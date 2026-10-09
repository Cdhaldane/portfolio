const test = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanFilename,
  parseId,
  validateUpload,
  validateEdit,
  validateEvent,
  reanalyzeLimit,
  parseSeriesQuery,
} = require("./telemetry-normalize");

const NOW = new Date("2026-10-08T20:00:00Z");
const GZ = "H4sIAAAAAAAAA0tMSgYAAAD//wMA"; // any base64 of plausible length

const upload = (over = {}) => ({
  car: "golf",
  filename: "datalog7.csv",
  recordedOn: "2026-10-04",
  csvGz: GZ,
  ...over,
});

test("validateUpload accepts a dry run and only commits on strict true", () => {
  const dry = validateUpload(upload(), NOW);
  assert.equal(dry.ok, true);
  assert.equal(dry.value.commit, false);
  assert.equal(validateUpload(upload({ commit: "true" }), NOW).value.commit, false);
  assert.equal(validateUpload(upload({ commit: 1 }), NOW).value.commit, false);
  assert.equal(validateUpload(upload({ commit: true }), NOW).value.commit, true);
});

test("validateUpload rejects bad cars, dates, names and bytes", () => {
  assert.equal(validateUpload(upload({ car: "civic" }), NOW).ok, false);
  assert.equal(validateUpload(upload({ recordedOn: "2026-10-12" }), NOW).ok, false);
  assert.equal(validateUpload(upload({ recordedOn: "2026-02-30" }), NOW).ok, false);
  assert.equal(validateUpload(upload({ filename: "   " }), NOW).ok, false);
  assert.equal(validateUpload(upload({ csvGz: "not base64!" }), NOW).ok, false);
  assert.equal(validateUpload(upload({ csvGz: "A".repeat(5 * 1024 * 1024) }), NOW).ok, false);
  assert.equal(validateUpload(null, NOW).ok, false);
});

test("validateUpload never sends a hash or summary through", () => {
  const r = validateUpload(upload({ sha256: "abc", summary: { worst_level: "ok" } }), NOW);
  assert.deepEqual(Object.keys(r.value).sort(), ["car", "commit", "csvGz", "filename", "note", "recordedOn"]);
});

test("cleanFilename strips folders and control characters", () => {
  assert.equal(cleanFilename("C:\\logs\\datalog1.csv"), "datalog1.csv");
  assert.equal(cleanFilename("../../etc/datalog\u0007.csv"), "datalog.csv");
  assert.equal(cleanFilename(42), null);
});

test("parseId accepts positive integers only", () => {
  assert.equal(parseId("12"), 12);
  assert.equal(parseId(3), 3);
  assert.equal(parseId("0"), null);
  assert.equal(parseId("1.5"), null);
  assert.equal(parseId("abc"), null);
  assert.equal(parseId(undefined), null);
});

test("validateEdit changes only what was sent, and can clear the note", () => {
  assert.deepEqual(validateEdit({ id: 4, recordedOn: "2026-10-01" }, NOW).value, {
    id: 4,
    recordedOn: "2026-10-01",
  });
  assert.deepEqual(validateEdit({ id: 4, note: "" }, NOW).value, { id: 4, note: null });
  assert.equal(validateEdit({ id: 4 }, NOW).ok, false);
  assert.equal(validateEdit({ id: 4, car: "civic" }, NOW).ok, false);
  assert.equal(validateEdit({ car: "golf" }, NOW).ok, false);
});

const event = (over = {}) => ({
  car: "golf",
  happenedOn: "2026-10-03",
  label: "  Oil   change ",
  kind: "service",
  odometerKm: "232450",
  cost: "$129.99",
  doneBy: "DIY",
  parts: "Liqui Moly 5W-40, Mann HU 7020 z",
  services: ["oil", "oil"],
  ...over,
});

test("validateEvent cleans a full work-log entry", () => {
  const r = validateEvent(event(), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    id: null,
    car: "golf",
    happenedOn: "2026-10-03",
    label: "Oil change",
    kind: "service",
    odometerKm: 232450,
    costCents: 12999,
    doneBy: "DIY",
    parts: "Liqui Moly 5W-40, Mann HU 7020 z",
    services: ["oil"],
    note: null,
  });
});

test("validateEvent: a reading needs km and gets a default label", () => {
  const r = validateEvent({ car: "cayenne", happenedOn: "2026-10-03", kind: "reading", odometerKm: 181000 }, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.label, "Odometer reading");
  assert.equal(validateEvent({ car: "cayenne", happenedOn: "2026-10-03", kind: "reading" }, NOW).ok, false);
});

test("validateEvent rejects what it can't store", () => {
  assert.equal(validateEvent(event({ label: "" }), NOW).ok, false);
  assert.equal(validateEvent(event({ kind: "wash" }), NOW).ok, false);
  assert.equal(validateEvent(event({ odometerKm: 12.5 }), NOW).ok, false);
  assert.equal(validateEvent(event({ odometerKm: -1 }), NOW).ok, false);
  assert.equal(validateEvent(event({ cost: "lots" }), NOW).ok, false);
  assert.equal(validateEvent(event({ cost: -5 }), NOW).ok, false);
  assert.equal(validateEvent(event({ services: ["Oil Change"] }), NOW).ok, false);
  assert.equal(validateEvent(event({ services: "oil" }), NOW).ok, false);
  assert.equal(validateEvent(event({ happenedOn: "2026-10-20" }), NOW).ok, false);
  assert.equal(validateEvent(event({ id: "x" }), NOW).ok, false);
});

test("validateEvent leaves optional fields null", () => {
  const r = validateEvent({ car: "golf", happenedOn: "2026-10-03", label: "Wash" }, NOW);
  assert.equal(r.value.kind, "service");
  assert.equal(r.value.odometerKm, null);
  assert.equal(r.value.costCents, null);
  assert.deepEqual(r.value.services, []);
});

test("reanalyzeLimit caps the page", () => {
  assert.equal(reanalyzeLimit({}), 10);
  assert.equal(reanalyzeLimit({ limit: 3 }), 3);
  assert.equal(reanalyzeLimit({ limit: 500 }), 10);
  assert.equal(reanalyzeLimit({ limit: "abc" }), 10);
});

test("parseSeriesQuery keeps at most 8 named channels and numeric bounds", () => {
  const q = parseSeriesQuery({ cols: "rpm, boost_psi,,cat_c", t0: "12.5", t1: "x", points: "800" });
  assert.deepEqual(q, { cols: ["rpm", "boost_psi", "cat_c"], t0: 12.5, t1: null, points: 800 });
  assert.equal(parseSeriesQuery({ cols: Array(20).fill("a").join(",") }).cols.length, 8);
  assert.deepEqual(parseSeriesQuery({}).cols, []);
});
