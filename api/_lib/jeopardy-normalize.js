// Input validation for /api/jeopardy. NOT an endpoint.
//
// The host's browser publishes the room's public state and every player's
// phone renders it, so the server rebuilds it from a whitelist instead of
// relaying whatever arrived: known fields only, strings trimmed and capped,
// numbers clamped, ids pattern-checked. The shape mirrors
// src/Pages/Dashboard/Jeopardrink/publicView.js. Change both together.

const PHASES = ["lobby", "board", "wager", "clue", "break", "lc-wager", "lc-clue", "lc-judge", "over"];
const RESOLVED = ["correct", "stumped", "nobody", "dd-right", "dd-wrong"];
const CALLOUTS = ["score", "drink", "everyone", "give", "shot", "finish"];

const MAX_STATE_CHARS = 24 * 1024; // a full board + 12 players is ~4KB
const MAX_ROSTER = 16;
const MAX_CATS = 6;
const MAX_CELLS = 5;
const MAX_POINTS = 10000000;

const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"; // no vowels, so no accidental words
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{4}$`);
const PLAYER_ID_RE = /^[a-f0-9]{16}$/; // phones (server-issued)
const SEAT_ID_RE = /^[a-z0-9-]{1,40}$/i; // anyone on the roster, incl. host-added players
const TOKEN_RE = /^[a-f0-9]{32}$/;

const text = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
const int = (v, min, max) => (Number.isInteger(v) ? Math.min(Math.max(v, min), max) : 0);
const seat = (v) => (typeof v === "string" && SEAT_ID_RE.test(v) ? v : null);
const seats = (v) => (Array.isArray(v) ? v.map(seat).filter(Boolean).slice(0, MAX_ROSTER) : []);
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const normalizeCode = (v) => {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  return CODE_RE.test(code) ? code : null;
};
const isPlayerId = (v) => typeof v === "string" && PLAYER_ID_RE.test(v);
const isToken = (v) => typeof v === "string" && TOKEN_RE.test(v);

/** A display name: 1-20 visible characters. */
function normalizeName(v) {
  const name = text(v, 20);
  return name ? { ok: true, value: name } : { ok: false, error: "Pick a name (20 characters max)." };
}

const board = (v) =>
  Array.isArray(v)
    ? v.slice(0, MAX_CATS).map((cat) => ({
        name: text(cat && cat.name, 60),
        cells: (Array.isArray(cat && cat.cells) ? cat.cells : []).slice(0, MAX_CELLS).map((c) => ({
          value: int(c && c.value, 0, 100000),
          used: Boolean(c && c.used === true),
        })),
      }))
    : null;

const clue = (v) =>
  isObject(v)
    ? {
        cat: text(v.cat, 60),
        value: int(v.value, 0, 100000),
        dd: v.dd === true,
        wager: Number.isInteger(v.wager) ? int(v.wager, 0, MAX_POINTS) : null,
        resolved: RESOLVED.includes(v.resolved) ? v.resolved : null,
        answer: v.answer ? text(v.answer, 120) || null : null,
      }
    : null;

const callout = (v) =>
  isObject(v) && CALLOUTS.includes(v.kind)
    ? {
        id: int(v.id, 0, MAX_POINTS),
        kind: v.kind,
        pid: seat(v.pid),
        sips: int(v.sips, 0, 10),
        points: int(v.points, -MAX_POINTS, MAX_POINTS),
      }
    : null;

const lastCall = (v) => {
  if (!isObject(v)) return null;
  const judged = isObject(v.judged)
    ? Object.fromEntries(
        Object.entries(v.judged)
          .filter(([k]) => seat(k))
          .slice(0, MAX_ROSTER)
          .map(([k, ok]) => [k, ok === true])
      )
    : {};
  return {
    cat: text(v.cat, 60),
    wagered: seats(v.wagered),
    answered: seats(v.answered),
    judged,
    answer: v.answer ? text(v.answer, 120) || null : null,
  };
};

/** Rebuild the host's public state from the whitelist, or explain why not. */
function normalizeState(raw) {
  if (!isObject(raw)) return { ok: false, error: "Missing state." };
  if (JSON.stringify(raw).length > MAX_STATE_CHARS) return { ok: false, error: "State is too big." };
  if (!PHASES.includes(raw.phase)) return { ok: false, error: "Unknown phase." };
  if (raw.phase === "lobby") return { ok: true, value: { phase: "lobby" } };

  const buzz = isObject(raw.buzz) ? raw.buzz : {};
  return {
    ok: true,
    value: {
      phase: raw.phase,
      round: int(raw.round, 0, 1),
      rounds: int(raw.rounds, 1, 2),
      board: board(raw.board),
      clue: clue(raw.clue),
      buzz: { open: buzz.open === true, seq: int(buzz.seq, 0, MAX_POINTS), locked: seats(buzz.locked) },
      answering: seat(raw.answering),
      control: seat(raw.control),
      roster: (Array.isArray(raw.roster) ? raw.roster : [])
        .slice(0, MAX_ROSTER)
        .map((p) => ({ id: seat(p && p.id), name: text(p && p.name, 20), score: int(p && p.score, -MAX_POINTS, MAX_POINTS) }))
        .filter((p) => p.id && p.name),
      callout: callout(raw.callout),
      lastCall: lastCall(raw.lastCall),
      drinking: raw.drinking !== false,
    },
  };
}

/** A Last Call wager (whole points) or typed answer from a phone. */
function normalizeFinal(body) {
  const out = {};
  if (body.wager !== undefined) {
    const n = Number(body.wager);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Wager a number, zero or more." };
    out.wager = Math.min(Math.round(n), MAX_POINTS);
  }
  if (body.answer !== undefined) {
    const answer = text(body.answer, 80);
    if (!answer) return { ok: false, error: "Type an answer first." };
    out.answer = answer;
  }
  return out.wager === undefined && out.answer === undefined
    ? { ok: false, error: "Send a wager or an answer." }
    : { ok: true, value: out };
}

module.exports = {
  CODE_ALPHABET,
  MAX_STATE_CHARS,
  normalizeCode,
  normalizeName,
  normalizeState,
  normalizeFinal,
  isPlayerId,
  isToken,
};
