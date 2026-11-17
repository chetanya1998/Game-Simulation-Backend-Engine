import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram, type JsonResult } from '@gamex/cli';

const SWARM = readFileSync(
  new URL('../../../fixtures/swarm-rescue/swarm-rescue.game-model.json', import.meta.url),
  'utf8',
);

function repo(model: string | null = SWARM): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-cli-'));
  if (model !== null) {
    mkdirSync(join(dir, 'gamex'));
    writeFileSync(join(dir, 'gamex', 'game-model.json'), model);
  }
  return dir;
}

function gamex(args: string[]) {
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  const program = createProgram({ stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  let thrown: number | undefined;
  try {
    program.parse(['node', 'gamex', ...args]);
  } catch (error) {
    thrown = (error as { exitCode?: number }).exitCode;
  }
  const code = thrown ?? (typeof process.exitCode === 'number' ? process.exitCode : 0);
  const json = stdout.trim().startsWith('{')
    ? (JSON.parse(stdout) as JsonResult<Record<string, unknown>>)
    : undefined;
  return { stdout, stderr, code, json };
}

afterEach(() => {
  process.exitCode = undefined;
});

const fast = ['--players', '8', '--days', '3'];

describe('gamex validate', () => {
  it('accepts the Swarm Rescue model', () => {
    const r = gamex(['validate', '--cwd', repo(), '--json']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      ok: true,
      command: 'validate',
      data: { errors: 0, warnings: 0 },
    });
  });

  it('reports errors with file, line and hint, and exits 1', () => {
    const broken = SWARM.replace(
      '"missionLevel >= interstitialMinLevel"',
      '"missionLevl >= interstitialMinLevel"',
    );
    const r = gamex(['validate', '--cwd', repo(broken)]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /gamex\/game-model\.json:\d+:\d+: error EXPR_UNKNOWN_IDENTIFIER .*Did you mean "missionLevel"\?/,
    );
  });

  it('exits 3 when there is no model, with a hint', () => {
    const r = gamex(['validate', '--cwd', repo(null), '--json']);
    expect(r.code).toBe(3);
    expect(r.json?.issues[0]).toMatchObject({
      code: 'MODEL_NOT_FOUND',
      hint: expect.stringContaining('gamex/game-model.json') as unknown,
    });
  });

  it('accepts --model', () => {
    const dir = repo(null);
    writeFileSync(join(dir, 'm.json'), SWARM);
    expect(gamex(['validate', '--cwd', dir, '--model', 'm.json']).code).toBe(0);
  });
});

describe('gamex sim', () => {
  it('is deterministic and reports invariants', () => {
    const dir = repo();
    const a = gamex(['sim', '--cwd', dir, '--json', ...fast, '--seed', '4']);
    const b = gamex(['sim', '--cwd', dir, '--json', ...fast, '--seed', '4']);
    expect(a.code).toBe(0);
    expect((a.json?.data['record'] as { outputHash: string }).outputHash).toBe(
      (b.json?.data['record'] as { outputHash: string }).outputHash,
    );
    expect(gamex(['sim', '--cwd', dir, ...fast]).stderr).toMatch(
      /✔ interstitial-min-gap: held in all \d+ checks/,
    );
  });

  it('applies --param overrides and runs sweeps', () => {
    const dir = repo();
    const p = gamex([
      'sim',
      '--cwd',
      dir,
      '--json',
      ...fast,
      '--param',
      'interstitialMinGapSeconds=300',
    ]);
    expect((p.json?.data['record'] as { params: unknown }).params).toEqual({
      interstitialMinGapSeconds: 300,
    });
    const s = gamex(['sim', '--cwd', dir, '--json', ...fast, '--sweep', 'coinsVictoryBase=25,100']);
    expect((s.json?.data['rows'] as unknown[]).length).toBe(2);
    const l = gamex([
      'sim',
      '--cwd',
      dir,
      '--json',
      ...fast,
      '--lhs',
      'coinsVictoryBase,bossDamage',
      '--samples',
      '3',
    ]);
    expect(l.json?.data['method']).toBe('latin-hypercube');
  }, 60000);

  it.each([
    [['--param', 'nope'], /--param expects key=number/],
    [['--days', '0'], /--days must be a positive integer/],
    [['--sweep', 'x=a'], /--sweep expects/],
  ])('rejects bad options %j with exit 2', (args, message) => {
    const r = gamex(['sim', '--cwd', repo(), ...fast, ...args]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(message);
  });

  it('reports an unknown parameter as a model error (exit 1)', () => {
    const r = gamex(['sim', '--cwd', repo(), '--json', ...fast, '--param', 'nope=1']);
    expect(r.code).toBe(1);
    expect(r.json?.issues[0]?.message).toMatch(/Unknown parameter "nope"/);
  });
});

describe('gamex explore', () => {
  it('passes Swarm Rescue', () => {
    const r = gamex(['explore', '--cwd', repo(), '--json']);
    expect(r.code).toBe(0);
    expect(r.json?.data['ok']).toBe(true);
  }, 60000);

  it('fails (exit 1) with a planted reward loop', () => {
    const model = JSON.parse(SWARM) as { actions: { id: string; limits?: unknown }[] };
    const claim = model.actions.find((a) => a.id === 'claim-triple');
    if (claim) delete claim.limits;
    const r = gamex(['explore', '--cwd', repo(JSON.stringify(model))]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/blocking: reward-loop — Infinite reward loop: claim-triple/);
  }, 60000);
});

describe('gamex sync', () => {
  it('writes the Spec Pack, is idempotent, and the golden tests pass with plain node', () => {
    const dir = repo();
    writeFileSync(join(dir, 'AGENTS.md'), '# Team rules\n\nBe kind.\n');
    const first = gamex(['sync', '--cwd', dir, '--json', ...fast]);
    expect(first.code).toBe(0);
    expect(first.json?.data['written']).toBe(true);
    const second = gamex(['sync', '--cwd', dir, ...fast]);
    expect(second.stderr).toMatch(/0 created, 0 updated, 0 deleted/);
    expect(
      readFileSync(join(dir, 'AGENTS.md'), 'utf8').startsWith('# Team rules\n\nBe kind.\n'),
    ).toBe(true);
    const out = execFileSync('node', ['gamex/tests/runner/run-golden.ts'], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(out).toMatch(/# \d+ passed, 0 failed/);
  }, 120000);

  it('stops with exit 1 on a hand-edited generated file and --force overwrites', () => {
    const dir = repo();
    gamex(['sync', '--cwd', dir, ...fast]);
    writeFileSync(join(dir, 'gamex', 'backend', 'openapi.yaml'), 'mine\n');
    const r = gamex(['sync', '--cwd', dir, '--json', ...fast, '--seed', '2']);
    expect(r.code).toBe(1);
    expect(r.json?.issues[0]).toMatchObject({
      code: 'SYNC_CONFLICT',
      message: expect.stringContaining('gamex/backend/openapi.yaml') as unknown,
    });
    expect(gamex(['sync', '--cwd', dir, ...fast, '--seed', '2', '--force']).code).toBe(0);
    expect(readFileSync(join(dir, 'gamex', 'backend', 'openapi.yaml'), 'utf8')).toContain(
      'openapi: "3.1.0"',
    );
  }, 120000);

  it('--dry-run writes nothing', () => {
    const dir = repo();
    const r = gamex(['sync', '--cwd', dir, '--json', ...fast, '--dry-run']);
    expect(r.json?.data['written']).toBe(false);
    expect(() => readFileSync(join(dir, 'gamex', 'README.md'))).toThrow();
  }, 60000);
});
