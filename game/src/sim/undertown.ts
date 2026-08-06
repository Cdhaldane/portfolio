/*
 * sim/undertown.ts — Map 02, Hollow Creek: Undertown.
 *
 * GALLOWS_HYMN_MAPS.md §5. The flagship, and the one map whose geometry is not
 * constant: six buildings are boarded, and opening one is a purchase that changes
 * the flow field. It lives in its own file because it is roughly as much geometry
 * as the rest of the registry put together, and because `sites.ts` should stay a
 * registry rather than becoming a level editor.
 *
 * **What it invalidates: the finished build.** Every other site is a fixed puzzle.
 * Here the kill box that cleared round 6 is aimed at a wall that has a door in it
 * by round 8 — and you are the one who put the door there.
 *
 * Two things about the layout are load-bearing and easy to undo by accident:
 *
 *  1. **The north alley has no gate and exactly one way in per opened building.**
 *     Seal it and the alley rule (§5) evaporates: the whole point is that one
 *     door is a dead-end pocket the flow field ignores, and the *second* door
 *     turns it into a bypass. If you ever punch a permanent gap through the north
 *     row, the map loses its best mechanic and gains nothing.
 *  2. **The plaza has exactly one mouth** until the player buys more. The Paupers'
 *     Rows run west to the rock and the saloon runs east to it, so there is no
 *     way around either of them. The sump along the south is decor and must never
 *     become a route.
 */

import { BOX, type Box } from "./level.ts";
import { block, deck, pillar, wallRun } from "./kit.ts";
import { UNDERTOWN_AIR } from "./atmosphere.ts";
import { SIDE, SURF, type SurfaceSlot } from "./surfaces.ts";

export const WIDTH = 80;
export const DEPTH = 48;

/** Storey height for everything that fell down here. */
const H = 8;
/** The cavern roof. Ceiling slots mount at this height. */
const ROOF = UNDERTOWN_AIR.roof;

// ── openables ──────────────────────────────────────────────────────────────
// Index order is the wire format: `Level.open` is indexed by these, so appending
// is safe and reordering is not.

export const OPEN = {
  fetch: 0,
  saloon: 1,
  chapel: 2,
  assay: 3,
  jail: 4,
  paupers: 5,
} as const;

export interface OpenableDef {
  key: string;
  name: string;
  cost: number;
  /** One line for the build panel. States the cost, not just the gain (§6). */
  blurb: string;
}

/**
 * Six buildings. 75 / 100 / 150 sits between a trap (30–130) and an upgrade
 * (1.5× base) on purpose: opening one should feel like buying two traps you
 * cannot place yet.
 */
export const UNDERTOWN_OPENABLES: OpenableDef[] = [
  {
    key: "fetch",
    name: "The Fetch & Carry",
    cost: 75,
    blurb: "Freight hoist and fourteen wall faces. Puts a door on the alley.",
  },
  {
    key: "saloon",
    name: "The Long Account",
    cost: 100,
    blurb: "Balcony over the plaza, and a chandelier. Opens a second plaza mouth.",
  },
  {
    key: "chapel",
    name: "Chapel of the Ninth Hour",
    cost: 150,
    blurb: "The bell, free forever after. Puts a door on the alley.",
  },
  {
    key: "assay",
    name: "The Assay Office",
    cost: 100,
    blurb: "A cache of 200 scrap. Its broken window is a door on the alley.",
  },
  {
    key: "jail",
    name: "The Jail",
    cost: 150,
    blurb: "Releases the Debt. It breaks the south wall, and the breach stays.",
  },
  {
    key: "paupers",
    name: "The Paupers' Rows",
    cost: 75,
    blurb: "The densest floor on the map. Opens a slow lane off the west drift.",
  },
];

// ── geometry helpers ───────────────────────────────────────────────────────

/**
 * A horizontal wall along `z`, with an optional doorway centred on `gapAt`.
 *
 * Doorways are 3m: wide enough that the 0.45m agent radius leaves real clearance
 * after `bakeBlocked` inflates the jambs, narrow enough to still read as a door.
 */
function wallX(out: Box[], x0: number, x1: number, z: number, gapAt?: number): void {
  if (gapAt === undefined) {
    wallRun(out, x0, z, x1, z, H);
    return;
  }
  const half = 1.5;
  if (gapAt - half > x0) wallRun(out, x0, z, gapAt - half, z, H);
  if (gapAt + half < x1) wallRun(out, gapAt + half, z, x1, z, H);
}

/** The same, along Z: a vertical wall at `x` with an optional doorway. */
function wallZ(out: Box[], z0: number, z1: number, x: number, gapAt?: number): void {
  if (gapAt === undefined) {
    wallRun(out, x, z0, x, z1, H);
    return;
  }
  const half = 1.5;
  if (gapAt - half > z0) wallRun(out, x, z0, x, gapAt - half, H);
  if (gapAt + half < z1) wallRun(out, x, gapAt + half, x, z1, H);
}

/**
 * Which faces an opened building puts a doorway in, in metres along that face.
 *
 * **Compass, not role.** These were briefly named `street` and `alley`, which is
 * how the south row ended up with its front door in the back wall: Main Street is
 * the *south* face of the north row and the *north* face of the south row, so a
 * role name is inverted for half the map. Compass directions cannot be.
 *
 * Which faces a building opens is the entire cost of opening it, so these four
 * lines are the most load-bearing in the file.
 */
interface Doors {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
}

/** A building: one solid mass while boarded, a shell with doorways once opened. */
function building(
  out: Box[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  opened: boolean,
  doors: Doors = {},
): void {
  if (!opened) {
    block(out, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, H);
    return;
  }
  wallX(out, x0, x1, z0, doors.north);
  wallX(out, x0, x1, z1, doors.south);
  wallZ(out, z0, z1, x0, doors.west);
  wallZ(out, z0, z1, x1, doors.east);
}

/** Solid party wall / untouched strata between two buildings. */
function mass(out: Box[], x0: number, z0: number, x1: number, z1: number): void {
  block(out, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, H);
}

/**
 * The Fall: the rubble cone under the breach.
 *
 * Concentric decks, each ring 0.3m higher over a 1m run. The rise is the whole
 * constraint — it has to stay under `PLAYER.stepOffset` (0.35), which is exactly
 * what made Boot Hill's first staircase decorative when it was authored at 0.45.
 *
 * Decks rather than blocks because `isSolidKind` exempts them: a 4m mound with a
 * *gate on top of it* has to be a ramp, not an obstacle, or `bakeBlocked` walls
 * off G3 and the bodies standing on it can never path down. Passing `thickness =
 * top` grounds each ring at y0 = 0, so the mesher draws a mound instead of a
 * stack of floating slabs.
 */
function fallCone(out: Box[]): void {
  const rings = 13;
  for (let i = 0; i < rings; i++) {
    const top = 0.3 * (i + 1);
    const size = 14 - i;
    deck(out, 71, 37, size, size, top, top);
  }
}

// ── the map ────────────────────────────────────────────────────────────────

export function buildUndertown(open: readonly boolean[] = []): Box[] {
  const b: Box[] = [];
  const is = (i: number): boolean => open[i] === true;

  // Living rock, all the way round. Not a fence — there is no outside.
  wallRun(b, 0, 0, WIDTH, 0, ROOF);
  wallRun(b, 0, DEPTH, WIDTH, DEPTH, ROOF);
  wallRun(b, 0, 0, 0, DEPTH, ROOF);
  wallRun(b, WIDTH, 0, WIDTH, DEPTH, ROOF);

  // ── the north row, z 6–18 ────────────────────────────────────────────────
  // Continuous from rock to rock. The gaps between buildings are party walls,
  // which is both what a frontier street looks like and what keeps the alley
  // sealed until somebody pays to open it.
  // South face (z=18) is Main Street; north face (z=6) is the alley.
  mass(b, 2, 6, 4, 18);
  building(b, 4, 6, 18, 18, is(OPEN.chapel), { south: 10, north: 10 });
  mass(b, 18, 6, 22, 18);
  building(b, 22, 6, 34, 18, is(OPEN.assay), { south: 28, north: 28 });
  // The rib: untouched strata the town was built around. Never opens.
  mass(b, 34, 6, 46, 18);
  // No alley door. It is a jail.
  building(b, 46, 6, 60, 18, is(OPEN.jail), { south: 52 });
  mass(b, 60, 6, 64, 18);
  building(b, 64, 6, 76, 18, is(OPEN.fetch), { south: 70, north: 70 });
  mass(b, 76, 6, 78, 18);

  // ── the street, z 18–30 ──────────────────────────────────────────────────
  // Boardwalks are 0.30m and buildable; the plaza mouth (x 26–46) has none.
  deck(b, 40, 19, 76, 2, 0.3);
  deck(b, 14, 29, 24, 2, 0.3);
  deck(b, 62, 29, 32, 2, 0.3);

  // Awning posts flank the lane and never block it.
  for (const x of [8, 28, 48, 68]) pillar(b, x, 22);
  // A wagon and a trough. Props: they break sight and block nothing.
  block(b, 14, 26, 2.6, 1.2, 0.9, BOX.prop);
  block(b, 50, 26, 2.6, 1.2, 0.9, BOX.prop);

  // ── the south row, z 30–46 ───────────────────────────────────────────────
  // Paupers run west to the rock and the saloon runs east to it, so the plaza
  // has exactly one mouth — the 20m gap between them — until the player buys
  // another.
  //
  // **The plaza-facing doors are the whole mechanic.** Opening the Rows puts a
  // door in their east flank and the saloon puts one in its west flank, and each
  // is a genuine second and third way into the plaza that shortens a gate's path.
  // Without them the Boarding is cosmetic: the flow field is pure shortest-path,
  // so a building that only opens onto the street it already fronts changes
  // nothing a body would ever choose to do.
  // Here the *north* face (z=30) is the street and the plaza flank is the door
  // that matters.
  building(b, 2, 30, 26, 46, is(OPEN.paupers), { north: 14, east: 40 });
  building(b, 46, 30, 64, 46, is(OPEN.saloon), { north: 54, west: 40 });

  /*
   * The throat: two wings that neck the plaza mouth down from 20m to 8m.
   *
   * Without them the map's whole mechanic is inert, and the probe said so — every
   * gate measured 39.1 / 47.1 / 45.0m boarded and *exactly the same* with every
   * combination of buildings open. A 20m mouth sitting directly on the route
   * cannot be beaten by any alternative, so opening a building changed nothing a
   * body would ever choose to do.
   *
   * Necked to 8m and set 6m deep, the throat is finally worth going around, and
   * the plaza-flank doors become real. Note what that means: with one
   * shortest-path field there is no such thing as *splitting* the crowd — a
   * cheaper route does not add a lane, it **moves** the lane. Your kill box is
   * not overwhelmed, it is bypassed, which is a good deal harsher and is exactly
   * what "invalidates the finished build" should feel like.
   */
  mass(b, 26, 30, 32, 36);
  mass(b, 40, 30, 46, 36);

  /*
   * Stacked coffins, once the Rows are open: the densest floor on the map.
   *
   * The pitch is 6m against a 2.4m stack, and it has to stay that way. At 4m the
   * aisles were 1.6m of clear floor, `bakeBlocked` inflated each stack by the
   * 0.45m agent radius from both sides, and the rows fused into one solid mass —
   * the interior became unreachable and opening the Rows did nothing at all. 6m
   * leaves two clear cells between stacks.
   */
  if (is(OPEN.paupers)) {
    for (let x = 6; x <= 22; x += 6) {
      for (let z = 36; z <= 44; z += 6) block(b, x, z, 2.4, 2.4, 1.6);
    }
  }
  // The saloon's balcony: a deck you can walk under, which is the whole reason
  // `groundHeight` had to learn about `y0`.
  if (is(OPEN.saloon)) deck(b, 55, 33, 16, 4, 3.5, 0.3);

  fallCone(b);

  // The gallows frame — the pit-head headframe that came down with the town.
  // Its four legs are what break every sightline into the well, so they are the
  // one piece of geometry on this map that has to be exactly where it is. They
  // sit 5.7m out, clear of the 4m safe build ring.
  for (const [x, z] of [[32, 36], [40, 36], [32, 44], [40, 44]]) {
    pillar(b, x, z, 1.0, H);
  }

  return b;
}

// ── surfaces ───────────────────────────────────────────────────────────────

/**
 * Authored mount points (§7.1). Slots are never inferred from geometry: the raw
 * boxes here offer several hundred wall faces, and the map claims about thirty.
 *
 * Ceilings are the reason this map exists. There is rock at 12m over open street,
 * so Chandelier Drop, Rain of Nails, Buzzard Roost and Church Bell all work
 * outdoors here and nowhere else — and a Buzzard cruising at 4.6m is finally
 * inside somebody's reach.
 */
function undertownSlots(): SurfaceSlot[] {
  const s: SurfaceSlot[] = [];

  // Ceiling: the timber sets bracing the roof over Main Street, then the plaza.
  for (let x = 8; x <= 72; x += 8) s.push({ surface: SURF.ceiling, x, z: 24, y: ROOF });
  for (const [x, z] of [[30, 34], [42, 34], [30, 42], [42, 42], [36, 31]]) {
    s.push({ surface: SURF.ceiling, x, z, y: ROOF });
  }

  // Wall: the north row's street face, and the south row's street face.
  for (let x = 6; x <= 74; x += 6) {
    s.push({ surface: SURF.wall, x, z: 18, y: 1.4, side: SIDE.south });
  }
  for (const x of [6, 12, 18, 24, 50, 56, 62]) {
    s.push({ surface: SURF.wall, x, z: 30, y: 1.4, side: SIDE.north });
  }
  // The plaza's two flanks — the best wall real estate on the map, because the
  // crowd has to walk between them to reach the well.
  for (const z of [34, 40]) {
    s.push({ surface: SURF.wall, x: 26, z, y: 1.4, side: SIDE.east });
    s.push({ surface: SURF.wall, x: 46, z, y: 1.4, side: SIDE.west });
  }

  // Sigil: chalk. Five faded marks (§5) plus four clean patches in the plaza.
  for (const [x, z] of [[6, 19], [32, 19], [20, 29], [60, 29], [37, 33]]) {
    s.push({ surface: SURF.sigil, x, z, y: 0 });
  }
  for (const [x, z] of [[30, 38], [42, 38], [36, 43], [71, 37]]) {
    s.push({ surface: SURF.sigil, x, z, y: 0 });
  }

  return s;
}

export const UNDERTOWN_SURFACES: SurfaceSlot[] = undertownSlots();

// ── env slots ──────────────────────────────────────────────────────────────

export interface EnvSlotDef {
  key: string;
  name: string;
  x: number;
  z: number;
  /** Only usable once the building holding it is open. */
  requiresOpen?: number;
  /** Free the first time; this many salt to reset (§4). */
  resetSalt: number;
}

export const UNDERTOWN_ENV: EnvSlotDef[] = [
  { key: "hoist", name: "Freight hoist", x: 70, z: 12, requiresOpen: OPEN.fetch, resetSalt: 15 },
  { key: "chandelier", name: "Chandelier", x: 54, z: 34, requiresOpen: OPEN.saloon, resetSalt: 15 },
  { key: "bell", name: "The bell", x: 10, z: 12, requiresOpen: OPEN.chapel, resetSalt: 15 },
  { key: "well", name: "The winding gear", x: 36, z: 31, resetSalt: 20 },
];
