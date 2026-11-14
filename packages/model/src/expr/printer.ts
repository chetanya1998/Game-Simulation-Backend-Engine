import { BINARY_PRECEDENCE, TERNARY_PRECEDENCE, UNARY_PRECEDENCE, type Expr } from './ast.js';

function precedenceOf(expr: Expr): number {
  if (expr.kind === 'binary') return BINARY_PRECEDENCE[expr.op];
  if (expr.kind === 'ternary') return TERNARY_PRECEDENCE;
  if (expr.kind === 'unary') return UNARY_PRECEDENCE;
  return UNARY_PRECEDENCE + 1;
}

function wrap(expr: Expr, needsParens: boolean): string {
  const text = printExpr(expr);
  return needsParens ? `(${text})` : text;
}

/**
 * Prints an AST in canonical form with the minimum parentheses, such that
 * `parseExpr(printExpr(ast))` yields the same tree (ignoring spans).
 */
export function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'number':
      return String(expr.value);
    case 'string':
      return JSON.stringify(expr.value);
    case 'bool':
      return expr.value ? 'true' : 'false';
    case 'ident':
      return expr.name;
    case 'unary':
      // `-(-a)` rather than `--a`, which reads like a decrement.
      return `${expr.op}${wrap(expr.operand, precedenceOf(expr.operand) < UNARY_PRECEDENCE || (expr.op === '-' && expr.operand.kind === 'unary' && expr.operand.op === '-'))}`;
    case 'binary': {
      const p = BINARY_PRECEDENCE[expr.op];
      return `${wrap(expr.left, precedenceOf(expr.left) < p)} ${expr.op} ${wrap(expr.right, precedenceOf(expr.right) <= p)}`;
    }
    case 'ternary':
      return `${wrap(expr.cond, precedenceOf(expr.cond) <= TERNARY_PRECEDENCE)} ? ${printExpr(expr.then)} : ${printExpr(expr.otherwise)}`;
    case 'call':
      return `${expr.callee}(${expr.args.map(printExpr).join(', ')})`;
  }
}
