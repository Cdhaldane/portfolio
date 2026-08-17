/*
 * render/models/props.ts — the Bone Orchard itself: sky, hills, headstones, and
 * everything else that makes the site a *place* rather than a floor with walls.
 *
 * The baseline screenshot this replaces is the argument for the whole file: a
 * flat black sky, one uniform ground plane, and nothing between the walls and
 * the horizon. §3 names the site "Boot Hill — headstones, iron fencing, a hanging
 * tree, open sightlines, wind", and §1's five-second test says the first thirty
 * seconds carry the entire portfolio claim. Neither survives an empty box.
 *
 * Two placement rules keep all of this free of gameplay consequences, which is
 * why it can be added without touching the sim:
 *
 *  1. **Anything tall goes OUTSIDE the perimeter walls.** The graveyard the
 *     player fights in the middle of is 44×34m; the graveyard they can *see* runs
 *     another 30m past it in every direction. Nothing out there is reachable, so
 *     nothing out there can block a lane, occlude a trap, or need collision.
 *  2. **Anything inside is under 20cm.** Tufts, stones and bones read as ground
 *     texture and can be walked and built straight through without looking wrong,
 *     which is exactly what a decorative prop in a trap game has to survive.
 *
 * The one exception is the gate arch, which straddles a spawn point at 4m — over
 * every head in the game, and it was already dressed with free-standing posts.
 *
 * Everything here is stamped from a handful of authored shapes via
 * `withTransform`, so the entire orchard — a few hundred props — merges down to a
 * single geometry and a single draw call (§14.2 budgets 250 for everything).
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  SphereGeometry,
} from "three";

import type { Level } from "../../sim/level.ts";
import { COLOR } from "../palette.ts";
import {
  DRESS_SHADE,
  box,
  createSink,
  cyl,
  finish,
  hash01,
  hash2,
  spike,
  withTransform,
  type Sink,
} from "./build.ts";

/* ── the pieces ──────────────────────────────────────────────────────────── */

/**
 * A headstone, in three silhouettes.
 *
 * Three, not one, because a field of identical markers reads as a texture and a
 * field of three reads as a graveyard — and not thirty, because at 30m past a
 * wall the only thing that survives is the outline. Round-top, cross, and a
 * snapped slab leaning out of true.
 */
function headstone(s: Sink, variant: number): void {
  const stone = variant === 1 ? COLOR.ash : COLOR.grave;

  if (variant === 1) {
    // Cross: an upright and a crossbar. The most legible marker at distance.
    box(s, { at: [0, 0, 0], size: [0.16, 1.05, 0.15], col: stone, taper: 0.88 });
    box(s, { at: [0, 0.66, 0], size: [0.62, 0.15, 0.13], col: stone, taper: 0.9 });
    return;
  }

  if (variant === 2) {
    // Broken slab, leaning. `lean` tips it out of true, which is what stops a
    // row of these looking like a fence.
    box(s, { at: [0, 0, 0], size: [0.5, 0.62, 0.16], col: stone, taper: 0.94, lean: 0.16 });
    // The snap: a shorter shard beside it, fallen the other way.
    box(s, { at: [0.34, 0, 0.1], size: [0.3, 0.16, 0.26], col: stone, taper: 0.8, lean: 0.9 });
    return;
  }

  // Round-top slab: a plinth, the stone, and a faceted cap.
  box(s, { at: [0, 0, 0], size: [0.62, 0.12, 0.34], col: COLOR.ash, taper: 0.92 });
  box(s, { at: [0, 0.1, 0], size: [0.46, 0.74, 0.16], col: stone, taper: 0.95 });
  cyl(s, {
    at: [0, 0.82, 0],
    rBottom: 0.23,
    rTop: 0.19,
    height: 0.14,
    segments: 7,
    col: stone,
    squash: 0.36,
  });
}

/**
 * The hanging tree (§3). Dead, leaning, and tall enough to be a silhouette
 * against the sky from anywhere on the site.
 *
 * The trunk is three stacked frusta with a growing lean rather than one tapered
 * cylinder, because a straight trunk reads as a telegraph pole. Branches get the
 * same treatment at a smaller scale.
 */
function deadTree(s: Sink, seed: number): void {
  const bark = COLOR.timberDark;
  let x = 0;
  let z = 0;
  let y = 0;
  let r = 0.34;

  for (let i = 0; i < 3; i++) {
    const h = 1.5 + hash2(seed, i) * 0.7;
    const nr = r * 0.72;
    cyl(s, {
      at: [x, y, z],
      rBottom: r,
      rTop: nr,
      height: h,
      segments: 7,
      col: bark,
      phase: i * 0.5,
    });
    // Each section drifts, so the trunk bends.
    const a = hash2(seed, i + 7) * Math.PI * 2;
    x += Math.cos(a) * 0.18;
    z += Math.sin(a) * 0.18;
    y += h;
    r = nr;
  }

  // Bare branches, reaching. Five is enough to read; twenty is noise at 40m.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + hash2(seed, i + 21) * 1.2;
    const len = 1.1 + hash2(seed, i + 33) * 1.0;
    box(s, {
      at: [x + Math.cos(a) * 0.1, y - 0.5 - hash2(seed, i + 41) * 0.9, z + Math.sin(a) * 0.1],
      size: [0.19, len, 0.19],
      col: bark,
      taper: 0.35,
      yaw: a,
      // Leaning hard off vertical: dead branches reach out, not up.
      lean: 0.75 + hash2(seed, i + 55) * 0.5,
    });
  }
}

/** A run of iron fence: two posts, two rails, and pickets between them. */
function fenceSection(s: Sink): void {
  const iron = COLOR.grave;
  for (const side of [-1, 1]) {
    box(s, { at: [side * 1.2, 0, 0], size: [0.14, 1.15, 0.14], col: iron, taper: 0.85 });
    spike(s, { at: [side * 1.2, 1.15, 0], base: [0.14, 0.14], height: 0.2, col: iron });
  }
  for (const y of [0.28, 0.86]) {
    box(s, { at: [0, y, 0], size: [2.5, 0.07, 0.07], col: COLOR.rust, taper: 0.95 });
  }
  for (let i = 0; i < 5; i++) {
    const x = (i / 4 - 0.5) * 2.0;
    box(s, { at: [x, 0.1, 0], size: [0.07, 0.92, 0.07], col: iron, taper: 0.9 });
    spike(s, { at: [x, 1.02, 0], base: [0.07, 0.07], height: 0.14, col: iron });
  }
}

/** A tuft of dry grass. Five leaning blades — the cheapest possible "ground". */
function tuft(s: Sink, seed: number): void {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + hash2(seed, i) * 1.4;
    spike(s, {
      at: [Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07],
      base: [0.06, 0.05],
      height: 0.11 + hash2(seed, i + 9) * 0.07,
      col: i % 2 === 0 ? COLOR.dust : COLOR.timberDark,
      yaw: a,
      lean: 0.3 + hash2(seed, i + 17) * 0.4,
    });
  }
}

/** A stone, half-buried. */
function stone(s: Sink, seed: number): void {
  box(s, {
    at: [0, 0, 0],
    size: [0.22 + hash2(seed, 1) * 0.2, 0.1 + hash2(seed, 2) * 0.06, 0.2 + hash2(seed, 3) * 0.18],
    col: COLOR.grave,
    taper: 0.65,
    yaw: hash2(seed, 4) * Math.PI,
  });
}

/**
 * Scattered bones. This is the Bone Orchard; the name should be doing work
 * somewhere the player can actually see it.
 */
function bones(s: Sink, seed: number): void {
  for (let i = 0; i < 3; i++) {
    box(s, {
      at: [hash2(seed, i) * 0.3 - 0.15, 0, hash2(seed, i + 5) * 0.3 - 0.15],
      size: [0.26, 0.06, 0.07],
      col: COLOR.bone,
      taper: 0.8,
      yaw: hash2(seed, i + 11) * Math.PI,
    });
  }
}

/**
 * The gate arch: where the dead come in.
 *
 * Replaces two free-standing posts with something that reads as a *threshold*.
 * The lanterns are `lamp`-coloured because §3 reserves warm light for safe/yours
 * — the gate is the site's, not the Choir's, and the point light `scene.ts` hangs
 * here needs a source you can see.
 */
function gateArch(s: Sink): void {
  const timber = COLOR.timber;
  const dark = COLOR.timberDark;

  for (const side of [-1, 1]) {
    // Posts lean very slightly inward: nothing on this site stands straight.
    box(s, {
      at: [0, 0, side * 2.3],
      size: [0.42, 4.0, 0.42],
      col: timber,
      taper: 0.86,
      lean: -side * 0.03,
    });
    // Footing stones.
    box(s, { at: [0, 0, side * 2.3], size: [0.66, 0.22, 0.66], col: COLOR.grave, taper: 0.88 });
    // A brace back to the post.
    box(s, {
      at: [0, 3.1, side * 1.75],
      size: [0.2, 0.75, 0.2],
      col: dark,
      taper: 0.8,
      lean: side * 0.6,
    });
  }

  // Crossbeam over the lane, at 4m — clear over every head in the game.
  box(s, { at: [0, 3.95, 0], size: [0.36, 0.34, 5.4], col: timber, taper: 0.94 });
  // The sign board. `BONE ORCHARD · NO TRESPASSING` is on it in spirit; at this
  // distance a board is a board, and lettering would be sub-3cm noise (§17.1).
  box(s, { at: [0, 3.35, 0], size: [0.1, 0.5, 2.2], col: dark, taper: 0.96 });

  // Two hanging lanterns.
  for (const side of [-1, 1]) {
    box(s, { at: [0, 3.5, side * 1.5], size: [0.08, 0.28, 0.08], col: COLOR.rust, taper: 0.9 });
    cyl(s, {
      at: [0, 3.24, side * 1.5],
      rBottom: 0.14,
      rTop: 0.16,
      height: 0.26,
      segments: 7,
      col: COLOR.lamp,
    });
    cyl(s, {
      at: [0, 3.5, side * 1.5],
      rBottom: 0.17,
      rTop: 0.1,
      height: 0.12,
      segments: 7,
      col: COLOR.rust,
    });
  }
}

/**
 * The kerb around the Rift: nine stones and a chalk ring.
 *
 * Nine, because the thing at the bottom of Shaft Nine is the Ninth Bell (§3) and
 * the Sigil of Nine already counts its ticks for the same reason. The kerb also
 * does a practical job — it gives the objective a built edge, so the Rift reads
 * as a grave-well someone dug rather than a cyan light with no cause.
 */
function riftKerb(s: Sink, radius: number): void {
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const lean = hash2(i, 3) * 0.12 - 0.06;
    box(s, {
      at: [Math.cos(a) * radius, 0, Math.sin(a) * radius],
      size: [0.5, 0.3 + hash2(i, 8) * 0.16, 0.34],
      col: COLOR.grave,
      taper: 0.82,
      yaw: -a,
      lean,
    });
  }
}

/* ── the orchard ─────────────────────────────────────────────────────────── */

/** How far past the walls the visible graveyard runs. Fog eats the rest. */
const OUTSKIRT = 30;

/** Distance from the site edge, 0 while inside it. */
function outsideBy(level: Level, x: number, z: number): number {
  return Math.max(0, -x, x - level.width, -z, z - level.depth);
}

/**
 * Everything static and decorative, merged into one geometry.
 *
 * Deliberately one pass over a coarse lattice rather than a random scatter: a
 * lattice with hashed jitter never clumps, never leaves a suspicious hole, and —
 * because every decision comes from `hash01` of the cell index — builds the exact
 * same orchard every run without touching the sim's RNG (§13 rule 2).
 */
export function buildDressingGeometry(level: Level): BufferGeometry {
  const s = createSink(DRESS_SHADE);
  const STEP = 2.6;
  let seed = 0;

  // ── the graveyard beyond the walls ──────────────────────────────────────
  for (let z = -OUTSKIRT; z < level.depth + OUTSKIRT; z += STEP) {
    for (let x = -OUTSKIRT; x < level.width + OUTSKIRT; x += STEP) {
      seed++;
      // A skirt of 1.5m keeps props off the wall faces themselves.
      const out = outsideBy(level, x, z);
      if (out < 1.5) continue;

      // Density falls off with distance so the field thins into the fog rather
      // than ending on a line.
      const falloff = 1 - Math.min(1, out / OUTSKIRT) * 0.55;
      const roll = hash2(seed, 1);
      if (roll > 0.42 * falloff) continue;

      const px = x + (hash2(seed, 2) - 0.5) * STEP * 0.8;
      const pz = z + (hash2(seed, 3) - 0.5) * STEP * 0.8;
      const yaw = hash2(seed, 4) * Math.PI * 2;
      const pick = hash2(seed, 5);

      if (pick > 0.965) {
        // A dead tree. Rare on purpose: §3 gives Boot Hill *a* hanging tree, and
        // a forest of them would be a different site.
        withTransform(s, { x: px, z: pz, yaw, scale: 0.85 + hash2(seed, 6) * 0.5 }, (t) =>
          deadTree(t, seed),
        );
      } else if (pick > 0.9) {
        withTransform(s, { x: px, z: pz, yaw }, fenceSection);
      } else {
        const variant = pick > 0.62 ? 1 : pick > 0.3 ? 0 : 2;
        withTransform(
          s,
          { x: px, z: pz, yaw, scale: 0.8 + hash2(seed, 7) * 0.55 },
          (t) => headstone(t, variant),
        );
      }
    }
  }

  // ── pickets crowning the perimeter walls ────────────────────────────────
  //
  // The walls are 4m of flat timber ending in a hard horizontal line against the
  // sky, which is the least interesting edge in the frame. Iron pickets break it
  // up and put §3's "iron fencing" where it is always visible.
  const crown = (x: number, z: number, i: number): void => {
    spike(s, {
      at: [x, 4.0, z],
      base: [0.11, 0.11],
      height: 0.3 + hash01(i * 13 + 1) * 0.12,
      col: COLOR.grave,
    });
  };
  for (let x = 0.6; x < level.width; x += 0.85) {
    crown(x, 0, x * 7);
    crown(x, level.depth, x * 11 + 3);
  }
  for (let z = 0.6; z < level.depth; z += 0.85) {
    crown(0, z, z * 17 + 5);
    crown(level.width, z, z * 19 + 9);
  }

  // ── ground scatter inside the site ──────────────────────────────────────
  //
  // Capped at 20cm so it can never occlude a trap, a body or a lane. This is
  // texture, not furniture.
  for (let cz = 0; cz < level.gh; cz++) {
    for (let cx = 0; cx < level.gw; cx++) {
      const i = cz * level.gw + cx;
      if (level.blocked[i]) continue;
      const roll = hash2(i, 31);
      if (roll > 0.17) continue;

      const px = (cx + 0.5 + (hash2(i, 32) - 0.5) * 0.7) * level.cell;
      const pz = (cz + 0.5 + (hash2(i, 33) - 0.5) * 0.7) * level.cell;
      // Keep the objective's apron clear — the Rift needs to read cleanly.
      const dx = px - level.rift.x;
      const dz = pz - level.rift.z;
      if (dx * dx + dz * dz < (level.rift.radius + 1.2) ** 2) continue;

      const yaw = hash2(i, 34) * Math.PI * 2;
      const pick = hash2(i, 35);
      withTransform(s, { x: px, z: pz, yaw }, (t) => {
        if (pick > 0.82) bones(t, i);
        else if (pick > 0.5) stone(t, i);
        else tuft(t, i);
      });
    }
  }

  // ── the objective and the gates ─────────────────────────────────────────
  withTransform(s, { x: level.rift.x, z: level.rift.z }, (t) =>
    riftKerb(t, level.rift.radius + 0.35),
  );
  for (const gate of level.gates) {
    withTransform(s, { x: gate.x, z: gate.z }, gateArch);
  }

  // ── authored lanterns ────────────────────────────────────────────────────
  // Same rule as the gate arches: the point light scene.ts hangs on a LampDef
  // needs a source you can see, or the pool of light reads as a rendering bug.
  for (const lamp of level.atmosphere.lamps ?? []) {
    minerLamp(s, lamp.x, lamp.y, lamp.z, lamp.post === true);
  }

  return finish(s);
}

/**
 * A miner's lantern: a rust bracket, a `lamp` glass, and — for the standing
 * variant — a timber post from the ground. The bracket-only form hangs off
 * whatever the map put next to it (Shaft Nine bolts them to its timber sets).
 * Dimensions match the gate arch's lanterns, because they are the same lamps
 * from the same company store.
 */
function minerLamp(s: Sink, x: number, y: number, z: number, post: boolean): void {
  if (post) {
    // The post, planted a little off vertical — company issue, miner installed.
    box(s, {
      at: [x, 0, z],
      size: [0.22, y + 0.3, 0.22],
      col: COLOR.timber,
      taper: 0.82,
      lean: 0.03,
    });
    // A footing wedge, so it reads as planted rather than stuck on.
    box(s, { at: [x, 0, z], size: [0.4, 0.18, 0.4], col: COLOR.grave, taper: 0.85 });
  }
  // Bracket arm above the glass.
  box(s, {
    at: [x, y + 0.14, z],
    size: [0.08, 0.28, 0.08],
    col: COLOR.rust,
    taper: 0.9,
  });
  // The glass: `lamp`-coloured, the §3 warm-means-yours signal, and the visible
  // source for the light scene.ts parents here.
  cyl(s, {
    at: [x, y - 0.14, z],
    rBottom: 0.14,
    rTop: 0.16,
    height: 0.26,
    segments: 7,
    col: COLOR.lamp,
  });
  // The cap.
  cyl(s, {
    at: [x, y + 0.12, z],
    rBottom: 0.17,
    rTop: 0.1,
    height: 0.12,
    segments: 7,
    col: COLOR.rust,
  });
}

/**
 * A ring of low hills on the horizon.
 *
 * Its own geometry because it wants to sit *behind* the fog's far plane and be
 * almost entirely eaten by it — which is the whole effect. Hills you can barely
 * make out give the site a beyond; hills you can see clearly give it a wall.
 */
export function buildHillsGeometry(level: Level): BufferGeometry {
  const s = createSink(DRESS_SHADE);
  const cx = level.width / 2;
  const cz = level.depth / 2;

  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + hash01(i * 3 + 1) * 0.2;
    const dist = 78 + hash2(i, 2) * 26;
    spike(s, {
      at: [cx + Math.cos(a) * dist, -2, cz + Math.sin(a) * dist],
      base: [34 + hash2(i, 3) * 26, 30 + hash2(i, 4) * 20],
      height: 9 + hash2(i, 5) * 13,
      col: COLOR.ash,
      yaw: a,
    });
  }

  return finish(s);
}

/* ── the sky ─────────────────────────────────────────────────────────────── */

/**
 * A gradient sky dome.
 *
 * The single biggest change to the frame, and the cheapest: the baseline was a
 * flat `void` clear colour, so the top half of every screenshot was dead black
 * and the walls ended in nothing. §17.1's value rule is "dark ground, mid
 * architecture, **light sky/fog**" — without a sky there is no top of the value
 * range for anything else to read against.
 *
 * `moonAt` biases a cool glow toward the moon so the sky isn't radially
 * symmetric, which is what stops it looking like a lighting preset.
 *
 * The radius has to stay inside the camera's 220m far plane or the dome is
 * clipped away entirely and the sky goes back to being the clear colour — which
 * is a genuinely confusing failure, because the geometry is right there and
 * simply never drawn. `scene.ts` re-centres it on the camera every frame, so
 * 200m is always 200m away.
 */
export const SKY_RADIUS = 200;

export function buildSkyGeometry(moonAt: { x: number; y: number; z: number }): BufferGeometry {
  const geo = new SphereGeometry(SKY_RADIUS, 24, 16);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);

  const zenith = new Color(COLOR.void);
  // The horizon is `ash` lifted toward `bell` — a cool *value*, not a cyan. §3
  // reserves saturated cyan for the Choir, and spending that signal on the sky
  // would be the most expensive palette mistake available.
  const horizon = new Color(COLOR.ash).lerp(new Color(COLOR.bell), 0.3);
  const glow = new Color(COLOR.bell).lerp(new Color(0xffffff), 0.5);

  const len = Math.hypot(moonAt.x, moonAt.y, moonAt.z) || 1;
  const mx = moonAt.x / len;
  const my = moonAt.y / len;
  const mz = moonAt.z / len;
  const c = new Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, y, z) || 1;
    const up = y / r;

    // Sharpened toward the horizon: most of the gradient's range should live in
    // the bottom third of the dome, which is the part actually on screen.
    const t = Math.min(1, Math.max(0, up + 0.12) ** 0.62);
    c.copy(horizon).lerp(zenith, t);

    // Moon glow: a wide, soft pool around the moon's own direction.
    const towardMoon = Math.max(0, (x * mx + y * my + z * mz) / r);
    c.lerp(glow, towardMoon ** 7 * 0.5);

    // Below the horizon, sink to the deepest value so the dome's underside never
    // shows as a lighter band under the ground plane.
    if (up < 0) c.multiplyScalar(1 + Math.max(-0.75, up * 1.6));

    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }

  geo.setAttribute("color", new BufferAttribute(col, 3));
  return geo;
}

/**
 * Stars, as a single `Points` cloud on the upper hemisphere.
 *
 * One draw call, no texture, and it does more for "night" than any amount of
 * post-processing. Distributed by a hash rather than `Math.random` so the sky is
 * the same one every run — the title-card dolly (§1) should be reproducible.
 */
/**
 * The Rift, as light rather than as glass.
 *
 * The first version was a `MeshBasicMaterial` cylinder at a flat 0.16 opacity,
 * and from four metres away — which is where the player spawns — it read as a
 * pale blue plastic tube covering a third of the frame. Three things were wrong
 * with it and all three are geometry problems, not shader problems:
 *
 *  1. **Uniform opacity.** Real light falls off. A column that is as solid at
 *     its top as at its base has no direction, so it reads as a wall.
 *  2. **One surface.** A single shell has a hard silhouette. Light does not.
 *  3. **Flat blending.** Alpha blending over the sky darkened it; additive
 *     blending *adds* to what is behind, which is what emitted light does.
 *
 * So: three nested shells, each fading to black upward, drawn additively. Black
 * is transparent under additive blending, so the fade lives in the vertex
 * colours and no alpha channel is needed at all — which also means it can be one
 * geometry and one draw call.
 *
 * `bell` (#9be3ff) is the correct swatch: §17.1 gives it to "Rift light, cold
 * magic accents", and the Rift is the one cyan thing in the game that is not a
 * threat.
 */
export function buildRiftGeometry(radius: number): BufferGeometry {
  /*
   * Shell radius multiplier, height, and how hot the base is.
   *
   * The gains are LOW on purpose, and lower than they look like they should be.
   *
   * Two things stack against them. Bloom runs at strength 0.62 with a high
   * threshold (render/post), so anything additive near full swatch brightness
   * sails past it — 1.0/0.55/0.28 whited out the whole right of the frame from
   * the spawn point. And `DoubleSide` means a grazing view crosses SIX surfaces
   * (front and back of three shells), each adding, so the on-screen value is
   * several times the number written here.
   *
   * Calibrated against the version this replaces, which was a single alpha
   * shell at 0.16 and read at about the right brightness while reading as the
   * wrong material. Summed across the layers these land near that, with the
   * falloff doing the work instead of the opacity.
   */
  const SHELLS = [
    { r: 0.42, h: 5.2, gain: 0.085 },
    { r: 0.72, h: 4.0, gain: 0.05 },
    { r: 1.0, h: 2.8, gain: 0.028 },
  ];
  const SEGMENTS = 22;

  const pos: number[] = [];
  const col: number[] = [];
  const base = new Color(COLOR.bell);

  for (const shell of SHELLS) {
    const r = radius * shell.r;
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
      const x0 = Math.cos(a0) * r;
      const z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r;
      const z1 = Math.sin(a1) * r;

      /* Taper inward as it rises: a column that narrows reads as something
       * escaping, where a parallel-sided one reads as a pipe. */
      const topR = 0.55;
      const tx0 = x0 * topR;
      const tz0 = z0 * topR;
      const tx1 = x1 * topR;
      const tz1 = z1 * topR;

      // Two triangles, wound both ways so the shell is visible from inside too.
      const quad = [
        [x0, 0, z0, 0], [x1, 0, z1, 0], [tx1, shell.h, tz1, 1],
        [x0, 0, z0, 0], [tx1, shell.h, tz1, 1], [tx0, shell.h, tz0, 1],
        [x1, 0, z1, 0], [x0, 0, z0, 0], [tx0, shell.h, tz0, 1],
        [x1, 0, z1, 0], [tx0, shell.h, tz0, 1], [tx1, shell.h, tz1, 1],
      ];
      for (const [vx, vy, vz, t] of quad) {
        pos.push(vx, vy, vz);
        /* Cubic fade, not linear: light thins fast and then lingers, and a
         * linear ramp leaves a visible flat-topped column. */
        const k = (1 - (t as number)) ** 3 * shell.gain;
        col.push(base.r * k, base.g * k, base.b * k);
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  return geo;
}

export function buildStarfield(): Points {
  const COUNT = 420;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const c = new Color();

  for (let i = 0; i < COUNT; i++) {
    // Even-ish spread over the dome: acos-distributed elevation, hashed azimuth.
    const az = hash2(i, 1) * Math.PI * 2;
    const el = Math.acos(1 - hash2(i, 2) * 0.92);
    // Just inside the dome, so stars never punch through it.
    const r = SKY_RADIUS * 0.95;
    const sinEl = Math.sin(el);
    pos[i * 3] = Math.cos(az) * sinEl * r;
    pos[i * 3 + 1] = Math.abs(Math.cos(el)) * r;
    pos[i * 3 + 2] = Math.sin(az) * sinEl * r;

    // A few bright ones, most dim. A uniform field reads as noise.
    const mag = hash2(i, 3) ** 3;
    c.copy(COLOR.sunbleach).lerp(new Color(COLOR.bell), hash2(i, 4) * 0.6);
    c.multiplyScalar(0.25 + mag * 0.95);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));

  const points = new Points(
    geo,
    new PointsMaterial({
      size: 1.7,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}
