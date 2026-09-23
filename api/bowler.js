// Vercel serverless function — /api/bowler (the private /bowler tracker).
//
//   GET                           → every saved series, oldest first
//   POST { action: "parse", image, mediaType }
//                                 → Claude's read of a recap-screen photo (NOT saved)
//   POST { action: "save", bowledOn, entries: [{ bowler, games }], source, note }
//                                 → upsert one night for one or both bowlers
//   DELETE ?id=123                → remove one series
//
// Same shape as the /api/budget/* handlers: requireUser() FIRST (Clerk JWT +
// the fail-closed BUDGET_ALLOWED_USER_IDS allowlist), so an anonymous caller
// learns nothing about server config. One file, one function — the Hobby
// plan caps a deployment at 12.
const { requireUser, sendAuthError, HttpError } = require("./_lib/budget-auth");
const {
  getSql,
  ensureBowlTables,
  listSeries,
  saveNight,
  deleteSeries,
} = require("./_lib/bowler-db");
const { validateSave, validateImage, sanitizeParse } = require("./_lib/bowler-normalize");
const { readScoreboard } = require("./_lib/bowler-vision");

// Photo reads cost real money, so cap them per user per warm instance. Not
// a global limit (instances don't share memory) but plenty for two people
// and a hard stop on a runaway retry loop.
const PARSE_LIMIT = 12;
const PARSE_WINDOW_MS = 10 * 60 * 1000;
const parseLog = new Map();

function allowParse(userId, now = Date.now()) {
  const recent = (parseLog.get(userId) || []).filter((t) => now - t < PARSE_WINDOW_MS);
  if (recent.length >= PARSE_LIMIT) {
    parseLog.set(userId, recent);
    return false;
  }
  parseLog.set(userId, [...recent, now]);
  return true;
}

async function handleParse(res, userId, body) {
  const photo = validateImage(body);
  if (!photo.ok) return res.status(400).json({ error: photo.error });
  if (!allowParse(userId)) {
    return res
      .status(429)
      .json({ error: "That's a lot of photos. Give it a few minutes, or type the scores in." });
  }
  const raw = await readScoreboard(photo.value);
  return res.status(200).json({ ok: true, read: sanitizeParse(raw) });
}

async function handleSave(res, sql, userId, body) {
  const parsed = validateSave(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const saved = await saveNight(sql, userId, parsed.value);
  return res.status(200).json({ ok: true, saved });
}

async function handleDelete(req, res, sql) {
  const id = Number(req.query && req.query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Missing series id." });
  }
  const removed = await deleteSeries(sql, id);
  return removed
    ? res.status(200).json({ ok: true })
    : res.status(404).json({ error: "That series is already gone." });
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

  try {
    // Parsing never touches the database, so it works before Neon is wired.
    if (req.method === "POST" && body.action === "parse") {
      return await handleParse(res, userId, body);
    }

    const sql = getSql();
    if (!sql) {
      return res.status(503).json({ error: "The database isn't configured yet." });
    }
    await ensureBowlTables(sql);

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, series: await listSeries(sql) });
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res, sql);
    }
    if (body.action === "save") {
      return await handleSave(res, sql, userId, body);
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Bowler API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
