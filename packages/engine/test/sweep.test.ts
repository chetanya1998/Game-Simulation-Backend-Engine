import { describe, expect, it } from 'vitest';
import { gridSweep, latinHypercubeSweep, sensitivity, snap } from '@gamex/engine';
import { minimalModel } from './helpers.ts';

const base = { seed: 3, days: 3, playersPerPersona: 15 };

describe('gridSweep', () => {
  it('runs every combination with common random numbers', () => {
    const r = gridSweep(minimalModel(), { reward: [5, 10, 20] }, base);
    expect(r.rows.map((x) => x.params)).toEqual([{ reward: 5 }, { reward: 10 }, { reward: 20 }]);
    const balances = r.rows.map((x) => x.kpis['coinsBalance'] ?? 0);
    expect(balances[0]).toBeLessThan(balances[1] ?? 0);
    expect(balances[1]).toBeLessThan(balances[2] ?? 0);
    expect(gridSweep(minimalModel(), { reward: [10] }, base).rows[0]?.outputHash).toBe(
      r.rows[1]?.outputHash,
    );
  });

  it('builds the cartesian product', () => {
    expect(
      gridSweep(
        minimalModel(),
        { reward: [5, 10], heroHp: [50, 100] },
        { ...base, playersPerPersona: 2 },
      ).rows,
    ).toHaveLength(4);
    expect(() => gridSweep(minimalModel(), { reward: [] }, base)).toThrow(/no values/);
  });
});

describe('latinHypercubeSweep', () => {
  it('uses each stratum of each range exactly once, snapped to the step', () => {
    const r = latinHypercubeSweep(minimalModel(), ['reward'], 4, { ...base, playersPerPersona: 3 });
    const values = r.rows.map((x) => x.params['reward'] ?? -1).sort((a, b) => a - b);
    values.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(25 * i);
      expect(v).toBeLessThanOrEqual(25 * (i + 1));
      expect(v % 5).toBe(0);
    });
    expect(
      JSON.stringify(
        latinHypercubeSweep(minimalModel(), ['reward'], 4, { ...base, playersPerPersona: 3 }),
      ),
    ).toBe(JSON.stringify(r));
  });

  it('rejects constants without a range and bad sample counts', () => {
    expect(() => latinHypercubeSweep(minimalModel(), ['maxRevives'], 3, base)).toThrow(
      /needs min and max/,
    );
    expect(() => latinHypercubeSweep(minimalModel(), ['cost'], 3, base)).toThrow(
      /not a scalar constant/,
    );
    expect(() => latinHypercubeSweep(minimalModel(), ['reward'], 0, base)).toThrow(
      /positive integer/,
    );
  });

  it('snap() clamps and rounds to the step', () => {
    expect(snap(13, { min: 0, max: 100, step: 5 })).toBe(15);
    expect(snap(-3, { min: 0, max: 100, step: 5 })).toBe(0);
    expect(snap(0.123456789, { min: 0, max: 1, step: undefined })).toBe(0.123457);
  });
});

describe('sensitivity', () => {
  it('ranks the constants that move a KPI most (tornado data)', () => {
    const r = sensitivity(minimalModel(), base);
    const coins = r.tornado['coinsBalance'] ?? [];
    expect(coins[0]).toMatchObject({ constant: 'reward', low: 0, high: 100 });
    expect(coins[0]?.delta).toBeGreaterThan(0);
    expect(coins.find((e) => e.constant === 'heroHp')?.delta).toBe(0);
    expect(r.baseline['coinsBalance']).toBeGreaterThan(0);
  });

  it('can be limited to chosen constants', () => {
    const r = sensitivity(minimalModel(), { ...base, constants: ['reward'] });
    expect(r.tornado['coinsBalance']?.map((e) => e.constant)).toEqual(['reward']);
    expect(() => sensitivity(minimalModel(), { ...base, constants: ['nope'] })).toThrow(
      /not a scalar constant/,
    );
  });
});
