import { idToKey } from '../ids.js';
import type { Effect, GameModel } from '../schema/game-model.js';
import type { IssueCollector } from './collector.js';
import type { ExpressionUsage } from './expressions.js';
import type { NodeEntry } from './nodes.js';
import type { RefOccurrence } from './references.js';

const REVENUE_METRICS = new Set(['ad-revenue-per-dau', 'arpdau']);

/** Layer 6: design-level checks — ads in forbidden states, unused tunables, assumptions without gaps. */
export function checkSemantics(
  model: GameModel,
  nodes: readonly NodeEntry[],
  refs: readonly RefOccurrence[],
  usage: ExpressionUsage,
  issues: IssueCollector,
): void {
  const referenced = new Set(refs.map((r) => r.ref));

  // No UI ad may be triggered in a forbidden state (e.g. live gameplay); in-world billboards are exempt.
  const globalForbidden = new Set(model.monetization.forbiddenStates);
  model.monetization.placements.forEach((p, i) => {
    if (p.inWorld === true) return;
    const forbidden = new Set([...globalForbidden, ...(p.forbiddenIn ?? [])]);
    if ('state' in p.trigger && forbidden.has(p.trigger.state)) {
      issues.error(
        'PLACEMENT_IN_FORBIDDEN_STATE',
        ['monetization', 'placements', i, 'trigger', 'state'],
        `Placement "${p.id}" is shown in ${p.trigger.state}, where ads are forbidden`,
        {
          hint: 'Move the placement to another state, or mark it inWorld if it is part of the scene.',
          nodeRef: `placement:${p.id}`,
        },
      );
    }
    if ('action' in p.trigger) {
      const action = p.trigger.action;
      model.stateMachine.transitions.forEach((t, j) => {
        if (t.trigger === action && forbidden.has(t.from)) {
          issues.error(
            'PLACEMENT_IN_FORBIDDEN_STATE',
            ['stateMachine', 'transitions', j, 'trigger'],
            `Placement "${p.id}" (via ${action}) can be triggered from ${t.from}, where ads are forbidden`,
            {
              hint: 'Trigger the action from a non-gameplay state.',
              nodeRef: `placement:${p.id}`,
            },
          );
        }
      });
    }
  });

  model.constants.forEach((c, i) => {
    const key = idToKey(c.id);
    if (!usage.identifiers.has(key) && !referenced.has(`const:${c.id}`)) {
      issues.warning(
        'UNUSED_CONSTANT',
        ['constants', i],
        `Constant "${c.id}" is not used by any expression or reference`,
        {
          hint: 'Use it, reference it from an entity attribute, or remove it.',
          nodeRef: `const:${c.id}`,
        },
      );
    }
  });

  const changed = new Set<string>();
  const note = (list: readonly Effect[] | undefined): void => {
    for (const e of list ?? []) changed.add(e.target);
  };
  for (const a of model.actions) {
    note(a.effects);
    for (const o of a.outcomes ?? []) note(o.effects);
    for (const c of a.costs) changed.add(c.resource);
  }
  for (const t of model.stateMachine.transitions) note(t.effects);
  for (const p of model.monetization.placements) {
    note(p.reward);
    note(p.onShow);
  }
  model.resources.forEach((r, i) => {
    if (!changed.has(`res:${r.id}`)) {
      issues.warning(
        'RESOURCE_NEVER_CHANGES',
        ['resources', i],
        `Resource "${r.id}" is never granted or spent`,
        { nodeRef: `res:${r.id}` },
      );
    }
  });

  model.stateMachine.transitions.forEach((t, i) => {
    const from = model.stateMachine.states.find((s) => `state:${s.id}` === t.from);
    if (from?.kind === 'exit') {
      issues.warning(
        'TRANSITION_FROM_EXIT',
        ['stateMachine', 'transitions', i, 'from'],
        `Transition "${t.id}" leaves exit state ${t.from}`,
        { nodeRef: `transition:${t.id}` },
      );
    }
  });

  if (model.monetization.assumptions === undefined) {
    model.kpis.forEach((k, i) => {
      if (REVENUE_METRICS.has(k.metric)) {
        issues.warning(
          'REVENUE_KPI_WITHOUT_ASSUMPTIONS',
          ['kpis', i, 'metric'],
          `KPI "${k.id}" needs eCPM/fill-rate assumptions and will be skipped`,
          {
            hint: 'Add monetization.assumptions with eCPM and fill-rate constants.',
            nodeRef: `kpi:${k.id}`,
          },
        );
      }
    });
  }

  const covered = new Set(model.gaps.flatMap((g) => g.related));
  for (const node of nodes) {
    if (node.status === 'assumed' && node.kind !== 'gap' && !covered.has(node.ref)) {
      issues.warning(
        'ASSUMED_WITHOUT_GAP',
        node.path,
        `${node.ref} is marked "assumed" but no gap asks about it`,
        {
          hint: 'Add it to the "related" list of a gap so the team confirms it.',
          nodeRef: node.ref,
        },
      );
    }
  }
}
