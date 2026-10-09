// Chart data for one parsed log: the channel list and min/max-decimated
// series for the ones the page asked for. Ported from mqbtel's dashboard
// (web/library.py) so the two draw the same picture. NOT an endpoint.
const {
  describe,
  KNOCK_COLS,
  CAT_WATCH_C,
  CAT_WARN_C,
  KNOCK_WARN_DEG,
  LTFT_WATCH_PCT,
  LTFT_WARN_PCT,
} = require("./telemetry-analyze");

const DEFAULT_POINTS = 1600;
const MIN_POINTS = 50;
const MAX_POINTS = 6000;

// A derived channel: the worst cylinder's retard as positive degrees, so one
// lane shows every knock event regardless of which cylinder logged it.
const KNOCK_MAX = "kr_max";

// Reference lines the chart draws on a lane. Levels match the checks.
const THRESHOLDS = Object.freeze({
  cat_c: [
    { value: CAT_WATCH_C, level: "watch" },
    { value: CAT_WARN_C, level: "warn" },
  ],
  [KNOCK_MAX]: [{ value: KNOCK_WARN_DEG, level: "warn" }],
  ltft_pct: [
    { value: LTFT_WATCH_PCT, level: "watch" },
    { value: -LTFT_WATCH_PCT, level: "watch" },
    { value: LTFT_WARN_PCT, level: "warn" },
    { value: -LTFT_WARN_PCT, level: "warn" },
  ],
});

function hasData(arr) {
  for (let i = 0; i < arr.length; i += 1) if (!Number.isNaN(arr[i])) return true;
  return false;
}

/** Every plottable column, described, with the derived knock lane first in its group. */
function channels(log) {
  const out = [];
  const knock = KNOCK_COLS.filter((c) => log.data.has(c));
  if (knock.length) {
    out.push({
      key: KNOCK_MAX,
      label: "Knock retard, worst cylinder",
      unit: "deg",
      group: "Ignition & knock",
      hasData: knock.some((c) => hasData(log.data.get(c))),
      thresholds: THRESHOLDS[KNOCK_MAX],
    });
  }
  for (const col of log.columns) {
    if (col === "time_s") continue;
    const ch = describe(col);
    out.push({ ...ch, hasData: hasData(log.data.get(col)), thresholds: THRESHOLDS[col] || [] });
  }
  return out;
}

function columnFor(log, key) {
  if (key !== KNOCK_MAX) return log.data.get(key) || null;
  const cols = KNOCK_COLS.filter((c) => log.data.has(c)).map((c) => log.data.get(c));
  if (!cols.length) return null;
  const out = new Float64Array(log.length);
  for (let i = 0; i < log.length; i += 1) {
    let m = 0;
    for (const arr of cols) {
      const v = Math.abs(arr[i]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/**
 * Downsample for plotting without losing peaks. Each bucket keeps two points
 * per series, its min and its max in the order they occurred, so a single-
 * sample knock spike survives at any zoom level.
 */
function minmaxDecimate(t, ys, buckets) {
  const n = t.length;
  if (n <= buckets * 2) return { t: Array.from(t), ys: ys.map((y) => Array.from(y)) };
  const size = Math.ceil(n / buckets);
  const nb = Math.ceil(n / size);
  const tOut = new Array(nb * 2);
  for (let b = 0; b < nb; b += 1) {
    tOut[2 * b] = t[b * size];
    tOut[2 * b + 1] = t[Math.min(n, (b + 1) * size) - 1];
  }
  const out = ys.map((y) => {
    const o = new Array(nb * 2);
    for (let b = 0; b < nb; b += 1) {
      const start = b * size;
      const end = Math.min(n, start + size);
      let iMin = -1;
      let iMax = -1;
      for (let i = start; i < end; i += 1) {
        const v = y[i];
        if (Number.isNaN(v)) continue;
        if (iMin === -1 || v < y[iMin]) iMin = i;
        if (iMax === -1 || v > y[iMax]) iMax = i;
      }
      if (iMin === -1) {
        o[2 * b] = NaN;
        o[2 * b + 1] = NaN;
      } else if (iMin <= iMax) {
        o[2 * b] = y[iMin];
        o[2 * b + 1] = y[iMax];
      } else {
        o[2 * b] = y[iMax];
        o[2 * b + 1] = y[iMin];
      }
    }
    return o;
  });
  return { t: tOut, ys: out };
}

const roundTo = (digits) => {
  const f = 10 ** digits;
  return (v) => (Number.isFinite(v) ? Math.round(v * f) / f : null);
};

/**
 * Series for the requested channels between t0 and t1 (seconds), keeping one
 * sample either side of the window so lines run to the plot edge.
 */
function series(log, keys, { points = DEFAULT_POINTS, t0 = null, t1 = null } = {}) {
  const t = log.data.get("time_s");
  if (!t) return null;
  const wanted = [...new Set(keys)]
    .filter((k) => k !== "time_s")
    .map((k) => [k, columnFor(log, k)])
    .filter(([, col]) => col);
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < t.length; i += 1) {
    const v = t[i];
    if (Number.isNaN(v) || (t0 !== null && v < t0) || (t1 !== null && v > t1)) continue;
    if (lo === -1) lo = i;
    hi = i;
  }
  const start = lo === -1 ? 0 : Math.max(lo - 1, 0);
  const end = lo === -1 ? 0 : Math.min(hi + 2, t.length);
  const tt = t.subarray(start, end);
  const ys = wanted.map(([, col]) => col.subarray(start, end));
  const budget = Math.max(MIN_POINTS, Math.min(Math.trunc(points) || DEFAULT_POINTS, MAX_POINTS));
  const dec = minmaxDecimate(tt, ys, Math.floor(budget / 2));
  const r3 = roundTo(3);
  const r4 = roundTo(4);
  return {
    t: dec.t.map(r3),
    series: Object.fromEntries(wanted.map(([k], i) => [k, dec.ys[i].map(r4)])),
    decimated: dec.t.length < tt.length,
    rawPoints: tt.length,
  };
}

module.exports = {
  DEFAULT_POINTS,
  MAX_POINTS,
  KNOCK_MAX,
  THRESHOLDS,
  channels,
  minmaxDecimate,
  series,
};
