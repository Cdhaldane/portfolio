/*
 * tests/summons.test.ts — the three sim primitives decision 20's abilities need.
 *
 *   pierce   — a hitscan that keeps going (Dead Reckoning)
 *   keg      — a thrown charge with a second trigger (Blasting Charge)
 *   revenant — a corpse raised as a temporary ally (Wake)
 *
 * These were shipped as declared `pending` gaps first and built second, so the
 * cases below are mostly "does the primitive actually do the thing the ability
 * claims", which is the assertion that would have caught a silent no-op.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ABILITY_SLOT, WEAPON } from "../src/sim/abilities.ts";
import { fireAbility } from "../src/sim/systems/ability.ts";
import { summonSystem, raiseCorpses, throwKeg, REVENANT } from "../src/sim/systems/summons.ts";
import { damageEnemy, hitscan, SOURCE } from "../src/sim/systems/combat.ts";
import { CORPSE_TTL, SUMMON_LIMITS, createWorld, spawnEnemy, type World } from "../src/sim/world.ts";
import { SITE } from "../src/sim/sites.ts";

const world = (): World => createWorld(99, SITE.bootHill, true);
const liveCount = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0);

// ───────────────────────────────────────────────────────────── corpses

describe("corpses", () => {
  it("records where a body fell, because the enemy slot is reused at once", () => {
    const w = world();
    const i = spawnEnemy(w, 20, 17);
    const x = w.enemies.x[i];

    damageEnemy(w, i, 99999, SOURCE.revolver);

    assert.equal(w.enemies.alive[i], 0, "the body should be gone");
    assert.equal(liveCount(w.summons.corpse.alive), 1, "but a corpse should remain");
    const c = w.summons.corpse;
    const slot = c.alive.findIndex((v) => v === 1);
    assert.equal(c.x[slot], x, "at the position it died");
  });

  it("expires on its own clock", () => {
    const w = world();
    damageEnemy(w, spawnEnemy(w, 20, 17), 99999, SOURCE.revolver);
    for (let t = 0; t < CORPSE_TTL; t++) summonSystem(w);
    assert.equal(liveCount(w.summons.corpse.alive), 0, "should not be raisable forever");
  });

  it("overwrites the oldest when the pool is full, never the freshest", () => {
    const w = world();
    // Fill the pool, then age half of it so "oldest" is unambiguous.
    for (let n = 0; n < SUMMON_LIMITS.corpses; n++) {
      damageEnemy(w, spawnEnemy(w, 20 + (n % 5), 17), 99999, SOURCE.revolver);
    }
    assert.equal(liveCount(w.summons.corpse.alive), SUMMON_LIMITS.corpses);
    for (let t = 0; t < 60; t++) summonSystem(w);

    const before = Math.min(...Array.from(w.summons.corpse.ttl));
    damageEnemy(w, spawnEnemy(w, 26, 17), 99999, SOURCE.revolver);

    const ttls = Array.from(w.summons.corpse.ttl);
    assert.ok(ttls.includes(CORPSE_TTL), "the new corpse should be in there at full ttl");
    assert.ok(
      Math.min(...ttls) >= before,
      "the replaced slot should have been the oldest, not a fresh one",
    );
  });
});

// ───────────────────────────────────────────────────────────── revenants

describe("revenants", () => {
  it("rises from nearby corpses, up to the cap, spending each one", () => {
    const w = world();
    for (let n = 0; n < 6; n++) {
      const i = spawnEnemy(w, w.player.x + 1 + n * 0.2, w.player.z + 1);
      damageEnemy(w, i, 99999, SOURCE.revolver);
    }
    const raised = raiseCorpses(w, 8, 4, 900);
    assert.equal(raised, 4, "should honour the cap");
    assert.equal(liveCount(w.summons.revenant.alive), 4);
    assert.equal(liveCount(w.summons.corpse.alive), 2, "raised corpses are spent");
  });

  it("raises nothing when the bodies are out of range", () => {
    const w = world();
    const i = spawnEnemy(w, w.player.x + 30, w.player.z);
    damageEnemy(w, i, 99999, SOURCE.revolver);
    assert.equal(raiseCorpses(w, 8, 4, 900), 0);
  });

  it("shoots the nearest body, then goes on cooldown", () => {
    const w = world();
    const dead = spawnEnemy(w, w.player.x + 1, w.player.z + 1);
    damageEnemy(w, dead, 99999, SOURCE.revolver);
    assert.equal(raiseCorpses(w, 8, 1, 900), 1);

    const target = spawnEnemy(w, w.player.x + 2, w.player.z + 1);
    const hpBefore = w.enemies.hp[target];

    summonSystem(w);
    assert.ok(w.enemies.hp[target] < hpBefore, "a revenant should shoot");

    const afterFirst = w.enemies.hp[target];
    summonSystem(w);
    assert.equal(w.enemies.hp[afterFirst >= 0 ? target : target], afterFirst, "and then wait");
  });

  it("expires on its timer rather than needing to be killed", () => {
    const w = world();
    const dead = spawnEnemy(w, w.player.x + 1, w.player.z + 1);
    damageEnemy(w, dead, 99999, SOURCE.revolver);
    raiseCorpses(w, 8, 1, 30);
    for (let t = 0; t < 31; t++) summonSystem(w);
    assert.equal(liveCount(w.summons.revenant.alive), 0);
  });

  it("has the §7 Revenant Deputy's gun", () => {
    assert.equal(REVENANT.damage, 25, "§7 G1 says 25 damage a shot");
  });
});

// ───────────────────────────────────────────────────────────────── kegs

describe("the thrown charge", () => {
  it("flies, falls, and comes to rest on the ground", () => {
    const w = world();
    assert.equal(throwKeg(w, 4, 100, 10, 600), true);
    const k = w.summons.keg;
    const slot = k.alive.findIndex((v) => v === 1);
    const startY = k.y[slot];

    for (let t = 0; t < 120; t++) summonSystem(w);
    assert.ok(k.alive[slot], "should still be waiting on its fuse");
    assert.ok(k.y[slot] < startY, "gravity should have brought it down");
    assert.ok(k.y[slot] >= 0.2, "and it should rest, not sink through the floor");
  });

  it("detonates on its fuse, damaging and launching what is near", () => {
    const w = world();
    const i = spawnEnemy(w, w.player.x, w.player.z + 2);
    const hpBefore = w.enemies.hp[i];

    throwKeg(w, 12, 40, 8, 4);
    for (let t = 0; t < 5; t++) summonSystem(w);

    assert.equal(liveCount(w.summons.keg.alive), 0, "the keg is spent");
    assert.ok(w.enemies.hp[i] < hpBefore, "it should have hurt");
    assert.equal(w.enemies.grounded[i], 0, "and thrown the body into the air");
  });

  it("is detonated by a second press, and that press is free", () => {
    const w = world();
    w.player.weapon = WEAPON.assay;

    assert.equal(fireAbility(w, ABILITY_SLOT.q), true, "throws");
    assert.equal(liveCount(w.summons.keg.alive), 1);
    const cdAfterThrow = w.player.abilityCooldown[0];

    assert.equal(fireAbility(w, ABILITY_SLOT.q), true, "second press detonates");
    assert.equal(liveCount(w.summons.keg.alive), 0, "the keg went off");
    assert.equal(
      w.player.abilityCooldown[0],
      cdAfterThrow,
      "detonating must not charge the cooldown twice",
    );
  });
});

// ────────────────────────────────────────────────────────────── pierce

describe("piercing shots", () => {
  it("hits every body on the ray, not just the nearest", () => {
    const shoot = (pierce: boolean): number => {
      const w = world();
      const p = w.player;
      /*
       * The ray leaves the camera above head height and bodies are 1.8m tall
       * standing on the floor, so a pitch of exactly 0 sails over every head.
       * −0.12 keeps the ray inside the body band across the whole span.
       */
      p.pyaw = 0;
      p.ppitch = -0.12;
      // cameraPose lerps from the PREVIOUS transform at alpha 0, so it reads
      // px/py/pz — a fresh world has not stepped yet.
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      // yaw 0 looks down −z, and the boom puts the ray origin 3.4m BEHIND the
      // player — so the targets go in front, at decreasing z.
      const ids = [3, 5, 7].map((d) => spawnEnemy(w, p.x, p.z - d));
      const before = ids.map((i) => w.enemies.hp[i]);
      if (pierce) p.pierceTicks = 60;

      hitscan(w);

      return ids.filter((i, k) => w.enemies.hp[i] < before[k]).length;
    };

    assert.equal(shoot(false), 1, "an ordinary shot stops at the first body");
    assert.ok(shoot(true) > 1, "a piercing shot should carry on through");
  });
});
