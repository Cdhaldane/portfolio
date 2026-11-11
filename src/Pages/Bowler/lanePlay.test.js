import { boardStats, lanePairs, leanText } from "./lanePlay";

// A strike frame and an open one, with the boards noted (or not).
const X = (target, actual) => ({ rolls: [10], standing: null, target, actual });
const O = (target, actual) => ({ rolls: [7, 2], standing: null, target, actual });
const plain = { rolls: [9, 0], standing: null };

const game = (...noted) => [...noted, ...Array.from({ length: 10 - noted.length }, () => plain)];

const row = (bowler, bowledOn, games, extra = {}) => ({
  id: `${bowler}-${bowledOn}`,
  bowler,
  bowledOn,
  games,
  frames: [null, null, null],
  lanes: [null, null, null],
  ...extra,
});

describe("boardStats", () => {
  // Charlie: on target 3 times (2 strikes), inside by 3 twice, outside by 6 once.
  const series = [
    row("cha", "2026-10-06", [150, 150, 150], {
      frames: [game(X(12, 12), X(12, 13), O(12, 11), O(12, 15)), game(O(12, 15), O(10, 4)), null],
    }),
    row("van", "2026-10-06", [150, 150, 150]),
  ];

  test("counts only first balls with both boards", () => {
    const s = boardStats(series, "cha");
    expect(s.throws).toBe(6);
    expect(s.onTarget).toEqual({ made: 3, chances: 6, pct: 50 });
    expect(s.strikeNear).toEqual({ made: 2, chances: 3, pct: 66.7 });
    expect(s.strikeFar).toEqual({ made: 0, chances: 3, pct: 0 });
  });

  test("the miss chart clamps its ends and the lean averages the misses", () => {
    const s = boardStats(series, "cha");
    // bins: -4+ .. +4+  →  -6 lands in the first, then -1, 0, +1, and +3 twice
    expect(s.bins).toEqual([1, 0, 0, 1, 1, 1, 0, 2, 0]);
    expect(s.lean).toBe(0); // (0 + 1 - 1 + 3 + 3 - 6) / 6: the big outside miss cancels the rest
    expect(s.spread).toBe(2.3); // 14 / 6
  });

  test("targets are the most-used boards first", () => {
    const [top, next] = boardStats(series, "cha").targets;
    expect(top).toEqual({ board: 12, throws: 5, strike: { made: 2, chances: 5, pct: 40 }, lean: 1.2 });
    expect(next.board).toBe(10);
  });

  test("a bowler with nothing noted gets empty, not zero", () => {
    const s = boardStats(series, "van");
    expect(s.throws).toBe(0);
    expect(s.onTarget.pct).toBeNull();
    expect(s.lean).toBeNull();
    expect(s.bins.every((n) => n === 0)).toBe(true);
    expect(s.targets).toEqual([]);
  });
});

test("leanText says which way the misses go", () => {
  expect(leanText(null)).toBeNull();
  expect(leanText(0.3)).toBe("Right on your line, on average.");
  expect(leanText(1)).toBe("Misses inside by a board on average.");
  expect(leanText(-2.5)).toBe("Misses outside by 2.5 boards on average.");
});

describe("lanePairs", () => {
  const series = [
    row("cha", "2026-10-06", [200, 210, 190], { lanes: [13, 13, 15] }),
    row("cha", "2026-10-13", [150, 160, 170], { lanes: [15, 15, 9] }),
    row("cha", "2026-10-20", [180, 180, 180]), // no lanes noted
  ];

  test("averages each pair against the bowler's overall average", () => {
    const p = lanePairs(series, "cha");
    expect(p.games).toBe(6);
    expect(p.overall).toBe(180);
    expect(p.pairs.map((x) => x.label)).toEqual(["15-16", "13-14", "9-10"]);
    const [fifteen, thirteen, nine] = p.pairs;
    expect(fifteen).toEqual({ lane: 15, label: "15-16", games: 3, average: 166.7, diff: -13.3 });
    expect(thirteen.diff).toBe(25);
    expect(nine.games).toBe(1);
  });

  test("best and toughest need two pairs with enough games", () => {
    const p = lanePairs(series, "cha");
    expect(p.best).toBe(13);
    expect(p.worst).toBe(15);
    const one = lanePairs([series[2], row("cha", "2026-10-27", [1, 2, 3], { lanes: [3, 3, null] })], "cha");
    expect(one.best).toBeNull();
    expect(lanePairs(series, "van")).toEqual({ games: 0, overall: null, pairs: [], best: null, worst: null });
  });
});
