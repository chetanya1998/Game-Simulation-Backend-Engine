import { roundHalfEven } from './expr/functions.js';
import type { Result } from './expr/errors.js';

export type Rounding = 'none' | 'floor' | 'ceil' | 'round-half-even';

interface CurveCommon {
  /** Rounding applied to the curve's raw value (default "none"). */
  readonly rounding?: Rounding | undefined;
  /** Clamp applied after rounding. */
  readonly min?: number | undefined;
  readonly max?: number | undefined;
}

/** A tunable value that depends on a tier/level `n` (master prompt §6: curves are first-class). */
export type Curve =
  | (CurveCommon & {
      readonly type: 'linear';
      readonly params: {
        readonly base: number;
        readonly perStep: number;
        readonly from?: number | undefined;
      };
    })
  | (CurveCommon & {
      readonly type: 'geometric';
      readonly params: {
        readonly base: number;
        readonly ratio: number;
        readonly from?: number | undefined;
      };
    })
  | (CurveCommon & {
      readonly type: 'table';
      readonly params: { readonly values: readonly number[]; readonly from?: number | undefined };
    })
  | (CurveCommon & {
      readonly type: 'piecewise';
      readonly params: {
        readonly segments: readonly { readonly upTo?: number | undefined; readonly curve: Curve }[];
      };
    });

/**
 * x^k for integer k by exponentiation by squaring. Uses only multiplication and division, which are
 * exactly specified, so the result is identical in every JS engine (unlike Math.pow).
 */
export function integerPower(x: number, k: number): number {
  if (!Number.isInteger(k))
    throw new RangeError(`integerPower needs an integer exponent, got ${String(k)}`);
  let base = k < 0 ? 1 / x : x;
  let e = Math.abs(k);
  let result = 1;
  while (e > 0) {
    if (e % 2 === 1) result *= base;
    base *= base;
    e = Math.floor(e / 2);
  }
  return result;
}

export function applyRounding(x: number, rounding: Rounding | undefined): number {
  switch (rounding ?? 'none') {
    case 'floor':
      return Math.floor(x);
    case 'ceil':
      return Math.ceil(x);
    case 'round-half-even':
      return roundHalfEven(x);
    case 'none':
      return x;
  }
}

function raw(curve: Curve, n: number): Result<number, string> {
  switch (curve.type) {
    case 'linear':
      return {
        ok: true,
        value: curve.params.base + curve.params.perStep * (n - (curve.params.from ?? 1)),
      };
    case 'geometric':
      return {
        ok: true,
        value: curve.params.base * integerPower(curve.params.ratio, n - (curve.params.from ?? 1)),
      };
    case 'table': {
      const values = curve.params.values;
      if (values.length === 0) return { ok: false, error: 'table curve has no values' };
      const index = Math.min(Math.max(n - (curve.params.from ?? 1), 0), values.length - 1);
      return { ok: true, value: values[index] ?? 0 };
    }
    case 'piecewise': {
      const segment = curve.params.segments.find((s) => s.upTo === undefined || n <= s.upTo);
      if (segment === undefined)
        return { ok: false, error: `piecewise curve has no segment for n = ${String(n)}` };
      return evalCurve(segment.curve, n);
    }
  }
}

/**
 * Evaluates a curve at integer tier `n`: raw value → rounding → clamp. Table curves clamp `n` to their
 * first/last entry. Returns an error (never throws) for a non-integer `n` or a non-finite result.
 */
export function evalCurve(curve: Curve, n: number): Result<number, string> {
  if (!Number.isInteger(n))
    return { ok: false, error: `curve tier must be an integer, got ${String(n)}` };
  const r = raw(curve, n);
  if (!r.ok) return r;
  let value = applyRounding(r.value, curve.rounding);
  if (curve.min !== undefined) value = Math.max(value, curve.min);
  if (curve.max !== undefined) value = Math.min(value, curve.max);
  if (!Number.isFinite(value))
    return { ok: false, error: `curve value at n = ${String(n)} is not finite` };
  return { ok: true, value };
}
