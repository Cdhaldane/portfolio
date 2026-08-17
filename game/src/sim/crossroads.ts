/*
 * sim/crossroads.ts — Map 04, The Crossroads, Hanging Day.
 *
 * 56 × 56 · 4 gates · the map with **no chokepoint anywhere**, on purpose.
 *
 * `GALLOWS_HYMN_MAPS.md` §7 calls this "the highest-risk design in the document" and
 * §13 open question 1 says to prototype it before anything is drawn — which is why it
 * exists now, in grey-box, ahead of Map 03 and the chunk cut. §11 forbids the
 * *generator* from ever producing a pinchless site and is right to: a random map with
 * no pinch is a random map with no answer. An authored one may, "provided it pays for
 * it", and the three payments are all geometry in this file:
 *
 *  1. **It is small.** The Rift is at most 28m from any point of the perimeter, so
 *     the player can genuinely be everywhere.
 *  2. **Four road-mouth gibbets**, 20m out along each road — an environmental answer
 *     built into every approach before the player spends a coin.
 *  3. **The salt ring**, already drawn, free from wave 1.
 *
 * ## The two pieces that must be exactly where they are
 *
 * **The scaffold.** Four roads pointing at the centre is four gates with a clean shot
 * at the Rift, which breaks G2 and makes §8's Deadeye constraint unsatisfiable — there
 * would be no legal Deadeye gate anywhere on the map. Four uprights and a plank skirt
 * break the eye line from road level in all four directions.
 *
 * **The skirt is scenery, not a wall.** It breaks sight and blocks *nothing*, because
 * §7 requires "the ground itself completely open to walk across". A 1.1m solid ring
 * around the Rift would seal the flow field's only source and every cell on the map
 * would go unreachable — the M0 softlock (§21.1 note 3), rebuilt deliberately. `BOX.prop`
 * is exempt from `isSolidKind`, so it is invisible to pathing and to collision while
 * still occluding.
 *
 * The Rift sits at grade under the trapdoor, **not** on a deck: a deck needs stairs,
 * and stairs would be a chokepoint.
 */

import { BOX, type Box } from "./level.ts";
import { block, hazard, pillar, slab, wall } from "./kit.ts";
import type { EnvSlotDef } from "./env.ts";
import { SURF, type SurfaceSlot } from "./surfaces.ts";

export const WIDTH = 56;
export const DEPTH = 56;

/** Dead centre. The Rift, the scaffold and the salt ring all key off it. */
const C = 28;
/** Where the roads pierce the perimeter. 4m wide — a road, not a door. */
const GATE_HALF = 2;
/** Gibbets sit 20m out along each road (§7). */
const GIBBET = 20;
/** The salt ring's radius, and where the roads cross it. */
export const SALT_RADIUS = 12;

/** A perimeter wall with a gap in the middle for the road. */
function roadWall(out: Box[], along: "x" | "z", at: number): void {
  // Snapped inward at the far edge so the wall sits INSIDE the map rather than
  // straddling its boundary — a tile-thick wall at x = 56 would be outside it.
  const far = at >= WIDTH ? at - 2 : at;
  if (along === "x") {
    wall(out, 0, far, C - GATE_HALF, far);
    wall(out, C + GATE_HALF, far, WIDTH, far);
  } else {
    wall(out, far, 0, far, C - GATE_HALF);
    wall(out, far, C + GATE_HALF, far, DEPTH);
  }
}

export function buildCrossroads(): Box[] {
  const b: Box[] = [];

  // Perimeter, pierced by four roads.
  roadWall(b, "x", 0);
  roadWall(b, "x", DEPTH);
  roadWall(b, "z", 0);
  roadWall(b, "z", WIDTH);

  /*
   * The four corner holdings, and they are four different *kinds* of obstacle
   * rather than four buildings — which is most of what stops a 56m square of open
   * ground reading as a car park.
   */
  // NW: the well house, and SW: the windmill. Solid 8m masses.
  slab(b, 8, 4, 20, 12, 8);
  slab(b, 8, 46, 20, 54, 8);
  // NE: the wagon yard. Crates at 1.2m — block pathing, break sight.
  slab(b, 36, 4, 48, 12, 1.2);
  // SE: the grave plot. Headstones at 0.9m — block nothing, break sight.
  for (let i = 0; i < 12; i++) {
    const x = 37 + (i % 4) * 3.2;
    const z = 47.5 + Math.floor(i / 4) * 2.6;
    block(b, x, z, 0.6, 0.3, 0.9, BOX.prop);
  }

  /*
   * The scaffold. The one piece of geometry on this map that has to be exactly here.
   */
  pillar(b, C - 2, C - 2, 0.6, 4);
  pillar(b, C + 2, C - 2, 0.6, 4);
  pillar(b, C - 2, C + 2, 0.6, 4);
  pillar(b, C + 2, C + 2, 0.6, 4);
  // The plank skirt: 1.1m, sight-breaking, and walkable *through* (see the note above).
  for (const [x, z, sx, sz] of [
    [C, C - 2.4, 5.2, 0.25],
    [C, C + 2.4, 5.2, 0.25],
    [C - 2.4, C, 0.25, 5.2],
    [C + 2.4, C, 0.25, 5.2],
  ]) {
    block(b, x, z, sx, sz, 1.1, BOX.prop);
  }

  /* Salt barrels marking where each road crosses the ring. Scenery that happens to
     be a rule — except the rule is not implemented yet (see SALT_CROSSINGS). */
  for (const [x, z] of saltCrossings()) block(b, x, z, 0.8, 0.8, 0.9, BOX.prop);

  /*
   * The horse trough, flooded, on the NE diagonal.
   *
   * Two tiles of water is not a defence on a 56m map — it is a *shape*. The whole
   * argument of the Crossroads is that there is no chokepoint to hold, and a hazard
   * gives the player one edge to anchor a build against without giving them a lane.
   */
  hazard(b, 34, 16, 40, 20);

  return b;
}

/** Where the four roads cross the salt ring, 12m out from the scaffold. */
export function saltCrossings(): [number, number][] {
  return [
    [C, C - SALT_RADIUS],
    [C, C + SALT_RADIUS],
    [C - SALT_RADIUS, C],
    [C + SALT_RADIUS, C],
  ];
}

/**
 * Four gibbets, one at each road mouth.
 *
 * §7 specifies these as Coffin Hatches — instant kill on one non-boss body, free once,
 * 15 salt to reset — and notes they must award **no scrap and no Tally**, because four
 * free instant kills a wave is otherwise a real economy leak. They are the generic
 * environmental one-shot for now (`sim/env.ts`), which damages rather than executes;
 * the distinction only starts to matter when something survives 240 damage.
 */
export const CROSSROADS_ENV: EnvSlotDef[] = [
  { key: "gibbet-n", name: "The north gibbet", x: C, z: C - GIBBET, resetSalt: 15 },
  { key: "gibbet-s", name: "The south gibbet", x: C, z: C + GIBBET, resetSalt: 15 },
  { key: "gibbet-w", name: "The west gibbet", x: C - GIBBET, z: C, resetSalt: 15 },
  { key: "gibbet-e", name: "The east gibbet", x: C + GIBBET, z: C, resetSalt: 15 },
];

/**
 * One ceiling anchor: the scaffold crossbeam, spanning the uprights at +5m.
 *
 * Deliberately the only one. §7 calls it "the map's central ceiling anchor", and on a
 * map whose whole argument is that you cannot cover a lane, a single roof mount at the
 * exact centre is the one piece of verticality worth fighting over.
 *
 * **No chalk.** Map 04's plan draws no `*`, so the site traces no sigils — which also
 * means `siteCanAnswer` will refuse a Lamplight Wisp here (it needs `sigil >= 4`).
 * That is accidentally the right behaviour: the Wisp's answer on this map is the salt
 * ring, and the salt ring is not implemented, so barring it is honest until it is.
 */
export const CROSSROADS_SURFACES: SurfaceSlot[] = [
  { surface: SURF.ceiling, x: C, z: C, y: 5 },
];
