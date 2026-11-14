import { describe, expect, it } from 'vitest';
import { NEVER, normalizeGameModel, planImplicit, validateGameModel } from '@gamex/model';
import { minimalModel } from './helpers/minimal-model.ts';

describe('planImplicit', () => {
  const plan = planImplicit(minimalModel());

  it('creates a counter variable and a guard rule for each limit', () => {
    expect(plan.variables.find((v) => v.id === 'revive-count-mission')).toMatchObject({
      key: 'reviveCountMission',
      scope: 'mission',
      type: 'int',
      initial: 0,
      derivedFrom: 'action:revive',
      provenance: { source: 'gamex:derived', location: '/actions/1/limits/0' },
    });
    expect(plan.rules.find((r) => r.id === 'revive-limit-mission')).toMatchObject({
      appliesTo: { actions: ['action:revive'] },
      expr: 'reviveCountMission < (maxRevives)',
      errorCode: 'REVIVE_LIMIT_REACHED',
    });
    expect(plan.actionEffects.get('revive')).toEqual([
      { op: 'add', target: 'var:revive-count-mission', value: '1' },
    ]);
  });

  it('creates caps and cooldowns for placements, with derived error codes', () => {
    expect(plan.variables.map((v) => v.id)).toEqual([
      'revive-count-mission',
      'interstitial-count-mission',
      'interstitial-last-at',
    ]);
    expect(plan.variables[2]).toMatchObject({ type: 'timestamp', scope: 'player', initial: NEVER });
    expect(plan.rules.find((r) => r.id === 'interstitial-cooldown')).toMatchObject({
      appliesTo: { placements: ['placement:interstitial'] },
      expr: 'now - interstitialLastAt >= (gapSeconds)',
      errorCode: 'INTERSTITIAL_COOLDOWN_ACTIVE',
    });
    expect(plan.rules.find((r) => r.id === 'interstitial-limit-mission')?.errorCode).toBe(
      'INTERSTITIAL_LIMIT_REACHED',
    );
    expect(plan.placementEffects.get('interstitial')).toEqual([
      { op: 'add', target: 'var:interstitial-count-mission', value: '1' },
      { op: 'set', target: 'var:interstitial-last-at', value: 'now' },
    ]);
  });

  it('shares one counter between limits of the same scope', () => {
    const m = minimalModel();
    m.actions[1]?.limits?.push({ max: '3', per: 'mission' }, { max: '5', per: 'day' });
    const p = planImplicit(m);
    expect(p.variables.filter((v) => v.derivedFrom === 'action:revive').map((v) => v.id)).toEqual([
      'revive-count-mission',
      'revive-count-day',
    ]);
    expect(p.rules.filter((r) => r.derivedFrom === 'action:revive').map((r) => r.id)).toEqual([
      'revive-limit-mission',
      'revive-limit-mission-1',
      'revive-limit-day',
    ]);
    expect(p.actionEffects.get('revive')).toHaveLength(2);
  });
});

describe('normalizeGameModel', () => {
  it('fills every key and appends derived nodes and effects', () => {
    const n = normalizeGameModel(minimalModel());
    expect(n.constants.map((c) => c.key)).toEqual([
      'heroHp',
      'reward',
      'maxRevives',
      'gapSeconds',
      'winChance',
      'cost',
    ]);
    expect(n.stateMachine.transitions[4]?.key).toBe('continueAd');
    expect(n.variables).toHaveLength(5);
    expect(n.rules.map((r) => r.id)).toEqual([
      'revive-limit-mission',
      'interstitial-limit-mission',
      'interstitial-cooldown',
    ]);
    expect(n.actions[1]?.effects).toHaveLength(2);
    expect(n.monetization.placements[1]?.onShow).toHaveLength(2);
  });

  it('produces a model that still validates', () => {
    const r = validateGameModel(normalizeGameModel(minimalModel()));
    expect(r.issues).toEqual([]);
  });

  it('is idempotent', () => {
    const once = normalizeGameModel(minimalModel());
    expect(normalizeGameModel(once)).toEqual(once);
  });

  it('does not mutate its input', () => {
    const m = minimalModel();
    const before = JSON.stringify(m);
    normalizeGameModel(m);
    expect(JSON.stringify(m)).toBe(before);
  });
});
