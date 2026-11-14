import {
  BINARY_PRECEDENCE,
  TERNARY_PRECEDENCE,
  UNARY_PRECEDENCE,
  type BinaryOp,
  type Expr,
} from './ast.js';
import { exprError, type ExprError, type Result } from './errors.js';
import { LexError, tokenize, type Token } from './lexer.js';

class ParseError extends Error {
  constructor(readonly detail: ExprError) {
    super(detail.message);
  }
}

function describe(token: Token): string {
  return token.kind === 'eof' ? 'end of expression' : `"${token.text}"`;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error('internal error: token stream is exhausted');
    return token;
  }

  private next(): Token {
    const token = this.peek();
    if (this.index < this.tokens.length - 1) this.index++;
    return token;
  }

  private expectPunct(text: string, context: string): Token {
    const token = this.peek();
    if (token.kind !== 'punct' || token.text !== text) {
      throw new ParseError(
        exprError(
          'EXPR_UNEXPECTED_TOKEN',
          `Expected "${text}" ${context}, found ${describe(token)}`,
          token.span,
        ),
      );
    }
    return this.next();
  }

  parseAll(): Expr {
    if (this.peek().kind === 'eof') {
      throw new ParseError(
        exprError(
          'EXPR_EMPTY',
          'Expression is empty',
          this.peek().span,
          'Write an expression, e.g. coins >= 100.',
        ),
      );
    }
    const expr = this.parseExpression(TERNARY_PRECEDENCE);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      throw new ParseError(
        exprError(
          'EXPR_UNEXPECTED_TOKEN',
          `Unexpected ${describe(rest)} after the end of the expression`,
          rest.span,
          'Join conditions with && or ||.',
        ),
      );
    }
    return expr;
  }

  private parseExpression(minPrecedence: number): Expr {
    let left = this.parsePrefix();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'punct') break;
      if (token.text === '?') {
        if (TERNARY_PRECEDENCE < minPrecedence) break;
        this.next();
        const then = this.parseExpression(TERNARY_PRECEDENCE);
        this.expectPunct(':', 'in a conditional expression (a ? b : c)');
        const otherwise = this.parseExpression(TERNARY_PRECEDENCE);
        left = {
          kind: 'ternary',
          cond: left,
          then,
          otherwise,
          span: { start: left.span.start, end: otherwise.span.end },
        };
        continue;
      }
      const precedence = BINARY_PRECEDENCE[token.text as BinaryOp] as number | undefined;
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      const right = this.parseExpression(precedence + 1);
      left = {
        kind: 'binary',
        op: token.text as BinaryOp,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parsePrefix(): Expr {
    const token = this.next();
    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: token.value as number, span: token.span };
      case 'string':
        return { kind: 'string', value: token.value as string, span: token.span };
      case 'bool':
        return { kind: 'bool', value: token.value as boolean, span: token.span };
      case 'ident': {
        const after = this.peek();
        if (after.kind === 'punct' && after.text === '(') {
          this.next();
          const args: Expr[] = [];
          if (!(this.peek().kind === 'punct' && this.peek().text === ')')) {
            for (;;) {
              args.push(this.parseExpression(TERNARY_PRECEDENCE));
              if (this.peek().kind === 'punct' && this.peek().text === ',') {
                this.next();
                continue;
              }
              break;
            }
          }
          const close = this.expectPunct(')', `to close the call to ${token.text}(…)`);
          return {
            kind: 'call',
            callee: token.text,
            args,
            span: { start: token.span.start, end: close.span.end },
          };
        }
        return { kind: 'ident', name: token.text, span: token.span };
      }
      case 'punct': {
        if (token.text === '(') {
          const inner = this.parseExpression(TERNARY_PRECEDENCE);
          this.expectPunct(')', 'to close "("');
          return inner;
        }
        if (token.text === '!' || token.text === '-') {
          const operand = this.parseExpression(UNARY_PRECEDENCE);
          return {
            kind: 'unary',
            op: token.text,
            operand,
            span: { start: token.span.start, end: operand.span.end },
          };
        }
        break;
      }
      case 'eof':
        break;
    }
    throw new ParseError(
      exprError(
        'EXPR_UNEXPECTED_TOKEN',
        `Expected a value, found ${describe(token)}`,
        token.span,
        'Values are numbers, "strings", true/false, names, or calls like min(a, b).',
      ),
    );
  }
}

/** Parses an expression string into an AST. Never throws. */
export function parseExpr(source: string): Result<Expr> {
  try {
    return { ok: true, value: new Parser(tokenize(source)).parseAll() };
  } catch (error) {
    if (error instanceof LexError || error instanceof ParseError)
      return { ok: false, error: error.detail };
    throw error;
  }
}
