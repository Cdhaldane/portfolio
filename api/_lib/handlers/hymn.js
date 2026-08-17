// Gallows Hymn leaderboard — the whole of /api/game/*.
//
// Shares reckoning.js's shape: Neon, a table created once per warm instance, salted
// IP hashes rather than addresses, and a graceful `configured: false` when there is no
// database so the game still runs for anyone cloning this repo.
//
// It differs from reckoning.js in one way that matters. Dead Reckoning takes a number
// on trust because a daily guessing game has nothing better to offer. This board
// stores the **replay** — a seed, a sparse command log and a fingerprint every 600
// ticks — so any entry can be recomputed rather than believed. The server checks the
// claim is internally coherent (api/_lib/hymn-run.js); exact verification is a replay
// away, and `verify()` in the game already does it, in the browser, for free.
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const { validateSubmission } = require("../hymn-run.js");

// Local dev fallback: an unlinked `vercel dev` doesn't inject env into functions.
if (!process.env.POSTGRES_URL) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — fall through to the graceful fallback below */
  }
}

const BOARD_LIMIT = 25;
/** One submission per key per this window, so a stuck client cannot flood the table. */
const SUBMIT_COOLDOWN_SEC = 20;

let sqlClient;
function getSql() {
  if (!process.env.POSTGRES_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.POSTGRES_URL);
  return sqlClient;
}

let ensured;
function ensureTable(sql) {
  if (!ensured) {
    /*
     * One row per player, holding their BEST run — not one row per run.
     *
     * The board answers "how far has each person got", so a table of every attempt
     * would be a table that mostly needs filtering out, and it would grow without
     * bound while storing a replay blob per row. `UNIQUE (player_key)` plus an upsert
     * that only wins on a better round keeps it one row per person, forever.
     */
    ensured = sql`
      CREATE TABLE IF NOT EXISTS gh_scores (
        id SERIAL PRIMARY KEY,
        player_key TEXT NOT NULL,
        name TEXT NOT NULL,
        round INTEGER NOT NULL,
        tally INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0,
        leaks INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        seed BIGINT NOT NULL,
        site INTEGER NOT NULL DEFAULT 0,
        ticks INTEGER NOT NULL DEFAULT 0,
        replay TEXT,
        ip_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (player_key)
      )
    `;
  }
  return ensured;
}

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "unknown";

const hashIp = (ip) =>
  crypto
    .createHash("sha256")
    .update(ip + (process.env.GUESTBOOK_SALT || "gallowshymn"))
    .digest("hex")
    .slice(0, 32);

/** The board, newest-best first. Never includes the replay blobs — they are large. */
async function board(sql, res) {
  const entries = await sql`
    SELECT name, round, tally, kills, leaks, duration_ms, seed, site, created_at,
           (replay IS NOT NULL) AS verifiable
      FROM gh_scores
     ORDER BY round DESC, tally DESC, created_at ASC
     LIMIT ${BOARD_LIMIT}
  `;
  return res.status(200).json({ configured: true, entries });
}

/**
 * One entry's replay, for the client to recompute.
 *
 * Deliberately a separate request: a replay is ~19KB for four minutes of play, so
 * shipping them with the board would make a 25-row leaderboard megabytes wide for a
 * feature almost nobody uses on any given visit.
 */
async function replay(sql, req, res) {
  const key = String(req.query?.player || "").trim();
  if (!key) return res.status(400).json({ error: "Which run?" });
  const rows = await sql`
    SELECT name, round, replay FROM gh_scores WHERE player_key = ${key} LIMIT 1
  `;
  if (!rows.length || !rows[0].replay) {
    return res.status(404).json({ error: "No replay stored for that run." });
  }
  return res.status(200).json({
    name: rows[0].name,
    round: rows[0].round,
    replay: JSON.parse(rows[0].replay),
  });
}

async function submit(sql, req, res) {
  const { website } = req.body || {};
  // Honeypot, as per guestbook/reckoning: bots fill it, humans never see it.
  if (website) return res.status(200).json({ ok: true });

  const { error, run } = validateSubmission(req.body);
  if (error) return res.status(400).json({ error });

  const ipHash = hashIp(clientIp(req));

  const recent = await sql`
    SELECT created_at FROM gh_scores
     WHERE player_key = ${run.playerKey}
       AND created_at > now() - (${SUBMIT_COOLDOWN_SEC} || ' seconds')::interval
     LIMIT 1
  `;
  if (recent.length) {
    return res.status(429).json({ error: "Give it a moment before submitting again." });
  }

  /*
   * Upsert that only wins on a better round.
   *
   * `WHERE EXCLUDED.round > gh_scores.round` is the whole anti-regression rule: a
   * later, worse run cannot overwrite a better one, so the board is a record of bests
   * without the client having to know or be trusted about what its previous best was.
   */
  const rows = await sql`
    INSERT INTO gh_scores
      (player_key, name, round, tally, kills, leaks, duration_ms, seed, site, ticks, replay, ip_hash)
    VALUES
      (${run.playerKey}, ${run.name}, ${run.round}, ${run.tally}, ${run.kills}, ${run.leaks},
       ${run.durationMs}, ${run.seed}, ${run.site}, ${run.ticks}, ${run.replay}, ${ipHash})
    ON CONFLICT (player_key) DO UPDATE SET
      name = EXCLUDED.name,
      round = EXCLUDED.round,
      tally = EXCLUDED.tally,
      kills = EXCLUDED.kills,
      leaks = EXCLUDED.leaks,
      duration_ms = EXCLUDED.duration_ms,
      seed = EXCLUDED.seed,
      site = EXCLUDED.site,
      ticks = EXCLUDED.ticks,
      replay = EXCLUDED.replay,
      ip_hash = EXCLUDED.ip_hash,
      created_at = now()
    WHERE EXCLUDED.round > gh_scores.round
       OR (EXCLUDED.round = gh_scores.round AND EXCLUDED.tally > gh_scores.tally)
    RETURNING round, tally
  `;

  // No row back means the stored best still stands. That is a success, not an error.
  return res.status(200).json({ ok: true, improved: rows.length > 0 });
}

module.exports = async (req, res) => {
  const sql = getSql();
  const action = req.query?.action;

  if (!sql) {
    // No database configured: the game must still be playable, just not ranked.
    if (req.method === "GET") {
      return res.status(200).json({ configured: false, entries: [] });
    }
    return res.status(503).json({ error: "The tally board is warming up." });
  }

  try {
    await ensureTable(sql);
    if (req.method === "GET" && action === "board") return board(sql, res);
    if (req.method === "GET" && action === "replay") return replay(sql, req, res);
    if (req.method === "POST" && action === "submit") return submit(sql, req, res);

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Gallows Hymn leaderboard error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
