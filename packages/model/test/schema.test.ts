import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  canonicalStringify,
  checkSchemaVersion,
  computeContentHash,
  gameModelJsonSchema,
  migrateModel,
  serializeGameModel,
} from '@gamex/model';
import { minimalModel } from './helpers/minimal-model.ts';

describe('JSON Schema', () => {
  it('is up to date — run `pnpm --filter @gamex/model gen:schema` if this fails', () => {
    const onDisk = readFileSync(
      new URL('../schema/game-model.schema.json', import.meta.url),
      'utf8',
    );
    expect(onDisk).toBe(canonicalStringify(gameModelJsonSchema()));
  });

  it('describes every top-level section as required', () => {
    const schema = gameModelJsonSchema() as {
      required: string[];
      $schema: string;
      additionalProperties: boolean;
    };
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.required).toEqual([
      'meta',
      'entities',
      'resources',
      'constants',
      'variables',
      'actions',
      'rules',
      'stateMachine',
      'flows',
      'monetization',
      'personas',
      'kpis',
      'invariants',
      'gaps',
    ]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('schema versions', () => {
  it('accepts the current version and files without meta', () => {
    expect(checkSchemaVersion(minimalModel())).toEqual([]);
    expect(checkSchemaVersion({})).toEqual([]);
    expect(checkSchemaVersion({ meta: { schemaVersion: 'x' } })).toEqual([]);
  });

  it.each([
    ['1.0.0', /newer than/],
    ['0.2.0', /newer than/],
    ['0.0.9', /older than and not migratable/],
  ])('rejects %s', (version, message) => {
    const issues = checkSchemaVersion({ meta: { schemaVersion: version } });
    expect(issues[0]).toMatchObject({
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      path: '/meta/schemaVersion',
    });
    expect(issues[0]?.message).toMatch(message);
  });

  it('has no migrations yet, so migrateModel is the identity', () => {
    expect(MIGRATIONS).toEqual([]);
    const m = { meta: { schemaVersion: SCHEMA_VERSION } };
    expect(migrateModel(m)).toEqual({ model: m, applied: [] });
  });
});

describe('content hash and serialization', () => {
  it('ignores version counters and timestamps but not content', () => {
    const a = minimalModel();
    const b = minimalModel();
    b.meta.modelVersion = 7;
    b.meta.updatedAt = '2026-11-14T00:00:00Z';
    expect(computeContentHash(b)).toBe(computeContentHash(a));
    expect(computeContentHash({ ...b, $schema: './schema/game-model.schema.json' })).toBe(
      computeContentHash(a),
    );
    b.constants[0] = { ...b.constants[0]!, value: 110 }; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(computeContentHash(b)).not.toBe(computeContentHash(a));
    expect(computeContentHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes canonically and stably', () => {
    const text = serializeGameModel(minimalModel());
    expect(text.startsWith('{\n  "meta": {')).toBe(true);
    expect(serializeGameModel(JSON.parse(text) as ReturnType<typeof minimalModel>)).toBe(text);
  });
});
