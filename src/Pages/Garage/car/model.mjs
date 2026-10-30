import {
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { DIM, T, T_TOP, bodyPoint, centreTop, endX, sideZ, stations, topY } from "./shape.mjs";

/*
 * Builds the Golf R as a three.js Group. Geometry only: every mesh carries
 * userData.mat (a material key the renderer resolves) and, for the parts a mod
 * touches, userData.part (the ids in mods.mjs). The browser's scene
 * (scene.mjs) swaps in real materials; scripts/car-preview.mjs shades the same
 * meshes in software, which is how the shape gets checked without a browser.
 *
 * The skin comes from shape.mjs. Everything bolted on is placed against it:
 * lights and badges are projected onto the nose and tail, vents onto the
 * hood, handles sit on the shoulder, the spoiler is bent to the roof's crown.
 *
 * It's this car, not a showroom one: the turquoise wrap, six-spoke wheels,
 * the vented forged hood with sky blue flake, black tips, the finned diffuser,
 * rain visors, dark tint and the quarter-glass stickers. Stickers are meshes with
 * userData.sticker, a text layout the scene paints onto a canvas. Plates carry
 * the province, never the number, and nothing here carries the VIN.
 */

const PLACEHOLDER = new MeshBasicMaterial();

/** Material keys that make up the body and what's glued to it: what an x-ray fades. */
export const SHELL = new Set([
  "paint", "under", "trim", "gloss", "glass", "tint", "visor", "lens", "lamp", "chrome", "forged",
  "forgedFlake", "carbon", "tail", "tailLed", "drl", "amber", "interior", "leather", "mirror", "plastic",
  "sticker", "sensor",
]);

/** Lowered: the body sits this much nearer the wheels than a stock Golf R. */
export const RIDE_DROP = 0.03;

function mesh(geometry, mat, part) {
  const m = new Mesh(geometry, PLACEHOLDER);
  m.userData.mat = mat;
  if (part) m.userData.part = part;
  return m;
}

const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
const lerp = (a, b, k) => a + (b - a) * k;

/* ------------------------------------------------------- geometry tools -- */

function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    g.index.needsUpdate = true;
    return g;
  }
  for (const attr of Object.values(g.attributes)) {
    const s = attr.itemSize;
    const a = attr.array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let k = 0; k < s; k++) {
        const j1 = (i + 1) * s + k;
        const j2 = (i + 2) * s + k;
        [a[j1], a[j2]] = [a[j2], a[j1]];
      }
    }
    attr.needsUpdate = true;
  }
  return g;
}

/** The mirror image of a +z geometry, for the -z (driver's) side. */
function toRight(g) {
  const m = g.clone();
  m.scale(1, 1, -1);
  return flipWinding(m);
}

/** The geometry plus its mirror image across the centreline. */
function both(g) {
  return mergeGeometries([g, toRight(g)]);
}

/** Make the geometry's faces point (on average) along dir. */
function orient(g, dir) {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < n.count; i++) dot += n.getX(i) * dir[0] + n.getY(i) * dir[1] + n.getZ(i) * dir[2];
  if (dot < 0) {
    flipWinding(g);
    g.computeVertexNormals();
  }
  return g;
}

/** Push every vertex along its normal (positive = outwards), then re-derive normals. */
function lift(g, d) {
  if (!d) return g;
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Split every triangle into four, `times` over (non-indexed in, non-indexed out). */
function subdivide(g, times) {
  let pos = Array.from(g.attributes.position.array);
  for (let k = 0; k < times; k++) {
    const next = [];
    for (let i = 0; i < pos.length; i += 9) {
      const a = pos.slice(i, i + 3);
      const b = pos.slice(i + 3, i + 6);
      const c = pos.slice(i + 6, i + 9);
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca);
    }
    pos = next;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return out;
}

/** Planar UVs from two world axes, `scale` repeats per metre. For the carbon weave. */
function planarUV(g, a = "x", b = "z", scale = 8) {
  const p = g.attributes.position;
  const uv = [];
  for (let i = 0; i < p.count; i++) {
    const v = { x: p.getX(i), y: p.getY(i), z: p.getZ(i) };
    uv.push(v[a] * scale, v[b] * scale);
  }
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * UVs stretched 0..1 over the geometry's extent, for a sticker's text: u runs
 * along axis `u[0]` (u[1] = -1 runs it backwards, so the text reads from
 * outside), v along `v[0]`.
 */
function boxUV(g, u, v) {
  const p = g.attributes.position;
  const get = (axis, i) => (axis === "x" ? p.getX(i) : axis === "y" ? p.getY(i) : p.getZ(i));
  const span = (axis) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.count; i++) {
      lo = Math.min(lo, get(axis, i));
      hi = Math.max(hi, get(axis, i));
    }
    return [lo, hi - lo || 1];
  };
  const [u0, us] = span(u[0]);
  const [v0, vs] = span(v[0]);
  const uv = [];
  for (let i = 0; i < p.count; i++) {
    const a = (get(u[0], i) - u0) / us;
    const b = (get(v[0], i) - v0) / vs;
    uv.push(u[1] < 0 ? 1 - a : a, v[1] < 0 ? 1 - b : b);
  }
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

function sticker(geo, spec, u, v, part) {
  const m = mesh(boxUV(geo, u, v), "sticker", part);
  m.userData.sticker = spec;
  return m;
}

function rbox(w, h, d, r = 0.01, x = 0, y = 0, z = 0, segments = 2) {
  const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
  g.translate(x, y, z);
  return g;
}

function cyl(r1, r2, len, x, y, z, axis = "y", seg = 24, open = false) {
  const g = new CylinderGeometry(r1, r2, len, seg, 1, open);
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function tube(points, r, seg = 48, radial = 14) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)), false, "centripetal");
  return new TubeGeometry(curve, seg, r, radial, false);
}

/** A flat-shaded six-sided solid from 8 corners (front quad 0-3, back quad 4-7, same order). */
function block(c) {
  const quads = [
    [0, 1, 2, 3],
    [7, 6, 5, 4],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  const mid = c.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
  const pos = [];
  for (const [a, b, d, e] of quads) {
    for (const tri of [
      [a, b, d],
      [a, d, e],
    ]) {
      const [p, q, r] = tri.map((i) => c[i]);
      const n = new Vector3(...q).sub(new Vector3(...p)).cross(new Vector3(...r).sub(new Vector3(...p)));
      const out = new Vector3(...p).sub(new Vector3(...mid));
      pos.push(...(n.dot(out) >= 0 ? [...p, ...q, ...r] : [...p, ...r, ...q]));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A rounded rectangle as a Shape (or a hole Path). */
function roundRect(x0, y0, x1, y1, r, into = new Shape()) {
  into.moveTo(x0 + r, y0);
  into.lineTo(x1 - r, y0);
  into.quadraticCurveTo(x1, y0, x1, y0 + r);
  into.lineTo(x1, y1 - r);
  into.quadraticCurveTo(x1, y1, x1 - r, y1);
  into.lineTo(x0 + r, y1);
  into.quadraticCurveTo(x0, y1, x0, y1 - r);
  into.lineTo(x0, y0 + r);
  into.quadraticCurveTo(x0, y0, x0 + r, y0);
  return into;
}

/** A polyline thickened into a ribbon outline, for shut lines. */
function ribbon(points, width) {
  const left = [];
  const right = [];
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (width / 2);
    const ny = (dx / l) * (width / 2);
    left.push([p[0] + nx, p[1] + ny]);
    right.unshift([p[0] - nx, p[1] - ny]);
  });
  return [...left, ...right];
}

/* -------------------------------------------------------------- the skin -- */

/*
 * A grid of rows (t) by columns (x), by default both halves of the car in one
 * geometry; `side` 1 or -1 builds only the +z (passenger) or -z (driver's)
 * half. The -z half mirrors z and reverses winding so both face outwards. Normals on the
 * centreline are squared off so the halves shade as one surface.
 */
function grid(rows, { side = 0, flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos = [];
  const uv = [];
  const idx = [];
  (side ? [side] : [1, -1]).forEach((s, h) => {
    const base = h * nr * nc;
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const p = rows[r][c];
        pos.push(p[0], p[1], p[2] * s);
        uv.push(c / (nc - 1), r / (nr - 1));
      }
    }
    const out = (s > 0) !== flip;
    for (let r = 0; r < nr - 1; r++) {
      for (let c = 0; c < nc - 1; c++) {
        const a = base + r * nc + c;
        const b = a + 1;
        const d = a + nc;
        const e = d + 1;
        if (out) idx.push(a, b, d, b, e, d);
        else idx.push(a, d, b, b, d, e);
      }
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    if (Math.abs(pos[i * 3 + 2]) < 1e-6) {
      const l = Math.hypot(n.getX(i), n.getY(i)) || 1;
      n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, 0);
    }
  }
  return g;
}

const STATIONS = stations();

/*
 * A patch of the skin between x0..x1 and t0..t1. x0/x1 may be functions of t
 * for slanted edges (x is then sampled evenly); fixed edges reuse the shared
 * stations so the arch openings stay crisp. `offset` moves it off the skin
 * along the normal: decals and trim sit proud, liners sit inside.
 */
function skin({ x0, x1, t0, t1, nt, nx = 40, offset = 0, side = 0, flip = false }) {
  const ts = range(t0, t1, nt || Math.max(2, Math.ceil((t1 - t0) * 10)));
  let rows;
  if (typeof x0 === "number" && typeof x1 === "number") {
    const xs = [x0, ...STATIONS.filter((x) => x > x0 + 1e-4 && x < x1 - 1e-4), x1];
    rows = ts.map((t) => xs.map((x) => bodyPoint(x, t)));
  } else {
    const f0 = typeof x0 === "number" ? () => x0 : x0;
    const f1 = typeof x1 === "number" ? () => x1 : x1;
    rows = ts.map((t) => range(f0(t), f1(t), nx).map((x) => bodyPoint(x, t)));
  }
  return lift(grid(rows, { side, flip }), offset);
}

/** Tessellate an outline (array of [a, b] or a Shape with holes) so it can bend to the skin. */
function flat(outline, subdiv) {
  const shape = outline instanceof Shape ? outline : new Shape(outline.map(([a, b]) => new Vector2(a, b)));
  return mergeVertices(subdivide(new ShapeGeometry(shape, 8).toNonIndexed(), subdiv), 1e-6);
}

/*
 * A flat outline wrapped onto the nose (dir 1) or tail (dir -1): drawn in
 * [z, y] as seen end-on, tessellated, then each vertex pushed onto the skin.
 */
function endDecal(outline, dir, { offset = 0.002, mirror = true, subdiv = 2 } = {}) {
  const g = flat(outline, subdiv);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getX(i);
    const y = p.getY(i);
    const x = endX(y, z, dir);
    p.setXYZ(i, x === null ? (dir > 0 ? 2.0 : -1.95) : x, y, z);
  }
  lift(orient(g, [dir, 0, 0]), offset);
  return mirror ? both(g) : g;
}

/** A flat outline drawn in [x, y] from the side, wrapped onto the +z flank; side -1 the -z flank, 0 both. */
function sideDecal(outline, { offset = 0.002, subdiv = 2, side = 0 } = {}) {
  const g = flat(outline, subdiv);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setXYZ(i, x, y, sideZ(x, y) ?? 0.85);
  }
  lift(orient(g, [0, 0, 1]), offset);
  return side === 0 ? both(g) : side < 0 ? toRight(g) : g;
}

/** A flat outline drawn in [x, z] from above, laid onto the hood or roof (and mirrored). */
function topDecal(outline, { offset = 0.002, subdiv = 2, mirror = true } = {}) {
  const g = flat(outline, subdiv);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getY(i);
    p.setXYZ(i, x, topY(x, z), z);
  }
  lift(orient(g, [0, 1, 0]), offset);
  return mirror ? both(g) : g;
}

/** Close the skin at the very nose or tail with a fan across the last section. */
function cap(x, dir) {
  const ring = range(0, T_TOP, 90).map((t) => bodyPoint(x, t));
  const c = [x, (ring[0][1] + ring[ring.length - 1][1]) / 2, 0];
  const pos = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    pos.push(...c, ...a, ...b, ...c, b[0], b[1], -b[2], a[0], a[1], -a[2]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  return orient(g, [dir, 0, 0]);
}

/** A shallow spherical dome of base radius r and height h, facing dir along x from (x, y, 0). */
function dome(r, h, x, y, dir) {
  const R = (r * r + h * h) / (2 * h);
  const g = new SphereGeometry(R, 40, 6, 0, Math.PI * 2, 0, Math.asin(r / R));
  g.rotateZ((-dir * Math.PI) / 2);
  g.translate(x - dir * (R - h), y, 0);
  return g;
}

/** An annulus as a Shape with a hole, for chrome bezels. */
function bezel(cz, cy, r0, r1, n = 28) {
  const s = new Shape(circle(cz, cy, r1, n).map(([a, b]) => new Vector2(a, b)));
  s.holes.push(new Path(circle(cz, cy, r0, n).map(([a, b]) => new Vector2(a, b))));
  return s;
}

function circle(cz, cy, r, n = 20) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cz + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/* --------------------------------------------------------------- stickers -- */

// Text layouts for the scene to paint: y and size are fractions of the
// canvas height, x of its width. Fonts are generic families, not the real
// logotypes, so the stickers read as this car's without copying anyone's artwork.
const STICKER = {
  sponsors: {
    w: 512,
    h: 704,
    lines: [
      { text: "COBB", y: 0.17, size: 0.17, style: "italic 900", max: 0.8 },
      { text: "HPtuners", y: 0.4, size: 0.15, style: "italic 800", max: 0.86 },
      { text: "FAST", y: 0.64, size: 0.2, style: "italic 900", max: 0.86 },
      { text: "W H E E L S", y: 0.8, size: 0.055, style: "700", font: "sans", max: 0.7 },
    ],
  },
  donut: {
    w: 512,
    h: 704,
    rects: [
      { x: 0.1, y: 0.16, w: 0.045, h: 0.2 },
      { x: 0.18, y: 0.16, w: 0.045, h: 0.2 },
    ],
    lines: [
      { text: "WOLFSBURG", y: 0.2, x: 0.64, size: 0.07, style: "700", font: "sans", max: 0.6 },
      { text: "#1092", y: 0.3, x: 0.64, size: 0.07, style: "700", font: "sans", max: 0.6 },
      { text: "Donut", y: 0.55, size: 0.24, style: "700", font: "script", max: 0.9 },
    ],
  },
  badgeR: { w: 128, h: 128, lines: [{ text: "R", y: 0.55, size: 0.9, style: "italic 800", color: "#e2e6ea", max: 0.9 }] },
  plateFront: {
    w: 512,
    h: 256,
    bg: "#f3f4f0",
    border: "#1e3f94",
    lines: [
      { text: "ONTARIO", y: 0.17, size: 0.15, style: "600", font: "serif", color: "#1e3f94" },
      { text: "YOURS TO DISCOVER", y: 0.87, size: 0.09, style: "600", font: "sans", color: "#1e3f94" },
    ],
  },
  plateRear: {
    w: 512,
    h: 256,
    bg: "#f3f4f0",
    border: "#121212",
    bands: [{ y0: 0.8, y1: 1, color: "#121212" }],
    lines: [
      { text: "ONTARIO", y: 0.15, size: 0.13, style: "600", font: "serif", color: "#1e3f94" },
      { text: "FUEL YOUR PASSION", y: 0.9, size: 0.12, style: "900", color: "#ffffff", max: 0.8 },
    ],
  },
};

/**
 * A flat plate on the nose (dir 1) or tail (dir -1), standing just proud of
 * the bumper and leaning with it, in a black surround.
 */
function plate(spec, dir, cz, cy, w = 0.305, h = 0.152) {
  const g = new Group();
  const zs = range(cz - w / 2, cz + w / 2, 6);
  const ys = range(cy - h / 2, cy + h / 2, 8);
  // How far out the bumper reaches at each height, then a plane leaning with
  // it, pushed out until it clears the bulge.
  const reach = ys.map((y) => Math.max(...zs.map((z) => dir * (endX(y, z, dir) ?? dir * 2))));
  const k = (reach[reach.length - 1] - reach[0]) / h;
  const out = Math.max(...ys.map((y, i) => reach[i] - (y - cy) * k)) + 0.012;
  const x = dir * out;
  const tilt = -dir * Math.atan(k);
  const face = new PlaneGeometry(w, h);
  face.rotateY((dir * Math.PI) / 2);
  face.rotateZ(tilt);
  face.translate(x, cy, cz);
  const m = mesh(face, "sticker");
  m.userData.sticker = spec;
  g.add(m);
  const frame = rbox(0.012, h + 0.016, w + 0.016, 0.004, 0, 0, 0);
  frame.rotateZ(tilt);
  frame.translate(x - dir * 0.007, cy, cz);
  g.add(mesh(frame, "trim"));
  return g;
}

/* --------------------------------------------------------------- landmarks -- */

export const X = {
  hoodRear: 0.7,
  hoodFront: 2.04,
  cowl: 0.62,
  roofFront: -0.2,
  roofRear: -1.8,
  glassBottom: -1.982,
  bFront: -0.37,
  bRear: -0.45,
  doorFront: 0.86,
  doorSplit: -0.41,
  doorRear: -0.93,
  quarter: -0.985, // the rear door glass's fixed quarter pane starts behind this bar
};
const WIN = { lo: T.belt + 0.04, hi: T.roofEdge - 0.14 };
// The rear door glass's trailing edge leans forward as it rises.
const rearGlassEdge = (t) => lerp(-1.3, -1.1, (t - T.belt) / (T.roofEdge - T.belt));
// The rear door's shut line climbs the front of the arch, then follows the glass.
const rearDoorEdge = (t) => (t < 4.7 ? X.doorRear : lerp(X.doorRear, -1.31, (t - 4.7) / (T.belt - 4.7)));

/* ------------------------------------------------------------------- body -- */

function body() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));
  const wrap = (geo) => add(geo, "paint", "wrap");

  // Floor and wheel wells, then the painted flanks from arch lip to beltline.
  add(skin({ x0: DIM.rear + 0.1, x1: DIM.front - 0.1, t0: 0, t1: T.lip, nt: 12 }), "under");
  wrap(skin({ x0: DIM.front - 0.1, x1: DIM.front, t0: 0, t1: T.lip, nt: 24 }));
  wrap(skin({ x0: DIM.rear, x1: DIM.rear + 0.1, t0: 0, t1: T.lip, nt: 24 }));
  wrap(skin({ x0: DIM.rear, x1: DIM.front, t0: T.lip, t1: T.belt, nt: 30 }));
  wrap(cap(DIM.front, 1));
  wrap(cap(DIM.rear, -1));

  // Nose above the beltline (the grille and lights land on this), the cowl.
  wrap(skin({ x0: X.hoodFront + 0.004, x1: DIM.front, t0: T.belt, t1: T_TOP, nt: 30 }));
  add(skin({ x0: X.cowl, x1: X.hoodRear, t0: T.belt, t1: T_TOP, nt: 30, offset: -0.004 }), "trim");

  // Windshield, A-pillars, roof.
  add(skin({ x0: X.roofFront, x1: X.cowl, t0: 7.25, t1: T_TOP, nt: 24, offset: -0.003 }), "glass");
  wrap(skin({ x0: X.roofFront, x1: X.cowl, t0: 6.86, t1: 7.25, nt: 6 }));
  wrap(skin({ x0: X.roofRear, x1: X.roofFront, t0: 6.86, t1: T_TOP, nt: 28 }));

  // Side glass, tinted dark, in black frames; the B-pillar; the quarter-pane
  // bar in the rear door; the C-pillar in paint.
  add(skin({ x0: X.bFront, x1: 0.6, t0: WIN.lo, t1: WIN.hi, nt: 10, offset: -0.004 }), "tint");
  add(skin({ x0: rearGlassEdge, x1: X.bRear, t0: WIN.lo, t1: WIN.hi, nt: 10, offset: -0.004 }), "tint");
  const frameRear = (t) => rearGlassEdge(t) - 0.018;
  add(skin({ x0: frameRear, x1: X.cowl, t0: T.belt, t1: WIN.lo, nt: 2, nx: 120, offset: -0.001 }), "trim");
  add(skin({ x0: frameRear, x1: X.cowl, t0: WIN.hi, t1: 6.86, nt: 2, nx: 160, offset: -0.001 }), "trim");
  add(skin({ x0: X.bRear, x1: X.bFront, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 4, offset: -0.001 }), "gloss");
  add(skin({ x0: X.quarter - 0.022, x1: X.quarter, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 2, offset: -0.0015 }), "gloss");
  add(skin({ x0: 0.6, x1: X.cowl, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 4, offset: -0.001 }), "trim");
  add(skin({ x0: frameRear, x1: rearGlassEdge, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 3, offset: -0.001 }), "trim");
  wrap(skin({ x0: X.glassBottom, x1: frameRear, t0: T.belt, t1: 6.86, nt: 10, nx: 40 }));

  // Rain visors over both door windows, running down the A-pillar.
  add(skin({ x0: (t) => rearGlassEdge(t) - 0.01, x1: 0.42, t0: WIN.hi - 0.04, t1: WIN.hi + 0.09, nt: 3, nx: 120, offset: 0.012 }), "visor");

  // Hatch: C-pillar wrap, a black frit band, the glass; the tailgate below it.
  wrap(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 6.86, t1: 7.12, nt: 4 }));
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.12, t1: 7.32, nt: 3, offset: -0.001 }), "trim");
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.32, t1: T_TOP, nt: 22, offset: -0.003 }), "tint");
  wrap(skin({ x0: DIM.rear, x1: X.glassBottom, t0: T.belt, t1: T_TOP, nt: 30 }));
  add(skin({ x0: X.glassBottom, x1: X.glassBottom + 0.012, t0: 7.12, t1: T_TOP, nt: 16, offset: 0.0008 }), "trim");

  // Shut lines: doors, hood edge, door bottoms.
  const line = (geo) => add(geo, "trim");
  for (const x of [X.doorFront, X.doorSplit]) {
    line(skin({ x0: x - 0.002, x1: x + 0.002, t0: T.rocker, t1: T.belt, nt: 24, offset: 0.0008 }));
  }
  line(skin({ x0: (t) => rearDoorEdge(t) - 0.002, x1: (t) => rearDoorEdge(t) + 0.002, t0: T.rocker, t1: T.belt, nt: 30, nx: 1, offset: 0.0008 }));
  line(skin({ x0: rearDoorEdge(T.rocker), x1: X.doorFront, t0: T.rocker - 0.035, t1: T.rocker, nt: 1, offset: 0.0008 }));
  line(skin({ x0: X.hoodRear, x1: X.hoodFront + 0.004, t0: T.belt - 0.04, t1: T.belt, nt: 1, offset: 0.0008 }));

  // Fuel door, on the passenger side's rear quarter.
  const door = roundRect(-1.63, 0.79, -1.42, 0.925, 0.035);
  door.holes.push(roundRect(-1.627, 0.793, -1.423, 0.922, 0.032, new Path()));
  line(sideDecal(door, { side: 1, offset: 0.0008, subdiv: 1 }));

  // Liners: the inside of the cabin is dark, not body colour. (Flipped, so a
  // positive offset moves them inwards.)
  add(skin({ x0: X.roofRear, x1: X.cowl, t0: T.lip, t1: T.belt, nt: 6, offset: 0.02, flip: true }), "interior");
  add(skin({ x0: X.roofRear, x1: X.roofFront, t0: 6.86, t1: T_TOP, nt: 6, offset: 0.03, flip: true }), "interior");

  // Door handles on the shoulder, R badges on the front wings.
  for (const x of [-0.16, -1.04]) {
    const [, y, z] = bodyPoint(x, T.shoulder - 0.12);
    const handle = mesh(both(rbox(0.15, 0.028, 0.026, 0.011, x, y, z + 0.004)), "paint", "wrap");
    handle.name = "handle";
    g.add(handle);
  }
  const fender = [[0.9, 0.772], [0.958, 0.772], [0.958, 0.8], [0.9, 0.8]];
  g.add(sticker(sideDecal(fender, { side: 1, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["x", 1], ["y", 1]));
  g.add(sticker(sideDecal(fender, { side: -1, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["x", -1], ["y", 1]));

  // Stickers: the sponsor stack on the driver's quarter pane, Donut on the
  // passenger's. (u runs towards the viewer's right on each side.) The
  // windshield and hatch glass stay clear.
  const pane = { x0: -1.165, x1: X.quarter - 0.03, t0: 6.12, t1: 6.6, nt: 6, nx: 12, offset: -0.0025 };
  g.add(sticker(skin({ ...pane, side: -1 }), STICKER.sponsors, ["x", -1], ["y", 1]));
  g.add(sticker(skin({ ...pane, side: 1 }), STICKER.donut, ["x", 1], ["y", 1]));

  // Shark-fin aerial at the back of the roof.
  const fin = new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  fin.scale(0.085, 0.055, 0.025);
  fin.translate(-1.58, topY(-1.58, 0) - 0.004, 0);
  add(fin, "gloss");
  return g;
}

/*
 * The hood swings on a hinge at the cowl. Forged carbon with sky blue flake,
 * and two louvred heat extractors either side of the centre.
 */
function hood() {
  const pivot = new Group();
  pivot.position.set(X.hoodRear, centreTop(X.hoodRear), 0);
  const place = (geo) => geo.translate(-pivot.position.x, -pivot.position.y, 0);
  const add = (geo, mat, part = "hood") => pivot.add(mesh(place(geo), mat, part));

  add(planarUV(skin({ x0: X.hoodRear + 0.004, x1: X.hoodFront, t0: T.belt, t1: T_TOP, nt: 30 }), "x", "z", 2.4), "forgedFlake");
  // Underside, so the open hood isn't see-through.
  add(skin({ x0: X.hoodRear + 0.02, x1: X.hoodFront - 0.02, t0: T.belt + 0.1, t1: T_TOP, nt: 8, offset: 0.012, flip: true }), "plastic", null);

  const vent = [[0.93, 0.27], [1.2, 0.25], [1.25, 0.47], [0.99, 0.5]];
  add(topDecal(vent, { offset: 0.002 }), "trim");
  for (let k = 0; k < 4; k++) {
    const x = lerp(0.98, 1.19, k / 3);
    const z = lerp(0.265, 0.485, 0.5) + (x - 1.08) * 0.08;
    add(both(rbox(0.022, 0.012, 0.19, 0.004, x, topY(x, z) + 0.009, z)), "gloss");
  }
  return pivot;
}

/* ------------------------------------------------------------ nose & tail -- */

function nose() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Upper grille between the lights, its slats, the blacked-out roundel in its
  // chrome ring, and the R on the passenger side.
  add(endDecal([[-0.43, 0.705], [0.43, 0.705], [0.43, 0.8], [-0.43, 0.8]], 1, { mirror: false, offset: 0.003 }), "gloss");
  for (const y of [0.73, 0.758]) {
    add(endDecal([[-0.42, y], [0.42, y], [0.42, y + 0.006], [-0.42, y + 0.006]], 1, { mirror: false, offset: 0.0045 }), "trim");
  }
  const bx = endX(0.735, 0, 1);
  const ring = new TorusGeometry(0.064, 0.006, 8, 40);
  ring.rotateY(Math.PI / 2);
  ring.translate(bx + 0.012, 0.735, 0);
  add(ring, "chrome");
  add(dome(0.062, 0.01, bx + 0.008, 0.735, 1), "gloss");
  g.add(sticker(endDecal([[0.285, 0.708], [0.335, 0.708], [0.335, 0.733], [0.285, 0.733]], 1, { mirror: false, offset: 0.006, subdiv: 1 }), STICKER.badgeR, ["z", -1], ["y", 1]));

  // Headlights: wide smoked wedges carrying the grille's line out to the
  // corners and round them, a chrome projector, the LED strip along the bottom.
  const head = [[0.43, 0.67], [0.43, 0.8], [0.62, 0.815], [0.8, 0.812], [0.848, 0.78], [0.835, 0.72], [0.7, 0.67]];
  add(endDecal(head, 1, { offset: 0.003, subdiv: 3 }), "lamp");
  add(endDecal([[0.46, 0.68], [0.7, 0.68], [0.83, 0.725], [0.826, 0.74], [0.69, 0.696], [0.46, 0.696]], 1, { offset: 0.006 }), "drl");
  add(endDecal(circle(0.63, 0.752, 0.03), 1, { offset: 0.006 }), "trim");
  add(endDecal(bezel(0.63, 0.752, 0.03, 0.038), 1, { offset: 0.006, subdiv: 1 }), "chrome");
  add(endDecal(head, 1, { offset: 0.009, subdiv: 3 }), "lens");

  // Lower bumper: the wide slatted grille, and the side intakes split by two
  // body-colour blades each.
  add(endDecal([[-0.42, 0.405], [0.42, 0.405], [0.46, 0.235], [-0.46, 0.235]], 1, { mirror: false, offset: 0.003 }), "trim");
  for (const y of [0.29, 0.33, 0.37]) {
    add(endDecal([[-0.44, y], [0.44, y], [0.44, y + 0.007], [-0.44, y + 0.007]], 1, { mirror: false, offset: 0.0045 }), "gloss");
  }
  add(endDecal([[0.48, 0.47], [0.7, 0.5], [0.79, 0.45], [0.79, 0.27], [0.53, 0.235], [0.46, 0.29]], 1, { offset: 0.003 }), "trim");
  add(endDecal([[0.47, 0.41], [0.79, 0.418], [0.79, 0.438], [0.47, 0.43]], 1, { offset: 0.006 }), "paint", "wrap");
  add(endDecal([[0.49, 0.335], [0.79, 0.343], [0.79, 0.362], [0.49, 0.355]], 1, { offset: 0.006 }), "paint", "wrap");

  // The plate sits off-centre on the lower grille, on the passenger side.
  g.add(plate(STICKER.plateFront, 1, 0.27, 0.33));

  // Parking sensors along the bumper bar.
  for (const z of [0.2, 0.52]) add(endDecal(circle(z, 0.49, 0.012, 14), 1, { offset: 0.0025, subdiv: 1 }), "sensor");

  // Splitter lip along the bottom.
  const lip = [];
  for (let z = -0.8; z <= 0.8001; z += 0.04) {
    const x = endX(0.2, z, 1) ?? 2.1;
    lip.push(new Vector2(x + 0.018, z));
  }
  for (let z = 0.8; z >= -0.8001; z -= 0.04) lip.push(new Vector2((endX(0.2, z, 1) ?? 2.1) - 0.05, z));
  const blade = new ExtrudeGeometry(new Shape(lip), { depth: 0.014, bevelEnabled: false });
  blade.rotateX(Math.PI / 2);
  blade.translate(0, 0.2, 0);
  add(blade, "gloss");

  // Amber side markers at the corners (North American spec).
  add(sideDecal([[1.97, 0.5], [2.06, 0.505], [2.06, 0.525], [1.97, 0.52]], { offset: 0.002, subdiv: 1 }), "amber");
  return g;
}

function tail() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Tail lights: big wedges under the glass that wrap a long way round the
  // flank, with the R's L-shaped LED.
  const lamp = [[0.3, 0.892], [0.3, 0.962], [0.6, 0.983], [0.84, 0.978], [0.852, 0.858], [0.66, 0.852], [0.48, 0.872]];
  add(endDecal(lamp, -1, { offset: 0.003, subdiv: 3 }), "tail");
  add(endDecal([[0.38, 0.928], [0.8, 0.94], [0.8, 0.951], [0.38, 0.939]], -1, { offset: 0.006 }), "tailLed");
  add(endDecal([[0.785, 0.875], [0.8, 0.875], [0.8, 0.951], [0.785, 0.951]], -1, { offset: 0.006 }), "tailLed");
  add(sideDecal([[-1.972, 0.853], [-1.87, 0.87], [-1.75, 0.918], [-1.785, 0.95], [-1.972, 0.985]], { offset: 0.003, subdiv: 3 }), "tail");
  add(sideDecal([[-1.965, 0.928], [-1.8, 0.932], [-1.8, 0.942], [-1.965, 0.94]], { offset: 0.006, subdiv: 1 }), "tailLed");

  // Tailgate: its shut line, the blacked-out roundel, the R lower left.
  const gate = ribbon([[-0.32, 0.86], [-0.335, 0.72], [-0.3, 0.655], [0, 0.645], [0.3, 0.655], [0.335, 0.72], [0.32, 0.86]], 0.005);
  add(endDecal(gate, -1, { mirror: false, offset: 0.0008, subdiv: 1 }), "trim");
  const bx = endX(0.86, 0, -1);
  add(dome(0.058, 0.009, bx - 0.006, 0.86, -1), "gloss");
  g.add(sticker(endDecal([[-0.25, 0.695], [-0.2, 0.695], [-0.2, 0.72], [-0.25, 0.72]], -1, { mirror: false, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["z", 1], ["y", 1]));

  // Plate on the bumper, in its frame; parking sensors; reflectors; side markers.
  g.add(plate(STICKER.plateRear, -1, 0, 0.525));
  for (const z of [0.3, 0.62]) add(endDecal(circle(z, 0.6, 0.012, 14), -1, { offset: 0.0025, subdiv: 1 }), "sensor");
  add(endDecal([[0.6, 0.42], [0.8, 0.42], [0.8, 0.436], [0.6, 0.436]], -1, { offset: 0.003 }), "tail");
  add(sideDecal([[-2.04, 0.47], [-1.96, 0.475], [-1.96, 0.495], [-2.04, 0.49]], { offset: 0.002, subdiv: 1 }), "tail");

  // Rear wiper parked across the bottom of the glass.
  const wiper = rbox(0.012, 0.012, 0.34, 0.004, -1.966, 1.045, 0.12);
  add(wiper, "gloss");
  return g;
}

/* --------------------------------------------------------------- mirrors -- */

function mirror() {
  const g = new Group();
  const [, by, bz] = bodyPoint(0.5, T.belt);
  const cx = 0.47;
  const cy = by + 0.075;
  const cz = bz + 0.085;
  // Cap: the front half of a squashed ellipsoid, in forged carbon.
  const cap = new SphereGeometry(1, 32, 16, Math.PI / 2, Math.PI);
  cap.scale(0.075, 0.07, 0.11);
  cap.translate(cx, cy, cz);
  g.add(mesh(both(planarUV(cap, "z", "y", 3)), "forged", "mirrors"));
  const back = new CircleGeometry(1, 32);
  back.rotateY(-Math.PI / 2);
  back.scale(1, 0.07, 0.11);
  back.translate(cx - 0.001, cy, cz);
  g.add(mesh(both(back), "mirror"));
  g.add(mesh(both(rbox(0.07, 0.03, 0.1, 0.01, cx + 0.01, cy - 0.05, bz + 0.04)), "trim"));
  return g;
}

/* --------------------------------------------------------------- spoiler -- */

/*
 * A big roof wing that overhangs the glass, its trailing corners kicked up
 * into winglets, and fins down the sides of the glass.
 */
function spoiler() {
  const xa = X.roofRear + 0.06;
  const y0 = centreTop(xa);
  const profile = new Shape([
    new Vector2(xa, y0 - 0.004),
    new Vector2(-2.0, y0 - 0.032),
    new Vector2(-2.01, y0 - 0.052),
    new Vector2(-1.9, y0 - 0.075),
    new Vector2(X.roofRear - 0.02, y0 - 0.04),
  ]);
  const half = 0.57;
  const g = new ExtrudeGeometry(profile, {
    depth: half * 2,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.006,
    bevelSegments: 3,
    steps: 24,
  });
  g.translate(0, 0, -half);
  // Bend it to the roof: drop each vertex by how much the roof falls away from the centreline.
  const p = g.attributes.position;
  const crown = topY(xa, 0);
  for (let i = 0; i < p.count; i++) {
    const z = Math.max(-half, Math.min(half, p.getZ(i)));
    p.setY(i, p.getY(i) + (topY(xa, z) - crown));
  }
  g.computeVertexNormals();
  const out = new Group();
  out.add(mesh(planarUV(g, "x", "z", 7), "carbon", "spoiler"));

  const drop = topY(xa, half) - crown;
  const winglet = new Shape([
    new Vector2(-1.84, y0 - 0.016),
    new Vector2(-2.005, y0 - 0.034),
    new Vector2(-2.015, y0 + 0.05),
    new Vector2(-1.965, y0 + 0.042),
  ]);
  const wg = new ExtrudeGeometry(winglet, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
  wg.translate(0, drop, half - 0.014);
  out.add(mesh(planarUV(both(wg), "x", "y", 7), "carbon", "spoiler"));

  const fin = new Shape([
    new Vector2(X.roofRear + 0.02, 0),
    new Vector2(-1.97, -0.03),
    new Vector2(-1.93, -0.16),
    new Vector2(-1.88, -0.1),
  ]);
  const fg = new ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
  fg.translate(0, topY(xa, half - 0.02) - 0.03, half - 0.04);
  out.add(mesh(planarUV(both(fg), "x", "y", 7), "carbon", "spoiler"));
  return out;
}

/* --------------------------------------------------------- diffuser, tips -- */

const TIPS_Z = [0.475, 0.59];
const TIP_Y = 0.3;
const TIP_R = 0.05;

/*
 * Maxton-style: a gloss black blade under the bumper, six shark fins hanging
 * below it with sky blue tips, and flaps at the corners.
 */
function diffuser() {
  const g = new Group();
  const add = (geo, mat = "gloss") => g.add(mesh(geo, mat, "diffuser"));
  add(endDecal([[-0.42, 0.3], [0.42, 0.3], [0.42, 0.37], [-0.42, 0.37]], -1, { mirror: false, offset: 0.004 }));
  add(endDecal([[0.68, 0.3], [0.8, 0.31], [0.8, 0.37], [0.68, 0.37]], -1, { offset: 0.004 }));

  const sheet = (pts, depth) => {
    const s = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth, bevelEnabled: false });
    s.translate(0, 0, -depth / 2);
    return s;
  };
  for (const z of [0.07, 0.19, 0.31]) {
    const fin = sheet([[-1.93, 0.3], [-2.08, 0.3], [-2.105, 0.17], [-2.07, 0.155]], 0.008);
    fin.translate(0, 0, z);
    add(both(fin));
    const tip = sheet([[-2.07, 0.155], [-2.105, 0.17], [-2.1, 0.193], [-2.068, 0.18]], 0.0104);
    tip.translate(0, 0, z);
    add(both(tip), "paint");
  }
  const flap = sheet([[-1.88, 0.31], [-2.03, 0.31], [-2.045, 0.235], [-1.92, 0.22]], 0.01);
  flap.translate(0, 0, 0.775);
  add(both(flap));
  return g;
}

function exhaust() {
  const g = new Group();
  const add = (geo, mat = "steel") => g.add(mesh(geo, mat, "exhaust"));
  // From the downpipe's flange back down the tunnel, over the axle, into the silencer.
  add(tube([[0.38, 0.19, 0], [0, 0.19, 0.02], [-0.6, 0.2, 0.02], [-1.1, 0.24, 0], [-1.45, 0.25, 0]], 0.032));
  add(cyl(0.065, 0.065, 0.42, -0.45, 0.2, 0.02, "x"));
  add(cyl(0.085, 0.085, 0.86, -1.72, 0.27, 0, "z"));
  for (const z of TIPS_Z) {
    for (const s of [1, -1]) {
      add(tube([[-1.72, 0.27, s * (z - 0.06)], [-1.86, 0.29, s * z], [-1.995, TIP_Y, s * z]], 0.028, 12, 10));
      // Black tips, well proud of the bumper, with a dark throat.
      const x0 = -2.115;
      add(cyl(TIP_R, TIP_R, 0.12, x0 + 0.06, TIP_Y, s * z, "x", 32, true), "tip");
      add(cyl(TIP_R - 0.007, TIP_R - 0.007, 0.12, x0 + 0.06, TIP_Y, s * z, "x", 32, true), "trim");
      const lipRing = new TorusGeometry(TIP_R - 0.0035, 0.0035, 8, 32);
      lipRing.rotateY(Math.PI / 2);
      lipRing.translate(x0, TIP_Y, s * z);
      add(lipRing, "tip");
    }
  }
  return g;
}

/* ------------------------------------------------------------ engine bay -- */

/*
 * As it sits with the hood up: the TSI cover over the coils, the Unitronic
 * carbon airbox on the driver's side with its tube arching back to the turbo,
 * the battery behind it, coolant and washer bottles on the passenger side.
 */
function engine() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  add(rbox(0.07, 0.42, 1.12, 0.02, 1.93, 0.46, 0), "plastic"); // radiator support
  add(rbox(0.16, 0.025, 1.0, 0.008, 1.88, 0.695, 0), "plastic"); // slam-panel cover
  add(rbox(0.34, 0.36, 0.62, 0.04, 1.35, 0.43, 0.19), "engine"); // block
  add(rbox(0.3, 0.12, 0.6, 0.04, 1.35, 0.67, 0.19), "engine"); // head
  add(rbox(0.15, 0.24, 0.58, 0.04, 1.58, 0.56, 0.19), "plastic"); // intake manifold
  add(rbox(0.36, 0.3, 0.36, 0.06, 1.33, 0.4, -0.3), "engine"); // DSG
  add(rbox(0.02, 0.18, 0.4, 0.005, 1.15, 0.6, 0.25), "steel"); // turbo heat shield

  // The engine cover, over the coils; the scene fades it to show them.
  add(rbox(0.36, 0.09, 0.56, 0.04, 1.36, 0.8, 0.2), "cover");
  const logo = new TorusGeometry(0.032, 0.004, 6, 28);
  logo.rotateX(Math.PI / 2);
  logo.translate(1.36, 0.846, 0.3);
  add(logo, "cover");

  // APR coils, red tops on black bodies.
  for (let i = 0; i < 4; i++) {
    const z = 0.35 - i * 0.088;
    add(cyl(0.021, 0.021, 0.06, 1.35, 0.76, z, "y", 16), "plastic", "coils");
    add(rbox(0.07, 0.03, 0.05, 0.008, 1.35, 0.8, z), "red", "coils");
  }

  // Unitronic carbon airbox; snorkel forward to the slam panel.
  const box = rbox(0.42, 0.2, 0.32, 0.06, 1.55, 0.64, -0.28);
  add(planarUV(box, "x", "z", 7), "carbon", "intake");
  add(planarUV(tube([[1.74, 0.66, -0.34], [1.84, 0.66, -0.34], [1.88, 0.62, -0.32]], 0.04, 16, 12), "x", "z", 7), "carbon", "intake");

  // Turbo at the back of the block; the inlet arches from the airbox over to it.
  add(cyl(0.065, 0.065, 0.07, 1.12, 0.55, 0.02, "z", 24), "steel");
  add(cyl(0.055, 0.055, 0.07, 1.12, 0.52, 0.1, "z", 24), "steel");
  add(tube([[1.42, 0.72, -0.24], [1.28, 0.79, -0.2], [1.14, 0.76, -0.14], [1.06, 0.66, -0.04], [1.1, 0.57, 0.01]], 0.04), "inlet", "inlet");

  // Battery behind the airbox, the ECU beside it, the TCU on the gearbox:
  // the last two are the halves of the tune.
  add(rbox(0.26, 0.19, 0.18, 0.02, 0.96, 0.62, -0.4), "plastic");
  add(cyl(0.018, 0.018, 0.03, 0.9, 0.725, -0.35), "red");
  add(rbox(0.14, 0.12, 0.1, 0.01, 1.17, 0.66, -0.48), "ecu", "tune");
  add(rbox(0.06, 0.14, 0.22, 0.01, 1.53, 0.38, -0.3), "ecu", "tune");

  // Coolant and washer bottles on the passenger side.
  add(rbox(0.18, 0.15, 0.2, 0.04, 0.95, 0.62, 0.42), "reservoir");
  add(cyl(0.04, 0.04, 0.03, 0.95, 0.71, 0.42), "plastic");
  add(rbox(0.16, 0.16, 0.14, 0.03, 1.72, 0.57, 0.47), "reservoir");
  add(cyl(0.028, 0.028, 0.03, 1.72, 0.665, 0.47), "blue");

  // Strut tops and the scuttle panel.
  for (const z of [0.5, -0.5]) add(cyl(0.07, 0.07, 0.06, 1.3, 0.76, z), "plastic");
  add(rbox(0.06, 0.12, 1.2, 0.02, 0.76, 0.84, 0), "plastic");
  return g;
}

function downpipe() {
  const g = new Group();
  g.add(
    mesh(
      tube([[1.1, 0.46, 0.13], [1.04, 0.38, 0.14], [0.94, 0.28, 0.1], [0.78, 0.21, 0.04], [0.55, 0.19, 0.01], [0.38, 0.19, 0]], 0.038),
      "steel",
      "downpipe"
    )
  );
  g.add(mesh(cyl(0.062, 0.062, 0.2, 0.66, 0.2, 0.02, "x"), "steel", "downpipe"));
  return g;
}

/* --------------------------------------------------------------- interior -- */

const WHEEL = { x: 0.1, y: 0.94, z: -0.37, r: 0.18, tilt: -0.38 };

function steeringWheel() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));
  // Rim in four arcs: forged carbon top and flat bottom, leather at the grips.
  const arcs = [
    [0.85, 2.29, "forged"],
    [2.29, 4.11, "leather"],
    [4.11, 5.31, "forged"],
    [5.31, 7.13, "leather"],
  ];
  for (const [a0, a1, mat] of arcs) {
    const t = new TorusGeometry(WHEEL.r, 0.017, 12, 40, a1 - a0);
    t.rotateZ(a0);
    add(mat === "forged" ? planarUV(t, "x", "y", 5) : t, mat, "steering");
  }
  // Spokes and the boss.
  add(rbox(0.26, 0.04, 0.03, 0.012, 0, -0.01, 0), "leather");
  add(rbox(0.04, 0.12, 0.03, 0.012, 0, -0.1, 0), "leather");
  add(cyl(0.055, 0.06, 0.05, 0, -0.01, -0.012, "z", 24), "leather");
  // Paddles behind the rim.
  for (const s of [1, -1]) {
    const p = rbox(0.05, 0.1, 0.006, 0.003, s * 0.135, 0.02, -0.04);
    p.rotateZ(s * -0.25);
    add(planarUV(p, "x", "y", 7), "carbon", "paddles");
  }
  g.rotation.set(0, -Math.PI / 2, 0);
  const tilt = new Group();
  tilt.add(g);
  tilt.rotation.z = WHEEL.tilt;
  tilt.position.set(WHEEL.x, WHEEL.y, WHEEL.z);
  return tilt;
}

/** Black leather R buckets with deep bolsters, three headrests in the back. */
function interior() {
  const g = new Group();
  const add = (geo, mat) => g.add(mesh(geo, mat));
  add(rbox(0.42, 0.22, 1.42, 0.06, 0.4, 0.86, 0), "interior"); // dash
  add(rbox(0.2, 0.08, 0.3, 0.03, 0.26, 0.98, WHEEL.z), "interior"); // binnacle
  add(rbox(0.8, 0.22, 0.2, 0.04, -0.05, 0.5, 0), "interior"); // console
  add(cyl(0.025, 0.03, 0.3, 0.22, 0.88, WHEEL.z, "x", 12), "interior"); // column
  const seatBack = (w, h, d, dz) => {
    const b = rbox(w, h, d, 0.04, 0, 0.3, dz);
    b.rotateZ(0.22);
    return b;
  };
  for (const z of [0.37, -0.37]) {
    add(rbox(0.5, 0.12, 0.42, 0.05, -0.45, 0.42, z), "leather");
    for (const s of [1, -1]) add(rbox(0.46, 0.1, 0.08, 0.035, -0.45, 0.48, z + s * 0.22), "leather");
    const back = seatBack(0.12, 0.62, 0.4, 0);
    back.translate(-0.72, 0.47, z);
    add(back, "leather");
    for (const s of [1, -1]) {
      const bolster = seatBack(0.18, 0.5, 0.08, s * 0.22);
      bolster.translate(-0.7, 0.43, z);
      add(bolster, "leather");
    }
    add(rbox(0.1, 0.16, 0.26, 0.04, -0.86, 1.13, z), "leather");
  }
  add(rbox(0.5, 0.14, 1.14, 0.05, -1.3, 0.44, 0), "leather"); // rear bench
  const rb = rbox(0.12, 0.56, 1.14, 0.05, 0, 0, 0);
  rb.rotateZ(0.24);
  rb.translate(-1.55, 0.78, 0);
  add(rb, "leather");
  for (const z of [-0.4, 0, 0.4]) add(rbox(0.09, 0.12, z ? 0.24 : 0.2, 0.035, -1.66, 1.08, z), "leather");
  return g;
}

/* ---------------------------------------------------------------- wheels -- */

const RIM_R = 0.2286; // 18"

function lathe(points, segments = 48) {
  // Lathe spins around y; the wheel's axis is z.
  const g = new LatheGeometry(points.map(([r, w]) => new Vector2(r, w)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** One straight, wide spoke: deeper at the hub than at the rim, so the face is dished. */
function spoke(angle, w) {
  const r0 = 0.068;
  const r1 = RIM_R - 0.008;
  const h0 = 0.03;
  const h1 = 0.021;
  const f0 = w / 2 - 0.072;
  const f1 = w / 2 - 0.024;
  const d = 0.03;
  const g = block([
    [-h0, r0, f0],
    [h0, r0, f0],
    [h1, r1, f1],
    [-h1, r1, f1],
    [-h0, r0, f0 - d],
    [h0, r0, f0 - d],
    [h1, r1, f1 - d],
    [-h1, r1, f1 - d],
  ]);
  g.rotateZ(angle);
  return g;
}

/*
 * Superspeed six-spoke in gloss black: machined notches where each spoke
 * meets the lip, gold lug nuts round a black cap, on Firehawk Indy 500s.
 */
function wheel() {
  const w = DIM.tireW;
  const group = new Group();
  const add = (geo, mat, part = "wheels") => group.add(mesh(geo, mat, part));
  add(
    lathe(
      [
        [RIM_R + 0.005, -w / 2 + 0.01],
        [RIM_R + 0.02, -w / 2],
        [DIM.tireR - 0.035, -w / 2 - 0.004],
        [DIM.tireR - 0.008, -w / 2 + 0.022],
        [DIM.tireR, -w / 2 + 0.05],
        [DIM.tireR, w / 2 - 0.05],
        [DIM.tireR - 0.008, w / 2 - 0.022],
        [DIM.tireR - 0.035, w / 2 + 0.004],
        [RIM_R + 0.02, w / 2],
        [RIM_R + 0.005, w / 2 - 0.01],
      ],
      64
    ),
    "tire"
  );
  // Barrel and a stepped lip, open towards the outside face.
  add(
    lathe(
      [
        [RIM_R - 0.02, w / 2 - 0.03],
        [RIM_R - 0.012, w / 2 - 0.004],
        [RIM_R + 0.008, w / 2 - 0.002],
        [RIM_R + 0.012, w / 2 - 0.012],
        [RIM_R - 0.004, w / 2 - 0.03],
        [RIM_R + 0.004, -w / 2 + 0.012],
        [RIM_R - 0.012, -w / 2 + 0.02],
      ],
      64
    ),
    "wheel"
  );
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(spoke(a, w), "wheel");
    const notch = rbox(0.03, 0.007, 0.01, 0.001, 0, RIM_R - 0.013, w / 2 - 0.02, 1);
    notch.rotateZ(a);
    add(notch, "machined");
  }
  add(cyl(0.075, 0.08, 0.04, 0, 0, w / 2 - 0.065, "z", 30), "wheel");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    add(cyl(0.0095, 0.0095, 0.022, Math.cos(a) * 0.056, Math.sin(a) * 0.056, w / 2 - 0.04, "z", 6), "lug");
  }
  add(cyl(0.031, 0.031, 0.012, 0, 0, w / 2 - 0.042, "z", 24), "gloss");
  const capRing = new TorusGeometry(0.031, 0.002, 6, 24);
  capRing.translate(0, 0, w / 2 - 0.036);
  add(capRing, "machined");
  // Brake: disc and caliper behind the spokes.
  add(cyl(0.17, 0.17, 0.028, 0, 0, -0.01, "z", 40), "disc", null);
  const caliper = new CylinderGeometry(0.155, 0.155, 0.07, 20, 1, false, 0, 0.85);
  caliper.rotateX(Math.PI / 2);
  caliper.rotateZ(1.75);
  add(caliper, "caliper", null);
  return group;
}

/* ------------------------------------------------------------------- car -- */

export const HOOD_OPEN = 0.95; // radians

/**
 * The whole car. userData.openHood(k) swings the hood, k 0..1; parts are
 * tagged for the scene to light up. The body rides RIDE_DROP below its stock
 * height over the wheels.
 */
export function buildCar() {
  const car = new Group();
  car.name = "golf-r";
  const chassis = new Group();
  chassis.position.y = -RIDE_DROP;
  chassis.add(body(), nose(), tail(), mirror(), spoiler(), diffuser(), exhaust(), downpipe(), engine(), interior());
  const hinge = hood();
  chassis.add(hinge, steeringWheel());
  car.add(chassis);
  car.userData.openHood = (k) => {
    hinge.rotation.z = k * HOOD_OPEN;
  };

  for (const [x, track] of [
    [DIM.axle, DIM.trackF],
    [-DIM.axle, DIM.trackR],
  ]) {
    for (const side of [1, -1]) {
      const wl = wheel();
      wl.position.set(x, DIM.tireR, (side * track) / 2);
      wl.scale.z = side;
      car.add(wl);
    }
  }
  return car;
}
