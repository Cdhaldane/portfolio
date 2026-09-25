// Pure validation / cleanup for /api/bowler — no I/O, unit-tested via
// `npm run test:api`. NOT an endpoint (the `_lib` prefix keeps Vercel from
// routing to it).
//
// Everything that arrives from the browser OR from the vision model passes
// through here before it reaches the database: the model's read of a photo
// is just as untrusted as a hand-typed score.

// The two tracked bowlers. Keys are the stored ids (and the URL-ish short
// names used on the page); values are the display names on the recap screen.
const BOWLERS = Object.freeze({ cha: "Charlie", van: "Vanessa" });
const BOWLER_KEYS = Object.freeze(Object.keys(BOWLERS));

const GAMES_PER_SERIES = 3;
const MAX_GAME = 300;
const MAX_NOTE = 200;
const SOURCES = Object.freeze(["manual", "photo"]);

const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
// Base64 inflates by 4/3; the browser downsizes to ~1600px JPEG (~300-600KB)
// so this cap only bites on a client that skipped that step. Vercel's own
// request-body ceiling is 4.5MB.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Bowling balls. Weights are whole pounds, the range every pro shop sells.
// Colour is cosmetic (it paints the ball on the page), so a bad one falls
// back to the default instead of failing the save. Keep the default in
// sync with DEFAULT_BALL_COLOR in src/Pages/Bowler/balls.js.
const MAX_BALL_NAME = 40;
const MIN_BALL_WEIGHT = 6;
const MAX_BALL_WEIGHT = 16;
const DEFAULT_BALL_COLOR = "#1f5fd1";
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** A real calendar date in YYYY-MM-DD, not in the (far) future. */
function isValidDate(value, now = new Date()) {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== value) return false; // e.g. 2026-02-31
  if (+m[1] < 2000) return false;
  // One day of slack so a late-night entry in Toronto isn't "the future" in UTC.
  const tomorrow = now.getTime() + 24 * 60 * 60 * 1000;
  return d.getTime() <= tomorrow;
}

function isValidGame(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_GAME;
}

const isPositiveId = (n) => Number.isInteger(n) && n > 0;

/** A ball id, null for "not tracked", or undefined when it's garbage. */
function cleanBallId(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return isPositiveId(n) ? n : undefined;
}

/**
 * Validate one bowler's series from a save request. `balls` is optional
 * (one id or null per game); leaving it out means no ball was tracked.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "Each entry needs a bowler and three games." };
  }
  if (!BOWLER_KEYS.includes(entry.bowler)) {
    return { ok: false, error: "Unknown bowler." };
  }
  const games = Array.isArray(entry.games) ? entry.games.map(Number) : [];
  if (games.length !== GAMES_PER_SERIES || !games.every(isValidGame)) {
    return {
      ok: false,
      error: `${BOWLERS[entry.bowler]} needs ${GAMES_PER_SERIES} games, each a whole number from 0 to ${MAX_GAME}.`,
    };
  }
  const rawBalls = entry.balls === undefined || entry.balls === null ? [] : entry.balls;
  const balls = Array.isArray(rawBalls)
    ? Array.from({ length: GAMES_PER_SERIES }, (_, i) => cleanBallId(rawBalls[i]))
    : [undefined];
  if (rawBalls.length > GAMES_PER_SERIES || balls.includes(undefined)) {
    return { ok: false, error: `${BOWLERS[entry.bowler]}'s ball pick didn't come through. Pick it again.` };
  }
  return { ok: true, value: { bowler: entry.bowler, games, balls } };
}

/** Every distinct ball id a validated save refers to. */
function referencedBalls(entries) {
  return [...new Set(entries.flatMap((e) => e.balls).filter((id) => id !== null))];
}

/**
 * Validate a ball from the bag form. `id` present = edit, absent = new.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateBall(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Missing ball." };
  }
  const id = raw.id === undefined || raw.id === null ? null : Number(raw.id);
  if (id !== null && !isPositiveId(id)) {
    return { ok: false, error: "Unknown ball." };
  }
  if (!BOWLER_KEYS.includes(raw.owner)) {
    return { ok: false, error: "Pick whose bag it goes in." };
  }
  const name =
    typeof raw.name === "string"
      ? raw.name.trim().replace(/\s+/g, " ").slice(0, MAX_BALL_NAME)
      : "";
  if (!name) {
    return { ok: false, error: "Give the ball a name." };
  }
  let weight = null;
  if (raw.weight !== undefined && raw.weight !== null && raw.weight !== "") {
    weight = Number(raw.weight);
    if (!Number.isInteger(weight) || weight < MIN_BALL_WEIGHT || weight > MAX_BALL_WEIGHT) {
      return {
        ok: false,
        error: `Weight is whole pounds, ${MIN_BALL_WEIGHT} to ${MAX_BALL_WEIGHT}.`,
      };
    }
  }
  const color =
    typeof raw.color === "string" && COLOR_RE.test(raw.color)
      ? raw.color.toLowerCase()
      : DEFAULT_BALL_COLOR;
  return {
    ok: true,
    value: { id, owner: raw.owner, name, weight, color, retired: raw.retired === true },
  };
}

/**
 * Validate a whole save request: one date, 1-2 bowler entries (one each).
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateSave(body, now = new Date()) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Missing request body." };
  }
  if (!isValidDate(body.bowledOn, now)) {
    return { ok: false, error: "Pick a valid league night date (not in the future)." };
  }
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (rawEntries.length < 1 || rawEntries.length > BOWLER_KEYS.length) {
    return { ok: false, error: "Add scores for at least one bowler." };
  }

  const entries = [];
  for (const raw of rawEntries) {
    const result = validateEntry(raw);
    if (!result.ok) return result;
    if (entries.some((e) => e.bowler === result.value.bowler)) {
      return { ok: false, error: "Each bowler can only appear once per night." };
    }
    entries.push(result.value);
  }

  const source = SOURCES.includes(body.source) ? body.source : "manual";
  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) || null : null;

  return { ok: true, value: { bowledOn: body.bowledOn, entries, source, note } };
}

/**
 * Validate an uploaded scoreboard photo (base64, no data: prefix).
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateImage(body) {
  const mediaType = body && body.mediaType;
  const image = body && body.image;
  if (!IMAGE_TYPES.includes(mediaType)) {
    return { ok: false, error: "Upload a JPEG, PNG or WebP photo." };
  }
  if (typeof image !== "string" || image.length < 100 || !BASE64_RE.test(image)) {
    return { ok: false, error: "That photo didn't come through. Try again." };
  }
  const bytes = Math.floor((image.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: "That photo is too large. Try a smaller one." };
  }
  return { ok: true, value: { image, mediaType } };
}

/** Map a name as printed on the scoreboard to a tracked bowler key, or null. */
function matchBowler(name) {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase();
  if (n.startsWith("charl") || n === "cha") return "cha";
  if (n.startsWith("van") || n === "nessa") return "van";
  return null;
}

function cleanGame(value) {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return isValidGame(n) ? n : null;
}

/**
 * Normalize the vision model's structured output into what the review form
 * shows. Never throws; garbage in yields an empty, clearly-flagged result.
 * `mismatch` is true when the three games don't add up to the row total the
 * screen printed — a cheap self-check on the read.
 */
function sanitizeParse(raw) {
  const rows = raw && Array.isArray(raw.bowlers) ? raw.bowlers.slice(0, 12) : [];
  const bowlers = rows
    .filter((r) => r && typeof r.name === "string" && r.name.trim())
    .map((r) => {
      const games = Array.from({ length: GAMES_PER_SERIES }, (_, i) =>
        cleanGame(Array.isArray(r.games) ? r.games[i] : null)
      );
      const total = Number.isInteger(r.total) ? r.total : null;
      const complete = games.every((g) => g !== null);
      const sum = complete ? games.reduce((a, b) => a + b, 0) : null;
      return {
        name: r.name.trim().slice(0, 40),
        key: matchBowler(r.name),
        games,
        total,
        mismatch: complete && total !== null && sum !== total,
      };
    });

  const team =
    raw && typeof raw.team === "string" && raw.team.trim()
      ? raw.team.trim().slice(0, 60)
      : null;

  return { team, bowlers, readable: bowlers.length > 0 };
}

module.exports = {
  BOWLERS,
  BOWLER_KEYS,
  GAMES_PER_SERIES,
  MAX_GAME,
  isValidDate,
  validateEntry,
  referencedBalls,
  validateBall,
  validateSave,
  validateImage,
  matchBowler,
  sanitizeParse,
};
