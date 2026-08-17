/*
 * render/models/enemies.ts — the roster as geometry.
 *
 * §1 pillar 2 (legible chaos) is the entire brief: at forty bodies on screen the
 * player identifies an enemy by **silhouette and one dominant colour**, never by
 * detail. A Dustkin, an Ironjaw and a Buzzard that are the same capsule at three
 * scales is not a roster, it's a difficulty slider — and the §8 invalidation
 * table only works if the player can *see* which argument is walking at them.
 *
 * So each archetype is built around one shape idea, chosen to survive being a
 * black shape at 64px (§17.10):
 *
 *   Dustkin  — a **lopsided, hunched** figure with a pale skull and hanging rags.
 *              Human enough to be Hollow Creek's own dead (§3), wrong enough to
 *              read as tuned. Asymmetry is the tell: one shoulder high, one arm
 *              long.
 *   Ironjaw  — a **wide low block**. Pauldrons past the hips, helmet sunk between
 *              them, and the jaw guard the name promises jutting forward. It
 *              should look like it does not care what you throw at it, because
 *              mechanically it doesn't (§8: invalidates chip damage).
 *   Buzzard  — a **horizontal cross**. Everything else in the game is vertical,
 *              so a wide flat body with swept wings is unmistakable even in
 *              silhouette against a night sky.
 *   Coyote   — a **low dart**. The only horizontal shape ON the ground: four
 *              legs, head thrust ahead of the chest, tail flagged behind. Speed,
 *              drawn as a body.
 *   Preacher — a **perfect column**. The Dustkin's exact opposite: symmetric,
 *              upright, still — a hat brim over an unbroken fall of coat. In a
 *              crowd of hunched wrong-jointed bodies, composure IS the tell.
 *   Colossus — a **pale mountain**. The one giant, and the one *bright* body —
 *              built of bone in a roster of soot silhouettes, so mass reads as
 *              value as well as size. Head sunk to nothing between shoulders.
 *
 * The full silhouette contract — one shape idea, one dominant colour, one
 * saturated note per archetype — lives in ENEMIES.md §3.
 *
 * Everything is authored **base at y=0** and scaled off its `EnemyDef`, so the
 * model follows the tuning rather than drifting from it, and `scene.ts` can place
 * an instance at the sim's own feet position with no per-archetype offset.
 *
 * Facing is **-Z**, matching the yaw `scene.ts` derives from velocity.
 *
 * Heads are baked in rather than instanced separately. The old pool drew a
 * sphere per body as a second `InstancedMesh` purely because a capsule has no
 * head; with authored models that is a wasted draw call, a wasted matrix upload
 * and a second place for the two halves to disagree about where the neck is.
 */

import type { BufferGeometry } from "three";
import type { EnemyDef } from "../../sim/enemies.ts";
import { COLOR } from "../palette.ts";
import { CHAR_SHADE, box, buildGeometry, cyl, spike, type Sink } from "./build.ts";

/**
 * THE DUSTKIN — the horde, and the teacher.
 *
 * Built from fractions of the def's own height so it tracks tuning. The hunch is
 * a negative `lean` (tips the top toward -Z, which is forward), and it is what
 * stops this reading as a scarecrow.
 */
function dustkin(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  const rag = COLOR.dust;
  const cloth = COLOR.timberDark;

  // Legs: thin, and set at slightly different angles. A pair of matched columns
  // reads as furniture.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.34, 0, side * 0.02],
      size: [r * 0.36, h * 0.44, r * 0.4],
      col: cloth,
      taper: 1.15,
      lean: side * 0.05,
    });
  }

  // Torso, hunched forward and set slightly off-centre.
  box(s, {
    at: [r * 0.04, h * 0.4, 0.02],
    size: [r * 1.05, h * 0.34, r * 0.78],
    col: rag,
    taper: 1.06,
    lean: -0.16,
  });

  // Hanging rags at the hem. Taper >1 makes each one wide at the top and narrow
  // at the bottom — a fringe of points rather than a row of pegs.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    box(s, {
      at: [Math.cos(a) * r * 0.44, h * 0.3, Math.sin(a) * r * 0.42],
      size: [r * 0.3, h * 0.13, r * 0.16],
      col: cloth,
      taper: 0.35,
      yaw: -a,
    });
  }

  // Shoulders, uneven by 4cm — the whole "wrong-jointed" read in one number.
  box(s, {
    at: [0, h * 0.72, 0.01],
    size: [r * 1.5, h * 0.06, r * 0.62],
    col: rag,
    taper: 0.9,
    yaw: 0.07,
  });

  // Arms, hanging, and deliberately mismatched in length.
  const armLen = [0.36, 0.44];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    box(s, {
      at: [side * r * 0.78, h * (0.72 - armLen[i]), 0],
      size: [r * 0.28, h * armLen[i], r * 0.3],
      col: rag,
      taper: 1.2,
      lean: side * 0.08,
    });
    // Hand: a pale knuckle at the end of each arm, so the reach reads.
    box(s, {
      at: [side * r * 0.8, h * (0.7 - armLen[i]), -0.01],
      size: [r * 0.24, h * 0.05, r * 0.24],
      col: COLOR.bone,
      taper: 0.85,
    });
  }

  // The skull. `bone` on a `dust` body is the value separation that makes a
  // Dustkin readable in a crowd, and it puts the brightest note at the top of
  // the silhouette where the eye lands.
  cyl(s, {
    at: [r * 0.06, h * 0.76, -0.03],
    rBottom: r * 0.3,
    rTop: r * 0.34,
    height: h * 0.13,
    segments: 8,
    col: COLOR.bone,
    squash: 0.9,
  });
  // Jaw, hanging open. The dead don't close their mouths.
  box(s, {
    at: [r * 0.06, h * 0.79, -r * 0.26],
    size: [r * 0.34, h * 0.06, r * 0.22],
    col: COLOR.bone,
    taper: 0.8,
    lean: -0.35,
  });
  // Eye sockets: two `void` pits. At 3cm they are exactly at the §17.1 detail
  // floor, and they are the difference between a skull and an egg.
  for (const side of [-1, 1]) {
    box(s, {
      at: [r * 0.06 + side * r * 0.15, h * 0.84, -r * 0.28],
      size: [r * 0.16, h * 0.035, r * 0.08],
      col: COLOR.void,
      taper: 0.9,
    });
  }
  // A dried oxblood stain down the front — §3's "dried oxblood" faction colour,
  // used once so it stays a note rather than a scheme.
  box(s, {
    at: [r * 0.02, h * 0.52, -r * 0.4],
    size: [r * 0.4, h * 0.16, r * 0.1],
    col: COLOR.oxblood,
    taper: 0.7,
  });

  // The noose. The game is named for the gallows and its dead should say so:
  // a rope collar still knotted at the neck, with the cut end swinging down the
  // chest. It also fixes a real read problem — the skull used to sit straight
  // on the shoulder slab, and the rope gives the neck a visible joint.
  cyl(s, {
    at: [r * 0.06, h * 0.735, -0.03],
    rBottom: r * 0.38,
    rTop: r * 0.34,
    height: h * 0.035,
    segments: 7,
    col: COLOR.timber,
    caps: "none",
    phase: 0.3,
  });
  // The hanging tail of the rope, in two kinked segments — a straight rope
  // reads as a necktie.
  box(s, {
    at: [r * 0.18, h * 0.62, -r * 0.34],
    size: [r * 0.11, h * 0.12, r * 0.11],
    col: COLOR.timber,
    taper: 0.85,
    lean: -0.18,
  });
  box(s, {
    at: [r * 0.24, h * 0.52, -r * 0.36],
    size: [r * 0.1, h * 0.11, r * 0.1],
    col: COLOR.timber,
    taper: 0.8,
    lean: 0.12,
    yaw: 0.3,
  });
  // Frayed end, pointing down: a spike leaned right over (§17.1 — exaggerate
  // the functional part, and the function here is "cut down in a hurry").
  spike(s, {
    at: [r * 0.27, h * 0.47, -r * 0.37],
    base: [r * 0.14, r * 0.14],
    height: h * 0.07,
    col: COLOR.dust,
    lean: 2.6,
  });
}

/**
 * THE IRONJAW — armoured mass.
 *
 * Wide, low, and front-heavy. Everything about the proportion says "hits under
 * 20 clang off me", which is precisely what it does (§8). The pauldrons are
 * wider than the stance on purpose: §17.1 exaggerates the functional part, and
 * here the function *is* the armour.
 */
function ironjaw(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  const plate = COLOR.grave;
  const rust = COLOR.rust;

  // Short, wide-set legs. A heavy thing stands with its feet apart.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.46, 0, 0],
      size: [r * 0.5, h * 0.32, r * 0.55],
      col: COLOR.ash,
      taper: 1.1,
    });
    // Boot plates.
    box(s, {
      at: [side * r * 0.46, 0, -r * 0.08],
      size: [r * 0.58, h * 0.07, r * 0.7],
      col: plate,
      taper: 0.94,
    });
  }

  // Torso: a single wide slab of plate, barely tapered. Squat, per §8's read.
  box(s, {
    at: [0, h * 0.3, 0],
    size: [r * 1.7, h * 0.36, r * 1.15],
    col: plate,
    taper: 1.04,
  });
  // A skirt of tassets below it, so the waist isn't a straight cut.
  box(s, { at: [0, h * 0.26, 0], size: [r * 1.5, h * 0.08, r * 1.05], col: rust, taper: 1.1 });

  // Rivets: oversized, in a row across the chest. §17.1 — bolts are 2× size.
  for (let i = 0; i < 5; i++) {
    const x = (i / 4 - 0.5) * r * 1.2;
    cyl(s, {
      at: [x, h * 0.6, -r * 0.56],
      rBottom: r * 0.09,
      rTop: r * 0.07,
      height: r * 0.09,
      segments: 6,
      col: rust,
      axis: "z",
    });
  }

  // Pauldrons — the widest thing on the model, and the silhouette.
  //
  // `rust`, not plate. On the shelf the whole unit came out as one near-black
  // mass with no internal read at all: §3 gives the Company "rust, soot black,
  // brass", and building it from two dark greys spent the faction's one warm
  // colour on nothing. Rust on the widest, highest parts is what makes an
  // Ironjaw legible as armour rather than as a shadow.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 1.0, h * 0.62, 0],
      size: [r * 0.85, h * 0.16, r * 0.95],
      col: rust,
      taper: 0.8,
    });
    // Arms, stubby, hanging inside the pauldron line.
    box(s, {
      at: [side * r * 1.05, h * 0.34, 0],
      size: [r * 0.42, h * 0.28, r * 0.45],
      col: COLOR.ash,
      taper: 1.15,
    });
    // Fists.
    box(s, {
      at: [side * r * 1.05, h * 0.29, -r * 0.05],
      size: [r * 0.46, h * 0.09, r * 0.5],
      col: rust,
      taper: 0.9,
    });
  }

  // Helmet, sunk between the pauldrons — no neck, which is half the read.
  cyl(s, {
    at: [0, h * 0.66, 0],
    rBottom: r * 0.5,
    rTop: r * 0.44,
    height: h * 0.2,
    segments: 8,
    col: plate,
  });
  // Visor slit: one `void` band. The only opening in the whole silhouette.
  box(s, {
    at: [0, h * 0.76, -r * 0.42],
    size: [r * 0.7, h * 0.035, r * 0.12],
    col: COLOR.void,
    taper: 0.95,
  });
  // The jaw guard the name promises: a heavy rust wedge jutting forward.
  box(s, {
    at: [0, h * 0.68, -r * 0.52],
    size: [r * 0.62, h * 0.08, r * 0.34],
    col: rust,
    taper: 0.85,
    lean: -0.5,
  });
  // Crest, so the helmet has a top edge instead of a dome.
  box(s, { at: [0, h * 0.85, 0], size: [r * 0.16, h * 0.05, r * 0.8], col: rust, taper: 0.7 });

  /*
   * Brass fittings. §3 gives the Company "rust, soot black, brass" and the
   * first build only ever spent the first two — which left the Ironjaw as the
   * one silhouette on the roster with no bright note at all. `lamp` is the
   * closest swatch to brass, and it is spent the way a foundry would spend it:
   * on the fittings, never on the plate.
   */
  // Jaw bolts, one at each corner of the guard — the working man's jewellery.
  for (const side of [-1, 1]) {
    cyl(s, {
      at: [side * r * 0.24, h * 0.7, -r * 0.62],
      rBottom: r * 0.07,
      rTop: r * 0.055,
      height: r * 0.09,
      segments: 6,
      col: COLOR.lamp,
      axis: "z",
    });
  }
  // A brass boss where the crest meets the brow, closing the helmet's front edge.
  box(s, {
    at: [0, h * 0.84, -r * 0.34],
    size: [r * 0.15, h * 0.045, r * 0.15],
    col: COLOR.lamp,
    taper: 0.75,
  });
  // Pauldron studs on the outer faces, so the widest points of the silhouette
  // carry a highlight the moonlight can find.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 1.3, h * 0.65, 0],
      size: [r * 0.14, h * 0.05, r * 0.32],
      col: COLOR.lamp,
      taper: 0.7,
    });
  }
}

/**
 * THE BUZZARD — the horizontal one.
 *
 * The wings are NOT in this geometry: they are their own instanced pools so they
 * can flap (see `buildWingGeometry`). A flier that holds its wings rigid reads as
 * a prop on a stick, and §14.6's juice pass is not the place to discover that the
 * mesh made flapping impossible.
 */
function buzzard(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  // `grave` rather than `ash`: a flier is usually seen against the sky, which is
  // the lightest thing in the frame, but it is *also* seen against the ground on
  // approach — and at `ash` it disappeared into it.
  const feather = COLOR.grave;

  // Body: a fat tapered spindle along Z, deepest at the chest.
  //
  // The vertical layout is pushed up into the top two thirds of `h` on purpose.
  // A flier's `height` is its whole vertical extent to the sim, and the tucked
  // feet hang below the body — so a body centred at half height leaves the model
  // a quarter shorter than the def says it is, which is the kind of quiet scale
  // drift §17.7 exists to prevent (and which the geometry test now catches).
  box(s, {
    at: [0, h * 0.4, 0.05],
    size: [r * 0.95, h * 0.44, r * 2.1],
    col: feather,
    taper: 0.78,
  });
  // Belly, a shade darker, so the underside reads from below — which is the
  // angle the player usually has on a flier.
  box(s, {
    at: [0, h * 0.32, 0.02],
    size: [r * 0.8, h * 0.12, r * 1.7],
    col: COLOR.timberDark,
    taper: 1.05,
  });

  // Neck and head, thrust forward.
  box(s, {
    at: [0, h * 0.6, -r * 0.75],
    size: [r * 0.42, h * 0.22, r * 0.5],
    col: feather,
    taper: 0.85,
    lean: -0.6,
  });
  // The ruff: a band of oxblood where the neck meets the body. One saturated
  // note, and it is the only warm colour on the model.
  cyl(s, {
    at: [0, h * 0.58, -r * 0.55],
    rBottom: r * 0.34,
    rTop: r * 0.3,
    height: h * 0.09,
    segments: 7,
    col: COLOR.oxblood,
    caps: "none",
  });
  // Skull, then the hooked beak — a `bone` spike leaning down and forward.
  cyl(s, {
    at: [0, h * 0.7, -r * 1.05],
    rBottom: r * 0.26,
    rTop: r * 0.22,
    height: h * 0.16,
    segments: 7,
    col: COLOR.grave,
  });
  spike(s, {
    at: [0, h * 0.72, -r * 1.3],
    base: [r * 0.28, r * 0.5],
    height: h * 0.26,
    col: COLOR.bone,
    lean: -1.35,
  });

  // Tail: three flat feathers fanning back. Cheap, and it fixes the "which end
  // is the front" problem that every symmetrical flier has.
  for (let i = -1; i <= 1; i++) {
    box(s, {
      at: [i * r * 0.3, h * 0.42, r * 1.15],
      size: [r * 0.34, h * 0.05, r * 1.0],
      col: COLOR.grave,
      taper: 0.75,
      yaw: i * 0.22,
    });
  }

  // Tucked feet, so it isn't a torpedo. These are what occupy the bottom of the
  // model's height, and why the body sits high.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.3, h * 0.06, r * 0.15],
      size: [r * 0.18, h * 0.3, r * 0.3],
      col: COLOR.rust,
      taper: 0.6,
      lean: 0.7,
    });
    // Talons: one `bone` hook per foot, curled down and forward. A lean past
    // π/2 points the spike at the ground — which is where a buzzard's talons
    // point at everything below it, and this bird is always above you.
    spike(s, {
      at: [side * r * 0.3, h * 0.055, r * 0.02],
      base: [r * 0.16, r * 0.2],
      height: h * 0.09,
      col: COLOR.bone,
      lean: 1.9,
    });
  }

  // An exposed ridge of spine down the back — this is carrion that got back up,
  // and from the player's usual low angle the back is the face. `dust` rather
  // than `bone`: vertebrae under weathered feathers, not a fresh wound.
  for (let i = 0; i < 4; i++) {
    box(s, {
      at: [0, h * (0.8 - i * 0.03), r * (-0.25 + i * 0.3)],
      size: [r * 0.14, h * 0.05, r * 0.2],
      col: COLOR.dust,
      taper: 0.6,
    });
  }
}

/**
 * THE COYOTE — the low dart.
 *
 * The roster's only ground-hugging horizontal, so at 64px it cannot be confused
 * with anything: walkers are vertical, the Buzzard is horizontal *in the sky*,
 * and this is horizontal AT YOUR ANKLES. Head ahead of the chest, tail flagged
 * behind — the whole body is an arrow pointing where it's going, which for a
 * unit whose argument is speed (§8) is the honest silhouette.
 *
 * Half its face is bare skull. §3's dead don't heal; a coyote that died in the
 * dust and got back up should look like the desert had already started on it.
 */
function coyote(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  const fur = COLOR.dust;
  const shadow = COLOR.timberDark;

  // Legs first: four, thin, and splayed mid-stride rather than table-square —
  // a quadruped with matched columns under each corner reads as a bench.
  const legs: Array<[number, number, number]> = [
    // [x side, z position, lean]
    [-1, -r * 0.55, -0.22],
    [1, -r * 0.5, 0.1],
    [-1, r * 0.6, 0.18],
    [1, r * 0.66, -0.12],
  ];
  for (const [side, z, lean] of legs) {
    box(s, {
      at: [side * r * 0.3, 0, z],
      size: [r * 0.16, h * 0.48, r * 0.2],
      col: shadow,
      taper: 1.3,
      lean,
    });
  }

  // The body: chest-heavy and pinched at the waist, running along Z. Two boxes
  // rather than one — the step between ribcage and haunch is what makes it an
  // animal instead of a draught excluder.
  box(s, {
    at: [0, h * 0.4, -r * 0.35],
    size: [r * 0.72, h * 0.34, r * 1.05],
    col: fur,
    taper: 0.72,
    lean: -0.1,
  });
  box(s, {
    at: [0, h * 0.38, r * 0.55],
    size: [r * 0.62, h * 0.3, r * 0.85],
    col: fur,
    taper: 0.68,
    lean: 0.28,
  });
  // A dark saddle across the shoulders, so the back has a value break at speed.
  box(s, {
    at: [0, h * 0.66, -r * 0.3],
    size: [r * 0.5, h * 0.07, r * 0.8],
    col: shadow,
    taper: 0.7,
  });

  // Ribs, showing through on both flanks: three bone slats a hair proud of the
  // fur. The dead-animal read in the cheapest possible geometry.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(s, {
        at: [side * r * 0.34, h * 0.38, -r * (0.55 - i * 0.22)],
        size: [r * 0.06, h * 0.22, r * 0.09],
        col: COLOR.bone,
        taper: 0.8,
        lean: -0.12,
      });
    }
  }

  // Neck, dropped low and thrust at the target — a coyote points like a drawn
  // bow, it does not stand up to look at you.
  box(s, {
    at: [0, h * 0.5, -r * 0.95],
    size: [r * 0.34, h * 0.22, r * 0.5],
    col: fur,
    taper: 0.85,
    lean: -0.9,
  });

  // The head: fur cranium, bare `bone` muzzle — the front half of the face is
  // already skull. Brightest thing on the model, right at the tip of the arrow.
  box(s, {
    at: [0, h * 0.56, -r * 1.28],
    size: [r * 0.36, h * 0.18, r * 0.42],
    col: fur,
    taper: 0.8,
    lean: -0.25,
  });
  box(s, {
    at: [0, h * 0.56, -r * 1.62],
    size: [r * 0.24, h * 0.12, r * 0.4],
    col: COLOR.bone,
    taper: 0.75,
    lean: -0.15,
  });
  // Jaw, hanging a touch open — same family tell as the Dustkin's.
  box(s, {
    at: [0, h * 0.52, -r * 1.55],
    size: [r * 0.18, h * 0.045, r * 0.34],
    col: COLOR.bone,
    taper: 0.7,
    lean: -0.55,
  });
  // Eye pits, `void`, on the fur/bone seam.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.12, h * 0.6, -r * 1.44],
      size: [r * 0.09, h * 0.035, r * 0.09],
      col: COLOR.void,
      taper: 0.9,
    });
  }
  // Ears: two pricked spikes. With the muzzle they make the three-point head
  // silhouette that says "canid" at any distance.
  for (const side of [-1, 1]) {
    spike(s, {
      at: [side * r * 0.14, h * 0.68, -r * 1.22],
      base: [r * 0.14, r * 0.18],
      height: h * 0.14,
      col: shadow,
      lean: 0.2,
    });
  }

  // Tail: flagged up and back, the counterweight to the head. `shadow` with a
  // `bone` tip — mange down to the bone at the very end.
  box(s, {
    at: [0, h * 0.48, r * 1.0],
    size: [r * 0.16, h * 0.32, r * 0.2],
    col: shadow,
    taper: 0.7,
    lean: 0.85,
  });
  spike(s, {
    at: [0, h * 0.72, r * 1.22],
    base: [r * 0.12, r * 0.12],
    height: h * 0.12,
    col: COLOR.bone,
    lean: 0.7,
  });
}

/**
 * THE HOLLOW PREACHER — the column.
 *
 * Everything else the Bell tunes shambles; the Preacher *processes*. It is the
 * only perfectly symmetric, perfectly upright body on the roster, and that
 * composure is the silhouette: a flat hat brim over an unbroken fall of coat,
 * hands clasped on a book. §8 makes it a priority target for the gun, so the
 * player has to be able to pick it out of a crowd instantly — and in a mob of
 * hunched wrong-jointed Dustkin, the one figure standing straight is the
 * loudest thing on the screen.
 *
 * Its saturated note is `hex`, and only its eyes and the book carry it — the
 * same swatch the heal-pulse FX uses, so the glow in the crowd and the glow on
 * the body join up into "that one is doing it".
 */
function preacher(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  const coat = COLOR.ash;

  // The coat: one faceted fall from collar to hem, flared at the bottom like a
  // bell — it should look as if the body underneath has long since stopped
  // mattering. Low segment count so the facets catch the ramp.
  cyl(s, {
    at: [0, 0, 0],
    rBottom: r * 0.68,
    rTop: r * 0.44,
    height: h * 0.6,
    segments: 8,
    col: coat,
    caps: "top",
    phase: 0.4,
  });
  // Torso above the coat's waist, narrower — the column tapers all the way up.
  box(s, {
    at: [0, h * 0.58, 0],
    size: [r * 0.78, h * 0.16, r * 0.6],
    col: coat,
    taper: 0.88,
  });

  // A cape across the shoulders, squared off. The Preacher's one wide point —
  // still narrower than any Dustkin shoulder, because the column must hold.
  box(s, {
    at: [0, h * 0.72, 0.02],
    size: [r * 1.05, h * 0.07, r * 0.7],
    col: COLOR.grave,
    taper: 0.8,
  });

  // Arms: bent at the elbow, meeting in front. Authored as two segments per
  // side — hanging straight would break the "clasped in prayer" read that
  // makes it a preacher rather than a tall Dustkin.
  for (const side of [-1, 1]) {
    // Upper arm, close to the body.
    box(s, {
      at: [side * r * 0.5, h * 0.55, 0],
      size: [r * 0.2, h * 0.17, r * 0.24],
      col: coat,
      taper: 1.1,
      lean: side * 0.04,
    });
    // Forearm, swung forward and inward to the book.
    box(s, {
      at: [side * r * 0.42, h * 0.53, -r * 0.3],
      size: [r * 0.18, h * 0.06, r * 0.4],
      col: coat,
      taper: 0.9,
      yaw: side * 0.5,
      lean: -1.35,
    });
    // Hand on the book: bone, and the only flesh it shows below the neck.
    box(s, {
      at: [side * r * 0.16, h * 0.55, -r * 0.52],
      size: [r * 0.16, h * 0.045, r * 0.18],
      col: COLOR.bone,
      taper: 0.85,
    });
  }

  // The book, held out at chest height: `timberDark` boards, a `bone` block of
  // pages, and a `hex` sigil burned into the cover. This is the heal aura's
  // *source* — the eye should land here when the pulse FX draws it in.
  box(s, {
    at: [0, h * 0.51, -r * 0.56],
    size: [r * 0.4, h * 0.045, r * 0.34],
    col: COLOR.timberDark,
    taper: 1,
  });
  box(s, {
    at: [0, h * 0.545, -r * 0.56],
    size: [r * 0.34, h * 0.02, r * 0.28],
    col: COLOR.bone,
    taper: 1,
  });
  box(s, {
    at: [0, h * 0.565, -r * 0.56],
    size: [r * 0.16, h * 0.012, r * 0.14],
    col: COLOR.hex,
    taper: 1,
  });

  // Clerical collar: a `bone` band, the value step that separates the head
  // from the coat — the same job the Dustkin's noose does, in this fiction's
  // other uniform.
  cyl(s, {
    at: [0, h * 0.745, 0],
    rBottom: r * 0.3,
    rTop: r * 0.26,
    height: h * 0.035,
    segments: 8,
    col: COLOR.bone,
    caps: "none",
  });

  // The head: gaunt, long, `dust` — sun-dried skin rather than bare skull; the
  // Preacher died recently enough to still have his convictions.
  cyl(s, {
    at: [0, h * 0.78, 0],
    rBottom: r * 0.24,
    rTop: r * 0.28,
    height: h * 0.12,
    segments: 8,
    col: COLOR.dust,
    squash: 0.85,
  });
  // The eyes burn `hex` under the brim. Two of the six cubic centimetres of
  // saturated colour on the whole model, and the pair the player actually meets.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.11, h * 0.845, -r * 0.24],
      size: [r * 0.09, h * 0.02, r * 0.06],
      col: COLOR.hex,
      taper: 0.9,
    });
  }

  // The hat: crown first, then the widest flat brim in the game. It shades the
  // face to a void from every angle above — which is every angle the player
  // ever has — leaving the hex eyes floating in the dark.
  cyl(s, {
    at: [0, h * 0.895, 0],
    rBottom: r * 0.85,
    rTop: r * 0.82,
    height: h * 0.018,
    segments: 9,
    col: COLOR.void,
    caps: "top",
    squash: 0.92,
  });
  cyl(s, {
    at: [0, h * 0.9, 0],
    rBottom: r * 0.34,
    rTop: r * 0.3,
    height: h * 0.1,
    segments: 8,
    col: COLOR.void,
    caps: "top",
    phase: 0.2,
  });
}

/**
 * THE MARROW COLOSSUS — the pale mountain.
 *
 * Tier 4 needs to read as a different *class* of problem before the health bar
 * says so, and it gets there twice over: the only giant, and the only bright
 * body. The whole roster walks in soot and rust; the Colossus is built of
 * `bone` — a thing assembled from the Orchard's own stock — so in a night-time
 * horde it reads as a pale mass with a crowd of shadows around its knees.
 *
 * The headstone on its back is the lore in one prop: the graves it was made
 * from, still strapped on. It also breaks the symmetric silhouette from
 * behind, which is the angle the player sees most as it walks away toward the
 * Rift.
 */
function colossus(s: Sink, def: EnemyDef): void {
  const h = def.height;
  const r = def.radius;
  const bone = COLOR.bone;
  const shade = COLOR.dust;

  // Legs: two piers, splayed wide. No feet — mass this size doesn't articulate,
  // it re-plants.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.5, 0, 0.02],
      size: [r * 0.52, h * 0.34, r * 0.6],
      col: shade,
      taper: 1.18,
      lean: side * 0.05,
    });
    // A knee cap of bone where the pier meets the pelvis.
    box(s, {
      at: [side * r * 0.52, h * 0.3, -r * 0.16],
      size: [r * 0.3, h * 0.08, r * 0.2],
      col: bone,
      taper: 0.8,
      lean: -0.3,
    });
  }

  // Pelvis: a single bone block, the keystone the piers carry.
  box(s, {
    at: [0, h * 0.32, 0],
    size: [r * 1.15, h * 0.12, r * 0.7],
    col: bone,
    taper: 0.92,
  });

  // The torso core: `void`, and deliberately so. The ribs wrap around a
  // darkness rather than a body — at the silhouette level it makes the chest
  // read as a cage, and the cage is the read.
  box(s, {
    at: [0, h * 0.4, 0],
    size: [r * 1.0, h * 0.34, r * 0.62],
    col: COLOR.void,
    taper: 0.95,
  });

  // The ribcage: four bone hoops, each a shallow chevron of three boxes bent
  // around the core. Biggest at the bottom, closing toward the clavicle.
  for (let i = 0; i < 4; i++) {
    const y = h * (0.42 + i * 0.065);
    const w = 1.28 - i * 0.09;
    // Front span.
    box(s, {
      at: [0, y, -r * 0.38],
      size: [r * w * 0.72, h * 0.045, r * 0.14],
      col: bone,
      taper: 0.9,
    });
    // Side returns, yawed back toward the spine.
    for (const side of [-1, 1]) {
      box(s, {
        at: [side * r * w * 0.44, y + h * 0.004, -r * 0.05],
        size: [r * 0.14, h * 0.045, r * 0.62],
        col: bone,
        taper: 0.9,
        yaw: side * 0.16,
      });
    }
  }

  // Shoulders: the two biggest single masses on any enemy — femur-heads scaled
  // up to boulders, wider than the pelvis, so the whole figure triangulates
  // upward like the hill it walks like.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.95, h * 0.6, 0],
      size: [r * 0.85, h * 0.18, r * 0.8],
      col: bone,
      taper: 0.72,
      lean: side * 0.04,
    });
  }

  // Arms: knuckle-draggers. Upper arm hangs from the shoulder mass; the
  // forearm is *thicker* than the upper arm, gorilla-wise, and ends in a fused
  // bone maul of a fist at knee height.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 1.05, h * 0.38, 0.02],
      size: [r * 0.34, h * 0.24, r * 0.36],
      col: shade,
      taper: 1.12,
      lean: side * 0.06,
    });
    box(s, {
      at: [side * r * 1.08, h * 0.18, 0],
      size: [r * 0.44, h * 0.2, r * 0.46],
      col: bone,
      taper: 1.08,
    });
    // The fist: one knuckle block, low enough to swing without a windup ever
    // being animated — the model itself is mid-drag.
    box(s, {
      at: [side * r * 1.08, h * 0.12, -r * 0.08],
      size: [r * 0.5, h * 0.08, r * 0.52],
      col: bone,
      taper: 0.85,
    });
  }

  // The skull, sunk to nothing between the shoulders — same trick as the
  // Ironjaw's helmet and it means the same thing: nothing here to aim at.
  cyl(s, {
    at: [0, h * 0.66, -r * 0.1],
    rBottom: r * 0.28,
    rTop: r * 0.32,
    height: h * 0.09,
    segments: 8,
    col: bone,
    squash: 0.9,
  });
  // Brow shelf and jaw, both jutting: the head is all front.
  box(s, {
    at: [0, h * 0.72, -r * 0.3],
    size: [r * 0.42, h * 0.035, r * 0.2],
    col: bone,
    taper: 0.8,
    lean: -0.2,
  });
  box(s, {
    at: [0, h * 0.655, -r * 0.28],
    size: [r * 0.3, h * 0.04, r * 0.18],
    col: bone,
    taper: 0.75,
    lean: -0.4,
  });
  // Eye pits. `void` in a `bone` face — the Dustkin's contrast, inverted.
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.13, h * 0.71, -r * 0.3],
      size: [r * 0.11, h * 0.025, r * 0.08],
      col: COLOR.void,
      taper: 0.9,
    });
  }

  // The headstone, strapped across its back at a tired angle. `grave` — the
  // swatch is literally named for it — with two `oxblood` straps over the
  // shoulders, the model's only warm colour and its only asymmetry (the yaw).
  box(s, {
    at: [r * 0.06, h * 0.36, r * 0.5],
    size: [r * 0.72, h * 0.42, r * 0.16],
    col: COLOR.grave,
    taper: 0.9,
    yaw: 0.12,
    lean: 0.18,
  });
  // The stone's shoulder — headstones are round-topped, so cap the slab with a
  // squashed drum to break the box read.
  cyl(s, {
    at: [r * 0.06, h * 0.76, r * 0.56],
    rBottom: r * 0.34,
    rTop: r * 0.28,
    height: h * 0.05,
    segments: 7,
    col: COLOR.grave,
    squash: 0.4,
    phase: 0.12,
  });
  for (const side of [-1, 1]) {
    box(s, {
      at: [side * r * 0.4, h * 0.6, r * 0.2 + side * r * 0.02],
      size: [r * 0.14, h * 0.14, r * 0.5],
      col: COLOR.oxblood,
      taper: 0.9,
      lean: 0.5,
    });
  }
}

/**
 * One wing, hinged at the origin so a `rotation.z` at the shoulder is a flap.
 *
 * `side` is +1 for the +X wing and -1 for the -X wing. They are authored as two
 * separate geometries rather than one mirrored by a negative scale, because a
 * negative scale has determinant -1 and silently inverts every face — the exact
 * failure the winding test exists to catch, and it would be invisible until the
 * wing turned inside out mid-flap.
 */
export function buildWingGeometry(def: EnemyDef, side: 1 | -1): BufferGeometry {
  return buildGeometry(
    (s: Sink) => {
      const h = def.height;
      const r = def.radius;

      // The arm of the wing: a tapered spar running outward.
      box(s, {
        at: [side * r * 0.55, -h * 0.03, 0],
        size: [r * 1.4, h * 0.09, r * 0.62],
        col: COLOR.grave,
        taper: 0.9,
      });

      // Primaries: four flat feathers, swept back and shortening outward. The
      // sweep is what makes a wing read as a wing rather than as a plank.
      //
      // Alternating `grave`/`dust` rather than `ash`/`grave`: the first pass put
      // two near-identical darks next to each other and the wing came out as one
      // flat slab with no feathers in it at all. Adjacent parts need a value
      // step, and a wing is nothing but adjacent parts.
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        box(s, {
          at: [side * r * (0.55 + t * 1.0), -h * 0.02, r * (0.1 + t * 0.42)],
          size: [r * 0.62, h * 0.055, r * (1.15 - t * 0.35)],
          col: i % 2 === 0 ? COLOR.grave : COLOR.dust,
          taper: 0.82,
          yaw: side * (0.12 + t * 0.3),
        });
      }

      // Shoulder covert, hiding the join with the body.
      box(s, {
        at: [side * r * 0.16, 0, 0.02],
        size: [r * 0.6, h * 0.13, r * 0.75],
        col: COLOR.ash,
        taper: 0.85,
      });
    },
    CHAR_SHADE,
    // The hinge sits about a third of the way up the body; without this the
    // whole wing would sample the darkest end of the contact gradient.
    def.height * 0.42,
  );
}

/** Where each flier's wings hinge, in the body's own local space. */
export function wingHinge(def: EnemyDef): { y: number; z: number } {
  return { y: def.height * 0.42, z: def.radius * 0.1 };
}

/* ── assembly ────────────────────────────────────────────────────────────── */

type Model = (s: Sink, def: EnemyDef) => void;

/**
 * Keyed by `EnemyDef.key`. A def with no entry falls back to the Dustkin rather
 * than throwing, so adding an archetype to the roster never breaks the renderer
 * before its model exists — the same contract `TRAP_MODELS` keeps.
 */
export const ENEMY_MODELS: Record<string, Model> = {
  dustkin,
  ironjaw,
  buzzard,
  coyote,
  preacher,
  colossus,
};

/**
 * §17.7 budgets the shared humanoid base 1,800 triangles, and it is
 * "doubly load-bearing" there because the VAT bake at §14.3 costs
 * `verts × frames`. These grey-boxes are well under it, and the test holds them
 * there so a detail pass can't quietly make the future crowd path unaffordable.
 */
export const ENEMY_TRI_BUDGET = 1800;

export function buildEnemyGeometry(def: EnemyDef): BufferGeometry {
  const model = ENEMY_MODELS[def.key] ?? dustkin;
  return buildGeometry((s) => model(s, def), CHAR_SHADE);
}
