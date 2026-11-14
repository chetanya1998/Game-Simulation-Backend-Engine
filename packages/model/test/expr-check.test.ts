import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateExpr,
  parseExpr,
  printExpr,
  roundHalfEven,
  typecheckExpr,
  type EvalEnv,
  type Expr,
} from '@gamex/model';
import { boolExpr, numExpr, testEnv, valueArb } from './helpers/arbitraries.ts';

function parse(source: string): Expr {
  const r = parseExpr(source);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
function check(source: string, expected?: 'number' | 'bool' | 'string') {
  return typecheckExpr(parse(source), testEnv, expected);
}
function env(values: Record<string, number | boolean | string>): EvalEnv {
  return {
    value: (n) => values[n],
    curve: (name, n) =>
      name === 'cost' && Number.isInteger(n)
        ? { ok: true, value: 100 * n }
        : { ok: false, error: `bad tier ${String(n)}` },
    eligible: (id) => id === 'interstitial',
  };
}
function evaluate(source: string, values: Record<string, number | boolean | string> = {}) {
  return evaluateExpr(parse(source), env(values));
}

describe('typecheckExpr', () => {
  it.each([
    ['a + b * 2', 'number'],
    ['a < b && !p', 'bool'],
    ['p ? a : 1', 'number'],
    ['mode == "hard"', 'bool'],
    ['curve(cost, c + 1)', 'number'],
    ['eligible("interstitial")', 'bool'],
    ['clamp(persona.skill, 0, 1)', 'number'],
  ])('%s : %s', (source, type) => {
    expect(check(source)).toEqual({ type, errors: [] });
  });

  it.each([
    ['a + p', 'EXPR_TYPE_MISMATCH', 'The right side of + must be a number'],
    ['!a', 'EXPR_TYPE_MISMATCH', 'operand of !'],
    ['a == p', 'EXPR_TYPE_MISMATCH', 'Cannot compare'],
    ['p ? 1 : q', 'EXPR_TYPE_MISMATCH', 'same type'],
    ['aa + 1', 'EXPR_UNKNOWN_IDENTIFIER', 'Unknown name "aa"'],
    ['cost + 1', 'EXPR_CURVE_AS_VALUE', 'is a curve'],
    ['curve(a, 1)', 'EXPR_CURVE_ARGUMENT', 'not a curve'],
    ['curve(cost)', 'EXPR_WRONG_ARGUMENT_COUNT', 'expects 2'],
    ['clamp(a, 1)', 'EXPR_WRONG_ARGUMENT_COUNT', 'expects 3'],
    ['sqrt(a)', 'EXPR_UNKNOWN_FUNCTION', 'Unknown function'],
    ['mode == "medium"', 'EXPR_UNKNOWN_ENUM_VALUE', 'not a possible value of mode'],
    ['eligible("interstitals")', 'EXPR_UNKNOWN_PLACEMENT', 'Unknown placement'],
    ['eligible(mode)', 'EXPR_TYPE_MISMATCH', 'string literal'],
    ['min()', 'EXPR_WRONG_ARGUMENT_COUNT', 'at least 1'],
  ])('rejects %s with %s', (source, code, message) => {
    const r = check(source);
    expect(r.type).toBeUndefined();
    expect(r.errors[0]).toMatchObject({
      code,
      message: expect.stringContaining(message) as unknown,
    });
  });

  it('suggests close names', () => {
    expect(check('persona.skil > 0').errors[0]?.hint).toBe('Did you mean "persona.skill"?');
    expect(check('mode == "hrad"').errors[0]?.hint).toBe('Did you mean "hard"?');
    expect(check('mni(a, b)').errors[0]?.hint).toBe('Did you mean "min"?');
  });

  it('checks the expected type', () => {
    expect(check('a + 1', 'bool').errors[0]).toMatchObject({
      code: 'EXPR_TYPE_MISMATCH',
      message: 'Expected a boolean expression, but this is a number',
    });
  });

  it('rejects eligible() where placements are unavailable', () => {
    const r = typecheckExpr(parse('eligible("x")'), { symbols: new Map(), curves: new Set() });
    expect(r.errors[0]?.code).toBe('EXPR_UNKNOWN_FUNCTION');
  });

  it('reports every error, not just the first', () => {
    expect(check('aa + bb + p').errors.map((e) => e.code)).toEqual([
      'EXPR_UNKNOWN_IDENTIFIER',
      'EXPR_UNKNOWN_IDENTIFIER',
      'EXPR_TYPE_MISMATCH',
    ]);
  });

  it('accepts every generated well-typed expression (property)', () => {
    fc.assert(
      fc.property(numExpr, boolExpr, (n, b) => {
        expect(typecheckExpr(n, testEnv, 'number').errors).toEqual([]);
        expect(typecheckExpr(b, testEnv, 'bool').errors).toEqual([]);
      }),
    );
  });
});

describe('evaluateExpr', () => {
  it.each([
    ['1 + 2 * 3', {}, 7],
    ['7 % 3', {}, 1],
    ['min(3, 1, 2) + max(1, 5)', {}, 6],
    ['clamp(12, 0, 10)', {}, 10],
    ['round(2.5) + round(3.5) + round(-2.5)', {}, 2 + 4 - 2],
    ['floor(-1.5) + ceil(1.2) + abs(-3)', {}, -2 + 2 + 3],
    ['p ? a : b', { p: false, a: 1, b: 2 }, 2],
    ['mode == "easy" && !p', { mode: 'easy', p: false }, true],
    ['curve(cost, 3)', {}, 300],
    ['eligible("interstitial") && !eligible("banner")', {}, true],
    ['p || a / 0 > 1', { p: true, a: 1 }, true],
  ])('%s = %j', (source, values, expected) => {
    expect(evaluate(source, values)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['a / 0', { a: 1 }, 'EXPR_DIVISION_BY_ZERO'],
    ['a % 0', { a: 1 }, 'EXPR_DIVISION_BY_ZERO'],
    ['a * a', { a: 1e300 }, 'EXPR_NON_FINITE'],
    ['zz + 1', {}, 'EXPR_UNKNOWN_IDENTIFIER'],
    ['a + p', { a: 1, p: true }, 'EXPR_TYPE_MISMATCH'],
    ['curve(cost, 1.5)', {}, 'EXPR_CURVE_EVALUATION'],
    ['nope(1)', {}, 'EXPR_UNKNOWN_FUNCTION'],
  ])('%s fails with %s', (source, values, code) => {
    const r = evaluate(source, values);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });

  it('roundHalfEven rounds halves to even', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(roundHalfEven)).toEqual([
      0, 2, 2, 0, -2, 2, 3,
    ]);
  });

  // The oracle: the same expression printed as JavaScript and run by the JS engine. Our operators
  // are defined to match JavaScript's on numbers and booleans, except that we reject x/0, x%0 and
  // overflow instead of producing Infinity/NaN, and round() rounds halves to even.
  function oracle(
    ast: Expr,
    values: { a: number; b: number; c: number; skill: number; p: boolean; q: boolean },
  ): unknown {
    const js = printExpr(ast).replaceAll('persona.skill', 'skill');
    const params = [
      'a',
      'b',
      'c',
      'skill',
      'p',
      'q',
      'min',
      'max',
      'abs',
      'floor',
      'ceil',
      'round',
      'clamp',
    ];
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- test oracle only
    const fn = new Function(...params, `return (${js});`) as (...args: unknown[]) => unknown;
    return fn(
      values.a,
      values.b,
      values.c,
      values.skill,
      values.p,
      values.q,
      Math.min,
      Math.max,
      Math.abs,
      Math.floor,
      Math.ceil,
      roundHalfEven,
      (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    );
  }

  it('agrees with a JavaScript oracle (property)', () => {
    fc.assert(
      fc.property(fc.oneof(numExpr, boolExpr), valueArb, (ast, v) => {
        const values = {
          a: v.a,
          b: v.b,
          c: v.c,
          'persona.skill': v.skill,
          skill: v.skill,
          p: v.p,
          q: v.q,
        };
        const ours = evaluateExpr(ast, { value: (n) => values[n as keyof typeof values] });
        const theirs = oracle(ast, values);
        if (ours.ok) {
          expect(Object.is(ours.value, theirs) || ours.value === theirs).toBe(true);
        } else {
          expect(['EXPR_DIVISION_BY_ZERO', 'EXPR_NON_FINITE']).toContain(ours.error.code);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('never throws on well-typed expressions and is deterministic (property)', () => {
    fc.assert(
      fc.property(fc.oneof(numExpr, boolExpr), valueArb, (ast, v) => {
        const values: Record<string, number | boolean> = {
          a: v.a,
          b: v.b,
          c: v.c,
          'persona.skill': v.skill,
          p: v.p,
          q: v.q,
        };
        const e = { value: (n: string) => values[n] };
        const first = evaluateExpr(ast, e);
        expect(evaluateExpr(ast, e)).toEqual(first);
      }),
    );
  });
});
