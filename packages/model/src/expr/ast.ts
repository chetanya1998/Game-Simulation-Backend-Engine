/** Character offsets into the expression source: `start` inclusive, `end` exclusive. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export type BinaryOp =
  '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';
export type UnaryOp = '!' | '-';

export type Expr =
  | { readonly kind: 'number'; readonly value: number; readonly span: Span }
  | { readonly kind: 'bool'; readonly value: boolean; readonly span: Span }
  | { readonly kind: 'string'; readonly value: string; readonly span: Span }
  | { readonly kind: 'ident'; readonly name: string; readonly span: Span }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly operand: Expr; readonly span: Span }
  | {
      readonly kind: 'binary';
      readonly op: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
      readonly span: Span;
    }
  | {
      readonly kind: 'ternary';
      readonly cond: Expr;
      readonly then: Expr;
      readonly otherwise: Expr;
      readonly span: Span;
    }
  | {
      readonly kind: 'call';
      readonly callee: string;
      readonly args: readonly Expr[];
      readonly span: Span;
    };

/** Binding power of binary operators (higher binds tighter). Ternary is 1, unary is 8. */
export const BINARY_PRECEDENCE: Readonly<Record<BinaryOp, number>> = {
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '<=': 5,
  '>': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};
export const TERNARY_PRECEDENCE = 1;
export const UNARY_PRECEDENCE = 8;

/** Visits every node depth-first, parents before children. */
export function walkExpr(expr: Expr, visit: (node: Expr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case 'unary':
      walkExpr(expr.operand, visit);
      break;
    case 'binary':
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case 'ternary':
      walkExpr(expr.cond, visit);
      walkExpr(expr.then, visit);
      walkExpr(expr.otherwise, visit);
      break;
    case 'call':
      for (const arg of expr.args) walkExpr(arg, visit);
      break;
    default:
      break;
  }
}

/** Collects every identifier name used in an expression (including curve names passed to `curve`). */
export function identifiersOf(expr: Expr): string[] {
  const names = new Set<string>();
  walkExpr(expr, (node) => {
    if (node.kind === 'ident') names.add(node.name);
  });
  return [...names];
}
