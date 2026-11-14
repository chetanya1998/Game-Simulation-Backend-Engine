import type { Span } from './ast.js';
import { exprError, type ExprError } from './errors.js';

export type TokenKind = 'number' | 'string' | 'bool' | 'ident' | 'punct' | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** Source text of the token (for `punct`, the operator itself). */
  readonly text: string;
  readonly span: Span;
  /** Decoded value for number, string and bool tokens. */
  readonly value?: number | string | boolean;
}

export class LexError extends Error {
  constructor(readonly detail: ExprError) {
    super(detail.message);
  }
}

const PUNCTUATION = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '(',
  ')',
  ',',
  '?',
  ':',
  '!',
  '-',
  '+',
  '*',
  '/',
  '%',
  '<',
  '>',
];
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/** Splits an expression into tokens. Identifiers may contain dots (`persona.skill`). */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const at = (k: number): string => source.charAt(k);

  while (i < source.length) {
    const ch = at(i);
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const start = i;

    if (DIGIT.test(ch)) {
      while (DIGIT.test(at(i))) i++;
      if (at(i) === '.' && DIGIT.test(at(i + 1))) {
        i++;
        while (DIGIT.test(at(i))) i++;
      }
      if (at(i) === 'e' || at(i) === 'E') {
        let j = i + 1;
        if (at(j) === '+' || at(j) === '-') j++;
        if (!DIGIT.test(at(j))) {
          throw new LexError(
            exprError(
              'EXPR_INVALID_NUMBER',
              `Invalid number "${source.slice(start, j)}"`,
              { start, end: j },
              'An exponent needs digits, e.g. 1e6.',
            ),
          );
        }
        i = j;
        while (DIGIT.test(at(i))) i++;
      }
      if (IDENT_START.test(at(i))) {
        throw new LexError(
          exprError(
            'EXPR_INVALID_NUMBER',
            `Invalid number "${source.slice(start, i + 1)}"`,
            { start, end: i + 1 },
            'Identifiers cannot start with a digit.',
          ),
        );
      }
      const text = source.slice(start, i);
      tokens.push({ kind: 'number', text, span: { start, end: i }, value: Number(text) });
      continue;
    }

    if (ch === '"') {
      i++;
      while (i < source.length && at(i) !== '"') {
        if (at(i) === '\\') i++;
        i++;
      }
      if (i >= source.length) {
        throw new LexError(
          exprError(
            'EXPR_UNTERMINATED_STRING',
            'Unterminated string literal',
            { start, end: source.length },
            'Close the string with a double quote (").',
          ),
        );
      }
      i++;
      const text = source.slice(start, i);
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new LexError(
          exprError(
            'EXPR_INVALID_STRING',
            `Invalid string literal ${text}`,
            { start, end: i },
            'Use JSON escapes only: \\" \\\\ \\n \\t \\uXXXX.',
          ),
        );
      }
      tokens.push({ kind: 'string', text, span: { start, end: i }, value: value as string });
      continue;
    }

    if (IDENT_START.test(ch)) {
      while (IDENT_PART.test(at(i)) || (at(i) === '.' && IDENT_START.test(at(i + 1)))) i++;
      const text = source.slice(start, i);
      if (text === 'true' || text === 'false') {
        tokens.push({ kind: 'bool', text, span: { start, end: i }, value: text === 'true' });
      } else {
        tokens.push({ kind: 'ident', text, span: { start, end: i } });
      }
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct !== undefined) {
      i += punct.length;
      tokens.push({ kind: 'punct', text: punct, span: { start, end: i } });
      continue;
    }

    const hints: Record<string, string> = {
      '=': 'Use == to compare values; expressions cannot assign.',
      '&': 'Use && for "and".',
      '|': 'Use || for "or".',
      "'": 'Use double quotes for strings, e.g. "s11-victory".',
    };
    throw new LexError(
      exprError(
        'EXPR_UNEXPECTED_CHARACTER',
        `Unexpected character "${ch}"`,
        { start, end: start + 1 },
        hints[ch],
      ),
    );
  }

  tokens.push({ kind: 'eof', text: '', span: { start: source.length, end: source.length } });
  return tokens;
}
