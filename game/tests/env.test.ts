/*
 * tests/env.test.ts — §4's environmental one-shots (MAPS §9 item 7).
 *
 * "1–3 environmental trap slots — free to activate once, then cost salt to reset.
 * Sites that roll these are memorable; the generator guarantees at least one per
 * site."
 *
 * The guarantee is the part worth a test. Everything else here is behaviour; that one
 * is a promise the maps make to the design, and it is the kind of promise a new site
 * breaks by simply forgetting.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EV } from "../src/sim/events.ts";
import { buildLevel } from "../src/sim/level.ts";
import { ENV_KIND, envReady } from "../src/sim/env.ts";
import { SITE, SITES } from "../src/sim/sites.ts";
import { fireEnvSlot } from "../src/sim/systems/combat.ts";
import { PHASE, createWorld, spawnEnemy, type World } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import type { Command, TickInput } from "../src/sim/commands.ts";

const EMPTY: Command[] = [];
function send(w: World, cmds: Command[] = EMPTY): void {
  const input: TickInput = { tick: w.tick, playerId: 0, cmds };
  step(w, input);
}

describe("environmental one-shots", () => {
  it("gives every site at least one, as §4 guarantees", () => {
    for (const def of SITES) {
      const level = buildLevel(def.id);
      assert.ok(
        level.envSlots.def.length >= 1,
        `${def.key} has no environmental slot — §4 guarantees at least one per site`,
      );
      /*
       * §4's "1-3" is the GENERATOR's range, not a cap on authored maps. Undertown
       * rolls four and the Crossroads four more — §7 calls it "the env-slot-richest
       * map in the game", and that is the second of the three things it pays for
       * having no chokepoint. The guarantee worth testing is the floor, not the
       * ceiling; the ceiling belongs to the generator's own validator at M3.
       */
      assert.ok(
        level.envSlots.def.length <= 6,
        `${def.key} has ${level.envSlots.def.length} slots — even an authored map has a limit`,
      );
      // And the census has to agree with what is actually there.
      assert.equal(level.census.env, level.envSlots.def.length, `${def.key}: census.env is wrong`);
    }
  });

  it("hangs each one above the ground beneath it", () => {
    // They are shot down, so they have to be above head height and reachable by a ray.
    for (const def of SITES) {
      const level = buildLevel(def.id);
      for (let i = 0; i < level.envSlots.def.length; i++) {
        const y = level.envSlots.y[i];
        assert.ok(y > 2.5 && y < 12, `${def.key}: slot ${i} hangs at ${y}m`);
      }
    }
  });

  it("fires once, kills what is under it, and is then spent", () => {
    const w = createWorld(11, SITE.bootHill);
    w.phase = PHASE.combat;
    const slot = w.level.envSlots.def[0];

    const near = spawnEnemy(w, slot.x, slot.z, 0);
    const far = spawnEnemy(w, slot.x + ENV_KIND.radius + 4, slot.z, 0);
    w.enemies.hp[near] = 1000;
    w.enemies.hp[far] = 1000;

    fireEnvSlot(w, 0);

    assert.ok(w.enemies.hp[near] < 1000, "the body underneath took nothing");
    assert.equal(w.enemies.hp[far], 1000, "it reached a body outside its radius");
    assert.ok(w.enemies.hold[near] > 0, "survivors must be pinned — the window is the point");
    assert.equal(w.level.envSlots.used[0], 1, "it did not mark itself spent");

    // Once. Salt-funded resets are §5 work and salt does not exist yet.
    const hp = w.enemies.hp[near];
    fireEnvSlot(w, 0);
    assert.equal(w.enemies.hp[near], hp, "it fired a second time");
  });

  it("announces itself, so presentation can hear it", () => {
    const w = createWorld(12, SITE.bootHill);
    w.phase = PHASE.combat;
    w.events.clear();
    fireEnvSlot(w, 0);
    let found = false;
    for (let i = 0; i < w.events.count; i++) {
      if (w.events.kind[i] === EV.envFired) found = true;
    }
    assert.ok(found, "no envFired event — nothing would see or hear it");
  });

  it("stays unavailable while the building holding it is boarded", () => {
    /*
     * Undertown's chandelier is inside the saloon, and the saloon is boarded until the
     * player pays for it. A slot behind a closed building is not a secret; it is not
     * there yet.
     */
    const level = buildLevel(SITE.undertown);
    const gated = level.envSlots.def.findIndex((d) => d.requiresOpen !== undefined);
    assert.ok(gated >= 0, "the fixture expects Undertown to gate a slot behind a building");

    const shut = envReady(level.envSlots, gated, () => false);
    const open = envReady(level.envSlots, gated, () => true);
    assert.equal(shut, false, "a slot in a boarded building must not be shootable");
    assert.equal(open, true, "opening the building must make it shootable");
  });

  it("comes back when the run travels to a new site", () => {
    // `used` lives on the level, so arriving somewhere new restores them — a site's
    // one-shot is once per SITE, not once per run.
    const w = createWorld(13, SITE.bootHill);
    fireEnvSlot(w, 0);
    assert.equal(w.level.envSlots.used[0], 1);

    const fresh = buildLevel(SITE.creekPinch);
    assert.equal(fresh.envSlots.used[0], 0, "a new site arrived with its slot already spent");
  });

  it("does not fire itself", () => {
    // Nothing in the sim may trigger one: it is the player's shot or nothing.
    const w = createWorld(14, SITE.bootHill);
    w.phase = PHASE.combat;
    for (let t = 0; t < 600; t++) send(w);
    assert.equal(w.level.envSlots.used[0], 0, "an environmental slot went off on its own");
  });
});
