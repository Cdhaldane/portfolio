import { beforeAfter, configChanges, formatMetric, markers, metricLevel, trendPoints } from "./logs";

const L = (id, recordedOn, over = {}) => ({
  id,
  car: "golf",
  recordedOn,
  ecuMap: "EQT Stage 2 91 v2.52",
  tcmMap: "COBB Aggressive v110",
  apFirmware: "1.7.6.0",
  catMaxC: null,
  knockMaxDeg: null,
  ltftMeanPct: null,
  ...over,
});

const LOGS = [
  L(4, "2026-10-06", { catMaxC: 71, ecuMap: "EQT Stage 2+ 93 v2.60" }),
  L(3, "2026-10-01", { catMaxC: 95 }),
  L(2, "2026-09-25", { catMaxC: 88, apFirmware: null }),
  L(1, "2026-09-20", { catMaxC: 86, car: "golf" }),
  L(9, "2026-09-21", { car: "cayenne", ecuMap: null, tcmMap: null, apFirmware: null }),
];

test("configChanges flags the first log after a tune change, not the baseline", () => {
  const changes = configChanges(LOGS);
  expect([...changes.keys()]).toEqual([4]);
  expect(changes.get(4)).toEqual([
    { field: "ecuMap", label: "ECU map", from: "EQT Stage 2 91 v2.52", to: "EQT Stage 2+ 93 v2.60" },
  ]);
});

test("a missing value is not a change", () => {
  // Log 2 has no firmware; log 3 has the same firmware as log 1.
  expect(configChanges(LOGS).has(3)).toBe(false);
});

test("trendPoints are oldest first and skip logs without the metric", () => {
  const pts = trendPoints(LOGS, "catMaxC");
  expect(pts.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  expect(pts[2].level).toBe("warn");
});

test("beforeAfter splits on a date, counting that day as after", () => {
  const pts = trendPoints(LOGS, "catMaxC");
  const r = beforeAfter(pts, "2026-10-01");
  expect(r.before).toEqual({ mean: 87, n: 2 });
  expect(r.after).toEqual({ mean: 83, n: 2 });
  expect(r.delta).toBe(-4);
  expect(beforeAfter(pts, "2027-01-01").delta).toBe(null);
});

test("markers merge mods, repairs and tune changes by date", () => {
  const events = [
    { id: 1, kind: "mod", happenedOn: "2026-09-30", label: "Intercooler installed" },
    { id: 2, kind: "service", happenedOn: "2026-09-29", label: "Oil change" },
  ];
  expect(markers(events, LOGS).map((m) => [m.date, m.kind])).toEqual([
    ["2026-09-30", "mod"],
    ["2026-10-06", "tune"],
  ]);
});

test("metricLevel follows the check thresholds", () => {
  expect(metricLevel("catMaxC", 69.9)).toBe("ok");
  expect(metricLevel("catMaxC", 70)).toBe("watch");
  expect(metricLevel("knockMaxDeg", 0)).toBe("ok");
  expect(metricLevel("knockMaxDeg", 0.75)).toBe("watch");
  expect(metricLevel("knockMaxDeg", 3.5)).toBe("warn");
  expect(metricLevel("ltftMeanPct", -10.2)).toBe("warn");
  expect(metricLevel("ltftMeanPct", null)).toBe(null);
  expect(formatMetric("ltftMeanPct", 2.25)).toBe("+2.3%");
  expect(formatMetric("catMaxC", 86.2)).toBe("86°C");
});
