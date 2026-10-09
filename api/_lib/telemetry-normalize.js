// Pure validation / cleanup for /api/telemetry — no I/O, unit-tested via
// `npm run test:api`. NOT an endpoint (the `_lib` prefix keeps Vercel from
// routing to it).
//
// The client sends only what a person chose (car, date, note, the work-log
// fields) plus the gzipped bytes. It never sends a hash or a summary: the
// server derives those itself from the bytes.
const { isValidDate } = require("./bowler-normalize");

const CARS = Object.freeze(["golf", "cayenne"]);
const KINDS = Object.freeze(["service", "repair", "mod", "inspection", "reading", "other"]);

// A raw hour-long Accessport log is ~10 MB and ~2.3 MB gzipped. Base64 grows
// that by 4/3, which keeps it under Vercel's 4.5 MB request ceiling.
const MAX_GZ_BYTES = 3 * 1024 * 1024;
// zlib stops inflating past this, so a compressed bomb fails fast.
const MAX_RAW_BYTES = 40 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const MAX_FILENAME = 120;
const MAX_LOG_NOTE = 300;
const MAX_LABEL = 80;
const MAX_DONE_BY = 60;
const MAX_PARTS = 300;
const MAX_EVENT_NOTE = 1000;
const MAX_SERVICES = 16;
const SERVICE_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
const MAX_ODOMETER_KM = 2000000;
const MAX_COST_DOLLARS = 1000000;

const MAX_SERIES_COLS = 8;
const MAX_COL_NAME = 120;
// A real 20-minute log is ~850 KB gzipped, so a page of 10 keeps each call
// to roughly 10 MB of reads and a couple of seconds of parsing.
const REANALYZE_PAGE = 10;

const isPositiveId = (n) => Number.isInteger(n) && n > 0;

/** Collapsed, trimmed, capped text; null when nothing is left. */
function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/[ \t]+/g, " ").slice(0, max).trim();
  return s || null;
}

/** A file's own name: no folders, no control characters. */
function cleanFilename(value) {
  if (typeof value !== "string") return null;
  const base = value.split(/[\\/]/).pop();
  return cleanText(base.replace(/[\u0000-\u001f\u007f]/g, ""), MAX_FILENAME);
}

/** A positive integer id from a query string or body, or null. */
function parseId(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return isPositiveId(n) ? n : null;
}

/**
 * Validate an upload (dry run or commit). The bytes stay base64 here; the
 * handler decodes and inflates them with the caps below.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateUpload(body, now = new Date()) {
  if (!body || typeof body !== "object") return { ok: false, error: "Missing request body." };
  if (!CARS.includes(body.car)) return { ok: false, error: "Pick which car this log is from." };
  const filename = cleanFilename(body.filename);
  if (!filename) return { ok: false, error: "Missing file name." };
  if (!isValidDate(body.recordedOn, now)) {
    return { ok: false, error: `Pick the date ${filename} was recorded (not in the future).` };
  }
  const gz = body.csvGz;
  if (typeof gz !== "string" || gz.length < 20 || !BASE64_RE.test(gz)) {
    return { ok: false, error: `${filename} didn't come through. Try it again.` };
  }
  if (Math.floor((gz.length * 3) / 4) > MAX_GZ_BYTES) {
    return { ok: false, error: `${filename} is too big. Split the session into shorter logs.` };
  }
  return {
    ok: true,
    value: {
      car: body.car,
      filename,
      recordedOn: body.recordedOn,
      csvGz: gz,
      note: cleanText(body.note, MAX_LOG_NOTE),
      // Strictly true: a client bug can never save by accident.
      commit: body.commit === true,
    },
  };
}

/**
 * Validate a log edit. Absent fields are left alone; `note: null` or "" clears it.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateEdit(body, now = new Date()) {
  if (!body || typeof body !== "object") return { ok: false, error: "Missing request body." };
  const id = parseId(body.id);
  if (!id) return { ok: false, error: "Unknown log." };
  const value = { id };
  if (body.car !== undefined) {
    if (!CARS.includes(body.car)) return { ok: false, error: "Unknown car." };
    value.car = body.car;
  }
  if (body.recordedOn !== undefined) {
    if (!isValidDate(body.recordedOn, now)) {
      return { ok: false, error: "Pick a valid date (not in the future)." };
    }
    value.recordedOn = body.recordedOn;
  }
  if (body.note !== undefined) value.note = cleanText(body.note, MAX_LOG_NOTE);
  if (Object.keys(value).length === 1) return { ok: false, error: "Nothing to change." };
  return { ok: true, value };
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : NaN;
}

/**
 * Validate a work-log entry. `id` present = edit, absent = new.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateEvent(raw, now = new Date()) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Missing entry." };
  const id = raw.id === undefined || raw.id === null ? null : parseId(raw.id);
  if (raw.id !== undefined && raw.id !== null && !id) return { ok: false, error: "Unknown entry." };
  if (!CARS.includes(raw.car)) return { ok: false, error: "Pick which car the work was on." };
  if (!isValidDate(raw.happenedOn, now)) {
    return { ok: false, error: "Pick the date the work was done (not in the future)." };
  }
  const kind = raw.kind === undefined ? "service" : raw.kind;
  if (!KINDS.includes(kind)) return { ok: false, error: "Pick what kind of work it was." };

  const odometer = optionalNumber(raw.odometerKm);
  if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0 || odometer > MAX_ODOMETER_KM)) {
    return { ok: false, error: "Odometer is whole kilometres." };
  }
  if (kind === "reading" && odometer === null) {
    return { ok: false, error: "An odometer reading needs the kilometres." };
  }
  const label = cleanText(raw.label, MAX_LABEL) || (kind === "reading" ? "Odometer reading" : null);
  if (!label) return { ok: false, error: "Say what was done." };

  const cost = optionalNumber(raw.cost);
  if (cost !== null && (Number.isNaN(cost) || cost < 0 || cost > MAX_COST_DOLLARS)) {
    return { ok: false, error: "Cost is a dollar amount, like 89.99." };
  }

  const rawServices = raw.services === undefined || raw.services === null ? [] : raw.services;
  if (!Array.isArray(rawServices) || rawServices.length > MAX_SERVICES) {
    return { ok: false, error: "Those service items didn't come through. Pick them again." };
  }
  const services = [...new Set(rawServices)];
  if (!services.every((s) => typeof s === "string" && SERVICE_KEY_RE.test(s))) {
    return { ok: false, error: "Those service items didn't come through. Pick them again." };
  }

  return {
    ok: true,
    value: {
      id,
      car: raw.car,
      happenedOn: raw.happenedOn,
      label,
      kind,
      odometerKm: odometer,
      costCents: cost === null ? null : Math.round(cost * 100),
      doneBy: cleanText(raw.doneBy, MAX_DONE_BY),
      parts: cleanText(raw.parts, MAX_PARTS),
      services,
      note: typeof raw.note === "string" ? raw.note.trim().slice(0, MAX_EVENT_NOTE) || null : null,
    },
  };
}

/** How many stale rows one reanalyze call may process. */
function reanalyzeLimit(body) {
  const n = Number(body && body.limit);
  return Number.isInteger(n) && n > 0 ? Math.min(n, REANALYZE_PAGE) : REANALYZE_PAGE;
}

/** ?cols=a,b&t0=&t1=&points= for one log's chart. */
function parseSeriesQuery(query = {}) {
  const cols = String(query.cols || "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c.length <= MAX_COL_NAME)
    .slice(0, MAX_SERIES_COLS);
  const time = (v) => {
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const points = Number(query.points);
  return {
    cols,
    t0: time(query.t0),
    t1: time(query.t1),
    points: Number.isFinite(points) ? points : undefined,
  };
}

module.exports = {
  CARS,
  KINDS,
  MAX_GZ_BYTES,
  MAX_RAW_BYTES,
  cleanFilename,
  parseId,
  validateUpload,
  validateEdit,
  validateEvent,
  reanalyzeLimit,
  parseSeriesQuery,
};
