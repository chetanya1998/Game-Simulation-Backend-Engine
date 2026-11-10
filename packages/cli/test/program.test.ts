import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@gamex/model';
import { CLI_VERSION, compareVersions, createProgram, type JsonResult } from '@gamex/cli';

function run(args: string[], nodeVersion?: string) {
  let stdout = '';
  let stderr = '';
  const program = createProgram(
    { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
    nodeVersion,
  );
  let exitCode: number | undefined;
  try {
    program.parse(['node', 'gamex', ...args]);
  } catch (error) {
    exitCode = (error as { exitCode?: number }).exitCode;
  }
  return { stdout, stderr, exitCode, processExitCode: process.exitCode };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('gamex CLI', () => {
  it('prints its version', () => {
    const { stdout, exitCode } = run(['--version']);
    expect(stdout.trim()).toBe(CLI_VERSION);
    expect(exitCode).toBe(0);
  });

  it('keeps CLI_VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('doctor --json reports a supported Node version', () => {
    const { stdout, processExitCode } = run(['doctor', '--json'], '22.18.0');
    const result = JSON.parse(stdout) as JsonResult<{ schemaVersion: string }>;
    expect(result).toMatchObject({ ok: true, command: 'doctor', issues: [] });
    expect(result.data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(processExitCode).toBeUndefined();
  });

  it('doctor --json flags an old Node version with an actionable hint and exit code 1', () => {
    const { stdout, processExitCode } = run(['doctor', '--json'], '20.11.1');
    const result = JSON.parse(stdout) as JsonResult<unknown>;
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: 'NODE_TOO_OLD',
      hint: expect.stringMatching(/22\.18/) as unknown,
    });
    expect(processExitCode).toBe(1);
  });

  it('doctor without --json writes a human summary to stderr only', () => {
    const { stdout, stderr } = run(['doctor'], '24.1.0');
    expect(stdout).toBe('');
    expect(stderr).toMatch(/✔ Node 24\.1\.0/);
  });

  it('rejects unknown commands as usage errors', () => {
    const { exitCode, stderr } = run(['frobnicate']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/unknown command/);
  });
});

describe('compareVersions', () => {
  it.each([
    ['22.18.0', '22.18.0', 0],
    ['v22.19.1', '22.18.0', 1],
    ['22.9.0', '22.18.0', -1],
    ['24', '22.18.0', 1],
  ])('%s vs %s → %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});
