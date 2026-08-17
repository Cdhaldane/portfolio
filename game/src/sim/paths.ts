/*
 * sim/paths.ts — the ghost path: where the bodies will walk.
 *
 * GALLOWS_HYMN.md §4 puts this in the build phase alongside the Bill: "Ghost
 * paths shown from each active gate to the Rift". It is not decoration, it is the
 * other half of the contract the Bill starts. §4's rule is that difficulty comes
 * from the wave composition being *hard*, never from it being *secret*, and a
 * trap game that hides the route is hiding the question — you cannot place a Tar
 * Seep to cover a lane you have to guess at.
 *
 * It matters most on Hollow Creek (MAPS §5), where the player can *pay to move
 * the lane*. Buying the saloon re-routes the Long Adit by three metres and the
 * Fall by four; without a drawn path that is an invisible consequence of a
 * 100-scrap purchase, which is exactly the hostile design §4 forbids.
 *
 * **It traces the real field.** This walks `flowDir` — the same function
 * `EnemySystem` steers by, ring-search fallback and all — rather than
 * re-deriving a route from `dist`. A preview that is drawn by different code
 * than the thing it previews is a lie waiting to happen; when the two disagree,
 * they must disagree because the *field* changed, not because the drawing did.
 *
 * Pure: no three, no DOM. Presentation turns these points into a ribbon.
 */

import { cellOf, flowDir, type Level } from "./level.ts";

/** Metres per trace step. Below the 1m cell size, so no cell is skipped. */
const STEP = 0.5;

/**
 * Hard cap on steps. A 80m map at 0.5m is 160 steps for a straight run; 1200
 * allows a thoroughly serpentine one and still terminates if a field ever loops.
 * It should never be reached, and a path that reaches it is a bug worth seeing
 * as a stubby line rather than as a hung frame.
 */
const MAX_STEPS = 1200;

const dir = new Float64Array(2);

/**
 * Trace one gate's route to the Rift, appending `x, z` pairs to `out`.
 *
 * Returns the number of points written. Points are emitted only where the route
 * actually turns (see `MIN_TURN`), so a straight 40m lane costs two points
 * rather than eighty — the ribbon that gets built from this is then mostly long
 * quads, and the whole preview stays one small buffer.
 */
export function tracePath(level: Level, gx: number, gz: number, out: number[]): number {
  let x = gx;
  let z = gz;
  let written = 0;

  const push = (px: number, pz: number): void => {
    out.push(px, pz);
    written++;
  };
  push(x, z);

  // Last emitted heading, so we can drop points along a straight run.
  let lastDx = 0;
  let lastDz = 0;
  const MIN_TURN = 0.996; // ~5 degrees

  const rr = level.rift.radius;
  for (let i = 0; i < MAX_STEPS; i++) {
    const dx = level.rift.x - x;
    const dz = level.rift.z - z;
    if (dx * dx + dz * dz <= rr * rr) break;

    // Off the grid entirely: a gate outside the map is a bug, but bail rather
    // than spin.
    if (cellOf(level, x, z) < 0) break;

    flowDir(level, x, z, dir);
    if (dir[0] === 0 && dir[1] === 0) break;

    x += dir[0] * STEP;
    z += dir[1] * STEP;

    const turned = dir[0] * lastDx + dir[1] * lastDz < MIN_TURN;
    if (turned) {
      push(x, z);
      lastDx = dir[0];
      lastDz = dir[1];
    }
  }

  // Always finish on the Rift, so every path visibly arrives somewhere rather
  // than stopping in mid-air a metre short of the ring.
  push(level.rift.x, level.rift.z);
  return written;
}

/**
 * A signature of everything a drawn path depends on.
 *
 * Cheaper than diffing the geometry and it catches all five things that move a
 * lane: travelling to a new site, a round opening another gate, the player
 * buying a building, the Rift itself moving — and the field being re-baked,
 * which is how a blockade going up or coming down re-traces the preview
 * (`bakeEpoch` bumps on every `rebake`; without it, placing a Dead Man's Brace
 * left the ribbon drawing a route the bodies no longer take). Presentation
 * re-traces when this changes and never otherwise — tracing is far too
 * expensive for a frame.
 */
export function pathSignature(level: Level, round: number): string {
  let open = "";
  for (let i = 0; i < level.open.length; i++) open += level.open[i] ? "1" : "0";
  return `${level.siteId}:${round}:${open}:${level.rift.x},${level.rift.z}:${level.bakeEpoch}`;
}
