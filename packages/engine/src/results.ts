import {
  SCHEMA_VERSION,
  canonicalStringify,
  computeContentHash,
  evaluateExpr,
  idToKey,
  parseExpr,
  sha256Hex,
  type GameModel,
  type Kpi,
} from '@gamex/model';
import { compileModel, type CompiledModel } from './compile.js';
import { ENGINE_VERSION } from './version.js';
import {
  resolveOptions,
  simulatePlayers,
  type Evidence,
  type PlayerSummary,
  type SimulationOptions,
} from './simulate.js';
import { round6, summarize, type Summary } from './stats.js';
import { envOf } from './world.js';

export interface DailyAggregate {
  readonly day: number;
  readonly dau: number;
  readonly retention: number;
  readonly sessionsPerDau: number;
  readonly values: Readonly<Record<string, Summary>>;
  readonly faucet: Readonly<Record<string, number>>;
  readonly sink: Readonly<Record<string, number>>;
  readonly impressionsPerDau: Readonly<Record<string, number>>;
}

export interface PersonaResult {
  readonly id: string;
  readonly players: number;
  readonly churned: number;
  readonly daily: readonly DailyAggregate[];
  readonly placements: readonly {
    readonly id: string;
    readonly impressions: number;
    readonly offers: number;
    readonly accepts: number;
  }[];
  readonly attempts: readonly {
    readonly action: string;
    readonly level: string;
    readonly attempts: number;
    readonly failures: number;
    readonly failureRate: number;
  }[];
  /** Where combat missions were lost: "actionId@stage" → count. */
  readonly deaths: Readonly<Record<string, number>>;
}

export interface KpiResult {
  readonly id: string;
  readonly key: string;
  readonly metric: Kpi['metric'];
  readonly persona: string | null;
  /** The scalar used by aggregate invariants; null when it cannot be computed (see `note`). */
  readonly value: number | null;
  readonly note?: string;
  readonly detail?: unknown;
}

export interface InvariantResult {
  readonly id: string;
  readonly kind: 'trace' | 'aggregate';
  readonly severity: 'blocking' | 'warning';
  readonly status: 'pass' | 'fail' | 'skipped';
  /** How many times the invariant was evaluated (trace) — 0 means it was never exercised. */
  readonly checks: number;
  readonly violations: number;
  readonly message: string;
  readonly evidence?: Evidence;
}

export interface Finding {
  readonly kind: 'unbounded-growth' | 'range-violation' | 'cap-hit' | 'stuck-sessions';
  readonly severity: 'blocking' | 'warning' | 'info';
  readonly message: string;
  readonly ref?: string;
}

export interface RunRecord {
  readonly engineVersion: string;
  readonly schemaVersion: string;
  readonly model: {
    readonly name: string;
    readonly modelVersion: number;
    readonly contentHash: string;
  };
  readonly seed: number;
  readonly days: number;
  readonly playersPerPersona: number;
  readonly personas: readonly string[];
  readonly params: Readonly<Record<string, number>>;
  readonly options: Readonly<Record<string, unknown>>;
  /** SHA-256 of the canonical JSON of the result without this field. */
  readonly outputHash: string;
}

export interface SimulationResult {
  readonly record: RunRecord;
  readonly personas: readonly PersonaResult[];
  readonly kpis: readonly KpiResult[];
  readonly invariants: readonly InvariantResult[];
  readonly findings: readonly Finding[];
  readonly traces: readonly {
    readonly persona: string;
    readonly index: number;
    readonly events: NonNullable<PlayerSummary['trace']>;
  }[];
}

const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const ratio = (a: number, b: number): number | null => (b === 0 ? null : round6(a / b));
const refKey = (ref: unknown): string | undefined =>
  typeof ref === 'string' && ref.includes(':')
    ? idToKey(ref.slice(ref.indexOf(':') + 1))
    : undefined;

function dauDays(players: readonly PlayerSummary[]): number {
  return sumOf(players.map((p) => p.days.filter((d) => d.active).length));
}

function lastValue(p: PlayerSummary, key: string, day?: number): number {
  const d = p.days[(day ?? p.days.length) - 1] ?? p.days.at(-1);
  return d?.values[key] ?? 0;
}

function constantValue(c: CompiledModel, ref: unknown): number | undefined {
  const key = refKey(ref);
  return key === undefined ? undefined : c.constants.get(key);
}

function adRevenue(c: CompiledModel, players: readonly PlayerSummary[]): number | null {
  const a = c.model.monetization.assumptions;
  if (a === undefined) return null;
  let revenue = 0;
  for (const p of players) {
    for (const [placementId, n] of Object.entries(p.impressions)) {
      const format = c.placements.get(placementId)?.format;
      if (format === undefined || format === 'iap') continue;
      const ecpm = constantValue(c, a.ecpm[format]);
      const fill = constantValue(c, a.fillRate[format]) ?? 1;
      if (ecpm !== undefined) revenue += (n * fill * ecpm) / 1000;
    }
  }
  return revenue;
}

function computeKpi(
  c: CompiledModel,
  kpi: Kpi,
  all: readonly PlayerSummary[],
  days: number,
  failures: ReadonlySet<string>,
  scope?: string,
): KpiResult {
  const persona = kpi.persona?.slice('persona:'.length) ?? scope ?? null;
  const players = persona === null ? all : all.filter((p) => p.persona === persona);
  const base = { id: kpi.id, key: idToKey(kpi.id), metric: kpi.metric, persona };
  const params = kpi.params ?? {};
  const varKey = refKey(params['variable']);
  const resKey = refKey(params['resource']);
  const n = players.length;
  const none = (note: string): KpiResult => ({ ...base, value: null, note });
  if (n === 0) return none('no players in scope');

  switch (kpi.metric) {
    case 'progression-speed': {
      if (varKey === undefined) return none('needs params.variable');
      const finals = players.map((p) => lastValue(p, varKey));
      const levels = [
        ...new Set(players.flatMap((p) => p.days.map((d) => d.values[varKey] ?? 0))),
      ].sort((a, b) => a - b);
      const detail = levels.map((level) => {
        const firstDays = players
          .map((p) => p.days.findIndex((d) => (d.values[varKey] ?? 0) >= level) + 1)
          .filter((d) => d > 0);
        return {
          level,
          reachedShare: round6(firstDays.length / n),
          meanDayReached:
            firstDays.length === 0 ? null : round6(sumOf(firstDays) / firstDays.length),
        };
      });
      return { ...base, value: round6(sumOf(finals) / n), detail };
    }
    case 'reach-rate': {
      if (varKey === undefined) return none('needs params.variable');
      const target = Number(params['value'] ?? 1);
      const day = Math.min(days, Number(params['day'] ?? days));
      return {
        ...base,
        value: round6(players.filter((p) => lastValue(p, varKey, day) >= target).length / n),
        detail: { target, day },
      };
    }
    case 'currency-balance': {
      if (resKey === undefined) return none('needs params.resource');
      return {
        ...base,
        value: round6(sumOf(players.map((p) => lastValue(p, resKey))) / n),
        detail: summarize(players.map((p) => lastValue(p, resKey))),
      };
    }
    case 'inflation-rate': {
      if (resKey === undefined) return none('needs params.resource');
      if (days < 2) return none('needs at least 2 days');
      const first = sumOf(players.map((p) => lastValue(p, resKey, 1))) / n;
      const last = sumOf(players.map((p) => lastValue(p, resKey))) / n;
      return {
        ...base,
        value: round6((last - first) / Math.max(1, first) / (days - 1)),
        detail: { firstDayMean: round6(first), lastDayMean: round6(last) },
      };
    }
    case 'faucet-sink-ratio': {
      if (resKey === undefined) return none('needs params.resource');
      const faucet = sumOf(players.flatMap((p) => p.days.map((d) => d.faucet[resKey] ?? 0)));
      const sink = sumOf(players.flatMap((p) => p.days.map((d) => d.sink[resKey] ?? 0)));
      const value = ratio(faucet, sink);
      return value === null
        ? { ...base, value: null, note: 'nothing was spent', detail: { faucet, sink } }
        : { ...base, value, detail: { faucet, sink } };
    }
    case 'progression-walls': {
      const table = new Map<string, { attempts: number; failures: number; players: number }>();
      for (const p of players) {
        for (const [k, v] of Object.entries(p.attempts)) {
          const e = table.get(k) ?? { attempts: 0, failures: 0, players: 0 };
          e.attempts += v.attempts;
          e.failures += v.failures;
          e.players += 1;
          table.set(k, e);
        }
      }
      const minAttempts = Number(params['minAttempts'] ?? 20);
      const maxWinRate = Number(params['maxWinRate'] ?? 0.25);
      const rows = [...table]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => {
          const [action = '', level = ''] = k.split('@');
          return {
            action,
            level,
            attempts: v.attempts,
            winRate: round6(1 - v.failures / v.attempts),
            players: v.players,
          };
        });
      const walls = rows.filter((r) => r.attempts >= minAttempts && r.winRate <= maxWinRate);
      const levels = walls
        .filter((w) => w.level !== '')
        .map((w) => Number(w.level))
        .filter((x) => Number.isFinite(x));
      return {
        ...base,
        value: levels.length === 0 ? null : Math.min(...levels),
        ...(walls.length === 0 ? { note: 'no wall found' } : {}),
        detail: { walls, attempts: rows, failureOutcomes: [...failures] },
      };
    }
    case 'churn-risk':
      return { ...base, value: round6(players.filter((p) => p.churnedOnDay !== null).length / n) };
    case 'ad-impressions-per-dau': {
      const format = params['format'];
      const total = sumOf(
        players.flatMap((p) =>
          p.days.map((d) =>
            format === undefined
              ? sumOf(Object.values(d.impressions))
              : (d.impressions[String(format)] ?? 0),
          ),
        ),
      );
      const value = ratio(total, dauDays(players));
      return value === null ? none('no active days') : { ...base, value };
    }
    case 'rewarded-opt-in-rate': {
      const only =
        refKey(params['placement']) === undefined
          ? undefined
          : String(params['placement']).slice('placement:'.length);
      const offers = sumOf(
        players.flatMap((p) =>
          Object.entries(p.offers)
            .filter(([k]) => only === undefined || k === only)
            .map(([, v]) => v),
        ),
      );
      const accepts = sumOf(
        players.flatMap((p) =>
          Object.entries(p.accepts)
            .filter(([k]) => only === undefined || k === only)
            .map(([, v]) => v),
        ),
      );
      const value = ratio(accepts, offers);
      return value === null ? none('no rewarded offers') : { ...base, value };
    }
    case 'ad-revenue-per-dau': {
      const revenue = adRevenue(c, players);
      if (revenue === null) return none('no revenue assumptions (monetization.assumptions)');
      const value = ratio(revenue, dauDays(players));
      return value === null ? none('no active days') : { ...base, value };
    }
    case 'iap-conversion': {
      const placement =
        refKey(params['placement']) === undefined
          ? undefined
          : c.placements.get(String(params['placement']).slice('placement:'.length));
      const action = placement?.triggerAction;
      const payers = players.filter((p) =>
        Object.entries(p.purchases).some(
          ([a, v]) => v > 0 && (action === undefined || a === action),
        ),
      ).length;
      return { ...base, value: round6(payers / n) };
    }
    case 'arppu':
    case 'arpdau': {
      const price = constantValue(c, params['price']);
      const purchases = sumOf(players.flatMap((p) => Object.values(p.purchases)));
      const iapRevenue = price === undefined ? null : purchases * price;
      if (kpi.metric === 'arppu') {
        if (iapRevenue === null) return none('needs params.price (a constant reference)');
        const payers = players.filter((p) => sumOf(Object.values(p.purchases)) > 0).length;
        const value = ratio(iapRevenue, payers);
        return value === null ? none('no payers') : { ...base, value };
      }
      const ads = adRevenue(c, players);
      if (ads === null && iapRevenue === null)
        return none('needs revenue assumptions or params.price');
      const value = ratio((ads ?? 0) + (iapRevenue ?? 0), dauDays(players));
      return value === null ? none('no active days') : { ...base, value };
    }
    case 'custom': {
      if (kpi.expr === undefined) return none('needs expr');
      const parsed = parseExpr(kpi.expr);
      if (!parsed.ok) return none(parsed.error.message);
      let total = 0;
      for (const p of players) {
        const env = envOf(c, {
          state: c.initialState,
          prevState: c.initialState,
          stack: [],
          now: days * 86400,
          values: p.finalValues,
          persona: { skill: p.skill, churnSensitivity: 0 },
          inMission: false,
        });
        const r = evaluateExpr(parsed.value, env);
        if (!r.ok || typeof r.value !== 'number')
          return none(r.ok ? 'expr is not a number' : r.error.message);
        total += r.value;
      }
      return { ...base, value: round6(total / n) };
    }
  }
}

function aggregatePersona(
  c: CompiledModel,
  id: string,
  players: readonly PlayerSummary[],
  days: number,
  trackedKeys: readonly string[],
): PersonaResult {
  const daily: DailyAggregate[] = [];
  for (let d = 0; d < days; d++) {
    const snaps = players.map((p) => p.days[d]).filter((s) => s !== undefined);
    const active = snaps.filter((s) => s.active);
    const values: Record<string, Summary> = {};
    for (const k of trackedKeys) values[k] = summarize(snaps.map((s) => s.values[k] ?? 0));
    const sumKey = (
      pick: (s: (typeof snaps)[number]) => Readonly<Record<string, number>>,
    ): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const s of snaps)
        for (const [k, v] of Object.entries(pick(s))) out[k] = (out[k] ?? 0) + v;
      return out;
    };
    const impressions = sumKey((s) => s.impressions);
    daily.push({
      day: d + 1,
      dau: active.length,
      retention: round6(players.length === 0 ? 0 : active.length / players.length),
      sessionsPerDau: round6(
        active.length === 0 ? 0 : sumOf(active.map((s) => s.sessions)) / active.length,
      ),
      values,
      faucet: sumKey((s) => s.faucet),
      sink: sumKey((s) => s.sink),
      impressionsPerDau: Object.fromEntries(
        Object.entries(impressions)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => [k, round6(active.length === 0 ? 0 : v / active.length)]),
      ),
    });
  }
  const placements = [...c.placements.keys()].map((pid) => ({
    id: pid,
    impressions: sumOf(players.map((p) => p.impressions[pid] ?? 0)),
    offers: sumOf(players.map((p) => p.offers[pid] ?? 0)),
    accepts: sumOf(players.map((p) => p.accepts[pid] ?? 0)),
  }));
  const table = new Map<string, { attempts: number; failures: number }>();
  for (const p of players) {
    for (const [k, v] of Object.entries(p.attempts)) {
      const e = table.get(k) ?? { attempts: 0, failures: 0 };
      e.attempts += v.attempts;
      e.failures += v.failures;
      table.set(k, e);
    }
  }
  const attempts = [...table]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => {
      const [action = '', level = ''] = k.split('@');
      return {
        action,
        level,
        attempts: v.attempts,
        failures: v.failures,
        failureRate: round6(v.failures / v.attempts),
      };
    });
  const deaths: Record<string, number> = {};
  for (const p of players)
    for (const [k, v] of Object.entries(p.deaths)) deaths[k] = (deaths[k] ?? 0) + v;
  const sortedDeaths = Object.fromEntries(
    Object.entries(deaths).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return {
    id,
    players: players.length,
    churned: players.filter((p) => p.churnedOnDay !== null).length,
    daily,
    placements,
    attempts,
    deaths: sortedDeaths,
  };
}

function evaluateAggregate(
  c: CompiledModel,
  model: GameModel,
  players: readonly PlayerSummary[],
  days: number,
  failures: ReadonlySet<string>,
): InvariantResult[] {
  const out: InvariantResult[] = [];
  for (const inv of model.invariants) {
    if (inv.kind !== 'aggregate') continue;
    const scope = inv.persona?.slice('persona:'.length);
    const kpiValues = new Map(
      model.kpis.map((k) => [
        idToKey(k.id),
        computeKpi(c, k, players, days, failures, scope).value,
      ]),
    );
    const parsed = parseExpr(inv.expr);
    const base = {
      id: inv.id,
      kind: 'aggregate' as const,
      severity: inv.severity,
      checks: 1,
      violations: 0,
    };
    if (!parsed.ok) {
      out.push({ ...base, status: 'skipped', checks: 0, message: parsed.error.message });
      continue;
    }
    const missing = [...kpiValues]
      .filter(([k, v]) => v === null && inv.expr.includes(k))
      .map(([k]) => k);
    if (missing.length > 0) {
      out.push({
        ...base,
        status: 'skipped',
        checks: 0,
        message: `KPI ${missing.join(', ')} could not be computed`,
      });
      continue;
    }
    const r = evaluateExpr(parsed.value, {
      value: (name) => kpiValues.get(name) ?? c.constants.get(name) ?? undefined,
    });
    if (!r.ok) out.push({ ...base, status: 'skipped', checks: 0, message: r.error.message });
    else {
      const values = [...kpiValues]
        .filter(([k]) => inv.expr.includes(k))
        .map(([k, v]) => `${k} = ${String(v)}`)
        .join(', ');
      out.push({
        ...base,
        status: r.value === true ? 'pass' : 'fail',
        violations: r.value === true ? 0 : 1,
        message: `${inv.expr} with ${values}`,
      });
    }
  }
  return out;
}

/** Combines player summaries into the full, hashed simulation result. */
export function aggregateResults(
  input: GameModel | CompiledModel,
  options: SimulationOptions,
  players: readonly PlayerSummary[],
): SimulationResult {
  const c =
    'transitionsFrom' in input
      ? input
      : compileModel(input, options.params === undefined ? {} : { params: options.params });
  const r = resolveOptions(c, options);
  const ordered = [...players].sort((a, b) => {
    const pa = r.personas.findIndex((p) => p.id === a.persona);
    const pb = r.personas.findIndex((p) => p.id === b.persona);
    return pa - pb || a.index - b.index;
  });
  const personas = r.personas.map((p) =>
    aggregatePersona(
      c,
      p.id,
      ordered.filter((x) => x.persona === p.id),
      options.days,
      r.trackedKeys,
    ),
  );
  const kpis = c.model.kpis.map((k) => computeKpi(c, k, ordered, options.days, r.failures));

  const trace: InvariantResult[] = c.traceInvariants.map((inv) => {
    const checks = sumOf(ordered.map((p) => p.invariantChecks[inv.id] ?? 0));
    const violations = sumOf(ordered.map((p) => p.violationCounts[inv.id] ?? 0));
    const evidence = ordered.flatMap((p) => p.violations).find((v) => v.invariantId === inv.id);
    const status = violations > 0 ? 'fail' : checks === 0 ? 'skipped' : 'pass';
    const message =
      status === 'pass'
        ? `held in all ${String(checks)} checks across ${String(ordered.length)} players`
        : status === 'skipped'
          ? 'never exercised by the simulated players'
          : `violated ${String(violations)} time(s) in ${String(checks)} checks`;
    return {
      id: inv.id,
      kind: 'trace' as const,
      severity: inv.blocking ? 'blocking' : 'warning',
      status,
      checks,
      violations,
      message,
      ...(evidence === undefined ? {} : { evidence }),
    };
  });
  const invariants = [
    ...trace,
    ...evaluateAggregate(c, c.model, ordered, options.days, r.failures),
  ];

  const findings: Finding[] = [];
  for (const res of c.resources.values()) {
    if (options.days < 4) break;
    for (const p of personas) {
      const means = p.daily.map((d) => d.values[res.key]?.mean ?? 0);
      const half = means.slice(Math.floor(means.length / 2));
      const rising = half.every((v, i) => i === 0 || v > (half[i - 1] ?? 0));
      const lastSink = p.daily.at(-1)?.sink[res.key] ?? 0;
      if (rising && lastSink === 0 && (half.at(-1) ?? 0) > 0) {
        findings.push({
          kind: 'unbounded-growth',
          severity: 'warning',
          ref: `res:${res.id}`,
          message: `${res.id} rises every day in the second half for persona ${p.id}, with nothing spent on the last day — is there a late-game sink?`,
        });
      }
    }
  }
  const rangeViolations = sumOf(ordered.map((p) => p.rangeViolations));
  if (rangeViolations > 0)
    findings.push({
      kind: 'range-violation',
      severity: 'blocking',
      message: `${String(rangeViolations)} effect(s) pushed a value outside its declared range`,
    });
  const capHits = sumOf(ordered.map((p) => p.capHits));
  if (capHits > 0)
    findings.push({
      kind: 'cap-hit',
      severity: 'info',
      message: `resources hit their cap ${String(capHits)} time(s)`,
    });
  const stuck = sumOf(ordered.map((p) => p.stuckSessions));
  if (stuck > 0)
    findings.push({
      kind: 'stuck-sessions',
      severity: 'warning',
      message: `${String(stuck)} session(s) ended in a screen with no way forward`,
    });

  const traces = ordered
    .filter((p) => p.trace !== undefined)
    .map((p) => ({ persona: p.persona, index: p.index, events: p.trace ?? [] }));
  const body = {
    personas,
    kpis,
    invariants,
    findings,
    traces,
  };
  const recordBase = {
    engineVersion: ENGINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    model: {
      name: c.model.meta.name,
      modelVersion: c.model.meta.modelVersion,
      contentHash: computeContentHash(c.model),
    },
    seed: options.seed,
    days: options.days,
    playersPerPersona: options.playersPerPersona,
    personas: r.personas.map((p) => p.id),
    params: c.params,
    options: {
      uiSeconds: r.uiSeconds,
      maxStepsPerSession: r.maxSteps,
      metaVisitProbability: r.metaP,
      churn: r.churn,
      failureOutcomes: [...r.failures],
      sampleTraces: r.sampleTraces,
    },
  };
  const outputHash = sha256Hex(canonicalStringify({ record: recordBase, ...body }));
  return { record: { ...recordBase, outputHash }, ...body };
}

/** Runs a full Monte Carlo simulation: every persona × playersPerPersona players × days. */
export function runSimulation(
  model: GameModel | CompiledModel,
  options: SimulationOptions,
): SimulationResult {
  const c =
    'transitionsFrom' in model
      ? model
      : compileModel(model, options.params === undefined ? {} : { params: options.params });
  return aggregateResults(
    c,
    options,
    simulatePlayers(c, { ...options, playerRange: { from: 0, to: options.playersPerPersona } }),
  );
}
