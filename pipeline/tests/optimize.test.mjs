/*
 * pipeline/tests/optimize.test.mjs — pins the behaviour of the gltf-transform
 * stage. Split from pipeline.test.mjs so that suite stays dependency-free;
 * this one needs `npm install` inside pipeline/.
 *
 *   node --test pipeline/tests/optimize.test.mjs
 *
 * Each case pins a defect found by measuring real vendored assets:
 *
 *   - Simplification silently no-ops on flat-shaded meshes unless NORMAL is
 *     dropped before welding (7,956 → 7,752 tris vs 7,956 → 352).
 *   - The meshopt *decoder* must be registered or the tool cannot re-read its
 *     own output, breaking any re-run over an optimized tree.
 *   - External textures must be content-addressed, or every asset writes
 *     `baseColor.png` into the same directory and the last one wins.
 *   - `normals()` is flat-only, so LODs must re-weld after regenerating them.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document } from "@gltf-transform/core";

import { cleanup, compress, countTriangles, countVertices, makeIO, makeLod } from "../optimize.mjs";

/**
 * A flat-shaded grid: every triangle gets its own three vertices with a shared
 * face normal, which is exactly how the low-poly source art is authored and
 * exactly the case that defeats a naive weld.
 */
function flatShadedGrid(doc, n = 24) {
  const pos = [];
  const nrm = [];
  const uv = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const quad = [
        [x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0],
        [x, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0],
      ];
      /* Perturb Z per quad so the surface has something to decimate. */
      const z = Math.sin(x * 0.7) * Math.cos(y * 0.7) * 0.6;
      for (const [px, py] of quad) {
        pos.push(px / n, py / n, z);
        nrm.push(0, 0, 1);
        uv.push(px / n, py / n);
      }
    }
  }
  const buf = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(nrm)).setBuffer(buf))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buf))
    .setMaterial(doc.createMaterial("m"));
  const mesh = doc.createMesh("grid").addPrimitive(prim);
  doc.createScene().addChild(doc.createNode("n").setMesh(mesh));
  return doc;
}

test("cleanup welds and joins without changing triangle count", async () => {
  const doc = flatShadedGrid(new Document());
  const before = countTriangles(doc);
  await cleanup(doc);
  assert.equal(countTriangles(doc), before, "cleanup must not decimate");
  assert.ok(countVertices(doc) <= before * 3, "vertices should not increase");
});

test("makeLod reaches an aggressive triangle target on flat-shaded geometry", async () => {
  /* The regression this guards: with NORMAL left in place the decimator gets
   * nowhere, and the LOD silently ships at nearly full density. */
  const doc = flatShadedGrid(new Document());
  await cleanup(doc);
  const before = countTriangles(doc);
  const target = Math.round(before * 0.1);

  const res = await makeLod(doc, target);
  assert.equal(res.skipped, false);
  assert.ok(
    res.tris <= target * 1.3,
    `wanted ~${target} tris, got ${res.tris} (from ${before}) — simplification is not engaging`,
  );
  assert.ok(res.tris > 0, "simplify destroyed the mesh");
});

test("makeLod skips work when already under target", async () => {
  const doc = flatShadedGrid(new Document(), 4);
  await cleanup(doc);
  const tris = countTriangles(doc);
  const res = await makeLod(doc, tris + 100);
  assert.equal(res.skipped, true);
  assert.equal(res.tris, tris);
});

test("LOD normals are regenerated, flat, and re-welded", async () => {
  /* gltf-transform only generates flat normals. The unweld → normals → weld
   * chain must leave NORMAL present and must not leave the mesh fully split:
   * coplanar faces should merge back, so vertices stay below 3x triangles. */
  const doc = flatShadedGrid(new Document());
  await cleanup(doc);
  const res = await makeLod(doc, Math.round(countTriangles(doc) * 0.1));

  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  assert.ok(prim.getAttribute("NORMAL"), "NORMAL was not regenerated");
  assert.ok(
    countVertices(doc) < res.tris * 3,
    `expected coplanar faces to re-weld: ${countVertices(doc)} verts for ${res.tris} tris`,
  );
});

test("meshopt output can be read back — decoder is registered", async () => {
  const io = makeIO();
  const doc = flatShadedGrid(new Document());
  await cleanup(doc);
  await compress(doc);
  const glb = await io.writeBinary(doc);

  /* Without "meshopt.decoder" this throws, and a second build over an
   * already-optimized tree would fail. */
  const reread = await io.readBinary(glb);
  assert.ok(countTriangles(reread) > 0, "re-read produced no geometry");
});

test("optimize round-trips through disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gh-opt-"));
  try {
    const io = makeIO();
    const doc = flatShadedGrid(new Document());
    await cleanup(doc);
    const tris = countTriangles(doc);
    await compress(doc);
    const out = join(dir, "asset.glb");
    await io.write(out, doc);
    assert.equal(countTriangles(await io.read(out)), tris);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
