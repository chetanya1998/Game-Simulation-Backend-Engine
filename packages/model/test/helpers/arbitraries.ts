import fc from 'fast-check';
import type { BinaryOp, Expr, SymbolInfo, TypeEnv } from '@gamex/model';

const span = { start: 0, end: 0 };
export const NUM_VARS = ['a', 'b', 'c', 'persona.skill'] as const;
export const BOOL_VARS = ['p', 'q'] as const;

const symbols = new Map<string, SymbolInfo>();
for (const n of NUM_VARS) symbols.set(n, { type: 'number' });
for (const n of BOOL_VARS) symbols.set(n, { type: 'bool' });
symbols.set('mode', { type: 'string', enumValues: ['easy', 'hard'] });

export const testEnv: TypeEnv = {
  symbols,
  curves: new Set(['cost']),
  placements: new Set(['interstitial']),
};

/** Small non-negative numbers, including fractions and large exponents. */
const numberLiteral = fc.oneof(
  fc.integer({ min: 0, max: 1000 }),
  fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  fc.constant(1e21),
);

/** Well-typed number and boolean expression ASTs. */
export const { num: numExpr, bool: boolExpr } = fc.letrec<{ num: Expr; bool: Expr }>((tie) => ({
  num: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    numberLiteral.map((value): Expr => ({ kind: 'number', value, span })),
    fc.constantFrom(...NUM_VARS).map((name): Expr => ({ kind: 'ident', name, span })),
    tie('num').map((operand): Expr => ({ kind: 'unary', op: '-', operand, span })),
    fc
      .tuple(fc.constantFrom<BinaryOp>('+', '-', '*', '/', '%'), tie('num'), tie('num'))
      .map(([op, left, right]): Expr => ({ kind: 'binary', op, left, right, span })),
    fc
      .tuple(tie('bool'), tie('num'), tie('num'))
      .map(([cond, then, otherwise]): Expr => ({ kind: 'ternary', cond, then, otherwise, span })),
    fc
      .tuple(
        fc.constantFrom('min', 'max', 'abs', 'floor', 'ceil', 'round', 'clamp'),
        fc.array(tie('num'), { minLength: 3, maxLength: 3 }),
      )
      .map(([callee, args]): Expr => ({
        kind: 'call',
        callee,
        args: callee === 'min' || callee === 'max' || callee === 'clamp' ? args : args.slice(0, 1),
        span,
      })),
  ),
  bool: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.boolean().map((value): Expr => ({ kind: 'bool', value, span })),
    fc.constantFrom(...BOOL_VARS).map((name): Expr => ({ kind: 'ident', name, span })),
    tie('bool').map((operand): Expr => ({ kind: 'unary', op: '!', operand, span })),
    fc
      .tuple(fc.constantFrom<BinaryOp>('&&', '||', '==', '!='), tie('bool'), tie('bool'))
      .map(([op, left, right]): Expr => ({ kind: 'binary', op, left, right, span })),
    fc
      .tuple(fc.constantFrom<BinaryOp>('<', '<=', '>', '>=', '==', '!='), tie('num'), tie('num'))
      .map(([op, left, right]): Expr => ({ kind: 'binary', op, left, right, span })),
  ),
}));

/** Removes spans so trees can be compared structurally. */
export function stripSpans(expr: Expr): unknown {
  return JSON.parse(
    JSON.stringify(expr, (k, v: unknown) => (k === 'span' ? undefined : v)),
  ) as unknown;
}

export const valueArb = fc.record({
  a: fc.integer({ min: -50, max: 50 }),
  b: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
  c: fc.integer({ min: 0, max: 5 }),
  skill: fc.double({ min: 0, max: 1, noNaN: true }),
  p: fc.boolean(),
  q: fc.boolean(),
});
