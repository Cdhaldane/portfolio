// Pure helpers over the API's log list (and the work log, for trend markers).
// Logs arrive newest first: [{ id, car, recordedOn, ecuMap, tcmMap, apFirmware,
// worstLevel, catMaxC, knockMaxDeg, ltftMeanPct, pullCount, railRefDroopPct,
// catRiseC, ... }]
import { CAT_RISE_S, RAIL_REF_TEXT, THRESHOLDS } from "./cars";

const chronological = (a, b) =>
  a.recordedOn === b.recordedOn ? a.id - b.id : a.recordedOn < b.recordedOn ? -1 : 1;

const CONFIG_FIELDS = [
  ["ecuMap", "ECU map"],
  ["tcmMap", "TCM map"],
  ["apFirmware", "AP firmware"],
];

/**
 * Tune or firmware changes, keyed by the first log that shows the new value.
 * The very first log of a car is the baseline, not a change.
 * @returns {Map<number, { field: string, label: string, from: string, to: string }[]>}
 */
export function configChanges(logs) {
  const out = new Map();
  const prev = {};
  for (const log of [...logs].sort(chronological)) {
    const seen = (prev[log.car] = prev[log.car] || {});
    for (const [field, label] of CONFIG_FIELDS) {
      const value = log[field];
      if (!value) continue;
      if (seen[field] && seen[field] !== value) {
        out.set(log.id, [...(out.get(log.id) || []), { field, label, from: seen[field], to: value }]);
      }
      seen[field] = value;
    }
  }
  return out;
}

// `about` explains the number under its chart; `lines` are labelled threshold
// lines drawn over the bands; `empty` says why a car has no trend for it yet.
export const METRICS = [
  {
    key: "catMaxC",
    label: "Peak charge air temp",
    short: "Peak CAT",
    unit: "°C",
    digits: 0,
    thresholds: THRESHOLDS.catMaxC,
    about: "Peak charge air follows the weather as much as the car. Compare logs from similar days.",
  },
  {
    key: "catRiseC",
    label: `Charge air rise, first ${CAT_RISE_S} s of boost`,
    short: "CAT rise",
    unit: "°C",
    digits: 0,
    signed: true,
    thresholds: null,
    about:
      "Median over the log's pulls. The intercooler's before/after number: a better one brings this down.",
    empty: `Needs two logs with a pull that keeps going ${CAT_RISE_S} s or more after boost reaches 20 psi.`,
  },
  {
    key: "knockMaxDeg",
    label: "Max knock retard",
    short: "Max knock",
    unit: "°",
    digits: 2,
    thresholds: THRESHOLDS.knockMaxDeg,
  },
  {
    key: "ltftMeanPct",
    label: "Long-term fuel trim, mean",
    short: "LTFT",
    unit: "%",
    digits: 1,
    signed: true,
    thresholds: THRESHOLDS.ltftMeanPct,
  },
  {
    key: "railRefDroopPct",
    label: "Rail pressure drop at reference load",
    short: "Rail droop",
    unit: "%",
    digits: 1,
    thresholds: THRESHOLDS.railRefDroopPct,
    lines: [{ value: THRESHOLDS.railRefDroopPct.warn, level: "warn", label: `warn ${THRESHOLDS.railRefDroopPct.warn}%` }],
    about:
      `90th percentile at full load, ${RAIL_REF_TEXT}. The same load in every log, so a rising ` +
      "trend means the fuel pump is falling behind.",
    empty:
      `Needs two logs with 10+ full-load samples at ${RAIL_REF_TEXT}, ` +
      "with air mass per stroke logged.",
  },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** Watch/warn level of one list value, matching the checks' rules. Null for a metric with no verdict. */
export function metricLevel(key, value) {
  if (value === null || value === undefined) return null;
  const th = THRESHOLDS[key];
  if (!th) return null;
  if (key === "knockMaxDeg") return value > th.warn ? "warn" : value > th.watch ? "watch" : "ok";
  const v = key === "ltftMeanPct" ? Math.abs(value) : value;
  return v >= th.warn ? "warn" : th.watch !== undefined && v >= th.watch ? "watch" : "ok";
}

export function formatMetric(key, value) {
  const m = METRIC_BY_KEY[key];
  if (value === null || value === undefined) return "–";
  const text = value.toFixed(m.digits);
  return `${m.signed && value > 0 ? "+" : ""}${text}${m.unit}`;
}

/** One point per log that has the metric, oldest first. */
export function trendPoints(logs, key) {
  return [...logs]
    .sort(chronological)
    .filter((l) => l[key] !== null && l[key] !== undefined)
    .map((l) => ({ id: l.id, date: l.recordedOn, value: l[key], level: metricLevel(key, l[key]) }));
}

/** Dated markers for the trend chart: mods and repairs from the work log, plus tune changes. */
export function markers(events, logs) {
  const work = events
    .filter((e) => e.kind === "mod" || e.kind === "repair")
    .map((e) => ({ id: `e${e.id}`, date: e.happenedOn, label: e.label, kind: e.kind }));
  const changes = configChanges(logs);
  const byId = new Map(logs.map((l) => [l.id, l]));
  const tune = [...changes.entries()].map(([id, list]) => ({
    id: `t${id}`,
    date: byId.get(id).recordedOn,
    label: list.map((c) => `${c.label}: ${c.to}`).join(" · "),
    kind: "tune",
  }));
  return [...work, ...tune].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Average of a trend before vs from `date` on. A log on the day itself counts
 * as after: a mod fitted that morning is on the car for the drive home.
 */
export function beforeAfter(points, date) {
  const before = points.filter((p) => p.date < date).map((p) => p.value);
  const after = points.filter((p) => p.date >= date).map((p) => p.value);
  const b = mean(before);
  const a = mean(after);
  return {
    before: { mean: b, n: before.length },
    after: { mean: a, n: after.length },
    delta: a !== null && b !== null ? a - b : null,
  };
}
