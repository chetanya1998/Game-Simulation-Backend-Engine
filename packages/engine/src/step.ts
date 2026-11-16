import type { ExprValue } from '@gamex/model';
import type { CAction, CEffect, CompiledModel, CTransition } from './compile.js';
import { EngineRuntimeError } from './errors.js';
import type { Rng } from './random.js';
import {
  envOf,
  evalBool,
  evalNum,
  evalValue,
  placementEligibility,
  resetScope,
  type WorldState,
} from './world.js';

export type EngineEvent =
  | {
      readonly type: 'action';
      readonly now: number;
      readonly actionId: string;
      readonly outcome?: string;
    }
  | {
      readonly type: 'rejected';
      readonly now: number;
      readonly actionId: string;
      readonly code: string;
    }
  | {
      readonly type: 'transition';
      readonly now: number;
      readonly transitionId: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: 'impression';
      readonly now: number;
      readonly placementId: string;
      readonly format: string;
    }
  | { readonly type: 'rule-warning'; readonly now: number; readonly ruleId: string }
  | { readonly type: 'cap-hit'; readonly now: number; readonly key: string; readonly cap: number }
  | {
      readonly type: 'range-violation';
      readonly now: number;
      readonly key: string;
      readonly value: number;
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly type: 'mission-begin'; readonly now: number }
  | { readonly type: 'mission-end'; readonly now: number };

export interface InvariantViolation {
  readonly invariantId: string;
  readonly blocking: boolean;
  readonly now: number;
  readonly state: string;
  readonly at: string;
}

export type Check =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly nodeRef: string;
    };

/** Change per key: numeric difference for numbers, the new value otherwise. */
export type Deltas = Readonly<Record<string, number | boolean | string>>;

export interface ActionResult {
  readonly result: 'ok' | 'rejected';
  readonly error?: { readonly code: string; readonly message: string };
  readonly outcome?: string;
  readonly deltas: Deltas;
  readonly next: WorldState;
  readonly events: readonly EngineEvent[];
  readonly violations: readonly InvariantViolation[];
}

export interface StepOptions {
  /** Outcome to force for an action with random outcomes (golden tests). Otherwise sampled with `rng`. */
  readonly outcome?: string;
  readonly rng?: Rng;
  /** Evaluate trace invariants during the step (default true). */
  readonly checkInvariants?: boolean;
  /** Counts how often each invariant was evaluated (for "checked N times" in reports). */
  readonly invariantCounter?: Map<string, number>;
}

function constCase(id: string): string {
  return id.toUpperCase().replaceAll('-', '_');
}

/** Checks trace invariants attached to a point (or, with `at` undefined, the per-step ones). */
export function checkInvariantsAt(
  c: CompiledModel,
  w: WorldState,
  kind: 'placement' | 'action' | 'state' | 'step',
  id = '',
  counter?: Map<string, number>,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const inv of c.traceInvariants) {
    const matches =
      kind === 'step' ? inv.at === undefined : inv.at?.kind === kind && inv.at.id === id;
    if (matches) counter?.set(inv.id, (counter.get(inv.id) ?? 0) + 1);
    if (matches && !evalBool(c, w, inv.expr)) {
      out.push({
        invariantId: inv.id,
        blocking: inv.blocking,
        now: w.now,
        state: w.state,
        at: kind === 'step' ? 'step' : `${kind}:${id}`,
      });
    }
  }
  return out;
}

/** Whether an action may run now; the first failing check decides the error code. */
export function checkAction(c: CompiledModel, w: WorldState, actionId: string): Check {
  const a = c.actions.get(actionId);
  if (a === undefined)
    throw new EngineRuntimeError(
      `Unknown action "${actionId}"`,
      'UNKNOWN_ACTION',
      `action:${actionId}`,
    );
  for (const p of a.preconditions) {
    if (!evalBool(c, w, p))
      return {
        ok: false,
        code: a.errorCode,
        message: `precondition failed: ${p.source}`,
        nodeRef: a.ref,
      };
  }
  for (const r of a.rules) {
    if (r.blocking && !evalBool(c, w, r.expr))
      return {
        ok: false,
        code: r.errorCode,
        message: `rule ${r.id} failed: ${r.expr.source}`,
        nodeRef: `rule:${r.id}`,
      };
  }
  for (const p of a.placements) {
    const e = placementEligibility(c, w, p);
    if (!e.eligible) {
      const rule =
        e.reason?.startsWith('rule:') === true
          ? p.rules.find((r) => `rule:${r.id}` === e.reason)
          : undefined;
      return {
        ok: false,
        code: rule?.errorCode ?? 'PLACEMENT_NOT_ELIGIBLE',
        message: `${p.ref} is not eligible (${e.reason ?? ''})`,
        nodeRef: p.ref,
      };
    }
  }
  for (const cost of a.costs) {
    const amount = evalNum(c, w, cost.amount);
    const have = w.values[cost.key];
    if (typeof have !== 'number' || have < amount) {
      return {
        ok: false,
        code: `INSUFFICIENT_${constCase(cost.resourceId)}`,
        message: `needs ${String(amount)} ${cost.key}, has ${String(have)}`,
        nodeRef: a.ref,
      };
    }
  }
  return { ok: true };
}

interface Computed {
  readonly op: CEffect['op'];
  readonly key: string;
  readonly value: ExprValue;
  readonly nodeRef: string;
}

/** Evaluates effect values against `w` (the state before the step). */
export function computeEffects(
  c: CompiledModel,
  w: WorldState,
  effects: readonly CEffect[],
): Computed[] {
  return effects.map((e) => ({
    op: e.op,
    key: e.key,
    value: evalValue(c, w, e.value),
    nodeRef: e.value.nodeRef,
  }));
}

/** Applies computed effects in order to a copy of `values`, enforcing types, caps and ranges. */
export function applyComputed(
  c: CompiledModel,
  values: Record<string, ExprValue>,
  computed: readonly Computed[],
  now: number,
  events: EngineEvent[],
): void {
  for (const e of computed) {
    const old = values[e.key];
    let next: ExprValue;
    if (e.op === 'set') next = e.value;
    else {
      if (typeof old !== 'number' || typeof e.value !== 'number') {
        throw new EngineRuntimeError(
          `"${e.op}" needs numbers, got ${JSON.stringify(old)} and ${JSON.stringify(e.value)}`,
          'EFFECT_TYPE',
          e.nodeRef,
        );
      }
      next = e.op === 'add' ? old + e.value : old - e.value;
    }
    const variable = c.variables.get(e.key);
    const resource = c.resources.get(e.key);
    if (typeof next === 'number') {
      if ((resource !== undefined || variable?.type === 'int') && !Number.isInteger(next)) {
        throw new EngineRuntimeError(
          `${e.key} must be a whole number, got ${String(next)}`,
          'NON_INTEGER',
          e.nodeRef,
        );
      }
      if (resource !== undefined) {
        if (next < 0) {
          events.push({ type: 'range-violation', now, key: e.key, value: next, min: 0 });
          next = 0;
        }
        if (resource.cap !== undefined && next > resource.cap) {
          events.push({ type: 'cap-hit', now, key: e.key, cap: resource.cap });
          next = resource.cap;
        }
      } else if (
        variable !== undefined &&
        ((variable.min !== undefined && next < variable.min) ||
          (variable.max !== undefined && next > variable.max))
      ) {
        events.push({
          type: 'range-violation',
          now,
          key: e.key,
          value: next,
          ...(variable.min === undefined ? {} : { min: variable.min }),
          ...(variable.max === undefined ? {} : { max: variable.max }),
        });
      }
    }
    values[e.key] = next;
  }
}

export function diffValues(
  before: Readonly<Record<string, ExprValue>>,
  after: Readonly<Record<string, ExprValue>>,
): Deltas {
  const out: Record<string, number | boolean | string> = {};
  for (const key of Object.keys(after).sort()) {
    const a = before[key];
    const b = after[key];
    if (a === b || b === undefined) continue;
    out[key] = typeof a === 'number' && typeof b === 'number' ? b - a : b;
  }
  return out;
}

function chooseOutcome(
  c: CompiledModel,
  w: WorldState,
  a: CAction,
  options: StepOptions,
): string | undefined {
  if (a.outcomes === undefined) return undefined;
  if (options.outcome !== undefined) {
    if (!a.outcomes.some((o) => o.id === options.outcome)) {
      throw new EngineRuntimeError(
        `Action has no outcome "${options.outcome}"`,
        'UNKNOWN_OUTCOME',
        a.ref,
      );
    }
    return options.outcome;
  }
  const weights = a.outcomes.map((o) => {
    const wgt = evalNum(c, w, o.weight);
    if (wgt < 0)
      throw new EngineRuntimeError(
        `outcome "${o.id}" has a negative weight (${String(wgt)})`,
        'NEGATIVE_WEIGHT',
        a.ref,
        o.weight.source,
      );
    return wgt;
  });
  if (options.rng === undefined)
    throw new EngineRuntimeError(
      'an rng or an explicit outcome is needed for an action with outcomes',
      'NO_RNG',
      a.ref,
    );
  const index = options.rng.weightedIndex(weights);
  if (index < 0) throw new EngineRuntimeError('every outcome weight is 0', 'NO_OUTCOME', a.ref);
  return a.outcomes[index]?.id;
}

/**
 * Runs one action — the single enforcement path used by simulation, exploration and golden tests.
 * Checks preconditions, rules, placement eligibility and costs; picks an outcome; evaluates every effect
 * against the state before the step and applies them together; advances time by the action's duration.
 */
export function applyAction(
  c: CompiledModel,
  w: WorldState,
  actionId: string,
  options: StepOptions = {},
): ActionResult {
  const check = checkAction(c, w, actionId);
  if (!check.ok) {
    return {
      result: 'rejected',
      error: { code: check.code, message: check.message },
      deltas: {},
      next: w,
      events: [{ type: 'rejected', now: w.now, actionId, code: check.code }],
      violations: [],
    };
  }
  const a = c.actions.get(actionId) as CAction;
  const violations: InvariantViolation[] = [];
  const checking = options.checkInvariants !== false;
  if (checking) {
    violations.push(...checkInvariantsAt(c, w, 'action', actionId, options.invariantCounter));
    for (const p of a.placements)
      violations.push(...checkInvariantsAt(c, w, 'placement', p.id, options.invariantCounter));
  }
  const events: EngineEvent[] = [];
  for (const r of a.rules)
    if (!r.blocking && !evalBool(c, w, r.expr))
      events.push({ type: 'rule-warning', now: w.now, ruleId: r.id });

  const outcome = chooseOutcome(c, w, a, options);
  const effects: CEffect[] = [...a.effects];
  if (outcome !== undefined)
    effects.push(...(a.outcomes?.find((o) => o.id === outcome)?.effects ?? []));
  for (const p of a.placements) effects.push(...p.onShow, ...p.reward);
  const computed = [
    ...a.costs.map((cost): Computed => ({
      op: 'sub',
      key: cost.key,
      value: evalNum(c, w, cost.amount),
      nodeRef: a.ref,
    })),
    ...computeEffects(c, w, effects),
  ];
  const values = { ...w.values };
  events.push(
    outcome === undefined
      ? { type: 'action', now: w.now, actionId }
      : { type: 'action', now: w.now, actionId, outcome },
  );
  for (const p of a.placements)
    events.push({ type: 'impression', now: w.now, placementId: p.id, format: p.format });
  applyComputed(c, values, computed, w.now, events);
  const duration = a.duration === undefined ? 0 : evalNum(c, w, a.duration);
  const next: WorldState = { ...w, values, now: w.now + duration };
  return {
    result: 'ok',
    ...(outcome === undefined ? {} : { outcome }),
    deltas: diffValues(w.values, values),
    next,
    events,
    violations,
  };
}

/** A choice available in the current screen. */
export type StepOption =
  | { readonly kind: 'ui' | 'auto'; readonly transition: CTransition }
  | {
      readonly kind: 'action';
      readonly actionId: string;
      readonly transitions: readonly CTransition[];
    };

export function guardHolds(c: CompiledModel, w: WorldState, t: CTransition): boolean {
  return t.guard === undefined || evalBool(c, w, t.guard);
}

/** Every option available in `w.state`: ui and auto transitions whose guards hold, and runnable actions. */
export function availableOptions(c: CompiledModel, w: WorldState): StepOption[] {
  const out: StepOption[] = [];
  const byAction = new Map<string, CTransition[]>();
  for (const t of c.transitionsFrom.get(w.state) ?? []) {
    if (t.trigger.kind === 'action') {
      if (guardHolds(c, w, t))
        byAction.set(t.trigger.actionId, [...(byAction.get(t.trigger.actionId) ?? []), t]);
    } else if (guardHolds(c, w, t)) {
      out.push({ kind: t.trigger.kind, transition: t });
    }
  }
  for (const [actionId, transitions] of byAction)
    if (checkAction(c, w, actionId).ok) out.push({ kind: 'action', actionId, transitions });
  return out;
}

export interface StepResult {
  readonly next: WorldState;
  readonly events: readonly EngineEvent[];
  readonly violations: readonly InvariantViolation[];
  readonly action?: ActionResult;
  readonly transition?: CTransition;
}

/** Moves along a transition: mission bookkeeping, transition effects, entering the target screen. */
function enter(
  c: CompiledModel,
  pre: WorldState,
  values: Record<string, ExprValue>,
  t: CTransition,
  now: number,
  events: EngineEvent[],
  violations: InvariantViolation[],
  checking: boolean,
  counter?: Map<string, number>,
): WorldState {
  let target: string;
  let stack: string[];
  if (t.to === 'return') {
    const top = pre.stack.at(-1);
    if (top === undefined)
      throw new EngineRuntimeError(
        '"return" with nothing to return to',
        'EMPTY_RETURN_STACK',
        t.ref,
      );
    target = top;
    stack = pre.stack.slice(0, -1);
  } else {
    target = t.to;
    stack = c.states.get(target)?.kind === 'overlay' ? [...pre.stack, pre.state] : [];
  }
  const computed = computeEffects(c, pre, t.effects);
  let inMission = pre.inMission;
  if (t.beginsMission) {
    resetScope(c, values, 'mission');
    inMission = true;
    events.push({ type: 'mission-begin', now });
  }
  applyComputed(c, values, computed, now, events);
  if (t.endsMission) {
    inMission = false;
    events.push({ type: 'mission-end', now });
  }
  events.push({ type: 'transition', now, transitionId: t.id, from: pre.state, to: target });
  let w: WorldState = {
    ...pre,
    state: target,
    prevState: pre.state,
    stack,
    values,
    now,
    inMission,
  };
  if (checking) violations.push(...checkInvariantsAt(c, w, 'state', target, counter));

  for (const p of c.statePlacements.get(target) ?? []) {
    if (!placementEligibility(c, w, p).eligible) continue;
    if (checking) violations.push(...checkInvariantsAt(c, w, 'placement', p.id, counter));
    const shown = { ...w.values };
    applyComputed(c, shown, computeEffects(c, w, p.onShow), now, events);
    events.push({ type: 'impression', now, placementId: p.id, format: p.format });
    w = { ...w, values: shown };
  }
  const state = c.states.get(target);
  const duration = state?.duration === undefined ? 0 : evalNum(c, w, state.duration);
  return { ...w, now: w.now + duration };
}

/** Performs one option: runs the action (if any), follows the matching transition, enters the screen. */
export function perform(
  c: CompiledModel,
  w: WorldState,
  option: StepOption,
  options: StepOptions = {},
): StepResult {
  const checking = options.checkInvariants !== false;
  const events: EngineEvent[] = [];
  const violations: InvariantViolation[] = [];
  if (option.kind !== 'action') {
    const next = enter(
      c,
      w,
      { ...w.values },
      option.transition,
      w.now,
      events,
      violations,
      checking,
      options.invariantCounter,
    );
    if (checking)
      violations.push(...checkInvariantsAt(c, next, 'step', '', options.invariantCounter));
    return { next, events, violations, transition: option.transition };
  }
  const action = applyAction(c, w, option.actionId, options);
  events.push(...action.events);
  violations.push(...action.violations);
  if (action.result === 'rejected') return { next: w, events, violations, action };
  const t = option.transitions.find(
    (x) => (x.outcome === undefined || x.outcome === action.outcome) && guardHolds(c, w, x),
  );
  if (t === undefined) {
    if (checking)
      violations.push(...checkInvariantsAt(c, action.next, 'step', '', options.invariantCounter));
    return { next: action.next, events, violations, action };
  }
  // Transition effects are evaluated against the pre-step state, like the action's own effects.
  const pre: WorldState = { ...w, now: action.next.now };
  const next = enter(
    c,
    pre,
    { ...action.next.values },
    t,
    action.next.now,
    events,
    violations,
    checking,
    options.invariantCounter,
  );
  if (checking)
    violations.push(...checkInvariantsAt(c, next, 'step', '', options.invariantCounter));
  return { next, events, violations, action, transition: t };
}

/** Takes auto transitions until none applies (guarding against infinite auto loops). */
export function settle(
  c: CompiledModel,
  w: WorldState,
  options: StepOptions = {},
  limit = 100,
): StepResult {
  let current = w;
  const events: EngineEvent[] = [];
  const violations: InvariantViolation[] = [];
  for (let i = 0; i < limit; i++) {
    const auto = availableOptions(c, current).find((o) => o.kind === 'auto');
    if (auto === undefined) return { next: current, events, violations };
    const r = perform(c, current, auto, options);
    events.push(...r.events);
    violations.push(...r.violations);
    current = r.next;
  }
  throw new EngineRuntimeError(
    `more than ${String(limit)} automatic transitions in a row (an auto loop?)`,
    'AUTO_LOOP',
    `state:${current.state}`,
  );
}

export { envOf };
