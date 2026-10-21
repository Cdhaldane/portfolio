import { CATEGORIES, LAST_CALLS } from "./clues";
import { CATS_PER_BOARD, CLUES_PER_CAT, ROUND_VALUES } from "./board";

const filled = (s) => typeof s === "string" && s.trim().length > 0;

test("there are enough categories for a full two-round game with no repeats", () => {
  expect(CATEGORIES.length).toBeGreaterThanOrEqual(CATS_PER_BOARD * ROUND_VALUES.length);
});

test("category ids and names are unique", () => {
  const ids = CATEGORIES.map((c) => c.id);
  const names = CATEGORIES.map((c) => c.name.toLowerCase());
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(names).size).toBe(names.length);
});

test("every category has exactly five filled-in clues", () => {
  CATEGORIES.forEach((cat) => {
    expect(filled(cat.name)).toBe(true);
    expect(cat.clues).toHaveLength(CLUES_PER_CAT);
    cat.clues.forEach((clue) => {
      expect(filled(clue.q)).toBe(true);
      expect(filled(clue.a)).toBe(true);
    });
  });
});

test("category names fit the board (and the API's 60-char cap)", () => {
  CATEGORIES.forEach((cat) => expect(cat.name.length).toBeLessThanOrEqual(40));
});

test("no answer repeats inside a category", () => {
  CATEGORIES.forEach((cat) => {
    const answers = cat.clues.map((c) => c.a.toLowerCase());
    expect(new Set(answers).size).toBe(answers.length);
  });
});

test("every Last Call clue has a category, clue and answer", () => {
  expect(LAST_CALLS.length).toBeGreaterThanOrEqual(8);
  LAST_CALLS.forEach((lc) => {
    expect(filled(lc.cat)).toBe(true);
    expect(filled(lc.q)).toBe(true);
    expect(filled(lc.a)).toBe(true);
  });
});
