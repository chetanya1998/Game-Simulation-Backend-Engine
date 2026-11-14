import { idToKey } from './ids.js';
import type {
  Action,
  Effect,
  GameModel,
  Limit,
  Placement,
  Provenance,
  Rule,
  Variable,
} from './schema/game-model.js';

/** Initial value of "last shown/used at" timestamps: far enough in the past that no cooldown applies. */
export const NEVER = -1e12;

const SCOPE_OF_LIMIT: Record<Limit['per'], Variable['scope']> = {
  mission: 'mission',
  session: 'session',
  day: 'day',
  lifetime: 'player',
};

export interface ImplicitPlan {
  /** Counter and timestamp variables created for limits, caps and cooldowns. */
  readonly variables: readonly Variable[];
  /** Guard rules enforcing those limits, caps and cooldowns. */
  readonly rules: readonly Rule[];
  /** Effects appended to an action (by action id) when it succeeds. */
  readonly actionEffects: ReadonlyMap<string, readonly Effect[]>;
  /** Effects appended to a placement's `onShow` (by placement id). */
  readonly placementEffects: ReadonlyMap<string, readonly Effect[]>;
}

function constCase(id: string): string {
  return id.toUpperCase().replaceAll('-', '_');
}

function derivedProvenance(origin: Provenance, location: string): Provenance {
  return {
    source: 'gamex:derived',
    location,
    excerpt: '',
    confidence: 'high',
    status: origin.status,
  };
}

interface Limited {
  readonly kind: 'action' | 'placement';
  readonly id: string;
  readonly path: string;
  readonly provenance: Provenance;
  readonly limits: readonly Limit[];
  readonly cooldown:
    { readonly seconds: string; readonly errorCode?: string | undefined } | undefined;
}

function limitedNodes(model: GameModel): Limited[] {
  const actions = model.actions.map((a: Action, i): Limited => ({
    kind: 'action',
    id: a.id,
    path: `/actions/${String(i)}`,
    provenance: a.provenance,
    limits: a.limits ?? [],
    cooldown: a.cooldown,
  }));
  const placements = model.monetization.placements.map((p: Placement, i): Limited => ({
    kind: 'placement',
    id: p.id,
    path: `/monetization/placements/${String(i)}`,
    provenance: p.provenance,
    limits: p.caps ?? [],
    cooldown: p.cooldownSeconds === undefined ? undefined : { seconds: p.cooldownSeconds },
  }));
  return [...actions, ...placements];
}

/**
 * Desugars limits, caps and cooldowns into ordinary variables + guard rules + effects, so the engine has
 * exactly one enforcement path. Names are deterministic: action `revive` with a per-mission limit gets
 * variable `revive-count-mission` (key `reviveCountMission`) and rule `revive-limit-mission`.
 */
export function planImplicit(model: GameModel): ImplicitPlan {
  const variables: Variable[] = [];
  const rules: Rule[] = [];
  const actionEffects = new Map<string, Effect[]>();
  const placementEffects = new Map<string, Effect[]>();

  for (const node of limitedNodes(model)) {
    const effects: Effect[] = [];
    const appliesTo =
      node.kind === 'action'
        ? { actions: [`action:${node.id}`] }
        : { placements: [`placement:${node.id}`] };
    const origin = `${node.kind}:${node.id}`;
    const seenScopes = new Set<string>();
    const usedRuleIds = new Set<string>();

    node.limits.forEach((limit, j) => {
      const counterId = `${node.id}-count-${limit.per}`;
      const counterKey = idToKey(counterId);
      if (!seenScopes.has(limit.per)) {
        seenScopes.add(limit.per);
        variables.push({
          id: counterId,
          key: counterKey,
          description: `How many times ${origin} happened this ${limit.per}.`,
          derivedFrom: origin,
          scope: SCOPE_OF_LIMIT[limit.per],
          type: 'int',
          initial: 0,
          min: 0,
          provenance: derivedProvenance(
            node.provenance,
            `${node.path}/${node.kind === 'action' ? 'limits' : 'caps'}/${String(j)}`,
          ),
        });
        effects.push({ op: 'add', target: `var:${counterId}`, value: '1' });
      }
      let ruleId = `${node.id}-limit-${limit.per}`;
      if (usedRuleIds.has(ruleId)) ruleId = `${ruleId}-${String(j)}`;
      usedRuleIds.add(ruleId);
      rules.push({
        id: ruleId,
        key: idToKey(ruleId),
        description: `At most (${limit.max}) per ${limit.per}.`,
        derivedFrom: origin,
        appliesTo,
        expr: `${counterKey} < (${limit.max})`,
        severity: 'blocking',
        errorCode: limit.errorCode ?? `${constCase(node.id)}_LIMIT_REACHED`,
        provenance: derivedProvenance(
          node.provenance,
          `${node.path}/${node.kind === 'action' ? 'limits' : 'caps'}/${String(j)}`,
        ),
      });
    });

    if (node.cooldown !== undefined) {
      const lastId = `${node.id}-last-at`;
      const lastKey = idToKey(lastId);
      const location = `${node.path}/${node.kind === 'action' ? 'cooldown' : 'cooldownSeconds'}`;
      variables.push({
        id: lastId,
        key: lastKey,
        description: `Simulated time (seconds) when ${origin} last happened.`,
        derivedFrom: origin,
        scope: 'player',
        type: 'timestamp',
        initial: NEVER,
        provenance: derivedProvenance(node.provenance, location),
      });
      rules.push({
        id: `${node.id}-cooldown`,
        key: idToKey(`${node.id}-cooldown`),
        description: `At least (${node.cooldown.seconds}) seconds apart.`,
        derivedFrom: origin,
        appliesTo,
        expr: `now - ${lastKey} >= (${node.cooldown.seconds})`,
        severity: 'blocking',
        errorCode: node.cooldown.errorCode ?? `${constCase(node.id)}_COOLDOWN_ACTIVE`,
        provenance: derivedProvenance(node.provenance, location),
      });
      effects.push({ op: 'set', target: `var:${lastId}`, value: 'now' });
    }

    if (effects.length > 0)
      (node.kind === 'action' ? actionEffects : placementEffects).set(node.id, effects);
  }
  return { variables, rules, actionEffects, placementEffects };
}

function withKey<T extends { id: string; key?: string | undefined }>(node: T): T {
  return { ...node, key: idToKey(node.id) };
}

function sameEffect(a: Effect, b: Effect): boolean {
  return a.op === b.op && a.target === b.target && a.value === b.value;
}

function appendEffects(
  existing: readonly Effect[] | undefined,
  extra: readonly Effect[] | undefined,
): Effect[] | undefined {
  if (extra === undefined || extra.length === 0)
    return existing === undefined ? undefined : [...existing];
  const out = [...(existing ?? [])];
  for (const e of extra) if (!out.some((x) => sameEffect(x, e))) out.push(e);
  return out;
}

/**
 * Returns a normalized copy of a (schema-valid) model: every node has its `key`, and limits, caps and
 * cooldowns are desugared (see `planImplicit`). Idempotent: normalizing twice equals normalizing once.
 */
export function normalizeGameModel(model: GameModel): GameModel {
  const m = JSON.parse(JSON.stringify(model)) as GameModel;
  const plan = planImplicit(m);
  const varIds = new Set(m.variables.map((v) => v.id));
  const ruleIds = new Set(m.rules.map((r) => r.id));

  const placements = m.monetization.placements.map((p) => {
    const onShow = appendEffects(p.onShow, plan.placementEffects.get(p.id));
    return withKey(onShow === undefined ? p : { ...p, onShow });
  });

  return {
    ...m,
    entities: m.entities.map(withKey),
    resources: m.resources.map(withKey),
    constants: m.constants.map(withKey),
    variables: [...m.variables, ...plan.variables.filter((v) => !varIds.has(v.id))].map(withKey),
    actions: m.actions.map((a) =>
      withKey({ ...a, effects: appendEffects(a.effects, plan.actionEffects.get(a.id)) ?? [] }),
    ),
    rules: [...m.rules, ...plan.rules.filter((r) => !ruleIds.has(r.id))].map(withKey),
    stateMachine: {
      ...m.stateMachine,
      states: m.stateMachine.states.map(withKey),
      transitions: m.stateMachine.transitions.map(withKey),
    },
    flows: m.flows.map(withKey),
    monetization: { ...m.monetization, placements },
    personas: m.personas.map(withKey),
    kpis: m.kpis.map(withKey),
    invariants: m.invariants.map(withKey),
    gaps: m.gaps.map(withKey),
  };
}
