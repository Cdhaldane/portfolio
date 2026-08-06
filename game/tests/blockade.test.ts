/*
 * tests/blockade.test.ts — the Dead Man's Brace.
 *
 * The blockade is the first trap that changes the *map*, so its tests are about
 * geometry and pathing rather than damage. Four promises:
 *
 *   1. It reroutes bodies — the flow field actually goes around it.
 *   2. It can narrow a lane but NEVER seal it.
 *   3. It stops enemies only. The player and their shots pass straight through.
 *   4. Putting one up and taking it down leaves the map exactly as it was.
 *
 * Promise 2 is the one worth the most scrutiny, because the failure mode is a run
 * that cannot be lost turning into a run that cannot be played: seal every gate and
 * the bodies stop arriving, the round never ends, and there is nothing on screen to
 * explain why.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, type Command, type TickInput } from "../src/sim/commands.ts";
import {
  buildLevel,
  cellOf,
  isPlaceable,
  rebake,
  tileCenterX,
  tileCenterZ,
  tileOf,
  wouldSealLane,
  type Level,
} from "../src/sim/level.ts";
import { resolveCircle } from "../src/sim/geom.ts";
import { SITE } from "../src/sim/sites.ts";
import { TRAPS } from "../src/sim/traps.ts";
import { PHASE, createWorld, spawnEnemy, trapAtCell, type World } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { PLAYER } from "../src/sim/tuning.ts";

const EMPTY: Command[] = [];
const BRACE = TRAPS.find((d) => d.blocks === true)!.id;

function send(w: World, cmds: Command[] = EMPTY): void {
  const input: TickInput = { tick: w.tick, playerId: 0, cmds };
  step(w, input);
  w.events.clear();
}

/** Place a blockade on the tile nearest (x, z). Returns the tile id. */
function brace(w: World, x: number, z: number): number {
  const tile = tileOf(w.level, x, z);
  w.player.slot = BRACE;
  w.player.buildMode = true;
  send(w, [{ t: CMD.place, cell: tile }]);
  return tile;
}

/** Every nav cell the Rift can reach, by flooding `dist`. */
function reachableGates(level: Level): boolean[] {
  return level.gates.map((g) => {
    const c = cellOf(level, g.x, g.z);
    return c >= 0 && Number.isFinite(level.dist[c]);
  });
}

describe("the Dead Man's Brace", () => {
  it("is an obstacle with no upgrades and no effects", () => {
    const def = TRAPS[BRACE];
    assert.equal(def.blocks, true);
    assert.equal(def.effects.length, 0, "an obstacle should not also deal damage");
    assert.equal(def.upgrades, undefined, "§6 forbids inventing a choice to fill the slot");
  });

  it("blocks the flow field where it stands", () => {
    const w = createWorld(3, SITE.bootHill);
    w.scrap = 2000;
    const tile = tileOf(w.level, 27, 17);
    const nav = cellOf(w.level, 27, 17);
    assert.equal(w.level.blocked[nav], 0, "the fixture cell should start walkable");

    brace(w, 27, 17);
    assert.ok(trapAtCell(w, tile) >= 0, "the blockade was not placed");
    assert.equal(w.level.blockTiles[tile], 1, "the tile was not flagged");
    assert.equal(w.level.blocked[nav], 1, "the flow field walked straight through it");
    assert.equal(w.level.blockBoxes.length, 1, "no collision box was baked");
  });

  it("leaves the map exactly as it was when sold", () => {
    /*
     * The blockade is the only trap that mutates the level, so putting one up and
     * pulling it down has to be a true round trip — a stale `blocked` cell would be a
     * permanent invisible wall, and nothing on screen would explain it.
     */
    const w = createWorld(3, SITE.bootHill);
    w.scrap = 2000;
    const before = Array.from(w.level.blocked);
    const distBefore = Array.from(w.level.dist);

    const tile = brace(w, 27, 17);
    assert.notDeepEqual(Array.from(w.level.blocked), before, "placing changed nothing");

    send(w, [{ t: CMD.sell, cell: tile }]);
    assert.equal(trapAtCell(w, tile), -1, "the blockade survived being sold");
    assert.equal(w.level.blockTiles[tile], 0, "the tile stayed flagged after selling");
    assert.deepEqual(Array.from(w.level.blocked), before, "blocked cells did not come back");
    assert.deepEqual(Array.from(w.level.dist), distBefore, "the field did not come back");
    assert.equal(w.level.blockBoxes.length, 0, "a collision box was left behind");
  });

  it("cannot be sealed by ANY sequence of legal blockades", () => {
    /*
     * The real invariant, and it took a wrong test to find the right one.
     *
     * The first version filled Boot Hill's 4m orchard gap and expected a refusal. It
     * never came, and the game was right: the fence stops at z=26 and there is a
     * southern loop past its end, so walling the pinch shut is a perfectly legal move
     * that costs the bodies distance rather than a route. "Every chokepoint stays
     * open" was never the promise — "a gate keeps SOME route" is.
     *
     * So this asserts the property directly and depends on no map trivia: greedily
     * build a blockade on every tile the game will allow, in order, and afterwards
     * every gate must still reach the Rift. With no rule at all this walls the map
     * solid; the refusals are what stop it.
     */
    for (const site of [SITE.bootHill, SITE.creekPinch]) {
      const w = createWorld(3, site);
      w.scrap = 1e9;
      w.player.slot = BRACE;
      w.player.buildMode = true;

      const tiles = w.level.blockTiles.length;
      let placed = 0;
      let refused = 0;
      for (let tile = 0; tile < tiles; tile++) {
        if (!isPlaceable(w.level, tile)) continue;
        const n = w.traps.count;
        send(w, [{ t: CMD.place, cell: tile }]);
        if (w.traps.count > n) placed++;
        else refused++;
      }

      assert.ok(placed > 20, `${site}: only ${placed} blockades went up`);
      assert.ok(
        refused > 0,
        `${site}: every single tile accepted a blockade — the seal rule never fired`,
      );
      assert.deepEqual(
        reachableGates(w.level),
        w.level.gates.map(() => true),
        `${site}: a gate lost its route after ${placed} legal blockades`,
      );
      // A route existing is not enough: bodies have to be able to walk it.
      for (const g of w.level.gates) {
        const c = cellOf(w.level, g.x, g.z);
        assert.equal(w.level.blocked[c], 0, `${site}: gate (${g.x}, ${g.z}) got walled in`);
      }
    }
  });

  it("refuses to seal the pinch even when the player can afford to", () => {
    // Hollow Creek's gap is the same 4m, and the money is not the constraint.
    const w = createWorld(9, SITE.creekPinch);
    w.scrap = 100000;
    for (let z = 15.5; z <= 18.5; z += 1) {
      const tile = tileOf(w.level, 26.5, z);
      if (tile < 0 || !isPlaceable(w.level, tile)) continue;
      w.player.slot = BRACE;
      w.player.buildMode = true;
      send(w, [{ t: CMD.place, cell: tile }]);
    }
    assert.deepEqual(
      reachableGates(w.level),
      w.level.gates.map(() => true),
      "the pinch was sealed shut",
    );
  });

  it("keeps wouldSealLane pure — the ghost asks it every frame", () => {
    /*
     * The host calls this from the render path, so a version that mutated to test
     * would have the renderer writing sim state (§12.2) and would break determinism.
     * Asserted by fingerprinting the whole level around a call.
     */
    const level = buildLevel(SITE.bootHill);
    const snap = () =>
      JSON.stringify([
        Array.from(level.blocked),
        Array.from(level.dist),
        Array.from(level.flowX),
        Array.from(level.blockTiles),
        level.blockBoxes.length,
        level.census,
      ]);
    const before = snap();
    for (let t = 0; t < level.blockTiles.length; t += 7) wouldSealLane(level, t);
    assert.equal(snap(), before, "wouldSealLane mutated the level");
  });

  it("agrees with what rebake would actually do", () => {
    /*
     * The preview and the real thing have to give the same answer, or the ghost turns
     * green on a placement the command system then refuses. Checked by actually
     * baking each candidate and comparing.
     */
    const level = buildLevel(SITE.bootHill);
    for (let tile = 0; tile < level.blockTiles.length; tile += 5) {
      if (!isPlaceable(level, tile)) continue;
      const predicted = wouldSealLane(level, tile);

      level.blockTiles[tile] = 1;
      rebake(level);
      const actual = level.gates.some((g) => {
        const c = cellOf(level, g.x, g.z);
        return c < 0 || !Number.isFinite(level.dist[c]);
      });
      level.blockTiles[tile] = 0;
      rebake(level);

      assert.equal(
        predicted,
        actual,
        `tile ${tile} at (${tileCenterX(level, tile)}, ${tileCenterZ(level, tile)}): ` +
          `preview said ${predicted}, baking said ${actual}`,
      );
    }
  });

  it("stops bodies and not the player", () => {
    // Promise 3, at the collision layer where the difference actually lives.
    const level = buildLevel(SITE.bootHill);
    const tile = tileOf(level, 27, 17);
    level.blockTiles[tile] = 1;
    rebake(level);

    const x = tileCenterX(level, tile);
    const z = tileCenterZ(level, tile);
    const out = new Float64Array(2);

    // A body walking into it gets pushed out.
    resolveCircle(level, x, z, 0.45, 0.15, 1.8, out, PLAYER.stepOffset, true);
    assert.ok(
      Math.hypot(out[0] - x, out[1] - z) > 0.1,
      "a body was not stopped by the blockade",
    );

    // The player, on the same spot, is not.
    resolveCircle(level, x, z, PLAYER.radius, 0.15, 1.8, out, PLAYER.stepOffset, false);
    assert.ok(
      Math.hypot(out[0] - x, out[1] - z) < 1e-6,
      "the player was blocked by their own blockade",
    );
  });

  it("reroutes a body instead of trapping it", () => {
    /*
     * The end-to-end version: a Dustkin heading down the lane must still be making
     * progress toward the Rift after a blockade lands in front of it. The failure this
     * guards is the M1.0 softlock — a body in a blocked cell with no flow direction,
     * standing still for the rest of the run.
     */
    const w = createWorld(5, SITE.bootHill);
    w.scrap = 2000;
    w.phase = PHASE.combat;
    // Park the player out of the lane so melee cannot end the test early.
    w.player.x = 2;
    w.player.z = 2;

    const i = spawnEnemy(w, 34, 16, 0);
    assert.ok(i >= 0);
    brace(w, 30.5, 16.5);

    const startDist = w.level.dist[cellOf(w.level, w.enemies.x[i], w.enemies.z[i])];
    let moved = 0;
    for (let t = 0; t < 600 && w.enemies.alive[i]; t++) {
      const px = w.enemies.x[i];
      const pz = w.enemies.z[i];
      send(w);
      moved += Math.hypot(w.enemies.x[i] - px, w.enemies.z[i] - pz);
    }
    assert.ok(moved > 6, `the body only travelled ${moved.toFixed(2)}m — it is stuck`);
    if (w.enemies.alive[i]) {
      const nowCell = cellOf(w.level, w.enemies.x[i], w.enemies.z[i]);
      assert.ok(
        Number.isFinite(w.level.dist[nowCell]) && w.level.dist[nowCell] < startDist,
        "the body moved but got no closer to the Rift",
      );
    }
  });

  it("costs scrap and refunds like any other trap", () => {
    const w = createWorld(3, SITE.bootHill);
    w.scrap = 500;
    const def = TRAPS[BRACE];
    const tile = brace(w, 27, 17);
    assert.equal(w.scrap, 500 - def.cost, "the blockade was free");
    send(w, [{ t: CMD.sell, cell: tile }]);
    assert.ok(w.scrap > 500 - def.cost, "selling refunded nothing");
  });

  it("cannot be upgraded, and never takes the money for it", () => {
    // The bug this exists for: an optional `upgrades` let `upgradeTrap` charge full
    // price, mark the instance, and resolve straight back to the base def.
    const w = createWorld(3, SITE.bootHill);
    w.scrap = 2000;
    const tile = brace(w, 27, 17);
    const purse = w.scrap;
    send(w, [{ t: CMD.upgrade, cell: tile, choice: 1 }]);
    assert.equal(w.scrap, purse, "charged for an upgrade that does not exist");
    assert.equal(w.traps.upgrade[trapAtCell(w, tile)], 0, "marked as upgraded anyway");
  });
});
