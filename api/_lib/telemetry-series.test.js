const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load } = require("./telemetry-analyze");
const { KNOCK_MAX, channels, minmaxDecimate, series } = require("./telemetry-series");

const FIXTURES = path.join(__dirname, "__fixtures__", "telemetry");
const fixture = (name) => load(fs.readFileSync(path.join(FIXTURES, `${name}.csv`), "utf8"), `${name}.csv`);

test("minmaxDecimate keeps a one-sample spike", () => {
  const n = 10000;
  const t = Float64Array.from({ length: n }, (_, i) => i / 10);
  const y = new Float64Array(n);
  y[5555] = 7.5;
  const out = minmaxDecimate(t, [y], 100);
  assert.ok(out.t.length <= 200);
  assert.equal(Math.max(...out.ys[0]), 7.5);
});

test("minmaxDecimate passes short series through untouched", () => {
  const out = minmaxDecimate(Float64Array.of(0, 1, 2), [Float64Array.of(5, NaN, 6)], 100);
  assert.deepEqual(out.t, [0, 1, 2]);
  assert.ok(Number.isNaN(out.ys[0][1]));
});

test("channels list every column plus the derived knock lane", () => {
  const list = channels(fixture("knock_one_cyl_boost"));
  const keys = list.map((c) => c.key);
  assert.equal(keys[0], KNOCK_MAX);
  assert.ok(keys.includes("cat_c"));
  assert.ok(!keys.includes("time_s"));
  const cat = list.find((c) => c.key === "cat_c");
  assert.deepEqual(cat.thresholds.map((th) => th.value), [70, 90]);
  assert.equal(list.find((c) => c.key === "Exhaust Cam Position (Degrees)").group, "Valvetrain");
});

test("no knock lane when the log has no knock channels", () => {
  assert.ok(!channels(fixture("no_knock_channels")).some((c) => c.key === KNOCK_MAX));
});

test("series windows, decimates and derives knock magnitude", () => {
  const log = fixture("knock_one_cyl_boost");
  const s = series(log, ["rpm", KNOCK_MAX, "nope"], { t0: 5, t1: 15, points: 50 });
  assert.deepEqual(Object.keys(s.series), ["rpm", KNOCK_MAX]);
  assert.equal(s.decimated, true);
  assert.equal(s.rawPoints, 53); // 51 rows in the window (5 Hz), plus one either side
  assert.equal(Math.max(...s.series[KNOCK_MAX]), 4.5);
  assert.ok(s.t[0] <= 5 && s.t[s.t.length - 1] >= 15);
});

test("series turns NaN into null for JSON", () => {
  const s = series(fixture("messy_cells"), ["boost_psi"], { points: 6000 });
  assert.ok(s.series.boost_psi.every((v) => v === null));
});
