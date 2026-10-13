const test = require("node:test");
const assert = require("node:assert/strict");
const { SEASON_ONE, SEED_LESSONS } = require("./acta-seed");
const { normalizeLesson, slugify } = require("./acta-lesson");

const topics = SEASON_ONE.weeks.flatMap((w) => w.topics);
const slugOf = (t) => t.slug || slugify(t.title);

test("Season 1 is 30 topics in the weekday rhythm", () => {
  assert.equal(topics.length, 30);
  const rhythm = ["person", "place", "moment", "idea", "object", "meanwhile"];
  topics.forEach((t, i) => assert.equal(t.kind, rhythm[i % 6], t.title));
});

test("week 1 is fully hand-written, one seed per topic slug", () => {
  const week1 = topics.slice(0, 6).map(slugOf);
  assert.deepEqual(week1, ["themistocles", "delphi", "salamis", "ostracism", "the-trireme", "confucius"]);
  assert.deepEqual(Object.keys(SEED_LESSONS).sort(), [...week1].sort());
});

for (const [slug, lesson] of Object.entries(SEED_LESSONS)) {
  const at = topics.findIndex((t) => slugOf(t) === slug);
  const topic = topics[at];

  test(`seed "${slug}" is a valid, finished lesson`, () => {
    assert.ok(topic, "matches a Season 1 topic");
    assert.equal(lesson.slug, slug);
    assert.equal(lesson.kind, topic.kind);
    assert.equal(lesson.era, topic.era);
    const { ok, problems } = normalizeLesson(lesson, {
      slug,
      kind: lesson.kind,
      era: lesson.era,
      teaserFor: lesson.teaserFor,
      knownSlugs: Object.keys(SEED_LESSONS),
    });
    assert.equal(ok, true, JSON.stringify(problems.filter((p) => p.severity === "error")));
    assert.ok(lesson.cards.length >= 26 && lesson.cards.length <= 31, `${lesson.cards.length} cards`);
    assert.ok(lesson.minutes >= 10, `${lesson.minutes} min`);
    // Every image is resolved on Commons with a credit.
    for (const c of lesson.cards.filter((x) => x.image)) {
      assert.match(c.image.url, /^https:\/\/(upload|thumb)\.wikimedia\.org\//, c.image.file);
      assert.ok(c.image.artist && c.image.license && c.image.descUrl && c.image.alt, c.image.file);
    }
    // Every quote card names who said it.
    for (const c of lesson.cards.filter((x) => x.type === "quote")) assert.ok(c.quote.attribution);
  });

  test(`seed "${slug}" teases the lesson that follows it`, () => {
    const next = topics[at + 1];
    assert.equal(lesson.teaserFor, slugOf(next));
    assert.ok(lesson.teaser && lesson.teaser.length > 20);
  });
}
