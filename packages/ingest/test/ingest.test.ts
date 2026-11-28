import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  SafeFileSystem,
  UnsafeReadError,
  discoverInputs,
  entropy,
  locationOf,
  readChunks,
  scanForSecrets,
} from '@gamex/ingest';

const SAMPLE = new URL('../../../fixtures/swarm-rescue/sample-repo/', import.meta.url).pathname;
const GDD = new URL('../../../fixtures/swarm-rescue/GDD.md', import.meta.url).pathname;
export const CANARIES = [
  'planted-canary-value-do-not-send',
  'PLANTED-SSH-KEY',
  'PLANTED-PEM',
  'AKIAPLANTEDCANARY012',
  'Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0',
];

/** A copy of the sample repo with the GDD and planted secrets of every kind. */
export function plantedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-ingest-'));
  cpSync(SAMPLE, dir, { recursive: true });
  // The sample repo ships docs/GDD.md (a copy of the fixture GDD).
  mkdirSync(join(dir, 'keys'));
  writeFileSync(
    join(dir, 'keys', 'id_rsa'),
    '-----BEGIN OPENSSH PRIVATE KEY-----\nPLANTED-SSH-KEY\n-----END OPENSSH PRIVATE KEY-----\n',
  );
  writeFileSync(
    join(dir, 'config', 'server.pem'),
    '-----BEGIN PRIVATE KEY-----\nPLANTED-PEM\n-----END PRIVATE KEY-----\n',
  );
  writeFileSync(
    join(dir, 'config', 'ads-config.json'),
    '{ "network": "planted", "awsKey": "AKIAPLANTEDCANARY012" }\n',
  );
  writeFileSync(
    join(dir, 'config', 'economy-settings.yaml'),
    'apiToken: "Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0"\nreward: 10\n',
  );
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'pkg', 'config.json'), '{}');
  writeFileSync(join(dir, '.gitignore'), 'secret-notes/\n*.local.md\n');
  mkdirSync(join(dir, 'secret-notes'));
  writeFileSync(join(dir, 'secret-notes', 'design.md'), '# hidden design\n');
  writeFileSync(join(dir, 'docs', 'draft.local.md'), '# local draft\n');
  return dir;
}

describe('scanForSecrets', () => {
  it.each([
    ['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['aws = AKIAABCDEFGHIJKLMNOP', 'aws-access-key'],
    ['key: sk-ant-api03-abcdefghijklmnopqrstuvwx', 'anthropic-key'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB', 'github-token'],
    ['"apiKey": "Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0"', 'high-entropy value for "apiKey"'],
  ])('finds %s', (line, kind) => {
    expect(scanForSecrets(`ok\n${line}\n`)).toEqual({ kind, line: 2 });
  });

  it.each([
    'password: changeme',
    'maxRevivesPerMission: 1',
    'tokenCount = 12345678901234567890',
    '# Design tokens for the UI',
  ])('ignores %s', (line) => {
    expect(scanForSecrets(line)).toBeUndefined();
  });

  it('measures entropy', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
  });
});

describe('discoverInputs on a repo with planted secrets', () => {
  const dir = plantedRepo();
  const plan = discoverInputs(dir);
  const included = plan.files.map((f) => f.path);
  const excluded = new Map(plan.excluded.map((e) => [e.path, e.reason]));

  it('includes the design doc, README, balance config and tuning code', () => {
    expect(included).toEqual(['README.md', 'docs/GDD.md', 'config/economy.json', 'src/Tuning.cs']);
    expect(plan.files.find((f) => f.path === 'src/Tuning.cs')).toMatchObject({
      kind: 'code',
      reason: 'tuning/config code name',
    });
    expect(plan.totalBytes).toBeGreaterThan(5000);
  });

  it('excludes every planted secret with a reason', () => {
    expect(excluded.get('.env')).toMatch(/denied: environment file/);
    expect(excluded.get('keys/id_rsa')).toMatch(/denied: SSH key/);
    expect(excluded.get('config/server.pem')).toMatch(/denied: private key/);
    expect(excluded.get('config/ads-config.json')).toMatch(/secret \(aws-access-key, line 1\)/);
    expect(excluded.get('config/economy-settings.yaml')).toMatch(
      /high-entropy value for "apiToken"/,
    );
  });

  it('honours .gitignore and never enters dependency folders', () => {
    expect(excluded.get('secret-notes/')).toBe('ignored by .gitignore');
    expect(excluded.get('docs/draft.local.md')).toBe('ignored by .gitignore');
    expect([...excluded.keys()].some((p) => p.startsWith('node_modules'))).toBe(false);
  });

  it('chunks never contain any planted secret', async () => {
    const chunks = await readChunks(plan);
    const all = chunks.map((c) => c.text).join('\n');
    for (const canary of CANARIES) expect(all).not.toContain(canary);
    expect(new Set(chunks.map((c) => c.path))).toEqual(new Set(included));
  });
});

describe('SafeFileSystem', () => {
  const dir = plantedRepo();
  const fs = new SafeFileSystem(dir);

  it('refuses denied, ignored, oversized and secret-bearing files even when asked directly', () => {
    for (const p of [
      '.env',
      'keys/id_rsa',
      'secret-notes/design.md',
      'node_modules/pkg/config.json',
      '../outside.md',
    ]) {
      expect(() => fs.readText(p), p).toThrow(UnsafeReadError);
    }
    expect(() => fs.readText('config/ads-config.json')).toThrow(/looks like it contains a secret/);
    writeFileSync(join(dir, 'docs', 'huge.md'), 'x'.repeat(300 * 1024));
    expect(() => fs.readText('docs/huge.md')).toThrow(/size cap/);
    expect(fs.readText('README.md')).toContain('Swarm Rescue');
  });

  it('never follows symlinks', () => {
    const outside = mkdtempSync(join(tmpdir(), 'gamex-outside-'));
    writeFileSync(join(outside, 'GDD.md'), '# outside\n');
    symlinkSync(join(outside, 'GDD.md'), join(dir, 'docs', 'linked-gdd.md'));
    symlinkSync(outside, join(dir, 'linked-dir'));
    const { files, excluded } = fs.list();
    expect(files.map((f) => f.path)).not.toContain('docs/linked-gdd.md');
    expect(
      excluded
        .filter((e) => e.reason.includes('symbolic link'))
        .map((e) => e.path)
        .sort(),
    ).toEqual(['docs/linked-gdd.md', 'linked-dir']);
    expect(() => fs.readText('docs/linked-gdd.md')).toThrow(/not a regular file/);
  });
});

describe('readChunks', () => {
  it('splits markdown by section and locates lines', async () => {
    const dir = plantedRepo();
    const plan = discoverInputs(dir);
    const chunks = await readChunks(plan);
    const gdd = chunks.filter((c) => c.path === 'docs/GDD.md');
    const mon = gdd.find((c) => c.heading?.endsWith('7. Monetization'));
    expect(mon).toMatchObject({
      id: expect.stringMatching(/^docs\/GDD\.md#L129-\d+$/) as unknown,
      startLine: 129,
    });
    const gddLines = readFileSync(GDD, 'utf8').split('\n');
    const line = gddLines.findIndex((l) => l.includes('At least 180 seconds apart')) + 1;
    if (mon === undefined) throw new Error('monetization chunk missing');
    expect(locationOf(mon, line)).toBe(`§7.2 / line ${String(line)}`);
    expect(mon.text.split('\n')[line - mon.startLine]).toContain('At least 180 seconds apart');
    expect(chunks.find((c) => c.path === 'src/Tuning.cs')?.id).toMatch(/^src\/Tuning\.cs#L1-\d+$/);
  });

  it('reads PDFs page by page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gamex-pdf-'));
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Revive at most once per mission.', { x: 50, y: 700, font, size: 12 });
    pdf.addPage().drawText('Interstitials only after victory.', { x: 50, y: 700, font, size: 12 });
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'design.pdf'), await pdf.save());
    const chunks = await readChunks(discoverInputs(dir));
    expect(chunks.map((c) => [c.id, c.page, c.text.trim()])).toEqual([
      ['docs/design.pdf#p1', 1, 'Revive at most once per mission.'],
      ['docs/design.pdf#p2', 2, 'Interstitials only after victory.'],
    ]);
    expect(chunks[1] && locationOf(chunks[1], 1)).toBe('p.2');
  });
});

describe('plan confirmation', () => {
  it('refuses to chunk a file that changed after the plan was made', async () => {
    const dir = plantedRepo();
    const plan = discoverInputs(dir);
    writeFileSync(join(dir, 'config', 'economy.json'), '{ "changed": true }\n');
    await expect(readChunks(plan)).rejects.toThrow(
      /config\/economy\.json: it changed after the ingest plan was confirmed/,
    );
  });
});

describe('gamex/sources (studio uploads)', () => {
  it('reads documents uploaded to gamex/sources/ but nothing else under gamex/', async () => {
    const dir = plantedRepo();
    mkdirSync(join(dir, 'gamex', 'sources'), { recursive: true });
    mkdirSync(join(dir, 'gamex', 'balance'), { recursive: true });
    writeFileSync(join(dir, 'gamex', 'sources', 'notes.md'), '# Notes\nRevive once.\n');
    writeFileSync(join(dir, 'gamex', 'sources', '.env'), 'X=planted-canary-value-do-not-send\n');
    writeFileSync(join(dir, 'gamex', 'balance', 'economy.json'), '{}');
    writeFileSync(join(dir, 'gamex', 'game-model.json'), '{}');
    const plan = discoverInputs(dir);
    expect(plan.files.filter((f) => f.path.startsWith('gamex/'))).toEqual([
      expect.objectContaining({ path: 'gamex/sources/notes.md', kind: 'design' }),
    ]);
    expect(plan.excluded.find((e) => e.path === 'gamex/sources/.env')?.reason).toMatch(/denied/);
    const chunks = await readChunks(plan);
    expect(chunks.map((c) => c.text).join('\n')).not.toContain('planted-canary');
  });

  it('does not follow a symlinked gamex/sources', () => {
    const dir = plantedRepo();
    const outside = mkdtempSync(join(tmpdir(), 'gamex-outside-'));
    writeFileSync(join(outside, 'GDD.md'), '# outside\n');
    mkdirSync(join(dir, 'gamex'));
    symlinkSync(outside, join(dir, 'gamex', 'sources'));
    const plan = discoverInputs(dir);
    expect(plan.files.map((f) => f.path)).not.toContain('gamex/sources/GDD.md');
    expect(plan.excluded).toContainEqual({
      path: 'gamex/sources',
      reason: 'symbolic link (never followed)',
    });
  });
});
