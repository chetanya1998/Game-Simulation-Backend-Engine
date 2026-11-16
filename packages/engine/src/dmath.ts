/**
 * Deterministic elementary functions. `Math.exp`/`Math.log` are implementation-approximated and can differ
 * in the last bits between JavaScript engines; these use only + − × ÷ and fixed iteration counts, so they
 * give bit-identical results everywhere (accurate to ~1e-15 relative).
 */
import { integerPower } from '@gamex/model';

export const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

/** e^x. */
export function dexp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 709.78) return Number.POSITIVE_INFINITY;
  if (x < -745.2) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  // Taylor series of e^r for |r| ≤ ln2/2, 24 terms (error < 1e-17).
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 24; n++) {
    term = (term * r) / n;
    sum += term;
  }
  // Scale by 2^k in two halves to avoid overflow of 2^k for large |k| before multiplying.
  const half = Math.trunc(k / 2);
  return sum * integerPower(2, half) * integerPower(2, k - half);
}

/** Natural logarithm; NaN for x < 0, −∞ for 0. */
export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (x === Number.POSITIVE_INFINITY) return x;
  // x = m · 2^e with m in [1/√2, √2): multiplying/dividing by 2 is exact.
  let m = x;
  let e = 0;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  if (m > SQRT2) {
    m /= 2;
    e++;
  }
  // ln m = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716; 22 terms (error < 1e-17).
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let power = s;
  let sum = 0;
  for (let k = 0; k < 22; k++) {
    sum += power / (2 * k + 1);
    power *= s2;
  }
  return e * LN2 + 2 * sum;
}
