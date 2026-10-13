// The /api/acta/* request handler, built from injected dependencies so the
// auth, validation and rate-limit rules are unit-tested without Clerk, Neon
// or Claude (see acta-handler.test.js). NOT an endpoint; api/acta/[action].js
// wires it up.
//
// Public (no sign-in, CDN-cached where it's safe):
//   GET  today              today's lesson (or the latest), review-day flag
//   GET  lesson?slug=…      one live lesson
//   GET  archive            every live lesson, newest first
//   POST flag               "this card is wrong" { slug, card, reason, note }
//   GET|POST|DELETE push    the VAPID key / subscribe / unsubscribe
// Owner only (Clerk session on ACTA_EDITOR_USER_IDS):
//   GET|PUT me              synced progress, review deck and saves
//   POST ask                a follow-up question about one card
//   GET  desk               seasons, lessons, flags and setup status
//   POST desk { op, … }     approve seasons, edit topics, run the pipeline…
// Cron (Authorization: Bearer CRON_SECRET, sent by Vercel):
//   GET  cron               advance the pipeline, propose a season when the
//                           calendar runs low, send the daily reminder
const crypto = require("crypto");
const { createLimiter, clientKey } = require("./top5-handler");
const { todayISO, isReviewDay } = require("./acta-schedule");

const OWNER_AUTH = Object.freeze({ allowlistEnv: "ACTA_EDITOR_USER_IDS", product: "Acta Diurna desk" });
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FLAG_REASONS = ["fact", "quote", "image", "typo", "other"];
const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=900";
const MAX_ME_BYTES = 600 * 1024;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const body = (req) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});
const intOrNull = (v) => (Number.isInteger(v) ? v : null);

function createActaHandler({
  requireUser,
  sendAuthError,
  HttpError,
  getSql,
  createStore,
  createPipeline,
  claude,
  sources,
  push,
  today = () => todayISO(),
  cronSecret = () => process.env.CRON_SECRET,
  readLimit = { limit: 240, windowMs: 60 * 1000 },
  flagLimit = { limit: 8, windowMs: 60 * 60 * 1000 },
  pushLimit = { limit: 20, windowMs: 60 * 60 * 1000 },
  askLimit = { limit: 40, windowMs: 60 * 60 * 1000 },
}) {
  const allowRead = createLimiter(readLimit);
  const allowFlag = createLimiter(flagLimit);
  const allowPush = createLimiter(pushLimit);
  const allowAsk = createLimiter(askLimit);

  let ready = null;
  async function storeOrNull() {
    const sql = getSql();
    if (!sql) return null;
    const store = createStore(sql);
    if (!ready) ready = store.ensure().catch((e) => {
      ready = null;
      throw e;
    });
    await ready;
    return store;
  }

  async function storeOr503() {
    const store = await storeOrNull();
    if (!store) throw new HttpError(503, { error: "The database isn't configured yet." });
    return store;
  }

  const pipelineFor = (store) => createPipeline({ store, claude, sources, today });

  // ---------------------------------------------------------------------
  // Public

  /** The page-ready lesson: its JSON plus where it sits in the calendar. */
  async function publicLesson(store, row, day) {
    const [next, around, flagged] = await Promise.all([
      store.nextAfter(row.publish_on),
      store.neighbours(row.publish_on, day),
      store.openFlagCards(row.slug),
    ]);
    return {
      ...row.data,
      slug: row.slug,
      day: row.day,
      publishOn: row.publish_on,
      next,
      prev: around.prev,
      later: around.next,
      flagged,
    };
  }

  async function getToday(res) {
    const day = today();
    const store = await storeOrNull();
    const base = { ok: true, date: day, reviewDay: isReviewDay(day), push: push.publicKey() };
    if (!store) return res.status(200).json({ ...base, lesson: null });
    const row = await store.latestLive(day);
    res.setHeader("Cache-Control", PUBLIC_CACHE);
    if (!row) return res.status(200).json({ ...base, lesson: null, next: await store.nextAfter(day) });
    return res.status(200).json({ ...base, isNew: row.publish_on === day, lesson: await publicLesson(store, row, day) });
  }

  async function getLesson(res, query) {
    const slug = String(query.slug || "");
    if (!SLUG.test(slug)) return res.status(400).json({ error: "That isn't a lesson." });
    const store = await storeOrNull();
    if (!store) return res.status(404).json({ error: "No lessons yet." });
    const day = today();
    const row = await store.liveBySlug(slug, day);
    if (!row) return res.status(404).json({ error: "That lesson isn't out yet, or doesn't exist." });
    res.setHeader("Cache-Control", PUBLIC_CACHE);
    return res.status(200).json({ ok: true, date: day, lesson: await publicLesson(store, row, day) });
  }

  async function getArchive(res) {
    const store = await storeOrNull();
    const day = today();
    if (!store) return res.status(200).json({ ok: true, date: day, lessons: [] });
    const rows = await store.archive(day);
    res.setHeader("Cache-Control", PUBLIC_CACHE);
    return res.status(200).json({
      ok: true,
      date: day,
      lessons: rows.map((r) => ({
        slug: r.slug,
        day: r.day,
        publishOn: r.publish_on,
        title: r.title,
        subtitle: r.subtitle,
        summary: r.summary,
        kind: r.kind,
        era: r.era,
        year: r.year,
        yearLabel: r.year_label,
        minutes: r.minutes,
        takeaways: r.takeaways || [],
      })),
    });
  }

  async function postFlag(req, res) {
    if (!allowFlag(clientKey(req))) return res.status(429).json({ error: "Thanks, that's plenty of reports for now." });
    const b = body(req);
    const slug = String(b.slug || "");
    const reason = String(b.reason || "");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 600) : "";
    const card = intOrNull(b.card);
    if (!SLUG.test(slug)) return res.status(400).json({ error: "Which lesson is this about?" });
    if (!FLAG_REASONS.includes(reason)) return res.status(400).json({ error: "Pick what's wrong." });
    if (card !== null && (card < 0 || card > 60)) return res.status(400).json({ error: "Which card is this about?" });
    if (reason === "other" && !note) return res.status(400).json({ error: "Say what's wrong in a few words." });
    const store = await storeOr503();
    const row = await store.liveBySlug(slug, today());
    if (!row) return res.status(404).json({ error: "That lesson isn't out." });
    await store.insertFlag({ slug, card, reason, note });
    return res.status(200).json({ ok: true });
  }

  async function handlePush(req, res) {
    if (req.method === "GET") return res.status(200).json({ ok: true, publicKey: push.publicKey(), enabled: push.configured() });
    if (!allowPush(clientKey(req))) return res.status(429).json({ error: "Slow down a little." });
    if (!push.configured()) return res.status(503).json({ error: "Reminders aren't switched on yet." });
    const b = body(req);
    const store = await storeOr503();
    if (req.method === "DELETE") {
      const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
      if (endpoint) await store.deletePush(endpoint);
      return res.status(200).json({ ok: true });
    }
    const sub = push.validSubscription(b.subscription);
    if (!sub) return res.status(400).json({ error: "That subscription doesn't look right." });
    await store.savePush(sub);
    return res.status(200).json({ ok: true });
  }

  // ---------------------------------------------------------------------
  // Owner

  async function handleMe(req, res, userId) {
    const store = await storeOr503();
    if (req.method === "GET") return res.status(200).json({ ok: true, data: (await store.getUserData(userId)) || null });
    const data = body(req).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return res.status(400).json({ error: "Nothing to save." });
    if (JSON.stringify(data).length > MAX_ME_BYTES) return res.status(413).json({ error: "That's more than a reading log should hold." });
    await store.putUserData(userId, data);
    return res.status(200).json({ ok: true });
  }

  async function postAsk(req, res, userId) {
    if (!allowAsk(userId)) return res.status(429).json({ error: "That's a lot of questions. Give it a few minutes." });
    const b = body(req);
    const slug = String(b.slug || "");
    const question = typeof b.question === "string" ? b.question.trim().slice(0, 400) : "";
    const cardIndex = intOrNull(b.card);
    if (!SLUG.test(slug)) return res.status(400).json({ error: "Which lesson is this about?" });
    if (question.length < 3) return res.status(400).json({ error: "Ask a question first." });
    const store = await storeOr503();
    const row = await store.lessonBySlug(slug);
    if (!row || !row.data) return res.status(404).json({ error: "That lesson isn't written yet." });
    const full = await store.getLesson(row.id, { withSources: true });
    const card = cardIndex !== null ? row.data.cards[cardIndex] || null : null;
    const msg = await claude.runNow(claude.askParams(row.data, card, full.sources, question));
    return res.status(200).json({ ok: true, answer: claude.textFrom(msg) });
  }

  function deskLesson(l) {
    return {
      id: l.id,
      slug: l.slug,
      day: l.day,
      publishOn: l.publish_on,
      status: l.status,
      held: l.held,
      title: l.lesson_title || l.topic_title,
      kind: l.kind,
      era: l.era,
      yearLabel: l.year_label,
      seasonId: l.season_id,
      issues: l.issues || [],
      attempts: l.attempts,
      revisions: l.revisions,
      error: l.error,
      updatedAt: l.updated_at,
    };
  }

  async function getDesk(res) {
    const store = await storeOr503();
    const [seasons, lessons, flags] = await Promise.all([store.listSeasons(), store.listLessons(), store.listFlags()]);
    return res.status(200).json({
      ok: true,
      today: today(),
      config: {
        claude: claude.configured(),
        model: claude.MODEL,
        cron: Boolean(cronSecret()),
        push: push.configured(),
      },
      seasons,
      lessons: lessons.map(deskLesson),
      flags,
    });
  }

  async function postDesk(req, res) {
    const b = body(req);
    const store = await storeOr503();
    const p = pipelineFor(store);
    const id = (k) => {
      const v = b[k];
      if (!Number.isInteger(v) || v < 1) throw new HttpError(400, { error: `Missing ${k}.` });
      return v;
    };
    let out;
    switch (b.op) {
      case "advance":
        out = await p.advance({ budgetMs: 150000 });
        break;
      case "propose":
        out = { season: await p.proposeSeason({ hint: typeof b.hint === "string" ? b.hint.slice(0, 200) : "" }) };
        break;
      case "approve":
        out = await p.approveSeason(id("seasonId"));
        break;
      case "discard":
        await p.discardSeason(id("seasonId"));
        out = {};
        break;
      case "edit-topic":
        out = { topic: await p.editTopic(id("topicId"), b.fields && typeof b.fields === "object" ? b.fields : {}) };
        break;
      case "swap-topic":
        out = { topic: await p.swapTopic(id("topicId"), typeof b.note === "string" ? b.note : "") };
        break;
      case "move-topic":
        out = { season: await p.moveTopic(id("topicId"), b.dir === -1 ? -1 : 1) };
        break;
      case "hold":
        await p.setHeld(id("lessonId"), Boolean(b.held));
        out = {};
        break;
      case "regenerate":
        await p.regenerate(id("lessonId"));
        out = {};
        break;
      case "retry":
        await p.retry(id("lessonId"));
        out = {};
        break;
      case "publish":
        await p.publishAnyway(id("lessonId"));
        out = {};
        break;
      case "revise":
        await p.reviseWithNotes(id("lessonId"), b.notes);
        out = {};
        break;
      case "flag": {
        const status = ["open", "resolved", "dismissed"].includes(b.status) ? b.status : "resolved";
        await store.setFlagStatus(id("flagId"), status);
        out = {};
        break;
      }
      case "preview": {
        const row = await store.getLesson(id("lessonId"));
        if (!row) return res.status(404).json({ error: "That lesson is gone." });
        out = {
          lesson: row.data ? { ...row.data, slug: row.slug, day: row.day, publishOn: row.publish_on, next: await store.nextAfter(row.publish_on), preview: true } : null,
          issues: row.issues || [],
          status: row.status,
        };
        break;
      }
      default:
        return res.status(400).json({ error: "Unknown desk operation." });
    }
    return res.status(200).json({ ok: true, ...out });
  }

  // ---------------------------------------------------------------------
  // Cron

  async function runCron(req, res) {
    const secret = cronSecret();
    if (!secret) return res.status(503).json({ error: "CRON_SECRET isn't set." });
    const header = String(req.headers.authorization || "");
    if (!safeEqual(header, `Bearer ${secret}`)) return res.status(401).json({ error: "Unauthorized" });
    const store = await storeOr503();
    const p = pipelineFor(store);
    const report = {};
    report.pipeline = await p.advance({ budgetMs: 170000 });
    try {
      const season = await p.maybePropose();
      report.proposed = season ? season.title : null;
    } catch (e) {
      report.proposeError = e.message;
    }
    const day = today();
    try {
      report.push = await push.sendDaily(store, { today: day, row: await store.latestLive(day) });
    } catch (e) {
      report.pushError = e.message;
    }
    return res.status(200).json({ ok: true, ...report });
  }

  // ---------------------------------------------------------------------

  const PUBLIC = {
    today: { GET: (req, res) => getToday(res) },
    lesson: { GET: (req, res) => getLesson(res, req.query || {}) },
    archive: { GET: (req, res) => getArchive(res) },
    flag: { POST: postFlag },
    push: { GET: handlePush, POST: handlePush, DELETE: handlePush },
    cron: { GET: runCron, POST: runCron },
  };
  const OWNER = {
    me: { GET: handleMe, PUT: handleMe },
    ask: { POST: postAsk },
    desk: { GET: (req, res) => getDesk(res), POST: postDesk },
  };

  return async function actaHandler(req, res) {
    const action = String((req.query && req.query.action) || "");
    const route = PUBLIC[action] || OWNER[action];
    if (!route) return res.status(404).json({ error: "Not found" });
    if (!route[req.method]) {
      res.setHeader("Allow", Object.keys(route).join(", "));
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (action !== "cron" && !allowRead(clientKey(req))) return res.status(429).json({ error: "Slow down a little." });
    if (!["today", "lesson", "archive"].includes(action)) res.setHeader("Cache-Control", "no-store");

    try {
      if (PUBLIC[action]) return await route[req.method](req, res);
      // Owner routes: auth runs before any other work, so an anonymous caller
      // learns nothing about the server's configuration.
      let userId;
      try {
        ({ userId } = await requireUser(req, OWNER_AUTH));
      } catch (err) {
        return sendAuthError(res, err);
      }
      return await route[req.method](req, res, userId);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.payload);
      if (err && err.name === "PipelineError") return res.status(err.status || 400).json({ error: err.message });
      if (err && err.name === "ModelOutputError") return res.status(502).json({ error: err.message });
      console.error("Acta API error:", err);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}

module.exports = { createActaHandler, OWNER_AUTH, FLAG_REASONS };
