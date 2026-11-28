import { canonicalStringify, sha256Hex, type GameModel, type Provenance } from '@gamex/model';

/** The review ledger (gamex/review.json, ADR 0008). Mirrors @gamex/extract, which the browser cannot import. */
export type Decision = 'approve' | 'reject' | 'assume' | 'edit';
export interface LedgerDecision {
  ref: string;
  decision: Decision;
  set?: Record<string, unknown>;
  note?: string;
  hash?: string;
}
export interface ReviewLedger {
  version: 1;
  default?: 'approve' | 'reject' | 'assume' | 'pending';
  decisions: LedgerDecision[];
}

export const EMPTY_LEDGER: ReviewLedger = { version: 1, decisions: [] };

/** Same as @gamex/extract's itemHash: content hash of an item without its review status. */
export function itemHash(node: object): string {
  const { provenance, ...rest } = node as { provenance?: Record<string, unknown> };
  const prov = Object.fromEntries(Object.entries(provenance ?? {}).filter(([k]) => k !== 'status'));
  return sha256Hex(canonicalStringify({ ...rest, provenance: prov })).slice(0, 16);
}

export interface Item {
  kind: string;
  ref: string;
  id: string;
  name: string;
  provenance: Provenance;
  node: Record<string, unknown> & { id: string; provenance: Provenance };
}

export const KINDS: readonly (readonly [string, string, (m: GameModel) => readonly unknown[]])[] = [
  ['Entities', 'ent', (m) => m.entities],
  ['Resources', 'res', (m) => m.resources],
  ['Constants', 'const', (m) => m.constants],
  ['Variables', 'var', (m) => m.variables],
  ['Actions', 'action', (m) => m.actions],
  ['Rules', 'rule', (m) => m.rules],
  ['Screens', 'state', (m) => m.stateMachine.states],
  ['Transitions', 'transition', (m) => m.stateMachine.transitions],
  ['Economy flows', 'flow', (m) => m.flows],
  ['Placements', 'placement', (m) => m.monetization.placements],
  ['Personas', 'persona', (m) => m.personas],
  ['KPIs', 'kpi', (m) => m.kpis],
  ['Invariants', 'inv', (m) => m.invariants],
  ['Gaps', 'gap', (m) => m.gaps],
];

export function itemsOf(model: GameModel): Item[] {
  return KINDS.flatMap(([kind, prefix, get]) =>
    (get(model) as Item['node'][]).map((node) => ({
      kind,
      ref: `${prefix}:${node.id}`,
      id: node.id,
      name: typeof node['name'] === 'string' ? node['name'] : node.id,
      provenance: node.provenance,
      node,
    })),
  );
}

/** The decision that applies to an item: its own (unless the item changed since), else the default. */
export function decisionOf(ledger: ReviewLedger, item: Item): Decision | 'pending' {
  const d = ledger.decisions.find((x) => x.ref === item.ref);
  if (d !== undefined && (d.hash === undefined || d.hash === itemHash(item.node)))
    return d.decision;
  if (d !== undefined) return 'pending';
  return ledger.default ?? 'pending';
}

export function decide(
  ledger: ReviewLedger,
  item: Item,
  decision: Decision,
  set?: Record<string, unknown>,
): ReviewLedger {
  const entry: LedgerDecision = {
    ref: item.ref,
    decision,
    hash: itemHash(item.node),
    ...(set === undefined ? {} : { set }),
  };
  return {
    ...ledger,
    decisions: [...ledger.decisions.filter((d) => d.ref !== item.ref), entry].sort((a, b) =>
      a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
    ),
  };
}
