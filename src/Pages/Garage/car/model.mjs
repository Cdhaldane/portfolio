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
 * lights are projected onto the nose and tail, handles sit on the shoulder,
 * the spoiler is bent to the roof's crown.
 */

const PLACEHOLDER = new MeshBasicMaterial();

/** Material keys that make up the body and what's glued to it: what an x-ray fades. */
export const SHELL = new Set([
  "paint", "under", "trim", "gloss", "glass", "lens", "lamp", "chrome", "forged", "carbon", "tail",
  "tailLed", "drl", "amber", "interior", "leather", "mirror", "plastic",
]);

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

/** The geometry plus its mirror image across the centreline. */
function both(g) {
  const m = g.clone();
  m.scale(1, 1, -1);
  flipWinding(m);
  return mergeGeometries([g, m]);
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

function rbox(w, h, d, r = 0.01, x = 0, y = 0, z = 0) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
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

/* -------------------------------------------------------------- the skin -- */

/*
 * A grid of rows (t) by columns (x), both halves of the car in one geometry.
 * The right half mirrors z and reverses winding so both face outwards. Normals
 * on the centreline are squared off so the halves shade as one surface.
 */
function grid(rows, { mirror = true, flip = false } = {}) {
  const nr = rows.length;
  const nc = rows[0].length;
  const pos = [];
  const uv = [];
  const idx = [];
  (mirror ? [1, -1] : [1]).forEach((side, h) => {
    const base = h * nr * nc;
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const p = rows[r][c];
        pos.push(p[0], p[1], p[2] * side);
        uv.push(c / (nc - 1), r / (nr - 1));
      }
    }
    const out = (side > 0) !== flip;
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
function skin({ x0, x1, t0, t1, nt, nx = 40, offset = 0, mirror = true, flip = false }) {
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
  return lift(grid(rows, { mirror, flip }), offset);
}

/*
 * A flat outline wrapped onto the nose (dir 1) or tail (dir -1): drawn in
 * [z, y] as seen end-on, tessellated, then each vertex pushed onto the skin.
 */
function endDecal(outline, dir, { offset = 0.002, mirror = true, subdiv = 2 } = {}) {
  const shape = new Shape(outline.map(([z, y]) => new Vector2(z, y)));
  let g = subdivide(new ShapeGeometry(shape, 8).toNonIndexed(), subdiv);
  g = mergeVertices(g, 1e-6);
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

/** A flat outline drawn in [x, y] from the side, wrapped onto the left flank (and mirrored). */
function sideDecal(outline, { offset = 0.002, subdiv = 2 } = {}) {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  let g = subdivide(new ShapeGeometry(shape, 8).toNonIndexed(), subdiv);
  g = mergeVertices(g, 1e-6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setXYZ(i, x, y, sideZ(x, y) ?? 0.85);
  }
  lift(orient(g, [0, 0, 1]), offset);
  return both(g);
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
};
const WIN = { lo: T.belt + 0.06, hi: T.roofEdge - 0.2 };
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
  add(skin({ x0: DIM.rear + 0.1, x1: DIM.front - 0.1, t0: 0, t1: T.lip, nt: 24 }), "under");
  wrap(skin({ x0: DIM.front - 0.1, x1: DIM.front, t0: 0, t1: T.lip, nt: 24 }));
  wrap(skin({ x0: DIM.rear, x1: DIM.rear + 0.1, t0: 0, t1: T.lip, nt: 24 }));
  wrap(skin({ x0: DIM.rear, x1: DIM.front, t0: T.lip, t1: T.belt, nt: 36 }));
  wrap(cap(DIM.front, 1));
  wrap(cap(DIM.rear, -1));

  // Nose above the beltline (the grille and lights land on this), the cowl.
  wrap(skin({ x0: X.hoodFront + 0.004, x1: DIM.front, t0: T.belt, t1: T_TOP, nt: 30 }));
  add(skin({ x0: X.cowl, x1: X.hoodRear, t0: T.belt, t1: T_TOP, nt: 30, offset: -0.004 }), "trim");

  // Windshield, A-pillars, roof.
  add(skin({ x0: X.roofFront, x1: X.cowl, t0: 7.25, t1: T_TOP, nt: 24, offset: -0.003 }), "glass");
  wrap(skin({ x0: X.roofFront, x1: X.cowl, t0: 6.86, t1: 7.25, nt: 6 }));
  wrap(skin({ x0: X.roofRear, x1: X.roofFront, t0: 6.86, t1: T_TOP, nt: 28 }));

  // Side glass in black frames, the B-pillar, and the C-pillar in paint.
  add(skin({ x0: X.bFront, x1: 0.6, t0: WIN.lo, t1: WIN.hi, nt: 10, offset: -0.004 }), "glass");
  add(skin({ x0: rearGlassEdge, x1: X.bRear, t0: WIN.lo, t1: WIN.hi, nt: 10, offset: -0.004 }), "glass");
  const frameRear = (t) => rearGlassEdge(t) - 0.018;
  add(skin({ x0: frameRear, x1: X.cowl, t0: T.belt, t1: WIN.lo, nt: 2, nx: 120, offset: -0.001 }), "trim");
  add(skin({ x0: frameRear, x1: X.cowl, t0: WIN.hi, t1: 6.86, nt: 2, nx: 160, offset: -0.001 }), "trim");
  add(skin({ x0: X.bRear, x1: X.bFront, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 4, offset: -0.001 }), "gloss");
  add(skin({ x0: 0.6, x1: X.cowl, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 4, offset: -0.001 }), "trim");
  add(skin({ x0: frameRear, x1: rearGlassEdge, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 3, offset: -0.001 }), "trim");
  wrap(skin({ x0: X.glassBottom, x1: frameRear, t0: T.belt, t1: 6.86, nt: 10, nx: 40 }));

  // Hatch: C-pillar wrap, a black frit band, the glass; the tailgate below it.
  wrap(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 6.86, t1: 7.12, nt: 4 }));
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.12, t1: 7.32, nt: 3, offset: -0.001 }), "trim");
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.32, t1: T_TOP, nt: 22, offset: -0.003 }), "glass");
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

  // Liners: the inside of the cabin is dark, not body colour. (Flipped, so a
  // positive offset moves them inwards.)
  add(skin({ x0: X.roofRear, x1: X.cowl, t0: T.lip, t1: T.belt, nt: 16, offset: 0.02, flip: true }), "interior");
  add(skin({ x0: X.roofRear, x1: X.roofFront, t0: 6.86, t1: T_TOP, nt: 12, offset: 0.03, flip: true }), "interior");

  // Door handles on the shoulder.
  for (const x of [-0.16, -1.04]) {
    const [, y, z] = bodyPoint(x, T.shoulder - 0.12);
    const handle = mesh(both(rbox(0.15, 0.028, 0.026, 0.011, x, y, z + 0.004)), "paint", "wrap");
    handle.name = "handle";
    g.add(handle);
  }

  return g;
}

function hood() {
  const pivot = new Group();
  pivot.position.set(X.hoodRear, centreTop(X.hoodRear), 0);
  const geo = planarUV(skin({ x0: X.hoodRear + 0.004, x1: X.hoodFront, t0: T.belt, t1: T_TOP, nt: 30 }), "x", "z", 2.4);
  geo.translate(-pivot.position.x, -pivot.position.y, 0);
  pivot.add(mesh(geo, "forged", "hood"));
  // Underside, so the open hood isn't see-through.
  const under = skin({ x0: X.hoodRear + 0.02, x1: X.hoodFront - 0.02, t0: T.belt + 0.1, t1: T_TOP, nt: 20, offset: 0.012, flip: true });
  under.translate(-pivot.position.x, -pivot.position.y, 0);
  pivot.add(mesh(under, "plastic"));
  return pivot;
}

/* ------------------------------------------------------------ nose & tail -- */

function nose() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Upper grille between the lights, and the badge.
  add(endDecal([[-0.4, 0.7], [0.4, 0.7], [0.42, 0.785], [-0.42, 0.785]], 1, { mirror: false, offset: 0.003 }), "gloss");
  const badge = new TorusGeometry(0.062, 0.007, 8, 40);
  badge.rotateY(Math.PI / 2);
  const bx = endX(0.72, 0, 1);
  badge.translate(bx + 0.008, 0.72, 0);
  add(badge, "chrome");
  const disc = new CircleGeometry(0.06, 40);
  disc.rotateY(Math.PI / 2);
  disc.translate(bx + 0.006, 0.72, 0);
  add(disc, "trim");

  // Headlights: smoked housing, chrome projector, the LED strip along the bottom.
  const head = [[0.44, 0.665], [0.44, 0.792], [0.64, 0.81], [0.83, 0.8], [0.82, 0.735], [0.7, 0.665]];
  add(endDecal(head, 1, { offset: 0.003, subdiv: 3 }), "lamp");
  add(endDecal([[0.47, 0.674], [0.7, 0.674], [0.8, 0.727], [0.795, 0.742], [0.69, 0.69], [0.47, 0.69]], 1, { offset: 0.006 }), "drl");
  add(endDecal(circle(0.6, 0.745, 0.03), 1, { offset: 0.006 }), "chrome");
  add(endDecal(head, 1, { offset: 0.009, subdiv: 3 }), "lens");

  // Lower bumper: centre intake, the two big side intakes with a blade each.
  add(endDecal([[-0.33, 0.4], [0.33, 0.4], [0.42, 0.245], [-0.42, 0.245]], 1, { mirror: false, offset: 0.003 }), "trim");
  add(endDecal([[0.5, 0.45], [0.68, 0.47], [0.77, 0.41], [0.77, 0.27], [0.53, 0.235], [0.47, 0.29]], 1, { offset: 0.003 }), "trim");
  add(endDecal([[0.5, 0.345], [0.765, 0.36], [0.765, 0.38], [0.5, 0.367]], 1, { offset: 0.006 }), "gloss");

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

function circle(cz, cy, r, n = 20) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cz + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

function tail() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Tail lights under the glass, wrapping round to the flank.
  const lamp = [[0.32, 0.895], [0.32, 0.962], [0.6, 0.982], [0.835, 0.975], [0.85, 0.875], [0.62, 0.868]];
  add(endDecal(lamp, -1, { offset: 0.003, subdiv: 3 }), "tail");
  add(endDecal([[0.38, 0.93], [0.82, 0.945], [0.82, 0.956], [0.38, 0.942]], -1, { offset: 0.006 }), "tailLed");
  add(sideDecal([[-1.96, 0.877], [-1.87, 0.892], [-1.87, 0.948], [-1.965, 0.97]], { offset: 0.003 }), "tail");

  // Badge on the tailgate.
  const bx = endX(0.86, 0, -1);
  const badge = new TorusGeometry(0.058, 0.007, 8, 40);
  badge.rotateY(Math.PI / 2);
  badge.translate(bx - 0.008, 0.86, 0);
  add(badge, "chrome");
  const disc = new CircleGeometry(0.056, 40);
  disc.rotateY(-Math.PI / 2);
  disc.translate(bx - 0.006, 0.86, 0);
  add(disc, "trim");

  // Plate recess, reflectors, red side markers.
  add(endDecal([[-0.16, 0.6], [0.16, 0.6], [0.16, 0.755], [-0.16, 0.755]], -1, { mirror: false, offset: 0.003 }), "trim");
  add(endDecal([[0.6, 0.43], [0.8, 0.43], [0.8, 0.448], [0.6, 0.448]], -1, { offset: 0.003 }), "tail");
  add(sideDecal([[-2.04, 0.47], [-1.96, 0.475], [-1.96, 0.495], [-2.04, 0.49]], { offset: 0.002, subdiv: 1 }), "tail");
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

function spoiler() {
  const xa = X.roofRear + 0.06;
  const y0 = centreTop(xa);
  const profile = new Shape([
    new Vector2(xa, y0 - 0.004),
    new Vector2(-1.98, y0 - 0.03),
    new Vector2(-1.99, y0 - 0.05),
    new Vector2(-1.9, y0 - 0.075),
    new Vector2(X.roofRear - 0.02, y0 - 0.04),
  ]);
  const half = 0.56;
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
  // Side fins down the edges of the glass.
  const fin = new Shape([
    new Vector2(X.roofRear + 0.02, 0),
    new Vector2(-1.97, -0.03),
    new Vector2(-1.93, -0.16),
    new Vector2(-1.88, -0.1),
  ]);
  const fg = new ExtrudeGeometry(fin, { depth: 0.012, bevelEnabled: false });
  fg.translate(0, topY(xa, half) - 0.03, half - 0.03);
  out.add(mesh(planarUV(both(fg), "x", "y", 7), "carbon", "spoiler"));
  return out;
}

/* --------------------------------------------------------- diffuser, tips -- */

const TIPS_Z = [0.49, 0.615];
const TIP_Y = 0.305;

function diffuser() {
  const g = new Group();
  const add = (geo) => g.add(mesh(geo, "gloss", "diffuser"));
  // A gloss black blade along the bumper's lower edge, notched around the tips.
  add(endDecal([[-0.42, 0.3], [0.42, 0.3], [0.42, 0.37], [-0.42, 0.37]], -1, { mirror: false, offset: 0.004 }));
  add(endDecal([[0.69, 0.3], [0.8, 0.31], [0.8, 0.37], [0.69, 0.37]], -1, { offset: 0.004 }));
  // Fins.
  for (const z of [0, 0.14, 0.28]) {
    const x = endX(0.3, z, -1) ?? -2.05;
    const fin = rbox(0.09, 0.065, 0.008, 0.003, x + 0.005, 0.27, z);
    add(z === 0 ? fin : both(fin));
  }
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
      add(tube([[-1.72, 0.27, s * (z - 0.06)], [-1.86, 0.29, s * z], [-1.97, TIP_Y, s * z]], 0.028, 12, 10));
      // Tips: polished, open, with a dark throat.
      const x0 = -2.065;
      add(cyl(0.048, 0.048, 0.1, x0 + 0.05, TIP_Y, s * z, "x", 32, true), "chrome");
      add(cyl(0.041, 0.041, 0.1, x0 + 0.05, TIP_Y, s * z, "x", 32, true), "trim");
      const ring = new TorusGeometry(0.0445, 0.0035, 8, 32);
      ring.rotateY(Math.PI / 2);
      ring.translate(x0, TIP_Y, s * z);
      add(ring, "chrome");
    }
  }
  return g;
}

/* ------------------------------------------------------------ engine bay -- */

function engine() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  add(rbox(0.07, 0.42, 1.12, 0.02, 1.93, 0.46, 0), "plastic"); // radiator support
  add(rbox(0.34, 0.36, 0.62, 0.04, 1.35, 0.43, -0.19), "engine"); // block
  add(rbox(0.3, 0.12, 0.6, 0.04, 1.35, 0.67, -0.19), "engine"); // head
  add(rbox(0.15, 0.24, 0.58, 0.04, 1.58, 0.56, -0.19), "plastic"); // intake manifold
  add(rbox(0.36, 0.3, 0.36, 0.06, 1.33, 0.4, 0.3), "engine"); // DSG
  add(rbox(0.25, 0.2, 0.25, 0.02, 1.74, 0.5, 0.42), "plastic"); // battery
  add(cyl(0.035, 0.035, 0.07, 1.74, 0.63, 0.36), "red");

  // APR coils, red tops on black bodies.
  for (let i = 0; i < 4; i++) {
    const z = -0.42 + i * 0.088 + 0.07;
    add(cyl(0.021, 0.021, 0.06, 1.35, 0.76, z, "y", 16), "plastic", "coils");
    add(rbox(0.07, 0.03, 0.05, 0.008, 1.35, 0.8, z), "red", "coils");
  }

  // Unitronic carbon airbox over the gearbox; snorkel forward to the bumper.
  const box = rbox(0.4, 0.17, 0.3, 0.05, 1.36, 0.68, 0.33);
  add(planarUV(box, "x", "z", 7), "carbon", "intake");
  add(planarUV(tube([[1.56, 0.7, 0.4], [1.72, 0.71, 0.38], [1.86, 0.66, 0.32]], 0.04, 16, 12), "x", "z", 7), "carbon", "intake");

  // Turbo at the back of the block, inlet pipe from the airbox.
  add(cyl(0.065, 0.065, 0.07, 1.12, 0.55, -0.02, "z", 24), "steel");
  add(cyl(0.055, 0.055, 0.07, 1.12, 0.52, -0.1, "z", 24), "steel");
  add(
    tube([[1.17, 0.68, 0.2], [1.08, 0.68, 0.14], [1.04, 0.63, 0.06], [1.08, 0.57, 0.02], [1.12, 0.55, 0.015]], 0.036),
    "inlet",
    "inlet"
  );

  // ECU by the battery, TCU on the gearbox: the two halves of the tune.
  add(rbox(0.2, 0.05, 0.16, 0.008, 0.94, 0.66, 0.46), "ecu", "tune");
  add(rbox(0.06, 0.14, 0.22, 0.01, 1.53, 0.38, 0.3), "ecu", "tune");

  // Strut tops and the scuttle panel.
  for (const z of [0.5, -0.5]) add(cyl(0.07, 0.07, 0.06, 1.3, 0.76, z), "plastic");
  add(rbox(0.06, 0.12, 1.2, 0.02, 0.76, 0.84, 0), "plastic");
  return g;
}

function downpipe() {
  const g = new Group();
  g.add(
    mesh(
      tube([[1.1, 0.46, -0.13], [1.04, 0.38, -0.14], [0.94, 0.28, -0.1], [0.78, 0.21, -0.04], [0.55, 0.19, -0.01], [0.38, 0.19, 0]], 0.038),
      "steel",
      "downpipe"
    )
  );
  g.add(mesh(cyl(0.062, 0.062, 0.2, 0.66, 0.2, -0.02, "x"), "steel", "downpipe"));
  return g;
}

/* --------------------------------------------------------------- interior -- */

const WHEEL = { x: 0.1, y: 0.94, z: 0.37, r: 0.18, tilt: -0.38 };

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

function interior() {
  const g = new Group();
  const add = (geo, mat) => g.add(mesh(geo, mat));
  add(rbox(0.42, 0.22, 1.42, 0.06, 0.4, 0.86, 0), "interior"); // dash
  add(rbox(0.2, 0.08, 0.3, 0.03, 0.26, 0.98, 0.37), "interior"); // binnacle
  add(rbox(0.8, 0.22, 0.2, 0.04, -0.05, 0.5, 0), "interior"); // console
  add(cyl(0.025, 0.03, 0.3, 0.22, 0.88, 0.37, "x", 12), "interior"); // column
  for (const z of [0.37, -0.37]) {
    add(rbox(0.5, 0.13, 0.5, 0.05, -0.45, 0.43, z), "leather");
    const back = rbox(0.12, 0.62, 0.5, 0.05, 0, 0.3, 0);
    back.rotateZ(0.22);
    back.translate(-0.72, 0.47, z);
    add(back, "leather");
    add(rbox(0.1, 0.16, 0.26, 0.04, -0.86, 1.13, z), "leather");
  }
  add(rbox(0.5, 0.14, 1.14, 0.05, -1.3, 0.44, 0), "leather"); // rear bench
  const rb = rbox(0.12, 0.56, 1.14, 0.05, 0, 0, 0);
  rb.rotateZ(0.24);
  rb.translate(-1.55, 0.78, 0);
  add(rb, "leather");
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
  // Barrel and lip, open towards the outside face.
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
  // Five split spokes, dished: the hub sits deeper than the rim face.
  for (let i = 0; i < 10; i++) {
    const a = (Math.floor(i / 2) / 5) * Math.PI * 2 + (i % 2 ? 0.12 : -0.12);
    const spoke = new CylinderGeometry(0.009, 0.015, RIM_R - 0.07, 6, 1);
    spoke.scale(1, 1, 1.8);
    spoke.translate(0, 0.07 + (RIM_R - 0.07) / 2, 0);
    spoke.rotateX(-0.14);
    spoke.translate(0, 0, w / 2 - 0.045);
    spoke.rotateZ(a);
    add(spoke, "wheel");
  }
  add(cyl(0.075, 0.08, 0.04, 0, 0, w / 2 - 0.065, "z", 30), "wheel");
  add(cyl(0.03, 0.03, 0.01, 0, 0, w / 2 - 0.042, "z", 24), "chrome");
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
 * tagged for the scene to light up.
 */
export function buildCar() {
  const car = new Group();
  car.name = "golf-r";
  car.add(body(), nose(), tail(), mirror(), spoiler(), diffuser(), exhaust(), downpipe(), engine(), interior());
  const hinge = hood();
  car.add(hinge, steeringWheel());
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
