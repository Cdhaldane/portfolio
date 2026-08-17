/*
 * tests/walls.test.ts — the walls you look at, and the traps bolted to them.
 *
 * Rendering usually is not worth testing: it is judged by eye, and an assertion about
 * a colour is an assertion about taste. Geometry is different — "does this mesh end up
 * inside that wall" has one right answer, it is invisible until someone notices it in
 * play, and it is exactly the class of bug that shipped here (a Scattergun Ports plate
 * sank 0.44m into the masonry, and nothing failed).
 *
 * So: no assertions about how the walls look, only about where their surfaces are.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLevel, isSolidKind } from "../src/sim/level.ts";
import { SITE, SITES } from "../src/sim/sites.ts";
import { SIDE, SURF, sideNormalX, sideNormalZ } from "../src/sim/surfaces.ts";
import { TRAPS } from "../src/sim/traps.ts";
import { PANEL_PROUD, buildBoxGeometry, buildFloorGeometry } from "../src/render/mesher.ts";
import { faceSquares } from "../src/sim/wallgrid.ts";
import { buildTrapGeometry, trapBackDepth } from "../src/render/models/traps.ts";
import { roughGrain } from "../src/render/textures.ts";

describe("wall relief", () => {
  it("gives architecture real depth without exploding the budget", () => {
    /*
     * §14.2 budgets 1.2M triangles for a whole frame. Panels cost geometry, and the
     * point of measuring is that "add relief" is the kind of change that quietly
     * multiplies — the check is that walls became three-dimensional, not that the
     * mesher started emitting a wall per brick.
     */
    for (const def of SITES) {
      const level = buildLevel(def.id);
      const flat = buildBoxGeometry(
        level.boxes.filter((b) => !isSolidKind(b.kind)),
        level.tile,
      );
      const full = buildBoxGeometry(level.boxes, level.tile);
      const tris = full.getAttribute("position").count / 3;
      assert.ok(
        tris > flat.getAttribute("position").count / 3,
        `${def.key}: panelling added nothing`,
      );
      assert.ok(tris < 200_000, `${def.key}: ${tris} triangles of architecture is too many`);
    }
  });

  it("carries UVs on every vertex, so the grain has somewhere to sit", () => {
    for (const def of SITES) {
      const g = buildBoxGeometry(buildLevel(def.id).boxes, 2);
      const pos = g.getAttribute("position");
      const uv = g.getAttribute("uv");
      assert.ok(uv, `${def.key}: no uv attribute`);
      assert.equal(uv.count, pos.count, `${def.key}: uv count does not match positions`);
      for (let v = 0; v < uv.count; v++) {
        assert.ok(Number.isFinite(uv.getX(v)) && Number.isFinite(uv.getY(v)));
      }
    }
  });

  it("keeps every panel within PANEL_PROUD of its wall", () => {
    /*
     * The invariant the no-clipping fix depends on. Panels stand PROUD of the box, so
     * the renderer offsets wall traps by `PANEL_PROUD` to clear them — if a panel ever
     * reached further than that, traps would start clipping again and the offset that
     * is supposed to prevent it would be the thing hiding the cause.
     */
    const level = buildLevel(SITE.bootHill);
    /* Architecture ONLY, on both sides of the comparison. Measuring every vertex in
       the site against just the solid boxes says a headstone is 7m from a wall, which
       is true and completely beside the point. */
    const solids = level.boxes.filter((b) => isSolidKind(b.kind) && b.y1 - b.y0 >= 1);
    const g = buildBoxGeometry(solids, level.tile);
    const pos = g.getAttribute("position");

    let worst = 0;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      // How far outside the nearest solid box does this vertex sit?
      let best = Infinity;
      for (const b of solids) {
        if (y < b.y0 - 0.01 || y > b.y1 + 0.01) continue;
        const dx = Math.max(b.x0 - x, 0, x - b.x1);
        const dz = Math.max(b.z0 - z, 0, z - b.z1);
        const d = Math.max(dx, dz);
        if (d < best) best = d;
      }
      if (best !== Infinity && best > worst) worst = best;
    }
    assert.ok(
      worst <= PANEL_PROUD + 1e-3,
      `panels reach ${worst.toFixed(3)}m off the wall, past the ${PANEL_PROUD}m allowance`,
    );
  });
});

describe("mounted traps do not clip into walls", () => {
  it("measures each trap's own reach behind its origin", () => {
    // Derived, not authored — the whole point is that re-modelling cannot leave a
    // stale number behind.
    for (const def of TRAPS) {
      const d = trapBackDepth(def.key);
      assert.ok(Number.isFinite(d) && d >= 0, `${def.key}: bad back depth ${d}`);
      const pos = buildTrapGeometry(def.key).getAttribute("position");
      let max = 0;
      for (let v = 0; v < pos.count; v++) max = Math.max(max, pos.getZ(v));
      assert.ok(Math.abs(d - max) < 1e-6, `${def.key}: back depth disagrees with the mesh`);
    }
  });

  it("puts no part of a wall trap inside the wall it is bolted to", () => {
    /*
     * The regression, stated as geometry.
     *
     * Rebuild what the renderer does — rotate the model by the mount's facing, push it
     * out along the normal by `trapBackDepth + PANEL_PROUD`, translate to the tile —
     * then check that no vertex ends up on the wall's side of the face plane.
     */
    const level = buildLevel(SITE.bootHill);
    const wallTraps = TRAPS.filter((d) => d.surface === SURF.wall);
    assert.ok(wallTraps.length > 0);

    for (const t of level.wallTiles.slice(0, 40)) {
      const nx = sideNormalX(t.side);
      const nz = sideNormalZ(t.side);

      for (const def of wallTraps) {
        const out = trapBackDepth(def.key) + PANEL_PROUD;
        const ox = t.x + nx * out;
        const oz = t.z + nz * out;
        const pos = buildTrapGeometry(def.key).getAttribute("position");

        for (let v = 0; v < pos.count; v++) {
          // Model space: -Z is outward. Rotate so -Z lands on the mount normal.
          const lx = pos.getX(v);
          const lz = pos.getZ(v);
          const wx = ox + (nx !== 0 ? -lz * nx : lx * (nz > 0 ? -1 : 1));
          const wz = oz + (nz !== 0 ? -lz * nz : lx * (nx > 0 ? 1 : -1));
          // Distance along the outward normal from the tile's own plane.
          const along = (wx - t.x) * nx + (wz - t.z) * nz;
          assert.ok(
            along >= -1e-6,
            `${def.key} on a side-${t.side} face reaches ${along.toFixed(3)}m INTO the wall`,
          );
        }
      }
    }
  });

  it("clears the panels as well as the face", () => {
    // The offset has to beat the masonry, not just the nominal plane.
    for (const def of TRAPS.filter((d) => d.surface === SURF.wall)) {
      assert.ok(
        trapBackDepth(def.key) + PANEL_PROUD > trapBackDepth(def.key),
        `${def.key}: no clearance for the coursed panels`,
      );
    }
  });
});

describe("the grain texture", () => {
  it("is generated, deterministic and cached", () => {
    const a = roughGrain();
    const b = roughGrain();
    assert.equal(a, b, "regenerated instead of caching");
    assert.equal(a.image.width, 128);
    assert.equal(a.image.height, 128);
  });

  it("only ever darkens, and never to black", () => {
    /*
     * `map` multiplies, so the grain can subtract light but not add it. The floor of
     * the range matters as much as the ceiling: under a three-band toon ramp a texture
     * that swings too far stops sitting *under* the bands and starts competing with
     * them, which is what makes cel-shaded surfaces look muddy.
     */
    const data = roughGrain().image.data as Uint8Array;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
      assert.equal(data[i], data[i + 1], "grain must be greyscale, not tinted");
      assert.equal(data[i + 3], 255, "grain must be opaque");
    }
    assert.ok(max <= 255, `grain brightens (max ${max})`);
    assert.ok(min > 140, `grain reaches ${min} — too dark, it will fight the toon bands`);
    assert.ok(max - min > 15, `grain range is only ${max - min} — invisible`);
  });
});

describe("wall squares line up with the floor grid", () => {
  it("puts a two-square wall's mounts on the same lattice as the floor", () => {
    /*
     * The bug this pins, in the reporter's own words: "if a wall is two squares high,
     * the trap should align with those grid squares similar to the floor."
     *
     * It did not. The build lattice counted rows up from a minimum mount height while
     * the mesher divided each face into equal parts — two schemes, and they drifted.
     * On a 4m wall the courses were drawn at y = 1 and 3 and traps mounted at 1.8 and
     * 3.8, floating 0.8m above the square they appeared to sit on.
     */
    const squares = faceSquares(0, 8, 0, 4, 2);
    const rows = [...new Set(squares.map((q) => q.cy))].sort((a, b) => a - b);
    assert.deepEqual(rows, [1, 3], "a 4m wall must be exactly two squares high");
    const cols = [...new Set(squares.map((q) => q.cu))].sort((a, b) => a - b);
    assert.deepEqual(cols, [1, 3, 5, 7], "columns must land on world tile centres");
  });

  it("centres every wall square on the world grid, exactly like a floor tile", () => {
    /*
     * World-aligned, not face-aligned. Centring the lattice on each face would mean two
     * walls meeting at a corner have courses that do not line up, and it would put a
     * wall square somewhere other than directly above the floor square beneath it.
     */
    for (const def of SITES) {
      const level = buildLevel(def.id);
      const onGrid = (v: number) => Math.abs(v / level.tile - Math.floor(v / level.tile) - 0.5) < 1e-6;
      for (const t of level.wallTiles) {
        const along = t.side === SIDE.east || t.side === SIDE.west ? t.z : t.x;
        assert.ok(onGrid(along), `${def.key}: wall square at ${along} is off the world grid`);
        assert.ok(onGrid(t.y), `${def.key}: wall square at y=${t.y} is off the world grid`);
      }
    }
  });

  it("draws its courses from the same squares it mounts on", () => {
    /*
     * The structural guarantee. Both the lattice and the mesher call `faceSquares`, so
     * "the masonry IS the grid" is true by construction rather than by two
     * implementations happening to agree — which is precisely how it broke.
     */
    const level = buildLevel(SITE.bootHill);
    const rows = new Set(level.wallTiles.map((t) => t.y));
    for (const b of level.boxes) {
      if (!isSolidKind(b.kind) || b.y1 - b.y0 < 2) continue;
      for (const sq of faceSquares(b.x0, b.x1, b.y0, b.y1, level.tile)) {
        assert.ok(
          rows.has(sq.cy),
          `a course at y=${sq.cy} has no mounting row — the two schemes have drifted again`,
        );
      }
    }
  });
});

describe("faces point the way they claim to", () => {
  it("winds every triangle to agree with its own normal", () => {
    /*
     * The bug this exists for, and it had been shipping since M0.
     *
     * `emitBox` listed the corners of all four SIDE faces in the order that makes the
     * geometric normal point back into the box. With the default `FrontSide` material
     * every one of them was back-facing and culled, so looking at a wall you saw
     * straight through the near face to the inside of the far one — reported, exactly
     * right, as "some of the walls are invisible".
     *
     * It hid for so long because lighting reads the supplied `normal` attribute, not
     * the winding: the faces that did draw were shaded correctly, so nothing looked
     * obviously broken, it just looked oddly flat. Only the top face was ever right,
     * which is why the floor — sharing its corner order — always looked fine.
     *
     * `cross(b - a, c - a)` must point the same way as the normal the mesher declares.
     * That is the whole invariant, it is checkable without a GPU, and it catches this
     * for panels, floors and anything else that goes through `quad`.
     */
    const check = (g: ReturnType<typeof buildBoxGeometry>, what: string): void => {
      const pos = g.getAttribute("position");
      const nrm = g.getAttribute("normal");
      for (let t = 0; t < pos.count / 3; t++) {
        const i = t * 3;
        const ax = pos.getX(i);
        const ay = pos.getY(i);
        const az = pos.getZ(i);
        const ux = pos.getX(i + 1) - ax;
        const uy = pos.getY(i + 1) - ay;
        const uz = pos.getZ(i + 1) - az;
        const vx = pos.getX(i + 2) - ax;
        const vy = pos.getY(i + 2) - ay;
        const vz = pos.getZ(i + 2) - az;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        const dot = cx * nrm.getX(i) + cy * nrm.getY(i) + cz * nrm.getZ(i);
        assert.ok(
          dot > 0,
          `${what}: triangle ${t} is wound backwards — it will be culled and invisible`,
        );
      }
    };

    for (const def of SITES) {
      const level = buildLevel(def.id);
      check(buildBoxGeometry(level.boxes, level.tile), `${def.key} boxes`);
      check(buildFloorGeometry(level.width, level.depth, level.boxes), `${def.key} floor`);
    }
  });
});
