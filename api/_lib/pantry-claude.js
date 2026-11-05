// Claude for /pantry: reads receipt photos into pantry items, and suggests
// recipes from what's in stock. NOT an endpoint.
//
// Both return the model's raw JSON; the caller always runs it through
// pantry-normalize.js (sanitizeRead / sanitizeRecipes). A receipt read is
// never saved directly either: the household reviews every line first, so a
// misread costs a correction, never bad stock.
//
// Env: ANTHROPIC_API_KEY (server-side only). Unset → 503 with a code the
// page uses to offer typing the receipt in instead.
const Anthropic = require("@anthropic-ai/sdk");
const { HttpError } = require("./budget-auth");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — the calls below degrade to a 503 */
  }
}

// Haiku 5.5: a receipt is transcription plus a little judgment, and at
// $0.10 / $0.50 per million tokens it costs a fortieth of Opus 5.5.
// PANTRY_MODEL swaps in a bigger model if its reads aren't good enough.
const MODEL = process.env.PANTRY_MODEL || "claude-haiku-5-5";
// Haiku has no server-side fallback. On a bigger model, a policy decline
// (very unlikely here) reruns on a fallback model instead of failing.
const FALLBACK = /haiku/.test(MODEL)
  ? {}
  : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
// Known items sent with a receipt, so the model can match "NN 2% MLK 4L" to
// the "Milk 2%" already on the shelf. Plenty for a household.
const MAX_KNOWN = 400;

const CATEGORY_ENUM = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "bakery",
  "pantry",
  "frozen",
  "snacks",
  "drinks",
  "household",
  "other",
];
const LOCATION_ENUM = ["fridge", "freezer", "pantry", "counter", "home"];

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store", "purchasedOn", "totalCents", "lines"],
  properties: {
    store: nullable({ type: "string" }),
    purchasedOn: nullable({ type: "string" }),
    totalCents: nullable({ type: "integer" }),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "raw",
          "name",
          "matchId",
          "category",
          "location",
          "qty",
          "size",
          "priceCents",
          "shelfDays",
          "keep",
        ],
        properties: {
          raw: { type: "string" },
          name: { type: "string" },
          matchId: nullable({ type: "integer" }),
          category: { type: "string", enum: CATEGORY_ENUM },
          location: { type: "string", enum: LOCATION_ENUM },
          qty: { type: "number" },
          size: nullable({ type: "string" }),
          priceCents: nullable({ type: "integer" }),
          shelfDays: nullable({ type: "integer" }),
          keep: { type: "boolean" },
        },
      },
    },
  },
};

const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recipes"],
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "blurb", "minutes", "servings", "uses", "missing", "steps", "tags"],
        properties: {
          title: { type: "string" },
          blurb: { type: "string" },
          minutes: { type: "integer" },
          servings: { type: "integer" },
          uses: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["itemId", "amount"],
              properties: {
                itemId: { type: "integer" },
                amount: { type: "string" },
              },
            },
          },
          missing: { type: "array", items: { type: "string" } },
          steps: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

function receiptPrompt(known, photoCount, today) {
  const intro =
    photoCount > 1
      ? `These ${photoCount} phone photos are one grocery receipt, in order from top to bottom. A long receipt is split across them and the photos may overlap, so never count a line twice.`
      : "This phone photo is a grocery receipt.";
  const table = known.length
    ? known.map((i) => `${i.id} | ${i.name}`).join("\n")
    : "(none yet: this is the first receipt)";
  return `${intro}

Read every purchased line and turn it into a pantry item:
- raw: the item description exactly as printed, without the price or tax codes.
- name: the short plain name someone would use at home, in sentence case. Expand the abbreviations and drop brand names unless the brand is the product. For example "PC BLK BEANS 540ML" is "Black beans (canned)" and "NN 2% MLK 4L" is "Milk 2%".
- matchId: if the line is the same product as one of the household's known items below, that item's id, otherwise null. Match on what the thing is, not the wording: "Large eggs 12pk" matches "Eggs".
- category, and location: where it's kept at home. Use "home" for household supplies that aren't food, such as paper towels or dish soap.
- qty: how many packages were bought. A "2 @ 1.99" line is 2. Weighed produce is 1.
- size: the package size if it's printed ("540 mL", "4 L", "0.62 kg"), otherwise null.
- priceCents: what the line cost in cents, after any discount on it. Null if you can't read it.
- shelfDays: roughly how many days it stays good at home from purchase, where it's kept: milk 10, sliced bread 5, bananas 5, raw chicken 2, canned goods 730. Null for things that don't spoil, like dish soap.
- keep: false for lines that aren't stock: bag fees, deposits, bottle returns, gift cards, lottery. True otherwise.

Fold a discount or coupon line into the item it applies to instead of listing it. Also give the store name, the purchase date as YYYY-MM-DD and the receipt's total in cents, each null if it isn't visible. Today is ${today}, and the shopping was almost always in the last few days: when a printed date could be read two ways ("11/03/26" is March 11 or November 3), pick the reading on or just before today, never one in the future. Never invent a line you can't see. If a description is only partly legible, keep what you can read in raw and give your best plain name. If the photos aren't a receipt, return no lines.

Known items (id | name):
${table}`;
}

function recipePrompt(stock, ask, today) {
  const rows = stock.map((i) => {
    const notes = [];
    if (i.status.expired) notes.push("past its usual shelf life, check it");
    else if (i.status.useSoon) notes.push("use soon");
    if (i.status.state === "low") notes.push("running low");
    return `${i.id} | ${i.name} | ${i.qty < 1 ? "a little" : i.qty} | ${notes.join(", ")}`;
  });
  const request = ask
    ? `\nThey asked for: "${ask}". Treat it as a preference about what to cook.`
    : "";
  return `Today is ${today}. Suggest 4 recipes we can cook mostly from what's in our kitchen right now.

- Lean on what we have. Each recipe should need at most 3 things we don't have, not counting water, salt, pepper and cooking oil (assume we have those).
- Prefer recipes that use the things marked "use soon", and put those recipes first.
- Vary them: different cuisines and methods, not four pastas.
- uses: the stock items the recipe uses, by id, each with a short amount ("2 cups", "half").
- missing: anything else it needs, as plain shopping-list names.
- blurb: one sentence on why it's a good pick tonight.
- steps: short and concrete, like a recipe card.
- tags: a few words such as "vegetarian", "one pan", "30 min".${request}

In stock (id | name | packs | notes):
${rows.join("\n")}`;
}

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** One structured call with Bowler's error mapping. `opts.client` is for tests. */
async function structuredCall({ content, schema, effort, label }, opts = {}) {
  if (!opts.client && !process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, {
      error: "Claude isn't set up yet, so this has to be typed in for now.",
      code: "claude_unconfigured",
    });
  }
  const api = opts.client || getClient();
  const unreadable = label === "receipt" ? "Couldn't read that receipt. Try a sharper, flatter photo." : "Couldn't come up with recipes just now. Try again.";

  let response;
  try {
    response = await api.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort, format: { type: "json_schema", schema } },
      ...FALLBACK,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, { error: "Claude is busy. Try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error(`Pantry ${label} bad request:`, err.message);
      throw new HttpError(422, { error: unreadable });
    }
    console.error(`Pantry ${label} error:`, err);
    throw new HttpError(502, { error: "Claude is unavailable right now. Try again shortly." });
  }

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    throw new HttpError(422, { error: unreadable });
  }
  const text = response.content.find((b) => b.type === "text");
  try {
    return JSON.parse(text ? text.text : "");
  } catch (_) {
    throw new HttpError(422, { error: unreadable });
  }
}

/**
 * @param {{ image: string, mediaType: string }[]} photos pre-validated, top to bottom
 * @param {{ id: number, name: string }[]} known items to match against
 * @param {string} today YYYY-MM-DD, to settle day/month order
 */
function readReceipt(photos, known, today, opts) {
  const content = [
    ...photos.map((p) => ({
      type: "image",
      source: { type: "base64", media_type: p.mediaType, data: p.image },
    })),
    { type: "text", text: receiptPrompt(known.slice(0, MAX_KNOWN), photos.length, today) },
  ];
  // Expanding receipt shorthand takes a little judgment: medium, not low.
  return structuredCall({ content, schema: RECEIPT_SCHEMA, effort: "medium", label: "receipt" }, opts);
}

/**
 * @param {object[]} stock items with .status, qty > 0
 * @param {string} ask the household's request, may be empty
 */
function suggestRecipes(stock, ask, today, opts) {
  const content = [{ type: "text", text: recipePrompt(stock, ask, today) }];
  return structuredCall({ content, schema: RECIPE_SCHEMA, effort: "medium", label: "recipes" }, opts);
}

module.exports = { MODEL, readReceipt, suggestRecipes, receiptPrompt, recipePrompt };
