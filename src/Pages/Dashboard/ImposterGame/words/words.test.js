import fs from "fs";
import path from "path";

/*
 * Guards the word data. Every category file is checked on its own so a bad
 * entry names its category; run one with `-t <id>`.
 *
 * The giveaway check is mechanical — it catches a hint that reuses part of
 * the secret ("Ice Cream" → "Creamy"), not one that's merely too pointed.
 */

const MIN_WORDS = 60;
const MAX_WORDS = 120;
const HINTS_PER_WORD = 3;

const STOP = new Set([
  "the", "and", "for", "with", "from", "of", "a", "an", "in", "on", "to", "de", "la", "le", "el",
]);

const tokens = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));

// Plural first, then one more suffix, so "Boys"/"Boy" and "Creamy"/"Cream" meet.
const stem = (t) => t.replace(/(es|s)$/, "").replace(/(ing|er|ed|y)$/, "");

/** True when a hint leans on a word from the secret itself. */
const sharesRoot = (secret, hint) => {
  const a = tokens(secret);
  const b = tokens(hint);
  return a.some((x) =>
    b.some(
      (y) =>
        x === y ||
        (stem(x).length >= 3 && stem(x) === stem(y)) ||
        (x.length >= 5 && y.includes(x)) ||
        (y.length >= 5 && x.includes(y))
    )
  );
};

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".js") && f !== "index.js" && !f.endsWith(".test.js"))
  .sort();

const load = (f) => require(path.join(dir, f)).default;

test("the word directory has category files", () => {
  expect(files.length).toBeGreaterThan(0);
});

const table = files.map((f) => [f.replace(/\.js$/, ""), f]);

// `.each` throws on an empty table; the directory test above already fails then.
describe.each(table.length ? table : [["(none)", null]])("%s", (id, file) => {
  const cat = file ? load(file) : { words: [] };

  test(`${id}: metadata`, () => {
    expect(cat.id).toBe(id);
    expect(typeof cat.name).toBe("string");
    expect(cat.name.trim().length).toBeGreaterThan(0);
    expect(cat.icon).toMatch(/^fa-(solid|regular|brands) fa-[a-z0-9-]+$/);
  });

  test(`${id}: word count`, () => {
    expect(Array.isArray(cat.words)).toBe(true);
    expect(cat.words.length).toBeGreaterThanOrEqual(MIN_WORDS);
    expect(cat.words.length).toBeLessThanOrEqual(MAX_WORDS);
  });

  test(`${id}: entries are [word, hint, hint, hint]`, () => {
    const bad = cat.words.filter(
      (e) =>
        !Array.isArray(e) ||
        e.length !== HINTS_PER_WORD + 1 ||
        e.some((s) => typeof s !== "string" || s.trim() !== s || s.length === 0)
    );
    expect(bad).toEqual([]);
  });

  test(`${id}: no duplicate secret words`, () => {
    const seen = new Map();
    const dupes = [];
    cat.words.forEach(([w]) => {
      const k = w.toLowerCase();
      if (seen.has(k)) dupes.push(w);
      seen.set(k, true);
    });
    expect(dupes).toEqual([]);
  });

  test(`${id}: hints are distinct and don't give the word away`, () => {
    const problems = [];
    cat.words.forEach(([word, ...hints]) => {
      const lower = hints.map((h) => h.toLowerCase());
      if (new Set(lower).size !== lower.length) problems.push(`${word}: repeated hint`);
      hints.forEach((h) => {
        if (sharesRoot(word, h)) problems.push(`${word} → ${h}`);
      });
    });
    expect(problems).toEqual([]);
  });
});

test("category ids are unique", () => {
  const ids = files.map((f) => load(f).id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every category file sits on exactly one shelf", () => {
  // Required lazily so a single-category `-t` run doesn't need every file.
  const { CATEGORIES } = require("./index");
  const shelved = CATEGORIES.map((c) => c.id).sort();
  expect(shelved).toEqual(files.map((f) => load(f).id).sort());
});
