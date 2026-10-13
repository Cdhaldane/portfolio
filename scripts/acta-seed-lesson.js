#!/usr/bin/env node
// Check and publish a hand-written Acta lesson (a seed that skips the Claude
// pipeline). Usage:
//
//   node scripts/acta-seed-lesson.js <dir> <slug> <kind> <era> <teaserFor> [knownSlug,...]
//
// <dir> holds draft.js (the lesson in the writer's JSON shape, CommonJS),
// media.json (the gathered media list: [{ file, caption }]) and the source
// texts as *.txt (Wikipedia articles, primary-source pages). The draft runs
// through the pipeline's own normalizeLesson with those texts as the quote
// corpus, so a quote that isn't word for word fails here too. Quotations
// inside story text are checked as well. Then the Commons images are
// resolved and src/Pages/Acta/lessons/<slug>.json is written.
// Afterwards: node scripts/acta-mentions.js src/Pages/Acta/lessons/<slug>.json
// and register the file in api/_lib/acta-seed.js.
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..");
const [dirArg, slug, kind, era, teaserFor, known = ""] = process.argv.slice(2);
if (!dirArg || !slug || !kind || !era) {
  console.error("Usage: node scripts/acta-seed-lesson.js <dir> <slug> <kind> <era> <teaserFor> [knownSlug,...]");
  process.exit(2);
}
const dir = path.resolve(dirArg);
const { normalizeLesson, words } = require(path.join(repo, "api/_lib/acta-lesson"));
const { resolveImages, applyImages } = require(path.join(repo, "api/_lib/acta-sources"));
delete require.cache[path.join(dir, "draft.js")];
const draft = require(path.join(dir, "draft.js"));
const corpus = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n\n");
const media = JSON.parse(fs.readFileSync(path.join(dir, "media.json"), "utf8")).map((m) => m.file);

const { ok, lesson, problems } = normalizeLesson(draft, {
  slug, kind, era, corpus, media, teaserFor, knownSlugs: known.split(",").filter(Boolean),
});
console.log(`${slug}: ok=${ok} cards=${lesson.cards.length} minutes=${lesson.minutes} links=${JSON.stringify(lesson.links)}`);
for (const p of problems) console.log(`  ${p.severity} card ${p.card == null ? "-" : p.card + 1}: ${p.message}`);
let total = 0;
lesson.cards.forEach((c, i) => {
  const n = words(c.text) + words(c.q) + words(c.a) + (c.quote ? words(c.quote.text) : 0) + (c.sides || []).reduce((a, s) => a + words(s.text), 0) + (c.rows || []).reduce((a, r) => a + words(r.label), 0);
  total += n;
  if (n > (c.image ? 90 : 140)) console.log(`  long card ${i + 1} (${c.title || c.type}): ${n} words`);
});
console.log(`  total words ${total}`);
// Inline quotations inside story text must be verbatim too.
const { containsVerbatim } = require(path.join(repo, "api/_lib/acta-lesson"));
lesson.cards.forEach((c, i) => {
  const quoted = String(c.text || "").match(/[“"]([^”"]{12,})[”"]/g) || [];
  for (const q of quoted) {
    const inner = q.slice(1, -1).replace(/[,.]$/, "");
    if (inner.split(" ").length >= 4 && !containsVerbatim(corpus, inner)) console.log(`  NOT VERBATIM card ${i + 1}: ${inner.slice(0, 70)}`);
  }
});
if (!ok) process.exit(1);
(async () => {
  const resolved = await resolveImages(lesson.cards.filter((c) => c.image).map((c) => c.image.file));
  const out = applyImages(lesson, resolved);
  for (const c of out.cards) if (c.image) console.log(`  ${c.image.license.padEnd(16)} ${c.image.artist.slice(0, 34).padEnd(36)} ${c.image.file.slice(5, 70)}`);
  const dropped = lesson.cards.filter((c) => c.image).length - out.cards.filter((c) => c.image).length;
  if (dropped) console.log(`  DROPPED ${dropped} image(s) not on Commons`);
  fs.writeFileSync(path.join(repo, "src/Pages/Acta/lessons", `${slug}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`  written ${slug}.json`);
})();
