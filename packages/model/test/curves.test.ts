import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyRounding, evalCurve, integerPower, type Curve } from '@gamex/model';

const value = (curve: Curve, n: number): number => {
  const r = evalCurve(curve, n);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('integerPower', () => {
  it('computes exact small powers', () => {
    expect([0, 1, 2, 3, 10].map((k) => integerPower(2, k))).toEqual([1, 2, 4, 8, 1024]);
    expect(integerPower(1.5, 2)).toBe(2.25);
    expect(integerPower(2, -2)).toBe(0.25);
  });

  it('rejects non-integer exponents', () => {
    expect(() => integerPower(2, 0.5)).toThrow(/integer exponent/);
  });

  it('satisfies x^(a+b) = x^a · x^b for integer x (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (x, a, b) => {
          expect(integerPower(x, a + b)).toBe(integerPower(x, a) * integerPower(x, b));
        },
      ),
    );
  });
});

describe('evalCurve', () => {
  const upgrade: Curve = {
    type: 'geometric',
    params: { base: 100, ratio: 1.5 },
    rounding: 'round-half-even',
  };

  it('evaluates the Swarm Rescue upgrade cost curve', () => {
    expect([1, 2, 3, 4, 5, 10].map((n) => value(upgrade, n))).toEqual([
      100, 150, 225, 338, 506, 3844,
    ]);
  });

  it('evaluates linear curves from their first tier', () => {
    const c: Curve = { type: 'linear', params: { base: 50, perStep: 25, from: 1 } };
    expect([1, 2, 5].map((n) => value(c, n))).toEqual([50, 75, 150]);
  });

  it('clamps table lookups to the first and last entry', () => {
    const c: Curve = { type: 'table', params: { values: [3, 4, 5, 6, 6] } };
    expect([-1, 1, 3, 5, 99].map((n) => value(c, n))).toEqual([3, 3, 5, 6, 6]);
  });

  it('picks the first matching piecewise segment', () => {
    const c: Curve = {
      type: 'piecewise',
      params: {
        segments: [
          { upTo: 3, curve: { type: 'linear', params: { base: 10, perStep: 10 } } },
          { curve: { type: 'geometric', params: { base: 30, ratio: 2, from: 3 } } },
        ],
      },
    };
    expect([1, 3, 4, 5].map((n) => value(c, n))).toEqual([10, 30, 60, 120]);
  });

  it('applies rounding, then min/max', () => {
    const c: Curve = {
      type: 'linear',
      params: { base: 0.4, perStep: 1 },
      rounding: 'ceil',
      min: 2,
      max: 3,
    };
    expect([1, 2, 3, 4].map((n) => value(c, n))).toEqual([2, 2, 3, 3]);
  });

  it('reports bad tiers and gaps instead of throwing', () => {
    expect(evalCurve(upgrade, 1.5)).toEqual({
      ok: false,
      error: 'curve tier must be an integer, got 1.5',
    });
    const gap: Curve = {
      type: 'piecewise',
      params: {
        segments: [{ upTo: 2, curve: { type: 'linear', params: { base: 1, perStep: 1 } } }],
      },
    };
    expect(evalCurve(gap, 3).ok).toBe(false);
    expect(evalCurve({ type: 'table', params: { values: [] } }, 1).ok).toBe(false);
    expect(evalCurve({ type: 'geometric', params: { base: 1e300, ratio: 1e10 } }, 5).ok).toBe(
      false,
    );
  });

  it.each([
    ['none', 2.5, 2.5],
    ['floor', 2.7, 2],
    ['ceil', 2.1, 3],
    ['round-half-even', 2.5, 2],
    ['round-half-even', 3.5, 4],
  ] as const)('rounding %s(%d) = %d', (mode, x, expected) => {
    expect(applyRounding(x, mode)).toBe(expected);
  });

  it('geometric curves with ratio ≥ 1 never decrease (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3, noNaN: true }),
        fc.integer({ min: 1, max: 30 }),
        (ratio, n) => {
          const c: Curve = { type: 'geometric', params: { base: 100, ratio }, rounding: 'floor' };
          expect(value(c, n + 1)).toBeGreaterThanOrEqual(value(c, n));
        },
      ),
    );
  });
});
