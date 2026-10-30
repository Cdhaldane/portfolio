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
  archR: 0.37,
  archY: 0.33,
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

// Centreline silhouette: bumper face, grille, hood, windshield, roof, hatch
// glass, tailgate. Both ends finish on a vertical edge (bottom() meets it), so
// the bumper and the tailgate stand upright instead of tapering to a point.
const top = profile([
  [2.195, 0.62], [2.19, 0.634], [2.17, 0.664], [2.12, 0.735], [2.075, 0.798], [2.05, 0.817],
  [2.0, 0.833], [1.7, 0.862], [1.3, 0.898], [0.95, 0.93], [0.7, 0.965], [0.62, 0.98],
  [0.4, 1.1], [0.15, 1.235], [-0.05, 1.33], [-0.2, 1.385], [-0.35, 1.418], [-0.6, 1.436],
  [-1.0, 1.432], [-1.4, 1.418], [-1.72, 1.395], [-1.8, 1.37], [-1.86, 1.28], [-1.93, 1.14],
  [-1.985, 1.0], [-2.0, 0.96], [-2.02, 0.88], [-2.035, 0.78], [-2.045, 0.7], [-2.06, 0.66],
  [-2.075, 0.635], [-2.081, 0.62],
]);

// Underside: the lower bumper tucks back to the splitter, the diffuser rises
// at the tail, and each meets top() in that vertical end edge.
const bottom = profile([
  [2.195, 0.3], [2.193, 0.26], [2.188, 0.232], [2.175, 0.21], [2.15, 0.19], [2.1, 0.175],
  [2.0, 0.165], [1.8, 0.16], [0, 0.155], [-1.75, 0.165], [-1.9, 0.2], [-2.0, 0.245],
  [-2.05, 0.275], [-2.07, 0.305], [-2.078, 0.33], [-2.081, 0.36],
]);

// Half width at the widest point of each section (the shoulder). In plan the
// nose is a broad, gently curved face with tight corners; the tail is flatter
// still. The body is widest over the rear wheels.
const shoulderW = profile([
  [2.195, 0.04], [2.1935, 0.32], [2.19, 0.46], [2.182, 0.58], [2.168, 0.68], [2.145, 0.76],
  [2.11, 0.815], [2.06, 0.85], [1.98, 0.872], [1.8, 0.886], [1.3, 0.895], [0.6, 0.889],
  [-0.5, 0.887], [-1.3, 0.897], [-1.7, 0.89], [-1.9, 0.878], [-1.98, 0.862], [-2.02, 0.84],
  [-2.05, 0.8], [-2.066, 0.73], [-2.075, 0.63], [-2.0795, 0.48], [-2.0808, 0.3], [-2.081, 0.04],
]);

// Height of the shoulder: the tornado line, a crease running from the
// headlight to the tail light and rising gently on the way; at each end it
// drops to the bumper's widest line.
const shoulderY = profile([
  [2.195, 0.47], [2.16, 0.52], [2.12, 0.62], [2.06, 0.74], [2.0, 0.79], [1.9, 0.805],
  [1.6, 0.825], [1.0, 0.84],
  [0, 0.855], [-1.0, 0.868], [-1.6, 0.875], [-1.95, 0.865], [-2.02, 0.8], [-2.05, 0.66],
  [-2.07, 0.55], [-2.081, 0.5],
]);

// Beltline: the hood's edge up front, the base of the side glass in the cabin.
const beltY = profile([
  [2.195, 0.6], [2.15, 0.73], [2.1, 0.775], [2.06, 0.8], [2.0, 0.815], [1.5, 0.86], [1.0, 0.895],
  [0.62, 0.945], [0, 0.962], [-1.0, 0.99], [-1.6, 1.015], [-1.85, 1.02], [-1.95, 1.005],
  [-1.985, 0.98], [-2.02, 0.88], [-2.06, 0.65], [-2.081, 0.6],
]);

// How far the beltline sits inboard of the shoulder.
const beltInset = profile([
  [2.195, 0.01], [2.1, 0.04], [1.5, 0.05], [0.6, 0.05], [-1.6, 0.05], [-2.0, 0.04], [-2.081, 0.01],
]);

// Top of the side glass: the A-pillar, the roof rail, the C-pillar into the hatch.
const roofEdgeY = profile([
  [0.7, 0.9], [0.62, 0.97], [0.4, 1.06], [0.15, 1.175], [-0.05, 1.27], [-0.2, 1.33],
  [-0.35, 1.365], [-0.6, 1.382], [-1.0, 1.38], [-1.4, 1.37], [-1.7, 1.355], [-1.8, 1.32],
  [-1.86, 1.23], [-1.93, 1.1], [-1.985, 0.97], [-2.02, 0.9],
]);

// Half width at the roof edge: the greenhouse's tumblehome.
const roofEdgeW = profile([
  [0.62, 0.8], [0.3, 0.735], [0, 0.68], [-0.25, 0.645], [-0.6, 0.628], [-1.2, 0.622],
  [-1.6, 0.612], [-1.8, 0.6], [-1.86, 0.64], [-1.93, 0.72], [-1.985, 0.8],
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
  const wRock = arch === null ? wsh - 0.02 : wsh + 0.002;
  const ysh = clamp(shoulderY(x), ya + 0.03, yTop - 0.008);
  const ybl = clamp(beltY(x), ysh + 0.004, yTop - 0.004);
  const wbl = wsh - beltInset(x);
  const yre = clamp(roofEdgeY(x), ybl + 0.002, yTop - 0.002);
  const wre = Math.min(roofEdgeW(x), wbl - 0.003);
  // The hood's raised centre: near-level between two lengthwise creases,
  // falling away outboard of them to the fender line.
  const hood = smooth(0.62, 0.78, x) * (1 - smooth(1.98, 2.06, x));
  const c = [
    [0, yb],
    [wIn, yb],
    [wIn, ya],
    [wLip, ya],
    [wRock, ya + Math.min(0.09, (ysh - ya) * 0.35)],
    [wsh, ysh],
    [wbl, ybl],
    [wre, yre],
    [wre * lerp(0.55, 0.5, hood), yTop - (yTop - yre) * lerp(0.22, 0.05, hood)],
    [0, yTop],
  ];
  if (hood > 0) {
    c.tension = TENSION.slice();
    c.tension[8] = lerp(1, 0.3, hood);
  }
  return c;
}

// Tangent scale per control point: below 1 tightens the curve into a crease.
// The tornado line (shoulder) and the side-skirt crease (rocker) are sharp, so
// the doors between them read flat, as they do on a Mk7; the beltline and
// arch lip are firm; the roof stays round.
const TENSION = [1, 0.2, 0.2, 0.3, 0.35, 0.15, 0.45, 0.8, 1, 1];

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
