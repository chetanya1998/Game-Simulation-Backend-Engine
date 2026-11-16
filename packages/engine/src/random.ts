/**
 * Seeded pseudo-random numbers. Uses only 32-bit integer operations (`Math.imul`, shifts, `>>> 0`), which
 * every JavaScript engine computes identically, so a seed reproduces the same sequence everywhere.
 */

/** SplitMix32 finalizer: a fast, well-mixed 32-bit hash step. */
export function mix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

function hashString(h: number, s: string): number {
  let x = h;
  for (let i = 0; i < s.length; i++) x = mix32(x ^ s.charCodeAt(i));
  return mix32(x ^ s.length);
}

/**
 * Derives an independent 32-bit seed from a run seed and labels, e.g. `deriveSeed(seed, "payer", 17)`.
 * Each simulated player gets its own stream this way, so results do not depend on how players are
 * split across workers.
 */
export function deriveSeed(seed: number, ...parts: readonly (string | number)[]): number {
  let h = mix32(seed >>> 0);
  for (const p of parts) h = typeof p === 'number' ? mix32(h ^ mix32(p >>> 0)) : hashString(h, p);
  return h;
}

/** Small Fast Chaotic PRNG (sfc32) with a 128-bit state. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = mix32(seed);
    this.b = mix32(this.a ^ 0x1b873593);
    this.c = mix32(this.b ^ 0xcc9e2d51);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1), with 32 bits of precision (exact division by 2^32). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Index chosen with probability proportional to its weight; -1 when every weight is 0. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] ?? 0;
      if (w <= 0) continue;
      if (r < w) return i;
      r -= w;
    }
    for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] ?? 0) > 0) return i;
    return -1;
  }

  /** Fisher–Yates shuffle (returns a new array). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}
