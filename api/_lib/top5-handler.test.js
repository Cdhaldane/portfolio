const test = require("node:test");
const assert = require("node:assert/strict");
const { createTop5Handler, createLimiter } = require("./top5-handler");

class HttpError extends Error {
  constructor(status, payload) {
    super(payload.error);
    this.status = status;
    this.payload = payload;
  }
}

const OWNER = "user_owner";

const validBody = () => ({
  packId: "food",
  pack: {
    name: "Food",
    tagline: "Chef's Selection",
    statLabels: ["Comfort", "Crave", "Mess"],
    cards: [1, 2, 3, 4, 5].map((n) => ({
      id: `dish-${n}`,
      title: `Dish ${n}`,
      meta: "",
      icon: "fa-pizza-slice",
      take: "Delicious.",
      stats: [9, 9, 9],
      fun: "",
    })),
  },
});

/** A handler wired to in-memory fakes; `who` is the signed-in user (or null). */
function setup({ who = OWNER, sql = true, limits } = {}) {
  const store = new Map();
  const calls = { auth: [] };
  const requireUser = async (req, opts) => {
    calls.auth.push(opts);
    if (!who) throw new HttpError(401, { error: "Sign in required." });
    if (who !== OWNER) throw new HttpError(403, { error: "Not on the list.", userId: who });
    return { userId: who };
  };
  const sendAuthError = (res, err) => res.status(err.status).json(err.payload);
  const handler = createTop5Handler({
    requireUser,
    sendAuthError,
    HttpError,
    getSql: () => (sql ? {} : null),
    ensureTable: async () => {},
    listPacks: async () => [...store.entries()].map(([pack_id, data]) => ({ pack_id, data })),
    savePack: async (_sql, userId, { packId, pack }) => {
      store.set(packId, pack);
      return { pack_id: packId, data: pack, updated_by: userId };
    },
    deletePack: async (_sql, packId) => store.delete(packId),
    ...(limits || {}),
  });
  return { handler, store, calls };
}

function call(handler, { method = "GET", query = {}, body, ip = "203.0.113.7" } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
  const req = { method, query, body, headers: { "x-forwarded-for": ip } };
  return handler(req, res).then(() => res);
}

test("anyone can read the saved lists, without signing in", async () => {
  const { handler, store, calls } = setup({ who: null });
  store.set("movies", { name: "Films" });
  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, packs: { movies: { name: "Films" } } });
  assert.equal(calls.auth.length, 0);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("reads still work with no database (the page keeps its defaults)", async () => {
  const { handler } = setup({ sql: false });
  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, packs: {} });
});

test("writes require a signed-in user on the Top 5 allowlist", async () => {
  const anon = setup({ who: null });
  assert.equal((await call(anon.handler, { method: "PUT", body: validBody() })).statusCode, 401);
  const stranger = setup({ who: "user_someone_else" });
  const res = await call(stranger.handler, { method: "PUT", body: validBody() });
  assert.equal(res.statusCode, 403);
  assert.equal(stranger.store.size, 0);
  assert.deepEqual(stranger.calls.auth[0], { allowlistEnv: "TOP5_EDITOR_USER_IDS", product: "Top 5" });
});

test("the owner can check, save and reset a pack", async () => {
  const { handler, store } = setup();
  const me = await call(handler, { query: { me: "1" } });
  assert.deepEqual(me.payload, { ok: true, canEdit: true });

  const saved = await call(handler, { method: "PUT", body: validBody() });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.payload.ok, true);
  assert.equal(store.get("food").cards[0].title, "Dish 1");

  const reset = await call(handler, { method: "DELETE", query: { packId: "food" } });
  assert.equal(reset.statusCode, 200);
  assert.equal(store.has("food"), false);
});

test("bad edits are rejected before they reach the database", async () => {
  const { handler, store } = setup();
  const bad = validBody();
  bad.pack.cards[1].title = "x".repeat(200);
  const res = await call(handler, { method: "PUT", body: bad });
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /#2/);
  assert.equal(store.size, 0);
  const unknown = await call(handler, { method: "DELETE", query: { packId: "nope" } });
  assert.equal(unknown.statusCode, 400);
  const empty = await call(handler, { method: "PUT", body: "nope" });
  assert.equal(empty.statusCode, 400);
});

test("oversized bodies are refused", async () => {
  const { handler } = setup();
  const huge = validBody();
  huge.pack.padding = "x".repeat(20000);
  const res = await call(handler, { method: "PUT", body: huge });
  assert.equal(res.statusCode, 413);
});

test("writes need a database", async () => {
  const { handler } = setup({ sql: false });
  const res = await call(handler, { method: "PUT", body: validBody() });
  assert.equal(res.statusCode, 503);
});

test("other methods are refused with an Allow header", async () => {
  const { handler } = setup();
  const res = await call(handler, { method: "POST", body: validBody() });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET, PUT, DELETE");
});

test("requests are rate limited per IP, and writes per user", async () => {
  const reads = setup({ limits: { readLimit: { limit: 2, windowMs: 60000 } } });
  assert.equal((await call(reads.handler)).statusCode, 200);
  assert.equal((await call(reads.handler)).statusCode, 200);
  assert.equal((await call(reads.handler)).statusCode, 429);
  assert.equal((await call(reads.handler, { ip: "198.51.100.9" })).statusCode, 200);

  const writes = setup({ limits: { writeLimit: { limit: 1, windowMs: 60000 } } });
  assert.equal((await call(writes.handler, { method: "PUT", body: validBody() })).statusCode, 200);
  assert.equal((await call(writes.handler, { method: "PUT", body: validBody() })).statusCode, 429);
});

test("the limiter forgets old hits and caps its memory", () => {
  const allow = createLimiter({ limit: 1, windowMs: 1000, maxKeys: 3 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 500), false);
  assert.equal(allow("a", 1500), true);
  ["b", "c", "d", "e"].forEach((k) => allow(k, 2000));
  // "a" was evicted as the oldest key, so it starts fresh.
  assert.equal(allow("a", 2000), true);
});
