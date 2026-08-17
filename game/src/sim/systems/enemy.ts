/*
 * Systems 3/4/5/6/7 (enemy half) — status, flow-field locomotion, flight, melee,
 * separation, gravity and collision.
 *
 * Everything here is per-entity via `enemyDef(e.defId[i])` rather than against a
 * single set of constants, which is what lets §8's roster exist at all: an
 * archetype is a row of data, not a branch.
 *
 * Two movement modes:
 *   walkers — sample the baked flow field, O(1) per enemy per tick (§15.1)
 *   fliers  — ignore the field, the walls and the chokepoints entirely, cruising
 *             above the geometry straight at the Rift. That IS the Buzzard's
 *             argument: the ground you spent all your scrap on does not apply.
 */

import { enemyDef } from "../enemies.ts";
import { EV } from "../events.ts";
import { resolveCircle } from "../geom.ts";
import { flowDir, groundHeight } from "../level.ts";
import { approach } from "../math.ts";
import { LAUNCH, PLAYER, STEP } from "../tuning.ts";
import type { World } from "../world.ts";
import { SOURCE, applyFallDamage, damageEnemy, damagePlayer } from "./combat.ts";
import { ELEM } from "../traps.ts";

const scratch = new Float64Array(2);
const flow = new Float64Array(2);

export function statusSystem(w: World): void {
  const e = w.enemies;
  const p = w.player;
  if (p.invuln > 0) p.invuln--;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    if (e.hold[i] > 0) e.hold[i]--;
    if (e.soaked[i] > 0) e.soaked[i]--;
    if (e.marked[i] > 0) e.marked[i]--;
    if (e.slowed[i] > 0) e.slowed[i]--;
    if (e.hitFlash[i] > 0) e.hitFlash[i]--;
    if (e.booted[i] > 0) e.booted[i]--;
    if (e.attackCd[i] > 0) e.attackCd[i]--;

    // Burning ticks damage. Routed through damageEnemy so amplifiers and armour
    // still apply and the kill is attributed to fire, not to whatever lit it.
    if (e.burning[i] > 0) {
      e.burning[i]--;
      damageEnemy(w, i, e.burnDps[i] * STEP, SOURCE.burn, ELEM.fire);
      if (!e.alive[i]) continue;
      if (e.burning[i] === 0) e.burnDps[i] = 0;
    }
  }
}

/**
 * How often the hymn is *audible/visible*, in ticks. The healing itself is
 * continuous; the pulse is presentation cadence, on a shared beat (`w.tick`
 * phase) so every Preacher in earshot sings in unison — which is both cheaper
 * than per-body timers and better fiction.
 */
const HEAL_PULSE_TICKS = 36;

/**
 * System 3b — the Hollow Preacher's hymn (§8).
 *
 * Restores HP to every *other* body in range and cleanses their slows. Two
 * rules do the design work:
 *
 *   - It never heals itself, so "kill it yourself" stays a decision with a
 *     fixed price (two revolver rounds) rather than a DPS race.
 *   - It keeps singing while clamped in a trap. Traps must not be the answer
 *     to the unit whose argument is "your traps have stopped working".
 *
 * O(n × preachers), which is fine at weight 3 — and the loop shape is the same
 * one separationSystem already lives with.
 */
export function healSystem(w: World): void {
  const e = w.enemies;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    const heal = def.heal;
    if (!heal) continue;

    const r2 = heal.radius * heal.radius;
    let landed = false;

    for (let j = 0; j < e.alive.length; j++) {
      if (j === i || !e.alive[j]) continue;
      const dx = e.x[j] - e.x[i];
      const dz = e.z[j] - e.z[i];
      if (dx * dx + dz * dz > r2) continue;

      if (e.slowed[j] > 0) {
        e.slowed[j] = 0;
        landed = true;
      }
      if (e.hp[j] < e.maxHp[j]) {
        e.hp[j] = Math.min(e.maxHp[j], e.hp[j] + heal.rate * STEP);
        landed = true;
      }
    }

    // The tell. §8's telegraph rule generalises: an aura with no cue is a lane
    // that stopped working for no visible reason, which reads as a bug.
    if (landed && w.tick % HEAL_PULSE_TICKS === 0) {
      w.events.push(EV.healPulse, e.x[i], e.y[i] + def.height * 0.8, e.z[i], e.defId[i]);
    }
  }
}

/**
 * System 4 — the melee half of ThinkSystem.
 *
 * A telegraphed swing, not an instant touch: `windup` gives the player a window
 * to step out or kick the thing away, which is what makes melee a *decision*
 * rather than a tax for standing in the wrong place.
 */
export function meleeSystem(w: World): void {
  const e = w.enemies;
  const p = w.player;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    const melee = def.melee;
    if (!melee) continue;

    // Mid-swing: land it if still in reach, otherwise the player dodged.
    if (e.windup[i] > 0) {
      e.windup[i]--;
      if (e.windup[i] === 0) {
        const dx = p.x - e.x[i];
        const dz = p.z - e.z[i];
        const reach = melee.range + PLAYER.radius;
        if (dx * dx + dz * dz <= reach * reach) damagePlayer(w, melee.damage);
      }
      continue;
    }

    // Clamped or airborne things can't swing.
    if (e.hold[i] > 0 || e.grounded[i] === 0 || e.attackCd[i] > 0) continue;

    const dx = p.x - e.x[i];
    const dz = p.z - e.z[i];
    const reach = melee.range + PLAYER.radius;
    if (dx * dx + dz * dz > reach * reach) continue;

    e.windup[i] = melee.windup;
    e.attackCd[i] = melee.cooldown;
    w.events.push(EV.enemyWindup, e.x[i], e.y[i] + def.height * 0.7, e.z[i], e.defId[i]);
  }
}

export function enemyMoveSystem(w: World): void {
  const e = w.enemies;
  const level = w.level;
  const speedScale = w.enemySpeedScale;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    const slow = e.slowed[i] > 0 ? e.slowFactor[i] : 1;
    const speed = def.speed * speedScale * slow;

    // ── fliers ───────────────────────────────────────────────────────────
    if (def.flying) {
      let dx = level.rift.x - e.x[i];
      let dz = level.rift.z - e.z[i];
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= d;
      dz /= d;
      const rate = def.turnRate * STEP * def.speed;
      e.vx[i] = approach(e.vx[i], dx * speed, rate);
      e.vz[i] = approach(e.vz[i], dz * speed, rate);
      e.x[i] += e.vx[i] * STEP;
      e.z[i] += e.vz[i] * STEP;
      // Hold the cruise altitude with a soft bob so it reads as flight.
      e.y[i] = approach(e.y[i], def.flightHeight, 4 * STEP);
      e.grounded[i] = 0;
      continue;
    }

    // ── walkers: vertical ────────────────────────────────────────────────
    const airborne = e.grounded[i] === 0;
    if (airborne) {
      e.vy[i] -= LAUNCH.gravity * STEP;
      e.y[i] += e.vy[i] * STEP;
      const ground = groundHeight(level, e.x[i], e.z[i], e.y[i] + 0.5);
      if (e.y[i] <= ground) {
        const impact = -e.vy[i];
        e.y[i] = ground;
        e.vy[i] = 0;
        e.grounded[i] = 1;
        applyFallDamage(w, i, impact);
        if (!e.alive[i]) continue;
      }
    }

    // Mid-swing bodies plant their feet, and clamped ones can't move at all.
    if ((e.hold[i] > 0 || e.windup[i] > 0) && !airborne) {
      e.vx[i] = 0;
      e.vz[i] = 0;
      continue;
    }

    // flowDir, not a raw cell lookup: a body standing in a blocked cell's skirt
    // has no flow of its own and would otherwise freeze forever (see level.ts).
    flowDir(level, e.x[i], e.z[i], flow);
    let dirX = flow[0];
    let dirZ = flow[1];

    /*
     * Feared bodies run from the player rather than toward the Rift (§7.3 Peal).
     *
     * Steering away from the PLAYER, not simply reversing the flow field:
     * reversing sends them back down the lane they came from, which is where
     * the traps are, and a crowd-control verb that herds enemies INTO the kill
     * box would read as a reward rather than a reprieve.
     */
    if (e.feared[i] > 0) {
      e.feared[i]--;
      const fx = e.x[i] - w.player.x;
      const fz = e.z[i] - w.player.z;
      const len = Math.hypot(fx, fz);
      if (len > 1e-4) {
        dirX = fx / len;
        dirZ = fz / len;
      }
    }

    const control = airborne ? LAUNCH.airControl : 1;
    const rate = def.turnRate * STEP * def.speed * control;
    e.vx[i] = approach(e.vx[i], dirX * speed, rate);
    e.vz[i] = approach(e.vz[i], dirZ * speed, rate);

    e.x[i] += e.vx[i] * STEP;
    e.z[i] += e.vz[i] * STEP;

    if (!airborne) {
      e.y[i] = groundHeight(level, e.x[i], e.z[i], e.y[i] + 0.5);
    }
  }
}

/**
 * Positional separation instead of RVO: two relaxation passes pushing
 * overlapping cylinders apart. Deterministic, cheap, and it looks right —
 * a horde *should* shove (§15.1).
 *
 * O(n²) over grounded bodies. The uniform-grid broadphase arrives with the rest
 * of the spatial hash at M1; the loop shape doesn't change when it does.
 */
export function separationSystem(w: World): void {
  const e = w.enemies;

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < e.alive.length; i++) {
      if (!e.alive[i] || e.grounded[i] === 0) continue;
      const ri = enemyDef(e.defId[i]).radius;
      for (let j = i + 1; j < e.alive.length; j++) {
        if (!e.alive[j] || e.grounded[j] === 0) continue;
        const minDist = ri + enemyDef(e.defId[j]).radius;
        const dx = e.x[j] - e.x[i];
        const dz = e.z[j] - e.z[i];
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = (dx / d) * push;
        const nz = (dz / d) * push;
        // A held enemy is anchored: the trap wins the tug of war.
        if (e.hold[i] === 0) {
          e.x[i] -= nx;
          e.z[i] -= nz;
        }
        if (e.hold[j] === 0) {
          e.x[j] += nx;
          e.z[j] += nz;
        }
      }
    }
  }
}

/** Keep bodies out of the player's own cylinder so they never ghost through. */
export function playerPushSystem(w: World): void {
  const e = w.enemies;
  const p = w.player;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i] || e.hold[i] > 0 || e.grounded[i] === 0) continue;
    const minDist = enemyDef(e.defId[i]).radius + PLAYER.radius;
    const dx = e.x[i] - p.x;
    const dz = e.z[i] - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minDist * minDist || d2 < 1e-9) continue;
    const d = Math.sqrt(d2);
    const push = minDist - d;
    e.x[i] += (dx / d) * push;
    e.z[i] += (dz / d) * push;
  }
}

export function enemyCollisionSystem(w: World): void {
  const e = w.enemies;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    // Fliers are above the walls; collision would only fight them.
    if (def.flying) continue;
    resolveCircle(
      w.level,
      e.x[i],
      e.z[i],
      def.radius,
      e.y[i] + 0.15,
      e.y[i] + def.height,
      scratch,
      PLAYER.stepOffset,
      // Bodies are stopped by the player's blockades. The player is not (§6).
      true,
    );
    e.x[i] = scratch[0];
    e.z[i] = scratch[1];
  }
}
