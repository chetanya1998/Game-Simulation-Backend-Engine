import type { CompiledModel, CTransition } from './compile.js';
import { distancesTo, isSelfLoop } from './graph.js';
import type { Rng } from './random.js';
import type { StepOption } from './step.js';
import type { WorldState } from './world.js';

/**
 * The default persona policy — a deliberately simple, documented model of a player:
 * - players head for the next mission, and inside a mission they keep playing;
 * - with `metaVisitProbability` per session they first visit a meta screen (shop, chest) and use what is
 *   available there;
 * - rewarded videos are watched with the persona's opt-in probability, decided once per visit to a screen;
 * - everything else is chosen at random with low weight, so all screens get visited.
 */
export interface PolicyWeights {
  readonly progress: number;
  readonly mission: number;
  readonly inPlace: number;
  readonly rewardedAccepted: number;
  readonly uiSelfLoop: number;
  readonly base: number;
}

export const DEFAULT_POLICY_WEIGHTS: PolicyWeights = {
  progress: 6,
  mission: 10,
  inPlace: 4,
  rewardedAccepted: 8,
  uiSelfLoop: 0.2,
  base: 1,
};

export interface PolicyContext {
  readonly c: CompiledModel;
  /** Distance to a screen where a mission can begin. */
  readonly toMissionStart: ReadonlyMap<string, number>;
  /** Distance to a screen where a mission action (an action with outcomes) is played. */
  readonly toGameplay: ReadonlyMap<string, number>;
  /** Distance to screens offering in-place actions (shop, chest, store). */
  readonly toMeta: ReadonlyMap<string, number>;
  readonly rewardedActions: ReadonlySet<string>;
  readonly weights: PolicyWeights;
}

export function createPolicyContext(
  c: CompiledModel,
  weights: PolicyWeights = DEFAULT_POLICY_WEIGHTS,
): PolicyContext {
  const missionStart = new Set<string>();
  const gameplay = new Set<string>();
  const meta = new Set<string>();
  for (const t of c.transitions) {
    if (t.beginsMission) missionStart.add(t.from);
    if (t.trigger.kind === 'action') {
      const a = c.actions.get(t.trigger.actionId);
      if (a?.outcomes !== undefined) gameplay.add(t.from);
      else if (isSelfLoop(t) && a?.actor !== 'store') meta.add(t.from);
    }
  }
  const rewardedActions = new Set<string>();
  for (const a of c.actions.values())
    if (a.placements.some((p) => p.format === 'rewarded')) rewardedActions.add(a.id);
  return {
    c,
    toMissionStart: distancesTo(c, missionStart),
    toGameplay: distancesTo(c, gameplay),
    toMeta: distancesTo(c, meta),
    rewardedActions,
    weights,
  };
}

export interface Intent {
  /** Heading for a meta screen this session. */
  meta: boolean;
}

function targetOf(t: CTransition, w: WorldState): string {
  return t.to === 'return' ? (w.stack.at(-1) ?? t.from) : t.to;
}

/** Picks one option. `declined` holds rewarded actions the player said no to during this screen visit. */
export function chooseOption(
  ctx: PolicyContext,
  w: WorldState,
  options: readonly StepOption[],
  intent: Intent,
  declined: ReadonlySet<string>,
  rng: Rng,
): StepOption | undefined {
  const { weights } = ctx;
  const dist = intent.meta ? ctx.toMeta : w.inMission ? ctx.toGameplay : ctx.toMissionStart;
  const here = dist.get(w.state) ?? Number.POSITIVE_INFINITY;
  const scores = options.map((o) => {
    if (o.kind === 'action') {
      if (ctx.rewardedActions.has(o.actionId))
        return declined.has(o.actionId) ? 0 : weights.rewardedAccepted;
      const action = ctx.c.actions.get(o.actionId);
      if (action?.outcomes !== undefined) return weights.mission;
      if (o.transitions.every(isSelfLoop))
        return intent.meta ? weights.inPlace * 2 : weights.inPlace / 2;
      const t = o.transitions[0];
      return t !== undefined && (dist.get(targetOf(t, w)) ?? Number.POSITIVE_INFINITY) < here
        ? weights.progress
        : weights.base;
    }
    const t = o.transition;
    if (isSelfLoop(t)) return weights.uiSelfLoop;
    if (t.beginsMission && !intent.meta) return weights.mission;
    return (dist.get(targetOf(t, w)) ?? Number.POSITIVE_INFINITY) < here
      ? weights.progress
      : weights.base;
  });
  const i = rng.weightedIndex(scores);
  return i < 0 ? undefined : options[i];
}
