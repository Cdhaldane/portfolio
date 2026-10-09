// Schema + queries for /api/telemetry (the private /garage page). Shares the
// Neon client with Budgetter; `tel_` table prefix so nothing can collide.
// NOT an endpoint itself.
//
// tel_logs: one row per uploaded datalog. The raw CSV is kept, gzipped, so
// every log can be re-analysed when thresholds or column maps change
// (analyzer_version says which rows are stale). raw_sha256 is of the
// uncompressed CSV: the Accessport names files datalog1.csv, datalog2.csv...
// so names collide across sessions, but content never does. The hot columns
// (worst_level ... pull_count) are copies out of `summary` so list and trend
// queries stay cheap; list queries never select raw_gz.
//
// tel_events: the work log. Services, repairs, mods, inspections and bare
// odometer readings, each dated and optionally with km, cost and parts.
// `services` lists the maintenance items an entry covered (keys from the
// page's cars.js), which is what the service schedule reads. Mods and repairs
// double as markers on the trend charts.
//
// Bytes cross the driver as base64 (encode/decode in SQL) and JSON as text
// with a ::jsonb cast, so nothing depends on the driver's type mapping.
const { getSql } = require("./budget-db");

let ensured = false;

async function ensureTelTables(sql) {
  if (ensured) return;
  // One round trip on a cold start. Every statement is idempotent, so two
  // instances racing through this is harmless.
  await sql.transaction([
    sql`
      CREATE TABLE IF NOT EXISTS tel_logs (
        id               SERIAL PRIMARY KEY,
        car              TEXT NOT NULL CHECK (car IN ('golf', 'cayenne')),
        recorded_on      DATE NOT NULL,
        filename         TEXT NOT NULL,
        source           TEXT NOT NULL CHECK (source IN ('cobb', 'androbd', 'mqbtel')),
        raw_sha256       TEXT NOT NULL UNIQUE,
        raw_gz           BYTEA NOT NULL,
        raw_bytes        INTEGER NOT NULL,
        samples          INTEGER NOT NULL,
        duration_s       REAL NOT NULL,
        ecu_map          TEXT,
        tcm_map          TEXT,
        ap_firmware      TEXT,
        worst_level      TEXT NOT NULL CHECK (worst_level IN ('info', 'ok', 'watch', 'warn')),
        cat_max_c        REAL,
        knock_max_deg    REAL,
        ltft_mean_pct    REAL,
        pull_count       SMALLINT NOT NULL DEFAULT 0,
        summary          JSONB NOT NULL,
        analyzer_version TEXT NOT NULL,
        note             TEXT,
        created_by       TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS tel_logs_car_date ON tel_logs (car, recorded_on)`,
    sql`
      CREATE TABLE IF NOT EXISTS tel_events (
        id           SERIAL PRIMARY KEY,
        car          TEXT NOT NULL CHECK (car IN ('golf', 'cayenne')),
        happened_on  DATE NOT NULL,
        label        TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'service'
                     CHECK (kind IN ('service', 'repair', 'mod', 'inspection', 'reading', 'other')),
        odometer_km  INTEGER CHECK (odometer_km BETWEEN 0 AND 2000000),
        cost_cents   INTEGER CHECK (cost_cents BETWEEN 0 AND 100000000),
        done_by      TEXT,
        parts        TEXT,
        services     JSONB NOT NULL DEFAULT '[]'::jsonb,
        note         TEXT,
        created_by   TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS tel_events_car_date ON tel_events (car, happened_on)`,
  ]);
  ensured = true;
}

// DATE comes back as a JS Date at UTC midnight; ship the plain day.
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const num = (v) => (v === null || v === undefined ? null : Number(v));

function logToApi(row) {
  return {
    id: row.id,
    car: row.car,
    recordedOn: day(row.recorded_on),
    filename: row.filename,
    source: row.source,
    rawBytes: row.raw_bytes,
    samples: row.samples,
    durationS: num(row.duration_s),
    ecuMap: row.ecu_map,
    tcmMap: row.tcm_map,
    apFirmware: row.ap_firmware,
    worstLevel: row.worst_level,
    catMaxC: num(row.cat_max_c),
    knockMaxDeg: num(row.knock_max_deg),
    ltftMeanPct: num(row.ltft_mean_pct),
    pullCount: row.pull_count,
    analyzerVersion: row.analyzer_version,
    note: row.note,
    ...(row.summary !== undefined ? { summary: row.summary } : {}),
  };
}

function eventToApi(row) {
  return {
    id: row.id,
    car: row.car,
    happenedOn: day(row.happened_on),
    label: row.label,
    kind: row.kind,
    odometerKm: row.odometer_km,
    costCents: row.cost_cents,
    doneBy: row.done_by,
    parts: row.parts,
    services: Array.isArray(row.services) ? row.services : [],
    note: row.note,
  };
}

const LOG_COLUMNS = `
  id, car, recorded_on, filename, source, raw_bytes, samples, duration_s,
  ecu_map, tcm_map, ap_firmware, worst_level, cat_max_c, knock_max_deg,
  ltft_mean_pct, pull_count, analyzer_version, note`;

async function listLogs(sql) {
  const rows = await sql.query(
    `SELECT ${LOG_COLUMNS} FROM tel_logs ORDER BY recorded_on DESC, id DESC`
  );
  return rows.map(logToApi);
}

/** One log with its full summary, or null. */
async function getLog(sql, id) {
  const rows = await sql.query(`SELECT ${LOG_COLUMNS}, summary FROM tel_logs WHERE id = $1`, [id]);
  return rows[0] ? logToApi(rows[0]) : null;
}

/** One log's gzipped CSV as base64, or null. */
async function getRaw(sql, id) {
  const rows = await sql`SELECT encode(raw_gz, 'base64') AS raw_b64 FROM tel_logs WHERE id = ${id}`;
  return rows[0] ? rows[0].raw_b64 : null;
}

async function findBySha(sql, sha) {
  const rows = await sql`
    SELECT id, car, recorded_on, filename FROM tel_logs WHERE raw_sha256 = ${sha}
  `;
  return rows[0]
    ? { id: rows[0].id, car: rows[0].car, recordedOn: day(rows[0].recorded_on), filename: rows[0].filename }
    : null;
}

/** Store one analysed log. Null when the same CSV is already stored. */
async function insertLog(sql, userId, r) {
  const rows = await sql.query(
    `INSERT INTO tel_logs
            (car, recorded_on, filename, source, raw_sha256, raw_gz, raw_bytes, samples,
             duration_s, ecu_map, tcm_map, ap_firmware, worst_level, cat_max_c,
             knock_max_deg, ltft_mean_pct, pull_count, summary, analyzer_version, note, created_by)
     VALUES ($1, $2, $3, $4, $5, decode($6, 'base64'), $7, $8,
             $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18::jsonb, $19, $20, $21)
     ON CONFLICT (raw_sha256) DO NOTHING
     RETURNING ${LOG_COLUMNS}`,
    [
      r.car, r.recordedOn, r.filename, r.source, r.sha256, r.gzB64, r.rawBytes, r.samples,
      r.durationS, r.ecuMap, r.tcmMap, r.apFirmware, r.hot.worstLevel, r.hot.catMaxC,
      r.hot.knockMaxDeg, r.hot.ltftMeanPct, r.hot.pullCount, JSON.stringify(r.summary),
      r.analyzerVersion, r.note, userId,
    ]
  );
  return rows[0] ? logToApi(rows[0]) : null;
}

/** Change car, date or note. `note: undefined` leaves it, `null` clears it. */
async function editLog(sql, { id, car, recordedOn, note }) {
  const rows = await sql.query(
    `UPDATE tel_logs
        SET car = COALESCE($2, car),
            recorded_on = COALESCE($3::date, recorded_on),
            note = CASE WHEN $4 THEN $5 ELSE note END,
            updated_at = now()
      WHERE id = $1
  RETURNING ${LOG_COLUMNS}`,
    [id, car ?? null, recordedOn ?? null, note !== undefined, note ?? null]
  );
  return rows[0] ? logToApi(rows[0]) : null;
}

async function deleteLog(sql, id) {
  const rows = await sql`DELETE FROM tel_logs WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/**
 * Rows analysed by an older analyzer, in id order after `afterId`. The cursor
 * keeps a log that fails to re-analyse from blocking the rest of the queue on
 * every call. No raw CSV here: the caller reads those one at a time, since a
 * page of them (~1 MB of base64 each) is too much for one HTTP response.
 */
async function staleLogs(sql, version, limit, afterId = 0) {
  const rows = await sql`
    SELECT id, filename
      FROM tel_logs
     WHERE analyzer_version <> ${version} AND id > ${afterId}
     ORDER BY id ASC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({ id: r.id, filename: r.filename }));
}

async function countStale(sql, version, afterId = 0) {
  const rows = await sql`
    SELECT count(*)::int AS n FROM tel_logs WHERE analyzer_version <> ${version} AND id > ${afterId}
  `;
  return rows[0].n;
}

async function updateAnalysis(sql, id, a) {
  await sql.query(
    `UPDATE tel_logs
        SET samples = $2, duration_s = $3, ecu_map = $4, tcm_map = $5, ap_firmware = $6,
            worst_level = $7, cat_max_c = $8, knock_max_deg = $9, ltft_mean_pct = $10,
            pull_count = $11, summary = $12::jsonb, analyzer_version = $13, updated_at = now()
      WHERE id = $1`,
    [
      id, a.samples, a.durationS, a.ecuMap, a.tcmMap, a.apFirmware,
      a.hot.worstLevel, a.hot.catMaxC, a.hot.knockMaxDeg, a.hot.ltftMeanPct,
      a.hot.pullCount, JSON.stringify(a.summary), a.analyzerVersion,
    ]
  );
}

const EVENT_COLUMNS = `
  id, car, happened_on, label, kind, odometer_km, cost_cents, done_by, parts, services, note`;

async function listEvents(sql) {
  const rows = await sql.query(
    `SELECT ${EVENT_COLUMNS} FROM tel_events ORDER BY happened_on DESC, id DESC`
  );
  return rows.map(eventToApi);
}

/** Insert a work-log entry, or edit one in place. Null when the edit target is gone. */
async function saveEvent(sql, userId, e) {
  const values = [
    e.car, e.happenedOn, e.label, e.kind, e.odometerKm, e.costCents,
    e.doneBy, e.parts, JSON.stringify(e.services), e.note,
  ];
  const rows = e.id
    ? await sql.query(
        `UPDATE tel_events
            SET car = $1, happened_on = $2, label = $3, kind = $4, odometer_km = $5,
                cost_cents = $6, done_by = $7, parts = $8, services = $9::jsonb, note = $10,
                updated_at = now()
          WHERE id = $11
      RETURNING ${EVENT_COLUMNS}`,
        [...values, e.id]
      )
    : await sql.query(
        `INSERT INTO tel_events
                (car, happened_on, label, kind, odometer_km, cost_cents, done_by, parts,
                 services, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
      RETURNING ${EVENT_COLUMNS}`,
        [...values, userId]
      );
  return rows[0] ? eventToApi(rows[0]) : null;
}

async function deleteEvent(sql, id) {
  const rows = await sql`DELETE FROM tel_events WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

module.exports = {
  getSql,
  ensureTelTables,
  listLogs,
  getLog,
  getRaw,
  findBySha,
  insertLog,
  editLog,
  deleteLog,
  staleLogs,
  countStale,
  updateAnalysis,
  listEvents,
  saveEvent,
  deleteEvent,
};
