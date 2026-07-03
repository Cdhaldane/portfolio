// Vercel serverless function — GET/POST /api/guestbook
// Public guestbook backed by Neon Postgres (POSTGRES_URL, injected by the
// Neon–Vercel integration). Uses @neondatabase/serverless — an HTTP driver
// built for serverless, so there are no TCP pools to exhaust. Degrades
// gracefully when no DB is configured.
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

const NAME_MAX = 40;
const MESSAGE_MAX = 280;

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
      CREATE TABLE IF NOT EXISTS guestbook (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        ip_hash TEXT,
        approved BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
  }
  return ensured;
}

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "unknown";

// Store a salted hash, never the raw IP — used only for rate limiting.
const hashIp = (ip) =>
  crypto
    .createHash("sha256")
    .update(ip + (process.env.GUESTBOOK_SALT || "guestbook"))
    .digest("hex")
    .slice(0, 32);

module.exports = async (req, res) => {
  const sql = getSql();

  // No database wired yet — degrade gracefully instead of 500ing.
  if (!sql) {
    if (req.method === "GET") {
      return res.status(200).json({ configured: false, entries: [] });
    }
    return res
      .status(503)
      .json({ error: "The guestbook is warming up — check back soon." });
  }

  try {
    await ensureTable(sql);

    if (req.method === "GET") {
      const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 50));
      const entries = await sql`
        SELECT id, name, message, created_at
          FROM guestbook
         WHERE approved = TRUE
         ORDER BY created_at DESC
         LIMIT ${limit}
      `;
      return res.status(200).json({ configured: true, entries });
    }

    if (req.method === "POST") {
      const { name, message, website } = req.body || {};

      // Honeypot: bots fill the hidden "website" field; humans never see it.
      if (website) return res.status(200).json({ ok: true });

      const cleanName = String(name || "").trim();
      const cleanMessage = String(message || "").trim();
      if (!cleanName || !cleanMessage) {
        return res.status(400).json({ error: "Name and message are both required." });
      }
      if (cleanName.length > NAME_MAX) {
        return res.status(400).json({ error: `Name must be ${NAME_MAX} characters or fewer.` });
      }
      if (cleanMessage.length > MESSAGE_MAX) {
        return res.status(400).json({ error: `Message must be ${MESSAGE_MAX} characters or fewer.` });
      }

      const ipHash = hashIp(clientIp(req));

      // Rate limit: one entry per IP per 30 seconds.
      const recent = await sql`
        SELECT 1 FROM guestbook
         WHERE ip_hash = ${ipHash} AND created_at > now() - interval '30 seconds'
         LIMIT 1
      `;
      if (recent.length) {
        return res.status(429).json({ error: "You're signing a little fast — give it a moment." });
      }

      const inserted = await sql`
        INSERT INTO guestbook (name, message, ip_hash)
        VALUES (${cleanName}, ${cleanMessage}, ${ipHash})
        RETURNING id, name, message, created_at
      `;
      return res.status(201).json({ ok: true, entry: inserted[0] });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Guestbook error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
