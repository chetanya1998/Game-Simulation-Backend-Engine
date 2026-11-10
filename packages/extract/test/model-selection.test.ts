import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, resolveModel } from '@gamex/extract';

describe('resolveModel', () => {
  it('defaults to Claude Opus 5.5', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(resolveModel({})).toEqual({ model: 'claude-opus-5-5', source: 'default' });
  });

  it('prefers flag over env over config', () => {
    expect(resolveModel({ flag: 'a', env: 'b', config: 'c' })).toEqual({
      model: 'a',
      source: 'flag',
    });
    expect(resolveModel({ env: 'b', config: 'c' })).toEqual({ model: 'b', source: 'env' });
    expect(resolveModel({ config: 'c' })).toEqual({ model: 'c', source: 'config' });
  });

  it('ignores empty and whitespace-only values', () => {
    expect(resolveModel({ flag: '  ', env: '', config: ' claude-sonnet-5-5 ' })).toEqual({
      model: 'claude-sonnet-5-5',
      source: 'config',
    });
  });
});
