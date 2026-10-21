// The /api/jeopardy request handler (JEOPARDRINK! phone buzzers), built from
// injected dependencies so the rules are unit-tested without Neon (see
// jeopardy-handler.test.js). NOT an endpoint; api/jeopardy.js wires it up.
//
//   POST ?op=create                              → { code, hostKey }
//   PUT  ?op=state  { code, state }   [host]     → publish the public state
//   GET  ?op=poll&code=…&v=…                     → public state (players)
//   GET  ?op=poll&code=…&v=…&as=host  [host]     → + joins, buzz order, Last Call
//   POST ?op=join   { code, name }               → { playerId, secret }
//   POST ?op=buzz   { code, playerId, secret, seq }
//   POST ?op=final  { code, playerId, secret, wager | answer }
//
// [host] = `X-Host-Key` header. Keys and player secrets are random 128-bit
// tokens stored only as SHA-256 hashes. Rooms are throwaway party state, so
// there are no accounts: possession of the token is the permission.
const crypto = require("crypto");
const { createLimiter, clientKey } = require("./top5-handler");
const {
  CODE_ALPHABET,
  MAX_STATE_CHARS,
  normalizeCode,
  normalizeName,
  normalizeState,
  normalizeFinal,
  isPlayerId,
  isToken,
} = require("./jeopardy-normalize");

const MAX_PLAYERS = 12;
const CODE_ATTEMPTS = 6;

const DEFAULT_LIMITS = Object.freeze({
  ip: { limit: 2400, windowMs: 60 * 1000 }, // a whole party shares one Wi-Fi IP
  create: { limit: 10, windowMs: 60 * 60 * 1000 },
  join: { limit: 40, windowMs: 10 * 60 * 1000 },
  poll: { limit: 240, windowMs: 60 * 1000 }, // per seat: 4/s, comfortably above the 600ms cadence
  act: { limit: 180, windowMs: 60 * 1000 }, // per seat: buzzes, answers, host publishes
});

const token = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const matches = (secret, hash) => {
  const a = Buffer.from(sha(secret), "hex");
  const b = Buffer.from(String(hash || ""), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const randomCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");

const ROOM_GONE = { error: "That room doesn't exist or has closed. Check the code with your host." };

class Reply extends Error {
  constructor(status, payload) {
    super(payload.error || "reply");
    this.status = status;
    this.payload = payload;
  }
}
const fail = (status, error) => {
  throw new Reply(status, { error });
};

const bodyOf = (req) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});
const hostKeyOf = (req) => String((req.headers && req.headers["x-host-key"]) || "");

function createJeopardyHandler({ getSql, db, limits = DEFAULT_LIMITS }) {
  const allow = Object.fromEntries(Object.entries({ ...DEFAULT_LIMITS, ...limits }).map(([k, v]) => [k, createLimiter(v)]));
  const throttle = (bucket, key, message = "Easy there. Give it a second.") => {
    if (!allow[bucket](key)) fail(429, message);
  };

  const codeFrom = (v) => normalizeCode(v) || fail(400, "Room codes are four letters.");

  /** The snapshot for a live room, after checking the host key. */
  async function hostRoom(sql, req, code) {
    const key = hostKeyOf(req);
    if (!isToken(key)) fail(401, "Missing host key.");
    const room = await db.getSnapshot(sql, code);
    if (!room) throw new Reply(404, ROOM_GONE);
    if (!matches(key, room.host_hash)) fail(403, "That's not your room.");
    return room;
  }

  /** A joined player whose secret checks out, with the room's current state. */
  async function playerOf(sql, code, body) {
    if (!isPlayerId(body.playerId) || !isToken(body.secret)) fail(401, "Rejoin the room to keep playing.");
    const player = await db.getPlayer(sql, code, body.playerId);
    if (!player) throw new Reply(404, ROOM_GONE);
    if (!matches(body.secret, player.secret_hash)) fail(403, "Rejoin the room to keep playing.");
    throttle("act", `${code}:${body.playerId}`);
    return player;
  }

  async function create(sql, res, req) {
    throttle("create", clientKey(req), "That's a lot of rooms. Try again in a bit.");
    await db.purgeOldRooms(sql);
    const hostKey = token();
    for (let i = 0; i < CODE_ATTEMPTS; i += 1) {
      const code = randomCode();
      if (await db.createRoom(sql, { code, hostHash: sha(hostKey) })) {
        return res.status(201).json({ ok: true, code, hostKey });
      }
    }
    return fail(503, "Couldn't find a free room code. Try again.");
  }

  async function publish(sql, res, req) {
    const body = bodyOf(req);
    const code = codeFrom(body.code);
    if (JSON.stringify(body).length > MAX_STATE_CHARS + 512) fail(413, "State is too big.");
    await hostRoom(sql, req, code);
    throttle("act", `${code}:host`);
    const parsed = normalizeState(body.state);
    if (!parsed.ok) fail(400, parsed.error);
    const version = await db.saveState(sql, code, parsed.value);
    return res.status(200).json({ ok: true, version });
  }

  async function poll(sql, res, req) {
    const query = req.query || {};
    const code = codeFrom(query.code);
    const asHost = query.as === "host";
    // Per seat, not per IP: the whole party is usually on one Wi-Fi. A spoofed
    // pid only buys a fresh seat bucket; the IP limit above still applies.
    const seat = asHost ? "host" : isPlayerId(query.pid) ? query.pid : clientKey(req);
    throttle("poll", `${code}:${seat}`);
    const room = asHost ? await hostRoom(sql, req, code) : await db.getSnapshot(sql, code);
    if (!room) throw new Reply(404, ROOM_GONE);

    const since = Number(query.v);
    if (Number.isInteger(since) && since === room.version) {
      return res.status(200).json({ ok: true, unchanged: true, version: room.version });
    }
    const state = room.state || { phase: "lobby" };
    const locked = (state.buzz && state.buzz.locked) || [];
    const order = room.buzzes.map((b) => b.pid).filter((pid) => !locked.includes(pid));
    const out = { ok: true, version: room.version, state, first: order[0] || null };
    if (!asHost) return res.status(200).json(out);
    return res.status(200).json({
      ...out,
      seq: state.buzz ? state.buzz.seq : null,
      players: room.players,
      buzzes: order,
      finals: room.finals,
    });
  }

  async function join(sql, res, req) {
    throttle("join", clientKey(req), "Too many joins from here. Give it a minute.");
    const body = bodyOf(req);
    const code = codeFrom(body.code);
    const name = normalizeName(body.name);
    if (!name.ok) fail(400, name.error);
    const room = await db.getSnapshot(sql, code);
    if (!room) throw new Reply(404, ROOM_GONE);
    if (room.players.length >= MAX_PLAYERS) fail(409, `This room is full (${MAX_PLAYERS} players).`);
    const lower = name.value.toLowerCase();
    if (room.players.some((p) => p.name.toLowerCase() === lower)) {
      fail(409, "Someone already took that name. Add a last initial?");
    }
    const playerId = token(8);
    const secret = token();
    await db.addPlayer(sql, { code, id: playerId, name: name.value, secretHash: sha(secret) });
    return res.status(201).json({ ok: true, code, playerId, secret, name: name.value });
  }

  async function buzz(sql, res, req) {
    const body = bodyOf(req);
    const code = codeFrom(body.code);
    const { state } = await playerOf(sql, code, body);
    const b = (state && state.buzz) || {};
    const live =
      Boolean(state) && state.phase === "clue" && b.open === true && Number.isInteger(body.seq) && b.seq === body.seq;
    if (!live) return res.status(200).json({ ok: true, accepted: false, reason: "closed" });
    if ((b.locked || []).includes(body.playerId)) {
      return res.status(200).json({ ok: true, accepted: false, reason: "locked" });
    }
    const accepted = await db.insertBuzz(sql, { code, seq: b.seq, playerId: body.playerId });
    const order = (await db.listBuzzes(sql, code, b.seq)).filter((pid) => !(b.locked || []).includes(pid));
    return res.status(200).json({ ok: true, accepted, first: order[0] || null });
  }

  async function final(sql, res, req) {
    const body = bodyOf(req);
    const code = codeFrom(body.code);
    const { state } = await playerOf(sql, code, body);
    const parsed = normalizeFinal(body);
    if (!parsed.ok) fail(400, parsed.error);
    const { wager, answer } = parsed.value;
    const phase = state && state.phase;
    if (wager !== undefined && phase !== "lc-wager") fail(409, "Wagers are locked.");
    if (answer !== undefined && phase !== "lc-clue") fail(409, "Pencils down. Too late for answers.");
    await db.upsertFinal(sql, { code, playerId: body.playerId, wager, answer });
    return res.status(200).json({ ok: true });
  }

  const ROUTES = {
    "POST create": create,
    "PUT state": publish,
    "GET poll": poll,
    "POST join": join,
    "POST buzz": buzz,
    "POST final": final,
  };

  return async function jeopardyHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    const route = ROUTES[`${req.method} ${(req.query || {}).op}`];
    if (!route) return res.status(404).json({ error: "Unknown request." });

    try {
      throttle("ip", clientKey(req), "Slow down a little.");
      const sql = getSql();
      if (!sql) fail(503, "Phone buzzers aren't set up on this server.");
      await db.ensureTables(sql);
      return await route(sql, res, req);
    } catch (err) {
      if (err instanceof Reply) return res.status(err.status).json(err.payload);
      console.error("Jeopardy API error:", err);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}

module.exports = { createJeopardyHandler, MAX_PLAYERS };
