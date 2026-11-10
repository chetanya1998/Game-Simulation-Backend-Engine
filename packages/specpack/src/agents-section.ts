/**
 * Management of the delimited GameX section inside a target repo's AGENTS.md
 * (master prompt §9, ARCHITECTURE §6). Content outside the markers is preserved byte-for-byte.
 */

export const SECTION_BEGIN = '<!-- GAMEX:BEGIN v1 -->';
export const SECTION_END = '<!-- GAMEX:END -->';

const BEGIN_PATTERN = /<!-- GAMEX:BEGIN v\d+ -->/g;

export class SectionMarkerError extends Error {
  override readonly name = 'SectionMarkerError';
}

function countMatches(text: string, pattern: RegExp | string): number {
  if (typeof pattern === 'string') return text.split(pattern).length - 1;
  return [...text.matchAll(pattern)].length;
}

/**
 * Inserts or replaces the GameX section in `existing` (the current AGENTS.md, or `undefined` if the
 * file does not exist) and returns the new file content. Idempotent: applying it twice with the same
 * body yields the same text.
 *
 * @throws {SectionMarkerError} if the file contains unbalanced or duplicated markers.
 */
export function upsertAgentsSection(existing: string | undefined, body: string): string {
  const eol = existing?.includes('\r\n') === true ? '\r\n' : '\n';
  const normalizedBody = body.replace(/\r?\n/g, eol).replace(/(\r?\n)+$/, '');
  const block = `${SECTION_BEGIN}${eol}${normalizedBody}${eol}${SECTION_END}`;

  if (existing === undefined || existing.length === 0) return `${block}${eol}`;

  const begins = countMatches(existing, BEGIN_PATTERN);
  const ends = countMatches(existing, SECTION_END);
  if (begins === 0 && ends === 0) {
    const separator = existing.endsWith(`${eol}${eol}`)
      ? ''
      : existing.endsWith(eol)
        ? eol
        : `${eol}${eol}`;
    return `${existing}${separator}${block}${eol}`;
  }
  if (begins !== 1 || ends !== 1) {
    throw new SectionMarkerError(
      `AGENTS.md has ${String(begins)} GameX begin marker(s) and ${String(ends)} end marker(s); expected exactly one of each. ` +
        `Fix the file by keeping a single "${SECTION_BEGIN}" … "${SECTION_END}" block (or removing both markers), then re-run sync.`,
    );
  }
  const start = existing.search(BEGIN_PATTERN);
  const endIndex = existing.indexOf(SECTION_END);
  if (endIndex < start) {
    throw new SectionMarkerError(
      `AGENTS.md has the GameX end marker before the begin marker. Move "${SECTION_END}" after "${SECTION_BEGIN}", then re-run sync.`,
    );
  }
  return existing.slice(0, start) + block + existing.slice(endIndex + SECTION_END.length);
}
