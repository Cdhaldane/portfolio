// Every Claude call Acta Diurna makes: the prompts, the request bodies, and
// thin wrappers for running them. NOT an endpoint.
//
// Two ways to run a request:
//   - batch (research, write, check, revise): submitted to the Message
//     Batches API and collected on a later pipeline pass. Batches take
//     minutes, cost half, and never hold a serverless function open, which
//     matters because writing a 3,000-word lesson can outlast Vercel's
//     function time limit. The Batches API rejects `fallbacks`, so batch
//     requests go without them.
//   - now (propose a season, swap a topic, answer a question): short enough
//     to run inside one request, with the server-side refusal fallback on.
//
// The request builders are pure and unit-tested; only the wrappers at the
// bottom touch the network.
const Anthropic = require("@anthropic-ai/sdk");
const { HttpError } = require("./budget-auth");
const { LESSON_SCHEMA, ERAS, KINDS } = require("./acta-lesson");
const { PRIMARY_DOMAINS } = require("./acta-sources");
const { SLOT_KINDS, WEEKS_PER_SEASON } = require("./acta-schedule");

if (!process.env.ANTHROPIC_API_KEY) {
  try {
    require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env.local") });
  } catch (_) {
    /* dotenv/file missing — configured() reports false */
  }
}

const MODEL = process.env.ACTA_MODEL || "claude-opus-5-5";
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const str = { type: "string" };
const int = { type: "integer" };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const TOPIC_SCHEMA = obj({
  kind: { type: "string", enum: KINDS },
  title: str,
  era: { type: "string", enum: ERAS },
  year: int,
  yearLabel: str,
  wiki: { type: "array", items: str },
  focus: str,
});

const SEASON_SCHEMA = obj({
  title: str,
  span: str,
  intro: str,
  weeks: { type: "array", items: obj({ theme: str, topics: { type: "array", items: TOPIC_SCHEMA } }) },
});

const PASSAGES_SCHEMA = obj({
  passages: {
    type: "array",
    items: obj({ citation: str, translator: nullable(str), url: str, excerpt: str }),
  },
});

const ISSUES_SCHEMA = obj({
  verdict: { type: "string", enum: ["pass", "fix"] },
  issues: {
    type: "array",
    items: obj({
      card: int,
      severity: { type: "string", enum: ["error", "warn"] },
      claim: str,
      problem: str,
      fix: str,
    }),
  },
});

const format = (schema) => ({ type: "json_schema", schema });

// ---------------------------------------------------------------------------
// Prompts

const PLANNER_SYSTEM = `You plan seasons for Acta Diurna, a daily history lesson read on a phone. One lesson a day, about 15 minutes each.

A season is ${WEEKS_PER_SEASON} weeks. Each week has six lessons in a fixed rhythm:
- Monday: a person
- Tuesday: a place
- Wednesday: a moment (a battle, a speech, a disaster; one day or one year)
- Thursday: an idea
- Friday: an object
- Saturday: meanwhile (the same years somewhere else in the world, outside the season's main region)
Sunday is review, with no lesson.

The reader is a curious adult who wants to get smarter. They love ancient Greece and Rome, which should be about 40% of all seasons, but they want all of history, everywhere.

Rules:
- Give each week a theme. Move forward through time loosely, week by week, so each lesson can build on the last.
- Prefer topics with a strong story and real consequences. Mix the famous with the surprising.
- Never repeat a topic from PAST TOPICS.
- title: short and specific ("Salamis, 480 BC", "Themistocles", "The trireme").
- wiki: one or two exact English Wikipedia article titles that cover the topic in depth. The lesson will be written only from these articles, so pick substantial ones. Use real article titles.
- era: one of ${ERAS.join(", ")}. It sets the visual style: ancient (Egypt, Mesopotamia, Bronze Age), greece, rome, byzantine (late antiquity), medieval (Europe and the Islamic world), east (China, Japan, Korea, India, Southeast Asia), renaissance (and the age of sail), revolutions (1750 to 1850), industrial (1850 to 1914), modern (1914 on).
- year: integer, negative for BC, the year that anchors the topic. yearLabel: how to show it ("480 BC", "c. 1450", "1914").
- focus: one or two sentences on the angle the lesson should take and the tension it turns on.`;

const RESEARCH_SYSTEM = `You find primary-source passages for a history lesson that will quote them word for word.

Search and fetch only the allowed sites. Find 2 to 5 passages that a lesson could quote: an eyewitness account, a famous speech, a vivid detail, a document's key lines. Each passage must be 40 to 150 words of an English translation that is public domain or openly licensed (or an original English text), from a primary source: a writer who lived at the time or close to it, not a modern historian.

The excerpt must be copied exactly from the page you fetched, character for character, with no omissions or edits. It will be checked word for word against that page, and anything that doesn't match is thrown away. Give the citation (author, work, and book/chapter/section), the translator if the page names one, and the exact URL of the page that contains the excerpt.

If you can't find good passages, return an empty list. Don't stretch.`;

const WRITER_SYSTEM = `You write the daily lesson for Acta Diurna, a history page read on a phone: one lesson a day, about 15 minutes, swiped one card per screen like a feed. The reader is a curious, smart adult who isn't a historian and wants to come away knowing more. Accuracy beats drama every time, and the story still has to be good.

## What you're given
- TOPIC: the subject, its kind (person, place, moment, idea, object or meanwhile), its era, and the angle to take.
- ARTICLES: Wikipedia articles as plain text. IMAGES: the files you may use, with captions. PASSAGES: primary-source excerpts already verified word for word against the page they come from.
- PREVIOUS LESSONS the reader has had, and TOMORROW's topic.

## The rule that overrides everything
Every fact you state must be supported by the ARTICLES or PASSAGES. Don't add dates, numbers, names, places or causes from memory, even ones you're sure of. If the sources don't have it, leave it out. When ancient writers give a figure (army sizes, ages, casualties), attribute it ("Herodotus says…") and give the modern estimate when the sources have one. When a date is uncertain or traditional, say so ("about", "traditionally"). A fact-checker will check every card against the same sources and send back anything unsupported.

## Shape of the lesson: 24 to 30 cards, in this order
1. open: the cold open. A scene in the present tense at the moment of greatest tension, 40 to 80 words, with the best painting or photograph available (not a map). title is the lesson title. label names the kind, e.g. "A moment".
2. where: where and when. A place photo or map, 30 to 70 words placing it on the map and in time, plus pins: 4 to 6 well-known events with their years across the surrounding centuries, including this topic's own year. Only dates the sources give or that are textbook-standard.
3. Story chapters: 10 to 15 cards in 3 or 4 chapters, told in order. Set chapter to "I", "II", "III", "IV" and label to the chapter name ("I · The silver"); every card in a chapter repeats its label. Each card makes one move in the story: concrete people making choices, not abstractions.
   Mix these in where they fit the story:
   - quote: 1 or 2 primary-source cards. quote.text must be copied exactly from a PASSAGE (set quote.passage to its id) or from a quotation inside an article that names its author. Never paraphrase inside a quote, never translate one yourself, never present a modern paraphrase as ancient words. If nothing suitable exists, skip quote cards and describe the source in a story card instead. text may hold one sentence of context.
   - aside: 1 or 2 side characters or details that enrich the story. label "Aside · Name".
   - numbers: one card with 3 to 5 rows. value is short ("378", "600–800"), label is one line. Put ancient figures next to modern estimates where the sources give both.
   - recall: two questions, one after chapter II and one after chapter III.
4. disagree: the real debate among historians. Two sides of 30 to 60 words, each the strongest version of itself. Name a historian only if the sources name them.
5. ripple: two cards. What changed because of it, and something you can still see or visit today.
6. recall: three final questions.
Don't write a closing card. The page builds one from takeaways and teaser.

## Card rules
- Plain, vivid English. Short sentences, active voice. No filler words like "fascinating" or "remarkable", no "little did they know", no strings of rhetorical questions, no em-dash asides.
- text holds at most 140 words, or 90 when the card has an image. Separate paragraphs with a blank line. A card is one phone screen; if it's crowded, split it into two cards.
- title: 2 to 6 words, specific ("A message in the night", not "The plan").
- recall: q asks why or how, not trivia. a is one to three sentences. Leave text null.
- Images: 6 to 10 cards with images. Use each file once, and only files from IMAGES, spelled exactly. Paintings and photographs for scenes; maps only for the where card. alt describes the picture for someone who can't see it. focus is the CSS object-position that keeps the subject in frame on a tall phone crop ("50% 30%"), or null.
- src: ids of the sources that support the card. Make a source entry for each article ("wiki-1", "wiki-2", with its URL), for each PASSAGE you use (its id, citation and URL), and for each ancient work the articles cite that a card relies on (e.g. id "hdt-8.75", label "Herodotus, Histories 8.75", url null).
- Write for the kind. A person lesson turns on the choice that defined them. A place lesson shows why it mattered and what's there now. A moment lesson covers the hours that decided it. An idea lesson covers where it came from, how it worked and what it became. An object lesson is about the thing itself and the world around it. A meanwhile lesson takes the reader somewhere else in the same years and ties it back to what they've been learning.
- If a previous lesson connects, mention it naturally once ("You met Themistocles on Monday") and put its slug in links.

## Other fields
title; subtitle (a date or span, e.g. "September 480 BC"); summary (one sentence for the archive); year (integer, negative for BC); yearLabel ("480 BC"); place; takeaways (exactly three, one sentence each: the things to remember); teaser (one intriguing sentence about tomorrow's topic without spoiling it, or null when there is no tomorrow); links; sources; cards; mentions.

## Mentions
The reader can tap a person or place named in the cards to see Wikipedia's summary of them. List the ones worth a tap, usually 10 to 20: the people who act in the story, the ancient writers it relies on, and the cities, regions and sites it moves through. For each:
- wiki: the exact title of the English Wikipedia article about that specific person or place. Pick the article, not a disambiguation page or a namesake: "Xerxes I", not "Xerxes"; "Salamis Island" for the island, not "Battle of Salamis"; "Leonidas I", not "Leonidas". The reader sees whatever that article says, so a wrong title shows them the wrong thing.
- kind: person or place.
- names: the name exactly as the cards' text spells it, plus any other spelling the cards use ("Xerxes", "Xerxes I"). Only names that appear in text or in a disagree side, not in titles or quotes.
Leave out the lesson's own subject, and any person or place you aren't sure has its own article.`;

const CHECKER_SYSTEM = `You are the fact-checker for Acta Diurna, a daily history lesson published to the public. You get the lesson as numbered cards and the SOURCES it was written from. Catch anything a careful historian would object to before it goes out.

Check every card:
- Each specific claim (a date or year, a number, a name, a place, a title, who did what, cause and effect stated as fact, who said or reported something) must be supported by the SOURCES. If the sources contradict it or don't support it, report an "error".
- Quotes: the words must match a source exactly, and the attribution must be right.
- Pins on the where card: every year must be correct.
- Recall answers must be correct and supported.
- Ancient figures the sources treat as uncertain must be attributed, not stated as fact.
- Report a "warn" for misleading emphasis, an uncertain date presented as certain, a live debate presented as settled, or wording a specialist would wince at without it being false.

Don't report style, length or structure. Don't flag uncontroversial background (that Athens is in Greece). Don't invent problems: if a card is fine, say nothing about it.

For each issue give the card number, the exact claim, what's wrong according to the sources, and a concrete fix: the corrected wording, or "remove". verdict is "pass" when there are no errors, otherwise "fix".`;

const ASK_SYSTEM = `You answer a reader's follow-up question about today's lesson on Acta Diurna, a daily history page. Answer in at most 110 words, plainly, the way a good historian talks to a curious friend. Use the lesson and its SOURCES. If they don't cover the question, say so in one short sentence, then give only what is well established and mark it as going beyond the lesson's sources. No lists, no headings, no preamble.`;

// ---------------------------------------------------------------------------
// Content blocks

const esc = (s) => String(s == null ? "" : s).replace(/"/g, "'");

function articlesBlock(sources) {
  const arts = (sources && sources.articles) || [];
  return `<articles>\n${arts
    .map((a, i) => `<article id="wiki-${i + 1}" title="${esc(a.title)}" url="${esc(a.url)}">\n${a.text}\n</article>`)
    .join("\n")}\n</articles>`;
}

function imagesBlock(sources) {
  const media = (sources && sources.media) || [];
  return `<images>\n${media.map((m) => `${m.file}${m.caption ? ` | ${m.caption}` : ""}`).join("\n")}\n</images>`;
}

function passagesBlock(sources) {
  const ps = (sources && sources.passages) || [];
  if (!ps.length) return "<passages>\n(none verified)\n</passages>";
  return `<passages>\n${ps
    .map(
      (p) =>
        `<passage id="${p.id}" citation="${esc(p.citation)}"${p.translator ? ` translator="${esc(p.translator)}"` : ""} url="${esc(p.url)}">\n${p.excerpt}\n</passage>`
    )
    .join("\n")}\n</passages>`;
}

function topicBlock(topic) {
  return `<topic>\ntitle: ${topic.title}\nkind: ${topic.kind}\nera: ${topic.era}\nyear: ${topic.yearLabel || topic.year}\nangle: ${topic.focus || "(none given)"}\n</topic>`;
}

function contextBlock({ previous = [], tomorrow = null }) {
  const prev = previous.length
    ? previous.map((p) => `${p.slug} | ${p.title} (${p.kind}, ${p.yearLabel || p.year})`).join("\n")
    : "(this is the first lesson)";
  const next = tomorrow ? `${tomorrow.title} (${tomorrow.kind}). ${tomorrow.focus || ""}`.trim() : "(none scheduled)";
  return `<previous_lessons>\n${prev}\n</previous_lessons>\n<tomorrow>\n${next}\n</tomorrow>`;
}

/** The lesson as the checker reads it: numbered from 1, without image plumbing. */
function lessonForReview(lesson) {
  const cards = lesson.cards.map((c, i) => {
    const { image, id, ...rest } = c;
    return { n: i + 1, ...rest, ...(image ? { image: image.file } : {}) };
  });
  return JSON.stringify(
    {
      title: lesson.title,
      subtitle: lesson.subtitle,
      year: lesson.year,
      yearLabel: lesson.yearLabel,
      place: lesson.place,
      takeaways: lesson.takeaways,
      sources: lesson.sources,
      cards,
    },
    null,
    1
  );
}

// ---------------------------------------------------------------------------
// Request builders (pure)

function researchParams(topic, sources) {
  const lead = ((sources && sources.articles) || [])
    .map((a) => `${a.title}: ${a.text.slice(0, 2500)}`)
    .join("\n\n");
  return {
    model: MODEL,
    max_tokens: 16000,
    system: RESEARCH_SYSTEM,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4, allowed_domains: PRIMARY_DOMAINS },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, allowed_domains: PRIMARY_DOMAINS },
    ],
    output_config: { effort: "medium", format: format(PASSAGES_SCHEMA) },
    messages: [
      {
        role: "user",
        content: `${topicBlock(topic)}\n\nWhat the lesson will draw on:\n${lead}\n\nFind primary-source passages for this lesson.`,
      },
    ],
  };
}

function writeParams(topic, sources, context) {
  return {
    model: MODEL,
    max_tokens: 48000,
    system: [{ type: "text", text: WRITER_SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "high", format: format(LESSON_SCHEMA) },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${articlesBlock(sources)}\n\n${imagesBlock(sources)}\n\n${passagesBlock(sources)}` },
          { type: "text", text: `${topicBlock(topic)}\n\n${contextBlock(context)}\n\nWrite the lesson.` },
        ],
      },
    ],
  };
}

function checkParams(lesson, sources) {
  return {
    model: MODEL,
    max_tokens: 24000,
    system: [{ type: "text", text: CHECKER_SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "high", format: format(ISSUES_SCHEMA) },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `<sources>\n${articlesBlock(sources)}\n\n${passagesBlock(sources)}\n</sources>` },
          { type: "text", text: `<lesson>\n${lessonForReview(lesson)}\n</lesson>\n\nCheck the lesson.` },
        ],
      },
    ],
  };
}

function reviseParams(topic, sources, context, lesson, issues) {
  const list = issues
    .map((p) => `- ${p.card ? `Card ${p.card}: ` : ""}${p.claim ? `"${p.claim}". ` : ""}${p.problem || p.message}${p.fix ? ` Fix: ${p.fix}` : ""}`)
    .join("\n");
  return {
    ...writeParams(topic, sources, context),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${articlesBlock(sources)}\n\n${imagesBlock(sources)}\n\n${passagesBlock(sources)}` },
          {
            type: "text",
            text: `${topicBlock(topic)}\n\n${contextBlock(context)}\n\n<draft>\n${lessonForReview(lesson)}\n</draft>\n\n<problems>\n${list}\n</problems>\n\nThis draft was sent back. Rewrite the whole lesson and fix every problem listed. Where a claim can't be supported by the sources, cut it or say less; don't swap in another unsupported claim. Keep everything that wasn't flagged as close to the draft as you can.`,
          },
        ],
      },
    ],
  };
}

function proposeParams({ number, hint, pastSeasons = [], pastTopics = [] }) {
  return {
    model: MODEL,
    max_tokens: 16000,
    system: PLANNER_SYSTEM,
    output_config: { effort: "high", format: format(SEASON_SCHEMA) },
    messages: [
      {
        role: "user",
        content: `<past_seasons>\n${pastSeasons.map((s) => `${s.number}. ${s.title} (${s.span})`).join("\n") || "(none)"}\n</past_seasons>\n<past_topics>\n${
          pastTopics.join("\n") || "(none)"
        }\n</past_topics>\n\nPlan season ${number}${hint ? `: ${hint}` : ""}. Five weeks, six topics a week in the order ${SLOT_KINDS.join(", ")}.`,
      },
    ],
  };
}

function swapParams({ season, topic, others, note }) {
  return {
    model: MODEL,
    max_tokens: 8000,
    system: PLANNER_SYSTEM,
    output_config: { effort: "medium", format: format(obj({ topic: TOPIC_SCHEMA })) },
    messages: [
      {
        role: "user",
        content: `Season: ${season.title} (${season.span}).\nThe other topics this season:\n${others.join("\n")}\n\nReplace this ${topic.kind} topic: "${topic.title}".${
          note ? `\nCharlie's note: ${note}` : ""
        }\nThe replacement must be a ${topic.kind}, fit the same week, and not repeat anything listed.`,
      },
    ],
  };
}

function askParams(lesson, card, sources, question) {
  return {
    model: MODEL,
    max_tokens: 2000,
    system: ASK_SYSTEM,
    output_config: { effort: "medium" },
    messages: [
      {
        role: "user",
        content: `<sources>\n${articlesBlock({ articles: ((sources && sources.articles) || []).map((a) => ({ ...a, text: a.text.slice(0, 30000) })) })}\n\n${passagesBlock(
          sources
        )}\n</sources>\n<lesson>\n${lessonForReview(lesson)}\n</lesson>\n<card>\n${JSON.stringify(card)}\n</card>\n\nQuestion: ${question}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Parsing

class ModelOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelOutputError";
  }
}

/** The JSON a structured-output response carries. Throws ModelOutputError when there isn't any. */
function jsonFrom(message) {
  if (!message) throw new ModelOutputError("No response.");
  if (message.stop_reason === "refusal") throw new ModelOutputError("Claude declined this one.");
  if (message.stop_reason === "max_tokens") throw new ModelOutputError("The response ran out of room.");
  if (message.stop_reason === "pause_turn") throw new ModelOutputError("The research ran out of steps.");
  const blocks = (message.content || []).filter((b) => b.type === "text");
  const text = blocks.length ? blocks[blocks.length - 1].text : "";
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new ModelOutputError("The response wasn't valid JSON.");
  }
}

function textFrom(message) {
  if (!message || message.stop_reason === "refusal") throw new ModelOutputError("Claude declined this one.");
  return (message.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------
// Network wrappers

const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client;
function getClient() {
  if (!configured()) {
    throw new HttpError(503, { error: "ANTHROPIC_API_KEY isn't set, so lessons can't be written yet.", code: "claude_unconfigured" });
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** Submit one request as a batch. Resolves with the batch id. */
async function submit(customId, params) {
  const batch = await getClient().messages.batches.create({
    requests: [{ custom_id: customId.slice(0, 64), params }],
  });
  return batch.id;
}

/**
 * Check a batch. { done: false } while it runs; then either { done, message }
 * or { done, error } (errored, expired, canceled).
 */
async function collect(batchId) {
  const c = getClient();
  const batch = await c.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return { done: false };
  for await (const r of await c.messages.batches.results(batchId)) {
    if (r.result.type === "succeeded") return { done: true, message: r.result.message };
    const e = r.result.type === "errored" && r.result.error ? r.result.error.error || r.result.error : null;
    return { done: true, error: e && e.message ? e.message : r.result.type };
  }
  return { done: true, error: "The batch ended without a result." };
}

/** Run a short request now, with the server-side refusal fallback. */
async function runNow(params) {
  try {
    return await getClient().beta.messages.create({ ...params, ...FALLBACK });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, { error: "Claude is busy. Try again in a minute." });
    if (err instanceof Anthropic.BadRequestError) {
      console.error("Acta Claude bad request:", err.message);
      throw new HttpError(502, { error: "Claude rejected the request." });
    }
    console.error("Acta Claude error:", err);
    throw new HttpError(502, { error: "Claude is unavailable right now." });
  }
}

module.exports = {
  MODEL,
  TOPIC_SCHEMA,
  SEASON_SCHEMA,
  PASSAGES_SCHEMA,
  ISSUES_SCHEMA,
  WRITER_SYSTEM,
  CHECKER_SYSTEM,
  researchParams,
  writeParams,
  checkParams,
  reviseParams,
  proposeParams,
  swapParams,
  askParams,
  lessonForReview,
  ModelOutputError,
  jsonFrom,
  textFrom,
  configured,
  submit,
  collect,
  runNow,
};
