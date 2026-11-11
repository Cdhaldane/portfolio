// Reads bowling-alley screen photos with Claude vision and returns the raw
// structured read. NOT an endpoint. The caller always runs the result
// through bowler-normalize.js (sanitizeParse / sanitizeFrames) and the user
// always reviews it before anything is saved, so a misread costs a
// correction, never bad data.
//
// Two screens:
//   readScoreboard  the league recap sheet: three game totals per bowler
//   readFrames      the overhead score screen: one game, ball by ball
//
// Env: ANTHROPIC_API_KEY (server-side only). Unset → 503, and the page falls
// back to typing scores in.
const Anthropic = require("@anthropic-ai/sdk");
const { HttpError } = require("./budget-auth");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — the reads degrade to a 503 below */
  }
}

const MODEL = "claude-opus-5-5";

const nullableInt = { anyOf: [{ type: "integer" }, { type: "null" }] };

const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["team", "bowlers"],
  properties: {
    team: { anyOf: [{ type: "string" }, { type: "null" }] },
    bowlers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "games", "total"],
        properties: {
          name: { type: "string" },
          games: { type: "array", items: nullableInt },
          total: nullableInt,
        },
      },
    },
  },
};

const RECAP_PROMPT = `This is a phone photo of a bowling alley scoreboard showing a league recap sheet (often a TV screen, possibly at an angle, with glare).

Extract every bowler row:
- name: exactly as printed
- games: the scratch score for each game column in order (1st, 2nd, 3rd). Use null for a game you cannot read with confidence. Never guess.
- total: the row's printed series total, or null if not visible.

Ignore team rows such as Pins, +HDCP and Totals, and ignore empty rows. Set team to the team name if one is shown, else null. If this is not a bowling scoreboard, return an empty bowlers array.`;

// Every mark a scoring screen prints for one ball. Splits are usually a
// circled or coloured number; the number is all we need.
const MARKS = ["X", "/", "-", "G", "F", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

const FRAMES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bowlers"],
  properties: {
    bowlers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "frames", "total"],
        properties: {
          name: { type: "string" },
          frames: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["marks", "running"],
              properties: {
                marks: { type: "array", items: { type: "string", enum: MARKS } },
                running: nullableInt,
              },
            },
          },
          total: nullableInt,
        },
      },
    },
  },
};

const FRAMES_PROMPT = `This is a phone photo of a bowling alley's overhead scoring screen, showing one game frame by frame for one or more bowlers (possibly at an angle, with glare).

For every bowler row:
- name: exactly as printed.
- frames: one entry per frame that has at least one ball in it, starting at frame 1, in order. Leave out frames nobody has bowled yet.
  - marks: each ball in that frame as printed: "X" for a strike, "/" for a spare, "-" for a miss or gutter, "F" for a foul, otherwise the number of pins. A split is usually shown as a circled or coloured number; give just the number. The 10th frame can have up to three marks.
  - running: the cumulative score printed under that frame, or null if it's blank or you can't read it.
- total: the bowler's game total if the screen shows one, else null.

Never guess a mark. If you can't read a frame with confidence, stop that bowler's frames just before it. Ignore handicap, average and team total rows. If this isn't a bowling score screen, return an empty bowlers array.`;

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * One structured vision call. `opts.client` is for tests.
 * @throws {HttpError} 503 unconfigured, 422 unreadable, 429 busy, 502 upstream failure
 */
async function readPhoto({ image, mediaType }, prompt, schema, opts = {}) {
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, {
      error: "Photo reading isn't set up yet. Type the scores in instead.",
      code: "vision_unconfigured",
    });
  }

  let response;
  try {
    response = await (opts.client || getClient()).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A plain transcription job: low effort keeps it quick and cheap.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema },
      },
      // Route a (very unlikely) policy decline to a fallback model instead
      // of failing the read.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, { error: "The photo reader is busy. Try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("Bowler vision bad request:", err.message);
      throw new HttpError(422, { error: "Couldn't read that photo. Try another shot." });
    }
    console.error("Bowler vision error:", err);
    throw new HttpError(502, { error: "The photo reader is unavailable right now." });
  }

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    throw new HttpError(422, { error: "Couldn't read that photo. Try another shot." });
  }
  const text = response.content.find((b) => b.type === "text");
  try {
    return JSON.parse(text ? text.text : "");
  } catch (_) {
    throw new HttpError(422, { error: "Couldn't read that photo. Try another shot." });
  }
}

/** The league recap sheet. Returns the model's JSON (unsanitized). */
const readScoreboard = (photo, opts) => readPhoto(photo, RECAP_PROMPT, RECAP_SCHEMA, opts);

/** The overhead score screen, ball by ball. Returns the model's JSON (unsanitized). */
const readFrames = (photo, opts) => readPhoto(photo, FRAMES_PROMPT, FRAMES_SCHEMA, opts);

module.exports = { MODEL, MARKS, readScoreboard, readFrames };
