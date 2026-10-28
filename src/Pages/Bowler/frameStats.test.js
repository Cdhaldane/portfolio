import { frameStats, framedGames, nightFrameStats } from "./frameStats";
import { checkGame, scoreGame } from "./scoring";

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const PERFECT = [
  ...Array.from({ length: 9 }, () => ({ rolls: [10], standing: [[]] })),
  { rolls: [10, 10, 10], standing: [[], [], []] },
];

// One of everything: single pins made and missed, a split, buckets, a
// gutter, strikes, pocket marks, and a 10th with a strike then a spare.
const MIXED = [
  { rolls: [9, 1], standing: [[10], []], pocket: true },
  { rolls: [9, 0], standing: [[7], [7]] },
  { rolls: [8, 0], standing: [[7, 10], [7, 10]], pocket: false },
  { rolls: [8, 2], standing: [[4, 7], []] },
  { rolls: [10], standing: [[]], pocket: true },
  { rolls: [7, 3], standing: [[3, 6, 10], []] },
  { rolls: [0, 10], standing: [ALL, []] },
  { rolls: [10], standing: [[]] },
  { rolls: [9, 1], standing: [[10], []] },
  { rolls: [10, 9, 1], standing: [[], [10], []] },
];

const row = (id, bowler, bowledOn, games, frames) => ({ id, bowler, bowledOn, games, frames });

test("the fixtures are real games", () => {
  expect(checkGame(PERFECT).ok).toBe(true);
  expect(checkGame(MIXED).ok).toBe(true);
  expect(scoreGame(MIXED).total).toBe(166);
});

test("a perfect game is twelve strikes from twelve and nothing else", () => {
  const s = frameStats([row(1, "cha", "2026-10-20", [300, 150, 150], [PERFECT, null, null])], "cha");
  expect(s.games).toBe(1);
  expect(s.totalGames).toBe(3);
  expect(s.strike).toEqual({ made: 12, chances: 12, pct: 100 });
  expect(s.spare).toEqual({ made: 0, chances: 0, pct: null });
  expect(s.opensPerGame).toBe(0);
  expect(s.firstBall).toBe(10);
  expect(s.pocket.pct).toBeNull();
  expect(s.leaves).toEqual([]);
});

test("spares split into single pin, multi pin and splits", () => {
  const s = frameStats([row(1, "cha", "2026-10-20", [166, 150, 150], [MIXED, null, null])], "cha");
  // Full racks: nine first balls plus the 10th's first two.
  expect(s.strike).toEqual({ made: 3, chances: 11, pct: 27.3 });
  expect(s.spare).toEqual({ made: 6, chances: 8, pct: 75 });
  expect(s.single).toEqual({ made: 3, chances: 4, pct: 75 });
  // The gutter leaves the head pin up, so it's a (big) bucket, not a split.
  expect(s.multi).toEqual({ made: 3, chances: 3, pct: 100 });
  expect(s.split).toEqual({ made: 0, chances: 1, pct: 0 });
  expect(s.opensPerGame).toBe(2);
  expect(s.firstBall).toBe(8.1);
  expect(s.pocket).toEqual({ made: 2, chances: 3, pct: 66.7 });
});

test("leaves rank by how often you see them", () => {
  const s = frameStats([row(1, "cha", "2026-10-20", [166, 150, 150], [MIXED, null, null])], "cha", {
    topLeaves: 3,
  });
  expect(s.leaves[0]).toEqual({ key: "10", pins: [10], made: 3, chances: 3, pct: 100, split: false });
  expect(s.leaves).toHaveLength(3);
  // Ties on count put the one you miss most first.
  expect(s.leaves[1].pct).toBe(0);
  expect(s.leaves.map((l) => l.key)).toContain("7-10");
});

test("nights without frames don't drag the frame stats down", () => {
  const series = [
    row(1, "cha", "2026-10-06", [140, 150, 160], null),
    row(2, "cha", "2026-10-13", [150, 166, 140], [null, MIXED, null]),
    row(3, "van", "2026-10-13", [120, 110, 130], [null, null, null]),
  ];
  const cha = frameStats(series, "cha");
  expect(cha.games).toBe(1);
  expect(cha.totalGames).toBe(6);
  expect(cha.strike.chances).toBe(11);

  const van = frameStats(series, "van");
  expect(van.games).toBe(0);
  expect(van.totalGames).toBe(3);
  expect(van.strike.pct).toBeNull();
  expect(van.opensPerGame).toBeNull();
  expect(van.firstBall).toBeNull();
  expect(van.leaves).toEqual([]);

  expect(frameStats([], "cha")).toMatchObject({ games: 0, totalGames: 0 });
});

test("count-only frames count toward spares but not the split buckets", () => {
  const counts = [
    { rolls: [7, 3], standing: null },
    { rolls: [9, 1], standing: null },
    ...Array.from({ length: 7 }, () => ({ rolls: [10], standing: null })),
    { rolls: [10, 10, 10], standing: null },
  ];
  const s = frameStats([row(1, "van", "2026-10-20", [scoreGame(counts).total, 0, 0], [counts, null, null])], "van");
  expect(s.spare).toEqual({ made: 2, chances: 2, pct: 100 });
  expect(s.single).toEqual({ made: 1, chances: 1, pct: 100 });
  expect(s.multi.chances).toBe(0);
  expect(s.split.chances).toBe(0);
  expect(s.leaves).toEqual([]);
});

test("one night's stats", () => {
  const night = row(1, "cha", "2026-10-20", [300, 166, 150], [PERFECT, MIXED, null]);
  expect(framedGames(night)).toHaveLength(2);
  const s = nightFrameStats(night);
  expect(s.games).toBe(2);
  expect(s.totalGames).toBe(3);
  expect(s.strike).toEqual({ made: 15, chances: 23, pct: 65.2 });
  expect(s.opensPerGame).toBe(1);
  expect(s.leaves).toHaveLength(3);
});

test("rows from before frames existed have no frames field at all", () => {
  expect(framedGames({ id: 1, bowler: "cha", bowledOn: "2026-09-01", games: [1, 2, 3] })).toEqual([]);
});
