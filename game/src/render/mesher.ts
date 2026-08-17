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
import { boxFaces, faceSquares } from "../sim/wallgrid.ts";
import { sideNormalX, sideNormalZ } from "../sim/surfaces.ts";
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
  uv: number[];
}

/**
 * World-space planar UVs, chosen by the dominant normal axis.
 *
 * Triplanar-lite, and it earns its keep: the site is one merged mesh assembled from
 * boxes at arbitrary sizes, so there is no sensible unwrap and any per-box UV scheme
 * would make the grain change size from one wall to the next. Projecting from world
 * metres means the texture is the same physical size everywhere, which is the only
 * thing that makes it read as *material* rather than as decoration.
 */
function planarUV(x: number, y: number, z: number, nx: number, ny: number, nz: number): [number, number] {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return [x * UV_PER_METRE, z * UV_PER_METRE];
  if (ax >= az) return [z * UV_PER_METRE, y * UV_PER_METRE];
  return [x * UV_PER_METRE, y * UV_PER_METRE];
}

/** One texture repeat every 2m — the build tile, so grain and grid agree. */
const UV_PER_METRE = 0.5;

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
    const [u, v] = planarUV(xs[i], ys[i], zs[i], nx, ny, nz);
    s.uv.push(u, v);
    // Darken toward the floor: cheap contact shadow, no lighting cost.
    const span = Math.max(0.001, gradientTop - gradientBase);
    const t = (ys[i] - gradientBase) / span;
    const g = 0.74 + 0.26 * Math.min(1, Math.max(0, t));
    /*
     * Per-vertex grain, on top of the face shade and the floor gradient.
     *
     * The texture map carries the fine detail; this carries the *blotches* — damp
     * patches, weathering, one course darker than the next. Two scales rather than
     * one because a single frequency reads as noise, and two read as a material that
     * has been rained on.
     */
    const grain =
      0.88 +
      0.12 * valueNoise(xs[i] * 2.1 + zs[i] * 0.7, ys[i] * 2.3 + zs[i] * 1.9) +
      0.06 * (valueNoise(xs[i] * 7.3, ys[i] * 6.1 + zs[i] * 3.3) - 0.5);
    const m = shade * g * grain;
    s.col.push(c.r * m, c.g * m, c.b * m);
  }
}

/** Which kinds get relief. Walkables and scenery stay simple boxes. */
function isArchitecture(kind: Box["kind"]): boolean {
  return kind === BOX.wall || kind === BOX.block || kind === BOX.pillar;
}

/**
 * Panels laid over a wall's vertical faces, so a wall is a *surface* and not a slab.
 *
 * Two decisions worth stating, because both were the alternative at one point:
 *
 * **Proud, not recessed.** Recessed panels would need the flat face cut away around
 * them, and any gap in that cut is a hole you can see the sky through. Laying courses
 * ON the intact box can never hole, and it changes the silhouette — which is most of
 * what makes a wall look three-dimensional from across the room, far more than the
 * face detail does.
 *
 * **Aligned to the build tile.** The panel grid is the same 2m lattice traps mount
 * on, so the masonry a player is looking at IS the grid they are placing into. That
 * is the whole reason walls got a lattice; a wall whose visible courses disagreed
 * with its build cells would be actively misleading.
 *
 * Everything protrudes by at most `PANEL_PROUD`, and the renderer offsets wall-
 * mounted trap meshes by that much, so nothing a player builds ever intersects it.
 */
export const PANEL_PROUD = 0.09;
/** Groove between courses. Wide enough to read at 20m under a banded ramp. */
const PANEL_GAP = 0.1;

function emitPanels(s: Sink, b: Box, tile: number): void {
  const c = baseColor(b.kind);
  const tint = new Color();

  for (const f of boxFaces(b)) {
    const nx = sideNormalX(f.side);
    const nz = sideNormalZ(f.side);

    /*
     * The SAME squares the build lattice uses (sim/wallgrid.ts).
     *
     * Not a matching implementation — the actual function. These were two separate
     * schemes and they drifted: courses at y = 1 and 3, mounts at 1.8 and 3.8, so
     * every wall trap floated 0.8m above the square it looked like it was on. Reading
     * one definition is the only version of "the masonry IS the grid" that stays true.
     */
    for (const sq of faceSquares(f.uFrom, f.uTo, b.y0, b.y1, tile)) {
      const u0 = sq.u0 + PANEL_GAP / 2;
      const u1 = sq.u1 - PANEL_GAP / 2;
      const v0 = sq.y0 + PANEL_GAP / 2;
      const v1 = sq.y1 - PANEL_GAP / 2;
      if (u1 <= u0 || v1 <= v0) continue;

      // Deterministic depth per course (§13 rule 2 — no Math.random anywhere).
      const n = valueNoise(sq.cu * 1.7 + (f.ox + f.oz) * 2.3, sq.cy * 3.1);
      const d = PANEL_PROUD * (0.45 + 0.55 * n);
      // Value varies course to course. This is the cheapest "rough" there is.
      tint.copy(c).multiplyScalar(0.86 + 0.22 * n);

      const box: Box = {
        x0: f.ux !== 0 ? u0 : f.ox + (nx > 0 ? 0 : -d),
        x1: f.ux !== 0 ? u1 : f.ox + (nx > 0 ? d : 0),
        z0: f.uz !== 0 ? u0 : f.oz + (nz > 0 ? 0 : -d),
        z1: f.uz !== 0 ? u1 : f.oz + (nz > 0 ? d : 0),
        y0: v0,
        y1: v1,
        kind: b.kind,
      };
      /*
       * Shade scale 1, NOT the parent face's shade.
       *
       * A panel is a box, and `emitBox` already gives each of ITS faces the right
       * FACE_SHADE — so passing the wall's shade in as well applied it twice and made
       * every course 0.25x where the wall behind it was 0.5x. Courses came out
       * markedly darker than the wall they sit on, which reads as grime at best and as
       * holes at worst. (Fixed once, then reintroduced by a later rewrite of this
       * function; hence saying it in the code rather than in a commit message.)
       */
      emitBox(s, box, tint, 1);
    }
  }
}

function emitBox(s: Sink, b: Box, override?: Color, shadeScale = 1): void {
  const { x0, x1, y0, y1, z0, z1 } = b;
  const c = override ?? baseColor(b.kind);

  const k = shadeScale;
  /*
   * WINDING. Every side face here had its corners in the order that makes the
   * geometric normal point INTO the box, so with the default `FrontSide` material all
   * four were back-facing and culled — you were seeing the inside of the far wall
   * through the near one. Only the top face (and the floor, which shares its corner
   * order) was ever right, which is why the bug survived: lighting uses the supplied
   * normal attribute, so the shading looked correct on the faces that did draw.
   *
   * Corner order is a-d-c-b relative to the old code: the same quad, wound the other
   * way. Verified by `cross(b - a, c - a)` agreeing with the declared normal — that is
   * what `walls.test.ts` asserts, so it cannot silently flip back.
   */
  // Top
  quad(s, x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, c, FACE_SHADE.top * k, y0, y1);
  // +X
  quad(s, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, c, FACE_SHADE.px * k, y0, y1);
  // -X
  quad(s, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, c, FACE_SHADE.nx * k, y0, y1);
  // +Z
  quad(s, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, c, FACE_SHADE.pz * k, y0, y1);
  // -Z
  quad(s, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, c, FACE_SHADE.nz * k, y0, y1);
  // Bottom deliberately omitted.
}

export function buildBoxGeometry(boxes: Box[], tile = 2): BufferGeometry {
  const s: Sink = { pos: [], nrm: [], col: [], uv: [] };
  // A non-positive tile would make `faceSquares` iterate for ever.
  if (!(tile > 0)) tile = 2;
  for (let i = 0; i < boxes.length; i++) {
    emitBox(s, boxes[i]);
    if (isArchitecture(boxes[i].kind)) emitPanels(s, boxes[i], tile);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(s.col), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(s.uv), 2));
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
/**
 * One ground cell, with an independent shade at each corner.
 *
 * `quad` takes a single shade for the whole face because that is right for a
 * wall panel, where a flat facet is the intent. The floor wants the opposite, so
 * it gets its own emitter rather than growing `quad` a mode that every wall call
 * would have to pass through.
 */
function floorQuad(
  s: Sink,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  c: Color,
  sA: number,
  sB: number,
  sC: number,
  sD: number,
): void {
  // a=(x0,z1) b=(x1,z1) c=(x1,z0) d=(x0,z0), wound to face +Y.
  const xs = [x0, x1, x1, x0, x1, x0];
  const zs = [z1, z1, z0, z1, z0, z0];
  const sh = [sA, sB, sC, sA, sC, sD];
  for (let i = 0; i < 6; i++) {
    s.pos.push(xs[i], 0, zs[i]);
    s.nrm.push(0, 1, 0);
    const [u, v] = planarUV(xs[i], 0, zs[i], 0, 1, 0);
    s.uv.push(u, v);
    s.col.push(c.r * sh[i], c.g * sh[i], c.b * sh[i]);
  }
}

export function buildFloorGeometry(
  width: number,
  depth: number,
  boxes: Box[] = [],
): BufferGeometry {
  const s: Sink = { pos: [], nrm: [], col: [], uv: [] };
  // ~1m cells: 3k triangles for the whole site, against a 1.2M budget (§14.2).
  const step = 1;
  const nx = Math.max(1, Math.round(width / step));
  const nz = Math.max(1, Math.round(depth / step));

  /** Ground shade at one point: noise, times the baked contact shadow. */
  const cornerShade = (x: number, z: number): number => {
    const n = valueNoise(x, z);
    // Occlusion is squared so it hugs the wall instead of washing outward.
    const occ = Math.min(1, nearBox(x, z) / AO_REACH) ** 2;
    return (0.62 + n * 0.42) * (0.44 + 0.56 * occ);
  };

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
      // The tint sweep is per-cell; only the shade is sampled per corner.
      const cx = (x0 + x1) / 2;

      // Warm at the gate end (+X), cool toward the Rift.
      tint.copy(cool).lerp(warm, cx / Math.max(1, width));

      /*
       * Shade at the four CORNERS, not at the centre.
       *
       * This used to take one noise sample per cell and apply it flat to all
       * four vertices — a per-face shade wearing a per-vertex comment. It made
       * 44×34m of ground read as a hard-edged checkerboard of 1m facets, which
       * was the largest single artifact in any frame. Sampling per corner lets
       * the rasteriser interpolate, so the same noise field becomes the patchy
       * dry earth it was always meant to be.
       *
       * Corners are shared with the neighbouring cells, so values agree across
       * every seam and no lattice survives.
       */
      floorQuad(
        s,
        x0, z0, x1, z1,
        tint,
        cornerShade(x0, z1),
        cornerShade(x1, z1),
        cornerShade(x1, z0),
        cornerShade(x0, z0),
      );
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(s.col), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(s.uv), 2));
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
