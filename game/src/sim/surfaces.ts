/*
 * sim/surfaces.ts — where a trap may mount.
 *
 * Engine work item 5 from GALLOWS_HYMN_MAPS.md §9. Until now `isPlaceable`
 * returned one boolean and every trap was a floor trap, so §6's requirement that
 * "placement is validated against surface tags" had nothing to validate against,
 * and the surface census in §3 described surfaces nothing could use.
 *
 * **Slots are authored, never inferred.** MAPS §3 is explicit: a wall face a trap
 * can mount on is a design decision, not something you can read off a box — "a
 * crypt has three usable faces, not six". Boot Hill's census claims three wall
 * faces where its raw geometry has about forty, and that gap is the whole point:
 * the map decides where iron can be bolted, and the census is *derived from the
 * slots* so the two can never disagree.
 *
 * That also answers "put a grid on the walls": a uniform wall grid would imply
 * every face is mountable, which is exactly the claim the census exists to deny.
 * The player sees chalk marks at the real mount points instead.
 */

export const SURF = {
  floor: 0,
  wall: 1,
  ceiling: 2,
  /** Chalk: only arcane traps may be traced here. */
  sigil: 3,
  /** Map 05: arcane placements only, over a whole region. */
  unhallowed: 4,
} as const;

export type SurfaceClass = (typeof SURF)[keyof typeof SURF];

/** Which way a wall-mounted trap faces. Its effects fire along this normal. */
export const SIDE = {
  north: 0, // −Z
  east: 1, // +X
  south: 2, // +Z
  west: 3, // −X
} as const;

export type Side = (typeof SIDE)[keyof typeof SIDE];

export function sideNormalX(side: number): number {
  return side === SIDE.east ? 1 : side === SIDE.west ? -1 : 0;
}

export function sideNormalZ(side: number): number {
  return side === SIDE.south ? 1 : side === SIDE.north ? -1 : 0;
}

/** Yaw such that a mesh's −Z points along the slot normal (matches sim/aim.ts). */
export function sideYaw(side: number): number {
  switch (side) {
    case SIDE.east:
      return -Math.PI / 2;
    case SIDE.south:
      return Math.PI;
    case SIDE.west:
      return Math.PI / 2;
    default:
      return 0;
  }
}

/**
 * One authored mount point, in metres.
 *
 * Walls and ceilings carry a real height; sigils sit on the floor. Positions are
 * metres rather than cells so a site can be authored against its plan view
 * without knowing the grid width.
 */
export interface SurfaceSlot {
  surface: SurfaceClass;
  x: number;
  z: number;
  /** Mount height. Walls ~1.4m, ceilings whatever the roof is, sigils 0. */
  y: number;
  /** Walls only: which way it faces. */
  side?: Side;
}

/** How close the crosshair has to be to a slot for it to snap. */
export const SNAP_RANGE: Record<number, number> = {
  [SURF.wall]: 2.2,
  [SURF.ceiling]: 3.4,
  [SURF.sigil]: 1.8,
  [SURF.unhallowed]: 1.2,
  [SURF.floor]: 0,
};

/**
 * Nearest free slot of `surface` to a point, or -1.
 *
 * Snapping to authored slots rather than free-placing is deliberate: it makes wall
 * and ceiling placement forgiving with a third-person camera (you are aiming from
 * 3.4m behind your own shoulder), and it keeps the census honest, since a slot can
 * only be used once.
 */
export function nearestSlot(
  slots: SurfaceSlot[],
  surface: SurfaceClass,
  x: number,
  z: number,
  taken: (index: number) => boolean,
): number {
  const range = SNAP_RANGE[surface] ?? 2;
  let best = -1;
  let bestD2 = range * range;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.surface !== surface) continue;
    if (taken(i)) continue;
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    // Ties break on index so placement is deterministic (§13 rule 4).
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * The mount the player is looking at, or -1.
 *
 * Floor placement can raycast the ground plane, but a wall face has no ground
 * plane and a roof beam is 4m over your head, so mounts are picked by *aim
 * proximity*: the slot closest to the aim ray wins, inside a cone that widens with
 * distance. Aiming near a mount is enough.
 *
 * That forgiveness is not a shortcut, it is the requirement. The camera sits 3.4m
 * behind the player's shoulder, so the crosshair and the hand are never in the
 * same place; demanding a pixel-accurate hit on a 40cm bracket across the map would
 * make wall traps miserable to place. Verified the hard way in M0.9, where a
 * ~3m crosshair drift made the upgrade panel look broken.
 */
export function slotNearRay(
  slots: SurfaceSlot[],
  surface: SurfaceClass,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  taken: (index: number) => boolean,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.surface !== surface) continue;
    if (taken(i)) continue;
    const vx = s.x - ox;
    const vy = s.y - oy;
    const vz = s.z - oz;
    // How far along the ray the mount sits. Behind you, or across the map, is not
    // something you are aiming at.
    const t = vx * dx + vy * dy + vz * dz;
    if (t < 0.5 || t > 34) continue;
    // Perpendicular miss distance.
    const px = vx - dx * t;
    const py = vy - dy * t;
    const pz = vz - dz * t;
    const off2 = px * px + py * py + pz * pz;
    // A cone, not a cylinder: 0.9m of slack up close, ~3m at the far wall. A fixed
    // radius either fights you at range or snaps between neighbours up close.
    const tol = 0.9 + t * 0.07;
    if (off2 > tol * tol) continue;
    // Nearest to the line wins, then nearest to the player. Both are total orders,
    // so the pick never depends on array order (§13 rule 4).
    const score = off2 * 1000 + t;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export interface SurfaceCensus {
  floor: number;
  wall: number;
  /** Wall tiles the map refuses. Painted differently, and counted separately. */
  noBuildWall: number;
  ceiling: number;
  sigil: number;
  unhallowed: number;
  env: number;
}

/**
 * Count the slots. The census is derived, never hand-written — a hand-counted
 * census is a comment that can silently stop being true, and the director makes
 * roster decisions from it.
 */
export function censusOf(slots: SurfaceSlot[], floor: number, env: number): SurfaceCensus {
  let wall = 0;
  let ceiling = 0;
  let sigil = 0;
  let unhallowed = 0;
  for (const s of slots) {
    if (s.surface === SURF.wall) wall++;
    else if (s.surface === SURF.ceiling) ceiling++;
    else if (s.surface === SURF.sigil) sigil++;
    else if (s.surface === SURF.unhallowed) unhallowed++;
  }
  return { floor, wall, noBuildWall: 0, ceiling, sigil, unhallowed, env };
}
