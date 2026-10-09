// Schema + queries for /api/top5. Shares the Neon client with Budgetter and
// Bowler (same database, `top5_` table prefix so nothing can collide). NOT
// an endpoint itself.
//
// One row = one pack's edits (name, tagline, stat labels and its five cards,
// already validated by top5-normalize). A pack with no row shows the
// defaults shipped in src/Pages/Dashboard/TopFive/top5.data.js, so deleting
// a row is "reset to default".
const { getSql } = require("./budget-db");

let ensured = false;

async function ensureTop5Table(sql) {
  if (ensured) return;
  // Idempotent, so two cold starts racing through this is harmless.
  await sql`
    CREATE TABLE IF NOT EXISTS top5_packs (
      pack_id     TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      updated_by  TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  ensured = true;
}

async function listPacks(sql) {
  return sql`SELECT pack_id, data FROM top5_packs`;
}

async function savePack(sql, userId, { packId, pack }) {
  const rows = await sql`
    INSERT INTO top5_packs (pack_id, data, updated_by)
    VALUES (${packId}, ${JSON.stringify(pack)}::jsonb, ${userId})
    ON CONFLICT (pack_id) DO UPDATE
      SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING pack_id, data
  `;
  return rows[0];
}

async function deletePack(sql, packId) {
  await sql`DELETE FROM top5_packs WHERE pack_id = ${packId}`;
}

module.exports = { getSql, ensureTop5Table, listPacks, savePack, deletePack };
