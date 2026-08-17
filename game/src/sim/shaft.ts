/*
 * sim/shaft.ts — Map 03, Shaft Nine, The Deepings.
 *
 * 64 × 48 across three levels · 3 gates and one from above · rounds 8–18.
 *
 * **What it invalidates: the flat build.** Every map so far has been a plan view. This
 * one has a Y axis and the crowd uses it.
 *
 * ## The heights are shifted, and it matters that they are not the doc's
 *
 * MAPS §6 draws the gallery at 0m, the stope at −6m and the catwalks at +5m. The engine
 * cannot: `groundHeight` starts at 0 and returns the highest box top at or below the
 * query, so **0 is the floor of the world** and nothing can be below it. The whole map
 * is therefore lifted 6m — stope 0, gallery +6, catwalks +11 — which preserves every
 * relative height the design depends on (the 6m drop down a chute, the 5m of catwalk
 * above the rail) and changes nothing a player could perceive.
 *
 * ## It is 2.5D, but it is planar for pathing
 *
 * The gallery and the stope are at different heights and do **not overlap in plan** —
 * the gallery runs z 6–30, the stope z 30–46, joined by the haulage ramp. So a single
 * 2D flow field is not an approximation here, it is exact, and MAPS §6's "accept that
 * the chutes are non-navigable and only the ramp joins the graph" is satisfied by the
 * geometry rather than by a special case.
 *
 * The catwalks *do* overlap the gallery, and they are the exception that proves it:
 * they are the player's, enemies never path onto them, and `groundHeight`'s `maxY`
 * already stops a body under one from snapping to its top.
 *
 * ## The chutes are the signature verb
 *
 * Three one-way drops in the wall between gallery and stope. They are `navBlock`
 * regions, not geometry: the field refuses to route through them, and nothing stops a
 * body the player *boots* through one from falling 6m onto whatever is built below.
 * Chute + Boot is the map's verb, and it only works because the hole is a hole to
 * physics and a wall to pathing.
 */

import { BOX, type Box } from "./level.ts";
import { block, deck, hazard, pillar, slab, stepsZ, wall } from "./kit.ts";
import type { EnvSlotDef } from "./env.ts";
import { SURF, type SurfaceSlot } from "./surfaces.ts";
import { SKY, type Atmosphere } from "./atmosphere.ts";

export const WIDTH = 64;
export const DEPTH = 48;

/** Stope floor. The base of the world, and of `groundHeight`. */
export const STOPE = 0;
/** The main gallery, 6m above the stope — the drop a chute is worth. */
export const GALLERY = 6;
/** The player's catwalk, 5m above the gallery. */
export const CATWALK = 11;

/** Where the gallery ends and the stope begins. */
const LIP = 30;
/** The haulage ramp: x 6–14, descending south over 8m of plan. */
const RAMP_X0 = 6;
const RAMP_X1 = 14;

/** The three ore chutes, as gaps in the lip. One-way, player tech only. */
export const CHUTES: [number, number][] = [
  [20, 22],
  [28, 30],
  [34, 36],
];

export function buildShaft(): Box[] {
  const b: Box[] = [];
  // Tall enough to contain both levels: a 4m wall would sit below the gallery floor.
  const H = 16;

  // ── perimeter ────────────────────────────────────────────────────────────
  // North rock, 6m of it, with the North Drift (G2) cut through at z 6–12.
  slab(b, 0, 0, WIDTH, 6, H);
  wall(b, 0, 0, 0, 6, H);
  wall(b, 0, 12, 0, DEPTH, H);
  wall(b, 62, 0, 62, 22, H);
  wall(b, 62, 26, 62, 40, H);
  wall(b, 62, 44, 62, DEPTH, H);
  wall(b, 0, 46, WIDTH, 46, H);

  /*
   * The rib at z=14, with two winzes through it.
   *
   * This is what makes G2's path a *different problem* to G1's: the North Drift
   * arrives above the rib and has to find a winze before it can turn for the ramp.
   */
  /* The winzes are 4m, not 2m. `bakeBlocked` inflates every wall by the agent radius
     and marks whole cells, so a 2m gap loses a cell to each side and seals outright —
     the same arithmetic that closed Boot Hill's orchard gap (§21.7). 4m survives it
     with a cell to spare, and a winze a body cannot fit through is a gate that cannot
     reach the Rift. */
  wall(b, 0, 14, 10, 14, H);
  wall(b, 14, 14, 46, 14, H);
  wall(b, 50, 14, WIDTH, 14, H);

  // ── the gallery, +6 ──────────────────────────────────────────────────────
  // One deck from the rock face to the lip. Buildable: this is where the fight is.
  deck(b, WIDTH / 2, 18, WIDTH - 4, 24, GALLERY, GALLERY);

  /*
   * The lip at z=30, with the ramp mouth and three chutes cut out of it.
   *
   * Solid, so nothing walks off the gallery by accident — falling off is something
   * the player *does to* a body, not something that happens.
   */
  const lipRuns: [number, number][] = [];
  let cursor = RAMP_X1;
  for (const [c0, c1] of CHUTES) {
    lipRuns.push([cursor, c0]);
    cursor = c1;
  }
  lipRuns.push([cursor, WIDTH]);
  for (const [x0, x1] of lipRuns) {
    // A tile deep, on the grid: the lip is architecture, not a kerb.
    if (x1 - x0 > 0.05) slab(b, x0, LIP, x1, LIP + 2, GALLERY + 1.2);
  }

  // ── the haulage ramp ─────────────────────────────────────────────────────
  // 20 treads of 0.3 over 8m of run: the rise stays under PLAYER.stepOffset (0.35),
  // which is the whole reason Boot Hill's first staircase was unclimbable (§21.7).
  stepsZ(b, (RAMP_X0 + RAMP_X1) / 2, LIP + 8, 20, 0.3, 0.4, RAMP_X1 - RAMP_X0, -1);

  // ── the stope, 0 ─────────────────────────────────────────────────────────
  // Rock either side of the open floor, and the Lower Drift (G3) running east at z 40–44.
  slab(b, 0, 30, 6, 46, H);
  slab(b, 36, 30, 64, 40, H);
  slab(b, 36, 44, 64, 46, H);

  /*
   * The sump: the bottom of the cut, flooded.
   *
   * Water is what a stope at the bottom of a mine actually has in it, and mechanically
   * it is the map's second shape — it narrows the stope floor without adding a wall,
   * and it sits directly under the western chutes, so a body Booted down one lands in
   * it rather than on open ground.
   */
  hazard(b, 6, 42, 18, 46);

  // ── timber sets ──────────────────────────────────────────────────────────
  // Six on the gallery. They carry the roof, the lantern pools and the ceiling mounts.
  for (const z of [20, 28]) {
    for (const x of [16, 32, 48]) pillar(b, x, z, 0.8, GALLERY + 5);
  }

  // ── the catwalks, +11 ────────────────────────────────────────────────────
  // Yours. Boot Hill gave you a 1.35m plinth; here you own the high ground the length
  // of the gallery, with the rail line directly beneath it.
  deck(b, WIDTH / 2, 24, WIDTH - 8, 3, CATWALK);
  /*
   * Flights up to the catwalk, against the rib. Two authoring facts matter:
   *
   *  - They START FROM THE GALLERY (`base`). Authored against 0 they topped out
   *    at 5.1m — a metre short of the floor they stand on — so the catwalk was
   *    unreachable and seventeen phantom treads floated in the void under the
   *    deck. 17 × 0.3 lands at +11.1, a 10cm step down onto the catwalk.
   *  - The west flight is at x=8, not x=10: the G2 winze exits at x 10–14, and a
   *    flight parked in that mouth (plus its navBlock, below) pinched the north
   *    lane to a single cell.
   *  - The run is 0.4, not 0.45: the catwalk plan starts at z 22.5, and a longer
   *    flight met it mid-climb with a 0.5m riser onto the deck — exactly the
   *    off-by-a-comparison step the deck helper's 0.30/0.35 note warns about.
   *    At 0.4 the treads reach +10.8 before the deck begins, a 0.2m step up.
   */
  stepsZ(b, 8, 16, 17, 0.3, 0.4, 2.4, 1, GALLERY);
  stepsZ(b, 54, 16, 17, 0.3, 0.4, 2.4, 1, GALLERY);

  // The rail line: sleepers along z=24, scenery that says where the carts run.
  for (let x = 4; x < WIDTH - 4; x += 2.5) {
    block(b, x, 24, 1.6, 0.3, GALLERY + 0.12, BOX.prop);
  }

  return b;
}

/**
 * The chutes, as regions the field refuses.
 *
 * A little deeper than the lip so a body cannot path around the block by clipping its
 * northern edge, and no wider, so the player's boot still finds the hole.
 */
export const SHAFT_NAVBLOCK = [
  ...CHUTES.map(([x0, x1]) => ({
    x0,
    z0: LIP,
    x1,
    z1: LIP + 2,
  })),
  /*
   * The catwalk flights. Same contract as the chutes — a hole to physics, a wall
   * to pathing — but pointing the other way: the player climbs them, and the
   * field must never send a body up them. Treads rise 0.3 and `groundHeight`
   * does not care whose feet are on it; without these blocks the crowd would
   * ride the west flight straight onto the catwalk, which is yours by design.
   */
  { x0: 6.8, z0: 16, x1: 9.2, z1: 22.9 },
  { x0: 52.8, z0: 16, x1: 55.2, z1: 22.9 },
  /*
   * The haulage ramp's exposed east flank. The treads beside the lip stand 6m
   * tall, and collision now treats a flank that tall as a wall (sim/geom.ts) —
   * so the field has to agree, or it would steer bodies hugging the shortest
   * path straight into it and pin them there. The west flank borders rock and
   * needs nothing.
   */
  { x0: RAMP_X1, z0: LIP, x1: RAMP_X1 + 1.5, z1: LIP + 8 },
];

/**
 * Two mine carts on the rail line (MAPS §6).
 *
 * §6 specifies "200 damage to everything on the track plus a launch" — a *line* the
 * full 60m of the gallery. `sim/env.ts` fires a radius, so these are the generic
 * one-shot for now and the line shape is deferred; the cart is claimed from the
 * catalog rather than invented, so the shape is the only thing outstanding.
 */
export const SHAFT_ENV: EnvSlotDef[] = [
  // On the rail, not above it — see `EnvSlotDef.y`. The catwalk 5m overhead is what
  // makes the default hoist height wrong here.
  { key: "cart-e", name: "The east cart", x: 46, z: 24, y: GALLERY + 0.7, resetSalt: 15 },
  { key: "cart-w", name: "The west cart", x: 18, z: 24, y: GALLERY + 0.7, resetSalt: 15 },
];

/**
 * Ceiling anchors on the timber sets, and chalk on the stope floor.
 *
 * §6 promises 22 ceiling cells and 30 wall faces, which is what makes this "the first
 * map where the Rattler is legal under the new census constraint". Wall faces are
 * derived from the geometry now (`sim/wallgrid.ts`) and this map has plenty; the
 * ceilings are the authored half.
 */
export const SHAFT_SURFACES: SurfaceSlot[] = [
  ...[20, 28].flatMap((z) =>
    [16, 32, 48].map((x) => ({ surface: SURF.ceiling, x, z, y: GALLERY + 4.4 })),
  ),
  // Over the rail, between the sets — where a cart's victims end up.
  ...[10, 24, 40, 54].map((x) => ({ surface: SURF.ceiling, x, z: 24, y: GALLERY + 4.4 })),
  // The stope is where the Company chalked before they stopped coming down.
  { surface: SURF.sigil, x: 22, z: 36, y: STOPE },
  { surface: SURF.sigil, x: 30, z: 34, y: STOPE },
  { surface: SURF.sigil, x: 20, z: 42, y: STOPE },
  { surface: SURF.sigil, x: 30, z: 42, y: STOPE },
];

/**
 * Darkness as a mechanic, not a mood (MAPS §6).
 *
 * Fog 8–30 and **no directional light at all** — the hemisphere carries the whole
 * image, and everything else is lantern pools and whatever the player brings. This is
 * the site where the Hex Lantern stops being an amplifier and becomes vision.
 *
 * §6's own warning is that darkness plus forty bodies may simply be unreadable, and
 * that if it fails the fix is lantern density rather than fog distance — moving the fog
 * changes the feel of the entire kit. It failed exactly that way on the first pass —
 * the mid-gallery was a black wall at 15m — so the fix is exactly that: the lantern
 * pools the timber sets were always described as carrying now exist (`lamps`), the
 * stope gets two standing lamps by the sigil ground, and the bounce comes up to the
 * open-air figure. The fog stays where the design put it.
 */
export const SHAFT_AIR: Atmosphere = {
  sky: SKY.cavern,
  roof: GALLERY + 5,
  fogNear: 8,
  fogFar: 30,
  moon: 0,
  hemi: 0.62,
  lamps: [
    // One per timber set, hung on the south face of each post, over the rail lane.
    ...[20, 28].flatMap((z) =>
      [16, 32, 48].map((x) => ({ x, y: GALLERY + 3.1, z: z + 0.95 })),
    ),
    // The stope: two standing lamps where the Company chalked their circles.
    { x: 26, y: 3.1, z: 35, post: true },
    { x: 24, y: 3.1, z: 41.4, post: true },
  ],
};
