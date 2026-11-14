import type { RefKind } from '../schema/common.js';
import { REF_PREFIXES } from '../schema/common.js';
import type { GameModel } from '../schema/game-model.js';
import type { Path } from './collector.js';

export interface NodeEntry {
  readonly kind: RefKind;
  readonly id: string;
  readonly key?: string | undefined;
  readonly path: Path;
  readonly status: string;
  readonly ref: string;
}

/** Every identified node of the model with its kind and location. */
export function listNodes(model: GameModel): NodeEntry[] {
  const out: NodeEntry[] = [];
  const add = (
    kind: RefKind,
    base: Path,
    nodes: readonly { id: string; key?: string | undefined; provenance: { status: string } }[],
  ): void => {
    nodes.forEach((n, i) => {
      out.push({
        kind,
        id: n.id,
        key: n.key,
        path: [...base, i],
        status: n.provenance.status,
        ref: `${REF_PREFIXES[kind]}:${n.id}`,
      });
    });
  };
  add('entity', ['entities'], model.entities);
  add('resource', ['resources'], model.resources);
  add('constant', ['constants'], model.constants);
  add('variable', ['variables'], model.variables);
  add('action', ['actions'], model.actions);
  add('rule', ['rules'], model.rules);
  add('state', ['stateMachine', 'states'], model.stateMachine.states);
  add('transition', ['stateMachine', 'transitions'], model.stateMachine.transitions);
  add('flow', ['flows'], model.flows);
  add('placement', ['monetization', 'placements'], model.monetization.placements);
  add('persona', ['personas'], model.personas);
  add('kpi', ['kpis'], model.kpis);
  add('invariant', ['invariants'], model.invariants);
  add('gap', ['gaps'], model.gaps);
  return out;
}

export type NodeIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** Ids per reference prefix, e.g. index.get("state") → {"s00-loading", …}. */
export function indexNodes(
  nodes: readonly NodeEntry[],
  extraVariableIds: Iterable<string> = [],
): NodeIndex {
  const index = new Map<string, Set<string>>();
  for (const prefix of Object.values(REF_PREFIXES)) index.set(prefix, new Set());
  for (const n of nodes) index.get(REF_PREFIXES[n.kind])?.add(n.id);
  for (const id of extraVariableIds) index.get('var')?.add(id);
  return index;
}
