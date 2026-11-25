import { validateGameModel, type GameModel, type Issue, type Provenance } from '@gamex/model';
import { z } from 'zod';
import {
  NODE_ARRAYS,
  RepairError,
  repairModel,
  type Dropped,
  type RepairResult,
} from './repair.js';

export const DECISIONS = ['approve', 'reject', 'assume', 'edit'] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * `gamex/review.json`: the designer's decisions on extracted items, committed with the repo so a
 * re-extraction keeps them. Items without a decision use `default` ("pending" = left out).
 */
export const ReviewLedgerSchema = z.strictObject({
  version: z.literal(1),
  default: z.enum(['approve', 'reject', 'assume', 'pending']).optional(),
  decisions: z.array(
    z.strictObject({
      /** Typed ref of the item, e.g. "placement:rewarded-revive". */
      ref: z.string(),
      decision: z.enum(DECISIONS),
      /** For "edit": fields to replace on the item (null removes a field). The id cannot change. */
      set: z.record(z.string(), z.unknown()).optional(),
      note: z.string().optional(),
    }),
  ),
});
export type ReviewLedger = z.infer<typeof ReviewLedgerSchema>;

export const EMPTY_LEDGER: ReviewLedger = { version: 1, decisions: [] };

export interface ReviewItem {
  readonly ref: string;
  readonly name: string;
  readonly provenance: Provenance;
  readonly decision: Decision | 'pending';
}

export interface PromoteSummary {
  readonly approved: number;
  readonly assumed: number;
  readonly edited: number;
  readonly rejected: number;
  /** Items without a decision, left out of the model. */
  readonly pending: readonly string[];
  /** Items removed because something they depend on was rejected or left out. */
  readonly cascaded: readonly Dropped[];
  /** Decisions for refs the candidate does not contain (e.g. after re-extraction). */
  readonly stale: readonly string[];
}

export interface PromoteResult {
  readonly model: GameModel;
  readonly summary: PromoteSummary;
  readonly issues: readonly Issue[];
}

type AnyNode = { id: string; name?: string; provenance: Provenance } & Record<string, unknown>;

function listOf(model: GameModel, path: readonly string[]): AnyNode[] {
  let cur: unknown = model;
  for (const s of path) cur = (cur as Record<string, unknown>)[s];
  return cur as AnyNode[];
}

/** Every reviewable item of a candidate, with its current decision. */
export function reviewItems(candidate: GameModel, ledger: ReviewLedger): ReviewItem[] {
  const decided = new Map(ledger.decisions.map((d) => [d.ref, d.decision]));
  const fallback = ledger.default ?? 'pending';
  return NODE_ARRAYS.flatMap(([path, prefix]) =>
    listOf(candidate, path).map((n) => {
      const ref = `${prefix}:${n.id}`;
      const decision = decided.get(ref) ?? (fallback === 'pending' ? 'pending' : fallback);
      return { ref, name: n.name ?? n.id, provenance: n.provenance, decision };
    }),
  );
}

/** Adds or replaces the decision for a ref. */
export function decide(
  ledger: ReviewLedger,
  ref: string,
  decision: Decision,
  extra: { set?: Record<string, unknown>; note?: string } = {},
): ReviewLedger {
  return {
    ...ledger,
    decisions: [...ledger.decisions.filter((d) => d.ref !== ref), { ref, decision, ...extra }].sort(
      (a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    ),
  };
}

/**
 * Builds the reviewed Game Model from a candidate and the ledger: approved items become `confirmed`
 * (assumed items stay `assumed`), "assume" marks an item as an assumption, "edit" applies the given
 * fields and marks it `edited`, rejected and undecided items are left out, and anything that then
 * depends on a missing item is removed too (reported as `cascaded`).
 */
export function promote(candidate: GameModel, ledger: ReviewLedger): PromoteResult {
  const model = structuredClone(candidate);
  const byRef = new Map(ledger.decisions.map((d) => [d.ref, d]));
  const seen = new Set<string>();
  let approved = 0;
  let assumed = 0;
  let edited = 0;
  let rejected = 0;
  const pending: string[] = [];

  for (const [path, prefix] of NODE_ARRAYS) {
    const list = listOf(model, path);
    const kept: AnyNode[] = [];
    for (const node of list) {
      const ref = `${prefix}:${node.id}`;
      seen.add(ref);
      const entry = byRef.get(ref);
      const decision = entry?.decision ?? ledger.default ?? 'pending';
      if (decision === 'pending') {
        pending.push(ref);
        continue;
      }
      if (decision === 'reject') {
        rejected++;
        continue;
      }
      if (decision === 'approve') {
        approved++;
        if (node.provenance.status === 'detected') node.provenance.status = 'confirmed';
      } else if (decision === 'assume') {
        assumed++;
        node.provenance.status = 'assumed';
      } else {
        edited++;
        for (const [field, value] of Object.entries(entry?.set ?? {})) {
          if (field === 'id' || field === 'provenance') {
            throw new Error(`The edit for ${ref} in gamex/review.json cannot change "${field}".`);
          }
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- merge-patch semantics: null removes
          if (value === null) delete node[field];
          else node[field] = value;
        }
        node.provenance.status = 'edited';
      }
      kept.push(node);
    }
    list.splice(0, list.length, ...kept);
  }

  let repaired: RepairResult;
  try {
    repaired = repairModel(model);
  } catch (error) {
    if (!(error instanceof RepairError)) throw error;
    throw new Error(
      `The reviewed model is incomplete (${error.issue}). ${String(pending.length)} item(s) have no decision yet: ` +
        'approve the items the model needs, or set "default": "approve" in gamex/review.json.',
      { cause: error },
    );
  }
  const result = repaired.model;
  const final = validateGameModel(result);
  return {
    model: result,
    summary: {
      approved,
      assumed,
      edited,
      rejected,
      pending,
      cascaded: repaired.dropped,
      stale: ledger.decisions.map((d) => d.ref).filter((r) => !seen.has(r)),
    },
    issues: final.issues,
  };
}
