import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { SECTION_END, upsertAgentsSection } from '../agents-section.js';
import { GENERATED_HEADER } from '../golden/generate.js';
import type { SpecPack } from '../pack.js';
import { mergeEditable, withoutEditable, type Ownership } from '../render/common.js';

export const LOCK_PATH = 'gamex/.gamex-lock.json';
const ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);

export class UnsafePathError extends Error {
  override readonly name = 'UnsafePathError';
}

/** Spec Pack writes stay inside gamex/, plus AGENTS.md (section) and the shims. Throws otherwise. */
export function assertAllowedPath(path: string): void {
  const n = normalize(path).split(sep).join('/');
  if (
    n !== path ||
    path.startsWith('/') ||
    path.split('/').includes('..') ||
    !(path.startsWith('gamex/') || ROOT_FILES.has(path))
  ) {
    throw new UnsafePathError(
      `Refusing to write "${path}": the Spec Pack may only write inside gamex/ and the delimited section of AGENTS.md.`,
    );
  }
}

export type FileAction = 'create' | 'update' | 'unchanged' | 'delete' | 'conflict' | 'skip';

export interface PlannedFile {
  readonly path: string;
  readonly action: FileAction;
  readonly reason?: string;
}

export interface WriteResult {
  readonly written: boolean;
  readonly files: readonly PlannedFile[];
  readonly conflicts: readonly PlannedFile[];
}

export interface WriteOptions {
  /** Overwrite files that were edited by hand (their managed parts). */
  readonly force?: boolean;
  /** Plan only; write nothing. */
  readonly dryRun?: boolean;
}

interface Lock {
  readonly files: Record<string, string>;
}

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function sectionBody(text: string): string | undefined {
  const start = text.search(/<!-- GAMEX:BEGIN v\d+ -->/);
  const end = text.indexOf(SECTION_END);
  return start < 0 || end < start ? undefined : text.slice(start, end + SECTION_END.length);
}

/** The part of a file GameX manages — what the lock fingerprints and what counts as a hand edit. */
function managed(ownership: Ownership, text: string): string {
  if (ownership === 'editable') return withoutEditable(text);
  if (ownership === 'section') return sectionBody(text) ?? '';
  return text;
}

function readIfFile(root: string, path: string): string | undefined {
  const full = join(root, path);
  if (!existsSync(full)) return undefined;
  const stat = lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new UnsafePathError(
      `Refusing to touch "${path}": it is not a regular file (symlink or directory).`,
    );
  return readFileSync(full, 'utf8');
}

function readLock(root: string): Lock {
  const text = readIfFile(root, LOCK_PATH);
  if (text === undefined) return { files: {} };
  try {
    const parsed = JSON.parse(text) as { files?: Record<string, string> };
    return { files: parsed.files ?? {} };
  } catch {
    return { files: {} };
  }
}

function writeAtomic(root: string, path: string, content: string): void {
  const full = join(root, path);
  for (let dir = dirname(full); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink())
      throw new UnsafePathError(`Refusing to write through the symlinked directory "${dir}".`);
  }
  mkdirSync(dirname(full), { recursive: true });
  const tmp = `${full}.gamex-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, full);
}

/**
 * Writes a rendered Spec Pack into a repo. Plans every file first; if any file was edited by hand where GameX
 * manages it, nothing is written (unless `force`). Idempotent: writing the same pack twice changes nothing.
 */
export function writeSpecPack(
  root: string,
  pack: SpecPack,
  options: WriteOptions = {},
): WriteResult {
  const lock = readLock(root);
  const planned: PlannedFile[] = [];
  const writes = new Map<string, string>();
  const newLock: Record<string, string> = {};

  const entries = [...pack.files].map(([path, f]) => ({ path, ...f }));
  const existingAgents = readIfFile(root, 'AGENTS.md');
  entries.push({
    path: 'AGENTS.md',
    ownership: 'section',
    content: upsertAgentsSection(existingAgents, pack.agentsSection),
  });

  for (const { path, ownership, content } of entries) {
    assertAllowedPath(path);
    const current = readIfFile(root, path);
    if (ownership === 'create-if-missing') {
      if (current === undefined) {
        planned.push({ path, action: 'create' });
        writes.set(path, content);
      } else planned.push({ path, action: 'skip', reason: 'exists (created only if missing)' });
      continue;
    }
    const next =
      ownership === 'editable' && current !== undefined ? mergeEditable(content, current) : content;
    if (ownership !== 'source') newLock[path] = sha(managed(ownership, next));
    if (current === undefined) {
      planned.push({ path, action: 'create' });
      writes.set(path, next);
      continue;
    }
    if (current === next) {
      planned.push({ path, action: 'unchanged' });
      continue;
    }
    if (ownership !== 'source') {
      const now = sha(managed(ownership, current));
      const before = lock.files[path];
      const handEdited =
        before === undefined
          ? ownership !== 'section' || sectionBody(current) !== undefined
          : now !== before;
      if (handEdited && now !== newLock[path] && options.force !== true) {
        planned.push({
          path,
          action: 'conflict',
          reason:
            before === undefined
              ? 'exists but was not written by GameX'
              : 'edited by hand since the last sync (only GAMEX:EDITABLE regions are kept)',
        });
        continue;
      }
    }
    planned.push({ path, action: 'update' });
    writes.set(path, next);
  }

  const deletes: string[] = [];
  for (const path of Object.keys(lock.files).sort()) {
    if (path in newLock) continue;
    assertAllowedPath(path);
    const current = readIfFile(root, path);
    if (current === undefined) continue;
    const recorded = lock.files[path];
    if (
      sha(current) === recorded ||
      sha(withoutEditable(current)) === recorded ||
      sha(sectionBody(current) ?? '') === recorded ||
      options.force === true
    ) {
      planned.push({ path, action: 'delete' });
      deletes.push(path);
    } else
      planned.push({
        path,
        action: 'conflict',
        reason: 'no longer generated, but edited by hand — delete it yourself',
      });
  }

  const conflicts = planned.filter((p) => p.action === 'conflict');
  const lockText = `${JSON.stringify({ $comment: GENERATED_HEADER, version: 1, files: Object.fromEntries(Object.entries(newLock).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2)}\n`;
  if (readIfFile(root, LOCK_PATH) !== lockText) writes.set(LOCK_PATH, lockText);
  const written = conflicts.length === 0 && options.dryRun !== true;
  if (written) {
    for (const [path, content] of writes) writeAtomic(root, path, content);
    for (const path of deletes) rmSync(join(root, path));
  }
  return { written, files: planned, conflicts };
}
