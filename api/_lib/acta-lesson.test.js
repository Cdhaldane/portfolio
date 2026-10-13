const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./acta-lesson");
const { rawLesson } = require("./__fixtures__/acta-fakes");
const salamis = require("../../src/Pages/Acta/lessons/salamis.json");

const corpus = "Herodotus wrote that the fleet sailed at dawn and the wind rose.";
const ctx = (extra = {}) => ({ slug: "test", kind: "moment", era: "greece", corpus, media: ["File:A.jpg", "File:B.jpg"], ...extra });

test("containsVerbatim folds typography but not wording", () => {
  const page = "“My men have become women, and my women men.” They say this is what Xerxes said.";
  assert.equal(L.containsVerbatim(page, '"My men have become women, and my women men."'), true);
  assert.equal(L.containsVerbatim(page, "My men have turned into women, and my women men."), false);
  // An ellipsis may stand for omitted words, but the pieces must be in order.
  assert.equal(L.containsVerbatim("one two three four five six seven eight", "one two three … six seven eight"), true);
  assert.equal(L.containsVerbatim("one two three four five six seven eight", "six seven eight … one two three"), false);
  // Footnote markers and spaces left before punctuation by HTML don't break a match.
  assert.equal(L.containsVerbatim("called Aegaleos , saw one [12] of his", "called Aegaleos, saw one of his"), true);
  // Too short to mean anything.
  assert.equal(L.containsVerbatim("the end", "the end"), false);
});

test("slugify and normalizeFile", () => {
  assert.equal(L.slugify("Salamis, 480 BC"), "salamis-480-bc");
  assert.equal(L.slugify("Çatalhöyük & the first towns"), "catalhoyuk-and-the-first-towns");
  assert.equal(L.normalizeFile("file:battle_of salamis.png"), "File:Battle of salamis.png");
  assert.equal(L.normalizeFile("Image:X.jpg"), "File:X.jpg");
});

test("a valid lesson normalises cleanly", () => {
  const { ok, lesson, problems } = L.normalizeLesson(rawLesson(), ctx({ teaserFor: "next-one" }));
  assert.equal(ok, true, JSON.stringify(problems));
  assert.equal(lesson.cards.length, 20);
  assert.equal(lesson.cards[0].type, "open");
  assert.deepEqual(lesson.cards.filter((c) => c.type === "recall").map((c) => c.id), ["test-r1", "test-r2", "test-r3"]);
  assert.equal(lesson.teaserFor, "next-one");
  assert.equal(lesson.cards[1].pins.length, 2);
  assert.ok(lesson.minutes >= 5);
  // Nulls are dropped, so stored cards stay small.
  assert.equal("quote" in lesson.cards[2], false);
});

test("a quote that isn't in the sources is an error", () => {
  const { ok, problems } = L.normalizeLesson(rawLesson({ quote: "the fleet sailed at midnight and the wind fell" }), ctx());
  assert.equal(ok, false);
  assert.ok(problems.some((p) => p.severity === "error" && /word for word/.test(p.message)));
});

test("unknown images and source ids are dropped with a warning, not an error", () => {
  const raw = rawLesson();
  raw.cards[2].image = { file: "File:Invented.jpg", alt: "x", focus: null };
  raw.cards[3].src = ["wiki-1", "made-up"];
  const { ok, lesson, problems } = L.normalizeLesson(raw, ctx());
  assert.equal(ok, true);
  assert.equal(lesson.cards[2].image, undefined);
  assert.deepEqual(lesson.cards[3].src, ["wiki-1"]);
  assert.equal(problems.filter((p) => p.severity === "warn").length, 2);
});

test("the same image twice is dropped the second time", () => {
  const raw = rawLesson();
  raw.cards[2].image = { file: "File:A.jpg", alt: "again", focus: null };
  const { lesson } = L.normalizeLesson(raw, ctx());
  assert.equal(lesson.cards[2].image, undefined);
});

test("structural problems are errors", () => {
  const raw = rawLesson();
  raw.cards = raw.cards.filter((c) => c.type !== "recall");
  raw.takeaways = ["Only one."];
  const { ok, problems } = L.normalizeLesson(raw, ctx());
  assert.equal(ok, false);
  assert.ok(problems.some((p) => /recall questions/.test(p.message)));
  assert.ok(problems.some((p) => /takeaways/.test(p.message)));
});

test("an over-long card is sent back", () => {
  const raw = rawLesson();
  raw.cards[4].text = Array.from({ length: 160 }, () => "word").join(" ");
  const { ok, problems } = L.normalizeLesson(raw, ctx());
  assert.equal(ok, false);
  assert.ok(problems.some((p) => p.card === 4 && /160 words/.test(p.message)));
});

test("the first card must be the cold open", () => {
  const raw = rawLesson();
  raw.cards.unshift({ ...raw.cards[3] });
  const { ok } = L.normalizeLesson(raw, ctx());
  assert.equal(ok, false);
});

test("links only keep lessons the reader has had", () => {
  const raw = rawLesson({ extra: { links: ["themistocles", "future-lesson", "test"] } });
  const { lesson } = L.normalizeLesson(raw, ctx({ knownSlugs: ["themistocles"] }));
  assert.deepEqual(lesson.links, ["themistocles"]);
});

test("mentions keep only names the prose uses, and never fail a lesson", () => {
  const raw = rawLesson({
    extra: {
      mentions: [
        { wiki: "Athens", kind: "place", names: ["Athens", "Athenses"] },
        { wiki: "Herodotus", kind: "person", names: ["Herodotus"] }, // only inside the quote's attribution
        { wiki: "Beat", kind: "person", names: ["Beat"] }, // only in titles
        { wiki: "Story", kind: "dragon", names: ["Story"] }, // in the prose, with an unknown kind
        { wiki: "", kind: "place", names: ["Athens"] },
      ],
    },
  });
  const { ok, lesson, problems } = L.normalizeLesson(raw, ctx());
  assert.equal(ok, true, JSON.stringify(problems));
  assert.deepEqual(lesson.mentions, [
    { wiki: "Athens", kind: "place", names: ["Athens"] },
    { wiki: "Story", kind: "person", names: ["Story"] },
  ]);
  assert.equal(problems.filter((p) => /isn't linked/.test(p.message)).length, 2);
  // No mentions, no field.
  assert.equal("mentions" in L.normalizeLesson(rawLesson({ extra: { mentions: [] } }), ctx()).lesson, false);
});

test("namedIn matches whole words only, case and all", () => {
  assert.equal(L.namedIn("Without Athens' ships", "Athens"), true);
  assert.equal(L.namedIn("the Athenians", "Athens"), false);
  assert.equal(L.namedIn("Persians and Persia", "Persia"), true);
  assert.equal(L.namedIn("Persians only", "Persia"), false);
  assert.equal(L.namedIn("athens", "Athens"), false);
});

test("garbage in is a clean failure", () => {
  assert.equal(L.normalizeLesson(null, ctx()).ok, false);
  assert.equal(L.normalizeLesson({ cards: "no" }, ctx()).lesson, null);
});

test("the bundled Salamis lesson is a valid stored lesson", () => {
  // Re-normalising the stored lesson must not lose anything (no corpus: it was hand-checked).
  const { ok, lesson, problems } = L.normalizeLesson(salamis, { slug: "salamis", kind: "moment", era: "greece", teaserFor: "ostracism", knownSlugs: ["themistocles", "delphi"] });
  assert.equal(ok, true, JSON.stringify(problems.filter((p) => p.severity === "error")));
  assert.equal(lesson.cards.length, salamis.cards.length);
  assert.equal(salamis.cards.filter((c) => c.image && c.image.url).length, 11);
  for (const c of salamis.cards.filter((c) => c.image)) {
    assert.match(c.image.url, /^https:\/\/(upload|thumb)\.wikimedia\.org\//);
    assert.ok(c.image.license && c.image.artist && c.image.descUrl);
  }
  assert.equal(L.recallItems(salamis).length, 5);
  // Every person and place it links is named in the prose and was resolved.
  assert.equal(lesson.mentions.length, salamis.mentions.length);
  for (const m of salamis.mentions) {
    assert.ok(m.title && m.extract && /^https:\/\/en\.wikipedia\.org\/wiki\//.test(m.url), m.wiki);
    if (m.image) assert.ok(/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(m.image.url) && m.image.license && m.image.descUrl, m.wiki);
  }
});

test("the lesson schema is structured-output safe", () => {
  // Every object closes additionalProperties and requires all of its keys.
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(L.LESSON_SCHEMA);
});
