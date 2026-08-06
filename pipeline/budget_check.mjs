#!/usr/bin/env node
/*
 * pipeline/budget_check.mjs — the starred rules, enforced by the build.
 *
 * §17.7's framing is the point: budgets are "enforced by the build, not by
 * willpower". Every ★ rule in `art-recipes/prompts/character-model.md` §3 that
 * can be decided from a glTF file is decided here, and the exit code is what
 * makes it real.
 *
 *   node pipeline/budget_check.mjs <file|dir>... [--class prop] [--json]
 *   node pipeline/budget_check.mjs art/ -r --summary
 *
 * Asset class is inferred from the §17.7 naming convention and can be overridden
 * with --class. Anything unrecognised is checked against the prop budget, which
 * is the tightest sensible default.
 *
 * ── What is deliberately NOT checked ──────────────────────────────────────
 *
 * Some starred rules are not decidable from geometry, and claiming otherwise
 * would be worse than not checking:
 *
 * - **Eye line 1.620m** needs a rig landmark, not a bounding box. Reported as
 *   unverifiable on skinned assets rather than guessed from height.
 * - **Forward is −Z** cannot be read off a symmetric mesh. A hat and a coat look
 *   the same to a bounding box.
 * - **Silhouette reads at 64px** is a human judgement and always will be.
 *
 * Everything else in the ★ list is checked here, including de-lit albedo and
 * palette conformance — for both embedded and external textures, since
 * `optimize.mjs` writes external ones by default.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readGltf, survey, texelDensity } from "./lib/gltf.mjs";
import { decodePng } from "./lib/png.mjs";
import { RESERVED, assertMatchesGame, conformance, selectSwatches } from "./lib/palette.mjs";
import { lightingVariance } from "./delight.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/* §17.7 budget table plus the character brief's §3 rules. `tris` is a hard
 * ceiling; `minTris` catches an asset that is suspiciously empty. */
const CLASSES = {
  hero: { tris: 24000, materials: 1, texel: 128, height: [1.795, 1.805], width: 0.8, uv1: false },
  heroBase: { tris: 9000, materials: 1, texel: 128, height: [1.795, 1.805], width: 0.8, uv1: false },
  kit: { tris: 12000, materials: 1, texel: 128, uv1: false },
  weapon: { tris: 3000, materials: 1, texel: 256, uv1: false },
  boss: { tris: 20000, materials: 1, texel: 128, uv1: false },
  elite: { tris: 8000, materials: 1, texel: 128, uv1: false },
  humanoidBase: { tris: 1800, materials: 1, texel: 128, height: [1.7, 1.9], uv1: false },
  prop: { tris: 1500, materials: 1, texel: 64, uv1: true },
  trap: { tris: 1200, minTris: 400, materials: 1, texel: 128, uv1: true },
  chunk: { tris: 8000, minTris: 3000, materials: 3, texel: 64, uv1: true },
};

/** §17.7 naming convention → class. */
function inferClass(name) {
  const stem = basename(name, extname(name));
  if (/^SK_HeroBase/i.test(stem)) return "heroBase";
  if (/^SM_Kit_/i.test(stem)) return "kit";
  if (/^SM_Wpn_/i.test(stem)) return "weapon";
  if (/^SK_Boss/i.test(stem)) return "boss";
  if (/^SK_Humanoid/i.test(stem)) return "humanoidBase";
  if (/^SM_Trap_/i.test(stem)) return "trap";
  if (/^SM_Chunk_/i.test(stem)) return "chunk";
  if (/^SM_/i.test(stem)) return "prop";
  return null;
}

const NAMING = /^(SM|SK|AN|T|COL)_[A-Za-z0-9]+/;

/* Stops of baked lighting. Above DELIT the albedo still carries illumination;
 * above ATLAS it is a packed sheet and the measure means something else
 * entirely. Both calibrated in delight.mjs against real vendored textures. */
const DELIT_STOPS = 0.5;
const ATLAS_STOPS = 1.0;

/**
 * Return the material's base-colour image, from wherever it lives.
 *
 * glTF stores an image either as a `bufferView` into the binary chunk (embedded,
 * what `.glb` produces) or as a `uri` relative to the document (external, what
 * `optimize.mjs` produces by default). Both are normal; a checker that handles
 * only one silently skips half the build.
 */
async function resolveImage(gltf, docPath) {
  const img = gltf.json.images?.[0];
  if (!img) return null;

  let bytes = null;
  if (img.bufferView !== undefined && gltf.bin) {
    const view = gltf.json.bufferViews[img.bufferView];
    bytes = gltf.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  } else if (img.uri && !img.uri.startsWith("data:")) {
    try {
      bytes = await readFile(join(dirname(docPath), decodeURIComponent(img.uri)));
    } catch {
      return { png: null, missing: img.uri };
    }
  }
  if (!bytes) return null;

  try {
    return { png: decodePng(bytes) };
  } catch {
    /* JPEG or an exotic PNG flavour — readable by the engine, not by us. */
    return { png: null };
  }
}

// ------------------------------------------------------------------ checking

async function checkFile(path, forcedClass, swatches) {
  const gltf = await readGltf(path);
  const s = survey(gltf);
  const name = basename(path);
  const inferred = forcedClass ?? inferClass(name);
  const cls = inferred ?? "prop";
  const rules = CLASSES[cls];
  if (!rules) throw new Error(`unknown class "${cls}" — valid: ${Object.keys(CLASSES).join(", ")}`);

  const fail = [];
  const warn = [];
  const info = [];

  // ★ triangle budget
  if (s.triangles > rules.tris) {
    fail.push(`${s.triangles} tris exceeds the ${cls} budget of ${rules.tris}`);
  }
  if (rules.minTris && s.triangles < rules.minTris) {
    warn.push(`${s.triangles} tris is under the ${cls} floor of ${rules.minTris}`);
  }

  // ★ one material per asset
  if (s.materials > rules.materials) {
    fail.push(`${s.materials} materials, budget is ${rules.materials}`);
  }

  // ★ UV0 only for characters; UV1 is the env lightmap channel
  if (!s.uvSets.includes("TEXCOORD_0")) fail.push("no TEXCOORD_0 — asset is unmapped");
  if (!rules.uv1 && s.uvSets.includes("TEXCOORD_1")) {
    fail.push(`has TEXCOORD_1; ${cls} assets get no lightmap UV`);
  }

  // ★ transforms applied
  if (s.negativeScale) fail.push("negative scale — mirror is unapplied");
  if (s.nonUniformScale && !s.quantized) fail.push("non-uniform scale on a node");
  else if (s.unappliedScale && !s.quantized) {
    warn.push("node scale is not 1 — transforms may be unapplied");
  }

  // normals
  if (!s.hasNormals) warn.push("no NORMAL attribute — weighted normals not exported");

  // ★ dimensions and pivot
  if (s.bounds) {
    const [w, h, d] = s.bounds.size;
    if (rules.height) {
      const [lo, hi] = rules.height;
      if (h < lo || h > hi) fail.push(`height ${h.toFixed(3)}m outside ${lo}–${hi}m`);
    }
    if (rules.width && Math.max(w, d) > rules.width + 1e-3) {
      fail.push(`footprint ${Math.max(w, d).toFixed(3)}m exceeds the ${rules.width}m cylinder`);
    }
    /* +Y up on export, so "feet at Z=0" in Blender lands as minY≈0 here. A
     * prop floating above or sunk below its own origin is the single most
     * common export slip. */
    const minY = s.bounds.min[1];
    if (Math.abs(minY) > 0.01) {
      (Math.abs(minY) > 0.1 ? fail : warn).push(
        `base sits at y=${minY.toFixed(3)}m, expected 0 (pivot at the feet/base)`,
      );
    }
  } else {
    warn.push("no POSITION bounds — cannot verify scale or pivot");
  }

  // ★ naming convention
  if (!NAMING.test(basename(name, extname(name)))) {
    warn.push(`"${name}" does not match SM_/SK_/AN_/T_/COL_ naming`);
  }
  if (!inferred) info.push("class not inferable from the name; checked as a prop");

  /* Resolve the base-colour image once, from either storage form.
   *
   * `optimize.mjs` writes external textures by default (so a shared atlas is
   * stored once rather than copied into every asset), which means an
   * embedded-only reader silently stops checking anything downstream of the
   * texture the moment an asset has been through the optimizer — exactly the
   * assets that most need checking. */
  const image = await resolveImage(gltf, path);

  // ★ texel density
  let density = null;
  if (image?.png) {
    density = texelDensity(gltf, image.png.width);
    if (density !== null) {
      const ratio = density / rules.texel;
      /* A factor of two either way is the tolerance §17.7 implicitly allows:
       * below that the asset is visibly soft, above it wastes atlas space. */
      if (ratio < 0.5 || ratio > 2) {
        warn.push(
          `texel density ${density.toFixed(0)} px/m vs target ${rules.texel} (${ratio.toFixed(2)}×)`,
        );
      }
    }
  }

  // ★ palette lock, and the reserved-cyan contract
  let palette = null;
  if (image?.png) {
    palette = conformance(image.png, swatches);
    if (palette.chroma > 0.05) {
      warn.push(`texture is ${palette.chroma.toFixed(4)} from the palette — run palette_lock.mjs`);
    }
    /* §1 of the character brief: cyan means Choir, and no Vigil asset may use
     * it. Measured against the reserved swatches specifically, because they are
     * excluded from the lock and so would never show up in `chroma`. */
    const cyan = conformance(image.png, selectSwatches(RESERVED));
    if (cyan.mean < 0.06) {
      fail.push(
        `texture sits ${cyan.mean.toFixed(3)} from the reserved cyans (hex/bell) — ` +
          `those are the Choir contract and must not appear on a Vigil asset`,
      );
    }
  }

  // ★ de-lit albedo
  if (image?.png) {
    const stops = lightingVariance(image.png, 0.12);
    /* Calibrated in delight.mjs against real inputs: PBR albedo measures
     * 0.02–0.20 stops, a packed atlas 1.70–1.80. Between those, a single
     * surface carrying real painted shadow. */
    if (stops > ATLAS_STOPS) {
      info.push(`${stops.toFixed(2)} stops of low-frequency variation — reads as a packed atlas`);
    } else if (stops > DELIT_STOPS) {
      warn.push(`albedo is not de-lit (${stops.toFixed(2)} stops of baked lighting) — run delight.mjs`);
    }
  } else if (s.images > 0) {
    info.push("texture is not a readable PNG; palette, de-lit and texel density unchecked");
  }

  if (s.hasSkin) info.push("skinned asset — eye line is not verifiable from geometry");

  return { path, name, cls, survey: s, density, palette, fail, warn, info };
}

// ---------------------------------------------------------------------- cli

async function collect(target, recursive) {
  const out = [];
  const stack = [target];
  while (stack.length) {
    const p = stack.pop();
    const st = await stat(p).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      for (const e of await readdir(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) {
          if (recursive) stack.push(full);
        } else if (/\.(glb|gltf)$/i.test(e.name)) out.push(full);
      }
    } else if (/\.(glb|gltf)$/i.test(p)) {
      out.push(p);
    }
  }
  return out.sort();
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

async function main() {
  const opts = { class: null, recursive: false, json: false, summary: false, quiet: false };
  const inputs = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--class") opts.class = argv[++i];
    else if (a === "-r" || a === "--recursive") opts.recursive = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--summary") opts.summary = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else inputs.push(a);
  }
  if (!inputs.length) throw new Error("no input file or directory given");

  await assertMatchesGame();
  const swatches = selectSwatches(null);

  const files = (await Promise.all(inputs.map((i) => collect(i, opts.recursive)))).flat();
  if (!files.length) throw new Error("no .glb or .gltf files found");

  const results = [];
  for (const f of files) {
    try {
      results.push(await checkFile(f, opts.class, swatches));
    } catch (e) {
      results.push({ path: f, name: basename(f), fail: [`unreadable: ${e.message}`], warn: [], info: [] });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ results }, null, 2));
    return results.some((r) => r.fail.length) ? 1 : 0;
  }

  const failed = results.filter((r) => r.fail.length);
  const warned = results.filter((r) => !r.fail.length && r.warn.length);

  console.log(`\n${c.b("Budget check")} — ${results.length} asset(s)\n`);

  if (!opts.summary) {
    for (const r of results) {
      if (!r.fail.length && !r.warn.length && opts.quiet) continue;
      const tag = r.fail.length ? c.bad("FAIL") : r.warn.length ? c.warn("warn") : c.ok(" ok ");
      const stats = r.survey
        ? c.dim(
            `${r.survey.triangles} tris · ${r.survey.materials} mat · ${r.cls}` +
              (r.density ? ` · ${r.density.toFixed(0)} px/m` : ""),
          )
        : "";
      console.log(`  ${tag} ${c.b(r.name.padEnd(30))} ${stats}`);
      for (const m of r.fail) console.log(`       ${c.bad("×")} ${m}`);
      for (const m of r.warn) console.log(`       ${c.warn("!")} ${m}`);
      for (const m of r.info) console.log(`       ${c.dim(`· ${m}`)}`);
    }
    console.log();
  }

  /* Distribution, because a per-file list of 392 assets tells you nothing about
   * whether the *set* is healthy. */
  const withSurvey = results.filter((r) => r.survey);
  if (withSurvey.length > 1) {
    const tris = withSurvey.map((r) => r.survey.triangles).sort((a, b) => a - b);
    const q = (p) => tris[Math.min(tris.length - 1, Math.floor(p * tris.length))];
    console.log(
      `${c.b("Triangles")}  min ${tris[0]} · p50 ${q(0.5)} · p90 ${q(0.9)} · max ${tris[tris.length - 1]}`,
    );
  }

  console.log(
    `${c.b("Result")}     ${c.ok(`${results.length - failed.length - warned.length} clean`)} · ` +
      `${c.warn(`${warned.length} warned`)} · ${c.bad(`${failed.length} failed`)}\n`,
  );

  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`\n${c.bad("budget_check failed")} — ${e.message}\n`);
      process.exit(1);
    },
  );
}
