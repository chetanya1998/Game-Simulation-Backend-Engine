import { idToKey, type ExprValue, type GameModel, type Persona } from '@gamex/model';
import { compileModel, type CompiledModel } from './compile.js';
import { sample } from './distributions.js';
import { EngineModelError } from './errors.js';
import { createPolicyContext, chooseOption, type Intent, type PolicyContext } from './policy.js';
import { deriveSeed, Rng } from './random.js';
import {
  availableOptions,
  perform,
  settle,
  type EngineEvent,
  type InvariantViolation,
  type StepOption,
} from './step.js';
import { createWorld, resetScope, type WorldState } from './world.js';

export interface ChurnOptions {
  /** Base chance to stop playing after a session, scaled by the persona's churn sensitivity. */
  readonly base: number;
  /** Added per consecutive mission failure. */
  readonly perFailure: number;
  /** Added when progress has not moved for three sessions. */
  readonly stall: number;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly days: number;
  readonly playersPerPersona: number;
  /** Persona ids to simulate (default: all). */
  readonly personas?: readonly string[];
  /** Constant overrides by key. */
  readonly params?: Readonly<Record<string, number>>;
  /** Players per persona whose full event trace is kept (default 1). */
  readonly sampleTraces?: number;
  /** Simulated seconds per UI navigation (default 5). */
  readonly uiSeconds?: number;
  readonly maxStepsPerSession?: number;
  /** Chance per session to visit a meta screen (shop, chest) first (default 0.5). */
  readonly metaVisitProbability?: number;
  readonly churn?: Partial<ChurnOptions>;
  /** Outcome ids that count as a failed mission attempt (default ["lose"]). */
  readonly failureOutcomes?: readonly string[];
  /** Simulate only players [from, to) of each persona — for splitting work across workers. */
  readonly playerRange?: { readonly from: number; readonly to: number };
}

export const DEFAULT_CHURN: ChurnOptions = { base: 0.03, perFailure: 0.05, stall: 0.1 };
export const SECONDS_PER_DAY = 86400;

export interface TraceEvent {
  readonly day: number;
  readonly session: number;
  readonly event: EngineEvent;
}

export interface Evidence {
  readonly invariantId: string;
  readonly blocking: boolean;
  readonly persona: string;
  readonly playerIndex: number;
  readonly day: number;
  readonly session: number;
  readonly now: number;
  readonly state: string;
  readonly at: string;
  /** The last events before the violation. */
  readonly trace: readonly EngineEvent[];
}

export interface DaySnapshot {
  readonly active: boolean;
  readonly sessions: number;
  /** End-of-day values of resources and numeric (non-derived) variables. */
  readonly values: Readonly<Record<string, number>>;
  readonly faucet: Readonly<Record<string, number>>;
  readonly sink: Readonly<Record<string, number>>;
  readonly impressions: Readonly<Record<string, number>>;
}

export interface PlayerSummary {
  readonly persona: string;
  readonly index: number;
  readonly skill: number;
  readonly days: readonly DaySnapshot[];
  readonly churnedOnDay: number | null;
  readonly sessions: number;
  readonly missions: number;
  readonly stuckSessions: number;
  readonly impressions: Readonly<Record<string, number>>;
  readonly offers: Readonly<Record<string, number>>;
  readonly accepts: Readonly<Record<string, number>>;
  readonly purchases: Readonly<Record<string, number>>;
  /** Mission attempts keyed by "actionId@level". */
  readonly attempts: Readonly<
    Record<string, { readonly attempts: number; readonly failures: number }>
  >;
  /** Combat deaths keyed by "actionId@stage" (e.g. "fight-boss@boss-phase-2"). */
  readonly deaths: Readonly<Record<string, number>>;
  readonly invariantChecks: Readonly<Record<string, number>>;
  readonly violations: readonly Evidence[];
  readonly violationCounts: Readonly<Record<string, number>>;
  readonly rangeViolations: number;
  readonly capHits: number;
  readonly finalValues: Readonly<Record<string, ExprValue>>;
  readonly trace?: readonly TraceEvent[];
}

interface Resolved {
  readonly c: CompiledModel;
  readonly policy: PolicyContext;
  readonly personas: readonly Persona[];
  readonly uiSeconds: number;
  readonly maxSteps: number;
  readonly metaP: number;
  readonly churn: ChurnOptions;
  readonly failures: ReadonlySet<string>;
  readonly levelKey: string | undefined;
  readonly progressKey: string | undefined;
  readonly trackedKeys: readonly string[];
  readonly sampleTraces: number;
}

function keyOfVarRef(ref: unknown): string | undefined {
  return typeof ref === 'string' && ref.startsWith('var:') ? idToKey(ref.slice(4)) : undefined;
}

export function resolveOptions(c: CompiledModel, options: SimulationOptions): Resolved {
  if (!Number.isInteger(options.days) || options.days < 1)
    throw new EngineModelError('days must be a positive integer');
  if (!Number.isInteger(options.playersPerPersona) || options.playersPerPersona < 1)
    throw new EngineModelError('playersPerPersona must be a positive integer');
  const all = c.model.personas;
  if (all.length === 0)
    throw new EngineModelError('The model has no personas to simulate; add at least one persona.');
  const personas =
    options.personas === undefined
      ? all
      : options.personas.map((id) => {
          const p = all.find((x) => x.id === id);
          if (p === undefined)
            throw new EngineModelError(
              `Unknown persona "${id}". Known: ${all.map((x) => x.id).join(', ')}`,
            );
          return p;
        });
  const walls = c.model.kpis.find((k) => k.metric === 'progression-walls');
  const speed = c.model.kpis.find(
    (k) => k.metric === 'progression-speed' || k.metric === 'reach-rate',
  );
  const trackedKeys = [
    ...[...c.resources.values()].map((r) => r.key),
    ...[...c.variables.values()]
      .filter((v) => !v.derived && (v.type === 'int' || v.type === 'number'))
      .map((v) => v.key),
  ];
  return {
    c,
    policy: createPolicyContext(c),
    personas,
    uiSeconds: options.uiSeconds ?? 5,
    maxSteps: options.maxStepsPerSession ?? 2000,
    metaP: options.metaVisitProbability ?? 0.5,
    churn: { ...DEFAULT_CHURN, ...options.churn },
    failures: new Set(options.failureOutcomes ?? ['lose']),
    levelKey: keyOfVarRef(walls?.params?.['attemptVariable'] ?? walls?.params?.['variable']),
    progressKey: keyOfVarRef(speed?.params?.['variable']),
    trackedKeys,
    sampleTraces: options.sampleTraces ?? 1,
  };
}

const inc = (m: Record<string, number>, k: string, by = 1): void => {
  m[k] = (m[k] ?? 0) + by;
};

/** Simulates one player of one persona. Deterministic in (seed, persona id, index). */
export function simulatePlayer(
  r: Resolved,
  persona: Persona,
  index: number,
  options: SimulationOptions,
): PlayerSummary {
  const { c } = r;
  const rng = new Rng(deriveSeed(options.seed, persona.id, index));
  const skill = Math.min(1, Math.max(0, sample(persona.skill, rng)));
  let w: WorldState = createWorld(c, {
    persona: { skill, churnSensitivity: persona.churnSensitivity },
  });
  const keepTrace = index < r.sampleTraces;
  const trace: TraceEvent[] = [];
  const recent: EngineEvent[] = [];
  const impressions: Record<string, number> = {};
  const offers: Record<string, number> = {};
  const accepts: Record<string, number> = {};
  const purchases: Record<string, number> = {};
  const attempts: Record<string, { attempts: number; failures: number }> = {};
  const deaths: Record<string, number> = {};
  const invariantChecks = new Map<string, number>();
  const violations: Evidence[] = [];
  const violationCounts: Record<string, number> = {};
  const days: DaySnapshot[] = [];
  let sessions = 0;
  let missions = 0;
  let stuck = 0;
  let rangeViolations = 0;
  let capHits = 0;
  let churnedOnDay: number | null = null;
  let consecutiveFailures = 0;
  const progressHistory: ExprValue[] = [];
  const stepOptions = { rng, invariantCounter: invariantChecks };

  let day = 0;
  let session = 0;
  let dayFaucet: Record<string, number> = {};
  let daySink: Record<string, number> = {};
  let dayImpressions: Record<string, number> = {};

  const record = (
    events: readonly EngineEvent[],
    found: readonly InvariantViolation[],
    before: WorldState,
    after: WorldState,
  ): void => {
    for (const e of events) {
      recent.push(e);
      if (recent.length > 12) recent.shift();
      if (keepTrace && trace.length < 5000) trace.push({ day: day + 1, session, event: e });
      switch (e.type) {
        case 'impression': {
          inc(impressions, e.placementId);
          inc(dayImpressions, e.format);
          break;
        }
        case 'action': {
          const a = c.actions.get(e.actionId);
          if (a?.actor === 'store') inc(purchases, e.actionId);
          if (e.outcome !== undefined) {
            const level = r.levelKey === undefined ? '' : String(before.values[r.levelKey]);
            const k = `${e.actionId}@${level}`;
            const entry = (attempts[k] ??= { attempts: 0, failures: 0 });
            entry.attempts++;
            if (r.failures.has(e.outcome)) {
              entry.failures++;
              consecutiveFailures++;
            } else consecutiveFailures = 0;
          }
          break;
        }
        case 'mission-begin':
          missions++;
          break;
        case 'combat':
          if (e.diedAt !== null) inc(deaths, `${e.actionId}@${e.diedAt}`);
          break;
        case 'range-violation':
          rangeViolations++;
          break;
        case 'cap-hit':
          capHits++;
          break;
        default:
          break;
      }
    }
    for (const v of found) {
      inc(violationCounts, v.invariantId);
      if (violations.length < 20) {
        violations.push({
          ...v,
          persona: persona.id,
          playerIndex: index,
          day: day + 1,
          session,
          trace: [...recent],
        });
      }
    }
    for (const res of c.resources.values()) {
      const d = (after.values[res.key] as number) - (before.values[res.key] as number);
      if (d > 0) inc(dayFaucet, res.key, d);
      else if (d < 0) inc(daySink, res.key, -d);
    }
  };

  const runSession = (start: number): void => {
    const values = { ...w.values };
    resetScope(c, values, 'session');
    w = { ...w, values, now: start, state: c.initialState, prevState: c.initialState, stack: [] };
    sessions++;

    const budget = Math.max(0, sample(persona.sessionLengthSeconds, rng));
    const end = start + budget;
    const intent: Intent = {
      purchase:
        rng.chance(persona.purchaseProbabilityPerSession) &&
        Number.isFinite(r.policy.toStore.get(c.initialState) ?? Number.POSITIVE_INFINITY),
      meta:
        rng.chance(r.metaP) &&
        Number.isFinite(r.policy.toMeta.get(c.initialState) ?? Number.POSITIVE_INFINITY),
    };
    let visitState = '';
    const decided = new Map<string, boolean>();

    const settled = settle(c, w, stepOptions);
    record(settled.events, settled.violations, w, settled.next);
    w = settled.next;

    for (let step = 0; step < r.maxSteps; step++) {
      if (w.now >= end && !w.inMission) break;
      if (w.now >= start + 2 * Math.max(budget, 60)) break;
      if (w.state !== visitState) {
        visitState = w.state;
        decided.clear();
      }
      // Purchases happen only when the persona decided to buy this session, never by wandering into the store.
      const options = availableOptions(c, w).filter(
        (o) =>
          o.kind !== 'auto' &&
          (intent.purchase || !(o.kind === 'action' && r.policy.storeActions.has(o.actionId))),
      );
      if (
        intent.purchase &&
        (r.policy.toStore.get(w.state) ?? 1) === 0 &&
        !options.some((o) => o.kind === 'action' && r.policy.storeActions.has(o.actionId))
      ) {
        intent.purchase = false; // at the store, but nothing left to buy
      }
      if (options.length === 0) {
        stuck++;
        break;
      }
      for (const o of options) {
        if (
          o.kind !== 'action' ||
          !r.policy.rewardedActions.has(o.actionId) ||
          decided.has(o.actionId)
        )
          continue;
        const action = c.actions.get(o.actionId);
        const placement = action?.placements.find((p) => p.format === 'rewarded');
        const p =
          placement === undefined
            ? persona.adOptIn.default
            : (persona.adOptIn.byPlacement?.[placement.ref] ?? persona.adOptIn.default);
        const yes = rng.chance(p);
        decided.set(o.actionId, yes);
        if (placement !== undefined) {
          inc(offers, placement.id);
          if (yes) inc(accepts, placement.id);
        }
      }
      if (intent.meta && (r.policy.toMeta.get(w.state) ?? 1) === 0) {
        const inPlace = options.some(
          (o) =>
            o.kind === 'action' &&
            o.transitions.every((t) => t.to === t.from) &&
            !(r.policy.rewardedActions.has(o.actionId) && decided.get(o.actionId) !== true),
        );
        if (!inPlace) intent.meta = false;
      }
      const declined = new Set([...decided].filter(([, yes]) => !yes).map(([id]) => id));
      const choice: StepOption | undefined = chooseOption(
        r.policy,
        w,
        options,
        intent,
        declined,
        rng,
      );
      if (choice === undefined) {
        stuck++;
        break;
      }
      const result = perform(c, w, choice, stepOptions);
      if (choice.kind === 'action' && r.policy.storeActions.has(choice.actionId))
        intent.purchase = false;
      record(result.events, result.violations, w, result.next);
      w =
        choice.kind === 'ui' ? { ...result.next, now: result.next.now + r.uiSeconds } : result.next;
      const after = settle(c, w, stepOptions);
      record(after.events, after.violations, w, after.next);
      w = after.next;
    }
  };

  for (day = 0; day < options.days; day++) {
    dayFaucet = {};
    daySink = {};
    dayImpressions = {};
    let daySessions = 0;
    if (churnedOnDay === null) {
      const values = { ...w.values };
      resetScope(c, values, 'day');
      w = { ...w, values };
      const n = Math.max(0, Math.round(sample(persona.sessionsPerDay, rng)));
      const dayStart = day * SECONDS_PER_DAY;
      for (session = 1; session <= n; session++) {
        const planned = dayStart + (session * SECONDS_PER_DAY) / (n + 1);
        runSession(Math.max(w.now, planned));
        daySessions++;
        if (r.progressKey !== undefined) progressHistory.push(w.values[r.progressKey] ?? 0);
        const stalled =
          progressHistory.length >= 4 && progressHistory.at(-1) === progressHistory.at(-4);
        const hazard =
          persona.churnSensitivity *
          (r.churn.base + r.churn.perFailure * consecutiveFailures + (stalled ? r.churn.stall : 0));
        if (rng.chance(Math.min(1, hazard))) {
          churnedOnDay = day + 1;
          break;
        }
      }
    }
    const snapshot: Record<string, number> = {};
    for (const k of r.trackedKeys) snapshot[k] = w.values[k] as number;
    days.push({
      active: daySessions > 0,
      sessions: daySessions,
      values: snapshot,
      faucet: dayFaucet,
      sink: daySink,
      impressions: dayImpressions,
    });
  }

  const summary: PlayerSummary = {
    persona: persona.id,
    index,
    skill,
    days,
    churnedOnDay,
    sessions,
    missions,
    stuckSessions: stuck,
    impressions,
    offers,
    accepts,
    purchases,
    attempts,
    deaths,
    invariantChecks: Object.fromEntries([...invariantChecks].sort(([a], [b]) => (a < b ? -1 : 1))),
    violations,
    violationCounts,
    rangeViolations,
    capHits,
    finalValues: w.values,
  };
  return keepTrace ? { ...summary, trace } : summary;
}

/** Simulates every requested player (or the `playerRange` slice), in a fixed order. */
export function simulatePlayers(
  input: GameModel | CompiledModel,
  options: SimulationOptions,
): PlayerSummary[] {
  const c =
    'transitionsFrom' in input
      ? input
      : compileModel(input, options.params === undefined ? {} : { params: options.params });
  const r = resolveOptions(c, options);
  const from = options.playerRange?.from ?? 0;
  const to = Math.min(
    options.playerRange?.to ?? options.playersPerPersona,
    options.playersPerPersona,
  );
  const out: PlayerSummary[] = [];
  for (const persona of r.personas)
    for (let i = from; i < to; i++) out.push(simulatePlayer(r, persona, i, options));
  return out;
}
