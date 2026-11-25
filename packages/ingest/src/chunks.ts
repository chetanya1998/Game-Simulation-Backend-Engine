import { createHash } from 'node:crypto';
import { SafeFileSystem, UnsafeReadError } from './safe-fs.js';
import type { IngestPlan, InputKind } from './discover.js';

/** A located piece of an input file. `id` is stable and is what the LLM cites as evidence. */
export interface Chunk {
  readonly id: string;
  readonly path: string;
  readonly kind: InputKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly page?: number;
  /** Markdown section path, e.g. "7 Monetization › 7.2 Interstitial". */
  readonly heading?: string;
  readonly text: string;
}

const MAX_CHUNK_CHARS = 6000;
const CODE_WINDOW = 150;

function splitLines(
  path: string,
  kind: InputKind,
  lines: readonly string[],
  start: number,
  end: number,
  heading?: string,
): Chunk[] {
  const out: Chunk[] = [];
  let from = start;
  while (from <= end) {
    let to = from;
    let size = 0;
    while (
      to <= end &&
      (to === from || size + (lines[to - 1] ?? '').length + 1 <= MAX_CHUNK_CHARS) &&
      to - from < (kind === 'design' ? 400 : CODE_WINDOW)
    ) {
      size += (lines[to - 1] ?? '').length + 1;
      to++;
    }
    const text = lines.slice(from - 1, to - 1).join('\n');
    if (text.trim() !== '') {
      out.push({
        id: `${path}#L${String(from)}-${String(to - 1)}`,
        path,
        kind,
        startLine: from,
        endLine: to - 1,
        ...(heading === undefined ? {} : { heading }),
        text,
      });
    }
    from = to;
  }
  return out;
}

/** Markdown: one chunk per level-2 section (split further if long), carrying the heading path. */
function markdownChunks(path: string, kind: InputKind, text: string): Chunk[] {
  const lines = text.split('\n');
  const starts: { line: number; heading: string }[] = [];
  const stack: string[] = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,3})\s+(.*)$/.exec(l);
    if (m === null) return;
    const level = (m[1] ?? '').length;
    stack.length = level - 1;
    stack[level - 1] = (m[2] ?? '').trim();
    if (level <= 2) starts.push({ line: i + 1, heading: stack.filter(Boolean).join(' › ') });
  });
  if (starts.length === 0 || starts[0]?.line !== 1) starts.unshift({ line: 1, heading: '' });
  const out: Chunk[] = [];
  starts.forEach((s, i) => {
    const end = (starts[i + 1]?.line ?? lines.length + 1) - 1;
    out.push(
      ...splitLines(path, kind, lines, s.line, end, s.heading === '' ? undefined : s.heading),
    );
  });
  return out;
}

async function pdfChunks(path: string, kind: InputKind, bytes: Uint8Array): Promise<Chunk[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages
    .map((t, i) => ({
      id: `${path}#p${String(i + 1)}`,
      path,
      kind,
      startLine: 1,
      endLine: t.split('\n').length,
      page: i + 1,
      text: t,
    }))
    .filter((c) => c.text.trim() !== '');
}

/** Reads every planned file through the SafeFileSystem and splits it into located chunks. */
export async function readChunks(
  plan: IngestPlan,
  options: { readonly maxBytes?: number } = {},
): Promise<Chunk[]> {
  const fs = new SafeFileSystem(plan.root, options);
  const out: Chunk[] = [];
  for (const f of plan.files) {
    if (f.path.toLowerCase().endsWith('.pdf')) {
      const bytes = fs.readBytes(f.path);
      if (createHash('sha256').update(bytes).digest('hex') !== f.sha256)
        throw new UnsafeReadError(
          `Refusing to read ${f.path}: it changed after the ingest plan was confirmed. Run \`gamex ingest\` again.`,
        );
      out.push(...(await pdfChunks(f.path, f.kind, bytes)));
      continue;
    }
    const text = fs.readText(f.path, f.sha256).replace(/\r\n/g, '\n');
    if (/\.(md|markdown)$/i.test(f.path)) out.push(...markdownChunks(f.path, f.kind, text));
    else {
      const lines = text.split('\n');
      out.push(...splitLines(f.path, f.kind, lines, 1, lines.length));
    }
  }
  return out;
}

/** Location text for provenance: "§7.2 / line 150" (nearest numbered heading above the line), "line 12", "p.3". */
export function locationOf(chunk: Chunk, line: number): string {
  if (chunk.page !== undefined) return `p.${String(chunk.page)}`;
  const lines = chunk.text.split('\n').slice(0, Math.max(0, line - chunk.startLine + 1));
  let section = /(\d+(?:\.\d+)*)\.?\s/.exec(chunk.heading?.split(' › ').at(-1) ?? '')?.[1];
  for (const l of lines) {
    const m = /^#{1,4}\s+(\d+(?:\.\d+)*)\.?\s/.exec(l);
    if (m !== null) section = m[1];
  }
  return section !== undefined ? `§${section} / line ${String(line)}` : `line ${String(line)}`;
}
