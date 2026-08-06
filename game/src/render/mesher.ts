/*
 * render/mesher.ts — turns the level's boxes into one merged mesh.
 *
 * Hand-written rather than pulled from BufferGeometryUtils, because doing it
 * ourselves buys three things a generic merge can't:
 *
 *  1. **Bottom faces are skipped.** Nothing is ever seen from below.
 *  2. **Baked face shading in vertex colours** — top faces bright, X sides
 *     mid, Z sides dark, plus a vertical gradient toward the floor. That is a
 *     fake-AO value structure for free, and it's what makes the grey-box read
 *     as deliberate instead of flat (§17.1: "value before hue").
 *  3. **One geometry, one draw call** for the whole site (§14.2 budget: ≤40
 *     draw calls for an assembled site).
 *
 * This is the render half of Path A (§17.0): the same `Box[]` the sim collides
 * against becomes the thing you look at.
 */

import { BufferAttribute, BufferGeometry, Color } from "three";
import { BOX, type Box } from "../sim/level.ts";
import { COLOR } from "./palette.ts";

/** Which swatch each kit piece is made of. */
function baseColor(kind: Box["kind"]): Color {
  switch (kind) {
    case BOX.wall:
      return COLOR.timber;
    case BOX.block:
      return COLOR.grave;
    case BOX.pillar:
      return COLOR.ash;
    case BOX.step:
      return COLOR.timberDark;
    default:
      return COLOR.dust;
  }
}

/** Per-face brightness. Directional, not physical — it just has to read. */
const FACE_SHADE = {
  top: 1.0,
  px: 0.74,
  nx: 0.62,
  pz: 0.86,
  nz: 0.5,
} as const;

interface Sink {
  pos: number[];
  nrm: number[];
  col: number[];
}

function quad(
  s: Sink,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  nx: number,
  ny: number,
  nz: number,
  c: Color,
  shade: number,
  gradientBase: number,
  gradientTop: number,
): void {
  // Two triangles, wound counter-clockwise when viewed along -normal.
  const xs = [ax, bx, cx, ax, cx, dx];
  const ys = [ay, by, cy, ay, cy, dy];
  const zs = [az, bz, cz, az, cz, dz];
  for (let i = 0; i < 6; i++) {
    s.pos.push(xs[i], ys[i], zs[i]);
    s.nrm.push(nx, ny, nz);
    // Darken toward the floor: cheap contact shadow, no lighting cost.
    const span = Math.max(0.001, gradientTop - gradientBase);
    const t = (ys[i] - gradientBase) / span;
    const g = 0.74 + 0.26 * Math.min(1, Math.max(0, t));
    const m = shade * g;
    s.col.push(c.r * m, c.g * m, c.b * m);
  }
}

function emitBox(s: Sink, b: Box): void {
  const { x0, x1, y0, y1, z0, z1 } = b;
  const c = baseColor(b.kind);

  // Top
  quad(s, x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, c, FACE_SHADE.top, y0, y1);
  // +X
  quad(s, x1, y0, z1, x1, y1, z1, x1, y1, z0, x1, y0, z0, 1, 0, 0, c, FACE_SHADE.px, y0, y1);
  // -X
  quad(s, x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1, -1, 0, 0, c, FACE_SHADE.nx, y0, y1);
  // +Z
  quad(s, x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1, 0, 0, 1, c, FACE_SHADE.pz, y0, y1);
  // -Z
  quad(s, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z0, 0, 0, -1, c, FACE_SHADE.nz, y0, y1);
  // Bottom deliberately omitted.
}

export function buildBoxGeometry(boxes: Box[]): BufferGeometry {
  const s: Sink = { pos: [], nrm: [], col: [] };
  for (let i = 0; i < boxes.length; i++) emitBox(s, boxes[i]);

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(s.col), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Deterministic 2D value noise. Two octaves is all the ground needs, and a hash
 * rather than `Math.random` keeps every player's dirt identical (§13 rule 2).
 */
function valueNoise(x: number, z: number): number {
  const h = (i: number, j: number): number => {
    let n = (i * 374761393 + j * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return (((n ^ (n >>> 16)) >>> 0) % 10000) / 10000;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const at = (sx: number, sz: number): number => {
    const i = Math.floor(sx);
    const j = Math.floor(sz);
    const fx = smooth(sx - i);
    const fz = smooth(sz - j);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * fx;
    const b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * fx;
    return a + (b - a) * fz;
  };
  return at(x * 0.09, z * 0.09) * 0.65 + at(x * 0.31, z * 0.31) * 0.35;
}

/** How far from a wall the baked contact shadow still darkens the floor. */
const AO_REACH = 2.2;

/**
 * The ground plane, subdivided and shaded per vertex.
 *
 * The first version was a single quad in one flat `dust`, which is what a floor
 * looks like when nobody has looked at it yet: in the baseline screenshot the
 * whole lower half of the frame is one unbroken grey, and it made a 44×34m
 * graveyard read as a stage. Three things fix it, all baked at build time and all
 * free at runtime, because they live in vertex colours on a mesh that never
 * changes:
 *
 *  1. **Two octaves of value noise** — patchy dry earth instead of a swatch.
 *  2. **A baked contact shadow around every box** (`boxes`), which is the single
 *     most convincing cue that the walls are *standing on* the ground rather than
 *     intersecting it. §14.4 bakes AO offline in the shipping pipeline; this is
 *     the Path A version of the same idea, and the geometry is right here.
 *  3. **A cool-to-warm sweep across the site**, tying the cold Rift end to the
 *     lamplit gate end (§3's two-ends-never-read-the-same rule) in the surface
 *     itself rather than only in the lights.
 *
 * `boxes` is optional so the shelf scene can still ask for a plain floor.
 */
export function buildFloorGeometry(
  width: number,
  depth: number,
  boxes: Box[] = [],
): BufferGeometry {
  const s: Sink = { pos: [], nrm: [], col: [] };
  // ~1m cells: 3k triangles for the whole site, against a 1.2M budget (§14.2).
  const step = 1;
  const nx = Math.max(1, Math.round(width / step));
  const nz = Math.max(1, Math.round(depth / step));

  const cool = new Color(COLOR.dust).lerp(new Color(COLOR.ash), 0.42);
  const warm = new Color(COLOR.dust).lerp(new Color(COLOR.timber), 0.3);
  const tint = new Color();

  /** Distance from (x,z) to the nearest box footprint, capped at AO_REACH. */
  const nearBox = (x: number, z: number): number => {
    let best = AO_REACH;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // Only geometry tall enough to cast a real contact shadow counts; a 6cm
      // step should not draw a halo on the floor.
      if (b.y1 - b.y0 < 0.5) continue;
      const dx = Math.max(b.x0 - x, 0, x - b.x1);
      const dz = Math.max(b.z0 - z, 0, z - b.z1);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
      if (best === 0) break;
    }
    return best;
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = (i / nx) * width;
      const x1 = ((i + 1) / nx) * width;
      const z0 = (j / nz) * depth;
      const z1 = ((j + 1) / nz) * depth;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;

      // Warm at the gate end (+X), cool toward the Rift.
      tint.copy(cool).lerp(warm, cx / Math.max(1, width));

      const n = valueNoise(cx, cz);
      // Occlusion is squared so it hugs the wall instead of washing outward.
      const occ = Math.min(1, nearBox(cx, cz) / AO_REACH) ** 2;
      const shade = (0.62 + n * 0.42) * (0.44 + 0.56 * occ);

      quad(
        s,
        x0, 0, z1,
        x1, 0, z1,
        x1, 0, z0,
        x0, 0, z0,
        0, 1, 0,
        tint,
        shade,
        0,
        1,
      );
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(s.col), 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Chalk lines on the placement grid. Diegetic (§3: chalk sigils are how magic
 * gets into this world) and load-bearing — a trap game needs the player to see
 * the cells they're placing into.
 */
export function buildGridGeometry(width: number, depth: number, cell: number): BufferGeometry {
  const pos: number[] = [];
  const y = 0.012; // just off the floor, no z-fighting
  for (let x = 0; x <= width; x += cell) pos.push(x, y, 0, x, y, depth);
  for (let z = 0; z <= depth; z += cell) pos.push(0, y, z, width, y, z);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  return g;
}
