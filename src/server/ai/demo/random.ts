/**
 * Small deterministic PRNG toolkit for the demo data generator. Same seed → same sequence,
 * so the demo project content is reproducible (only ids and the anchor date differ).
 */

/** FNV-1a 32-bit hash of a string (used to turn a seed string into a numeric seed). */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, good-enough 32-bit PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly nextFloat: () => number;
  private spare: number | null = null;

  constructor(seed: string | number) {
    this.nextFloat = mulberry32(typeof seed === "number" ? seed : hashSeed(seed));
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextFloat();
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return Math.floor(min + (max - min + 1) * this.nextFloat());
  }

  /** True with probability p. */
  bool(p: number): boolean {
    return this.nextFloat() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[Math.floor(this.nextFloat() * items.length)]!;
  }

  /** Picks one item with probability proportional to `weight(item)`. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error("Rng.weighted on empty array");
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return this.pick(items);
    let r = this.nextFloat() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1]!;
  }

  /** Picks `n` distinct items, each draw proportional to `weight(item)` (without replacement). */
  weightedSample<T>(items: readonly T[], n: number, weight: (item: T) => number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) {
      const chosen = this.weighted(pool, weight);
      out.push(chosen);
      pool.splice(pool.indexOf(chosen), 1);
    }
    return out;
  }

  /** Fisher–Yates shuffle (returns a new array). */
  shuffle<T>(items: readonly T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.nextFloat() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }

  /** Normally distributed value (Box–Muller). */
  gaussian(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.nextFloat();
    while (v === 0) v = this.nextFloat();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mean + sd * mag * Math.cos(2 * Math.PI * v);
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
