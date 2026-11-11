import { blankDraft } from "./laneDraft";
import { bookFor, leaveName, needsFor, oddsFor } from "./laneHelp";

const s = (rolls, standing) => ({ rolls, standing });
const MADE_10 = s([9, 1], [[10], []]);
const MISSED_10 = s([9, 0], [[10], [10]]);
const SPLIT = s([8, 0], [[7, 10], [7, 10]]);
// A real ten-frame game: the given frames, then missed 10 pins to the end.
const fill = (frames) => [...frames, ...Array.from({ length: 10 - frames.length }, () => MISSED_10)];

const row = (bowler, bowledOn, games, frames) => ({ bowler, bowledOn, games, frames });

describe("the leave book", () => {
  const series = [
    row("cha", "2026-10-06", [90, 90, 90], [fill([MADE_10, MADE_10, SPLIT]), null, null]),
    row("cha", "2026-10-13", [90, 90, 90], [fill([MADE_10]), null, null]),
  ];

  test("counts every leave across saved nights and tonight's games", () => {
    const draft = blankDraft("2026-10-20");
    draft.bowlers.cha.games[0].frames = [MADE_10, SPLIT];
    const book = bookFor(series, draft, "cha");
    // 10 pin: game 1 has 2 made + 7 missed, game 2 has 1 made + 9 missed, tonight 1 made.
    expect(book.leaves.get("10")).toEqual({ made: 4, chances: 20, pct: 20, split: false });
    expect(book.leaves.get("7-10")).toEqual({ made: 0, chances: 2, pct: 0, split: true });
    expect(book.split).toEqual({ made: 0, chances: 2, pct: 0 });
  });

  test("a saved night re-opened on the phone doesn't count twice", () => {
    const draft = blankDraft("2026-10-13");
    draft.bowlers.cha.games[0].frames = fill([MADE_10]);
    const book = bookFor(series, draft, "cha");
    expect(book.leaves.get("10").chances).toBe(19); // 9 from 10-06, 10 from the phone
  });

  test("oddsFor names the leave and handles a first sighting", () => {
    const book = bookFor(series, blankDraft("2026-10-20"), "cha");
    expect(oddsFor(book, [10])).toMatchObject({ name: "10 pin", made: 3, chances: 19 });
    expect(oddsFor(book, [2, 4, 5, 8])).toEqual({
      name: "2-4-5-8",
      made: 0,
      chances: 0,
      pct: null,
      split: false,
    });
    expect(oddsFor(book, null)).toBeNull();
    expect(oddsFor(book, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeNull();
    expect(leaveName([4, 7, 10])).toBe("4-7-10");
  });
});

describe("needsFor", () => {
  const series = [
    row("cha", "2026-10-06", [150, 160, 170], [null, null, null]),
    row("van", "2026-10-06", [140, 150, 160], [null, null, null]),
  ];

  test("average, best game and the other bowler's finished game", () => {
    const draft = blankDraft("2026-10-13");
    draft.bowlers.van.games[0] = { ...draft.bowlers.van.games[0], mode: "score", score: "187" };
    const needs = needsFor({ series, draft, bowler: "cha", game: 0, score: 100, best: 250 });
    expect(needs).toEqual([
      { id: "avg", label: "Average 160", target: 161, need: 61, state: "on" },
      { id: "high", label: "Best game 170", target: 171, need: 71, state: "on" },
      { id: "rival", label: "Vanessa's 187", target: 188, need: 88, state: "on" },
    ]);
  });

  test("beaten once the score is past it, out of reach once the max can't get there", () => {
    const draft = blankDraft("2026-10-13");
    const needs = needsFor({ series, draft, bowler: "cha", game: 0, score: 165, best: 168 });
    expect(needs.map((n) => [n.id, n.state, n.need])).toEqual([
      ["avg", "done", 0],
      ["high", "gone", 6],
    ]);
  });

  test("no history and no finished rival game means nothing to chase", () => {
    expect(needsFor({ series: null, draft: blankDraft("2026-10-13"), bowler: "cha", game: 1, score: 0, best: 300 })).toEqual([]);
  });
});
