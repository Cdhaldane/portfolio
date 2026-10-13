// In-memory stand-ins for the Acta store, Claude and Wikimedia, shared by the
// acta-*.test.js suites. They implement the same interfaces as acta-db's
// createStore(), acta-claude and acta-sources, so the pipeline and handler
// run unchanged against them.
const realClaude = require("../acta-claude");
const realSources = require("../acta-sources");

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function createFakeStore({ seeds = {} } = {}) {
  const db = { seasons: [], topics: [], lessons: [], flags: [], users: new Map(), push: new Map(), meta: new Map() };
  let nextId = 1;
  const id = () => nextId++;

  const topicOf = (l) => db.topics.find((t) => t.id === l.topic_id) || {};
  const joined = (l) => {
    const t = topicOf(l);
    const { sources, ...rest } = l;
    return {
      ...clone(rest),
      lesson_title: l.data ? l.data.title : null,
      topic_title: t.title,
      kind: t.kind,
      era: t.era,
      year: t.year,
      year_label: t.yearLabel,
      wiki: t.wiki,
      focus: t.focus,
      season_id: t.seasonId,
    };
  };
  const byDate = (a, b) => (a.publish_on < b.publish_on ? -1 : a.publish_on > b.publish_on ? 1 : a.id - b.id);
  const live = (l, today) => l.status === "ready" && !l.held && l.data && l.publish_on <= today;

  const store = {
    db,
    ensure: async () => {},
    async insertSeason(season, status = "proposed") {
      const sid = id();
      db.seasons.push({ id: sid, number: season.number, title: season.title, span: season.span || "", intro: season.intro || "", themes: (season.weeks || []).map((w) => w.theme), status });
      (season.weeks || []).flatMap((w) => w.topics).forEach((t, i) => {
        db.topics.push({ id: id(), seasonId: sid, position: i, kind: t.kind, title: t.title, slug: t.slug || "", era: t.era, year: t.year || 0, yearLabel: t.yearLabel || "", wiki: t.wiki || [], focus: t.focus || "", warning: t.warning || null });
      });
      return sid;
    },
    async listSeasons() {
      return db.seasons
        .filter((s) => s.status !== "discarded")
        .map((s) => ({ ...clone(s), topics: db.topics.filter((t) => t.seasonId === s.id).sort((a, b) => a.position - b.position).map(clone) }));
    },
    async getSeason(sid) {
      return (await store.listSeasons()).find((s) => s.id === sid) || null;
    },
    async getTopic(tid) {
      return clone(db.topics.find((t) => t.id === tid) || null);
    },
    async updateTopic(tid, f) {
      const t = db.topics.find((x) => x.id === tid);
      if (!t) return null;
      Object.assign(t, { title: f.title, slug: f.slug || "", kind: f.kind, era: f.era, year: f.year, yearLabel: f.yearLabel, wiki: f.wiki, focus: f.focus, warning: f.warning || null });
      return clone(t);
    },
    async swapTopicPositions(a, b) {
      const ta = db.topics.find((x) => x.id === a.id);
      const tb = db.topics.find((x) => x.id === b.id);
      [ta.position, tb.position] = [tb.position, ta.position];
    },
    async setSeasonStatus(sid, status) {
      db.seasons.find((s) => s.id === sid).status = status;
    },
    async nextSeasonNumber() {
      return Math.max(0, ...db.seasons.filter((s) => s.status !== "discarded").map((s) => s.number)) + 1;
    },
    async pastTopicTitles() {
      return db.topics.map((t) => t.title);
    },
    async lastScheduledDate() {
      return db.lessons.length ? db.lessons.map((l) => l.publish_on).sort().pop() : null;
    },
    async slugTaken(slug) {
      return db.lessons.some((l) => l.slug === slug);
    },
    async insertLesson(l) {
      const row = { id: id(), topic_id: l.topicId, slug: l.slug, day: null, publish_on: l.publishOn, status: l.status || "queued", held: false, data: clone(l.data) || null, sources: clone(l.sources) || null, issues: [], batch_id: null, attempts: 0, revisions: 0, error: null, updated_at: new Date().toISOString() };
      db.lessons.push(row);
      return clone(row);
    },
    async renumberDays() {
      [...db.lessons].sort(byDate).forEach((l, i) => (l.day = i + 1));
    },
    async updateLesson(lid, fields, { expectStatus } = {}) {
      const l = db.lessons.find((x) => x.id === lid);
      if (!l || (expectStatus && l.status !== expectStatus)) return null;
      for (const k of ["status", "held", "data", "sources", "issues", "batch_id", "attempts", "revisions", "error", "publish_on"]) {
        if (k in fields) l[k] = clone(fields[k]);
      }
      l.updated_at = new Date().toISOString();
      const { sources, ...rest } = l;
      return clone(rest);
    },
    async getLesson(lid, { withSources = false } = {}) {
      const l = db.lessons.find((x) => x.id === lid);
      if (!l) return null;
      if (withSources) return clone(l);
      const { sources, ...rest } = l;
      return clone(rest);
    },
    async listLessons() {
      return [...db.lessons].sort(byDate).map(joined);
    },
    async activeLessons() {
      return [...db.lessons].sort(byDate).filter((l) => !["ready", "needs_review", "failed"].includes(l.status)).map(joined);
    },
    async latestLive(today) {
      const rows = db.lessons.filter((l) => live(l, today)).sort(byDate);
      return rows.length ? clone(rows[rows.length - 1]) : null;
    },
    async liveBySlug(slug, today) {
      return clone(db.lessons.find((l) => l.slug === slug && live(l, today)) || null);
    },
    async lessonBySlug(slug) {
      const l = db.lessons.find((x) => x.slug === slug);
      if (!l) return null;
      const { sources, ...rest } = l;
      return clone(rest);
    },
    async archive(today) {
      return db.lessons
        .filter((l) => live(l, today))
        .sort(byDate)
        .reverse()
        .map((l) => ({ slug: l.slug, day: l.day, publish_on: l.publish_on, title: l.data.title, subtitle: l.data.subtitle, summary: l.data.summary, kind: l.data.kind, era: l.data.era, year: l.data.year, year_label: l.data.yearLabel, takeaways: l.data.takeaways, minutes: l.data.minutes }));
    },
    async everyLesson() {
      return [...db.lessons]
        .sort(byDate)
        .reverse()
        .map((l) => {
          const t = topicOf(l);
          const d = l.data || {};
          return {
            slug: l.slug,
            day: l.day,
            publish_on: l.publish_on,
            status: l.status,
            held: l.held,
            written: Boolean(l.data),
            title: d.title || t.title,
            subtitle: d.subtitle || null,
            summary: d.summary || null,
            kind: d.kind || t.kind,
            era: d.era || t.era,
            year: d.year != null ? d.year : t.year,
            year_label: d.yearLabel || t.yearLabel,
            takeaways: d.takeaways || null,
            minutes: d.minutes || null,
          };
        });
    },
    async nextAfter(date) {
      const l = [...db.lessons].sort(byDate).find((x) => x.publish_on > date && !x.held);
      if (!l) return null;
      const t = topicOf(l);
      return { slug: l.slug, date: l.publish_on, title: t.title, kind: t.kind };
    },
    async neighbours(date, today) {
      const lv = db.lessons.filter((l) => live(l, today)).sort(byDate);
      const prev = lv.filter((l) => l.publish_on < date).pop();
      const next = lv.find((l) => l.publish_on > date);
      return { prev: prev ? { slug: prev.slug, title: prev.data.title } : null, next: next ? { slug: next.slug, title: next.data.title } : null };
    },
    async scheduledFrom(from) {
      return db.lessons.filter((l) => l.publish_on >= from && !l.held).length;
    },
    async topicsByIds(ids) {
      return db.topics.filter((t) => ids.includes(t.id)).map(clone);
    },
    async insertFlag(f) {
      const fid = id();
      db.flags.push({ id: fid, status: "open", ...clone(f) });
      return fid;
    },
    async listFlags() {
      return clone(db.flags);
    },
    async setFlagStatus(fid, status) {
      db.flags.find((f) => f.id === fid).status = status;
    },
    async openFlagCards(slug) {
      return [...new Set(db.flags.filter((f) => f.slug === slug && f.status === "open" && f.card != null).map((f) => f.card))];
    },
    async getUserData(uid) {
      return clone(db.users.get(uid) || null);
    },
    async putUserData(uid, data) {
      db.users.set(uid, clone(data));
    },
    async savePush(sub) {
      db.push.set(sub.endpoint, clone(sub.keys));
    },
    async deletePush(endpoint) {
      db.push.delete(endpoint);
    },
    async listPush() {
      return [...db.push.entries()].map(([endpoint, keys]) => ({ endpoint, keys }));
    },
    async getMeta(k) {
      return db.meta.has(k) ? db.meta.get(k) : null;
    },
    async setMeta(k, v) {
      db.meta.set(k, v);
    },
    async takeLock(name) {
      if (db.meta.get(`lock:${name}`)) return false;
      db.meta.set(`lock:${name}`, "held");
      return true;
    },
    async releaseLock(name) {
      db.meta.set(`lock:${name}`, null);
    },
    seedLesson: (slug) => clone(seeds[slug] || null),
  };
  return store;
}

/** A Claude reply carrying `json` as structured output. */
const reply = (json, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text: JSON.stringify(json) }] });

/**
 * Fake Claude: the real (pure) request builders and parsers, with batches
 * answered by `respond[kind](params, n)`. kind is research | write | check |
 * revise | notes, taken from the batch's custom id. Set `pending` to a kind
 * to make that kind's batches stay in progress.
 */
function createFakeClaude(respond = {}) {
  const calls = [];
  const batches = new Map();
  let n = 0;
  const fake = {
    ...realClaude,
    calls,
    pending: new Set(),
    configured: () => true,
    async submit(customId, params) {
      const kind = customId.split("-")[2];
      const bid = `batch_${++n}`;
      batches.set(bid, { kind, params });
      calls.push({ customId, kind, params });
      return bid;
    },
    async collect(bid) {
      const b = batches.get(bid);
      if (!b) return { done: true, error: "unknown batch" };
      if (fake.pending.has(b.kind)) return { done: false };
      const fn = respond[b.kind];
      if (!fn) return { done: true, error: `no fake for ${b.kind}` };
      const out = fn(b.params, calls.filter((c) => c.kind === b.kind).length);
      if (out && out.error) return { done: true, error: out.error };
      return { done: true, message: out };
    },
    async runNow(params) {
      calls.push({ kind: "now", params });
      if (!respond.now) throw new Error("no fake for runNow");
      return respond.now(params);
    },
  };
  return fake;
}

/** Fake Wikimedia: every title exists unless it contains "Missing". */
function createFakeSources() {
  const calls = { gather: 0, resolve: 0, verify: 0, mentions: [] };
  return {
    ...realSources,
    calls,
    async gather(wiki) {
      calls.gather++;
      return {
        articles: wiki.map((t) => ({ title: t, url: `https://en.wikipedia.org/wiki/${t}`, text: `${t} article text. Herodotus wrote that the fleet sailed at dawn and the wind rose.` })),
        media: [{ file: "File:A.jpg", caption: "" }, { file: "File:B.jpg", caption: "" }, { file: "File:NotOnCommons.jpg", caption: "" }],
        passages: [],
        fetchedAt: "2026-10-01T00:00:00Z",
      };
    },
    async verifyPassages(candidates) {
      calls.verify++;
      return candidates.map((c, i) => ({ id: `p${i + 1}`, citation: c.citation, translator: c.translator, url: c.url, excerpt: c.excerpt }));
    },
    async resolveImages(files) {
      calls.resolve++;
      const m = new Map();
      for (const f of files) {
        if (f.includes("NotOnCommons")) continue;
        m.set(f, { url: `https://upload.wikimedia.org/${encodeURIComponent(f)}`, width: 800, height: 600, descUrl: "https://commons.wikimedia.org/wiki/x", artist: "Someone", license: "Public domain" });
      }
      return m;
    },
    async checkTitles(titles) {
      const found = titles.filter((t) => !/Missing/.test(t)).map((t) => ({ asked: t, title: t }));
      return { found, missing: titles.filter((t) => /Missing/.test(t)) };
    },
    async resolveMentions(mentions, { exclude = [] } = {}) {
      calls.mentions.push({ mentions, exclude });
      return mentions
        .filter((m) => !/Missing/.test(m.wiki) && !exclude.includes(m.wiki))
        .map((m) => ({ ...m, title: m.wiki, extract: `${m.wiki} is a place.`, url: `https://en.wikipedia.org/wiki/${m.wiki}` }));
    },
  };
}

/** A valid writer response: 20 cards, every kind of card, quotes from `corpusQuote`. */
function rawLesson({ title = "Test lesson", quote = "the fleet sailed at dawn and the wind rose", extra = {} } = {}) {
  const story = (i) => ({ type: "story", label: "I · Start", chapter: "I", title: `Beat ${i}`, text: `Story beat number ${i}, short and true.`, image: null, quote: null, rows: null, sides: null, q: null, a: null, pins: null, src: ["wiki-1"] });
  const base = { label: null, chapter: null, title: null, text: null, image: null, quote: null, rows: null, sides: null, q: null, a: null, pins: null, src: [] };
  const cards = [
    { ...base, type: "open", label: "A moment", title, text: "A scene in the present tense.", image: { file: "File:A.jpg", alt: "A picture", focus: "50% 40%" }, src: ["wiki-1"] },
    { ...base, type: "where", label: "Where & when", title: "The place", text: "Where it happened, west of Athens.", image: { file: "File:B.jpg", alt: "Another", focus: null }, pins: [{ year: -490, label: "Marathon" }, { year: -480, label: "Salamis" }] },
    ...Array.from({ length: 11 }, (_, i) => story(i + 1)),
    { ...base, type: "quote", label: "Primary source", text: "Context.", quote: { text: quote, attribution: "Herodotus", translator: "Godley", passage: null } },
    { ...base, type: "numbers", title: "Numbers", rows: [{ value: "378", label: "ships" }, { value: "1,207", label: "ships" }] },
    { ...base, type: "disagree", title: "Debate", sides: [{ label: "For", text: "Yes it did." }, { label: "Against", text: "No it didn't." }] },
    { ...base, type: "ripple", title: "After", text: "What changed." },
    { ...base, type: "recall", q: "Why one?", a: "Because one." },
    { ...base, type: "recall", q: "Why two?", a: "Because two." },
    { ...base, type: "recall", q: "Why three?", a: "Because three." },
  ];
  return {
    title,
    subtitle: "480 BC",
    summary: "A summary.",
    year: -480,
    yearLabel: "480 BC",
    place: "Greece",
    takeaways: ["One.", "Two.", "Three."],
    teaser: "Tomorrow is good.",
    links: [],
    sources: [{ id: "wiki-1", label: "Wikipedia", url: "https://en.wikipedia.org/wiki/X" }],
    cards,
    mentions: [{ wiki: "Athens", kind: "place", names: ["Athens"] }],
    ...extra,
  };
}

/** A minimal Season of 30 topics in the weekday rhythm. */
function seasonFixture({ number = 1, slugs = {}, wiki = (i) => [`Article ${i}`] } = {}) {
  const kinds = ["person", "place", "moment", "idea", "object", "meanwhile"];
  return {
    number,
    title: `Season ${number}`,
    span: "500–400 BC",
    intro: "Intro",
    weeks: Array.from({ length: 5 }, (_, w) => ({
      theme: `Week ${w + 1}`,
      topics: kinds.map((kind, s) => {
        const i = w * 6 + s;
        return { kind, title: `Topic ${number}-${i}`, era: "greece", year: -480, yearLabel: "480 BC", wiki: wiki(i), focus: "Angle", ...(slugs[i] ? { slug: slugs[i] } : {}) };
      }),
    })),
  };
}

module.exports = { createFakeStore, createFakeClaude, createFakeSources, reply, rawLesson, seasonFixture, clone };
