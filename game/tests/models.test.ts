/*
 * Headless geometry tests for the code-authored trap models.
 *
 * These run in plain Node — three.js's `BufferGeometry` needs no WebGL context —
 * which is what makes code-authored art testable at all (GALLOWS_HYMN.md §23.1
 * decision 15). A modelled asset can only be checked by looking at it; a
 * generated one can be checked by CI on every commit, and that is most of the
 * argument for generating it.
 *
 * The load-bearing test here is `winding`. Triangle winding decides which way a
 * face points, an inverted face is *invisible* under backface culling, and the
 * failure reads as a hole in the model rather than as an error — so it is exactly
 * the kind of bug that survives a visual check and then ships. Every top face in
 * this module was inverted on first write; this test is why that was caught.
 *
 *   node --experimental-strip-types --test tests/models.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BufferGeometry } from "three";

import { ENEMIES } from "../src/sim/enemies.ts";
import { TRAPS } from "../src/sim/traps.ts";
import { SURF } from "../src/sim/surfaces.ts";
import { BUILD_TILE } from "../src/sim/level.ts";
import { TRAP_MODEL_SCALE } from "../src/render/models/traps.ts";
import {
  MIN_THICKNESS,
  TRAP_MODELS,
  TRAP_TRI_BUDGET,
  buildTrapGeometry,
} from "../src/render/models/traps.ts";
import {
  ENEMY_MODELS,
  ENEMY_TRI_BUDGET,
  buildEnemyGeometry,
  buildWingGeometry,
} from "../src/render/models/enemies.ts";
import {
  HERO,
  HEROES,
  HERO_TRI_BUDGET,
  JOINTS,
  defaultHeroId,
  buildHeroParts,
} from "../src/render/models/hero.ts";
import {
  annulus,
  blob,
  box,
  buildGeometry,
  cyl,
  spike,
  withTransform,
} from "../src/render/models/build.ts";
import { COLOR } from "../src/render/palette.ts";

interface Stats {
  tris: number;
  minY: number;
  maxY: number;
  maxRadius: number;
  areaUp: number;
  areaDown: number;
}

function statsOf(g: BufferGeometry): Stats {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");

  const s: Stats = {
    tris: pos.count / 3,
    minY: Infinity,
    maxY: -Infinity,
    maxRadius: 0,
    areaUp: 0,
    areaDown: 0,
  };

  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v);
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
    const r = Math.hypot(pos.getX(v), pos.getZ(v));
    if (r > s.maxRadius) s.maxRadius = r;
  }

  for (let t = 0; t < s.tris; t++) {
    const i = t * 3;
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax;
    const uy = pos.getY(i + 1) - ay;
    const uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax;
    const vy = pos.getY(i + 2) - ay;
    const vz = pos.getZ(i + 2) - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const area = Math.hypot(cx, cy, cz) / 2;
    // The stored normal, which is what the GPU shades with.
    const ny = nrm.getY(i);
    if (ny > 0.25) s.areaUp += area;
    else if (ny < -0.25) s.areaDown += area;
  }

  return s;
}

const statsFor = (key: string): Stats => statsOf(buildTrapGeometry(key));

/**
 * The shared assertions every code-authored model has to pass, whatever it is.
 *
 * Factored out when the hero and the roster joined the traps, because these are
 * properties of the *authoring toolkit* (`models/build.ts`) rather than of any
 * one asset: a primitive with inverted winding, a zero-area triangle or an
 * out-of-range colour is a bug in the shared code that would otherwise only be
 * caught on whichever model happened to use it.
 */
function assertWellFormed(name: string, g: BufferGeometry): void {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const col = g.getAttribute("color");

  assert.ok(pos && nrm && col, `${name}: missing an attribute`);
  assert.equal(pos.count, nrm.count, `${name}: normal count mismatch`);
  assert.equal(pos.count, col.count, `${name}: colour count mismatch`);
  assert.equal(pos.count % 3, 0, `${name}: vertex count is not whole triangles`);
  assert.ok(pos.count > 0, `${name}: empty model`);

  for (let v = 0; v < pos.count; v++) {
    for (const a of [pos, nrm, col]) {
      assert.ok(
        Number.isFinite(a.getX(v)) &&
          Number.isFinite(a.getY(v)) &&
          Number.isFinite(a.getZ(v)),
        `${name}: non-finite value at vertex ${v}`,
      );
    }
    const len = Math.hypot(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
    assert.ok(
      Math.abs(len - 1) < 1e-3,
      `${name}: normal at vertex ${v} is not unit length (${len}) — a zero-area triangle`,
    );
    // Baked shading multiplies the swatch down, never up past white.
    for (const ch of [col.getX(v), col.getY(v), col.getZ(v)]) {
      assert.ok(ch >= 0 && ch <= 1.001, `${name}: colour channel out of range (${ch})`);
    }
  }
}

/**
 * Net area-weighted normal. Zero for any correctly wound *closed* shell.
 *
 * This is the rigorous version of the up/down heuristic, and it exists because
 * the heuristic does not survive contact with a character. "Almost no down-facing
 * area" is only true of things that stand upright on the floor; the hero's
 * revolver is a handful of boxes leaned flat, so half its faces legitimately
 * point down and the heuristic fails a model that is perfectly correct.
 *
 * The divergence theorem does not care about orientation: seal a shape and the
 * outward face vectors must cancel. Invert one primitive and they cannot.
 */
function netNormal(g: BufferGeometry): number {
  const pos = g.getAttribute("position");
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let total = 0;

  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax;
    const uy = pos.getY(i + 1) - ay;
    const uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax;
    const vy = pos.getY(i + 2) - ay;
    const vz = pos.getZ(i + 2) - az;
    // Cross product magnitude is twice the area, so this is area-weighted.
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    nx += cx;
    ny += cy;
    nz += cz;
    total += Math.hypot(cx, cy, cz);
  }

  // Normalised by total area, so the tolerance means the same thing at any scale.
  return Math.hypot(nx, ny, nz) / Math.max(1e-9, total);
}

describe("authoring primitives", () => {
  /*
   * The toolkit in models/build.ts, tested directly rather than sampled through
   * whichever asset happens to use it.
   *
   * Winding is the thing worth this much care. It decides which way a face
   * points, an inverted face is *invisible* under backface culling, and the
   * failure reads as a hole in the model rather than as an error — exactly the
   * kind of bug that survives a visual check and then ships. Every top face in
   * the original trap module was inverted on first write.
   *
   * Testing the primitives closed-shell is strictly stronger than testing the
   * assets: every model in the game is built from these five, so one inverted
   * primitive is caught here whether or not any current asset uses it in the
   * orientation that would reveal it.
   */
  it("seals a closed box, with every face pointing outward", () => {
    const g = buildGeometry((s) =>
      box(s, { at: [0, 0, 0], size: [0.4, 0.6, 0.3], col: COLOR.bone, closed: true }),
    );
    assert.ok(netNormal(g) < 1e-6, `closed box does not seal (${netNormal(g)})`);
  });

  it("seals a closed box under taper, yaw and lean", () => {
    // The transform arguments are where winding bugs actually hide: a lean or a
    // yaw that reorders the corners flips faces without changing the code path.
    const g = buildGeometry((s) =>
      box(s, {
        at: [0.2, 0, -0.1],
        size: [0.4, 0.6, 0.3],
        col: COLOR.bone,
        taper: 0.7,
        yaw: 0.9,
        lean: 1.2,
        closed: true,
      }),
    );
    assert.ok(netNormal(g) < 1e-6, `transformed closed box does not seal (${netNormal(g)})`);
  });

  it("seals a capped cylinder on every axis", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const g = buildGeometry((s) =>
        cyl(s, {
          at: [0, 0, 0],
          rBottom: 0.3,
          rTop: 0.2,
          height: 0.5,
          segments: 9,
          col: COLOR.bone,
          caps: "both",
          axis,
        }),
      );
      // The axis rotations are hand-written in build.ts precisely because a
      // coordinate swap has determinant -1 and would silently invert winding.
      assert.ok(netNormal(g) < 1e-6, `cylinder on ${axis} does not seal (${netNormal(g)})`);
    }
  });

  it("points a spike's faces up and out", () => {
    const s = statsOf(
      buildGeometry((sink) =>
        spike(sink, { at: [0, 0, 0], base: [0.3, 0.3], height: 0.5, col: COLOR.bone }),
      ),
    );
    // A pyramid with no base is all up-and-outward; any down-facing area at all
    // means the winding reversed.
    assert.equal(s.areaDown, 0, "spike has down-facing area — winding is inverted");
    assert.ok(s.areaUp > 0, "spike has no up-facing area");
  });

  it("faces an annulus up", () => {
    const s = statsOf(
      buildGeometry((sink) =>
        annulus(sink, { at: [0, 0, 0], inner: 0.2, outer: 0.4, segments: 12, col: COLOR.bone }),
      ),
    );
    assert.equal(s.areaDown, 0, "annulus faces down — chalk would be invisible");
    assert.ok(s.areaUp > 0.3, `annulus up-facing area is only ${s.areaUp}`);
  });

  it("applies withTransform without disturbing winding", () => {
    // Scattering the orchard depends on this: a headstone authored once and
    // stamped 200 times must not invert on any of them.
    const g = buildGeometry((s) =>
      withTransform(s, { x: 3, y: 1, z: -2, yaw: 2.1, scale: 1.7 }, (t) =>
        box(t, { at: [0, 0, 0], size: [0.4, 0.6, 0.3], col: COLOR.bone, closed: true }),
      ),
    );
    assert.ok(netNormal(g) < 1e-6, `transformed stamp does not seal (${netNormal(g)})`);

    // And it must actually move the geometry where it was told to.
    const s = statsOf(g);
    assert.ok(Math.abs(s.maxY - (1 + 0.6 * 1.7)) < 1e-5, `stamp landed at the wrong height`);
  });

  it("is deterministic, including the hashed shapes", () => {
    // `blob` jitters its outline from a hash, not from Math.random (§13 rule 2).
    const build = (): ArrayLike<number> =>
      buildGeometry((s) =>
        blob(s, {
          at: [0, 0, 0],
          rMin: 0.5,
          rMax: 1,
          segments: 12,
          height: 0.05,
          col: COLOR.bone,
          seed: 3,
        }),
      ).getAttribute("position").array;
    assert.deepEqual(build(), build(), "blob is not deterministic");
  });
});

describe("trap models", () => {
  it("every trap in the catalog has a model of its own", () => {
    for (const def of TRAPS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(TRAP_MODELS, def.key),
        `TrapDef "${def.key}" has no model — it would silently fall back to the sigil`,
      );
    }
  });

  it("builds non-degenerate geometry with position, normal and colour", () => {
    for (const def of TRAPS) assertWellFormed(def.key, buildTrapGeometry(def.key));
  });

  it("winds faces outward — top surfaces must actually face up", () => {
    // Bottom faces are omitted by convention, so a correctly wound FLOOR trap has
    // essentially no down-facing area. Invert any primitive's winding and this
    // flips, which is the whole point of the assertion.
    //
    /* It does not generalise to a mounted trap and is not asked to: a Scattergun
       Ports barrel is a horizontal cylinder, so half its tube faces down however it
       is wound. Mounted traps therefore have NO equivalent winding assertion — the
       shared primitives are covered by the primitive tests above and by all five
       floor traps, so a winding bug in `box`/`cyl`/`spike` still fails loudly; what
       is unguarded is a mounted model built inside-out from correct parts. */
    for (const def of TRAPS) {
      if (def.surface !== SURF.floor) continue;
      const s = statsFor(def.key);
      assert.ok(
        s.areaUp > 0.02,
        `${def.key}: almost no up-facing area (${s.areaUp.toFixed(4)}m²) — winding is inverted`,
      );
      assert.ok(
        s.areaUp > s.areaDown * 3,
        `${def.key}: down-facing area ${s.areaDown.toFixed(4)}m² rivals up-facing ` +
          `${s.areaUp.toFixed(4)}m² — some primitive is wound backwards`,
      );
    }
  });

  it("covers the build tile it sits on", () => {
    /*
     * The rule the tile size exists to keep honest. A 2m tile's circumscribed radius
     * is 1.41m, so a trap whose reach is under that leaves its own corners untouched
     * — and a body clipping the corner of your Jaws tile and walking away reads as
     * broken rather than as tight. Floor traps only: a wall mount covers a lane, not
     * a tile.
     */
    const corner = (BUILD_TILE / 2) * Math.SQRT2;
    for (const def of TRAPS) {
      if (def.surface !== SURF.floor) continue;
      assert.ok(
        def.radius >= corner,
        `${def.key}: radius ${def.radius} is under the ${corner.toFixed(2)}m tile corner — bodies clip its corners`,
      );
    }
  });

  it("stays inside its triangle budget", () => {
    // §17.7 gives traps 400-1,200 triangles — "generous, players stare at these".
    for (const def of TRAPS) {
      const s = statsFor(def.key);
      assert.ok(
        s.tris <= TRAP_TRI_BUDGET,
        `${def.key}: ${s.tris} tris exceeds the ${TRAP_TRI_BUDGET} budget`,
      );
      assert.ok(s.tris >= 60, `${def.key}: only ${s.tris} tris — too sparse to read`);
    }
  });

  it("sits on the floor and fits its placement cell", () => {
    for (const def of TRAPS) {
      // Mounted traps are authored centred on their mount, not standing on the
      // floor — see the convention note in render/models/traps.ts. They get their
      // own envelope in the next test.
      if (def.surface !== SURF.floor) continue;
      const s = statsFor(def.key);
      assert.ok(
        s.minY >= -1e-6,
        `${def.key}: dips below the floor (minY ${s.minY}) — scene.ts lifts by 0.01, not more`,
      );
      assert.ok(
        s.maxY > MIN_THICKNESS,
        `${def.key}: is flatter than MIN_THICKNESS (${s.maxY})`,
      );
      /* Body-scale, NOT tile-scale: this is about the player's eye line, and the
         player is still 1.8m however big the build tile gets. It does not scale with
         TRAP_MODEL_SCALE, and that is the point.
         An obstacle is exempt, because occluding the ground behind it is its entire
         job — but it still may not reach eye height, or you could not shoot over your
         own blockade, which is the one thing that makes it enemies-only. */
      const tall = def.blocks === true ? 1.75 : 1.5;
      assert.ok(s.maxY < tall, `${def.key}: ${s.maxY}m tall — occludes the ground behind it`);
      /* Tile-scale: tar is a spilled pool and is meant to overrun its tile,
         everything else stays roughly inside one so placements never visually
         collide. Expressed in tiles so a tile-size change carries them along. */
      const limit = (def.key === "tar" ? 1.6 : 1.0) * TRAP_MODEL_SCALE;
      assert.ok(
        s.maxRadius <= limit,
        `${def.key}: reaches ${s.maxRadius.toFixed(2)}m from centre, over its ${limit}m allowance`,
      );
    }
  });

  it("keeps mounted traps inside their bracket envelope", () => {
    /*
     * A wall or roof trap is placed AT its mount, so it is authored around the
     * origin and may hang below it. What it must not do is reach so far off the
     * surface that it fouls the lane — the player has to be able to run past a
     * wall of iron without the geometry eating them.
     */
    for (const def of TRAPS) {
      if (def.surface === SURF.floor) continue;
      const s = statsFor(def.key);
      const bracket = 0.7 * TRAP_MODEL_SCALE;
      assert.ok(
        Math.abs(s.minY) < bracket && s.maxY < bracket,
        `${def.key}: spans ${s.minY.toFixed(2)}..${s.maxY.toFixed(2)} around its mount — too big for a bracket`,
      );
      assert.ok(
        s.maxRadius <= 0.8 * TRAP_MODEL_SCALE,
        `${def.key}: reaches ${s.maxRadius.toFixed(2)}m off its mount — it would foul the lane`,
      );
    }
  });

  it("is deterministic — the same key builds byte-identical geometry", () => {
    // The tar pool jitters its outline from a hash, not from Math.random (§13).
    // If that ever changes, two players see different puddles and a replay stops
    // matching its own screenshots.
    for (const def of TRAPS) {
      const a = buildTrapGeometry(def.key).getAttribute("position").array;
      const b = buildTrapGeometry(def.key).getAttribute("position").array;
      assert.deepEqual(a, b, `${def.key}: geometry is not deterministic`);
    }
  });
});

describe("enemy models", () => {
  it("every archetype in the roster has a model of its own", () => {
    // §1 pillar 2: silhouette is the only thing that identifies an enemy in a
    // crowd. A def falling back to the Dustkin renders a *different enemy's*
    // silhouette, which is worse than a missing asset because it looks fine.
    for (const def of ENEMIES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ENEMY_MODELS, def.key),
        `EnemyDef "${def.key}" has no model — it would silently render as a Dustkin`,
      );
    }
  });

  it("builds well-formed geometry", () => {
    for (const def of ENEMIES) {
      assertWellFormed(def.key, buildEnemyGeometry(def));
      if (!def.flying) continue;
      assertWellFormed(`${def.key} wing +`, buildWingGeometry(def, 1));
      assertWellFormed(`${def.key} wing -`, buildWingGeometry(def, -1));
    }
  });

  it("stands on its own feet, at roughly the height the sim thinks it is", () => {
    for (const def of ENEMIES) {
      const s = statsOf(buildEnemyGeometry(def));
      // Authored base-at-origin: scene.ts places an instance at the sim's feet
      // position with no offset, so anything below y=0 sinks into the floor.
      assert.ok(
        s.minY >= -1e-6,
        `${def.key}: dips below its own base (minY ${s.minY}) — it would sink into the ground`,
      );
      // Within 25% of the def's height. Loose on purpose — a hunched Dustkin
      // SHOULD be shorter than its stat height — but tight enough to catch a
      // model authored in the wrong units, which is §17.7's classic failure.
      assert.ok(
        s.maxY > def.height * 0.75 && s.maxY < def.height * 1.25,
        `${def.key}: ${s.maxY.toFixed(2)}m tall against a def height of ${def.height}m`,
      );
      // Nothing should be wildly wider than its collision radius, or bodies will
      // visually overlap long before the sim separates them.
      assert.ok(
        s.maxRadius <= def.radius * 3.2,
        `${def.key}: reaches ${s.maxRadius.toFixed(2)}m against a radius of ${def.radius}m`,
      );
    }
  });

  it("stays inside the §17.7 horde triangle budget", () => {
    // Load-bearing beyond the draw cost: the VAT bake at §14.3 costs
    // `verts × frames`, so a detail pass here is paid for again by every frame
    // of every clip when the crowd path lands.
    for (const def of ENEMIES) {
      const s = statsOf(buildEnemyGeometry(def));
      assert.ok(
        s.tris <= ENEMY_TRI_BUDGET,
        `${def.key}: ${s.tris} tris exceeds the ${ENEMY_TRI_BUDGET} budget`,
      );
      assert.ok(s.tris >= 40, `${def.key}: only ${s.tris} tris — too sparse to read`);
    }
  });

  it("is deterministic", () => {
    for (const def of ENEMIES) {
      const a = buildEnemyGeometry(def).getAttribute("position").array;
      const b = buildEnemyGeometry(def).getAttribute("position").array;
      assert.deepEqual(a, b, `${def.key}: geometry is not deterministic`);
    }
  });
});

describe("the heroes", () => {
  it("builds well-formed parts for every playable body", () => {
    for (const profile of HEROES) {
      const parts = buildHeroParts(profile.id);
      for (const [name, geometry] of Object.entries(parts)) {
        assertWellFormed(`${profile.key}.${name}`, geometry);
      }
    }
  });

  it("shares one skeleton — vertical joints are identical across heroes", () => {
    /*
     * The load-bearing rule in HEROES.md §4, and the one that silently rots.
     *
     * §17.6 budgets 28 Mixamo clips authored against ONE skeleton. Two heroes
     * with different joint heights means 56 clips and a second hero that stops
     * being affordable — and the failure would not show up until animation
     * lands at M8, as every clip popping on one body.
     *
     * Lateral offsets are exempt on purpose: retargeting maps bones by name and
     * absorbs a narrower shoulder without touching the clip.
     */
    const base = JOINTS[HEROES[0].id];
    for (const profile of HEROES.slice(1)) {
      const j = JOINTS[profile.id];
      for (const key of ["hips", "shoulder", "neck", "legTop"] as const) {
        assert.equal(
          j[key],
          base[key],
          `${profile.key}: ${key} is ${j[key]}, not ${base[key]} — that is a second skeleton`,
        );
      }
    }
  });

  it("hangs its limbs below their pivots", () => {
    // The rig in actors.ts positions each limb group AT the joint and expects
    // the geometry to hang from it. A limb authored upward would appear growing
    // out of the character's shoulder — and would swing the wrong way.
    for (const profile of HEROES) {
      const parts = buildHeroParts(profile.id);
      for (const name of ["armR", "armL", "legR", "legL", "revolver"] as const) {
        const s = statsOf(parts[name]);
        assert.ok(
          s.minY < -0.05,
          `${profile.key}.${name}: does not hang below its pivot (minY ${s.minY.toFixed(3)})`,
        );
        assert.ok(
          s.maxY <= 0.06,
          `${profile.key}.${name}: rises above its pivot (maxY ${s.maxY.toFixed(3)}) — it would detach`,
        );
      }
    }
  });

  it("is 1.8m of gunslinger, hat included", () => {
    // §17.7: "Hero is 1.8m". Assembled height is the neck joint plus whatever
    // the head part reaches above it, and headwear is allowed past the nominal
    // figure — a hat is a hat.
    for (const profile of HEROES) {
      const joints = JOINTS[profile.id];
      const parts = buildHeroParts(profile.id);
      const head = statsOf(parts.head);
      const top = joints.neck + head.maxY;
      assert.ok(top > 1.8 && top < 2.02, `${profile.key} tops out at ${top.toFixed(2)}m`);

      const legs = statsOf(parts.legR);
      assert.ok(
        Math.abs(joints.legTop + legs.minY) < 0.06,
        `${profile.key}'s boots land at ${(joints.legTop + legs.minY).toFixed(3)}m, not on the floor`,
      );
    }
  });

  it("keeps the two silhouettes apart", () => {
    /*
     * HEROES.md §3 commits the heroes to opposing letterforms: Amos a T (widest
     * at the brim and the hem), Ada an I (a column, veil to the shoulder). That
     * is a *design contract*, and design contracts erode — a later pass widens
     * Ada's hat to make her read better alone, and the co-op legibility the two
     * bodies exist for (HEROES.md §2) is quietly gone.
     *
     * So it is asserted. Headwear width is the check because it is the single
     * most identifying measurement on either model and the first thing anyone
     * would be tempted to even out.
     */
    const width = (id: (typeof HEROES)[number]["id"]): number =>
      statsOf(buildHeroParts(id).head).maxRadius;

    const amos = width(HERO.amos);
    const ada = width(HERO.ada);
    assert.ok(
      amos > ada * 1.25,
      `Amos's brim (${amos.toFixed(2)}m) is no longer decisively wider than Ada's ` +
        `(${ada.toFixed(2)}m) — the T and the I have converged`,
    );

    // And the coats have to diverge at the hem, not only at the head.
    const hem = (id: (typeof HEROES)[number]["id"]): number =>
      statsOf(buildHeroParts(id).torso).maxRadius;
    assert.ok(
      hem(HERO.amos) > hem(HERO.ada) * 1.1,
      `Amos's coat (${hem(HERO.amos).toFixed(2)}m) no longer flares past Ada's column ` +
        `(${hem(HERO.ada).toFixed(2)}m)`,
    );
  });

  it("stays inside the §17.7 hero triangle budget", () => {
    for (const profile of HEROES) {
      const parts = buildHeroParts(profile.id);
      let total = 0;
      for (const geometry of Object.values(parts)) total += statsOf(geometry).tris;
      assert.ok(
        total <= HERO_TRI_BUDGET,
        `${profile.key}: ${total} tris exceeds ${HERO_TRI_BUDGET}`,
      );
      assert.ok(total >= 200, `${profile.key}: only ${total} tris — too sparse to read`);
    }
  });

  it("is deterministic", () => {
    for (const profile of HEROES) {
      const a = buildHeroParts(profile.id).torso.getAttribute("position").array;
      const b = buildHeroParts(profile.id).torso.getAttribute("position").array;
      assert.deepEqual(a, b, `${profile.key}: geometry is not deterministic`);
    }
  });

  it("selects a body from the URL, and falls back rather than throwing", () => {
    /*
     * `?hero=ada` is the temporary stand-in for the pre-run screen (HEROES.md
     * §8). It is two lines of parsing, but it is the only path by which anyone
     * ever plays as the second hero, and it runs before the first frame — a
     * throw here is a black screen, not a wrong hat.
     *
     * Stubbed rather than screenshotted on purpose: a query-string parse is
     * exactly the kind of thing a picture cannot actually confirm.
     */
    const holder = globalThis as { location?: { search: string } };
    const original = holder.location;
    try {
      const idFor = (search: string): number => {
        holder.location = { search };
        return defaultHeroId();
      };
      assert.equal(idFor("?hero=ada"), HERO.ada);
      assert.equal(idFor("?hero=amos"), HERO.amos);
      assert.equal(idFor("?dev&hero=ada"), HERO.ada, "must survive other params");
      assert.equal(idFor("?hero=nobody"), HERO.amos, "unknown hero falls back");
      assert.equal(idFor(""), HERO.amos, "no param falls back");
    } finally {
      if (original === undefined) delete holder.location;
      else holder.location = original;
    }
  });
});
