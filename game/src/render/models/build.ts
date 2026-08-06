/*
 * render/models/build.ts — the code-authoring toolkit every model is made of.
 *
 * This started life inside `models/traps.ts` and was lifted out the moment the
 * hero and the enemy roster needed the same vocabulary. That extraction is the
 * point: GALLOWS_HYMN.md §17.9 says cohesion is won by putting heterogeneous
 * sources through *one* styling path, and when the art is code the styling path
 * is a module. A hero built out of the same tapered boxes and faceted cylinders
 * as a bear trap cannot drift away from it.
 *
 * The §17.1 cartoony rules are implemented here rather than aspired to:
 *
 *   - nothing thinner than 4cm            → MIN_THICKNESS; an authoring rule, so
 *                                           it's on review, not on the test
 *   - exaggerate the functional part      → teeth, hoops, hat brims, pauldrons
 *   - taper everything                    → every box and cylinder takes a taper
 *   - one flat colour per part            → baked into vertex colours, below
 *   - no detail under 3cm                 → nothing here is smaller
 *
 * **Flat normals everywhere, deliberately.** Every quad computes its own face
 * normal, so cylinders are faceted rather than smooth. Under the banded toon ramp
 * (§17.1) hard facets are the *correct* look — smooth-shaded cylinders would land
 * back in stylized-realism, and they'd cost a normal-averaging pass to get there.
 *
 * **Why baked vertex colours rather than one material per part:** most of what
 * this builds ends up in an `InstancedMesh` (one draw call for every Jaws, every
 * Dustkin), and instancing needs one geometry and one material. Per-part colour
 * therefore has to live in the vertex stream. The consequence is that the
 * per-instance colour can no longer carry hue — it carries *state* (armed,
 * burning, just-hit), which is the better job for it anyway.
 */

import { BufferAttribute, BufferGeometry, type Color } from "three";

/**
 * The §17.1 cartoony floor on form thickness. Exported so the geometry test can
 * assert it rather than trusting that nobody ever authors a 1cm sliver.
 */
export const MIN_THICKNESS = 0.04;

export type Vec3 = readonly [number, number, number];

/* ── shading ─────────────────────────────────────────────────────────────── */

/**
 * A fixed "sun" for baked directional shading, matching the value structure the
 * site mesher uses (top faces ~1.0, -Z faces ~0.5) so a trap and the floor it
 * sits on look lit by the same thing. Purely a value trick — no light is
 * involved, and it survives regardless of what the real lighting does.
 */
const LIGHT: Vec3 = [0.3, 0.9, 0.32];

export interface Shading {
  /** Flat term every face gets. */
  ambient: number;
  /** How much the fixed sun adds on top. */
  direct: number;
  /** Height over which the contact gradient runs out, metres. */
  span: number;
  /** Value at the very bottom of that gradient. */
  floor: number;
  /** How much it climbs over `span`. */
  range: number;
}

/**
 * Props and traps: knee-high things whose whole body sits inside the contact
 * gradient, and which never rotate, so the baked sun can be strong.
 *
 * Lifted from 0.5/0.556 and 0.72/0.28 after looking at the shelf scene (§17.9).
 * The first pass was tuned by reasoning about the numbers and it came out muddy:
 * `grave`-coloured iron at 0.5 ambient × 0.75 contact read as a black lump at
 * gameplay distance, which is the opposite of the cartoony brief. Top-to-side
 * ratio is still ~2:1, so value separation survives the lift.
 *
 * This is the shelf earning its keep on its first use — the values were plausible
 * and wrong, and nothing but seeing five traps in a row would have shown it.
 */
export const PROP_SHADE: Shading = {
  ambient: 0.6,
  direct: 0.52,
  span: 0.55,
  floor: 0.82,
  range: 0.18,
};

/**
 * Characters: a *weaker* baked sun and a taller gradient.
 *
 * Both differences come from the same fact — a character turns. Baked
 * directional shading turns with it, so at full strength a Dustkin's lit side
 * would swing around as it walks, which reads as a bug. Keeping the direct term
 * low leaves the real moonlight to say where the light is coming from, and the
 * vertical gradient (which is rotation-invariant) does the value separation
 * instead: boots dark, hat bright, which is exactly the §17.1 read.
 */
export const CHAR_SHADE: Shading = {
  ambient: 0.66,
  direct: 0.3,
  span: 1.95,
  floor: 0.74,
  range: 0.3,
};

/**
 * The site dressing: authored once at the origin and then stamped hundreds of
 * times across the map, so it wants the prop sun but a taller gradient — a
 * headstone is knee-high, a dead tree is five metres.
 */
export const DRESS_SHADE: Shading = {
  ambient: 0.52,
  direct: 0.48,
  span: 2.4,
  floor: 0.66,
  range: 0.34,
};

/* ── the sink ────────────────────────────────────────────────────────────── */

/** Position/rotation/scale applied to everything a primitive emits. */
export interface Transform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

const IDENTITY: Transform = { x: 0, y: 0, z: 0, yaw: 0, scale: 1 };

export interface Sink {
  pos: number[];
  nrm: number[];
  col: number[];
  shade: Shading;
  /**
   * Added to a vertex's local Y before the contact gradient is sampled. A limb
   * authored hanging *down* from its pivot has negative local Y; without this it
   * would clamp to the darkest end of the gradient along its whole length.
   */
  yBias: number;
  xf: Transform;
}

export function createSink(shade: Shading = PROP_SHADE, yBias = 0): Sink {
  return { pos: [], nrm: [], col: [], shade, yBias, xf: { ...IDENTITY } };
}

/**
 * Run `fn` with everything it emits moved, turned and scaled.
 *
 * This is what makes a graveyard affordable: `headstone()` is authored once at
 * the origin and stamped two hundred times, and the merged result is still one
 * geometry and one draw call.
 */
export function withTransform(s: Sink, xf: Partial<Transform>, fn: (s: Sink) => void): void {
  const prev = s.xf;
  s.xf = {
    x: xf.x ?? 0,
    y: xf.y ?? 0,
    z: xf.z ?? 0,
    yaw: xf.yaw ?? 0,
    scale: xf.scale ?? 1,
  };
  fn(s);
  s.xf = prev;
}

function shadeFor(nx: number, ny: number, nz: number, sh: Shading): number {
  const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  return sh.ambient + sh.direct * Math.max(0, d);
}

function push(s: Sink, p: Vec3, n: Vec3, c: Color, shade: number): void {
  const xf = s.xf;
  const cs = Math.cos(xf.yaw);
  const sn = Math.sin(xf.yaw);
  const lx = p[0] * xf.scale;
  const ly = p[1] * xf.scale;
  const lz = p[2] * xf.scale;
  s.pos.push(xf.x + lx * cs - lz * sn, xf.y + ly, xf.z + lx * sn + lz * cs);

  // The normal only turns; it is never scaled (uniform scale can't skew it).
  s.nrm.push(n[0] * cs - n[2] * sn, n[1], n[0] * sn + n[2] * cs);

  // Contact darkening reads the LOCAL height, so a headstone stamped on a rise
  // still darkens at its own base rather than at the world floor.
  const sh = s.shade;
  const t = Math.min(1, Math.max(0, (p[1] + s.yBias) / sh.span));
  // Clamped: a multiplier over 1 is meaningless for albedo, and it would push the
  // brightest swatch (`lamp`, whose red channel is already 1.0) out of range.
  const m = Math.min(1, shade * (sh.floor + sh.range * t));
  s.col.push(c.r * m, c.g * m, c.b * m);
}

/** Face normal from three corners, wound counter-clockwise seen from outside. */
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function tri(s: Sink, a: Vec3, b: Vec3, c: Vec3, col: Color): void {
  const n = faceNormal(a, b, c);
  const shade = shadeFor(n[0], n[1], n[2], s.shade);
  push(s, a, n, col, shade);
  push(s, b, n, col, shade);
  push(s, c, n, col, shade);
}

export function quad(s: Sink, a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: Color): void {
  tri(s, a, b, c, col);
  tri(s, a, c, d, col);
}

/* ── primitives ──────────────────────────────────────────────────────────── */

function rotY(x: number, z: number, yaw: number): [number, number] {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  return [x * cs - z * sn, x * sn + z * cs];
}

export interface BoxOpts {
  at: Vec3;
  /** Full extents at the base. */
  size: Vec3;
  col: Color;
  /** Footprint scale at the top. <1 tapers inward — the §17.1 default. */
  taper?: number;
  yaw?: number;
  /** Lean off vertical, radians. Positive tips the top toward +Z before yaw. */
  lean?: number;
  /**
   * Emit the bottom face. Off by default — nothing is seen from below, the same
   * convention the site mesher uses, and the geometry test leans on it (an
   * inverted-winding regression shows up as down-facing area appearing).
   */
  closed?: boolean;
}

/**
 * A tapered, yawed, optionally leaning box. The workhorse — a taper of
 * 0.85–0.95 is what stops code-generated geometry reading as programmer art,
 * and it costs no polygons.
 */
export function box(s: Sink, o: BoxOpts): void {
  const [cx, cy, cz] = o.at;
  const [sx, sy, sz] = o.size;
  const t = o.taper ?? 1;
  const yaw = o.yaw ?? 0;
  const lean = o.lean ?? 0;
  const hx = sx / 2;
  const hz = sz / 2;
  const tx = hx * t;
  const tz = hz * t;

  const corner = (lx: number, lz: number, y: number): Vec3 => {
    // Lean tips the whole section about X, so height shifts into Z as it rises.
    const zz = lz + Math.sin(lean) * y;
    const yy = y * Math.cos(lean);
    const [rx, rz] = rotY(lx, zz, yaw);
    return [cx + rx, cy + yy, cz + rz];
  };

  // Bottom ring (y = 0) and top ring (y = sy), in local space.
  const b0 = corner(-hx, -hz, 0);
  const b1 = corner(hx, -hz, 0);
  const b2 = corner(hx, hz, 0);
  const b3 = corner(-hx, hz, 0);
  const t0 = corner(-tx, -tz, sy);
  const t1 = corner(tx, -tz, sy);
  const t2 = corner(tx, tz, sy);
  const t3 = corner(-tx, tz, sy);

  // Winding matters and is easy to get backwards: a triangle (a,b,c) faces along
  // (b-a) x (c-a), so these orders are the ones that put the normal *outward*.
  // Verified face by face — an inverted top face is invisible under backface
  // culling and reads as a hole in the model.
  quad(s, t0, t3, t2, t1, o.col); // top   → +Y
  quad(s, b0, b3, t3, t0, o.col); // -X
  quad(s, b1, t1, t2, b2, o.col); // +X
  quad(s, b0, t0, t1, b1, o.col); // -Z
  quad(s, b3, b2, t2, t3, o.col); // +Z
  if (o.closed) quad(s, b0, b1, b2, b3, o.col); // bottom → -Y
}

export interface CylOpts {
  at: Vec3;
  rBottom: number;
  rTop: number;
  height: number;
  segments: number;
  col: Color;
  axis?: "x" | "y" | "z";
  caps?: "top" | "both" | "none";
  /** Rotate the facet seam, so stacked cylinders don't line up their edges. */
  phase?: number;
  /** Squash the cross-section along local Z. <1 makes an oval — a hat brim. */
  squash?: number;
}

/**
 * A faceted cylinder/frustum. Low segment counts are the point: 8–12 facets
 * under a hard ramp read as deliberate faceting, where 32 read as a failed
 * attempt at smooth.
 */
export function cyl(s: Sink, o: CylOpts): void {
  const seg = Math.max(3, o.segments);
  const axis = o.axis ?? "y";
  const caps = o.caps ?? "top";
  const phase = o.phase ?? 0;
  const squash = o.squash ?? 1;
  const [cx, cy, cz] = o.at;

  // Build along +Y, then rotate into place with a proper rotation (never a
  // coordinate swap — a swap has determinant -1 and silently inverts winding).
  const place = (lx: number, ly: number, lz: number): Vec3 => {
    let x = lx;
    let y = ly;
    let z = lz;
    if (axis === "x") {
      // -90° about Z: +Y → +X
      const nx = y;
      const ny = -x;
      x = nx;
      y = ny;
    } else if (axis === "z") {
      // +90° about X: +Y → +Z
      const ny = -z;
      const nz = y;
      y = ny;
      z = nz;
    }
    return [cx + x, cy + y, cz + z];
  };

  const ring = (r: number, y: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = phase + (i / seg) * Math.PI * 2;
      out.push(place(Math.cos(a) * r, y, Math.sin(a) * r * squash));
    }
    return out;
  };

  const bottom = ring(o.rBottom, 0);
  const top = ring(o.rTop, o.height);

  // Sides: this winding is outward — verified at angle 0, where the normal comes
  // out as +X as it should.
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    quad(s, bottom[i], top[i], top[j], bottom[j], o.col);
  }

  if (caps === "top" || caps === "both") {
    const c = place(0, o.height, 0);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      tri(s, c, top[j], top[i], o.col); // → +Y (local)
    }
  }
  if (caps === "both") {
    const c = place(0, 0, 0);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      tri(s, c, bottom[i], bottom[j], o.col); // → -Y (local)
    }
  }
}

export interface SpikeOpts {
  at: Vec3;
  /** Base footprint. Fat, per §17.1 — a tooth is a wedge, not a needle. */
  base: readonly [number, number];
  height: number;
  col: Color;
  yaw?: number;
  /** Lean off vertical, radians. Positive leans toward +Z before yaw. */
  lean?: number;
}

/** A four-sided pyramid: the tooth, the fence picket, the ash heap, the beak. */
export function spike(s: Sink, o: SpikeOpts): void {
  const [cx, cy, cz] = o.at;
  const [bx, bz] = o.base;
  const yaw = o.yaw ?? 0;
  const lean = o.lean ?? 0;

  const at = (lx: number, ly: number, lz: number): Vec3 => {
    // Lean tilts about X, so the apex shifts in Z as it rises.
    const tz = lz + Math.sin(lean) * ly;
    const ty = ly * Math.cos(lean);
    const [rx, rz] = rotY(lx, tz, yaw);
    return [cx + rx, cy + ty, cz + rz];
  };

  const b0 = at(-bx / 2, 0, -bz / 2);
  const b1 = at(bx / 2, 0, -bz / 2);
  const b2 = at(bx / 2, 0, bz / 2);
  const b3 = at(-bx / 2, 0, bz / 2);
  const apex = at(0, o.height, 0);

  // Reversed relative to the base ring order, so the faces point outward/up.
  tri(s, b1, b0, apex, o.col);
  tri(s, b2, b1, apex, o.col);
  tri(s, b3, b2, apex, o.col);
  tri(s, b0, b3, apex, o.col);
}

export interface AnnulusOpts {
  at: Vec3;
  inner: number;
  outer: number;
  segments: number;
  col: Color;
}

/** A flat ring on the ground — chalk. Genuinely flat; chalk has no thickness. */
export function annulus(s: Sink, o: AnnulusOpts): void {
  const seg = Math.max(6, o.segments);
  const [cx, cy, cz] = o.at;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (r: number, a: number): Vec3 => [
      cx + Math.cos(a) * r,
      cy,
      cz + Math.sin(a) * r,
    ];
    // Inner→inner→outer→outer, which is the order that faces +Y.
    quad(s, p(o.inner, a0), p(o.inner, a1), p(o.outer, a1), p(o.outer, a0), o.col);
  }
}

/** Deterministic per-index jitter. No `Math.random` anywhere in the build. */
export function hash01(i: number): number {
  return ((i * 2654435761) >>> 0) / 4294967296;
}

/** Two hashed streams from one index, for scatter that doesn't fall in a line. */
export function hash2(i: number, salt: number): number {
  return hash01(i * 73856093 + salt * 19349663 + 1);
}

export interface BlobOpts {
  at: Vec3;
  rMin: number;
  rMax: number;
  segments: number;
  height: number;
  col: Color;
  seed?: number;
}

/**
 * An irregular disc — a spilled pool. The irregularity is the whole point: a
 * perfect circle of tar reads as a decal, a lumpy one reads as a liquid that
 * found the low ground.
 */
export function blob(s: Sink, o: BlobOpts): void {
  const seg = Math.max(6, o.segments);
  const seed = o.seed ?? 0;
  const [cx, cy, cz] = o.at;
  const radii: number[] = [];
  for (let i = 0; i < seg; i++) {
    radii.push(o.rMin + (o.rMax - o.rMin) * hash01(i + seed * 97 + 1));
  }
  const p = (i: number, y: number): Vec3 => {
    const a = (i / seg) * Math.PI * 2;
    const r = radii[i % seg];
    return [cx + Math.cos(a) * r, cy + y, cz + Math.sin(a) * r];
  };
  const centre: Vec3 = [cx, cy + o.height, cz];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    // Top surface — j before i, so it faces up.
    tri(s, centre, p(j, o.height), p(i, o.height), o.col);
    // A short rim, so the pool has an edge to catch the light.
    quad(s, p(i, 0), p(i, o.height), p(j, o.height), p(j, 0), o.col);
  }
}

/* ── assembly ────────────────────────────────────────────────────────────── */

/** Turn a filled sink into a geometry. No indices: flat normals need none. */
export function finish(s: Sink): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(s.pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(s.nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(s.col), 3));
  g.computeBoundingSphere();
  return g;
}

/** Author into a fresh sink and hand back the geometry. The common case. */
export function buildGeometry(
  fn: (s: Sink) => void,
  shade: Shading = PROP_SHADE,
  yBias = 0,
): BufferGeometry {
  const s = createSink(shade, yBias);
  fn(s);
  return finish(s);
}
