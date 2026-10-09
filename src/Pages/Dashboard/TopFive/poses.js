/*
 * Pure layout maths and shared motion constants for TOP DECK.
 *
 * Every pose is an offset from the table stage's centre, so the same numbers
 * drive the framer poses, the flat hit-grips laid over the 3D, and the unit
 * tests. Cards are authored at their inspect size and only ever scaled DOWN,
 * which keeps their text crisp.
 */

export const CARD_RATIO = 88 / 63; // a real trading card: 63 x 88 mm
export const PACK_RATIO = 1.62;
export const PERSPECTIVE = 1100; // the one lens on the table (px)
export const TILT_MAX = 16; // holo tilt ceiling (deg); readable below 30
// Tilt ranges (deg). A lifted card in the fan sits just 70-90px in front of
// its neighbours, so its corner swing must stay smaller than that gap; the
// inspected card is alone at the front and gets the full range.
export const HAND_TILT = { x: 8, y: 10 };
export const INSPECT_TILT = { x: 14, y: TILT_MAX };
export const SPREAD = 0.42; // fan step as a fraction of the card width
export const MAX_HAND_SCALE = 0.7;
export const TABLE_BARS = { top: 56, bottom: 84 };
const GOLDEN = 2.39996; // golden angle (rad), spreads the depth cloud evenly

// House easing (CLAUDE.md §1) plus the landing / reposition / exit family.
export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EASE_INOUT = [0.45, 0, 0.55, 1];
export const EASE_IN = [0.55, 0, 0.8, 0.4];

// Damping ratios noted for each: smooth by default; the playful ~0.63 is
// spent once, on the legendary flip.
export const SPRING = {
  hover: { type: "spring", stiffness: 380, damping: 30, mass: 0.9 }, // ζ≈0.81
  nudge: { type: "spring", stiffness: 520, damping: 36 }, // victims move first
  travel: { type: "spring", stiffness: 170, damping: 22 }, // ζ≈0.84
  assemble: { type: "spring", stiffness: 120, damping: 18 }, // ζ≈0.82
  tilt: { stiffness: 220, damping: 20, mass: 0.6 }, // ζ≈0.87
  flip: { type: "spring", stiffness: 240, damping: 24 }, // ζ≈0.77
  legend: { type: "spring", stiffness: 180, damping: 17 }, // ζ≈0.63
  slam: { type: "spring", stiffness: 400, damping: 24 },
};

export const DEAL_CADENCE = 0.26; // one countdown beat per card
export const SPEED_CADENCE = 0.12; // after a few packs the deal speeds up
export const LEGEND_HOLD = 1.2; // the revealed #1 holds flat to be read (s)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Index-seeded pseudo-random in [0, 1): identical on every visit. */
export const prand = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Scale that cancels the lens magnifying a plane pushed z px forward. */
export const zComp = (z) => (PERSPECTIVE - z) / PERSPECTIVE;

export const cardWidthFor = (vw) => clamp(vw * 0.78, 248, 340);

/** The table stage: the viewport between the top and bottom bars. */
export const stageBox = (vw, vh) => ({
  top: TABLE_BARS.top,
  w: vw,
  h: Math.max(0, vh - TABLE_BARS.top - TABLE_BARS.bottom),
});

/** The fan's moving parts at a given hand scale. */
const fanGeometry = ({ cw, ch, angle, captionH }, handScale) => {
  const lift = ch * handScale * 0.18 + 16;
  return {
    cw,
    ch,
    angle,
    captionH,
    handScale,
    step: cw * handScale * SPREAD,
    lift,
    arc: 10 * handScale,
    handY: lift * 0.5,
  };
};

export function handLayout({ stageW, stageH, cw }) {
  const ch = cw * CARD_RATIO;
  const angle = stageW < 480 ? 5 : 7;
  const fitInspect = (reserve) =>
    Math.min(1, (stageH - 24 - reserve) / ch, (stageW - 32) / cw);
  // Too small to read the card itself? Reserve a caption strip under it.
  const captionH = fitInspect(0) < 0.62 ? 64 : 0;

  // The fan's projected width scales linearly with handScale, so measure the
  // real extent (rotation, lift, parting, perspective) once at scale 1.
  const unit = fanBounds({ ...fanGeometry({ cw, ch, angle, captionH: 0 }, 1), lift: 0, arc: 0, handY: 0 });
  let handScale = Math.max(
    0.12,
    Math.min(MAX_HAND_SCALE, (stageW - 32) / (unit.right - unit.left), (stageH - 70) / (ch * 1.28))
  );
  // Height isn't quite linear (the lift has a fixed 16px), so check the real
  // projected fan and shrink until it clears the stage edges by 8px.
  for (let pass = 0; pass < 3; pass += 1) {
    const b = fanBounds(fanGeometry({ cw, ch, angle, captionH }, handScale));
    const reach = Math.max(b.bottom, -b.top);
    if (reach <= stageH / 2 - 8 || handScale <= 0.12) break;
    handScale = Math.max(0.12, (handScale * (stageH / 2 - 8)) / reach);
  }

  return {
    ...fanGeometry({ cw, ch, angle, captionH }, handScale),
    stageW,
    stageH,
    inspectScale: Math.max(0.12, fitInspect(captionH)),
  };
}

export function ripLayout({ stageW, stageH }) {
  const w = clamp(stageW * 0.56, 200, 280);
  const h = w * PACK_RATIO;
  return { w, h, scale: clamp((stageH - 40) / h, 0.1, 1) };
}

export const fanPose = (i, L) => {
  const d = i - 2;
  return { x: d * L.step, y: L.handY + d * d * L.arc, z: i * 4, rotate: d * L.angle, scale: L.handScale };
};

// z 90 keeps a HAND_TILT corner swing clear of the neighbours (z 0-16).
const liftedPose = (i, L) => {
  const fan = fanPose(i, L);
  return { ...fan, y: fan.y - L.lift, z: 90, rotate: 0, scale: L.handScale * 1.1 };
};

const spreadPose = (i, lifted, L) => {
  const fan = fanPose(i, L);
  const gap = Math.abs(i - lifted) === 1 ? 0.32 : 0.14;
  return { ...fan, x: fan.x + Math.sign(i - lifted) * L.step * gap };
};

const dimmedPose = (i, L) => {
  const fan = fanPose(i, L);
  return { ...fan, y: fan.y + 64, z: fan.z - 20, scale: L.handScale * 0.94 };
};

const packCardScale = (L, R) => (R.w * R.scale * 0.84) / L.cw;

// The face-down stack sits BEHIND the wrapper body (z < 0), so true depth
// sorting hides it until it rises out of the torn top. -40 clears the
// wrapper's own pointer tilt (±10° sweeps its edges ~±31px in z).
const inPackPose = (i, L, R) => ({
  x: 0,
  y: R.h * R.scale * 0.06 + i * 1.2,
  z: -40 - i * 1.5,
  rotate: 0,
  scale: packCardScale(L, R),
});

// The stack rises out of the torn top, but never past the top of the stage.
const risenPose = (i, L, R) => {
  const half = (L.ch * packCardScale(L, R)) / 2;
  const rise = Math.max(0, Math.min(R.h * R.scale * 0.36, L.stageH / 2 - half - 8));
  return { ...inPackPose(i, L, R), y: -rise + i * 1.2 };
};

// The hero card flips and tilts about its own centre, swinging up to half its
// UNSCALED width in z (scale() never touches z). Parking it that far forward
// keeps the swing clear of the fan behind; zComp keeps its apparent size.
const heroZ = (L, margin) => L.cw / 2 + margin;

const legendPose = (L) => {
  const z = heroZ(L, 30);
  return { x: 0, y: -8, z, rotate: 0, scale: 0.9 * L.inspectScale * zComp(z) };
};

const inspectPose = (L) => {
  const z = heroZ(L, 40);
  return { x: 0, y: -L.captionH / 2, z, rotate: 0, scale: L.inspectScale * zComp(z) };
};

/** Where a card should be for the current beat, and what kind of move it is. */
export function poseFor({ i, phase, tearDone = false, lifted = null, inspected = null, L, R }) {
  switch (phase) {
    case "sealed":
      return { kind: "pack", pose: inPackPose(i, L, R) };
    case "ripping":
      return tearDone
        ? { kind: "risen", pose: risenPose(i, L, R) }
        : { kind: "pack", pose: inPackPose(i, L, R) };
    case "dealing":
      return i === 4
        ? { kind: "risen", pose: risenPose(i, L, R) }
        : { kind: "fan", pose: fanPose(i, L) };
    case "legend":
    case "reveal":
      return i === 4 ? { kind: "legend", pose: legendPose(L) } : { kind: "fan", pose: fanPose(i, L) };
    case "inspect":
      return i === inspected
        ? { kind: "inspect", pose: inspectPose(L) }
        : { kind: "dimmed", pose: dimmedPose(i, L) };
    default:
      if (lifted === i) return { kind: "lifted", pose: liftedPose(i, L) };
      if (lifted !== null && lifted !== undefined) {
        return { kind: "spread", pose: spreadPose(i, lifted, L) };
      }
      return { kind: "fan", pose: fanPose(i, L) };
  }
}

/** Off-stage pose for a pack switch: cards sweep in from (or out to) a side. */
export const sidePose = (i, dir, L, stageW) => {
  const fan = fanPose(i, L);
  return { ...fan, x: fan.x + dir * stageW * 0.62, rotate: fan.rotate + dir * 12 };
};

/** Which fan card sits under a stage-relative x (for the flat hit-grip). */
export const nearestFanIndex = (x, L) => clamp(Math.round(x / L.step + 2), 0, 4);

/**
 * Screen-space bounds of every resting, lifted and parted fan pose, projected
 * through the lens (planes nearer the camera look bigger and drift outward
 * from the perspective origin, which sits at the inspect caption's centre).
 */
export function fanBounds(L) {
  const oy = -(L.captionH || 0) / 2;
  const box = (p) => {
    const w = L.cw * p.scale;
    const h = L.ch * p.scale;
    const t = (Math.abs(p.rotate) * Math.PI) / 180;
    const hw = (w * Math.cos(t) + h * Math.sin(t)) / 2;
    const hh = (w * Math.sin(t) + h * Math.cos(t)) / 2;
    const k = PERSPECTIVE / (PERSPECTIVE - p.z);
    return {
      left: (p.x - hw) * k,
      right: (p.x + hw) * k,
      top: oy + (p.y - hh - oy) * k,
      bottom: oy + (p.y + hh - oy) * k,
    };
  };
  const idx = [0, 1, 2, 3, 4];
  const poses = [
    ...idx.map((i) => fanPose(i, L)),
    ...idx.map((i) => liftedPose(i, L)),
    ...idx.flatMap((li) => idx.filter((i) => i !== li).map((i) => spreadPose(i, li, L))),
  ];
  const boxes = poses.map(box);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** A pack's starting point in the shelf's arrival depth cloud. */
export function cloudPose(i, n, narrow) {
  const a = i * GOLDEN;
  const radius = narrow ? 110 : 200;
  const depth = narrow ? 160 : 300;
  return {
    x: Math.cos(a) * radius,
    y: Math.sin(a) * radius * 0.6 - 60,
    z: depth - (i / Math.max(1, n - 1)) * depth * 2,
    rotateX: Math.sin(a) * 70,
    rotateY: Math.cos(a) * 70,
    rotate: 0,
  };
}

/** A pack's resting pose on the playmat: flat, with a small toss. */
export const homePose = (i) => ({
  x: 0,
  y: Math.round(prand(i + 9) * 8),
  z: 0,
  rotateX: 0,
  rotateY: 0,
  rotate: (prand(i) - 0.5) * 8,
});
