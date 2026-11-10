import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH, SCHEMA_VERSION, idToKey, isValidId } from '@gamex/model';

describe('isValidId', () => {
  it.each(['coins', 'max-revives-per-mission', 's11-victory', 'l5-boss', 'a1-b2-c3'])(
    'accepts %s',
    (id) => {
      expect(isValidId(id)).toBe(true);
    },
  );

  it.each(['', 'Coins', 'max_revives', '-coins', 'coins-', 'max--revives', '1coins', 'co ins'])(
    'rejects %j',
    (id) => {
      expect(isValidId(id)).toBe(false);
    },
  );

  it('rejects ids longer than the maximum', () => {
    expect(isValidId('a'.repeat(MAX_ID_LENGTH))).toBe(true);
    expect(isValidId('a'.repeat(MAX_ID_LENGTH + 1))).toBe(false);
  });
});

describe('idToKey', () => {
  it.each([
    ['coins', 'coins'],
    ['max-revives-per-mission', 'maxRevivesPerMission'],
    ['revives-used-this-mission', 'revivesUsedThisMission'],
    ['s11-victory', 's11Victory'],
    ['l5-2x-reward', 'l52xReward'],
  ])('%s → %s', (id, key) => {
    expect(idToKey(id)).toBe(key);
  });

  it('throws an actionable error for invalid ids', () => {
    expect(() => idToKey('Max_Revives')).toThrow(
      /Invalid id "Max_Revives": ids must be kebab-case/,
    );
  });

  const idArb = fc
    .array(fc.stringMatching(/^[a-z0-9]{1,6}$/), { minLength: 1, maxLength: 6 })
    .map((parts) => `x${parts.join('-')}`)
    .filter((id) => id.length <= MAX_ID_LENGTH);

  it('produces identifier-safe keys without hyphens (property)', () => {
    fc.assert(
      fc.property(idArb, (id) => {
        const key = idToKey(id);
        expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        expect(key.toLowerCase()).toBe(id.replaceAll('-', ''));
      }),
    );
  });
});

describe('SCHEMA_VERSION', () => {
  it('is a semver string', () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
