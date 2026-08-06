#!/usr/bin/env node
/*
 * pipeline/art.mjs — §17.8's "one command".
 *
 *   npm run art                    full rebuild
 *   npm run art:one -- coffin      single asset — TARGET: under 15 seconds (§21 M4)
 *   npm run art:import -- <file>   normalize + check a fresh generation
 *
 * The chain, and why it is in this order:
 *
 *   delight      → strip baked lighting while the texture is still per-material
 *   palette_lock → pull the de-lit albedo toward the 14 swatches (§17.9)
 *   optimize     → dedup/weld/join/simplify/meshopt + LODs
 *   budget_check → FAIL THE BUILD on any §17.7 violation
 *   manifest     → content hashes + the §17.11 bundle budgets
 *
 * De-light before palette-lock is not arbitrary. The lock maps each pixel to a
 * palette target, and a pixel darkened by baked shadow maps to a *different*
 * swatch than the same material lit — so locking first bakes the lighting into
 * the palette assignment permanently. Strip the light, then decide the colour.
 *
 * Budget check runs on the **optimized** output rather than the source, because
 * that is what ships: LOD triangle counts, quantized bounds and the external
 * texture layout are all properties of the output, and none of them exist yet
 * at source time.
 *
 * ── The 15-second target ──────────────────────────────────────────────────
 *
 * §21 M4's exit criterion is `npm run art:one` under 15 seconds, and §22 R10
 * treats it as a real requirement rather than a nicety: an iteration loop that
 * takes a minute is one nobody uses, and the cohesion pass in §17.9 depends on
 * looking at an asset next to its neighbours over and over. Every run prints
 * its own wall-clock against that budget.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/* §17.8's tree. `art/` is gitignored (Appendix B); `game/public/assets/` is
 * build output and likewise not committed. */
const ART = join(ROOT, "art");
const OUT = join(ROOT, "game", "public", "assets");
const WORK = join(ROOT, "pipeline", ".work");

const TARGET_SECONDS = 15;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

function run(script, args, { quiet = true } = {}) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(HERE, script), ...args], {
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      cwd: ROOT,
    });
    let out = "";
    if (quiet) {
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
    }
    p.on("close", (code) => res({ code: code ?? 1, out }));
    p.on("error", (e) => res({ code: 1, out: e.message }));
  });
}

const exists = (p) => stat(p).then(() => true, () => false);

/**
 * Load the §17.11 bundle rules. Kept as committed data (pipeline/bundles.json)
 * rather than code, because which act an asset belongs to is a design decision
 * that should be reviewable in a diff.
 */
async function loadBundleRules() {
  const raw = JSON.parse(await readFile(join(HERE, "bundles.json"), "utf8"));
  return raw.rules.map((r) => ({ ...r, re: new RegExp(r.match) }));
}

const CACHE = join(WORK, "textures.json");

/**
 * Content-hash every source texture and compare against the last successful run.
 *
 * Keyed on content, not mtime: a git checkout or a file copy rewrites mtimes
 * without changing a pixel, and re-running a 5-second pass because of that is
 * exactly the friction §22 R10 warns kills the iteration loop.
 */
async function texturesChanged(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const p = stack.pop();
    for (const e of await readdir(p, { withFileTypes: true })) {
      const full = join(p, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/\.png$/i.test(e.name)) files.push(full);
    }
  }
  files.sort();

  const hashes = {};
  for (const f of files) {
    hashes[relative(ART, f).split(sep).join("/")] = createHash("sha256")
      .update(await readFile(f))
      .digest("hex")
      .slice(0, 16);
  }

  let previous = null;
  try {
    previous = JSON.parse(await readFile(CACHE, "utf8"));
  } catch {
    /* No cache yet — first run always does the work. */
  }

  const changed =
    !previous ||
    Object.keys(hashes).length !== Object.keys(previous).length ||
    Object.entries(hashes).some(([k, v]) => previous[k] !== v);

  return { changed, hashes, count: files.length };
}

async function recordTextures(hashes) {
  await mkdir(WORK, { recursive: true });
  await writeFile(CACHE, `${JSON.stringify(hashes, null, 2)}
`, "utf8");
}

/** First matching rule wins; null means "no rule", which manifest.mjs fails on. */
function bundleFor(relPath, rules) {
  const norm = relPath.split(sep).join("/");
  return rules.find((r) => r.re.test(norm))?.bundle ?? null;
}

async function findAssets(dir, pattern) {
  if (!(await exists(dir))) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const p = stack.pop();
    for (const e of await readdir(p, { withFileTypes: true })) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        if (e.name !== "gen") stack.push(full); // art/gen is raw output, never shipped
      } else if (/\.(glb|gltf)$/i.test(e.name) && !/_LOD\d/i.test(e.name)) {
        if (!pattern || basename(e.name, extname(e.name)).includes(pattern)) out.push(full);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------- steps

async function step(label, fn) {
  const t0 = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const ok = result.code === 0;
  console.log(
    `  ${ok ? c.ok("✓") : c.bad("✗")} ${label.padEnd(16)} ${c.dim(`${(ms / 1000).toFixed(2)}s`)}` +
      (result.note ? `  ${c.dim(result.note)}` : ""),
  );
  if (!ok && result.out) {
    console.log(
      result.out
        .split("\n")
        .filter(Boolean)
        .slice(-12)
        .map((l) => `      ${l}`)
        .join("\n"),
    );
  }
  return { ok, ms, ...result };
}

async function build({ pattern, verbose }) {
  const t0 = process.hrtime.bigint();
  const label = pattern ? `art:one ${pattern}` : "art (full rebuild)";
  console.log(`\n${c.b(label)}\n`);

  const sources = await findAssets(ART, pattern);
  const textures = await exists(join(ART, "textures"));

  if (!sources.length && !textures) {
    console.log(
      `  ${c.warn("nothing to build")} — ${c.dim("art/ has no matching .glb/.gltf and no textures/")}\n`,
    );
    console.log(
      c.dim(
        "  art/ is gitignored by design (Appendix B): sources live in cloud storage.\n" +
          "  Until they land, exercise the chain against a vendored pack, e.g.\n" +
          `    node pipeline/optimize.mjs "pipeline/vendor/<pack>/extracted/Models/GLB format" -r --out ${OUT}\n`,
      ),
    );
    return 0;
  }

  await mkdir(WORK, { recursive: true });
  const rules = await loadBundleRules();
  const steps = [];

  if (textures) {
    /* The texture passes dominate wall-clock — 7.5s of a 9.4s single-asset run,
     * against a 15s budget that has to survive §17.7's eight atlases. They are
     * also the passes least likely to have changed: the common iteration is
     * geometry, not albedo. So skip them outright when no source texture has
     * changed since the last run, keyed on content rather than mtime (a git
     * checkout rewrites mtimes without changing a pixel). */
    const fresh = await texturesChanged(join(ART, "textures"));
    if (!fresh.changed) {
      console.log(
        `  ${c.dim("–")} ${"delight".padEnd(16)} ${c.dim("cached")}\n` +
          `  ${c.dim("–")} ${"palette_lock".padEnd(16)} ${c.dim(`cached (${fresh.count} texture(s) unchanged)`)}`,
      );
    } else {
      steps.push(
        await step("delight", async () =>
          run("delight.mjs", [join(ART, "textures"), "-r", "--out", join(WORK, "tex")]),
        ),
      );
      steps.push(
        await step("palette_lock", async () => {
          const src = (await exists(join(WORK, "tex"))) ? join(WORK, "tex") : join(ART, "textures");
          return run("palette_lock.mjs", [src, "-r", "--out", join(WORK, "tex-locked")]);
        }),
      );
      if (steps.every((s) => s.ok)) await recordTextures(fresh.hashes);
    }
  }

  if (sources.length) {
    /* Group by §17.11 bundle before optimizing, so each asset lands in the
     * directory manifest.mjs reads its bundle from. Unassigned assets are still
     * built — manifest.mjs is the one place that decides they are a failure. */
    const grouped = new Map();
    const unassigned = [];
    for (const src of sources) {
      const bundle = bundleFor(relative(ART, src), rules);
      if (!bundle) unassigned.push(src);
      const key = bundle ?? "unassigned";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(src);
    }

    steps.push(
      await step("optimize", async () => {
        let code = 0;
        let out = "";
        for (const [bundle, list] of grouped) {
          const r = await run("optimize.mjs", [...list, "--out", join(OUT, bundle)], {
            quiet: !verbose,
          });
          code ||= r.code;
          out += r.out;
        }
        const note =
          `${sources.length} asset(s) → ${[...grouped.keys()].join(", ")}` +
          (unassigned.length ? `  ${c.warn(`${unassigned.length} unassigned`)}` : "");
        return { code, out, note };
      }),
    );

    if (unassigned.length) {
      console.log(
        c.dim(
          `      ${unassigned.length} asset(s) match no rule in pipeline/bundles.json:\n` +
            unassigned
              .slice(0, 5)
              .map((u) => `        ${relative(ART, u)}`)
              .join("\n"),
        ),
      );
    }

    steps.push(
      await step("budget_check", async () => run("budget_check.mjs", [OUT, "-r", "--quiet"])),
    );
  }

  steps.push(await step("manifest", async () => run("manifest.mjs", [OUT, "--check"])));

  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  const failed = steps.filter((s) => !s.ok);

  console.log();
  if (pattern) {
    /* Only the single-asset loop is held to the M4 number; a full rebuild is
     * allowed to take as long as it takes. */
    const within = seconds <= TARGET_SECONDS;
    console.log(
      `  ${within ? c.ok("within budget") : c.warn("over budget")} ` +
        `${seconds.toFixed(2)}s / ${TARGET_SECONDS}s  ${c.dim("(§21 M4 exit criterion)")}`,
    );
  } else {
    console.log(`  ${c.dim(`total ${seconds.toFixed(2)}s`)}`);
  }

  if (failed.length) {
    console.log(`\n${c.bad(`${failed.length} step(s) failed.`)} ${c.dim("Nothing was published.")}\n`);
    return 1;
  }
  console.log(`\n${c.ok("Build clean.")} ${c.dim(`Output: ${relative(ROOT, OUT)}`)}\n`);
  return 0;
}

// ------------------------------------------------------------------- import

/**
 * `art:import` — the front door for a fresh AI generation.
 *
 * §17.8 pairs this with `normalize.py`, which needs Blender and does not exist
 * yet. Until it does, this reports what normalization *would* have to fix rather
 * than pretending the asset is ready: scale, pivot, orientation and naming are
 * exactly the things generated meshes get wrong (§17.4).
 */
async function importAsset(file) {
  console.log(`\n${c.b("art:import")} ${basename(file)}\n`);
  if (!(await exists(file))) throw new Error(`${file} does not exist`);

  const r = await run("budget_check.mjs", [file]);
  console.log(r.out.trimEnd());
  console.log(
    c.dim(
      "\n  Fixes for scale/pivot/orientation belong in pipeline/normalize.py, which\n" +
        "  needs Blender and is not written yet. Until then this is a report, not a fix.\n",
    ),
  );
  return 0;
}

// ---------------------------------------------------------------------- cli

async function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.includes("--verbose");
  const rest = argv.filter((a) => a !== "--verbose");
  const mode = rest[0];

  if (mode === "import") {
    if (!rest[1]) throw new Error("art:import needs a file");
    return importAsset(resolve(rest[1]));
  }
  if (mode === "one") {
    if (!rest[1]) throw new Error("art:one needs an asset name, e.g. `npm run art:one -- hero`");
    return build({ pattern: rest[1], verbose });
  }
  if (mode && mode !== "all") throw new Error(`unknown mode "${mode}" — use all | one | import`);
  return build({ pattern: null, verbose });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`\n${c.bad("art failed")} — ${e.message}\n`);
    process.exit(1);
  },
);
