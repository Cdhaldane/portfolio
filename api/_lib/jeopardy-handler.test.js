const test = require("node:test");
const assert = require("node:assert/strict");
const { createJeopardyHandler, MAX_PLAYERS } = require("./jeopardy-handler");

/** In-memory stand-in for jeopardy-db.js with the same semantics. */
function fakeDb() {
  const rooms = new Map();
  let clock = 0;
  const bump = (r) => {
    r.version += 1;
  };
  const db = {
    ensureTables: async () => {},
    purgeOldRooms: async () => {},
    createRoom: async (_sql, { code, hostHash }) => {
      if (rooms.has(code)) return false;
      rooms.set(code, { host_hash: hostHash, state: { phase: "lobby" }, version: 1, players: [], buzzes: [], finals: new Map() });
      return true;
    },
    getSnapshot: async (_sql, code) => {
      const r = rooms.get(code);
      if (!r) return null;
      const seq = r.state.buzz ? r.state.buzz.seq : null;
      return {
        version: r.version,
        state: r.state,
        host_hash: r.host_hash,
        players: r.players.map(({ id, name }) => ({ id, name })),
        buzzes: r.buzzes.filter((b) => b.seq === seq).sort((a, b) => a.at - b.at).map((b) => ({ pid: b.pid })),
        finals: [...r.finals.entries()].map(([pid, f]) => ({ pid, ...f })),
      };
    },
    getPlayer: async (_sql, code, id) => {
      const r = rooms.get(code);
      const p = r && r.players.find((x) => x.id === id);
      return p ? { state: r.state, secret_hash: p.secret_hash } : null;
    },
    saveState: async (_sql, code, state) => {
      const r = rooms.get(code);
      r.state = state;
      bump(r);
      return r.version;
    },
    addPlayer: async (_sql, { code, id, name, secretHash }) => {
      const r = rooms.get(code);
      r.players.push({ id, name, secret_hash: secretHash });
      bump(r);
    },
    insertBuzz: async (_sql, { code, seq, playerId }) => {
      const r = rooms.get(code);
      if (r.buzzes.some((b) => b.seq === seq && b.pid === playerId)) return false;
      clock += 1;
      r.buzzes.push({ seq, pid: playerId, at: clock });
      bump(r);
      return true;
    },
    listBuzzes: async (_sql, code, seq) =>
      rooms.get(code).buzzes.filter((b) => b.seq === seq).sort((a, b) => a.at - b.at).map((b) => b.pid),
    upsertFinal: async (_sql, { code, playerId, wager = null, answer = null }) => {
      const r = rooms.get(code);
      const prev = r.finals.get(playerId) || { wager: null, answer: null };
      r.finals.set(playerId, { wager: wager ?? prev.wager, answer: answer ?? prev.answer });
      bump(r);
    },
  };
  return { db, rooms };
}

function setup({ sql = true, limits } = {}) {
  const { db, rooms } = fakeDb();
  const handler = createJeopardyHandler({ getSql: () => (sql ? {} : null), db, limits });
  return { handler, rooms };
}

/** Minimal req/res pair matching what Vercel hands a Node function. */
async function call(handler, { method = "GET", op, query = {}, body, hostKey, ip = "10.0.0.1" }) {
  const req = {
    method,
    query: { op, ...query },
    body,
    headers: { "x-forwarded-for": ip, ...(hostKey ? { "x-host-key": hostKey } : {}) },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
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
  await handler(req, res);
  return res;
}

const liveState = (overrides = {}) => ({
  phase: "clue",
  round: 0,
  rounds: 2,
  board: [{ name: "Potent Potables", cells: [{ value: 200, used: false }] }],
  clue: { cat: "Potent Potables", value: 200, dd: false, wager: null, resolved: null, answer: null },
  buzz: { open: true, seq: 3, locked: [] },
  answering: null,
  control: null,
  roster: [],
  callout: null,
  lastCall: null,
  drinking: true,
  ...overrides,
});

async function room(handler) {
  const res = await call(handler, { method: "POST", op: "create" });
  assert.equal(res.statusCode, 201);
  return res.body;
}

async function joinAs(handler, code, name, ip) {
  const res = await call(handler, { method: "POST", op: "join", body: { code, name }, ip });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body;
}

const publish = (handler, code, hostKey, state) =>
  call(handler, { method: "PUT", op: "state", body: { code, state }, hostKey });

test("create hands back a four-letter vowel-free code and a host key", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  assert.match(hostKey, /^[a-f0-9]{32}$/);
});

test("unknown ops and methods are 404s", async () => {
  const { handler } = setup();
  assert.equal((await call(handler, { op: "nope" })).statusCode, 404);
  assert.equal((await call(handler, { method: "DELETE", op: "poll" })).statusCode, 404);
});

test("no database configured is a friendly 503", async () => {
  const { handler } = setup({ sql: false });
  const res = await call(handler, { method: "POST", op: "create" });
  assert.equal(res.statusCode, 503);
});

test("only the host key can publish state", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  assert.equal((await publish(handler, code, undefined, liveState())).statusCode, 401);
  assert.equal((await publish(handler, code, "f".repeat(32), liveState())).statusCode, 403);
  assert.equal((await publish(handler, code, hostKey, liveState())).statusCode, 200);
});

test("published state is rebuilt from the whitelist", async () => {
  const { handler, rooms } = setup();
  const { code, hostKey } = await room(handler);
  const junk = liveState({
    evil: "<script>",
    clue: { cat: "  Spaced   out  ", value: 200, q: "the secret clue", a: "the answer" },
    roster: [{ id: "abc", name: "x".repeat(50), score: 1.5 }, { id: "bad id!", name: "Nope" }],
  });
  await publish(handler, code, hostKey, junk);
  const saved = rooms.get(code).state;
  assert.equal(saved.evil, undefined);
  assert.equal(saved.clue.cat, "Spaced out");
  assert.equal(saved.clue.q, undefined);
  assert.deepEqual(saved.roster, [{ id: "abc", name: "x".repeat(20), score: 0 }]);
});

test("bad state shapes are rejected", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  assert.equal((await publish(handler, code, hostKey, { phase: "party" })).statusCode, 400);
  assert.equal((await publish(handler, code, hostKey, [])).statusCode, 400);
  const huge = liveState({ roster: [{ id: "a", name: "A", pad: "x".repeat(30000) }] });
  assert.equal((await publish(handler, code, hostKey, huge)).statusCode, 413);
});

test("joining: names are validated, unique per room, and the room caps out", async () => {
  const { handler } = setup();
  const { code } = await room(handler);
  assert.equal((await call(handler, { method: "POST", op: "join", body: { code, name: "   " } })).statusCode, 400);
  assert.equal((await call(handler, { method: "POST", op: "join", body: { code: "zz", name: "Al" } })).statusCode, 400);
  assert.equal((await call(handler, { method: "POST", op: "join", body: { code: "BBBB", name: "Al" } })).statusCode, 404);
  const al = await joinAs(handler, code, "Al", "1.1.1.1");
  assert.match(al.playerId, /^[a-f0-9]{16}$/);
  const dupe = await call(handler, { method: "POST", op: "join", body: { code, name: "AL" } });
  assert.equal(dupe.statusCode, 409);
  for (let i = 1; i < MAX_PLAYERS; i += 1) await joinAs(handler, code, `P${i}`, `2.2.2.${i}`);
  const full = await call(handler, { method: "POST", op: "join", body: { code, name: "Thirteen" } });
  assert.equal(full.statusCode, 409);
});

test("first buzz wins; duplicates, locked players and closed windows don't count", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  const a = await joinAs(handler, code, "Ana", "1.1.1.1");
  const b = await joinAs(handler, code, "Ben", "1.1.1.2");
  const c = await joinAs(handler, code, "Cy", "1.1.1.3");
  await publish(handler, code, hostKey, liveState({ buzz: { open: true, seq: 3, locked: [c.playerId] } }));
  const buzz = (p, seq = 3) =>
    call(handler, { method: "POST", op: "buzz", body: { code, playerId: p.playerId, secret: p.secret, seq } });

  const first = await buzz(b);
  assert.deepEqual(first.body, { ok: true, accepted: true, first: b.playerId });
  const second = await buzz(a);
  assert.equal(second.body.accepted, true);
  assert.equal(second.body.first, b.playerId);
  assert.equal((await buzz(b)).body.accepted, false); // already in
  assert.equal((await buzz(c)).body.reason, "locked");
  assert.equal((await buzz(a, 2)).body.reason, "closed"); // stale window

  const host = await call(handler, { op: "poll", query: { code, as: "host" }, hostKey });
  assert.deepEqual(host.body.buzzes, [b.playerId, a.playerId]);
  assert.equal(host.body.seq, 3);
});

test("a buzz needs the right secret", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  const a = await joinAs(handler, code, "Ana");
  await publish(handler, code, hostKey, liveState());
  const res = await call(handler, { method: "POST", op: "buzz", body: { code, playerId: a.playerId, secret: "0".repeat(32), seq: 3 } });
  assert.equal(res.statusCode, 403);
});

test("player polls see public state only; host polls see joins and Last Call", async () => {
  const { handler } = setup();
  const { code, hostKey } = await room(handler);
  const a = await joinAs(handler, code, "Ana");
  await publish(handler, code, hostKey, liveState({ phase: "lc-clue", clue: null, buzz: { open: false, seq: 3, locked: [] } }));
  await call(handler, { method: "POST", op: "final", body: { code, playerId: a.playerId, secret: a.secret, answer: "What is gin?" } });

  const player = await call(handler, { op: "poll", query: { code, pid: a.playerId } });
  assert.equal(player.body.state.phase, "lc-clue");
  assert.equal(player.body.finals, undefined);
  assert.equal(player.body.players, undefined);
  assert.equal(JSON.stringify(player.body).includes("host_hash"), false);

  const host = await call(handler, { op: "poll", query: { code, as: "host" }, hostKey });
  assert.deepEqual(host.body.players, [{ id: a.playerId, name: "Ana" }]);
  assert.deepEqual(host.body.finals, [{ pid: a.playerId, wager: null, answer: "What is gin?" }]);
  assert.equal(JSON.stringify(host.body).includes("host_hash"), false);

  const again = await call(handler, { op: "poll", query: { code, v: String(host.body.version) } });
  assert.deepEqual(again.body, { ok: true, unchanged: true, version: host.body.version });
});

test("host polls need the host key", async () => {
  const { handler } = setup();
  const { code } = await room(handler);
  assert.equal((await call(handler, { op: "poll", query: { code, as: "host" } })).statusCode, 401);
});

test("Last Call: wagers only while wagering, answers only while the clue is up", async () => {
  const { handler, rooms } = setup();
  const { code, hostKey } = await room(handler);
  const a = await joinAs(handler, code, "Ana");
  const final = (body) => call(handler, { method: "POST", op: "final", body: { code, playerId: a.playerId, secret: a.secret, ...body } });

  await publish(handler, code, hostKey, liveState({ phase: "lc-wager", clue: null }));
  assert.equal((await final({ wager: 600.4 })).statusCode, 200);
  assert.equal((await final({ wager: -5 })).statusCode, 400);
  assert.equal((await final({ answer: "early" })).statusCode, 409);

  await publish(handler, code, hostKey, liveState({ phase: "lc-clue", clue: null }));
  assert.equal((await final({ wager: 9000 })).statusCode, 409);
  assert.equal((await final({ answer: "  What is   rum? " })).statusCode, 200);
  assert.deepEqual(rooms.get(code).finals.get(a.playerId), { wager: 600, answer: "What is rum?" });

  await publish(handler, code, hostKey, liveState({ phase: "lc-judge", clue: null }));
  assert.equal((await final({ answer: "changed my mind" })).statusCode, 409);
});

test("room creation is rate-limited per IP", async () => {
  const { handler } = setup({ limits: { create: { limit: 2, windowMs: 60000 } } });
  await room(handler);
  await room(handler);
  assert.equal((await call(handler, { method: "POST", op: "create" })).statusCode, 429);
});

test("one Wi-Fi full of players doesn't share a poll bucket", async () => {
  const { handler } = setup({ limits: { poll: { limit: 2, windowMs: 60000 } } });
  const { code } = await room(handler);
  const a = await joinAs(handler, code, "Ana", "9.9.9.9");
  const b = await joinAs(handler, code, "Ben", "9.9.9.9");
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await call(handler, { op: "poll", query: { code, pid: a.playerId }, ip: "9.9.9.9" })).statusCode, 200);
  }
  assert.equal((await call(handler, { op: "poll", query: { code, pid: a.playerId }, ip: "9.9.9.9" })).statusCode, 429);
  assert.equal((await call(handler, { op: "poll", query: { code, pid: b.playerId }, ip: "9.9.9.9" })).statusCode, 200);
});
