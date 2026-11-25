import { describe, expect, it } from 'vitest';
import {
  normalizeText,
  numbersIn,
  textStatesNumber,
  toId,
  toRef,
  verifyEvidence,
} from '@gamex/extract';
import { CHUNKS } from './helpers.js';

const byId = new Map(CHUNKS.map((c) => [c.id, c]));
const byPath = new Map(CHUNKS.map((c) => [c.path, [c]]));

describe('verifyEvidence', () => {
  it('locates an exact quote and cites the source line', () => {
    expect(
      verifyEvidence(
        { chunk: 'docs/design.md#L10-13', quote: 'Players get 50 coins' },
        byId,
        byPath,
      ),
    ).toMatchObject({
      source: 'docs/design.md',
      location: '§3 / line 12',
      excerpt: 'Players get 50 coins per win.',
      match: 'exact',
      line: 12,
    });
  });

  it('accepts a quote that drops markdown emphasis as a fuzzy match', () => {
    expect(
      verifyEvidence(
        { chunk: 'docs/design.md#L10-13', quote: 'Revive at most 2 times per run.' },
        byId,
        byPath,
      ),
    ).toMatchObject({
      excerpt: 'Revive at most **2 times** per run.',
      match: 'fuzzy',
      line: 11,
    });
  });

  it('falls back to other chunks of the same file when the chunk id is wrong', () => {
    expect(
      verifyEvidence(
        { chunk: 'docs/design.md#L1-2', quote: 'Shown only after a win.' },
        byId,
        byPath,
      ),
    ).toMatchObject({ match: 'exact', line: 13 });
  });

  it('reports a quote that is not in the source', () => {
    expect(
      verifyEvidence(
        { chunk: 'docs/design.md#L10-13', quote: 'The boss has 900 HP.' },
        byId,
        byPath,
      ),
    ).toMatchObject({
      source: 'docs/design.md',
      excerpt: 'The boss has 900 HP.',
      match: 'missing',
    });
    expect(verifyEvidence({ chunk: 'nowhere.md#L1-1', quote: 'x' }, byId, byPath)).toMatchObject({
      source: 'gamex:unverified',
      match: 'missing',
    });
  });
});

describe('numbers in text', () => {
  it('reads digits, separators, percentages and number words', () => {
    expect(numbersIn('1,500 HP, $3.99, 25% and three phases, once per day')).toEqual([
      1500, 3.99, 25, 0.25, 3, 1,
    ]);
    expect(textStatesNumber('+0.1x per kill', 0.1)).toBe(true);
    expect(textStatesNumber('Max 1 revive', 2)).toBe(false);
  });

  it('normalizes text for comparison', () => {
    expect(normalizeText('| **Max 1** revive |  per `mission` ')).toBe('max 1 revive per mission');
  });
});

describe('ids', () => {
  it.each([
    ['S07 Laser Trial', 's07-laser-trial'],
    ['maxRevivesPerMission', 'max-revives-per-mission'],
    ['Café — Bonus!', 'cafe-bonus'],
    ['3x claim', 'x-3x-claim'],
    ['', 'item'],
  ])('%s → %s', (raw, id) => {
    expect(toId(raw)).toBe(id);
  });

  it('normalizes references and rejects other prefixes', () => {
    expect(toRef('state: S11 Victory', ['state'])).toBe('state:s11-victory');
    expect(toRef('const:x', ['state'])).toBeUndefined();
    expect(toRef('victory', ['state'])).toBeUndefined();
  });
});
