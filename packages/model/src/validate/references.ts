import { didYouMean } from '../expr/suggest.js';
import type { Effect, GameModel } from '../schema/game-model.js';
import type { IssueCollector, Path } from './collector.js';
import type { NodeIndex } from './nodes.js';

const KIND_NAMES: Record<string, string> = {
  ent: 'entity',
  res: 'resource',
  const: 'constant',
  var: 'variable',
  action: 'action',
  rule: 'rule',
  state: 'state',
  transition: 'transition',
  flow: 'flow node',
  placement: 'placement',
  persona: 'persona',
  kpi: 'KPI',
  inv: 'invariant',
  gap: 'gap',
};

export interface RefOccurrence {
  readonly ref: string;
  readonly path: Path;
  /** True when the reference is the key of a record rather than a value. */
  readonly isKey?: boolean;
}

/** Every typed reference in the model, with where it occurs. */
export function collectRefs(model: GameModel): RefOccurrence[] {
  const out: RefOccurrence[] = [];
  const push = (ref: string, path: Path, isKey = false): void => {
    out.push(isKey ? { ref, path, isKey } : { ref, path });
  };
  const effects = (list: readonly Effect[] | undefined, base: Path): void => {
    list?.forEach((e, i) => {
      push(e.target, [...base, i, 'target']);
    });
  };

  model.entities.forEach((e, i) => {
    for (const [name, ref] of Object.entries(e.attributes))
      push(ref, ['entities', i, 'attributes', name]);
  });
  model.actions.forEach((a, i) => {
    a.costs.forEach((c, j) => {
      push(c.resource, ['actions', i, 'costs', j, 'resource']);
    });
    effects(a.effects, ['actions', i, 'effects']);
    a.outcomes?.forEach((o, j) => {
      effects(o.effects, ['actions', i, 'outcomes', j, 'effects']);
    });
  });
  model.rules.forEach((r, i) => {
    r.appliesTo.actions?.forEach((ref, j) => {
      push(ref, ['rules', i, 'appliesTo', 'actions', j]);
    });
    r.appliesTo.placements?.forEach((ref, j) => {
      push(ref, ['rules', i, 'appliesTo', 'placements', j]);
    });
  });
  push(model.stateMachine.initial, ['stateMachine', 'initial']);
  model.stateMachine.transitions.forEach((t, i) => {
    const base = ['stateMachine', 'transitions', i];
    push(t.from, [...base, 'from']);
    if (t.to !== 'return') push(t.to, [...base, 'to']);
    if (t.trigger !== 'ui' && t.trigger !== 'auto') push(t.trigger, [...base, 'trigger']);
    effects(t.effects, [...base, 'effects']);
  });
  model.flows.forEach((f, i) => {
    push(f.resource, ['flows', i, 'resource']);
    f.actions.forEach((ref, j) => {
      push(ref, ['flows', i, 'actions', j]);
    });
    f.to.forEach((ref, j) => {
      push(ref, ['flows', i, 'to', j]);
    });
  });
  const mon = model.monetization;
  mon.placements.forEach((p, i) => {
    const base = ['monetization', 'placements', i];
    if ('action' in p.trigger) push(p.trigger.action, [...base, 'trigger', 'action']);
    else push(p.trigger.state, [...base, 'trigger', 'state']);
    p.forbiddenIn?.forEach((ref, j) => {
      push(ref, [...base, 'forbiddenIn', j]);
    });
    effects(p.reward, [...base, 'reward']);
    effects(p.onShow, [...base, 'onShow']);
  });
  mon.forbiddenStates.forEach((ref, i) => {
    push(ref, ['monetization', 'forbiddenStates', i]);
  });
  if (mon.assumptions !== undefined) {
    for (const [format, ref] of Object.entries(mon.assumptions.ecpm))
      push(ref, ['monetization', 'assumptions', 'ecpm', format]);
    for (const [format, ref] of Object.entries(mon.assumptions.fillRate))
      push(ref, ['monetization', 'assumptions', 'fillRate', format]);
  }
  model.personas.forEach((p, i) => {
    for (const ref of Object.keys(p.adOptIn.byPlacement ?? {}))
      push(ref, ['personas', i, 'adOptIn', 'byPlacement', ref], true);
    for (const ref of Object.keys(p.transitionWeights ?? {}))
      push(ref, ['personas', i, 'transitionWeights', ref], true);
  });
  model.kpis.forEach((k, i) => {
    if (k.persona !== undefined) push(k.persona, ['kpis', i, 'persona']);
    for (const [name, value] of Object.entries(k.params ?? {})) {
      if (typeof value === 'string' && /^[a-z]+:[a-z]/.test(value))
        push(value, ['kpis', i, 'params', name]);
    }
  });
  model.invariants.forEach((inv, i) => {
    if (inv.kind === 'trace' && inv.at !== undefined) {
      const [field, ref] = Object.entries(inv.at)[0] ?? ['', ''];
      push(ref, ['invariants', i, 'at', field]);
    }
    if (inv.kind === 'aggregate' && inv.persona !== undefined)
      push(inv.persona, ['invariants', i, 'persona']);
  });
  model.gaps.forEach((g, i) => {
    g.related.forEach((ref, j) => {
      push(ref, ['gaps', i, 'related', j]);
    });
  });
  return out;
}

/** Layer 3: every reference resolves; transition outcomes exist on their trigger action. */
export function checkReferences(
  model: GameModel,
  index: NodeIndex,
  issues: IssueCollector,
): RefOccurrence[] {
  const refs = collectRefs(model);
  for (const occ of refs) {
    const colon = occ.ref.indexOf(':');
    const prefix = occ.ref.slice(0, colon);
    const id = occ.ref.slice(colon + 1);
    const ids = index.get(prefix);
    if (ids === undefined) {
      issues.error(
        'UNKNOWN_REFERENCE',
        occ.path,
        `"${occ.ref}" does not use a known reference prefix`,
        {
          hint: `Prefixes: ${Object.keys(KIND_NAMES).join(', ')}.`,
        },
      );
    } else if (!ids.has(id)) {
      const suggestion = didYouMean(id, ids);
      issues.error(
        'UNKNOWN_REFERENCE',
        occ.path,
        `No ${KIND_NAMES[prefix] ?? prefix} with id "${id}" (referenced as "${occ.ref}")`,
        {
          hint:
            suggestion === undefined
              ? `Add the ${KIND_NAMES[prefix] ?? prefix} or fix the reference.`
              : suggestion.replace(/"([^"]+)"/, `"${prefix}:$1"`),
        },
      );
    }
  }

  model.actions.forEach((a, i) => {
    if (a.combat === undefined) return;
    const ids = a.outcomes?.map((o) => o.id) ?? [];
    for (const which of ['win', 'lose'] as const) {
      const id = a.combat.outcomes[which];
      if (!ids.includes(id)) {
        issues.error(
          'COMBAT_UNKNOWN_OUTCOME',
          ['actions', i, 'combat', 'outcomes', which],
          `Combat "${which}" outcome "${id}" is not an outcome of action "${a.id}"`,
          {
            hint:
              ids.length === 0
                ? 'A combat action needs outcomes (with effects) for winning and losing.'
                : (didYouMean(id, ids) ?? `Outcomes: ${ids.join(', ')}.`),
            nodeRef: `action:${a.id}`,
          },
        );
      }
    }
  });

  const outcomesOf = new Map(
    model.actions.map((a) => [`action:${a.id}`, a.outcomes?.map((o) => o.id)]),
  );
  model.stateMachine.transitions.forEach((t, i) => {
    if (t.outcome === undefined) return;
    const path = ['stateMachine', 'transitions', i, 'outcome'];
    if (t.trigger === 'ui' || t.trigger === 'auto') {
      issues.error(
        'OUTCOME_WITHOUT_ACTION',
        path,
        `Transition "${t.id}" names outcome "${t.outcome}" but is not triggered by an action`,
        {
          hint: 'Set "trigger" to the action whose outcome this transition follows.',
          nodeRef: `transition:${t.id}`,
        },
      );
      return;
    }
    if (!outcomesOf.has(t.trigger)) return; // unknown action already reported
    const outcomes = outcomesOf.get(t.trigger);
    if (outcomes?.includes(t.outcome) !== true) {
      issues.error('UNKNOWN_OUTCOME', path, `Action "${t.trigger}" has no outcome "${t.outcome}"`, {
        hint:
          outcomes === undefined
            ? 'That action has no outcomes.'
            : (didYouMean(t.outcome, outcomes) ?? `Outcomes: ${outcomes.join(', ')}.`),
        nodeRef: `transition:${t.id}`,
      });
    }
  });
  return refs;
}
