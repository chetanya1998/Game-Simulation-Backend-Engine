import { Command } from 'commander';
import { ENGINE_VERSION } from '@gamex/engine';
import { SCHEMA_VERSION } from '@gamex/model';

export const CLI_VERSION = '0.0.0';

/** Minimum Node version: the Spec Pack's golden-test runner relies on native TypeScript type stripping. */
export const MIN_NODE_VERSION = '22.18.0';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Envelope printed by every command with `--json` (ARCHITECTURE §8). */
export interface JsonResult<T> {
  ok: boolean;
  command: string;
  data: T;
  issues: { severity: 'error' | 'warning'; code: string; message: string; hint?: string }[];
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function createProgram(io: Io, nodeVersion: string = process.versions.node): Command {
  const program = new Command();
  program
    .name('gamex')
    .description('GameX Engine — turn a game design into a buildable, testable, repo-native spec.')
    .version(CLI_VERSION, '-v, --version')
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();

  program
    .command('doctor')
    .description('Check that this environment can run GameX Engine and its Spec Pack test runner.')
    .option('--json', 'print a single JSON result to stdout')
    .action((options: { json?: boolean }) => {
      const nodeOk = compareVersions(nodeVersion, MIN_NODE_VERSION) >= 0;
      const result: JsonResult<{
        node: string;
        requiredNode: string;
        schemaVersion: string;
        engineVersion: string;
      }> = {
        ok: nodeOk,
        command: 'doctor',
        data: {
          node: nodeVersion,
          requiredNode: MIN_NODE_VERSION,
          schemaVersion: SCHEMA_VERSION,
          engineVersion: ENGINE_VERSION,
        },
        issues: nodeOk
          ? []
          : [
              {
                severity: 'error',
                code: 'NODE_TOO_OLD',
                message: `Node ${nodeVersion} is older than the required ${MIN_NODE_VERSION}.`,
                hint: 'Install Node 22.18 or newer (e.g. `nvm install 22`).',
              },
            ],
      };
      if (options.json === true) {
        io.stdout(`${JSON.stringify(result)}\n`);
      } else {
        io.stderr(
          `${nodeOk ? '✔' : '✖'} Node ${nodeVersion} (requires ≥ ${MIN_NODE_VERSION})\n` +
            `  Game Model schema ${SCHEMA_VERSION} · engine ${ENGINE_VERSION}\n`,
        );
      }
      if (!nodeOk) process.exitCode = 1;
    });

  return program;
}
