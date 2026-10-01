const test = require("node:test");
const assert = require("node:assert/strict");
const { PACK_IDS, LIMITS, cleanText, validatePack } = require("./top5-normalize");

const card = (n, extra = {}) => ({
  id: `pick-${n}`,
  title: `Pick number ${n}`,
  meta: "1998 · Someone",
  icon: "fa-star",
  take: "A hot take that fits on the card.",
  stats: [7, 8, 9],
  fun: "Rewatched 14×",
  ...extra,
});

const body = (packOverrides = {}, cards = [1, 2, 3, 4, 5].map((n) => card(n))) => ({
  packId: "movies",
  pack: {
    name: "Movies",
    tagline: "Feature Presentation",
    statLabels: ["Rewatch", "Quotes", "Vibes"],
    cards,
    ...packOverrides,
  },
});

test("accepts a complete pack and returns only known fields", () => {
  const input = body();
  input.pack.sneaky = "<script>";
  input.pack.cards[0].onclick = "alert(1)";
  const r = validatePack(input);
  assert.equal(r.ok, true);
  assert.equal(r.value.packId, "movies");
  assert.deepEqual(Object.keys(r.value.pack).sort(), ["cards", "name", "statLabels", "tagline"]);
  assert.deepEqual(Object.keys(r.value.pack.cards[0]).sort(), ["fun", "icon", "id", "meta", "stats", "take", "title"]);
});

test("keeps emoji joiners intact", () => {
  assert.equal(cleanText("Chef \u{1F9D1}\u200d\u{1F373} approved"), "Chef \u{1F9D1}\u200d\u{1F373} approved");
  assert.equal(cleanText("\u{1F937}\u200d\u2642\ufe0f"), "\u{1F937}\u200d\u2642\ufe0f");
});

test("cleans whitespace and control characters", () => {
  assert.equal(cleanText("  The\n\tBig   Lebowski  "), "The Big Lebowski");
  assert.equal(cleanText("A\u0000B\u202eC\u200bD"), "A BCD");
  assert.equal(cleanText(42), null);
  const r = validatePack(body({ name: "  Movies \n" }));
  assert.equal(r.value.pack.name, "Movies");
});

test("rejects unknown packs and malformed bodies", () => {
  assert.equal(validatePack(null).ok, false);
  assert.equal(validatePack({}).ok, false);
  assert.equal(validatePack({ ...body(), packId: "nope" }).ok, false);
  assert.equal(validatePack({ ...body(), packId: "__proto__" }).ok, false);
  assert.equal(validatePack({ packId: "movies", pack: "x" }).ok, false);
});

test("every pack id the page ships is editable", () => {
  assert.deepEqual(PACK_IDS, ["movies", "food", "albums", "games", "tv", "places", "snacks", "party", "bugs"]);
});

test("enforces the card layout's text budgets", () => {
  const long = (n) => "x".repeat(n);
  assert.equal(validatePack(body({ name: long(LIMITS.packName + 1) })).ok, false);
  assert.equal(validatePack(body({ tagline: long(LIMITS.tagline + 1) })).ok, false);
  assert.equal(validatePack(body({ name: "" })).ok, false);
  const tooLong = [1, 2, 3, 4, 5].map((n) => card(n, n === 3 ? { title: long(LIMITS.title + 1) } : {}));
  const r = validatePack(body({}, tooLong));
  assert.equal(r.ok, false);
  assert.match(r.error, /#3/);
  assert.equal(validatePack(body({}, [1, 2, 3, 4, 5].map((n) => card(n, { take: long(LIMITS.take + 1) })))).ok, false);
  assert.equal(validatePack(body({}, [1, 2, 3, 4, 5].map((n) => card(n, { take: "  " })))).ok, false);
  // meta and fun may be empty
  assert.equal(validatePack(body({}, [1, 2, 3, 4, 5].map((n) => card(n, { meta: "", fun: "" })))).ok, true);
});

test("needs exactly three stat labels and five cards", () => {
  assert.equal(validatePack(body({ statLabels: ["A", "B"] })).ok, false);
  assert.equal(validatePack(body({ statLabels: ["A", "B", "x".repeat(LIMITS.statLabel + 1)] })).ok, false);
  assert.equal(validatePack(body({}, [1, 2, 3, 4].map((n) => card(n)))).ok, false);
  assert.equal(validatePack(body({}, [1, 2, 3, 4, 5, 6].map((n) => card(n)))).ok, false);
});

test("icons and ids are locked to safe patterns", () => {
  const bad = (extra) => validatePack(body({}, [1, 2, 3, 4, 5].map((n) => card(n, n === 1 ? extra : {})))).ok;
  assert.equal(bad({ icon: "fa-star extra-class" }), false);
  assert.equal(bad({ icon: "star" }), false);
  assert.equal(bad({ icon: 'fa-x" onload="' }), false);
  assert.equal(bad({ id: "Has Spaces" }), false);
  assert.equal(bad({ id: "pick-2" }), false); // duplicate id inside the pack
});

test("stats are three whole numbers from 0 to 10", () => {
  const withStats = (stats) =>
    validatePack(body({}, [1, 2, 3, 4, 5].map((n) => card(n, n === 2 ? { stats } : {}))));
  assert.equal(withStats([0, 5, 10]).ok, true);
  assert.equal(withStats([11, 5, 5]).ok, false);
  assert.equal(withStats([-1, 5, 5]).ok, false);
  assert.equal(withStats([1.5, 5, 5]).ok, false);
  assert.equal(withStats(["7", 5, 5]).ok, false);
  assert.equal(withStats([5, 5]).ok, false);
});
