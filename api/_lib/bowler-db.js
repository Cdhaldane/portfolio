// Schema + queries for /api/bowler. Shares the Neon client with Budgetter
// (same database, `bowl_` table prefix so nothing can collide). NOT an
// endpoint itself.
//
// One row = one bowler's three-game series on one league night. The UNIQUE
// (bowler, bowled_on) makes a re-save of the same night an edit, never a
// duplicate. `created_by` is the Clerk user who typed/uploaded it
// (attribution only; both tracked bowlers see every row).
const { getSql } = require("./budget-db");

let ensured = false;

async function ensureBowlTables(sql) {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS bowl_series (
      id          SERIAL PRIMARY KEY,
      bowler      TEXT NOT NULL CHECK (bowler IN ('cha', 'van')),
      bowled_on   DATE NOT NULL,
      g1          SMALLINT NOT NULL CHECK (g1 BETWEEN 0 AND 300),
      g2          SMALLINT NOT NULL CHECK (g2 BETWEEN 0 AND 300),
      g3          SMALLINT NOT NULL CHECK (g3 BETWEEN 0 AND 300),
      source      TEXT NOT NULL DEFAULT 'manual',
      note        TEXT,
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bowler, bowled_on)
    )
  `;
  ensured = true;
}

function toApi(row) {
  return {
    id: row.id,
    bowler: row.bowler,
    // DATE comes back as a JS Date at UTC midnight; ship the plain day.
    bowledOn:
      row.bowled_on instanceof Date
        ? row.bowled_on.toISOString().slice(0, 10)
        : String(row.bowled_on).slice(0, 10),
    games: [row.g1, row.g2, row.g3],
    source: row.source,
    note: row.note,
  };
}

async function listSeries(sql) {
  const rows = await sql`
    SELECT id, bowler, bowled_on, g1, g2, g3, source, note
      FROM bowl_series
     ORDER BY bowled_on ASC, bowler ASC
  `;
  return rows.map(toApi);
}

/** Upsert every entry for one night atomically. */
async function saveNight(sql, userId, { bowledOn, entries, source, note }) {
  const results = await sql.transaction(
    entries.map(
      (e) => sql`
        INSERT INTO bowl_series (bowler, bowled_on, g1, g2, g3, source, note, created_by)
        VALUES (${e.bowler}, ${bowledOn}, ${e.games[0]}, ${e.games[1]}, ${e.games[2]},
                ${source}, ${note}, ${userId})
        ON CONFLICT (bowler, bowled_on) DO UPDATE
           SET g1 = EXCLUDED.g1, g2 = EXCLUDED.g2, g3 = EXCLUDED.g3,
               source = EXCLUDED.source, note = EXCLUDED.note, updated_at = now()
        RETURNING id, bowler, bowled_on, g1, g2, g3, source, note
      `
    )
  );
  return results.flat().map(toApi);
}

async function deleteSeries(sql, id) {
  const rows = await sql`DELETE FROM bowl_series WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

module.exports = { getSql, ensureBowlTables, listSeries, saveNight, deleteSeries };
