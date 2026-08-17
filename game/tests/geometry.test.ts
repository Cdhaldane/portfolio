/*
 * tests/geometry.test.ts — every generated mesh, checked for the things a GPU would
 * hide rather than report.
 *
 * This exists because a face wound the wrong way is *silent*. It does not throw, it
 * does not warn, and it does not even look obviously broken — lighting reads the
 * `normal` attribute, so the faces that survive culling are shaded correctly and the
 * scene just looks subtly flat. Every side face of the site mesh was inside out from
 * M0 until it was reported as "some of the walls are invisible", three milestones
 * later, having been misattributed to the palette and the fog in between.
 *
 * The invariant needs no GPU, no browser and no screenshot:
 *
 *     cross(b - a, c - a) · declaredNormal > 0
 *
 * Applied to every generator in the game rather than only to the one that had the bug,
 * because the reason it went unnoticed for so long applies equally to all of them.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BufferGeometry } from "three";

import { buildLevel } from "../src/sim/level.ts";
import { SITES } from "../src/sim/sites.ts";
import { ENEMIES } from "../src/sim/enemies.ts";
import { TRAPS } from "../src/sim/traps.ts";
import { buildBoxGeometry, buildFloorGeometry } from "../src/render/mesher.ts";
import { buildTrapGeometry } from "../src/render/models/traps.ts";
import { buildEnemyGeometry } from "../src/render/models/enemies.ts";
import { buildHeroParts } from "../src/render/models/hero.ts";
import { buildDressingGeometry, buildHillsGeometry } from "../src/render/models/props.ts";

interface Report {
  tris: number;
  backwards: number;
  degenerate: number;
  nonUnitNormals: number;
  nonFinite: number;
}

/**
 * Walk a geometry's triangles, **through its index if it has one**.
 *
 * Reading positions sequentially on an indexed geometry produces confident nonsense —
 * it reported the skydome as 59 backwards triangles out of "141.67", which is not even
 * a whole number of triangles and should have been the tell. A tool that can be wrong
 * this quietly is worth writing once, carefully, in one place.
 */
function inspect(g: BufferGeometry): Report {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const idx = g.index;
  const count = idx ? idx.count : pos.count;
  const at = (i: number): number => (idx ? idx.getX(i) : i);

  const r: Report = { tris: count / 3, backwards: 0, degenerate: 0, nonUnitNormals: 0, nonFinite: 0 };

  for (let t = 0; t < count / 3; t++) {
    const ia = at(t * 3);
    const ib = at(t * 3 + 1);
    const ic = at(t * 3 + 2);
    const ax = pos.getX(ia);
    const ay = pos.getY(ia);
    const az = pos.getZ(ia);
    const ux = pos.getX(ib) - ax;
    const uy = pos.getY(ib) - ay;
    const uz = pos.getZ(ib) - az;
    const vx = pos.getX(ic) - ax;
    const vy = pos.getY(ic) - ay;
    const vz = pos.getZ(ic) - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;

    if (!Number.isFinite(cx + cy + cz)) {
      r.nonFinite++;
      continue;
    }
    if (Math.hypot(cx, cy, cz) / 2 < 1e-9) {
      r.degenerate++;
      continue;
    }
    if (cx * nrm.getX(ia) + cy * nrm.getY(ia) + cz * nrm.getZ(ia) <= 0) r.backwards++;
  }

  for (let v = 0; v < nrm.count; v++) {
    const len = Math.hypot(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    if (!Number.isFinite(len) || Math.abs(len - 1) > 0.02) r.nonUnitNormals++;
  }
  return r;
}

/** Every front-facing mesh in the game, by name. */
function everything(): [string, BufferGeometry][] {
  const out: [string, BufferGeometry][] = [];
  for (const d of TRAPS) out.push([`trap:${d.key}`, buildTrapGeometry(d.key)]);
  for (const d of ENEMIES) out.push([`enemy:${d.key}`, buildEnemyGeometry(d)]);
  const parts = buildHeroParts() as unknown as Record<string, BufferGeometry>;
  for (const k of Object.keys(parts)) {
    if (parts[k] && typeof parts[k].getAttribute === "function") out.push([`hero:${k}`, parts[k]]);
  }
  for (const def of SITES) {
    const level = buildLevel(def.id);
    out.push([`${def.key}:boxes`, buildBoxGeometry(level.boxes, level.tile)]);
    out.push([`${def.key}:floor`, buildFloorGeometry(level.width, level.depth, level.boxes)]);
    out.push([`${def.key}:dressing`, buildDressingGeometry(level)]);
    out.push([`${def.key}:hills`, buildHillsGeometry(level)]);
  }
  return out;
}

describe("generated geometry", () => {
  it("winds every triangle so it faces the way it claims to", () => {
    /*
     * The skydome is deliberately absent: it is drawn `BackSide`, because it is a shell
     * you stand inside, so its triangles are *supposed* to face inward. Every mesh
     * listed here is FrontSide, where backwards means invisible.
     */
    for (const [name, g] of everything()) {
      const r = inspect(g);
      assert.equal(
        r.backwards,
        0,
        `${name}: ${r.backwards} of ${r.tris} triangles are wound backwards — they will be culled and vanish`,
      );
    }
  });

  it("emits no degenerate or non-finite triangles", () => {
    for (const [name, g] of everything()) {
      const r = inspect(g);
      assert.equal(r.nonFinite, 0, `${name}: ${r.nonFinite} triangles have NaN vertices`);
      assert.ok(
        r.degenerate <= r.tris * 0.02,
        `${name}: ${r.degenerate} of ${r.tris} triangles are zero-area`,
      );
    }
  });

  it("normalises every normal", () => {
    // Toon shading quantises `dot(N, L)`, so a normal that is not unit length lands in
    // the wrong band — a visible hard-edged patch, on a surface that is otherwise fine.
    for (const [name, g] of everything()) {
      const r = inspect(g);
      assert.equal(r.nonUnitNormals, 0, `${name}: ${r.nonUnitNormals} normals are not unit length`);
    }
  });
});
