// Schema + queries for /api/bowler. Shares the Neon client with Budgetter
// (same database, `bowl_` table prefix so nothing can collide). NOT an
// endpoint itself.
//
// One row = one bowler's three-game series on one league night. The UNIQUE
// (bowler, bowled_on) makes a re-save of the same night an edit, never a
// duplicate. `created_by` is the Clerk user who typed/uploaded it
// (attribution only; both tracked bowlers see every row).
//
// bowl_balls is the bag: every ball either bowler owns. Each game links to
// the ball it was thrown with (ball1..ball3, nullable: untagged games and
// every night from before balls existed just have none). Deleting a ball
// unlinks its games instead of deleting them.
const { getSql } = require("./budget-db");

let ensured = false;

async function ensureBowlTables(sql) {
  if (ensured) return;
  // One round trip on a cold start. Every statement is idempotent, so two
  // instances racing through this is harmless.
  await sql.transaction([
    sql`
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
    `,
    sql`
      CREATE TABLE IF NOT EXISTS bowl_balls (
        id          SERIAL PRIMARY KEY,
        owner       TEXT NOT NULL CHECK (owner IN ('cha', 'van')),
        name        TEXT NOT NULL,
        weight      SMALLINT CHECK (weight BETWEEN 6 AND 16),
        color       TEXT NOT NULL,
        retired     BOOLEAN NOT NULL DEFAULT FALSE,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      ALTER TABLE bowl_series
        ADD COLUMN IF NOT EXISTS ball1 INTEGER REFERENCES bowl_balls(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS ball2 INTEGER REFERENCES bowl_balls(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS ball3 INTEGER REFERENCES bowl_balls(id) ON DELETE SET NULL
    `,
  ]);
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
    balls: [row.ball1 ?? null, row.ball2 ?? null, row.ball3 ?? null],
    source: row.source,
    note: row.note,
  };
}

function ballToApi(row) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    weight: row.weight ?? null,
    color: row.color,
    retired: row.retired,
  };
}

async function listSeries(sql) {
  const rows = await sql`
    SELECT id, bowler, bowled_on, g1, g2, g3, ball1, ball2, ball3, source, note
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
        INSERT INTO bowl_series
               (bowler, bowled_on, g1, g2, g3, ball1, ball2, ball3, source, note, created_by)
        VALUES (${e.bowler}, ${bowledOn}, ${e.games[0]}, ${e.games[1]}, ${e.games[2]},
                ${e.balls[0]}, ${e.balls[1]}, ${e.balls[2]}, ${source}, ${note}, ${userId})
        ON CONFLICT (bowler, bowled_on) DO UPDATE
           SET g1 = EXCLUDED.g1, g2 = EXCLUDED.g2, g3 = EXCLUDED.g3,
               ball1 = EXCLUDED.ball1, ball2 = EXCLUDED.ball2, ball3 = EXCLUDED.ball3,
               source = EXCLUDED.source, note = EXCLUDED.note, updated_at = now()
        RETURNING id, bowler, bowled_on, g1, g2, g3, ball1, ball2, ball3, source, note
      `
    )
  );
  return results.flat().map(toApi);
}

async function deleteSeries(sql, id) {
  const rows = await sql`DELETE FROM bowl_series WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function listBalls(sql) {
  const rows = await sql`
    SELECT id, owner, name, weight, color, retired
      FROM bowl_balls
     ORDER BY id ASC
  `;
  return rows.map(ballToApi);
}

/** Insert a new ball, or edit one in place. Null when the edit target is gone. */
async function saveBall(sql, userId, { id, owner, name, weight, color, retired }) {
  const rows = id
    ? await sql`
        UPDATE bowl_balls
           SET owner = ${owner}, name = ${name}, weight = ${weight},
               color = ${color}, retired = ${retired}, updated_at = now()
         WHERE id = ${id}
     RETURNING id, owner, name, weight, color, retired
      `
    : await sql`
        INSERT INTO bowl_balls (owner, name, weight, color, retired, created_by)
        VALUES (${owner}, ${name}, ${weight}, ${color}, ${retired}, ${userId})
     RETURNING id, owner, name, weight, color, retired
      `;
  return rows[0] ? ballToApi(rows[0]) : null;
}

async function deleteBall(sql, id) {
  const rows = await sql`DELETE FROM bowl_balls WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

module.exports = {
  getSql,
  ensureBowlTables,
  listSeries,
  saveNight,
  deleteSeries,
  listBalls,
  saveBall,
  deleteBall,
};
