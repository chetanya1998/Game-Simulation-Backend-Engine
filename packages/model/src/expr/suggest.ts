/** Edit distance counting insertions, deletions, substitutions and adjacent swaps (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => rows[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    const row = rows[i] ?? [];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, at(i - 2, j - 2) + 1);
      row[j] = d;
    }
  }
  return at(a.length, b.length);
}

/**
 * Returns the closest candidate to `name` for a "did you mean" hint, or `undefined` when nothing is close.
 * A candidate that starts with `name` (e.g. `revivesUsed` → `revivesUsedThisMission`) also counts as close.
 * Ties resolve to the alphabetically first candidate, so hints are deterministic.
 */
export function closestMatch(name: string, candidates: Iterable<string>): string | undefined {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of [...candidates].sort()) {
    const c = candidate.toLowerCase();
    const distance = c.startsWith(lower) && lower.length >= 3 ? 1 : editDistance(lower, c);
    const limit = Math.max(1, Math.floor(Math.max(name.length, candidate.length) / 3));
    if (distance <= limit && distance < bestScore) {
      best = candidate;
      bestScore = distance;
    }
  }
  return best;
}

export function didYouMean(name: string, candidates: Iterable<string>): string | undefined {
  const match = closestMatch(name, candidates);
  return match === undefined ? undefined : `Did you mean "${match}"?`;
}
