import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGameModel } from '@gamex/model';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram, type JsonResult } from '@gamex/cli';

const FIXTURES = new URL('../../../fixtures/swarm-rescue/', import.meta.url).pathname;
const RECORDINGS = join(FIXTURES, 'recordings');
const ACCEPT_ALL = join(FIXTURES, 'accept-all.json');

function sampleRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-init-'));
  cpSync(join(FIXTURES, 'sample-repo'), dir, { recursive: true });
  return dir;
}

async function gamex(args: string[], answers?: string[]) {
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  const queue = [...(answers ?? [])];
  const program = createProgram({
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    ...(answers === undefined ? {} : { prompt: () => Promise.resolve(queue.shift() ?? 'q') }),
  });
  await program.parseAsync(['node', 'gamex', ...args]);
  const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
  const json = stdout.trim().startsWith('{')
    ? (JSON.parse(stdout) as JsonResult<Record<string, unknown>>)
    : undefined;
  return { stdout, stderr, code, json };
}

afterEach(() => {
  process.exitCode = undefined;
});

const recorded = ['--provider', 'recorded', '--recordings', RECORDINGS];

describe('gamex ingest', () => {
  it('shows the plan and asks for confirmation before anything is saved', async () => {
    const dir = sampleRepo();
    const r = await gamex(['ingest', '--cwd', dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\+ docs\/GDD\.md\s+design/);
    expect(r.stderr).toMatch(/- \.env\s+denied: environment file/);
    expect(r.stderr).toMatch(/Confirmation needed.*--yes/s);
    expect(existsSync(join(dir, 'gamex'))).toBe(false);

    expect((await gamex(['ingest', '--cwd', dir], ['n'])).code).toBe(1);
    expect(existsSync(join(dir, 'gamex'))).toBe(false);
    expect((await gamex(['ingest', '--cwd', dir], ['y'])).code).toBe(0);
    expect(readFileSync(join(dir, 'gamex', '.work', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('prints the plan as JSON with --yes --json', async () => {
    const r = await gamex(['ingest', '--cwd', sampleRepo(), '--yes', '--json']);
    expect(r.code).toBe(0);
    const data = r.json?.data as {
      files: { path: string }[];
      excluded: { path: string; reason: string }[];
    };
    expect(data.files.map((f) => f.path)).toEqual([
      'README.md',
      'docs/GDD.md',
      'config/economy.json',
      'src/Tuning.cs',
    ]);
    expect(data.excluded).toContainEqual({
      path: '.env',
      reason: expect.stringMatching(/denied/) as unknown,
    });
  });
});

describe('gamex extract', () => {
  it('needs a confirmed plan', async () => {
    const r = await gamex(['extract', '--cwd', sampleRepo(), ...recorded, '--json']);
    expect(r.code).toBe(2);
    expect(r.json?.issues[0]).toMatchObject({ code: 'NO_INGEST_PLAN' });
  });

  it('writes the candidate, and refuses inputs that changed after confirmation', async () => {
    const dir = sampleRepo();
    await gamex(['ingest', '--cwd', dir, '--yes']);
    const r = await gamex(['extract', '--cwd', dir, ...recorded]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/✔ Candidate model: 22 screens, 50 transitions/);
    expect(
      validateGameModel(readFileSync(join(dir, 'gamex/.work/candidate.json'), 'utf8')).ok,
    ).toBe(true);
    expect(
      JSON.parse(readFileSync(join(dir, 'gamex/.work/extraction-report.json'), 'utf8')),
    ).toMatchObject({ provider: 'recorded' });

    writeFileSync(join(dir, 'config', 'economy.json'), '{}\n');
    const changed = await gamex(['extract', '--cwd', dir, ...recorded, '--json']);
    expect(changed.code).toBe(1);
    expect(changed.json?.issues[0]).toMatchObject({
      code: 'INPUTS_CHANGED',
      message: expect.stringContaining('config/economy.json') as unknown,
    });
  });

  it('exits 3 without an API key for the Anthropic provider', async () => {
    const dir = sampleRepo();
    await gamex(['ingest', '--cwd', dir, '--yes']);
    const saved = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const r = await gamex(['extract', '--cwd', dir, '--json']);
      expect(r.code).toBe(3);
      expect(r.json?.issues[0]).toMatchObject({
        code: 'NO_API_KEY',
        hint: expect.stringContaining('--provider agent') as unknown,
      });
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved;
    }
  });

  it('hands requests to your own agent and exits 1 while they are pending', async () => {
    const dir = sampleRepo();
    await gamex(['ingest', '--cwd', dir, '--yes']);
    const r = await gamex(['extract', '--cwd', dir, '--provider', 'agent', '--json']);
    expect(r.code).toBe(1);
    expect(r.json?.data).toEqual({ pending: ['inventory#1'], directory: 'gamex/.work/handoff' });
    const request = JSON.parse(
      readFileSync(join(dir, 'gamex/.work/handoff/requests/inventory-1.json'), 'utf8'),
    ) as { documents: string };
    expect(request.documents).toContain('Swarm Rescue');
    expect(request.documents).not.toContain('planted-canary');
  });
});

describe('gamex review', () => {
  async function extracted(): Promise<string> {
    const dir = sampleRepo();
    await gamex(['ingest', '--cwd', dir, '--yes']);
    await gamex(['extract', '--cwd', dir, ...recorded]);
    return dir;
  }

  it('applies a decisions file, writes the ledger and the model, and bumps the version on change', async () => {
    const dir = await extracted();
    const r = await gamex(['review', '--cwd', dir, '--decisions', ACCEPT_ALL, '--json']);
    expect(r.code).toBe(0);
    expect(r.json?.data).toMatchObject({
      model: 'gamex/game-model.json',
      modelVersion: 1,
      summary: { rejected: 0, pending: [] },
    });
    expect(JSON.parse(readFileSync(join(dir, 'gamex/review.json'), 'utf8'))).toEqual({
      version: 1,
      decisions: [],
      default: 'approve',
    });
    expect(validateGameModel(readFileSync(join(dir, 'gamex/game-model.json'), 'utf8')).ok).toBe(
      true,
    );

    expect((await gamex(['review', '--cwd', dir, '--json'])).json?.data).toMatchObject({
      modelVersion: 1,
    });
    const edit = join(dir, 'edit.json');
    writeFileSync(
      edit,
      JSON.stringify({
        version: 1,
        decisions: [
          { ref: 'const:interstitial-min-gap-seconds', decision: 'edit', set: { value: 240 } },
        ],
      }),
    );
    const edited = await gamex(['review', '--cwd', dir, '--decisions', edit, '--json']);
    expect(edited.json?.data).toMatchObject({ modelVersion: 2, summary: { edited: 1 } });
    const model = JSON.parse(readFileSync(join(dir, 'gamex/game-model.json'), 'utf8')) as {
      constants: { id: string; value: unknown }[];
    };
    expect(model.constants.find((c) => c.id === 'interstitial-min-gap-seconds')?.value).toBe(240);
  });

  it('asks item by item in a terminal', async () => {
    const dir = await extracted();
    const r = await gamex(['review', '--cwd', dir], ['r', 'x', 's', 'A']);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/\[1\/\d+\] ent:relickeeper — Relickeeper \(confirmed|detected/);
    const ledger = JSON.parse(readFileSync(join(dir, 'gamex/review.json'), 'utf8')) as {
      decisions: { ref: string; decision: string }[];
    };
    expect(ledger.decisions.find((d) => d.ref === 'ent:relickeeper')?.decision).toBe('reject');
    expect(ledger.decisions.find((d) => d.ref === 'ent:vanguard')?.decision).toBe('assume');
    expect(ledger.decisions.find((d) => d.ref === 'ent:swarm-drone')?.decision).toBe('approve');
  });

  it('reports an incomplete review without writing the model', async () => {
    const dir = await extracted();
    const r = await gamex(['review', '--cwd', dir, '--default', 'pending', '--json']);
    expect(r.code).toBe(1);
    expect(r.json?.issues[0]).toMatchObject({ code: 'REVIEW_INCOMPLETE' });
    expect(existsSync(join(dir, 'gamex/game-model.json'))).toBe(false);
  });
});

describe('gamex init', () => {
  it('turns the sample repo into a valid model and a complete Spec Pack whose golden tests pass', async () => {
    const dir = sampleRepo();
    const r = await gamex([
      'init',
      '--cwd',
      dir,
      '--yes',
      '--decisions',
      ACCEPT_ALL,
      ...recorded,
      '--players',
      '20',
      '--days',
      '3',
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/✔ Spec Pack written: \d+ files, \d+ golden cases/);
    const model = validateGameModel(readFileSync(join(dir, 'gamex/game-model.json'), 'utf8'));
    expect(model.issues.filter((i) => i.severity === 'error')).toEqual([]);
    for (const f of [
      'AGENTS.md',
      'gamex/README.md',
      'gamex/balance',
      'gamex/backend/openapi.yaml',
      'gamex/tests/runner/run-golden.ts',
      'gamex/tasks',
    ]) {
      expect(existsSync(join(dir, f)), f).toBe(true);
    }
    const out = execFileSync(process.execPath, ['gamex/tests/runner/run-golden.ts'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out).toMatch(/passed/);
    const again = await gamex(['sync', '--cwd', dir, '--players', '20', '--days', '3', '--json']);
    const files = (again.json?.data as { files: { action: string }[] }).files;
    expect(files.filter((f) => f.action !== 'unchanged' && f.action !== 'skip')).toEqual([]);
  }, 120_000);
});
