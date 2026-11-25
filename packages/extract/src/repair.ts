import { formatIssue, validateGameModel, type GameModel, type Issue } from '@gamex/model';

export interface Dropped {
  /** Typed ref of the removed node, or the JSON path of the removed reference. */
  readonly ref: string;
  /** Typed ref of the node that held a removed reference. */
  readonly in?: string;
  readonly reason: string;
}

/** The model cannot be made valid by removing items (e.g. no screens are left). */
export class RepairError extends Error {
  constructor(readonly issue: string) {
    super(`Cannot repair the model: ${issue}`);
    this.name = 'RepairError';
  }
}

export interface RepairResult {
  readonly model: GameModel;
  readonly dropped: readonly Dropped[];
  /** Remaining issues (warnings only). */
  readonly issues: readonly Issue[];
}

export const NODE_ARRAYS: readonly (readonly [readonly string[], string])[] = [
  [['entities'], 'ent'],
  [['resources'], 'res'],
  [['constants'], 'const'],
  [['variables'], 'var'],
  [['actions'], 'action'],
  [['rules'], 'rule'],
  [['stateMachine', 'states'], 'state'],
  [['stateMachine', 'transitions'], 'transition'],
  [['flows'], 'flow'],
  [['monetization', 'placements'], 'placement'],
  [['personas'], 'persona'],
  [['kpis'], 'kpi'],
  [['invariants'], 'inv'],
  [['gaps'], 'gap'],
];

function segments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function at(root: unknown, path: readonly string[]): unknown {
  let cur = root;
  for (const s of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

/**
 * Makes an extracted candidate valid by removing what is wrong rather than guessing a fix: a dangling
 * reference inside a list of references is removed from the list; any other error removes the whole
 * node (and everything that then dangles, on the next round). Every removal is reported, so it can be
 * raised as a gap.
 */
export function repairModel(input: GameModel): RepairResult {
  const model = structuredClone(input);
  const dropped: Dropped[] = [];
  for (let round = 0; round < 10_000; round++) {
    const result = validateGameModel(model);
    const error = result.issues.find((i) => i.severity === 'error');
    if (error === undefined) return { model, dropped, issues: result.issues };
    const path = segments(error.path);
    const reason = formatIssue(error);

    const owner = NODE_ARRAYS.find(
      ([base]) => base.every((s, i) => path[i] === s) && path.length > base.length,
    );
    if (owner !== undefined) {
      const [base, prefix] = owner;
      const list = at(model, base) as { id: string }[];
      const index = Number(path[base.length]);
      const node = list[index];
      if (node === undefined) throw new RepairError(reason);
      const ref = `${prefix}:${node.id}`;
      const inner = path.slice(base.length + 1);
      const parent = at(node, inner.slice(0, -1));
      const leaf = inner.at(-1);
      if (error.code === 'UNKNOWN_REFERENCE' && inner.length >= 2 && leaf !== undefined) {
        if (Array.isArray(parent) && typeof parent[Number(leaf)] === 'string') {
          dropped.push({ ref: String(parent[Number(leaf)]), in: ref, reason });
          parent.splice(Number(leaf), 1);
          continue;
        }
        if (
          inner[0] === 'attributes' &&
          inner.length === 2 &&
          parent !== null &&
          typeof parent === 'object'
        ) {
          const attrs = parent as Record<string, unknown>;
          dropped.push({ ref: String(attrs[leaf]), in: ref, reason });
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- removing one attribute by name
          delete attrs[leaf];
          continue;
        }
      }
      dropped.push({ ref, reason });
      list.splice(index, 1);
      continue;
    }
    if (path[0] === 'stateMachine' && path[1] === 'initial') {
      const first = model.stateMachine.states[0];
      if (first === undefined) throw new RepairError(reason);
      dropped.push({ ref: model.stateMachine.initial, reason });
      model.stateMachine.initial = `state:${first.id}`;
      continue;
    }
    if (path[0] === 'monetization' && path[1] === 'forbiddenStates' && path.length === 3) {
      dropped.push({ ref: String(model.monetization.forbiddenStates[Number(path[2])]), reason });
      model.monetization.forbiddenStates.splice(Number(path[2]), 1);
      continue;
    }
    if (path[0] === 'monetization' && path[1] === 'assumptions') {
      dropped.push({ ref: 'monetization.assumptions', reason });
      delete model.monetization.assumptions;
      continue;
    }
    throw new RepairError(reason);
  }
  throw new RepairError('too many rounds');
}
