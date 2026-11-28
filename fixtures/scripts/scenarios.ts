import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('../swarm-rescue/', import.meta.url).pathname;

/** A copy of the sample repo without its GDD — the starting point of the studio's upload flow. */
export function repoWithoutGdd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-nogdd-'));
  cpSync(join(here, 'sample-repo'), dir, { recursive: true });
  rmSync(join(dir, 'docs'), { recursive: true });
  return dir;
}

/** The same repo after the GDD was uploaded through the studio (gamex/sources/GDD.md). */
export function uploadScenarioRepo(): string {
  const dir = repoWithoutGdd();
  mkdirSync(join(dir, 'gamex', 'sources'), { recursive: true });
  cpSync(join(here, 'GDD.md'), join(dir, 'gamex', 'sources', 'GDD.md'));
  return dir;
}
