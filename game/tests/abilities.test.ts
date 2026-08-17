/*
 * tests/abilities.test.ts — decision 20's four coupled changes.
 *
 * Weapon abilities, the two-regime HP curve, combo-amplified trap damage, and
 * the Ash formula. They are tested together because they were designed together:
 * the HP curve is only survivable because the combo bonus exists, and the Ash
 * price is only reachable because combos dominate Tally.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ABILITY_SLOT, WEAPON, WEAPONS, abilityDef, weaponDef } from "../src/sim/abilities.ts";
import { hpScaleForRound } from "../src/sim/systems/director.ts";
import { SOURCE, damageEnemy, handAmp } from "../src/sim/systems/combat.ts";
import { fireAbility, abilityCooldownSystem } from "../src/sim/systems/ability.ts";
import { ashForRun } from "../src/host/persist.ts";
import { COMBO, ROUND } from "../src/sim/tuning.ts";
import { createWorld, spawnEnemy } from "../src/sim/world.ts";
import { SITE } from "../src/sim/sites.ts";

const world = () => createWorld(1234, SITE.bootHill, true);

// ─────────────────────────────────────────────────────── the HP curve (§4)

describe("two-regime HP scaling", () => {
  it("is continuous at the join — difficulty never steps", () => {
    const at = hpScaleForRound(ROUND.hpRampRound);
    const before = hpScaleForRound(ROUND.hpRampRound - 1);
    assert.ok(at > before, "should still be climbing at the join");
    // Approaching from the late branch with a zero-length exponent is the same value.
    assert.ok(Math.abs(at - (1 + (ROUND.hpRampRound - 1) * ROUND.hpPerRound)) < 1e-9);
  });

  it("is linear early and compounding late", () => {
    assert.equal(hpScaleForRound(1), 1);
    assert.ok(Math.abs(hpScaleForRound(11) - (1 + 10 * ROUND.hpPerRound)) < 1e-9);

    /* The whole point of the change: past the body cap the curve must keep
     * climbing, and faster than the early linear rate. */
    const lateStep = hpScaleForRound(41) / hpScaleForRound(40);
    const earlyStep = hpScaleForRound(11) / hpScaleForRound(10);
    assert.ok(lateStep > earlyStep, `late ${lateStep} should outpace early ${earlyStep}`);
    assert.ok(Math.abs(lateStep - (1 + ROUND.hpPerRoundLate)) < 1e-9);
  });

  it("never decreases", () => {
    for (let r = 1; r < 60; r++) {
      assert.ok(hpScaleForRound(r + 1) >= hpScaleForRound(r), `round ${r}`);
    }
  });
});

// ──────────────────────────────────────────── combo → trap damage (§5)

describe("the open hand amplifies trap damage", () => {
  it("pays nothing with no hand, and caps with a full one", () => {
    const w = world();
    assert.equal(handAmp(w), 1, "an empty hand must give nothing away");

    w.hand.count = 1;
    assert.ok(Math.abs(handAmp(w) - (1 + COMBO.ampPerCard)) < 1e-9);

    w.hand.count = 99;
    assert.equal(handAmp(w), COMBO.ampCap, "must not run away");
  });

  it("amplifies traps but never the revolver", () => {
    const measure = (source: number, cards: number): number => {
      const w = world();
      const e = w.enemies;
      // A fresh world has no bodies — they arrive with a round. Spawn one
      // directly so the hand is the only variable in the measurement.
      const i = spawnEnemy(w, 20, 17);
      assert.ok(i >= 0, "expected to spawn a body");
      const before = e.hp[i];
      w.hand.count = cards;
      damageEnemy(w, i, 10, source as never);
      return before - e.hp[i];
    };

    const trapCold = measure(SOURCE.jaws, 0);
    const trapHot = measure(SOURCE.jaws, 5);
    const gunCold = measure(SOURCE.revolver, 0);
    const gunHot = measure(SOURCE.revolver, 5);

    assert.ok(trapHot > trapCold, "trap damage should rise with the hand");
    assert.equal(gunHot, gunCold, "the gun must NOT be amplified (§5)");
  });
});

// ──────────────────────────────────────────────────── Ash (§10)

describe("the Ash formula", () => {
  it("needs both terms — neither alone pays", () => {
    assert.equal(ashForRun(0, 30), 0, "no score, no Ash");
    assert.equal(ashForRun(50_000, 0), 0, "no depth, no Ash");
  });

  it("matches the worked example in §10", () => {
    // round 22, Tally 46,000 → floor(46) × (1 + 22/20) = 46 × 2.1 = 96.6 → 96
    assert.equal(ashForRun(46_000, 22), 96);
  });

  it("rewards depth and score together, not either alone", () => {
    const deepAndGood = ashForRun(46_000, 22);
    const shallowAndGood = ashForRun(46_000, 4);
    const deepAndPoor = ashForRun(6_000, 22);
    assert.ok(deepAndGood > shallowAndGood, "depth must matter");
    assert.ok(deepAndGood > deepAndPoor, "score must matter");
  });

  it("is steep enough that a weapon is a long-term goal", () => {
    const perGoodRun = ashForRun(46_000, 22);
    const cheapest = Math.min(...WEAPONS.filter((wp) => wp.ash > 0).map((wp) => wp.ash));
    const runs = cheapest / perGoodRun;
    assert.ok(runs >= 4, `a weapon should take real time; got ${runs.toFixed(1)} runs`);
  });
});

// ─────────────────────────────────────────────── weapon abilities (§7.3)

describe("weapon abilities", () => {
  it("gives every weapon exactly two, on Q then E", () => {
    for (const wp of WEAPONS) {
      assert.equal(wp.abilities.length, 2, `${wp.key} must have exactly two`);
      assert.equal(abilityDef(wp.id, ABILITY_SLOT.q), wp.abilities[0]);
      assert.equal(abilityDef(wp.id, ABILITY_SLOT.e), wp.abilities[1]);
      for (const a of wp.abilities) {
        assert.ok(a.cooldown > 0, `${wp.key}/${a.key} needs a cooldown`);
        assert.ok(a.blurb.length > 0, `${wp.key}/${a.key} needs a blurb the HUD can show`);
        assert.ok(a.effects.length > 0 || a.pending, `${wp.key}/${a.key} does nothing`);
      }
    }
  });

  it("falls back to the starting revolver for an unknown weapon", () => {
    assert.equal(weaponDef(999).id, WEAPON.absolution);
  });

  it("fires, then refuses until the cooldown has run", () => {
    const w = world();
    const def = abilityDef(w.player.weapon, ABILITY_SLOT.q);

    assert.equal(fireAbility(w, ABILITY_SLOT.q), true, "should fire when ready");
    assert.equal(w.player.abilityCooldown[0], def.cooldown);
    assert.equal(fireAbility(w, ABILITY_SLOT.q), false, "must refuse while cooling");

    // The other slot is on its own clock.
    assert.equal(fireAbility(w, ABILITY_SLOT.e), true, "E must be independent of Q");

    for (let t = 0; t < def.cooldown; t++) abilityCooldownSystem(w);
    assert.equal(w.player.abilityCooldown[0], 0);
    assert.equal(fireAbility(w, ABILITY_SLOT.q), true, "should be ready again");
  });

  it("Steady buffs the gun and roots the player, then expires cleanly", () => {
    const w = world();
    w.player.weapon = WEAPON.absolution;
    fireAbility(w, ABILITY_SLOT.e); // Steady

    assert.ok(w.player.buffDamage > 1, "should buff the gun");
    assert.ok(w.player.rootTicks > 0, "should root — the cost half of the verb");

    const span = Math.max(w.player.buffTicks, w.player.rootTicks);
    for (let t = 0; t < span; t++) abilityCooldownSystem(w);

    assert.equal(w.player.buffDamage, 1, "buff must reset, not linger");
    assert.equal(w.player.rootTicks, 0);
  });

  it("Fan the Hammer spends its own shots, never the cylinder", () => {
    const w = world();
    w.player.weapon = WEAPON.absolution;
    const ammoBefore = w.player.ammo;
    fireAbility(w, ABILITY_SLOT.q); // Fan the Hammer
    assert.ok(w.player.freeShots > 0);
    assert.equal(w.player.ammo, ammoBefore, "must not drain the cylinder");
  });

  it("has no unbuilt effects left, and any future one must explain itself", () => {
    /* All three originally-pending effects now have sim primitives: pierce in
     * the hitscan, the keg in the summon pool, revenants raised from corpses.
     * The field stays as a convention for the next ability that outruns the
     * sim — but it may never be a bare flag. */
    for (const wp of WEAPONS) {
      for (const a of wp.abilities) {
        if (a.pending !== undefined) {
          assert.ok(a.pending.length > 10, `${wp.key}/${a.key}: say WHAT is missing`);
        }
      }
    }
    const stillPending = WEAPONS.flatMap((wp) =>
      wp.abilities.filter((a) => a.pending).map((a) => a.key),
    );
    assert.deepEqual(stillPending, [], "these should now be built");
  });
});
