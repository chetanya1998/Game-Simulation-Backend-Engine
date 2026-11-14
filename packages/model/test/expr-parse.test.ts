import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseExpr, printExpr, tokenize, type Expr } from '@gamex/model';
import { boolExpr, numExpr, stripSpans } from './helpers/arbitraries.ts';

function parse(source: string): Expr {
  const r = parseExpr(source);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe('tokenize', () => {
  it('splits operators, literals and dotted identifiers', () => {
    expect(tokenize('persona.skill >= 0.5e1 && !p').map((t) => [t.kind, t.text])).toEqual([
      ['ident', 'persona.skill'],
      ['punct', '>='],
      ['number', '0.5e1'],
      ['punct', '&&'],
      ['punct', '!'],
      ['ident', 'p'],
      ['eof', ''],
    ]);
  });

  it('decodes JSON string escapes', () => {
    expect(tokenize('"a\\"b\\u0041"')[0]?.value).toBe('a"bA');
  });
});

describe('parseExpr', () => {
  it('respects precedence and associativity', () => {
    expect(printExpr(parse('1 + 2 * 3 - 4'))).toBe('1 + 2 * 3 - 4');
    expect(stripSpans(parse('a - b - c'))).toEqual(stripSpans(parse('(a - b) - c')));
    expect(stripSpans(parse('p || q && p'))).toEqual(stripSpans(parse('p || (q && p)')));
    expect(stripSpans(parse('p ? 1 : q ? 2 : 3'))).toEqual(
      stripSpans(parse('p ? 1 : (q ? 2 : 3)')),
    );
    expect(stripSpans(parse('-a * b'))).toEqual(stripSpans(parse('(-a) * b')));
  });

  it('records spans of every node', () => {
    const e = parse('min(a, 10)');
    expect(e).toMatchObject({ kind: 'call', callee: 'min', span: { start: 0, end: 10 } });
    if (e.kind !== 'call') throw new Error('expected call');
    expect(e.args[1]?.span).toEqual({ start: 7, end: 9 });
  });

  it.each([
    ['', 'EXPR_EMPTY', 0],
    ['a +', 'EXPR_UNEXPECTED_TOKEN', 3],
    ['(a + b', 'EXPR_UNEXPECTED_TOKEN', 6],
    ['a b', 'EXPR_UNEXPECTED_TOKEN', 2],
    ['a = 1', 'EXPR_UNEXPECTED_CHARACTER', 2],
    ["state == 's1'", 'EXPR_UNEXPECTED_CHARACTER', 9],
    ['"open', 'EXPR_UNTERMINATED_STRING', 0],
    ['"bad \\q"', 'EXPR_INVALID_STRING', 0],
    ['1e', 'EXPR_INVALID_NUMBER', 0],
    ['3x', 'EXPR_INVALID_NUMBER', 0],
    ['p ? 1', 'EXPR_UNEXPECTED_TOKEN', 5],
    ['min(a,', 'EXPR_UNEXPECTED_TOKEN', 6],
  ])('reports %j as %s at offset %d', (source, code, offset) => {
    const r = parseExpr(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe(code);
    expect(r.error.span.start).toBe(offset);
  });

  it('gives actionable hints', () => {
    const r = parseExpr('a = 1');
    expect(!r.ok && r.error.hint).toMatch(/==/);
  });

  it('parse ∘ print is the identity on ASTs (property)', () => {
    fc.assert(
      fc.property(fc.oneof(numExpr, boolExpr), (ast) => {
        expect(stripSpans(parse(printExpr(ast)))).toEqual(stripSpans(ast));
      }),
      { numRuns: 500 },
    );
  });

  it('print is a fixed point after one round trip (property)', () => {
    fc.assert(
      fc.property(fc.oneof(numExpr, boolExpr), (ast) => {
        const once = printExpr(ast);
        expect(printExpr(parse(once))).toBe(once);
      }),
    );
  });

  it('never throws on arbitrary input (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseExpr(s);
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 1000 },
    );
  });

  it('prints strings and calls canonically', () => {
    expect(printExpr(parse('eligible( "x\\"y" )'))).toBe('eligible("x\\"y")');
    expect(printExpr(parse('!(p && q)'))).toBe('!(p && q)');
    expect(printExpr(parse('- -a'))).toBe('-(-a)');
    expect(printExpr(parse('!!p'))).toBe('!!p');
    expect(printExpr(parse('(p ? a : b) ? 1 : 2'.replace('(p ? a : b)', '(p ? q : p)')))).toBe(
      '(p ? q : p) ? 1 : 2',
    );
  });
});
