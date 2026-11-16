import { idToKey, type GameModel } from '@gamex/model';
import { compileModel } from './compile.js';
import { EngineModelError } from './errors.js';
import { deriveSeed, Rng } from './random.js';
import { runSimulation, type SimulationResult } from './results.js';
import type { SimulationOptions } from './simulate.js';
import { round6 } from './stats.js';

export interface SweepRow {
  readonly params: Readonly<Record<string, number>>;
  /** KPI scalar values by KPI key (null when not computable). */
  readonly kpis: Readonly<Record<string, number | null>>;
  readonly failedInvariants: readonly string[];
  readonly outputHash: string;
}

export interface SweepResult {
  readonly method: 'grid' | 'latin-hypercube';
  readonly rows: readonly SweepRow[];
}

type BaseOptions = Omit<SimulationOptions, 'params'>;

interface Range {
  readonly min: number;
  readonly max: number;
  readonly step: number | undefined;
}

function constantRanges(model: GameModel): Map<string, Range & { value: number }> {
  const out = new Map<string, Range & { value: number }>();
  for (const c of model.constants) {
    if (typeof c.value !== 'number') continue;
    out.set(idToKey(c.id), {
      min: c.min ?? c.value,
      max: c.max ?? c.value,
      step: c.step,
      value: c.value,
    });
  }
  return out;
}

function rowOf(params: Record<string, number>, r: SimulationResult): SweepRow {
  return {
    params,
    kpis: Object.fromEntries(r.kpis.map((k) => [k.key, k.value])),
    failedInvariants: r.invariants.filter((i) => i.status === 'fail').map((i) => i.id),
    outputHash: r.record.outputHash,
  };
}

/**
 * Runs the simulation for every combination of the given values. Every run uses the same seed (common random
 * numbers), so differences between rows come from the parameters, not from noise.
 */
export function gridSweep(
  model: GameModel,
  values: Readonly<Record<string, readonly number[]>>,
  options: BaseOptions,
): SweepResult {
  const keys = Object.keys(values).sort();
  let combos: Record<string, number>[] = [{}];
  for (const k of keys) {
    const vs = values[k] ?? [];
    if (vs.length === 0) throw new EngineModelError(`Sweep parameter "${k}" has no values`);
    combos = combos.flatMap((c) => vs.map((v) => ({ ...c, [k]: v })));
  }
  return {
    method: 'grid',
    rows: combos.map((params) =>
      rowOf(params, runSimulation(compileModel(model, { params }), { ...options, params })),
    ),
  };
}

/** Snaps x to the constant's step grid (from min) and clamps it to [min, max]. */
export function snap(x: number, range: Range): number {
  let v = Math.min(Math.max(x, range.min), range.max);
  if (range.step !== undefined)
    v = range.min + Math.round((v - range.min) / range.step) * range.step;
  return round6(Math.min(Math.max(v, range.min), range.max));
}

/**
 * Latin-hypercube sampling over constants' declared ranges: each parameter's range is split into `samples`
 * equal strata, and each stratum is used exactly once, in a seeded random order.
 */
export function latinHypercubeSweep(
  model: GameModel,
  keys: readonly string[],
  samples: number,
  options: BaseOptions,
): SweepResult {
  if (!Number.isInteger(samples) || samples < 1)
    throw new EngineModelError('samples must be a positive integer');
  const ranges = constantRanges(model);
  const rng = new Rng(deriveSeed(options.seed, 'lhs'));
  const columns = new Map<string, number[]>();
  for (const k of [...keys].sort()) {
    const range = ranges.get(k);
    if (range === undefined) throw new EngineModelError(`"${k}" is not a scalar constant key`);
    if (range.min === range.max)
      throw new EngineModelError(`Constant "${k}" needs min and max to be swept`);
    const strata = rng.shuffle(Array.from({ length: samples }, (_, i) => i));
    columns.set(
      k,
      strata.map((s) =>
        snap(range.min + ((s + rng.next()) / samples) * (range.max - range.min), range),
      ),
    );
  }
  const rows: SweepRow[] = [];
  for (let i = 0; i < samples; i++) {
    const params: Record<string, number> = {};
    for (const [k, col] of columns) params[k] = col[i] ?? 0;
    rows.push(
      rowOf(params, runSimulation(compileModel(model, { params }), { ...options, params })),
    );
  }
  return { method: 'latin-hypercube', rows };
}

export interface SensitivityEntry {
  readonly constant: string;
  readonly low: number;
  readonly high: number;
  readonly kpiAtLow: number | null;
  readonly kpiAtHigh: number | null;
  /** kpiAtHigh − kpiAtLow. */
  readonly delta: number | null;
  /** Relative KPI change per relative parameter change around the baseline. */
  readonly elasticity: number | null;
}

export interface SensitivityResult {
  readonly baseline: Readonly<Record<string, number | null>>;
  /** For each KPI key: constants ranked by |delta| (largest first) — the data of a tornado chart. */
  readonly tornado: Readonly<Record<string, readonly SensitivityEntry[]>>;
}

/**
 * One-at-a-time sensitivity: each constant is set to its declared min and max (others at baseline), and the
 * change of every KPI is recorded. Constants without a range are skipped.
 */
export function sensitivity(
  model: GameModel,
  options: BaseOptions & { readonly constants?: readonly string[] },
): SensitivityResult {
  const ranges = constantRanges(model);
  const keys = (options.constants ?? [...ranges.keys()]).filter((k) => {
    const r = ranges.get(k);
    if (r === undefined) throw new EngineModelError(`"${k}" is not a scalar constant key`);
    return r.min < r.max;
  });
  const base = runSimulation(model, options);
  const baseline = Object.fromEntries(base.kpis.map((k) => [k.key, k.value]));
  const runs = keys.map((k) => {
    const r = ranges.get(k) as Range & { value: number };
    const low = runSimulation(compileModel(model, { params: { [k]: r.min } }), {
      ...options,
      params: { [k]: r.min },
    });
    const high = runSimulation(compileModel(model, { params: { [k]: r.max } }), {
      ...options,
      params: { [k]: r.max },
    });
    return {
      k,
      r,
      low: Object.fromEntries(low.kpis.map((x) => [x.key, x.value])),
      high: Object.fromEntries(high.kpis.map((x) => [x.key, x.value])),
    };
  });
  const tornado: Record<string, SensitivityEntry[]> = {};
  for (const kpi of Object.keys(baseline).sort()) {
    const entries = runs.map(({ k, r, low, high }): SensitivityEntry => {
      const a = low[kpi] ?? null;
      const b = high[kpi] ?? null;
      const delta = a === null || b === null ? null : round6(b - a);
      const b0 = baseline[kpi] ?? null;
      const elasticity =
        delta === null || b0 === null || b0 === 0 || r.value === 0
          ? null
          : round6(delta / b0 / ((r.max - r.min) / r.value));
      return { constant: k, low: r.min, high: r.max, kpiAtLow: a, kpiAtHigh: b, delta, elasticity };
    });
    entries.sort(
      (x, y) =>
        Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0) || (x.constant < y.constant ? -1 : 1),
    );
    tornado[kpi] = entries;
  }
  return { baseline, tornado };
}
