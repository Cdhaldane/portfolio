// The Acta Diurna lesson pipeline: seasons, scheduling, and the state
// machine that turns an approved topic into a checked lesson. NOT an endpoint.
//
// A lesson moves through these statuses, one step per pass:
//
//   queued ─gather→ gathered ─submit→ researching ─collect+verify→ researched
//     ─submit→ writing ─collect+normalise→ written ─submit→ checking
//     ─collect→ ready                      (no errors: images resolved, live on its date)
//             → revising → written → …     (errors, up to MAX_REVISIONS rewrites)
//             → needs_review               (still wrong after that: Charlie decides)
//   any step failing MAX_ATTEMPTS times → failed
//
// Every Claude step is a Message Batch: submitted on one pass, collected on a
// later one. So a pass never waits on a model, and the daily cron, the desk's
// "Run now" button and the local script can all call advance() safely. A
// lock in acta_meta stops two passes overlapping, and every transition is
// conditional on the status it started from.
//
// Everything is injected (store, claude, sources, clock) so the tests drive
// the whole machine with fakes.
const {
  todayISO,
  addDays,
  seasonStart,
  slotDate,
  slotKind,
  SLOT_KINDS,
  TOPICS_PER_SEASON,
  LEAD_DAYS,
  PROPOSE_WHEN_DAYS_LEFT,
} = require("./acta-schedule");
const { normalizeLesson, slugify, ERAS, KINDS } = require("./acta-lesson");

const MAX_ATTEMPTS = 3;
const MAX_REVISIONS = 2;
const MAX_STEP_ERRORS = 5;

/** Season themes Claude is steered toward, in order; after these it plans freely. */
const SEASON_PLAN = [
  "Greece and Persia",
  "Alexander and the Hellenistic world",
  "Rome: the Republic",
  "Rome: the Empire",
  "Late antiquity and the fall of the West",
  "Medieval worlds: Byzantium, Baghdad and Song China",
  "The Renaissance and the age of sail",
  "The age of revolutions",
  "Industry and empire",
  "The twentieth century",
];

class PipelineError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PipelineError";
    this.status = status;
  }
}

const topicOf = (row) => ({
  title: row.topic_title || row.title,
  kind: row.kind,
  era: row.era,
  year: row.year,
  yearLabel: row.year_label || row.yearLabel,
  wiki: row.wiki || [],
  focus: row.focus || "",
});

function createPipeline({ store, claude, sources, today = () => todayISO(), clock = () => Date.now(), log = console }) {
  // -------------------------------------------------------------------------
  // Context for the writer: what the reader has already had, and what's next.

  async function contextFor(row) {
    const all = await store.listLessons();
    const previous = all
      .filter((l) => l.publish_on < row.publish_on && l.status === "ready")
      .slice(-40)
      .map((l) => ({ slug: l.slug, title: l.lesson_title || l.topic_title, kind: l.kind, year: l.year, yearLabel: l.year_label }));
    const next = all.find((l) => l.publish_on > row.publish_on && !l.held);
    const tomorrow = next ? { slug: next.slug, title: next.topic_title, kind: next.kind, focus: next.focus } : null;
    return { previous, tomorrow, knownSlugs: all.filter((l) => l.publish_on < row.publish_on).map((l) => l.slug) };
  }

  const set = (row, fields, from) => store.updateLesson(row.id, fields, { expectStatus: from || row.status });

  // -------------------------------------------------------------------------
  // One handler per status. Each returns { to } after a transition or
  // { wait } when there's nothing to do yet.

  async function collectDraft(row, full) {
    const r = await claude.collect(row.batch_id);
    if (!r.done) return { wait: "Claude is writing" };
    let raw = null;
    let failure = r.error || null;
    if (!failure) {
      try {
        raw = claude.jsonFrom(r.message);
      } catch (e) {
        failure = e.message;
      }
    }
    const ctx = await contextFor(row);
    const result = raw
      ? normalizeLesson(raw, {
          slug: row.slug,
          kind: row.kind,
          era: row.era,
          corpus: sources.corpusOf(full.sources),
          media: ((full.sources && full.sources.media) || []).map((m) => m.file),
          knownSlugs: ctx.knownSlugs,
          teaserFor: ctx.tomorrow ? ctx.tomorrow.slug : null,
        })
      : null;
    if (!result || !result.lesson) {
      const attempts = row.attempts + 1;
      const why = failure || (result && result.problems[0] && result.problems[0].message) || "No lesson came back.";
      if (attempts >= MAX_ATTEMPTS) {
        await set(row, { status: "failed", error: `Writing failed ${attempts} times: ${why}`, batch_id: null, attempts });
        return { to: "failed" };
      }
      // A failed first draft goes back to be written again; a failed rewrite
      // keeps the previous draft and goes back through the check.
      const back = row.status === "writing" || !full.data ? "researched" : "written";
      await set(row, { status: back, error: why, batch_id: null, attempts });
      return { to: back, note: why };
    }
    const issues = result.problems.map((p) => ({
      card: p.card == null ? null : p.card + 1,
      severity: p.severity,
      problem: p.message,
      source: "format",
    }));
    await set(row, { status: "written", data: result.lesson, issues, batch_id: null, error: null });
    return { to: "written", note: `${result.lesson.cards.length} cards` };
  }

  async function finish(row, data, issues) {
    const files = data.cards.filter((c) => c.image).map((c) => c.image.file);
    const resolved = files.length ? await sources.resolveImages(files) : new Map();
    const done = sources.applyImages(data, resolved);
    // Wikipedia's summaries for the people and places the cards name, so a
    // tap on one opens without the reader waiting on Wikipedia.
    const { mentions, ...rest } = done;
    let linked = [];
    if (mentions && mentions.length) {
      try {
        linked = await sources.resolveMentions(mentions, { exclude: row.wiki || [] });
      } catch (e) {
        log.warn && log.warn(`Acta mentions for ${row.slug}: ${e.message}`);
      }
    }
    await set(row, { status: "ready", data: linked.length ? { ...rest, mentions: linked } : rest, issues, batch_id: null, error: null });
    return { to: "ready" };
  }

  const STEPS = {
    async queued(row) {
      if (row.publish_on > addDays(today(), LEAD_DAYS)) return { wait: `starts ${addDays(row.publish_on, -LEAD_DAYS)}` };
      const gathered = await sources.gather(row.wiki || []);
      await set(row, { status: "gathered", sources: gathered, error: null });
      return { to: "gathered", note: `${gathered.articles.length} articles, ${gathered.media.length} images` };
    },

    async gathered(row, full) {
      const id = await claude.submit(`acta-${row.id}-research-${row.attempts}`, claude.researchParams(topicOf(row), full.sources));
      await set(row, { status: "researching", batch_id: id });
      return { to: "researching" };
    },

    async researching(row, full) {
      const r = await claude.collect(row.batch_id);
      if (!r.done) return { wait: "Claude is researching" };
      // Research is a bonus: if it fails, the lesson is written without quotes.
      let passages = [];
      if (r.message) {
        try {
          const j = claude.jsonFrom(r.message);
          passages = await sources.verifyPassages(Array.isArray(j.passages) ? j.passages : []);
        } catch (e) {
          log.warn && log.warn(`Acta research for ${row.slug}: ${e.message}`);
        }
      }
      await set(row, { status: "researched", batch_id: null, sources: { ...full.sources, passages } });
      return { to: "researched", note: `${passages.length} primary passages verified` };
    },

    async researched(row, full) {
      const ctx = await contextFor(row);
      const id = await claude.submit(
        `acta-${row.id}-write-${row.attempts}`,
        claude.writeParams(topicOf(row), full.sources, { previous: ctx.previous, tomorrow: ctx.tomorrow })
      );
      await set(row, { status: "writing", batch_id: id });
      return { to: "writing" };
    },

    writing: collectDraft,
    revising: collectDraft,

    async written(row, full) {
      const id = await claude.submit(`acta-${row.id}-check-${row.revisions}-${row.attempts}`, claude.checkParams(full.data, full.sources));
      await set(row, { status: "checking", batch_id: id });
      return { to: "checking" };
    },

    async checking(row, full) {
      const r = await claude.collect(row.batch_id);
      if (!r.done) return { wait: "Claude is fact-checking" };
      let report = null;
      let failure = r.error || null;
      if (!failure) {
        try {
          report = claude.jsonFrom(r.message);
        } catch (e) {
          failure = e.message;
        }
      }
      if (!report) {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await set(row, { status: "needs_review", error: `The fact-check failed: ${failure}`, batch_id: null, attempts });
          return { to: "needs_review" };
        }
        await set(row, { status: "written", error: failure, batch_id: null, attempts });
        return { to: "written", note: failure };
      }
      const format = (full.issues || []).filter((i) => i.source === "format");
      const checker = (Array.isArray(report.issues) ? report.issues : []).map((i) => ({
        card: Number.isInteger(i.card) ? i.card : null,
        severity: i.severity === "error" ? "error" : "warn",
        claim: String(i.claim || "").slice(0, 400),
        problem: String(i.problem || "").slice(0, 600),
        fix: String(i.fix || "").slice(0, 600),
        source: "checker",
      }));
      const issues = [...format, ...checker];
      const errors = issues.filter((i) => i.severity === "error");
      if (!errors.length) return finish(row, full.data, issues);

      if (row.revisions >= MAX_REVISIONS) {
        await set(row, { status: "needs_review", issues, batch_id: null, error: `${errors.length} problems left after ${row.revisions} rewrites.` });
        return { to: "needs_review" };
      }
      const ctx = await contextFor(row);
      const id = await claude.submit(
        `acta-${row.id}-revise-${row.revisions + 1}`,
        claude.reviseParams(topicOf(row), full.sources, { previous: ctx.previous, tomorrow: ctx.tomorrow }, full.data, errors)
      );
      await set(row, { status: "revising", issues, batch_id: id, revisions: row.revisions + 1 });
      return { to: "revising", note: `${errors.length} to fix` };
    },
  };

  const SYNC_STEPS = new Set(["queued", "gathered", "researched", "written"]);

  /**
   * Move every lesson in progress as far as it can go in `budgetMs`.
   * Resolves with what happened, or { busy: true } if another pass holds the lock.
   */
  async function advance({ budgetMs = 200000 } = {}) {
    if (!(await store.takeLock("pipeline", budgetMs + 60000))) return { busy: true, steps: [] };
    const started = clock();
    const steps = [];
    try {
      // Hand-written lessons need no Claude: a queued topic with one goes
      // straight to ready, even if its season was approved before it existed.
      for (const row of await store.activeLessons()) {
        const seed = row.status === "queued" && store.seedLesson ? store.seedLesson(row.slug) : null;
        if (!seed) continue;
        await set(row, { status: "ready", data: { ...seed, slug: row.slug }, error: null });
        steps.push({ slug: row.slug, from: "queued", to: "ready", note: "hand-written" });
      }
      const rows = await store.activeLessons();
      for (const first of rows) {
        let row = first;
        // A lesson can take several quick steps in one pass (gather, then submit).
        for (let hop = 0; hop < 4; hop++) {
          if (clock() - started > budgetMs) return { busy: false, steps, outOfTime: true };
          const handler = STEPS[row.status];
          if (!handler) break;
          const full = await store.getLesson(row.id, { withSources: true });
          if (!full || full.status !== row.status) break;
          let result;
          try {
            result = await handler(row, full);
          } catch (e) {
            if (e && e.status === 503) {
              steps.push({ slug: row.slug, from: row.status, error: e.payload ? e.payload.error : e.message });
              return { busy: false, steps, stopped: true };
            }
            const attempts = row.attempts + 1;
            const message = String((e && e.message) || e).slice(0, 500);
            await store.updateLesson(
              row.id,
              attempts >= MAX_STEP_ERRORS ? { status: "failed", error: message, attempts } : { error: message, attempts },
              { expectStatus: row.status }
            );
            steps.push({ slug: row.slug, from: row.status, error: message });
            break;
          }
          steps.push({ slug: row.slug, from: row.status, ...(result || {}) });
          if (!result || !result.to || !SYNC_STEPS.has(result.to)) break;
          const next = await store.getLesson(row.id);
          if (!next) break;
          row = { ...row, ...next };
        }
      }
      return { busy: false, steps };
    } finally {
      await store.releaseLock("pipeline");
    }
  }

  // -------------------------------------------------------------------------
  // Seasons

  /** Put Claude's season into the fixed weekday rhythm, fixing order where it can. */
  function shapeSeason(raw, number) {
    const weeks = Array.isArray(raw && raw.weeks) ? raw.weeks : [];
    const out = [];
    for (let w = 0; w < TOPICS_PER_SEASON / SLOT_KINDS.length; w++) {
      const week = weeks[w] || { theme: "", topics: [] };
      const given = (Array.isArray(week.topics) ? week.topics : []).slice(0, SLOT_KINDS.length);
      if (given.length < SLOT_KINDS.length) throw new PipelineError(`Week ${w + 1} of the proposal is incomplete.`, 502);
      const byKind = new Map(given.map((t) => [t.kind, t]));
      const ordered = SLOT_KINDS.every((k) => byKind.has(k)) ? SLOT_KINDS.map((k) => byKind.get(k)) : given;
      out.push({
        theme: String(week.theme || "").slice(0, 120),
        topics: ordered.map((t, i) => {
          const kind = SLOT_KINDS[i];
          return {
            kind,
            title: String(t.title || "").slice(0, 120),
            era: ERAS.includes(t.era) ? t.era : "greece",
            year: Number.isInteger(t.year) ? t.year : 0,
            yearLabel: String(t.yearLabel || "").slice(0, 60),
            wiki: (Array.isArray(t.wiki) ? t.wiki : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
            focus: String(t.focus || "").slice(0, 600),
            ...(t.kind !== kind && KINDS.includes(t.kind) ? { warning: `Planned as ${t.kind}; check it fits ${kind}.` } : {}),
          };
        }),
      });
    }
    return {
      number,
      title: String((raw && raw.title) || SEASON_PLAN[number - 1] || `Season ${number}`).slice(0, 120),
      span: String((raw && raw.span) || "").slice(0, 60),
      intro: String((raw && raw.intro) || "").slice(0, 600),
      weeks: out,
    };
  }

  /** Swap each topic's article titles for the real ones; flag topics with none. */
  async function checkWiki(topics) {
    const { found } = await sources.checkTitles(topics.flatMap((t) => t.wiki));
    const real = new Map(found.map((f) => [f.asked, f.title]));
    return topics.map((t) => {
      const wiki = [...new Set(t.wiki.map((w) => real.get(w)).filter(Boolean))];
      const missing = t.wiki.filter((w) => !real.has(w));
      const warning = !wiki.length
        ? `No Wikipedia article found (${t.wiki.join(", ") || "none given"}). Edit or swap it.`
        : missing.length
        ? `Dropped missing article: ${missing.join(", ")}.`
        : t.warning || null;
      return { ...t, wiki, warning };
    });
  }

  async function proposeSeason({ hint } = {}) {
    const number = await store.nextSeasonNumber();
    const seasons = await store.listSeasons();
    const pastTopics = await store.pastTopicTitles();
    const msg = await claude.runNow(
      claude.proposeParams({
        number,
        hint: hint || SEASON_PLAN[number - 1] || "",
        pastSeasons: seasons.map((s) => ({ number: s.number, title: s.title, span: s.span })),
        pastTopics,
      })
    );
    const season = shapeSeason(claude.jsonFrom(msg), number);
    const checked = await checkWiki(season.weeks.flatMap((w) => w.topics));
    const per = SLOT_KINDS.length;
    season.weeks = season.weeks.map((w, wi) => ({ ...w, topics: checked.slice(wi * per, wi * per + per) }));
    const id = await store.insertSeason(season, "proposed");
    return store.getSeason(id);
  }

  async function proposedSeasonOrThrow(seasonId) {
    const season = await store.getSeason(seasonId);
    if (!season) throw new PipelineError("That season is gone.", 404);
    if (season.status !== "proposed") throw new PipelineError("That season is already approved.", 409);
    return season;
  }

  async function editTopic(topicId, fields) {
    const topic = await store.getTopic(topicId);
    if (!topic) throw new PipelineError("That topic is gone.", 404);
    await proposedSeasonOrThrow(topic.seasonId);
    const next = {
      ...topic,
      title: fields.title != null ? String(fields.title).trim().slice(0, 120) || topic.title : topic.title,
      focus: fields.focus != null ? String(fields.focus).trim().slice(0, 600) : topic.focus,
      yearLabel: fields.yearLabel != null ? String(fields.yearLabel).trim().slice(0, 60) : topic.yearLabel,
      year: Number.isInteger(fields.year) ? fields.year : topic.year,
      era: ERAS.includes(fields.era) ? fields.era : topic.era,
      wiki: Array.isArray(fields.wiki) ? fields.wiki.map((s) => String(s).trim()).filter(Boolean).slice(0, 3) : topic.wiki,
      warning: null,
    };
    const [checked] = await checkWiki([next]);
    return store.updateTopic(topicId, { ...checked, kind: slotKind(topic.position), slug: "" });
  }

  async function swapTopic(topicId, note) {
    const topic = await store.getTopic(topicId);
    if (!topic) throw new PipelineError("That topic is gone.", 404);
    const season = await proposedSeasonOrThrow(topic.seasonId);
    const others = season.topics.filter((t) => t.id !== topic.id).map((t) => `${t.kind}: ${t.title}`);
    const msg = await claude.runNow(
      claude.swapParams({ season, topic, others: [...others, ...(await store.pastTopicTitles())], note: note ? String(note).slice(0, 400) : "" })
    );
    const j = claude.jsonFrom(msg);
    const raw = j && j.topic;
    if (!raw || !raw.title) throw new PipelineError("Claude didn't suggest a replacement. Try again.", 502);
    const [checked] = await checkWiki([
      {
        kind: topic.kind,
        title: String(raw.title).slice(0, 120),
        era: ERAS.includes(raw.era) ? raw.era : topic.era,
        year: Number.isInteger(raw.year) ? raw.year : topic.year,
        yearLabel: String(raw.yearLabel || "").slice(0, 60),
        wiki: (Array.isArray(raw.wiki) ? raw.wiki : []).map(String).slice(0, 3),
        focus: String(raw.focus || "").slice(0, 600),
      },
    ]);
    return store.updateTopic(topicId, { ...checked, kind: topic.kind, slug: "" });
  }

  /** Move a topic a week earlier (-1) or later (+1), keeping its weekday. */
  async function moveTopic(topicId, dir) {
    const topic = await store.getTopic(topicId);
    if (!topic) throw new PipelineError("That topic is gone.", 404);
    const season = await proposedSeasonOrThrow(topic.seasonId);
    const target = topic.position + (dir < 0 ? -SLOT_KINDS.length : SLOT_KINDS.length);
    const other = season.topics.find((t) => t.position === target);
    if (!other) throw new PipelineError("It can't move any further that way.", 400);
    await store.swapTopicPositions(topic, other);
    return store.getSeason(season.id);
  }

  async function discardSeason(seasonId) {
    await proposedSeasonOrThrow(seasonId);
    await store.setSeasonStatus(seasonId, "discarded");
  }

  /** Approve a season: schedule its 30 lessons from the next free Monday. */
  async function approveSeason(seasonId) {
    const season = await proposedSeasonOrThrow(seasonId);
    if (season.topics.length !== TOPICS_PER_SEASON) {
      throw new PipelineError(`A season needs ${TOPICS_PER_SEASON} topics; this one has ${season.topics.length}.`);
    }
    const blocked = season.topics.filter((t) => !t.wiki.length);
    if (blocked.length) {
      throw new PipelineError(`Fix these first, they have no Wikipedia article: ${blocked.map((t) => t.title).join(", ")}.`);
    }
    const start = seasonStart(today(), await store.lastScheduledDate());
    for (const topic of season.topics) {
      const base = topic.slug || slugify(topic.title) || `topic-${topic.id}`;
      let slug = base;
      for (let n = 2; await store.slugTaken(slug); n++) slug = `${base}-${n}`;
      const seed = store.seedLesson(slug);
      await store.insertLesson({
        topicId: topic.id,
        slug,
        publishOn: slotDate(start, topic.position),
        status: seed ? "ready" : "queued",
        data: seed ? { ...seed, slug } : null,
      });
      if (slug !== topic.slug) await store.updateTopic(topic.id, { ...topic, slug });
    }
    await store.setSeasonStatus(seasonId, "approved");
    await store.renumberDays();
    return { start, season: await store.getSeason(seasonId) };
  }

  /** Propose the next season when the calendar is running low and nothing is waiting. */
  async function maybePropose() {
    const seasons = await store.listSeasons();
    if (seasons.some((s) => s.status === "proposed")) return null;
    const left = await store.scheduledFrom(today());
    if (left >= PROPOSE_WHEN_DAYS_LEFT) return null;
    return proposeSeason();
  }

  // -------------------------------------------------------------------------
  // Charlie's lesson controls

  async function lessonOrThrow(id) {
    const row = await store.getLesson(id);
    if (!row) throw new PipelineError("That lesson is gone.", 404);
    return row;
  }

  async function setHeld(id, held) {
    await lessonOrThrow(id);
    return store.updateLesson(id, { held: Boolean(held) });
  }

  /** Start over from scratch (sources are gathered again). */
  async function regenerate(id) {
    await lessonOrThrow(id);
    return store.updateLesson(id, {
      status: "queued",
      data: null,
      sources: null,
      issues: [],
      batch_id: null,
      attempts: 0,
      revisions: 0,
      error: null,
    });
  }

  /** Try again from wherever it stopped. */
  async function retry(id) {
    const row = await lessonOrThrow(id);
    const full = await store.getLesson(id, { withSources: true });
    const status = full.data ? "written" : full.sources ? "researched" : "queued";
    return store.updateLesson(id, { status, batch_id: null, attempts: 0, revisions: Math.min(row.revisions, MAX_REVISIONS - 1), error: null });
  }

  /** Publish a lesson the checker wasn't happy with, on Charlie's say-so. */
  async function publishAnyway(id) {
    const row = await lessonOrThrow(id);
    const full = await store.getLesson(id, { withSources: true });
    if (!full.data) throw new PipelineError("There's no draft to publish yet.");
    const topic = (await store.topicsByIds([row.topic_id]))[0] || {};
    await finish({ ...row, status: row.status, wiki: topic.wiki || [] }, full.data, full.issues || []);
    return store.getLesson(id);
  }

  /**
   * Send a lesson back for a rewrite with Charlie's notes (e.g. from reader
   * flags). It leaves the live page until the rewrite passes the check.
   */
  async function reviseWithNotes(id, notes) {
    const row = await lessonOrThrow(id);
    const full = await store.getLesson(id, { withSources: true });
    if (!full.data) throw new PipelineError("There's no draft to revise yet.");
    if (!full.sources) throw new PipelineError("This lesson was written by hand, so there are no sources to revise it from.");
    const errors = (Array.isArray(notes) ? notes : [])
      .map((n) => ({ card: Number.isInteger(n.card) ? n.card : null, problem: String(n.problem || "").slice(0, 600), fix: String(n.fix || "") }))
      .filter((n) => n.problem);
    if (!errors.length) throw new PipelineError("Say what needs fixing.");
    const topic = (await store.topicsByIds([row.topic_id]))[0] || {};
    const ctx = await contextFor(row);
    const batchId = await claude.submit(
      `acta-${row.id}-notes-${Date.now() % 100000}`,
      claude.reviseParams({ ...topic, year_label: topic.yearLabel }, full.sources, { previous: ctx.previous, tomorrow: ctx.tomorrow }, full.data, errors)
    );
    return store.updateLesson(id, {
      status: "revising",
      batch_id: batchId,
      revisions: 0,
      attempts: 0,
      issues: errors.map((e) => ({ ...e, severity: "error", source: "charlie" })),
      error: null,
    });
  }

  return {
    advance,
    proposeSeason,
    maybePropose,
    approveSeason,
    discardSeason,
    editTopic,
    swapTopic,
    moveTopic,
    setHeld,
    regenerate,
    retry,
    publishAnyway,
    reviseWithNotes,
    shapeSeason,
    _steps: STEPS,
  };
}

module.exports = { createPipeline, PipelineError, SEASON_PLAN, MAX_ATTEMPTS, MAX_REVISIONS, topicOf };
