import { describe, expect, it } from 'vitest';
import {
  Rng,
  applyAction,
  availableOptions,
  compileModel,
  createWorld,
  perform,
  resolveCombat,
  runSimulation,
  type CombatSpec,
  type StepOption,
} from '@gamex/engine';
import { minimalModel, swarmRescue } from './helpers.ts';

const spec: CombatSpec = {
  heroHp: 100,
  heroDamage: 10,
  fireRate: 4,
  accuracy: 0.6,
  dodge: 0.3,
  damageMultiplier: 1,
  waves: 3,
  enemiesPerWave: 4,
  enemyHp: 20,
  enemyDamage: 2,
  boss: { phases: 3, hp: 600, damage: 5 },
  maxSecondsPerStage: 120,
};

const winRate = (s: CombatSpec, trials = 400): number => {
  let wins = 0;
  for (let i = 0; i < trials; i++) if (resolveCombat(s, new Rng(i)).won) wins++;
  return wins / trials;
};

describe('resolveCombat', () => {
  it('is deterministic for a seed', () => {
    expect(resolveCombat(spec, new Rng(1))).toEqual(resolveCombat(spec, new Rng(1)));
  });

  it('reports where the player died and where a revive continues', () => {
    const hard = { ...spec, boss: { phases: 3, hp: 3000, damage: 9 } };
    const r = resolveCombat(hard, new Rng(2));
    expect(r.won).toBe(false);
    expect(r.diedAt).toMatch(/^boss-phase-[123]$/);
    expect(r.resumeAt).toMatchObject({ wave: 3 });
    expect(r.stars).toBe(0);
    const resumed = resolveCombat(hard, new Rng(3), r.resumeAt);
    expect(resumed.wavesCleared).toBe(3);
  });

  it('dies in a wave against overwhelming enemies', () => {
    const r = resolveCombat({ ...spec, enemyDamage: 50, dodge: 0 }, new Rng(1));
    expect(r).toMatchObject({ won: false, diedAt: 'wave-1', resumeAt: { wave: 0, phase: 0 } });
  });

  it('times out when the hero cannot do damage', () => {
    const r = resolveCombat(
      { ...spec, heroDamage: 0, enemyDamage: 0, maxSecondsPerStage: 10 },
      new Rng(1),
    );
    expect(r).toMatchObject({ won: false, timedOut: true, seconds: 10, diedAt: 'wave-1' });
  });

  it('wins easy fights with stars by remaining health', () => {
    const r = resolveCombat({ ...spec, enemyDamage: 0, boss: undefined }, new Rng(1));
    expect(r).toMatchObject({
      won: true,
      stars: 3,
      diedAt: null,
      bossPhasesCleared: 0,
      wavesCleared: 3,
    });
    expect(r.seconds).toBeGreaterThan(0);
    const scraped = resolveCombat({ ...spec, heroHp: 30, waves: 1, boss: undefined }, new Rng(4));
    expect([0, 1, 2, 3]).toContain(scraped.stars);
  });

  it('raising hero damage never lowers the win rate (common random numbers)', () => {
    const rates = [6, 8, 10, 14, 20].map((d) => winRate({ ...spec, heroDamage: d }));
    for (let i = 1; i < rates.length; i++)
      expect(rates[i]).toBeGreaterThanOrEqual((rates[i - 1] ?? 0) - 0.02);
    expect(rates.at(-1)).toBeGreaterThan(rates[0] ?? 1);
  });

  it('raising boss damage never raises the win rate', () => {
    const rates = [2, 4, 6, 8].map((d) =>
      winRate({ ...spec, boss: { phases: 3, hp: 600, damage: d } }),
    );
    for (let i = 1; i < rates.length; i++)
      expect(rates[i]).toBeLessThanOrEqual((rates[i - 1] ?? 1) + 0.02);
  });
});

describe('combat in the engine', () => {
  const c = compileModel(swarmRescue());
  const boss = (values: Record<string, number | boolean | string> = {}) => ({
    ...createWorld(c, { state: 's09-boss-fight', values: { missionLevel: 5, ...values } }),
    inMission: true,
  });

  it('resolves the Swarm Rescue boss fight by combat and reports it', () => {
    const r = applyAction(c, boss(), 'fight-boss', { rng: new Rng(7) });
    const combat = r.events.find((e) => e.type === 'combat');
    expect(combat).toMatchObject({ actionId: 'fight-boss' });
    expect(r.outcome).toBe(combat?.type === 'combat' && combat.won ? 'win' : 'lose');
    expect(r.next.now).toBe(combat?.type === 'combat' ? combat.seconds : -1);
  });

  it('still honours a forced outcome (golden tests do not depend on combat sampling)', () => {
    const r = applyAction(c, boss(), 'fight-boss', { outcome: 'win' });
    expect(r.outcome).toBe('win');
    expect(r.events.some((e) => e.type === 'combat')).toBe(false);
  });

  it('a revive continues the boss fight from the phase where the player died', () => {
    let lost;
    for (let seed = 0; seed < 200 && lost === undefined; seed++) {
      const r = applyAction(c, boss({ damageTier: 0 }), 'fight-boss', { rng: new Rng(seed) });
      if (r.outcome === 'lose') lost = r;
    }
    expect(lost?.next.combatResume?.['fight-boss']).toMatchObject({ wave: 0 });
    const phase = lost?.next.combatResume?.['fight-boss']?.phase ?? -1;
    expect(phase).toBeGreaterThanOrEqual(0);
    // Starting a new mission forgets the resume point.
    const w = {
      ...createWorld(c, { state: 's06-briefing' }),
      combatResume: { 'fight-boss': { wave: 0, phase: 2 } },
    };
    const start = availableOptions(c, w).find(
      (o) => o.kind === 'ui' && o.transition.beginsMission,
    ) as StepOption;
    expect(perform(c, w, start).next.combatResume).toEqual({});
  });

  it('records where combat missions are lost', () => {
    const r = runSimulation(swarmRescue(), { seed: 11, days: 7, playersPerPersona: 40 });
    const deaths = r.personas.flatMap((p) => Object.keys(p.deaths));
    expect(deaths.every((d) => /^fight-boss@boss-phase-[123]$/.test(d))).toBe(true);
    expect(deaths.length).toBeGreaterThan(0);
  });

  it('a combat block on an action that is never taken changes nothing (Level 1 stays the default)', () => {
    const plain = runSimulation(minimalModel(), { seed: 3, days: 3, playersPerPersona: 10 });
    const m = minimalModel();
    const p = m.entities[0]?.provenance as never;
    m.actions.push({
      id: 'unused-fight',
      actor: 'system',
      preconditions: ['false'],
      costs: [],
      effects: [],
      outcomes: [
        { id: 'win', weight: '1', effects: [] },
        { id: 'lose', weight: '1', effects: [] },
      ],
      combat: {
        outcomes: { win: 'win', lose: 'lose' },
        heroHp: '1',
        heroDamage: '1',
        fireRate: '1',
        accuracy: '1',
        dodge: '0',
        waves: '1',
        enemiesPerWave: '1',
        enemyHp: '1',
        enemyDamage: '1',
      },
      errorCode: 'NEVER',
      provenance: p,
    });
    const withCombat = runSimulation(m, { seed: 3, days: 3, playersPerPersona: 10 });
    expect(withCombat.personas).toEqual(plain.personas);
    expect(withCombat.kpis).toEqual(plain.kpis);
  });

  it('detects a planted boss wall for non-paying players', () => {
    const r = runSimulation(swarmRescue(), {
      seed: 5,
      days: 7,
      playersPerPersona: 40,
      params: { bossTotalHp: 5000 },
    });
    const walls = r.kpis.find((k) => k.id === 'progression-walls');
    expect(walls?.value).toBe(5);
    expect((walls?.detail as { walls: { action: string; level: string }[] }).walls).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'fight-boss', level: '5' })]),
    );
    const casual = r.personas.find((p) => p.id === 'casual-non-payer');
    expect(casual?.attempts.find((a) => a.action === 'fight-boss')?.failureRate).toBeGreaterThan(
      0.75,
    );
  });

  it('the shipped boss fight is hard but not a wall', () => {
    const r = runSimulation(swarmRescue(), { seed: 5, days: 7, playersPerPersona: 40 });
    expect(r.kpis.find((k) => k.id === 'progression-walls')?.value).toBeNull();
  });
});
