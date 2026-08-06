#!/usr/bin/env node
/*
 * pipeline/delight.mjs — strip baked lighting out of an albedo map.
 *
 * §17.9 and the character brief both star the same rule: **albedo must be
 * de-lit — no baked shadow, AO, or highlight.** It matters more here than in a
 * normal PBR pipeline, because §17.1's shading model bakes its own AO and runs
 * a hard 3-band toon ramp. That ramp is the whole look: a crisp terminator that
 * separates lit from unlit. Lighting already painted into the albedo gets lit a
 * second time and smears that terminator into mush, and the painted shadow
 * stays put when the light moves. Everything looks dirty and nothing looks like
 * it is in the room.
 *
 *   node pipeline/delight.mjs <in.png> [-o out.png] [--radius 0.12] [--amount 1]
 *   node pipeline/delight.mjs <dir> --out <dir> -r
 *   node pipeline/delight.mjs <in.png> --report
 *
 * ── Method ────────────────────────────────────────────────────────────────
 *
 * Illumination is multiplicative and low-frequency; material is high-frequency.
 * So: take log luminance, blur it at a large radius to estimate the lighting
 * field, subtract that field, and exponentiate back. Subtraction in log space
 * is division in linear space, which is what "remove a light" actually means —
 * doing it as a linear subtract would crush darks into black and is the usual
 * reason hand-rolled de-lighters produce muddy results.
 *
 * What this cannot do: recover detail from a region that was blown out or
 * crushed to black in the source. Nothing can. `--report` prints how much of
 * the image is clipped so a texture that is beyond saving gets rejected at
 * import rather than after it has been atlased.
 */

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng, encodePng, linearToSrgb, luminance, srgbToLinear } from "./lib/png.mjs";

const DEFAULTS = { radius: 0.12, amount: 1, floor: 0.02 };

/* Stops of low-frequency luminance variation above which the input is treated
 * as a packed atlas rather than a single lit surface. Calibrated against real
 * inputs: ambientCG albedo maps measure 0.02–0.20, Kenney packed atlases 1.70–1.80. */
const ATLAS_THRESHOLD = 1.0;

// ------------------------------------------------------------ separable blur

/**
 * Three box passes ≈ a Gaussian, at O(n) per pass regardless of radius.
 *
 * Edges are clamped rather than wrapped: a tiling trim sheet would prefer wrap,
 * but a character atlas would then bleed the hat's lighting into the boots.
 * Clamp is the safe default for both, and the error only affects a border of
 * width `radius`, which the atlas gutter covers anyway.
 */
function boxBlur(src, width, height, radius) {
  let a = Float64Array.from(src);
  let b = new Float64Array(src.length);
  const r = Math.max(1, Math.round(radius));

  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[row + Math.min(width - 1, Math.max(0, i))];
      const norm = 1 / (2 * r + 1);
      for (let x = 0; x < width; x++) {
        b[row + x] = sum * norm;
        const out = row + Math.min(width - 1, Math.max(0, x - r));
        const inn = row + Math.min(width - 1, Math.max(0, x + r + 1));
        sum += a[inn] - a[out];
      }
    }
    [a, b] = [b, a];

    // vertical
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[Math.min(height - 1, Math.max(0, i)) * width + x];
      const norm = 1 / (2 * r + 1);
      for (let y = 0; y < height; y++) {
        b[y * width + x] = sum * norm;
        const out = Math.min(height - 1, Math.max(0, y - r)) * width + x;
        const inn = Math.min(height - 1, Math.max(0, y + r + 1)) * width + x;
        sum += a[inn] - a[out];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

// ----------------------------------------------------------------- the kernel

export function delightImage(img, { radius, amount, floor }) {
  const { data, channels, width, height } = img;
  const px = width * height;

  /* Log luminance. The floor keeps log() finite and stops near-black pixels
   * (where luminance carries almost no information) from dominating the
   * estimate of the lighting field. */
  const logLum = new Float64Array(px);
  let clippedLow = 0;
  let clippedHigh = 0;
  let opaque = 0;

  /* Transparent texels carry no colour — they are atlas gutter or cut-out. Left
   * in, they read as pure black, drag the lighting estimate down, and get
   * counted as crushed shadow. Seed them with the running mean instead so the
   * blur has something neutral to work with at the edges. */
  let meanLog = 0;
  for (let i = 0; i < px; i++) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 8) {
      logLum[i] = NaN;
      continue;
    }
    const l = luminance(srgbToLinear(data[o]), srgbToLinear(data[o + 1]), srgbToLinear(data[o + 2]));
    logLum[i] = Math.log(Math.max(floor, l));
    meanLog += logLum[i];
    opaque++;
    if (data[o] <= 2 && data[o + 1] <= 2 && data[o + 2] <= 2) clippedLow++;
    if (data[o] >= 253 && data[o + 1] >= 253 && data[o + 2] >= 253) clippedHigh++;
  }
  if (!opaque) return { clippedLow: 0, clippedHigh: 0, maxCorrectionStops: 0, opaqueFraction: 0 };
  meanLog /= opaque;
  for (let i = 0; i < px; i++) if (Number.isNaN(logLum[i])) logLum[i] = meanLog;

  const radiusPx = radius * Math.min(width, height);
  const field = boxBlur(logLum, width, height, radiusPx / 3);

  /* Normalise the correction so mean brightness is preserved: we are removing
   * the *variation* in lighting, not the exposure. */
  let meanField = 0;
  for (let i = 0; i < px; i++) meanField += field[i];
  meanField /= px;

  let maxCorrection = 0;
  for (let i = 0; i < px; i++) {
    const correction = Math.exp(-(field[i] - meanField) * amount);
    if (Math.abs(Math.log(correction)) > maxCorrection) maxCorrection = Math.abs(Math.log(correction));
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 8) continue;
    for (let ch = 0; ch < 3; ch++) {
      data[o + ch] = linearToSrgb(srgbToLinear(data[o + ch]) * correction);
    }
  }

  return {
    clippedLow: clippedLow / opaque,
    clippedHigh: clippedHigh / opaque,
    maxCorrectionStops: maxCorrection / Math.LN2,
    opaqueFraction: opaque / px,
  };
}

/** Standard deviation of blurred log-luminance: how much lighting is baked in. */
export function lightingVariance(img, radius) {
  const { data, channels, width, height } = img;
  const px = width * height;
  const logLum = new Float64Array(px);
  const solid = new Uint8Array(px);
  let mean = 0;
  let n = 0;
  for (let i = 0; i < px; i++) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 8) continue;
    const l = luminance(srgbToLinear(data[o]), srgbToLinear(data[o + 1]), srgbToLinear(data[o + 2]));
    logLum[i] = Math.log(Math.max(0.02, l));
    solid[i] = 1;
    mean += logLum[i];
    n++;
  }
  if (!n) return 0;
  mean /= n;
  for (let i = 0; i < px; i++) if (!solid[i]) logLum[i] = mean;

  const field = boxBlur(logLum, width, height, (radius * Math.min(width, height)) / 3);
  let m = 0;
  for (let i = 0; i < px; i++) if (solid[i]) m += field[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < px; i++) if (solid[i]) v += (field[i] - m) ** 2;
  return Math.sqrt(v / n) / Math.LN2; // in stops
}

// ------------------------------------------------------------------- cli

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
      } else if (extname(e.name).toLowerCase() === ".png") out.push(full);
    }
  }
  return out.sort();
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
};

async function main() {
  const opts = { ...DEFAULTS, out: null, recursive: false, report: false, force: false };
  const inputs = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "--radius") opts.radius = Number(argv[++i]);
    else if (a === "--amount") opts.amount = Number(argv[++i]);
    else if (a === "-r" || a === "--recursive") opts.recursive = true;
    else if (a === "--report") opts.report = true;
    else if (a === "--force") opts.force = true;
    else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else inputs.push(a);
  }
  if (!inputs.length) throw new Error("no input file or directory given");

  const files = (await Promise.all(inputs.map((i) => collect(i, opts.recursive)))).flat();
  if (!files.length) throw new Error("no .png files found");

  console.log(
    `\n${c.b("De-light")} — radius ${opts.radius} of the short edge · amount ${opts.amount}` +
      (opts.report ? c.dim("  (report only)") : ""),
  );
  console.log();

  let refused = 0;
  for (const file of files) {
    const img = decodePng(await readFile(file));
    const before = lightingVariance(img, opts.radius);

    /* An atlas is not a surface. De-lighting assumes low-frequency luminance is
     * illumination, which holds for one continuous material and is false for a
     * sheet of unrelated patches — there the low-frequency variation *is* the
     * palette. Measured on Kenney's packed colormap: 1.80 stops of apparent
     * "lighting", none of it light. Running the correction would flatten `void`
     * and `sunbleach` toward each other and destroy the atlas.
     *
     * Hence the pipeline order this implies: de-light each material BEFORE it
     * is packed, never afterwards. */
    if (before > ATLAS_THRESHOLD && !opts.force) {
      console.log(
        `  ${c.b(basename(file).padEnd(22))} ${c.warn("refused")} — ${before.toFixed(2)} stops of ` +
          `low-frequency variation reads as a packed atlas, not a lit surface.`,
      );
      console.log(
        c.dim(`     De-light the source materials before atlasing, or pass --force if this really is one surface.`),
      );
      refused++;
      continue;
    }

    const stats = delightImage(img, opts);
    const after = lightingVariance(img, opts.radius);

    const clipped = stats.clippedLow + stats.clippedHigh;
    const verdict =
      clipped > 0.02
        ? c.warn(`${(clipped * 100).toFixed(1)}% clipped — detail is unrecoverable there`)
        : c.ok("clean");

    console.log(
      `  ${c.b(basename(file).padEnd(22))} lighting ${before.toFixed(3)} → ` +
        `${c.ok(after.toFixed(3))} stops  ${c.dim(`peak correction ${stats.maxCorrectionStops.toFixed(2)} stops`)}  ${verdict}`,
    );

    if (!opts.report) {
      const dest = opts.out
        ? files.length > 1 || opts.recursive
          ? join(opts.out, relative(resolve(inputs[0]), resolve(file)) || basename(file))
          : opts.out
        : join(dirname(file), `${basename(file, ".png")}.delit.png`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, encodePng(img));
    }
  }
  console.log(
    c.dim(
      "\nLighting is the std-dev of the blurred log-luminance field, in stops.\n" +
        "Under ~0.15 reads as flat; a source over ~0.5 has real shadows painted in.",
    ),
  );
  console.log();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\n\x1b[31mdelight failed\x1b[0m — ${e.message}\n`);
    process.exit(1);
  });
}
