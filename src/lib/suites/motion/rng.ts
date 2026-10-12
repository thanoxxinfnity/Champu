/**
 * A tiny seeded PRNG (mulberry32), shared by anything in Motion Studio that needs randomness that is
 * still a pure function of its inputs — particle spawn points, screen-shake jitter. Given the same seed
 * it always produces the same sequence, which is what lets the timeline be scrubbed to any instant and
 * exported frame-by-frame without the result depending on how many times it was evaluated before.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh generator seeded from (seed, salt) — two different salts never collide for the same seed. */
export function seededAt(seed: number, salt: number): () => number {
  return mulberry32((seed * 2654435761 + salt * 2246822519) >>> 0);
}
