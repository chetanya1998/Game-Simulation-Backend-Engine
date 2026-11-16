import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LN2,
  Rng,
  deriveSeed,
  dexp,
  dlog,
  mix32,
  poisson,
  sample,
  standardNormal,
} from '@gamex/engine';

const draws = (rng: Rng, n: number, f: (r: Rng) => number): number[] =>
  Array.from({ length: n }, () => f(rng));
const meanOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const varOf = (xs: number[]): number => {
  const m = meanOf(xs);
  return meanOf(xs.map((x) => (x - m) * (x - m)));
};

describe('Rng', () => {
  it('reproduces the same sequence for the same seed (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        expect(draws(new Rng(seed), 20, (r) => r.nextUint32())).toEqual(
          draws(new Rng(seed), 20, (r) => r.nextUint32()),
        );
      }),
    );
  });

  it('pins the first outputs of seed 42 (cross-engine regression)', () => {
    expect(draws(new Rng(42), 4, (r) => r.nextUint32())).toMatchInlineSnapshot(`
      [
        866592460,
        3929343673,
        3618975535,
        3696398421,
      ]
    `);
  });

  it('produces values in [0, 1) with a uniform mean', () => {
    const xs = draws(new Rng(7), 20000, (r) => r.next());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(meanOf(xs)).toBeCloseTo(0.5, 2);
  });

  it('int() covers [lo, hi] evenly', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    const rng = new Rng(3);
    for (let i = 0; i < 6000; i++) {
      const k = rng.int(0, 5);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });

  it('weightedIndex follows the weights and skips zero weights', () => {
    const rng = new Rng(11);
    const counts = [0, 0, 0];
    for (let i = 0; i < 9000; i++) {
      const k = rng.weightedIndex([1, 0, 2]);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts[1]).toBe(0);
    expect((counts[2] ?? 0) / (counts[0] ?? 1)).toBeGreaterThan(1.7);
    expect(rng.weightedIndex([0, 0])).toBe(-1);
    expect(rng.weightedIndex([-1, 0, 5])).toBe(2);
  });

  it('chance() and shuffle() behave', () => {
    const rng = new Rng(5);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    const shuffled = rng.shuffle([1, 2, 3, 4, 5]);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('deriveSeed', () => {
  it('is deterministic and separates labels', () => {
    expect(deriveSeed(1, 'payer', 3)).toBe(deriveSeed(1, 'payer', 3));
    const seeds = new Set([
      deriveSeed(1, 'payer', 3),
      deriveSeed(1, 'payer', 4),
      deriveSeed(1, 'casual', 3),
      deriveSeed(2, 'payer', 3),
      deriveSeed(1, 'payer3'),
    ]);
    expect(seeds.size).toBe(5);
  });

  it('mixes to 32-bit unsigned integers (property)', () => {
    fc.assert(
      fc.property(fc.integer(), (x) => {
        const m = mix32(x);
        expect(Number.isInteger(m) && m >= 0 && m < 2 ** 32).toBe(true);
      }),
    );
  });
});

describe('deterministic math', () => {
  it('dexp matches Math.exp to ~1e-14 relative (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -700, max: 700, noNaN: true }), (x) => {
        const ref = Math.exp(x);
        expect(Math.abs(dexp(x) - ref) / ref).toBeLessThan(1e-13);
      }),
      { numRuns: 2000 },
    );
  });

  it('dlog matches Math.log to ~1e-14 (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-300, max: 1e300, noNaN: true }), (x) => {
        const ref = Math.log(x);
        expect(Math.abs(dlog(x) - ref)).toBeLessThan(1e-13 * Math.max(1, Math.abs(ref)));
      }),
      { numRuns: 2000 },
    );
  });

  it('handles special values', () => {
    expect(dexp(0)).toBe(1);
    expect(dexp(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(dexp(-1000)).toBe(0);
    expect(Number.isNaN(dexp(Number.NaN))).toBe(true);
    expect(dlog(1)).toBe(0);
    expect(dlog(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(dlog(-1))).toBe(true);
    expect(dlog(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(dlog(2)).toBeCloseTo(LN2, 15);
    expect(dlog(5e-324)).toBeCloseTo(Math.log(5e-324), 10);
  });

  it('dlog inverts dexp (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), (x) => {
        expect(dlog(dexp(x))).toBeCloseTo(x, 10);
      }),
    );
  });
});

describe('distributions', () => {
  it('standard normal has mean 0 and variance 1', () => {
    const xs = draws(new Rng(1), 20000, standardNormal);
    expect(meanOf(xs)).toBeCloseTo(0, 1);
    expect(varOf(xs)).toBeCloseTo(1, 1);
  });

  it.each([2, 12.5, 80])('poisson(%d) has mean ≈ variance ≈ λ', (lambda) => {
    const xs = draws(new Rng(2), 20000, (r) => poisson(r, lambda));
    expect(Math.abs(meanOf(xs) - lambda) / lambda).toBeLessThan(0.03);
    expect(Math.abs(varOf(xs) - lambda) / lambda).toBeLessThan(0.08);
    expect(xs.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
    expect(poisson(new Rng(1), 0)).toBe(0);
  });

  it('samples every distribution type within its bounds', () => {
    const rng = new Rng(9);
    expect(sample({ type: 'constant', value: 4 }, rng)).toBe(4);
    const u = draws(rng, 5000, (r) => sample({ type: 'uniform', min: 60, max: 300 }, r));
    expect(Math.min(...u)).toBeGreaterThanOrEqual(60);
    expect(meanOf(u)).toBeCloseTo(180, -1);
    const n = draws(rng, 5000, (r) =>
      sample({ type: 'normal', mean: 0.5, sd: 0.3, min: 0, max: 1 }, r),
    );
    expect(Math.min(...n)).toBe(0);
    expect(Math.max(...n)).toBe(1);
    const ln = draws(rng, 5000, (r) => sample({ type: 'lognormal', mu: 0, sigma: 0.5 }, r));
    expect(meanOf(ln)).toBeCloseTo(Math.exp(0.125), 1);
    const b = draws(rng, 5000, (r) => sample({ type: 'bernoulli', p: 0.3 }, r));
    expect(meanOf(b)).toBeCloseTo(0.3, 1);
    expect(sample({ type: 'poisson', mean: 3 }, rng)).toBeGreaterThanOrEqual(0);
  });
});
