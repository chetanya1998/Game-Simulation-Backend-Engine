import { describe, expect, it } from 'vitest';
import { DEFAULT_DRIFT_SEVERITY, DRIFT_KINDS, isDriftKind } from '@gamex/drift';

describe('drift kinds', () => {
  it('covers exactly the four kinds from the spec', () => {
    expect([...DRIFT_KINDS].sort()).toEqual([
      'missing-in-code',
      'missing-in-spec',
      'rule-violation',
      'value-mismatch',
    ]);
    expect(Object.keys(DEFAULT_DRIFT_SEVERITY).sort()).toEqual([...DRIFT_KINDS].sort());
  });

  it('blocks on code/spec disagreement and warns on one-sided omissions', () => {
    expect(DEFAULT_DRIFT_SEVERITY['value-mismatch']).toBe('blocking');
    expect(DEFAULT_DRIFT_SEVERITY['rule-violation']).toBe('blocking');
    expect(DEFAULT_DRIFT_SEVERITY['missing-in-code']).toBe('warning');
  });

  it('narrows strings', () => {
    expect(isDriftKind('value-mismatch')).toBe(true);
    expect(isDriftKind('value_mismatch')).toBe(false);
  });
});
