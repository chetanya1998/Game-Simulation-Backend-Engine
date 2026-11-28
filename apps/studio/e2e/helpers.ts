import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import type { BrowserContext, Page } from 'playwright';

export const ROOT = new URL('../../../', import.meta.url).pathname;
export const CLI = join(ROOT, 'packages/cli/dist/gamex.js');
export const FIXTURES = join(ROOT, 'fixtures/swarm-rescue');
export const STUDIO_DIST = join(ROOT, 'apps/studio/dist');
export const OUTPUT = join(ROOT, 'apps/studio/e2e-output');

export function ensureBuilt(): void {
  for (const f of [
    CLI,
    join(ROOT, 'packages/cli/dist/studio/index.html'),
    join(STUDIO_DIST, 'index.html'),
  ]) {
    if (!existsSync(f))
      throw new Error(`${f} is missing: run \`pnpm build\` before the studio E2E tests.`);
  }
  mkdirSync(OUTPUT, { recursive: true });
}

/** A git repo copy of the sample game without its GDD (the studio uploads it). */
export function gameRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-e2e-'));
  cpSync(join(FIXTURES, 'sample-repo'), dir, { recursive: true });
  rmSync(join(dir, 'docs'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

export function gamex(args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

/** Starts `gamex studio` (the built CLI) and resolves with its URL. */
export function startStudio(
  repo: string,
  extra: string[] = [],
): Promise<{ url: string; origin: string; proc: ChildProcess }> {
  const proc = spawn(process.execPath, [CLI, 'studio', '--cwd', repo, ...extra], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  return new Promise((ok, fail) => {
    let err = '';
    const timer = setTimeout(() => {
      fail(new Error(`gamex studio did not start: ${err}`));
    }, 15_000);
    proc.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      const m = /Open: (http:\/\/127\.0\.0\.1:\d+)\/#token=[0-9a-f]+/.exec(err);
      if (m?.[1] !== undefined) {
        clearTimeout(timer);
        ok({ url: m[0].slice('Open: '.length), origin: m[1], proc });
      }
    });
    proc.on('exit', (code) => {
      fail(new Error(`gamex studio exited (${String(code)}): ${err}`));
    });
  });
}

/** Serves a folder statically, like any web server would host the offline build. */
export function serveStatic(dir: string): Promise<{ origin: string; server: Server }> {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
  };
  const server = createServer((req, res) => {
    const rel =
      decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') ||
      'index.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      .end(readFileSync(file));
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      ok({ origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, server });
    });
  });
}

/** Blocks every request that does not go to `origin`, and records what was blocked. */
export async function offline(context: BrowserContext, origin: string): Promise<string[]> {
  const blocked: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith('blob:') || url.startsWith('data:'))
      return route.continue();
    blocked.push(url);
    return route.abort();
  });
  return blocked;
}

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** WCAG contrast ratio of two CSS rgb() colours. */
export function contrast(a: string, b: string): number {
  const lum = (c: string): number => {
    const [r = 0, g = 0, bl = 0] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const ch = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
