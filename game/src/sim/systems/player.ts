/*
 * Systems 6/8 (player half) — locomotion, collision, and the revolver.
 *
 * Movement is hand-rolled rather than handed to Rapier, deliberately: it's the
 * most feel-critical and most determinism-critical system in the game, so every
 * constant stays in our hands (§15.3). Rapier is reserved for cosmetic ragdolls
 * and debris, where a desync can't matter.
 */

import { forwardX, forwardZ, rightX, rightZ } from "../aim.ts";
import { EV } from "../events.ts";
import { resolveCircle } from "../geom.ts";
import { groundHeight } from "../level.ts";
import { approach, len2 } from "../math.ts";
import { CAMERA, JUMP_VELOCITY, PLAYER, REVOLVER, STEP } from "../tuning.ts";
import { PHASE, type World } from "../world.ts";
import { hitscan } from "./combat.ts";

const scratch = new Float64Array(2);

export function playerMoveSystem(w: World): void {
  const p = w.player;
  const level = w.level;

  // Desired direction, in camera space and flattened to the ground plane.
  const fx = forwardX(p.yaw, 0);
  const fz = forwardZ(p.yaw, 0);
  const rx = rightX(p.yaw);
  const rz = rightZ(p.yaw);
  let wishX = rx * p.inMoveX + fx * p.inMoveY;
  let wishZ = rz * p.inMoveX + fz * p.inMoveY;
  const wishLen = len2(wishX, wishZ);
  if (wishLen > 1) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  const maxSpeed = p.sprinting && !p.aiming ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const accel = p.grounded ? PLAYER.groundAccel : PLAYER.airAccel;
  const targetX = wishX * maxSpeed;
  const targetZ = wishZ * maxSpeed;

  if (wishLen > 0.001) {
    p.vx = approach(p.vx, targetX, accel * STEP);
    p.vz = approach(p.vz, targetZ, accel * STEP);
  } else if (p.grounded) {
    p.vx = approach(p.vx, 0, PLAYER.groundFriction * STEP);
    p.vz = approach(p.vz, 0, PLAYER.groundFriction * STEP);
  }

  // Jump: coyote time and the input buffer are what make hopping over your own
  // traps feel fair (§7).
  if (p.jumpBuffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = JUMP_VELOCITY;
    p.grounded = false;
    p.coyote = 0;
    p.jumpBuffer = 0;
  }
  if (p.jumpBuffer > 0) p.jumpBuffer--;

  p.vy -= PLAYER.gravity * STEP;

  // Horizontal first, then vertical — the classic fix for snagging on seams.
  const bodyTop = p.y + PLAYER.height;
  resolveCircle(
    level,
    p.x + p.vx * STEP,
    p.z + p.vz * STEP,
    PLAYER.radius,
    p.y + 0.15,
    bodyTop,
    scratch,
    PLAYER.stepOffset,
  );
  // Kill the velocity component we were just pushed back along, or the player
  // keeps grinding into the wall and friction never takes over.
  const movedX = scratch[0] - p.x;
  const movedZ = scratch[1] - p.z;
  if (Math.abs(movedX) < Math.abs(p.vx * STEP) * 0.5) p.vx = 0;
  if (Math.abs(movedZ) < Math.abs(p.vz * STEP) * 0.5) p.vz = 0;
  p.x = scratch[0];
  p.z = scratch[1];

  p.y += p.vy * STEP;

  // Only surfaces we could actually step onto count as ground.
  const ground = groundHeight(level, p.x, p.z, p.y + PLAYER.stepOffset);
  if (p.y <= ground) {
    p.y = ground;
    if (p.vy < 0) p.vy = 0;
    p.grounded = true;
    p.coyote = PLAYER.coyoteTicks;
  } else {
    p.grounded = false;
    if (p.coyote > 0) p.coyote--;
  }

  // Keep the player inside the arena even if collision ever lets them squeeze.
  if (p.x < 1) p.x = 1;
  if (p.z < 1) p.z = 1;
  if (p.x > level.width - 1) p.x = level.width - 1;
  if (p.z > level.depth - 1) p.z = level.depth - 1;

  // Aim blend for the camera (§7): 120ms in, same out.
  const aimTarget = p.aiming ? 1 : 0;
  p.aimBlend = approach(p.aimBlend, aimTarget, 1 / CAMERA.aimBlendTicks);
}

export function playerWeaponSystem(w: World): void {
  const p = w.player;
  if (p.fireCooldown > 0) p.fireCooldown--;

  if (p.reloadTicks > 0) {
    p.reloadTicks--;
    if (p.reloadTicks === 0) {
      p.ammo = REVOLVER.magazine;
      w.events.push(EV.reloadEnd);
    }
    return;
  }

  const canAct = w.phase !== PHASE.lost && !p.buildMode;

  if (p.wantReload && p.ammo < REVOLVER.magazine) {
    p.reloadTicks = REVOLVER.reloadTicks;
    w.events.push(EV.reloadStart);
    return;
  }

  if (canAct && p.wantFire) {
    if (p.ammo <= 0) {
      // Dry fire auto-reloads — nobody enjoys being told to press R.
      p.reloadTicks = REVOLVER.reloadTicks;
      w.events.push(EV.reloadStart);
      return;
    }
    if (p.fireCooldown <= 0) {
      p.ammo--;
      p.fireCooldown = REVOLVER.fireCooldownTicks;
      w.shotsFired++;
      hitscan(w);
    }
  }
}
