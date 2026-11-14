import type { Expr } from './ast.js';
import { exprError, type ExprError, type Result } from './errors.js';
import { NUMERIC_FUNCTIONS } from './functions.js';
import type { ExprValue } from './types.js';

/** Values available to an expression at evaluation time. */
export interface EvalEnv {
  value(name: string): ExprValue | undefined;
  /** Evaluates curve `name` at tier `n`. */
  curve?(name: string, n: number): Result<number, string>;
  /** Whether placement `id` is currently eligible. */
  eligible?(id: string): boolean;
}

class EvalFailure extends Error {
  constructor(readonly detail: ExprError) {
    super(detail.message);
  }
}

function fail(expr: Expr, code: ExprError['code'], message: string, hint?: string): never {
  throw new EvalFailure(exprError(code, message, expr.span, hint));
}

function finite(expr: Expr, value: number): number {
  if (!Number.isFinite(value))
    fail(expr, 'EXPR_NON_FINITE', 'The result is not a finite number (overflow)');
  return value;
}

class Evaluator {
  constructor(private readonly env: EvalEnv) {}

  num(expr: Expr): number {
    const v = this.eval(expr);
    if (typeof v !== 'number')
      fail(expr, 'EXPR_TYPE_MISMATCH', `Expected a number, got ${JSON.stringify(v)}`);
    return v;
  }

  bool(expr: Expr): boolean {
    const v = this.eval(expr);
    if (typeof v !== 'boolean')
      fail(expr, 'EXPR_TYPE_MISMATCH', `Expected a boolean, got ${JSON.stringify(v)}`);
    return v;
  }

  eval(expr: Expr): ExprValue {
    switch (expr.kind) {
      case 'number':
      case 'bool':
      case 'string':
        return expr.value;
      case 'ident': {
        const v = this.env.value(expr.name);
        if (v === undefined) fail(expr, 'EXPR_UNKNOWN_IDENTIFIER', `Unknown name "${expr.name}"`);
        return v;
      }
      case 'unary':
        return expr.op === '!' ? !this.bool(expr.operand) : -this.num(expr.operand);
      case 'binary': {
        switch (expr.op) {
          case '&&':
            return this.bool(expr.left) && this.bool(expr.right);
          case '||':
            return this.bool(expr.left) || this.bool(expr.right);
          case '==':
            return this.eval(expr.left) === this.eval(expr.right);
          case '!=':
            return this.eval(expr.left) !== this.eval(expr.right);
          case '<':
            return this.num(expr.left) < this.num(expr.right);
          case '<=':
            return this.num(expr.left) <= this.num(expr.right);
          case '>':
            return this.num(expr.left) > this.num(expr.right);
          case '>=':
            return this.num(expr.left) >= this.num(expr.right);
          case '+':
            return finite(expr, this.num(expr.left) + this.num(expr.right));
          case '-':
            return finite(expr, this.num(expr.left) - this.num(expr.right));
          case '*':
            return finite(expr, this.num(expr.left) * this.num(expr.right));
          case '/':
          case '%': {
            const a = this.num(expr.left);
            const b = this.num(expr.right);
            if (b === 0)
              fail(
                expr,
                'EXPR_DIVISION_BY_ZERO',
                `Division by zero in "${expr.op}"`,
                'Guard the divisor, e.g. x / max(n, 1).',
              );
            return finite(expr, expr.op === '/' ? a / b : a % b);
          }
        }
        break;
      }
      case 'ternary':
        return this.bool(expr.cond) ? this.eval(expr.then) : this.eval(expr.otherwise);
      case 'call': {
        if (expr.callee === 'curve') {
          const [nameArg, nArg] = expr.args;
          if (nameArg?.kind !== 'ident' || nArg === undefined || this.env.curve === undefined) {
            return fail(expr, 'EXPR_CURVE_ARGUMENT', 'curve() needs a curve name and a tier');
          }
          const result = this.env.curve(nameArg.name, this.num(nArg));
          if (!result.ok) fail(expr, 'EXPR_CURVE_EVALUATION', result.error);
          return result.value;
        }
        if (expr.callee === 'eligible') {
          const [arg] = expr.args;
          if (arg?.kind !== 'string' || this.env.eligible === undefined) {
            return fail(expr, 'EXPR_UNKNOWN_PLACEMENT', 'eligible() needs a placement id');
          }
          return this.env.eligible(arg.value);
        }
        const fn = NUMERIC_FUNCTIONS[expr.callee];
        if (fn === undefined)
          return fail(expr, 'EXPR_UNKNOWN_FUNCTION', `Unknown function "${expr.callee}"`);
        if (expr.args.length < fn.minArgs || expr.args.length > fn.maxArgs) {
          fail(expr, 'EXPR_WRONG_ARGUMENT_COUNT', `Wrong number of arguments for ${expr.callee}()`);
        }
        return fn.apply(expr.args.map((a) => this.num(a)));
      }
    }
    return fail(expr, 'EXPR_TYPE_MISMATCH', 'Unsupported expression');
  }
}

/**
 * Evaluates an expression. Pure and deterministic; never throws — failures (unknown names, division by
 * zero, overflow, runtime type errors) are returned as located errors.
 */
export function evaluateExpr(expr: Expr, env: EvalEnv): Result<ExprValue> {
  try {
    return { ok: true, value: new Evaluator(env).eval(expr) };
  } catch (error) {
    if (error instanceof EvalFailure) return { ok: false, error: error.detail };
    throw error;
  }
}
