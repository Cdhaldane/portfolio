/*
 * sim/combo.ts — the poker hands (GALLOWS_HYMN.md §5).
 *
 * The signature scoring system, and the game's real difficulty curve: survival
 * gets easy, mastery never does. Every kill inside a rolling 4-second window
 * appends its *source* to the current hand; when the window lapses the hand is
 * named, multiplied and banked as Tally.
 *
 * Why this shape:
 *   - It makes the player deliberately DIVERSIFY and SEQUENCE their build instead
 *     of spamming one optimal trap — a Straight needs five distinct sources.
 *   - It is trivially legible: kills are cards, and everyone already knows what a
 *     Full House is.
 *   - It is thematically free. This is a western.
 *
 * Pure functions over a fixed-size buffer: no allocation, no wall clock, and
 * therefore fully replayable.
 */

export const MAX_HAND = 8;

export const HAND = {
  none: 0,
  pair: 1,
  twoPair: 2,
  threeOfAKind: 3,
  fourOfAKind: 4,
  flush: 5,
  fullHouse: 6,
  straight: 7,
  straightFlush: 8,
  deadMans: 9,
} as const;

export type HandId = (typeof HAND)[keyof typeof HAND];

export interface HandInfo {
  name: string;
  multiplier: number;
}

/** Ordered weakest → strongest; the evaluator returns the best that applies. */
export const HANDS: Record<HandId, HandInfo> = {
  [HAND.none]: { name: "", multiplier: 1 },
  [HAND.pair]: { name: "PAIR", multiplier: 1.2 },
  [HAND.twoPair]: { name: "TWO PAIR", multiplier: 1.5 },
  [HAND.threeOfAKind]: { name: "THREE OF A KIND", multiplier: 1.8 },
  [HAND.fourOfAKind]: { name: "FOUR OF A KIND", multiplier: 2.4 },
  [HAND.flush]: { name: "FLUSH", multiplier: 2.6 },
  [HAND.fullHouse]: { name: "FULL HOUSE", multiplier: 2.8 },
  [HAND.straight]: { name: "STRAIGHT", multiplier: 3.0 },
  [HAND.straightFlush]: { name: "STRAIGHT FLUSH", multiplier: 4.5 },
  [HAND.deadMans]: { name: "DEAD MAN'S HAND", multiplier: 6.0 },
};

export interface HandState {
  /** Damage source of each kill in the window, in order. */
  sources: Int32Array;
  count: number;
  /** Base points accumulated (already carrying per-kill multipliers). */
  points: number;
  /** Tick at which the window lapses. */
  expiry: number;
  /** Did the player take a hit during this window? Kills Dead Man's Hand. */
  clean: boolean;
  /** Did the last kill land within 2m of the Rift? Upgrades a Straight. */
  atRift: boolean;
}

export function makeHand(): HandState {
  return {
    sources: new Int32Array(MAX_HAND),
    count: 0,
    points: 0,
    expiry: 0,
    clean: true,
    atRift: false,
  };
}

export function resetHand(h: HandState): void {
  h.count = 0;
  h.points = 0;
  h.expiry = 0;
  h.clean = true;
  h.atRift = false;
}

/**
 * Name the hand held in `h`.
 *
 * Counting is done into a tiny fixed scratch array rather than a Map, because
 * this runs inside the sim and must not allocate (§12.5).
 */
const scratchKinds = new Int32Array(32);
const scratchCounts = new Int32Array(32);

export function evaluate(h: HandState): HandId {
  const n = h.count;
  if (n < 2) return HAND.none;

  // Tally how many kills came from each distinct source.
  let distinct = 0;
  for (let i = 0; i < n; i++) {
    const s = h.sources[i];
    let found = -1;
    for (let k = 0; k < distinct; k++) {
      if (scratchKinds[k] === s) {
        found = k;
        break;
      }
    }
    if (found >= 0) scratchCounts[found]++;
    else if (distinct < scratchKinds.length) {
      scratchKinds[distinct] = s;
      scratchCounts[distinct] = 1;
      distinct++;
    }
  }

  let best = 0;
  let second = 0;
  for (let k = 0; k < distinct; k++) {
    const c = scratchCounts[k];
    if (c > best) {
      second = best;
      best = c;
    } else if (c > second) {
      second = c;
    }
  }

  // Strongest first: the moment one matches, it's the answer.
  if (n >= MAX_HAND && distinct >= 6 && h.clean) return HAND.deadMans;
  if (n >= 5 && distinct >= 5 && h.atRift) return HAND.straightFlush;
  if (n >= 5 && distinct >= 5) return HAND.straight;
  if (n >= 5 && best >= 3 && second >= 2) return HAND.fullHouse;
  if (n >= 5 && best >= 5) return HAND.flush;
  if (best >= 4) return HAND.fourOfAKind;
  if (best >= 3) return HAND.threeOfAKind;
  if (n >= 4 && distinct >= 2 && best >= 2 && second >= 2) return HAND.twoPair;
  if (n >= 2) return HAND.pair;
  return HAND.none;
}

/** Points banked when the window closes. */
export function score(h: HandState): number {
  const hand = evaluate(h);
  return Math.round(h.points * HANDS[hand].multiplier);
}
