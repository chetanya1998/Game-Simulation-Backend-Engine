import type { Expr, Span } from './ast.js';
import { exprError, type ExprError } from './errors.js';
import { FUNCTION_NAMES, NUMERIC_FUNCTIONS } from './functions.js';
import { didYouMean } from './suggest.js';
import type { ExprType } from './types.js';

export interface SymbolInfo {
  readonly type: ExprType;
  /** Allowed string values (enum variables, `state`, `prevState`). */
  readonly enumValues?: readonly string[];
}

/** What an expression may refer to. Built by the validator from the Game Model. */
export interface TypeEnv {
  /** Identifiers usable as values: constant, variable and resource keys, plus built-ins. */
  readonly symbols: ReadonlyMap<string, SymbolInfo>;
  /** Keys of curve constants, usable only as `curve(name, n)`. */
  readonly curves: ReadonlySet<string>;
  /** Placement ids accepted by `eligible("…")`. When undefined, `eligible` is unavailable. */
  readonly placements?: ReadonlySet<string>;
}

export interface TypecheckResult {
  /** The inferred type, when the expression is well typed. */
  readonly type: ExprType | undefined;
  readonly errors: readonly ExprError[];
}

function typeName(t: ExprType): string {
  return t === 'bool' ? 'boolean' : t;
}

class Checker {
  readonly errors: ExprError[] = [];
  constructor(private readonly env: TypeEnv) {}

  private fail(
    code: ExprError['code'],
    message: string,
    span: Span,
    hint?: string,
  ): ExprType | undefined {
    this.errors.push(exprError(code, message, span, hint));
    return undefined;
  }

  private expect(expr: Expr, expected: ExprType, context: string): void {
    const actual = this.infer(expr);
    if (actual !== undefined && actual !== expected) {
      this.fail(
        'EXPR_TYPE_MISMATCH',
        `${context} must be a ${typeName(expected)}, but this is a ${typeName(actual)}`,
        expr.span,
      );
    }
  }

  private checkEnumLiteral(a: Expr, b: Expr): void {
    if (a.kind !== 'ident' || b.kind !== 'string') return;
    const info = this.env.symbols.get(a.name);
    if (info?.enumValues === undefined || info.enumValues.includes(b.value)) return;
    this.fail(
      'EXPR_UNKNOWN_ENUM_VALUE',
      `"${b.value}" is not a possible value of ${a.name}`,
      b.span,
      didYouMean(b.value, info.enumValues) ??
        `Possible values: ${info.enumValues.map((v) => `"${v}"`).join(', ')}.`,
    );
  }

  infer(expr: Expr): ExprType | undefined {
    switch (expr.kind) {
      case 'number':
        return 'number';
      case 'bool':
        return 'bool';
      case 'string':
        return 'string';
      case 'ident': {
        const info = this.env.symbols.get(expr.name);
        if (info !== undefined) return info.type;
        if (this.env.curves.has(expr.name)) {
          return this.fail(
            'EXPR_CURVE_AS_VALUE',
            `${expr.name} is a curve, not a single value`,
            expr.span,
            `Use curve(${expr.name}, n) to read tier n.`,
          );
        }
        return this.fail(
          'EXPR_UNKNOWN_IDENTIFIER',
          `Unknown name "${expr.name}"`,
          expr.span,
          didYouMean(expr.name, [...this.env.symbols.keys(), ...this.env.curves]) ??
            'Names are the camelCase keys of constants, variables and resources.',
        );
      }
      case 'unary':
        if (expr.op === '!') {
          this.expect(expr.operand, 'bool', 'The operand of !');
          return 'bool';
        }
        this.expect(expr.operand, 'number', 'The operand of unary -');
        return 'number';
      case 'binary': {
        switch (expr.op) {
          case '&&':
          case '||':
            this.expect(expr.left, 'bool', `The left side of ${expr.op}`);
            this.expect(expr.right, 'bool', `The right side of ${expr.op}`);
            return 'bool';
          case '==':
          case '!=': {
            const left = this.infer(expr.left);
            const right = this.infer(expr.right);
            if (left !== undefined && right !== undefined && left !== right) {
              this.fail(
                'EXPR_TYPE_MISMATCH',
                `Cannot compare a ${typeName(left)} with a ${typeName(right)}`,
                expr.span,
              );
            }
            this.checkEnumLiteral(expr.left, expr.right);
            this.checkEnumLiteral(expr.right, expr.left);
            return 'bool';
          }
          case '<':
          case '<=':
          case '>':
          case '>=':
            this.expect(expr.left, 'number', `The left side of ${expr.op}`);
            this.expect(expr.right, 'number', `The right side of ${expr.op}`);
            return 'bool';
          default:
            this.expect(expr.left, 'number', `The left side of ${expr.op}`);
            this.expect(expr.right, 'number', `The right side of ${expr.op}`);
            return 'number';
        }
      }
      case 'ternary': {
        this.expect(expr.cond, 'bool', 'The condition before ?');
        const a = this.infer(expr.then);
        const b = this.infer(expr.otherwise);
        if (a !== undefined && b !== undefined && a !== b) {
          return this.fail(
            'EXPR_TYPE_MISMATCH',
            `Both branches of ?: must have the same type (found ${typeName(a)} and ${typeName(b)})`,
            expr.span,
          );
        }
        return a ?? b;
      }
      case 'call':
        return this.inferCall(expr);
    }
  }

  private inferCall(expr: Extract<Expr, { kind: 'call' }>): ExprType | undefined {
    const arity = (min: number, max: number, signature: string): boolean => {
      if (expr.args.length >= min && expr.args.length <= max) return true;
      this.fail(
        'EXPR_WRONG_ARGUMENT_COUNT',
        `${expr.callee} expects ${min === max ? String(min) : `at least ${String(min)}`} argument(s), got ${String(expr.args.length)}`,
        expr.span,
        `Usage: ${signature}.`,
      );
      return false;
    };

    if (expr.callee === 'curve') {
      if (!arity(2, 2, 'curve(curveName, n)')) return 'number';
      const [name, n] = expr.args as [Expr, Expr];
      if (name.kind !== 'ident' || !this.env.curves.has(name.name)) {
        const label = name.kind === 'ident' ? `"${name.name}"` : 'This argument';
        this.fail(
          'EXPR_CURVE_ARGUMENT',
          `${label} is not a curve constant`,
          name.span,
          (name.kind === 'ident' ? didYouMean(name.name, this.env.curves) : undefined) ??
            'The first argument of curve() is the key of a curve constant.',
        );
      }
      this.expect(n, 'number', 'The tier passed to curve()');
      return 'number';
    }

    if (expr.callee === 'eligible') {
      if (this.env.placements === undefined) {
        return this.fail(
          'EXPR_UNKNOWN_FUNCTION',
          'eligible() is not available here',
          expr.span,
          'eligible() can be used in transition guards, rules and actions.',
        );
      }
      if (!arity(1, 1, 'eligible("placement-id")')) return 'bool';
      const [arg] = expr.args as [Expr];
      if (arg.kind !== 'string') {
        this.fail(
          'EXPR_TYPE_MISMATCH',
          'eligible() takes a placement id as a string literal',
          arg.span,
          'Example: eligible("interstitial-after-victory").',
        );
      } else if (!this.env.placements.has(arg.value)) {
        this.fail(
          'EXPR_UNKNOWN_PLACEMENT',
          `Unknown placement "${arg.value}"`,
          arg.span,
          didYouMean(arg.value, this.env.placements),
        );
      }
      return 'bool';
    }

    const fn = NUMERIC_FUNCTIONS[expr.callee];
    if (fn === undefined) {
      return this.fail(
        'EXPR_UNKNOWN_FUNCTION',
        `Unknown function "${expr.callee}"`,
        expr.span,
        didYouMean(expr.callee, FUNCTION_NAMES) ?? `Available: ${FUNCTION_NAMES.join(', ')}.`,
      );
    }
    arity(fn.minArgs, fn.maxArgs, fn.signature);
    expr.args.forEach((arg, i) => {
      this.expect(arg, 'number', `Argument ${String(i + 1)} of ${expr.callee}()`);
    });
    return 'number';
  }
}

/**
 * Infers the type of an expression and reports every type error found. When `expected` is given, a
 * well-typed expression of another type is also reported.
 */
export function typecheckExpr(expr: Expr, env: TypeEnv, expected?: ExprType): TypecheckResult {
  const checker = new Checker(env);
  const type = checker.infer(expr);
  if (expected !== undefined && type !== undefined && type !== expected) {
    checker.errors.push(
      exprError(
        'EXPR_TYPE_MISMATCH',
        `Expected a ${typeName(expected)} expression, but this is a ${typeName(type)}`,
        expr.span,
      ),
    );
  }
  return { type: checker.errors.length === 0 ? type : undefined, errors: checker.errors };
}
