import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatIssue,
  normalizeGameModel,
  serializeGameModel,
  validateGameModel,
  type GameModel,
} from '@gamex/model';

const FILE = 'swarm-rescue.game-model.json';
const text = readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8');
const gdd = readFileSync(new URL('../GDD.md', import.meta.url), 'utf8').split('\n');
const result = validateGameModel(text, { source: FILE });
if (result.model === undefined)
  throw new Error(
    `${FILE} failed schema validation:\n${result.issues.map(formatIssue).join('\n')}`,
  );
const model: GameModel = result.model;

describe('Swarm Rescue Game Model', () => {
  it('validates with zero errors and zero warnings', () => {
    expect(result.issues.map(formatIssue)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is stored in canonical form', () => {
    expect(serializeGameModel(JSON.parse(text) as GameModel)).toBe(text);
  });

  it('has the 22 screen states S00 … S21, all marked assumed', () => {
    const states = model.stateMachine.states;
    expect(states.map((s) => s.code)).toEqual(
      Array.from({ length: 22 }, (_, i) => `S${String(i).padStart(2, '0')}`),
    );
    expect(states.every((s) => s.provenance.status === 'assumed')).toBe(true);
    expect(model.stateMachine.initial).toBe('state:s00-loading');
  });

  it('models every placement from the GDD', () => {
    const byFormat = (f: string) =>
      model.monetization.placements.filter((p) => p.format === f).map((p) => p.id);
    expect(byFormat('rewarded')).toEqual([
      'rewarded-claim-triple',
      'rewarded-revive',
      'rewarded-laser-trial',
      'rewarded-upgrade-reroll',
      'rewarded-daily-free-upgrade',
    ]);
    expect(byFormat('interstitial')).toEqual(['interstitial-after-victory']);
    expect(byFormat('banner')).toEqual([
      'banner-home',
      'banner-campaign-map',
      'banner-armory',
      'banner-settings',
      'billboard-in-world',
    ]);
    expect(byFormat('mrec')).toEqual(['mrec-pause', 'mrec-victory', 'mrec-defeat']);
    expect(byFormat('iap')).toEqual(['iap-remove-ads']);
  });

  it('forbids UI ads in live gameplay and on app open', () => {
    expect(model.monetization.forbiddenStates).toEqual([
      'state:s00-loading',
      'state:s01-consent',
      'state:s08-gameplay',
      'state:s09-boss-fight',
      'state:s10-kill-cam',
    ]);
    expect(
      model.monetization.placements.filter((p) => p.inWorld === true).map((p) => p.id),
    ).toEqual(['billboard-in-world']);
  });

  it('encodes every interstitial pacing rule', () => {
    const p = model.monetization.placements.find((x) => x.id === 'interstitial-after-victory');
    expect(p).toMatchObject({
      trigger: { state: 'state:s13-interstitial' },
      eligibility: ['lastMissionResult == "victory"', 'missionLevel >= interstitialMinLevel'],
      caps: [{ max: 'interstitialMaxPerMission', per: 'mission' }],
      cooldownSeconds: 'interstitialMinGapSeconds',
    });
    const value = (id: string) => model.constants.find((c) => c.id === id)?.value;
    expect([
      value('interstitial-min-level'),
      value('interstitial-max-per-mission'),
      value('interstitial-min-gap-seconds'),
    ]).toEqual([3, 1, 180]);
    expect(
      model.invariants
        .filter((i) => i.kind === 'trace' && i.at !== undefined && 'placement' in i.at)
        .map((i) => i.id),
    ).toEqual([
      'interstitial-min-gap',
      'interstitial-once-per-mission',
      'interstitial-never-after-defeat',
      'interstitial-from-level-3',
      'interstitial-only-after-victory-continue',
    ]);
  });

  it('limits revives to one per mission with REVIVE_LIMIT_REACHED', () => {
    const n = normalizeGameModel(model);
    expect(n.rules.find((r) => r.id === 'revive-limit-mission')).toMatchObject({
      expr: 'reviveCountMission < (maxRevivesPerMission)',
      errorCode: 'REVIVE_LIMIT_REACHED',
    });
  });

  it('raises the open questions from the GDD as gaps', () => {
    const ids = model.gaps.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'gap-web-build',
        'gap-age-rating-coppa',
        'gap-mediation-stack',
        'gap-iap-beyond-remove-ads',
        'gap-currency-and-upgrade-costs',
        'gap-ad-revenue-assumptions',
      ]),
    );
  });

  it('covers every assumed item with a gap', () => {
    const covered = new Set(model.gaps.flatMap((g) => g.related));
    const assumed = [
      ...model.constants.map((c) => [`const:${c.id}`, c.provenance.status]),
      ...model.personas.map((p) => [`persona:${p.id}`, p.provenance.status]),
    ]
      .filter(([, s]) => s === 'assumed')
      .map(([ref]) => ref);
    expect(assumed.length).toBeGreaterThan(20);
    expect(assumed.filter((ref) => !covered.has(ref ?? ''))).toEqual([]);
  });

  it('has provenance excerpts that really appear on the cited GDD line', () => {
    const nodes = [
      ...model.constants,
      ...model.actions,
      ...model.monetization.placements,
      ...model.stateMachine.states,
      ...model.invariants,
      ...model.gaps,
    ];
    let checked = 0;
    for (const n of nodes) {
      const p = n.provenance;
      if (p.source !== 'fixtures/swarm-rescue/GDD.md') continue;
      const line = Number(/line (\d+)/.exec(p.location)?.[1]);
      expect(gdd[line - 1]?.trim(), `${n.id} cites ${p.location}`).toBe(p.excerpt);
      checked++;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('marks undecided GDD numbers as assumed', () => {
    const status = (id: string) => model.constants.find((c) => c.id === id)?.provenance.status;
    expect(status('upgrade-cost')).toBe('assumed');
    expect(status('coins-victory-base')).toBe('assumed');
    expect(status('interstitial-min-gap-seconds')).toBe('confirmed');
    expect(status('max-revives-per-mission')).toBe('confirmed');
  });
});
