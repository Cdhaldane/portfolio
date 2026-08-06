#!/usr/bin/env node
/*
 * pipeline/palette_lock.mjs — §17.9's cohesion mechanism.
 *
 * Pulls every texture toward the 14 swatches of §17.1 so that heterogeneous
 * sources (CC0 packs, AI generations, photogrammetry) resolve to one palette.
 * This is the step §17 claims is what stops the game looking like a pile of
 * assets, so it is worth being precise about what it actually does.
 *
 *   node pipeline/palette_lock.mjs <in.png> [-o out.png] [--strength 0.6]
 *   node pipeline/palette_lock.mjs <dir> --out <dir> --recursive
 *   node pipeline/palette_lock.mjs <in.png> --report        (measure, write nothing)
 *
 * ── The one design decision that matters ──────────────────────────────────
 *
 * A naive lock lerps each pixel toward its nearest swatch in all three Oklab
 * axes. That destroys the game. §17.1's first rule is "value before hue —
 * every asset must read in greyscale", and a full-strength lerp collapses the
 * light and dark regions of one material onto the same swatch, flattening
 * exactly the value structure the art direction is built on.
 *
 * So the lock is anisotropic: **chroma is pulled, lightness is left alone.**
 * `--strength` (default 0.6, per the starred rule in the character brief)
 * applies to the a/b axes — hue and saturation. `--value` applies to L and
 * **defaults to 0**, because it was measured to be pure cost: swept across
 * 0/0.15/0.3 on five textures from three sources, a lightness pull changed
 * between-source cohesion by nothing at all (43.2% tighter either way) while
 * dropping the per-pixel lightness correlation from 0.99999 to 0.9969. It buys
 * no cohesion and spends the one thing §17.1 rule 1 protects.
 *
 * The same sweep put strength 0.6 at the knee of the curve — 0.3→24%,
 * 0.45→34%, 0.6→43%, 0.75→50%, 0.9→53% tighter — so the brief's starred value
 * is well chosen and is left as the default.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng, encodePng, linearToOklab, oklabToLinear } from "./lib/png.mjs";
import {
  assertMatchesGame,
  conformance,
  linearToSrgb,
  nearest,
  selectSwatches,
  softTarget,
  srgbToLinear,
  valuePreservation,
} from "./lib/palette.mjs";

const DEFAULTS = { strength: 0.6, value: 0, bandwidth: 0.15 };

// ---------------------------------------------------------------- the kernel

/**
 * Lock one decoded image in place and return what changed.
 *
 * Alpha is preserved untouched — it is a mask, not a colour, and §17.7 packs
 * meaningful data there (`T_*_alb` is RGB albedo + A mask).
 */
export function lockImage(img, { strength, value, swatches, bandwidth = 0.15 }) {
  const { data, channels, width, height } = img;
  const px = width * height;
  const hits = new Map();
  let moved = 0;
  let lumaDrift = 0;

  for (let i = 0; i < px; i++) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 8) continue;

    const lin = [srgbToLinear(data[o]), srgbToLinear(data[o + 1]), srgbToLinear(data[o + 2])];
    const lab = linearToOklab(...lin);
    /* bandwidth 0 selects hard nearest-swatch, kept switchable so the banding
     * artifact that motivated soft assignment stays reproducible. */
    const { target, swatch } =
      bandwidth > 0
        ? softTarget(lab, swatches, bandwidth)
        : (() => {
            const n = nearest(lab, swatches);
            return { target: n.swatch.oklab, swatch: n.swatch };
          })();

    const locked = [
      lab[0] + (target[0] - lab[0]) * value,
      lab[1] + (target[1] - lab[1]) * strength,
      lab[2] + (target[2] - lab[2]) * strength,
    ];

    const out = oklabToLinear(...locked).map(linearToSrgb);
    moved += Math.abs(out[0] - data[o]) + Math.abs(out[1] - data[o + 1]) + Math.abs(out[2] - data[o + 2]);
    lumaDrift += Math.abs(locked[0] - lab[0]);

    data[o] = out[0];
    data[o + 1] = out[1];
    data[o + 2] = out[2];
    hits.set(swatch.name, (hits.get(swatch.name) ?? 0) + 1);
  }

  return {
    meanChannelShift: moved / (px * 3),
    meanLightnessShift: lumaDrift / px,
    histogram: [...hits.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ------------------------------------------------------------------ file i/o

async function collect(target, recursive) {
  const stack = [target];
  const out = [];
  while (stack.length) {
    const p = stack.pop();
    let entries;
    try {
      entries = await readdir(p, { withFileTypes: true });
    } catch {
      if (extname(p).toLowerCase() === ".png") out.push(p);
      continue;
    }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) {
        if (recursive) stack.push(full);
      } else if (extname(e.name).toLowerCase() === ".png") {
        out.push(full);
      }
    }
  }
  return out.sort();
}

// -------------------------------------------------------------------- report

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS, out: null, recursive: false, report: false, include: null };
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "--strength") opts.strength = Number(argv[++i]);
    else if (a === "--value") opts.value = Number(argv[++i]);
    else if (a === "--include") opts.include = argv[++i].split(",").filter(Boolean);
    else if (a === "--bandwidth") opts.bandwidth = Number(argv[++i]);
    else if (a === "--recursive" || a === "-r") opts.recursive = true;
    else if (a === "--report") opts.report = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else inputs.push(a);
  }
  if (!inputs.length) throw new Error("no input file or directory given");
  for (const [k, v] of [["strength", opts.strength], ["value", opts.value]]) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`--${k} must be between 0 and 1`);
  }
  return { opts, inputs };
}

async function main() {
  const { opts, inputs } = parseArgs(process.argv.slice(2));
  await assertMatchesGame();
  const swatches = selectSwatches(opts.include);

  const files = (await Promise.all(inputs.map((i) => collect(i, opts.recursive)))).flat();
  if (!files.length) throw new Error("no .png files found");

  console.log(
    `\n${c.b("Palette lock")} — ${swatches.length} swatches · ` +
      `chroma ${opts.strength} · lightness ${opts.value}` +
      (opts.report ? c.dim("  (report only)") : ""),
  );
  if (!opts.include) console.log(c.dim(`Reserved cyans excluded: hex, bell (§1 readability contract)`));
  console.log();

  const rows = [];
  for (const file of files) {
    const img = decodePng(await readFile(file));
    const original = { ...img, data: Buffer.from(img.data) };
    const before = conformance(img, swatches);
    const stats = lockImage(img, { ...opts, swatches });
    const after = conformance(img, swatches);
    const value = valuePreservation(original, img);

    rows.push({ file, before, after, stats, value });

    const top = stats.histogram
      .slice(0, 3)
      .map(([n, v]) => `${n} ${pct(v / (img.width * img.height))}`)
      .join(", ");
    console.log(
      `  ${c.b(basename(file).padEnd(22))} ${img.width}x${img.height}  ` +
        `chroma ${before.chroma.toFixed(4)} → ${c.ok(after.chroma.toFixed(4))}  ` +
        `gamut ${before.chromaSpread.toFixed(4)} → ${after.chromaSpread.toFixed(4)}  ` +
        c.dim(`value r=${value.correlation.toFixed(5)}`),
    );
    console.log(`  ${c.dim(`→ ${top}`)}`);

    if (!opts.report) {
      const dest = opts.out
        ? files.length > 1 || opts.recursive
          ? join(opts.out, relative(resolve(inputs[0]), resolve(file)) || basename(file))
          : opts.out
        : join(dirname(file), `${basename(file, ".png")}.locked.png`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, encodePng(img));
    }
  }

  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const chromaBefore = avg((r) => r.before.chroma);
  const chromaAfter = avg((r) => r.after.chroma);
  const worstR = Math.min(...rows.map((r) => r.value.correlation));

  console.log(
    `\n${c.b("Summary")}  ${rows.length} texture(s) · ` +
      `chroma-to-palette ${chromaBefore.toFixed(4)} → ${chromaAfter.toFixed(4)} ` +
      `(${pct(1 - chromaAfter / chromaBefore)} closer)`,
  );

  /* §17.1 rule 1 is the constraint the lock must not break. A per-pixel
   * lightness correlation below ~0.999 means the greyscale read has started to
   * shift, which is the failure this whole anisotropic design exists to avoid. */
  if (worstR >= 0.999) {
    console.log(`${c.ok("Value structure intact")} — worst lightness correlation r=${worstR.toFixed(5)}`);
  } else {
    console.log(
      `${c.warn("Value structure at risk")} — worst lightness correlation r=${worstR.toFixed(5)}. ` +
        `Lower --value.`,
    );
  }

  /* Cohesion is a between-image property, so it only means anything with more
   * than one source in the set — which is the entire point of §17.9. */
  if (rows.length > 1) {
    const spread = (sel) => {
      const cs = rows.map((r) => sel(r).centroid);
      const ma = cs.reduce((s, v) => s + v[0], 0) / cs.length;
      const mb = cs.reduce((s, v) => s + v[1], 0) / cs.length;
      return Math.sqrt(cs.reduce((s, v) => s + (v[0] - ma) ** 2 + (v[1] - mb) ** 2, 0) / cs.length);
    };
    const sBefore = spread((r) => r.before);
    const sAfter = spread((r) => r.after);
    console.log(
      `${c.b("Cohesion")} — spread between source palettes ` +
        `${sBefore.toFixed(4)} → ${c.ok(sAfter.toFixed(4))} (${pct(1 - sAfter / sBefore)} tighter). ` +
        `\n${c.dim("This is the §17.9 claim: unrelated sources converging on one colour family.")}`,
    );
  }
  console.log();
}

/* Only run as a CLI. `lockImage` is imported by the calibration harness and by
 * budget_check; a module that runs main() on import breaks both. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\n\x1b[31mpalette_lock failed\x1b[0m — ${e.message}\n`);
    process.exit(1);
  });
}
