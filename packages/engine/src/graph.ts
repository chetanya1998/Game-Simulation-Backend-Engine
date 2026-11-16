import type { CompiledModel, CTransition } from './compile.js';

/** Static successor screens of every screen (ignoring guards); "return" goes back to any overlay caller. */
export function successors(c: CompiledModel): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of c.states.keys()) out.set(s, new Set());
  const callersOf = new Map<string, Set<string>>();
  for (const t of c.transitions) {
    if (t.to !== 'return' && c.states.get(t.to)?.kind === 'overlay') {
      callersOf.set(t.to, (callersOf.get(t.to) ?? new Set()).add(t.from));
    }
  }
  for (const t of c.transitions) {
    if (t.to === 'return')
      for (const caller of callersOf.get(t.from) ?? []) out.get(t.from)?.add(caller);
    else out.get(t.from)?.add(t.to);
  }
  return out;
}

/** Breadth-first distance from every screen to the nearest screen in `goals` (Infinity if unreachable). */
export function distancesTo(c: CompiledModel, goals: ReadonlySet<string>): Map<string, number> {
  const reverse = new Map<string, Set<string>>();
  for (const [from, tos] of successors(c))
    for (const to of tos) reverse.set(to, (reverse.get(to) ?? new Set()).add(from));
  const dist = new Map<string, number>();
  for (const s of c.states.keys()) dist.set(s, Number.POSITIVE_INFINITY);
  const queue: string[] = [];
  for (const g of goals) {
    dist.set(g, 0);
    queue.push(g);
  }
  // for…of also visits items pushed during iteration (breadth-first order).
  for (const s of queue) {
    const d = dist.get(s) ?? 0;
    for (const p of reverse.get(s) ?? []) {
      if ((dist.get(p) ?? 0) > d + 1) {
        dist.set(p, d + 1);
        queue.push(p);
      }
    }
  }
  return dist;
}

export function isSelfLoop(t: CTransition): boolean {
  return t.to === t.from;
}
