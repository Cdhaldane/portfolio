/*
 * tests/surfaces.test.ts — where a trap may mount (MAPS §9 item 5).
 *
 * The rules under test are the ones that make wall and ceiling traps a *decision*
 * rather than more floor traps: a mount is authored, a mount takes one trap, a
 * class cannot be substituted for another, and only a roof trap reaches the air.
 *
 * The surface census is checked here too, because it is a contract rather than
 * documentation — the wave director refuses archetypes a site cannot answer, so a
 * census that drifts from the geometry silently changes the roster (§3 G7).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, type Command, type TickInput } from "../src/sim/commands.ts";
import {
  SLOT_BASE,
  buildLevel,
  cellOfSlot,
  isPlaceable,
  isPlaceableFor,
  tileCenterX,
  tileCenterY,
  tileCenterZ,
  tileOf,
  slotOfCell,
} from "../src/sim/level.ts";
import { ENEMY } from "../src/sim/enemies.ts";
import { SITE, SITES, siteDef } from "../src/sim/sites.ts";
import { SURF, censusOf, type SurfaceClass } from "../src/sim/surfaces.ts";
import { wallCellOf } from "../src/sim/wallgrid.ts";
import { REACH, TRAPS, trapDef } from "../src/sim/traps.ts";
import { PHASE, createWorld, spawnEnemy, trapAtCell, type World } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";

const EMPTY: Command[] = [];

/** Trap def ids, by key, so the tests read as the catalog does. */
const ID: Record<string, number> = {};
for (const d of TRAPS) ID[d.key] = d.id;

function armed(w: World, defId: number): void {
  w.player.slot = defId;
  w.player.buildMode = true;
}

/** Run one tick with these commands, through the real command system. */
function send(w: World, cmds: Command[] = EMPTY): void {
  const input: TickInput = { tick: w.tick, playerId: 0, cmds };
  step(w, input);
  // The host drains the ring once a frame; do the same so a long run cannot
  // silently overflow it.
  w.events.clear();
}

describe("surface classes", () => {
  it("gives every trap a surface and a reach", () => {
    for (const d of TRAPS) {
      assert.ok(
        d.surface === SURF.floor ||
          d.surface === SURF.wall ||
          d.surface === SURF.ceiling ||
          d.surface === SURF.sigil,
        `${d.key}: surface ${d.surface} is not a class a site can author`,
      );
      assert.ok(
        d.reach === REACH.ground || d.reach === REACH.air || d.reach === REACH.both,
        `${d.key}: reach ${d.reach} is not a REACH value`,
      );
    }
  });

  it("keeps the mount id space clear of real cells", () => {
    /*
     * Mounts are addressed as `SLOT_BASE + n` so one `cell` field can identify any
     * trap (see sim/level.ts). That only works while no real grid can reach
     * SLOT_BASE — 1e6 cells is a 1000x1000m site, far past anything authorable.
     */
    for (const def of SITES) {
      const level = buildLevel(def.id);
      const tiles = level.tw * level.th;
      assert.ok(
        tiles < SLOT_BASE,
        `${def.key} has ${tiles} build tiles, which collides with the mount id space`,
      );
    }
    assert.equal(slotOfCell(0), -1);
    assert.equal(slotOfCell(999), -1);
    assert.equal(slotOfCell(cellOfSlot(4)), 4);
  });

  it("refuses a wall trap on the floor, and a floor trap on a wall", () => {
    /*
     * Both directions, not just the interesting one.
     *
     * A browser run appeared to place a floor trap with a wall trap armed, which
     * would have meant `isPlaceableFor` was gating nothing. It turned out the
     * hotbar's digit mapping had shifted under the harness and a floor trap really
     * was armed — but "the observation was explained" is not the same as "the rule
     * is enforced", so both directions are pinned here instead.
     */
    const level = buildLevel(SITE.bootHill);
    const floorCell = tileOf(level, 12.5, 24.5);
    assert.ok(isPlaceable(level, floorCell), "picked a cell that is not open floor");

    assert.equal(isPlaceableFor(level, floorCell, SURF.floor), true);
    assert.equal(isPlaceableFor(level, floorCell, SURF.wall), false);
    assert.equal(isPlaceableFor(level, floorCell, SURF.ceiling), false);

    /* Wall placements come from the derived lattice now, not from authored mounts
       (sim/wallgrid.ts). The classes still may not be substituted for one another,
       which is what this test is actually about. */
    const wallIdx = level.wallTiles.findIndex((t) => !t.noBuild);
    assert.ok(wallIdx >= 0, "Boot Hill derives no buildable wall tile");
    const wallCell = wallCellOf(wallIdx);
    assert.equal(isPlaceableFor(level, wallCell, SURF.wall), true);
    assert.equal(isPlaceableFor(level, wallCell, SURF.floor), false);
    assert.equal(isPlaceableFor(level, wallCell, SURF.ceiling), false);
  });

  it("denies the place command when the surface is wrong", () => {
    // The end-to-end version of the above, through the command system.
    const w = createWorld(7, SITE.bootHill);
    w.scrap = 900;
    const floorCell = tileOf(w.level, 12.5, 24.5);

    armed(w, ID.ports); // a wall trap
    send(w, [{ t: CMD.place, cell: floorCell }]);
    assert.equal(w.traps.count, 0, "a wall trap was allowed onto open floor");

    armed(w, ID.tar); // a floor trap
    const wallCell = wallCellOf(w.level.wallTiles.findIndex((t) => !t.noBuild));
    send(w, [{ t: CMD.place, cell: wallCell }]);
    assert.equal(w.traps.count, 0, "a floor trap was allowed onto a wall mount");

    // ...and the right pairing does work, so the test above is not just refusing
    // everything.
    armed(w, ID.ports);
    send(w, [{ t: CMD.place, cell: wallCell }]);
    assert.equal(w.traps.count, 1, "a wall trap could not be placed on a wall mount");
  });

  it("mounts the trap at the authored height and facing", () => {
    const w = createWorld(7, SITE.bootHill);
    w.scrap = 900;
    const si = w.level.wallTiles.findIndex((t) => !t.noBuild);
    const slot = w.level.wallTiles[si];
    armed(w, ID.ports);
    send(w, [{ t: CMD.place, cell: wallCellOf(si) }]);
    assert.equal(w.traps.count, 1);

    assert.ok(Math.abs(w.traps.x[0] - slot.x) < 1e-4);
    assert.ok(Math.abs(w.traps.z[0] - slot.z) < 1e-4);
    assert.ok(
      Math.abs(w.traps.y[0] - slot.y) < 1e-4,
      `mounted at y=${w.traps.y[0]}, authored y=${slot.y}`,
    );
    // A floor trap must stay at zero, or every ground trap floats.
    armed(w, ID.tar);
    send(w, [{ t: CMD.place, cell: tileOf(w.level, 12.5, 24.5) }]);
    const floorIdx = w.traps.cell[0] >= SLOT_BASE ? 1 : 0;
    assert.equal(w.traps.y[floorIdx], 0);
  });

  it("lets one mount hold exactly one trap", () => {
    const w = createWorld(7, SITE.bootHill);
    w.scrap = 900;
    const cell = wallCellOf(w.level.wallTiles.findIndex((t) => !t.noBuild));
    armed(w, ID.ports);
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.traps.count, 1);
    // Same mount, different trap: still occupied.
    armed(w, ID.lantern);
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.traps.count, 1, "a second trap shared one bracket");
    assert.ok(trapAtCell(w, cell) >= 0);
  });

  it("charges for a mounted trap, and refunds the mount on sell", () => {
    const w = createWorld(7, SITE.bootHill);
    w.scrap = 500;
    const cell = wallCellOf(w.level.wallTiles.findIndex((t) => !t.noBuild));
    armed(w, ID.ports);
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.scrap, 500 - trapDef(ID.ports).cost);
    send(w, [{ t: CMD.sell, cell }]);
    assert.equal(w.traps.count, 0, "selling a mounted trap left it in place");
    // And the mount is free again, or a sold bracket would be dead ground.
    armed(w, ID.lantern);
    send(w, [{ t: CMD.place, cell }]);
    assert.equal(w.traps.count, 1, "a sold mount could not be reused");
  });

  it("resolves cellCenter* for mounts as well as grid cells", () => {
    const level = buildLevel(SITE.bootHill);
    const si = level.slots.findIndex((s) => s.surface === SURF.ceiling);
    assert.ok(si >= 0, "Boot Hill authors no ceiling anchor");
    const slot = level.slots[si];
    const cell = cellOfSlot(si);
    assert.equal(tileCenterX(level, cell), slot.x);
    assert.equal(tileCenterZ(level, cell), slot.z);
    assert.equal(tileCenterY(level, cell), slot.y);
    // A grid cell still resolves to its centre, at ground height.
    const g = tileOf(level, 12.5, 24.5);
    assert.equal(tileCenterX(level, g), tileCenterX(level, g));
    assert.ok(Math.abs(tileCenterX(level, g) - 12.5) <= level.tile / 2);
    assert.equal(tileCenterY(level, g), 0);
  });
});

/*
 * The "mount picking" block that lived here is gone, not broken.
 *
 * It tested `slotNearRay` against authored WALL mounts, and walls are a derived
 * lattice now — picked by an exact raycast in `wallTileAtRay`, covered by
 * tests/wallgrid.test.ts. `slotNearRay` still serves ceilings and sigils, which are
 * genuinely discrete anchors and still snap.
 */

describe("reach", () => {
  /*
   * These tests pin the body in place between steps.
   *
   * The first attempt faked an airborne body with `grounded = 0` and it promptly
   * *fell*, landed, and got clamped by the ground trap the test was proving could
   * not reach it — the failure was the setup, not the rule. Pinning a real Buzzard
   * isolates the thing under test (the targeting predicate) from flight, gravity,
   * pathing and leaking, all of which have their own tests elsewhere.
   */
  function pinned(w: World, x: number, z: number, y: number, defId: number): number {
    const i = spawnEnemy(w, x, z, defId);
    const e = w.enemies;
    e.hp[i] = 5000;
    e.y[i] = y;
    e.grounded[i] = y > 0.05 ? 0 : 1;
    return i;
  }

  function hold(w: World, i: number, x: number, z: number, y: number, ticks: number): void {
    const e = w.enemies;
    for (let t = 0; t < ticks; t++) {
      e.x[i] = x;
      e.z[i] = z;
      e.y[i] = y;
      e.px[i] = x;
      e.pz[i] = z;
      e.py[i] = y;
      e.grounded[i] = y > 0.05 ? 0 : 1;
      e.hold[i] = 0;
      send(w);
    }
  }

  it("keeps every ground trap off a flier", () => {
    const w = createWorld(11, SITE.bootHill);
    w.phase = PHASE.combat;
    w.scrap = 4000;
    const beam = w.level.slots.find((sl) => sl.surface === SURF.ceiling)!;

    // A Buzzard hovering at its cruising height, right under the roof beam.
    const i = pinned(w, beam.x, beam.z, 4.6, ENEMY.buzzard);
    const before = w.enemies.hp[i];

    // Every ground trap in the catalog, stacked underneath it.
    for (const key of ["jaws", "tar", "vent", "plate", "sigil"]) {
      const d = trapDef(ID[key]);
      assert.equal(d.reach, REACH.ground, `${key} is no longer a ground trap`);
    }
    armed(w, ID.vent); // periodic: fires whether or not anything is there
    send(w, [{ t: CMD.place, cell: tileOf(w.level, beam.x, beam.z) }]);
    armed(w, ID.jaws);
    send(w, [{ t: CMD.place, cell: tileOf(w.level, beam.x + 2.5, beam.z) }]);
    assert.equal(w.traps.count, 2, "the ground traps were not placed");

    hold(w, i, beam.x, beam.z, 4.6, 300);
    assert.equal(
      w.enemies.hp[i],
      before,
      "a ground trap reached a flier — every trap being a ground trap is the Buzzard's whole argument",
    );
  });

  it("lets the roost reach what nothing else can", () => {
    const w = createWorld(11, SITE.bootHill);
    w.phase = PHASE.combat;
    w.scrap = 4000;
    const si = w.level.slots.findIndex((sl) => sl.surface === SURF.ceiling);
    const beam = w.level.slots[si];

    const i = pinned(w, beam.x, beam.z, 4.6, ENEMY.buzzard);
    const before = w.enemies.hp[i];

    armed(w, ID.roost);
    send(w, [{ t: CMD.place, cell: cellOfSlot(si) }]);
    assert.equal(w.traps.count, 1, "the roost was not placed on the beam");

    hold(w, i, beam.x, beam.z, 4.6, 300);
    assert.ok(
      w.enemies.hp[i] < before,
      "the Buzzard Roost never reached the air — it is the only trap that can",
    );
  });

  it("keeps the air-only roost off the ground", () => {
    const w = createWorld(11, SITE.bootHill);
    w.phase = PHASE.combat;
    w.scrap = 4000;
    const si = w.level.slots.findIndex((sl) => sl.surface === SURF.ceiling);
    const beam = w.level.slots[si];

    // A Dustkin standing directly beneath the beam, well inside the 9m radius.
    const i = pinned(w, beam.x, beam.z, 0, ENEMY.dustkin);
    const before = w.enemies.hp[i];

    armed(w, ID.roost);
    send(w, [{ t: CMD.place, cell: cellOfSlot(si) }]);
    hold(w, i, beam.x, beam.z, 0, 300);
    assert.equal(
      w.enemies.hp[i],
      before,
      "the roost shot something standing on the ground — it would just be a better floor trap",
    );
  });

  it("catches a body a Bone Plate throws into the air", () => {
    /*
     * The combo the reach rule exists to allow: `inReach` treats *launched* bodies
     * as airborne, not only fliers, so a plate feeding a roost is a real pairing
     * rather than a coincidence of two traps being near each other.
     */
    const w = createWorld(11, SITE.bootHill);
    w.phase = PHASE.combat;
    w.scrap = 4000;
    const si = w.level.slots.findIndex((sl) => sl.surface === SURF.ceiling);
    const beam = w.level.slots[si];

    const i = pinned(w, beam.x, beam.z, 0, ENEMY.dustkin);
    armed(w, ID.roost);
    send(w, [{ t: CMD.place, cell: cellOfSlot(si) }]);
    const before = w.enemies.hp[i];

    // Off the ground, as a launch would leave it, and held there.
    hold(w, i, beam.x, beam.z, 2.2, 240);
    assert.ok(
      w.enemies.hp[i] < before,
      "the roost ignored a launched body — a plate feeding a roost has to work",
    );
  });
});

describe("the surface census", () => {
  it("is derived from the authored mounts, not written by hand", () => {
    for (const def of SITES) {
      const level = buildLevel(def.id);
      const counted = censusOf(def.surfaces, level.census.floor, def.env);
      // Walls are measured off the lattice, not counted off the mount list.
      counted.wall = level.census.wall;
      counted.noBuildWall = level.census.noBuildWall;
      assert.deepEqual(
        level.census,
        counted,
        `${def.key}: census disagrees with its own mount list`,
      );
    }
  });

  it("counts a floor that is actually placeable", () => {
    for (const def of SITES) {
      const level = buildLevel(def.id);
      let n = 0;
      for (let i = 0; i < level.blocked.length; i++) if (isPlaceable(level, i)) n++;
      assert.equal(level.census.floor, n, `${def.key}: floor count is not the real one`);
      assert.ok(n > 60, `${def.key}: only ${n} placeable cells — nothing to build`);
    }
  });

  it("authors mounts a trap can actually be placed on", () => {
    // Every authored mount must accept its class. A typo'd side or a mount inside
    // rock is a content bug, and it should fail here rather than in someone's run.
    for (const def of SITES) {
      const level = buildLevel(def.id);
      for (let i = 0; i < level.slots.length; i++) {
        const s = level.slots[i];
        assert.equal(
          isPlaceableFor(level, cellOfSlot(i), s.surface),
          true,
          `${def.key}: mount ${i} does not accept its own class`,
        );
        assert.ok(
          s.x >= 0 && s.x <= def.width && s.z >= 0 && s.z <= def.depth,
          `${def.key}: mount ${i} is outside the map`,
        );
        assert.notEqual(
          s.surface,
          SURF.wall,
          `${def.key}: authored wall mounts are superseded by the lattice`,
        );
        if (s.surface === SURF.ceiling) {
          assert.ok(s.y > 2.5, `${def.key}: ceiling anchor ${i} hangs at only ${s.y}m`);
        }
      }
    }
  });

  it("gives Boot Hill deliberately little to bolt to", () => {
    /*
     * Not an accident worth loosening later: Map 01's census is scarce on purpose,
     * so the wall traps read as a promotion when the run reaches a furnished site.
     * If this ever needs changing, change the map's intent first.
     */
    const c = siteDef(SITE.bootHill);
    const level = buildLevel(SITE.bootHill);
    /* Wall scarcity is gone by design — every exposed face is buildable since the
       lattice landed. What stays scarce is the roof, and what stays authored is the
       refusal painted across the crypt row. */
    assert.ok(level.census.wall > 100, "the wall lattice should be generous");
    assert.ok(level.census.noBuildWall > 0, "the crypt row must still refuse iron");
    assert.equal(level.census.ceiling, 1, "Boot Hill has exactly one roof anchor");
    assert.equal(c.env, 1, "the hanging tree is the one env hook");
  });
});

describe("nothing is counted that cannot be used", () => {
  it("gives every surface a site authors at least one trap that can use it", () => {
    /*
     * The guard for the gap this test was written after finding.
     *
     * Every site authored chalk circles, the census counted them, and
     * `siteCanAnswer` could gate a whole archetype on `sigil >= 4` — while no trap in
     * the catalog could be traced on one, because the Sigil of Nine had shipped as a
     * floor trap instead of a sigil-family trap (§6 catalog #19). Authored data that
     * nothing consumes does not look broken; it looks finished.
     */
    const consumers = new Set(TRAPS.map((d) => d.surface));
    const NAMES = ["floor", "wall", "ceiling", "sigil", "unhallowed"];

    for (const def of SITES) {
      const level = buildLevel(def.id);
      const authored = new Set<SurfaceClass>(level.slots.map((s) => s.surface));
      if (level.wallTiles.length > 0) authored.add(SURF.wall);
      if (level.census.floor > 0) authored.add(SURF.floor);

      for (const surface of authored) {
        assert.ok(
          consumers.has(surface),
          `${def.key} authors ${NAMES[surface]} placements and no trap can use one`,
        );
      }
    }
  });
});
