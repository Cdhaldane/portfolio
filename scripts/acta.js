#!/usr/bin/env node
// Acta Diurna from the terminal: the same pipeline the cron and the desk run,
// against whatever database .env.local points at. Handy for seeding the first
// week without waiting on the daily cron.
//
//   npm run acta -- status                 seasons and lessons at a glance
//   npm run acta -- propose ["a hint"]     ask Claude for the next season
//   npm run acta -- approve <seasonId>     schedule a proposed season
//   npm run acta -- advance                one pipeline pass
//   npm run acta -- advance --loop         keep passing every 60 s until nothing is in flight
//
// Needs POSTGRES_URL and ANTHROPIC_API_KEY (in .env.local). Every Claude step
// is billed to that key. Prints which database host it's about to touch.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env.local") });

const { getSql, createStore } = require("../api/_lib/acta-db");
const { createPipeline } = require("../api/_lib/acta-pipeline");
const claude = require("../api/_lib/acta-claude");
const sources = require("../api/_lib/acta-sources");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_FLIGHT = ["queued", "gathered", "researching", "researched", "writing", "written", "checking", "revising"];

async function main() {
  const [cmd = "status", ...args] = process.argv.slice(2);
  const sql = getSql();
  if (!sql) throw new Error("POSTGRES_URL isn't set (.env.local).");
  try {
    console.log(`Database: ${new URL(process.env.POSTGRES_URL).hostname}`);
  } catch (_) {
    /* unparseable URL: the driver will complain */
  }
  const store = createStore(sql);
  await store.ensure();
  const pipeline = createPipeline({ store, claude, sources });

  if (cmd === "status") {
    for (const s of await store.listSeasons()) console.log(`Season ${s.number} [${s.status}] #${s.id} ${s.title} (${s.span})`);
    const lessons = await store.listLessons();
    for (const l of lessons) {
      const issues = (l.issues || []).filter((i) => i.severity === "error").length;
      console.log(`  ${l.publish_on}  day ${String(l.day).padStart(3)}  ${l.status.padEnd(12)} ${l.held ? "HELD " : ""}${l.lesson_title || l.topic_title}${issues ? `  (${issues} errors)` : ""}${l.error ? `  ! ${l.error}` : ""}`);
    }
    if (!lessons.length) console.log("No lessons scheduled. Approve a season: npm run acta -- approve <seasonId>");
    return;
  }

  if (cmd === "propose") {
    const s = await pipeline.proposeSeason({ hint: args.join(" ") });
    console.log(`Proposed season ${s.number} #${s.id}: ${s.title}`);
    for (const t of s.topics) console.log(`  ${t.position}`.padEnd(5), t.kind.padEnd(10), t.title, t.warning ? `  ! ${t.warning}` : "");
    return;
  }

  if (cmd === "approve") {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) throw new Error("Usage: npm run acta -- approve <seasonId>");
    const r = await pipeline.approveSeason(id);
    console.log(`Scheduled from ${r.start}.`);
    return;
  }

  if (cmd === "advance") {
    const loop = args.includes("--loop");
    for (;;) {
      const r = await pipeline.advance({ budgetMs: 10 * 60 * 1000 });
      if (r.busy) console.log("Another pass holds the lock; waiting.");
      for (const s of r.steps) console.log(`  ${s.slug}: ${s.from}${s.to ? ` → ${s.to}` : ""}${s.wait ? ` (${s.wait})` : ""}${s.note ? ` · ${s.note}` : ""}${s.error ? ` ! ${s.error}` : ""}`);
      if (!loop || r.stopped) return;
      const pending = (await store.activeLessons()).filter((l) => IN_FLIGHT.includes(l.status) && !(l.status === "queued" && r.steps.some((s) => s.slug === l.slug && s.wait)));
      if (!pending.length && !r.busy) {
        console.log("Nothing left in flight.");
        return;
      }
      await sleep(60000);
    }
  }

  throw new Error(`Unknown command "${cmd}". Try status, propose, approve or advance.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.payload ? e.payload.error : e.message);
    process.exit(1);
  }
);
