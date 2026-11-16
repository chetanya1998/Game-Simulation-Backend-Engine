import { evalCurve, evaluateExpr, type EvalEnv, type ExprValue } from '@gamex/model';
import type { CExpr, CompiledModel, CPlacement, CVariable } from './compile.js';
import { EngineRuntimeError } from './errors.js';

export interface PersonaTraits {
  readonly skill: number;
  readonly churnSensitivity: number;
}

/** Everything that changes while a player plays. Immutable: every step returns a new value. */
export interface WorldState {
  /** Current screen id. */
  readonly state: string;
  readonly prevState: string;
  /** Screens to return to from overlays (Pause). */
  readonly stack: readonly string[];
  /** Simulated time in seconds. */
  readonly now: number;
  /** Variable and resource values by key. */
  readonly values: Readonly<Record<string, ExprValue>>;
  readonly persona: PersonaTraits;
  readonly inMission: boolean;
}

export interface CreateWorldOptions {
  readonly persona?: PersonaTraits;
  readonly now?: number;
  /** Start in this state instead of the model's initial state. */
  readonly state?: string;
  /** Override variable/resource values by key. */
  readonly values?: Readonly<Record<string, ExprValue>>;
}

export const DEFAULT_PERSONA: PersonaTraits = { skill: 0.5, churnSensitivity: 0.5 };

export function initialValues(c: CompiledModel): Record<string, ExprValue> {
  const values: Record<string, ExprValue> = {};
  for (const v of c.variables.values()) values[v.key] = v.initial;
  for (const r of c.resources.values()) values[r.key] = r.starting;
  return values;
}

export function createWorld(c: CompiledModel, options: CreateWorldOptions = {}): WorldState {
  const state = options.state ?? c.initialState;
  if (!c.states.has(state))
    throw new EngineRuntimeError(`Unknown state "${state}"`, 'UNKNOWN_STATE', `state:${state}`);
  const values = initialValues(c);
  for (const [key, value] of Object.entries(options.values ?? {})) {
    if (!(key in values))
      throw new EngineRuntimeError(`Unknown variable or resource key "${key}"`, 'UNKNOWN_KEY', key);
    values[key] = value;
  }
  return {
    state,
    prevState: state,
    stack: [],
    now: options.now ?? 0,
    values,
    persona: options.persona ?? DEFAULT_PERSONA,
    inMission: false,
  };
}

/** Resets every variable with the given scope to its initial value. */
export function resetScope(
  c: CompiledModel,
  values: Record<string, ExprValue>,
  scope: CVariable['scope'],
): void {
  for (const v of c.variables.values()) if (v.scope === scope) values[v.key] = v.initial;
}

export function placementEligibility(
  c: CompiledModel,
  w: WorldState,
  p: CPlacement,
): { eligible: boolean; reason?: string } {
  if (
    !p.inWorld &&
    (p.forbidden.has(w.state) || (p.triggerState !== undefined && p.forbidden.has(p.triggerState)))
  ) {
    return { eligible: false, reason: 'forbidden-state' };
  }
  for (const e of p.eligibility)
    if (!evalBool(c, w, e)) return { eligible: false, reason: `eligibility: ${e.source}` };
  for (const r of p.rules)
    if (r.blocking && !evalBool(c, w, r.expr)) return { eligible: false, reason: `rule:${r.id}` };
  return { eligible: true };
}

/** The values an expression can see in world `w`. */
export function envOf(c: CompiledModel, w: WorldState): EvalEnv {
  return {
    value(name) {
      const v = w.values[name];
      if (v !== undefined) return v;
      const k = c.constants.get(name);
      if (k !== undefined) return k;
      switch (name) {
        case 'now':
          return w.now;
        case 'state':
          return w.state;
        case 'prevState':
          return w.prevState;
        case 'persona.skill':
          return w.persona.skill;
        case 'persona.churnSensitivity':
          return w.persona.churnSensitivity;
        default:
          return undefined;
      }
    },
    curve(name, n) {
      const curve = c.curves.get(name);
      return curve === undefined
        ? { ok: false, error: `unknown curve "${name}"` }
        : evalCurve(curve, n);
    },
    eligible(id) {
      const p = c.placements.get(id);
      return p !== undefined && placementEligibility(c, w, p).eligible;
    },
  };
}

export function evalValue(c: CompiledModel, w: WorldState, e: CExpr): ExprValue {
  const r = evaluateExpr(e.ast, envOf(c, w));
  if (!r.ok) throw new EngineRuntimeError(r.error.message, r.error.code, e.nodeRef, e.source);
  return r.value;
}

export function evalNum(c: CompiledModel, w: WorldState, e: CExpr): number {
  const v = evalValue(c, w, e);
  if (typeof v !== 'number')
    throw new EngineRuntimeError(
      `expected a number, got ${JSON.stringify(v)}`,
      'EXPR_TYPE_MISMATCH',
      e.nodeRef,
      e.source,
    );
  return v;
}

export function evalBool(c: CompiledModel, w: WorldState, e: CExpr): boolean {
  const v = evalValue(c, w, e);
  if (typeof v !== 'boolean')
    throw new EngineRuntimeError(
      `expected a boolean, got ${JSON.stringify(v)}`,
      'EXPR_TYPE_MISMATCH',
      e.nodeRef,
      e.source,
    );
  return v;
}

/** Key identifying the "control" state (screen + variables), ignoring resources and timestamps. */
export function controlKey(c: CompiledModel, w: WorldState): string {
  const parts = [w.state, w.stack.join('>'), w.inMission ? 'M' : '-'];
  for (const v of c.variables.values())
    if (v.type !== 'timestamp') parts.push(`${v.key}=${String(w.values[v.key])}`);
  return parts.join('|');
}

/** Key of the full state except time (control + resources). */
export function worldKey(c: CompiledModel, w: WorldState): string {
  const parts = [controlKey(c, w)];
  for (const r of c.resources.values()) parts.push(`${r.key}=${String(w.values[r.key])}`);
  return parts.join('|');
}
