import {
  celebrationFor,
  milestones,
  moneyline,
  nightsToTarget,
  pinsNeeded,
  projectedSeries,
  simulate,
  tonightsLine,
  totals,
  wrapFacts,
} from "./insights";
import { ALL_TIME, bestSeasonKey, inSeason, seasonList, seasonOf, seasonSummary } from "./seasons";

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

describe("seasons", () => {
  test("seasonOf buckets by month", () => {
    expect(seasonOf("2026-09-22").key).toBe("2026-fall");
    expect(seasonOf("2027-02-02")).toMatchObject({ key: "2027-spring", label: "Spring 2027" });
    expect(seasonOf("2027-06-10").key).toBe("2027-summer");
  });

  test("seasonList is chronological and inSeason filters", () => {
    const mixed = [...SERIES, S(8, "cha", "2027-01-12", [150, 150, 150])];
    expect(seasonList(mixed).map((s) => s.key)).toEqual(["2026-fall", "2027-spring"]);
    expect(inSeason(mixed, "2027-spring")).toHaveLength(1);
    expect(inSeason(mixed, ALL_TIME)).toHaveLength(8);
  });

  test("bestSeasonKey needs two eligible seasons", () => {
    const spring = [
      S(10, "cha", "2027-01-05", [200, 200, 200]),
      S(11, "cha", "2027-01-12", [200, 200, 200]),
      S(12, "cha", "2027-01-19", [200, 200, 200]),
    ];
    expect(bestSeasonKey(seasonSummary(SERIES), "cha")).toBeNull();
    const summary = seasonSummary([...SERIES, ...spring]);
    expect(bestSeasonKey(summary, "cha")).toBe("2027-spring");
    expect(bestSeasonKey(summary, "van")).toBeNull();
  });
});

describe("simulator math", () => {
  const t = totals(SERIES, "cha"); // 1873 pins over 12 games

  test("totals", () => {
    expect(t).toEqual({ sum: 1873, count: 12 });
  });

  test("pinsNeeded to reach a target average", () => {
    expect(pinsNeeded(t, 160)).toBe(527); // 160*15 - 1873
  });

  test("simulate returns the new average and handicap", () => {
    expect(simulate(t, 527)).toEqual({ average: 160, handicap: 54 });
  });

  test("nightsToTarget at a 600 pace, null when impossible", () => {
    expect(nightsToTarget(t, 170)).toBe(2); // (2040-1873)/(600-510)=1.86
    expect(nightsToTarget(t, 200)).toBeNull();
  });
});

describe("milestones", () => {
  test("returns at most four goals, closest first", () => {
    const goals = milestones(SERIES, "cha");
    expect(goals.length).toBeLessThanOrEqual(4);
    const progress = goals.map((g) => g.progress);
    expect(progress).toEqual([...progress].sort((a, b) => b - a));
    expect(goals.find((g) => g.id === "hg")).toBeTruthy(); // already has a 200
  });

  test("empty for a bowler with no nights", () => {
    expect(milestones([], "van")).toEqual([]);
  });
});

describe("tonight's line", () => {
  test("moneyline formatting", () => {
    expect(moneyline(0.5)).toBe("-100");
    expect(moneyline(0.75)).toBe("-300");
    expect(moneyline(0.25)).toBe("+300");
  });

  test("projectedSeries weights recent nights", () => {
    // weights 1..4 over cha's four series 480, 390, 570, 433
    expect(projectedSeries(SERIES, "cha")).toBe(Math.round((480 + 780 + 1710 + 1732) / 10));
  });

  test("favours the higher projection and probabilities sum to one", () => {
    const line = tonightsLine(SERIES);
    expect(line.favourite).toBe("cha");
    expect(line.cha.p + line.van.p).toBeCloseTo(1, 5);
    expect(tonightsLine(SERIES.slice(0, 2))).toBeNull();
  });
});

describe("wrap card", () => {
  test("facts for a night both bowled", () => {
    const facts = wrapFacts(SERIES, "2026-09-22");
    const cha = facts.bowlers.find((b) => b.key === "cha");
    expect(cha.total).toBe(433);
    expect(cha.beat).toBe(1); // only the 191 beat a 163.3 prior average
    expect(cha.pbSeries).toBe(false);
    expect(cha.clubStreak).toBe(0);
    expect(facts.lines[0]).toBe("Charlie 433, 1 of 3 games above average");
  });

  test("flags a new high series and the 200 club", () => {
    const facts = wrapFacts(SERIES, "2026-09-15");
    expect(facts.bowlers).toHaveLength(1);
    expect(facts.lines[0]).toBe(
      "Charlie 570, a new high series, 3 of 3 games above average, made the 200 club"
    );
  });

  test("celebrationFor picks the right animation", () => {
    expect(celebrationFor([{ games: [300, 120, 130] }])).toBe("perfect");
    expect(celebrationFor([{ games: [210, 120, 130] }])).toBe("club");
    expect(celebrationFor([{ games: [79, 120, 130] }])).toBe("gutter");
    expect(celebrationFor([{ games: [150, 120, 130] }])).toBe("strike");
  });
});
