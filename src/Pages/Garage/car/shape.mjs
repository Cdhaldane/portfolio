/*
 * The Golf R's body as maths, with no three.js in it.
 *
 * The body is lofted: a closed cross-section at every station along the car,
 * each section a smooth curve through ten control points (see controls()).
 * Every control point follows its own profile along the length, so the hood,
 * windshield, roof and hatch all fall out of one surface, S(x, t): x is metres
 * along the car and t runs 0..9 from the bottom centre to the top centre on
 * the +z side. Panels, glass and decals are patches cut from that surface,
 * so they meet without seams.
 *
 * Frame: metres, x forward, y up, z to the car's right (the passenger side;
 * the driver sits at -z), origin on the ground at the middle of the
 * wheelbase. Numbers are a 2017 Golf R (Mk7): 4276 long, 1790 wide, 1436
 * high, 2631 wheelbase.
 */

export const DIM = {
  front: 2.195,
  rear: -2.081,
  axle: 1.3155,
  trackF: 1.535,
  trackR: 1.51,
  tireR: 0.318, // 225/40R18
  tireW: 0.225,
  archR: 0.385,
  archY: 0.32,
};

export const T_TOP = 9;

/** Section indices worth naming. */
export const T = { floor: 1, lip: 3, rocker: 4, shoulder: 5, belt: 6, roofEdge: 7, top: 9 };

/** Monotone cubic (Fritsch–Carlson) through [x, y] keys: smooth, never overshoots. */
export function profile(keys) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * m[hi]
    );
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// The profiles below are measured off an orthographic Mk7 Golf R blueprint
// (side, top, front and rear views), scaled to the R's 4276 x 1790 x 1436.

// Centreline silhouette: the nose, a hood that rounds down into it, the long
// raked windshield (base at x 0.97, header at 0.0), a flat roof, the hatch
// glass under the spoiler, the tailgate and the bumper's bulge. Both ends
// finish on a short vertical edge where bottom() meets it.
const top = profile([
  [2.195, 0.45], [2.192, 0.52], [2.185, 0.58], [2.172, 0.63], [2.155, 0.67], [2.135, 0.7],
  [2.11, 0.715], [2.067, 0.73], [2.0, 0.77], [1.94, 0.8], [1.87, 0.833], [1.81, 0.856],
  [1.75, 0.873], [1.68, 0.89], [1.55, 0.913], [1.42, 0.938], [1.3, 0.955], [1.17, 0.972],
  [1.04, 0.985], [0.97, 0.997], [0.91, 1.02], [0.85, 1.053], [0.78, 1.092], [0.655, 1.158],
  [0.527, 1.222], [0.398, 1.285], [0.27, 1.343], [0.142, 1.384], [0.013, 1.41], [-0.115, 1.424],
  [-0.24, 1.431], [-0.35, 1.436], [-0.8, 1.436], [-0.95, 1.429], [-1.27, 1.41], [-1.46, 1.39],
  [-1.59, 1.372], [-1.66, 1.36], [-1.7, 1.3], [-1.8, 1.15], [-1.88, 1.03], [-1.93, 0.965],
  [-1.975, 0.9], [-1.995, 0.82], [-2.005, 0.74], [-2.02, 0.685], [-2.045, 0.645], [-2.065, 0.615],
  [-2.081, 0.585],
]);

// Underside: the front lip, sills a hand's width off the ground, the
// diffuser rising into the tail.
const bottom = profile([
  [2.195, 0.3], [2.192, 0.27], [2.183, 0.25], [2.16, 0.235], [2.12, 0.225], [2.05, 0.215],
  [1.95, 0.205], [1.8, 0.195], [0.9, 0.18], [0, 0.185], [-0.9, 0.195], [-1.75, 0.235],
  [-1.85, 0.25], [-1.95, 0.27], [-2.02, 0.3], [-2.05, 0.34], [-2.068, 0.4], [-2.078, 0.45],
  [-2.081, 0.48],
]);

// Half width in plan (the widest point of each section). Both ends are round
// in plan, the nose more than the tail; the front wings are the widest point.
const shoulderW = profile([
  [2.195, 0.04], [2.1935, 0.2], [2.189, 0.25], [2.183, 0.31], [2.172, 0.386], [2.16, 0.438],
  [2.148, 0.478], [2.137, 0.51], [2.125, 0.536], [2.113, 0.553], [2.09, 0.596], [2.067, 0.631],
  [2.043, 0.665], [2.02, 0.688], [1.997, 0.711], [1.974, 0.734], [1.95, 0.751], [1.92, 0.777],
  [1.898, 0.795], [1.875, 0.809], [1.851, 0.823], [1.828, 0.838], [1.805, 0.849], [1.781, 0.861],
  [1.758, 0.872], [1.735, 0.878], [1.7, 0.887], [1.3, 0.895], [0.97, 0.895], [0.89, 0.884],
  [0.8, 0.878], [0, 0.878], [-0.4, 0.872], [-0.7, 0.864], [-1.0, 0.864], [-1.15, 0.866],
  [-1.4, 0.861], [-1.6, 0.855], [-1.662, 0.852], [-1.69, 0.844], [-1.72, 0.838], [-1.75, 0.826],
  [-1.78, 0.809], [-1.81, 0.79], [-1.84, 0.77], [-1.87, 0.746], [-1.9, 0.725], [-1.93, 0.694],
  [-1.96, 0.659], [-1.99, 0.613], [-2.017, 0.55], [-2.04, 0.481], [-2.058, 0.406], [-2.069, 0.273],
  [-2.075, 0.167], [-2.081, 0.04],
]);

// Height of the shoulder: the tornado line at about 0.82, from the back of
// the headlight to the tail light. Ahead of the headlight's tip it dives under
// the lamp to the bumper's widest line (and stops being a crease, see
// controls()); at the tail it drops the same way.
const shoulderY = profile([
  [2.195, 0.38], [2.15, 0.44], [2.1, 0.47], [2.0, 0.5], [1.9, 0.52], [1.8, 0.545], [1.72, 0.59],
  [1.667, 0.735], [1.6, 0.79], [1.5, 0.8], [1.0, 0.815], [0, 0.82], [-0.5, 0.823], [-1.0, 0.826],
  [-1.4, 0.826], [-1.6, 0.818], [-1.68, 0.807], [-1.8, 0.795], [-1.9, 0.765], [-1.97, 0.7],
  [-2.02, 0.62], [-2.06, 0.56], [-2.081, 0.53],
]);

// Beltline: the hood's shut line up front (which is the top edge of each
// headlight, then the top of the wing back to the A-pillar), the base of the
// side glass in the cabin, the foot of the hatch glass at the back.
const beltY = profile([
  [2.195, 0.44], [2.155, 0.62], [2.12, 0.703], [2.07, 0.712], [2.0, 0.727], [1.9, 0.75],
  [1.8, 0.768], [1.72, 0.779], [1.6, 0.802], [1.5, 0.838], [1.25, 0.885], [1.03, 0.922],
  [0.97, 0.935], [0.85, 0.95],
  [0.55, 0.962], [0, 0.982], [-0.5, 0.995], [-1.0, 1.0], [-1.3, 1.0], [-1.6, 0.998],
  [-1.75, 0.99], [-1.88, 0.975], [-1.93, 0.94], [-1.975, 0.88], [-2.0, 0.8], [-2.04, 0.66],
  [-2.081, 0.57],
]);

// How far the beltline sits inboard of the widest point: the Mk7's broad
// shoulder shelf, deepest along the doors.
const beltInset = profile([
  [2.195, 0.03], [2.1, 0.06], [1.9, 0.08], [1.6, 0.088], [1.0, 0.088], [0.5, 0.088], [0, 0.085],
  [-1.0, 0.08], [-1.5, 0.07], [-1.75, 0.058], [-1.9, 0.045], [-2.0, 0.035], [-2.081, 0.03],
]);

// The hood's shut line in plan where it runs round the headlights. The lamps
// take the hood's front corners, so its edge cuts in along their inner side,
// from the back of each lamp to the end of the grille. (Further back the
// beltline's inset governs; this only ever narrows it.)
const hoodEdgeW = profile([
  [1.55, 0.83], [1.68, 0.805], [1.72, 0.79], [1.76, 0.745], [1.8, 0.695], [1.9, 0.592],
  [2.0, 0.5], [2.07, 0.468], [2.12, 0.47], [2.195, 0.45],
]);

// The hood's two creases, in plan and how far they sit under the centreline:
// from its back corners they run in towards the ends of the grille, a shallow
// dome between them and the hood falling away outboard to the lamps.
const creaseW = profile([
  [1.03, 0.765], [1.2, 0.725], [1.4, 0.68], [1.5, 0.66], [1.8, 0.567], [2.0, 0.5], [2.12, 0.45],
]);
const creaseDrop = profile([[1.03, 0.035], [1.5, 0.05], [1.8, 0.04], [2.0, 0.03], [2.12, 0.005]]);

// Top of the side glass: up the A-pillar, along the roof rail, down the
// C-pillar to the foot of the hatch glass.
const roofEdgeY = profile([
  [1.0, 0.94], [0.97, 0.985], [0.9, 1.005], [0.8, 1.045], [0.65, 1.11], [0.5, 1.17],
  [0.35, 1.235], [0.2, 1.29], [0.05, 1.335], [-0.1, 1.355], [-0.3, 1.366], [-0.7, 1.368],
  [-1.0, 1.36], [-1.3, 1.345], [-1.5, 1.33], [-1.6, 1.312], [-1.66, 1.285], [-1.72, 1.21],
  [-1.8, 1.1], [-1.88, 0.99], [-1.93, 0.94],
]);

// Half width at the roof edge: a strong tumblehome, the roof about 1.15 m
// across its rails along the cabin.
const roofEdgeW = profile([
  [1.0, 0.82], [0.97, 0.8], [0.8, 0.745], [0.6, 0.7], [0.48, 0.676], [0.32, 0.65], [0.15, 0.625],
  [0, 0.605], [-0.33, 0.585], [-0.75, 0.57], [-1.1, 0.563], [-1.5, 0.565], [-1.62, 0.56],
  [-1.72, 0.6], [-1.8, 0.66], [-1.88, 0.72],
]);

/** Top of the wheel opening at x, or null outside both arches. Flat-bottomed arches. */
export function archTop(x) {
  for (const ax of [DIM.axle, -DIM.axle]) {
    const dx = x - ax;
    if (Math.abs(dx) < DIM.archR) return DIM.archY + Math.sqrt(DIM.archR * DIM.archR - dx * dx);
  }
  return null;
}

/*
 * The ten [z, y] control points of the +z half-section at x:
 *   0 bottom centre · 1 floor edge · 2 top of the wheel well's inner wall ·
 *   3 the arch lip · 4 rocker · 5 shoulder · 6 beltline · 7 roof edge ·
 *   8 roof crown · 9 top centre.
 * Away from the wheels, 1-3 sit on one spot and the well vanishes. Inside an
 * arch they open into a pocket: floor, up the inner wall, out along the well's
 * ceiling to the lip, so the wheel has somewhere to live and the engine bay
 * keeps its floor.
 */
export const WELL_Z = 0.6;

export function controls(x) {
  const yTop = top(x);
  const yb = Math.min(bottom(x), yTop - 0.05);
  const arch = archTop(x);
  const ya = arch === null ? yb : Math.min(Math.max(yb, arch), yTop - 0.04);
  const wsh = shoulderW(x);
  // Under the doors the floor tucks well in behind the skirts; the bumpers
  // run nearly straight down to their lips.
  const ends = smooth(1.75, 1.95, Math.abs(x));
  const wb = Math.max(wsh - lerp(0.1, 0.045, ends), wsh * 0.6);
  const wIn = arch === null ? wb : Math.min(WELL_Z, wb);
  // Over the wheels the arch lip flares a little proud of the flank.
  const wLip = arch === null ? wb : wsh + 0.005;
  const wRock = arch === null ? wsh - 0.006 : wsh + 0.002;
  const ysh = clamp(shoulderY(x), ya + 0.03, yTop - 0.008);
  const ybl = clamp(beltY(x), ysh + 0.004, yTop - 0.004);
  const wbl = Math.min(wsh - beltInset(x), hoodEdgeW(x));
  let yre = clamp(roofEdgeY(x), ybl + 0.002, yTop - 0.002);
  let wre = Math.min(roofEdgeW(x), wbl - 0.003);
  // Ahead of the windshield the roof edge becomes the hood's crease, and the
  // crown sits on the dome between the two creases.
  const hood = smooth(0.97, 1.06, x);
  if (hood > 0) {
    const wc = Math.min(creaseW(x), wbl - 0.012);
    const yc = clamp(yTop - creaseDrop(x), ybl + 0.004, yTop - 0.002);
    wre = lerp(wre, wc, hood);
    yre = lerp(yre, yc, hood);
  }
  const crown = [wre * lerp(0.62, 0.5, hood), yTop - (yTop - yre) * lerp(0.14, 0.25, hood)];
  const c = [
    [0, yb],
    [wIn, yb],
    [wIn, ya],
    [wLip, ya],
    [wRock, ya + Math.min(0.12, (ysh - ya) * 0.3)],
    [wsh - 0.012, ysh],
    [wbl, ybl],
    [wre, yre],
    crown,
    [0, yTop],
  ];
  // The hood's creases are crisp; the tornado line fades out ahead of the
  // headlight's tip, so the wing rounds smoothly under the lamp.
  const lamp = smooth(1.6, 1.72, x);
  if (hood > 0 || lamp > 0) {
    c.tension = TENSION.slice();
    c.tension[7] = lerp(TENSION[7], 0.3, hood);
    c.tension[5] = lerp(TENSION[5], 1, lamp);
  }
  return c;
}

// Tangent scale per control point: below 1 tightens the curve into a crease.
// The tornado line (shoulder) is firm and the shelf above it rolls in to the
// beltline; the doors below stand almost upright to the skirt; the roof is
// round across.
const TENSION = [1, 0.2, 0.2, 0.3, 0.6, 0.35, 0.45, 0.8, 1, 1];

const cache = new Map();
function cachedControls(x) {
  const key = Math.round(x * 1e5);
  let c = cache.get(key);
  if (!c) {
    c = controls(x);
    if (cache.size > 20000) cache.clear();
    cache.set(key, c);
  }
  return c;
}

/*
 * A point on a section at t (0..9). Hermite segments with Catmull-Rom style
 * tangents, each scaled by the lengths of the chords around it, so a segment
 * that collapses (the greenhouse over the hood) stays a straight sliver
 * instead of looping. Phantom points mirrored across the centreline make the
 * curve cross z = 0 square, so the two halves join smoothly.
 */
export function sectionPoint(ctrl, t) {
  const n = ctrl.length - 1;
  const tc = clamp(t, 0, n);
  const i = Math.min(Math.floor(tc), n - 1);
  const s = tc - i;
  const at = (j) => {
    if (j < 0) return [-ctrl[1][0], ctrl[1][1]];
    if (j > n) return [-ctrl[n - 1][0], ctrl[n - 1][1]];
    return ctrl[j];
  };
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  const l0 = len(p0, p1);
  const l1 = len(p1, p2);
  const l2 = len(p2, p3);
  const ten = ctrl.tension || TENSION;
  const k1 = (l1 / (l0 + l1)) * ten[i];
  const k2 = (l1 / (l1 + l2)) * ten[Math.min(i + 1, n)];
  const m1 = [(p2[0] - p0[0]) * k1, (p2[1] - p0[1]) * k1];
  const m2 = [(p3[0] - p1[0]) * k2, (p3[1] - p1[1]) * k2];
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return [
    h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
    h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
  ];
}

/** S(x, t) on the +z side: [x, y, z]. */
export function bodyPoint(x, t) {
  const [z, y] = sectionPoint(cachedControls(x), t);
  return [x, y, z];
}

/*
 * The stations the body is sampled at: 3 cm apart, 4 mm in the last 12 cm of
 * each end where the nose and tail turn in, 1.2 cm inside the arches, and a pair
 * either side of each arch's vertical edge so the opening stays crisp.
 */
export function stations(extra = []) {
  const xs = [];
  for (let x = DIM.rear; x < DIM.front; x += 0.03) xs.push(x);
  for (let x = DIM.front - 0.12; x < DIM.front; x += 0.004) xs.push(x);
  for (let x = DIM.rear; x < DIM.rear + 0.12; x += 0.004) xs.push(x);
  for (let k = 1; k < 10; k++) xs.push(DIM.front - k * 0.0015, DIM.rear + k * 0.0015);
  for (const ax of [DIM.axle, -DIM.axle]) {
    for (let dx = -DIM.archR; dx <= DIM.archR; dx += 0.012) xs.push(ax + dx);
    for (const side of [-1, 1]) {
      xs.push(ax + side * (DIM.archR - 0.0004), ax + side * (DIM.archR + 0.0004));
    }
  }
  xs.push(DIM.front, DIM.rear, ...extra);
  xs.sort((a, b) => a - b);
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-4);
}

/** Outermost z of the +z side at height y on station x, or null if the section doesn't reach y. */
export function sideZ(x, y, t0 = T.lip, t1 = T.roofEdge) {
  const ctrl = cachedControls(x);
  let best = null;
  let prev = sectionPoint(ctrl, t0);
  for (let t = t0 + 0.02; t <= t1 + 1e-9; t += 0.02) {
    const p = sectionPoint(ctrl, t);
    if ((prev[1] - y) * (p[1] - y) <= 0 && prev[1] !== p[1]) {
      const z = prev[0] + ((y - prev[1]) / (p[1] - prev[1])) * (p[0] - prev[0]);
      if (best === null || z > best) best = z;
    }
    prev = p;
  }
  return best;
}

/** Is (y, z) inside the full section at x? */
function insideSection(x, y, z) {
  const ctrl = cachedControls(x);
  const az = Math.abs(z);
  let inside = false;
  let prev = sectionPoint(ctrl, 0);
  for (let t = 0.08; t <= T_TOP + 1e-9; t += 0.08) {
    const p = sectionPoint(ctrl, t);
    // Ray from (az, y) towards +z: count crossings of the half-section.
    if ((prev[1] > y) !== (p[1] > y)) {
      const zc = prev[0] + ((y - prev[1]) / (p[1] - prev[1])) * (p[0] - prev[0]);
      if (zc > az) inside = !inside;
    }
    prev = p;
  }
  return inside;
}

/*
 * Where the body's skin is when you look at it end-on: the x of the nose
 * (dir 1) or tail (dir -1) at (y, z). Sections shrink towards each end, so
 * "inside" flips once along x; a bisection finds it.
 */
export function endX(y, z, dir) {
  // Start just outside the arches, where the section is whole.
  let a = dir > 0 ? 1.75 : -1.75;
  let b = dir > 0 ? DIM.front : DIM.rear;
  if (!insideSection(a, y, z)) return null;
  for (let i = 0; i < 18; i++) {
    const m = (a + b) / 2;
    if (insideSection(m, y, z)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * Where a ray in plan from (xc, y, 0), heading (dx, dz), leaves the body:
 * [x, y, z], or null. For wrapping things round the corners, where looking
 * end-on or side-on both go edge-on to the skin.
 */
export function radialPoint(xc, y, dx, dz) {
  const l = Math.hypot(dx, dz);
  const inside = (s) => {
    const x = xc + (dx / l) * s;
    return x < DIM.front && x > DIM.rear && insideSection(x, y, (dz / l) * s);
  };
  if (!inside(0)) return null;
  let a = 0;
  let b = 2.5;
  for (let i = 0; i < 24; i++) {
    const m = (a + b) / 2;
    if (inside(m)) a = m;
    else b = m;
  }
  const s = (a + b) / 2;
  return [xc + (dx / l) * s, y, (dz / l) * s];
}

/** Height of the centreline silhouette at x. */
export const centreTop = top;

/** Height of the upper surface (roof, hood, glass) at (x, z), searching from the roof edge in. */
export function topY(x, z, t0 = T.belt) {
  const ctrl = cachedControls(x);
  const az = Math.abs(z);
  let prev = sectionPoint(ctrl, t0);
  for (let t = t0 + 0.02; t <= T_TOP + 1e-9; t += 0.02) {
    const p = sectionPoint(ctrl, t);
    if ((prev[0] - az) * (p[0] - az) <= 0 && prev[0] !== p[0]) {
      return prev[1] + ((az - prev[0]) / (p[0] - prev[0])) * (p[1] - prev[1]);
    }
    prev = p;
  }
  return ctrl[ctrl.length - 1][1];
}
