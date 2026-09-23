import {
  averageBefore,
  badges,
  beatAverageStreak,
  bowlerStats,
  handicapFor,
  headToHead,
  nights,
  seriesFor,
  trendPoints,
} from "./stats";

const S = (id, bowler, bowledOn, games) => ({ id, bowler, bowledOn, games });

const SERIES = [
  S(1, "cha", "2026-09-01", [150, 160, 170]),
  S(2, "van", "2026-09-01", [90, 100, 110]),
  S(3, "cha", "2026-09-08", [120, 130, 140]),
  S(4, "van", "2026-09-08", [140, 150, 160]),
  S(5, "cha", "2026-09-15", [180, 200, 190]),
  S(6, "cha", "2026-09-22", [191, 122, 120]),
  S(7, "van", "2026-09-22", [93, 93, 119]),
];

test("bowlerStats computes the headline numbers", () => {
  const cha = bowlerStats(SERIES, "cha");
  expect(cha.nights).toBe(4);
  expect(cha.games).toBe(12);
  expect(cha.average).toBe(156.1);
  expect(cha.highGame).toEqual({ score: 200, date: "2026-09-15" });
  expect(cha.highSeries).toEqual({ score: 570, date: "2026-09-15" });
  expect(cha.over200).toBe(1);
  expect(cha.splits).toEqual([160.3, 153, 155]);
  expect(cha.splitLabel).toBe("Fast starter");
  // last three nights (avg 154.8) vs the first (160)
  expect(cha.form).toBe(-5.2);
});

test("bowlerStats is null-safe for a bowler with no nights", () => {
  const none = bowlerStats([], "van");
  expect(none.nights).toBe(0);
  expect(none.average).toBeNull();
  expect(none.handicap).toBeNull();
  expect(none.highGame).toBeNull();
  expect(none.form).toBeNull();
  expect(none.splitLabel).toBeNull();
  expect(none.streak).toBe(0);
});

test("handicapFor uses 90% of 220 and never goes negative", () => {
  expect(handicapFor(156.1)).toBe(57);
  expect(handicapFor(230)).toBe(0);
  expect(handicapFor(null)).toBeNull();
});

test("averageBefore only counts earlier nights", () => {
  const rows = seriesFor(SERIES, "cha");
  expect(averageBefore(rows, "2026-09-01")).toBeNull();
  expect(averageBefore(rows, "2026-09-08")).toBe(160);
});

test("beatAverageStreak counts back from the latest night", () => {
  const rows = seriesFor(SERIES, "van");
  // 09-08 (150) beat 100; 09-22 (101.7) did not beat 125
  expect(beatAverageStreak(rows)).toBe(0);
  expect(beatAverageStreak(rows.slice(0, 2))).toBe(1);
});

test("headToHead tallies shared nights and games", () => {
  const h = headToHead(SERIES);
  expect(h.shared).toBe(3);
  expect(h.nights).toEqual({ a: 2, b: 1, tie: 0 });
  expect(h.games).toEqual({ a: 6, b: 3 });
  expect(h.biggest).toEqual({ margin: 180, date: "2026-09-01", winner: "cha" });
});

test("trendPoints has one point per night with gaps as null", () => {
  const pts = trendPoints(SERIES);
  expect(pts).toHaveLength(4);
  expect(pts[2]).toMatchObject({ date: "2026-09-15", cha: 190, van: null });
});

test("nights lists newest first with both bowlers", () => {
  const list = nights(SERIES);
  expect(list[0].date).toBe("2026-09-22");
  expect(list[0].rows.van.id).toBe(7);
  expect(list[1].rows.van).toBeNull();
});

test("badges records the first night each was earned", () => {
  const cha = Object.fromEntries(badges(SERIES, "cha").map((b) => [b.id, b.earnedOn]));
  expect(cha.century).toBe("2026-09-15");
  expect(cha.clean).toBe("2026-09-01");
  expect(cha["500"]).toBe("2026-09-15");
  expect(cha["600"]).toBeNull();
  expect(cha.steady).toBeNull();
  expect(cha.regular).toBeNull();
});

test("stat helpers never mutate their input", () => {
  const frozen = Object.freeze(SERIES.map((s) => Object.freeze({ ...s })));
  expect(() => {
    bowlerStats(frozen, "cha");
    headToHead(frozen);
    trendPoints(frozen);
    nights(frozen);
    badges(frozen, "van");
  }).not.toThrow();
});
