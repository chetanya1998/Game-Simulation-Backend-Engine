import type { CompiledModel, CVariable } from '@gamex/engine';
import { idToKey } from '@gamex/model';
import { GENERATED_HEADER, snake, type FileMap } from './common.js';

const q = (name: string): string => `"${name}"`;
const lit = (s: string): string => `'${s.replaceAll("'", "''")}'`;

function column(c: CompiledModel, v: CVariable): string {
  const name = q(snake(v.id));
  const enumValues = c.model.variables.find((x) => idToKey(x.id) === v.key)?.enumValues ?? [];
  const def =
    typeof v.initial === 'string'
      ? lit(v.initial)
      : typeof v.initial === 'boolean'
        ? v.initial
          ? 'TRUE'
          : 'FALSE'
        : String(v.initial);
  const type =
    v.type === 'int'
      ? 'BIGINT'
      : v.type === 'bool'
        ? 'BOOLEAN'
        : v.type === 'enum'
          ? 'TEXT'
          : 'DOUBLE PRECISION';
  const checks: string[] = [];
  if (v.type === 'enum') checks.push(`${name} IN (${enumValues.map(lit).join(', ')})`);
  if (v.min !== undefined) checks.push(`${name} >= ${String(v.min)}`);
  if (v.max !== undefined) checks.push(`${name} <= ${String(v.max)}`);
  return `  ${name} ${type} NOT NULL DEFAULT ${def}${checks.length === 0 ? '' : ` CHECK (${checks.join(' AND ')})`}`;
}

const SCOPE_TABLES: Record<string, { table: string; key: string; comment: string }> = {
  player: { table: 'player_state', key: '', comment: 'Progress that lasts forever.' },
  global: { table: 'player_state', key: '', comment: '' },
  mission: {
    table: 'mission_state',
    key: '  "mission_id" TEXT NOT NULL,\n',
    comment: 'Reset when a mission begins.',
  },
  session: {
    table: 'session_state',
    key: '  "session_id" TEXT NOT NULL,\n',
    comment: 'Reset when a session starts.',
  },
  day: {
    table: 'day_state',
    key: '  "day" DATE NOT NULL,\n',
    comment: 'Reset at the daily reset.',
  },
};

/** gamex/backend/data-model.sql — PostgreSQL tables for wallet, ledger, state, ad claims, purchases, idempotency. */
export function renderSql(c: CompiledModel, files: FileMap): void {
  const resources = [...c.resources.values()];
  const rewarded = [...c.placements.values()]
    .filter((p) => p.format === 'rewarded')
    .map((p) => p.id);
  const storeActions = [...c.actions.values()].filter((a) => a.actor === 'store').map((a) => a.id);
  const out: string[] = [
    `-- ${GENERATED_HEADER}`,
    `-- Data model for the ${c.model.meta.name} economy backend (PostgreSQL). Amounts are whole numbers.`,
    '',
    'CREATE TABLE "players" (\n  "player_id" TEXT PRIMARY KEY,\n  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()\n);',
    '',
    '-- One row per player and resource. Balances never go negative and never exceed their cap.',
    `CREATE TABLE "wallet" (
  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),
  "resource" TEXT NOT NULL CHECK ("resource" IN (${resources.map((r) => lit(r.id)).join(', ') || "''"})),
  "amount" BIGINT NOT NULL CHECK ("amount" >= 0),
${resources
  .filter((r) => r.cap !== undefined)
  .map((r) => `  CHECK ("resource" <> ${lit(r.id)} OR "amount" <= ${String(r.cap)}),\n`)
  .join('')}  PRIMARY KEY ("player_id", "resource")
);`,
    '',
    '-- Append-only history of every balance change, for audits and anti-cheat.',
    `CREATE TABLE "ledger" (
  "entry_id" BIGSERIAL PRIMARY KEY,
  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),
  "resource" TEXT NOT NULL,
  "delta" BIGINT NOT NULL,
  "balance_after" BIGINT NOT NULL CHECK ("balance_after" >= 0),
  "action" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
  ];
  const byTable = new Map<string, CVariable[]>();
  for (const v of c.variables.values()) {
    const t = SCOPE_TABLES[v.scope]?.table ?? 'player_state';
    byTable.set(t, [...(byTable.get(t) ?? []), v]);
  }
  for (const scope of ['player', 'mission', 'session', 'day']) {
    const spec = SCOPE_TABLES[scope];
    if (spec === undefined) continue;
    const vars = byTable.get(spec.table) ?? [];
    if (vars.length === 0 && scope !== 'player') continue;
    out.push(
      '',
      `-- ${spec.comment} Generated counters (…_count_…, …_last_at) enforce limits, caps and cooldowns.`,
    );
    const pk =
      scope === 'player' ? '"player_id"' : `"player_id", ${spec.key.trim().split(' ')[0] ?? ''}`;
    out.push(
      `CREATE TABLE ${q(spec.table)} (\n  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),\n${spec.key}${vars.map((v) => `${column(c, v)},\n`).join('')}  PRIMARY KEY (${pk})\n);`,
    );
  }
  out.push(
    '',
    '-- Rewarded videos: a reward is granted only once per verified ad (server-side verification token).',
    `CREATE TABLE "ad_claims" (
  "claim_id" BIGSERIAL PRIMARY KEY,
  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),
  "placement" TEXT NOT NULL CHECK ("placement" IN (${rewarded.map(lit).join(', ') || "''"})),
  "network" TEXT NOT NULL,
  "verification_token" TEXT NOT NULL UNIQUE,
  "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
    '',
    '-- Purchases: each store receipt is redeemed once.',
    `CREATE TABLE "purchases" (
  "purchase_id" BIGSERIAL PRIMARY KEY,
  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),
  "action" TEXT NOT NULL CHECK ("action" IN (${storeActions.map(lit).join(', ') || "''"})),
  "store" TEXT NOT NULL,
  "receipt_id" TEXT NOT NULL UNIQUE,
  "purchased_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
    '',
    '-- Idempotency: a retried request with the same key returns the stored response and changes nothing.',
    `CREATE TABLE "idempotency_keys" (
  "player_id" TEXT NOT NULL REFERENCES "players" ("player_id"),
  "idempotency_key" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("player_id", "idempotency_key")
);`,
    '',
  );
  files.set('gamex/backend/data-model.sql', { ownership: 'generated', content: out.join('\n') });
}
