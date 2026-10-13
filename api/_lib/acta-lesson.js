// The Acta Diurna lesson format: the JSON schema Claude writes to, and the
// normaliser + deterministic checks every lesson passes before it is stored.
// NOT an endpoint.
//
// A lesson is ~27 cards read one per screen. The writer's output is
// untrusted: normalizeLesson() clamps it to the shape the page renders and
// returns a list of problems. "error" problems send the lesson back for a
// rewrite; "warn" problems are fixed here (an unknown image is dropped, an
// unknown source id is removed) and only reported.
//
// The one check that matters most is mechanical: a quote card must appear
// word for word in the gathered sources. A model can be argued out of a
// misremembered date by a second model; a fabricated quote is caught here
// without asking anyone.
const KINDS = ["person", "place", "moment", "idea", "object", "meanwhile"];
const ERAS = [
  "ancient",
  "greece",
  "rome",
  "byzantine",
  "medieval",
  "east",
  "renaissance",
  "revolutions",
  "industrial",
  "modern",
];
const CARD_TYPES = ["open", "where", "story", "aside", "quote", "numbers", "disagree", "recall", "ripple"];
const TEXT_TYPES = ["open", "where", "story", "aside", "ripple"];
const MENTION_KINDS = ["person", "place"];

const LIMITS = Object.freeze({
  minCards: 18,
  maxCards: 34,
  wordsPerCard: 150,
  wordsWithImage: 100,
  minRecall: 3,
  maxRecall: 7,
  maxImages: 12,
  maxMentions: 30,
  namesPerMention: 4,
  wordsPerMinute: 200, // reading on a phone, card by card
});

// ---------------------------------------------------------------------------
// JSON schema for structured output. Structured outputs need every property
// listed in `required` and `additionalProperties: false`, so optional fields
// are nullable rather than absent.

const str = { type: "string" };
const int = { type: "integer" };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const IMAGE_SCHEMA = obj({ file: str, alt: str, focus: nullable(str) });
const QUOTE_SCHEMA = obj({ text: str, attribution: str, translator: nullable(str), passage: nullable(str) });
const CARD_SCHEMA = obj({
  type: { type: "string", enum: CARD_TYPES },
  label: nullable(str),
  chapter: nullable(str),
  title: nullable(str),
  text: nullable(str),
  image: nullable(IMAGE_SCHEMA),
  quote: nullable(QUOTE_SCHEMA),
  rows: nullable({ type: "array", items: obj({ value: str, label: str }) }),
  sides: nullable({ type: "array", items: obj({ label: str, text: str }) }),
  q: nullable(str),
  a: nullable(str),
  pins: nullable({ type: "array", items: obj({ year: int, label: str }) }),
  src: { type: "array", items: str },
});
const MENTION_SCHEMA = obj({
  wiki: str,
  kind: { type: "string", enum: MENTION_KINDS },
  names: { type: "array", items: str },
});

const LESSON_SCHEMA = obj({
  title: str,
  subtitle: str,
  summary: str,
  year: int,
  yearLabel: str,
  place: str,
  takeaways: { type: "array", items: str },
  teaser: nullable(str),
  links: { type: "array", items: str },
  sources: { type: "array", items: obj({ id: str, label: str, url: nullable(str) }) },
  cards: { type: "array", items: CARD_SCHEMA },
  mentions: { type: "array", items: MENTION_SCHEMA },
});

// ---------------------------------------------------------------------------
// Text helpers

const clean = (v, max = 4000) =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";

const words = (s) => (typeof s === "string" ? s.split(/\s+/).filter(Boolean).length : 0);

function slugify(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Canonical Commons/Wikipedia file title: "File:Some name.jpg". */
function normalizeFile(name) {
  const bare = String(name || "")
    .trim()
    .replace(/^(file|image):/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bare) return "";
  return `File:${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
}

/** Fold the typographic differences that don't change a quotation. */
function foldForMatch(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/­/g, "")
    .replace(/\[\s*(?:\d+|[a-z])\s*\]/g, " ") // footnote markers like [12] or [a]
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?)])/g, "$1") // HTML-to-text leaves "Aegaleos ," behind links
    .replace(/\( /g, "(")
    .trim();
}

const trimPunct = (s) => s.replace(/^[\s"'.,;:!?()-]+|[\s"'.,;:!?()-]+$/g, "");

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** True when `name` occurs in `text` as a whole word ("Athens" in "Athens'", not in "Athenses"). Case-sensitive. */
function namedIn(text, name) {
  if (!name) return false;
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + name.length] || "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

/** The running prose of a card, where the page links names: not titles, quotes or questions. */
function proseOf(card) {
  const parts = [];
  if (TEXT_TYPES.includes(card.type) || card.type === "quote") parts.push(card.text || "");
  for (const s of card.sides || []) parts.push(s.text);
  return parts.join("\n");
}

/**
 * True when `quote` appears in `corpus` word for word, allowing an ellipsis
 * to stand for omitted words: every ellipsis-separated segment must be found,
 * in order. Case, curly quotes, dashes and whitespace are folded first.
 */
function containsVerbatim(corpus, quote) {
  const hay = foldForMatch(corpus);
  const segments = foldForMatch(quote)
    .split(/\.\.\.|…|\[\.\.\.\]|\[…\]/)
    .map(trimPunct)
    .filter((s) => s.length > 0);
  if (!segments.length) return false;
  if (segments.join(" ").split(" ").length < 4) return false; // too short to mean anything
  let from = 0;
  for (const seg of segments) {
    const at = hay.indexOf(seg, from);
    if (at < 0) return false;
    from = at + seg.length;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Normaliser

/**
 * Clamp a raw writer lesson to the stored shape and list its problems.
 *
 * @param {object} raw            the model's JSON
 * @param {object} ctx
 * @param {string} ctx.slug
 * @param {string} ctx.kind
 * @param {string} ctx.era
 * @param {string} [ctx.corpus]   all gathered source text (articles + verified passages)
 * @param {string[]} [ctx.media]  file titles the writer was allowed to use
 * @param {string[]} [ctx.knownSlugs] lessons that may be linked
 * @param {string|null} [ctx.teaserFor] slug of the next lesson the teaser describes
 * @returns {{ ok: boolean, lesson: object|null, problems: {severity: string, card: number|null, message: string}[] }}
 */
function normalizeLesson(raw, ctx = {}) {
  const problems = [];
  const err = (message, card = null) => problems.push({ severity: "error", card, message });
  const warn = (message, card = null) => problems.push({ severity: "warn", card, message });

  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cards)) {
    return { ok: false, lesson: null, problems: [{ severity: "error", card: null, message: "Lesson JSON is missing its cards." }] };
  }

  const media = ctx.media ? new Set(ctx.media.map(normalizeFile)) : null;
  const corpus = ctx.corpus || "";
  const knownSlugs = new Set(ctx.knownSlugs || []);

  const sources = [];
  const sourceIds = new Set();
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    const id = clean(s && s.id, 80);
    const label = clean(s && s.label, 200);
    if (!id || !label || sourceIds.has(id)) continue;
    const url = clean(s.url, 500);
    sourceIds.add(id);
    sources.push({ id, label, ...(url && /^https:\/\//.test(url) ? { url } : {}) });
  }

  const usedFiles = new Set();
  const cards = [];
  let recallN = 0;

  raw.cards.slice(0, LIMITS.maxCards + 6).forEach((c, i) => {
    if (!c || !CARD_TYPES.includes(c.type)) {
      warn(`Card ${i + 1} has an unknown type and was dropped.`, i);
      return;
    }
    const card = { type: c.type };
    const at = cards.length; // index in the stored lesson
    const label = clean(c.label, 60);
    const chapter = clean(c.chapter, 8);
    const title = clean(c.title, 120);
    const text = clean(c.text, 2400);
    if (label) card.label = label;
    if (chapter) card.chapter = chapter;
    if (title) card.title = title;
    if (text) card.text = text;

    if (c.image && typeof c.image === "object") {
      const file = normalizeFile(c.image.file);
      if (!file) {
        warn(`Card ${at + 1}: image has no file name, dropped.`, at);
      } else if (media && !media.has(file)) {
        warn(`Card ${at + 1}: ${file} isn't in the article's media list, dropped.`, at);
      } else if (usedFiles.has(file)) {
        warn(`Card ${at + 1}: ${file} is already used on an earlier card, dropped.`, at);
      } else if (usedFiles.size >= LIMITS.maxImages) {
        warn(`Card ${at + 1}: too many images, dropped.`, at);
      } else {
        usedFiles.add(file);
        const focus = clean(c.image.focus, 20);
        card.image = {
          file,
          alt: clean(c.image.alt, 300) || title || "",
          ...(focus && /^\d{1,3}% \d{1,3}%$/.test(focus) ? { focus } : {}),
        };
      }
    }

    const src = (Array.isArray(c.src) ? c.src : []).map((s) => clean(s, 80)).filter(Boolean);
    const known = src.filter((s) => sourceIds.has(s));
    if (known.length < src.length) warn(`Card ${at + 1}: unknown source ids removed.`, at);
    if (known.length) card.src = [...new Set(known)];

    if (TEXT_TYPES.includes(c.type)) {
      if (!text) err(`Card ${at + 1} (${c.type}) has no text.`, at);
      const limit = card.image ? LIMITS.wordsWithImage : LIMITS.wordsPerCard;
      const n = words(text);
      if (n > limit) err(`Card ${at + 1} is ${n} words; the limit is ${limit}${card.image ? " with an image" : ""}.`, at);
      if (c.type === "where" && Array.isArray(c.pins)) {
        const pins = c.pins
          .filter((p) => p && Number.isInteger(p.year) && p.year >= -12000 && p.year <= 2100 && clean(p.label, 40))
          .slice(0, 8)
          .map((p) => ({ year: p.year, label: clean(p.label, 40) }))
          .sort((a, b) => a.year - b.year);
        if (pins.length >= 2) card.pins = pins;
      }
    }

    if (c.type === "quote") {
      const q = c.quote && typeof c.quote === "object" ? c.quote : null;
      const qText = clean(q && q.text, 1200).replace(/^["“”']+|["“”']+$/g, "");
      const attribution = clean(q && q.attribution, 200);
      if (!qText || !attribution) {
        err(`Card ${at + 1}: a quote card needs the quoted text and who said it.`, at);
      } else {
        card.quote = { text: qText, attribution };
        const translator = clean(q.translator, 120);
        if (translator) card.quote.translator = translator;
        if (words(qText) > 120) err(`Card ${at + 1}: the quote is ${words(qText)} words; keep it under 120.`, at);
        if (corpus && !containsVerbatim(corpus, qText)) {
          err(
            `Card ${at + 1}: the quote isn't word for word in the sources. Copy it exactly from a passage, or turn the card into a description of the passage.`,
            at
          );
        }
      }
    }

    if (c.type === "numbers") {
      const rows = (Array.isArray(c.rows) ? c.rows : [])
        .map((r) => ({ value: clean(r && r.value, 24), label: clean(r && r.label, 160) }))
        .filter((r) => r.value && r.label)
        .slice(0, 6);
      if (rows.length < 2) err(`Card ${at + 1}: a numbers card needs at least two rows.`, at);
      card.rows = rows;
    }

    if (c.type === "disagree") {
      const sides = (Array.isArray(c.sides) ? c.sides : [])
        .map((s) => ({ label: clean(s && s.label, 60), text: clean(s && s.text, 800) }))
        .filter((s) => s.label && s.text);
      if (sides.length !== 2) err(`Card ${at + 1}: a disagree card needs exactly two sides.`, at);
      sides.forEach((s, k) => {
        if (words(s.text) > 70) err(`Card ${at + 1}: side ${k + 1} is ${words(s.text)} words; keep each side under 70.`, at);
      });
      card.sides = sides.slice(0, 2);
    }

    if (c.type === "recall") {
      const q = clean(c.q, 400);
      const a = clean(c.a, 800);
      if (!q || !a) err(`Card ${at + 1}: a recall card needs a question and an answer.`, at);
      recallN += 1;
      card.q = q;
      card.a = a;
      card.id = `${ctx.slug || "lesson"}-r${recallN}`;
      delete card.text;
    }

    cards.push(card);
  });

  if (cards.length < LIMITS.minCards) err(`The lesson has ${cards.length} cards; it needs at least ${LIMITS.minCards}.`);
  if (cards.length > LIMITS.maxCards) err(`The lesson has ${cards.length} cards; keep it to ${LIMITS.maxCards}.`);
  if (cards[0] && cards[0].type !== "open") err("The first card must be the cold open.", 0);
  if (cards[0] && cards[0].type === "open" && !cards[0].image) warn("The cold open has no image.", 0);
  if (!cards.some((c) => c.type === "where")) err("The lesson needs a where-and-when card.");
  if (recallN < LIMITS.minRecall) err(`The lesson has ${recallN} recall questions; it needs at least ${LIMITS.minRecall}.`);
  if (recallN > LIMITS.maxRecall) err(`The lesson has ${recallN} recall questions; keep it to ${LIMITS.maxRecall}.`);

  const takeaways = (Array.isArray(raw.takeaways) ? raw.takeaways : []).map((t) => clean(t, 300)).filter(Boolean);
  if (takeaways.length < 3) err(`The lesson has ${takeaways.length} takeaways; it needs three.`);

  const title = clean(raw.title, 120);
  if (!title) err("The lesson has no title.");
  const year = Number.isInteger(raw.year) ? raw.year : null;
  if (year === null) err("The lesson has no year.");

  const links = (Array.isArray(raw.links) ? raw.links : [])
    .map((s) => clean(s, 80))
    .filter((s) => knownSlugs.has(s) && s !== ctx.slug);

  // People and places the reader can tap for Wikipedia's summary. Only names
  // the prose really uses are kept; the article titles are checked against
  // Wikipedia when the lesson goes live (resolveMentions). Never an error: a
  // missing link costs the reader a shortcut, not a fact.
  const prose = cards.map(proseOf).join("\n");
  const mentions = [];
  for (const m of Array.isArray(raw.mentions) ? raw.mentions : []) {
    const wiki = clean(m && m.wiki, 200);
    if (!wiki) continue;
    const names = [...new Set((Array.isArray(m.names) ? m.names : []).map((n) => clean(n, 60)))]
      .filter((n) => namedIn(prose, n))
      .slice(0, LIMITS.namesPerMention);
    if (!names.length) {
      warn(`${wiki} isn't named in the cards' text, so it isn't linked.`);
      continue;
    }
    if (mentions.length >= LIMITS.maxMentions) {
      warn(`More than ${LIMITS.maxMentions} people and places; the rest aren't linked.`);
      break;
    }
    mentions.push({ wiki, kind: MENTION_KINDS.includes(m.kind) ? m.kind : "person", names });
  }

  const lesson = {
    v: 1,
    slug: ctx.slug || slugify(title),
    kind: KINDS.includes(ctx.kind) ? ctx.kind : "moment",
    era: ERAS.includes(ctx.era) ? ctx.era : "greece",
    title,
    subtitle: clean(raw.subtitle, 120),
    summary: clean(raw.summary, 300),
    year: year === null ? 0 : year,
    yearLabel: clean(raw.yearLabel, 40),
    place: clean(raw.place, 120),
    minutes: estimateMinutes(cards),
    takeaways: takeaways.slice(0, 3),
    ...(clean(raw.teaser, 240) && ctx.teaserFor ? { teaser: clean(raw.teaser, 240), teaserFor: ctx.teaserFor } : {}),
    links: [...new Set(links)].slice(0, 4),
    sources,
    cards,
    ...(mentions.length ? { mentions } : {}),
  };
  return { ok: !problems.some((p) => p.severity === "error"), lesson, problems };
}

/**
 * Reading time on a phone: words at ~200 wpm, a few seconds per picture and
 * per swipe, and half a minute for each question you stop to answer.
 */
function estimateMinutes(cards) {
  let n = 0;
  for (const c of cards) {
    n += words(c.title) + words(c.text) + words(c.q) + words(c.a);
    if (c.quote) n += words(c.quote.text);
    if (c.rows) for (const r of c.rows) n += words(r.value) + words(r.label);
    if (c.sides) for (const s of c.sides) n += words(s.text) + words(s.label);
  }
  const recall = cards.filter((c) => c.type === "recall").length;
  const pictures = cards.filter((c) => c.image).length;
  const total = n / LIMITS.wordsPerMinute + recall * 0.5 + pictures * 0.1 + cards.length * 0.05;
  return Math.max(5, Math.min(25, Math.round(total)));
}

/** Every recall question in a lesson, ready for a review deck. */
function recallItems(lesson) {
  return (lesson.cards || [])
    .filter((c) => c.type === "recall" && c.id)
    .map((c) => ({ id: c.id, q: c.q, a: c.a }));
}

module.exports = {
  KINDS,
  ERAS,
  CARD_TYPES,
  MENTION_KINDS,
  LIMITS,
  LESSON_SCHEMA,
  slugify,
  normalizeFile,
  foldForMatch,
  containsVerbatim,
  namedIn,
  proseOf,
  normalizeLesson,
  estimateMinutes,
  recallItems,
  words,
};
