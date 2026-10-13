// The reader's own state, kept in localStorage: where they are in each
// lesson, the review deck, saved cards and debate votes. Every visitor gets
// this with no account. When Charlie is signed in, sync.js mirrors it to the
// server so it follows him between devices.
//
// The scheduling and merge rules are pure functions (tested in
// store.test.js); the small store at the bottom only persists and notifies.
import { useSyncExternalStore } from "react";

const KEY = "acta:v1";

/** Days until a card comes back, by box. Box 5 and up is mastered. */
export const INTERVALS = [1, 3, 7, 21, 60];
export const MASTERED_BOX = INTERVALS.length;

// ---------------------------------------------------------------------------
// Dates (the reader's own calendar)

export function localISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
}

/** "today", "tomorrow", "Saturday", "Oct 30". */
export function whenLabel(iso, today = localISO()) {
  const n = daysBetween(today, iso);
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  const d = new Date(`${iso}T12:00:00Z`);
  if (n < 7) return d.toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Review deck

/**
 * Grade one recall card. Right moves it to the next box (longer gap); wrong
 * sends it back to box 0 (tomorrow). Past the last box it's mastered.
 */
export function gradeItem(item, got, today, base = {}) {
  // A new card starts in box 0, so a first right answer jumps to box 1 (three days).
  const prev = item || { box: 0, reps: 0, lapses: 0 };
  const box = got ? prev.box + 1 : 0;
  const mastered = box >= MASTERED_BOX;
  return {
    ...prev,
    ...base, // the lesson's current wording wins over an old snapshot
    box,
    reps: (prev.reps || 0) + 1,
    lapses: (prev.lapses || 0) + (got ? 0 : 1),
    last: today,
    due: mastered ? null : addDays(today, INTERVALS[Math.max(0, box)]),
    mastered,
    at: Date.now(),
  };
}

/** Cards due on or before `today`, oldest first. Cards readers have flagged sit out. */
export function dueItems(deck, today) {
  return Object.values(deck || {})
    .filter((i) => i && !i.mastered && !i.removed && !i.held && i.due && i.due <= today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (a.at || 0) - (b.at || 0)));
}

/** The next date anything is due after today, or null. */
export function nextDue(deck, today) {
  const future = Object.values(deck || {})
    .filter((i) => i && !i.mastered && !i.removed && i.due && i.due > today)
    .map((i) => i.due)
    .sort();
  return future[0] || null;
}

/** Recall cards from a finished lesson that weren't graded go in for tomorrow. */
export function addLessonToDeck(deck, lesson, today) {
  const next = { ...deck };
  for (const c of lesson.cards || []) {
    if (c.type !== "recall" || !c.id || next[c.id]) continue;
    next[c.id] = {
      id: c.id,
      slug: lesson.slug,
      lessonTitle: lesson.title,
      q: c.q,
      a: c.a,
      box: 0,
      reps: 0,
      lapses: 0,
      last: null,
      due: addDays(today, 1),
      mastered: false,
      at: Date.now(),
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Merge (for sync): the union of two devices' state, newest change wins.

const newer = (a, b, key = "at") => ((a && a[key]) || 0) >= ((b && b[key]) || 0) ? a : b;

export function mergeState(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  const out = empty();
  for (const slug of new Set([...Object.keys(x.progress), ...Object.keys(y.progress)])) {
    const p = x.progress[slug] || {};
    const q = y.progress[slug] || {};
    out.progress[slug] = {
      at: newer(p, q, "t").at || 0,
      max: Math.max(p.max || 0, q.max || 0),
      total: Math.max(p.total || 0, q.total || 0),
      done: Boolean(p.done || q.done),
      finishedAt: [p.finishedAt, q.finishedAt].filter(Boolean).sort()[0] || null,
      t: Math.max(p.t || 0, q.t || 0),
      title: p.title || q.title || "",
      era: p.era || q.era || null,
      year: p.year ?? q.year ?? null,
    };
  }
  for (const k of new Set([...Object.keys(x.deck), ...Object.keys(y.deck)])) out.deck[k] = newer(x.deck[k], y.deck[k]);
  for (const k of new Set([...Object.keys(x.saved), ...Object.keys(y.saved)])) out.saved[k] = newer(x.saved[k], y.saved[k]);
  for (const k of new Set([...Object.keys(x.votes), ...Object.keys(y.votes)])) out.votes[k] = newer(x.votes[k], y.votes[k]);
  out.prefs = { ...y.prefs, ...x.prefs };
  out.updatedAt = Math.max(x.updatedAt, y.updatedAt);
  return out;
}

export function empty() {
  return { v: 1, progress: {}, deck: {}, saved: {}, votes: {}, prefs: { size: "m" }, updatedAt: 0 };
}

export function normalize(s) {
  const e = empty();
  if (!s || typeof s !== "object") return e;
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    v: 1,
    progress: obj(s.progress),
    deck: obj(s.deck),
    saved: obj(s.saved),
    votes: obj(s.votes),
    prefs: { ...e.prefs, ...obj(s.prefs) },
    updatedAt: Number(s.updatedAt) || 0,
  };
}

// ---------------------------------------------------------------------------
// The store

function read() {
  try {
    return normalize(JSON.parse(window.localStorage.getItem(KEY) || "null"));
  } catch {
    return empty();
  }
}

let state = typeof window === "undefined" ? empty() : read();
const listeners = new Set();

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the session still works, it just won't persist */
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Replace part of the state immutably: update(s => ({ ...s, deck })). */
export function update(fn, { silent = false } = {}) {
  const next = fn(state);
  if (next === state) return;
  state = { ...next, updatedAt: Date.now() };
  persist();
  if (!silent) listeners.forEach((l) => l(state));
}

/** Overwrite everything (used by sync after a merge). */
export function replaceState(next) {
  state = normalize(next);
  persist();
  listeners.forEach((l) => l(state));
}

// Another tab changed it: pick that up.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    state = read();
    listeners.forEach((l) => l(state));
  });
}

/** Subscribe a component to one slice. The selector must return a stored reference. */
export function useActa(selector) {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(empty()));
}

// ---------------------------------------------------------------------------
// Actions

export function setProgress(lesson, at, total) {
  update((s) => {
    const p = s.progress[lesson.slug] || {};
    if (p.at === at && p.total === total) return s;
    return {
      ...s,
      progress: {
        ...s.progress,
        [lesson.slug]: { ...p, at, total, max: Math.max(p.max || 0, at), t: Date.now(), title: lesson.title, era: lesson.era, year: lesson.year },
      },
    };
  });
}

export function markDone(lesson, today = localISO()) {
  update((s) => {
    const p = s.progress[lesson.slug] || {};
    if (p.done) {
      const missing = (lesson.cards || []).some((c) => c.type === "recall" && c.id && !s.deck[c.id]);
      return missing ? { ...s, deck: addLessonToDeck(s.deck, lesson, today) } : s;
    }
    return {
      ...s,
      progress: { ...s.progress, [lesson.slug]: { ...p, done: true, finishedAt: today, t: Date.now(), title: lesson.title, era: lesson.era, year: lesson.year } },
      deck: addLessonToDeck(s.deck, lesson, today),
    };
  });
}

export function grade(card, lesson, got, today = localISO()) {
  update((s) => ({
    ...s,
    deck: {
      ...s.deck,
      [card.id]: gradeItem(s.deck[card.id], got, today, { id: card.id, slug: lesson.slug, lessonTitle: lesson.title, q: card.q, a: card.a }),
    },
  }));
  return getState().deck[card.id];
}

export const savedKey = (slug, index) => `${slug}:${index}`;

/** Snapshot of a card for the commonplace book (so it survives the lesson changing). */
export function snapshot(lesson, card, index) {
  const text =
    card.type === "quote" && card.quote
      ? `“${card.quote.text}” (${card.quote.attribution})`
      : card.type === "recall"
      ? `${card.q}\n\n${card.a}`
      : card.type === "numbers"
      ? (card.rows || []).map((r) => `${r.value}: ${r.label}`).join("\n")
      : card.type === "disagree"
      ? (card.sides || []).map((x) => `${x.label}: ${x.text}`).join("\n\n")
      : card.text || "";
  return {
    key: savedKey(lesson.slug, index),
    slug: lesson.slug,
    index,
    lessonTitle: lesson.title,
    era: lesson.era,
    title: card.title || card.label || "",
    label: card.label || "",
    text,
    image: card.image && card.image.url ? { url: card.image.url, alt: card.image.alt || "" } : null,
    at: Date.now(),
  };
}

export function toggleSaved(lesson, card, index) {
  const key = savedKey(lesson.slug, index);
  let saved = false;
  update((s) => {
    const cur = s.saved[key];
    saved = !cur || cur.removed;
    return {
      ...s,
      saved: { ...s.saved, [key]: saved ? snapshot(lesson, card, index) : { key, removed: true, at: Date.now() } },
    };
  });
  return saved;
}

export function vote(lesson, card, side) {
  update((s) => ({
    ...s,
    votes: {
      ...s.votes,
      [lesson.slug]: { side, title: card.title, sides: card.sides, lessonTitle: lesson.title, at: Date.now(), on: localISO() },
    },
  }));
}

/**
 * A recall card readers have flagged as wrong sits out of the review deck
 * until the flag is resolved; this applies the lesson's current flag list.
 */
export function syncFlags(lesson) {
  const flagged = new Set(lesson.flagged || []);
  update((s) => {
    let changed = false;
    const deck = { ...s.deck };
    (lesson.cards || []).forEach((c, i) => {
      const item = c.id && deck[c.id];
      if (!item) return;
      const held = flagged.has(i);
      if (Boolean(item.held) !== held) {
        deck[c.id] = { ...item, held };
        changed = true;
      }
    });
    return changed ? { ...s, deck } : s;
  });
}

export function setPref(key, value) {
  update((s) => ({ ...s, prefs: { ...s.prefs, [key]: value } }));
}
