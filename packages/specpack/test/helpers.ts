import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GameModel } from '@gamex/model';

export function swarmRescue(): GameModel {
  return JSON.parse(
    readFileSync(
      new URL('../../../fixtures/swarm-rescue/swarm-rescue.game-model.json', import.meta.url),
      'utf8',
    ),
  ) as GameModel;
}

export { minimalModel } from '../../model/test/helpers/minimal-model.ts';

export function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'gamex-repo-'));
}

export function runNode(cwd: string, args: string[]): { code: number; out: string } {
  try {
    return {
      code: 0,
      out: execFileSync('node', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}
