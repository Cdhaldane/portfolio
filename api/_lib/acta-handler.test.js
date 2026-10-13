const test = require("node:test");
const assert = require("node:assert/strict");
const { createActaHandler } = require("./acta-handler");
const { createPipeline } = require("./acta-pipeline");
const push = require("./acta-push");
const { createFakeStore, createFakeClaude, createFakeSources, reply, rawLesson, seasonFixture } = require("./__fixtures__/acta-fakes");

class HttpError extends Error {
  constructor(status, payload) {
    super(payload.error);
    this.status = status;
    this.payload = payload;
  }
}

const OWNER = "user_owner";
const TODAY = "2026-10-21"; // a Wednesday

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function setup({ who = OWNER, sql = true, today = TODAY, cronSecret = "s3cret", limits = {}, respond = {} } = {}) {
  const store = createFakeStore();
  const claude = createFakeClaude({ write: () => reply(rawLesson()), check: () => reply({ verdict: "pass", issues: [] }), now: () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Because the strait was narrow." }] }), ...respond });
  const sources = createFakeSources();
  const authCalls = [];
  const handler = createActaHandler({
    requireUser: async (req, opts) => {
      authCalls.push(opts);
      if (!who) throw new HttpError(401, { error: "Sign in required." });
      if (who !== OWNER) throw new HttpError(403, { error: "Not on the list.", userId: who });
      return { userId: who };
    },
    sendAuthError: (res, err) => res.status(err.status).json(err.payload),
    HttpError,
    getSql: () => (sql ? {} : null),
    createStore: () => store,
    createPipeline,
    claude,
    sources,
    push: { ...push, configured: () => true, publicKey: () => "BPUBLIC" },
    today: () => today,
    cronSecret: () => cronSecret,
    ...limits,
  });
  const call = async (method, action, { query = {}, body, headers = {} } = {}) => {
    const res = mockRes();
    await handler({ method, query: { action, ...query }, body, headers: { "x-forwarded-for": "203.0.113.9", ...headers } }, res);
    return res;
  };
  return { handler, store, claude, call, authCalls };
}

/** Put a live lesson on the calendar. */
async function liveLesson(store, { slug = "salamis", date = "2026-10-20", title = "Salamis" } = {}) {
  const sid = await store.insertSeason(seasonFixture(), "approved");
  const topic = (await store.getSeason(sid)).topics[0];
  const row = await store.insertLesson({ topicId: topic.id, slug, publishOn: date, status: "ready", data: { ...rawLesson({ title }), slug, kind: "moment", era: "greece", cards: [{ type: "open", text: "x" }] } });
  await store.renumberDays();
  return row;
}

test("today with no database still answers, so the page can show its sample", async () => {
  const { call } = setup({ sql: false });
  const res = await call("GET", "today");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.lesson, null);
  assert.equal(res.body.date, TODAY);
});

test("today serves the newest live lesson, CDN-cached", async () => {
  const { call, store } = setup();
  await liveLesson(store, { slug: "older", date: "2026-10-19", title: "Older" });
  await liveLesson(store, { slug: "salamis", date: "2026-10-21", title: "Salamis" });
  await liveLesson(store, { slug: "future", date: "2026-10-22", title: "Future" });
  const res = await call("GET", "today");
  assert.equal(res.body.lesson.slug, "salamis");
  assert.equal(res.body.isNew, true);
  assert.equal(res.body.lesson.prev.slug, "older");
  assert.equal(res.body.lesson.later, null, "tomorrow's lesson isn't linked before its day");
  assert.match(res.headers["cache-control"], /s-maxage=300/);
});

test("a held or unfinished lesson is never served", async () => {
  const { call, store } = setup();
  const row = await liveLesson(store, { date: "2026-10-21" });
  await store.updateLesson(row.id, { held: true });
  assert.equal((await call("GET", "today")).body.lesson, null);
  await store.updateLesson(row.id, { held: false, status: "checking" });
  assert.equal((await call("GET", "lesson", { query: { slug: "salamis" } })).statusCode, 404);
});

test("lesson by slug: validated, live only", async () => {
  const { call, store } = setup();
  await liveLesson(store, { date: "2026-10-20" });
  assert.equal((await call("GET", "lesson", { query: { slug: "salamis" } })).body.lesson.title, "Salamis");
  assert.equal((await call("GET", "lesson", { query: { slug: "../etc/passwd" } })).statusCode, 400);
  assert.equal((await call("GET", "lesson", { query: { slug: "nope" } })).statusCode, 404);
});

test("archive lists live lessons newest first", async () => {
  const { call, store } = setup();
  await liveLesson(store, { slug: "a", date: "2026-10-19", title: "A" });
  await liveLesson(store, { slug: "b", date: "2026-10-20", title: "B" });
  const res = await call("GET", "archive");
  assert.deepEqual(res.body.lessons.map((l) => l.slug), ["b", "a"]);
  assert.deepEqual(res.body.lessons[0].takeaways, ["One.", "Two.", "Three."]);
});

test("flags are validated, stored and rate-limited (bad attempts count too)", async () => {
  const { call, store } = setup({ limits: { flagLimit: { limit: 3, windowMs: 60000 } } });
  await liveLesson(store, { date: "2026-10-20" });
  assert.equal((await call("POST", "flag", { body: { slug: "salamis", card: 3, reason: "nonsense" } })).statusCode, 400);
  assert.equal((await call("POST", "flag", { body: { slug: "salamis", card: 3, reason: "other" } })).statusCode, 400, "other needs a note");
  assert.equal((await call("POST", "flag", { body: { slug: "salamis", card: 3, reason: "fact", note: "Wrong year" } })).statusCode, 200);
  assert.equal((await call("POST", "flag", { body: { slug: "salamis", card: 4, reason: "fact" } })).statusCode, 429);
  assert.equal(store.db.flags.length, 1);
  // Open flags are reported with the lesson so the page can mark the card.
  assert.deepEqual((await call("GET", "today")).body.lesson.flagged, [3]);
});

test("a flag on a lesson that isn't out is refused", async () => {
  const { call, store } = setup();
  await liveLesson(store, { date: "2026-10-30" });
  assert.equal((await call("POST", "flag", { body: { slug: "salamis", reason: "fact" } })).statusCode, 404);
});

test("push subscriptions are validated", async () => {
  const { call, store } = setup();
  assert.equal((await call("GET", "push")).body.publicKey, "BPUBLIC");
  assert.equal((await call("POST", "push", { body: { subscription: { endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } } } })).statusCode, 400);
  const sub = { endpoint: "https://push.example.com/abc123", keys: { p256dh: "key", auth: "auth" } };
  assert.equal((await call("POST", "push", { body: { subscription: sub } })).statusCode, 200);
  assert.equal(store.db.push.size, 1);
  assert.equal((await call("DELETE", "push", { body: { endpoint: sub.endpoint } })).statusCode, 200);
  assert.equal(store.db.push.size, 0);
});

test("owner routes need the Acta allowlist; anonymous callers learn nothing", async () => {
  for (const [method, action] of [["GET", "desk"], ["POST", "desk"], ["GET", "me"], ["POST", "ask"], ["GET", "all-lessons"], ["GET", "any-lesson"]]) {
    const anon = setup({ who: null });
    const res = await anon.call(method, action, { body: { op: "advance" } });
    assert.equal(res.statusCode, 401, `${method} ${action}`);
    assert.equal(anon.authCalls[0].allowlistEnv, "ACTA_EDITOR_USER_IDS");
    const stranger = setup({ who: "user_other" });
    assert.equal((await stranger.call(method, action, { body: { op: "advance" } })).statusCode, 403);
  }
});

test("Charlie's archive lists every scheduled lesson, out or not", async () => {
  const { call, store } = setup();
  await liveLesson(store, { slug: "past", date: "2026-10-20", title: "Past" });
  const future = await liveLesson(store, { slug: "future", date: "2026-10-23", title: "Future" });
  const held = await liveLesson(store, { slug: "held", date: "2026-10-19", title: "Held" });
  await store.updateLesson(held.id, { held: true });
  const unwritten = await liveLesson(store, { slug: "unwritten", date: "2026-10-26", title: "Unwritten" });
  await store.updateLesson(unwritten.id, { status: "queued", data: null });

  // Visitors see only what's out.
  assert.deepEqual((await call("GET", "archive")).body.lessons.map((l) => l.slug), ["past"]);

  const res = await call("GET", "all-lessons");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  const bySlug = Object.fromEntries(res.body.lessons.map((l) => [l.slug, l]));
  assert.deepEqual(res.body.lessons.map((l) => l.slug), ["unwritten", "future", "past", "held"]);
  assert.equal(bySlug.past.live, true);
  assert.equal(bySlug.future.live, false);
  assert.equal(bySlug.future.written, true);
  assert.equal(bySlug.held.held, true);
  assert.equal(bySlug.held.live, false);
  assert.equal(bySlug.unwritten.written, false);
  assert.equal(bySlug.unwritten.status, "queued");
  assert.equal(bySlug.unwritten.title, "Topic 1-0", "an unwritten lesson shows its topic's title");
  assert.ok(future);
});

test("Charlie can open a lesson before its day; visitors can't", async () => {
  const { call, store } = setup();
  await liveLesson(store, { slug: "future", date: "2026-10-23", title: "Future" });
  assert.equal((await call("GET", "lesson", { query: { slug: "future" } })).statusCode, 404);
  const res = await call("GET", "any-lesson", { query: { slug: "future" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.lesson.title, "Future");
  assert.equal(res.body.lesson.live, false);
  const queued = await liveLesson(store, { slug: "queued", date: "2026-10-26" });
  await store.updateLesson(queued.id, { status: "queued", data: null });
  assert.equal((await call("GET", "any-lesson", { query: { slug: "queued" } })).statusCode, 404);
  assert.equal((await call("GET", "any-lesson", { query: { slug: "../x" } })).statusCode, 400);
});

test("me round-trips Charlie's reading state", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "me")).body.data, null);
  assert.equal((await call("PUT", "me", { body: { data: { v: 1, deck: { a: 1 } } } })).statusCode, 200);
  assert.deepEqual((await call("GET", "me")).body.data, { v: 1, deck: { a: 1 } });
  assert.equal((await call("PUT", "me", { body: { data: [] } })).statusCode, 400);
  assert.equal((await call("PUT", "me", { body: { data: { big: "x".repeat(700 * 1024) } } })).statusCode, 413);
});

test("ask answers about a lesson", async () => {
  const { call, store, claude } = setup();
  await liveLesson(store, { date: "2026-10-20" });
  const res = await call("POST", "ask", { body: { slug: "salamis", card: 0, question: "Why didn't Xerxes wait?" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answer, "Because the strait was narrow.");
  assert.match(claude.calls.at(-1).params.messages[0].content, /Why didn't Xerxes wait\?/);
  assert.equal((await call("POST", "ask", { body: { slug: "salamis", question: "" } })).statusCode, 400);
});

test("the desk shows setup, seasons and lessons, and runs operations", async () => {
  const { call, store } = setup();
  const sid = await store.insertSeason(seasonFixture(), "proposed");
  const desk = await call("GET", "desk");
  assert.equal(desk.statusCode, 200);
  assert.equal(desk.body.config.claude, true);
  assert.equal(desk.body.seasons[0].topics.length, 30);
  assert.equal(desk.headers["cache-control"], "no-store");

  const approved = await call("POST", "desk", { body: { op: "approve", seasonId: sid } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.start, "2026-10-26");

  const again = await call("POST", "desk", { body: { op: "approve", seasonId: sid } });
  assert.equal(again.statusCode, 409);

  const ran = await call("POST", "desk", { body: { op: "advance" } });
  assert.ok(ran.body.steps.length > 0);

  const lesson = (await call("GET", "desk")).body.lessons[0];
  const held = await call("POST", "desk", { body: { op: "hold", lessonId: lesson.id, held: true } });
  assert.equal(held.statusCode, 200);
  assert.equal((await call("GET", "desk")).body.lessons[0].held, true);

  assert.equal((await call("POST", "desk", { body: { op: "explode" } })).statusCode, 400);
  assert.equal((await call("POST", "desk", { body: { op: "hold" } })).statusCode, 400);
});

test("desk preview returns a draft lesson whatever its status", async () => {
  const { call, store } = setup();
  const row = await liveLesson(store, { date: "2026-10-30" });
  await store.updateLesson(row.id, { status: "needs_review", issues: [{ severity: "error", problem: "x" }] });
  const res = await call("POST", "desk", { body: { op: "preview", lessonId: row.id } });
  assert.equal(res.body.lesson.slug, "salamis");
  assert.equal(res.body.lesson.preview, true);
  assert.equal(res.body.status, "needs_review");
});

test("cron needs the secret, then advances, proposes and reminds", async () => {
  const { call, store } = setup({ respond: { now: () => reply({ title: "Season 2", span: "", intro: "", weeks: [0, 1, 2, 3, 4].map(() => seasonFixture().weeks[0]) }) } });
  assert.equal((await call("GET", "cron")).statusCode, 401);
  assert.equal((await call("GET", "cron", { headers: { authorization: "Bearer wrong" } })).statusCode, 401);
  const res = await call("GET", "cron", { headers: { authorization: "Bearer s3cret" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.proposed, "Season 2", "an empty calendar gets a proposal");
  assert.ok(store.db.seasons.length >= 1);
  assert.ok(res.body.push);
});

test("cron without a configured secret is closed", async () => {
  const { call } = setup({ cronSecret: null });
  assert.equal((await call("GET", "cron", { headers: { authorization: "Bearer " } })).statusCode, 503);
});

test("unknown routes and wrong methods", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "nope")).statusCode, 404);
  const res = await call("DELETE", "today");
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
});
