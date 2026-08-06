/*
 * Systems 10/11/12 — hitscan, damage, death, and the Boot.
 *
 * `damageEnemy` is the ONLY writer of enemy hp (§12.4), which is what keeps every
 * multiplier, every element interaction, armour, and kill attribution in one
 * place. A new amplifier is one line here rather than a change to five traps.
 *
 * Resolution order matters and is deliberate:
 *   1. element interaction (fire on soaked → ×3, consume the soak, ignite)
 *   2. amplifiers (marked ×1.5, held ×1.25) — multiplicative
 *   3. ARMOUR, checked last, on the amplified number
 *
 * Armour going last is the whole design of the Ironjaw: burn ticks and lit ground
 * clang off it forever, but marking it so a small hit clears the threshold is a
 * real synergy the player can discover.
 */

import { cameraPose, makePose } from "../aim.ts";
import { HANDS, evaluate, resetHand, score, type HandId } from "../combo.ts";
import { enemyDef } from "../enemies.ts";
import { EV } from "../events.ts";
import { rayCylinder, rayLevel } from "../geom.ts";
import { dcos, dsin } from "../math.ts";
import { BOOT, KILL, LAUNCH, REVOLVER, ROUND, STATUS, SURVIVAL } from "../tuning.ts";
import { ELEM, type Elem } from "../traps.ts";
import { PHASE, killEnemy, type World } from "../world.ts";

/** Who landed the killing blow. The "suit" of the card in the poker hand (§5). */
export const SOURCE = {
  revolver: 0,
  jaws: 1,
  tar: 2,
  vent: 3,
  plate: 4,
  sigil: 5,
  burn: 6,
  fall: 7,
  boot: 8,
  rift: 9,
  ports: 10,
  coil: 11,
  lantern: 12,
  roost: 13,
} as const;

export type Source = (typeof SOURCE)[keyof typeof SOURCE];

/** Trap def id → damage source, so the kill feed and the hand agree. */
export const TRAP_SOURCE: Source[] = [
  SOURCE.jaws,
  SOURCE.tar,
  SOURCE.vent,
  SOURCE.plate,
  SOURCE.sigil,
  SOURCE.ports,
  SOURCE.coil,
  SOURCE.lantern,
  SOURCE.roost,
];

const TRAP_SOURCES = new Set<number>([
  SOURCE.jaws,
  SOURCE.tar,
  SOURCE.vent,
  SOURCE.plate,
  SOURCE.sigil,
  SOURCE.burn,
  SOURCE.fall,
  SOURCE.ports,
  SOURCE.coil,
  SOURCE.lantern,
  SOURCE.roost,
]);

export function damageEnemy(
  w: World,
  i: number,
  amount: number,
  source: Source,
  elem: Elem = ELEM.iron,
): void {
  const e = w.enemies;
  if (!e.alive[i]) return;
  const def = enemyDef(e.defId[i]);

  let dmg = amount;

  // 1 ── element interaction. Fire on a soaked body is the signature combo.
  let ignited = false;
  if (elem === ELEM.fire && e.soaked[i] > 0) {
    dmg *= STATUS.igniteMultiplier;
    e.soaked[i] = 0;
    e.burning[i] = STATUS.igniteBurnTicks;
    e.burnDps[i] = Math.max(e.burnDps[i], STATUS.igniteBurnDps);
    ignited = true;
  }

  // 2 ── amplifiers, multiplicative.
  if (e.marked[i] > 0) dmg *= 1 + e.markAmp[i];
  if (e.hold[i] > 0) dmg *= 1 + STATUS.heldAmp;

  // 3 ── armour, on the amplified number.
  if (def.armour > 0 && dmg < def.armour) {
    w.events.push(EV.armourClang, e.x[i], e.y[i] + def.height * 0.6, e.z[i], dmg);
    // A token scratch, so a player hammering plate sees *something* happen.
    dmg = 1;
  }

  e.hp[i] -= dmg;
  e.hitFlash[i] = 6;

  if (ignited) {
    w.events.push(EV.ignite, e.x[i], e.y[i] + 0.9, e.z[i], dmg);
  } else {
    w.events.push(EV.enemyHit, e.x[i], e.y[i] + def.height * 0.6, e.z[i], dmg);
  }

  if (e.hp[i] <= 0) killed(w, i, source);
}

function killed(w: World, i: number, source: Source): void {
  const e = w.enemies;
  const def = enemyDef(e.defId[i]);
  const elite = e.elite[i] === 1;

  // ── style points (§5) ────────────────────────────────────────────────────
  let points = def.tier * KILL.base;
  if (TRAP_SOURCES.has(source)) points *= KILL.byTrap;
  else if (source === SOURCE.revolver) points *= KILL.byGun;
  // The signature verb: kicked into the machinery, finished by the machinery.
  if (e.booted[i] > 0 && TRAP_SOURCES.has(source)) points *= KILL.afterBoot;
  if (e.grounded[i] === 0) points *= KILL.airborne;
  if (elite) points *= 2;

  const h = w.hand;
  if (h.count < h.sources.length) h.sources[h.count++] = source;
  h.points += points;
  h.expiry = w.tick + KILL.handWindow;
  const dx = e.x[i] - w.level.rift.x;
  const dz = e.z[i] - w.level.rift.z;
  h.atRift = dx * dx + dz * dz <= KILL.riftRadius * KILL.riftRadius;

  w.events.push(EV.enemyKilled, e.x[i], e.y[i] + 0.9, e.z[i], source);
  w.scrap += elite ? def.scrap * ROUND.eliteScrapMultiplier : def.scrap;
  w.kills++;
  w.roundKills++;
  killEnemy(w, i);
}

/**
 * System 13 — ComboSystem. Closes the hand when its window lapses.
 *
 * Deliberately not closed on the kill that completes a hand: the window has to
 * lapse, which is what makes "can I land one more before it closes" the tense,
 * skilful part.
 */
export function comboSystem(w: World): void {
  const h = w.hand;
  if (h.count === 0) return;
  if (w.tick < h.expiry) return;

  const hand = evaluate(h);
  const banked = score(h);
  w.tally += banked;
  w.lastHand = hand;
  w.lastHandPoints = banked;
  if (HANDS[hand].multiplier > HANDS[w.bestHand as HandId].multiplier) {
    w.bestHand = hand;
  }
  w.events.push(EV.handScored, 0, 0, 0, hand);
  resetHand(h);
}

export function damagePlayer(w: World, amount: number): void {
  const p = w.player;
  if (w.phase === PHASE.lost || p.invuln > 0) return;

  p.hp -= amount;
  p.invuln = SURVIVAL.invulnTicks;
  // Taking a hit kills Dead Man's Hand — the mastery ceiling requires you not to
  // get touched.
  w.hand.clean = false;
  w.events.push(EV.playerHurt, p.x, p.y + 1.2, p.z, amount);

  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = PHASE.lost;
    w.events.push(EV.playerDied, p.x, p.y + 1, p.z, w.round);
    w.events.push(EV.runLost, 0, 0, 0, w.round);
  }
}

/** Launch a body: Powder Plate and the Boot. */
export function launchEnemy(
  w: World,
  i: number,
  fromX: number,
  fromZ: number,
  up: number,
  out: number,
): void {
  const e = w.enemies;
  if (!e.alive[i]) return;
  // Fliers are already airborne and refuse to be thrown around by the ground.
  if (enemyDef(e.defId[i]).flying) return;

  let dx = e.x[i] - fromX;
  let dz = e.z[i] - fromZ;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.001) {
    dx = e.vx[i];
    dz = e.vz[i];
    const dv = Math.sqrt(dx * dx + dz * dz) || 1;
    dx /= dv;
    dz /= dv;
  } else {
    dx /= d;
    dz /= d;
  }
  e.vy[i] = up;
  e.vx[i] = dx * out;
  e.vz[i] = dz * out;
  e.grounded[i] = 0;
  // A launched body is no longer clamped — that's the point of the combo.
  e.hold[i] = 0;
  w.events.push(EV.launched, e.x[i], e.y[i] + 0.5, e.z[i], up);
}

/** Called by the enemy mover when a body lands. */
export function applyFallDamage(w: World, i: number, impactSpeed: number): void {
  const over = impactSpeed - LAUNCH.fallSafeSpeed;
  if (over <= 0) return;
  damageEnemy(w, i, over * LAUNCH.fallDamagePerMetreSecond, SOURCE.fall, ELEM.iron);
}

/**
 * The Boot (§7). Launches the body nearest the crosshair, in front of the player,
 * along the camera's forward vector — and stamps it with boot credit so a trap
 * finishing the job scores ×2.
 */
export function bootSystem(w: World): void {
  const p = w.player;
  if (p.bootCooldown > 0) p.bootCooldown--;
  if (!p.wantBoot || p.bootCooldown > 0 || w.phase === PHASE.lost) return;

  p.bootCooldown = BOOT.cooldown;

  // Flat forward, so kicking is a horizontal shove regardless of pitch.
  const fx = -dsin(p.yaw);
  const fz = -dcos(p.yaw);

  const e = w.enemies;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    if (def.flying) continue; // can't kick what's 4m up
    const dx = e.x[i] - p.x;
    const dz = e.z[i] - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > BOOT.range + def.radius) continue;
    if (d < 0.001) continue;
    const dot = (dx / d) * fx + (dz / d) * fz;
    if (dot < BOOT.coneDot) continue;
    // Favour whatever is most directly in front — generous, by design (§7).
    const s = dot - d * 0.1;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }

  if (best < 0) {
    w.events.push(EV.bootWhiff, p.x, p.y + 1, p.z, p.yaw);
    return;
  }

  e.booted[best] = BOOT.creditTicks;
  w.events.push(EV.booted, e.x[best], e.y[best] + 0.9, e.z[best], 0);
  // Launch from the player so the body goes where they're facing.
  launchEnemy(w, best, p.x, p.z, BOOT.up, BOOT.out);
  damageEnemy(w, best, BOOT.damage, SOURCE.boot, ELEM.iron);
}

const pose = makePose();

/**
 * The revolver. Fires from the CAMERA along the camera's forward vector, so a
 * shot goes exactly where the crosshair is (§7) — see aim.ts for why that pose
 * is computed in the sim rather than in render.
 */
export function hitscan(w: World): void {
  cameraPose(w, 0, pose);
  const ox = pose.x;
  const oy = pose.y;
  const oz = pose.z;
  const dx = pose.dx;
  const dy = pose.dy;
  const dz = pose.dz;

  const wallT = rayLevel(w.level, ox, oy, oz, dx, dy, dz, REVOLVER.range);

  let bestT = wallT;
  let bestEnemy = -1;
  const e = w.enemies;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    const def = enemyDef(e.defId[i]);
    const t = rayCylinder(
      e.x[i],
      e.y[i],
      e.z[i],
      def.radius + REVOLVER.hitPad,
      def.height,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
    );
    if (t < bestT) {
      bestT = t;
      bestEnemy = i;
    }
  }

  const p = w.player;
  w.events.push(EV.muzzle, p.x, p.y + 1.35, p.z, p.yaw);

  if (bestEnemy >= 0) {
    w.shotsHit++;
    damageEnemy(w, bestEnemy, REVOLVER.damage, SOURCE.revolver, ELEM.iron);
  } else if (isFinite(bestT)) {
    w.events.push(EV.bulletImpact, ox + dx * bestT, oy + dy * bestT, oz + dz * bestT);
  }
}
