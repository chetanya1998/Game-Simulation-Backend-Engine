import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@gamex/model';
import { ENGINE_VERSION, SUPPORTED_SCHEMA_VERSION } from '@gamex/engine';

describe('engine package', () => {
  it('reads the schema version published by @gamex/model', () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
  });

  it('has a semver engine version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
