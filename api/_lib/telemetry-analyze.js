// Datalog analysis for /api/telemetry — a JavaScript port of mqbtel's
// columns.py, parser.py and analyze.py. Pure: no I/O, no DOM, no Node-only
// APIs. NOT an endpoint (the `_lib` prefix keeps Vercel from routing to it).
//
// mqbtel (the Python CLI, its own repo) is the reference. The golden tests in telemetry-analyze.test.js feed synthetic CSVs through this
// module and deep-compare against JSON that mqbtel's Python wrote for the
// same files (__fixtures__/telemetry/make_goldens.py). If the two disagree,
// fix this port or regenerate the goldens; never hand-edit expected JSON.
//
// Output is snake_case on purpose: it is mqbtel's LogSummary, field for
// field, and it is what tel_logs.summary stores.
//
// Two copies of pandas behaviour matter for parity and are reproduced here
// rather than approximated:
//   * blank/text cells are NaN (not 0) and every max/min/mean skips NaN;
//   * duplicate headers are renamed X.1, X.2 ... and the parser drops X.1.
// Messages must match Python byte for byte, so numbers in them go through
// pyFixed(), which rounds exact ties half-to-even the way Python's format
// does (JS toFixed rounds them away from zero).

// Bump the +jsN suffix for a port-only change, and the mqbtel part whenever
// the goldens are regenerated from a new mqbtel revision. Stored rows with an
// older value are re-run by POST { action: "reanalyze" }.
const ANALYZER_VERSION = "mqbtel@4025e04+wip.2471839+js1";

// --- columns.py ---------------------------------------------------------------

// Cobb Accessport column header -> canonical key
const COBB_TO_CANON = Object.freeze({
  "Time (sec)": "time_s",
  "Engine Speed (RPM)": "rpm",
  "Accel Pedal Position (%)": "pedal_pct",
  "TPS (TPS)": "throttle_pct",
  "Boost Press. (psi)": "boost_psi",
  "PUT Set Point (psi)": "put_sp_psia",
  "Press Upstream Throttle (psi)": "put_psia",
  "Charge Air Temperature (C)": "cat_c",
  "Engine Oil Temp. (C)": "oil_c",
  "Ignition Timing Final (Degrees)": "timing_deg",
  "Knock Retard Cylinder 1 (Degrees)": "kr_cyl1",
  "Knock Retard Cylinder 2 (Degrees)": "kr_cyl2",
  "Knock Retard Cylinder 3 (Degrees)": "kr_cyl3",
  "Knock Retard Cylinder 4 (Degrees)": "kr_cyl4",
  "AFR (AFR)": "afr",
  "AFR Set Point (AFR)": "afr_sp",
  "LTFT (%)": "ltft_pct",
  "STFT (%)": "stft_pct",
  "Torque Actual (ft-lb)": "torque_ftlb",
  "Current Gear (-)": "gear",
  "Rail Press. (psi)": "rail_psi",
  "Rail Pressure Set Point (psi)": "rail_sp_psi",
  "(DSG)Vehicle Speed (mph)": "speed_mph",
});

const KNOCK_COLS = Object.freeze(["kr_cyl1", "kr_cyl2", "kr_cyl3", "kr_cyl4"]);

const UNITS = Object.freeze({
  time_s: "s",
  rpm: "rpm",
  pedal_pct: "%",
  throttle_pct: "%",
  boost_psi: "psi",
  put_sp_psia: "psia",
  put_psia: "psia",
  cat_c: "C",
  oil_c: "C",
  coolant_c: "C",
  iat_c: "C",
  timing_deg: "deg",
  kr_cyl1: "deg",
  kr_cyl2: "deg",
  kr_cyl3: "deg",
  kr_cyl4: "deg",
  afr: "AFR",
  afr_sp: "AFR",
  ltft_pct: "%",
  stft_pct: "%",
  torque_ftlb: "ft-lb",
  rail_psi: "psi",
  rail_sp_psi: "psi",
  speed_mph: "mph",
  speed_kmh: "km/h",
  map_kpa: "kPa",
  baro_kpa: "kPa",
  maf_gs: "g/s",
  load_pct: "%",
  gear: "",
});

const GROUPS = Object.freeze([
  "Engine", "Boost & air", "Ignition & knock", "Fuel", "Temperatures",
  "Torque", "Valvetrain", "Transmission (DSG)", "Other",
]);

const CANON = Object.freeze({
  time_s: ["Time", "Other"],
  rpm: ["Engine speed", "Engine"],
  pedal_pct: ["Accel pedal", "Engine"],
  throttle_pct: ["Throttle position", "Engine"],
  load_pct: ["Calculated load", "Engine"],
  speed_mph: ["Vehicle speed", "Engine"],
  speed_kmh: ["Vehicle speed", "Engine"],
  gear: ["Current gear", "Transmission (DSG)"],
  boost_psi: ["Boost", "Boost & air"],
  put_psia: ["Pressure upstream throttle", "Boost & air"],
  put_sp_psia: ["PUT set point", "Boost & air"],
  map_kpa: ["Manifold pressure", "Boost & air"],
  baro_kpa: ["Barometric pressure", "Boost & air"],
  maf_gs: ["Mass air flow", "Boost & air"],
  timing_deg: ["Ignition timing", "Ignition & knock"],
  kr_cyl1: ["Knock retard cyl 1", "Ignition & knock"],
  kr_cyl2: ["Knock retard cyl 2", "Ignition & knock"],
  kr_cyl3: ["Knock retard cyl 3", "Ignition & knock"],
  kr_cyl4: ["Knock retard cyl 4", "Ignition & knock"],
  afr: ["AFR", "Fuel"],
  afr_sp: ["AFR set point", "Fuel"],
  ltft_pct: ["Long-term fuel trim", "Fuel"],
  stft_pct: ["Short-term fuel trim", "Fuel"],
  rail_psi: ["Rail pressure", "Fuel"],
  rail_sp_psi: ["Rail pressure set point", "Fuel"],
  cat_c: ["Charge air temp", "Temperatures"],
  oil_c: ["Oil temp", "Temperatures"],
  coolant_c: ["Coolant temp", "Temperatures"],
  iat_c: ["Intake air temp", "Temperatures"],
  torque_ftlb: ["Torque actual", "Torque"],
});

const HEADER_RE = /^(\(DSG\))?\s*(.*?)\s*\(([^()]*)\)\s*$/;

const UNIT_ALIASES = Object.freeze({ Degrees: "deg", RPM: "rpm", Gear: "" });

// First match wins; checked against the lowercased label.
const GROUP_RULES = Object.freeze([
  ["knock", "Ignition & knock"], ["spark", "Ignition & knock"], ["ignition", "Ignition & knock"],
  ["cam ", "Valvetrain"], ["cam position", "Valvetrain"],
  ["torque", "Torque"], ["trq", "Torque"],
  ["rail", "Fuel"], ["hpfp", "Fuel"], ["inject", "Fuel"], ["afr", "Fuel"], ["ltft", "Fuel"], ["stft", "Fuel"],
  ["temp", "Temperatures"],
  ["boost", "Boost & air"], ["press upstream", "Boost & air"], ["put ", "Boost & air"],
  ["air mass", "Boost & air"], ["mass flow", "Boost & air"], ["wastegate", "Boost & air"],
  ["turbine", "Boost & air"], ["intake flap", "Boost & air"],
  ["engine speed", "Engine"], ["pedal", "Engine"], ["tps", "Engine"], ["speed", "Engine"],
]);

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Label, unit and group for any column, canonical or raw Cobb header. */
function describe(col) {
  if (own(CANON, col)) {
    const [label, group] = CANON[col];
    return { key: col, label, unit: own(UNITS, col) ? UNITS[col] : "", group };
  }
  const m = HEADER_RE.exec(col);
  if (!m) return { key: col, label: col, unit: "", group: "Other" };
  const label = m[2];
  let unit = own(UNIT_ALIASES, m[3]) ? UNIT_ALIASES[m[3]] : m[3];
  if (["-", "", label.toLowerCase()].includes(unit.toLowerCase())) unit = "";
  if (m[1]) return { key: col, label, unit, group: "Transmission (DSG)" };
  const low = `${label.toLowerCase()} `;
  const rule = GROUP_RULES.find(([needle]) => low.includes(needle));
  return { key: col, label, unit, group: rule ? rule[1] : "Other" };
}

// --- parser.py ----------------------------------------------------------------

/** Pull firmware / vehicle / map names out of Cobb's 'AP Info:[..][..][..]' header. */
function parseApInfo(headerCell) {
  const parts = [...headerCell.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
  const out = { ap_firmware: null, vehicle: null, ecu_map: null, tcm_map: null };
  if (parts.length >= 1) {
    // "AP3-VLK-003 v1.7.6.0-26745"
    const bits = parts[0].split(/\s+/).filter(Boolean);
    out.ap_firmware = bits.length > 1 ? bits[bits.length - 1].replace(/^v+/, "") : parts[0];
  }
  if (parts.length >= 2) out.vehicle = parts[1];
  if (parts.length >= 3) {
    const raw = parts[2].startsWith("Reflash:") ? parts[2].slice("Reflash:".length) : parts[2];
    const flash = raw.trim();
    const at = flash.indexOf(" - TCM:");
    if (at !== -1) {
      out.ecu_map = flash.slice(0, at).trim();
      out.tcm_map = flash.slice(at + " - TCM:".length).trim();
    } else {
      out.ecu_map = flash;
    }
  }
  return out;
}

class LogFormatError extends Error {}

/**
 * Split CSV text into records of string fields, skipping blank lines the way
 * pandas does. Lines without a quote take a fast split; a quoted field may
 * hold commas, doubled quotes or line breaks.
 */
function* csvRecords(text) {
  if (text.indexOf("\n") === -1 && text.indexOf("\r") !== -1) text = text.replace(/\r/g, "\n");
  const n = text.length;
  let i = 0;
  let nextQuote = -1;
  while (i < n) {
    let end = text.indexOf("\n", i);
    if (end === -1) end = n;
    if (nextQuote !== n && nextQuote < i) {
      nextQuote = text.indexOf('"', i);
      if (nextQuote === -1) nextQuote = n;
    }
    if (nextQuote >= end) {
      let line = text.slice(i, end);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      i = end + 1;
      if (line !== "") yield line.split(",");
      continue;
    }
    // Quote-aware path, one record. A quote only opens a field at its start
    // (pandas' tokenizer); anywhere else it is a literal character.
    const fields = [];
    let field = "";
    let quoted = false;
    let atStart = true;
    let j = i;
    for (; j < n; j += 1) {
      const c = text[j];
      if (quoted) {
        if (c === '"') {
          if (text[j + 1] === '"') {
            field += '"';
            j += 1;
          } else {
            quoted = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"' && atStart) {
        quoted = true;
        atStart = false;
      } else if (c === ",") {
        fields.push(field);
        field = "";
        atStart = true;
      } else if (c === "\n" || c === "\r") {
        break;
      } else {
        field += c;
        atStart = false;
      }
    }
    fields.push(field);
    i = text[j] === "\r" && text[j + 1] === "\n" ? j + 2 : j + 1;
    if (!(fields.length === 1 && fields[0] === "")) yield fields;
  }
}

/** pandas' duplicate-header renaming: X, X.1, X.2 ... never colliding. */
function dedupNames(names) {
  const counts = new Map();
  return names.map((name) => {
    let col = name;
    let cur = counts.get(col) || 0;
    while (cur > 0) {
      counts.set(col, cur + 1);
      col = `${col}.${cur}`;
      cur = counts.get(col) || 0;
    }
    counts.set(col, cur + 1);
    return col;
  });
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INF_RE = /^([+-]?)inf(inity)?$/i;

/** A cell as pd.to_numeric(errors="coerce") sees it. */
function toNumber(cell) {
  if (cell === undefined) return NaN;
  const s = cell.trim();
  if (NUMBER_RE.test(s)) return Number(s);
  const inf = INF_RE.exec(s);
  if (inf) return inf[1] === "-" ? -Infinity : Infinity;
  return NaN;
}

/**
 * Parse a Cobb Accessport datalog (or an mqbtel live-logger CSV) into
 * numeric columns. Throws LogFormatError for anything else, so an
 * unrecognised file is rejected rather than stored with every check missing.
 * @returns {{ meta: object, columns: string[], data: Map<string, Float64Array>, length: number }}
 */
function load(text, name = "log.csv") {
  if (typeof text !== "string") throw new LogFormatError("That file isn't text.");
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = csvRecords(body);
  const first = records.next();
  if (first.done) throw new LogFormatError("That file is empty.");

  const rawNames = first.value.map((h, i) => (h === "" ? `Unnamed: ${i}` : h));
  const names = dedupNames(rawNames).map((h) => h.trim());

  const apCols = names.filter((c) => c.startsWith("AP Info:"));
  let source;
  let meta;
  const keep = []; // [original index, final column name]
  if (apCols.length || names.includes("Time (sec)")) {
    source = "cobb";
    meta = parseApInfo(apCols.length ? apCols[0] : "");
    names.forEach((c, i) => {
      if (c.startsWith("AP Info:") || c.startsWith("Unnamed")) return;
      // Keep the first occurrence of any duplicated header (Cobb repeats some DSG fields).
      if (c.endsWith(".1")) return;
      keep.push([i, own(COBB_TO_CANON, c) ? COBB_TO_CANON[c] : c]);
    });
  } else if (names.includes("time_s") && names.includes("rpm")) {
    source = "mqbtel";
    meta = { ap_firmware: null, vehicle: null, ecu_map: null, tcm_map: null };
    names.forEach((c, i) => keep.push([i, c]));
  } else {
    throw new LogFormatError(
      "That doesn't look like an Accessport datalog. AndrOBD and other formats aren't supported yet."
    );
  }

  // A renamed header can collide with a raw one; first wins, like df["x"] would surprise you otherwise.
  const seen = new Set();
  const cols = keep.filter(([, c]) => (seen.has(c) ? false : seen.add(c)));

  const width = names.length;
  const buffers = cols.map(() => []);
  let row = 1;
  for (const fields of records) {
    row += 1;
    if (fields.length > width) {
      throw new LogFormatError(`Row ${row} has more columns than the header, so the file looks damaged.`);
    }
    for (let k = 0; k < cols.length; k += 1) buffers[k].push(toNumber(fields[cols[k][0]]));
  }

  const data = new Map(cols.map(([, c], k) => [c, Float64Array.from(buffers[k])]));
  return {
    meta: { name, source, ...meta },
    columns: cols.map(([, c]) => c),
    data,
    length: row - 1,
  };
}

// --- analyze.py ---------------------------------------------------------------
// Thresholds are deliberately conservative heuristics for a Stage 2 IS20 car
// on pump fuel. They flag things worth a closer look; they are not a tuner's
// verdict. Same names and values as mqbtel.

const WOT_PEDAL_PCT = 90.0;
const PULL_MIN_RPM = 2000;
const PULL_MIN_DURATION_S = 1.0;

const KNOCK_WATCH_DEG = 0.0; // any retard at all is worth noting
const KNOCK_WARN_DEG = 3.0; // sustained/large retard
const KNOCK_ON_BOOST_PSI = 3.0; // retard above this boost counts as "under load"

const CAT_WATCH_C = 70.0; // charge air getting warm
const CAT_WARN_C = 90.0; // clear heat soak

const LTFT_WATCH_PCT = 5.0;
const LTFT_WARN_PCT = 10.0;

const BOOST_UNDERSHOOT_WARN_PSI = 2.0; // sustained shortfall vs set point at full load
const RAIL_DROOP_WARN_PCT = 10.0; // rail pressure falling short of set point
const RAIL_MIN_SP_PSI = 1500.0; // only judge droop when the ECU is asking for real pressure
const AFR_LEAN_WARN = 0.5; // actual leaner than target, under boost
const AFR_BOOSTED_PSI = 10.0; // "under boost" for the AFR check

const FULL_LOAD = Object.freeze({ pedal: 80.0, rpm: 3000 });

const LEVEL_ORDER = Object.freeze({ info: 0, ok: 1, watch: 2, warn: 3 });

const CHECKS = Object.freeze({
  knock: ["Knock retard", KNOCK_COLS],
  cat: ["Charge air heat soak", ["cat_c"]],
  trims: ["Fuel trims", ["ltft_pct", "rpm"]],
  boost: ["Boost vs set point", ["put_psia", "put_sp_psia", "pedal_pct", "rpm"]],
  rail: ["Rail pressure (HPFP)", ["rail_psi", "rail_sp_psi", "pedal_pct", "rpm"]],
  afr: ["AFR under boost", ["afr", "afr_sp", "boost_psi"]],
  pulls: ["WOT pull detection", ["time_s", "pedal_pct", "rpm"]],
});

const CHECK_REQUIRES = Object.freeze({
  knock: "Knock retard channels for each cylinder.",
  cat: "A charge air temperature channel.",
  trims: "Long-term fuel trim with the engine running.",
  boost:
    `PUT actual and set point, with 5+ full-load samples (pedal ${pyFixed(FULL_LOAD.pedal, 0)}%+ ` +
    `at ${FULL_LOAD.rpm}+ rpm). Log a WOT pull.`,
  rail:
    "Rail pressure actual and set point, with 5+ full-load samples asking for " +
    `${pyFixed(RAIL_MIN_SP_PSI, 0)}+ psi. Log a WOT pull.`,
  afr: `AFR actual and set point, with 5+ samples above ${pyFixed(AFR_BOOSTED_PSI, 0)} psi boost.`,
  pulls:
    `Pedal held at ${pyFixed(WOT_PEDAL_PCT, 0)}%+ above ${PULL_MIN_RPM} rpm for ` +
    `${pyFixed(PULL_MIN_DURATION_S, 0)}+ s.`,
});

/**
 * Python's format(x, f".{digits}f"), including "+" for the sign flag.
 * Correct rounding of the binary value is what toFixed already does; only
 * exact ties differ (Python: half to even, JS: away from zero).
 */
function pyFixed(x, digits, plus = false) {
  if (Number.isNaN(x)) return plus ? "+nan" : "nan";
  const neg = x < 0 || Object.is(x, -0);
  const sign = neg ? "-" : plus ? "+" : "";
  const a = Math.abs(x);
  if (a === Infinity) return `${sign}inf`;
  const y = a * 2 ** (digits + 1); // exact: a power-of-two scale
  let body;
  if (Number.isInteger(y) && y % 2 === 1) {
    // a = (2k + 1) / (2 * 10^digits) exactly: a tie.
    const k = (y * 5 ** digits - 1) / 2;
    const n = k % 2 === 0 ? k : k + 1;
    const s = String(n).padStart(digits + 1, "0");
    body = digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
  } else {
    body = a.toFixed(digits);
  }
  return sign + body;
}

const isNum = (v) => !Number.isNaN(v);

function colOf(log, col) {
  return log.data.get(col);
}

function anyValid(arr) {
  if (!arr) return false;
  for (let i = 0; i < arr.length; i += 1) if (isNum(arr[i])) return true;
  return false;
}

/** NaN-skipping max/min over every row, or over the given row indices. */
function nanMax(arr, rows) {
  let m = NaN;
  const n = rows ? rows.length : arr.length;
  for (let i = 0; i < n; i += 1) {
    const v = arr[rows ? rows[i] : i];
    if (isNum(v) && (Number.isNaN(m) || v > m)) m = v;
  }
  return m;
}

function nanMin(arr, rows) {
  let m = NaN;
  const n = rows ? rows.length : arr.length;
  for (let i = 0; i < n; i += 1) {
    const v = arr[rows ? rows[i] : i];
    if (isNum(v) && (Number.isNaN(m) || v < m)) m = v;
  }
  return m;
}

/** _col_max: None when the column is absent or entirely NaN. */
function colMax(log, col, rows) {
  const arr = colOf(log, col);
  if (!arr) return null;
  const m = nanMax(arr, rows);
  return Number.isNaN(m) ? null : m;
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * max(series.rolling(5, min_periods=3).median()): a trailing window over the
 * rows given (not seconds), NaN-skipping, NaN where fewer than 3 values.
 */
function maxRollingMedian(values, window = 5, minPeriods = 3) {
  let best = NaN;
  for (let i = 0; i < values.length; i += 1) {
    const win = [];
    for (let j = Math.max(0, i - window + 1); j <= i; j += 1) if (isNum(values[j])) win.push(values[j]);
    if (win.length < minPeriods) continue;
    const m = median(win);
    if (Number.isNaN(best) || m > best) best = m;
  }
  return best;
}

function durationS(log) {
  const t = colOf(log, "time_s");
  if (!t || log.length === 0) return 0.0;
  return nanMax(t) - nanMin(t);
}

function missing(log, name) {
  return CHECKS[name][1].filter((c) => !anyValid(colOf(log, c)));
}

function record(s, name, status, detail) {
  const [label, needs] = CHECKS[name];
  s.checks.push({ name, label, status, detail, needs: [...needs], level: status === "ran" ? "ok" : null });
}

/** Add a finding from check `name` and roll its level up into the check status. */
function flag(s, name, level, message) {
  s.findings.push({ level, message, check: name });
  const st = s.checks.find((c) => c.name === name);
  if (st && st.status === "ran" && LEVEL_ORDER[level] > LEVEL_ORDER[st.level || "ok"]) {
    st.level = level;
  }
}

/**
 * Per-cylinder retard as positive degrees, NaN as 0. Cobb logs Simos18 knock
 * retard as negative degrees (timing removed), while other sources report it
 * positive. Magnitude is what matters either way.
 */
function knockMagnitude(log) {
  return KNOCK_COLS.filter((c) => log.data.has(c)).map((c) => {
    const src = log.data.get(c);
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 1) out[i] = isNum(src[i]) ? Math.abs(src[i]) : 0;
    return [c, out];
  });
}

/** Rows where `test(row)` holds, as an index list. */
function rowsWhere(n, test) {
  const rows = [];
  for (let i = 0; i < n; i += 1) if (test(i)) rows.push(i);
  return rows;
}

/** pandas Series.mode() on the given rows: smallest of the most frequent non-NaN values. */
function modeOf(arr, rows) {
  const counts = new Map();
  for (const r of rows) {
    const v = arr[r];
    if (isNum(v)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN || (n === bestN && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function findPulls(
  log,
  pedalMin = WOT_PEDAL_PCT,
  rpmMin = PULL_MIN_RPM,
  minDurationS = PULL_MIN_DURATION_S
) {
  if (!["time_s", "pedal_pct", "rpm"].every((c) => log.data.has(c))) return [];
  const t = colOf(log, "time_s");
  const pedal = colOf(log, "pedal_pct");
  const rpm = colOf(log, "rpm");
  const knock = knockMagnitude(log);
  const gear = colOf(log, "gear");
  const cat = colOf(log, "cat_c");

  const pulls = [];
  let i = 0;
  while (i < log.length) {
    if (!(pedal[i] >= pedalMin && rpm[i] >= rpmMin)) {
      i += 1;
      continue;
    }
    const rows = [];
    while (i < log.length && pedal[i] >= pedalMin && rpm[i] >= rpmMin) rows.push(i++);
    const first = rows[0];
    const last = rows[rows.length - 1];
    const t0 = t[first];
    const t1 = t[last];
    if (t1 - t0 < minDurationS) continue;
    let maxKnock = null;
    if (knock.length) {
      maxKnock = 0;
      for (const [, arr] of knock) for (const r of rows) if (arr[r] > maxKnock) maxKnock = arr[r];
    }
    const g = gear ? modeOf(gear, rows) : null;
    pulls.push({
      start_s: t0,
      end_s: t1,
      rpm_start: rpm[first],
      rpm_end: rpm[last],
      gear: g === null ? null : Math.trunc(g),
      peak_boost_psi: colMax(log, "boost_psi", rows),
      peak_torque_ftlb: colMax(log, "torque_ftlb", rows),
      max_knock_deg: maxKnock,
      cat_start_c: cat ? cat[first] : null,
      cat_end_c: cat ? cat[last] : null,
    });
  }
  return pulls;
}

function checkKnock(log, s) {
  if (missing(log, "knock").length === KNOCK_COLS.length) {
    record(s, "knock", "missing", "Log has no knock retard channels.");
    return;
  }
  const kr = knockMagnitude(log);
  for (const [c, arr] of kr) {
    let max = -Infinity;
    let count = 0;
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i] > max) max = arr[i];
      if (arr[i] > KNOCK_WATCH_DEG) count += 1;
    }
    s.knock[c] = [arr.length ? max : NaN, count];
  }

  let worstCyl = null;
  let worst = -Infinity;
  for (const [c, [m]] of Object.entries(s.knock)) {
    if (worstCyl === null || m > worst) {
      worstCyl = c;
      worst = m;
    }
  }

  const n = log.length;
  const rowMax = new Float64Array(n);
  const rowMin = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let hi = -Infinity;
    let lo = Infinity;
    for (const [, arr] of kr) {
      if (arr[i] > hi) hi = arr[i];
      if (arr[i] < lo) lo = arr[i];
    }
    rowMax[i] = hi;
    rowMin[i] = lo;
  }
  const events = (i) => rowMax[i] > KNOCK_WATCH_DEG;
  const nEvents = rowsWhere(n, events).length;
  s.knock_samples = nEvents;
  record(s, "knock", "ran", `${nEvents} samples with retard, ${pyFixed(worst, 2)} deg max.`);
  if (!nEvents) {
    flag(s, "knock", "ok", "Zero knock retard on all cylinders.");
    return;
  }

  // Retard that is identical on every cylinder at once, off boost, reads as a
  // global timing pull rather than one cylinder knocking. Report it, but don't
  // raise the alarm the way cylinder-specific retard under load should.
  const uniform = (i) => events(i) && rowMax[i] === rowMin[i] && kr.length > 1;
  const boost = colOf(log, "boost_psi");
  const onBoost = boost ? (i) => events(i) && boost[i] >= KNOCK_ON_BOOST_PSI : events; // can't tell, so assume the worst
  const serious = (i) => events(i) && rowMax[i] > KNOCK_WARN_DEG && (onBoost(i) || !uniform(i));
  const peaks = Object.values(s.knock).map(([m]) => m);
  const cyl =
    peaks.length > 1 && Math.min(...peaks) === worst ? "all cylinders" : worstCyl.replace("kr_cyl", "cyl ");
  const nOnBoost = rowsWhere(n, onBoost).length;
  if (rowsWhere(n, serious).length) {
    flag(s, "knock", "warn", `Knock retard up to ${pyFixed(worst, 2)} deg on ${cyl} under load (${nEvents} samples).`);
  } else if (rowsWhere(n, uniform).length === nEvents && !nOnBoost) {
    flag(
      s,
      "knock",
      "watch",
      `Knock retard up to ${pyFixed(worst, 2)} deg in ${nEvents} samples, identical on all cylinders ` +
        "and off boost; looks like a global timing pull rather than one cylinder knocking."
    );
  } else {
    const where = nOnBoost ? `, ${nOnBoost} on boost` : "";
    flag(s, "knock", "watch", `Minor knock retard (${pyFixed(worst, 2)} deg max on ${cyl}, ${nEvents} samples${where}).`);
  }

  // One cylinder carrying most of the events points at that cylinder specifically.
  const counts = Object.entries(s.knock).map(([c, [, k]]) => [c, k]);
  const total = counts.reduce((a, [, k]) => a + k, 0);
  if (total >= 10) {
    let [top, k] = counts[0];
    for (const [c, kk] of counts) if (kk > k) [top, k] = [c, kk];
    if (k / total >= 0.6) {
      flag(
        s,
        "knock",
        "watch",
        `${top.replace("kr_cyl", "Cyl ")} accounts for ${k}/${total} knock events — check plug/coil on that cylinder.`
      );
    }
  }
}

function checkCat(log, s) {
  if (missing(log, "cat").length) {
    record(s, "cat", "missing", "Log has no charge air temperature.");
    return;
  }
  const cat = colOf(log, "cat_c");
  const lo = nanMin(cat);
  const hi = nanMax(cat);
  s.cat_range = [lo, hi];
  record(s, "cat", "ran", `Charge air ${pyFixed(lo, 0)}-${pyFixed(hi, 0)} C.`);
  if (hi >= CAT_WARN_C) {
    flag(s, "cat", "warn", `Charge air temp hit ${pyFixed(hi, 0)}C — intercooler heat soak.`);
  } else if (hi >= CAT_WATCH_C) {
    flag(s, "cat", "watch", `Charge air temp reached ${pyFixed(hi, 0)}C.`);
  }
}

function checkTrims(log, s) {
  const gone = missing(log, "trims");
  if (gone.length) {
    record(s, "trims", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const rpm = colOf(log, "rpm");
  const ltft = colOf(log, "ltft_pct");
  const running = [];
  for (let i = 0; i < log.length; i += 1) if (rpm[i] > 500 && isNum(ltft[i])) running.push(ltft[i]);
  if (!running.length) {
    record(s, "trims", "idle", "No samples with the engine running.");
    return;
  }
  const mean = running.reduce((a, v) => a + v, 0) / running.length;
  const lo = nanMin(running);
  const hi = nanMax(running);
  s.ltft = [mean, lo, hi];
  record(s, "trims", "ran", `LTFT mean ${pyFixed(mean, 1, true)}% (${pyFixed(lo, 0, true)} to ${pyFixed(hi, 0, true)}).`);
  if (Math.abs(mean) >= LTFT_WARN_PCT) {
    flag(s, "trims", "warn", `Long-term fuel trim averaging ${pyFixed(mean, 1, true)}%.`);
  } else if (Math.abs(mean) >= LTFT_WATCH_PCT) {
    flag(s, "trims", "watch", `Long-term fuel trim averaging ${pyFixed(mean, 1, true)}%.`);
  }
}

function noFullLoad(n) {
  return (
    `Only ${n} full-load samples (pedal ${pyFixed(FULL_LOAD.pedal, 0)}%+ at ` +
    `${FULL_LOAD.rpm}+ rpm); needs 5. Log a WOT pull.`
  );
}

function fullLoadRows(log) {
  const pedal = colOf(log, "pedal_pct");
  const rpm = colOf(log, "rpm");
  if (!pedal || !rpm) return [];
  return rowsWhere(log.length, (i) => pedal[i] >= FULL_LOAD.pedal && rpm[i] >= FULL_LOAD.rpm);
}

/** Compare PUT actual vs set point. Both are absolute, so no ambient correction needed. */
function checkBoost(log, s) {
  const gone = missing(log, "boost");
  if (gone.length) {
    record(s, "boost", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const fl = fullLoadRows(log);
  if (fl.length < 5) {
    record(s, "boost", "idle", noFullLoad(fl.length));
    return;
  }
  const sp = colOf(log, "put_sp_psia");
  const put = colOf(log, "put_psia");
  // Rolling median ignores the spool-up transient at the start of a pull.
  s.boost_undershoot_psi = maxRollingMedian(fl.map((i) => sp[i] - put[i]));
  const x = s.boost_undershoot_psi;
  record(s, "boost", "ran", `${fl.length} full-load samples, worst shortfall ${pyFixed(x, 1)} psi.`);
  if (x >= BOOST_UNDERSHOOT_WARN_PSI) {
    flag(
      s,
      "boost",
      "warn",
      `Boost falling ${pyFixed(x, 1)} psi short of target at full load — possible boost leak or tired turbo.`
    );
  } else {
    flag(s, "boost", "ok", "Boost tracking set point at full load.");
  }
}

/** HPFP health: does rail pressure keep up with demand? */
function checkRail(log, s) {
  const gone = missing(log, "rail");
  if (gone.length) {
    record(s, "rail", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const sp = colOf(log, "rail_sp_psi");
  const rail = colOf(log, "rail_psi");
  const fl = fullLoadRows(log).filter((i) => sp[i] > RAIL_MIN_SP_PSI);
  if (fl.length < 5) {
    record(s, "rail", "idle", noFullLoad(fl.length));
    return;
  }
  s.rail_droop_pct = maxRollingMedian(fl.map((i) => ((sp[i] - rail[i]) / sp[i]) * 100));
  const x = s.rail_droop_pct;
  record(s, "rail", "ran", `${fl.length} full-load samples, worst droop ${pyFixed(x, 0)}%.`);
  if (x >= RAIL_DROOP_WARN_PCT) {
    flag(s, "rail", "warn", `Rail pressure dropping ${pyFixed(x, 0)}% below target — HPFP may be at its limit.`);
  }
}

function checkAfr(log, s) {
  const gone = missing(log, "afr");
  if (gone.length) {
    record(s, "afr", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const boost = colOf(log, "boost_psi");
  const afr = colOf(log, "afr");
  const sp = colOf(log, "afr_sp");
  const boosted = rowsWhere(log.length, (i) => boost[i] > AFR_BOOSTED_PSI && afr[i] > 0);
  if (boosted.length < 5) {
    record(
      s,
      "afr",
      "idle",
      `Only ${boosted.length} samples above ${pyFixed(AFR_BOOSTED_PSI, 0)} psi boost; needs 5.`
    );
    return;
  }
  const worst = maxRollingMedian(boosted.map((i) => afr[i] - sp[i]));
  record(s, "afr", "ran", `${boosted.length} boosted samples, worst ${pyFixed(worst, 2, true)} AFR vs target.`);
  if (worst >= AFR_LEAN_WARN) {
    flag(s, "afr", "warn", `Running up to ${pyFixed(worst, 2)} AFR leaner than target under boost.`);
  }
}

function worstLevel(findings) {
  let worst = "ok";
  let first = true;
  for (const f of findings) {
    if (first || LEVEL_ORDER[f.level] > LEVEL_ORDER[worst]) worst = f.level;
    first = false;
  }
  return worst;
}

/** mqbtel's summarize(): every check, findings in check order, plus pulls. */
function summarize(log) {
  const s = {
    name: log.meta.name,
    ecu_map: log.meta.ecu_map,
    tcm_map: log.meta.tcm_map,
    ap_firmware: log.meta.ap_firmware,
    duration_s: durationS(log),
    samples: log.length,
    peak: {},
    knock: {},
    cat_range: null,
    ltft: null,
    boost_undershoot_psi: null,
    rail_droop_pct: null,
    pulls: [],
    findings: [],
    checks: [],
    knock_samples: 0,
  };

  for (const col of ["pedal_pct", "rpm", "boost_psi", "torque_ftlb", "oil_c"]) {
    const v = colMax(log, col);
    if (v !== null) s.peak[col] = v;
  }

  if (log.length === 0 || log.columns.length === 0 || (s.peak.rpm ?? 0) === 0) {
    s.findings.push({ level: "info", message: "Engine not running for this log (ignition-on only).", check: null });
    for (const name of Object.keys(CHECKS)) record(s, name, "idle", "Engine not running.");
    s.worst_level = worstLevel(s.findings);
    return s;
  }

  checkKnock(log, s);
  checkCat(log, s);
  checkTrims(log, s);
  checkBoost(log, s);
  checkRail(log, s);
  checkAfr(log, s);

  s.pulls = findPulls(log);
  const gone = missing(log, "pulls");
  if (gone.length) {
    record(s, "pulls", "missing", `Log has no ${gone.join(", ")}.`);
  } else if (!s.pulls.length) {
    const peakPedal = s.peak.pedal_pct ?? 0;
    s.findings.push({
      level: "info",
      message:
        `No wide-open-throttle pull (peak pedal ${pyFixed(peakPedal, 0)}%). ` +
        "Full-load checks need a WOT pull to be meaningful.",
      check: null,
    });
    record(
      s,
      "pulls",
      "idle",
      `Pedal never held at ${pyFixed(WOT_PEDAL_PCT, 0)}%+ above ` +
        `${PULL_MIN_RPM} rpm (peak pedal ${pyFixed(peakPedal, 0)}%).`
    );
  } else {
    record(s, "pulls", "ran", `${s.pulls.length} pull(s) found.`);
  }
  s.worst_level = worstLevel(s.findings);
  return s;
}

/** JSON-safe copy, like mqbtel's clean(): NaN/inf -> null. */
function clean(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
  }
  return value;
}

/**
 * The hot columns tel_logs copies out of a summary, so list and trend
 * queries never have to open the JSON.
 */
function hotColumns(summary) {
  const knock = Object.values(summary.knock || {}).map(([m]) => m).filter((m) => m !== null);
  return {
    worstLevel: summary.worst_level,
    catMaxC: summary.cat_range ? summary.cat_range[1] : null,
    knockMaxDeg: knock.length ? Math.max(...knock) : null,
    ltftMeanPct: summary.ltft ? summary.ltft[0] : null,
    pullCount: summary.pulls.length,
  };
}

/** Parse + summarise one CSV. Throws LogFormatError for an unrecognised file. */
function analyzeCsv(text, name) {
  const log = load(text, name);
  return { log, summary: clean(summarize(log)) };
}

module.exports = {
  ANALYZER_VERSION,
  COBB_TO_CANON,
  KNOCK_COLS,
  UNITS,
  GROUPS,
  CHECKS,
  CHECK_REQUIRES,
  LEVEL_ORDER,
  CAT_WATCH_C,
  CAT_WARN_C,
  KNOCK_WARN_DEG,
  LTFT_WATCH_PCT,
  LTFT_WARN_PCT,
  WOT_PEDAL_PCT,
  FULL_LOAD,
  LogFormatError,
  describe,
  parseApInfo,
  dedupNames,
  csvRecords,
  load,
  pyFixed,
  maxRollingMedian,
  findPulls,
  summarize,
  clean,
  hotColumns,
  analyzeCsv,
};
