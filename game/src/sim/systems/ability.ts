/*
 * System — weapon abilities (§7.3, decision 20).
 *
 * Two verbs per weapon, on `Q` and `E`. This file is the only place that turns
 * an `AbilityEffect` into a change in the world, which keeps `abilities.ts`
 * purely declarative in the same way `traps.ts` is.
 *
 * Damage always routes through `damageEnemy` — the single writer of enemy hp
 * (§12.4) — so abilities inherit element interactions, amplifiers, armour and
 * kill attribution for free. An ability that wrote hp directly would silently
 * opt out of the combo system, which is exactly the bug this rule exists to
 * prevent.
 */

import { ABILITY_SLOT, abilityDef, type AbilityEffect } from "../abilities.ts";
import { EV } from "../events.ts";
import { enemyDef } from "../enemies.ts";
import { dcos, dsin } from "../math.ts";
import { ELEM } from "../traps.ts";
import { PHASE, type World } from "../world.ts";
import { SOURCE, damageEnemy, launchEnemy } from "./combat.ts";
import { detonateKegs, hasLiveKeg, raiseCorpses, throwKeg } from "./summons.ts";

/** Tick every ability timer down. Runs before command handling. */
export function abilityCooldownSystem(w: World): void {
  const p = w.player;
  if (p.abilityCooldown[0] > 0) p.abilityCooldown[0]--;
  if (p.abilityCooldown[1] > 0) p.abilityCooldown[1]--;
  if (p.buffTicks > 0 && --p.buffTicks === 0) p.buffDamage = 1;
  if (p.rootTicks > 0) p.rootTicks--;
  if (p.pierceTicks > 0) p.pierceTicks--;
  if (p.freeFireTicks > 0 && --p.freeFireTicks === 0) p.freeShots = 0;
}

/**
 * Fire ability `slot`, if it is off cooldown.
 *
 * Returns false when it did not fire, so the caller can play a "denied" cue
 * rather than silently eating the input — a cooldown the player cannot perceive
 * reads as an unresponsive button.
 */
export function fireAbility(w: World, slot: number): boolean {
  const p = w.player;
  if (w.phase === PHASE.lost) return false;
  const index = slot === ABILITY_SLOT.e ? 1 : 0;
  const def = abilityDef(p.weapon, index);

  /*
   * "Detonate on command" (§7.3 Blasting Charge): while a keg is in the air the
   * same key sets it off rather than throwing another.
   *
   * Checked BEFORE the cooldown guard, not merely before the cooldown is
   * stamped — the throw already started the cooldown, so a guard-first order
   * rejects the second press and the ability silently becomes fuse-only. That
   * is exactly the bug the test for this pins.
   */
  if (def.effects.some((fx) => fx.kind === "throwCharge") && hasLiveKeg(w)) {
    detonateKegs(w);
    w.events.push(EV.abilityFired, p.x, p.y + 1.2, p.z, index);
    return true;
  }

  if (p.abilityCooldown[index] > 0) return false;
  p.abilityCooldown[index] = def.cooldown;

  for (const effect of def.effects) apply(w, effect);

  w.events.push(EV.abilityFired, p.x, p.y + 1.2, p.z, index);
  return true;
}

function apply(w: World, effect: AbilityEffect): void {
  const p = w.player;
  const e = w.enemies;

  switch (effect.kind) {
    case "selfDamage":
      p.buffDamage = effect.mult;
      p.buffTicks = effect.ticks;
      break;

    case "root":
      p.rootTicks = effect.ticks;
      break;

    case "freeFire":
      p.freeShots = effect.shots;
      p.freeFireTicks = effect.ticks;
      p.freeFireInterval = effect.interval;
      // Fires on its own cadence from the next tick — see `freeFireSystem`.
      p.freeFireDelay = 0;
      // Cancels a reload: fanning the hammer is what you do INSTEAD of reloading.
      p.reloadTicks = 0;
      break;

    case "markArea":
      forEachEnemyInRange(w, p.x, p.z, effect.radius, (i) => {
        e.marked[i] = effect.ticks;
        e.markAmp[i] = Math.max(e.markAmp[i], effect.amp);
      });
      break;

    case "markTarget": {
      /* Aimed, not nearest: this is a precision verb and picking the closest
       * body would let the player fire it without looking. */
      const target = aimedEnemy(w, 60);
      if (target >= 0) {
        e.marked[target] = effect.ticks;
        e.markAmp[target] = Math.max(e.markAmp[target], effect.amp);
      }
      break;
    }

    case "fearArea":
      forEachEnemyInRange(w, p.x, p.z, effect.radius, (i) => {
        e.feared[i] = Math.max(e.feared[i], effect.ticks);
      });
      break;

    case "trapBuff": {
      const t = w.traps;
      const r2 = effect.radius * effect.radius;
      for (let i = 0; i < t.count; i++) {
        if (!t.alive[i]) continue;
        const dx = t.x[i] - p.x;
        const dz = t.z[i] - p.z;
        if (dx * dx + dz * dz <= r2) {
          t.buffTicks[i] = effect.ticks;
          t.buffMult[i] = Math.max(t.buffMult[i], effect.mult);
        }
      }
      break;
    }

    case "damageArea":
      forEachEnemyInRange(w, p.x, p.z, effect.radius, (i) => {
        damageEnemy(w, i, effect.amount, SOURCE.revolver, ELEM.powder);
      });
      break;

    case "knockback":
      forEachEnemyInRange(w, p.x, p.z, effect.radius, (i) => {
        launchEnemy(w, i, p.x, p.z, effect.up, effect.force);
      });
      break;

    case "selfLaunch": {
      /* Recoil as mobility: shove the player along their own back vector. The
       * movement system owns velocity, so this only writes it. */
      const back = -1;
      p.vx += dsin(p.pyaw) * effect.back * back;
      p.vz += dcos(p.pyaw) * effect.back * back;
      p.vy += effect.up;
      p.grounded = false;
      break;
    }

    case "pierce":
      p.pierceTicks = effect.ticks;
      break;

    case "throwCharge":
      throwKeg(w, effect.radius, effect.amount, effect.up, effect.fuse);
      break;

    case "raiseCorpses":
      raiseCorpses(w, effect.radius, effect.cap, effect.ticks);
      break;
  }
}

/** Nearest enemy along the aim ray, or -1. */
function aimedEnemy(w: World, range: number): number {
  const e = w.enemies;
  const p = w.player;
  const dx = dsin(p.pyaw) * dcos(p.ppitch);
  const dz = dcos(p.pyaw) * dcos(p.ppitch);
  let best = -1;
  let bestT = range;

  for (let i = 0; i < e.count; i++) {
    if (!e.alive[i]) continue;
    const ox = e.x[i] - p.x;
    const oz = e.z[i] - p.z;
    const t = ox * dx + oz * dz;
    if (t <= 0 || t >= bestT) continue;
    const perp = Math.abs(ox * dz - oz * dx);
    if (perp > enemyDef(e.defId[i]).radius + 0.6) continue;
    best = i;
    bestT = t;
  }
  return best;
}

function forEachEnemyInRange(
  w: World,
  x: number,
  z: number,
  radius: number,
  fn: (i: number) => void,
): void {
  const e = w.enemies;
  const r2 = radius * radius;
  for (let i = 0; i < e.count; i++) {
    if (!e.alive[i]) continue;
    const dx = e.x[i] - x;
    const dz = e.z[i] - z;
    if (dx * dx + dz * dz <= r2) fn(i);
  }
}
