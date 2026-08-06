/*
 * pipeline/tests/pipeline.test.mjs — self-test for the art pipeline maths.
 *
 *   node pipeline/tests/pipeline.test.mjs      (or: npm run art:selftest)
 *
 * These scripts do colour-space and signal-processing work where a wrong answer
 * looks plausible — a slightly-off de-light still produces an image, a broken
 * palette lock still produces colours. Every case below either pins a property
 * that must hold, or pins a bug that was found by measurement and fixed:
 *
 *   - PNG must round-trip pixel-exact, or every downstream measurement is noise.
 *   - `softTarget` must be continuous. A top-k implementation was not, and
 *     measured *worse* than no smoothing at all on a broad-gamut texture.
 *   - The lock at `value: 0` must leave lightness untouched, because §17.1
 *     rule 1 (everything reads in greyscale) is the constraint it exists under.
 *   - De-light must ignore transparent texels, which once read as pure black
 *     and dragged the whole lighting estimate down.
 *
 * No vendored assets are required: every fixture is synthesised here so the
 * suite runs on a clean clone.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePng,
  encodePng,
  linearToOklab,
  linearToSrgb,
  oklabToLinear,
  srgbToLinear,
} from "../lib/png.mjs";
import {
  HEX,
  NAMES,
  RESERVED,
  assertMatchesGame,
  conformance,
  nearest,
  selectSwatches,
  softTarget,
  valuePreservation,
} from "../lib/palette.mjs";
import { readGltf, survey, texelDensity } from "../lib/gltf.mjs";
import { lockImage } from "../palette_lock.mjs";
import { delightImage, lightingVariance } from "../delight.mjs";

// ------------------------------------------------------------------ fixtures

function makeImage(width, height, fn, channels = 4) {
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * width + x) * channels;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      if (channels === 4) data[o + 3] = a ?? 255;
    }
  }
  return { width, height, channels, data };
}

const clone = (img) => ({ ...img, data: Buffer.from(img.data) });

/** Minimal single-triangle GLB, so glTF tests need no fixture files. */
function makeGlb({ positions, uvs, indices, scale = null, material = true, quantize = false }) {
  /* Quantized mode stores POSITION as normalized SHORT, exactly as
   * KHR_mesh_quantization does, so the de-quantization path gets exercised. */
  const posBuf = quantize ? Buffer.alloc(positions.length * 2) : Buffer.alloc(positions.length * 4);
  if (quantize) {
    const peak = Math.max(...positions.map(Math.abs)) || 1;
    positions.forEach((v, i) => posBuf.writeInt16LE(Math.round((v / peak) * 32767), i * 2));
  } else {
    positions.forEach((v, i) => posBuf.writeFloatLE(v, i * 4));
  }
  const uvBuf = Buffer.alloc(uvs.length * 4);
  uvs.forEach((v, i) => uvBuf.writeFloatLE(v, i * 4));
  const idxBuf = Buffer.alloc(indices.length * 2);
  indices.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));

  const pad = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  const bin = Buffer.concat([pad(posBuf), pad(uvBuf), pad(idxBuf)]);

  const vCount = positions.length / 3;
  const min = [0, 1, 2].map((a) => Math.min(...Array.from({ length: vCount }, (_, i) => positions[i * 3 + a])));
  const max = [0, 1, 2].map((a) => Math.max(...Array.from({ length: vCount }, (_, i) => positions[i * 3 + a])));

  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, ...(scale ? { scale } : {}) }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1 },
            indices: 2,
            ...(material ? { material: 0 } : {}),
          },
        ],
      },
    ],
    ...(material ? { materials: [{ name: "m" }] } : {}),
    ...(quantize ? { extensionsUsed: ["KHR_mesh_quantization"] } : {}),
    accessors: [
      quantize
        ? {
            bufferView: 0,
            componentType: 5122,
            normalized: true,
            count: vCount,
            type: "VEC3",
            min: min.map((v) => Math.round((v / (Math.max(...positions.map(Math.abs)) || 1)) * 32767)),
            max: max.map((v) => Math.round((v / (Math.max(...positions.map(Math.abs)) || 1)) * 32767)),
          }
        : { bufferView: 0, componentType: 5126, count: vCount, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: vCount, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
      { buffer: 0, byteOffset: pad(posBuf).length, byteLength: uvBuf.length },
      { buffer: 0, byteOffset: pad(posBuf).length + pad(uvBuf).length, byteLength: idxBuf.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  /* glTF requires the JSON chunk be padded with spaces (0x20) and the BIN chunk
   * with zeros. Padding JSON with NULs makes JSON.parse fail. */
  const rawJson = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (rawJson.length % 4)) % 4;
  const jsonBuf = Buffer.concat([rawJson, Buffer.alloc(jsonPad, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonBuf.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(bin.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, jsonBuf, binChunk, bin]);
}

// ----------------------------------------------------------------- png codec

test("PNG round-trips pixel-exact through adaptive filtering", () => {
  for (const channels of [3, 4]) {
    const img = makeImage(64, 48, (x, y) => [(x * 4) % 256, (y * 5) % 256, (x ^ y) % 256, 255], channels);
    const decoded = decodePng(encodePng(img));
    assert.equal(decoded.width, 64);
    assert.equal(decoded.height, 48);
    assert.equal(decoded.channels, channels);
    assert.ok(decoded.data.equals(img.data), `channels=${channels} did not round-trip`);
  }
});

test("PNG round-trips a flat image and a noisy one (both filter regimes)", () => {
  const flat = makeImage(32, 32, () => [90, 40, 20, 255]);
  const noisy = makeImage(32, 32, (x, y) => [(x * 37 + y * 91) % 256, (x * 13) % 256, (y * 57) % 256, 255]);
  for (const img of [flat, noisy]) {
    assert.ok(decodePng(encodePng(img)).data.equals(img.data));
  }
});

test("PNG decoder refuses what it cannot honestly read", () => {
  assert.throws(() => decodePng(Buffer.alloc(64)), /not a PNG/);
});

// ------------------------------------------------------------- colour spaces

test("sRGB and linear round-trip within a code value", () => {
  for (let v = 0; v < 256; v++) assert.equal(linearToSrgb(srgbToLinear(v)), v);
});

test("Oklab round-trips linear RGB", () => {
  for (const rgb of [[0.1, 0.2, 0.3], [0.9, 0.5, 0.05], [0, 0, 0], [1, 1, 1]]) {
    const back = oklabToLinear(...linearToOklab(...rgb));
    back.forEach((v, i) => assert.ok(Math.abs(v - rgb[i]) < 1e-6, `${rgb} → ${back}`));
  }
});

// -------------------------------------------------------------------- palette

test("pipeline palette matches the game's palette.ts", async () => {
  assert.equal(await assertMatchesGame(), NAMES.length);
});

test("reserved cyans are excluded by default and opt-in only", () => {
  const def = selectSwatches(null).map((s) => s.name);
  for (const r of RESERVED) assert.ok(!def.includes(r), `${r} must not be a default lock target`);
  assert.ok(selectSwatches(["hex"]).map((s) => s.name).includes("hex"));
  assert.throws(() => selectSwatches(["nonsense"]), /unknown swatch/);
});

test("nearest() picks a genuinely near swatch, not a numerically near one", () => {
  const timber = HEX.timber;
  const lin = [(timber >> 16) & 255, (timber >> 8) & 255, timber & 255].map(srgbToLinear);
  assert.equal(nearest(linearToOklab(...lin), selectSwatches(null)).swatch.name, "timber");
});

test("softTarget is continuous — the top-k bug must not come back", () => {
  /* A top-k blend jumps when the k-th nearest swatch changes identity while its
   * weight is still non-zero. Walking a line through Oklab must produce a path
   * with no step much larger than its neighbours. */
  const sw = selectSwatches(null);
  const steps = 2000;
  let prev = null;
  let maxJump = 0;
  let meanJump = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lab = [0.55, -0.08 + 0.16 * t, -0.08 + 0.16 * t];
    const { target } = softTarget(lab, sw);
    if (prev) {
      const jump = Math.hypot(target[0] - prev[0], target[1] - prev[1], target[2] - prev[2]);
      maxJump = Math.max(maxJump, jump);
      meanJump += jump;
    }
    prev = target;
  }
  meanJump /= steps;
  assert.ok(
    maxJump < meanJump * 12,
    `discontinuity in softTarget: max step ${maxJump.toExponential(2)} vs mean ${meanJump.toExponential(2)}`,
  );
});

// --------------------------------------------------------------- palette lock

test("lock at value:0 leaves lightness untouched (§17.1 rule 1)", () => {
  const img = makeImage(64, 64, (x, y) => [40 + x * 3, 60 + y * 2, 30 + ((x + y) % 90), 255]);
  const before = clone(img);
  lockImage(img, { strength: 0.6, value: 0, swatches: selectSwatches(null) });
  const { correlation, meanShift } = valuePreservation(before, img);
  assert.ok(correlation > 0.9999, `lightness correlation fell to ${correlation}`);
  assert.ok(meanShift < 0.01, `mean lightness moved ${meanShift}`);
});

test("lock moves chroma toward the palette and never touches alpha", () => {
  const sw = selectSwatches(null);
  const img = makeImage(48, 48, (x, y) => [200, 30, 190, (x * 5) % 256]); // vivid magenta, off-palette
  const before = clone(img);
  const beforeConf = conformance(before, sw);
  lockImage(img, { strength: 0.8, value: 0, swatches: sw });
  const afterConf = conformance(img, sw);
  assert.ok(afterConf.chroma < beforeConf.chroma, "chroma distance did not decrease");
  for (let i = 0; i < img.width * img.height; i++) {
    assert.equal(img.data[i * 4 + 3], before.data[i * 4 + 3], "alpha was modified");
  }
});

test("lock leaves fully transparent texels alone", () => {
  const img = makeImage(16, 16, () => [255, 0, 255, 0]);
  const before = clone(img);
  lockImage(img, { strength: 1, value: 0, swatches: selectSwatches(null) });
  assert.ok(img.data.equals(before.data), "transparent texels were altered");
});

test("locking unrelated sources pulls them together (the §17.9 claim)", () => {
  const sw = selectSwatches(null);
  const warm = makeImage(64, 64, (x) => [190, 120 + (x % 30), 60, 255]);
  const cold = makeImage(64, 64, (x) => [60, 110, 180 + (x % 30), 255]);
  const centroid = (i) => conformance(i, sw).centroid;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  const apart = dist(centroid(warm), centroid(cold));
  lockImage(warm, { strength: 0.6, value: 0, swatches: sw });
  lockImage(cold, { strength: 0.6, value: 0, swatches: sw });
  const together = dist(centroid(warm), centroid(cold));

  assert.ok(together < apart * 0.75, `sources converged only ${apart} → ${together}`);
});

// -------------------------------------------------------------------- delight

test("de-light leaves an already-flat image essentially alone", () => {
  const img = makeImage(96, 96, (x, y) => [120 + ((x * y) % 7), 100 + ((x + y) % 5), 80, 255]);
  const before = clone(img);
  const stats = delightImage(img, { radius: 0.12, amount: 1, floor: 0.02 });
  assert.ok(stats.maxCorrectionStops < 0.25, `flat image corrected by ${stats.maxCorrectionStops} stops`);
  let maxDelta = 0;
  for (let i = 0; i < before.data.length; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(before.data[i] - img.data[i]));
  }
  assert.ok(maxDelta <= 12, `flat image shifted by up to ${maxDelta} code values`);
});

test("de-light removes a smooth luminance gradient", () => {
  /* A horizontal ramp on a single material is exactly the "baked lighting"
   * case: same albedo, different illumination. */
  const img = makeImage(96, 96, (x) => {
    const k = 0.35 + (0.6 * x) / 95;
    return [Math.round(180 * k), Math.round(150 * k), Math.round(110 * k), 255];
  });
  const before = lightingVariance(img, 0.12);
  delightImage(img, { radius: 0.25, amount: 1, floor: 0.02 });
  const after = lightingVariance(img, 0.12);
  assert.ok(after < before * 0.5, `lighting only fell ${before} → ${after} stops`);
});

test("de-light ignores transparent texels rather than reading them as black", () => {
  /* The bug: transparent gutter counted as crushed shadow and dragged the
   * lighting estimate down, so a clean texture reported 30%+ clipping. */
  const opaqueOnly = makeImage(64, 64, () => [130, 110, 90, 255]);
  const halfClear = makeImage(64, 64, (x) => [130, 110, 90, x < 32 ? 0 : 255]);
  const a = delightImage(clone(opaqueOnly), { radius: 0.12, amount: 1, floor: 0.02 });
  const b = delightImage(clone(halfClear), { radius: 0.12, amount: 1, floor: 0.02 });
  assert.ok(b.clippedLow < 0.01, `transparent texels counted as clipped: ${b.clippedLow}`);
  assert.ok(
    Math.abs(a.maxCorrectionStops - b.maxCorrectionStops) < 0.35,
    `transparency changed the correction: ${a.maxCorrectionStops} vs ${b.maxCorrectionStops}`,
  );
});

// ----------------------------------------------------------------------- glTF

test("survey counts triangles, materials, UV sets and bounds", async () => {
  const glb = makeGlb({
    positions: [0, 0, 0, 1, 0, 0, 0, 2, 0],
    uvs: [0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
  });
  const path = new URL("./_tmp.glb", import.meta.url);
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(path, glb);
  try {
    const s = survey(await readGltf(path));
    assert.equal(s.triangles, 1);
    assert.equal(s.materials, 1);
    assert.deepEqual(s.uvSets, ["TEXCOORD_0"]);
    assert.equal(s.negativeScale, false);
    assert.ok(Math.abs(s.bounds.size[1] - 2) < 1e-6);
    assert.ok(Math.abs(s.bounds.min[1]) < 1e-6);
  } finally {
    await rm(path, { force: true });
  }
});

test("survey flags negative scale (unapplied mirror)", async () => {
  const glb = makeGlb({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    scale: [-1, 1, 1],
  });
  const path = new URL("./_tmp_neg.glb", import.meta.url);
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(path, glb);
  try {
    assert.equal(survey(await readGltf(path)).negativeScale, true);
  } finally {
    await rm(path, { force: true });
  }
});

test("normalized accessors are de-quantized (a coffin is not 3km tall)", async () => {
  /* KHR_mesh_quantization stores POSITION as normalized integers and pushes the
   * real scale onto the node. Reading min/max literally reported a 0.84m coffin
   * as 3,275m and failed every optimized asset on the pivot rule. */
  const glb = makeGlb({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    uvs: [0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    quantize: true,
  });
  const path = new URL("./_tmp_quant.glb", import.meta.url);
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(path, glb);
  try {
    const s = survey(await readGltf(path));
    assert.equal(s.quantized, true, "KHR_mesh_quantization not detected");
    /* min/max are ±32767 in the file; de-normalized that is ±1, not ±32767. */
    assert.ok(s.bounds.size[1] <= 2.001, `height read as ${s.bounds.size[1]} — not de-quantized`);
  } finally {
    await rm(path, { force: true });
  }
});

test("reserved cyan on a texture is detectable", () => {
  /* §1's hardest contract: cyan means Choir. budget_check fails an asset whose
   * texture sits close to hex/bell, so that closeness must be measurable. */
  const reserved = selectSwatches(RESERVED);
  const cyan = makeImage(32, 32, () => [0x4f, 0xf0, 0xe0, 255]); // exactly `hex`
  const dust = makeImage(32, 32, () => [0x6e, 0x65, 0x59, 255]); // a Vigil brown
  assert.ok(conformance(cyan, reserved).mean < 0.01, "hex swatch not recognised as cyan");
  assert.ok(conformance(dust, reserved).mean > 0.06, "a dust brown must not read as cyan");
});

test("texelDensity matches a hand-computable case", async () => {
  /* A 2m × 2m right triangle mapped to the full 0..1 UV triangle, on a 1024px
   * texture, is exactly 512 px/m. */
  const glb = makeGlb({
    positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
    uvs: [0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
  });
  const path = new URL("./_tmp_density.glb", import.meta.url);
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(path, glb);
  try {
    const d = texelDensity(await readGltf(path), 1024);
    assert.ok(Math.abs(d - 512) < 1, `expected ~512 px/m, got ${d}`);
  } finally {
    await rm(path, { force: true });
  }
});
