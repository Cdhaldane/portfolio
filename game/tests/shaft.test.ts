/*
 * tests/shaft.test.ts — Shaft Nine's vertical contract.
 *
 * The first map with a Y axis, and the first map where "it works" cannot be
 * read off the flow field alone: bodies have to spawn on the floor their gate
 * stands on, ride stair treads with their feet, and be stopped by a staircase's
 * flank the way they are stopped by a wall. Every test here is a bug that
 * actually shipped in the first cut — enemies walking the void beneath the
 * gallery and surfacing through the ramp, catwalk flights authored a metre
 * below the floor they stood on, and a 6m tread stack you could stroll through
 * sideways.
 *
 *   node --experimental-strip-types --test tests/shaft.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLevel, cellOf, flowDir, groundHeight, type Level } from "../src/sim/level.ts";
import { resolveCircle } from "../src/sim/geom.ts";
import { BOX } from "../src/sim/level.ts";
import { PLAYER } from "../src/sim/tuning.ts";
import { SITE } from "../src/sim/sites.ts";
import { CATWALK, GALLERY, SHAFT_AIR } from "../src/sim/shaft.ts";
import { createWorld, spawnEnemy } from "../src/sim/world.ts";

const level = (): Level => buildLevel(SITE.shaft);

/** Walk a straight line, riding groundHeight, and return every step's rise. */
function ride(
  l: Level,
  x0: number,
  z0: number,
  z1: number,
  startY: number,
): { y: number; maxRise: number } {
  let y = startY;
  let maxRise = 0;
  const dz = z1 > z0 ? 0.2 : -0.2;
  for (let z = z0; dz > 0 ? z <= z1 : z >= z1; z += dz) {
    const next = groundHeight(l, x0, z, y + 0.5);
    maxRise = Math.max(maxRise, next - y);
    y = next;
  }
  return { y, maxRise };
}

describe("Shaft Nine — stairs that exist and cannot be walked through", () => {
  it("authors the catwalk flights ON the gallery, not in the void below it", () => {
    // The regression: stepsZ built every tread from y0=0, so a flight standing
    // on the +6 gallery topped out at 5.1m — under its own floor — and the
    // catwalk was unreachable.
    const l = level();
    const flight = l.boxes.filter(
      (b) => b.kind === BOX.step && b.x0 > 6 && b.x1 < 10 && b.z0 >= 15 && b.z1 <= 24,
    );
    assert.ok(flight.length >= 10, "the west flight is missing");
    for (const tread of flight) {
      assert.equal(tread.y0, GALLERY, "a tread must stand on the gallery floor");
    }
    const top = Math.max(...flight.map((b) => b.y1));
    assert.ok(top >= CATWALK - 0.15, `flight tops out at ${top}, catwalk is ${CATWALK}`);
  });

  it("lets the player climb gallery → catwalk in step-size rises", () => {
    const l = level();
    const walk = ride(l, 8, 16.1, 24.5, GALLERY);
    assert.ok(
      walk.maxRise <= PLAYER.stepOffset,
      `a riser of ${walk.maxRise.toFixed(2)} needs a jump — flights must be walkable`,
    );
    assert.ok(walk.y >= CATWALK - 0.05, `the walk ends at ${walk.y}, not on the catwalk`);
  });

  it("descends the haulage ramp tread by tread, gallery to stope", () => {
    const l = level();
    let y = GALLERY;
    for (let z = 29.8; z <= 38.6; z += 0.2) {
      const next = groundHeight(l, 10, z, y + 0.5);
      assert.ok(y - next <= 0.45, `a ${(y - next).toFixed(2)}m drop mid-ramp at z=${z}`);
      y = next;
    }
    assert.ok(y <= 0.35, `the ramp ends ${y}m above the stope floor`);
  });

  it("stops a body at the ramp's flank instead of letting it clip through", () => {
    // The treads beside the lip are 6m tall. A body at stope level walking west
    // into them must be pushed out — a staircase's side is a wall (geom.ts
    // STEP_FLANK), not a doorway into the mesh.
    const l = level();
    const out = new Float64Array(2);
    resolveCircle(l, 14.3, 34, 0.45, 0.15, 1.95, out, PLAYER.stepOffset);
    assert.ok(out[0] >= 14.4, `pushed to x=${out[0].toFixed(2)} — still inside the flank`);

    // Control: the same body ON the ramp, climbing, is not touched. The flank
    // rule must never fight the climb it exists beside.
    const feet = groundHeight(l, 10, 34, 6.5);
    resolveCircle(l, 10, 34, 0.8, feet + 0.15, feet + 2.8, out, PLAYER.stepOffset);
    assert.ok(
      Math.abs(out[0] - 10) < 1e-9 && Math.abs(out[1] - 34) < 1e-9,
      "even the fattest climber must ride the treads unbothered",
    );
  });

  it("keeps the field out of the flank and off the player's flights", () => {
    const l = level();
    // The flank strip and both flights are navBlocked: collision says wall, so
    // the field must never steer a body there (the anti-softlock agreement).
    assert.equal(l.blocked[cellOf(l, 14.5, 34)], 1, "the ramp flank must be no-path");
    assert.equal(l.blocked[cellOf(l, 8, 20)], 1, "the west flight must be no-path");
    assert.equal(l.blocked[cellOf(l, 54, 20)], 1, "the east flight must be no-path");
    // And the ramp itself must not be: it is the only lane between the levels.
    assert.equal(l.blocked[cellOf(l, 10, 34)], 0, "the ramp must stay routable");
  });

  it("spawns bodies on the floor their gate stands on", () => {
    // The worst version of the bug: gallery gates spawned bodies at y=0, and the
    // whole lane was walked in the void UNDER the deck — enemies surfacing
    // through the ramp's treads, reading as clipping out of the staircase.
    const w = createWorld(7, SITE.shaft, true);
    const g1 = spawnEnemy(w, 61, 24); // rail gate — on the gallery deck
    const g3 = spawnEnemy(w, 61, 42); // lower drift — on the stope floor
    assert.equal(w.enemies.y[g1], GALLERY, "G1 must arrive on the gallery");
    assert.equal(w.enemies.y[g3], 0, "G3 must arrive on the stope");
  });

  it("walks every gate to the Rift with ground and collision engaged", () => {
    /*
     * The end-to-end proof, and the guard for the flank rule: follow the flow
     * field exactly the way a body does — feet on groundHeight, resolveCircle
     * every step — and every gate must still arrive. A wedge anywhere (field
     * says west, collision says no) fails this long before a player finds it.
     */
    const l = level();
    const dir = new Float64Array(2);
    const out = new Float64Array(2);
    for (const gate of l.gates) {
      let x = gate.x;
      let z = gate.z;
      let y = groundHeight(l, x, z, 8);
      let reached = false;
      for (let i = 0; i < 4000 && !reached; i++) {
        const dx = x - l.rift.x;
        const dz = z - l.rift.z;
        if (Math.sqrt(dx * dx + dz * dz) <= l.rift.radius + 0.4) {
          reached = true;
          break;
        }
        flowDir(l, x, z, dir);
        if (dir[0] === 0 && dir[1] === 0) break;
        resolveCircle(l, x + dir[0] * 0.1, z + dir[1] * 0.1, 0.45, y + 0.15, y + 1.95, out, PLAYER.stepOffset, true);
        // Wedged: pushed back to where we started while the field still points on.
        x = out[0];
        z = out[1];
        y = groundHeight(l, x, z, y + 0.5);
      }
      assert.ok(
        reached,
        `gate (${gate.x}, ${gate.z}) never reached the Rift with collision on`,
      );
    }
  });
});

describe("Shaft Nine — the dark carries its own lamps", () => {
  it("hangs a lantern pool on every timber set, and lights the stope", () => {
    // MAPS §6: when the dark fails, "the fix is lantern density rather than fog
    // distance". The fog is untouched; the lamps are data, so they are pinned.
    assert.ok((SHAFT_AIR.lamps?.length ?? 0) >= 8, "the lantern pools are gone");
    assert.ok(SHAFT_AIR.hemi >= 0.6, "the bounce fell below readable again");
    const stope = (SHAFT_AIR.lamps ?? []).filter((l) => l.z > 30);
    assert.ok(stope.length >= 2, "the stope fights in the dark");
  });
});
