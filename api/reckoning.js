// Vercel serverless function — GET/POST /api/reckoning
// Daily leaderboard for DEAD // RECKONING (the /dashboard guessing game).
// Same Neon Postgres setup as guestbook.js; degrades gracefully without a DB.
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

// Local dev fallback: an unlinked `vercel dev` doesn't inject env into
// functions. Pull POSTGRES_URL from .env.local if it isn't already present.
if (!process.env.POSTGRES_URL) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — fall through to the graceful fallback below */
  }
}

const NAME_MAX = 24;
const MAX_SCORE = 3000; // 3 rounds x 1000
// Must match EPOCH in src/Pages/Dashboard/DeadReckoning/people.js — the
// client's "day" is days since this date at the player's local midnight.
const EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

let sqlClient;
function getSql() {
  if (!process.env.POSTGRES_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.POSTGRES_URL);
  return sqlClient;
}

// Create the table once per warm instance.
let ensured;
function ensureTable(sql) {
  if (!ensured) {
    ensured = sql`
      CREATE TABLE IF NOT EXISTS reckoning_scores (
        id SERIAL PRIMARY KEY,
        day INTEGER NOT NULL,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        ip_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (day, ip_hash)
      )
    `;
  }
  return ensured;
}

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "unknown";

// Store a salted hash, never the raw IP — used only to cap one entry/day.
const hashIp = (ip) =>
  crypto
    .createHash("sha256")
    .update(ip + (process.env.GUESTBOOK_SALT || "reckoning"))
    .digest("hex")
    .slice(0, 32);

module.exports = async (req, res) => {
  const sql = getSql();

  if (!sql) {
    if (req.method === "GET") {
      return res.status(200).json({ configured: false, entries: [] });
    }
    return res
      .status(503)
      .json({ error: "The leaderboard is warming up — check back soon." });
  }

  try {
    await ensureTable(sql);

    // Client day is local-midnight based; server checks against UTC with a
    // ±1 day window so every timezone can submit for "their" today.
    const serverDay = Math.floor((Date.now() - EPOCH) / DAY_MS);

    if (req.method === "GET") {
      const day = parseInt(req.query?.day, 10);
      if (!Number.isInteger(day)) {
        return res.status(400).json({ error: "A day index is required." });
      }
      const entries = await sql`
        SELECT name, score, created_at
          FROM reckoning_scores
         WHERE day = ${day}
         ORDER BY score DESC, created_at ASC
         LIMIT 20
      `;
      return res.status(200).json({ configured: true, day, entries });
    }

    if (req.method === "POST") {
      const { day, name, score, website } = req.body || {};

      // Honeypot: bots fill the hidden "website" field; humans never see it.
      if (website) return res.status(200).json({ ok: true });

      const cleanName = String(name || "").trim();
      const numDay = parseInt(day, 10);
      const numScore = parseInt(score, 10);

      if (!cleanName) {
        return res.status(400).json({ error: "A call sign is required." });
      }
      if (cleanName.length > NAME_MAX) {
        return res
          .status(400)
          .json({ error: `Call sign must be ${NAME_MAX} characters or fewer.` });
      }
      if (!Number.isInteger(numDay) || Math.abs(numDay - serverDay) > 1) {
        return res.status(400).json({ error: "That day isn't open for scoring." });
      }
      if (!Number.isInteger(numScore) || numScore < 0 || numScore > MAX_SCORE) {
        return res.status(400).json({ error: "Invalid score." });
      }

      const ipHash = hashIp(clientIp(req));

      const inserted = await sql`
        INSERT INTO reckoning_scores (day, name, score, ip_hash)
        VALUES (${numDay}, ${cleanName}, ${numScore}, ${ipHash})
        ON CONFLICT (day, ip_hash) DO NOTHING
        RETURNING name, score, created_at
      `;
      if (!inserted.length) {
        return res
          .status(409)
          .json({ error: "You're already on today's board." });
      }
      return res.status(201).json({ ok: true, entry: inserted[0] });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Reckoning leaderboard error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
