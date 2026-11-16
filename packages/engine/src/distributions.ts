import type { Distribution } from '@gamex/model';
import { dexp, dlog } from './dmath.js';
import type { Rng } from './random.js';

/** Standard normal sample by Marsaglia's polar method (needs only log and sqrt). */
export function standardNormal(rng: Rng): number {
  for (;;) {
    const u = 2 * rng.next() - 1;
    const v = 2 * rng.next() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) return u * Math.sqrt((-2 * dlog(s)) / s);
  }
}

function clampTo(x: number, min: number | undefined, max: number | undefined): number {
  let v = x;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/** Poisson sample: Knuth's method for small means, a rounded normal approximation above 30. */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * standardNormal(rng)));
  const limit = dexp(-mean);
  let k = 0;
  let p = rng.next();
  while (p > limit) {
    k++;
    p *= rng.next();
  }
  return k;
}

/** Draws one value from a persona distribution. */
export function sample(dist: Distribution, rng: Rng): number {
  switch (dist.type) {
    case 'constant':
      return dist.value;
    case 'uniform':
      return dist.min + (dist.max - dist.min) * rng.next();
    case 'normal':
      return clampTo(dist.mean + dist.sd * standardNormal(rng), dist.min, dist.max);
    case 'lognormal':
      return clampTo(dexp(dist.mu + dist.sigma * standardNormal(rng)), dist.min, dist.max);
    case 'poisson':
      return poisson(rng, dist.mean);
    case 'bernoulli':
      return rng.chance(dist.p) ? 1 : 0;
  }
}
