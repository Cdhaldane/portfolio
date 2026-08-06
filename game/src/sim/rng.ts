/*
 * sim/rng.ts — seeded random, split into independent streams.
 *
 * The streams matter more than the algorithm (GALLOWS_HYMN.md §13, rule 2):
 * cosmetic randomness MUST NOT share a stream with combat randomness, or
 * adding a spark effect shifts every damage roll and every committed replay
 * breaks. Each stream is seeded from (runSeed, streamId) through a mixing
 * function rather than by jumping one generator, so streams stay stable even
 * if the generator is swapped later.
 *
 * Imported by subpath: pure-rand 8.x publishes no root entry point, only the
 * per-generator and per-distribution modules.
 */

import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";

export const STREAM = {
  combat: 1,
  director: 2,
  loot: 3,
  procgen: 4,
  /** Presentation-only. Never read inside the sim. */
  cosmetic: 100,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/** splitmix-flavoured 32-bit mix so nearby seeds produce unrelated streams. */
function mixSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) | 0;
}

export interface Stream {
  /** Uniform integer in [0, bound). */
  int(bound: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Draws taken — lets a test prove a change didn't disturb another stream. */
  draws(): number;
}

export function makeStream(seed: number, stream: number): Stream {
  const gen = xoroshiro128plus(mixSeed(seed, stream));
  let count = 0;
  return {
    int(bound) {
      count++;
      if (bound <= 1) return 0;
      return uniformInt(gen, 0, bound - 1);
    },
    float() {
      count++;
      // 2^24 buckets: the quotient is exactly representable as a double, so the
      // result is bit-identical on every engine.
      return uniformInt(gen, 0, 0xffffff) / 0x1000000;
    },
    range(lo, hi) {
      return lo + this.float() * (hi - lo);
    },
    draws() {
      return count;
    },
  };
}

export interface Streams {
  combat: Stream;
  director: Stream;
  loot: Stream;
}

export function makeStreams(seed: number): Streams {
  return {
    combat: makeStream(seed, STREAM.combat),
    director: makeStream(seed, STREAM.director),
    loot: makeStream(seed, STREAM.loot),
  };
}
