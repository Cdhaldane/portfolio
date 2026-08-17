/*
 * render/models/hero.ts — the Vigil, authored in code and cut into limbs.
 *
 * Two playable bodies (HEROES.md): **Amos Kell**, the last marshal of Hollow
 * Creek, and **Ada Prewitt**, its undertaker. They share one skeleton and one
 * part set; everything that differs is geometry.
 *
 * §7 commits to a *full body* camera at a 3.4m boom, which makes the hero the
 * one asset that is on screen 100% of the time and always seen from behind.
 * Three consequences drive everything in this file:
 *
 *  1. **The silhouette from behind is the whole design.** §3 gives the Vigil
 *     "long coat, hat, defined shoulder line", and with two heroes the bar rises
 *     from §17.10's "readable as a black shape" to "readable as *which* black
 *     shape". HEROES.md §3 states the answer as two letterforms — Amos is a T
 *     (wide brim over a wide yoke, flaring hem), Ada is an I (veil falling to a
 *     narrow shoulder, coat hanging straight) — and the numbers below exist to
 *     produce exactly that. The geometry test asserts they stay apart.
 *  2. **One skeleton, two part sets** (HEROES.md §4). §17.6 budgets 28 Mixamo
 *     clips authored against one rig; two skeletons would make that 56 and the
 *     second hero would stop being affordable. So the *vertical* joint heights
 *     are identical for both and the test enforces it. Lateral offsets may
 *     differ — Mixamo retargets by bone name, so a narrower shoulder is a skin
 *     change, not a clip change.
 *  3. **It has to be cut at the joints.** "Mixamo later" cannot mean "a sliding
 *     capsule until then". The body ships as seven parts around real pivots and
 *     `scene.ts` drives them procedurally from the sim's own velocity. When the
 *     rig lands it replaces the driver, not the model — and it replaces it for
 *     both heroes at once, because neither `actors.ts` nor the driver knows
 *     which one it is animating.
 *
 * Every part is authored around **its own pivot at the origin**, limbs hanging
 * down into negative Y. `yBias` tells the shared contact gradient how high that
 * pivot actually sits, so an arm doesn't come out uniformly boot-dark.
 *
 * Facing is **-Z**, matching `sim/aim.ts`; the gun hand is +X (forward × up).
 */

import type { BufferGeometry, Color } from "three";
import { COLOR } from "../palette.ts";
import { CHAR_SHADE, box, buildGeometry, cyl, type Sink } from "./build.ts";

/* ── who ─────────────────────────────────────────────────────────────────── */

export const HERO = {
  /** Amos Kell — the marshal. Wide brim, storm yoke, flaring coat. */
  amos: 0,
  /** Ada Prewitt — the undertaker. Veil to the shoulder, coat hanging straight. */
  ada: 1,
} as const;

export type HeroId = (typeof HERO)[keyof typeof HERO];

export interface HeroProfile {
  id: HeroId;
  key: string;
  name: string;
  /** Shown on the pre-run screen when it exists; the shelf uses it as a label. */
  role: string;
}

export const HEROES: HeroProfile[] = [
  { id: HERO.amos, key: "amos", name: "Amos Kell", role: "The Marshal" },
  { id: HERO.ada, key: "ada", name: "Ada Prewitt", role: "The Undertaker" },
];

/* ── where the joints are ────────────────────────────────────────────────── */

export interface HeroJoints {
  hips: number;
  shoulder: number;
  neck: number;
  legTop: number;
  shoulderX: number;
  hipX: number;
}

/**
 * The rig contract (HEROES.md §4).
 *
 * `hips`, `shoulder`, `neck` and `legTop` are metres above the feet and are the
 * **same for both heroes** — that is the whole reason one clip set can drive
 * two bodies, and the geometry test asserts it rather than trusting review. It
 * is very easy to nudge a shoulder down 3cm to make a collar sit right and
 * discover at M8 that every animation pops on that hero.
 *
 * `shoulderX` and `hipX` may differ, because retargeting maps bones by name and
 * absorbs a lateral offset without touching the clip. That freedom is what lets
 * Ada be narrower through the shoulder without needing a rig of her own.
 *
 * `PLAYER.height` is 1.8 and both hats top out just under 1.95 — headwear is
 * allowed past the nominal height because a hat is a hat, and §17.7's "hero is
 * 1.8m" is about the body.
 */
const VERTICAL = {
  hips: 0.94,
  shoulder: 1.34,
  neck: 1.46,
  /** Legs hang from slightly above the hips so the coat can cover the joint. */
  legTop: 0.86,
} as const;

export const JOINTS: Record<HeroId, HeroJoints> = {
  [HERO.amos]: {
    ...VERTICAL,
    // Just outside the torso's half-width (0.24) so the arms clear it and read
    // as separate volumes rather than as part of the coat.
    shoulderX: 0.3,
    hipX: 0.13,
  },
  [HERO.ada]: {
    ...VERTICAL,
    // Narrower through the shoulder — half of what makes her read as a column
    // rather than a bell. Still outside her torso half-width (0.21).
    shoulderX: 0.255,
    hipX: 0.115,
  },
};

/** The default body. Kept as a named export so `actors.ts` reads legibly. */
export const JOINT = JOINTS[HERO.amos];

/**
 * Which hero to build, from `?hero=ada` on the game URL.
 *
 * Explicitly temporary (HEROES.md §8): hero choice belongs on a pre-run screen
 * next to archetype and seed, which is §10 camp work. It lives here rather than
 * in `scene.ts` so that adding selection needed no change to the renderer, the
 * host loop or the HUD — the whole feature is one default argument.
 *
 * Guarded for `location` because this module is imported by the headless
 * geometry tests, which run in plain Node.
 */
export function defaultHeroId(): HeroId {
  if (typeof location === "undefined") return HERO.amos;
  const want = new URLSearchParams(location.search).get("hero");
  const found = HEROES.find((h) => h.key === want);
  return found ? found.id : HERO.amos;
}

/* ── shared parts ────────────────────────────────────────────────────────── */

/**
 * The per-hero palette.
 *
 * Sleeve is deliberately the *inverse* of the outer coat on both heroes — one
 * step darker on Amos, one step lighter on Ada. §17.1's "high value separation
 * between adjacent parts" is not a stylistic preference for arms: at the first
 * pass Amos's sleeves matched his coat exactly and he read as a coat with no
 * arms at all. Whichever direction the step goes, it has to be there.
 */
interface HeroPalette {
  outer: Color;
  sleeve: Color;
  cuff: Color;
  /** The mid value that breaks up the dark mass — yoke on Amos, harness on Ada. */
  leather: Color;
  /** The at-a-glance personal tell, for co-op (HEROES.md §5). */
  accent: Color;
  trouser: Color;
  boot: Color;
}

const PALETTE: Record<HeroId, HeroPalette> = {
  [HERO.amos]: {
    outer: COLOR.grave,
    sleeve: COLOR.ash,
    cuff: COLOR.timber,
    leather: COLOR.timber,
    accent: COLOR.lamp,
    trouser: COLOR.timberDark,
    boot: COLOR.timber,
  },
  [HERO.ada]: {
    // A step darker overall, which is what lets a pale veil carry her.
    outer: COLOR.ash,
    sleeve: COLOR.grave,
    cuff: COLOR.timberDark,
    leather: COLOR.timber,
    accent: COLOR.sunbleach,
    trouser: COLOR.void,
    boot: COLOR.timberDark,
  },
};

/**
 * One arm. `flip` mirrors it for the left side.
 *
 * Built hanging *down* from the shoulder pivot, so `rotation.x` on the parent
 * group is a shoulder swing with no offset maths — and so the revolver, authored
 * along the same -Y axis, points forward exactly when the arm comes up.
 *
 * Shared between both heroes: a sleeve is a sleeve, and the silhouette work is
 * done by the torso and the head.
 */
function arm(s: Sink, flip: number, p: HeroPalette, width: number): void {
  // Upper arm. Taper >1 = wider at the top, i.e. at the shoulder.
  box(s, { at: [0, -0.26, 0], size: [width, 0.26, width * 1.26], col: p.sleeve, taper: 1.18 });
  // Cuff, flared — the one place a coat sleeve reads as a coat sleeve.
  box(s, { at: [0, -0.5, 0], size: [width, 0.24, width * 1.22], col: p.sleeve, taper: 1.05 });
  box(s, { at: [0, -0.54, 0], size: [width * 1.22, 0.07, width * 1.39], col: p.cuff, taper: 1.1 });
  // Glove.
  box(s, {
    at: [flip * 0.005, -0.63, -0.01],
    size: [width * 0.83, 0.11, width * 0.96],
    col: COLOR.timberDark,
    taper: 0.9,
  });
}

/**
 * One leg: thigh, shaft, boot, spur.
 *
 * Mostly hidden by the coat from behind, which is the point — legs exist so that
 * the walk cycle has something to move and so the hero doesn't hover.
 */
function leg(s: Sink, p: HeroPalette, width: number): void {
  box(s, { at: [0, -0.42, 0], size: [width, 0.42, width * 1.13], col: p.trouser, taper: 1.12 });
  // Boot shaft, then the foot, which extends forward (-Z).
  box(s, { at: [0, -0.72, 0], size: [width * 1.06, 0.3, width * 1.16], col: p.boot, taper: 1.06 });
  box(s, {
    at: [0, -0.86, -0.04],
    size: [width * 1.16, 0.14, width * 1.88],
    col: COLOR.timberDark,
    taper: 0.92,
  });
  // Heel and spur: the western note, and a real silhouette bump at the ankle.
  box(s, { at: [0, -0.86, 0.09], size: [width * 0.81, 0.06, 0.09], col: COLOR.timberDark, taper: 0.8 });
  cyl(s, {
    at: [0, -0.79, 0.12],
    rBottom: 0.055,
    rTop: 0.055,
    height: 0.03,
    segments: 6,
    col: COLOR.rust,
    axis: "z",
    caps: "none",
  });
}

/**
 * Absolution — the revolver (§7), authored in the gun hand's space.
 *
 * The barrel runs along **-Y**, continuing the line of the hanging arm, which is
 * what makes a single `rotation.x` on the shoulder swing it from a low ready to
 * level without a second joint. Oversized cylinder and hammer per §17.1: at 3.4m
 * a realistically-proportioned revolver is four dark pixels.
 *
 * Both heroes carry the same gun. §7 gives the Undertaker *dual* Absolutions,
 * which is an archetype property rather than a body one — the second revolver
 * hangs off the off hand when archetypes land, on either hero who takes it.
 */
function revolver(s: Sink): void {
  const iron = COLOR.grave;

  /*
   * Everything hangs at or below y=0, because y=0 is the hand.
   *
   * Which axis is which is worth being explicit about, since it is not obvious
   * and getting it wrong points the gun at the player's own boot: with the arm
   * raised, local -Y is world *forward* and local +Z is world *down*. So the
   * barrel runs along -Y, and the grip — which points at the ground when you
   * aim — is a box leaned almost flat onto +Z.
   */
  box(s, { at: [0, -0.19, 0], size: [0.075, 0.17, 0.075], col: iron, taper: 0.95 });
  // The fat cylinder. Oversized per §17.1 — it is the part that says "revolver".
  cyl(s, {
    at: [0, -0.17, 0],
    rBottom: 0.05,
    rTop: 0.05,
    height: 0.075,
    segments: 8,
    col: COLOR.rust,
    caps: "none",
  });
  // Barrel.
  cyl(s, { at: [0, -0.34, 0], rBottom: 0.032, rTop: 0.028, height: 0.15, segments: 7, col: iron });
  // Grip, laid back into the palm.
  box(s, {
    at: [0, -0.05, 0.015],
    size: [0.06, 0.14, 0.08],
    col: COLOR.timber,
    taper: 0.85,
    lean: 1.3,
  });
  // Hammer, standing proud at the back.
  box(s, { at: [0, -0.08, 0.04], size: [0.035, 0.05, 0.045], col: iron, taper: 0.7, lean: 1 });
  // Trigger guard.
  box(s, { at: [0, -0.14, 0.02], size: [0.045, 0.05, 0.06], col: iron, taper: 0.8, lean: 1.2 });
}

/**
 * The hip lantern. Both heroes carry one.
 *
 * It exists to *motivate the light*: `scene.ts` carries a warm point light on the
 * player, and an unexplained glow around the hero is the kind of thing §3's
 * "grounded first, magic second" rule exists to prevent. A lantern on the belt
 * makes the same light diegetic — and it's the Vigil's whole job description, so
 * it is the one piece of kit neither hero gives up.
 */
function lantern(s: Sink): void {
  const iron = COLOR.grave;
  box(s, { at: [0, -0.02, 0], size: [0.06, 0.04, 0.06], col: iron, taper: 0.9 });
  // The glass: `lamp`, the swatch that always means safe/yours.
  cyl(s, { at: [0, 0.02, 0], rBottom: 0.055, rTop: 0.06, height: 0.1, segments: 7, col: COLOR.lamp });
  cyl(s, { at: [0, 0.12, 0], rBottom: 0.062, rTop: 0.04, height: 0.05, segments: 7, col: iron });
  // Bail handle.
  box(s, { at: [0, 0.17, 0], size: [0.07, 0.035, 0.02], col: iron, taper: 0.8 });
}

/* ── Amos Kell — the marshal ─────────────────────────────────────────────── */

/**
 * Amos's torso: gunbelt, coat body, storm yoke, collar, flaring tails.
 *
 * The yoke is deliberately oversized (0.74m across a 0.5m chest) because §17.1
 * says exaggerate the part that carries the read, and from directly behind at
 * 3.4m the shoulder line is the only thing separating a person from a post. It
 * is also the top bar of his T (HEROES.md §3), so it is the last thing that
 * should ever be trimmed.
 */
function amosTorso(s: Sink): void {
  const p = PALETTE[HERO.amos];
  const dark = COLOR.timberDark;

  // Coat body, waist → chest. Taper >1 widens upward, so the coat flares into
  // the shoulders instead of hanging like a barrel.
  box(s, { at: [0, -0.04, 0], size: [0.44, 0.28, 0.27], col: p.outer, taper: 1.08 });
  box(s, { at: [0, 0.24, 0], size: [0.48, 0.2, 0.29], col: p.outer, taper: 1.02 });

  // Gunbelt, and the cartridge loops that ride it. Seven pale nubs on a dark
  // belt is the single most legible small detail on the whole model from behind,
  // and it costs 56 triangles.
  box(s, { at: [0, -0.09, 0], size: [0.47, 0.09, 0.3], col: p.leather, taper: 0.98 });
  for (let i = 0; i < 7; i++) {
    const x = (i / 6 - 0.5) * 0.36;
    box(s, {
      at: [x, -0.05, 0.15],
      size: [0.035, 0.05, 0.035],
      col: COLOR.sunbleach,
      taper: 0.8,
    });
  }
  // Buckle, on the front (-Z) so it catches the lantern.
  box(s, { at: [0, -0.08, -0.15], size: [0.1, 0.07, 0.04], col: COLOR.rust, taper: 0.85 });

  // Shoulder yoke — the coat's storm cape. Wide, and slightly lower at the back.
  // `timber` leather rather than more coat: it puts a mid value at the widest
  // point of the silhouette, between the dark hat above and the dark coat below,
  // which is what gives the figure a readable value ladder from top to boot.
  box(s, { at: [0, 0.34, 0.01], size: [0.74, 0.11, 0.34], col: p.leather, taper: 0.9 });
  box(s, { at: [0, 0.3, 0.06], size: [0.66, 0.06, 0.2], col: dark, taper: 0.94 });

  // Shirt and popped collar. `bone` against a `grave` coat is the value
  // separation §17.1 asks for, placed at the top of the silhouette where the
  // eye goes first.
  box(s, { at: [0, 0.42, 0], size: [0.22, 0.09, 0.2], col: COLOR.bone, taper: 0.86 });
  box(s, { at: [0, 0.44, 0.02], size: [0.3, 0.1, 0.22], col: dark, taper: 0.72 });

  // Coat tails, hanging to the knee with a vent up the back. Two boxes and a
  // gap, because one box is a skirt and two are a coat.
  //
  // The splay was pushed from 1.12/0.06 to 1.2/0.1 when Ada landed. Alone, Amos
  // only had to read as a person; beside a hero built as a straight column he
  // has to read as the *flared* one, and half a silhouette contract is no
  // contract. Widening the bell is cheaper and truer to §17.1's "exaggerate"
  // than narrowing her would have been.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * 0.12, -0.52, 0.01],
      size: [0.21, 0.44, 0.28],
      col: p.outer,
      taper: 1.2,
      yaw: side * 0.1,
    });
  }
  // Front panels, shorter, so the legs read from the front too.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * 0.13, -0.36, -0.12],
      size: [0.18, 0.3, 0.1],
      col: p.outer,
      taper: 1.14,
    });
  }
}

/**
 * Amos's head: skull, hat brim, crown, band.
 *
 * The brim is oval (`squash`) rather than round. A perfectly circular brim reads
 * as a lampshade from above-and-behind, which is the only angle this game ever
 * shows it from; squashing it 14% along Z is the entire difference between "hat"
 * and "disc" at gameplay distance.
 *
 * This brim is 0.62m across and it is the single most identifying thing about
 * him. HEROES.md §3: neither hero may borrow the other's headwear.
 */
function amosHead(s: Sink): void {
  const felt = COLOR.ash;

  // Neck, then the skull. `bone` is the skin note; there is no face to model
  // because there is no angle from which the player can see one.
  cyl(s, {
    at: [0, -0.02, 0],
    rBottom: 0.075,
    rTop: 0.08,
    height: 0.09,
    segments: 8,
    col: COLOR.timberDark,
  });
  cyl(s, {
    at: [0, 0.06, 0],
    rBottom: 0.125,
    rTop: 0.135,
    height: 0.2,
    segments: 9,
    col: COLOR.bone,
    squash: 0.92,
  });
  // Jaw, forward of centre, so the head has a direction from behind.
  box(s, { at: [0, 0.08, -0.09], size: [0.16, 0.1, 0.08], col: COLOR.bone, taper: 0.88 });

  // The hat. Brim first — it is the silhouette.
  cyl(s, {
    at: [0, 0.25, -0.01],
    rBottom: 0.29,
    rTop: 0.31,
    height: 0.04,
    segments: 14,
    col: felt,
    squash: 0.86,
  });
  // A turned-down front lip, so the brim isn't a flat plate.
  box(s, { at: [0, 0.235, -0.24], size: [0.3, 0.035, 0.09], col: felt, taper: 0.8, lean: -0.5 });

  // Crown, with the band where Amos's warm accent lives (§3: warm lamp-orange
  // always means safe/yours).
  cyl(s, {
    at: [0, 0.28, 0],
    rBottom: 0.185,
    rTop: 0.15,
    height: 0.19,
    segments: 10,
    col: felt,
    squash: 0.95,
  });
  cyl(s, {
    at: [0, 0.295, 0],
    rBottom: 0.192,
    rTop: 0.19,
    height: 0.045,
    segments: 10,
    col: COLOR.lamp,
    squash: 0.95,
    caps: "none",
  });
  // Crown crease: a shallow dent read as two ridges either side of the top.
  for (const side of [-1, 1]) {
    box(s, { at: [side * 0.075, 0.46, 0], size: [0.06, 0.035, 0.2], col: felt, taper: 0.7 });
  }
}

/* ── Ada Prewitt — the undertaker ────────────────────────────────────────── */

/**
 * Ada's torso: high collar, bandolier, satchel, split riding coat.
 *
 * Everything here is doing one of two jobs — keeping her **narrow** so she reads
 * as a column, and putting her mass **low and central** where Amos's is high and
 * wide. She has no yoke and no flare; the width she does have comes from a
 * bandolier and a hip satchel, which sit at chest and hip rather than at the
 * shoulder line (HEROES.md §3).
 *
 * A split riding coat over trousers, not a mourning dress: she sprints, slides
 * and gets launched by her own Powder Plate (§7), and the period-accurate
 * working answer is also the one that survives the movement system.
 */
function adaTorso(s: Sink): void {
  const p = PALETTE[HERO.ada];
  const dark = COLOR.timberDark;

  // Coat body — 0.38 at the waist against Amos's 0.44, and barely tapered, so
  // it goes up as a column rather than flaring into a chest.
  box(s, { at: [0, -0.04, 0], size: [0.38, 0.28, 0.24], col: p.outer, taper: 1.04 });
  box(s, { at: [0, 0.24, 0], size: [0.4, 0.2, 0.26], col: p.outer, taper: 1.0 });

  // Narrow shoulder caps instead of a storm yoke: just enough to seat the arms.
  box(s, { at: [0, 0.34, 0.01], size: [0.52, 0.09, 0.28], col: p.outer, taper: 0.92 });

  /*
   * The bandolier, as five stepped boxes climbing across the chest.
   *
   * A real diagonal strap would need a roll about Z, and `box` deliberately only
   * offers yaw and lean — adding a third rotation to the primitive for one strap
   * would be the wrong trade. Five stepped segments read as a diagonal at any
   * distance the player will ever see it from, which is the §17.1 answer: the
   * chunky approximation IS the style, not a compromise toward it.
   */
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    box(s, {
      at: [-0.14 + t * 0.28, 0.04 + t * 0.3, -0.13 + t * 0.01],
      size: [0.11, 0.09, 0.09],
      col: p.leather,
      taper: 0.9,
      yaw: 0.5,
    });
    // A pale shell in each loop — her accent, and the detail that makes the
    // strap read as a bandolier rather than as a sash.
    box(s, {
      at: [-0.14 + t * 0.28, 0.07 + t * 0.3, -0.17],
      size: [0.04, 0.055, 0.04],
      col: p.accent,
      taper: 0.8,
    });
  }

  // Waist belt, plainer than Amos's — she is not carrying his ammunition.
  box(s, { at: [0, -0.09, 0], size: [0.4, 0.08, 0.26], col: p.leather, taper: 0.98 });

  /*
   * The undertaker's satchel, on the right hip.
   *
   * §7 gives the Undertaker "corpses grant 2 salt", and a character whose
   * economy runs on what she takes off the dead should visibly have somewhere to
   * put it. It is also the widest thing on her below the chest, which is what
   * stops the column reading as a plank.
   */
  box(s, { at: [0.22, -0.24, 0.02], size: [0.19, 0.24, 0.15], col: p.leather, taper: 0.94 });
  box(s, { at: [0.22, -0.05, 0.02], size: [0.21, 0.05, 0.17], col: dark, taper: 0.9 });
  box(s, { at: [0.22, -0.14, -0.07], size: [0.06, 0.05, 0.04], col: p.accent, taper: 0.8 });

  // High mourning collar, standing well clear of the shoulders. Where Amos has
  // a popped collar and a shirt, she has one tall dark funnel — it is what the
  // veil lands on, and the two together are her whole upper silhouette.
  box(s, { at: [0, 0.4, 0.01], size: [0.26, 0.16, 0.23], col: p.outer, taper: 0.82 });
  box(s, { at: [0, 0.4, -0.09], size: [0.17, 0.1, 0.06], col: COLOR.bone, taper: 0.85 });

  // Bone buttons down the front — a vertical row, which reinforces the column.
  for (let i = 0; i < 4; i++) {
    box(s, {
      at: [0, -0.02 + i * 0.1, -0.14],
      size: [0.04, 0.045, 0.035],
      col: p.accent,
      taper: 0.8,
    });
  }

  // Split riding coat: two long panels hanging STRAIGHT to mid-calf. No taper
  // past 1.02 and no yaw — the absence of flare is the design.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * 0.105, -0.58, 0.01],
      size: [0.185, 0.5, 0.25],
      col: p.outer,
      taper: 1.02,
    });
  }
  // A shorter front panel each side, so the legs read from the front.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * 0.11, -0.4, -0.1],
      size: [0.16, 0.34, 0.09],
      col: p.outer,
      taper: 1.0,
    });
  }
}

/**
 * Ada's head: skull, veil, and a narrow flat-crowned mourning hat.
 *
 * The veil is the asset. It is a cone that falls **past the neck to the shoulder
 * line**, so head and body are one continuous mass — where Amos's head is a
 * distinct disc floating over a gap. That is the entire difference between an I
 * and a T at 64px, and it is why the veil is allowed to extend below this part's
 * own pivot.
 *
 * The skull sits forward of the veil's centre so the face clears the hood by a
 * few centimetres. Without that she is a faceless cone, which is a different and
 * much more Choir-like character than the one §3 describes.
 */
function adaHead(s: Sink): void {
  const p = PALETTE[HERO.ada];
  const felt = COLOR.ash;

  cyl(s, {
    at: [0, -0.02, 0],
    rBottom: 0.07,
    rTop: 0.075,
    height: 0.09,
    segments: 8,
    col: COLOR.timberDark,
  });
  /*
   * The skull sits well forward — 6cm, not the 3.5 it started at.
   *
   * Learned by looking at the shelf: at the first pass the veil's radius at head
   * height (0.196, squashed to 0.176) was *larger* than the skull's forward
   * reach, so the hood closed over her completely and she rendered as a faceless
   * cone. That is a different and much more Choir-like character than §3
   * describes — the Vigil is the living, barely, not one of the congregation.
   * The fix is both halves: the face comes forward, and the veil is now snug at
   * the crown and only flares below the chin.
   */
  cyl(s, {
    at: [0, 0.05, -0.06],
    rBottom: 0.115,
    rTop: 0.125,
    height: 0.19,
    segments: 9,
    col: COLOR.bone,
    squash: 0.92,
  });
  box(s, { at: [0, 0.07, -0.145], size: [0.14, 0.09, 0.08], col: COLOR.bone, taper: 0.88 });

  /*
   * The veil, in two sections with a GAP AT THE JAW.
   *
   * This is the third attempt and the first one that is actually a veil. A
   * single cone from crown to shoulder swallowed her whole and rendered a
   * faceless cowl — which is not a Vigil, it is one of the Choir (§3), and
   * exactly the wrong character. Making the cone snug at the crown did not fix
   * it either: even 5cm of forward clearance leaves the face *inside* a tube,
   * so it is unlit, and under a hard toon ramp unlit means black.
   *
   * So the veil now stops above the jaw and resumes below it, leaving an 11cm
   * band of bone exposed at mouth height. That is the real thing a mourning
   * veil does — it covers the eyes, not the face — and it is the only version
   * where the light can actually reach her.
   *
   * The silhouette contract is untouched: the outline still has no neck in it,
   * because that comes from the lower section flaring to the shoulder line, not
   * from the upper one.
   */
  // Upper: over the crown and the eyes.
  cyl(s, {
    at: [0, 0.15, 0.02],
    rBottom: 0.163,
    rTop: 0.152,
    height: 0.16,
    segments: 11,
    col: felt,
    squash: 0.88,
    caps: "none",
  });
  /*
   * Lower: the shoulder flare. `rBottom > rTop` is worth flagging because every
   * other cone in this project narrows upward — its base at y = -0.12 puts the
   * hem at 1.34m, exactly the shoulder joint, which is what removes the neck.
   */
  cyl(s, {
    at: [0, -0.12, 0.02],
    rBottom: 0.225,
    rTop: 0.168,
    height: 0.16,
    segments: 11,
    col: felt,
    squash: 0.9,
    caps: "none",
  });
  // The pale hem — her accent, and the brightest note on the model. It sits at
  // the widest point of the veil, so it draws the shape it is edging.
  cyl(s, {
    at: [0, -0.12, 0.015],
    rBottom: 0.232,
    rTop: 0.222,
    height: 0.05,
    segments: 11,
    col: p.accent,
    squash: 0.9,
    caps: "none",
  });

  /*
   * A narrow flat-crowned mourning hat over the veil.
   *
   * 0.47m across against Amos's 0.62m. She still reads as a westerner — this is
   * a frontier undertaker, not a ghost — but at a quarter less brim she can
   * never be mistaken for him in silhouette, which is the rule in HEROES.md §3.
   *
   * Brim widened and crown shortened from the first pass, which came out as a
   * stovepipe: tall-narrow-crown-on-tiny-brim reads Victorian city mortician,
   * and §3's register is frontier. Squat and flat is the western answer, and it
   * is still nothing like a slouch hat.
   */
  cyl(s, {
    at: [0, 0.29, 0],
    rBottom: 0.225,
    rTop: 0.235,
    height: 0.035,
    segments: 12,
    col: felt,
    squash: 0.9,
  });
  cyl(s, {
    at: [0, 0.315, 0],
    rBottom: 0.155,
    rTop: 0.15,
    height: 0.105,
    segments: 10,
    col: felt,
    squash: 0.95,
  });
  // A dark band, deliberately NOT her accent: the pale note belongs on the veil
  // hem, and two competing highlights on one head is one too many (§17.1).
  cyl(s, {
    at: [0, 0.325, 0],
    rBottom: 0.155,
    rTop: 0.153,
    height: 0.04,
    segments: 10,
    col: COLOR.timberDark,
    squash: 0.95,
    caps: "none",
  });
  // Flat top, so the crown ends on a hard horizontal rather than a taper.
  cyl(s, {
    at: [0, 0.42, 0],
    rBottom: 0.153,
    rTop: 0.15,
    height: 0.028,
    segments: 10,
    col: felt,
    squash: 0.95,
  });
}

/* ── assembly ────────────────────────────────────────────────────────────── */

export interface HeroParts {
  torso: BufferGeometry;
  head: BufferGeometry;
  armR: BufferGeometry;
  armL: BufferGeometry;
  legR: BufferGeometry;
  legL: BufferGeometry;
  revolver: BufferGeometry;
  lantern: BufferGeometry;
}

/**
 * §17.7 budgets the hero 24k triangles plus 3k of weapon. These grey-boxes spend
 * about a fortieth of that, which is the right side of the budget to be on: the
 * ceiling exists for the eventual sculpted mesh, and the test asserts we are
 * under it rather than near it.
 */
/**
 * The revolver on its own, for the hotbar icon (§7 decision 17).
 *
 * Decision 17 says a slot's picture comes from the thing itself rather than from
 * a drawn asset, so the weapon row uses the same `revolver()` the hero carries —
 * one source, and a gun that can never drift from its own icon.
 *
 * Re-oriented on the way out. In the hero's hand the barrel runs along local −Y
 * and the grip along +Z, because that hangs correctly off a raised arm; an icon
 * wants the gun lying in its own plane, barrel to the right and grip down. The
 * rotation is here rather than in `icons.ts` so the awkward axis convention
 * stays a fact about the hand, not something every caller has to know.
 */
export function buildRevolverGeometry(): BufferGeometry {
  const g = buildGeometry(revolver);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  g.computeBoundingBox();
  return g;
}

export const HERO_TRI_BUDGET = 24000;

interface BodySpec {
  torso: (s: Sink) => void;
  head: (s: Sink) => void;
  /** Limb thickness, so a narrower hero isn't narrow everywhere but the arms. */
  armWidth: number;
  legWidth: number;
}

const BODY: Record<HeroId, BodySpec> = {
  [HERO.amos]: { torso: amosTorso, head: amosHead, armWidth: 0.115, legWidth: 0.16 },
  [HERO.ada]: { torso: adaTorso, head: adaHead, armWidth: 0.1, legWidth: 0.14 },
};

export function buildHeroParts(hero: HeroId = HERO.amos): HeroParts {
  const joints = JOINTS[hero];
  const body = BODY[hero];
  const palette = PALETTE[hero];

  const at = (fn: (s: Sink) => void, pivotHeight: number): BufferGeometry =>
    buildGeometry(fn, CHAR_SHADE, pivotHeight);

  return {
    torso: at(body.torso, joints.hips),
    head: at(body.head, joints.neck),
    armR: at((s) => arm(s, 1, palette, body.armWidth), joints.shoulder),
    armL: at((s) => arm(s, -1, palette, body.armWidth), joints.shoulder),
    legR: at((s) => leg(s, palette, body.legWidth), joints.legTop),
    legL: at((s) => leg(s, palette, body.legWidth), joints.legTop),
    // The revolver hangs off the hand, ~0.62m below the shoulder.
    revolver: at(revolver, joints.shoulder - 0.62),
    lantern: at(lantern, joints.hips - 0.1),
  };
}
