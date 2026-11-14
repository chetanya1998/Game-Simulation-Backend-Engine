import type { Span } from './ast.js';

export type ExprErrorCode =
  | 'EXPR_UNEXPECTED_CHARACTER'
  | 'EXPR_UNTERMINATED_STRING'
  | 'EXPR_INVALID_STRING'
  | 'EXPR_INVALID_NUMBER'
  | 'EXPR_UNEXPECTED_TOKEN'
  | 'EXPR_EMPTY'
  | 'EXPR_UNKNOWN_IDENTIFIER'
  | 'EXPR_UNKNOWN_FUNCTION'
  | 'EXPR_WRONG_ARGUMENT_COUNT'
  | 'EXPR_TYPE_MISMATCH'
  | 'EXPR_CURVE_ARGUMENT'
  | 'EXPR_CURVE_AS_VALUE'
  | 'EXPR_UNKNOWN_ENUM_VALUE'
  | 'EXPR_UNKNOWN_PLACEMENT'
  | 'EXPR_DIVISION_BY_ZERO'
  | 'EXPR_NON_FINITE'
  | 'EXPR_CURVE_EVALUATION';

/** A located expression error. `span` points into the expression text. */
export interface ExprError {
  readonly code: ExprErrorCode;
  readonly message: string;
  readonly span: Span;
  readonly hint?: string;
}

export type Result<T, E = ExprError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function exprError(
  code: ExprErrorCode,
  message: string,
  span: Span,
  hint?: string,
): ExprError {
  return hint === undefined ? { code, message, span } : { code, message, span, hint };
}
