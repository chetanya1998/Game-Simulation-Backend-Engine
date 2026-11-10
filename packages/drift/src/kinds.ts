/** Drift categories between a game repo and its Game Model (master prompt §10). */
export const DRIFT_KINDS = [
  'value-mismatch',
  'missing-in-code',
  'missing-in-spec',
  'rule-violation',
] as const;

export type DriftKind = (typeof DRIFT_KINDS)[number];
export type DriftSeverity = 'blocking' | 'warning';

/**
 * Default severity per kind. Code that disagrees with the spec (wrong value, broken rule) blocks
 * CI; one-sided omissions warn, because they are often work in progress.
 */
export const DEFAULT_DRIFT_SEVERITY: Readonly<Record<DriftKind, DriftSeverity>> = {
  'value-mismatch': 'blocking',
  'rule-violation': 'blocking',
  'missing-in-code': 'warning',
  'missing-in-spec': 'warning',
};

export function isDriftKind(value: string): value is DriftKind {
  return (DRIFT_KINDS as readonly string[]).includes(value);
}
