// Vercel serverless function — /api/telemetry (the private /garage page).
//
//   GET                         → { logs, events }: every log (no raw CSV), newest
//                                 first, plus the whole work log
//   GET ?id=N[&cols=a,b&t0=&t1=&points=]
//                               → one log with its summary and channel list, plus
//                                 min/max-decimated series for `cols`
//   POST { action: "upload", car, filename, recordedOn, csvGz, note?, commit }
//                               → dry run: the analysis + duplicateOf. With
//                                 commit: true (strictly), the stored row
//   POST { action: "edit", id, car?, recordedOn?, note? }
//   POST { action: "reanalyze", limit?, afterId? }
//                               → re-runs rows whose analyzer_version is stale
//   POST { action: "event", event: { id?, car, happenedOn, label, kind, ... } }
//                               → add or edit a work-log entry
//   DELETE ?id=N                → remove one log
//   DELETE ?eventId=N           → remove one work-log entry
//
// Same shape as /api/bowler: requireUser() FIRST (Clerk JWT + the fail-closed
// BUDGET_ALLOWED_USER_IDS allowlist), so an anonymous caller learns nothing.
// Logs can carry where the car was driven, so nothing here is ever public.
// One file, one function: the Hobby plan caps a deployment at 12.
//
// The server derives everything from the bytes: it inflates, hashes, parses
// and analyses the CSV itself. The browser gzips with CompressionStream
// because a raw hour of logging (~10 MB) is over Vercel's 4.5 MB body limit.
const crypto = require("crypto");
const zlib = require("zlib");
const { requireUser, sendAuthError, HttpError } = require("./_lib/budget-auth");
const db = require("./_lib/telemetry-db");
const {
  MAX_RAW_BYTES,
  parseId,
  validateUpload,
  validateEdit,
  validateEvent,
  reanalyzeLimit,
  parseSeriesQuery,
} = require("./_lib/telemetry-normalize");
const {
  ANALYZER_VERSION,
  CHECKS,
  CHECK_REQUIRES,
  LogFormatError,
  analyzeCsv,
  hotColumns,
  load,
} = require("./_lib/telemetry-analyze");
const { channels, series } = require("./_lib/telemetry-series");

// Parsed logs on a warm instance, so flipping channels or zooming on one log
// doesn't re-read and re-parse a megabyte from Neon each time. Raw CSVs never
// change for an id (SERIAL ids are never reused), so there's nothing to expire.
const PARSED_CACHE_SIZE = 2;
const parsed = new Map();

function remember(id, log) {
  parsed.delete(id);
  parsed.set(id, log);
  while (parsed.size > PARSED_CACHE_SIZE) parsed.delete(parsed.keys().next().value);
}

/** Base64 gzip → Buffer, capped. Throws HttpError with a plain message. */
function inflate(b64, filename) {
  try {
    return zlib.gunzipSync(Buffer.from(b64, "base64"), { maxOutputLength: MAX_RAW_BYTES });
  } catch (err) {
    if (err && err.code === "ERR_BUFFER_TOO_LARGE") {
      throw new HttpError(400, { error: `${filename} is too big once unpacked. Split the session.` });
    }
    throw new HttpError(400, { error: `${filename} didn't come through. Try it again.` });
  }
}

/** Parse + summarise, turning an unrecognised file into a 400. */
function analyze(raw, filename) {
  try {
    const { log, summary } = analyzeCsv(raw.toString("utf8"), filename);
    return { log, summary, hot: hotColumns(summary) };
  } catch (err) {
    if (err instanceof LogFormatError) throw new HttpError(400, { error: `${filename}: ${err.message}` });
    throw err;
  }
}

const CHECK_INFO = Object.entries(CHECKS).map(([name, [label]]) => ({
  name,
  label,
  requires: CHECK_REQUIRES[name],
}));

async function handleList(res, sql) {
  const [logs, events, stale] = await Promise.all([
    db.listLogs(sql),
    db.listEvents(sql),
    db.countStale(sql, ANALYZER_VERSION),
  ]);
  return res.status(200).json({ ok: true, logs, events, stale, analyzerVersion: ANALYZER_VERSION });
}

async function handleOne(res, sql, query) {
  const id = parseId(query.id);
  if (!id) return res.status(400).json({ error: "Missing log id." });
  const log = await db.getLog(sql, id);
  if (!log) return res.status(404).json({ error: "That log is already gone." });

  let data = parsed.get(id);
  if (!data) {
    const b64 = await db.getRaw(sql, id);
    if (!b64) return res.status(404).json({ error: "That log is already gone." });
    data = load(inflate(b64, log.filename).toString("utf8"), log.filename);
    remember(id, data);
  }
  const q = parseSeriesQuery(query);
  return res.status(200).json({
    ok: true,
    log,
    channels: channels(data),
    series: q.cols.length ? series(data, q.cols, q) : null,
    checks: CHECK_INFO,
  });
}

async function handleUpload(res, sql, userId, body) {
  const parsedBody = validateUpload(body);
  if (!parsedBody.ok) return res.status(400).json({ error: parsedBody.error });
  const v = parsedBody.value;

  const raw = inflate(v.csvGz, v.filename);
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const { log, summary, hot } = analyze(raw, v.filename);

  if (!v.commit) {
    const duplicateOf = await db.findBySha(sql, sha256);
    return res.status(200).json({
      ok: true,
      preview: {
        filename: v.filename,
        source: log.meta.source,
        vehicle: log.meta.vehicle,
        samples: summary.samples,
        durationS: summary.duration_s,
        rawBytes: raw.length,
        ecuMap: summary.ecu_map,
        tcmMap: summary.tcm_map,
        apFirmware: summary.ap_firmware,
        ...hot,
        findings: summary.findings,
      },
      duplicateOf,
    });
  }

  const saved = await db.insertLog(sql, userId, {
    car: v.car,
    recordedOn: v.recordedOn,
    filename: v.filename,
    source: log.meta.source,
    sha256,
    gzB64: v.csvGz,
    rawBytes: raw.length,
    samples: summary.samples,
    durationS: summary.duration_s ?? 0,
    ecuMap: summary.ecu_map,
    tcmMap: summary.tcm_map,
    apFirmware: summary.ap_firmware,
    hot,
    summary,
    analyzerVersion: ANALYZER_VERSION,
    note: v.note,
  });
  if (saved) return res.status(200).json({ ok: true, log: saved });
  return res.status(409).json({
    error: `${v.filename} is already saved.`,
    duplicateOf: await db.findBySha(sql, sha256),
  });
}

async function handleEdit(res, sql, body) {
  const parsedBody = validateEdit(body);
  if (!parsedBody.ok) return res.status(400).json({ error: parsedBody.error });
  const log = await db.editLog(sql, parsedBody.value);
  return log
    ? res.status(200).json({ ok: true, log })
    : res.status(404).json({ error: "That log is already gone." });
}

async function handleReanalyze(res, sql, body) {
  const afterId = parseId(body.afterId) || 0;
  const rows = await db.staleLogs(sql, ANALYZER_VERSION, reanalyzeLimit(body), afterId);
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const b64 = await db.getRaw(sql, row.id);
      if (!b64) continue; // deleted mid-run
      const { summary, hot } = analyze(inflate(b64, row.filename), row.filename);
      await db.updateAnalysis(sql, row.id, {
        samples: summary.samples,
        durationS: summary.duration_s ?? 0,
        ecuMap: summary.ecu_map,
        tcmMap: summary.tcm_map,
        apFirmware: summary.ap_firmware,
        hot,
        summary,
        analyzerVersion: ANALYZER_VERSION,
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`Telemetry reanalyze failed for log ${row.id}:`, err);
    }
  }
  const lastId = rows.length ? rows[rows.length - 1].id : afterId;
  const remaining = await db.countStale(sql, ANALYZER_VERSION, lastId);
  return res.status(200).json({ ok: true, updated, failed, remaining, lastId });
}

async function handleEvent(res, sql, userId, body) {
  const parsedBody = validateEvent(body.event);
  if (!parsedBody.ok) return res.status(400).json({ error: parsedBody.error });
  const event = await db.saveEvent(sql, userId, parsedBody.value);
  return event
    ? res.status(200).json({ ok: true, event })
    : res.status(404).json({ error: "That entry is already gone." });
}

async function handleDelete(res, sql, query) {
  const isEvent = query.eventId !== undefined;
  const id = parseId(isEvent ? query.eventId : query.id);
  if (!id) return res.status(400).json({ error: isEvent ? "Missing entry id." : "Missing log id." });
  const removed = isEvent ? await db.deleteEvent(sql, id) : await db.deleteLog(sql, id);
  if (!isEvent) parsed.delete(id);
  if (removed) return res.status(200).json({ ok: true });
  return res
    .status(404)
    .json({ error: isEvent ? "That entry is already gone." : "That log is already gone." });
}

module.exports = async (req, res) => {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const query = req.query || {};

  try {
    const sql = db.getSql();
    if (!sql) return res.status(503).json({ error: "The database isn't configured yet." });
    await db.ensureTelTables(sql);

    if (req.method === "GET") {
      return query.id !== undefined ? await handleOne(res, sql, query) : await handleList(res, sql);
    }
    if (req.method === "DELETE") return await handleDelete(res, sql, query);
    if (body.action === "upload") return await handleUpload(res, sql, userId, body);
    if (body.action === "edit") return await handleEdit(res, sql, body);
    if (body.action === "reanalyze") return await handleReanalyze(res, sql, body);
    if (body.action === "event") return await handleEvent(res, sql, userId, body);
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Telemetry API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
