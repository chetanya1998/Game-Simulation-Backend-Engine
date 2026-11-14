/**
 * Built-in functions of the expression language. All are exactly specified by IEEE-754/ECMAScript,
 * so results are identical in every JavaScript engine.
 */

/** Rounds to the nearest integer; exact halves go to the even neighbour (banker's rounding). */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export interface NumericFunction {
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly apply: (args: readonly number[]) => number;
  readonly signature: string;
}

/** Functions over numbers. `curve` and `eligible` are special-cased by the checker and evaluator. */
export const NUMERIC_FUNCTIONS: Readonly<Record<string, NumericFunction>> = {
  min: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    apply: (a) => Math.min(...a),
    signature: 'min(a, b, …)',
  },
  max: {
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    apply: (a) => Math.max(...a),
    signature: 'max(a, b, …)',
  },
  clamp: {
    minArgs: 3,
    maxArgs: 3,
    apply: (a) => clamp(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0),
    signature: 'clamp(x, lo, hi)',
  },
  abs: { minArgs: 1, maxArgs: 1, apply: (a) => Math.abs(a[0] ?? 0), signature: 'abs(x)' },
  floor: { minArgs: 1, maxArgs: 1, apply: (a) => Math.floor(a[0] ?? 0), signature: 'floor(x)' },
  ceil: { minArgs: 1, maxArgs: 1, apply: (a) => Math.ceil(a[0] ?? 0), signature: 'ceil(x)' },
  round: {
    minArgs: 1,
    maxArgs: 1,
    apply: (a) => roundHalfEven(a[0] ?? 0),
    signature: 'round(x) — halves to even',
  },
};

export const SPECIAL_FUNCTIONS = {
  curve: 'curve(curveName, n)',
  eligible: 'eligible("placement-id")',
} as const;

export const FUNCTION_NAMES: readonly string[] = [
  ...Object.keys(NUMERIC_FUNCTIONS),
  ...Object.keys(SPECIAL_FUNCTIONS),
];
