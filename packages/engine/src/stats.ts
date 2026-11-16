/** Small, deterministic statistics helpers (fixed summation order). */

export interface Summary {
  readonly mean: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly min: number;
  readonly max: number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Nearest-rank percentile of already-sorted values (p in 0…100). */
export function percentileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: mean(values),
    p10: percentileSorted(sorted, 10),
    p50: percentileSorted(sorted, 50),
    p90: percentileSorted(sorted, 90),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

/** Rounds to 6 significant decimals so reports stay readable; deterministic. */
export function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
