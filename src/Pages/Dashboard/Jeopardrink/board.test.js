import {
  CATS_PER_BOARD,
  ROUND_VALUES,
  boardCleared,
  buildGame,
  clampWager,
  maxFinalWager,
  maxWager,
  sipsFor,
} from "./board";
import { LAST_CALLS } from "./clues";

/** Deterministic PRNG so board layouts are reproducible. */
const seeded = (seed) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const doubles = (board) =>
  board.cats.flatMap((cat, col) => cat.clues.map((cl, row) => ({ ...cl, col, row }))).filter((c) => c.dd);

test("a full game is two boards of six distinct categories and a Last Call", () => {
  const { boards, finalClue } = buildGame({ rounds: 2, rng: seeded(7) });
  expect(boards).toHaveLength(2);
  boards.forEach((b) => expect(b.cats).toHaveLength(CATS_PER_BOARD));
  const ids = boards.flatMap((b) => b.cats.map((c) => c.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(LAST_CALLS).toContain(finalClue);
});

test("values follow the round, top to bottom", () => {
  const { boards } = buildGame({ rounds: 2, rng: seeded(3) });
  boards.forEach((b, r) =>
    b.cats.forEach((cat) => expect(cat.clues.map((c) => c.value)).toEqual(ROUND_VALUES[r]))
  );
});

test("daily doubles: one then two, separate columns, never the top row", () => {
  for (let seed = 1; seed < 60; seed += 1) {
    const { boards } = buildGame({ rounds: 2, rng: seeded(seed) });
    const [r1, r2] = boards.map(doubles);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(2);
    expect(r2[0].col).not.toBe(r2[1].col);
    [...r1, ...r2].forEach((d) => expect(d.row).toBeGreaterThan(0));
  }
});

test("a quick game is one board", () => {
  expect(buildGame({ rounds: 1, rng: seeded(11) }).boards).toHaveLength(1);
});

test("sips scale with the row: 1, 1, 2, 2, 3", () => {
  expect([0, 1, 2, 3, 4].map(sipsFor)).toEqual([1, 1, 2, 2, 3]);
});

test("wager caps match the show", () => {
  expect(maxWager(300, 0)).toBe(1000); // poor? you can still bet the top of the board
  expect(maxWager(5400, 0)).toBe(5400);
  expect(maxWager(-800, 1)).toBe(2000);
  expect(maxFinalWager(-200)).toBe(0);
  expect(maxFinalWager(3200)).toBe(3200);
});

test("clampWager rounds and boxes junk", () => {
  expect(clampWager("450.6", 1000)).toBe(451);
  expect(clampWager(-50, 1000)).toBe(0);
  expect(clampWager(9999, 1000)).toBe(1000);
  expect(clampWager("lots", 1000)).toBe(0);
});

test("boardCleared only when every clue is used", () => {
  const { boards } = buildGame({ rounds: 1, rng: seeded(5) });
  expect(boardCleared(boards[0])).toBe(false);
  const used = { cats: boards[0].cats.map((c) => ({ ...c, clues: c.clues.map((cl) => ({ ...cl, used: true })) })) };
  expect(boardCleared(used)).toBe(true);
});
