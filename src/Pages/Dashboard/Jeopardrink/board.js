import { CATEGORIES, LAST_CALLS } from "./clues";

/*
 * Board building and the numbers every screen agrees on: dollar values,
 * sip counts, wager caps. Pure: randomness comes in as `rng` so tests can
 * pin it.
 */

export const CATS_PER_BOARD = 6;
export const CLUES_PER_CAT = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

// Round 1 is $200-$1000, "Double Jeopardrink" doubles it.
export const ROUND_VALUES = Object.freeze([
  [200, 400, 600, 800, 1000],
  [400, 800, 1200, 1600, 2000],
]);
// One Daily Double Shot in round 1, two in round 2 — same as the real show.
const DOUBLES_PER_ROUND = [1, 2];

// Nail a Daily Double Shot and you hand out this many sips.
export const DD_GIVE_SIPS = 3;

/** Wrong answer penalty by row: 1, 1, 2, 2, 3 sips. */
export const sipsFor = (row) => Math.ceil((row + 1) / 2);

/** Daily Double cap: your score, or the board's top value if you're poorer. */
export const maxWager = (score, round) =>
  Math.max(score, ROUND_VALUES[round][CLUES_PER_CAT - 1]);

/** Last Call cap: everything you've got (broke players still play for their liver). */
export const maxFinalWager = (score) => Math.max(score, 0);

export const clampWager = (amount, max) => {
  const n = Math.round(Number(amount));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
};

export const roundName = (round) => (round === 0 ? "Jeopardrink!" : "Double Jeopardrink!");

const shuffle = (list, rng) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Daily Doubles sit in different columns and never in the top row. */
const placeDoubles = (count, rng) => {
  const cols = shuffle([...Array(CATS_PER_BOARD).keys()], rng).slice(0, count);
  return new Set(cols.map((col) => `${col}:${1 + Math.floor(rng() * (CLUES_PER_CAT - 1))}`));
};

const buildBoard = (cats, round, rng) => {
  const doubles = placeDoubles(DOUBLES_PER_ROUND[round] ?? 1, rng);
  return {
    cats: cats.map((cat, col) => ({
      id: cat.id,
      name: cat.name,
      hint: cat.hint || "",
      clues: cat.clues.slice(0, CLUES_PER_CAT).map((clue, row) => ({
        q: clue.q,
        a: clue.a,
        value: ROUND_VALUES[round][row],
        dd: doubles.has(`${col}:${row}`),
        used: false,
      })),
    })),
  };
};

/**
 * A fresh game: `rounds` boards of six categories with no repeats, plus one
 * Last Call clue.
 */
export function buildGame({ rounds = 2, rng = Math.random, pool = CATEGORIES, finals = LAST_CALLS } = {}) {
  const count = Math.min(Math.max(rounds, 1), ROUND_VALUES.length);
  const picked = shuffle(pool, rng);
  const boards = Array.from({ length: count }, (_, r) =>
    buildBoard(picked.slice(r * CATS_PER_BOARD, (r + 1) * CATS_PER_BOARD), r, rng)
  );
  return { boards, finalClue: finals[Math.floor(rng() * finals.length)] };
}

export const boardCleared = (board) => board.cats.every((c) => c.clues.every((cl) => cl.used));
