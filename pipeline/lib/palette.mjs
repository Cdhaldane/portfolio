/*
 * pipeline/lib/palette.mjs — the 14 swatches of §17.1, for the pipeline side.
 *
 * `game/src/render/palette.ts` is the runtime copy and the authority. This file
 * deliberately restates the values rather than importing them (the pipeline is
 * plain .mjs and the game is TypeScript behind Vite), which creates exactly the
 * drift risk §17.1 exists to prevent — so `assertMatchesGame()` reads the TS
 * file and fails loudly if a single byte disagrees. Two sources of truth are
 * fine as long as disagreement is a build error.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { linearToOklab, linearToSrgb, srgbToLinear } from "./png.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const HEX = {
  void: 0x0b0a0c,
  ash: 0x232227,
  grave: 0x3b3a3d,
  dust: 0x6e6559,
  bone: 0xc9bfa8,
  sunbleach: 0xe6dfc8,
  timber: 0x5a4433,
  timberDark: 0x33261c,
  rust: 0x8a4a2b,
  oxblood: 0x7a1f24,
  lamp: 0xffab5e,
  ember: 0xff5d3b,
  hex: 0x4ff0e0,
  bell: 0x9be3ff,
};

/* The two cyans mean "Choir / arcane / physical won't work here". §1 of the
 * character brief calls that contract "the single biggest readability lever in
 * the game" and forbids it on every Vigil asset — so the lock excludes them by
 * default and you must opt in per-asset. A palette lock that could quietly tint
 * a hero's coat cyan would be worse than no lock at all. */
export const RESERVED = ["hex", "bell"];

export const NAMES = Object.keys(HEX);

/** Swatches as {name, srgb:[r,g,b], linear:[r,g,b], oklab:[L,a,b]}. */
export const SWATCHES = NAMES.map((name) => {
  const v = HEX[name];
  const srgb = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const linear = srgb.map(srgbToLinear);
  return { name, srgb, linear, oklab: linearToOklab(...linear) };
});

const BY_NAME = new Map(SWATCHES.map((s) => [s.name, s]));

/** Resolve a swatch subset from names, defaulting to everything non-reserved. */
export function selectSwatches(include) {
  const names = include?.length ? include : NAMES.filter((n) => !RESERVED.includes(n));
  return names.map((n) => {
    const s = BY_NAME.get(n);
    if (!s) throw new Error(`unknown swatch "${n}" — valid: ${NAMES.join(", ")}`);
    return s;
  });
}

/**
 * Nearest swatch in Oklab, plus the distance to it.
 *
 * Oklab rather than RGB because "nearest" has to mean what the eye means. In
 * RGB a warm mid-brown sits numerically close to neutral grey, and an RGB lock
 * will cheerfully desaturate every piece of weathered timber in the game.
 */
/**
 * Soft palette target: a distance-weighted blend across the swatch set, rather
 * than a hard snap to the single nearest.
 *
 * Hard nearest-swatch quantises Oklab into Voronoi cells, and a smooth gradient
 * crossing a cell boundary gets torn — adjacent pixels pulled toward different
 * hues. Measured on a near-neutral photogrammetry metal, hard assignment raised
 * high-frequency chroma roughness by 50% (0.00174 → 0.00261). That is invented
 * colour noise, the opposite of cohesion.
 *
 * **Weighting must cover every swatch, not the k nearest.** A top-k blend was
 * tried first and measured *worse* than hard on a broad-gamut ground texture
 * (0.00442 → 0.00769): as a pixel drifts, the identity of the k-th nearest
 * swatch flips while its weight is still non-zero, so the target jumps. Top-k
 * is a discontinuity dressed up as a smoothing. Gaussian weights over the full
 * set have no such seam — distant swatches contribute ~0 and contribute it
 * continuously.
 *
 * `bandwidth` is in Oklab units; ~0.15 keeps a pixel dominated by genuinely
 * near swatches while removing the seam.
 */
export function softTarget(oklab, swatches, bandwidth = 0.15) {
  let wsum = 0;
  const target = [0, 0, 0];
  let best = swatches[0];
  let bestD = Infinity;

  for (const s of swatches) {
    const d = Math.hypot(oklab[0] - s.oklab[0], oklab[1] - s.oklab[1], oklab[2] - s.oklab[2]);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
    const w = Math.exp(-((d / bandwidth) ** 2));
    wsum += w;
    target[0] += s.oklab[0] * w;
    target[1] += s.oklab[1] * w;
    target[2] += s.oklab[2] * w;
  }

  /* Far outside every swatch's bandwidth the weights underflow; fall back to
   * the nearest rather than dividing by ~0. */
  if (!(wsum > 1e-12)) return { target: best.oklab, swatch: best };

  return {
    target: [target[0] / wsum, target[1] / wsum, target[2] / wsum],
    swatch: best,
  };
}

export function nearest(oklab, swatches) {
  let best = swatches[0];
  let bestD = Infinity;
  for (const s of swatches) {
    const dL = oklab[0] - s.oklab[0];
    const da = oklab[1] - s.oklab[1];
    const db = oklab[2] - s.oklab[2];
    const d = dL * dL + da * da + db * db;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { swatch: best, distance: Math.sqrt(bestD) };
}

/**
 * How close an image sits to the palette.
 *
 * Two numbers, because they answer different questions and conflating them
 * hides what the lock does:
 *
 * - `mean` is full Oklab distance to the nearest swatch. It can never reach
 *   zero under an anisotropic lock, because the lock deliberately preserves the
 *   L axis — a dark and a light region of one material stay far apart in L and
 *   *should*.
 * - `chroma` is distance in the a/b plane only. This is what the lock actually
 *   targets, so this is the number to judge it by.
 *
 * `chromaSpread` is the standard deviation of the pixels' own a/b positions —
 * how wide a colour gamut the image occupies, independent of the palette. Two
 * images converging on similar spreads is what "cohesion" means in practice.
 */
export function conformance({ data, channels, width, height }, swatches) {
  let sum = 0;
  let sumSq = 0;
  let chromaSum = 0;
  let n = 0;
  let worst = 0;
  let aSum = 0;
  let bSum = 0;
  let aSq = 0;
  let bSq = 0;

  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    if (channels === 4 && data[o + 3] < 8) continue;
    const lin = [srgbToLinear(data[o]), srgbToLinear(data[o + 1]), srgbToLinear(data[o + 2])];
    const lab = linearToOklab(...lin);
    const { swatch, distance } = nearest(lab, swatches);

    sum += distance;
    sumSq += distance * distance;
    chromaSum += Math.hypot(lab[1] - swatch.oklab[1], lab[2] - swatch.oklab[2]);
    if (distance > worst) worst = distance;
    aSum += lab[1];
    bSum += lab[2];
    aSq += lab[1] * lab[1];
    bSq += lab[2] * lab[2];
    n++;
  }

  if (!n) return { mean: 0, chroma: 0, chromaSpread: 0, stdDev: 0, worst: 0, samples: 0 };
  const mean = sum / n;
  const va = Math.max(0, aSq / n - (aSum / n) ** 2);
  const vb = Math.max(0, bSq / n - (bSum / n) ** 2);
  return {
    mean,
    chroma: chromaSum / n,
    chromaSpread: Math.sqrt(va + vb),
    centroid: [aSum / n, bSum / n],
    stdDev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    worst,
    samples: n,
  };
}

/**
 * Mean absolute lightness change between two versions of the same image, and
 * the Pearson correlation of their per-pixel lightness.
 *
 * This is the §17.1 rule-1 guard: correlation must stay ~1.0, or the lock has
 * eaten the greyscale read that the whole art direction rests on.
 */
export function valuePreservation(before, after) {
  const { channels, width, height } = before;
  let n = 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, absDiff = 0;

  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    if (channels === 4 && before.data[o + 3] < 8) continue;
    const x = linearToOklab(
      srgbToLinear(before.data[o]), srgbToLinear(before.data[o + 1]), srgbToLinear(before.data[o + 2]),
    )[0];
    const y = linearToOklab(
      srgbToLinear(after.data[o]), srgbToLinear(after.data[o + 1]), srgbToLinear(after.data[o + 2]),
    )[0];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    absDiff += Math.abs(x - y);
    n++;
  }

  if (!n) return { correlation: 1, meanShift: 0 };
  const cov = sxy / n - (sx / n) * (sy / n);
  const sd = Math.sqrt(Math.max(0, sxx / n - (sx / n) ** 2)) * Math.sqrt(Math.max(0, syy / n - (sy / n) ** 2));
  return { correlation: sd > 1e-12 ? cov / sd : 1, meanShift: absDiff / n };
}

export { linearToSrgb, srgbToLinear };

/**
 * Fail if the pipeline's swatches have drifted from the game's.
 *
 * Parsed with a regex rather than by importing the module, because pulling
 * TypeScript through this script would mean a build step for a 14-line
 * constant. The regex is strict: a shape it doesn't recognise is a failure,
 * not a skip.
 */
export async function assertMatchesGame() {
  const path = join(ROOT, "game", "src", "render", "palette.ts");
  let src;
  try {
    src = await readFile(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path} — the palette authority is missing`);
  }

  const block = src.match(/export const HEX\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!block) throw new Error("could not find `export const HEX = { ... } as const` in palette.ts");

  const found = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*0x([0-9a-fA-F]{6})/g)) {
    found[m[1]] = parseInt(m[2], 16);
  }

  const problems = [];
  for (const name of NAMES) {
    if (!(name in found)) problems.push(`${name} is missing from palette.ts`);
    else if (found[name] !== HEX[name]) {
      const h = (v) => `#${v.toString(16).padStart(6, "0")}`;
      problems.push(`${name}: pipeline ${h(HEX[name])} vs game ${h(found[name])}`);
    }
  }
  for (const name of Object.keys(found)) {
    if (!(name in HEX)) problems.push(`${name} exists in palette.ts but not in the pipeline`);
  }

  if (problems.length) {
    throw new Error(`palette drift between pipeline and game:\n  - ${problems.join("\n  - ")}`);
  }
  return Object.keys(found).length;
}
