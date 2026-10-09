const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ANALYZER_VERSION,
  LogFormatError,
  analyzeCsv,
  describe,
  dedupNames,
  hotColumns,
  parseApInfo,
  pyFixed,
} = require("./telemetry-analyze");

// Goldens are written by mqbtel itself (make_goldens.py in the fixtures dir).
const FIXTURES = path.join(__dirname, "__fixtures__", "telemetry");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

/** Deep equality with numbers compared to 1e-6 (relative above 1). */
function assertClose(actual, expected, where = "summary") {
  if (typeof expected === "number" && typeof actual === "number") {
    const tol = 1e-6 * Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tol, `${where}: ${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array, got ${JSON.stringify(actual)}`);
    assert.equal(actual.length, expected.length, `${where}: length`);
    expected.forEach((v, i) => assertClose(actual[i], v, `${where}[${i}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${where}: expected an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys`);
    for (const k of Object.keys(expected)) assertClose(actual[k], expected[k], `${where}.${k}`);
    return;
  }
  assert.equal(actual, expected, where);
}

const goldens = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".csv"))
  .map((f) => f.slice(0, -4));

test("there are goldens to compare against", () => {
  assert.ok(goldens.length >= 11, `only ${goldens.length} fixtures`);
});

for (const name of goldens) {
  test(`summary matches mqbtel: ${name}`, () => {
    const text = fs.readFileSync(path.join(FIXTURES, `${name}.csv`), "utf8");
    const { summary } = analyzeCsv(text, `${name}.csv`);
    assertClose(JSON.parse(JSON.stringify(summary)), readJson(`${name}.expected.json`), name);
  });
}

test("ANALYZER_VERSION names the mqbtel revision the goldens came from", () => {
  const golden = fs.readFileSync(path.join(FIXTURES, "VERSION"), "utf8").trim();
  assert.match(ANALYZER_VERSION, /\+js\d+$/);
  assert.equal(ANALYZER_VERSION.replace(/\+js\d+$/, ""), golden);
});

test("describe() labels and groups channels like mqbtel", () => {
  for (const [header, channel] of Object.entries(readJson("describe.expected.json"))) {
    assert.deepEqual(describe(header), channel, header);
  }
});

test("parseApInfo() splits the Accessport header like mqbtel", () => {
  for (const [cell, info] of Object.entries(readJson("ap_info.expected.json"))) {
    assert.deepEqual(parseApInfo(cell), info, cell);
  }
});

test("pyFixed rounds exact ties half-to-even, like Python", () => {
  assert.equal(pyFixed(2.5, 0), "2");
  assert.equal(pyFixed(3.5, 0), "4");
  assert.equal(pyFixed(-2.5, 0), "-2");
  assert.equal(pyFixed(0.125, 2), "0.12");
  assert.equal(pyFixed(0.375, 2), "0.38");
  assert.equal(pyFixed(2.25, 1, true), "+2.2");
  assert.equal(pyFixed(1.005, 2), "1.00"); // not a tie in binary
  assert.equal(pyFixed(-0.4, 0, true), "-0");
  assert.equal(pyFixed(0, 1, true), "+0.0");
  assert.equal(pyFixed(NaN, 1), "nan");
});

test("dedupNames copies pandas' duplicate-header renaming", () => {
  assert.deepEqual(dedupNames(["a", "a", "a", "a.1"]), ["a", "a.1", "a.2", "a.1.1"]);
});

test("unrecognised CSVs are rejected, never summarised", () => {
  assert.throws(() => analyzeCsv("Date,Odometer\n2026-10-01,232000\n"), LogFormatError);
  assert.throws(() => analyzeCsv(""), LogFormatError);
  assert.throws(
    () => analyzeCsv("Time (sec),Engine Speed (RPM)\n0,800,99\n"),
    /more columns than the header/
  );
});

test("hotColumns copies the list/trend fields out of a summary", () => {
  const text = fs.readFileSync(path.join(FIXTURES, "knock_one_cyl_boost.csv"), "utf8");
  const { summary } = analyzeCsv(text, "x.csv");
  assert.deepEqual(hotColumns(summary), {
    worstLevel: "warn",
    catMaxC: 50,
    knockMaxDeg: 4.5,
    ltftMeanPct: 1,
    pullCount: 1,
  });
});
