// Reads a bowling-alley recap screen photo with Claude vision and returns
// the raw structured read. NOT an endpoint. The caller always runs the
// result through sanitizeParse() and the user always reviews it before
// anything is saved, so a misread costs a correction, never bad data.
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
    /* dotenv/file missing — readScoreboard degrades to a 503 below */
  }
}

const MODEL = "claude-opus-5";

const nullableInt = { anyOf: [{ type: "integer" }, { type: "null" }] };

const SCHEMA = {
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

const PROMPT = `This is a phone photo of a bowling alley scoreboard showing a league recap sheet (often a TV screen, possibly at an angle, with glare).

Extract every bowler row:
- name: exactly as printed
- games: the scratch score for each game column in order (1st, 2nd, 3rd). Use null for a game you cannot read with confidence. Never guess.
- total: the row's printed series total, or null if not visible.

Ignore team rows such as Pins, +HDCP and Totals, and ignore empty rows. Set team to the team name if one is shown, else null. If this is not a bowling scoreboard, return an empty bowlers array.`;

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * @param {{ image: string, mediaType: string }} photo base64 image, pre-validated
 * @returns {Promise<object>} the model's JSON (unsanitized)
 * @throws {HttpError} 503 unconfigured, 422 unreadable, 502 upstream failure
 */
async function readScoreboard({ image, mediaType }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, {
      error: "Photo reading isn't set up yet. Type the scores in instead.",
      code: "vision_unconfigured",
    });
  }

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A plain transcription job: low effort keeps it quick and cheap.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
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
            { type: "text", text: PROMPT },
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

module.exports = { readScoreboard };
