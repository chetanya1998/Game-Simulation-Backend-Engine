/**
 * `gamex studio`: a localhost-only HTTP server that serves the studio and gives it safe access to one game
 * repo (ADR 0009). Every /api request needs the per-launch token; requests with a foreign Host or Origin
 * are refused (DNS rebinding, cross-site requests). All repo reads go through @gamex/ingest and all
 * writes go to gamex/ (and the Spec Pack's own targets, via the Spec Pack writer).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ReviewLedgerSchema } from '@gamex/extract';
import { DEFAULT_MAX_BYTES, SafeFileSystem, scanForSecrets } from '@gamex/ingest';
import { formatIssue, validateGameModel } from '@gamex/model';
import { CliError, MODEL_PATH, syncPack } from './commands.js';
import {
  CANDIDATE_PATH,
  REPORT_PATH,
  applyLedger,
  discoverPlan,
  extractStep,
  loadCandidate,
  loadLedger,
  savePlan,
  writeModelFile,
} from './extraction.js';

export const SOURCES_DIR = 'gamex/sources';
const MAX_BODY = 4 * 1024 * 1024;
const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.(md|markdown|txt|pdf|json|yaml|yml|toml)$/;

export interface StudioServerOptions {
  /** The game repo. */
  readonly root: string;
  /** The built studio (index.html + assets). */
  readonly staticDir: string;
  /** 0 = any free port. */
  readonly port?: number;
  /** For tests; normally random per launch. */
  readonly token?: string;
  /** Provider used when the studio does not choose one. */
  readonly provider?: 'anthropic' | 'agent' | 'recorded';
  readonly recordings?: string;
  readonly model?: string;
  readonly log?: (line: string) => void;
}

export interface StudioServer {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly server: Server;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  // Everything the studio needs is served from this origin: no CDN, fonts or analytics.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

function statusOf(error: CliError): number {
  if (error.exitCode === 2) return 400;
  if (error.exitCode === 1) return 422;
  return error.code === 'LLM_ERROR' || error.code === 'NO_API_KEY' ? 502 : 500;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
    parts.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON.');
  }
}

function tokenMatches(expected: string, given: string | undefined): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Starts the studio server; resolves once it is listening. */
export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
  const root = resolve(options.root);
  const staticDir = resolve(options.staticDir);
  const token = options.token ?? randomBytes(24).toString('hex');
  const log = options.log ?? ((): void => undefined);
  let busy: string | undefined;
  let port = 0;

  const allowedHosts = (): string[] => [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`];

  function state(): Record<string, unknown> {
    const modelPath = join(root, MODEL_PATH);
    const modelResult = existsSync(modelPath)
      ? validateGameModel(readFileSync(modelPath, 'utf8'), { source: MODEL_PATH })
      : undefined;
    let candidate: unknown;
    try {
      candidate = existsSync(join(root, CANDIDATE_PATH)) ? loadCandidate(root) : null;
    } catch {
      candidate = null;
    }
    const sourcesDir = join(root, SOURCES_DIR);
    const sources =
      existsSync(sourcesDir) && lstatSync(sourcesDir).isDirectory()
        ? readdirSync(sourcesDir)
            .filter((f) => !f.startsWith('.'))
            .sort()
        : [];
    return {
      mode: 'server',
      repo: root.split(sep).at(-1) ?? root,
      model: modelResult?.model ?? null,
      modelIssues: (modelResult?.issues ?? []).map((i) => ({
        severity: i.severity,
        code: i.code,
        message: formatIssue(i),
      })),
      candidate,
      report: obj(readJsonIfExists(join(root, REPORT_PATH)))['report'] ?? null,
      ledger: loadLedger(root),
      plan: readJsonIfExists(join(root, 'gamex/.work/ingest.json')),
      sources,
      providers: {
        anthropic: (process.env['ANTHROPIC_API_KEY'] ?? '') !== '',
        agent: true,
        recorded: options.recordings !== undefined,
      },
      defaultProvider: options.provider ?? 'anthropic',
      busy: busy ?? null,
    };
  }

  function upload(body: Record<string, unknown>): Record<string, unknown> {
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    const content = typeof body['contentBase64'] === 'string' ? body['contentBase64'] : '';
    if (!UPLOAD_NAME.test(name)) {
      throw new HttpError(
        400,
        'BAD_FILE_NAME',
        `"${name}" is not an allowed file name.`,
        'Use a plain name ending in .md, .txt, .pdf, .json, .yaml or .toml.',
      );
    }
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length === 0) throw new HttpError(400, 'EMPTY_FILE', `${name} is empty.`);
    if (bytes.length > DEFAULT_MAX_BYTES) {
      throw new HttpError(
        413,
        'FILE_TOO_LARGE',
        `${name} is larger than ${String(DEFAULT_MAX_BYTES / 1024)} KB.`,
      );
    }
    const rel = `${SOURCES_DIR}/${name}`;
    const policy = new SafeFileSystem(root).pathPolicy(rel);
    if (policy !== undefined)
      throw new HttpError(400, 'FILE_NOT_ALLOWED', `${rel} would not be read: ${policy}.`);
    if (!name.toLowerCase().endsWith('.pdf')) {
      const secret = scanForSecrets(bytes.toString('utf8'));
      if (secret !== undefined) {
        throw new HttpError(
          400,
          'SECRET_IN_FILE',
          `${name} looks like it contains a secret (${secret.kind}, line ${String(secret.line)}); it was not saved.`,
        );
      }
    }
    const dir = join(root, SOURCES_DIR);
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
      throw new HttpError(
        400,
        'FILE_NOT_ALLOWED',
        `${SOURCES_DIR} is a symbolic link; refusing to write.`,
      );
    }
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(root, rel), bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new HttpError(
          409,
          'FILE_EXISTS',
          `${rel} already exists; uploads never overwrite.`,
          'Rename the file, or delete the old one first.',
        );
      }
      throw error;
    }
    log(`uploaded ${rel} (${String(bytes.length)} bytes)`);
    return { path: rel, bytes: bytes.length };
  }

  async function ingest(
    body: Record<string, unknown>,
    confirm: boolean,
  ): Promise<Record<string, unknown>> {
    const include = Array.isArray(body['include'])
      ? body['include'].filter((x): x is string => typeof x === 'string')
      : [];
    const { plan, estimate } = await discoverPlan(root, include);
    if (!confirm)
      return { files: plan.files, excluded: plan.excluded, totalBytes: plan.totalBytes, estimate };
    // The user confirmed a specific list: it must still be exactly what would be sent.
    const confirmed = Array.isArray(body['files']) ? body['files'].map(obj) : [];
    const want = confirmed.map((f) => `${String(f['path'])}@${String(f['sha256'])}`).sort();
    const have = plan.files.map((f) => `${f.path}@${f.sha256}`).sort();
    if (want.length === 0 || want.join('\n') !== have.join('\n')) {
      throw new HttpError(
        409,
        'PLAN_CHANGED',
        'The files changed since the list was shown; nothing was confirmed.',
        'Review the updated list and confirm again.',
      );
    }
    const saved = savePlan(root, plan, include);
    log(`confirmed ${String(saved.files.length)} file(s) for extraction`);
    return { files: saved.files, excluded: saved.excluded, totalBytes: saved.totalBytes, estimate };
  }

  async function extract(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const provider =
      typeof body['provider'] === 'string' ? body['provider'] : (options.provider ?? 'anthropic');
    if (provider === 'recorded' && options.recordings === undefined) {
      throw new HttpError(
        400,
        'PROVIDER_UNAVAILABLE',
        'Recorded answers are only available when `gamex studio` was started with --recordings.',
      );
    }
    const model =
      typeof body['model'] === 'string' && body['model'].trim() !== ''
        ? body['model']
        : options.model;
    const r = await extractStep(
      { stdout: () => undefined, stderr: () => undefined },
      {
        cwd: root,
        json: true,
        provider,
        ...(options.recordings === undefined ? {} : { recordings: options.recordings }),
        ...(model === undefined ? {} : { model }),
      },
    );
    log(r.done ? 'extraction finished' : 'extraction waiting for agent answers');
    return { done: r.done, ...obj(r.data) };
  }

  function review(body: Record<string, unknown>): Record<string, unknown> {
    const parsed = ReviewLedgerSchema.safeParse(body['ledger']);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'LEDGER_INVALID',
        `Invalid review ledger: ${parsed.error.issues.map((i) => `/${i.path.join('/')}: ${i.message}`).join('; ')}`,
      );
    }
    const r = applyLedger(root, loadCandidate(root), parsed.data);
    log(r.human[0] ?? 'review applied');
    return { ok: r.ok, ...obj(r.data), issues: r.issues };
  }

  function saveModel(body: Record<string, unknown>): Record<string, unknown> {
    const result = validateGameModel(body['model']);
    if (!result.ok || result.model === undefined) {
      throw new HttpError(
        422,
        'MODEL_INVALID',
        `The model has errors: ${result.issues
          .filter((i) => i.severity === 'error')
          .map(formatIssue)
          .slice(0, 5)
          .join('; ')}`,
      );
    }
    const version = writeModelFile(root, result.model);
    log(`saved ${MODEL_PATH} (version ${String(version)})`);
    return { model: MODEL_PATH, modelVersion: version };
  }

  function specPack(body: Record<string, unknown>, write: boolean): Record<string, unknown> {
    const modelPath = join(root, MODEL_PATH);
    if (!existsSync(modelPath))
      throw new HttpError(
        409,
        'NO_MODEL',
        `There is no ${MODEL_PATH} yet.`,
        'Finish the review (or save the model) first.',
      );
    const result = validateGameModel(readFileSync(modelPath, 'utf8'), { source: MODEL_PATH });
    if (result.model === undefined || !result.ok)
      throw new HttpError(422, 'MODEL_INVALID', `${MODEL_PATH} has errors; run validation.`);
    const num = (k: string): string | undefined =>
      typeof body[k] === 'number' ? String(body[k]) : undefined;
    const seed = num('seed');
    const days = num('days');
    const players = num('players');
    const { pack, r } = syncPack(root, result.model, {
      dryRun: !write,
      force: write && body['force'] === true,
      ...(seed === undefined ? {} : { seed }),
      ...(days === undefined ? {} : { days }),
      ...(players === undefined ? {} : { players }),
    });
    if (write)
      log(
        `Spec Pack ${r.written ? 'written' : 'not written'} (${String(r.conflicts.length)} conflicts)`,
      );
    return {
      written: r.written,
      files: r.files,
      conflicts: r.conflicts,
      goldenCases: pack.goldens.reduce((n, g) => n + g.cases.length, 0),
      outputHash: pack.simulation.record.outputHash,
    };
  }

  async function api(method: string, path: string, req: IncomingMessage): Promise<unknown> {
    const body = method === 'GET' ? {} : obj(await readBody(req));
    const route = `${method} ${path}`;
    const exclusive = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
      if (busy !== undefined)
        throw new HttpError(409, 'BUSY', `Another operation is running (${busy}).`);
      busy = name;
      try {
        return await fn();
      } finally {
        busy = undefined;
      }
    };
    switch (route) {
      case 'GET /api/state':
        return state();
      case 'POST /api/upload':
        return exclusive('upload', () => upload(body));
      case 'POST /api/ingest/plan':
        return ingest(body, false);
      case 'POST /api/ingest/confirm':
        return exclusive('ingest', () => ingest(body, true));
      case 'POST /api/extract':
        return exclusive('extract', () => extract(body));
      case 'POST /api/review':
        return exclusive('review', () => review(body));
      case 'PUT /api/model':
        return exclusive('save', () => saveModel(body));
      case 'POST /api/specpack/preview':
        return specPack(body, false);
      case 'POST /api/specpack/write':
        return exclusive('write', () => specPack(body, true));
      default:
        throw new HttpError(404, 'NOT_FOUND', `No such endpoint: ${route}`);
    }
  }

  function serveStatic(path: string, res: ServerResponse): void {
    let rel = decodeURIComponent(path).replace(/^\/+/, '');
    if (rel === '') rel = 'index.html';
    const file = normalize(join(staticDir, rel));
    const inside = file === staticDir || file.startsWith(staticDir + sep);
    const target =
      inside && existsSync(file) && lstatSync(file).isFile() ? file : join(staticDir, 'index.html');
    if (!existsSync(target)) {
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
      res.end('The studio is not built. Run `pnpm build`.');
      return;
    }
    const content = readFileSync(target);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': target.endsWith('index.html')
        ? 'no-store'
        : 'public, max-age=31536000, immutable',
      'content-length': content.length,
    });
    res.end(content);
  }

  const server = createServer((req, res) => {
    const host = req.headers.host ?? '';
    if (!allowedHosts().includes(host)) {
      send(res, 421, {
        ok: false,
        error: { code: 'BAD_HOST', message: 'Requests must use 127.0.0.1 or localhost.' },
      });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts().some((h) => origin === `http://${h}`)) {
      send(res, 403, {
        ok: false,
        error: { code: 'BAD_ORIGIN', message: 'Cross-origin requests are not allowed.' },
      });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);
    const method = req.method ?? 'GET';
    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, { ok: false, error: { code: 'METHOD', message: 'Method not allowed.' } });
        return;
      }
      serveStatic(url.pathname, res);
      return;
    }
    const given = req.headers['x-gamex-token'];
    if (!tokenMatches(token, typeof given === 'string' ? given : undefined)) {
      send(res, 401, {
        ok: false,
        error: {
          code: 'BAD_TOKEN',
          message: 'Missing or wrong studio token.',
          hint: 'Open the URL printed by `gamex studio`.',
        },
      });
      return;
    }
    api(method, url.pathname, req).then(
      (data) => {
        send(res, 200, { ok: true, data });
      },
      (error: unknown) => {
        if (error instanceof HttpError) {
          send(res, error.status, {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.hint === undefined ? {} : { hint: error.hint }),
            },
          });
        } else if (error instanceof CliError) {
          send(res, statusOf(error), {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.hint === undefined ? {} : { hint: error.hint }),
            },
          });
        } else {
          log(`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
          send(res, 500, {
            ok: false,
            error: {
              code: 'INTERNAL',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );
  });
  server.requestTimeout = 0; // extraction can take minutes

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      ok();
    });
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${String(port)}/#token=${token}`,
    port,
    token,
    server,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => {
          ok();
        });
      }),
  };
}

/** Where the built studio is: next to the CLI bundle (dist/studio) or, in development, apps/studio/dist. */
export function defaultStaticDir(): string {
  const candidates = [
    new URL('./studio/', import.meta.url),
    new URL('../../../apps/studio/dist/', import.meta.url),
  ];
  for (const c of candidates) {
    const p = c.pathname;
    if (existsSync(join(p, 'index.html'))) return p;
  }
  return candidates[0]?.pathname ?? '';
}
