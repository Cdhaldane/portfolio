// Schema + queries for /api/jeopardy (JEOPARDRINK! phone buzzers). Shares
// the Neon client with the other tools; the `jeop_` prefix keeps it apart.
// NOT an endpoint itself.
//
// A room is short-lived party state, not a record: one row of host-published
// public state plus the phones that joined, their buzzes and their Last Call
// submissions. Rooms stop answering after ROOM_TTL and are purged on the next
// room creation, cascading to everything else.
//
// `version` bumps on every write so a poll can say "unchanged" cheaply.
const { getSql } = require("./budget-db");

let ensured = false;

async function ensureJeopardyTables(sql) {
  if (ensured) return;
  // Idempotent, so two cold starts racing through this is harmless.
  await sql`
    CREATE TABLE IF NOT EXISTS jeop_rooms (
      code        TEXT PRIMARY KEY,
      host_hash   TEXT NOT NULL,
      state       JSONB NOT NULL DEFAULT '{"phase":"lobby"}'::jsonb,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jeop_players (
      code         TEXT NOT NULL REFERENCES jeop_rooms(code) ON DELETE CASCADE,
      id           TEXT NOT NULL,
      name         TEXT NOT NULL,
      secret_hash  TEXT NOT NULL,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (code, id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jeop_buzzes (
      code       TEXT NOT NULL REFERENCES jeop_rooms(code) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      player_id  TEXT NOT NULL,
      at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (code, seq, player_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS jeop_finals (
      code        TEXT NOT NULL REFERENCES jeop_rooms(code) ON DELETE CASCADE,
      player_id   TEXT NOT NULL,
      wager       INTEGER,
      answer      TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (code, player_id)
    )
  `;
  ensured = true;
}

// A long night, not a lifetime.
const ROOM_TTL = "14 hours";

async function purgeOldRooms(sql) {
  await sql`DELETE FROM jeop_rooms WHERE created_at < now() - interval '1 day'`;
}

/** True when the code was free and the room now exists. */
async function createRoom(sql, { code, hostHash }) {
  const rows = await sql`
    INSERT INTO jeop_rooms (code, host_hash) VALUES (${code}, ${hostHash})
    ON CONFLICT (code) DO NOTHING
    RETURNING code
  `;
  return rows.length === 1;
}

/**
 * Everything a poll needs in one round trip: the room, who joined, the
 * buzzes for the current buzzer window, and Last Call submissions.
 */
async function getSnapshot(sql, code) {
  const rows = await sql`
    SELECT r.version, r.state, r.host_hash,
      (SELECT coalesce(json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY p.joined_at), '[]'::json)
         FROM jeop_players p WHERE p.code = r.code) AS players,
      (SELECT coalesce(json_agg(json_build_object('pid', b.player_id) ORDER BY b.at, b.player_id), '[]'::json)
         FROM jeop_buzzes b
        WHERE b.code = r.code AND b.seq = (r.state->'buzz'->>'seq')::int) AS buzzes,
      (SELECT coalesce(json_agg(json_build_object('pid', f.player_id, 'wager', f.wager, 'answer', f.answer)), '[]'::json)
         FROM jeop_finals f WHERE f.code = r.code) AS finals
    FROM jeop_rooms r
    WHERE r.code = ${code} AND r.created_at > now() - ${ROOM_TTL}::interval
  `;
  return rows[0] || null;
}

/** A player's auth row plus the room state their action is checked against. */
async function getPlayer(sql, code, playerId) {
  const rows = await sql`
    SELECT r.state, p.secret_hash
    FROM jeop_rooms r JOIN jeop_players p ON p.code = r.code
    WHERE r.code = ${code} AND p.id = ${playerId}
      AND r.created_at > now() - ${ROOM_TTL}::interval
  `;
  return rows[0] || null;
}

async function saveState(sql, code, state) {
  const rows = await sql`
    UPDATE jeop_rooms SET state = ${JSON.stringify(state)}::jsonb, version = version + 1
    WHERE code = ${code}
    RETURNING version
  `;
  return rows[0] ? rows[0].version : null;
}

async function addPlayer(sql, { code, id, name, secretHash }) {
  await sql`
    WITH ins AS (
      INSERT INTO jeop_players (code, id, name, secret_hash)
      VALUES (${code}, ${id}, ${name}, ${secretHash})
      RETURNING 1
    )
    UPDATE jeop_rooms SET version = version + 1
    WHERE code = ${code} AND EXISTS (SELECT 1 FROM ins)
  `;
}

/** True if this was the player's first buzz in the window. */
async function insertBuzz(sql, { code, seq, playerId }) {
  const rows = await sql`
    WITH ins AS (
      INSERT INTO jeop_buzzes (code, seq, player_id) VALUES (${code}, ${seq}, ${playerId})
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    UPDATE jeop_rooms SET version = version + 1
    WHERE code = ${code} AND EXISTS (SELECT 1 FROM ins)
    RETURNING version
  `;
  return rows.length === 1;
}

/** Buzz order for one window, earliest first. */
async function listBuzzes(sql, code, seq) {
  const rows = await sql`
    SELECT player_id FROM jeop_buzzes
    WHERE code = ${code} AND seq = ${seq}
    ORDER BY at, player_id
  `;
  return rows.map((r) => r.player_id);
}

/** Set a wager or an answer (whichever is given), keeping the other. */
async function upsertFinal(sql, { code, playerId, wager = null, answer = null }) {
  await sql`
    WITH up AS (
      INSERT INTO jeop_finals (code, player_id, wager, answer)
      VALUES (${code}, ${playerId}, ${wager}, ${answer})
      ON CONFLICT (code, player_id) DO UPDATE SET
        wager = coalesce(EXCLUDED.wager, jeop_finals.wager),
        answer = coalesce(EXCLUDED.answer, jeop_finals.answer),
        updated_at = now()
      RETURNING 1
    )
    UPDATE jeop_rooms SET version = version + 1
    WHERE code = ${code} AND EXISTS (SELECT 1 FROM up)
  `;
}

module.exports = {
  getSql,
  ensureJeopardyTables,
  purgeOldRooms,
  createRoom,
  getSnapshot,
  getPlayer,
  saveState,
  addPlayer,
  insertBuzz,
  listBuzzes,
  upsertFinal,
};
