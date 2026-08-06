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

import { BOX, type Box, type BoxKind } from "./level.ts";

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
): void {
  for (let i = 0; i < count; i++) {
    const a = cx + dir * i * run;
    const b = cx + dir * (i + 1) * run;
    out.push({
      x0: Math.min(a, b),
      x1: Math.max(a, b),
      z0: cz - width / 2,
      z1: cz + width / 2,
      y0: 0,
      y1: rise * (i + 1),
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
