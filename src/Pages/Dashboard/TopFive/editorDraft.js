import { ICON_RE, LIMITS, cleanText } from "./top5.data";

/*
 * Pure, immutable helpers behind the Top 5 back office. A draft is the
 * editable slice of a pack: { name, tagline, statLabels[3], cards[5] }, cards
 * in rank order (index 0 is the #1 pick). Card ids never change; they travel
 * with the card when it's re-ranked.
 */

export const toDraft = (pack) => ({
  name: pack.name,
  tagline: pack.tagline,
  statLabels: [...pack.statLabels],
  cards: pack.cards.map((c) => ({
    id: c.id,
    title: c.title,
    meta: c.meta || "",
    icon: c.icon,
    take: c.take,
    fun: c.fun || "",
    stats: [...c.stats],
  })),
});

export const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const setPackField = (draft, field, value) => ({ ...draft, [field]: value });

export const setStatLabel = (draft, k, value) => ({
  ...draft,
  statLabels: draft.statLabels.map((label, i) => (i === k ? value : label)),
});

export const setCardField = (draft, index, field, value) => ({
  ...draft,
  cards: draft.cards.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
});

const toStat = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0;
};

export const setCardStat = (draft, index, k, value) => ({
  ...draft,
  cards: draft.cards.map((c, i) =>
    i === index ? { ...c, stats: c.stats.map((s, j) => (j === k ? toStat(value) : s)) } : c
  ),
});

/** Move the card at `from` to `to` (a re-rank). Out of range is a no-op. */
export const moveCard = (draft, from, to) => {
  if (to < 0 || to >= draft.cards.length || from === to) return draft;
  const cards = [...draft.cards];
  const [card] = cards.splice(from, 1);
  cards.splice(to, 0, card);
  return { ...draft, cards };
};

const check = (errors, key, value, max, label, required = true) => {
  const text = cleanText(value) ?? "";
  if (required && !text) return { ...errors, [key]: `${label} can't be empty.` };
  if (text.length > max) return { ...errors, [key]: `${label}: ${text.length}/${max} characters.` };
  return errors;
};

/** Field-keyed problems ({} when the draft is saveable). */
export function draftErrors(draft) {
  let errors = {};
  errors = check(errors, "name", draft.name, LIMITS.packName, "Pack name");
  errors = check(errors, "tagline", draft.tagline, LIMITS.tagline, "Tagline");
  draft.statLabels.forEach((label, k) => {
    errors = check(errors, `label-${k}`, label, LIMITS.statLabel, `Stat ${k + 1}`);
  });
  draft.cards.forEach((c, i) => {
    const at = `card-${i}`;
    errors = check(errors, `${at}-title`, c.title, LIMITS.title, "Title");
    errors = check(errors, `${at}-meta`, c.meta, LIMITS.meta, "Meta", false);
    errors = check(errors, `${at}-take`, c.take, LIMITS.take, "Hot take");
    errors = check(errors, `${at}-fun`, c.fun, LIMITS.fun, "Fun fact", false);
    if (!ICON_RE.test(c.icon)) errors = { ...errors, [`${at}-icon`]: "Icons look like fa-film." };
  });
  return errors;
}

/** What gets sent to the API: cleaned text, cards in rank order. */
export const toPayload = (draft) => ({
  name: cleanText(draft.name),
  tagline: cleanText(draft.tagline),
  statLabels: draft.statLabels.map(cleanText),
  cards: draft.cards.map((c) => ({
    id: c.id,
    title: cleanText(c.title),
    meta: cleanText(c.meta),
    icon: c.icon,
    take: cleanText(c.take),
    fun: cleanText(c.fun),
    stats: [...c.stats],
  })),
});
