import { canonicalStringify } from '@gamex/model';
import { GENERATED_HEADER } from '../golden/generate.js';

export { GENERATED_HEADER };

/**
 * How the writer treats a file:
 * - generated: owned by GameX; hand edits are reported as conflicts.
 * - editable: generated, but `<!-- GAMEX:EDITABLE name -->` regions keep the user's text.
 * - section: only the delimited GameX block of the file is managed (AGENTS.md).
 * - create-if-missing: written once, never touched again (CLAUDE.md, GEMINI.md shims).
 * - source: the Game Model itself — always written in canonical form.
 */
export type Ownership = 'generated' | 'editable' | 'section' | 'create-if-missing' | 'source';

export interface PackFile {
  readonly content: string;
  readonly ownership: Ownership;
}

export type FileMap = Map<string, PackFile>;

export const MD_HEADER = `<!-- ${GENERATED_HEADER} -->`;

export function jsonFile(value: Record<string, unknown>): string {
  return canonicalStringify({ $comment: GENERATED_HEADER, ...value });
}

export function editable(name: string, defaultText: string): string {
  return `<!-- GAMEX:EDITABLE ${name} -->\n${defaultText}\n<!-- GAMEX:END-EDITABLE ${name} -->`;
}

const REGION =
  /<!-- GAMEX:EDITABLE ([a-z0-9-]+) -->\n?([\s\S]*?)\n?<!-- GAMEX:END-EDITABLE \1 -->/g;

/** Editable regions of a file by name. */
export function editableRegions(text: string): Map<string, string> {
  return new Map([...text.matchAll(REGION)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

/** Replaces the regions of `generated` with the text the user wrote in `existing`. */
export function mergeEditable(generated: string, existing: string): string {
  const keep = editableRegions(existing);
  return generated.replace(REGION, (whole, name: string) =>
    keep.has(name)
      ? `<!-- GAMEX:EDITABLE ${name} -->\n${keep.get(name) ?? ''}\n<!-- GAMEX:END-EDITABLE ${name} -->`
      : whole,
  );
}

/** The GameX-managed part of an editable file: regions emptied. */
export function withoutEditable(text: string): string {
  return text.replace(
    REGION,
    (_w, name: string) => `<!-- GAMEX:EDITABLE ${name} -->\n<!-- GAMEX:END-EDITABLE ${name} -->`,
  );
}

export function mdTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const esc = (v: string | number): string =>
    String(v).replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

export function code(text: string): string {
  return `\`${text.replaceAll('`', "'")}\``;
}

export function snake(id: string): string {
  return id.replaceAll('-', '_');
}

export function constCase(id: string): string {
  return id.toUpperCase().replaceAll('-', '_');
}
