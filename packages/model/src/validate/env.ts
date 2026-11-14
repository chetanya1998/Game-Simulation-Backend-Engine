import type { SymbolInfo, TypeEnv } from '../expr/typecheck.js';
import type { ExprType } from '../expr/types.js';
import { idToKey } from '../ids.js';
import type { ImplicitPlan } from '../normalize.js';
import type { GameModel, Variable } from '../schema/game-model.js';

/** Names every expression can use, besides the model's own keys. */
export const BUILTIN_NAMES = [
  'now',
  'state',
  'prevState',
  'persona.skill',
  'persona.churnSensitivity',
] as const;

export function variableType(type: Variable['type']): ExprType {
  return type === 'bool' ? 'bool' : type === 'enum' ? 'string' : 'number';
}

export interface ModelEnvs {
  /** For action, rule, transition, placement, KPI and trace-invariant expressions. */
  readonly model: TypeEnv;
  /** For aggregate invariants: KPI keys and scalar constants. */
  readonly aggregate: TypeEnv;
  /** Type of each variable/resource target, by reference ("var:x", "res:y"). */
  readonly targets: ReadonlyMap<string, SymbolInfo>;
}

export function buildEnvs(model: GameModel, plan: ImplicitPlan): ModelEnvs {
  const symbols = new Map<string, SymbolInfo>();
  const targets = new Map<string, SymbolInfo>();
  const curves = new Set<string>();
  const stateIds = model.stateMachine.states.map((s) => s.id);

  const scalarConstants = new Map<string, SymbolInfo>();
  for (const c of model.constants) {
    if (typeof c.value === 'number') scalarConstants.set(idToKey(c.id), { type: 'number' });
    else curves.add(idToKey(c.id));
  }
  for (const [k, v] of scalarConstants) symbols.set(k, v);

  const variables = [
    ...model.variables,
    ...plan.variables.filter((v) => !model.variables.some((u) => u.id === v.id)),
  ];
  for (const v of variables) {
    const info: SymbolInfo =
      v.type === 'enum' && v.enumValues !== undefined
        ? { type: 'string', enumValues: v.enumValues }
        : { type: variableType(v.type) };
    symbols.set(idToKey(v.id), info);
    targets.set(`var:${v.id}`, info);
  }
  for (const r of model.resources) {
    symbols.set(idToKey(r.id), { type: 'number' });
    targets.set(`res:${r.id}`, { type: 'number' });
  }
  symbols.set('now', { type: 'number' });
  symbols.set('state', { type: 'string', enumValues: stateIds });
  symbols.set('prevState', { type: 'string', enumValues: stateIds });
  symbols.set('persona.skill', { type: 'number' });
  symbols.set('persona.churnSensitivity', { type: 'number' });

  const aggregateSymbols = new Map<string, SymbolInfo>(scalarConstants);
  for (const k of model.kpis) aggregateSymbols.set(idToKey(k.id), { type: 'number' });

  return {
    model: { symbols, curves, placements: new Set(model.monetization.placements.map((p) => p.id)) },
    aggregate: { symbols: aggregateSymbols, curves: new Set() },
    targets,
  };
}
