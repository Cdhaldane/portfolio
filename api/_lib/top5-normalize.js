// Pure validation for /api/top5: no I/O, unit-tested via `npm run test:api`.
// NOT an endpoint (the `_lib` prefix keeps Vercel from routing to it).
//
// Everything Charlie types in the Top 5 back office passes through here
// before it reaches the database. The limits mirror LIMITS in
// src/Pages/Dashboard/TopFive/top5.data.js (the card layout is built around
// them); src/Pages/Dashboard/TopFive/top5.contract.test.js keeps the two in
// sync.

// Packs are fixed by the page (their ids key the shelf order and every
// visitor's opened state); only their contents are editable.
const PACK_IDS = Object.freeze([
  "movies",
  "food",
  "albums",
  "games",
  "tv",
  "places",
  "snacks",
  "party",
  "bugs",
]);

const LIMITS = Object.freeze({
  packName: 14,
  tagline: 28,
  statLabel: 12,
  title: 34,
  meta: 40,
  take: 90,
  fun: 48,
});

const CARDS_PER_PACK = 5;
const STATS_PER_CARD = 3;
const MAX_STAT = 10;
const ICON_RE = /^fa-[a-z0-9-]{1,40}$/;
const ID_RE = /^[a-z0-9-]{1,40}$/;

// Zero-width spaces, direction marks and bidi overrides vanish; other control
// characters become spaces (then whitespace collapses), so nothing invisible
// or direction-flipping can sneak onto a card. ZWJ/ZWNJ (U+200C/U+200D) are
// kept: emoji sequences (person + ZWJ + frying pan = chef) and some scripts need them. Written as
// escapes so no invisible character ever sits in this file.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Trimmed single-line text, or null when the value isn't a string. */
function cleanText(value) {
  if (typeof value !== "string") return null;
  return value.replace(INVISIBLE, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function textField(value, label, max, { required = true } = {}) {
  const text = cleanText(value === undefined && !required ? "" : value);
  if (text === null) return { error: `${label} is missing.` };
  if (required && !text) return { error: `${label} can't be empty.` };
  if (text.length > max) return { error: `${label} is too long (max ${max}).` };
  return { value: text };
}

function validateCard(raw, rank, seenIds) {
  const at = `Card #${rank}`;
  if (!isObject(raw)) return { error: `${at} is missing.` };
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return { error: `${at} has a bad id.` };
  if (seenIds.has(raw.id)) return { error: `${at} repeats another card's id.` };
  if (typeof raw.icon !== "string" || !ICON_RE.test(raw.icon)) {
    return { error: `${at}: the icon must look like fa-film.` };
  }
  const fields = {
    title: textField(raw.title, `${at}: the title`, LIMITS.title),
    meta: textField(raw.meta, `${at}: the meta line`, LIMITS.meta, { required: false }),
    take: textField(raw.take, `${at}: the hot take`, LIMITS.take),
    fun: textField(raw.fun, `${at}: the fun fact`, LIMITS.fun, { required: false }),
  };
  const failed = Object.values(fields).find((f) => f.error);
  if (failed) return failed;
  const stats = raw.stats;
  const goodStats =
    Array.isArray(stats) &&
    stats.length === STATS_PER_CARD &&
    stats.every((s) => Number.isInteger(s) && s >= 0 && s <= MAX_STAT);
  if (!goodStats) return { error: `${at}: stats must be three whole numbers from 0 to 10.` };
  return {
    value: {
      id: raw.id,
      title: fields.title.value,
      meta: fields.meta.value,
      icon: raw.icon,
      take: fields.take.value,
      stats: [...stats],
      fun: fields.fun.value,
    },
  };
}

/**
 * Validate one pack edit: { packId, pack: { name, tagline, statLabels, cards } }.
 * Unknown fields are dropped, text is cleaned, and cards keep their order
 * (index 0 is the #1 pick).
 * @returns {{ ok: true, value: { packId, pack } } | { ok: false, error: string }}
 */
function validatePack(input) {
  if (!isObject(input) || !isObject(input.pack)) return { ok: false, error: "Missing pack." };
  const { packId, pack } = input;
  if (typeof packId !== "string" || !PACK_IDS.includes(packId)) {
    return { ok: false, error: "Unknown pack." };
  }

  const name = textField(pack.name, "The pack name", LIMITS.packName);
  if (name.error) return { ok: false, error: name.error };
  const tagline = textField(pack.tagline, "The tagline", LIMITS.tagline);
  if (tagline.error) return { ok: false, error: tagline.error };

  if (!Array.isArray(pack.statLabels) || pack.statLabels.length !== STATS_PER_CARD) {
    return { ok: false, error: "A pack needs exactly three stat labels." };
  }
  const statLabels = [];
  for (let i = 0; i < STATS_PER_CARD; i += 1) {
    const label = textField(pack.statLabels[i], `Stat label ${i + 1}`, LIMITS.statLabel);
    if (label.error) return { ok: false, error: label.error };
    statLabels.push(label.value);
  }

  if (!Array.isArray(pack.cards) || pack.cards.length !== CARDS_PER_PACK) {
    return { ok: false, error: "A pack needs exactly five cards." };
  }
  const seenIds = new Set();
  const cards = [];
  for (let i = 0; i < CARDS_PER_PACK; i += 1) {
    const card = validateCard(pack.cards[i], i + 1, seenIds);
    if (card.error) return { ok: false, error: card.error };
    seenIds.add(card.value.id);
    cards.push(card.value);
  }

  return {
    ok: true,
    value: { packId, pack: { name: name.value, tagline: tagline.value, statLabels, cards } },
  };
}

module.exports = { PACK_IDS, LIMITS, CARDS_PER_PACK, ICON_RE, ID_RE, cleanText, validatePack };
