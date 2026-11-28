import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateGameModel } from '@gamex/model';
import { startStudioServer, type StudioServer } from '../src/studio-server.ts';

const FIXTURES = new URL('../../../fixtures/swarm-rescue/', import.meta.url).pathname;

/** The sample repo without docs/GDD.md: the GDD arrives through the studio's upload. */
function repoWithoutGdd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-studio-'));
  for (const f of ['README.md', '.env', 'config/economy.json', 'src/Tuning.cs']) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), readFileSync(join(FIXTURES, 'sample-repo', f)));
  }
  return dir;
}

function staticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>studio</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
}

function call(
  s: StudioServer,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  return new Promise((ok, fail) => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: s.port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${String(s.port)}`,
          'x-gamex-token': s.token,
          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString('utf8')));
        res.on('end', () => {
          let json: Res['json'] = { ok: false };
          try {
            json = JSON.parse(data) as Res['json'];
          } catch {
            // static file
          }
          ok({ status: res.statusCode ?? 0, headers: res.headers, body: data, json });
        });
      },
    );
    req.on('error', fail);
    if (text !== undefined) req.write(text);
    req.end();
  });
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64');

describe('gamex studio server', () => {
  let s: StudioServer;
  let root: string;

  beforeAll(async () => {
    root = repoWithoutGdd();
    s = await startStudioServer({
      root,
      staticDir: staticDir(),
      recordings: join(FIXTURES, 'recordings-upload'),
      provider: 'recorded',
    });
  });
  afterAll(() => s.close());

  it('listens on 127.0.0.1 and prints a link carrying the token', () => {
    expect(s.url).toBe(`http://127.0.0.1:${String(s.port)}/#token=${s.token}`);
    expect(s.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it('requires the token, the right Host and no foreign Origin', async () => {
    expect(
      (await call(s, 'GET', '/api/state', undefined, { 'x-gamex-token': 'nope' })).status,
    ).toBe(401);
    expect(
      (await call(s, 'GET', '/api/state', undefined, { host: 'evil.example:80' })).json.error?.code,
    ).toBe('BAD_HOST');
    expect(
      (await call(s, 'GET', '/api/state', undefined, { origin: 'http://evil.example' })).status,
    ).toBe(403);
    const ok = await call(s, 'GET', '/api/state', undefined, {
      origin: `http://localhost:${String(s.port)}`,
      host: `localhost:${String(s.port)}`,
    });
    expect(ok.json).toMatchObject({
      ok: true,
      data: {
        mode: 'server',
        model: null,
        candidate: null,
        providers: { recorded: true, agent: true },
      },
    });
  });

  it('serves the studio with strict headers and never outside its folder', async () => {
    const index = await call(s, 'GET', '/');
    expect(index.status).toBe(200);
    expect(index.body).toContain('<title>studio</title>');
    expect(index.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect((await call(s, 'GET', '/assets/app.js')).headers['content-type']).toMatch(/javascript/);
    const escape = await call(s, 'GET', '/%2e%2e/%2e%2e/etc/passwd');
    expect(escape.body).toContain('<title>studio</title>');
    expect((await call(s, 'POST', '/index.html', {})).status).toBe(405);
  });

  it('accepts design-document uploads into gamex/sources/ only, never overwriting', async () => {
    const gdd = readFileSync(join(FIXTURES, 'GDD.md'));
    const up = await call(s, 'POST', '/api/upload', { name: 'GDD.md', contentBase64: b64(gdd) });
    expect(up.json).toEqual({
      ok: true,
      data: { path: 'gamex/sources/GDD.md', bytes: gdd.length },
    });
    expect(readFileSync(join(root, 'gamex/sources/GDD.md'))).toEqual(gdd);
    expect(
      (await call(s, 'POST', '/api/upload', { name: 'GDD.md', contentBase64: b64('x') })).json.error
        ?.code,
    ).toBe('FILE_EXISTS');
    for (const name of ['../evil.md', '.env', 'id_rsa', 'run.sh', 'a/b.md']) {
      expect(
        (await call(s, 'POST', '/api/upload', { name, contentBase64: b64('x') })).status,
        name,
      ).toBe(400);
    }
    const secret = await call(s, 'POST', '/api/upload', {
      name: 'notes.md',
      contentBase64: b64('apiKey: "Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0"\n'),
    });
    expect(secret.json.error?.code).toBe('SECRET_IN_FILE');
    expect(existsSync(join(root, 'gamex/sources/notes.md'))).toBe(false);
    const big = await call(s, 'POST', '/api/upload', {
      name: 'big.md',
      contentBase64: b64('x'.repeat(300 * 1024)),
    });
    expect(big.status).toBe(413);
  });

  it('shows the plan, confirms exactly that list, then extracts, reviews and writes the Spec Pack', async () => {
    const plan = await call(s, 'POST', '/api/ingest/plan', {});
    const files = plan.json.data?.['files'] as { path: string; sha256: string }[];
    expect(files.map((f) => f.path)).toEqual([
      'README.md',
      'gamex/sources/GDD.md',
      'config/economy.json',
      'src/Tuning.cs',
    ]);
    expect(plan.json.data?.['excluded']).toContainEqual({
      path: '.env',
      reason: expect.stringMatching(/denied/) as unknown,
    });

    const partial = await call(s, 'POST', '/api/ingest/confirm', { files: files.slice(1) });
    expect(partial.json.error?.code).toBe('PLAN_CHANGED');
    expect((await call(s, 'POST', '/api/extract', {})).json.error?.code).toBe('NO_INGEST_PLAN');
    expect((await call(s, 'POST', '/api/ingest/confirm', { files })).json.ok).toBe(true);

    const extracted = await call(s, 'POST', '/api/extract', {});
    expect(extracted.json).toMatchObject({ ok: true, data: { done: true, provider: 'recorded' } });
    const state = await call(s, 'GET', '/api/state');
    expect(state.json.data?.['candidate']).toMatchObject({ meta: { name: 'Swarm Rescue' } });
    expect(state.json.data?.['sources']).toEqual(['GDD.md']);

    const bad = await call(s, 'POST', '/api/review', { ledger: { version: 2 } });
    expect(bad.json.error?.code).toBe('LEDGER_INVALID');
    const reviewed = await call(s, 'POST', '/api/review', {
      ledger: { version: 1, default: 'approve', decisions: [] },
    });
    expect(reviewed.json).toMatchObject({ ok: true, data: { ok: true, modelVersion: 1 } });
    const model = validateGameModel(
      readFileSync(join(root, 'gamex/game-model.json'), 'utf8'),
    ).model;
    expect(
      model?.monetization.placements.find((p) => p.id === 'rewarded-revive')?.provenance.source,
    ).toBe('gamex/sources/GDD.md');

    if (model === undefined) throw new Error('no model');
    const edited = structuredClone(model);
    const gap = edited.constants.find((c) => c.id === 'interstitial-min-gap-seconds');
    if (gap !== undefined) gap.value = 240;
    expect((await call(s, 'PUT', '/api/model', { model: edited })).json.data).toEqual({
      model: 'gamex/game-model.json',
      modelVersion: 2,
    });
    expect((await call(s, 'PUT', '/api/model', { model: { meta: {} } })).json.error?.code).toBe(
      'MODEL_INVALID',
    );

    const preview = await call(s, 'POST', '/api/specpack/preview', { players: 10, days: 2 });
    expect(preview.json.data).toMatchObject({ written: false, conflicts: [] });
    expect(existsSync(join(root, 'gamex/README.md'))).toBe(false);
    const write = await call(s, 'POST', '/api/specpack/write', { players: 10, days: 2 });
    expect(write.json.data).toMatchObject({ written: true });
    expect(existsSync(join(root, 'gamex/tests/runner/run-golden.ts'))).toBe(true);
    expect(readFileSync(join(root, 'gamex/balance/ads.json'), 'utf8')).toContain('240');
  });

  it('refuses the recorded provider when none was configured, and unknown routes', async () => {
    const other = await startStudioServer({ root: repoWithoutGdd(), staticDir: staticDir() });
    try {
      expect(
        (await call(other, 'POST', '/api/extract', { provider: 'recorded' })).json.error?.code,
      ).toBe('PROVIDER_UNAVAILABLE');
      expect((await call(other, 'GET', '/api/nope')).status).toBe(404);
      expect(
        (await call(other, 'GET', '/api/state', undefined, { 'x-gamex-token': s.token })).status,
      ).toBe(401);
    } finally {
      await other.close();
    }
  });
});
