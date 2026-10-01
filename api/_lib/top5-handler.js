// The /api/top5 request handler, built from injected dependencies so the
// auth, validation and rate-limit rules are unit-tested without Clerk or
// Neon (see top5-handler.test.js). NOT an endpoint; api/top5.js wires it up.
//
//   GET                    → every saved pack edit (public: the page merges
//                            them over its built-in defaults)
//   GET ?me=1              → { canEdit } for the signed-in owner
//   PUT { packId, pack }   → save one pack (owner only)
//   DELETE ?packId=movies  → drop one pack's edits, back to defaults (owner only)
//
// "Owner only" = a verified Clerk session whose user id is on
// TOP5_EDITOR_USER_IDS. That list is fail-closed (unset means nobody can
// edit) and deliberately separate from BUDGET_ALLOWED_USER_IDS, which lets
// more than one person into Budgetter and Bowler.
const crypto = require("crypto");
const { PACK_IDS, validatePack } = require("./top5-normalize");

const OWNER_AUTH = Object.freeze({ allowlistEnv: "TOP5_EDITOR_USER_IDS", product: "Top 5" });
const MAX_BODY_CHARS = 8 * 1024; // five cards of text is ~2KB; anything near this is junk

/**
 * Sliding-window limiter held in instance memory. Not global (instances
 * don't share memory), but Fluid Compute reuses warm instances, so it's a
 * real brake on a hammering client. maxKeys bounds memory: the oldest key
 * is evicted first.
 */
function createLimiter({ limit, windowMs, maxKeys = 5000 }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    hits.delete(key); // re-insert so Map order tracks the most recent use
    hits.set(key, [...recent, now]);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return true;
  };
}

/** Rate-limit key for the caller's IP: hashed, held only in memory, never logged or stored. */
function clientKey(req) {
  const forwarded = String((req.headers && req.headers["x-forwarded-for"]) || "");
  const ip = forwarded.split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

const toPackMap = (rows) =>
  Object.fromEntries(
    rows.filter((r) => PACK_IDS.includes(r.pack_id)).map((r) => [r.pack_id, r.data])
  );

function createTop5Handler({
  requireUser,
  sendAuthError,
  HttpError,
  getSql,
  ensureTable,
  listPacks,
  savePack,
  deletePack,
  readLimit = { limit: 120, windowMs: 60 * 1000 },
  writeLimit = { limit: 60, windowMs: 10 * 60 * 1000 },
}) {
  const allowRequest = createLimiter(readLimit);
  const allowWrite = createLimiter(writeLimit);

  async function readAll(res) {
    const sql = getSql();
    if (!sql) return res.status(200).json({ ok: true, packs: {} });
    await ensureTable(sql);
    return res.status(200).json({ ok: true, packs: toPackMap(await listPacks(sql)) });
  }

  async function write(req, res, userId) {
    if (!allowWrite(userId)) {
      return res.status(429).json({ error: "That's a lot of saves. Give it a minute." });
    }
    const sql = getSql();
    if (!sql) return res.status(503).json({ error: "The database isn't configured yet." });
    await ensureTable(sql);

    if (req.method === "DELETE") {
      const packId = (req.query || {}).packId;
      if (typeof packId !== "string" || !PACK_IDS.includes(packId)) {
        return res.status(400).json({ error: "Unknown pack." });
      }
      await deletePack(sql, packId);
      return res.status(200).json({ ok: true });
    }

    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (!body) return res.status(400).json({ error: "Missing pack." });
    if (JSON.stringify(body).length > MAX_BODY_CHARS) {
      return res.status(413).json({ error: "That's way too much text for five cards." });
    }
    const parsed = validatePack(body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const saved = await savePack(sql, userId, parsed.value);
    return res.status(200).json({ ok: true, pack: saved.data });
  }

  return async function top5Handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "PUT", "DELETE"].includes(req.method)) {
      res.setHeader("Allow", "GET, PUT, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!allowRequest(clientKey(req))) {
      return res.status(429).json({ error: "Slow down a little." });
    }

    try {
      const query = req.query || {};
      if (req.method === "GET" && query.me === undefined) return await readAll(res);

      // Everything else is owner-only. Auth runs before any other work, so an
      // anonymous caller learns nothing about the server's configuration.
      let userId;
      try {
        ({ userId } = await requireUser(req, OWNER_AUTH));
      } catch (err) {
        return sendAuthError(res, err);
      }
      if (req.method === "GET") return res.status(200).json({ ok: true, canEdit: true });
      return await write(req, res, userId);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.payload);
      console.error("Top 5 API error:", err);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}

module.exports = { createTop5Handler, createLimiter, clientKey, OWNER_AUTH };
