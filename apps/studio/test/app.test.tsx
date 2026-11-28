import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { runSimulation, simulatePlayers } from '@gamex/engine';
import { itemHash as extractItemHash } from '@gamex/extract';
import { validateGameModel, type GameModel } from '@gamex/model';
import { describe, expect, it } from 'vitest';
import { App, VIEWS } from '../src/App.tsx';
import { planChunks, runChunked } from '../src/engine/chunked.ts';
import { decide, decisionOf, EMPTY_LEDGER, itemHash, itemsOf } from '../src/lib/ledger.ts';
import { applyParams, cleanParams, sliders } from '../src/lib/variants.ts';
import { nextPreference, resolveTheme } from '../src/theme.ts';

const SWARM = validateGameModel(
  readFileSync(
    new URL('../../../fixtures/swarm-rescue/swarm-rescue.game-model.json', import.meta.url),
    'utf8',
  ),
).model as GameModel;

describe('theme', () => {
  it('follows the system setting by default and honours explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });
});

describe('App', () => {
  it('renders the shell with the ten views, in static mode until a server token is present', () => {
    const html = renderToString(<App systemPrefersDark boot={false} />);
    expect(html).toContain('GameX Engine Studio');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('static · offline');
    expect(VIEWS.map((v) => v.label)).toEqual([
      'Sources',
      'Review',
      'Entity map',
      'Economy',
      'State machine',
      'Parameters',
      'Scenario',
      'Outcomes',
      'Compare A/B',
      'Spec Pack',
    ]);
  });
});

describe('chunked simulation (the worker pool)', () => {
  it('splits players into contiguous ranges', () => {
    expect(planChunks(10, 3)).toEqual([
      { from: 0, to: 3 },
      { from: 3, to: 6 },
      { from: 6, to: 10 },
    ]);
    expect(planChunks(2, 8)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ]);
  });

  it.each([1, 3, 7])('gives the same output hash as the CLI with %i chunks', async (parts) => {
    const options = {
      seed: 7,
      days: 3,
      playersPerPersona: 12,
      params: { interstitialMinGapSeconds: 240 },
    };
    const direct = runSimulation(SWARM, options);
    const progress: number[] = [];
    const chunked = await runChunked(
      SWARM,
      options,
      parts,
      (o) => Promise.resolve(simulatePlayers(SWARM, o)),
      (d) => progress.push(d),
    );
    expect(chunked.record.outputHash).toBe(direct.record.outputHash);
    expect(progress.at(-1)).toBe(Math.min(parts, 12));
  });
});

describe('review ledger in the browser', () => {
  it('hashes items exactly like @gamex/extract', () => {
    for (const item of itemsOf(SWARM).slice(0, 40))
      expect(itemHash(item.node)).toBe(extractItemHash(item.node));
  });

  it('applies defaults and re-asks about changed items', () => {
    const items = itemsOf(SWARM);
    const revive = items.find((i) => i.ref === 'placement:rewarded-revive');
    if (revive === undefined) throw new Error('missing');
    expect(items).toHaveLength(
      SWARM.entities.length +
        SWARM.resources.length +
        SWARM.constants.length +
        SWARM.variables.length +
        SWARM.actions.length +
        SWARM.rules.length +
        SWARM.stateMachine.states.length +
        SWARM.stateMachine.transitions.length +
        SWARM.flows.length +
        SWARM.monetization.placements.length +
        SWARM.personas.length +
        SWARM.kpis.length +
        SWARM.invariants.length +
        SWARM.gaps.length,
    );
    expect(decisionOf(EMPTY_LEDGER, revive)).toBe('pending');
    expect(decisionOf({ ...EMPTY_LEDGER, default: 'approve' }, revive)).toBe('approve');
    const ledger = decide(EMPTY_LEDGER, revive, 'reject');
    expect(decisionOf(ledger, revive)).toBe('reject');
    expect(decisionOf(ledger, { ...revive, node: { ...revive.node, name: 'Changed name' } })).toBe(
      'pending',
    );
  });
});

describe('variants', () => {
  it('builds sliders from constants and applies overrides', () => {
    const s = sliders(SWARM).find((x) => x.key === 'interstitialMinGapSeconds');
    expect(s).toMatchObject({ value: 180, group: expect.any(String) as unknown });
    expect(
      cleanParams(SWARM, { interstitialMinGapSeconds: 180, laserDamage: 12, nope: 3 }),
    ).toEqual({ laserDamage: 12 });
    const m = applyParams(SWARM, { laserDamage: 12 });
    expect(m.constants.find((c) => c.id === 'laser-damage')).toMatchObject({
      value: 12,
      provenance: { status: 'edited' },
    });
    expect(SWARM.constants.find((c) => c.id === 'laser-damage')?.value).toBe(10);
    expect(validateGameModel(m).ok).toBe(true);
  });
});
