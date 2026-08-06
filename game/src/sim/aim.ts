/*
 * sim/aim.ts — the camera pose, computed in the SIM.
 *
 * This looks like a render concern and isn't. §7 requires "shots go where the
 * crosshair is, always — no gun-origin parallax", which means the hitscan ray
 * must start at the *camera*, not the gun. If render owned the camera, the sim
 * would have to trust a value from outside itself and determinism would be gone.
 *
 * So the boom is pure maths over sim state (position, yaw, pitch, aim blend)
 * plus a deterministic spring-arm raycast against level geometry. Render calls
 * the same function and gets the same answer, by construction.
 *
 * Note on the §7 "8° down-angle": a fixed downward camera tilt contradicts a
 * centred crosshair. We get the same "the ground reads" result honestly by
 * starting the player's pitch slightly down (see world.ts) and letting the
 * camera look exactly along (yaw, pitch).
 */

import { dcos, dsin, lerp } from "./math.ts";
import { rayLevel } from "./geom.ts";
import { CAMERA } from "./tuning.ts";
import type { World } from "./world.ts";

/** Mutable output so callers never allocate. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  fov: number;
}

export function makePose(): Pose {
  return { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, fov: CAMERA.fov };
}

/** Unit forward for (yaw, pitch), three.js convention: yaw 0 looks down -Z. */
export function forwardX(yaw: number, pitch: number): number {
  return -dsin(yaw) * dcos(pitch);
}
export function forwardY(pitch: number): number {
  return dsin(pitch);
}
export function forwardZ(yaw: number, pitch: number): number {
  return -dcos(yaw) * dcos(pitch);
}

/** Unit right vector on the XZ plane. */
export function rightX(yaw: number): number {
  return dcos(yaw);
}
export function rightZ(yaw: number): number {
  return -dsin(yaw);
}

/**
 * Third-person spring arm (§7). Interpolated by `alpha` so render can sample
 * between ticks; pass alpha = 0 from the sim for the authoritative pose.
 */
export function cameraPose(w: World, alpha: number, out: Pose): Pose {
  const p = w.player;
  const yaw = lerp(p.pyaw, p.yaw, alpha);
  const pitch = lerp(p.ppitch, p.pitch, alpha);
  const px = lerp(p.px, p.x, alpha);
  const py = lerp(p.py, p.y, alpha);
  const pz = lerp(p.pz, p.z, alpha);

  const t = p.aimBlend;
  const boom = lerp(CAMERA.boom, CAMERA.aimBoom, t);
  const shoulder = lerp(CAMERA.shoulder, CAMERA.aimShoulder, t);
  const fov = lerp(CAMERA.fov, CAMERA.aimFov, t);

  const dx = forwardX(yaw, pitch);
  const dy = forwardY(pitch);
  const dz = forwardZ(yaw, pitch);

  // Pivot: above the feet, offset to the shoulder.
  const ox = px + rightX(yaw) * shoulder;
  const oy = py + CAMERA.height;
  const oz = pz + rightZ(yaw) * shoulder;

  // Spring in on geometry so the camera never ends up inside a wall.
  const hit = rayLevel(w.level, ox, oy, oz, -dx, -dy, -dz, boom + 0.3);
  const dist = Math.min(boom, Math.max(0.4, hit - 0.3));

  out.x = ox - dx * dist;
  out.y = oy - dy * dist;
  out.z = oz - dz * dist;
  out.dx = dx;
  out.dy = dy;
  out.dz = dz;
  out.fov = fov;
  return out;
}
