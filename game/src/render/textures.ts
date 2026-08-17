/*
 * render/textures.ts — procedural surface grain.
 *
 * There are no image files in this project and there are not going to be: §17.0's
 * Path A is code-generated art, and the two hard constraints behind it are "never
 * used Blender" and "won't spend money". A texture painted in a DCC tool is exactly
 * the dependency that rules out, so the grain is generated at load instead — a few
 * hundred bytes of code that produces the same bytes on every machine.
 *
 * ## Why a texture at all, when everything else is vertex colours
 *
 * Vertex colour resolution is the mesh. The wall panels in `mesher.ts` give value
 * variation per *course*, which is the right scale for weathering, and going finer
 * would mean subdividing geometry purely to carry colour — paying triangles for
 * something a 128px texture does for free. The division of labour:
 *
 *   silhouette   →  panel geometry      (mesher.ts)
 *   blotching    →  vertex colours      (mesher.ts, two octaves)
 *   fine grain   →  this file
 *
 * ## Why it only ever darkens
 *
 * `map` multiplies, so a texture can subtract light but never add it. That is a
 * constraint worth leaning into rather than fighting: dirt, soot and weathering are
 * all subtractive, and a grain that brightened would read as glitter. The range is
 * kept narrow (0.78–1.0) because under §17.1's three-band toon ramp a wide range
 * fights the bands instead of sitting under them.
 */

import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping } from "three";

const SIZE = 128;

/**
 * Deterministic hash noise. The same generator as `mesher.ts` uses, on purpose —
 * two different noises at two scales on the same surface read as two materials.
 */
function hash(i: number, j: number): number {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return (((n ^ (n >>> 16)) >>> 0) % 10000) / 10000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise, tiling exactly at `period` so the texture can repeat seamlessly. */
function tiledNoise(x: number, y: number, period: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = smooth(x - i);
  const fy = smooth(y - j);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(i), w(j));
  const b = hash(w(i + 1), w(j));
  const c = hash(w(i), w(j + 1));
  const d = hash(w(i + 1), w(j + 1));
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

let cached: DataTexture | null = null;

/**
 * Rough stone-and-timber grain, tiling every 2m of world (see `UV_PER_METRE`).
 *
 * Three layers, each doing a different job at a different distance:
 *
 *  1. **Coarse mottle** — reads from across the site, and stops a long wall from
 *     being one flat value the eye slides off.
 *  2. **Fine speckle** — reads at arm's length, where a player stands while building.
 *  3. **Horizontal streaking** — weathering runs *down*, and biasing the noise along
 *     one axis is the difference between "noisy" and "rained on". It is also what
 *     makes the grain agree with the coursed panels rather than fighting them.
 *
 * Cached: the site rebuilds its mesh when Undertown opens a building, and
 * regenerating 64KB of identical pixels each time would be pure waste.
 */
export function roughGrain(): DataTexture {
  if (cached) return cached;

  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * 8;
      const v = (y / SIZE) * 8;
      const coarse = tiledNoise(u, v, 8);
      // Streaks: sampled wide in x and tight in y, so the grain runs vertically.
      const streak = tiledNoise(u * 2, v * 12, 16);
      const speck = tiledNoise(u * 16, v * 16, 128);

      let value = 0.5 * coarse + 0.28 * streak + 0.22 * speck;
      // Occasional darker pits, so the surface has incident rather than only texture.
      if (speck > 0.86) value *= 0.72;

      const lum = Math.round(255 * (0.78 + 0.22 * value));
      const i = (y * SIZE + x) * 4;
      data[i] = lum;
      data[i + 1] = lum;
      data[i + 2] = lum;
      data[i + 3] = 255;
    }
  }

  const tex = new DataTexture(data, SIZE, SIZE, RGBAFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // The grain is a value signal, not colour: leaving it in sRGB would gamma-shift
  // every surface it touches.
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
