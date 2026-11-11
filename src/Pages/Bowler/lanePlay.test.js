import { RECENT, lanePairs, lineStats } from "./lanePlay";

// First balls with their line marked (or not).
const X = (aim, hook) => ({ rolls: [10], standing: null, target: aim, hook });
const O = (aim, hook) => ({ rolls: [7, 2], standing: null, target: aim, hook });
const plain = { rolls: [9, 0], standing: null };
const crossed = { rolls: [10], standing: null, target: 12, actual: 10 }; // from before the picture

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

describe("lineStats", () => {
  const series = [
    row("cha", "2026-10-06", [150, 150, 150], {
      frames: [game(X(10, 6), X(10, 5), O(10, 9), O(10, 6), crossed), game(X(10, 7), O(12, 8), O(12, 3)), null],
    }),
    row("van", "2026-10-06", [150, 150, 150]),
  ];

  test("counts first balls with both an aim and a hook", () => {
    const s = lineStats(series, "cha");
    expect(s.throws).toBe(7);
    expect(s.strike).toEqual({ made: 3, chances: 7, pct: 42.9 });
    expect(s.recent[0]).toEqual({ aim: 10, hook: 6, strike: true });
  });

  test("aims are the most-used first, with where they hook on average", () => {
    const [top, next] = lineStats(series, "cha").aims;
    expect(top).toEqual({ board: 10, throws: 5, strike: { made: 3, chances: 5, pct: 60 }, hook: 6.6 });
    expect(next).toEqual({ board: 12, throws: 2, strike: { made: 0, chances: 2, pct: 0 }, hook: 5.5 });
  });

  test("the strike zone is the three boards where hooking strikes most", () => {
    // Hooks of 5-7: 6 X, 5 X, 6 open, 7 X. Hooks of 4-6 strike 2 of 3; of 6-8, 2 of 4.
    expect(lineStats(series, "cha").zone).toEqual({
      from: 5,
      to: 7,
      throws: 4,
      strike: { made: 3, chances: 4, pct: 75 },
    });
  });

  test("the chart keeps only the latest lines", () => {
    const tens = [game(...Array(10).fill(X(10, 6))), game(...Array(10).fill(X(10, 6))), game(...Array(10).fill(X(10, 6)))];
    const many = [
      row("cha", "2026-10-13", [300, 300, 300], { frames: tens }),
      row("cha", "2026-10-06", [150, 150, 150], { frames: [game(...Array(10).fill(O(15, 9))), null, null] }),
    ];
    const s = lineStats(many, "cha");
    expect(s.throws).toBe(40);
    expect(s.recent).toHaveLength(RECENT);
    expect(s.recent.filter((l) => l.aim === 15)).toHaveLength(0); // the older night dropped off
  });

  test("a bowler with nothing marked gets empty, not zero", () => {
    const s = lineStats(series, "van");
    expect(s.throws).toBe(0);
    expect(s.strike.pct).toBeNull();
    expect(s.recent).toEqual([]);
    expect(s.aims).toEqual([]);
    expect(s.zone).toBeNull();
  });
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
