import { describe, expect, it } from 'vitest';
import {
  EngineModelError,
  EngineRuntimeError,
  Rng,
  applyAction,
  availableOptions,
  checkAction,
  compileModel,
  createWorld,
  perform,
  placementEligibility,
  settle,
  type StepOption,
  type WorldState,
} from '@gamex/engine';
import { minimalModel, swarmRescue } from './helpers.ts';

const c = compileModel(minimalModel());
const world = (
  values: Record<string, number | string | boolean> = {},
  state = 'menu',
): WorldState => createWorld(c, { state, values });

function option(w: WorldState, id: string): StepOption {
  const o = availableOptions(c, w).find((x) =>
    x.kind === 'action' ? x.actionId === id : x.transition.id === id,
  );
  if (o === undefined)
    throw new Error(
      `option ${id} not available in ${w.state}: ${availableOptions(c, w)
        .map((x) => (x.kind === 'action' ? x.actionId : x.transition.id))
        .join(', ')}`,
    );
  return o;
}

describe('compileModel', () => {
  it('refuses invalid models with their validation issues', () => {
    const m = minimalModel();
    m.stateMachine.initial = 'state:nowhere';
    expect(() => compileModel(m)).toThrow(EngineModelError);
    expect(() => compileModel(m)).toThrow(/UNKNOWN_REFERENCE/);
  });

  it('applies parameter overrides and rejects unknown ones', () => {
    expect(compileModel(minimalModel(), { params: { reward: 25 } }).constants.get('reward')).toBe(
      25,
    );
    expect(() => compileModel(minimalModel(), { params: { rewrd: 1 } })).toThrow(
      /Unknown parameter "rewrd"/,
    );
    expect(() => compileModel(minimalModel(), { params: { reward: Number.NaN } })).toThrow(
      /finite/,
    );
  });
});

describe('checkAction / applyAction', () => {
  it('returns the action error code when a precondition fails', () => {
    expect(checkAction(c, world({ result: 'victory' }), 'revive')).toMatchObject({
      ok: false,
      code: 'REVIVE_NOT_AVAILABLE',
    });
  });

  it('enforces limits through the generated rule: max 1 revive per mission', () => {
    const w = world({ result: 'defeat' });
    const first = applyAction(c, w, 'revive');
    expect(first.result).toBe('ok');
    expect(first.deltas).toEqual({ result: 'none', reviveCountMission: 1 });
    const again = applyAction(
      c,
      { ...first.next, values: { ...first.next.values, result: 'defeat' } },
      'revive',
    );
    expect(again).toMatchObject({
      result: 'rejected',
      error: { code: 'REVIVE_LIMIT_REACHED' },
      deltas: {},
    });
  });

  it('checks costs and reports INSUFFICIENT_<RESOURCE>', () => {
    expect(checkAction(c, world({ coins: 5 }), 'upgrade')).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_COINS',
    });
    const ok = applyAction(c, world({ coins: 100 }), 'upgrade');
    expect(ok.deltas).toEqual({ coins: -10, tier: 1 }); // curve(cost, 1) = 10
  });

  it('forces an outcome, or samples it reproducibly with an rng', () => {
    const w = world({}, 'game');
    expect(applyAction(c, w, 'play', { outcome: 'win' }).deltas).toEqual({
      coins: 10,
      result: 'victory',
    });
    const a = applyAction(c, w, 'play', { rng: new Rng(3) }).outcome;
    expect(applyAction(c, w, 'play', { rng: new Rng(3) }).outcome).toBe(a);
    expect(() => applyAction(c, w, 'play')).toThrow(/rng or an explicit outcome/);
    expect(() => applyAction(c, w, 'play', { outcome: 'draw' })).toThrow(/no outcome "draw"/);
  });

  it('evaluates every effect against the state before the step', () => {
    const m = minimalModel();
    m.actions[2]?.effects.push({ op: 'add', target: 'res:coins', value: 'tier * 100' });
    const cm = compileModel(m);
    // tier goes 0 → 1, but the bonus uses tier = 0 (pre-step), so coins only lose the cost.
    expect(applyAction(cm, createWorld(cm, { values: { coins: 100 } }), 'upgrade').deltas).toEqual({
      coins: -10,
      tier: 1,
    });
    expect(
      applyAction(cm, createWorld(cm, { values: { coins: 100, tier: 1 } }), 'upgrade').deltas,
    ).toEqual({ coins: 100 - 15, tier: 1 });
  });

  it('caps resources and records range violations', () => {
    const m = minimalModel();
    m.actions[2]?.effects.push(
      { op: 'add', target: 'res:coins', value: '5000' },
      { op: 'add', target: 'var:tier', value: '20' },
    );
    const cm = compileModel(m);
    const r = applyAction(cm, createWorld(cm, { values: { coins: 100 } }), 'upgrade');
    expect(r.next.values['coins']).toBe(1000);
    expect(r.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['cap-hit', 'range-violation']),
    );
  });

  it('raises located runtime errors for broken formulas', () => {
    const m = minimalModel();
    m.actions[2]?.effects.push({ op: 'add', target: 'var:tier', value: '1 / (tier - tier)' });
    const cm = compileModel(m);
    expect(() => applyAction(cm, createWorld(cm, { values: { coins: 100 } }), 'upgrade')).toThrow(
      EngineRuntimeError,
    );
    expect(() => applyAction(cm, createWorld(cm, { values: { coins: 100 } }), 'upgrade')).toThrow(
      /action:upgrade: Division by zero/,
    );
    const m2 = minimalModel();
    m2.actions[2]?.effects.push({ op: 'add', target: 'var:tier', value: '0.5' });
    const cm2 = compileModel(m2);
    expect(() => applyAction(cm2, createWorld(cm2, { values: { coins: 100 } }), 'upgrade')).toThrow(
      /whole number/,
    );
  });

  it('rejects unknown actions, states and keys', () => {
    expect(() => checkAction(c, world(), 'fly')).toThrow(/Unknown action/);
    expect(() => createWorld(c, { state: 'space' })).toThrow(/Unknown state/);
    expect(() => createWorld(c, { values: { gold: 1 } })).toThrow(
      /Unknown variable or resource key "gold"/,
    );
  });
});

describe('transitions and placements', () => {
  it('lists ui, auto and runnable action options', () => {
    const labels = availableOptions(c, world({ coins: 100 })).map((o) =>
      o.kind === 'action' ? `action:${o.actionId}` : `${o.kind}:${o.transition.id}`,
    );
    expect(labels).toEqual(['ui:start', 'action:upgrade']);
  });

  it('begins a mission by resetting mission-scoped variables', () => {
    const w = world({ result: 'defeat', reviveCountMission: 1 });
    const r = perform(c, w, option(w, 'start'));
    expect(r.next).toMatchObject({ state: 'game', prevState: 'menu', inMission: true });
    expect(r.next.values['result']).toBe('none');
    expect(r.next.values['reviveCountMission']).toBe(0);
    expect(r.events.map((e) => e.type)).toEqual(['mission-begin', 'transition']);
  });

  it('follows the transition of the sampled outcome', () => {
    const w = { ...world({}, 'game'), inMission: true };
    const r = perform(c, w, option(w, 'play'), { outcome: 'lose' });
    expect(r.transition?.id).toBe('lose');
    expect(r.next.state).toBe('defeat');
  });

  it('shows a state placement only when eligible, and its cap/cooldown then apply', () => {
    const victory = { ...world({ result: 'victory' }, 'victory'), now: 1000, inMission: true };
    const toAd = perform(c, victory, option(victory, 'continue-ad'));
    expect(toAd.next.state).toBe('ad');
    expect(toAd.events.flatMap((e) => (e.type === 'impression' ? [e.placementId] : []))).toEqual([
      'interstitial',
    ]);
    expect(toAd.next.values['interstitialLastAt']).toBe(1000);
    // Back at victory 60 s later: the 180 s cooldown makes it ineligible, so the plain transition is offered.
    const later = {
      ...toAd.next,
      state: 'victory',
      now: 1060,
      values: { ...toAd.next.values, interstitialCountMission: 0 },
    };
    expect(placementEligibility(c, later, c.placements.get('interstitial') as never).eligible).toBe(
      false,
    );
    expect(availableOptions(c, later).map((o) => o.kind !== 'action' && o.transition.id)).toEqual([
      'continue',
    ]);
  });

  it('flags trace-invariant violations at the moment they happen', () => {
    const m = minimalModel();
    const gap = m.invariants[0];
    if (gap) gap.expr = 'now - interstitialLastAt >= 1000000';
    const cm = compileModel(m);
    const w = {
      ...createWorld(cm, {
        state: 'victory',
        values: { result: 'victory', interstitialLastAt: 0 },
      }),
      now: 500,
    };
    const o = availableOptions(cm, w).find(
      (x) => x.kind === 'ui' && x.transition.id === 'continue-ad',
    ) as StepOption;
    const r = perform(cm, w, o);
    expect(r.violations).toEqual([
      { invariantId: 'gap', blocking: true, now: 500, state: 'ad', at: 'placement:interstitial' },
    ]);
  });

  it('settles automatic transitions and detects auto loops', () => {
    const w = { ...world({}, 'ad') };
    expect(settle(c, w).next.state).toBe('menu');
    const m = minimalModel();
    m.stateMachine.transitions.push({
      id: 'back',
      from: 'state:menu',
      to: 'state:ad',
      trigger: 'auto',
      provenance: m.stateMachine.transitions[0]?.provenance as never,
    });
    const cm = compileModel(m);
    expect(() => settle(cm, createWorld(cm, { state: 'ad' }))).toThrow(/auto loop/);
  });
});

describe('Swarm Rescue rules', () => {
  const s = compileModel(swarmRescue());
  const at = (
    state: string,
    values: Record<string, number | string | boolean>,
    now = 10000,
  ): WorldState => ({ ...createWorld(s, { state, values }), now, inMission: true });

  it('Victory → Continue goes to the interstitial only from level 3, once per mission and 180 s apart', () => {
    const victory = (level: number, extra: Record<string, number> = {}, now = 10000) =>
      at('s11-victory', { lastMissionResult: 'victory', missionLevel: level, ...extra }, now);
    const target = (w: WorldState) =>
      perform(
        s,
        w,
        availableOptions(s, w).find(
          (o) => o.kind === 'action' && o.actionId === 'victory-continue',
        ) as StepOption,
      ).next.state;
    expect(target(victory(2))).toBe('s05-campaign-map');
    expect(target(victory(3))).toBe('s13-interstitial');
    expect(target(victory(3, { interstitialAfterVictoryCountMission: 1 }))).toBe(
      's05-campaign-map',
    );
    expect(target(victory(3, { interstitialAfterVictoryLastAt: 9900 }))).toBe('s05-campaign-map');
    expect(target(victory(3, { interstitialAfterVictoryLastAt: 10000 - 180 }))).toBe(
      's13-interstitial',
    );
    expect(
      target(
        at('s11-victory', {
          lastMissionResult: 'victory',
          missionLevel: 5,
          removeAdsPurchased: true,
        }),
      ),
    ).toBe('s05-campaign-map');
  });

  it('rejects a second revive in the same mission with REVIVE_LIMIT_REACHED', () => {
    const w = at('s14-defeat', { lastMissionResult: 'defeat', reviveCountMission: 1 });
    expect(checkAction(s, w, 'revive')).toMatchObject({ ok: false, code: 'REVIVE_LIMIT_REACHED' });
  });

  it('prices upgrades from the curve, with the reroll discount', () => {
    expect(
      applyAction(s, at('s16-armory', { coins: 1000, damageTier: 2 }), 'buy-damage-upgrade').deltas,
    ).toMatchObject({ coins: -225, damageTier: 1 });
    expect(
      applyAction(
        s,
        at('s16-armory', { coins: 1000, damageTier: 2, upgradeDiscountActive: true }),
        'buy-damage-upgrade',
      ).deltas,
    ).toMatchObject({ coins: -168 });
  });

  it('pause returns to the screen the player came from', () => {
    const w = at('s09-boss-fight', { missionLevel: 5 });
    const paused = perform(
      s,
      w,
      availableOptions(s, w).find(
        (o) => o.kind === 'ui' && o.transition.id === 't-boss-pause',
      ) as StepOption,
    ).next;
    expect(paused.stack).toEqual(['s09-boss-fight']);
    const back = perform(
      s,
      paused,
      availableOptions(s, paused).find(
        (o) => o.kind === 'ui' && o.transition.id === 't-pause-resume',
      ) as StepOption,
    ).next;
    expect(back).toMatchObject({ state: 's09-boss-fight', stack: [] });
  });
});
