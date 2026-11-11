// Vercel serverless function — /api/bowler (the private /bowler tracker).
//
//   GET                           → every saved series (oldest first), the ball
//                                   bag, the night recaps that still match their
//                                   night, league night (if there's a pattern)
//                                   and whether reminders can be switched on
//   GET + Bearer <CRON_SECRET>    → the league-night reminder push. The Vercel
//                                   cron calls this; a Clerk token can never
//                                   equal the secret
//   POST { action: "parse", image, mediaType, kind? }
//                                 → Claude's read of a photo (NOT saved): the
//                                   recap sheet's game totals, or with
//                                   kind: "frames" the overhead screen's frames
//   POST { action: "save", bowledOn, entries: [{ bowler, games, balls, lanes?, frames? }],
//          source, note }        → upsert one night for one or both bowlers. A game
//                                   with frames is scored from them; leaving `frames`
//                                   out keeps whatever frames that night already has
//   POST { action: "recap", bowledOn }
//                                 → Claude's write-up of that night (reused while
//                                   the night is unchanged)
//   POST { action: "ball", ball: { id?, owner, name, weight, color, retired } }
//                                 → add a ball to the bag, or edit one
//   POST { action: "push", subscription }
//                                 → league-night reminders on for this phone
//   DELETE ?id=123                → remove one series
//   DELETE ?ballId=4              → remove one ball (its games stay, unlinked)
//   DELETE ?push=<endpoint>       → reminders off for that phone
//
// Same shape as the /api/budget/* handlers: requireUser() FIRST (Clerk JWT +
// the fail-closed BUDGET_ALLOWED_USER_IDS allowlist), so an anonymous caller
// learns nothing about server config. The cron checks its own secret
// instead. One file, one function — the Hobby plan caps a deployment at 12.
const crypto = require("crypto");
const { requireUser, sendAuthError, HttpError } = require("./_lib/budget-auth");
const db = require("./_lib/bowler-db");
const {
  isValidDate,
  validateSave,
  validateBall,
  validateImage,
  sanitizeParse,
  sanitizeFrames,
  referencedBalls,
  withSavedDetail,
} = require("./_lib/bowler-normalize");
const { readScoreboard, readFrames } = require("./_lib/bowler-vision");
const { nightFacts, recapBasis, writeRecap } = require("./_lib/bowler-recap");
const { leagueNight, reminderFor, todayIn } = require("./_lib/bowler-league");
const push = require("./_lib/bowler-push");

// Claude calls cost real money, so cap them per user per warm instance. Not
// a global limit (instances don't share memory) but plenty for two people
// and a hard stop on a runaway retry loop.
const CALL_LIMIT = 12;
const CALL_WINDOW_MS = 10 * 60 * 1000;
const callLog = new Map();

function allowCall(userId, kind, now = Date.now()) {
  const key = `${userId}:${kind}`;
  const recent = (callLog.get(key) || []).filter((t) => now - t < CALL_WINDOW_MS);
  if (recent.length >= CALL_LIMIT) {
    callLog.set(key, recent);
    return false;
  }
  callLog.set(key, [...recent, now]);
  return true;
}

/** Constant-time compare for the cron secret. */
function sameSecret(given, expected) {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const bearer = (req) => String(req.headers["authorization"] || "").replace(/^Bearer /, "");
const isCron = (req) =>
  (req.query && req.query.cron !== undefined) || sameSecret(bearer(req), process.env.CRON_SECRET);

function requireSql() {
  const sql = db.getSql();
  if (!sql) throw new HttpError(503, { error: "The database isn't configured yet." });
  return sql;
}

/** Recaps whose night hasn't changed since they were written. */
function freshRecaps(series, recaps) {
  const byDate = new Map();
  series.forEach((r) => byDate.set(r.bowledOn, [...(byDate.get(r.bowledOn) || []), r]));
  return recaps
    .filter((r) => byDate.has(r.bowledOn) && recapBasis(byDate.get(r.bowledOn)) === r.basis)
    .map(({ bowledOn, headline, story }) => ({ bowledOn, headline, story }));
}

// ---------------------------------------------------------------------------
// Sign-in free: the cron

async function handleCron(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ error: "CRON_SECRET isn't configured, so reminders are off." });
  }
  if (!sameSecret(bearer(req), process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sql = requireSql();
  await db.ensureBowlTables(sql);
  const today = todayIn();
  if ((await db.getMeta(sql, "remind:last")) === today) {
    return res.status(200).json({ ok: true, skipped: "already sent today" });
  }
  const payload = reminderFor(await db.listSeries(sql), today);
  if (!payload) return res.status(200).json({ ok: true, skipped: "not league night" });
  // Mark first: a crash mid-send must not mean a second round today.
  await db.setMeta(sql, "remind:last", today);
  const result = await push.sendAll(await db.listPush(sql), payload, {
    drop: (endpoint) => db.deletePush(sql, endpoint),
  });
  return res.status(200).json({ ok: true, ...result });
}

// ---------------------------------------------------------------------------
// Signed in

async function handleGet(res, sql) {
  const [series, balls, recaps] = await Promise.all([
    db.listSeries(sql),
    db.listBalls(sql),
    db.listRecaps(sql),
  ]);
  return res.status(200).json({
    ok: true,
    series,
    balls,
    recaps: freshRecaps(series, recaps),
    league: leagueNight(series, todayIn()),
    push: { enabled: push.configured(), publicKey: push.publicKey() },
  });
}

async function handleParse(res, userId, body) {
  const photo = validateImage(body);
  if (!photo.ok) return res.status(400).json({ error: photo.error });
  if (!allowCall(userId, "parse")) {
    return res
      .status(429)
      .json({ error: "That's a lot of photos. Give it a few minutes, or type the scores in." });
  }
  if (body.kind === "frames") {
    const raw = await readFrames(photo.value);
    return res.status(200).json({ ok: true, read: sanitizeFrames(raw) });
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
    const known = new Set((await db.listBalls(sql)).map((b) => b.id));
    if (!wanted.every((id) => known.has(id))) {
      return res
        .status(400)
        .json({ error: "One of those balls was just taken out of the bag. Pick again." });
    }
  }
  // The photo and type-it paths don't send frames; keep the ones already
  // saved for that night (one cheap read, only when something was left out).
  const { bowledOn, entries } = parsed.value;
  const partial = entries.some((e) => e.frames === undefined || e.lanes === undefined);
  const stored = partial ? await db.savedDetail(sql, bowledOn) : new Map();
  const merged = entries.map((e) => withSavedDetail(e, stored.get(e.bowler) || null));
  const saved = await db.saveNight(sql, userId, { ...parsed.value, entries: merged });
  return res.status(200).json({ ok: true, saved });
}

async function handleRecap(res, sql, userId, body) {
  if (!isValidDate(body.bowledOn)) return res.status(400).json({ error: "Pick a league night." });
  const [series, balls, recaps] = await Promise.all([
    db.listSeries(sql),
    db.listBalls(sql),
    db.listRecaps(sql),
  ]);
  const night = series.filter((r) => r.bowledOn === body.bowledOn);
  if (!night.length) return res.status(404).json({ error: "That night isn't saved." });

  const basis = recapBasis(night);
  const kept = recaps.find((r) => r.bowledOn === body.bowledOn && r.basis === basis);
  if (kept) {
    return res
      .status(200)
      .json({ ok: true, recap: { bowledOn: kept.bowledOn, headline: kept.headline, story: kept.story } });
  }
  if (!allowCall(userId, "recap")) {
    return res.status(429).json({ error: "That's a lot of recaps. Give it a few minutes." });
  }
  const facts = nightFacts(body.bowledOn, series, new Map(balls.map((b) => [b.id, b.name])));
  const written = await writeRecap(facts);
  await db.saveRecap(sql, body.bowledOn, { ...written, basis });
  return res
    .status(200)
    .json({ ok: true, recap: { bowledOn: body.bowledOn, headline: written.headline, story: written.story } });
}

async function handleBall(res, sql, userId, body) {
  const parsed = validateBall(body.ball);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const ball = await db.saveBall(sql, userId, parsed.value);
  return ball
    ? res.status(200).json({ ok: true, ball })
    : res.status(404).json({ error: "That ball is already gone." });
}

async function handlePush(res, sql, userId, body) {
  const sub = push.validSubscription(body.subscription);
  if (!sub) return res.status(400).json({ error: "That subscription didn't come through." });
  await db.savePush(sql, userId, sub);
  return res.status(200).json({ ok: true });
}

async function handleDelete(req, res, sql) {
  const query = req.query || {};
  if (query.push !== undefined) {
    await db.deletePush(sql, String(query.push));
    return res.status(200).json({ ok: true });
  }
  const isBall = query.ballId !== undefined;
  const id = Number(isBall ? query.ballId : query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: isBall ? "Missing ball id." : "Missing series id." });
  }
  const removed = isBall ? await db.deleteBall(sql, id) : await db.deleteSeries(sql, id);
  if (removed) return res.status(200).json({ ok: true });
  return res
    .status(404)
    .json({ error: isBall ? "That ball is already gone." : "That series is already gone." });
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET" && isCron(req)) return await handleCron(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Bowler cron error:", err);
    return res.status(500).json({ error: "Reminder run failed." });
  }

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

    const sql = requireSql();
    await db.ensureBowlTables(sql);

    if (req.method === "GET") return await handleGet(res, sql);
    if (req.method === "DELETE") return await handleDelete(req, res, sql);
    switch (body.action) {
      case "save":
        return await handleSave(res, sql, userId, body);
      case "recap":
        return await handleRecap(res, sql, userId, body);
      case "ball":
        return await handleBall(res, sql, userId, body);
      case "push":
        return await handlePush(res, sql, userId, body);
      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Bowler API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
