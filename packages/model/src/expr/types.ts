export type ExprType = 'number' | 'bool' | 'string';
export type ExprValue = number | boolean | string;

export function typeOfValue(value: ExprValue): ExprType {
  return typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'string';
}
