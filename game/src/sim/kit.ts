/*
 * sim/kit.ts — the code-generated kit vocabulary.
 *
 * Lifted out of `level.ts` so site definitions can use it without importing the
 * baker, and so the kit stays a small, closed vocabulary rather than growing
 * per-map special cases. This is "Path A" from GALLOWS_HYMN.md §17.0: environment
 * geometry as parameterized data, emitted by five generators.
 *
 * Adding an authored Blender kit later means adding a loader, not changing this
 * file — the sim only ever sees `Box[]`.
 */

import { BUILD_TILE, BOX, type Box, type BoxKind } from "./level.ts";

export function wallRun(
  out: Box[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  height = 4,
  thickness = 0.6,
): void {
  const half = thickness / 2;
  const horizontal = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  out.push({
    x0: horizontal ? Math.min(x0, x1) : x0 - half,
    x1: horizontal ? Math.max(x0, x1) : x0 + half,
    z0: horizontal ? z0 - half : Math.min(z0, z1),
    z1: horizontal ? z0 + half : Math.max(z0, z1),
    y0: 0,
    y1: height,
    kind: BOX.wall,
  });
}

export function block(
  out: Box[],
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  height: number,
  kind: BoxKind = BOX.block,
): void {
  out.push({
    x0: cx - sx / 2,
    x1: cx + sx / 2,
    z0: cz - sz / 2,
    z1: cz + sz / 2,
    y0: 0,
    y1: height,
    kind,
  });
}

export function pillar(out: Box[], cx: number, cz: number, size = 0.8, height = 4): void {
  block(out, cx, cz, size, size, height, BOX.pillar);
}

/**
 * A flight of steps. `dir` is which way along X the flight *ascends*, so a
 * platform can be approached from either side without leaving a hole at the join.
 *
 * `base` is the height the flight *starts from* — the floor it stands on, not 0.
 * It exists because Shaft Nine's catwalk flights start on the +6 gallery: authored
 * against 0 they topped out at 5.1m, entirely inside the void UNDER the gallery
 * deck, and the catwalk was unreachable while phantom treads floated below the
 * floor. `groundHeight` rides tread tops wherever they are; the base just has to
 * tell the truth.
 */
export function steps(
  out: Box[],
  cx: number,
  cz: number,
  count: number,
  rise: number,
  run: number,
  width: number,
  dir: 1 | -1 = 1,
  base = 0,
): void {
  for (let i = 0; i < count; i++) {
    const a = cx + dir * i * run;
    const b = cx + dir * (i + 1) * run;
    out.push({
      x0: Math.min(a, b),
      x1: Math.max(a, b),
      z0: cz - width / 2,
      z1: cz + width / 2,
      y0: base,
      y1: base + rise * (i + 1),
      kind: BOX.step,
    });
  }
}

/**
 * A deck: boardwalk, platform or catwalk (MAPS §9 item 2).
 *
 * The one kit piece with a non-zero `y0`, which is the whole reason it exists —
 * a catwalk you can walk *under* is what makes Shaft Nine a different game, and
 * `groundHeight` had to learn about `y0` before one could exist.
 *
 * Decks are 0.30m, never 0.35m: `PLAYER.stepOffset` is exactly 0.35, and putting
 * a deck at the step height lands the whole map on the wrong side of a
 * floating-point comparison. 0.30 leaves margin and needs no step-up handling.
 */
export function deck(
  out: Box[],
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  top: number,
  thickness = 0.12,
  noBuild = false,
): void {
  out.push({
    x0: cx - sx / 2,
    x1: cx + sx / 2,
    z0: cz - sz / 2,
    z1: cz + sz / 2,
    y0: Math.max(0, top - thickness),
    y1: top,
    kind: BOX.deck,
    noBuild,
  });
}

/**
 * A flight of steps running along **Z** rather than X.
 *
 * Shaft Nine's haulage ramp descends south, and `steps()` only walks X. Rather than
 * add an axis parameter to a helper every map already reads, this is the same code
 * with the two axes swapped — kit pieces are meant to be obvious at the call site, and
 * `stepsZ(...)` says which way it goes without anyone checking an argument.
 */
export function stepsZ(
  out: Box[],
  cx: number,
  cz: number,
  count: number,
  rise: number,
  run: number,
  width: number,
  dir: 1 | -1 = 1,
  base = 0,
): void {
  for (let i = 0; i < count; i++) {
    const a = cz + dir * i * run;
    const b = cz + dir * (i + 1) * run;
    out.push({
      x0: cx - width / 2,
      x1: cx + width / 2,
      z0: Math.min(a, b),
      z1: Math.max(a, b),
      y0: base,
      y1: base + rise * (i + 1),
      kind: BOX.step,
    });
  }
}

/* ── the grid ideology ─────────────────────────────────────────────────────
 *
 * **A wall is a square, and it sits on the grid.** No wall overfills a tile and none
 * straddles two.
 *
 * This is not tidiness. `bakeBlocked` inflates every wall by the agent radius and marks
 * whole nav cells, so a wall that sits *between* grid lines eats a cell either side of
 * itself — and a gap authored at 2m seals completely. That exact failure has now cost
 * three debugging sessions: Boot Hill's orchard gap, Undertown's plaza mouths, and
 * Shaft Nine's winzes, where G2 baked with `dist = Infinity` and could never reach the
 * Rift. Each time the fix was "make the gap wider", which treats the symptom.
 *
 * Tile-aligned walls make the arithmetic structural instead. Walls are whole tiles,
 * so gaps are whole tiles, and the rule a map author has to remember shrinks to one
 * number: **a gap is at least 2 tiles.** One tile leaves ~1.1m of passable nav width
 * after padding, which a 0.45m-radius body only just fits through; two leaves 3.1m.
 */

/** Snap down to a tile boundary. */
const floorTile = (v: number, tile: number): number => Math.floor(v / tile + 1e-6) * tile;
/** Snap up to a tile boundary. */
const ceilTile = (v: number, tile: number): number => Math.ceil(v / tile - 1e-6) * tile;

/**
 * A wall run, quantised to the build grid: one tile thick, whole tiles long.
 *
 * Replaces `wallRun`, whose 0.6m thickness is what put walls between the grid lines in
 * the first place. Takes the same arguments so a map reads the same after migrating.
 */
export function wall(
  out: Box[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  height = 4,
  tile = BUILD_TILE,
): void {
  const horizontal = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  if (horizontal) {
    const a = floorTile(Math.min(x0, x1), tile);
    const b = ceilTile(Math.max(x0, x1), tile);
    const z = floorTile(z0, tile);
    out.push({ x0: a, x1: b, z0: z, z1: z + tile, y0: 0, y1: height, kind: BOX.wall });
  } else {
    const a = floorTile(Math.min(z0, z1), tile);
    const b = ceilTile(Math.max(z0, z1), tile);
    const x = floorTile(x0, tile);
    out.push({ x0: x, x1: x + tile, z0: a, z1: b, y0: 0, y1: height, kind: BOX.wall });
  }
}

/** A rectangular mass, snapped outward to whole tiles. */
export function slab(
  out: Box[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  height: number,
  kind: BoxKind = BOX.block,
  tile = BUILD_TILE,
): void {
  out.push({
    x0: floorTile(Math.min(x0, x1), tile),
    x1: ceilTile(Math.max(x0, x1), tile),
    z0: floorTile(Math.min(z0, z1), tile),
    z1: ceilTile(Math.max(z0, z1), tile),
    y0: 0,
    y1: height,
    kind,
  });
}

/**
 * Water, lava, a flooded winze — ground you cannot cross and cannot build on.
 *
 * Flat by design (2cm), which is what separates it from a wall: it stops movement and
 * pathing while blocking **neither sight nor shots**. An open map with water in it
 * still reads as open, and you can fight across a channel you cannot walk over.
 *
 * A body *launched* over one clears it, because the collision only applies near the
 * ground — so a Powder Plate across a flooded cut is a real thing to build.
 */
export function hazard(
  out: Box[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  tile = BUILD_TILE,
): void {
  out.push({
    x0: floorTile(Math.min(x0, x1), tile),
    x1: ceilTile(Math.max(x0, x1), tile),
    z0: floorTile(Math.min(z0, z1), tile),
    z1: ceilTile(Math.max(z0, z1), tile),
    y0: 0,
    y1: 0.02,
    kind: BOX.hazard,
  });
}
