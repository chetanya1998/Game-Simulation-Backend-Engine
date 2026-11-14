import { FUNCTION_NAMES } from '../expr/functions.js';
import { idToKey } from '../ids.js';
import type { GameModel } from '../schema/game-model.js';
import type { ImplicitPlan } from '../normalize.js';
import { BUILTIN_NAMES } from './env.js';
import type { IssueCollector } from './collector.js';
import type { NodeEntry } from './nodes.js';

const RESERVED = new Set([...BUILTIN_NAMES, ...FUNCTION_NAMES, 'true', 'false']);

/** Layer 2: unique ids, keys that match their ids, no key collisions in the expression namespace. */
export function checkIdentity(
  model: GameModel,
  nodes: readonly NodeEntry[],
  plan: ImplicitPlan,
  issues: IssueCollector,
): void {
  const seen = new Map<string, NodeEntry>();
  for (const node of nodes) {
    const k = `${node.kind}:${node.id}`;
    const first = seen.get(k);
    if (first !== undefined) {
      issues.error(
        'DUPLICATE_ID',
        [...node.path, 'id'],
        `Duplicate ${node.kind} id "${node.id}" (also used at ${['', ...first.path].join('/')})`,
        {
          hint: 'Ids must be unique within their section; rename one of them.',
          nodeRef: node.ref,
        },
      );
    } else seen.set(k, node);

    if (node.key !== undefined && node.key !== idToKey(node.id)) {
      issues.error(
        'KEY_MISMATCH',
        [...node.path, 'key'],
        `Key "${node.key}" does not match id "${node.id}"`,
        {
          hint: `Use "${idToKey(node.id)}" or remove "key" — it is derived from the id.`,
          nodeRef: node.ref,
        },
      );
    }
  }

  // Constants, variables (incl. implicit ones) and resources share one namespace inside expressions.
  const owners = new Map<string, string>();
  const claim = (
    key: string,
    owner: string,
    path: readonly (string | number)[],
    ref: string,
  ): void => {
    if (RESERVED.has(key)) {
      issues.error(
        'KEY_RESERVED',
        path,
        `Key "${key}" (from ${owner}) is a reserved name in expressions`,
        { hint: 'Rename the id.', nodeRef: ref },
      );
      return;
    }
    const other = owners.get(key);
    if (other !== undefined && other !== owner) {
      issues.error(
        'KEY_COLLISION',
        path,
        `${owner} and ${other} both have key "${key}", so expressions cannot tell them apart`,
        {
          hint: 'Rename one of the ids.',
          nodeRef: ref,
        },
      );
    } else owners.set(key, owner);
  };
  for (const node of nodes) {
    if (node.kind === 'constant' || node.kind === 'variable' || node.kind === 'resource')
      claim(idToKey(node.id), node.ref, [...node.path, 'id'], node.ref);
  }
  const userVariableIds = new Set(model.variables.map((v) => v.id));
  for (const v of plan.variables) {
    if (
      userVariableIds.has(v.id) &&
      model.variables.find((u) => u.id === v.id)?.derivedFrom === v.derivedFrom
    )
      continue;
    claim(
      idToKey(v.id),
      `implicit var:${v.id} (from ${v.derivedFrom ?? '?'})`,
      ['variables'],
      `var:${v.id}`,
    );
  }

  model.actions.forEach((action, i) => {
    const outcomes = new Set<string>();
    action.outcomes?.forEach((o, j) => {
      if (outcomes.has(o.id)) {
        issues.error(
          'DUPLICATE_ID',
          ['actions', i, 'outcomes', j, 'id'],
          `Duplicate outcome id "${o.id}" in action "${action.id}"`,
          { nodeRef: `action:${action.id}` },
        );
      }
      outcomes.add(o.id);
    });
  });
}
