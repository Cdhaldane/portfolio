/*
 * render/models/traps.ts — the trap catalog as geometry, authored in code.
 *
 * GALLOWS_HYMN.md §23.1 decision 15: traps are *code-authored*, not modelled.
 * Three reasons, in order of how much they matter:
 *
 *  1. **Traps are mechanical.** Moving parts need exact pivots, and a jaw that
 *     snaps or a lever that throws has to be positioned to the centimetre. That
 *     is a number you tune, not a mesh you re-export.
 *  2. **Players stare at traps longer than at anything else**, so the iteration
 *     loop matters more here than anywhere. Editing a constant and hitting save
 *     beats a Blender round-trip by two orders of magnitude.
 *  3. **They live next to their `TrapDef`** (`sim/traps.ts`) as reviewable text.
 *
 * The style is §17.1 cartoony; the primitives that enforce it — the tapered box,
 * the faceted cylinder, the fat wedge — and the baked-shading rules all live in
 * `models/build.ts`, shared with the hero, the roster and the site dressing. The
 * only thing in this file is the traps themselves.
 *
 * One consequence of baked vertex colours is worth restating here, because it
 * constrains the renderer: a trap is an `InstancedMesh` (one draw call for every
 * Jaws on the map), so the per-instance colour multiplies over every part at
 * once. It therefore cannot carry the element hue — it carries *state* (armed /
 * cooling / just-fired), and the element hue moved into the model where it
 * belongs diegetically (tar is black, the vent glows ember, the sigil is chalk).
 */

import type { BufferGeometry } from "three";
import { COLOR } from "../palette.ts";
import { BUILD_TILE } from "../../sim/level.ts";
import {
  MIN_THICKNESS,
  annulus,
  blob,
  box,
  buildGeometry,
  cyl,
  spike,
  type Sink,
  type Vec3,
} from "./build.ts";

export { MIN_THICKNESS };

/* ── the traps ───────────────────────────────────────────────────────────── */

/**
 * JAWS OF PERDITION — the bear trap.
 *
 * The teeth are the asset. Two opposed arcs of fat wedges are what makes this
 * readable as a bear trap at 64px, so they get 2× realistic size and everything
 * else (pan, springs, chain) is subordinate to keeping them legible.
 */
function jaws(s: Sink): void {
  const iron = COLOR.grave;
  const rust = COLOR.rust;
  const wood = COLOR.timberDark;

  // The pan: a low faceted dish the jaws hinge off.
  cyl(s, { at: [0, 0, 0], rBottom: 0.34, rTop: 0.3, height: 0.07, segments: 10, col: iron });
  // A wooden baseboard peeking out, so the pan isn't floating on the floor.
  box(s, { at: [0, 0, 0], size: [0.74, 0.045, 0.5], col: wood, taper: 0.94 });

  // Two jaws, mirrored across Z. Five teeth each on a short arc bar.
  // Annotated as `number` so the defensive `TEETH === 1` guard below stays legal:
  // a bare `= 5` narrows to the literal type 5 and TS rejects the comparison.
  const TEETH: number = 5;
  const arc = 1.15; // radians spanned by one jaw
  const arcR = 0.29;
  for (const side of [1, -1]) {
    for (let i = 0; i < TEETH; i++) {
      const t = i / (TEETH - 1);
      const a = (t - 0.5) * arc;
      const bx = Math.sin(a) * arcR;
      const bz = Math.cos(a) * arcR * side;
      const yaw = a * side;

      // Arc bar segment the tooth stands on.
      box(s, {
        at: [bx, 0.055, bz],
        size: [0.15, 0.055, 0.075],
        col: iron,
        yaw,
        taper: 0.9,
      });
      // The tooth: leaning inward, tallest in the middle of the jaw.
      const h = 0.17 + (1 - Math.abs(t - 0.5) * 2) * 0.06;
      spike(s, {
        at: [bx, 0.105, bz],
        base: [0.105, 0.075],
        height: h,
        col: iron,
        yaw,
        lean: -0.42 * side,
      });
    }
  }

  // Springs: oversized coils either side. Two stacked frusta read as a coil
  // without the geometry of an actual helix.
  for (const side of [1, -1]) {
    cyl(s, {
      at: [0.3 * side, 0.045, 0],
      rBottom: 0.105,
      rTop: 0.085,
      height: 0.075,
      segments: 8,
      col: rust,
    });
    cyl(s, {
      at: [0.3 * side, 0.12, 0],
      rBottom: 0.085,
      rTop: 0.1,
      height: 0.06,
      segments: 8,
      col: rust,
      phase: 0.4,
    });
  }

  // Chain to a stake: three fat links. Three, not twenty (§17.1).
  //
  // The run is kept inside a 1m radius on purpose. A longer, more natural chain
  // reaches into the neighbouring placement cell, and two adjacent Jaws then have
  // their chains crossing through each other — invisible in a single-trap test
  // scene and obvious the moment a lane is built out. The geometry test asserts
  // the radius so this can't creep back.
  for (let i = 0; i < 3; i++) {
    box(s, {
      at: [0.4 + i * 0.13, 0.02, -0.28 - i * 0.055],
      size: [0.13, 0.05, 0.075],
      col: rust,
      yaw: -0.4 + i * 0.12,
      taper: 0.85,
    });
  }
  box(s, {
    at: [0.76, 0, -0.4],
    size: [0.08, 0.16, 0.08],
    col: iron,
    taper: 0.6,
  });
}

/**
 * TAR SEEP — the pool.
 *
 * The pool alone would read as a decal, so the identity is carried by the
 * tipped-over barrel that produced it. That also solves the silhouette problem:
 * an aura trap is flat by nature and needs one vertical element to exist at all.
 */
function tar(s: Sink): void {
  // Two blobs at different radii and seeds: a wet edge and a darker core.
  blob(s, {
    at: [0, 0, 0],
    rMin: 1.02,
    rMax: 1.3,
    segments: 16,
    height: 0.045,
    col: COLOR.ash,
    seed: 1,
  });
  blob(s, {
    at: [-0.05, 0.045, 0.04],
    rMin: 0.5,
    rMax: 0.78,
    segments: 13,
    height: 0.022,
    col: COLOR.void,
    seed: 5,
  });

  // The barrel, on its side, mouth toward the pool.
  //
  // `by` has to clear the *widest* ring, not the barrel body: the hoops are
  // r=0.225 and a horizontal cylinder spans centre ± r, so anything under 0.225
  // buries the hoops in the floor. It sits on the pool surface, which is right.
  const bx = 0.72;
  const by = 0.24;
  const bz = 0.5;
  cyl(s, {
    at: [bx, by, bz],
    rBottom: 0.19,
    rTop: 0.19,
    height: 0.44,
    segments: 10,
    col: COLOR.timber,
    axis: "x",
    caps: "both",
  });
  // A bulge, because a straight cylinder is a pipe and a bulged one is a barrel.
  cyl(s, {
    at: [bx + 0.06, by, bz],
    rBottom: 0.215,
    rTop: 0.215,
    height: 0.16,
    segments: 10,
    col: COLOR.timber,
    axis: "x",
    caps: "none",
  });
  for (const off of [-0.16, 0.0, 0.17]) {
    cyl(s, {
      at: [bx + off + 0.02, by, bz],
      rBottom: 0.225,
      rTop: 0.225,
      height: 0.05,
      segments: 10,
      col: COLOR.rust,
      axis: "x",
      caps: "none",
      phase: 0.3,
    });
  }
  // The spill: a short tongue of tar from the barrel mouth to the pool.
  box(s, {
    at: [0.38, 0.02, 0.34],
    size: [0.4, 0.05, 0.24],
    col: COLOR.void,
    yaw: -0.5,
    taper: 0.7,
  });
}

/**
 * BRIMSTONE VENT — the pipe mouth.
 *
 * The one trap with a genuinely vertical silhouette, and the only one carrying an
 * `ember` element colour in the model. The glow disc inside the mouth is what
 * says "this is the fire one" from across the room.
 */
function vent(s: Sink): void {
  const iron = COLOR.grave;
  const rust = COLOR.rust;

  // Flange bolted to the floor.
  cyl(s, { at: [0, 0, 0], rBottom: 0.36, rTop: 0.3, height: 0.06, segments: 10, col: iron });
  // Oversized bolts — the cartoony rule, and they give the flange a read.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    cyl(s, {
      at: [Math.cos(a) * 0.25, 0.06, Math.sin(a) * 0.25],
      rBottom: 0.05,
      rTop: 0.042,
      height: 0.05,
      segments: 6,
      col: rust,
    });
  }

  // The stack, tapering in, then flaring out into the mouth.
  cyl(s, { at: [0, 0.06, 0], rBottom: 0.2, rTop: 0.15, height: 0.3, segments: 10, col: iron });
  cyl(s, {
    at: [0, 0.36, 0],
    rBottom: 0.15,
    rTop: 0.27,
    height: 0.13,
    segments: 10,
    col: rust,
    phase: 0.31,
  });

  // The ember throat, recessed just under the lip so it reads as depth.
  cyl(s, {
    at: [0, 0.455, 0],
    rBottom: 0.2,
    rTop: 0.2,
    height: 0.012,
    segments: 10,
    col: COLOR.ember,
  });

  // Grate bars across the mouth.
  for (const off of [-0.11, 0.0, 0.11]) {
    box(s, {
      at: [0, 0.478, off],
      size: [0.44, 0.05, 0.055],
      col: iron,
      taper: 0.8,
    });
  }
}

/**
 * POWDER PLATE — the keg on a pressure board.
 *
 * A barrel is the most legible "this explodes" shape available, so the keg is
 * deliberately oversized relative to the board it stands on. The board's visible
 * hinges are what tell the player it's *pressure* triggered rather than timed.
 */
function plate(s: Sink): void {
  const wood = COLOR.timber;
  const dark = COLOR.timberDark;
  const rust = COLOR.rust;
  const iron = COLOR.grave;

  // Pressure board.
  box(s, { at: [0, 0, 0], size: [0.88, 0.06, 0.88], col: dark, taper: 0.93 });
  // Planks, as three shallow boxes so the board isn't one flat slab.
  for (const off of [-0.28, 0, 0.28]) {
    box(s, { at: [0, 0.06, off], size: [0.84, 0.03, 0.24], col: wood, taper: 0.96 });
  }
  // Hinges: the mechanism tell.
  for (const side of [1, -1]) {
    box(s, {
      at: [0.4 * side, 0.06, 0],
      size: [0.1, 0.06, 0.2],
      col: iron,
      taper: 0.8,
    });
  }

  // The keg: two frusta bulging at the waist.
  cyl(s, { at: [0, 0.09, 0], rBottom: 0.2, rTop: 0.26, height: 0.17, segments: 10, col: wood });
  cyl(s, {
    at: [0, 0.26, 0],
    rBottom: 0.26,
    rTop: 0.2,
    height: 0.17,
    segments: 10,
    col: wood,
    phase: 0.31,
  });
  // Hoops.
  for (const y of [0.13, 0.25, 0.37]) {
    cyl(s, {
      at: [0, y, 0],
      rBottom: 0.265,
      rTop: 0.265,
      height: 0.045,
      segments: 10,
      col: rust,
      caps: "none",
      phase: 0.15,
    });
  }
  // Lid.
  cyl(s, { at: [0, 0.43, 0], rBottom: 0.2, rTop: 0.185, height: 0.045, segments: 10, col: dark });

  // Fuse: three stepped links curling off the lid. Reads at a glance, and it's
  // where the wind-up tell (§14.6) will animate from.
  const fuse: Vec3[] = [
    [0.05, 0.475, 0.02],
    [0.12, 0.53, 0.06],
    [0.15, 0.575, 0.13],
  ];
  for (let i = 0; i < fuse.length; i++) {
    box(s, {
      at: fuse[i],
      size: [0.07, 0.055, 0.07],
      col: COLOR.ash,
      yaw: i * 0.5,
      taper: 0.8,
    });
  }
}

/**
 * SIGIL OF NINE — the chalk circle.
 *
 * The only trap that is *supposed* to be flat: it's chalk and ash on the ground
 * (§3 — magic gets into this world as a contaminant, drawn by hand). It gets
 * exactly enough vertical geometry to exist as a silhouette — three candle stubs
 * and a centre heap — and no more, because a chalk circle with a tower on it
 * would be a different trap.
 *
 * Note the chalk is `bone`, not `hex` cyan. The §3 colour contract reserves cyan
 * for the Choir and for "physical traps don't work here"; this is the player's
 * own trap, so the element hue lives on the reach ring, not on the asset.
 */
function sigil(s: Sink): void {
  const chalk = COLOR.bone;

  annulus(s, { at: [0, 0.014, 0], inner: 0.52, outer: 0.63, segments: 22, col: chalk });
  annulus(s, { at: [0, 0.014, 0], inner: 0.17, outer: 0.25, segments: 16, col: chalk });

  // Nine ticks — the name is load-bearing, so the count has to be right.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    box(s, {
      at: [Math.cos(a) * 0.72, 0.012, Math.sin(a) * 0.72],
      size: [0.16, 0.022, 0.06],
      col: chalk,
      yaw: -a,
      taper: 0.7,
    });
  }

  // Three candle stubs on the ring, at every third tick.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.35;
    const cxp = Math.cos(a) * 0.44;
    const czp = Math.sin(a) * 0.44;
    cyl(s, {
      at: [cxp, 0.014, czp],
      rBottom: 0.055,
      rTop: 0.045,
      height: 0.13,
      segments: 7,
      col: COLOR.sunbleach,
    });
    // The one warm accent: a lamp-coloured flame nub.
    spike(s, {
      at: [cxp, 0.144, czp],
      base: [0.055, 0.055],
      height: 0.07,
      col: COLOR.lamp,
    });
  }

  // Ash heap at the centre.
  spike(s, { at: [0, 0.014, 0], base: [0.2, 0.2], height: 0.1, col: COLOR.ash });
}


/* ── wall and ceiling mounts ──────────────────────────────────────────────
 *
 * These four are authored to a different convention from the five floor traps,
 * and it is worth being explicit about why.
 *
 * A floor trap authors its base at y = 0 and the renderer drops it on the ground.
 * A mounted trap is placed *at* its mount — 1.4m up a wall, 4.4m up a beam — so it
 * is authored **centred on the origin** instead, free to extend above and below.
 *
 * And **-Z is outward**: `scene.ts` rotates the instance by the mount's `yaw`,
 * which turns model -Z into the wall's outward normal (see `sideYaw`). So the
 * barrels, the bracket arm and the coil all reach toward -Z, and a trap bolted to
 * an east-facing face ends up pointing east without a special case anywhere.
 */

/**
 * SCATTERGUN PORTS — three cut-down barrels through a loophole plate.
 *
 * The barrels are the asset: they have to read as *guns in the wall* from the far
 * end of the lane, so they are oversized relative to the plate and splayed, which
 * also telegraphs the cone the shot covers.
 */
function ports(s: Sink): void {
  // The plate, sunk into the wall.
  box(s, { at: [0, 0, 0.03], size: [0.76, 0.56, 0.1], col: COLOR.timberDark });
  // Iron straps top and bottom — the plate needs to look bolted on, not painted.
  for (const y of [0.24, -0.24]) {
    box(s, { at: [0, y, 0.01], size: [0.8, 0.07, 0.13], col: COLOR.rust, taper: 0.9 });
  }

  /* Three barrels, staggered rather than splayed — an axis-"z" cylinder takes no
     yaw, and staggering reads as a fan anyway: the middle barrel sits higher and
     reaches furthest, so the silhouette steps instead of lining up like a fence. */
  const barrels: [number, number, number][] = [
    [-0.23, -0.03, 0.34],
    [0, 0.08, 0.44],
    [0.23, -0.03, 0.34],
  ];
  for (const [bx, by, len] of barrels) {
    cyl(s, {
      at: [bx, by, -len / 2],
      rBottom: 0.062,
      rTop: 0.05,
      height: len,
      segments: 7,
      col: COLOR.rust,
      axis: "z",
      caps: "both",
    });
    // A pale ring at the muzzle: powder scour, and it reads as a hole at distance.
    cyl(s, {
      at: [bx, by, -len - 0.02],
      rBottom: 0.07,
      rTop: 0.07,
      height: 0.04,
      segments: 7,
      col: COLOR.ash,
      axis: "z",
      caps: "both",
    });
  }

  // Powder flask hanging off the plate — the one soft shape, for contrast.
  cyl(s, {
    at: [0.3, -0.16, -0.06],
    rBottom: 0.07,
    rTop: 0.05,
    height: 0.16,
    segments: 6,
    col: COLOR.bone,
  });
}

/**
 * BARBED COIL — a loop of wire strung between two brackets.
 *
 * Authored as discrete links rather than a smooth torus on purpose: §17.1 wants
 * faceted and deliberate, and a chunky chain of barbs reads at 64px where a thin
 * ring would vanish. The barbs alternate lean so the silhouette is spiky from any
 * angle rather than only in profile.
 */
function coil(s: Sink): void {
  for (const bx of [-0.34, 0.34]) {
    box(s, { at: [bx, 0, 0.02], size: [0.09, 0.4, 0.14], col: COLOR.rust });
    // A bolt head, so the bracket has a reason to be that thick.
    box(s, { at: [bx, 0.12, -0.05], size: [0.06, 0.06, 0.05], col: COLOR.ash });
  }

  const links = 9;
  for (let i = 0; i < links; i++) {
    const t = i / (links - 1);
    const lx = -0.3 + t * 0.6;
    // A shallow sag: wire strung between two points is never straight.
    const ly = -0.06 + Math.sin(t * Math.PI) * -0.05;
    box(s, {
      at: [lx, ly, -0.07],
      size: [0.075, 0.05, 0.05],
      col: COLOR.rust,
      yaw: i % 2 === 0 ? 0.3 : -0.3,
    });
    // Two barbs per link, thrown opposite ways.
    for (const dir of [1, -1]) {
      spike(s, {
        at: [lx, ly, -0.07],
        base: [0.045, 0.045],
        height: 0.11,
        col: COLOR.ash,
        lean: dir * 1.15,
        yaw: dir > 0 ? 0.5 : -0.5,
      });
    }
  }
}

/**
 * HEX LANTERN — a gibbet lantern on a bracket arm, burning green.
 *
 * The only trap in the catalog that emits saturated hex-cyan, and it has earned
 * it: §3 reserves that colour for the arcane, and this is the arcane trap you see
 * from across the map. Everything else here is dull iron so the core is the only
 * bright thing in the model.
 */
function lantern(s: Sink): void {
  // Wall plate and the arm reaching out over the lane.
  box(s, { at: [0, 0.1, 0.03], size: [0.16, 0.3, 0.1], col: COLOR.rust });
  box(s, { at: [0, 0.22, -0.16], size: [0.06, 0.05, 0.36], col: COLOR.rust, taper: 0.8 });
  // A hook, then two chain links down to the cap.
  box(s, { at: [0, 0.17, -0.31], size: [0.03, 0.06, 0.03], col: COLOR.ash });
  box(s, { at: [0, 0.11, -0.31], size: [0.035, 0.05, 0.035], col: COLOR.ash });

  // The cap.
  cyl(s, {
    at: [0, 0.02, -0.31],
    rBottom: 0.14,
    rTop: 0.05,
    height: 0.09,
    segments: 6,
    col: COLOR.rust,
  });
  // Four corner posts, so the glass reads as glazing rather than a solid drum.
  for (const [px, pz] of [[-0.08, -0.23], [0.08, -0.23], [-0.08, -0.39], [0.08, -0.39]]) {
    box(s, { at: [px, -0.1, pz], size: [0.028, 0.24, 0.028], col: COLOR.ash });
  }
  // The core. Undersized against the frame — a small intense source looks hotter
  // than a large dim one, and it keeps the frame legible.
  cyl(s, {
    at: [0, -0.1, -0.31],
    rBottom: 0.075,
    rTop: 0.075,
    height: 0.2,
    segments: 6,
    col: COLOR.hex,
  });
  spike(s, { at: [0, 0.02, -0.31], base: [0.08, 0.08], height: 0.09, col: COLOR.hex });
  // Base pan.
  cyl(s, {
    at: [0, -0.24, -0.31],
    rBottom: 0.1,
    rTop: 0.12,
    height: 0.05,
    segments: 6,
    col: COLOR.rust,
  });
}

/**
 * BUZZARD ROOST — a beam with two birds on it, and what they have been eating.
 *
 * Hangs *downward* from the mount, since a ceiling anchor is above the player's
 * head: the beam is at the origin and everything else is negative Y. The birds are
 * the read, and they are deliberately hunched and ugly — this is the trap that
 * kills the thing circling you, and it should look like it wants to.
 */
function roost(s: Sink): void {
  // The beam, and the strap holding it to the rock.
  box(s, { at: [0, -0.04, 0], size: [1, 0.13, 0.24], col: COLOR.timberDark });
  box(s, { at: [0, 0.02, 0], size: [0.14, 0.16, 0.3], col: COLOR.rust });

  for (const bx of [-0.28, 0.28]) {
    const face = bx < 0 ? 1 : -1;
    // Legs.
    for (const lz of [-0.05, 0.05]) {
      box(s, { at: [bx, -0.19, lz], size: [0.032, 0.14, 0.032], col: COLOR.sunbleach });
    }
    // Body: a squat barrel across Z, so it reads as a perched bird in profile.
    cyl(s, {
      at: [bx, -0.32, 0],
      rBottom: 0.13,
      rTop: 0.1,
      height: 0.3,
      segments: 7,
      col: COLOR.void,
      axis: "z",
      caps: "both",
    });
    // Folded wings, one either side.
    for (const wx of [-0.06, 0.06]) {
      box(s, {
        at: [bx + wx, -0.32, 0.02],
        size: [0.05, 0.2, 0.26],
        col: COLOR.ash,
        taper: 0.6,
      });
    }
    // The bald head and neck — the buzzard tell.
    cyl(s, {
      at: [bx, -0.3, -0.16],
      rBottom: 0.055,
      rTop: 0.05,
      height: 0.12,
      segments: 6,
      col: COLOR.oxblood,
    });
    blob(s, {
      at: [bx, -0.22, -0.16],
      rMin: 0.055,
      rMax: 0.075,
      segments: 7,
      height: 0.09,
      col: COLOR.oxblood,
      seed: bx < 0 ? 3 : 8,
    });
    // Beak, thrown outward so the two birds face away from each other.
    spike(s, {
      at: [bx, -0.19, -0.2],
      base: [0.05, 0.05],
      height: 0.11,
      col: COLOR.sunbleach,
      lean: 1.4,
      yaw: face * 0.5,
    });
  }

  // Leavings: a rib and a long bone wired to the beam. Cheap, and it tells you
  // what this thing is for before it has ever fired.
  box(s, { at: [0, -0.14, 0.02], size: [0.04, 0.22, 0.04], col: COLOR.bone, lean: 0.25 });
  box(s, { at: [0.06, -0.2, -0.04], size: [0.03, 0.16, 0.03], col: COLOR.bone, lean: -0.4 });
}


/**
 * DEAD MAN'S BRACE — a flat square that fills its tile exactly.
 *
 * Authored at 1.0 x 1.0, which is one whole build tile before `TRAP_MODEL_SCALE`, so
 * a run of them reads as a continuous line rather than a row of separate objects with
 * gaps you would instinctively try to walk through.
 *
 * Flat, and deliberately so. It is the trap the player uses to *reason about paths*,
 * so what matters is seeing the shape of the wall you are drawing from across the map
 * and over the top of your own build — a chest-high barricade hides exactly the
 * ground you are trying to plan on. It also tells the truth about the rule: you shoot
 * straight over it because it stops bodies and nothing else.
 *
 * The collision volume is 2m tall regardless (sim/level.ts `bakeBlockades`) — it has
 * to clear `bakeBlocked`'s 1m threshold or the flow field would route straight
 * through. The plate is the read; the volume is the rule.
 */
function brace(s: Sink): void {
  const T = 0.5; // half a tile

  // The deck: one square slab, edge to edge.
  box(s, { at: [0, 0, 0], size: [T * 2, 0.1, T * 2], col: COLOR.timberDark, taper: 1 });

  // Four planks laid across it, gapped, so the square has a grain and a direction.
  for (const z of [-0.3, -0.1, 0.1, 0.3]) {
    box(s, { at: [0, 0.1, z], size: [T * 1.94, 0.05, 0.17], col: COLOR.timber, taper: 1 });
  }

  // A rust kerb around the rim: this is what makes it read as a filled TILE rather
  // than a rug, and what makes two of them abutting look like one wall.
  for (const [dx, dz, sx, sz] of [
    [0, -T + 0.04, T * 2, 0.08],
    [0, T - 0.04, T * 2, 0.08],
    [-T + 0.04, 0, 0.08, T * 2],
    [T - 0.04, 0, 0.08, T * 2],
  ]) {
    box(s, { at: [dx, 0.1, dz], size: [sx, 0.09, sz], col: COLOR.rust, taper: 1 });
  }

  // Four bolt heads, one per corner. Cheap, and they sell "fixed down".
  for (const dx of [-T + 0.13, T - 0.13]) {
    for (const dz of [-T + 0.13, T - 0.13]) {
      box(s, { at: [dx, 0.19, dz], size: [0.1, 0.05, 0.1], col: COLOR.ash, taper: 0.7 });
    }
  }
}

/* ── assembly ────────────────────────────────────────────────────────────── */

/**
 * Keyed by `TrapDef.key`. A trap without an entry falls back to the sigil's
 * flat-chalk treatment rather than throwing, so adding a `TrapDef` never breaks
 * the renderer before its model exists.
 */
export const TRAP_MODELS: Record<string, (s: Sink) => void> = {
  jaws,
  tar,
  vent,
  plate,
  sigil,
  ports,
  coil,
  lantern,
  roost,
  brace,
};

/**
 * §17.7 gives traps 400–1,200 triangles — "generous, players stare at these".
 * Asserted in the geometry test so a model can't quietly balloon.
 */
export const TRAP_TRI_BUDGET = 1200;

/**
 * Models are authored at **1m-tile scale** and scaled to the live build tile.
 *
 * One constant governs trap size, tile size, the ghost and the grid overlay together
 * (`BUILD_TILE`), which is the only way they stay in agreement — a trap authored to
 * one tile size and a grid drawn at another is a mismatch you feel on every
 * placement without being able to name it.
 *
 * Scaling the built geometry rather than every literal keeps the models readable:
 * `0.62` is a hand-sized part at any tile size. Uniform scale leaves normals and the
 * baked vertex colours untouched.
 */
export const TRAP_MODEL_SCALE = BUILD_TILE;

/**
 * How far a trap's mesh reaches BEHIND its origin, in metres.
 *
 * Wall models are authored with -Z outward, so their positive-Z extent is the part
 * that would end up inside the masonry. The renderer pushes the mesh out by exactly
 * this much (scene.ts), which is why re-modelling a wall trap needs no other edit —
 * measured off the geometry rather than written down beside it.
 */
const BACK_DEPTH = new Map<string, number>();

export function trapBackDepth(key: string): number {
  const hit = BACK_DEPTH.get(key);
  if (hit !== undefined) return hit;
  const pos = buildTrapGeometry(key).getAttribute("position");
  let max = 0;
  for (let v = 0; v < pos.count; v++) {
    const z = pos.getZ(v);
    if (z > max) max = z;
  }
  BACK_DEPTH.set(key, max);
  return max;
}

export function buildTrapGeometry(key: string): BufferGeometry {
  // PROP_SHADE is buildGeometry's default and is the right profile for traps:
  // knee-high, never rotates, so the baked sun can be strong (see build.ts).
  const g = buildGeometry(TRAP_MODELS[key] ?? sigil);
  g.scale(TRAP_MODEL_SCALE, TRAP_MODEL_SCALE, TRAP_MODEL_SCALE);
  return g;
}
