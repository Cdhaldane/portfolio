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
const ANALYZER_VERSION = "mqbtel@7ff2d73+js1";

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

// Cobb channels the analysis reads under their raw headers. They stay out of
// COBB_TO_CANON on purpose: the page's chart presets key on these exact names.
const HPFP_VOL = "HPFP Effective Pump Vol (%)";
const AIR_MASS = "Air Mass IM Per Stroke (mg/stk)";
const AIR_MASS_SP = "Air Mass Per Stroke SP (mg/stk)";
const TORQUE_MAX = "Torque Maximum Engine (ft-lb)";
const TORQUE_LIMIT_SRC = "Torque Limitation Source (-)";
const TARGET_GEAR = "(DSG)Target Gear (Gear)";
const CLUTCH1_SLIP = "(DSG)Clutch 1 Slip (RPM)";

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

// A pull is full load held long enough to judge: the pedal floored, or real
// boost. The tune makes 25+ psi well short of full pedal, so a burst that lifts
// at peak torque is still a pull; normal driving on this car stays under ~13 psi.
const WOT_PEDAL_PCT = 90.0;
const PULL_MIN_RPM = 2000;
const PULL_BOOST_PSI = 20.0;
const PULL_BOOST_MIN_RPM = 3000;
const PULL_MIN_DURATION_S = 2.0;

const KNOCK_WATCH_DEG = 0.0; // any retard at all is worth noting
const KNOCK_WARN_DEG = 3.0; // sustained/large retard
const KNOCK_ON_BOOST_PSI = 3.0; // retard above this boost counts as "under load"

const CAT_WATCH_C = 70.0; // charge air getting warm
const CAT_WARN_C = 90.0; // clear heat soak

const LTFT_WATCH_PCT = 5.0;
const LTFT_WARN_PCT = 10.0;

const BOOST_UNDERSHOOT_WARN_PSI = 2.0; // shortfall vs set point at full load...
const BOOST_UNDERSHOOT_MIN_S = 0.5; // ...sustained (median over windows this long) once spooled
// Boost still climbing faster than this is spool-up: boost trails its set
// point and AFR trails its enrichment target.
const BOOST_SPOOL_PSI_PER_S = 10.0;
const RAIL_DROOP_WARN_PCT = 10.0; // rail pressure falling short of set point
const RAIL_MIN_SP_PSI = 1500.0; // only judge droop when the ECU is asking for real pressure
const AFR_LEAN_WARN = 0.5; // actual leaner than target, under boost...
const AFR_LEAN_MIN_S = 0.3; // ...sustained (median over windows this long)
const AFR_BOOSTED_PSI = 10.0; // "under boost" for the AFR check
// Ignore this long after a gear change: the DSG reports the new gear ~0.4 s
// before the torque handover, whose fuel cut reads as AFR 20-30 and whose
// boost dip is normal.
const SHIFT_SETTLE_S = 0.75;

const HPFP_WATCH_PCT = 95.0; // pump effective volume held this high at full load: no fuel headroom...
const HPFP_MIN_S = 0.5; // ...sustained (median over windows this long)

const CLUTCH1_GEARS = Object.freeze([1, 3, 5]); // DQ250: clutch 1 drives the odd gears; clutch 2 slip isn't logged
// Clutch 1 slip held under load. Settled slip runs 7-19 rpm in all 13 of the
// owner's logs.
const CLUTCH_SLIP_WATCH_RPM = 50.0;
const CLUTCH_SLIP_WARN_RPM = 100.0;
const CLUTCH_MIN_TORQUE_FTLB = 150.0; // only judge slip with real torque through the clutch...
const CLUTCH_MIN_MPH = 15.0; // ...once rolling (pulling away slips by design)...
const CLUTCH_SETTLE_S = 1.0; // ...and settled after a shift (the handover reads ~1,800 rpm)
const CLUTCH_MIN_S = 0.5; // sustained (median over windows this long)

const SHIFT_MIN_TORQUE_FTLB = 200.0; // time upshifts only under real load
const SHIFT_RPM_DROP = 150.0; // handover: rpm this far below its peak since the target-gear change
const SHIFT_MAX_S = 2.0; // stop looking for the handover after this long

const CURVE_RPM_STEP = 250; // power curve bin width
const CURVE_MIN_SAMPLES = 2; // a bin needs this many settled samples
const HP_RPM_PER_FTLB = 5252.0; // hp = torque (ft-lb) x rpm / 5252

const FULL_LOAD = Object.freeze({ pedal: 80.0, rpm: 3000 });

const LEVEL_ORDER = Object.freeze({ info: 0, ok: 1, watch: 2, warn: 3 });

const CHECKS = Object.freeze({
  knock: ["Knock retard", KNOCK_COLS],
  cat: ["Charge air heat soak", ["cat_c"]],
  trims: ["Fuel trims", ["ltft_pct", "rpm"]],
  boost: ["Boost vs set point", ["put_psia", "put_sp_psia", "pedal_pct", "rpm", "time_s"]],
  rail: ["Rail pressure (HPFP)", ["rail_psi", "rail_sp_psi", "pedal_pct", "rpm"]],
  hpfp: ["Fuel pump headroom", [HPFP_VOL, "pedal_pct", "rpm", "time_s"]],
  afr: ["AFR under boost", ["afr", "afr_sp", "boost_psi", "time_s"]],
  clutch: ["DSG clutch slip", [CLUTCH1_SLIP, "gear", "torque_ftlb", "speed_mph", "time_s"]],
  pulls: ["WOT pull detection", ["time_s", "pedal_pct", "rpm"]],
  shifts: ["DSG shift timing", [TARGET_GEAR, "gear", "rpm", "torque_ftlb", "time_s"]],
});

const CHECK_REQUIRES = Object.freeze({
  knock: "Knock retard channels for each cylinder.",
  cat: "A charge air temperature channel.",
  trims: "Long-term fuel trim with the engine running.",
  boost:
    `PUT actual and set point, with 5+ full-load samples (pedal ${pyFixed(FULL_LOAD.pedal, 0)}%+ ` +
    `at ${FULL_LOAD.rpm}+ rpm) and boost settled for ${BOOST_UNDERSHOOT_MIN_S}+ s ` +
    "once spooled. Log a WOT pull.",
  rail:
    "Rail pressure actual and set point, with 5+ full-load samples asking for " +
    `${pyFixed(RAIL_MIN_SP_PSI, 0)}+ psi. Log a WOT pull.`,
  hpfp:
    `HPFP effective pump volume, with 5+ full-load samples (pedal ${pyFixed(FULL_LOAD.pedal, 0)}%+ ` +
    `at ${FULL_LOAD.rpm}+ rpm) held for ${HPFP_MIN_S}+ s. Log a WOT pull.`,
  afr:
    `AFR actual and set point, with 5+ samples above ${pyFixed(AFR_BOOSTED_PSI, 0)} psi boost, ` +
    `${AFR_LEAN_MIN_S}+ s of it settled (not spooling or shifting).`,
  clutch:
    "DSG clutch 1 slip with gear, torque and speed: 5+ samples in gear 1, 3 or 5 at " +
    `${pyFixed(CLUTCH_MIN_TORQUE_FTLB, 0)}+ ft-lb and ${pyFixed(CLUTCH_MIN_MPH, 0)}+ mph, ${CLUTCH_SETTLE_S}+ s ` +
    `after a shift, held for ${CLUTCH_MIN_S}+ s. Clutch 2 slip isn't logged, so gears 2, 4 ` +
    "and 6 can't be judged.",
  pulls:
    `Pedal at ${pyFixed(WOT_PEDAL_PCT, 0)}%+ above ${PULL_MIN_RPM} rpm, or boost at ` +
    `${pyFixed(PULL_BOOST_PSI, 0)}+ psi above ${PULL_BOOST_MIN_RPM} rpm, held for ` +
    `${PULL_MIN_DURATION_S}+ s.`,
  shifts: `DSG target gear, gear, rpm and torque, with an upshift at ${pyFixed(SHIFT_MIN_TORQUE_FTLB, 0)}+ ft-lb.`,
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
  minDurationS = PULL_MIN_DURATION_S,
  boostMin = PULL_BOOST_PSI,
  boostRpmMin = PULL_BOOST_MIN_RPM
) {
  if (!["time_s", "pedal_pct", "rpm"].every((c) => log.data.has(c))) return [];
  const t = colOf(log, "time_s");
  const pedal = colOf(log, "pedal_pct");
  const rpm = colOf(log, "rpm");
  const boost = colOf(log, "boost_psi");
  const knock = knockMagnitude(log);
  const gear = colOf(log, "gear");
  const cat = colOf(log, "cat_c");
  // Either condition, so a floored pull and a lift-at-peak burst that run
  // into each other are one pull, not two.
  const inPull = (j) =>
    (pedal[j] >= pedalMin && rpm[j] >= rpmMin) || (boost !== undefined && boost[j] >= boostMin && rpm[j] >= boostRpmMin);

  const shifting = afterShift(log);
  const pulls = [];
  let i = 0;
  while (i < log.length) {
    if (!inPull(i)) {
      i += 1;
      continue;
    }
    const rows = [];
    while (i < log.length && inPull(i)) rows.push(i++);
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
    const curve = powerCurve(log, rows.filter((r) => !shifting[r]));
    // Python's max(curve, key=hp): the first of equal peaks wins.
    let top = null;
    for (const c of curve) if (top === null || c.hp > top.hp) top = c;
    const peakTorque = colMax(log, "torque_ftlb", rows);
    pulls.push({
      start_s: t0,
      end_s: t1,
      rpm_start: rpm[first],
      rpm_end: rpm[last],
      gear: g === null ? null : Math.trunc(g),
      peak_boost_psi: colMax(log, "boost_psi", rows),
      peak_torque_ftlb: peakTorque,
      max_knock_deg: maxKnock,
      cat_start_c: cat ? cat[first] : null,
      cat_end_c: cat ? cat[last] : null,
      cat_max_c: colMax(log, "cat_c", rows),
      timing_median_deg: medianOf(colOf(log, "timing_deg"), rows),
      peak_hp: top ? top.hp : null,
      peak_hp_rpm: top ? top.rpm : null,
      hpfp_max_pct: colMax(log, HPFP_VOL, rows),
      airflow_pct: airflowPct(log, rows),
      torque_ceiling_pct: torqueCeilingPct(log, rows, peakTorque),
      torque_limited_pct: torqueLimitedPct(log, rows),
      curve,
    });
  }
  return pulls;
}

/** _median: NaN-skipping median of `arr` over `rows`, null if absent or all NaN. */
function medianOf(arr, rows) {
  if (!arr) return null;
  const vals = [];
  for (const r of rows) if (isNum(arr[r])) vals.push(arr[r]);
  return vals.length ? median(vals) : null;
}

/**
 * numpy's float floor_divide (Python's //). Math.floor(a / b) can round the
 * quotient up to an integer first; this takes the exact remainder like numpy.
 */
function floorDiv(a, b) {
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod && b < 0 !== mod < 0) div -= 1;
  const floor = Math.floor(div);
  return div - floor > 0.5 ? floor + 1 : floor;
}

/** Power curve: medians per CURVE_RPM_STEP rpm bin, from samples clear of a shift. */
function powerCurve(log, rows) {
  const rpm = colOf(log, "rpm");
  const torque = colOf(log, "torque_ftlb");
  if (!torque) return [];
  const bins = new Map();
  for (const r of rows) {
    if (!isNum(rpm[r]) || !isNum(torque[r])) continue;
    const bin = Math.trunc(floorDiv(rpm[r], CURVE_RPM_STEP) * CURVE_RPM_STEP);
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(r);
  }
  const curve = [];
  for (const bin of [...bins.keys()].sort((a, b) => a - b)) {
    const grp = bins.get(bin);
    if (grp.length < CURVE_MIN_SAMPLES) continue;
    curve.push({
      rpm: bin,
      torque_ftlb: medianOf(torque, grp),
      hp: median(grp.map((r) => (torque[r] * rpm[r]) / HP_RPM_PER_FTLB)),
      timing_deg: medianOf(colOf(log, "timing_deg"), grp),
      boost_psi: medianOf(colOf(log, "boost_psi"), grp),
      cat_c: medianOf(colOf(log, "cat_c"), grp),
    });
  }
  return curve;
}

/** Median air mass achieved as a share of what the ECU asked for. */
function airflowPct(log, rows) {
  const got = colOf(log, AIR_MASS);
  const asked = colOf(log, AIR_MASS_SP);
  if (!got || !asked) return null;
  const pct = [];
  for (const r of rows) if (asked[r] > 0 && isNum(got[r])) pct.push((got[r] / asked[r]) * 100);
  return pct.length ? median(pct) : null;
}

/** Peak torque as a share of the engine's torque ceiling over the pull. */
function torqueCeilingPct(log, rows, peakTorque) {
  const ceiling = medianOf(colOf(log, TORQUE_MAX), rows);
  if (peakTorque === null || ceiling === null || ceiling <= 0) return null;
  return (peakTorque / ceiling) * 100;
}

/** Share of the pull with a torque limiter in charge (any non-zero source code). */
function torqueLimitedPct(log, rows) {
  const src = colOf(log, TORQUE_LIMIT_SRC);
  if (!src) return null;
  let n = 0;
  let limited = 0;
  for (const r of rows) {
    if (!isNum(src[r])) continue;
    n += 1;
    if (src[r] !== 0) limited += 1;
  }
  return n ? (limited / n) * 100 : null;
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

/** Rows where `test(row)` holds, as a 0/1 mask. */
function maskWhere(n, test) {
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) mask[i] = test(i) ? 1 : 0;
  return mask;
}

const countOf = (mask) => mask.reduce((a, m) => a + m, 0);

function fullLoadMask(log) {
  const pedal = colOf(log, "pedal_pct");
  const rpm = colOf(log, "rpm");
  if (!pedal || !rpm) return new Uint8Array(log.length);
  return maskWhere(log.length, (i) => pedal[i] >= FULL_LOAD.pedal && rpm[i] >= FULL_LOAD.rpm);
}

function fullLoadRows(log) {
  const full = fullLoadMask(log);
  return rowsWhere(log.length, (i) => full[i]);
}

/**
 * True while boost is still building: spool-up, or recovery after a shift.
 * diff() / diff() as pandas has it: row 0 and 0/0 are NaN (false), and a
 * rise over a zero time step is +Infinity (true).
 */
function spooling(log, pressureCol) {
  const p = colOf(log, pressureCol);
  const t = colOf(log, "time_s");
  return maskWhere(log.length, (i) => i > 0 && (p[i] - p[i - 1]) / (t[i] - t[i - 1]) > BOOST_SPOOL_PSI_PER_S);
}

/** True within `settleS` after a gear change. All false if the log has no gear. */
function afterShift(log, settleS = SHIFT_SETTLE_S) {
  const gear = colOf(log, "gear");
  const t = colOf(log, "time_s");
  if (!gear || !t) return new Uint8Array(log.length);
  // A change is any step away from a real gear (pandas' ne: NaN != anything).
  // The time of the last one carries forward, skipping a change whose own time
  // is NaN the way ffill() does; before the first, `since` is NaN (false).
  let last = NaN;
  return maskWhere(log.length, (i) => {
    if (i > 0 && isNum(gear[i - 1]) && gear[i] !== gear[i - 1] && isNum(t[i])) last = t[i];
    return t[i] - last <= settleS;
  });
}

/** `mask` minus spool-up on `pressureCol` and the settle time after each shift. */
function settledMask(log, mask, pressureCol) {
  const spool = spooling(log, pressureCol);
  const shift = afterShift(log);
  return maskWhere(log.length, (i) => mask[i] && !spool[i] && !shift[i]);
}

/** numpy.searchsorted(a, key, side="right") for a non-NaN key: NaN sorts last. */
function searchSortedRight(a, key) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (a[mid] <= key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Worst level `values` sustains inside one contiguous stretch of `mask`.
 *
 * That's the highest median over any `minS` window. A median needs over half
 * its window at the level, so a noisy sample or a blip shorter than minS / 2
 * can't set it. Windows never bridge a gap between stretches; null if no
 * stretch lasts `minS`.
 */
function held(log, values, mask, minS) {
  const time = colOf(log, "time_s");
  const keep = (i) => mask[i] && isNum(values[i]);
  let worst = null;
  let i = 0;
  while (i < log.length) {
    if (!keep(i)) {
      i += 1;
      continue;
    }
    const t = [];
    const v = [];
    for (; i < log.length && keep(i); i += 1) {
      t.push(time[i]);
      v.push(values[i]);
    }
    for (let k = 0; k < t.length; k += 1) {
      if (!(t[k] - t[0] >= minS)) continue;
      const level = median(v.slice(searchSortedRight(t, t[k] - minS), k + 1));
      // Python's max(worst, level): the first stays unless the second is greater.
      worst = worst === null || level > worst ? level : worst;
    }
  }
  return worst;
}

/**
 * Compare PUT actual vs set point. Both are absolute, so no ambient correction needed.
 *
 * Spool-up at the start of a pull and the recovery after each shift both sit well
 * under set point while PUT climbs; neither is a leak. Only judge boost once it has
 * stopped climbing, and only a shortfall sustained over BOOST_UNDERSHOOT_MIN_S windows.
 */
function checkBoost(log, s) {
  const gone = missing(log, "boost");
  if (gone.length) {
    record(s, "boost", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const full = fullLoadMask(log);
  const nFull = countOf(full);
  if (nFull < 5) {
    record(s, "boost", "idle", noFullLoad(nFull));
    return;
  }
  const sp = colOf(log, "put_sp_psia");
  const put = colOf(log, "put_psia");
  const settled = settledMask(log, full, "put_psia");
  const shortfall = held(log, sp.map((v, i) => v - put[i]), settled, BOOST_UNDERSHOOT_MIN_S);
  if (shortfall === null) {
    record(
      s,
      "boost",
      "idle",
      `${nFull} full-load samples, but boost never settled for ` +
        `${BOOST_UNDERSHOOT_MIN_S} s (still spooling or shifting). Log a longer pull.`
    );
    return;
  }
  s.boost_undershoot_psi = shortfall;
  record(s, "boost", "ran", `${nFull} full-load samples, worst held shortfall ${pyFixed(shortfall, 1)} psi.`);
  if (shortfall >= BOOST_UNDERSHOOT_WARN_PSI) {
    flag(
      s,
      "boost",
      "warn",
      `Boost holding ${pyFixed(shortfall, 1)} psi short of target at full load once spooled — ` +
        "possible boost leak or tired turbo."
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
  const boosted = maskWhere(log.length, (i) => boost[i] > AFR_BOOSTED_PSI && afr[i] > 0);
  const n = countOf(boosted);
  if (n < 5) {
    record(s, "afr", "idle", `Only ${n} samples above ${pyFixed(AFR_BOOSTED_PSI, 0)} psi boost; needs 5.`);
    return;
  }
  // Each upshift cuts fuel, which the wideband reads as a one- or two-sample spike to
  // AFR 20-30. While boost builds, the target steps richer faster than the wideband
  // follows. Neither is the engine running lean.
  const settled = settledMask(log, boosted, "boost_psi");
  const worst = held(log, afr.map((v, i) => v - sp[i]), settled, AFR_LEAN_MIN_S);
  if (worst === null) {
    record(
      s,
      "afr",
      "idle",
      `${n} boosted samples, but boost never settled for ${AFR_LEAN_MIN_S} s ` +
        "(still spooling or shifting)."
    );
    return;
  }
  record(s, "afr", "ran", `${n} boosted samples, worst ${pyFixed(worst, 2, true)} AFR vs target.`);
  if (worst >= AFR_LEAN_WARN) {
    flag(s, "afr", "warn", `Running up to ${pyFixed(worst, 2)} AFR leaner than target under boost.`);
  }
}

/**
 * Fuel headroom: how close the high-pressure pump runs to its capacity at full
 * load. The rail check catches the pump falling behind; this one says how much
 * is left before it does. A Stage 2 car on the stock pump typically sits at 100%.
 */
function checkHpfp(log, s) {
  const gone = missing(log, "hpfp");
  if (gone.length) {
    record(s, "hpfp", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const full = fullLoadMask(log);
  const nFull = countOf(full);
  if (nFull < 5) {
    record(s, "hpfp", "idle", noFullLoad(nFull));
    return;
  }
  const level = held(log, colOf(log, HPFP_VOL), full, HPFP_MIN_S);
  if (level === null) {
    record(s, "hpfp", "idle", `${nFull} full-load samples, but none held for ${HPFP_MIN_S} s. Log a longer pull.`);
    return;
  }
  s.hpfp_pct = level;
  record(s, "hpfp", "ran", `${nFull} full-load samples, pump held at up to ${pyFixed(level, 0)}% effective volume.`);
  if (level >= HPFP_WATCH_PCT) {
    flag(
      s,
      "hpfp",
      "watch",
      `High-pressure fuel pump held at ${pyFixed(level, 0)}% of its capacity at full load — ` +
        "no fuel headroom left for more power."
    );
  } else {
    flag(s, "hpfp", "ok", `High-pressure fuel pump has headroom at full load (${pyFixed(level, 0)}%).`);
  }
}

/**
 * DSG clutch 1 (gears 1, 3, 5): does it hold under load once a shift has
 * settled? Its slip reads ~1,800 rpm through every handover and hundreds while
 * pulling away, both by design. Settled, rolling and loaded, a healthy clutch
 * slips 7-19 rpm.
 */
function checkClutch(log, s) {
  const gone = missing(log, "clutch");
  if (gone.length) {
    record(s, "clutch", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  const gear = colOf(log, "gear");
  const torque = colOf(log, "torque_ftlb");
  const speed = colOf(log, "speed_mph");
  const shifting = afterShift(log, CLUTCH_SETTLE_S);
  const loaded = maskWhere(
    log.length,
    (i) =>
      CLUTCH1_GEARS.includes(gear[i]) &&
      torque[i] >= CLUTCH_MIN_TORQUE_FTLB &&
      speed[i] >= CLUTCH_MIN_MPH &&
      !shifting[i]
  );
  const n = countOf(loaded);
  if (n < 5) {
    record(
      s,
      "clutch",
      "idle",
      `Only ${n} samples in gear 1, 3 or 5 at ${pyFixed(CLUTCH_MIN_TORQUE_FTLB, 0)}+ ft-lb and ` +
        `${pyFixed(CLUTCH_MIN_MPH, 0)}+ mph, settled after a shift; needs 5.`
    );
    return;
  }
  const slip = held(log, colOf(log, CLUTCH1_SLIP).map(Math.abs), loaded, CLUTCH_MIN_S);
  if (slip === null) {
    record(s, "clutch", "idle", `${n} loaded samples in gears 1, 3 and 5, but none held for ${CLUTCH_MIN_S} s.`);
    return;
  }
  s.clutch_slip_rpm = slip;
  record(s, "clutch", "ran", `${n} loaded samples in gears 1, 3 and 5, worst held slip ${pyFixed(slip, 0)} rpm.`);
  if (slip >= CLUTCH_SLIP_WARN_RPM) {
    flag(
      s,
      "clutch",
      "warn",
      `DSG clutch 1 (gears 1, 3, 5) slipping ${pyFixed(slip, 0)} rpm under load — the clutch pack ` +
        "may be wearing."
    );
  } else if (slip >= CLUTCH_SLIP_WATCH_RPM) {
    flag(
      s,
      "clutch",
      "watch",
      `DSG clutch 1 (gears 1, 3, 5) slip held at ${pyFixed(slip, 0)} rpm under load; settled slip ` +
        "is normally under 25."
    );
  } else {
    flag(s, "clutch", "ok", `DSG clutch 1 (gears 1, 3, 5) holding under load (${pyFixed(slip, 0)} rpm slip).`);
  }
}

/**
 * Upshifts under load, timed from the target-gear change to the handover. The
 * DSG names the target gear ~0.5 s before Current Gear flips, and Current Gear
 * flips ~0.4 s before torque moves over. The handover is the first sample in
 * the new gear with rpm SHIFT_RPM_DROP below its peak since the target changed.
 */
function findShifts(log) {
  const target = colOf(log, TARGET_GEAR);
  const t = colOf(log, "time_s");
  const rpm = colOf(log, "rpm");
  const gear = colOf(log, "gear");
  const torque = colOf(log, "torque_ftlb");
  const shifts = [];
  for (let i = 1; i < log.length; i += 1) {
    // target.gt(target.shift()) & target.shift().notna()
    if (!(isNum(target[i - 1]) && target[i] > target[i - 1])) continue;
    if (!(torque[i] >= SHIFT_MIN_TORQUE_FTLB)) continue;
    let handover = null;
    let peak = rpm[i];
    for (let j = i; j < log.length && t[j] - t[i] <= SHIFT_MAX_S; j += 1) {
      if (rpm[j] > peak) peak = rpm[j]; // Python's max(peak, rpm[j])
      if (gear[j] === target[i] && peak - rpm[j] >= SHIFT_RPM_DROP) {
        handover = t[j] - t[i];
        break;
      }
    }
    shifts.push({
      at_s: t[i],
      from_gear: Math.trunc(target[i - 1]),
      to_gear: Math.trunc(target[i]),
      rpm: rpm[i],
      torque_ftlb: torque[i],
      handover_s: handover,
    });
  }
  return shifts;
}

/** How long the DSG takes from choosing a gear to handing torque over. Trend data, no verdict. */
function checkShifts(log, s) {
  const gone = missing(log, "shifts");
  if (gone.length) {
    record(s, "shifts", "missing", `Log has no ${gone.join(", ")}.`);
    return;
  }
  s.shifts = findShifts(log);
  if (!s.shifts.length) {
    record(s, "shifts", "idle", `No upshifts at ${pyFixed(SHIFT_MIN_TORQUE_FTLB, 0)}+ ft-lb.`);
    return;
  }
  const times = s.shifts.map((x) => x.handover_s).filter((x) => x !== null);
  if (!times.length) {
    record(s, "shifts", "ran", `${s.shifts.length} upshifts under load, none with a clear handover.`);
    return;
  }
  record(
    s,
    "shifts",
    "ran",
    `${s.shifts.length} upshifts under load, median ${pyFixed(median(times), 2)} s from target gear to handover.`
  );
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
    hpfp_pct: null,
    clutch_slip_rpm: null,
    pulls: [],
    shifts: [],
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
  checkHpfp(log, s);
  checkAfr(log, s);
  checkClutch(log, s);

  s.pulls = findPulls(log);
  const gone = missing(log, "pulls");
  if (gone.length) {
    record(s, "pulls", "missing", `Log has no ${gone.join(", ")}.`);
  } else if (!s.pulls.length) {
    const peakPedal = s.peak.pedal_pct ?? 0;
    const peakBoost = s.peak.boost_psi;
    let peaks = `peak pedal ${pyFixed(peakPedal, 0)}%`;
    if (peakBoost !== undefined) peaks += `, peak boost ${pyFixed(peakBoost, 1)} psi`;
    s.findings.push({
      level: "info",
      message: `No full-load pull (${peaks}). Full-load checks need a pull to be meaningful.`,
      check: null,
    });
    record(
      s,
      "pulls",
      "idle",
      `Neither pedal at ${pyFixed(WOT_PEDAL_PCT, 0)}%+ above ${PULL_MIN_RPM} rpm ` +
        `nor boost at ${pyFixed(PULL_BOOST_PSI, 0)}+ psi above ${PULL_BOOST_MIN_RPM} rpm was held for ` +
        `${PULL_MIN_DURATION_S}+ s (${peaks}).`
    );
  } else {
    record(s, "pulls", "ran", `${s.pulls.length} pull(s) found.`);
  }
  checkShifts(log, s);
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
