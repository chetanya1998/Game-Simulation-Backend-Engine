import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SECTION_BEGIN,
  SECTION_END,
  SectionMarkerError,
  upsertAgentsSection,
} from '@gamex/specpack';

const body = '## GameX\n\n- Never hardcode economy values.';

describe('upsertAgentsSection', () => {
  it('creates the section when AGENTS.md does not exist', () => {
    expect(upsertAgentsSection(undefined, body)).toBe(
      `${SECTION_BEGIN}\n${body}\n${SECTION_END}\n`,
    );
  });

  it('appends after existing content, preserving it', () => {
    const existing = '# My game\n\nHouse rules.\n';
    const out = upsertAgentsSection(existing, body);
    expect(out.startsWith(existing)).toBe(true);
    expect(out).toBe(`${existing}\n${SECTION_BEGIN}\n${body}\n${SECTION_END}\n`);
  });

  it('replaces only the delimited block', () => {
    const before = '# Top\n\n';
    const after = '\n\n## Footer\nkeep me\n';
    const existing = `${before}${SECTION_BEGIN}\nold\n${SECTION_END}${after}`;
    expect(upsertAgentsSection(existing, body)).toBe(
      `${before}${SECTION_BEGIN}\n${body}\n${SECTION_END}${after}`,
    );
  });

  it('upgrades an older marker version', () => {
    const existing = `<!-- GAMEX:BEGIN v0 -->\nold\n${SECTION_END}\n`;
    expect(upsertAgentsSection(existing, body)).toBe(`${SECTION_BEGIN}\n${body}\n${SECTION_END}\n`);
  });

  it('keeps CRLF line endings when the file uses them', () => {
    const out = upsertAgentsSection('# Top\r\n', 'a\nb');
    expect(out).toBe(`# Top\r\n\r\n${SECTION_BEGIN}\r\na\r\nb\r\n${SECTION_END}\r\n`);
  });

  it('rejects duplicated or unbalanced markers with an actionable message', () => {
    expect(() => upsertAgentsSection(`${SECTION_BEGIN}\nx\n`, body)).toThrow(SectionMarkerError);
    expect(() =>
      upsertAgentsSection(
        `${SECTION_BEGIN}\n${SECTION_END}\n${SECTION_BEGIN}\n${SECTION_END}`,
        body,
      ),
    ).toThrow(/expected exactly one of each/);
    expect(() => upsertAgentsSection(`${SECTION_END}\n${SECTION_BEGIN}\n`, body)).toThrow(
      /end marker before the begin marker/,
    );
  });

  const text = fc.string().filter((s) => !s.includes('GAMEX:') && !s.includes('\r'));

  it('is idempotent and preserves surrounding content (property)', () => {
    fc.assert(
      fc.property(text, text, (existing, newBody) => {
        const once = upsertAgentsSection(existing, newBody);
        expect(upsertAgentsSection(once, newBody)).toBe(once);
        if (existing.length > 0) expect(once.startsWith(existing)).toBe(true);
      }),
    );
  });
});
