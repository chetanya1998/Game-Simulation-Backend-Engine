import { describe, expect, it } from 'vitest';
import {
  aggregateResults,
  compileModel,
  runSimulation,
  simulatePlayers,
  type SimulationOptions,
} from '@gamex/engine';
import { minimalModel, swarmRescue } from './helpers.ts';

const SWARM = swarmRescue();
const quick: SimulationOptions = { seed: 7, days: 5, playersPerPersona: 12 };

describe('determinism', () => {
  it('same model + same seed ⇒ identical output', () => {
    const a = runSimulation(SWARM, quick);
    const b = runSimulation(SWARM, quick);
    expect(b.record.outputHash).toBe(a.record.outputHash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('a different seed gives different output', () => {
    expect(runSimulation(SWARM, { ...quick, seed: 8 }).record.outputHash).not.toBe(
      runSimulation(SWARM, quick).record.outputHash,
    );
  });

  it('splitting players across workers does not change the result', () => {
    const c = compileModel(SWARM);
    const parts = [
      simulatePlayers(c, { ...quick, playerRange: { from: 0, to: 5 } }),
      simulatePlayers(c, { ...quick, playerRange: { from: 5, to: 9 } }),
      simulatePlayers(c, { ...quick, playerRange: { from: 9, to: 12 } }),
    ];
    const merged = aggregateResults(c, quick, [...parts[2]!, ...parts[0]!, ...parts[1]!]); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(merged.record.outputHash).toBe(runSimulation(c, quick).record.outputHash);
  });

  it('records everything needed to reproduce the run', () => {
    const r = runSimulation(SWARM, { ...quick, params: { interstitialMinGapSeconds: 240 } });
    expect(r.record).toMatchObject({
      engineVersion: '0.2.0',
      schemaVersion: '0.1.0',
      model: { name: 'Swarm Rescue', modelVersion: 1 },
      seed: 7,
      days: 5,
      playersPerPersona: 12,
      personas: ['casual-non-payer', 'engaged-ad-watcher', 'payer'],
      params: { interstitialMinGapSeconds: 240 },
    });
    expect(r.record.model.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.record.outputHash).not.toBe(runSimulation(SWARM, quick).record.outputHash);
  });
});

describe('Swarm Rescue simulation', () => {
  const r = runSimulation(SWARM, { seed: 2026, days: 7, playersPerPersona: 60 });
  const inv = (id: string) => r.invariants.find((i) => i.id === id);

  it.each([
    'interstitial-min-gap',
    'interstitial-once-per-mission',
    'interstitial-never-after-defeat',
    'interstitial-from-level-3',
    'interstitial-only-after-victory-continue',
  ])('interstitial rule %s holds in every simulated session', (id) => {
    expect(inv(id)).toMatchObject({ status: 'pass', violations: 0, severity: 'blocking' });
    expect(inv(id)?.checks).toBeGreaterThan(100);
  });

  it('the revive limit holds', () => {
    expect(inv('revive-max-once-per-mission')).toMatchObject({ status: 'pass', violations: 0 });
  });

  it('shows interstitials only in their screen and no UI ad in gameplay', () => {
    const shown = r.personas.flatMap((p) =>
      p.placements.filter((x) => x.impressions > 0).map((x) => x.id),
    );
    expect(shown).toEqual(
      expect.arrayContaining([
        'interstitial-after-victory',
        'rewarded-revive',
        'billboard-in-world',
        'mrec-victory',
      ]),
    );
  });

  it('computes the default KPIs and explains the ones it cannot', () => {
    const kpi = (id: string) => r.kpis.find((k) => k.id === id);
    expect(kpi('reach-level-5-by-day-7')?.value).toBeGreaterThan(0);
    expect(kpi('interstitials-per-dau')?.value).toBeGreaterThan(0);
    expect(kpi('rewarded-opt-in')?.value).toBeGreaterThan(0);
    expect(kpi('coins-faucet-sink')?.value).toBeGreaterThan(1);
    expect(kpi('progression-speed')?.detail).toBeDefined();
    expect(r.kpis.every((k) => k.value !== null || typeof k.note === 'string')).toBe(true);
  });

  it('evaluates the aggregate invariant on the persona it names', () => {
    expect(inv('non-payers-reach-level-5')?.message).toMatch(/reachLevel5ByDay7 = /);
  });

  it('produces daily series with percentiles and retention', () => {
    const day1 = r.personas[0]?.daily[0];
    expect(day1?.dau).toBeGreaterThan(0);
    expect(day1?.values['coins']).toMatchObject({
      mean: expect.any(Number) as unknown,
      p10: expect.any(Number) as unknown,
      p90: expect.any(Number) as unknown,
    });
    expect(r.personas[0]?.daily).toHaveLength(7);
    expect(r.personas[0]?.daily[6]?.retention).toBeLessThanOrEqual(1);
  });

  it('keeps a full trace for the first player of each persona', () => {
    expect(r.traces.map((t) => [t.persona, t.index])).toEqual([
      ['casual-non-payer', 0],
      ['engaged-ad-watcher', 0],
      ['payer', 0],
    ]);
    expect(r.traces[0]?.events.length).toBeGreaterThan(10);
  });

  it('payers buy Remove Ads by going to the Store', () => {
    const payer = r.personas.find((p) => p.id === 'payer');
    expect(payer?.placements.find((p) => p.id === 'iap-remove-ads')?.impressions).toBeGreaterThan(
      0,
    );
    expect(r.kpis.find((k) => k.id === 'remove-ads-conversion')?.value).toBeGreaterThan(0);
  });

  it('never buys Remove Ads for a persona that never purchases', () => {
    expect(
      r.personas
        .find((p) => p.id === 'casual-non-payer')
        ?.placements.find((p) => p.id === 'iap-remove-ads')?.impressions,
    ).toBe(0);
  });
});

describe('invariant evidence', () => {
  it('fails a violated invariant with the seed, player, day and trace', () => {
    const m = swarmRescue();
    const gap = m.invariants.find((i) => i.id === 'interstitial-min-gap');
    if (gap) gap.expr = 'now - interstitialAfterVictoryLastAt >= 100000000';
    const r = runSimulation(m, { seed: 1, days: 3, playersPerPersona: 10 });
    const res = r.invariants.find((i) => i.id === 'interstitial-min-gap');
    expect(res?.status).toBe('fail');
    expect(res?.evidence).toMatchObject({
      invariantId: 'interstitial-min-gap',
      state: 's13-interstitial',
      at: 'placement:interstitial-after-victory',
    });
    expect(res?.evidence?.trace.length).toBeGreaterThan(0);
  });

  it('marks never-exercised invariants as skipped', () => {
    const r = runSimulation(minimalModel(), {
      seed: 1,
      days: 1,
      playersPerPersona: 1,
      metaVisitProbability: 0,
    });
    expect(r.invariants.filter((i) => i.checks === 0).every((i) => i.status === 'skipped')).toBe(
      true,
    );
  });
});

describe('revenue KPIs', () => {
  it('are skipped without assumptions and computed with them', () => {
    const m = minimalModel();
    m.kpis.push({
      id: 'ad-revenue',
      metric: 'ad-revenue-per-dau',
      provenance: m.kpis[0]?.provenance as never,
    });
    expect(
      runSimulation(m, { seed: 1, days: 2, playersPerPersona: 5 }).kpis.find(
        (k) => k.id === 'ad-revenue',
      ),
    ).toMatchObject({ value: null, note: expect.stringContaining('assumptions') as unknown });
    m.constants.push({
      id: 'ecpm-interstitial',
      unit: 'usd',
      value: 12,
      balanceFile: 'ads',
      provenance: m.kpis[0]?.provenance as never,
    });
    m.monetization.assumptions = {
      market: 'US',
      currency: 'USD',
      ecpm: { interstitial: 'const:ecpm-interstitial' },
      fillRate: {},
    };
    const r = runSimulation(m, { seed: 1, days: 3, playersPerPersona: 20 });
    expect(r.kpis.find((k) => k.id === 'ad-revenue')?.value).toBeGreaterThan(0);
  });
});

describe('option errors', () => {
  it.each([
    [{ ...quick, days: 0 }, /days must be a positive integer/],
    [{ ...quick, playersPerPersona: 0 }, /playersPerPersona/],
    [{ ...quick, personas: ['whale'] }, /Unknown persona "whale"/],
    [{ ...quick, params: { nope: 1 } }, /Unknown parameter/],
  ])('rejects %o', (options, message) => {
    expect(() => runSimulation(SWARM, options)).toThrow(message);
  });

  it('needs at least one persona', () => {
    const m = minimalModel();
    m.personas = [];
    m.gaps = [];
    expect(() => runSimulation(m, quick)).toThrow(/no personas/);
  });
});
