// A short write-up of one league night, by Claude. NOT an endpoint.
//
// The numbers are worked out here, with the page's own scoring rules
// (src/Pages/Bowler/scoring.js), and handed to the model as facts: it
// writes the sentences, it never counts. A recap is stored with a `basis`
// (a hash of the night as it was), so editing the night retires it.
//
// Env: ANTHROPIC_API_KEY. BOWLER_RECAP_MODEL swaps the model.
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { HttpError } = require("./budget-auth");
const { BOWLERS } = require("./bowler-normalize");
const { PINS, isSplit, frameMarks, playFrame } = require("../../src/Pages/Bowler/scoring");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — writeRecap degrades to a 503 below */
  }
}

// A few sentences from a page of facts: Haiku 5.5 does it well for a
// fraction of a cent. It has no server-side refusal fallback; a decline just
// means no recap this time.
const MODEL = process.env.BOWLER_RECAP_MODEL || "claude-haiku-5-5";
const MAX_HEADLINE = 80;
const MAX_STORY = 600;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round1 = (n) => Math.round(n * 10) / 10;

/** A stable fingerprint of one night's rows: what a recap was written from. */
function recapBasis(rows) {
  const shape = rows
    .slice()
    .sort((a, b) => (a.bowler < b.bowler ? -1 : 1))
    .map((r) => [r.bowler, r.games, r.frames || null, r.lanes || null, r.balls || null, r.note || null]);
  return crypto.createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

/** Frame-level facts for one game, or null when it was entered as a score. */
function gameFacts(frames) {
  if (!frames) return null;
  let strikes = 0;
  let strikeChances = 0;
  let spares = 0;
  let spareChances = 0;
  let opens = 0;
  let splits = 0;
  let run = 0;
  let bestRun = 0;
  const missed = [];
  frames.forEach((frame, i) => {
    const { shots } = playFrame(frame, i);
    if (frame.rolls[0] !== PINS && frame.rolls[0] + frame.rolls[1] < PINS) opens += 1;
    shots.forEach((shot, k) => {
      if (!shot.rack.fresh) return;
      strikeChances += 1;
      if (shot.down === PINS) {
        strikes += 1;
        run += 1;
        bestRun = Math.max(bestRun, run);
        return;
      }
      run = 0;
      const pins = shot.left.pins;
      if (pins && isSplit(pins)) splits += 1;
      const attempt = shots[k + 1];
      if (!attempt) return;
      spareChances += 1;
      if (attempt.left.count === 0) spares += 1;
      else if (pins) missed.push(pins.join("-"));
    });
  });
  return {
    marks: frames.map((f, i) => frameMarks(f, i).map((m) => m.mark).join("")).join(" "),
    strikes: `${strikes} of ${strikeChances}`,
    spares: `${spares} of ${spareChances}`,
    openFrames: opens,
    splits,
    longestStrikeRun: bestRun,
    sparesMissed: missed,
  };
}

/**
 * The facts for one night, as plain data. `all` is every saved row
 * (API-shaped, any order), `ballNames` maps ball id → name.
 */
function nightFacts(date, all, ballNames = new Map()) {
  const tonight = all.filter((r) => r.bowledOn === date);
  const bowlers = tonight.map((row) => {
    const before = all.filter((r) => r.bowler === row.bowler && r.bowledOn < date);
    const games = before.flatMap((r) => r.games);
    const series = sum(row.games);
    const frames = Array.isArray(row.frames) ? row.frames : [null, null, null];
    const lanes = Array.isArray(row.lanes) ? row.lanes : [null, null, null];
    const balls = Array.isArray(row.balls) ? row.balls : [null, null, null];
    return {
      key: row.bowler,
      name: BOWLERS[row.bowler],
      games: row.games,
      series,
      averageBefore: games.length ? round1(sum(games) / games.length) : null,
      tonightAverage: round1(series / row.games.length),
      nightsBefore: before.length,
      highGameBefore: games.length ? Math.max(...games) : null,
      highSeriesBefore: before.length ? Math.max(...before.map((r) => sum(r.games))) : null,
      lanes: lanes.map((l) => (l === null ? null : `${l}-${l + 1}`)),
      balls: balls.map((id) => (id === null ? null : ballNames.get(id) || null)),
      frameByFrame: frames.map(gameFacts),
    };
  });

  const facts = { date, bowlers };
  if (bowlers.length === 2) {
    const [a, b] = bowlers;
    facts.headToHead = {
      games: a.games.map((g, i) => (g === b.games[i] ? "tie" : g > b.games[i] ? a.name : b.name)),
      series: a.series === b.series ? "tie" : a.series > b.series ? a.name : b.name,
    };
  }
  const note = tonight.map((r) => r.note).find(Boolean);
  if (note) facts.theirNote = note;
  return facts;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "story"],
  properties: {
    headline: { type: "string" },
    story: { type: "string" },
  },
};

function recapPrompt(facts) {
  return `You write the two-line recap on a private league-night tracker that two bowlers, Charlie and Vanessa, keep for themselves. Here are the facts for one night, worked out from their scores.

Write:
- headline: 3 to 7 words, like a sports-page headline. No ending period.
- story: 2 or 3 sentences, at most 55 words. Lead with the most interesting thing: a personal best, a big swing from their average, a strike run, a tight head-to-head game, a spare that kept getting away. Use names. Be warm, a little wry, never mean.

Rules: only use numbers and facts given here; never invent a frame, pin or score. "averageBefore" is the average coming into the night (null on someone's first night). In "marks", X is a strike, / a spare, - a miss. "sparesMissed" lists the pins left standing on each spare attempt that failed (for example "10" is the 10 pin). "theirNote" is a note one of them typed; use it only if it adds something.

${JSON.stringify(facts, null, 1)}`;
}

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * @returns {Promise<{ headline: string, story: string, model: string }>}
 * @throws {HttpError} 503 unconfigured, 422 declined/garbled, 429 busy, 502 upstream
 */
async function writeRecap(facts, opts = {}) {
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, {
      error: "Recaps need Claude, and it isn't set up yet.",
      code: "claude_unconfigured",
    });
  }
  const fail = () => new HttpError(422, { error: "Couldn't write that recap. Try again." });

  let response;
  try {
    response = await (opts.client || getClient()).messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: recapPrompt(facts) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, { error: "Claude is busy. Try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("Bowler recap bad request:", err.message);
      throw fail();
    }
    console.error("Bowler recap error:", err);
    throw new HttpError(502, { error: "Claude is unavailable right now. Try again shortly." });
  }

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw fail();
  const text = response.content.find((b) => b.type === "text");
  let out;
  try {
    out = JSON.parse(text ? text.text : "");
  } catch (_) {
    throw fail();
  }
  const clean = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const headline = clean(out.headline, MAX_HEADLINE).replace(/[.]+$/, "");
  const story = clean(out.story, MAX_STORY);
  if (!headline || !story) throw fail();
  return { headline, story, model: MODEL };
}

module.exports = { MODEL, recapBasis, gameFacts, nightFacts, recapPrompt, writeRecap };
