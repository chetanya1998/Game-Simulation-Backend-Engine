import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { matchDenyList } from './deny-list.js';
import { scanForSecrets } from './secrets.js';

/** File extensions GameX may read (design docs, configs, tuning code). */
export const ALLOWED_EXTENSIONS = [
  'md',
  'markdown',
  'txt',
  'pdf',
  'json',
  'yaml',
  'yml',
  'toml',
  'asset',
  'cs',
  'gd',
  'ts',
  'js',
  'lua',
] as const;

/** Directories never entered (build output, dependencies, engine caches, our own output). */
export const SKIPPED_DIRECTORIES = [
  '.git',
  'node_modules',
  'Library',
  'Temp',
  'Logs',
  'obj',
  'bin',
  'build',
  'Build',
  'dist',
  'out',
  '.gradle',
  '.idea',
  '.vscode',
  'gamex',
] as const;

export const DEFAULT_MAX_BYTES = 256 * 1024;

export interface ExcludedFile {
  readonly path: string;
  readonly reason: string;
}

export interface RepoFile {
  readonly path: string;
  readonly bytes: number;
  readonly extension: string;
}

export class UnsafeReadError extends Error {
  override readonly name = 'UnsafeReadError';
}

export interface SafeFileSystemOptions {
  readonly maxBytes?: number;
}

const toPosix = (p: string): string => p.split(sep).join('/');

/**
 * The only way GameX reads a target repo. Every read honours `.gitignore` and `.gamexignore` (in every
 * directory), the hard deny-list (secrets, keys, credentials), the extension allowlist, a size cap, never
 * follows symlinks, and scans text for secrets. A file that fails any check is never returned.
 */
function entriesOf(dir: string) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
}

export class SafeFileSystem {
  readonly root: string;
  readonly maxBytes: number;
  private readonly ignores = new Map<string, Ignore>();

  constructor(root: string, options: SafeFileSystemOptions = {}) {
    this.root = root;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  private ignoreFor(dirRel: string): Ignore {
    const cached = this.ignores.get(dirRel);
    if (cached !== undefined) return cached;
    const ig = ignore();
    for (const name of ['.gitignore', '.gamexignore']) {
      const file = join(this.root, dirRel, name);
      if (existsSync(file) && lstatSync(file).isFile()) ig.add(readFileSync(file, 'utf8'));
    }
    this.ignores.set(dirRel, ig);
    return ig;
  }

  /** Why GameX may not read a path, by name and location only (no content read); undefined if it may. */
  pathPolicy(relPath: string, isDirectory = false): string | undefined {
    const parts = relPath.split('/');
    if (parts.some((p) => p === '..' || p === '')) return 'outside the repository';
    // gamex/ holds GameX's own output and is skipped, except gamex/sources/ (documents uploaded in the studio).
    const inSources = parts[0] === 'gamex' && parts[1] === 'sources';
    for (const [i, p] of parts.slice(0, isDirectory ? parts.length : -1).entries())
      if ((SKIPPED_DIRECTORIES as readonly string[]).includes(p) && !(inSources && i === 0))
        return `inside ${p}/`;
    const denied = matchDenyList(relPath);
    if (denied !== undefined) return `denied: ${denied.reason}`;
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const rest = parts.slice(i).join('/') + (isDirectory && i === parts.length - 1 ? '/' : '');
      if (this.ignoreFor(dir).ignores(rest)) return 'ignored by .gitignore';
    }
    if (!isDirectory) {
      const ext = (parts.at(-1) ?? '').split('.').pop()?.toLowerCase() ?? '';
      if (
        !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext) ||
        !(parts.at(-1) ?? '').includes('.')
      )
        return `extension not allowed`;
    }
    return undefined;
  }

  /** Lists readable files and everything excluded (with the reason), in a stable order. */
  list(): { files: RepoFile[]; excluded: ExcludedFile[] } {
    const files: RepoFile[] = [];
    const excluded: ExcludedFile[] = [];
    const walk = (dirRel: string): void => {
      const entries = entriesOf(join(this.root, dirRel));
      for (const e of entries) {
        const rel = dirRel === '' ? e.name : `${dirRel}/${e.name}`;
        if (e.isSymbolicLink()) {
          excluded.push({ path: rel, reason: 'symbolic link (never followed)' });
          continue;
        }
        if (e.isDirectory()) {
          if (rel === 'gamex') {
            const sources = entriesOf(join(this.root, 'gamex')).find((x) => x.name === 'sources');
            if (sources?.isSymbolicLink() === true)
              excluded.push({ path: 'gamex/sources', reason: 'symbolic link (never followed)' });
            else if (
              sources?.isDirectory() === true &&
              this.pathPolicy('gamex/sources', true) === undefined
            )
              walk('gamex/sources');
            continue;
          }
          const why = this.pathPolicy(rel, true);
          if (why === undefined) walk(rel);
          else if (!(SKIPPED_DIRECTORIES as readonly string[]).includes(e.name))
            excluded.push({ path: `${rel}/`, reason: why });
          continue;
        }
        if (!e.isFile()) continue;
        const why = this.pathPolicy(rel);
        if (why !== undefined) {
          excluded.push({ path: rel, reason: why });
          continue;
        }
        const bytes = lstatSync(join(this.root, rel)).size;
        if (bytes > this.maxBytes) {
          excluded.push({
            path: rel,
            reason: `larger than ${String(Math.round(this.maxBytes / 1024))} KB`,
          });
          continue;
        }
        files.push({ path: rel, bytes, extension: (e.name.split('.').pop() ?? '').toLowerCase() });
      }
    };
    walk('');
    return { files, excluded };
  }

  /** Reads a file as bytes after re-checking every rule. Throws UnsafeReadError otherwise. */
  readBytes(relPath: string): Uint8Array {
    const rel = toPosix(relative(this.root, join(this.root, relPath)));
    const why = this.pathPolicy(rel);
    if (why !== undefined) throw new UnsafeReadError(`Refusing to read ${relPath}: ${why}`);
    const full = join(this.root, rel);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new UnsafeReadError(`Refusing to read ${relPath}: not a regular file`);
    if (stat.size > this.maxBytes)
      throw new UnsafeReadError(`Refusing to read ${relPath}: larger than the size cap`);
    return readFileSync(full);
  }

  /** Reads a text file after every rule, including the secret scan. Throws UnsafeReadError otherwise. */
  readText(relPath: string, expectedSha256?: string): string {
    const bytes = this.readBytes(relPath);
    if (expectedSha256 !== undefined) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256)
        throw new UnsafeReadError(
          `Refusing to read ${relPath}: it changed after the ingest plan was confirmed. Run \`gamex ingest\` again.`,
        );
    }
    const text = Buffer.from(bytes).toString('utf8');
    const secret = scanForSecrets(text);
    if (secret !== undefined)
      throw new UnsafeReadError(
        `Refusing to read ${relPath}: looks like it contains a secret (${secret.kind}, line ${String(secret.line)})`,
      );
    return text;
  }
}
