/*
 * render/gait.ts — how each archetype MOVES, as data and one pure function.
 *
 * §14.3 still owes the crowd a real VAT bake; until it lands, locomotion is a
 * procedural pose folded into the instance matrix that scene.ts was writing
 * anyway. The first pass of that ("the shamble") animated every archetype with
 * the same waveform at a different speed — which is §1 pillar 2's capsule
 * problem all over again, one octave up: a Colossus that bobs like a Dustkin
 * is a big Dustkin, however good its silhouette. Movement is identity just as
 * much as shape is, so it gets the same treatment shape got: one profile per
 * archetype, one shared vocabulary, and a test that keeps the contrasts from
 * eroding.
 *
 * Two structural rules, both learned from the first pass:
 *
 *   1. **Gait phase advances with distance walked, not with time.** The old
 *      `time × def.speed` kept marching while a body was slowed, clamped or
 *      stopped, so feet slid over the ground exactly the way §14.6's polish
 *      pass exists to prevent. scene.ts integrates each body's actual
 *      horizontal speed into a stride odometer (the same trick the hero's
 *      locomotion uses), and this module turns metres into pose. A Tar-slowed
 *      Dustkin now visibly trudges; a held one stops mid-step.
 *
 *   2. **The pose function is pure and allocation-free** (§12.5). Everything
 *      here is arithmetic on numbers the caller already had; the only object
 *      involved is a caller-owned scratch that is reused for all ~200 bodies.
 *      Pure also means testable in plain node — the archetype contrasts
 *      (a Preacher glides, a Coyote bounds) are asserted in tests/gait.test.ts
 *      the same way the silhouette contract is asserted on the geometry.
 *
 * Sign conventions, fixed by how scene.ts composes the matrix
 * (yaw → pitch → roll, model faces -Z):
 *   pitch > 0  tips the top BACKWARD (away from facing) — a rear-up
 *   pitch < 0  tips it forward — a hunch, a pounce, a nose-dive
 *   roll  > 0  leans onto the +X side
 */

import type { EnemyDef } from "../sim/enemies.ts";

/** Everything that makes one archetype's walk its own. */
export interface GaitProfile {
  /** Radians of gait phase per metre walked. Low = long ponderous strides. */
  stride: number;
  /** Step bounce, as a fraction of `def.height`. */
  lift: number;
  /**
   * Shape of the step curve: the bounce is `|sin|^plant`. 1 is a sine; higher
   * keeps the body low longer and pops it faster — the difference between a
   * glide and a stomp, in one exponent.
   */
  plant: number;
  /** Side-to-side lean onto the planted foot, radians. */
  roll: number;
  /**
   * Second-harmonic asymmetry, 0..1: how different the left step is from the
   * right. The Dustkin's wrong-jointed limp lives here; regular things get 0.
   */
  limp: number;
  /** Vertical squash-and-stretch with the step, as a scale amplitude. */
  stretch: number;
  /** Constant pitch while moving. Negative = leans into its own walk. */
  lean: number;
  /** Yaw wobble amplitude, radians — shoulder twist on the heavy things. */
  sway: number;
  /** Sway cycles per gait cycle (0.5 = one twist per two steps). */
  swayRate: number;
  /** Seconds of yaw rate converted into banking roll. Mass banks less. */
  bank: number;
  /** Idle breathing: lift fraction and roll radians when standing still. */
  idleLift: number;
  idleRoll: number;
}

/**
 * The unregistered-archetype fallback — the same contract ENEMY_MODELS keeps:
 * a def with no profile moves like the horde filler rather than crashing the
 * renderer, and the test asserts every *roster* def has its own entry so the
 * fallback can never quietly become somebody's gait.
 */
export const DEFAULT_GAIT: GaitProfile = {
  stride: 2.8,
  lift: 0.028,
  plant: 1,
  roll: 0.07,
  limp: 0.35,
  stretch: 0.035,
  lean: -0.05,
  sway: 0,
  swayRate: 0.5,
  bank: 0.12,
  idleLift: 0.004,
  idleRoll: 0.012,
};

export const GAITS: Record<string, GaitProfile> = {
  /*
   * DUSTKIN — the shamble. Everything slightly wrong: a limp big enough to
   * see (the two steps genuinely differ), a hunch into the walk, loose roll.
   * This is the baseline the rest of the roster contrasts against.
   */
  dustkin: {
    stride: 2.8,
    lift: 0.028,
    plant: 1,
    roll: 0.085,
    limp: 0.45,
    stretch: 0.04,
    lean: -0.07,
    sway: 0,
    swayRate: 0.5,
    bank: 0.12,
    idleLift: 0.004,
    idleRoll: 0.014,
  },
  /*
   * IRONJAW — the stomp. Long strides for its speed, a high plant exponent so
   * it stays planted and then heaves, and almost no bank: mass does not lean
   * into corners. The lean is *backward* — plate carries its weight high.
   */
  ironjaw: {
    stride: 2.0,
    lift: 0.035,
    plant: 2.2,
    roll: 0.1,
    limp: 0.1,
    stretch: 0.05,
    lean: 0.03,
    sway: 0.03,
    swayRate: 0.5,
    bank: 0.04,
    idleLift: 0.003,
    idleRoll: 0.008,
  },
  /*
   * BUZZARD — flight, so most of this table is unused (fliers take the bob /
   * bank / flap path in enemyPose). Stride values are the tucked-feet hop it
   * would do if it ever walked; nothing reads them today.
   */
  buzzard: {
    stride: 4.0,
    lift: 0.02,
    plant: 1,
    roll: 0.04,
    limp: 0,
    stretch: 0.02,
    lean: 0,
    sway: 0,
    swayRate: 0.5,
    bank: 0.9,
    idleLift: 0,
    idleRoll: 0,
  },
  /*
   * COYOTE — the bound. Not a walk cycle at all: the whole body is a
   * projectile between plants. Highest lift on the roster by a wide margin,
   * a pitch that noses up on push-off and down into the landing, hard
   * squash-and-stretch, and real banking — it corners like it means it.
   */
  coyote: {
    stride: 4.6,
    lift: 0.085,
    plant: 1.6,
    roll: 0.03,
    limp: 0,
    stretch: 0.09,
    lean: -0.05,
    sway: 0,
    swayRate: 0.5,
    bank: 0.22,
    idleLift: 0.006,
    idleRoll: 0.01,
  },
  /*
   * HOLLOW PREACHER — the procession. Its gait is the ABSENCE of gait:
   * per-step motion an order of magnitude under the Dustkin's, no limp, no
   * idle shuffle at all. In a bobbing crowd the one body that glides reads
   * from across the map, which is exactly what a priority target needs —
   * composure was already its silhouette tell (ENEMIES.md §3), and now it is
   * its movement tell too. The test pins the contrast so a later tuning pass
   * can't average it away.
   */
  preacher: {
    stride: 2.4,
    lift: 0.003,
    plant: 1,
    roll: 0.012,
    limp: 0,
    stretch: 0.004,
    lean: 0,
    sway: 0.008,
    swayRate: 0.25,
    bank: 0.05,
    idleLift: 0,
    idleRoll: 0,
  },
  /*
   * MARROW COLOSSUS — the earthquake. The lowest cadence in the game (a
   * stride every couple of metres), the sharpest plant, a ponderous roll, and
   * an arm-drag shoulder twist at half the step rate. Nothing about it may
   * read as quick: the fear is in the inevitability.
   */
  colossus: {
    stride: 1.15,
    lift: 0.045,
    plant: 2.6,
    roll: 0.12,
    limp: 0.12,
    stretch: 0.045,
    lean: 0.02,
    sway: 0.055,
    swayRate: 0.5,
    bank: 0.02,
    idleLift: 0.003,
    idleRoll: 0.006,
  },
};

export const gaitFor = (key: string): GaitProfile => GAITS[key] ?? DEFAULT_GAIT;

/* ── the pose ────────────────────────────────────────────────────────────── */

/** One body's pose this frame. Caller-owned and reused — never allocated here. */
export interface Pose {
  /** Metres added to the instance's Y. */
  lift: number;
  /** Radians about the facing axis (lean onto a foot, banking). */
  roll: number;
  /** Radians about X after yaw. >0 rears back, <0 pitches forward. */
  pitch: number;
  /** Radians of yaw wobble on top of facing. */
  sway: number;
  /** Vertical scale factor (squash < 1 < stretch). */
  squash: number;
}

/** Everything the pose depends on. One instance per Renderer, mutated per body. */
export interface PoseInput {
  /** Metres this body has walked, integrated by the caller while grounded. */
  strideM: number;
  /** Per-instance hash phase, so a crowd never marches in step. */
  phase: number;
  /** Presentation clock, seconds — idle breathing and held shudder only. */
  time: number;
  /** True when horizontal velocity is above the walk threshold. */
  moving: boolean;
  /** Clamped by a trap. */
  held: boolean;
  grounded: boolean;
  flying: boolean;
  /** Vertical velocity — drives airborne tumble and flier attitude. */
  vy: number;
  /** Smoothed facing rate, rad/s — drives banking. */
  yawRate: number;
  /** 0 outside a melee windup; ramps 0→1 as the swing approaches. */
  windupT: number;
  /** Fliers: 0 at cruise altitude, →1 the further below it. */
  climb: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Compute one body's pose. Pure: same inputs, same pose, no allocation.
 *
 * The layering order matters and is deliberate — statuses override locomotion
 * (a held body has no step to take), and the windup rear-back stacks on top of
 * whatever the body was doing, because an Ironjaw mid-stomp still telegraphs.
 */
export function enemyPose(out: Pose, def: EnemyDef, g: GaitProfile, inp: PoseInput): void {
  out.lift = 0;
  out.roll = 0;
  out.pitch = 0;
  out.sway = 0;
  out.squash = 1;

  if (inp.flying) {
    /*
     * Fliers: a soft bob (altitude must read as flight, not as a hover glitch),
     * banking into turns, and a nose-down attitude while climbing back to
     * cruise — the same phase the wings beat hardest in (see wingFlap), so the
     * whole body says "working" at once.
     */
    out.lift = Math.sin(inp.time * 6 + inp.phase * 1.7) * 0.16;
    out.roll = clamp(-inp.yawRate * g.bank, -0.45, 0.45);
    out.pitch = -0.04 - inp.climb * 0.22 + Math.sin(inp.time * 3.1 + inp.phase) * 0.02;
    return;
  }

  if (!inp.grounded) {
    /*
     * Launched (the Boot, a Powder Plate): no step to take in the air, so the
     * pose is all attitude — rear back while rising, tumble forward while
     * falling, with a per-body wobble so a launched crowd doesn't flip like
     * one rigid sheet.
     */
    out.pitch = clamp(inp.vy * 0.11, -0.55, 0.4);
    out.roll = Math.sin(inp.time * 9 + inp.phase) * 0.08;
    return;
  }

  if (inp.held) {
    /*
     * Clamped: the trap wins. The body shudders against the hold — high
     * frequency, three incommensurate rates so it reads as struggle rather
     * than as vibration — and squashes down, which is what sells the jaws
     * actually *gripping*.
     */
    out.squash = 0.82;
    out.roll = Math.sin(inp.time * 26 + inp.phase) * 0.05;
    out.pitch = Math.sin(inp.time * 31 + inp.phase * 2.3) * 0.04;
    out.sway = Math.sin(inp.time * 21 + inp.phase * 3.1) * 0.03;
  } else if (inp.moving) {
    /*
     * The walk. Phase is distance-based: `strideM` metres in, `g.stride`
     * radians per metre out. The limp term is a half-rate harmonic — it makes
     * alternate steps land differently, which is all a limp is.
     */
    const gp = inp.strideM * g.stride + inp.phase;
    const wave = Math.sin(gp) + g.limp * Math.sin(gp * 0.5 + inp.phase);
    const norm = 1 + g.limp; // keep |wave| ≤ 1 so `plant` powers stay real
    const step = Math.pow(Math.abs(wave) / norm, g.plant);

    out.lift = step * g.lift * def.height;
    out.roll = (wave / norm) * g.roll;
    out.pitch = g.lean + Math.cos(gp) * g.stretch * 1.6;
    out.sway = g.sway * Math.sin(gp * g.swayRate + inp.phase);
    out.squash = 1 + step * g.stretch - g.stretch * 0.45;
  } else {
    // Idle: a breath, not a march. The Preacher's zeros here are a design
    // contract (perfect stillness), not an omission — the test pins them.
    out.lift = Math.sin(inp.time * 1.6 + inp.phase) * g.idleLift * def.height;
    out.roll = Math.sin(inp.time * 1.1 + inp.phase * 1.9) * g.idleRoll;
  }

  // Banking into turns, over whatever the feet are doing. Heavy profiles have
  // small `bank`, so the Colossus corners like a ship and the Coyote like a dog.
  out.roll += clamp(-inp.yawRate * g.bank, -0.3, 0.3);

  /*
   * The windup rear-back — §14.6's melee telegraph, on the body itself. The
   * old pass promised this in a comment and only ever shipped the colour
   * flare; now the body visibly gathers itself as the swing approaches, and
   * `sin(t·π)` brings it back to neutral exactly when the hit lands, which is
   * the snap the player's eye reads as the strike.
   */
  if (inp.windupT > 0) {
    out.pitch += Math.sin(inp.windupT * Math.PI) * 0.22;
    out.squash *= 1 - Math.sin(inp.windupT * Math.PI) * 0.06;
  }
}

/* ── wings ───────────────────────────────────────────────────────────────── */

/**
 * Wing flap angle, radians about the shoulder hinge.
 *
 * Three regimes instead of the old single sine: hard fast beats while climbing
 * back to cruise, a steady beat in level flight, and — the one that sells the
 * whole bird — a locked-high glide with only a tremble in it when there is
 * nothing to do. Regimes blend on `climb` so the transition never pops.
 */
export function wingFlap(time: number, phase: number, climb: number): number {
  const c = clamp(climb, 0, 1);
  const glide = Math.sin(time * 2.2 + phase) * 0.06 + 0.24;
  const beat = Math.sin(time * (7.5 + c * 3.5) + phase) * (0.5 + c * 0.35) - 0.12;
  // At cruise (c≈0) mix a little beat over the glide so it still flies rather
  // than hangs; any real climb takes over quickly.
  const mix = clamp(0.35 + c * 1.3, 0, 1);
  return glide * (1 - mix) + beat * mix;
}
