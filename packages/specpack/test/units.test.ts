import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { compileModel } from '@gamex/engine';
import {
  GoldenFileSchema,
  editable,
  editableRegions,
  generateGoldens,
  mergeEditable,
  toYaml,
  withoutEditable,
} from '@gamex/specpack';
import { minimalModel, swarmRescue } from './helpers.ts';

describe('toYaml', () => {
  it('round-trips arbitrary JSON through a YAML parser (property)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (value) => {
        const normalized = JSON.parse(JSON.stringify(value)) as unknown;
        expect(parseYaml(toYaml(normalized))).toEqual(normalized);
      }),
    );
  });

  it('writes a header comment and quotes every string', () => {
    expect(toYaml({ a: 'yes', b: [1, { c: null }], d: {} }, 'hi')).toBe(
      '# hi\na: "yes"\nb:\n  - 1\n  - c: null\nd: {}\n',
    );
    expect(() => toYaml({ x: Number.NaN })).toThrow(/non-finite/);
  });
});

describe('editable regions', () => {
  const generated = `head\n${editable('notes', 'default')}\ntail\n${editable('more', 'x')}\n`;
  it('keeps the user text of each region by name', () => {
    const existing = generated.replace('default', 'my notes\nline 2');
    const merged = mergeEditable(generated.replace('head', 'new head'), existing);
    expect(merged).toContain('new head');
    expect(merged).toContain('my notes\nline 2');
    expect(editableRegions(merged).get('more')).toBe('x');
  });
  it('fingerprints only the managed text', () => {
    expect(withoutEditable(generated.replace('default', 'anything'))).toBe(
      withoutEditable(generated),
    );
  });
});

describe('generateGoldens', () => {
  const swarm = generateGoldens(compileModel(swarmRescue()));
  const all = swarm.flatMap((f) => f.cases);

  it('produces schema-valid files with unique case ids', () => {
    for (const f of swarm) expect(GoldenFileSchema.safeParse(f).success).toBe(true);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('pins every interstitial pacing rule', () => {
    const cases =
      swarm.find((f) => f.subject === 'placement:interstitial-after-victory')?.cases ?? [];
    const reasons = cases.map((c) =>
      'eligible' in c.then ? `${String(c.then.eligible)}:${c.then.reason ?? ''}` : '',
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        'true:',
        'false:eligibility: lastMissionResult == "victory"',
        'false:eligibility: missionLevel >= interstitialMinLevel',
        'false:rule:interstitial-after-victory-limit-mission',
        'false:rule:interstitial-after-victory-cooldown',
        'false:rule:remove-ads-blocks-ads',
        'false:forbidden-state',
      ]),
    );
    const cooldown = cases.filter((c) => c.rule === 'rule:interstitial-after-victory-cooldown');
    expect(cooldown.map((c) => ('eligible' in c.then ? c.then.eligible : null))).toEqual([
      false,
      true,
    ]);
  });

  it('pins the revive limit with REVIVE_LIMIT_REACHED', () => {
    const revive = swarm.find((f) => f.subject === 'action:revive')?.cases ?? [];
    expect(revive.find((c) => c.rule === 'rule:revive-limit-mission')?.then).toEqual({
      result: 'rejected',
      error: 'REVIVE_LIMIT_REACHED',
      deltas: {},
    });
  });

  it('covers cost boundaries on both sides (exactly enough is ok, one less is rejected)', () => {
    const cases = swarm.find((f) => f.subject === 'action:buy-damage-upgrade')?.cases ?? [];
    const coins = (c: (typeof cases)[number]): number => Number(c.given.vars['coins'] ?? 0);
    const short = cases.find(
      (c) => c.rule.includes('#cost-') && 'result' in c.then && c.then.result === 'rejected',
    );
    expect(short?.then).toMatchObject({ error: 'INSUFFICIENT_COINS' });
    const enough = cases.find(
      (c) => 'result' in c.then && c.then.result === 'ok' && coins(c) === coins(short as never) + 1,
    );
    expect(enough).toBeDefined();
  });

  it('gives every action with outcomes one case per outcome', () => {
    const play = swarm.find((f) => f.subject === 'action:play-mission')?.cases ?? [];
    expect(
      play
        .filter((c) => c.rule === 'action:play-mission')
        .map((c) => ('action' in c.when ? c.when.outcome : '')),
    ).toEqual(['win', 'waves-cleared', 'lose']);
  });

  it('works on the minimal model too', () => {
    const files = generateGoldens(compileModel(minimalModel()));
    expect(files.map((f) => f.subject)).toEqual([
      'action:play',
      'action:revive',
      'action:upgrade',
      'placement:interstitial',
    ]);
  });
});

describe('templates', () => {
  it('are embedded up to date — run `pnpm --filter @gamex/specpack gen:templates` if this fails', async () => {
    const { TEMPLATES } = await import('../src/templates.generated.ts');
    for (const f of ['interpreter.ts', 'run-golden.ts']) {
      expect(TEMPLATES[`tests/runner/${f}`]).toBe(
        readFileSync(new URL(`../templates/runner/${f}`, import.meta.url), 'utf8'),
      );
    }
  });
});
