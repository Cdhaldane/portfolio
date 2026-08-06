/*
 * Audio tests, in plain Node.
 *
 * This file is why `audio/pool.ts` and the event mapping are kept separate from
 * the Web Audio graph: voice allocation is a set of *rules* about what the player
 * gets to hear when the game asks for more sound than it can afford, and rules
 * deserve tests. Nothing here needs an AudioContext.
 *
 *   node --experimental-strip-types --test tests/audio.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EV } from "../src/sim/events.ts";
import {
  CULL_DISTANCE,
  PRIORITY,
  allocate,
  gainFor,
  makeSlots,
  occupy,
  panFor,
  release,
} from "../src/audio/pool.ts";

describe("voice pool (§16 — 32 voices, priority stealing)", () => {
  it("uses free slots before stealing anything", () => {
    const slots = makeSlots(3);
    for (let i = 0; i < 3; i++) {
      const at = allocate(slots, { priority: PRIORITY.enemy, distance: 1, now: i });
      assert.equal(at, i, "should fill free slots in order");
      occupy(slots, at, i + 1, { priority: PRIORITY.enemy, distance: 1, now: i });
    }
    // Full now, and an equal-priority newcomer must still get in by stealing.
    const at = allocate(slots, { priority: PRIORITY.enemy, distance: 1, now: 9 });
    assert.ok(at >= 0);
  });

  it("lets the player's gun steal a slot from an enemy grunt", () => {
    const slots = makeSlots(2);
    occupy(slots, 0, 1, { priority: PRIORITY.enemy, distance: 20, now: 1 });
    occupy(slots, 1, 2, { priority: PRIORITY.enemy, distance: 3, now: 2 });

    const at = allocate(slots, { priority: PRIORITY.player, distance: 0, now: 3 });
    // The furthest of the two equal-priority voices is the one nobody will miss.
    assert.equal(at, 0);
  });

  it("never lets a grunt silence the player", () => {
    const slots = makeSlots(1);
    occupy(slots, 0, 1, { priority: PRIORITY.player, distance: 0, now: 1 });
    const at = allocate(slots, { priority: PRIORITY.enemy, distance: 2, now: 2 });
    assert.equal(at, -1, "a quiet grunt must be dropped, not granted");
  });

  it("prefers stealing the furthest, then the oldest", () => {
    const slots = makeSlots(3);
    occupy(slots, 0, 1, { priority: PRIORITY.enemy, distance: 5, now: 10 });
    occupy(slots, 1, 2, { priority: PRIORITY.enemy, distance: 30, now: 20 });
    occupy(slots, 2, 3, { priority: PRIORITY.enemy, distance: 30, now: 5 });

    // Two are equally far; the older of those two goes.
    const at = allocate(slots, { priority: PRIORITY.trap, distance: 1, now: 30 });
    assert.equal(at, 2);
  });

  it("culls distant positional sounds entirely", () => {
    const slots = makeSlots(8);
    const at = allocate(slots, {
      priority: PRIORITY.enemy,
      distance: CULL_DISTANCE + 1,
      now: 1,
    });
    assert.equal(at, -1, "a sound nobody can hear should not cost a voice");
  });

  it("still plays player sounds regardless of distance", () => {
    const slots = makeSlots(8);
    const at = allocate(slots, {
      priority: PRIORITY.player,
      distance: 9999,
      now: 1,
    });
    assert.ok(at >= 0, "the player's own sounds are never positional-culled");
  });

  it("frees a slot on release", () => {
    const slots = makeSlots(1);
    occupy(slots, 0, 1, { priority: PRIORITY.player, distance: 0, now: 1 });
    release(slots, 0);
    assert.equal(slots[0].id, -1);
    assert.equal(allocate(slots, { priority: PRIORITY.enemy, distance: 1, now: 2 }), 0);
  });
});

describe("positional maths", () => {
  it("pans right when the source is to the listener's right", () => {
    // Listener looking down -Z, so its right vector is +X.
    const pan = panFor(5, 0, 1, 0, 5);
    assert.ok(pan > 0.5, `expected a right-side pan, got ${pan}`);
    assert.ok(pan <= 0.85, "and never a hard pan");
  });

  it("pans left for the mirror case, and centres straight ahead", () => {
    assert.ok(panFor(-5, 0, 1, 0, 5) < -0.5);
    assert.equal(Math.abs(panFor(0, -5, 1, 0, 5)) < 0.001, true);
  });

  it("is flat nearby, falls off with distance, and is silent past the cull", () => {
    assert.equal(gainFor(0), 1);
    assert.equal(gainFor(5), 1);
    assert.ok(gainFor(20) < 1 && gainFor(20) > 0);
    assert.ok(gainFor(20) > gainFor(35), "further should be quieter");
    assert.equal(gainFor(CULL_DISTANCE), 0);
  });
});

describe("event → sound mapping", () => {
  /*
   * Every event kind must be handled or *explicitly* ignored.
   *
   * A new event that nobody can hear is a silent regression, and silence is the
   * hardest bug class to notice — nothing looks broken, the game just quietly
   * stops telling you things. Rather than stub an AudioContext, this reads the
   * mapping's source and asserts every `EV.*` name appears as a case.
   */
  it("handles or explicitly ignores every event kind", () => {
    const src = readFileSync(new URL("../src/audio/index.ts", import.meta.url), "utf8");
    const missing: string[] = [];
    for (const name of Object.keys(EV)) {
      if (!src.includes(`EV.${name}`)) missing.push(name);
    }
    assert.deepEqual(
      missing,
      [],
      `these events make no sound and are not explicitly ignored: ${missing.join(", ")}`,
    );
  });

  it("routes the synergy above ordinary traps", () => {
    // Ignite is information, not decoration (§6), so it must outrank a trap sound
    // when the pool is full.
    assert.ok(PRIORITY.synergy > PRIORITY.trap);
    assert.ok(PRIORITY.player > PRIORITY.synergy);
    assert.ok(PRIORITY.trap > PRIORITY.enemy);
    assert.ok(PRIORITY.enemy > PRIORITY.ambience);
  });
});
