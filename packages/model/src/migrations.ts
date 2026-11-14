import type { Issue } from './issues.js';

/** Version of the Game Model file format (semver). Bumped with a migration on breaking changes. */
export const SCHEMA_VERSION = '0.1.0';

export interface Migration {
  readonly from: string;
  readonly to: string;
  readonly migrate: (model: Record<string, unknown>) => Record<string, unknown>;
}

/** Ordered migrations from older schema versions. Empty until the first breaking change. */
export const MIGRATIONS: readonly Migration[] = [];

function parseSemver(v: string): [number, number, number] | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])];
}

function schemaVersionOf(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const meta = (value as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return undefined;
  return (meta as { schemaVersion?: unknown }).schemaVersion;
}

/** Checks `meta.schemaVersion` before schema validation, so old/new files get a clear message. */
export function checkSchemaVersion(value: unknown): Issue[] {
  const version = schemaVersionOf(value);
  if (version === undefined) return []; // the schema layer reports the missing field
  if (typeof version !== 'string' || parseSemver(version) === undefined) return [];
  if (version === SCHEMA_VERSION || MIGRATIONS.some((m) => m.from === version)) return [];
  const [major, minor] = parseSemver(version) ?? [0, 0, 0];
  const [curMajor, curMinor] = parseSemver(SCHEMA_VERSION) ?? [0, 0, 0];
  const newer = major > curMajor || (major === curMajor && minor > curMinor);
  return [
    {
      severity: 'error',
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      path: '/meta/schemaVersion',
      message: `Schema version ${version} is ${newer ? 'newer than' : 'older than and not migratable to'} the supported version ${SCHEMA_VERSION}`,
      hint: newer
        ? 'Upgrade GameX Engine to read this file.'
        : 'Re-export the model with a supported GameX Engine version.',
    },
  ];
}

/** Applies migrations in order until the model is at SCHEMA_VERSION. */
export function migrateModel(value: Record<string, unknown>): {
  model: Record<string, unknown>;
  applied: string[];
} {
  let model = value;
  const applied: string[] = [];
  for (;;) {
    const version = schemaVersionOf(model);
    const step = MIGRATIONS.find((m) => m.from === version);
    if (step === undefined) return { model, applied };
    model = step.migrate(model);
    applied.push(`${step.from}→${step.to}`);
  }
}
