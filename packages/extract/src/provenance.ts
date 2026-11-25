import { locationOf, type Chunk } from '@gamex/ingest';
import type { Evidence } from './schemas.js';

export type Match = 'exact' | 'fuzzy' | 'missing';

export interface VerifiedEvidence {
  readonly source: string;
  readonly location: string;
  /** The source line the quote was found on (verbatim, ≤ 200 characters), or the quote when not found. */
  readonly excerpt: string;
  readonly match: Match;
  readonly chunk?: Chunk;
  readonly line?: number;
}

const MAX_EXCERPT = 200;

/** Lowercase, no markdown emphasis or table pipes, single spaces. */
export function normalizeText(text: string): string {
  return text
    .replace(/[*_`|>#]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function clip(text: string): string {
  const t = text.trim();
  return t.length <= MAX_EXCERPT ? t : `${t.slice(0, MAX_EXCERPT - 1)}…`;
}

function lineAt(chunk: Chunk, line: number): string {
  return chunk.text.split('\n')[line - chunk.startLine] ?? '';
}

function locate(chunk: Chunk, quote: string): { line: number; match: Match } | undefined {
  const lines = chunk.text.split('\n');
  const firstQuoteLine = quote.split('\n').find((l) => l.trim() !== '') ?? quote;
  const exact = lines.findIndex((l) => l.includes(firstQuoteLine.trim()));
  if (exact >= 0 && firstQuoteLine.trim() !== '')
    return { line: chunk.startLine + exact, match: 'exact' };
  const nq = normalizeText(firstQuoteLine);
  if (nq.length < 4) return undefined;
  const fuzzy = lines.findIndex((l) => {
    const nl = normalizeText(l);
    return nl.length > 0 && (nl.includes(nq) || (nl.length >= 12 && nq.includes(nl)));
  });
  return fuzzy >= 0 ? { line: chunk.startLine + fuzzy, match: 'fuzzy' } : undefined;
}

/**
 * Finds an LLM-cited quote in the chunks it names (or, failing that, in other chunks of the same file).
 * The provenance then points at the real line, and its excerpt is the source line itself, so nothing
 * the LLM wrote ends up presented as a quotation.
 */
export function verifyEvidence(
  evidence: Evidence,
  chunks: ReadonlyMap<string, Chunk>,
  byPath: ReadonlyMap<string, readonly Chunk[]>,
): VerifiedEvidence {
  const named = chunks.get(evidence.chunk);
  const path = named?.path ?? evidence.chunk.split('#')[0] ?? evidence.chunk;
  const candidates = [
    ...(named === undefined ? [] : [named]),
    ...(byPath.get(path) ?? []).filter((c) => c !== named),
  ];
  for (const chunk of candidates) {
    const found = locate(chunk, evidence.quote);
    if (found !== undefined) {
      const sourceLine = lineAt(chunk, found.line);
      return {
        source: chunk.path,
        location: locationOf(chunk, found.line),
        excerpt: clip(sourceLine.trim() === '' ? evidence.quote : sourceLine),
        match: found.match,
        chunk,
        line: found.line,
      };
    }
  }
  return {
    source: named?.path ?? (byPath.has(path) ? path : 'gamex:unverified'),
    location: named === undefined ? '' : locationOf(named, named.startLine),
    excerpt: clip(evidence.quote),
    match: 'missing',
    ...(named === undefined ? {} : { chunk: named }),
  };
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  once: 1,
  two: 2,
  twice: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  single: 1,
  double: 2,
  triple: 3,
  triples: 3,
  half: 0.5,
};

/** Every number written in a text: digits ("1,500", "3.99", "25%"), and simple number words. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d[\d,]*(?:\.\d+)?(%?)/g)) {
    const n = Number(m[0].replace(/[,%]/g, ''));
    if (Number.isFinite(n)) {
      out.push(n);
      if (m[1] === '%') out.push(n / 100);
    }
  }
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const n = WORD_NUMBERS[w];
    if (n !== undefined) out.push(n);
  }
  return out;
}

/** True when `value` is written in the text (within floating-point noise). */
export function textStatesNumber(text: string, value: number): boolean {
  return numbersIn(text).some(
    (n) => n === value || Math.abs(n - value) <= 1e-9 * Math.max(1, Math.abs(value)),
  );
}
