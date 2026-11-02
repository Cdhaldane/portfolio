import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
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
import { DIM, T, T_TOP, bodyPoint, centreTop, endX, profile, radialPoint, sideZ, stations, topY } from "./shape.mjs";

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
  "forgedFlake", "carbon", "tail", "tailLed", "reverse", "drl", "amber", "screen", "interior", "leather", "mirror", "plastic",
  "sticker", "sensor",
]);

/**
 * Decal vertices that found no body to land on, as [kind, a, b]. A light or
 * badge drawn past the edge of the surface ends up here instead of floating;
 * the tests hold it empty.
 */
export const DECAL_MISSES = [];

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

/** A polygon with every corner rounded off by r, as a Shape (or a hole Path). */
function roundPoly(points, r, into = new Shape()) {
  const n = points.length;
  const cut = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.min(r, l / 2) / l;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  points.forEach((p, i) => {
    const a = cut(p, points[(i + n - 1) % n]);
    const b = cut(p, points[(i + 1) % n]);
    if (i === 0) into.moveTo(...a);
    else into.lineTo(...a);
    into.quadraticCurveTo(p[0], p[1], ...b);
  });
  into.closePath();
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

/**
 * A raised panel on the +z skin, x0..x1 by t0..t1, standing `thick` proud on
 * the skin's normal and closed all round; mirrored. For parts that sit over
 * the skin's edges, like the spoiler's side plates.
 */
function slab({ x0, x1, t0, t1, thick, nx = 12, nt = 6 }) {
  const at = (x, t, o) => {
    const p = new Vector3(...bodyPoint(x, t));
    const e = 1e-3;
    const dx = new Vector3(...bodyPoint(x + e, t)).sub(new Vector3(...bodyPoint(x - e, t)));
    const dt = new Vector3(...bodyPoint(x, t + e)).sub(new Vector3(...bodyPoint(x, t - e)));
    const n = dx.cross(dt).normalize();
    if (n.dot(new Vector3(0, p.y - 0.6, p.z)) < 0) n.negate();
    return p.addScaledVector(n, o).toArray();
  };
  const xs = range(x0, x1, nx);
  const ts = range(t0, t1, nt);
  const os = range(0, thick, 1);
  // Rows run against the columns so each face winds outwards (see grid()).
  const faces = [
    grid(ts.map((t) => xs.map((x) => at(x, t, thick))), { side: 1 }),
    grid(os.map((o) => xs.map((x) => at(x, t0, o))), { side: 1 }),
    grid(os.slice().reverse().map((o) => xs.map((x) => at(x, t1, o))), { side: 1 }),
    orient(grid(ts.map((t) => os.map((o) => at(x0, t, o))), { side: 1 }), [-1, 0, 0]),
    orient(grid(ts.map((t) => os.map((o) => at(x1, t, o))), { side: 1 }), [1, 0, 0]),
  ];
  return both(mergeGeometries(faces));
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
    if (x === null) DECAL_MISSES.push(["end", dir, y, z]);
    p.setXYZ(i, x === null ? (dir > 0 ? 2.0 : -1.95) : x, y, z);
  }
  lift(orient(g, [dir, 0, 0]), offset);
  return mirror ? both(g) : g;
}

/**
 * A band on the nose (dir 1) or tail (dir -1), |z| <= w and y0..y1 as seen
 * end-on (w may be a function of y), as a regular grid on the skin. Columns bunch up towards the
 * ends, where the face turns the corner, so the patch hugs it.
 */
function endPatch(w, y0, y1, dir, { offset = 0.002, nz = 48, ny = 6 } = {}) {
  const half = typeof w === "number" ? () => w : w;
  const rows = range(y0, y1, ny).map((y) => range(0, Math.PI, nz).map((a) => {
    const z = -half(y) * Math.cos(a);
    const x = endX(y, z, dir);
    if (x === null) DECAL_MISSES.push(["end", dir, y, z]);
    return [x ?? dir * 2, y, z];
  }));
  return lift(orient(grid(rows, { side: 1 }), [dir, 0, 0]), offset);
}

/** A flat outline drawn in [x, y] from the side, wrapped onto the +z flank; side -1 the -z flank, 0 both. */
function sideDecal(outline, { offset = 0.002, subdiv = 2, side = 0 } = {}) {
  const g = flat(outline, subdiv);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = sideZ(x, y);
    if (z === null) DECAL_MISSES.push(["side", x, y]);
    p.setXYZ(i, x, y, z ?? 0.85);
  }
  lift(orient(g, [0, 0, 1]), offset);
  return side === 0 ? both(g) : side < 0 ? toRight(g) : g;
}

/**
 * A strip of the +z flank between two edges drawn from the side ([x, y]
 * polylines that start and end together), as a grid wrapped onto the skin: a
 * lamp's housing or lens, without the slivers a filled outline leaves where
 * the skin turns a corner. Mirrored to the other side.
 */
function sideBand(top, bottom, { offset = 0.002, n = 60, rows = 8 } = {}) {
  const resample = (pts) => {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return range(0, d[d.length - 1], n).map((s) => {
      let i = 1;
      while (i < pts.length - 1 && d[i] < s) i++;
      const k = (s - d[i - 1]) / (d[i] - d[i - 1] || 1);
      return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
    });
  };
  const lo = resample(bottom);
  const hi = resample(top);
  const cells = range(0, 1, rows).map((s) =>
    lo.map((p, i) => {
      const x = lerp(p[0], hi[i][0], s);
      const y = lerp(p[1], hi[i][1], s);
      const z = sideZ(x, y);
      if (z === null) DECAL_MISSES.push(["side", x, y]);
      return [x, y, z ?? 0.85];
    })
  );
  return both(lift(orient(grid(cells, { side: 1 }), [0, 0, 1]), offset));
}

/**
 * A band on the skin between two edges given as matching [x, y, z] key points
 * (top[i] across from bottom[i]), wrapped round a corner: every point is
 * pushed out to the skin along a ray in plan from (xc, 0). `k` keeps part of
 * its run, in key positions (fractions allowed), and `s` part of its height,
 * so the pieces inside a lamp line up with its outline. Mirrored.
 */
function cornerBand(top, bottom, { xc, offset = 0.002, k = [0, top.length - 1], s = [0, 1], rows = 8, per = 0.008, out = [0, 0, 1] }) {
  const at = (pts, kk) => {
    const i = Math.min(Math.floor(kk), pts.length - 2);
    return pts[i].map((v, c) => lerp(v, pts[i + 1][c], kk - i));
  };
  const ks = [k[0]];
  for (let i = 0; i < top.length - 1; i++) {
    const len = (new Vector3(...top[i]).distanceTo(new Vector3(...top[i + 1])) + new Vector3(...bottom[i]).distanceTo(new Vector3(...bottom[i + 1]))) / 2;
    const m = Math.max(1, Math.ceil(len / per));
    for (let j = 0; j < m; j++) if (i + j / m > k[0] + 1e-6 && i + j / m < k[1] - 1e-6) ks.push(i + j / m);
  }
  ks.push(k[1]);
  const cells = range(s[0], s[1], rows).map((sv) =>
    ks.map((kk) => {
      const a = at(bottom, kk);
      const b = at(top, kk);
      const p = a.map((v, c) => lerp(v, b[c], sv));
      const q = radialPoint(xc, p[1], p[0] - xc, p[2]);
      if (q === null) DECAL_MISSES.push(["corner", ...p]);
      return q ?? p;
    })
  );
  return both(lift(orient(grid(cells, { side: 1 }), out), offset));
}

/**
 * Stand a geometry built facing +z on the +z flank at side-view (x, y), `out`
 * off the skin and square to it there; mirrored to the other side.
 */
function onSkin(g, x, y, out = 0) {
  const e = 0.004;
  const z = sideZ(x, y);
  const dzdx = (sideZ(x + e, y) - sideZ(x - e, y)) / (2 * e);
  const dzdy = (sideZ(x, y + e) - sideZ(x, y - e)) / (2 * e);
  const n = new Vector3(-dzdx, -dzdy, 1).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n));
  g.translate(x + n.x * out, y + n.y * out, z + n.z * out);
  return both(g);
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

// Measured off the blueprint: the windshield's foot is well forward, over the
// back of the front wheel; the roof runs long to the spoiler.
export const X = {
  hoodRear: 1.03,
  hoodFront: 2.12,
  cowl: 0.97, // the windshield's foot on the centreline
  roofFront: 0.0, // the windshield header
  roofRear: -1.66, // the roof ends and the hatch glass begins, under the spoiler
  glassBottom: -1.88,
  doorFront: 0.875,
  doorSplit: -0.24,
  doorRear: -0.915,
  quarter: -0.985, // the rear door glass's fixed quarter pane starts behind this bar
  arch: DIM.axle - DIM.archR - 0.025, // the side skirt runs between the arches, |x| under this
  strut: DIM.axle, // strut tops sit over the front axle
  sail: 0.55, // front of the door glass, behind the mirror
  aBase: 0.82, // where the A-pillar meets the wing
};
const WIN = { lo: T.belt + 0.04, hi: T.roofEdge - 0.14 };
// The doors' bottom edge, on top of the side skirt (about 0.38 off the ground).
const SILL_T = 4.18;
// 0 at the beltline, 1 at the roof edge.
const up = (t) => (t - T.belt) / (T.roofEdge - T.belt);
// The B-pillar leans back as it rises.
const bFront = (t) => lerp(-0.2, -0.27, up(t));
const bRear = (t) => lerp(-0.33, -0.4, up(t));
// The rear door glass's trailing edge leans forward as it rises.
const rearGlassEdge = (t) => lerp(-1.29, -1.16, up(t));
// The rear door's shut line, off the 5-door blueprint: from just ahead of
// the arch at the sill, one long diagonal up to the foot of the quarter glass.
const rearDoorEdgeAt = profile([
  [0.38, X.doorRear], [0.45, -0.922], [0.5, -0.945], [0.6, -0.99], [0.7, -1.05], [0.8, -1.12], [0.9, -1.2], [1.0, -1.28],
]);
const rearDoorEdge = (t) => rearDoorEdgeAt(bodyPoint(-1.1, t)[1]);

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
  add(skin({ x0: bFront, x1: X.sail, t0: WIN.lo, t1: WIN.hi, nt: 10, nx: 30, offset: -0.004 }), "tint");
  add(skin({ x0: rearGlassEdge, x1: bRear, t0: WIN.lo, t1: WIN.hi, nt: 10, nx: 40, offset: -0.004 }), "tint");
  const frameRear = (t) => rearGlassEdge(t) - 0.018;
  add(skin({ x0: frameRear, x1: X.aBase, t0: T.belt, t1: WIN.lo, nt: 2, nx: 120, offset: -0.001 }), "trim");
  add(skin({ x0: frameRear, x1: X.aBase, t0: WIN.hi, t1: 6.86, nt: 2, nx: 160, offset: -0.001 }), "trim");
  add(skin({ x0: bRear, x1: bFront, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 4, offset: -0.001 }), "gloss");
  add(skin({ x0: X.quarter - 0.022, x1: X.quarter, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 2, offset: -0.0015 }), "gloss");
  // The black sail behind the mirror, then the A-pillar's foot in paint.
  add(skin({ x0: X.sail, x1: X.aBase, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 8, offset: -0.001 }), "trim");
  wrap(skin({ x0: X.aBase, x1: X.cowl, t0: T.belt, t1: 6.86, nt: 8, nx: 12 }));
  add(skin({ x0: frameRear, x1: rearGlassEdge, t0: WIN.lo, t1: WIN.hi, nt: 8, nx: 3, offset: -0.001 }), "trim");
  wrap(skin({ x0: X.glassBottom, x1: frameRear, t0: T.belt, t1: 6.86, nt: 10, nx: 40 }));

  // Rain visors over both door windows, running down the A-pillar.
  add(skin({ x0: (t) => rearGlassEdge(t) - 0.01, x1: X.sail + 0.08, t0: WIN.hi - 0.04, t1: WIN.hi + 0.09, nt: 3, nx: 120, offset: 0.012 }), "visor");

  // Hatch: C-pillar wrap, a black frit band, the glass; the tailgate below it.
  wrap(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 6.86, t1: 7.12, nt: 4 }));
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.12, t1: 7.32, nt: 3, offset: -0.001 }), "trim");
  add(skin({ x0: X.glassBottom, x1: X.roofRear, t0: 7.32, t1: T_TOP, nt: 22, offset: -0.003 }), "tint");
  wrap(skin({ x0: DIM.rear, x1: X.glassBottom, t0: T.belt, t1: T_TOP, nt: 30 }));
  add(skin({ x0: X.glassBottom, x1: X.glassBottom + 0.012, t0: 7.12, t1: T_TOP, nt: 16, offset: 0.0008 }), "trim");

  // Shut lines: doors, hood edge, door bottoms. The doors stop about 0.38
  // off the ground, on top of the side skirt.
  const line = (geo) => add(geo, "trim");
  for (const x of [X.doorFront, X.doorSplit]) {
    line(skin({ x0: x - 0.002, x1: x + 0.002, t0: SILL_T, t1: T.belt, nt: 24, offset: 0.0008 }));
  }
  line(skin({ x0: (t) => rearDoorEdge(t) - 0.002, x1: (t) => rearDoorEdge(t) + 0.002, t0: SILL_T, t1: T.belt, nt: 30, nx: 1, offset: 0.0008 }));
  line(skin({ x0: rearDoorEdge(SILL_T), x1: X.doorFront, t0: SILL_T - 0.012, t1: SILL_T, nt: 1, offset: 0.0008 }));

  // The R's side skirts between the arches: a body-colour sill standing proud
  // under the doors, its lip flaring out along the bottom.
  const skirt = { x0: -X.arch, x1: X.arch, nx: 60 };
  wrap(slab({ ...skirt, t0: 3.28, t1: SILL_T - 0.03, thick: 0.01, nt: 8 }));
  wrap(slab({ ...skirt, t0: 3.28, t1: 3.48, thick: 0.02, nt: 3 }));
  line(skin({ x0: X.hoodRear, x1: X.hoodFront + 0.004, t0: T.belt - 0.04, t1: T.belt, nt: 1, offset: 0.0008 }));

  // Fuel door, on the passenger side's rear quarter, its front edge raked
  // parallel to the rear door's shut line.
  const flap = (d) => [[-1.43 - d, 0.775 + d], [-1.67 + d, 0.775 + d], [-1.67 + d, 0.915 - d], [-1.52 - d * 0.6, 0.915 - d]];
  const door = roundPoly(flap(0), 0.035);
  door.holes.push(roundPoly(flap(0.003), 0.032, new Path()));
  line(sideDecal(door, { side: 1, offset: 0.0008, subdiv: 1 }));

  // Liners: the inside of the cabin is dark, not body colour. (Flipped, so a
  // positive offset moves them inwards.)
  add(skin({ x0: X.roofRear, x1: X.cowl, t0: T.lip, t1: T.belt, nt: 6, offset: 0.02, flip: true }), "interior");
  add(skin({ x0: X.roofRear, x1: X.roofFront, t0: 6.86, t1: T_TOP, nt: 6, offset: 0.03, flip: true }), "interior");

  // Door handles on the shelf just above the tornado line: a bar a little
  // taller at the back, where the seam marks off its end cap. R badges on the
  // front wings.
  for (const x of [-0.09, -0.99]) {
    const [, y] = bodyPoint(x, T.shoulder + 0.35);
    const s = new Shape();
    s.moveTo(-0.085, -0.015);
    s.lineTo(0.08, -0.012);
    s.quadraticCurveTo(0.097, -0.011, 0.097, 0);
    s.quadraticCurveTo(0.097, 0.011, 0.08, 0.012);
    s.lineTo(-0.085, 0.015);
    s.quadraticCurveTo(-0.097, 0.015, -0.097, 0);
    s.quadraticCurveTo(-0.097, -0.015, -0.085, -0.015);
    const bar = new ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.005, bevelSegments: 4, curveSegments: 8 });
    bar.translate(0, 0, 0.004);
    const seam = rbox(0.0025, 0.033, 0.03, 0.001, -0.058, 0, 0.012);
    for (const [geo, mat] of [[bar, "paint"], [seam, "gloss"]]) {
      const m = mesh(onSkin(geo, x, y), mat, mat === "paint" ? "wrap" : undefined);
      m.name = "handle";
      g.add(m);
    }
  }
  const fender = [[0.96, 0.75], [1.02, 0.75], [1.02, 0.775], [0.96, 0.775]];
  g.add(sticker(sideDecal(fender, { side: 1, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["x", 1], ["y", 1]));
  g.add(sticker(sideDecal(fender, { side: -1, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["x", -1], ["y", 1]));

  // Stickers: the sponsor stack on the driver's quarter pane, Donut on the
  // passenger's. (u runs towards the viewer's right on each side.) The
  // windshield and hatch glass stay clear.
  const pane = { x0: -1.165, x1: X.quarter - 0.03, t0: 6.12, t1: 6.6, nt: 6, nx: 12, offset: -0.0025 };
  g.add(sticker(skin({ ...pane, side: -1 }), STICKER.sponsors, ["x", -1], ["y", 1]));
  g.add(sticker(skin({ ...pane, side: 1 }), STICKER.donut, ["x", 1], ["y", 1]));

  // Shark-fin aerial on the roof, well ahead of the spoiler: a low rounded
  // pod its whole length, and a thin blade rising out of its back half to a
  // point. Sections along it, sat on the roof's crown, pinched in where the
  // blade stands above the pod.
  const fin = { x0: -1.22, len: 0.16 };
  add(grid(range(0, 1, 40).map((u) => {
    const x = fin.x0 - u * fin.len;
    const round = Math.sqrt(Math.max(0.01, Math.sin(Math.PI * u)));
    const pod = 0.026 * round;
    const blade = u < 0.45 ? 0 : u < 0.93 ? 0.074 * ((u - 0.45) / 0.48) ** 1.15 : 0.074 * Math.max(0, 1 - (u - 0.93) / 0.06) ** 0.6;
    const h = Math.max(pod, blade);
    const k = h > 0 ? (h - pod) / h : 0;
    const w = 0.034 * round;
    return range(0, Math.PI / 2, 12).map((a) => [x, topY(x, 0) - 0.003 + h * Math.sin(a), w * Math.cos(a) ** (1 + 1.6 * k)]);
  })), "gloss");

  // Wipers parked along the foot of the windshield, both pivoting on the
  // passenger side and lying towards the driver's, one above the other.
  for (const [zp, z1, xb] of [[0.56, -0.06, 0.885], [0.07, -0.56, 0.93]]) {
    const blade = range(zp - 0.04, z1, 16).map((z) => new Vector3(xb, topY(xb, z) + 0.012, z));
    add(tube(blade.map((v) => v.toArray()), 0.007, 32, 6), "gloss");
    const pivot = new Vector3(X.cowl + 0.025, topY(X.cowl + 0.025, zp) + 0.01, zp);
    const tip = blade[blade.length - 3].clone().add(new Vector3(0, 0.012, 0));
    add(tube([pivot.toArray(), pivot.clone().lerp(tip, 0.3).add(new Vector3(0, 0.012, 0)).toArray(), tip.toArray()], 0.006, 24, 6), "gloss");
    add(cyl(0.018, 0.02, 0.022, pivot.x, pivot.y, pivot.z, "y", 16), "gloss");
  }
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

  // The heat extractors near its back corners: blisters that rise out of the
  // hood from flush at the front to about 3.5 cm at the back, their tops a
  // dark louvred grille that shows from the front, closed at the back.
  const front = { x: 1.42, z0: 0.31, z1: 0.5 };
  const rear = { x: 1.09, z0: 0.28, z1: 0.6 };
  const rise = (k) => 0.035 * k ** 1.3;
  const at = (k, v, up = 1) => {
    const x = lerp(front.x, rear.x, k);
    const z = lerp(lerp(front.z0, rear.z0, k), lerp(front.z1, rear.z1, k), v);
    return [x, topY(x, z) + rise(k) * up, z];
  };
  const ks = range(0, 1, 10);
  const vs = range(0, 1, 8);
  const piece = (rows, dir) => both(orient(grid(rows, { side: 1 }), dir));
  add(planarUV(piece(ks.map((k) => vs.map((v) => at(k, v))), [0, 1, 0]), "x", "z", 2.4), "forgedFlake");
  for (const [v, dir] of [[0, [0, 0, -1]], [1, [0, 0, 1]]]) {
    add(planarUV(piece([0, 1].map((up) => ks.map((k) => at(k, v, up))), dir), "x", "y", 2.4), "forgedFlake");
  }
  add(planarUV(piece([0, 1].map((up) => vs.map((v) => at(1, v, up))), [-1, 0, 0]), "z", "y", 2.4), "forgedFlake");
  const inset = (k0, k1, v0, v1, mat, out) =>
    add(lift(piece(range(k0, k1, 6).map((k) => range(v0, v1, 6).map((v) => at(k, v))), [0, 1, 0]), out), mat);
  inset(0.12, 0.92, 0.1, 0.9, "trim", 0.001);
  for (let i = 0; i < 5; i++) {
    const k = lerp(0.2, 0.84, i / 4);
    inset(k, k + 0.045, 0.12, 0.88, "gloss", 0.004);
  }
  return pivot;
}

/* ------------------------------------------------------------ nose & tail -- */

function nose() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Upper grille between the lamps, right under the hood's front edge: two
  // gloss bars and the R's satin chrome bar along the bottom, which lines up
  // with the lamps' LED strips, over a dark recess. The blacked-out roundel
  // in its chrome rim stands proud low on it, dropping onto the bumper; the R
  // sits on the middle bar, on the passenger side.
  // Its ends follow the slant of the lamps' inner ends (see below).
  const hoodLine = (x) => bodyPoint(x, T.belt)[1] - 0.003;
  const foot = [2.155, 0.607];
  const brow = [2.118, hoodLine(2.118)];
  const reach = profile(range(0, 1, 6).map((k) => {
    const x = lerp(foot[0], brow[0], k);
    const y = lerp(foot[1], brow[1], k);
    return [y, sideZ(x, y) - 0.002];
  }));
  add(endPatch(reach, 0.605, 0.714, 1, { ny: 10 }), "trim");
  for (const [y0, y1] of [[0.686, 0.714], [0.655, 0.667]]) {
    add(endPatch((y) => reach(y) - 0.002, y0, y1, 1, { offset: 0.0045, ny: 3 }), "gloss");
  }
  add(endPatch(reach, 0.617, 0.629, 1, { offset: 0.0045, ny: 3 }), "chrome");
  // The roundel stands off the furthest-forward point across its height.
  const by = 0.64;
  const bx = Math.max(...range(by - 0.062, by + 0.062, 8).map((y) => endX(y, 0, 1) ?? 0));
  const ring = new TorusGeometry(0.062, 0.006, 8, 48);
  ring.rotateY(Math.PI / 2);
  ring.translate(bx + 0.014, by, 0);
  add(ring, "chrome");
  add(dome(0.06, 0.012, bx + 0.01, by, 1), "gloss");
  g.add(sticker(endDecal([[0.33, 0.65], [0.38, 0.65], [0.38, 0.672], [0.33, 0.672]], 1, { mirror: false, offset: 0.006, subdiv: 1 }), STICKER.badgeR, ["z", -1], ["y", 1]));

  // Headlights: long smoked lamps wrapped round the nose's corners, from the
  // ends of the grille back along the wing to a point, the top edge tucked
  // under the hood's shut line. Inside: a chrome-framed chamber, the bi-xenon
  // projector in its chrome bracket, the LED strip along the bottom that turns
  // up at the back, and the amber marker in the tip (North American spec).
  // Drawn as seen from the side, off the blueprint, and wrapped onto the skin.
  // The top edge runs under the hood line to the tip; the bottom edge from the
  // foot of the slanted inner end, low along the face and rising to the tip.
  const brim = [];
  for (let x = brow[0]; x > 1.74; x -= 0.025) brim.push([x, hoodLine(x)]);
  brim.push([1.733, hoodLine(1.733)], [1.7, 0.762], [1.667, 0.742]);
  const sill = [foot, [2.13, 0.606], [2.1, 0.605], [2.06, 0.603], [2.0, 0.6], [1.9, 0.612], [1.8, 0.645], [1.726, 0.681], [1.69, 0.715], [1.667, 0.742]];
  const lamp = (outline, mat, offset, subdiv = 3) => add(sideDecal(outline, { offset, subdiv }), mat);
  const quad = (pts, hole) => {
    const s = new Shape(pts.map(([a, b]) => new Vector2(a, b)));
    if (hole) s.holes.push(new Path(hole.map(([a, b]) => new Vector2(a, b))));
    return s;
  };
  add(sideBand(brim, sill, { offset: 0.0015 }), "lamp");
  lamp(quad([[2.072, 0.632], [1.985, 0.628], [1.978, 0.716], [2.068, 0.698]], [[2.068, 0.636], [1.989, 0.632], [1.982, 0.712], [2.064, 0.694]]), "chrome", 0.003);
  // The bracket is a chrome box round the projector: its top face catches the
  // light, so the frame is deepest along the top.
  lamp(quad([[1.952, 0.64], [1.8, 0.668], [1.79, 0.756], [1.948, 0.73]], [[1.944, 0.646], [1.807, 0.672], [1.8, 0.738], [1.94, 0.716]]), "chrome", 0.003);
  lamp(ribbon([[2.145, 0.622], [2.1, 0.623], [2.0, 0.622], [1.9, 0.633], [1.8, 0.662], [1.755, 0.684], [1.735, 0.697]], 0.011), "drl", 0.0035);
  lamp([[1.735, 0.698], [1.742, 0.758], [1.71, 0.762], [1.676, 0.742], [1.698, 0.716]], "amber", 0.003, 2);
  // The projector's lens: a shallow cap, under the lamp's cover.
  const arc = Math.asin(0.029 / 0.1);
  const lens = new SphereGeometry(0.1, 28, 4, 0, Math.PI * 2, 0, arc);
  lens.translate(0, -0.1 * Math.cos(arc), 0);
  lens.rotateX(Math.PI / 2);
  add(onSkin(lens, 1.875, 0.697, 0.0015), "gloss");
  add(onSkin(new TorusGeometry(0.031, 0.003, 6, 36), 1.875, 0.697, 0.003), "chrome");
  add(sideBand(brim, sill, { offset: 0.0065 }), "lens");

  // Lower bumper, off the blueprint's front view: the wide grille, its outer
  // ends raked out towards the bottom, with four slats; the side intakes,
  // their inner edges raked the same way, each split by one body-colour blade.
  const mouth = (y) => (y >= 0.385 ? 0.48 + ((0.4 - y) / 0.015) * 0.04 : 0.52 + ((0.385 - y) / 0.13) * 0.07);
  add(endDecal([[-0.48, 0.4], [0.48, 0.4], [0.52, 0.385], [0.59, 0.255], [-0.59, 0.255], [-0.52, 0.385]], 1, { mirror: false, offset: 0.004, subdiv: 4 }), "trim");
  for (const y of [0.275, 0.305, 0.335, 0.365]) {
    const w = mouth(y + 0.007) - 0.008;
    add(endDecal([[-w, y], [w, y], [w, y + 0.007], [-w, y + 0.007]], 1, { mirror: false, offset: 0.0055, subdiv: 3 }), "gloss");
  }
  add(endDecal([[0.58, 0.443], [0.838, 0.448], [0.842, 0.29], [0.675, 0.285]], 1, { offset: 0.003, subdiv: 4 }), "trim");
  add(endDecal([[0.624, 0.36], [0.84, 0.365], [0.84, 0.381], [0.633, 0.376]], 1, { offset: 0.006, subdiv: 3 }), "paint", "wrap");

  // The plate sits off-centre on the lower grille, on the passenger side.
  g.add(plate(STICKER.plateFront, 1, 0.27, 0.32));

  // Parking sensors on the bumper bar; the headlight washers' covers under
  // the lamps; the bumper's seam with the wing, from the lamp's tip down to
  // the arch.
  for (const [z, y] of [[0.2, 0.47], [0.55, 0.5]]) add(endDecal(circle(z, y, 0.012, 14), 1, { offset: 0.0025, subdiv: 1 }), "sensor");
  const washer = roundRect(0.6, 0.505, 0.71, 0.54, 0.014);
  washer.holes.push(roundRect(0.603, 0.508, 0.707, 0.537, 0.011, new Path()));
  add(endDecal(washer, 1, { offset: 0.0008, subdiv: 2 }), "trim");
  add(sideDecal(ribbon([[1.69, 0.712], [1.698, 0.6], [1.7, 0.5], [1.697, 0.41]], 0.004), { offset: 0.0008, subdiv: 1 }), "trim");

  // The bumper's lip along the bottom, in the wrap.
  const lipY = 0.235;
  const lip = [];
  for (let z = -0.8; z <= 0.8001; z += 0.04) lip.push(new Vector2((endX(lipY, z, 1) ?? 2.1) + 0.018, z));
  for (let z = 0.8; z >= -0.8001; z -= 0.04) lip.push(new Vector2((endX(lipY, z, 1) ?? 2.1) - 0.05, z));
  const blade = new ExtrudeGeometry(new Shape(lip), { depth: 0.014, bevelEnabled: false });
  blade.rotateX(Math.PI / 2);
  blade.translate(0, lipY, 0);
  add(blade, "paint", "wrap");
  return g;
}

function tail() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(geo, mat, part));

  // Tail lights: smoked LED wedges wrapped round the rear corners, off the
  // blueprint's rear, side and top views. The tailgate's shut line splits each
  // in two: the inner piece on the tailgate, ending in a point, and the outer
  // round the corner and forward along the flank, its raked front edge coming
  // down to a point where the tornado line runs into it. Inside each piece a
  // bright LED loop round a darker centre, and the pale reverse strip along the
  // bottom. Edges are key points end-on (R) and side-on (F), matched top to
  // bottom.
  const R = (z, y) => [endX(y, z, -1), y, z];
  const F = (x, y) => [x, y, sideZ(x, y)];
  const top = [R(0.33, 0.857), R(0.365, 0.918), R(0.48, 0.931), R(0.587, 0.941), R(0.69, 0.943), F(-1.86, 0.956), F(-1.774, 0.962), F(-1.727, 0.883), F(-1.679, 0.804)];
  const bottom = [R(0.33, 0.857), R(0.4, 0.827), R(0.48, 0.818), R(0.587, 0.808), R(0.69, 0.804), F(-1.86, 0.805), F(-1.774, 0.805), F(-1.727, 0.805), F(-1.679, 0.804)];
  const SPLIT = 3; // the key where the tailgate's shut line cuts each lamp in two
  const band = (mat, offset, k, s = [0, 1]) => add(cornerBand(top, bottom, { xc: -1.55, offset, k, s, out: [-1, 0, 1] }), mat);
  band("tail", 0.002, [0, 8]);
  band("reverse", 0.0035, [0.55, 7.75], [0.07, 0.22]);
  for (const [k0, k1] of [[0.7, SPLIT - 0.12], [SPLIT + 0.12, 7.35]]) {
    band("tailLed", 0.0035, [k0, k1], [0.32, 0.4]);
    band("tailLed", 0.0035, [k0, k1], [0.8, 0.88]);
    band("tailLed", 0.0035, [k0, k0 + 0.1], [0.32, 0.88]);
    band("tailLed", 0.0035, [k1 - 0.1, k1], [0.32, 0.88]);
  }
  band("gloss", 0.004, [SPLIT - 0.03, SPLIT + 0.03]);

  // Tailgate: its shut line down from the lamps' split and across above the
  // plate, and up the hatch's sides to the glass; the blacked-out roundel
  // between the lamps; the R low on the driver's side.
  const side = [[0.587, 0.806], [0.585, 0.78], [0.575, 0.72], [0.555, 0.675], [0.51, 0.64], [0.44, 0.627], [0.2, 0.62]];
  const gate = ribbon([...side.map(([z, y]) => [-z, y]), [0, 0.619], ...side.slice().reverse()], 0.005);
  add(endDecal(gate, -1, { mirror: false, offset: 0.0008, subdiv: 2 }), "trim");
  add(endDecal(ribbon([[0.587, 0.943], [0.6, 0.968], [0.618, 0.99]], 0.005), -1, { offset: 0.0008, subdiv: 1 }), "trim");
  const by = 0.89;
  const bx = endX(by, 0, -1);
  add(dome(0.058, 0.009, bx - 0.006, by, -1), "gloss");
  g.add(sticker(endDecal([[-0.48, 0.71], [-0.42, 0.71], [-0.42, 0.735], [-0.48, 0.735]], -1, { mirror: false, offset: 0.002, subdiv: 1 }), STICKER.badgeR, ["z", 1], ["y", 1]));

  // Plate low in the bumper, just over the diffuser, in its frame; parking
  // sensors level with its top; the black vents low on the corners, wrapping
  // round to the sides (no reflectors on this car).
  g.add(plate(STICKER.plateRear, -1, 0, 0.47));
  for (const z of [0.32, 0.62]) add(endDecal(circle(z, 0.54, 0.012, 14), -1, { offset: 0.0025, subdiv: 1 }), "sensor");
  add(cornerBand([R(0.56, 0.4), R(0.68, 0.402), R(0.78, 0.405)], [R(0.56, 0.382), R(0.68, 0.378), R(0.78, 0.37)], { xc: -1.55, rows: 2, out: [-1, 0, 1] }), "gloss");

  // Rear wiper parked across the bottom of the glass.
  add(rbox(0.012, 0.012, 0.34, 0.004, X.glassBottom + 0.012, centreTop(X.glassBottom + 0.012) + 0.012, 0.12), "gloss");
  return g;
}

/* --------------------------------------------------------------- mirrors -- */

function mirror() {
  const g = new Group();
  const add = (geo, mat, part) => g.add(mesh(both(geo), mat, part));
  // On the door at the window's front corner. Seen from behind the housing is
  // a rounded wedge, low at the door and tall at the outer end; its shell
  // domes forward from the glass, shallower towards the swept outer end. The
  // car is 2027 wide across them.
  const [, by, bz] = bodyPoint(0.62, T.belt);
  const xb = 0.56; // the glass
  const z0 = bz + 0.03;
  const y0 = by + 0.02;
  const glass = new CatmullRomCurve3(
    [[0, 0.02], [0.004, 0.07], [0.03, 0.095], [0.1, 0.118], [0.165, 0.132], [0.195, 0.12], [0.206, 0.085],
      [0.198, 0.035], [0.18, 0.01], [0.12, 0.002], [0.04, 0], [0.008, 0.004]].map(([u, v]) => new Vector3(z0 + u, y0 + v, 0)),
    true,
    "centripetal"
  ).getSpacedPoints(64);
  const c = glass.reduce((s, p) => s.add(p), new Vector3()).divideScalar(glass.length);
  const depth = 0.1;
  // Each ring pulls the outline in towards its centre and forward; the outer
  // end comes forward later, so it reads swept back.
  const shell = (a0, a1, rings, grow = 0) =>
    grid(
      range(a0, a1, rings).map((a) =>
        glass.map((p) => {
          const w = 1 - 0.7 * Math.max(0, (p.x - z0) / 0.206) ** 1.5;
          const k = Math.cos(a) * (1 + grow);
          const f = Math.sin(a) * (w + (1 - w) * Math.sin(a) ** 4);
          return [xb + depth * f * (1 + grow), c.y + (p.y - c.y) * k, c.x + (p.x - c.x) * k];
        })
      ),
      { side: 1 }
    );
  add(planarUV(orient(shell(0, Math.PI / 2, 14), [1, 0, 0]), "z", "y", 3), "forged", "mirrors");
  // The turn signal along the lower front edge.
  const lower = glass.filter((p) => p.y < y0 + 0.03 && p.x > z0 + 0.03 && p.x < z0 + 0.18);
  if (lower.length > 2) {
    const strip = grid(
      range(0.2, 0.42, 3).map((a) => lower.map((p) => {
        const k = Math.cos(a) * 1.01;
        return [xb + depth * Math.sin(a) * 1.01, c.y + (p.y - c.y) * k, c.x + (p.x - c.x) * k];
      })),
      { side: 1 }
    );
    add(orient(strip, [1, -0.5, 0]), "chrome");
  }
  // The glass, in its black rim; the arm and the base on the door.
  const outline = (inset) => new Shape(glass.map((p) => new Vector2(c.x + (p.x - c.x) * inset, c.y + (p.y - c.y) * inset)));
  const face = (inset, x) => {
    const f = new ShapeGeometry(outline(inset), 2);
    f.rotateY(-Math.PI / 2);
    f.translate(x, 0, 0);
    return orient(f, [-1, 0, 0]);
  };
  add(face(1, xb), "trim");
  add(face(0.9, xb - 0.002), "mirror");
  add(rbox(0.06, 0.025, 0.07, 0.008, xb + 0.045, y0 + 0.005, bz + 0.03), "trim");
  add(rbox(0.12, 0.05, 0.022, 0.01, 0.63, by + 0.02, bz + 0.004), "trim");
  return g;
}

/* --------------------------------------------------------------- spoiler -- */

/*
 * A carbon roof extension over the hatch glass: a wing carrying the roof on
 * past the glass's top edge, small ears kicked up at its trailing corners,
 * side plates framing the top of the glass, and the third brake light under
 * its trailing edge.
 */
function spoiler() {
  const R = X.roofRear;
  const xa = R + 0.08;
  const y0 = centreTop(xa);
  const profile = new Shape([
    new Vector2(xa, y0 - 0.004),
    new Vector2(R - 0.2, y0 - 0.035),
    new Vector2(R - 0.21, y0 - 0.055),
    new Vector2(R - 0.1, y0 - 0.08),
    new Vector2(R + 0.02, y0 - 0.04),
  ]);
  const half = 0.58;
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
    new Vector2(R - 0.08, y0 - 0.022),
    new Vector2(R - 0.205, y0 - 0.037),
    new Vector2(R - 0.215, y0 + 0.012),
    new Vector2(R - 0.17, y0 + 0.006),
  ]);
  const wg = new ExtrudeGeometry(winglet, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
  wg.translate(0, drop, half - 0.014);
  out.add(mesh(planarUV(both(wg), "x", "y", 7), "carbon", "spoiler"));

  out.add(mesh(planarUV(slab({ x0: -1.79, x1: R + 0.04, t0: 6.95, t1: 7.42, thick: 0.022 }), "x", "y", 7), "carbon", "spoiler"));
  out.add(mesh(rbox(0.014, 0.012, 0.3, 0.004, R - 0.15, y0 - 0.074, 0), "tailLed", "spoiler"));
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
  // Gloss black across the bumper's bottom between the corners, under a
  // blade along its top edge that stands a couple of centimetres proud.
  add(endPatch(0.7, 0.29, 0.37, -1, { offset: 0.003, ny: 6, nz: 60 }));
  const top = 0.37;
  const edge = [];
  for (let z = -0.7; z <= 0.7001; z += 0.035) edge.push(new Vector2((endX(top, z, -1) ?? -2) - 0.022, z));
  for (let z = 0.7; z >= -0.7001; z -= 0.035) edge.push(new Vector2((endX(top, z, -1) ?? -2) + 0.03, z));
  const blade = new ExtrudeGeometry(new Shape(edge), { depth: 0.01, bevelEnabled: false });
  blade.rotateX(Math.PI / 2);
  blade.translate(0, top + 0.004, 0);
  add(blade);

  const sheet = (pts, depth) => {
    const s = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth, bevelEnabled: false });
    s.translate(0, 0, -depth / 2);
    return s;
  };
  // Six raked fins hang under it, between the pairs of tips, each with a
  // stripe of the wrap down its trailing edge.
  for (const z of [0.07, 0.19, 0.31]) {
    const xs = endX(0.33, z, -1) ?? -2.02;
    const fin = sheet([[xs + 0.1, 0.33], [xs - 0.035, 0.33], [xs - 0.085, 0.19], [xs - 0.005, 0.18]], 0.008);
    fin.translate(0, 0, z);
    add(both(fin));
    const stripe = sheet([[xs - 0.035, 0.33], [xs - 0.047, 0.33], [xs - 0.097, 0.19], [xs - 0.085, 0.19]], 0.0104);
    stripe.translate(0, 0, z);
    add(both(stripe), "paint");
  }
  return g;
}

function exhaust() {
  const g = new Group();
  const add = (geo, mat = "steel") => g.add(mesh(geo, mat, "exhaust"));
  // From the downpipe's flange back down the tunnel, over the axle, into the silencer.
  add(tube([[0.38 + BAY_X, 0.19, 0], [0, 0.19, 0.02], [-0.6, 0.2, 0.02], [-1.1, 0.24, 0], [-1.45, 0.25, 0]], 0.032));
  add(cyl(0.06, 0.06, 0.42, -0.45, 0.22, 0.02, "x"));
  add(cyl(0.085, 0.085, 0.86, -1.72, 0.27, 0, "z"));
  // Each pair's mouths line up a few centimetres proud of the bumper.
  const x0 = Math.min(...TIPS_Z.map((z) => endX(TIP_Y, z, -1) ?? -2.02)) - 0.05;
  for (const z of TIPS_Z) {
    for (const s of [1, -1]) {
      add(tube([[-1.72, 0.27, s * (z - 0.06)], [-1.84, 0.29, s * z], [x0 + 0.12, TIP_Y, s * z]], 0.028, 12, 10));
      // Black tips with a dark throat.
      add(cyl(TIP_R, TIP_R, 0.14, x0 + 0.07, TIP_Y, s * z, "x", 32, true), "tip");
      add(cyl(TIP_R - 0.007, TIP_R - 0.007, 0.14, x0 + 0.07, TIP_Y, s * z, "x", 32, true), "trim");
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

  add(rbox(0.07, 0.42, 1.0, 0.02, 1.8, 0.46, 0), "plastic"); // radiator support
  add(rbox(0.14, 0.025, 0.9, 0.008, 1.76, 0.695, 0), "plastic"); // slam-panel cover
  add(rbox(0.34, 0.36, 0.62, 0.04, 1.35, 0.43, 0.19), "engine"); // block
  add(rbox(0.3, 0.12, 0.6, 0.04, 1.35, 0.67, 0.19), "engine"); // head
  add(rbox(0.15, 0.24, 0.58, 0.04, 1.58, 0.56, 0.19), "plastic"); // intake manifold
  add(rbox(0.36, 0.3, 0.36, 0.06, 1.33, 0.35, -0.3), "engine"); // DSG, under the intake
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

  // Unitronic carbon intake: a housing wide and squarish behind the slam
  // panel on the driver's side, sweeping back and inboard as it narrows into
  // the round mouth of the inlet hose; its snorkel reaches forward to the
  // slam panel.
  const path = new CatmullRomCurve3([[1.68, 0.62, -0.37], [1.56, 0.635, -0.33], [1.44, 0.665, -0.25], [1.37, 0.7, -0.19]].map((q) => new Vector3(...q)));
  const rings = range(0, 1, 18).map((u) => {
    const c = path.getPoint(u);
    const t = path.getTangent(u);
    const side = new Vector3(-t.z, 0, t.x).normalize();
    const w = lerp(0.34, 0.09, u ** 1.7) / 2;
    const h = lerp(0.24, 0.09, u ** 1.7) / 2;
    const n = lerp(5, 2, u);
    const ring = range(0, -Math.PI * 2, 32).map((a) => {
      const pw = (v) => Math.sign(v) * Math.abs(v) ** (2 / n);
      return c.clone().addScaledVector(side, w * pw(Math.cos(a))).add(new Vector3(0, h * pw(Math.sin(a)), 0)).toArray();
    });
    return ring;
  });
  // The housing's skin, and a lid closing its front end.
  const housing = grid(rings, { side: 1 }).toNonIndexed();
  housing.deleteAttribute("uv");
  const front = rings[0];
  const c0 = path.getPoint(0).toArray();
  const lid = new BufferGeometry();
  lid.setAttribute("position", new Float32BufferAttribute(front.slice(0, -1).flatMap((q, i) => [...c0, ...q, ...front[i + 1]]), 3));
  lid.computeVertexNormals();
  housing.computeVertexNormals();
  add(planarUV(mergeGeometries([housing, lid]), "x", "z", 7), "carbon", "intake");
  add(planarUV(tube([[1.74, 0.66, -0.34], [1.78, 0.66, -0.34], [1.8, 0.62, -0.32]], 0.04, 16, 12), "x", "z", 7), "carbon", "intake");

  // Turbo at the back of the block; the inlet arches from the airbox over to it.
  add(cyl(0.065, 0.065, 0.07, 1.12, 0.55, 0.02, "z", 24), "steel");
  add(cyl(0.055, 0.055, 0.07, 1.12, 0.52, 0.1, "z", 24), "steel");
  add(tube([[1.39, 0.695, -0.2], [1.3, 0.77, -0.16], [1.16, 0.76, -0.11], [1.07, 0.66, -0.03], [1.1, 0.57, 0.01]], 0.042), "inlet", "inlet");

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
  for (const z of [0.5, -0.5]) add(cyl(0.07, 0.07, 0.06, X.strut - BAY_X, 0.78, z), "plastic");
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

const WHEEL = { x: 0.2, y: 0.94, z: -0.37, r: 0.18, tilt: -0.38 };

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
  const merge = (...gs) => mergeGeometries(gs.map((x) => (x.index ? x.toNonIndexed() : x)));

  // Dash, with the centre stack standing out of it down to the console: the
  // touchscreen, the vents over it, the climate panel's three knobs. Chrome
  // rings round the outer vents, a chrome strip across the passenger side.
  // All of it faces the cabin (-x).
  add(rbox(0.46, 0.22, 1.42, 0.06, 0.6, 0.87, 0), "interior");
  add(rbox(0.27, 0.4, 0.27, 0.03, 0.47, 0.75, 0), "interior");
  add(rbox(0.36, 0.22, 0.2, 0.04, 0.05, 0.5, 0), "interior"); // console
  add(rbox(0.3, 0.08, 0.17, 0.03, -0.2, 0.64, 0), "leather"); // armrest
  const face = (w, h, x, y, z) => {
    const f = new PlaneGeometry(w, h);
    f.rotateY(-Math.PI / 2);
    f.translate(x, y, z);
    return f;
  };
  add(face(0.215, 0.13, 0.334, 0.82, 0), "gloss");
  add(face(0.18, 0.1, 0.333, 0.82, 0.01), "screen");
  for (const z of [-0.06, 0.06]) add(face(0.095, 0.04, 0.334, 0.915, z), "gloss");
  add(face(0.215, 0.07, 0.334, 0.7, 0), "gloss");
  for (const z of [-0.07, 0, 0.07]) {
    add(cyl(0.019, 0.019, 0.02, 0.33, 0.7, z, "x", 20), "gloss");
    const knob = new TorusGeometry(0.019, 0.003, 6, 24);
    knob.rotateY(Math.PI / 2);
    knob.translate(0.32, 0.7, z);
    add(knob, "chrome");
  }
  for (const z of [-0.6, 0.6]) {
    add(face(0.12, 0.065, 0.368, 0.9, z), "gloss");
    const rim = new Shape();
    roundRect(-0.07, -0.042, 0.07, 0.042, 0.03, rim);
    rim.holes.push(roundRect(-0.06, -0.032, 0.06, 0.032, 0.024, new Path()));
    const ring = new ShapeGeometry(rim, 6);
    ring.rotateY(-Math.PI / 2);
    ring.translate(0.367, 0.9, z);
    add(ring, "chrome");
  }
  add(rbox(0.006, 0.008, 0.5, 0.003, 0.368, 0.855, 0.42), "chrome");

  // The cluster's cowl over two chrome-ringed dials, behind the wheel.
  add(rbox(0.18, 0.13, 0.36, 0.04, 0.45, 0.98, WHEEL.z), "interior");
  for (const dz of [-0.085, 0.085]) {
    add(face(0.09, 0.09, 0.359, 0.97, WHEEL.z + dz), "gloss");
    const dial = new TorusGeometry(0.045, 0.0035, 6, 32);
    dial.rotateY(Math.PI / 2);
    dial.translate(0.357, 0.97, WHEEL.z + dz);
    add(dial, "chrome");
  }
  add(cyl(0.025, 0.03, 0.18, 0.31, 0.89, WHEEL.z, "x", 12), "interior"); // column

  // The DSG lever in its boot on the console.
  add(cyl(0.032, 0.042, 0.03, 0.06, 0.625, 0, "y", 16), "leather");
  const knob = new SphereGeometry(1, 20, 14);
  knob.scale(0.03, 0.045, 0.026);
  knob.translate(0.06, 0.675, 0);
  add(knob, "leather");
  add(cyl(0.02, 0.024, 0.008, 0.06, 0.718, 0, "y", 16), "chrome");

  // The R's sport seats: a quilted centre between big side bolsters, the
  // headrest separate on its posts, the R stitched into the backrest.
  // Built facing +x with the back's foot at the origin, then reclined.
  const RECLINE = 0.3;
  const place = (geo, x, y, z) => {
    geo.rotateZ(RECLINE);
    geo.translate(x, y, z);
    return geo;
  };
  for (const z of [0.37, -0.37]) {
    add(merge(
      rbox(0.48, 0.09, 0.34, 0.04, -0.03, 0.44, z),
      rbox(0.46, 0.12, 0.08, 0.035, -0.03, 0.47, z + 0.21),
      rbox(0.46, 0.12, 0.08, 0.035, -0.03, 0.47, z - 0.21),
    ), "leather");
    add(place(merge(
      rbox(0.1, 0.58, 0.32, 0.04, -0.06, 0.3, 0),
      rbox(0.17, 0.48, 0.09, 0.04, -0.02, 0.27, 0.205),
      rbox(0.17, 0.48, 0.09, 0.04, -0.02, 0.27, -0.205),
      rbox(0.1, 0.17, 0.26, 0.045, -0.07, 0.75, 0),
      cyl(0.006, 0.006, 0.08, -0.07, 0.62, 0.07, "y", 8),
      cyl(0.006, 0.006, 0.08, -0.07, 0.62, -0.07, "y", 8),
    ), -0.27, 0.47, z), "leather");
    const logo = new PlaneGeometry(0.075, 0.06);
    logo.rotateY(Math.PI / 2);
    logo.translate(-0.008, 0.5, 0);
    g.add(sticker(place(logo, -0.27, 0.47, z), STICKER.badgeR, ["z", -1], ["y", 1]));
  }

  // The rear bench and its three headrests.
  add(rbox(0.46, 0.13, 1.12, 0.05, -0.93, 0.45, 0), "leather");
  const rb = merge(rbox(0.12, 0.56, 1.12, 0.05, -0.06, 0.28, 0), ...[-0.4, 0, 0.4].map((dz) => rbox(0.09, 0.13, dz ? 0.24 : 0.2, 0.035, -0.07, 0.65, dz)));
  rb.rotateZ(0.38);
  rb.translate(-1.13, 0.5, 0);
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

/**
 * One straight, wide, flat-faced spoke, deeper at the hub than at the rim so
 * the face is dished, and a foot that flares into the rim.
 */
function spoke(angle, w) {
  const r0 = 0.068;
  const r1 = RIM_R - 0.03;
  const r2 = RIM_R - 0.01;
  const f = (r) => w / 2 - 0.072 + ((r - r0) / (r2 - r0)) * 0.062;
  const d = 0.03;
  const piece = (ra, rb, ha, hb) =>
    block([
      [-ha, ra, f(ra)],
      [ha, ra, f(ra)],
      [hb, rb, f(rb)],
      [-hb, rb, f(rb)],
      [-ha, ra, f(ra) - d],
      [ha, ra, f(ra) - d],
      [hb, rb, f(rb) - d],
      [-hb, rb, f(rb) - d],
    ]);
  const g = mergeGeometries([piece(r0, r1, 0.036, 0.026), piece(r1, r2, 0.026, 0.036)]);
  g.rotateZ(angle);
  return g;
}

/*
 * Superspeed six-spoke in gloss black: wide flat spokes, milled slots in the
 * lip either side of each one's foot, bronze lug nuts round a black cap, on
 * Firehawk Indy 500s.
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
    // The milled slots in the lip either side of each spoke's foot.
    for (const side of [-1, 1]) {
      const notch = rbox(0.026, 0.007, 0.006, 0.002, 0, RIM_R - 0.016, w / 2 - 0.006, 1);
      notch.rotateZ(a + side * 0.24);
      add(notch, "machined");
    }
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

// The engine bay is laid out in its own block (engine(), downpipe()) and
// seated this far forward, between the firewall behind the cowl and the
// radiator; parts that belong to the body (strut tops) subtract it back out.
export const BAY_X = 0.15;

/**
 * The whole car. userData.openHood(k) swings the hood, k 0..1; parts are
 * tagged for the scene to light up. The body rides RIDE_DROP below its stock
 * height over the wheels.
 */
export function buildCar() {
  DECAL_MISSES.length = 0;
  const car = new Group();
  car.name = "golf-r";
  const chassis = new Group();
  chassis.position.y = -RIDE_DROP;
  const bay = new Group();
  bay.position.x = BAY_X;
  bay.add(engine(), downpipe());
  chassis.add(body(), nose(), tail(), mirror(), spoiler(), diffuser(), exhaust(), bay, interior());
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
