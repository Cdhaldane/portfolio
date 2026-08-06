#!/usr/bin/env node
/*
 * pipeline/manifest.mjs — §17.8's "content-hashed manifest.json", and the thing
 * that makes the §17.11 bundle budgets real.
 *
 *   node pipeline/manifest.mjs game/public/assets
 *   node pipeline/manifest.mjs game/public/assets -o game/public/manifest.json
 *   node pipeline/manifest.mjs game/public/assets --check   (fail on overrun)
 *
 * ── Why sizes are measured compressed ─────────────────────────────────────
 *
 * §17.11's table is explicitly "Budget (compressed)", and the gap is not small:
 * a meshopt-encoded glTF is already entropy-dense and barely compresses, while
 * a JSON chunk halves. Measuring raw bytes would fail assets that are fine and
 * pass ones that are not. Brotli at quality 11 is what a static host serves for
 * precompressed assets, so that is what is measured.
 *
 * The manifest carries a content hash per file so the runtime can cache
 * aggressively and bust precisely — the §17.11 streaming plan ("act bundles
 * stream during camp/offer screens") only works if a returning player is not
 * re-downloading Act I.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, stat, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* §17.11, verbatim. Budgets are compressed bytes. */
const BUNDLES = {
  boot: { limit: 1.8e6, label: "Boot", firstPlayable: true },
  core: { limit: 6e6, label: "Core", firstPlayable: true },
  act1: { limit: 9e6, label: "Act I" },
  act2: { limit: 8e6, label: "Act II" },
  act3: { limit: 8e6, label: "Act III" },
  audio: { limit: 14e6, label: "Audio" },
};
const TOTAL_LIMIT = 45e6;
const FIRST_PLAYABLE_LIMIT = 8e6;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

const mb = (n) => `${(n / 1e6).toFixed(2)}MB`;

/* Assets already stored in a compressed container gain nothing from brotli and
 * cost real time to try — measure them as-is. */
const PRECOMPRESSED = /\.(ktx2|basis|png|jpg|jpeg|webp|avif|mp3|ogg|opus|m4a|woff2?|zip)$/i;

async function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const p = stack.pop();
    for (const e of await readdir(p, { withFileTypes: true })) {
      const full = join(p, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name !== "manifest.json") out.push(full);
    }
  }
  return out.sort();
}

/** Bundle is the first path segment; anything else is "unassigned". */
function bundleOf(relPath) {
  const first = relPath.split(posix.sep)[0];
  return first in BUNDLES ? first : "unassigned";
}

async function main() {
  const opts = { out: null, check: false, quiet: false };
  const inputs = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "--check") opts.check = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else inputs.push(a);
  }
  if (inputs.length !== 1) throw new Error("give exactly one asset directory");

  const root = resolve(inputs[0]);
  const st = await stat(root).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`${inputs[0]} is not a directory`);

  const files = await walk(root);
  if (!files.length) throw new Error(`no assets found under ${inputs[0]}`);

  const entries = [];
  for (const file of files) {
    const buf = await readFile(file);
    const rel = relative(root, file).split(sep).join(posix.sep);
    const compressed = PRECOMPRESSED.test(file)
      ? buf.length
      : brotliCompressSync(buf, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        }).length;

    entries.push({
      path: rel,
      bundle: bundleOf(rel),
      bytes: buf.length,
      compressed,
      hash: createHash("sha256").update(buf).digest("hex").slice(0, 16),
    });
  }

  const byBundle = new Map();
  for (const e of entries) {
    if (!byBundle.has(e.bundle)) byBundle.set(e.bundle, []);
    byBundle.get(e.bundle).push(e);
  }

  const manifest = {
    version: 1,
    generatedBy: "pipeline/manifest.mjs",
    note: "Sizes are bytes; `compressed` is brotli-11, matching the §17.11 budget table.",
    bundles: Object.fromEntries(
      [...byBundle.entries()].map(([name, list]) => [
        name,
        {
          label: BUNDLES[name]?.label ?? name,
          limit: BUNDLES[name]?.limit ?? null,
          compressed: list.reduce((n, e) => n + e.compressed, 0),
          bytes: list.reduce((n, e) => n + e.bytes, 0),
          files: list.length,
        },
      ]),
    ),
    assets: entries,
  };

  const outPath = opts.out ? resolve(opts.out) : join(root, "manifest.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // ------------------------------------------------------------- reporting

  console.log(`\n${c.b("Manifest")} — ${entries.length} asset(s) → ${relative(process.cwd(), outPath)}\n`);

  const problems = [];
  let total = 0;
  let firstPlayable = 0;

  for (const name of [...Object.keys(BUNDLES), "unassigned"]) {
    const list = byBundle.get(name);
    if (!list) continue;
    const size = list.reduce((n, e) => n + e.compressed, 0);
    total += size;
    const spec = BUNDLES[name];
    if (spec?.firstPlayable) firstPlayable += size;

    if (!spec) {
      console.log(
        `  ${c.warn("?".padEnd(4))} ${c.b(name.padEnd(12))} ${mb(size).padStart(9)}  ` +
          c.dim(`${list.length} file(s) in no §17.11 bundle`),
      );
      problems.push(`${list.length} asset(s) are outside every bundle — they will never be scheduled to load`);
      continue;
    }

    const over = size > spec.limit;
    const pctUsed = (size / spec.limit) * 100;
    if (over) problems.push(`${spec.label} is ${mb(size)} against a ${mb(spec.limit)} budget`);
    console.log(
      `  ${over ? c.bad("OVER") : c.ok(" ok ")} ${c.b(spec.label.padEnd(12))} ` +
        `${mb(size).padStart(9)} / ${mb(spec.limit).padEnd(8)} ` +
        c.dim(`${pctUsed.toFixed(0)}% · ${list.length} file(s)`),
    );
  }

  console.log();
  const totalOver = total > TOTAL_LIMIT;
  const fpOver = firstPlayable > FIRST_PLAYABLE_LIMIT;
  if (totalOver) problems.push(`total is ${mb(total)} against a ${mb(TOTAL_LIMIT)} budget`);
  if (fpOver) {
    problems.push(`first-playable is ${mb(firstPlayable)} against a ${mb(FIRST_PLAYABLE_LIMIT)} budget`);
  }

  console.log(
    `  ${totalOver ? c.bad("OVER") : c.ok(" ok ")} ${c.b("Total".padEnd(12))} ` +
      `${mb(total).padStart(9)} / ${mb(TOTAL_LIMIT)}`,
  );
  console.log(
    `  ${fpOver ? c.bad("OVER") : c.ok(" ok ")} ${c.b("→ playable".padEnd(12))} ` +
      `${mb(firstPlayable).padStart(9)} / ${mb(FIRST_PLAYABLE_LIMIT)}  ` +
      c.dim("(boot + core, before the player can do anything)"),
  );

  if (problems.length) {
    console.log(`\n${c.bad("Budget problems")}`);
    for (const p of problems) console.log(`  ${c.bad("×")} ${p}`);
    console.log();
    return opts.check ? 1 : 0;
  }

  console.log(`\n${c.ok("Within every §17.11 budget.")}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`\n${c.bad("manifest failed")} — ${e.message}\n`);
      process.exit(1);
    },
  );
}
