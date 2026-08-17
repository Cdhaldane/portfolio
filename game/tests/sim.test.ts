/*
 * Headless simulation tests.
 *
 * This file is the reason `sim/` is forbidden from importing three.js, React or
 * anything touching `window` (GALLOWS_HYMN.md §12.2). Everything below runs in
 * plain Node with no browser, no canvas and no mocks — and the determinism test
 * in particular is the single most valuable test in the project (§19.1).
 *
 *   node --experimental-strip-types --test tests/sim.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, DBG, type Command, type TickInput } from "../src/sim/commands.ts";
import { EV } from "../src/sim/events.ts";
import { hashWorld } from "../src/sim/hash.ts";
import { buildLevel, cellOf, cellOfSlot, isPlaceable, tileOf } from "../src/sim/level.ts";
import { step } from "../src/sim/step.ts";
import {
  DUSTKIN,
  KILL,
  OBJECTIVE,
  PAYOUT,
  ROUND,
  STATUS,
  ticks,
} from "../src/sim/tuning.ts";
import { ELEM, TRAPS, resolved, upgradeCost } from "../src/sim/traps.ts";
import {
  PHASE,
  createWorld,
  roundQuota,
  spawnEnemy,
  type World,
} from "../src/sim/world.ts";
import { SOURCE, damageEnemy, damagePlayer } from "../src/sim/systems/combat.ts";
import { DEBUT_CAP, ENEMIES, ENEMY } from "../src/sim/enemies.ts";
import { SITE, siteForRound } from "../src/sim/sites.ts";
import { SURF } from "../src/sim/surfaces.ts";

/**
 * A site has to leave enough build tiles to be defensible.
 *
 * In tiles, not metres: the build grid is 2m, so a 48x32 site is 24x16 = 384 tiles
 * before any geometry is subtracted. Measured, not guessed.
 */
const PLACEABLE_MIN = 60;
import { HAND } from "../src/sim/combo.ts";

const EMPTY: Command[] = [];

const TRAP = { jaws: 0, tar: 1, vent: 2, plate: 3, sigil: 4 } as const;

/**
 * A world with money, for scripts whose subject is not the economy.
 *
 * The four traps the determinism script builds cost 175 and the round-1 purse is a
 * fraction of that, so three of the four were refused for being unaffordable — a
 * quieter version of the same failure as the dead cell ids: the script said "exercise
 * every trap" and the run did not. Funding it identically on every world leaves
 * determinism untouched and makes the claim true.
 */
function fundedWorld(seed: number): World {
  const w = newWorld(seed);
  w.scrap = 2000;
  return w;
}

/**
 * Every world in this file is built on the retained M0 layout.
 *
 * These tests hardcode cell indices and metre coordinates from that map (the
 * pinch at 26.5, 17.5; cells 729/730/774). Since site rotation landed, round 1
 * belongs to Boot Hill, so `createWorld`'s default would silently move every one
 * of those coordinates onto different geometry.
 */
const newWorld = (seed: number): World => createWorld(seed, SITE.creekPinch);

/** Run `count` ticks, taking commands from a deterministic per-tick script. */
function run(
  w: World,
  count: number,
  script?: (tick: number) => Command[] | undefined,
): void {
  for (let i = 0; i < count; i++) {
    const cmds = script?.(w.tick) ?? EMPTY;
    const input: TickInput = { tick: w.tick, playerId: 0, cmds };
    step(w, input);
    // The host drains the event ring once per frame; do the same here so a long
    // run can't silently overflow it.
    w.events.clear();
  }
}

/** Step once without draining events, for assertions that read the ring. */
function tick1(w: World, cmds: Command[] = EMPTY): void {
  step(w, { tick: w.tick, playerId: 0, cmds });
}

function sawEvent(w: World, kind: number): boolean {
  for (let i = 0; i < w.events.count; i++) if (w.events.kind[i] === kind) return true;
  return false;
}

/**
 * Trace the Sigil on the chalk circle nearest (x, z).
 *
 * It moved to the sigil family in M1.5 (§6 catalog #19), so it can no longer be put
 * on open floor — a map traces four to six circles and where the Sigil goes is a
 * decision the map makes half of.
 */
function traceSigil(w: World, defId: number, x: number, z: number): void {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < w.level.slots.length; i++) {
    const s = w.level.slots[i];
    if (s.surface !== SURF.sigil) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  assert.ok(best >= 0, "the site traces no chalk circles");
  run(w, 1, () => [
    { t: CMD.selectSlot, slot: defId },
    { t: CMD.place, cell: cellOfSlot(best) },
  ]);
}

/** Place a trap directly, bypassing the aim plumbing. */
function place(w: World, defId: number, x: number, z: number): void {
  // A trap's placement id is a BUILD TILE, never a nav cell (sim/level.ts).
  const cell = tileOf(w.level, x, z);
  run(w, 1, () => [
    { t: CMD.selectSlot, slot: defId },
    { t: CMD.place, cell },
  ]);
}

/**
 * Move the player out of the lane.
 *
 * Needed since melee landed: a player parked on the path to the Rift now gets
 * beaten to death, so any test about *leaking* has to first stop the test player
 * from being a target. Standing still in the lane being lethal is the feature.
 */
function parkPlayer(w: World): void {
  w.player.x = 5;
  w.player.z = 30;
  w.player.px = 5;
  w.player.pz = 30;
}

/** The build tile in the middle of the pinch corridor — where a trap pays. */
function pinchCell(w: World): number {
  return tileOf(w.level, 26.5, 17.5);
}

/**
 * A kill-box that actually seals the pinch.
 *
 * Built ALONG the lane rather than across it, which the 2m build tile forces: the
 * corridor is ~3.1m wide, so it is one tile plus a sliver, and this fixture's old
 * pairs at z 16.5 / 17.5 now share a tile — where one trap goes, not two.
 *
 * That is the tile change paying off rather than fighting it. A Tar Seep's radius
 * doubled along with the tile, so one pool now covers the corridor's full width
 * where two used to leave a gap down one edge; depth is what the player buys.
 */
function buildKillBox(w: World): void {
  place(w, TRAP.tar, 29, 17);
  place(w, TRAP.tar, 27, 17);
  place(w, TRAP.vent, 25, 17);
  place(w, TRAP.vent, 23, 17);
  traceSigil(w, TRAP.sigil, 29, 17);
  assert.equal(w.traps.count, 5, "the kill-box failed to place");
}

describe("level generation (Path A, code-generated)", () => {
  const level = buildLevel();

  it("bakes a flow field that leads every gate to the Rift", () => {
    for (const gate of level.gates) {
      let x = gate.x;
      let z = gate.z;
      let reached = false;
      for (let i = 0; i < 400; i++) {
        const c = cellOf(level, x, z);
        assert.ok(c >= 0, "walked off the grid following the flow field");
        const dx = level.flowX[c];
        const dz = level.flowZ[c];
        const ddx = x - level.rift.x;
        const ddz = z - level.rift.z;
        if (Math.sqrt(ddx * ddx + ddz * ddz) <= level.rift.radius) {
          reached = true;
          break;
        }
        assert.ok(dx !== 0 || dz !== 0, `dead cell at (${x}, ${z})`);
        x += dx * 0.5;
        z += dz * 0.5;
      }
      assert.ok(reached, `gate (${gate.x}, ${gate.z}) never reaches the Rift`);
    }
  });

  it("keeps the Rift cell walkable", () => {
    // The Rift is the flow field's only source. Block it — as an early layout
    // did, with the player's platform — and every cell becomes unreachable with
    // no error anywhere. This assertion is cheap insurance for M3's generator.
    const rc = cellOf(level, level.rift.x, level.rift.z);
    assert.equal(level.blocked[rc], 0, "the Rift cell must never be blocked");
    assert.equal(level.dist[rc], 0);
  });

  it("gives the gate a finite cost to the Rift", () => {
    for (const gate of level.gates) {
      const c = cellOf(level, gate.x, gate.z);
      assert.ok(Number.isFinite(level.dist[c]), "gate is walled off from the Rift");
      // §11 guarantee 4: no enemy path shorter than 18m, or round 1 is unbuildable.
      assert.ok(level.dist[c] >= 18, `path too short: ${level.dist[c]}`);
    }
  });

  it("leaves placeable floor and protects the Rift ring", () => {
    let placeable = 0;
    const tiles = level.tw * level.th;
    for (let i = 0; i < tiles; i++) if (isPlaceable(level, i)) placeable++;
    assert.ok(placeable > PLACEABLE_MIN, `only ${placeable} placeable tiles`);
    assert.equal(isPlaceable(level, tileOf(level, level.rift.x, level.rift.z)), false);
  });
});


/*
 * Four build tiles down the lane, computed rather than written down.
 *
 * The literals these replace (1467/1468/1470/1471) were nav cells inside the north
 * wall's inflated skirt — `blocked = 1`, `dist = Infinity` — so all four placements
 * had been silently DENIED since M0, in a script whose whole job is to exercise
 * every trap. Hardcoded grid ids are the bug: they cannot be wrong out loud. These
 * are derived from metres, and the run below asserts they actually landed.
 */
const LANE_TILES = (() => {
  const l = buildLevel(SITE.creekPinch);
  const tiles = [29, 27, 25, 23].map((x) => tileOf(l, x, 17));
  for (const t of tiles) {
    if (!isPlaceable(l, t)) throw new Error("lane tile " + t + " is not placeable");
  }
  return tiles;
})();

describe("the event ring", () => {
  it("gives every event kind a unique discriminant", () => {
    /*
     * Event ids are assigned by hand in three parallel feature branches, and a
     * collision is silent: tsc does not flag duplicate values in a const object,
     * and the symptom is one event playing another's sound (a keg detonation
     * humming like a sigil). Found live when healPulse landed on kegThrown's 29.
     */
    const byValue = new Map<number, string>();
    for (const [name, value] of Object.entries(EV)) {
      const holder = byValue.get(value);
      assert.equal(
        holder,
        undefined,
        `EV.${name} and EV.${holder} share discriminant ${value}`,
      );
      byValue.set(value, name);
    }
  });
});

describe("the dev menu (CMD.debug, §19.2)", () => {
  const dbg = (w: World, action: (typeof DBG)[keyof typeof DBG], value = 0): void => {
    run(w, 1, () => [{ t: CMD.debug, action, value }]);
  };

  it("jumps to a round: build phase, right quota, clean slate", () => {
    // Locked to the fixture map, so the jump is about the round, not travel.
    const w = createWorld(31, SITE.creekPinch, true);
    spawnEnemy(w, 20, 17, ENEMY.dustkin);
    w.player.hp = 10;
    w.vigil = 3;

    dbg(w, DBG.round, 8);
    assert.equal(w.round, 8);
    assert.equal(w.phase, PHASE.build);
    assert.equal(w.roundQuota, roundQuota(8));
    assert.equal(w.enemies.count, 0, "the field must be cleared");
    assert.equal(w.player.hp, w.player.maxHp, "arrive testing, not dying");
    assert.equal(w.vigil, OBJECTIVE.startingVigil);
    assert.equal(w.level.siteId, SITE.creekPinch, "a locked run must not travel");
  });

  it("a rotation run jumps to the round's own ground", () => {
    // Same travel rule as playing there: moveSiteIfDue, not a second copy.
    const w = createWorld(32, SITE.creekPinch);
    dbg(w, DBG.round, 8);
    assert.equal(w.level.siteId, siteForRound(8));
  });

  it("grants scrap, and free build makes traps and upgrades cost nothing", () => {
    const w = newWorld(33);
    const before = w.scrap;
    dbg(w, DBG.scrap, 1000);
    assert.equal(w.scrap, before + 1000);

    dbg(w, DBG.freeBuild, 1);
    const funded = w.scrap;
    place(w, TRAP.jaws, 26.5, 17.5);
    assert.equal(w.traps.count, 1, "the free trap must still place");
    assert.equal(w.scrap, funded, "free build must not charge for the trap");

    dbg(w, DBG.freeBuild, 0);
    place(w, TRAP.tar, 29, 17);
    assert.ok(w.scrap < funded, "prices must come back when toggled off");
  });

  it("god mode makes damagePlayer a no-op, and toggles back off", () => {
    const w = newWorld(34);
    dbg(w, DBG.god, 1);
    damagePlayer(w, 50);
    assert.equal(w.player.hp, w.player.maxHp, "god mode must eat the hit");

    dbg(w, DBG.god, 0);
    damagePlayer(w, 50);
    assert.equal(w.player.hp, w.player.maxHp - 50);
  });

  it("ends the round the way the objective system would — payout included", () => {
    const w = newWorld(35);
    parkPlayer(w);
    run(w, 1, () => [{ t: CMD.startWave }]);
    spawnEnemy(w, 20, 17, ENEMY.dustkin);
    spawnEnemy(w, 21, 17, ENEMY.dustkin);

    const scrap = w.scrap;
    const round = w.round;
    // commandSystem runs before objectiveSystem in the same tick (§12.4), so
    // one tick both empties the field and closes the round.
    tick1(w, [{ t: CMD.debug, action: DBG.endRound, value: 0 }]);
    assert.ok(sawEvent(w, EV.roundCleared), "the round must clear properly");
    assert.equal(w.round, round + 1);
    assert.equal(w.phase, PHASE.build);
    assert.ok(w.scrap > scrap, "clearing must pay out, even a cheated clear");
    assert.equal(w.kills, 0, "despawns are not kills");
  });

  it("spawns a chosen archetype at the gate", () => {
    const w = newWorld(36);
    dbg(w, DBG.spawn, ENEMY.coyote);
    assert.equal(w.enemies.count, 1);
    let found = -1;
    for (let i = 0; i < w.enemies.alive.length; i++) {
      if (w.enemies.alive[i]) found = i;
    }
    assert.ok(found >= 0);
    assert.equal(w.enemies.defId[found], ENEMY.coyote);
  });

  it("taints the run — and stays deterministic, because cheats are commands", () => {
    const script = (tick: number): Command[] | undefined => {
      if (tick === 2) return [{ t: CMD.debug, action: DBG.round, value: 5 }];
      if (tick === 4) return [{ t: CMD.debug, action: DBG.spawn, value: ENEMY.ironjaw }];
      if (tick === 6) return [{ t: CMD.debug, action: DBG.scrap, value: 500 }];
      if (tick === 8) return [{ t: CMD.startWave }];
      return undefined;
    };
    const a = newWorld(37);
    const b = newWorld(37);
    run(a, 120, script);
    run(b, 120, script);
    assert.ok(a.debugUsed, "any debug command must taint the run");
    assert.equal(
      hashWorld(a),
      hashWorld(b),
      "the same cheats on the same seed must produce the same world",
    );
  });
});

describe("determinism (§13)", () => {
  // A scripted run that exercises input, the director, every trap, movement and
  // the weapon — i.e. every system that writes state.
  const script = (tick: number): Command[] | undefined => {
    if (tick === 3)
      return [{ t: CMD.selectSlot, slot: TRAP.tar }, { t: CMD.place, cell: LANE_TILES[0] }];
    if (tick === 4)
      return [{ t: CMD.selectSlot, slot: TRAP.vent }, { t: CMD.place, cell: LANE_TILES[1] }];
    if (tick === 5)
      return [{ t: CMD.selectSlot, slot: TRAP.jaws }, { t: CMD.place, cell: LANE_TILES[2] }];
    if (tick === 6)
      return [{ t: CMD.selectSlot, slot: TRAP.plate }, { t: CMD.place, cell: LANE_TILES[3] }];
    if (tick === 8) return [{ t: CMD.startWave }];
    if (tick === 20) return [{ t: CMD.move, x: 0.5, y: 1 }, { t: CMD.sprint, on: true }];
    if (tick === 90) return [{ t: CMD.jump }];
    if (tick === 120) return [{ t: CMD.move, x: -1, y: 0 }];
    if (tick === 200) return [{ t: CMD.aim, on: true }];
    if (tick % 37 === 0) return [{ t: CMD.fire }];
    if (tick % 53 === 0) return [{ t: CMD.look, yaw: -1.2 + tick * 0.0007, pitch: -0.1 }];
    return undefined;
  };

  it("actually places the traps the script asks for", () => {
    /* The assertion that was missing, and whose absence hid four dead placements for
       three milestones: a determinism test passes just as happily on a run where
       every single command was refused. */
    const w = fundedWorld(0xc0ffee);
    run(w, 10, script);
    assert.equal(w.traps.count, 4, "the determinism script placed nothing");
  });

  it("same seed + same commands produces the same state hash", () => {
    const a = fundedWorld(0xc0ffee);
    const b = fundedWorld(0xc0ffee);
    const checkpoints = [60, 300, 600, 900, 1800];
    let next = 0;
    for (let i = 0; i < 1800; i++) {
      run(a, 1, script);
      run(b, 1, script);
      if (a.tick === checkpoints[next]) {
        assert.equal(hashWorld(a), hashWorld(b), `diverged by tick ${a.tick}`);
        next++;
      }
    }
    assert.ok(a.spawnedThisWave > 0 || a.round > 1, "director never spawned");
  });

  it("a different seed produces a different hash", () => {
    const a = fundedWorld(1);
    const b = fundedWorld(2);
    run(a, 600, script);
    run(b, 600, script);
    assert.notEqual(hashWorld(a), hashWorld(b));
  });

  it("replaying a recorded command log reproduces the run", () => {
    const log: Command[][] = [];
    const original = fundedWorld(7777);
    for (let i = 0; i < 1200; i++) {
      const cmds = script(original.tick) ?? [];
      log.push(cmds);
      step(original, { tick: original.tick, playerId: 0, cmds });
      original.events.clear();
    }

    const replay = fundedWorld(7777);
    for (let i = 0; i < log.length; i++) {
      step(replay, { tick: replay.tick, playerId: 0, cmds: log[i] });
      replay.events.clear();
    }

    assert.equal(hashWorld(replay), hashWorld(original));
  });
});

describe("trap synergies (§6)", () => {
  it("Tar soaks, and fire on soaked ground deals triple", () => {
    const w = newWorld(101);
    const i = spawnEnemy(w, 20, 17);
    w.enemies.hp[i] = 1000;
    w.enemies.maxHp[i] = 1000;

    // Baseline: fire on a dry target.
    const before = w.enemies.hp[i];
    damageEnemy(w, i, 10, SOURCE.vent, ELEM.fire);
    const dry = before - w.enemies.hp[i];
    assert.equal(dry, 10);

    // Soaked: the same 10 becomes 30.
    w.enemies.soaked[i] = ticks(3);
    const beforeWet = w.enemies.hp[i];
    tick1(w);
    damageEnemy(w, i, 10, SOURCE.vent, ELEM.fire);
    const wet = beforeWet - w.enemies.hp[i];
    assert.ok(
      wet >= 10 * STATUS.igniteMultiplier,
      `expected >= ${10 * STATUS.igniteMultiplier}, got ${wet}`,
    );
    // Ignition consumes the soak and sets them alight.
    assert.equal(w.enemies.soaked[i], 0);
    assert.ok(w.enemies.burning[i] > 0, "ignition should leave them burning");
  });

  it("the Sigil marks, and marked things take more", () => {
    const w = newWorld(102);
    const i = spawnEnemy(w, 20, 17);
    w.enemies.hp[i] = 1000;

    damageEnemy(w, i, 100, SOURCE.revolver, ELEM.iron);
    const plain = 1000 - w.enemies.hp[i];

    w.enemies.marked[i] = ticks(1);
    w.enemies.markAmp[i] = 0.5;
    const before = w.enemies.hp[i];
    damageEnemy(w, i, 100, SOURCE.revolver, ELEM.iron);
    const marked = before - w.enemies.hp[i];

    assert.equal(plain, 100);
    assert.equal(marked, 150);
  });

  it("held things take more, which is why a hold trap is not a weak trap", () => {
    const w = newWorld(103);
    const i = spawnEnemy(w, 20, 17);
    w.enemies.hp[i] = 1000;
    w.enemies.hold[i] = ticks(1);
    const before = w.enemies.hp[i];
    damageEnemy(w, i, 100, SOURCE.revolver, ELEM.iron);
    assert.equal(before - w.enemies.hp[i], 100 * (1 + STATUS.heldAmp));
  });

  it("amplifiers stack multiplicatively — Tar + Sigil is the pay-off", () => {
    const w = newWorld(104);
    const i = spawnEnemy(w, 20, 17);
    w.enemies.hp[i] = 5000;
    w.enemies.soaked[i] = ticks(3);
    w.enemies.marked[i] = ticks(3);
    w.enemies.markAmp[i] = 0.5;
    w.enemies.hold[i] = ticks(3);
    const before = w.enemies.hp[i];
    damageEnemy(w, i, 10, SOURCE.vent, ELEM.fire);
    // 10 × 3 (ignite) × 1.5 (mark) × 1.25 (held) = 56.25
    assert.equal(before - w.enemies.hp[i], 56.25);
  });

  it("the Powder Plate launches bodies, and the landing hurts", () => {
    const w = newWorld(105);
    place(w, TRAP.plate, 26.5, 17.5);
    assert.equal(w.traps.count, 1);

    const i = spawnEnemy(w, 27.4, 17.5);
    w.enemies.hp[i] = 400;
    w.enemies.maxHp[i] = 400;

    let launched = false;
    for (let t = 0; t < 240 && !launched; t++) {
      tick1(w);
      if (sawEvent(w, EV.launched)) launched = true;
      w.events.clear();
    }
    assert.ok(launched, "the plate never launched anything");
    assert.equal(w.enemies.grounded[i], 0, "a launched body should be airborne");
    assert.ok(w.enemies.vy[i] > 0, "a launched body should be moving up");

    // Let it come down and take the fall.
    const hpAloft = w.enemies.hp[i];
    for (let t = 0; t < 240 && w.enemies.grounded[i] === 0; t++) run(w, 1);
    assert.equal(w.enemies.grounded[i], 1, "it never landed");
    assert.ok(w.enemies.hp[i] < hpAloft, "landing should hurt");
  });

  it("Tar deals no damage on its own — it is a setup piece", () => {
    const w = newWorld(106);
    place(w, TRAP.tar, 26.5, 17.5);
    const i = spawnEnemy(w, 26.5, 17.5);
    w.enemies.hp[i] = 500;
    run(w, 60);
    assert.equal(w.enemies.hp[i], 500, "Tar must not deal damage");
    assert.ok(w.enemies.soaked[i] > 0, "Tar must soak");
    assert.ok(w.enemies.slowed[i] > 0, "Tar must slow");
  });

  it("burning ticks damage over time and expires", () => {
    const w = newWorld(107);
    const i = spawnEnemy(w, 20, 17);
    w.enemies.hp[i] = 500;
    w.enemies.burning[i] = ticks(1);
    w.enemies.burnDps[i] = 60;
    run(w, 60);
    assert.ok(w.enemies.hp[i] < 500, "burning should deal damage");
    assert.equal(w.enemies.burning[i], 0, "burn should expire");
    assert.equal(w.enemies.burnDps[i], 0);
  });
});

describe("the hotbar and the purse", () => {
  it("charges the armed trap's price, not a fixed one", () => {
    const w = newWorld(201);
    const start = w.scrap;
    traceSigil(w, TRAP.sigil, 20, 17);
    assert.equal(w.traps.count, 1);
    assert.equal(w.scrap, start - TRAPS[TRAP.sigil].cost);
    assert.equal(w.traps.defId[0], TRAP.sigil);
  });

  it("refuses a trap you cannot afford", () => {
    const w = newWorld(202);
    w.scrap = TRAPS[TRAP.sigil].cost - 1;
    traceSigil(w, TRAP.sigil, 20, 17);
    assert.equal(w.traps.count, 0);
    assert.equal(w.scrap, TRAPS[TRAP.sigil].cost - 1);
  });

  it("sells a trap back for a refund", () => {
    const w = newWorld(203);
    const cell = pinchCell(w);
    place(w, TRAP.jaws, 26.5, 17.5);
    const afterBuy = w.scrap;
    run(w, 1, () => [{ t: CMD.sell, cell }]);
    assert.equal(w.traps.count, 0);
    // Full refund during the build phase (§5).
    assert.equal(w.scrap, afterBuy + TRAPS[TRAP.jaws].cost);
  });

  it("charges a surcharge for building mid-round", () => {
    const w = newWorld(204);
    run(w, 1, () => [{ t: CMD.startWave }]);
    const before = w.scrap;
    place(w, TRAP.jaws, 20, 17);
    const spent = before - w.scrap;
    assert.ok(spent > TRAPS[TRAP.jaws].cost, `expected a surcharge, spent ${spent}`);
  });

  it("refuses placement on the Rift, inside walls, and on an occupied cell", () => {
    const w = newWorld(205);
    const before = w.scrap;
    place(w, TRAP.jaws, w.level.rift.x, w.level.rift.z);
    /* Inside a solid: the low blockhouse at (20, 8), whose 3.0 x 2.4 footprint is
       big enough that a build tile's centre lands inside it. The old fixture aimed at
       the 0.6m fence, and since the tile grew to 2m a fence no longer fills one — the
       nearest tile centre is a metre clear of it, on open floor, and building beside a
       fence is exactly what the coverage rule is meant to allow. */
    place(w, TRAP.jaws, 21, 7);
    assert.equal(w.traps.count, 0);
    assert.equal(w.scrap, before);

    place(w, TRAP.jaws, 26.5, 17.5);
    place(w, TRAP.jaws, 26.5, 17.5);
    assert.equal(w.traps.count, 1);
  });
});

describe("the round loop (§4 — the round IS the score)", () => {
  it("stays in the build phase until the bell is rung", () => {
    const w = newWorld(301);
    run(w, ticks(30));
    assert.equal(w.phase, PHASE.build);
    assert.equal(w.spawnedThisWave, 0, "the director must not spawn during build");
    assert.equal(w.round, 1);
  });

  it("clears a round, pays out, and arms the next one", () => {
    const w = newWorld(302);
    parkPlayer(w);
    const quota1 = w.roundQuota;
    assert.equal(quota1, roundQuota(1));

    run(w, 1, () => [{ t: CMD.startWave }]);
    assert.equal(w.phase, PHASE.combat);

    // Nothing placed and nothing shot: every body walks through and the round
    // still completes. Leaking is a bad outcome, not a stuck one.
    const scrapBefore = w.scrap;
    for (let i = 0; i < ticks(200) && w.round === 1; i++) run(w, 1);

    assert.equal(w.round, 2, "the round should have advanced");
    assert.equal(w.phase, PHASE.build, "clearing a round returns to build");
    assert.ok(w.leaks > 0, "with no traps and no shooting, bodies must get through");
    assert.ok(w.scrap > scrapBefore, "clearing a round must pay out");
    assert.equal(w.lastPayout, PAYOUT.base + 1 * PAYOUT.perRound, "leaky round: no bonuses");
    assert.equal(w.spawnedThisWave, 0, "the new round starts unspawned");
    assert.equal(w.roundQuota, roundQuota(2));
    assert.ok(w.roundQuota > quota1, "later rounds must send more");
  });

  it("pays a no-leak bonus, and rounds get harder", () => {
    const w = newWorld(303);
    parkPlayer(w);
    w.scrap = 1000;
    buildKillBox(w);

    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(240) && w.round === 1; i++) run(w, 1);

    assert.equal(w.round, 2, "the kill-box should have cleared round 1");
    assert.equal(w.leaks, 0, "a wired pinch should not leak");
    assert.ok(w.kills > 0, "the traps should have killed");
    assert.equal(
      w.lastPayout,
      PAYOUT.base + PAYOUT.perRound + w.kills * PAYOUT.perKill + PAYOUT.noLeakBonus,
      "a clean round pays the no-leak bonus",
    );
    // Compare non-elite rounds: round 5 is elite and deliberately sends fewer.
    assert.ok(roundQuota(4) > roundQuota(2), "ordinary rounds must grow");
    assert.ok(roundQuota(9) > roundQuota(4));
  });

  it("marks every fifth round elite: fewer bodies, much tougher", () => {
    assert.ok(roundQuota(5) < roundQuota(4), "elite rounds send fewer");
    assert.ok(ROUND.eliteHpMultiplier > 2);
    assert.ok(ROUND.eliteScrapMultiplier > 1);
  });

  it("ends the run when the Vigil is spent, keeping the round as the score", () => {
    const w = newWorld(304);
    parkPlayer(w);
    w.vigil = 1;
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(200) && w.phase !== PHASE.lost; i++) run(w, 1);
    assert.equal(w.phase, PHASE.lost);
    assert.equal(w.vigil, 0);
    assert.ok(w.round >= 1);
  });

  it("restores some Vigil for clearing a round, capped", () => {
    const w = newWorld(305);
    parkPlayer(w);
    w.vigil = 4;
    w.scrap = 1000;
    buildKillBox(w);
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(240) && w.round === 1; i++) run(w, 1);
    assert.equal(w.round, 2);
    assert.ok(w.vigil > 4, "clearing a round should restore Vigil");
    assert.ok(w.vigil <= OBJECTIVE.startingVigil, "Vigil must stay capped");
  });
});

describe("Jaws of Perdition", () => {
  it("clamps and damages the first enemy to step on it", () => {
    const w = newWorld(11);
    const cell = pinchCell(w);
    assert.ok(isPlaceable(w.level, cell));

    place(w, TRAP.jaws, 26.5, 17.5);
    assert.equal(w.traps.count, 1);

    run(w, 1, () => [{ t: CMD.startWave }]);

    let sawHold = false;
    let minHp = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 1200 && !sawHold; i++) {
      run(w, 1);
      const e = w.enemies;
      for (let j = 0; j < e.alive.length; j++) {
        if (e.alive[j] && e.hold[j] > 0) {
          sawHold = true;
          minHp = Math.min(minHp, e.hp[j]);
        }
      }
    }
    assert.ok(sawHold, "no enemy was ever clamped walking the only route");
    // 25 damage, amplified 25% because the clamp lands before the damage.
    assert.ok(minHp < DUSTKIN.maxHp, "the clamp should also hurt");
  });

  it("lands the killing blow on an enemy the revolver already wounded", () => {
    // The M0 target moment: wound with the gun, let the trap finish it.
    const w = newWorld(21);
    place(w, TRAP.jaws, 26.5, 17.5);

    const i = spawnEnemy(w, 27.5, 17.5);
    w.enemies.hp[i] = DUSTKIN.maxHp;
    w.enemies.maxHp[i] = DUSTKIN.maxHp;
    damageEnemy(w, i, 34, SOURCE.revolver, ELEM.iron);
    assert.ok(w.enemies.alive[i], "one round should not kill outright");

    let trapKill = false;
    for (let t = 0; t < 300 && !trapKill; t++) {
      tick1(w);
      for (let k = 0; k < w.events.count; k++) {
        if (w.events.kind[k] === EV.enemyKilled && w.events.a[k] === SOURCE.jaws) {
          trapKill = true;
        }
      }
      w.events.clear();
    }
    assert.ok(trapKill, "the trap never landed a killing blow");
    assert.ok(w.kills >= 1);
  });
});

describe("the Boot (§7)", () => {
  it("kicks the body in front of you into the air and damages it", () => {
    const w = newWorld(401);
    // The player spawns facing +X, so put a body just ahead of them.
    const i = spawnEnemy(w, w.player.x + 1.4, w.player.z, ENEMY.dustkin);
    w.enemies.hp[i] = 500;

    tick1(w, [{ t: CMD.boot }]);
    assert.ok(sawEvent(w, EV.booted), "the Boot did not connect");
    w.events.clear();

    assert.equal(w.enemies.grounded[i], 0, "a kicked body must leave the ground");
    assert.ok(w.enemies.vy[i] > 0, "it should be moving up");
    assert.ok(w.enemies.hp[i] < 500, "the kick itself should hurt");
    assert.ok(w.enemies.booted[i] > 0, "boot credit should be stamped");
  });

  it("misses cleanly when nothing is in the cone, and still costs the cooldown", () => {
    const w = newWorld(402);
    spawnEnemy(w, w.player.x - 2, w.player.z, ENEMY.dustkin); // behind the player
    tick1(w, [{ t: CMD.boot }]);
    assert.ok(sawEvent(w, EV.bootWhiff), "kicking air should whiff, not connect");
    w.events.clear();
    assert.ok(w.player.bootCooldown > 0, "a whiff still costs the cooldown");

    const before = w.player.bootCooldown;
    tick1(w, [{ t: CMD.boot }]);
    assert.ok(w.player.bootCooldown < before, "cooldown should be ticking down");
    assert.equal(sawEvent(w, EV.booted), false, "and no kick during it");
  });

  it("cannot kick a flier out of the sky", () => {
    const w = newWorld(403);
    const i = spawnEnemy(w, w.player.x + 1.4, w.player.z, ENEMY.buzzard);
    w.enemies.hp[i] = 500;
    tick1(w, [{ t: CMD.boot }]);
    assert.ok(sawEvent(w, EV.bootWhiff), "a Buzzard is 4m up and unkickable");
  });
});

describe("the roster (§8 — every enemy is an argument)", () => {
  it("Ironjaw clangs off chip damage but not off a real hit", () => {
    const w = newWorld(501);
    const i = spawnEnemy(w, 20, 17, ENEMY.ironjaw);
    w.enemies.hp[i] = ENEMIES[ENEMY.ironjaw].maxHp;

    // A burn tick is far under the armour threshold: it clangs.
    const before = w.enemies.hp[i];
    damageEnemy(w, i, 5, SOURCE.burn, ELEM.fire);
    assert.ok(sawEvent(w, EV.armourClang), "small hits must clang");
    assert.equal(before - w.enemies.hp[i], 1, "a clang is a scratch, not damage");
    w.events.clear();

    // A revolver round clears the threshold and lands in full.
    const before2 = w.enemies.hp[i];
    damageEnemy(w, i, 34, SOURCE.revolver, ELEM.iron);
    assert.equal(before2 - w.enemies.hp[i], 34);
  });

  it("amplifiers can push chip damage through Ironjaw's armour", () => {
    // The intended discovery: mark it, and your small hits start landing.
    const w = newWorld(502);
    const i = spawnEnemy(w, 20, 17, ENEMY.ironjaw);
    w.enemies.hp[i] = 500;
    w.enemies.soaked[i] = ticks(3);
    w.enemies.marked[i] = ticks(3);
    w.enemies.markAmp[i] = 0.5;

    const before = w.enemies.hp[i];
    // 8 fire → ×3 ignite → ×1.5 mark = 36, clear of the 20 threshold.
    damageEnemy(w, i, 8, SOURCE.vent, ELEM.fire);
    assert.equal(sawEvent(w, EV.armourClang), false, "amplified, it should land");
    assert.equal(before - w.enemies.hp[i], 36);
  });

  it("Buzzard flies over every ground trap in the game", () => {
    const w = newWorld(503);
    w.scrap = 1000;
    buildKillBox(w);

    const i = spawnEnemy(w, 26.5, 17, ENEMY.buzzard);
    w.enemies.hp[i] = 500;
    w.enemies.maxHp[i] = 500;

    // Pin it directly over the kill-box for two seconds.
    for (let t = 0; t < 120; t++) {
      w.enemies.x[i] = 26.5;
      w.enemies.z[i] = 17;
      run(w, 1);
    }
    assert.equal(w.enemies.hp[i], 500, "ground traps must not touch a flier");
    assert.equal(w.enemies.soaked[i], 0, "and must not soak it");
    assert.equal(w.enemies.marked[i], 0, "and must not mark it");
  });

  it("but the revolver reaches it", () => {
    const w = newWorld(504);
    const i = spawnEnemy(w, 20, 17, ENEMY.buzzard);
    w.enemies.hp[i] = 500;
    damageEnemy(w, i, 34, SOURCE.revolver, ELEM.iron);
    assert.equal(w.enemies.hp[i], 466);
  });

  it("holds a debut to a couple of bodies so the player can learn it", () => {
    const w = newWorld(505);
    w.round = ENEMIES[ENEMY.buzzard].unlockRound;
    w.roundQuota = 40;
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(90) && w.spawnedThisWave < 40; i++) run(w, 1);
    assert.ok(w.spawnedByDef[ENEMY.buzzard] <= DEBUT_CAP, "a debut must be capped");
    assert.ok(w.spawnedByDef[ENEMY.dustkin] > 0, "the horde should still arrive");
  });

  it("Hollow Preacher heals the flock — never itself, and not past full", () => {
    const w = newWorld(506);
    const p = spawnEnemy(w, 20, 17, ENEMY.preacher);
    w.enemies.hp[p] = 30; // wounded, so self-healing would show
    w.enemies.maxHp[p] = 65;
    // Even clamped in a trap it keeps singing — traps must not be the answer
    // to the anti-trap unit (sim/enemies.ts, the heal field's contract).
    w.enemies.hold[p] = ticks(10);

    const near = spawnEnemy(w, 22, 17, ENEMY.dustkin);
    w.enemies.hp[near] = 10;
    w.enemies.maxHp[near] = 45;
    const far = spawnEnemy(w, 30, 17, ENEMY.dustkin); // 10m out, hymn is 8m
    w.enemies.hp[far] = 10;
    w.enemies.maxHp[far] = 45;

    // Pin everyone, the same trick as the Buzzard kill-box test — this is a
    // test of the aura, not of pathing.
    for (let t = 0; t < ticks(2); t++) {
      w.enemies.x[p] = 20;
      w.enemies.z[p] = 17;
      w.enemies.x[near] = 22;
      w.enemies.z[near] = 17;
      w.enemies.x[far] = 30;
      w.enemies.z[far] = 17;
      run(w, 1);
    }

    // 15 HP/s for 2s = +30, within a tick's rounding.
    assert.ok(w.enemies.hp[near] > 35, "a wounded body in the hymn must heal");
    assert.ok(w.enemies.hp[near] <= w.enemies.maxHp[near], "never past full");
    assert.equal(w.enemies.hp[far], 10, "the hymn must have a radius");
    assert.equal(w.enemies.hp[p], 30, "the Preacher must never heal itself");
  });

  it("the hymn cleanses slows, which is the anti-attrition argument", () => {
    const w = newWorld(507);
    spawnEnemy(w, 20, 17, ENEMY.preacher);
    const i = spawnEnemy(w, 22, 17, ENEMY.dustkin);
    w.enemies.slowed[i] = ticks(3);
    w.enemies.slowFactor[i] = 0.5;
    tick1(w);
    assert.equal(w.enemies.slowed[i], 0, "a slowed body in the hymn must be cleansed");
  });
});

describe("melee makes the player mortal", () => {
  it("telegraphs a swing, then lands it", () => {
    const w = newWorld(601);
    const i = spawnEnemy(w, w.player.x + 0.9, w.player.z, ENEMY.dustkin);
    w.enemies.hp[i] = 500;

    let sawWindup = false;
    for (let t = 0; t < 30 && !sawWindup; t++) {
      tick1(w);
      sawWindup = sawEvent(w, EV.enemyWindup);
      w.events.clear();
    }
    assert.ok(sawWindup, "melee must telegraph before it hits");

    const before = w.player.hp;
    for (let t = 0; t < 60 && w.player.hp === before; t++) run(w, 1);
    assert.ok(w.player.hp < before, "the swing should land");
  });

  it("kills the player, ends the run, and keeps the round as the score", () => {
    const w = newWorld(602);
    w.round = 4;
    const attackers: number[] = [];
    for (let n = 0; n < 4; n++) {
      const i = spawnEnemy(w, w.player.x + 0.9, w.player.z + (n - 1.5) * 0.5, ENEMY.ironjaw);
      w.enemies.hp[i] = 5000;
      attackers.push(i);
    }
    // Pin them in reach each tick. Left alone they would walk past the player
    // toward the Rift, which is correct behaviour and would test nothing here.
    for (let t = 0; t < ticks(60) && w.phase !== PHASE.lost; t++) {
      for (const i of attackers) {
        w.enemies.x[i] = w.player.x + 0.9;
        w.enemies.vx[i] = 0;
        w.enemies.vz[i] = 0;
      }
      run(w, 1);
    }
    assert.equal(w.phase, PHASE.lost, "four Ironjaws should finish a standing player");
    assert.equal(w.player.hp, 0);
    assert.equal(w.round, 4, "the round you died on is the score");
  });

  it("grants brief invulnerability so a crowd cannot chain-stun", () => {
    const w = newWorld(603);
    const before = w.player.hp;
    damagePlayer(w, 10);
    damagePlayer(w, 10);
    damagePlayer(w, 10);
    assert.equal(before - w.player.hp, 10, "only the first hit should land");
  });

  it("restores health when a round is cleared", () => {
    const w = newWorld(604);
    parkPlayer(w);
    w.player.hp = 20;
    run(w, 1, () => [{ t: CMD.startWave }]);
    for (let i = 0; i < ticks(200) && w.round === 1; i++) run(w, 1);
    assert.equal(w.round, 2);
    assert.equal(w.player.hp, w.player.maxHp, "a cleared round patches you up");
  });
});

describe("the poker hands (§5 — style is the score)", () => {
  /** Kill one body per listed source, all inside a single window. */
  function killWith(w: World, sources: number[]): void {
    for (let k = 0; k < sources.length; k++) {
      const i = spawnEnemy(w, 20, 17, ENEMY.dustkin);
      w.enemies.hp[i] = 1;
      damageEnemy(w, i, 999, sources[k] as 0, ELEM.iron);
    }
  }

  it("names a Pair, and banks it only when the window lapses", () => {
    const w = newWorld(701);
    killWith(w, [SOURCE.jaws, SOURCE.jaws]);
    assert.equal(w.hand.count, 2);
    assert.equal(w.tally, 0, "nothing banks until the window closes");

    run(w, KILL.handWindow + 2);
    assert.ok(w.tally > 0, "the hand should have banked");
    assert.equal(w.lastHand, HAND.pair);
    assert.equal(w.hand.count, 0, "and reset");
  });

  it("names a Straight for five distinct sources, and pays more than a Flush", () => {
    const straight = newWorld(702);
    killWith(straight, [
      SOURCE.jaws,
      SOURCE.vent,
      SOURCE.plate,
      SOURCE.revolver,
      SOURCE.fall,
    ]);
    run(straight, KILL.handWindow + 2);
    assert.equal(straight.lastHand, HAND.straight);

    const flush = newWorld(702);
    killWith(flush, [
      SOURCE.jaws,
      SOURCE.jaws,
      SOURCE.jaws,
      SOURCE.jaws,
      SOURCE.jaws,
    ]);
    run(flush, KILL.handWindow + 2);
    assert.equal(flush.lastHand, HAND.flush);

    assert.ok(
      straight.tally > flush.tally,
      `a Straight (${straight.tally}) must beat a Flush (${flush.tally})`,
    );
  });

  it("names Dead Man's Hand only if the player was never touched", () => {
    const eight = [
      SOURCE.jaws,
      SOURCE.vent,
      SOURCE.plate,
      SOURCE.revolver,
      SOURCE.fall,
      SOURCE.boot,
      SOURCE.tar,
      SOURCE.burn,
    ];

    const clean = newWorld(703);
    killWith(clean, eight);
    run(clean, KILL.handWindow + 2);
    assert.equal(clean.lastHand, HAND.deadMans);

    const bloodied = newWorld(703);
    killWith(bloodied, eight.slice(0, 4));
    damagePlayer(bloodied, 5);
    killWith(bloodied, eight.slice(4));
    run(bloodied, KILL.handWindow + 2);
    assert.notEqual(
      bloodied.lastHand,
      HAND.deadMans,
      "taking a hit must forfeit the mastery hand",
    );
  });

  it("pays a trap kill more than a gun kill, and a booted trap kill most", () => {
    const gun = newWorld(704);
    killWith(gun, [SOURCE.revolver, SOURCE.revolver]);
    run(gun, KILL.handWindow + 2);

    const trap = newWorld(704);
    killWith(trap, [SOURCE.jaws, SOURCE.jaws]);
    run(trap, KILL.handWindow + 2);

    assert.ok(trap.tally > gun.tally, "traps are the intended answer (§5)");

    const booted = newWorld(704);
    for (let n = 0; n < 2; n++) {
      const i = spawnEnemy(booted, 20, 17, ENEMY.dustkin);
      booted.enemies.hp[i] = 1;
      booted.enemies.booted[i] = 30;
      damageEnemy(booted, i, 999, SOURCE.jaws, ELEM.iron);
    }
    run(booted, KILL.handWindow + 2);
    assert.ok(
      booted.tally > trap.tally,
      `boot credit should beat a plain trap kill (${booted.tally} vs ${trap.tally})`,
    );
  });
});

describe("trap upgrades (§6 — exactly two, mutually exclusive)", () => {
  it("gives every trap exactly two branches, and every branch a real trade", () => {
    for (const def of TRAPS) {
      /*
       * `upgrades` became optional so the Dead Man's Brace could ship without a fake
       * pair — an unbreakable obstacle with no effects has nothing to choose between,
       * and §6 forbids inventing a choice to fill the slot.
       *
       * So the rule is narrowed rather than loosened: ONLY an obstacle may go
       * without. A damage trap that quietly shipped with no branches still fails.
       */
      if (def.upgrades === undefined) {
        assert.equal(
          def.blocks,
          true,
          `${def.name} has no upgrades and is not an obstacle — §6 wants exactly two`,
        );
        continue;
      }
      assert.equal(def.upgrades.length, 2, `${def.name} must offer exactly two`);
      for (const u of def.upgrades) {
        assert.ok(u.name.length > 0);
        assert.ok(u.blurb.length > 10, `${u.name} needs a blurb stating the trade`);
        assert.ok(
          Object.keys(u.override).length > 0,
          `${u.name} must actually change something`,
        );
      }
      // The two branches must differ from each other, or it isn't a choice.
      assert.notDeepEqual(
        def.upgrades[0].override,
        def.upgrades[1].override,
        `${def.name}'s branches are identical`,
      );
    }
  });

  it("charges for an upgrade and marks the instance", () => {
    const w = newWorld(801);
    place(w, TRAP.jaws, 26.5, 17.5);
    const cell = pinchCell(w);
    const before = w.scrap;

    run(w, 1, () => [{ t: CMD.upgrade, cell, choice: 1 }]);
    assert.equal(w.traps.upgrade[0], 1);
    assert.equal(before - w.scrap, upgradeCost(TRAP.jaws));
  });

  it("refuses a second upgrade — the choice is a commitment", () => {
    const w = newWorld(802);
    w.scrap = 1000;
    place(w, TRAP.jaws, 26.5, 17.5);
    const cell = pinchCell(w);
    run(w, 1, () => [{ t: CMD.upgrade, cell, choice: 1 }]);
    const after = w.scrap;
    run(w, 1, () => [{ t: CMD.upgrade, cell, choice: 2 }]);
    assert.equal(w.traps.upgrade[0], 1, "the branch must not switch");
    assert.equal(w.scrap, after, "and must not charge again");
  });

  it("refuses an upgrade you cannot afford", () => {
    const w = newWorld(803);
    traceSigil(w, TRAP.sigil, 20, 17);
    w.scrap = upgradeCost(TRAP.sigil) - 1;
    const before = w.scrap;
    run(w, 1, () => [{ t: CMD.upgrade, cell: tileOf(w.level, 20, 17), choice: 1 }]);
    assert.equal(w.traps.upgrade[0], 0);
    assert.equal(w.scrap, before);
  });

  it("refunds the upgrade when the trap is sold", () => {
    const w = newWorld(804);
    w.scrap = 1000;
    const start = w.scrap;
    place(w, TRAP.vent, 20, 17);
    const cell = tileOf(w.level, 20, 17);
    run(w, 1, () => [{ t: CMD.upgrade, cell, choice: 2 }]);
    run(w, 1, () => [{ t: CMD.sell, cell }]);
    assert.equal(w.traps.count, 0);
    assert.equal(w.scrap, start, "a full build-phase refund includes the upgrade");
  });

  it("runs the upgraded numbers, not the base ones", () => {
    // Black Powder trades the launch away for a much bigger hit.
    const base = resolved(TRAP.plate, 0);
    const black = resolved(TRAP.plate, 1);
    const fools = resolved(TRAP.plate, 2);

    const baseDmg = base.effects.find((f) => f.kind === "damage");
    const blackDmg = black.effects.find((f) => f.kind === "damage");
    assert.ok(baseDmg && blackDmg && baseDmg.kind === "damage" && blackDmg.kind === "damage");
    assert.ok(blackDmg.amount > baseDmg.amount * 2, "Black Powder should hit hard");
    assert.equal(
      black.effects.some((f) => f.kind === "launch"),
      false,
      "and give up the launch entirely",
    );
    assert.ok(
      fools.effects.some((f) => f.kind === "launch"),
      "Fool's Charge keeps the launch",
    );
    assert.ok(fools.cooldown < base.cooldown, "and fires more often");
  });

  it("Wolf Trap clamps three bodies in one bite", () => {
    const w = newWorld(805);
    w.scrap = 1000;
    place(w, TRAP.jaws, 26.5, 17.5);
    const cell = pinchCell(w);
    run(w, 1, () => [{ t: CMD.upgrade, cell, choice: 2 }]);
    assert.equal(w.traps.upgrade[0], 2);

    // Three bodies on it, spaced so separation does not immediately fling them
    // apart (bodies are 0.9m wide, so they have to start that far apart anyway).
    const ids: number[] = [];
    for (let n = 0; n < 3; n++) {
      const i = spawnEnemy(w, 26.5, 16.6 + n * 0.9, ENEMY.dustkin);
      w.enemies.hp[i] = 500;
      ids.push(i);
    }
    run(w, 2);
    const held = ids.filter((i) => w.enemies.hold[i] > 0).length;
    assert.equal(held, 3, `expected all three clamped, got ${held}`);
  });

  it("a base Jaws still only clamps one", () => {
    const w = newWorld(806);
    place(w, TRAP.jaws, 26.5, 17.5);
    const ids: number[] = [];
    for (let n = 0; n < 3; n++) {
      const i = spawnEnemy(w, 26.4 + n * 0.05, 17.4 + n * 0.05, ENEMY.dustkin);
      w.enemies.hp[i] = 500;
      ids.push(i);
    }
    run(w, 2);
    assert.equal(ids.filter((i) => w.enemies.hold[i] > 0).length, 1);
  });

  it("Kerosene Cut cooks far hotter once a Vent lights it", () => {
    function burnTest(upgrade: 0 | 2): number {
      const w = newWorld(807);
      w.scrap = 2000;
      place(w, TRAP.tar, 26.5, 17.5);
      place(w, TRAP.vent, 25.5, 17.5);
      if (upgrade !== 0) {
        run(w, 1, () => [{ t: CMD.upgrade, cell: pinchCell(w), choice: 2 }]);
      }
      const i = spawnEnemy(w, 26.5, 17.5, ENEMY.dustkin);
      w.enemies.hp[i] = 100000;
      w.enemies.maxHp[i] = 100000;
      // Pin it in the pool so only the ground damage is measured.
      for (let t = 0; t < 180; t++) {
        w.enemies.x[i] = 26.5;
        w.enemies.z[i] = 17.5;
        run(w, 1);
      }
      return 100000 - w.enemies.hp[i];
    }
    const plain = burnTest(0);
    const kerosene = burnTest(2);
    assert.ok(plain > 0, "a lit pool must deal damage at all");
    assert.ok(
      kerosene > plain * 1.4,
      `Kerosene (${kerosene.toFixed(0)}) should far outdamage plain tar (${plain.toFixed(0)})`,
    );
  });

  it("keeps replays deterministic with upgrades in the log", () => {
    const script = (tick: number): Command[] | undefined => {
      const [t0, t1] = LANE_TILES;
      if (tick === 2) return [{ t: CMD.selectSlot, slot: TRAP.tar }, { t: CMD.place, cell: t0 }];
      if (tick === 3) return [{ t: CMD.selectSlot, slot: TRAP.vent }, { t: CMD.place, cell: t1 }];
      if (tick === 4) return [{ t: CMD.upgrade, cell: t0, choice: 2 }];
      if (tick === 5) return [{ t: CMD.upgrade, cell: t1, choice: 1 }];
      if (tick === 8) return [{ t: CMD.startWave }];
      if (tick % 40 === 0) return [{ t: CMD.boot }];
      return undefined;
    };
    const a = newWorld(0xbadf00d);
    const b = newWorld(0xbadf00d);
    run(a, 900, script);
    run(b, 900, script);
    assert.equal(hashWorld(a), hashWorld(b));
    assert.ok(a.traps.upgrade[0] !== 0, "the upgrade should have been taken");
  });
});
