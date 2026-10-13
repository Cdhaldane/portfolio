// Small pure helpers for rendering a lesson. Tested in lessonUtil.test.js.

export const KIND_LABEL = {
  person: "A person",
  place: "A place",
  moment: "A moment",
  idea: "An idea",
  object: "An object",
  meanwhile: "Meanwhile",
};

/** -480 → "480 BC", 30 → "AD 30", 1453 → "1453". */
export function formatYear(y) {
  if (!Number.isFinite(y)) return "";
  if (y < 0) return `${-y} BC`;
  if (y < 1000) return `AD ${y}`;
  return String(y);
}

export const paragraphs = (text) =>
  String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/** The cards the feed shows: the lesson's own, then the closing card. */
export const feedCards = (lesson) => [...(lesson.cards || []), { type: "close" }];

/**
 * Group cards into the sections the contents rail lists: the cold open,
 * where and when, each chapter (with the asides, quotes and questions inside
 * it), the debate, the ripples, the final questions and the close.
 */
export function sections(cards) {
  const out = [];
  let chapter = null;
  let afterChapters = false;
  cards.forEach((c, i) => {
    let label;
    if (c.type === "open") label = "Cold open";
    else if (c.type === "where") label = "Where & when";
    else if (c.type === "close") label = "Close";
    else if (c.type === "disagree") {
      label = "Historians disagree";
      afterChapters = true;
    } else if (c.type === "ripple") {
      label = "Ripples";
      afterChapters = true;
    } else if (c.type === "recall" && afterChapters) label = "Check yourself";
    else if (c.type === "story" && c.label) {
      chapter = c.label;
      label = chapter;
    } else label = chapter || "The story";
    const last = out[out.length - 1];
    if (last && last.label === label) last.end = i;
    else out.push({ label, start: i, end: i });
  });
  return out;
}

/**
 * Place timeline pins on a strip: x as a percentage, and a row (0–2) so
 * labels that would overlap drop to the next line.
 */
export function layoutPins(pins, { minGap = 18 } = {}) {
  const sorted = [...(pins || [])].filter((p) => Number.isFinite(p.year)).sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return { from: null, to: null, pins: [] };
  const min = sorted[0].year;
  const max = sorted[sorted.length - 1].year;
  const span = Math.max(1, max - min);
  const pad = span * 0.06;
  const from = min - pad;
  const to = max + pad;
  const lastX = [-Infinity, -Infinity, -Infinity];
  return {
    from,
    to,
    pins: sorted.map((p) => {
      const x = ((p.year - from) / (to - from)) * 100;
      let row = 0;
      while (row < 2 && x - lastX[row] < minGap) row += 1;
      lastX[row] = x;
      return { ...p, x, row };
    }),
  };
}

/** What narration reads aloud for a card, as a list of sentences. */
export function speechParts(card, lesson) {
  // No regex lookbehind: Safari before 16.4 can't parse it.
  const sentences = (t) =>
    (String(t || "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) || [])
      .map((s) => s.trim())
      .filter(Boolean);
  switch (card.type) {
    case "open":
      return [lesson.title, lesson.subtitle, ...sentences(card.text)].filter(Boolean);
    case "quote":
      return [...sentences(card.text), ...sentences(card.quote && card.quote.text), card.quote ? card.quote.attribution : ""].filter(Boolean);
    case "numbers":
      return [card.title, ...(card.rows || []).map((r) => `${r.value}. ${r.label}.`)].filter(Boolean);
    case "disagree":
      return [card.title, ...(card.sides || []).flatMap((s) => [`${s.label}.`, ...sentences(s.text)])].filter(Boolean);
    case "recall":
      return [card.q];
    case "close":
      return ["That's today.", ...(lesson.takeaways || [])];
    default:
      return [card.title, ...sentences(card.text)].filter(Boolean);
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * One matcher for a lesson's people and places: every name in a single
 * alternation, longest first, so "Xerxes I" wins over "Xerxes". Mentions that
 * haven't been resolved (a draft on the desk) still link, by their wiki title.
 */
export function mentionMatcher(mentions) {
  const byName = new Map();
  for (const m of mentions || []) {
    if (!m || !(m.title || m.wiki)) continue;
    for (const n of m.names || []) if (n && !byName.has(n)) byName.set(n, m);
  }
  if (!byName.size) return null;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  return { re: new RegExp(names.map(escapeRe).join("|"), "g"), byName };
}

/**
 * Split text into plain strings and { text, mention } pieces. A name links
 * only as a whole word, and each person or place only the first time it
 * appears: `seen` carries that across a card's paragraphs.
 */
export function linkMentions(text, matcher, seen = new Set()) {
  const s = String(text || "");
  if (!matcher || !s) return [s];
  const { re, byName } = matcher;
  const out = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const at = m.index;
    const name = m[0];
    const mention = byName.get(name);
    if (WORD_CHAR.test(s[at - 1] || "") || WORD_CHAR.test(s[at + name.length] || "")) {
      re.lastIndex = at + 1; // inside a longer word; a shorter name may still start further on
      continue;
    }
    if (seen.has(mention)) continue;
    seen.add(mention);
    if (at > last) out.push(s.slice(last, at));
    out.push({ text: name, mention });
    last = at + name.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** The image credit line: "Wilhelm von Kaulbach · Public domain". */
export function credit(image) {
  if (!image || !image.url) return "";
  return [image.artist, image.license].filter(Boolean).join(" · ");
}
