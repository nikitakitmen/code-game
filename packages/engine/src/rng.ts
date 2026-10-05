/** Seeded, deterministic randomness. Never use Math.random() in the engine. */

/** FNV-1a 32-bit hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function combineSeed(...parts: (string | number)[]): number {
  return hashString(parts.join('|'));
}

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  hex(len: number): string;
}

/** mulberry32 PRNG */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, maxInclusive) {
      return min + Math.floor(next() * (maxInclusive - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    chance(p) {
      return next() < p;
    },
    hex(len) {
      let s = '';
      while (s.length < len) s += Math.floor(next() * 16).toString(16);
      return s;
    },
  };
}
