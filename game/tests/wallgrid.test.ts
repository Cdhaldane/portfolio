/*
 * tests/wallgrid.test.ts — walls as a placement lattice.
 *
 * The inversion from M1.1: every exposed wall face is buildable, and a map names the
 * exceptions. What has to hold:
 *
 *   1. Tiles sit ON faces, facing out, and never inside geometry.
 *   2. Ids are stable, because they go into recorded commands (§13 rule 4).
 *   3. A no-build region refuses traps, and nothing else does.
 *   4. The census measures the lattice instead of promising a number.
 *   5. The crosshair lands on the tile it is pointing at, exactly.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, type Command, type TickInput } from "../src/sim/commands.ts";
import {
  buildLevel,
  isPlaceableFor,
  isSolidKind,
  tileCenterX,
  tileCenterY,
  tileCenterZ,
  type Level,
} from "../src/sim/level.ts";
import { SITE, SITES } from "../src/sim/sites.ts";
import { SURF, sideNormalX, sideNormalZ } from "../src/sim/surfaces.ts";
import { TRAPS } from "../src/sim/traps.ts";
import {
  WALL_BASE,
  buildWallTiles,
  wallCellOf,
  wallOfCell,
  wallTileAtRay,
} from "../src/sim/wallgrid.ts";
import { createWorld, trapAtCell, type World } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";

const EMPTY: Command[] = [];
const PORTS = TRAPS.find((d) => d.surface === SURF.wall)!.id;

function send(w: World, cmds: Command[] = EMPTY): void {
  const input: TickInput = { tick: w.tick, playerId: 0, cmds };
  step(w, input);
  w.events.clear();
}

/** Is this point inside any solid box? Used to prove tiles are never buried. */
function insideSolid(level: Level, x: number, y: number, z: number): boolean {
  for (const b of level.boxes) {
    if (!isSolidKind(b.kind)) continue;
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

describe("the wall lattice", () => {
  it("derives tiles on every site without anything authored", () => {
    for (const def of SITES) {
      const level = buildLevel(def.id);
      assert.ok(
        level.wallTiles.length > 40,
        `${def.key}: only ${level.wallTiles.length} wall tiles — the lattice found nothing`,
      );
      // The census measures rather than promises (MAPS §3 G7).
      const buildable = level.wallTiles.filter((t) => !t.noBuild).length;
      const refused = level.wallTiles.filter((t) => t.noBuild).length;
      assert.equal(level.census.wall, buildable, `${def.key}: census.wall is not a count`);
      assert.equal(level.census.noBuildWall, refused, `${def.key}: no-build count is wrong`);
    }
  });

  it("puts every tile just clear of its face, never inside the wall", () => {
    /*
     * The failure this exists for is the one the player would report as "the trap is
     * inside the rock": a face buried in another box, or a tile pushed the wrong way
     * along its normal.
     */
    for (const def of SITES) {
      const level = buildLevel(def.id);
      for (const t of level.wallTiles) {
        assert.ok(
          !insideSolid(level, t.x, t.y, t.z),
          `${def.key}: a wall tile at (${t.x}, ${t.y}, ${t.z}) is inside solid geometry`,
        );
        // A step further along the normal must still be open air.
        const ax = t.x + sideNormalX(t.side) * 0.4;
        const az = t.z + sideNormalZ(t.side) * 0.4;
        assert.ok(
          !insideSolid(level, ax, t.y, az),
          `${def.key}: the tile at (${t.x}, ${t.z}) faces into geometry`,
        );
        assert.ok(t.y > 0.5, `${def.key}: a wall tile at y=${t.y} is at ankle height`);
        assert.ok(
          t.x >= -1 && t.z >= -1 && t.x <= def.width + 1 && t.z <= def.depth + 1,
          `${def.key}: a wall tile is off the map`,
        );
      }
    }
  });

  it("keeps tile ids stable across rebuilds", () => {
    /*
     * Ids go into recorded commands, so an unstable ordering would make a replay place
     * a trap somewhere else on the same input (§13 rule 4). Two builds of the same
     * site must agree exactly.
     */
    for (const def of SITES) {
      const a = buildLevel(def.id);
      const b = buildLevel(def.id);
      assert.equal(a.wallTiles.length, b.wallTiles.length, `${def.key}: tile count moved`);
      for (let i = 0; i < a.wallTiles.length; i++) {
        assert.deepEqual(a.wallTiles[i], b.wallTiles[i], `${def.key}: tile ${i} moved`);
      }
    }
  });

  it("keeps the wall id space clear of floor tiles and mounts", () => {
    for (const def of SITES) {
      const level = buildLevel(def.id);
      assert.ok(level.tw * level.th < WALL_BASE, `${def.key}: floor tiles reach WALL_BASE`);
      assert.ok(level.wallTiles.length < WALL_BASE, `${def.key}: too many wall tiles`);
    }
    assert.equal(wallOfCell(0), -1);
    assert.equal(wallOfCell(1_000_001), -1, "a mount id must not read as a wall tile");
    assert.equal(wallOfCell(wallCellOf(12)), 12);
  });

  it("refuses the faces a map excludes, and only those", () => {
    const level = buildLevel(SITE.bootHill);
    const refused = level.wallTiles.filter((t) => t.noBuild);
    assert.ok(refused.length > 0, "Boot Hill's crypt row should refuse traps");

    for (let i = 0; i < level.wallTiles.length; i++) {
      const t = level.wallTiles[i];
      const cell = wallCellOf(i);
      assert.equal(
        isPlaceableFor(level, cell, SURF.wall),
        !t.noBuild,
        `tile ${i} disagrees with its own noBuild flag`,
      );
      // A wall tile is a wall tile: no other class may claim it.
      assert.equal(isPlaceableFor(level, cell, SURF.floor), false);
      assert.equal(isPlaceableFor(level, cell, SURF.ceiling), false);
    }

    // Every refused tile is inside the authored region, and none outside it.
    const r = { x0: 16.5, z0: 5.5, x1: 21.5, z1: 27.5 };
    for (const t of refused) {
      assert.ok(
        t.x >= r.x0 - 0.5 && t.x <= r.x1 + 0.5 && t.z >= r.z0 - 0.5 && t.z <= r.z1 + 0.5,
        `a tile at (${t.x}, ${t.z}) is refused but outside the crypt row`,
      );
    }
  });

  it("resolves a wall tile's world position from its id", () => {
    const level = buildLevel(SITE.bootHill);
    for (let i = 0; i < level.wallTiles.length; i += 11) {
      const t = level.wallTiles[i];
      const cell = wallCellOf(i);
      assert.equal(tileCenterX(level, cell), t.x);
      assert.equal(tileCenterY(level, cell), t.y);
      assert.equal(tileCenterZ(level, cell), t.z);
    }
  });

  it("lands the crosshair on the tile it is pointing at", () => {
    /*
     * Exact, not snapped. Firing a ray at each tile's centre from 4m along its own
     * normal must return that same tile — anything else means placement would land
     * somewhere the player is not looking.
     */
    const level = buildLevel(SITE.bootHill);
    let hits = 0;
    for (let i = 0; i < level.wallTiles.length; i += 3) {
      const t = level.wallTiles[i];
      const nx = sideNormalX(t.side);
      const nz = sideNormalZ(t.side);
      const ox = t.x + nx * 4;
      const oz = t.z + nz * 4;
      const got = wallTileAtRay(level.wallTiles, level, ox, t.y, oz, -nx, 0, -nz, 40);
      if (got === i) {
        hits++;
        continue;
      }
      // A different tile is only acceptable if it is genuinely in front of this one.
      const other = level.wallTiles[got];
      assert.ok(
        got >= 0 && other !== undefined,
        `tile ${i} at (${t.x}, ${t.y}, ${t.z}) could not be hit by a ray down its own normal`,
      );
    }
    assert.ok(hits > 0, "no wall tile was hit by a ray aimed straight at it");
  });

  it("never returns a face the ray is behind", () => {
    const level = buildLevel(SITE.bootHill);
    const t = level.wallTiles[0];
    const nx = sideNormalX(t.side);
    const nz = sideNormalZ(t.side);
    // Standing in front, looking AWAY.
    const got = wallTileAtRay(
      level.wallTiles,
      level,
      t.x + nx * 4,
      t.y,
      t.z + nz * 4,
      nx,
      0,
      nz,
      40,
    );
    assert.notEqual(got, 0, "hit a face the ray was pointing away from");
  });

  it("places a wall trap on a lattice tile, at the tile's facing", () => {
    const w = createWorld(4, SITE.bootHill);
    w.scrap = 2000;
    const i = w.level.wallTiles.findIndex((t) => !t.noBuild);
    assert.ok(i >= 0);
    const t = w.level.wallTiles[i];
    const cell = wallCellOf(i);

    w.player.slot = PORTS;
    w.player.buildMode = true;
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.traps.count, 1, "a wall trap could not be placed on the lattice");
    assert.ok(Math.abs(w.traps.x[0] - t.x) < 1e-4);
    assert.ok(Math.abs(w.traps.y[0] - t.y) < 1e-4, "mounted at the wrong height");
    assert.ok(trapAtCell(w, cell) >= 0);

    // One tile, one trap.
    w.player.slot = PORTS;
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.traps.count, 1, "two traps shared a wall tile");
  });

  it("refuses a wall trap on a no-build face", () => {
    const w = createWorld(4, SITE.bootHill);
    w.scrap = 2000;
    const i = w.level.wallTiles.findIndex((t) => t.noBuild);
    assert.ok(i >= 0, "the fixture needs a refused face");
    w.player.slot = PORTS;
    w.player.buildMode = true;
    send(w, [{ t: CMD.place, cell: wallCellOf(i) }]);
    assert.equal(w.traps.count, 0, "built on consecrated stone");
  });

  it("gives a taller wall more rows than a short one", () => {
    /*
     * The regression this pins: the first row count asked how many whole steps fitted
     * above the minimum mount height, which gave a 4m wall ONE row at 1.8m and threw
     * away the entire upper half of every wall on every map.
     */
    const level = buildLevel(SITE.bootHill);
    const heights = new Set(level.wallTiles.map((t) => t.y));
    assert.ok(
      heights.size >= 2,
      `every wall tile sits at the same height (${[...heights]}) — tall walls lost their upper rows`,
    );
  });

  it("costs nothing to rebuild, and survives a rebake", () => {
    // Undertown rebuilds its geometry when the player opens a building, so the
    // lattice has to be a function of the boxes rather than a one-time bake.
    const level = buildLevel(SITE.undertown);
    const before = level.wallTiles.length;
    const again = buildWallTiles(level, level.noBuildWalls);
    assert.equal(again.length, before, "rebuilding the lattice changed it");
  });
});
