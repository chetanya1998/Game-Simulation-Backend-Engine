import { describe, expect, it } from 'vitest';
import type { GameModel } from '@gamex/model';
import {
  abstractEnvFor,
  abstractEval,
  mean,
  percentileSorted,
  round6,
  runSimulation,
  summarize,
} from '@gamex/engine';
import { parseExpr } from '@gamex/model';
import { minimalModel } from './helpers.ts';

type Kpi = GameModel['kpis'][number];

function withKpis(
  kpis: Omit<Kpi, 'provenance'>[],
  mutate: (m: GameModel) => void = () => undefined,
): GameModel {
  const m = minimalModel();
  const provenance = m.kpis[0]?.provenance as Kpi['provenance'];
  m.kpis.push(...kpis.map((k) => ({ ...k, provenance })));
  mutate(m);
  return m;
}

const run = (m: GameModel, days = 4) => runSimulation(m, { seed: 5, days, playersPerPersona: 30 });

describe('every KPI metric', () => {
  const m = withKpis(
    [
      { id: 'speed', metric: 'progression-speed', params: { variable: 'var:tier' } },
      { id: 'reach', metric: 'reach-rate', params: { variable: 'var:tier', value: 1, day: 2 } },
      { id: 'inflation', metric: 'inflation-rate', params: { resource: 'res:coins' } },
      { id: 'faucet-sink', metric: 'faucet-sink-ratio', params: { resource: 'res:coins' } },
      { id: 'walls', metric: 'progression-walls', params: { minAttempts: 5, maxWinRate: 0.9 } },
      { id: 'churn', metric: 'churn-risk' },
      { id: 'ads-all', metric: 'ad-impressions-per-dau' },
      { id: 'opt-in', metric: 'rewarded-opt-in-rate' },
      {
        id: 'opt-in-revive',
        metric: 'rewarded-opt-in-rate',
        params: { placement: 'placement:revive-ad' },
      },
      { id: 'iap', metric: 'iap-conversion' },
      { id: 'arppu', metric: 'arppu' },
      { id: 'arppu-priced', metric: 'arppu', params: { price: 'const:reward' } },
      { id: 'arpdau', metric: 'arpdau' },
      { id: 'arpdau-priced', metric: 'arpdau', params: { price: 'const:reward' } },
      { id: 'avg-tier', metric: 'custom', expr: 'tier * 2' },
      { id: 'speed-no-var', metric: 'progression-speed' },
      { id: 'balance-no-res', metric: 'currency-balance' },
      { id: 'custom-no-expr', metric: 'custom' },
    ],
    (model) => {
      // A store action so purchases happen.
      const p = model.entities[0]?.provenance as Kpi['provenance'];
      model.actions.push({
        id: 'buy',
        actor: 'store',
        preconditions: [],
        costs: [],
        effects: [{ op: 'add', target: 'res:coins', value: '50' }],
        errorCode: 'NO',
        provenance: p,
      });
      model.stateMachine.transitions.push({
        id: 'shop-buy',
        from: 'state:menu',
        to: 'state:menu',
        trigger: 'action:buy',
        provenance: p,
      });
      const persona = model.personas[0];
      if (persona) persona.purchaseProbabilityPerSession = 0.3;
    },
  );
  const r = run(m);
  const k = (id: string) => r.kpis.find((x) => x.id === id);

  it('computes values', () => {
    expect(k('speed')?.value).toBeGreaterThan(0);
    expect(k('reach')?.detail).toEqual({ target: 1, day: 2 });
    expect(typeof k('inflation')?.value).toBe('number');
    expect(k('faucet-sink')?.value).toBeGreaterThan(0);
    expect(k('churn')?.value).toBeGreaterThanOrEqual(0);
    expect(k('ads-all')?.value).toBeGreaterThan(0);
    expect(k('opt-in')?.value).toBeGreaterThan(0);
    expect(k('opt-in-revive')?.value).toBe(k('opt-in')?.value);
    expect(k('iap')?.value).toBeGreaterThan(0);
    expect(k('arppu-priced')?.value).toBeGreaterThan(0);
    expect(k('arpdau-priced')?.value).toBeGreaterThan(0);
    expect(k('avg-tier')?.value).toBeGreaterThanOrEqual(0);
  });

  it('finds the progression wall', () => {
    expect(k('walls')?.value).toBeNull(); // the minimal model has no level variable, so attempts are not by level
    expect((k('walls')?.detail as { attempts: unknown[] }).attempts.length).toBeGreaterThan(0);
  });

  it('explains what it cannot compute', () => {
    expect(k('arppu')).toMatchObject({
      value: null,
      note: expect.stringContaining('params.price') as unknown,
    });
    expect(k('arpdau')).toMatchObject({
      value: null,
      note: expect.stringContaining('revenue assumptions or params.price') as unknown,
    });
    expect(k('speed-no-var')?.note).toBe('needs params.variable');
    expect(k('balance-no-res')?.note).toBe('needs params.resource');
    expect(k('custom-no-expr')?.note).toBe('needs expr');
  });

  it('needs two days for inflation', () => {
    expect(run(m, 1).kpis.find((x) => x.id === 'inflation')?.note).toBe('needs at least 2 days');
  });
});

describe('progression walls by level', () => {
  it('reports the level where players keep losing', () => {
    const m = withKpis(
      [
        {
          id: 'walls',
          metric: 'progression-walls',
          params: { attemptVariable: 'var:tier', minAttempts: 10, maxWinRate: 0.25 },
        },
      ],
      (model) => {
        const win = model.constants.find((c) => c.id === 'win-chance');
        if (win) win.value = 0.1;
      },
    );
    const r = run(m);
    const walls = r.kpis.find((x) => x.id === 'walls');
    expect(walls?.value).toBe(0);
    expect((walls?.detail as { walls: { level: string }[] }).walls[0]?.level).toBe('0');
    expect(r.personas[0]?.attempts[0]).toMatchObject({ action: 'play', level: '0' });
  });
});

describe('findings', () => {
  it('flags a resource that only grows, and resources hitting their cap', () => {
    const m = minimalModel();
    const reward = m.constants.find((c) => c.id === 'reward');
    if (reward) reward.value = 100;
    const r = runSimulation(m, {
      seed: 1,
      days: 6,
      playersPerPersona: 10,
      metaVisitProbability: 0,
    });
    expect(r.findings.map((f) => f.kind)).toEqual(expect.arrayContaining(['cap-hit']));
    const m2 = minimalModel();
    const coins = m2.resources[0];
    if (coins) delete coins.cap;
    const up = m2.actions.find((a) => a.id === 'upgrade');
    if (up) up.preconditions = ['tier < 0 && tier > 0'];
    const r2 = runSimulation(m2, {
      seed: 1,
      days: 6,
      playersPerPersona: 10,
      churn: { base: 0, perFailure: 0, stall: 0 },
    });
    expect(r2.findings.find((f) => f.kind === 'unbounded-growth')?.ref).toBe('res:coins');
  });

  it('reports sessions that end in a screen with no way forward', () => {
    const m = minimalModel();
    const p = m.entities[0]?.provenance as Kpi['provenance'];
    m.stateMachine.states.push({ id: 'pit', kind: 'menu', provenance: p });
    m.stateMachine.transitions.push({
      id: 'to-pit',
      from: 'state:menu',
      to: 'state:pit',
      trigger: 'ui',
      provenance: p,
    });
    const r = runSimulation(m, { seed: 1, days: 2, playersPerPersona: 10 });
    expect(r.findings.find((f) => f.kind === 'stuck-sessions')?.severity).toBe('warning');
  });
});

describe('stats', () => {
  it('summarizes with nearest-rank percentiles', () => {
    expect(summarize([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({
      mean: 5.5,
      p10: 1,
      p50: 5,
      p90: 9,
      min: 1,
      max: 10,
    });
    expect(summarize([])).toEqual({ mean: 0, p10: 0, p50: 0, p90: 0, min: 0, max: 0 });
    expect(percentileSorted([], 50)).toBe(0);
    expect(percentileSorted([1, 2], 0)).toBe(1);
    expect(mean([])).toBe(0);
    expect(round6(1 / 3)).toBe(0.333333);
  });
});

describe('interval analysis edge cases', () => {
  const env = abstractEnvFor(minimalModel());
  const ev = (src: string) => {
    const p = parseExpr(src);
    if (!p.ok) throw new Error(p.error.message);
    return abstractEval(p.value, env);
  };
  it('handles every operator', () => {
    expect(ev('tier % 3')).toMatchObject({ kind: 'num', lo: Number.NEGATIVE_INFINITY });
    expect(ev('curve(cost, 1)')).toMatchObject({ kind: 'num', lo: Number.NEGATIVE_INFINITY });
    expect(ev('abs(-tier)')).toEqual({ kind: 'num', lo: 0, hi: 10 });
    expect(ev('abs(tier - 5)')).toEqual({ kind: 'num', lo: 0, hi: 5 });
    expect(ev('true != false')).toEqual({ kind: 'bool', canBeTrue: true, canBeFalse: false });
    expect(ev('state != prevState')).toEqual({ kind: 'bool', canBeTrue: true, canBeFalse: true });
    expect(ev('result != "none"')).toEqual({ kind: 'bool', canBeTrue: true, canBeFalse: true });
    expect(ev('"a" == "a"')).toEqual({ kind: 'bool', canBeTrue: true, canBeFalse: false });
    expect(ev('tier == 11')).toEqual({ kind: 'bool', canBeTrue: false, canBeFalse: true });
    expect(ev('5 == 5')).toEqual({ kind: 'bool', canBeTrue: true, canBeFalse: false });
    expect(ev('(true ? tier : 100) > 50')).toEqual({
      kind: 'bool',
      canBeTrue: false,
      canBeFalse: true,
    });
    expect(ev('(false ? tier : 100) > 50')).toEqual({
      kind: 'bool',
      canBeTrue: true,
      canBeFalse: false,
    });
    expect(ev('tier > 3 ? "x" : "y"')).toEqual({ kind: 'str', values: new Set(['x', 'y']) });
    expect(ev('tier > 3 ? true : false')).toEqual({
      kind: 'bool',
      canBeTrue: true,
      canBeFalse: true,
    });
    expect(ev('tier / 2')).toEqual({ kind: 'num', lo: 0, hi: 5 });
    expect(ev('unknownName + 1').kind).toBe('num');
  });
});
