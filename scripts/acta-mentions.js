#!/usr/bin/env node
// Resolve the people and places a hand-written Acta lesson names, in place.
// Seed lessons skip the pipeline, so nothing else fetches Wikipedia's
// summaries for them; generated lessons get the same thing in finish().
//
//   node scripts/acta-mentions.js src/Pages/Acta/lessons/salamis.json [more.json …]
//
// Each file's `mentions` ({ wiki, kind, names }) gain title, description,
// extract, url and a Commons picture with its credit. Missing articles,
// disambiguation pages and the lesson's own Wikipedia sources are dropped,
// and so are names the cards' prose doesn't use. Safe to re-run after edits:
// it always starts again from wiki/kind/names. Touches no database.
const fs = require("fs");
const path = require("path");
const { normalizeLesson } = require("../api/_lib/acta-lesson");
const { resolveMentions } = require("../api/_lib/acta-sources");

/** The article titles a lesson was written from: its own subject, never linked. */
function ownArticles(lesson) {
  const out = [];
  for (const s of lesson.sources || []) {
    const m = /^https:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/.exec(s.url || "");
    if (m) out.push(decodeURIComponent(m[1]).replace(/_/g, " "));
  }
  return out;
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Usage: node scripts/acta-mentions.js <lesson.json> [more.json …]");
  for (const file of files) {
    const abs = path.resolve(file);
    const lesson = JSON.parse(fs.readFileSync(abs, "utf8"));
    // The normaliser keeps only names the prose really uses (and the raw shape).
    const { lesson: clean, problems } = normalizeLesson(lesson, { slug: lesson.slug, kind: lesson.kind, era: lesson.era });
    for (const p of problems.filter((x) => /linked/.test(x.message))) console.log(`  ! ${p.message}`);
    const asked = (clean && clean.mentions) || [];
    const resolved = await resolveMentions(asked, { exclude: ownArticles(lesson) });
    const kept = new Set(resolved.map((m) => m.wiki));
    for (const m of asked) if (!kept.has(m.wiki)) console.log(`  ! ${m.wiki}: no article, a disambiguation page, merged, or the lesson's own subject`);
    const { mentions, ...rest } = lesson;
    fs.writeFileSync(abs, `${JSON.stringify(resolved.length ? { ...rest, mentions: resolved } : rest, null, 1)}\n`);
    console.log(`${path.basename(file)}: ${resolved.length} of ${asked.length} linked, ${resolved.filter((m) => m.image).length} with pictures`);
    for (const m of resolved) console.log(`  ${m.kind.padEnd(6)} ${m.names.join(" / ").padEnd(28)} → ${m.title}${m.description ? ` (${m.description})` : ""}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
