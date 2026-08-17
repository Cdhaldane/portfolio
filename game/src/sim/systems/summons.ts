/*
 * System — the things a weapon ability leaves in the world (§7.3).
 *
 * Three small pools, ticked together because they share a shape: fixed
 * capacity, struct-of-arrays, and a timer that eventually frees the slot.
 *
 *   keg      — a thrown charge, flies then detonates on fuse or on a second press
 *   corpse   — where a body fell, and how long it stays raisable
 *   revenant — a raised gunslinger, stationary and timed
 *
 * All damage routes through `damageEnemy`, the single writer of enemy hp
 * (§12.4), so a keg blast and a revenant's shot both feed the combo system,
 * element interactions and kill attribution without knowing they exist.
 */

import { EV } from "../events.ts";
import { enemyDef } from "../enemies.ts";
import { LAUNCH, STEP, ticks } from "../tuning.ts";
import { ELEM } from "../traps.ts";
import { PHASE, firstFree, type World } from "../world.ts";
import { SOURCE, damageEnemy, launchEnemy } from "./combat.ts";

/** A raised gunslinger, matching §7's Revenant Deputy. */
export const REVENANT = {
  damage: 25,
  fireCooldown: ticks(1),
  range: 14,
} as const;

export function summonSystem(w: World): void {
  if (w.phase === PHASE.lost) return;
  tickKegs(w);
  tickCorpses(w);
  tickRevenants(w);
}

// ─────────────────────────────────────────────────────────────── kegs

/**
 * Throw a charge along the player's aim.
 *
 * Ballistic rather than hitscan: the arc is the skill, and a keg that simply
 * appeared where you looked would make Blasting Charge a worse Scattershot.
 */
export function throwKeg(
  w: World,
  radius: number,
  damage: number,
  up: number,
  fuse: number,
): boolean {
  const k = w.summons.keg;
  const slot = firstFree(k.alive);
  if (slot < 0) return false;

  const p = w.player;
  const cosP = Math.cos(p.ppitch);
  const dirX = Math.sin(p.pyaw) * cosP;
  const dirY = Math.sin(p.ppitch);
  const dirZ = Math.cos(p.pyaw) * cosP;
  const speed = 16;

  k.alive[slot] = 1;
  k.x[slot] = p.x + dirX * 0.6;
  k.y[slot] = p.y + 1.3;
  k.z[slot] = p.z + dirZ * 0.6;
  k.vx[slot] = dirX * speed;
  /* A little extra lift so a flat throw still arcs — the player aims at a body,
   * not above it, and a dead-flat keg lands short of where they looked. */
  k.vy[slot] = dirY * speed + 3;
  k.vz[slot] = dirZ * speed;
  k.fuse[slot] = fuse;
  k.radius[slot] = radius;
  k.damage[slot] = damage;
  k.up[slot] = up;

  w.events.push(EV.kegThrown, k.x[slot], k.y[slot], k.z[slot], slot);
  return true;
}

/** Detonate every live keg now — the second press of Blasting Charge. */
export function detonateKegs(w: World): boolean {
  const k = w.summons.keg;
  let any = false;
  for (let i = 0; i < k.alive.length; i++) {
    if (!k.alive[i]) continue;
    blast(w, i);
    any = true;
  }
  return any;
}

export function hasLiveKeg(w: World): boolean {
  return w.summons.keg.alive.some((v) => v === 1);
}

function tickKegs(w: World): void {
  const k = w.summons.keg;
  for (let i = 0; i < k.alive.length; i++) {
    if (!k.alive[i]) continue;

    k.vy[i] -= LAUNCH.gravity * STEP;
    k.x[i] += k.vx[i] * STEP;
    k.y[i] += k.vy[i] * STEP;
    k.z[i] += k.vz[i] * STEP;

    // Rest on the ground rather than rolling: a keg that skids is a keg you
    // cannot aim, and the arc already carried the skill.
    if (k.y[i] <= 0.25) {
      k.y[i] = 0.25;
      k.vx[i] = 0;
      k.vy[i] = 0;
      k.vz[i] = 0;
    }

    if (k.fuse[i] > 0 && --k.fuse[i] === 0) blast(w, i);
  }
}

function blast(w: World, i: number): void {
  const k = w.summons.keg;
  const e = w.enemies;
  const r2 = k.radius[i] * k.radius[i];

  for (let j = 0; j < e.alive.length; j++) {
    if (!e.alive[j]) continue;
    const dx = e.x[j] - k.x[i];
    const dz = e.z[j] - k.z[i];
    if (dx * dx + dz * dz > r2) continue;
    /* Launch BEFORE damage: a body killed by the blast frees its slot inside
     * `damageEnemy`, and launching a freed slot would move a corpse. */
    launchEnemy(w, j, k.x[i], k.z[i], k.up[i], 2);
    damageEnemy(w, j, k.damage[i], SOURCE.plate, ELEM.powder);
  }

  w.events.push(EV.kegBlast, k.x[i], k.y[i], k.z[i], k.radius[i]);
  k.alive[i] = 0;
}

// ────────────────────────────────────────────────────────────── corpses

function tickCorpses(w: World): void {
  const c = w.summons.corpse;
  for (let i = 0; i < c.alive.length; i++) {
    if (!c.alive[i]) continue;
    if (--c.ttl[i] === 0) c.alive[i] = 0;
  }
}

/**
 * Raise every corpse in radius, up to `cap`.
 *
 * Returns how many rose, so the caller can tell the difference between "no
 * bodies nearby" and "the ability fired" — a verb that silently does nothing
 * reads as broken.
 */
export function raiseCorpses(w: World, radius: number, cap: number, ttl: number): number {
  const c = w.summons.corpse;
  const r = w.summons.revenant;
  const p = w.player;
  const r2 = radius * radius;
  let raised = 0;

  for (let i = 0; i < c.alive.length && raised < cap; i++) {
    if (!c.alive[i]) continue;
    const dx = c.x[i] - p.x;
    const dz = c.z[i] - p.z;
    if (dx * dx + dz * dz > r2) continue;

    const slot = firstFree(r.alive);
    if (slot < 0) break;

    r.alive[slot] = 1;
    r.x[slot] = c.x[i];
    r.y[slot] = c.y[i];
    r.z[slot] = c.z[i];
    r.ttl[slot] = ttl;
    r.cooldown[slot] = 0;

    // Spent: a corpse rises once.
    c.alive[i] = 0;
    raised++;
    w.events.push(EV.revenantRose, r.x[slot], r.y[slot], r.z[slot], slot);
  }
  return raised;
}

/**
 * Revenants shoot the nearest body and expire on their timer.
 *
 * Deliberately stationary and un-targetable in this pass: §7.3 gives Wake a
 * 15-second life, so the ally never needs to be killed to leave, and enemies
 * that could attack them would need a whole target-selection layer for a unit
 * that removes itself anyway. Recorded here rather than hidden — if revenants
 * ever become permanent, this is the assumption that breaks first.
 */
function tickRevenants(w: World): void {
  const r = w.summons.revenant;
  const e = w.enemies;

  for (let i = 0; i < r.alive.length; i++) {
    if (!r.alive[i]) continue;
    if (--r.ttl[i] === 0) {
      r.alive[i] = 0;
      w.events.push(EV.revenantFell, r.x[i], r.y[i], r.z[i], i);
      continue;
    }
    if (r.cooldown[i] > 0) {
      r.cooldown[i]--;
      continue;
    }

    let best = -1;
    let bestD2 = REVENANT.range * REVENANT.range;
    let bestSpawn = 0x7fffffff;
    for (let j = 0; j < e.alive.length; j++) {
      if (!e.alive[j]) continue;
      const dx = e.x[j] - r.x[i];
      const dz = e.z[j] - r.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD2) continue;
      // §13 rule 4: ties break on spawnId, never on array position.
      if (d2 === bestD2 && e.spawnId[j] >= bestSpawn) continue;
      best = j;
      bestD2 = d2;
      bestSpawn = e.spawnId[j];
    }
    if (best < 0) continue;

    r.cooldown[i] = REVENANT.fireCooldown;
    const def = enemyDef(e.defId[best]);
    w.events.push(EV.revenantFired, r.x[i], r.y[i] + 1.2, r.z[i], best);
    damageEnemy(w, best, REVENANT.damage, SOURCE.revolver, ELEM.iron);
    void def;
  }
}
