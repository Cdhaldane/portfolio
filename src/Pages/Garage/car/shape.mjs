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
  [2.195, 0.04], [2.189, 0.2534], [2.179, 0.3396], [2.169, 0.3988], [2.159, 0.4403], [2.149, 0.4739], [2.139, 0.5021],
  [2.129, 0.5251], [2.109, 0.5614], [2.089, 0.5962], [2.069, 0.6277], [2.049, 0.6554], [2.029, 0.6786], [2.009, 0.6991],
  [1.989, 0.7185], [1.969, 0.7364], [1.949, 0.7527], [1.929, 0.7691], [1.889, 0.7996], [1.849, 0.8245], [1.809, 0.8469],
  [1.769, 0.8658], [1.729, 0.8793], [1.649, 0.8896], [1.569, 0.8925], [1.489, 0.8941], [1.409, 0.8948], [1.329, 0.895],
  [1.249, 0.895], [1.169, 0.895], [1.089, 0.895], [1.009, 0.895], [0.969, 0.8941], [0.929, 0.89], [0.889, 0.8844],
  [0.849, 0.8805], [0.809, 0.8785], [0.729, 0.878], [0.649, 0.878], [0.569, 0.878], [0.489, 0.878], [0.409, 0.878],
  [0.329, 0.878], [0.249, 0.878], [0.169, 0.878], [0.089, 0.878], [0.009, 0.878], [-0.071, 0.8777], [-0.151, 0.8768],
  [-0.231, 0.8755], [-0.311, 0.8739], [-0.391, 0.8722], [-0.471, 0.87], [-0.551, 0.8672], [-0.631, 0.8649], [-0.711, 0.864],
  [-0.791, 0.864], [-0.871, 0.864], [-0.951, 0.864], [-1.031, 0.8643], [-1.111, 0.8656], [-1.191, 0.8657], [-1.271, 0.8643],
  [-1.351, 0.8623], [-1.431, 0.8602], [-1.511, 0.8579], [-1.591, 0.8553], [-1.631, 0.8537], [-1.671, 0.8486], [-1.711, 0.8391],
  [-1.731, 0.8326], [-1.751, 0.8241], [-1.791, 0.8018], [-1.871, 0.746], [-1.891, 0.7305], [-1.911, 0.713], [-1.931, 0.6924],
  [-1.951, 0.6693], [-1.971, 0.6425], [-1.981, 0.6269], [-1.991, 0.609], [-2.001, 0.5882], [-2.011, 0.5646], [-2.021, 0.5384],
  [-2.031, 0.5095], [-2.041, 0.4782], [-2.051, 0.442], [-2.061, 0.3752], [-2.071, 0.2397], [-2.081, 0.04],
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

// How far inboard of the widest point the tornado line sits. The blueprint's
// front view has the body already narrowing above 0.7 m, so the flank leans in
// a little below the line and the shelf a lot above it.
const SHOULDER_IN = 0.022;

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
  // Round each arch the rocker rides a ring 7 cm outside the opening, which
  // meets the doors' rocker height where it ends, so the flank above it runs
  // on unbroken past the arches. Over the wheels the lip sits just inside the
  // flank (the flare, in surface(), stands it out); beside them, inside the
  // ring, it comes most of the way out from under the floor, so the flank
  // turns under gently there instead of scooping in.
  const R = DIM.archR + 0.07;
  let ring = 0;
  for (const ax of [DIM.axle, -DIM.axle]) {
    const dx = Math.abs(x - ax);
    if (dx < R) ring = Math.max(ring, Math.sqrt(R * R - dx * dx));
  }
  const near = smooth(0, 0.05, ring);
  const wLip = arch === null ? lerp(wb, wsh - 0.028, near) : wsh - 0.008;
  const ysh = clamp(shoulderY(x), ya + 0.03, yTop - 0.008);
  const yRock = Math.max(ya + 0.02, Math.min(yb + 0.12 + ring, ysh - 0.025));
  // Where the rocker rides up near the crease (over the arches), the wing
  // above leans in to the tornado line instead of standing out to it.
  const wRock = wsh - lerp(0.007, 0.02, smooth(ysh - 0.15, ysh - 0.03, yRock));
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
    [wRock, yRock],
    [wsh - SHOULDER_IN, ysh],
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
const TENSION = [1, 0.2, 0.2, 0.3, 0.6, 0.12, 0.45, 0.8, 1, 1];

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

/*
 * The wheel arches' flares: a band round each opening standing out from the
 * flank, ending in a crisp line about 7 cm out from the opening, as the
 * blueprint draws it (it runs down to the sill at either end). Only on the
 * flank, between the arch lip and the tornado line.
 */
const FLARE = { out: 0.008, band: 0.075 };
function flare(x, y, t) {
  const tw = smooth(2.85, 3.0, t) * (1 - smooth(4.55, 4.95, t));
  if (tw === 0) return 0;
  let f = 0;
  for (const ax of [DIM.axle, -DIM.axle]) {
    const s = (Math.hypot(x - ax, Math.max(0, y - DIM.archY)) - DIM.archR) / FLARE.band;
    if (s < 1) f = Math.max(f, FLARE.out * (1 - Math.max(0, s) ** 3));
  }
  return f * tw;
}

/** The skin's half-section at x, t: [z, y], with the flares. */
export function surface(x, t) {
  const [z, y] = sectionPoint(cachedControls(x), t);
  return [z + flare(x, y, t), y];
}

/** S(x, t) on the +z side: [x, y, z]. */
export function bodyPoint(x, t) {
  const [z, y] = surface(x, t);
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
  let best = null;
  let prev = surface(x, t0);
  for (let t = t0 + 0.02; t <= t1 + 1e-9; t += 0.02) {
    const p = surface(x, t);
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
  const az = Math.abs(z);
  let inside = false;
  let prev = surface(x, 0);
  for (let t = 0.08; t <= T_TOP + 1e-9; t += 0.08) {
    const p = surface(x, t);
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
  const az = Math.abs(z);
  let prev = surface(x, t0);
  for (let t = t0 + 0.02; t <= T_TOP + 1e-9; t += 0.02) {
    const p = surface(x, t);
    if ((prev[0] - az) * (p[0] - az) <= 0 && prev[0] !== p[0]) {
      return prev[1] + ((az - prev[0]) / (p[0] - prev[0])) * (p[1] - prev[1]);
    }
    prev = p;
  }
  return surface(x, T_TOP)[1];
}
