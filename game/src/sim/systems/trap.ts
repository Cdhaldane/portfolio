/*
 * System 9 — TrapTriggerSystem.
 *
 * One generic dispatcher over `TrapDef`s (sim/traps.ts). Adding a trap is a data
 * entry; adding a *kind* of effect is one case below. Nothing here knows the name
 * of any individual trap, which is what stops this file from becoming a 900-line
 * switch by M6.
 *
 * Three trigger modes, and the difference between them is most of what makes the
 * five starting traps feel unalike:
 *
 *   proximity — grabs the nearest valid target, then goes cold (Jaws, Plate)
 *   aura      — always on, everything in radius, no cooldown (Tar, Sigil)
 *   periodic  — fires on a metronome whether or not anything's there (Vent)
 */

import { EV } from "../events.ts";
import {
  LIT_TICKS,
  REACH,
  TRIGGER,
  resolved,
  type TrapDef,
  type TrapEffect,
} from "../traps.ts";
import { ELEM } from "../traps.ts";
import { enemyDef } from "../enemies.ts";
import { EV as EVENTS } from "../events.ts";
import { STEP } from "../tuning.ts";
import type { World } from "../world.ts";
import { slotOfCell } from "../level.ts";
import { wallOfCell } from "../wallgrid.ts";
import { SURF, sideNormalX, sideNormalZ } from "../surfaces.ts";
import { TRAP_SOURCE, damageEnemy, launchEnemy } from "./combat.ts";

/**
 * Can this trap touch this body?
 *
 * Airborne means *off the ground*, which covers a Buzzard on a pass and a Dustkin
 * mid-launch alike — a Bone Plate feeding a Buzzard Roost is meant to work.
 */
function inReach(w: World, def: TrapDef, i: number): boolean {
  const e = w.enemies;
  const airborne = e.grounded[i] === 0 || enemyDef(e.defId[i]).flying;
  return airborne ? def.reach !== REACH.ground : def.reach !== REACH.air;
}

/**
 * Squared distance from a trap to a body, in the dimensions that trap works in.
 *
 * A ground trap is a puddle: it reaches across the floor and has no opinion about
 * height, so it stays a 2D test. A trap that reaches into the air is a *volume*
 * hung at `y` metres, and measuring it in 2D would let a roof beam 4.4m up hit a
 * flier directly beneath it as easily as one at its own altitude.
 */
function reachD2(w: World, ti: number, def: TrapDef, i: number): number {
  const e = w.enemies;
  const t = w.traps;
  const dx = e.x[i] - t.x[ti];
  const dz = e.z[i] - t.z[ti];
  if (def.reach === REACH.ground) return dx * dx + dz * dz;
  // Body centre, not its feet: a 1.8m body under a 4.4m beam is 3.5m away, not 4.4.
  const dy = e.y[i] + 0.9 - t.y[ti];
  return dx * dx + dy * dy + dz * dz;
}

export function trapSystem(w: World): void {
  const t = w.traps;
  for (let ti = 0; ti < t.alive.length; ti++) {
    if (!t.alive[ti]) continue;
    if (t.fired[ti] > 0) t.fired[ti]--;
    /* Peal's buff expires on its own clock (§7.3). Cleared rather than left to
     * decay, so `buffMult` is only ever read while `buffTicks` vouches for it. */
    if (t.buffTicks[ti] > 0 && --t.buffTicks[ti] === 0) t.buffMult[ti] = 1;

    // The resolved def folds in whichever upgrade this instance took (§6).
    const def = resolved(t.defId[ti], t.upgrade[ti]);
    if (!def) continue;
    if (t.lit[ti] > 0) t.lit[ti]--;

    // An obstacle works by existing; there is nothing to tick (sim/traps.ts).
    if (def.trigger === TRIGGER.inert) continue;

    switch (def.trigger) {
      case TRIGGER.aura:
        runAura(w, ti, def);
        break;
      case TRIGGER.periodic:
        if (t.cooldown[ti] > 0) t.cooldown[ti]--;
        else {
          t.cooldown[ti] = def.cooldown;
          runArea(w, ti, def);
          if (def.ignitesGround) igniteGround(w, ti, def);
        }
        break;
      default:
        if (t.cooldown[ti] > 0) t.cooldown[ti]--;
        else {
          const acted = runProximity(w, ti, def);
          if (acted && def.ignitesGround) igniteGround(w, ti, def);
        }
        break;
    }
  }
}

/**
 * Set every overlapping `litEffects` trap alight. This is the trap-to-trap
 * interaction: a Brimstone Vent next to a Tar Seep converts the pool from a slow
 * into a burning lake for as long as the vent keeps belching.
 */
function igniteGround(w: World, ti: number, def: TrapDef): void {
  const t = w.traps;
  for (let tj = 0; tj < t.alive.length; tj++) {
    if (tj === ti || !t.alive[tj]) continue;
    const other = resolved(t.defId[tj], t.upgrade[tj]);
    if (!other || !other.litEffects) continue;
    const dx = t.x[tj] - t.x[ti];
    const dz = t.z[tj] - t.z[ti];
    const reach = def.radius + other.radius;
    if (dx * dx + dz * dz > reach * reach) continue;
    // Fire has to be able to fall on the stuff: a vent bolted to a roof beam does
    // not light a tar pool it is 4m above.
    if (t.y[ti] - t.y[tj] > 2.5) continue;
    const wasLit = t.lit[tj] > 0;
    // A Wildfire Vent keeps ground alight far longer; Kerosene stays lit longer
    // once caught. Whichever is more generous wins.
    t.lit[tj] = Math.max(def.litTicks ?? LIT_TICKS, other.litTicks ?? LIT_TICKS);
    if (!wasLit) {
      w.events.push(EVENTS.ignite, t.x[tj], 0.3, t.z[tj], other.id);
    }
  }
}

/** Auras apply every tick to everything in radius and never announce themselves. */
function runAura(w: World, ti: number, def: TrapDef): void {
  const e = w.enemies;
  const t = w.traps;
  // A lit trap runs a different effect list entirely.
  const lit = t.lit[ti] > 0 && def.litEffects !== undefined;
  const effects = lit ? def.litEffects! : def.effects;
  // Fire from lit ground is fire, whatever the trap normally is.
  const elem = lit ? ELEM.fire : def.elem;
  const r2 = def.radius * def.radius;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    /* Airborne bodies are above a *ground* effect, not standing in it. That used
       to be unconditional, which is what left the Buzzard with no answer but the
       revolver; a Hex Lantern declares `REACH.both` and lights it anyway (§8). */
    if (!inReach(w, def, i)) continue;
    if (reachD2(w, ti, def, i) > r2) continue;
    applyEffects(w, i, ti, def, false, effects, elem);
  }
}

/** Periodic traps hit everything in radius when the metronome comes round. */
function runArea(w: World, ti: number, def: TrapDef): void {
  const e = w.enemies;
  const t = w.traps;
  const r2 = def.radius * def.radius;
  let touched = false;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i] || !inReach(w, def, i)) continue;
    if (reachD2(w, ti, def, i) > r2) continue;
    applyEffects(w, i, ti, def, true);
    touched = true;
  }
  // The vent belches on its own schedule; the event fires either way so the
  // cooldown tell is honest (§14.6).
  t.fired[ti] = 12;
  w.events.push(EV.trapFired, t.x[ti], t.y[ti], t.z[ti], def.id);
  if (touched) w.traps.fired[ti] = 18;
}

/** Nearest untouched target, deterministic tie-break by spawn order. */
function runProximity(w: World, ti: number, def: TrapDef): boolean {
  const e = w.enemies;
  const t = w.traps;
  let bestIdx = -1;
  let bestD2 = def.radius * def.radius;
  let bestSpawn = 0x7fffffff;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    // Nothing clamps what's already clamped.
    if (e.hold[i] > 0) continue;
    if (!inReach(w, def, i)) continue;
    const d2 = reachD2(w, ti, def, i);
    if (d2 > bestD2) continue;
    // §13 rule 4: ties break on spawnId, never on array position.
    if (d2 === bestD2 && e.spawnId[i] >= bestSpawn) continue;
    bestD2 = d2;
    bestIdx = i;
    bestSpawn = e.spawnId[i];
  }
  if (bestIdx < 0) return false;

  t.cooldown[ti] = def.cooldown;
  t.fired[ti] = 18;
  w.events.push(EV.trapFired, t.x[ti], t.y[ti], t.z[ti], def.id);
  applyEffects(w, bestIdx, ti, def, true);

  // A Wolf Trap catches three. Additional targets are taken in spawn order so
  // the choice stays deterministic (§13 rule 4).
  let taken = 1;
  if (def.maxTargets > 1) {
    const r2 = def.radius * def.radius;
    for (let i = 0; i < e.alive.length && taken < def.maxTargets; i++) {
      if (i === bestIdx || !e.alive[i] || e.hold[i] > 0) continue;
      if (!inReach(w, def, i)) continue;
      if (reachD2(w, ti, def, i) > r2) continue;
      applyEffects(w, i, ti, def, false);
      taken++;
    }
  }
  return true;
}

/**
 * Apply a def's effect list to one enemy. Damage goes LAST so the statuses this
 * trap applies (soak, mark, hold) are already live when the amplifiers in
 * `damageEnemy` read them — that's what makes a single trap's own combo land.
 */
function applyEffects(
  w: World,
  i: number,
  ti: number,
  def: TrapDef,
  announce: boolean,
  effects: TrapEffect[] = def.effects,
  elem = def.elem,
): void {
  const e = w.enemies;
  const t = w.traps;
  let damage = 0;

  for (let k = 0; k < effects.length; k++) {
    const fx: TrapEffect = effects[k];
    switch (fx.kind) {
      case "damage":
        damage += fx.amount;
        break;
      case "hold":
        if (e.hold[i] < fx.ticks) e.hold[i] = fx.ticks;
        break;
      case "soak":
        if (e.soaked[i] < fx.ticks) e.soaked[i] = fx.ticks;
        break;
      case "burn":
        if (e.burning[i] < fx.ticks) e.burning[i] = fx.ticks;
        if (e.burnDps[i] < fx.dps) e.burnDps[i] = fx.dps;
        break;
      case "slow":
        e.slowed[i] = fx.ticks;
        e.slowFactor[i] = fx.factor;
        break;
      case "mark":
        e.marked[i] = fx.ticks;
        e.markAmp[i] = fx.amp;
        break;
      case "launch": {
        /*
         * A floor trap throws bodies *away from itself*; a wall trap throws them
         * along its own outward normal, into the lane. Using the mount point for
         * both would make Scattergun Ports shove bodies into the very wall it is
         * bolted to whenever they drifted behind its centre line.
         *
         * The normal comes from the mount, not from `yaw`: a north-facing wall has
         * yaw 0, which is indistinguishable from a ceiling beam.
         */
        const wi = wallOfCell(t.cell[ti]);
        const si = slotOfCell(t.cell[ti]);
        const mount =
          wi >= 0
            ? { surface: SURF.wall, side: w.level.wallTiles[wi].side }
            : si >= 0
              ? w.level.slots[si]
              : undefined;
        if (mount !== undefined && mount.surface === SURF.wall) {
          const nx = sideNormalX(mount.side ?? 0);
          const nz = sideNormalZ(mount.side ?? 0);
          // Half a metre behind the face, so "away from here" IS "along the normal".
          launchEnemy(w, i, t.x[ti] - nx * 0.5, t.z[ti] - nz * 0.5, fx.up, fx.out);
        } else {
          launchEnemy(w, i, t.x[ti], t.z[ti], fx.up, fx.out);
        }
        break;
      }
    }
  }

  if (damage > 0) {
    // Aura damage is authored per SECOND: applying it per tick unchanged would be
    // a 60x error, and "24" reads as a rate in the def where "0.4" reads as noise.
    if (def.trigger === TRIGGER.aura) damage *= STEP;
    /* Peal's buff (§7.3). Guarded on the timer rather than reading buffMult
     * directly, because the pool's default is 0 and would zero the damage. */
    if (t.buffTicks[ti] > 0) damage *= t.buffMult[ti];
    damageEnemy(w, i, damage, TRAP_SOURCE[def.id] ?? 0, elem);
  } else if (announce) {
    // A no-damage trap still needs to look like it did something.
    w.events.push(EV.statusApplied, e.x[i], e.y[i] + 0.8, e.z[i], def.id);
  }
}
