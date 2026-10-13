const test = require("node:test");
const assert = require("node:assert/strict");
const { createPipeline, MAX_REVISIONS } = require("./acta-pipeline");
const { createFakeStore, createFakeClaude, createFakeSources, reply, rawLesson, seasonFixture } = require("./__fixtures__/acta-fakes");

const TODAY = "2026-10-13"; // a Tuesday

const pass = () => reply({ verdict: "pass", issues: [] });
const fail = (card = 3) => reply({ verdict: "fix", issues: [{ card, severity: "error", claim: "1,000 ships", problem: "The source says 1,207.", fix: "Say 1,207." }] });

function setup({ respond = {}, seeds = {}, today = TODAY } = {}) {
  const store = createFakeStore({ seeds });
  const claude = createFakeClaude({
    research: () => reply({ passages: [{ citation: "Herodotus 8.90", translator: "Godley", url: "https://www.perseus.tufts.edu/x", excerpt: "excerpt words here for the test" }] }),
    write: () => reply(rawLesson()),
    revise: () => reply(rawLesson({ title: "Revised" })),
    notes: () => reply(rawLesson({ title: "Noted" })),
    check: pass,
    ...respond,
  });
  const sources = createFakeSources();
  let clock = 0;
  const pipeline = createPipeline({ store, claude, sources, today: () => today, clock: () => clock, log: { warn() {} } });
  return { store, claude, sources, pipeline, tick: (ms) => (clock += ms) };
}

async function approvedSeason(ctx, opts = {}) {
  const sid = await ctx.store.insertSeason(seasonFixture(opts), "proposed");
  return ctx.pipeline.approveSeason(sid);
}

/** Run passes until nothing moves (or `max` passes). */
async function drain(pipeline, max = 20) {
  const all = [];
  for (let i = 0; i < max; i++) {
    const r = await pipeline.advance();
    all.push(...r.steps);
    if (!r.steps.some((s) => s.to)) break;
  }
  return all;
}

test("approving a season schedules 30 lessons Monday–Saturday from the next Monday", async () => {
  const ctx = setup();
  const { start } = await approvedSeason(ctx);
  assert.equal(start, "2026-10-19");
  const lessons = await ctx.store.listLessons();
  assert.equal(lessons.length, 30);
  assert.equal(lessons[0].publish_on, "2026-10-19");
  assert.equal(lessons[5].publish_on, "2026-10-24");
  assert.equal(lessons[6].publish_on, "2026-10-26");
  assert.deepEqual(lessons.map((l) => l.day), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.ok(lessons.every((l) => l.status === "queued"));
  assert.equal((await ctx.store.listSeasons())[0].status, "approved");
});

test("a second season queues after the first", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  const { start } = await approvedSeason(ctx, { number: 2 });
  assert.equal(start, "2026-11-23");
});

test("a seeded topic goes straight to ready", async () => {
  const seed = { ...rawLesson({ title: "Seeded" }), slug: "salamis", cards: [] };
  const ctx = setup({ seeds: { salamis: seed } });
  await approvedSeason(ctx, { slugs: { 2: "salamis" } });
  const row = await ctx.store.lessonBySlug("salamis");
  assert.equal(row.status, "ready");
  assert.equal(row.data.title, "Seeded");
});

test("a hand-written lesson added after approval goes live without Claude", async () => {
  const seeds = {};
  const ctx = setup({ seeds });
  ctx.claude.configured = () => false;
  ctx.claude.submit = async () => {
    const e = new Error("unconfigured");
    e.status = 503;
    e.payload = { error: "ANTHROPIC_API_KEY isn't set" };
    throw e;
  };
  await approvedSeason(ctx);
  // Written by hand after the season was scheduled, for a lesson far past the lead time.
  seeds["topic-1-20"] = { ...rawLesson({ title: "Hand-written" }), slug: "whatever" };
  const r = await ctx.pipeline.advance();
  const row = await ctx.store.lessonBySlug("topic-1-20");
  assert.equal(row.status, "ready");
  assert.equal(row.data.title, "Hand-written");
  assert.equal(row.data.slug, "topic-1-20", "the stored slug always matches the calendar");
  assert.ok(r.steps.some((s) => s.slug === "topic-1-20" && s.note === "hand-written"));
  // Without a key the rest of the pass stops cleanly instead of failing lessons.
  assert.equal(r.stopped, true);
});

test("approval refuses a season with a topic that has no article", async () => {
  const ctx = setup();
  const sid = await ctx.store.insertSeason(seasonFixture({ wiki: (i) => (i === 4 ? [] : [`A ${i}`]) }), "proposed");
  await assert.rejects(ctx.pipeline.approveSeason(sid), /no Wikipedia article/);
  assert.equal((await ctx.store.listLessons()).length, 0);
});

test("lessons wait until they are within the lead time", async () => {
  const ctx = setup({ today: "2026-10-13" });
  await approvedSeason(ctx);
  await ctx.pipeline.advance();
  const lessons = await ctx.store.listLessons();
  // Lead time is 10 days: lessons up to Oct 23 start, later ones wait.
  assert.equal(lessons.find((l) => l.publish_on === "2026-10-23").status, "researching");
  assert.equal(lessons.find((l) => l.publish_on === "2026-10-24").status, "queued");
});

test("a lesson goes from queued to ready through every stage", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  const steps = await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  const path = steps.filter((s) => s.slug === "topic-1-0" && s.to).map((s) => s.to);
  assert.deepEqual(path, ["gathered", "researching", "researched", "writing", "written", "checking", "ready"]);
  // Images were resolved, and the one Commons doesn't have was dropped at write time (it wasn't used).
  assert.match(first.data.cards[0].image.url, /^https:\/\/upload\.wikimedia\.org\//);
  // The verified passage was stored with the sources.
  const full = await ctx.store.getLesson(first.id, { withSources: true });
  assert.equal(full.sources.passages.length, 1);
  // The writer was told what came before and what's next.
  const write = ctx.claude.calls.find((c) => c.kind === "write" && c.customId.startsWith(`acta-${first.id}-`));
  assert.match(write.params.messages[0].content[1].text, /Topic 1-1 \(place\)/);
});

test("going live resolves the people and places, never linking the lesson's own subject", async () => {
  const ctx = setup({ respond: { write: () => reply(rawLesson({ extra: { mentions: [{ wiki: "Athens", kind: "place", names: ["Athens"] }, { wiki: "Article 0", kind: "place", names: ["Story"] }] } })) } });
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  assert.deepEqual(ctx.sources.calls.mentions.find((c) => c.exclude.includes("Article 0")).exclude, ["Article 0"]);
  assert.deepEqual(first.data.mentions.map((m) => m.title), ["Athens"]);
  assert.equal(first.data.mentions[0].extract, "Athens is a place.");
});

test("a lesson whose mentions all fail still goes live, without the field", async () => {
  const ctx = setup({ respond: { write: () => reply(rawLesson({ extra: { mentions: [{ wiki: "Missing place", kind: "place", names: ["Athens"] }] } })) } });
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  assert.equal("mentions" in first.data, false);
});

test("the writer's teaser is tied to the lesson that follows", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.data.teaserFor, "topic-1-1");
});

test("a batch still running is left alone", async () => {
  const ctx = setup();
  ctx.claude.pending.add("write");
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "writing");
  ctx.claude.pending.clear();
  await drain(ctx.pipeline);
  assert.equal((await ctx.store.lessonBySlug("topic-1-0")).status, "ready");
});

test("checker errors send the lesson back for a rewrite, then it passes", async () => {
  let checks = 0;
  const ctx = setup({ respond: { check: () => (++checks === 1 ? fail() : pass()) } });
  await approvedSeason(ctx);
  // Only follow the first lesson.
  const steps = await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  assert.equal(first.revisions, 1);
  assert.equal(first.data.title, "Revised");
  const path = steps.filter((s) => s.slug === "topic-1-0" && s.to).map((s) => s.to);
  assert.ok(path.includes("revising"));
  const revise = ctx.claude.calls.find((c) => c.kind === "revise");
  assert.match(revise.params.messages[0].content[1].text, /The source says 1,207/);
});

test("a lesson still wrong after the rewrites waits for Charlie", async () => {
  const ctx = setup({ respond: { check: () => fail() } });
  await approvedSeason(ctx);
  await drain(ctx.pipeline, 40);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "needs_review");
  assert.equal(first.revisions, MAX_REVISIONS);
  assert.ok(first.issues.some((i) => i.source === "checker" && i.severity === "error"));
  // Charlie can publish it anyway.
  await ctx.pipeline.publishAnyway(first.id);
  assert.equal((await ctx.store.lessonBySlug("topic-1-0")).status, "ready");
});

test("a misquote caught by the format check also forces a rewrite", async () => {
  let writes = 0;
  const ctx = setup({
    respond: {
      write: () => reply(rawLesson({ quote: ++writes === 1 ? "an invented quotation that appears nowhere at all" : undefined })),
      revise: () => reply(rawLesson({ title: "Fixed quote" })),
    },
  });
  await approvedSeason(ctx);
  await drain(ctx.pipeline, 30);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  assert.equal(first.data.title, "Fixed quote");
});

test("bad JSON from the writer is retried, then the lesson fails", async () => {
  const ctx = setup({ respond: { write: () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }) } });
  await approvedSeason(ctx);
  await drain(ctx.pipeline, 40);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "failed");
  assert.match(first.error, /valid JSON/);
  // Retry puts it back to work from where it stopped.
  await ctx.pipeline.retry(first.id);
  assert.equal((await ctx.store.lessonBySlug("topic-1-0")).status, "researched");
});

test("failed research doesn't block the lesson; it's written without quotes", async () => {
  const ctx = setup({ respond: { research: () => ({ error: "expired" }) } });
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "ready");
  const full = await ctx.store.getLesson(first.id, { withSources: true });
  assert.deepEqual(full.sources.passages, []);
});

test("a thrown step records the error and retries next pass", async () => {
  const ctx = setup();
  let calls = 0;
  ctx.sources.gather = async () => {
    if (++calls === 1) throw new Error("Wikipedia timed out");
    return { articles: [{ title: "A", url: "u", text: "t" }], media: [], passages: [] };
  };
  await approvedSeason(ctx);
  const r = await ctx.pipeline.advance();
  assert.ok(r.steps.some((s) => s.error === "Wikipedia timed out"));
  const first = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(first.status, "queued");
  assert.equal(first.error, "Wikipedia timed out");
  await ctx.pipeline.advance();
  assert.notEqual((await ctx.store.lessonBySlug("topic-1-0")).status, "queued");
});

test("an unconfigured Claude stops the pass instead of failing every lesson", async () => {
  const ctx = setup();
  ctx.claude.submit = async () => {
    const e = new Error("unconfigured");
    e.status = 503;
    e.payload = { error: "ANTHROPIC_API_KEY isn't set" };
    throw e;
  };
  await approvedSeason(ctx);
  const r = await ctx.pipeline.advance();
  assert.equal(r.stopped, true);
  const lessons = await ctx.store.listLessons();
  assert.ok(lessons.every((l) => l.status !== "failed"));
});

test("only one pass runs at a time", async () => {
  const ctx = setup();
  await ctx.store.takeLock("pipeline");
  const r = await ctx.pipeline.advance();
  assert.equal(r.busy, true);
});

test("a pass stops when it runs out of time", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  const orig = ctx.sources.gather;
  ctx.sources.gather = async (w) => {
    ctx.tick(60000);
    return orig(w);
  };
  const r = await ctx.pipeline.advance({ budgetMs: 100000 });
  assert.equal(r.outOfTime, true);
  // The lock is released for the next pass.
  assert.equal((await ctx.pipeline.advance()).busy, false);
});

test("Charlie's notes send a live lesson back through the check", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  await ctx.pipeline.reviseWithNotes(first.id, [{ card: 4, problem: "The date is wrong." }]);
  assert.equal((await ctx.store.lessonBySlug("topic-1-0")).status, "revising");
  await drain(ctx.pipeline);
  const after = await ctx.store.lessonBySlug("topic-1-0");
  assert.equal(after.status, "ready");
  assert.equal(after.data.title, "Noted");
  await assert.rejects(ctx.pipeline.reviseWithNotes(first.id, []), /Say what needs fixing/);
});

test("regenerate starts a lesson from scratch", async () => {
  const ctx = setup();
  await approvedSeason(ctx);
  await drain(ctx.pipeline);
  const first = await ctx.store.lessonBySlug("topic-1-0");
  await ctx.pipeline.regenerate(first.id);
  const row = await ctx.store.getLesson(first.id, { withSources: true });
  assert.equal(row.status, "queued");
  assert.equal(row.data, null);
  assert.equal(row.sources, null);
});

test("proposing a season orders topics by weekday and checks articles", async () => {
  const kinds = ["meanwhile", "person", "place", "moment", "idea", "object"]; // shuffled
  const week = (w) => ({
    theme: `W${w}`,
    topics: kinds.map((kind, i) => ({ kind, title: `${kind} ${w}`, era: "rome", year: -100, yearLabel: "100 BC", wiki: i === 0 && w === 0 ? ["Missing article"] : [`${kind} ${w}`], focus: "f" })),
  });
  const ctx = setup({ respond: { now: () => reply({ title: "Rome: the Republic", span: "509–27 BC", intro: "i", weeks: [0, 1, 2, 3, 4].map(week) }) } });
  const season = await ctx.pipeline.proposeSeason();
  assert.equal(season.status, "proposed");
  assert.deepEqual(season.topics.slice(0, 6).map((t) => t.kind), ["person", "place", "moment", "idea", "object", "meanwhile"]);
  const flagged = season.topics.find((t) => t.title === "meanwhile 0");
  assert.match(flagged.warning, /No Wikipedia article/);
  assert.deepEqual(flagged.wiki, []);
  // The planner was steered to season 1's theme and told what's been done.
  const params = ctx.claude.calls.find((c) => c.kind === "now").params;
  assert.match(params.messages[0].content, /Plan season 1: Greece and Persia/);
});

test("an incomplete proposal is rejected", async () => {
  const ctx = setup({ respond: { now: () => reply({ title: "T", span: "", intro: "", weeks: [{ theme: "x", topics: [] }] }) } });
  await assert.rejects(ctx.pipeline.proposeSeason(), /incomplete/);
});

test("topics can be edited, swapped and moved only while proposed", async () => {
  const ctx = setup({
    respond: { now: () => reply({ topic: { kind: "person", title: "Cimon", era: "greece", year: -470, yearLabel: "c. 510–450 BC", wiki: ["Cimon"], focus: "Son of Miltiades" } }) },
  });
  const sid = await ctx.store.insertSeason(seasonFixture(), "proposed");
  const season = await ctx.store.getSeason(sid);
  const t0 = season.topics[0];
  const edited = await ctx.pipeline.editTopic(t0.id, { title: "Miltiades", wiki: ["Miltiades the Younger"], kind: "object" });
  assert.equal(edited.title, "Miltiades");
  assert.equal(edited.kind, "person", "kind follows the weekday, not the request");
  const swapped = await ctx.pipeline.swapTopic(t0.id, "Someone Athenian");
  assert.equal(swapped.title, "Cimon");
  const moved = await ctx.pipeline.moveTopic(t0.id, 1);
  assert.equal(moved.topics.find((t) => t.id === t0.id).position, 6);
  await assert.rejects(ctx.pipeline.moveTopic(season.topics[29].id, 1), /any further/);
  await ctx.pipeline.approveSeason(sid);
  await assert.rejects(ctx.pipeline.editTopic(t0.id, { title: "x" }), /already approved/);
});

test("maybePropose only drafts when the calendar runs low and nothing is waiting", async () => {
  const ctx = setup({ respond: { now: () => reply({ title: "T", span: "", intro: "", weeks: [0, 1, 2, 3, 4].map(() => seasonFixture().weeks[0]) }) } });
  // Nothing scheduled: proposes.
  const s1 = await ctx.pipeline.maybePropose();
  assert.ok(s1);
  // A proposal is waiting: doesn't propose again.
  assert.equal(await ctx.pipeline.maybePropose(), null);
  // Approve it: 30 days of runway, so no proposal.
  await ctx.pipeline.approveSeason(s1.id);
  assert.equal(await ctx.pipeline.maybePropose(), null);
});
