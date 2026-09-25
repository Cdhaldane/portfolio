// Vercel serverless function — /api/bowler (the private /bowler tracker).
//
//   GET                           → every saved series (oldest first) + the ball bag
//   POST { action: "parse", image, mediaType }
//                                 → Claude's read of a recap-screen photo (NOT saved)
//   POST { action: "save", bowledOn, entries: [{ bowler, games, balls }], source, note }
//                                 → upsert one night for one or both bowlers
//   POST { action: "ball", ball: { id?, owner, name, weight, color, retired } }
//                                 → add a ball to the bag, or edit one
//   DELETE ?id=123                → remove one series
//   DELETE ?ballId=4              → remove one ball (its games stay, unlinked)
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
  listBalls,
  saveBall,
  deleteBall,
} = require("./_lib/bowler-db");
const {
  validateSave,
  validateBall,
  validateImage,
  sanitizeParse,
  referencedBalls,
} = require("./_lib/bowler-normalize");
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
  // The bag is tiny (two people's balls), so checking against all of it is
  // one cheap query and keeps a stale picker from hitting the foreign key.
  const wanted = referencedBalls(parsed.value.entries);
  if (wanted.length) {
    const known = new Set((await listBalls(sql)).map((b) => b.id));
    if (!wanted.every((id) => known.has(id))) {
      return res
        .status(400)
        .json({ error: "One of those balls was just taken out of the bag. Pick again." });
    }
  }
  const saved = await saveNight(sql, userId, parsed.value);
  return res.status(200).json({ ok: true, saved });
}

async function handleBall(res, sql, userId, body) {
  const parsed = validateBall(body.ball);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const ball = await saveBall(sql, userId, parsed.value);
  return ball
    ? res.status(200).json({ ok: true, ball })
    : res.status(404).json({ error: "That ball is already gone." });
}

async function handleDelete(req, res, sql) {
  const query = req.query || {};
  const isBall = query.ballId !== undefined;
  const id = Number(isBall ? query.ballId : query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: isBall ? "Missing ball id." : "Missing series id." });
  }
  const removed = isBall ? await deleteBall(sql, id) : await deleteSeries(sql, id);
  if (removed) return res.status(200).json({ ok: true });
  return res
    .status(404)
    .json({ error: isBall ? "That ball is already gone." : "That series is already gone." });
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
      const [series, balls] = await Promise.all([listSeries(sql), listBalls(sql)]);
      return res.status(200).json({ ok: true, series, balls });
    }
    if (req.method === "DELETE") {
      return await handleDelete(req, res, sql);
    }
    if (body.action === "save") {
      return await handleSave(res, sql, userId, body);
    }
    if (body.action === "ball") {
      return await handleBall(res, sql, userId, body);
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Bowler API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
