/*
 * Headless tests for the procedural gait system (render/gait.ts).
 *
 * Movement is identity the same way silhouette is (§1 pillar 2), and identity
 * contracts erode: a tuning pass evens out "extreme" numbers, and six months
 * later the Preacher bobs like everything else and nobody can say when it
 * started. So the contrasts that ARE the design — a Coyote bounds, a Preacher
 * glides, a Colossus is the slowest cadence in the game — are asserted here,
 * exactly the way the heroes' opposing letterforms are asserted on their
 * geometry.
 *
 * Everything tested is a pure function of numbers, which is the point of
 * keeping the pose math out of scene.ts: this file runs in plain node, no GL.
 *
 *   node --experimental-strip-types --test tests/gait.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENEMIES } from "../src/sim/enemies.ts";
import {
  DEFAULT_GAIT,
  GAITS,
  enemyPose,
  gaitFor,
  wingFlap,
  type Pose,
  type PoseInput,
} from "../src/render/gait.ts";

const makePose = (): Pose => ({ lift: 0, roll: 0, pitch: 0, sway: 0, squash: 1 });

const makeInput = (over: Partial<PoseInput> = {}): PoseInput => ({
  strideM: 0,
  phase: 0,
  time: 0,
  moving: false,
  held: false,
  grounded: true,
  flying: false,
  vy: 0,
  yawRate: 0,
  windupT: 0,
  climb: 0,
  ...over,
});

/** Peak |lift| for a def over a full walk, sampled densely enough to find it. */
function peakLift(key: string): number {
  const def = ENEMIES.find((d) => d.key === key);
  assert.ok(def, `no def for ${key}`);
  const out = makePose();
  let peak = 0;
  for (let m = 0; m < 30; m += 0.11) {
    enemyPose(out, def, gaitFor(key), makeInput({ moving: true, strideM: m }));
    peak = Math.max(peak, Math.abs(out.lift));
  }
  return peak;
}

describe("gait profiles", () => {
  it("gives every roster archetype a profile of its own", () => {
    // The DEFAULT_GAIT fallback exists for defs that land before their gait
    // does — same contract as ENEMY_MODELS. It must never quietly BE the gait
    // of anything already on the roster, or one archetype's movement identity
    // silently becomes the horde filler's.
    for (const def of ENEMIES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(GAITS, def.key),
        `EnemyDef "${def.key}" has no gait — it would move like the fallback`,
      );
      assert.notEqual(gaitFor(def.key), DEFAULT_GAIT);
    }
  });

  it("stays finite and bounded over the whole input space that matters", () => {
    const out = makePose();
    for (const def of ENEMIES) {
      const g = gaitFor(def.key);
      for (let m = 0; m < 25; m += 0.37) {
        for (const time of [0, 1.3, 7.9]) {
          for (const inp of [
            makeInput({ moving: true, strideM: m, time }),
            makeInput({ moving: false, strideM: m, time }),
            makeInput({ held: true, strideM: m, time }),
            makeInput({ grounded: false, vy: 6 - m, time }),
            makeInput({ flying: def.flying, climb: (m % 1.5) / 1.5, time, yawRate: 2 }),
            makeInput({ moving: true, strideM: m, windupT: (m % 1) || 0.5, time }),
          ]) {
            enemyPose(out, def, g, inp);
            for (const [name, v] of Object.entries(out)) {
              assert.ok(Number.isFinite(v), `${def.key}.${name} is not finite`);
            }
            assert.ok(Math.abs(out.pitch) < 0.75, `${def.key}: pitch ${out.pitch}`);
            assert.ok(Math.abs(out.roll) < 0.6, `${def.key}: roll ${out.roll}`);
            assert.ok(Math.abs(out.sway) < 0.25, `${def.key}: sway ${out.sway}`);
            assert.ok(
              out.squash > 0.7 && out.squash < 1.3,
              `${def.key}: squash ${out.squash}`,
            );
            assert.ok(
              Math.abs(out.lift) <= def.height * 0.25 + 0.2,
              `${def.key}: lift ${out.lift} against height ${def.height}`,
            );
          }
        }
      }
    }
  });

  it("is a function of distance walked, not of the clock", () => {
    // The whole point of the stride odometer: two frames at the same stride
    // read the same pose whatever the wall clock says, so slowing the body
    // slows the gait and stopping it freezes mid-step instead of jogging in
    // place. (Time may only drive idling, held shudder and flight bob.)
    const def = ENEMIES[0];
    const a = makePose();
    const b = makePose();
    enemyPose(a, def, gaitFor(def.key), makeInput({ moving: true, strideM: 3.7, time: 1 }));
    enemyPose(b, def, gaitFor(def.key), makeInput({ moving: true, strideM: 3.7, time: 99 }));
    assert.deepEqual(a, b, "a walking pose drifted with time at fixed stride");
  });
});

describe("the contrasts that are the design", () => {
  it("the Coyote bounds and the Dustkin shambles", () => {
    // Relative to height AND in absolute metres — the Coyote is half the
    // Dustkin's size and must still out-jump it on screen.
    assert.ok(
      GAITS.coyote.lift > GAITS.dustkin.lift * 2.5,
      "the bound has eroded toward the shamble",
    );
    assert.ok(peakLift("coyote") > peakLift("dustkin"));
  });

  it("the Preacher processes — its walk is an order of magnitude stiller", () => {
    assert.ok(
      peakLift("preacher") < peakLift("dustkin") * 0.2,
      "the Preacher has started bobbing with the crowd",
    );
    // And it does not breathe, shuffle or sway at rest. Composure is the tell
    // (ENEMIES.md §3) and idle is where composure lives.
    const def = ENEMIES.find((d) => d.key === "preacher");
    assert.ok(def);
    const out = makePose();
    enemyPose(out, def, gaitFor("preacher"), makeInput({ time: 4.2 }));
    assert.equal(out.lift, 0, "the Preacher must idle perfectly still");
    assert.equal(out.roll, 0, "the Preacher must idle perfectly still");
  });

  it("cadence orders by mass: Colossus < Ironjaw < Coyote", () => {
    assert.ok(GAITS.colossus.stride < GAITS.ironjaw.stride);
    assert.ok(GAITS.ironjaw.stride < GAITS.coyote.stride);
  });

  it("the Dustkin limps; the regular things do not", () => {
    assert.ok(GAITS.dustkin.limp > 0.3, "the wrong-jointed limp is gone");
    assert.equal(GAITS.coyote.limp, 0);
    assert.equal(GAITS.preacher.limp, 0);
  });

  it("mass does not bank into corners", () => {
    assert.ok(GAITS.colossus.bank < GAITS.coyote.bank * 0.25);
  });
});

describe("status poses — statuses override locomotion", () => {
  const dustkin = ENEMIES[0];

  it("a held body squashes, shudders, and takes no step", () => {
    const out = makePose();
    enemyPose(out, dustkin, gaitFor("dustkin"), makeInput({ held: true, strideM: 5 }));
    assert.ok(out.squash < 0.9, "the clamp should visibly grip");
    assert.equal(out.lift, 0, "a clamped body cannot step");
  });

  it("a launched body rears while rising and tumbles forward while falling", () => {
    const out = makePose();
    enemyPose(out, dustkin, gaitFor("dustkin"), makeInput({ grounded: false, vy: 5 }));
    assert.ok(out.pitch > 0.1, "rising should rear back");
    enemyPose(out, dustkin, gaitFor("dustkin"), makeInput({ grounded: false, vy: -5 }));
    assert.ok(out.pitch < -0.1, "falling should tumble forward");
  });

  it("the windup rears the body back, and lets go exactly at the hit", () => {
    // §14.6's melee telegraph, on the body. sin(t·π) peaks mid-windup and
    // returns to zero at t=1 — the snap back to neutral IS the strike frame.
    const out = makePose();
    const still = makeInput({ moving: false });
    enemyPose(out, dustkin, gaitFor("dustkin"), { ...still, windupT: 0.5 });
    assert.ok(out.pitch > 0.15, "mid-windup must visibly rear back");
    enemyPose(out, dustkin, gaitFor("dustkin"), { ...still, windupT: 1 });
    assert.ok(Math.abs(out.pitch) < 0.03, "the rear-back must release at impact");
  });

  it("fliers bank into their turns", () => {
    const buzzard = ENEMIES.find((d) => d.key === "buzzard");
    assert.ok(buzzard);
    const out = makePose();
    enemyPose(out, buzzard, gaitFor("buzzard"), makeInput({ flying: true, yawRate: 1.2 }));
    assert.ok(out.roll < -0.1, "a right turn should bank right");
  });
});

describe("wings", () => {
  const range = (climb: number): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 6; t += 0.02) {
      const a = wingFlap(t, 0.7, climb);
      assert.ok(Number.isFinite(a));
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    return hi - lo;
  };

  it("beats hard while climbing and locks into a glide at cruise", () => {
    assert.ok(
      range(1) > range(0) * 1.8,
      "the climb regime no longer works harder than the cruise",
    );
  });

  it("holds the glide high rather than dropping the wings", () => {
    // A glide is wings UP against the airflow. If the resting angle sags below
    // level, the bird reads as broken rather than as soaring.
    let mean = 0;
    let n = 0;
    for (let t = 0; t < 6; t += 0.05) {
      mean += wingFlap(t, 0.2, 0);
      n++;
    }
    assert.ok(mean / n > 0, "the cruise/glide posture must average above level");
  });
});
