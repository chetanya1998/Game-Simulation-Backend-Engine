import {
  idToKey,
  normalizeGameModel,
  parseExpr,
  validateGameModel,
  type Curve,
  type Effect,
  type Expr,
  type ExprValue,
  type GameModel,
  type Placement,
  type State,
  type Transition,
  type Variable,
} from '@gamex/model';
import { EngineModelError } from './errors.js';

/** A parsed expression together with its source and owner, for error messages. */
export interface CExpr {
  readonly ast: Expr;
  readonly source: string;
  readonly nodeRef: string;
}

export interface CEffect {
  readonly op: Effect['op'];
  /** Key of the target variable or resource. */
  readonly key: string;
  readonly value: CExpr;
}

export interface CRule {
  readonly id: string;
  readonly expr: CExpr;
  readonly blocking: boolean;
  readonly errorCode: string;
}

export interface COutcome {
  readonly id: string;
  readonly weight: CExpr;
  readonly effects: readonly CEffect[];
}

export interface CAction {
  readonly id: string;
  readonly ref: string;
  readonly actor: string;
  readonly preconditions: readonly CExpr[];
  readonly costs: readonly {
    readonly key: string;
    readonly resourceId: string;
    readonly amount: CExpr;
  }[];
  readonly effects: readonly CEffect[];
  readonly outcomes: readonly COutcome[] | undefined;
  readonly duration: CExpr | undefined;
  readonly errorCode: string;
  readonly rules: readonly CRule[];
  /** Placements shown when this action runs (rewarded videos, IAP). */
  readonly placements: readonly CPlacement[];
}

export interface CPlacement {
  readonly id: string;
  readonly ref: string;
  readonly format: Placement['format'];
  readonly triggerState: string | undefined;
  readonly triggerAction: string | undefined;
  readonly eligibility: readonly CExpr[];
  readonly rules: readonly CRule[];
  readonly onShow: readonly CEffect[];
  readonly reward: readonly CEffect[];
  readonly forbidden: ReadonlySet<string>;
  readonly inWorld: boolean;
}

export interface CTransition {
  readonly id: string;
  readonly ref: string;
  readonly from: string;
  /** Target screen id, or "return" to leave an overlay. */
  readonly to: string;
  readonly trigger:
    | { readonly kind: 'ui' }
    | { readonly kind: 'auto' }
    | { readonly kind: 'action'; readonly actionId: string };
  readonly outcome: string | undefined;
  readonly guard: CExpr | undefined;
  readonly effects: readonly CEffect[];
  readonly beginsMission: boolean;
  readonly endsMission: boolean;
}

export interface CState {
  readonly id: string;
  readonly kind: State['kind'];
  readonly duration: CExpr | undefined;
}

export interface CVariable {
  readonly id: string;
  readonly key: string;
  readonly type: Variable['type'];
  readonly scope: Variable['scope'];
  readonly initial: ExprValue;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly derived: boolean;
}

export interface CResource {
  readonly id: string;
  readonly key: string;
  readonly starting: number;
  readonly cap: number | undefined;
}

export interface CTraceInvariant {
  readonly id: string;
  readonly expr: CExpr;
  readonly blocking: boolean;
  readonly at: { readonly kind: 'placement' | 'action' | 'state'; readonly id: string } | undefined;
}

/** A validated, normalized model with every expression parsed — ready to run. */
export interface CompiledModel {
  readonly model: GameModel;
  readonly constants: ReadonlyMap<string, number>;
  readonly curves: ReadonlyMap<string, Curve>;
  readonly variables: ReadonlyMap<string, CVariable>;
  readonly resources: ReadonlyMap<string, CResource>;
  readonly actions: ReadonlyMap<string, CAction>;
  readonly placements: ReadonlyMap<string, CPlacement>;
  readonly statePlacements: ReadonlyMap<string, readonly CPlacement[]>;
  readonly states: ReadonlyMap<string, CState>;
  readonly transitionsFrom: ReadonlyMap<string, readonly CTransition[]>;
  readonly transitions: readonly CTransition[];
  readonly initialState: string;
  readonly traceInvariants: readonly CTraceInvariant[];
  /** Parameter overrides applied to constants (by key). */
  readonly params: Readonly<Record<string, number>>;
}

export interface CompileOptions {
  /** Override scalar constants by key, e.g. `{ interstitialMinGapSeconds: 120 }`. */
  readonly params?: Readonly<Record<string, number>>;
}

const refId = (ref: string): string => ref.slice(ref.indexOf(':') + 1);

function compileExpr(source: string, nodeRef: string): CExpr {
  const parsed = parseExpr(source);
  if (!parsed.ok)
    throw new EngineModelError(`${nodeRef}: cannot parse "${source}": ${parsed.error.message}`);
  return { ast: parsed.value, source, nodeRef };
}

/**
 * Validates, normalizes and compiles a Game Model. Throws `EngineModelError` (with the validation issues)
 * when the model has errors — the engine never runs an invalid model.
 */
export function compileModel(input: GameModel, options: CompileOptions = {}): CompiledModel {
  const validation = validateGameModel(input);
  if (!validation.ok || validation.model === undefined) {
    throw new EngineModelError(
      'The Game Model has validation errors; fix them before simulating.',
      validation.issues.filter((i) => i.severity === 'error'),
    );
  }
  const model = normalizeGameModel(validation.model);
  const keyOfRef = new Map<string, string>();
  for (const v of model.variables) keyOfRef.set(`var:${v.id}`, idToKey(v.id));
  for (const r of model.resources) keyOfRef.set(`res:${r.id}`, idToKey(r.id));
  const effects = (list: readonly Effect[] | undefined, nodeRef: string): CEffect[] =>
    (list ?? []).map((e) => ({
      op: e.op,
      key: keyOfRef.get(e.target) ?? idToKey(refId(e.target)),
      value: compileExpr(e.value, nodeRef),
    }));

  const constants = new Map<string, number>();
  const curves = new Map<string, Curve>();
  for (const c of model.constants) {
    if (typeof c.value === 'number') constants.set(idToKey(c.id), c.value);
    else curves.set(idToKey(c.id), c.value);
  }
  const params = options.params ?? {};
  for (const [key, value] of Object.entries(params)) {
    if (!constants.has(key)) {
      throw new EngineModelError(
        `Unknown parameter "${key}": parameters override scalar constants by key (e.g. "interstitialMinGapSeconds").`,
      );
    }
    if (!Number.isFinite(value))
      throw new EngineModelError(`Parameter "${key}" must be a finite number.`);
    constants.set(key, value);
  }

  const variables = new Map<string, CVariable>();
  for (const v of model.variables) {
    variables.set(idToKey(v.id), {
      id: v.id,
      key: idToKey(v.id),
      type: v.type,
      scope: v.scope,
      initial: v.initial,
      min: v.min,
      max: v.max,
      derived: v.derivedFrom !== undefined,
    });
  }
  const resources = new Map<string, CResource>();
  for (const r of model.resources)
    resources.set(idToKey(r.id), {
      id: r.id,
      key: idToKey(r.id),
      starting: r.starting,
      cap: r.cap,
    });

  const rulesFor = (kind: 'actions' | 'placements', ref: string): CRule[] =>
    model.rules
      .filter((r) => r.appliesTo[kind]?.includes(ref) === true)
      .map((r) => ({
        id: r.id,
        expr: compileExpr(r.expr, `rule:${r.id}`),
        blocking: r.severity === 'blocking',
        errorCode: r.errorCode,
      }));

  const forbiddenGlobal = model.monetization.forbiddenStates.map(refId);
  const placements = new Map<string, CPlacement>();
  for (const p of model.monetization.placements) {
    const ref = `placement:${p.id}`;
    placements.set(p.id, {
      id: p.id,
      ref,
      format: p.format,
      triggerState: 'state' in p.trigger ? refId(p.trigger.state) : undefined,
      triggerAction: 'action' in p.trigger ? refId(p.trigger.action) : undefined,
      eligibility: p.eligibility.map((e) => compileExpr(e, ref)),
      rules: rulesFor('placements', ref),
      onShow: effects(p.onShow, ref),
      reward: effects(p.reward, ref),
      forbidden: new Set([...forbiddenGlobal, ...(p.forbiddenIn ?? []).map(refId)]),
      inWorld: p.inWorld === true,
    });
  }
  const statePlacements = new Map<string, CPlacement[]>();
  for (const p of placements.values()) {
    if (p.triggerState === undefined) continue;
    statePlacements.set(p.triggerState, [...(statePlacements.get(p.triggerState) ?? []), p]);
  }

  const actions = new Map<string, CAction>();
  for (const a of model.actions) {
    const ref = `action:${a.id}`;
    actions.set(a.id, {
      id: a.id,
      ref,
      actor: a.actor,
      preconditions: a.preconditions.map((p) => compileExpr(p, ref)),
      costs: a.costs.map((c) => ({
        key: keyOfRef.get(c.resource) ?? '',
        resourceId: refId(c.resource),
        amount: compileExpr(c.amount, ref),
      })),
      effects: effects(a.effects, ref),
      outcomes: a.outcomes?.map((o) => ({
        id: o.id,
        weight: compileExpr(o.weight, ref),
        effects: effects(o.effects, ref),
      })),
      duration: a.duration === undefined ? undefined : compileExpr(a.duration, ref),
      errorCode: a.errorCode,
      rules: rulesFor('actions', ref),
      placements: [...placements.values()].filter((p) => p.triggerAction === a.id),
    });
  }

  const states = new Map<string, CState>();
  for (const s of model.stateMachine.states) {
    states.set(s.id, {
      id: s.id,
      kind: s.kind,
      duration: s.duration === undefined ? undefined : compileExpr(s.duration, `state:${s.id}`),
    });
  }
  const transitions = model.stateMachine.transitions.map((t: Transition): CTransition => {
    const ref = `transition:${t.id}`;
    return {
      id: t.id,
      ref,
      from: refId(t.from),
      to: t.to === 'return' ? 'return' : refId(t.to),
      trigger:
        t.trigger === 'ui'
          ? { kind: 'ui' }
          : t.trigger === 'auto'
            ? { kind: 'auto' }
            : { kind: 'action', actionId: refId(t.trigger) },
      outcome: t.outcome,
      guard: t.guard === undefined ? undefined : compileExpr(t.guard, ref),
      effects: effects(t.effects, ref),
      beginsMission: t.beginsMission === true,
      endsMission: t.endsMission === true,
    };
  });
  const transitionsFrom = new Map<string, CTransition[]>();
  for (const t of transitions)
    transitionsFrom.set(t.from, [...(transitionsFrom.get(t.from) ?? []), t]);

  const traceInvariants: CTraceInvariant[] = [];
  for (const inv of model.invariants) {
    if (inv.kind !== 'trace') continue;
    let at: CTraceInvariant['at'];
    if (inv.at !== undefined) {
      const [kind, ref] = Object.entries(inv.at)[0] as ['placement' | 'action' | 'state', string];
      at = { kind, id: refId(ref) };
    }
    traceInvariants.push({
      id: inv.id,
      expr: compileExpr(inv.expr, `inv:${inv.id}`),
      blocking: inv.severity === 'blocking',
      at,
    });
  }

  return {
    model,
    constants,
    curves,
    variables,
    resources,
    actions,
    placements,
    statePlacements,
    states,
    transitionsFrom,
    transitions,
    initialState: refId(model.stateMachine.initial),
    traceInvariants,
    params: { ...params },
  };
}
