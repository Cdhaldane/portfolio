// Splitting a log that's too big to upload whole. A session much past an hour
// gzips beyond the API's cap, so the browser cuts it into parts: each is the
// original header plus a run of the original rows, byte for byte, so nothing
// is resampled or dropped and every part's clock still reads session time.
// Cuts land in the quietest stretch near each even split — stopped if there
// is one, else light cruising — and never inside a pull, so every check still
// sees whole events. Pure: no File, no CompressionStream, so Jest can run it.

export const MAX_PARTS = 8;
// How far a cut may drift from an even split, as a share of one part's rows.
const WINDOW = 0.25;
// A quiet stretch has to last this long to be worth cutting in; past
// ENOUGH_QUIET_S any is as good as another, so the one nearest an even split
// wins and the parts stay balanced.
const MIN_QUIET_S = 3;
const ENOUGH_QUIET_S = 20;
const MIN_QUIET_ROWS = 30; // the same two ideas when a log has no time column
const ENOUGH_QUIET_ROWS = 200;
// Aim each part's gzip under the cap by this much, for header and ratio drift.
const HEADROOM = 0.9;

// Accessport headers first, then mqbtel's canonical names (telemetry-analyze.js).
const COLUMNS = {
  time: ["Time (sec)", "time_s"],
  pedal: ["Accel Pedal Position (%)", "pedal_pct"],
  boost: ["Boost Press. (psi)", "boost_psi"],
  speed: ["(DSG)Vehicle Speed (mph)", "speed_mph"],
};

const STOPPED = 2; // standing still, foot off
const CRUISING = 1; // moving on light throttle, no real boost
const BUSY = 0; // anything else, including a pull
const WHY = { [STOPPED]: "stopped", [CRUISING]: "cruising" };

/** One CSV line's cells, honouring quotes (the AP Info header has commas in it). */
function cells(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Where every row after the header starts. A trailing newline adds no row. */
function rowStarts(text, from) {
  const starts = [];
  let i = from;
  while (i < text.length) {
    starts.push(i);
    const nl = text.indexOf("\n", i);
    if (nl === -1) break;
    i = nl + 1;
  }
  return starts;
}

const num = (s) => (s === undefined || s.trim() === "" ? NaN : Number(s));

/**
 * Cut a CSV into `parts` pieces. Returns null when it can't be (no header,
 * or too few rows to make that many parts).
 * @returns {null | Array<{ text: string, rows: number, startS: number|null, endS: number|null, endCut: string|null }>}
 *   `endCut` says what the car was doing where this part was cut off:
 *   "stopped", "cruising", or "mid-drive" when nothing near an even split was
 *   quiet. It's null on the last part, which runs to the end of the log.
 */
export function splitCsv(text, parts) {
  const nl = text.indexOf("\n");
  if (nl === -1 || parts < 2) return null;
  const header = text.slice(0, nl + 1);
  const starts = rowStarts(text, nl + 1);
  const rows = starts.length;
  if (rows < parts * 2) return null;

  const names = cells(header.replace(/^﻿/, "").replace(/\r?\n$/, ""));
  const col = {};
  Object.entries(COLUMNS).forEach(([k, opts]) => {
    const i = names.findIndex((n) => opts.includes(n));
    col[k] = i === -1 ? null : i;
  });

  const lineAt = (r) => text.slice(starts[r], r + 1 < rows ? starts[r + 1] : text.length);
  const read = (r) => {
    const c = lineAt(r).replace(/\r?\n$/, "").split(",");
    const at = (k) => (col[k] === null ? NaN : num(c[col[k]]));
    return { t: at("time"), pedal: at("pedal"), boost: at("boost"), speed: at("speed") };
  };
  const levelOf = ({ pedal, boost, speed }) => {
    if (!(pedal < 30) || boost >= 3) return BUSY;
    return speed < 1 ? STOPPED : CRUISING;
  };
  const timeAt = (r) => {
    const t = read(r).t;
    return Number.isFinite(t) ? t : null;
  };

  /** The middle of the best quiet stretch in [lo, hi), or null. */
  const quietest = (lo, hi, ideal) => {
    const info = [];
    for (let r = lo; r < hi; r++) info.push(read(r));
    for (const want of [STOPPED, CRUISING]) {
      let best = null;
      let runStart = null;
      for (let k = 0; k <= info.length; k++) {
        const quiet = k < info.length && levelOf(info[k]) >= want;
        if (quiet && runStart === null) runStart = k;
        if (!quiet && runStart !== null) {
          const a = runStart;
          const b = k - 1;
          const span =
            Number.isFinite(info[a].t) && Number.isFinite(info[b].t) ? info[b].t - info[a].t : null;
          const long = span !== null ? span >= MIN_QUIET_S : b - a + 1 >= MIN_QUIET_ROWS;
          const size = span !== null ? Math.min(span, ENOUGH_QUIET_S) : Math.min(b - a + 1, ENOUGH_QUIET_ROWS);
          const mid = lo + Math.floor((a + b + 1) / 2);
          const better =
            !best ||
            size > best.size ||
            (size === best.size && Math.abs(mid - ideal) < Math.abs(best.row - ideal));
          if (long && better) best = { row: mid, size };
          runStart = null;
        }
      }
      if (best) return { row: best.row, why: WHY[want] };
    }
    return null;
  };

  const per = rows / parts;
  const reach = Math.floor(per * WINDOW);
  const cuts = [];
  for (let k = 1; k < parts; k++) {
    const ideal = Math.round(per * k);
    const found = quietest(Math.max(1, ideal - reach), Math.min(rows - 1, ideal + reach + 1), ideal);
    cuts.push(found || { row: ideal, why: "mid-drive" });
  }

  const edges = [0, ...cuts.map((c) => c.row), rows];
  return edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1];
    return {
      text: header + text.slice(starts[a], b < rows ? starts[b] : text.length),
      rows: b - a,
      startS: timeAt(a),
      endS: timeAt(b - 1),
      endCut: i < cuts.length ? cuts[i].why : null,
    };
  });
}

/**
 * Split until every part gzips under `cap`, starting from the fewest parts
 * that should fit. `pack(text)` gzips one part and resolves { b64, bytes }.
 * Resolves the packed parts (without their text), or null if even
 * MAX_PARTS pieces won't fit.
 */
export async function splitToFit(text, gzBytes, pack, cap) {
  const first = Math.max(2, Math.ceil(gzBytes / (cap * HEADROOM)));
  for (let n = first; n <= MAX_PARTS; n++) {
    const parts = splitCsv(text, n);
    if (!parts) return null;
    const packed = [];
    for (const { text: partText, ...part } of parts) {
      const gz = await pack(partText);
      if (gz.bytes > cap) break;
      packed.push({ ...part, gz });
    }
    if (packed.length === parts.length) return packed;
  }
  return null;
}

/** "datalog21.csv" → "datalog21 (part 1 of 2).csv". */
export const partName = (name, part, parts) =>
  `${name.replace(/\.csv$/i, "")} (part ${part} of ${parts}).csv`;
