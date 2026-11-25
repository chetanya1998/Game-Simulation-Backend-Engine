import { createHash } from 'node:crypto';
import { scanForSecrets } from './secrets.js';
import {
  SafeFileSystem,
  type ExcludedFile,
  type RepoFile,
  type SafeFileSystemOptions,
} from './safe-fs.js';

export type InputKind = 'design' | 'config' | 'code';

export interface PlannedInput {
  readonly path: string;
  readonly kind: InputKind;
  readonly bytes: number;
  readonly sha256: string;
  readonly reason: string;
}

/** Exactly which files would be read and sent, and why — shown to the user before any LLM call. */
export interface IngestPlan {
  readonly root: string;
  readonly files: readonly PlannedInput[];
  readonly excluded: readonly ExcludedFile[];
  readonly totalBytes: number;
}

const DESIGN_NAME = /(gdd|design|spec|concept|pitch|brief|economy|monetization|monetisation)/i;
const CONFIG_NAME =
  /(config|balance|tuning|economy|settings|level|shop|reward|ads|monet|progression|loot|store|upgrade)/i;
const CODE_NAME =
  /(tuning|config|constants|balance|economy|settings|rewards?|ads?manager|progression)/i;
const SKIP_NAME =
  /^(package(-lock)?\.json|tsconfig.*\.json|pnpm-lock\.yaml|yarn\.lock|\.eslintrc.*|\.prettierrc.*|composer\.json|manifest\.json|.*\.min\.js)$/i;

function classify(
  file: RepoFile,
  text: () => string,
): { kind: InputKind; reason: string } | undefined {
  const name = file.path.split('/').pop() ?? file.path;
  if (SKIP_NAME.test(name)) return undefined;
  const inDocs = /(^|\/)(docs?|design|gdd)\//i.test(file.path);
  switch (file.extension) {
    case 'md':
    case 'markdown':
    case 'txt':
    case 'pdf':
      if (file.path.toLowerCase() === 'readme.md')
        return { kind: 'design', reason: 'project README' };
      if (DESIGN_NAME.test(name)) return { kind: 'design', reason: 'design-document name' };
      if (inDocs) return { kind: 'design', reason: 'in a docs/design folder' };
      return undefined;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'asset':
      if (CONFIG_NAME.test(name)) return { kind: 'config', reason: 'balance/config name' };
      if (/(^|\/)(config|configs|data|balance|tuning)\//i.test(file.path))
        return { kind: 'config', reason: 'in a config/data folder' };
      return undefined;
    default: {
      if (CODE_NAME.test(name)) return { kind: 'code', reason: 'tuning/config code name' };
      const numericConstants = (
        text().match(
          /\b(?:const|static\s+readonly|readonly|export\s+const|var|let)\b[^=\n]*=\s*-?\d+(?:\.\d+)?f?\s*[;,\n]/g,
        ) ?? []
      ).length;
      if (numericConstants >= 5)
        return { kind: 'code', reason: `${String(numericConstants)} numeric constants` };
      return undefined;
    }
  }
}

export interface DiscoverOptions extends SafeFileSystemOptions {
  /** Extra files to include even if the heuristics would skip them (still subject to every safety rule). */
  readonly include?: readonly string[];
}

/**
 * Finds the files of a repo that likely describe the game (design docs, balance configs, tuning code).
 * Only files that pass every SafeFileSystem rule can appear in the plan; files whose text looks like it holds a
 * secret are moved to `excluded`.
 */
export function discoverInputs(root: string, options: DiscoverOptions = {}): IngestPlan {
  const fs = new SafeFileSystem(root, options);
  const { files, excluded } = fs.list();
  const out: PlannedInput[] = [];
  const skipped: ExcludedFile[] = [...excluded];
  const forced = new Set(options.include ?? []);
  for (const f of files) {
    let text: string | undefined;
    const readText = (): string =>
      (text ??= f.extension === 'pdf' ? '' : Buffer.from(fs.readBytes(f.path)).toString('utf8'));
    const c =
      classify(f, readText) ??
      (forced.has(f.path)
        ? {
            kind: (['md', 'txt', 'pdf', 'markdown'].includes(f.extension)
              ? 'design'
              : 'config') as InputKind,
            reason: 'requested with --include',
          }
        : undefined);
    if (c === undefined) continue;
    if (f.extension !== 'pdf') {
      const secret = scanForSecrets(readText());
      if (secret !== undefined) {
        skipped.push({
          path: f.path,
          reason: `looks like it contains a secret (${secret.kind}, line ${String(secret.line)})`,
        });
        continue;
      }
    }
    const bytes = fs.readBytes(f.path);
    out.push({
      path: f.path,
      kind: c.kind,
      bytes: f.bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      reason: c.reason,
    });
  }
  for (const p of forced)
    if (!out.some((f) => f.path === p) && !skipped.some((s) => s.path === p))
      skipped.push({ path: p, reason: 'requested with --include but not found or not allowed' });
  const order: Record<InputKind, number> = { design: 0, config: 1, code: 2 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || (a.path < b.path ? -1 : 1));
  skipped.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { root, files: out, excluded: skipped, totalBytes: out.reduce((n, f) => n + f.bytes, 0) };
}
