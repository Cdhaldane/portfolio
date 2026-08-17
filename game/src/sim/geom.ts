/*
 * sim/geom.ts — allocation-free geometry queries.
 *
 * Every function here takes scalars and returns a scalar. No vector objects, no
 * temporaries: this is the code that runs hundreds of times per tick (§12.5).
 */

import { BOX, isHazardKind, isSolidKind, type Box, type Level } from "./level.ts";

/**
 * A step whose top is this far above the feet is a wall from the side, not a
 * stair. Chosen against the fattest climber: a Colossus (r 0.8) on a 0.3/0.4
 * flight overlaps treads up to three ahead of its own — a 0.9m top delta — so
 * anything at 1.1m or more can only be a flank being walked into, never a tread
 * being climbed. Shaft Nine's 6m ramp flank is the case this exists for: steps
 * are invisible to `resolveCircle` (they're ridden via `groundHeight`), and
 * without this you could stroll straight through the staircase's side.
 */
const STEP_FLANK = 1.1;

/**
 * Ray vs axis-aligned box (slab method). Returns entry distance, or Infinity.
 * Rays starting inside the box return 0.
 */
export function rayBox(
  b: Box,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  let tmin = 0;
  let tmax = Infinity;

  // X slab
  if (dx !== 0) {
    const inv = 1 / dx;
    let t0 = (b.x0 - ox) * inv;
    let t1 = (b.x1 - ox) * inv;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  } else if (ox < b.x0 || ox > b.x1) return Infinity;

  // Y slab
  if (dy !== 0) {
    const inv = 1 / dy;
    let t0 = (b.y0 - oy) * inv;
    let t1 = (b.y1 - oy) * inv;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  } else if (oy < b.y0 || oy > b.y1) return Infinity;

  // Z slab
  if (dz !== 0) {
    const inv = 1 / dz;
    let t0 = (b.z0 - oz) * inv;
    let t1 = (b.z1 - oz) * inv;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
    }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  } else if (oz < b.z0 || oz > b.z1) return Infinity;

  return tmin;
}

/** Nearest hit distance against all level geometry, or Infinity. */
export function rayLevel(
  level: Level,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  let best = maxT;
  for (let i = 0; i < level.boxes.length; i++) {
    const t = rayBox(level.boxes[i], ox, oy, oz, dx, dy, dz);
    if (t < best) best = t;
  }
  // The floor plane at y = 0.
  if (dy < 0 && oy > 0) {
    const t = -oy / dy;
    if (t < best) best = t;
  }
  return best;
}

/**
 * Ray vs vertical capsule-ish cylinder (infinite-height test clipped to the
 * body span). Returns entry distance, or Infinity. Good enough for hitscan
 * against upright bodies, and far cheaper than a real capsule test.
 */
export function rayCylinder(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const mx = ox - cx;
  const mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a <= 1e-9) return Infinity;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / a;
  if (t < 0) t = (-b + sq) / a;
  if (t < 0) return Infinity;
  const hy = oy + dy * t;
  if (hy < cy || hy > cy + height) return Infinity;
  return t;
}

/** True if the vertical span [y0, y1) overlaps the box's own span. */
export function spansOverlap(b: Box, y0: number, y1: number): boolean {
  return y1 > b.y0 && y0 < b.y1;
}

/**
 * Push a circle of `radius` at (x, z) out of every box it overlaps, along the
 * shallowest axis. Writes into `out` (length 2) to stay allocation-free.
 */
/**
 * Push a circle out of the level's solid geometry.
 *
 * `withBlockades` is what makes the Dead Man's Brace enemies-only: a blockade is
 * real to a body and not to the player, so the two callers pass different answers
 * and there is no branch anywhere else in the game.
 */
export function resolveCircle(
  level: Level,
  x: number,
  z: number,
  radius: number,
  bodyY0: number,
  bodyY1: number,
  out: Float64Array,
  stepUp = 0,
  withBlockades = false,
): void {
  let px = x;
  let pz = z;
  const extra = withBlockades ? level.blockBoxes.length : 0;
  for (let i = 0; i < level.boxes.length + extra; i++) {
    const b =
      i < level.boxes.length ? level.boxes[i] : level.blockBoxes[i - level.boxes.length];
    /*
     * Walkables and decor are not walls.
     *
     * `isSolidKind` is shared with `bakeBlocked` on purpose: when the two
     * disagreed, a 0.9m headstone was invisible to the flow field and solid to the
     * body walking into it — the field said west, collision said no, and the body
     * wedged there forever, softlocking the round. Steps and decks are ridden via
     * `groundHeight`; headstones are scenery.
     *
     * ONE exception, learned on Shaft Nine's 6m haulage ramp: a step whose top is
     * far above the feet is not a stair from where this body stands, it is the
     * staircase's flank, and walking through it reads as clipping through solid
     * geometry. The threshold is high enough that no climber ever meets it on the
     * treads it is actually climbing (see STEP_FLANK) — and anywhere a flank
     * borders a lane, the site must navBlock it so the flow field agrees with
     * collision (shaft.ts does; that agreement is the anti-softlock rule above).
     */
    if (!isSolidKind(b.kind)) {
      if (b.kind !== BOX.step) continue;
      if (b.y1 <= bodyY0 + STEP_FLANK) continue;
      if (!spansOverlap(b, bodyY0, bodyY1)) continue;
    } else
    /*
     * Water stops you, and only while you are on the ground.
     *
     * A hazard is 2cm tall, so the ordinary span test would never see it. Applying it
     * near the ground rather than always is what lets a launched body clear a flooded
     * cut — which makes a Powder Plate across a channel a real thing to build rather
     * than an invisible wall the player cannot reason about.
     */
    if (isHazardKind(b.kind)) {
      if (bodyY0 > 0.5) continue;
    } else if (!spansOverlap(b, bodyY0, bodyY1)) continue;
    // Anything low enough to step onto is not a wall either.
    if (stepUp > 0 && b.y1 <= bodyY0 + stepUp) continue;
    const nx = px < b.x0 ? b.x0 : px > b.x1 ? b.x1 : px;
    const nz = pz < b.z0 ? b.z0 : pz > b.z1 ? b.z1 : pz;
    const dx = px - nx;
    const dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;

    if (d2 > 1e-9) {
      // Outside the box: push straight out along the contact normal.
      const d = Math.sqrt(d2);
      const push = radius - d;
      px += (dx / d) * push;
      pz += (dz / d) * push;
    } else {
      // Centre is inside the box: eject along the shallowest face.
      const left = px - b.x0;
      const right = b.x1 - px;
      const near = pz - b.z0;
      const far = b.z1 - pz;
      const m = Math.min(left, right, near, far);
      if (m === left) px = b.x0 - radius;
      else if (m === right) px = b.x1 + radius;
      else if (m === near) pz = b.z0 - radius;
      else pz = b.z1 + radius;
    }
  }
  out[0] = px;
  out[1] = pz;
}
