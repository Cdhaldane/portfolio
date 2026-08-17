/*
 * sim/sites.ts — the site registry.
 *
 * Engine work item 1 from GALLOWS_HYMN_MAPS.md §9: `WIDTH`/`DEPTH`/`CELL` and a
 * single hard-coded `buildBoxes()` were module constants in `level.ts`, so the
 * game had exactly one map forever and every other item in that list was blocked
 * behind this one.
 *
 * A `SiteDef` is data: dimensions, geometry, gates, the Rift, and — new — a
 * **surface census**. The census is a contract, not documentation (MAPS §3, G7):
 * §8's invalidation table quietly assumes the answers exist, and "Rattler —
 * counter: wall and ceiling coverage" is only true on a map that *has* wall and
 * ceiling surfaces. Boot Hill has almost none, on purpose. So the director reads
 * the census and refuses to send an archetype a site cannot answer.
 */

import { OBJECTIVE } from "./tuning.ts";
import { BOX, type Box } from "./level.ts";
import { block, deck, hazard, pillar, slab, steps, wall } from "./kit.ts";
import { SURF, type SurfaceSlot } from "./surfaces.ts";
import type { EnvSlotDef } from "./env.ts";
import type { NoBuildRegion } from "./wallgrid.ts";
import {
  CROSSROADS_ENV,
  CROSSROADS_SURFACES,
  DEPTH as CROSSROADS_DEPTH,
  WIDTH as CROSSROADS_WIDTH,
  buildCrossroads,
} from "./crossroads.ts";
import {
  DEPTH as SHAFT_DEPTH,
  SHAFT_AIR,
  SHAFT_ENV,
  SHAFT_NAVBLOCK,
  SHAFT_SURFACES,
  WIDTH as SHAFT_WIDTH,
  buildShaft,
} from "./shaft.ts";
import { type Atmosphere, UNDERTOWN_AIR } from "./atmosphere.ts";
import {
  OPEN,
  UNDERTOWN_ENV,
  UNDERTOWN_OPENABLES,
  UNDERTOWN_SURFACES,
  buildUndertown,
  type OpenableDef,
} from "./undertown.ts";

export const SITE = {
  bootHill: 0,
  /** The shipped M0 corridor. Retired from rotation — see `ROTATION`. */
  creekPinch: 1,
  /** Map 02: the town that fell thirty metres (MAPS §5). */
  undertown: 2,
  /** Map 04 — the pinchless one. Rounds 10+. */
  crossroads: 3,
  /** Map 03 — three levels, and the first map with a Y axis. Rounds 8-18. */
  shaft: 4,
} as const;

export type SiteId = (typeof SITE)[keyof typeof SITE];

/** A gate, and the round from which it starts sending bodies (MAPS §9 item 6). */
export interface GateDef {
  x: number;
  z: number;
  /** §4: later rounds activate more gates. A site escalates spatially. */
  fromRound: number;
  /**
   * Only live once openable `requiresOpen` has been bought.
   *
   * Exactly one gate in the game uses this — the Undertown's Breach — and it is
   * the declared exemption from §11 guarantee 4 (no path under 18m). The
   * guarantee tests skip gates that carry this field *and name it*, so a second
   * one cannot appear by accident.
   */
  requiresOpen?: number;
}

export interface SiteDef {
  id: SiteId;
  key: string;
  /** Shown in the HUD when a site is entered. */
  name: string;
  kit: "boothill" | "creek" | "shaft" | "reliquary";
  width: number;
  depth: number;
  cell: number;
  /** Build tile size. Defaults to BUILD_TILE; a site may go finer if it must. */
  tile?: number;
  gates: GateDef[];
  rift: { x: number; z: number; radius: number };
  playerStart: { x: number; z: number; yaw: number };
  /**
   * Every authored mount point (MAPS §9 item 5). A wall *face* a trap can bolt to
   * is a design decision, not something inferable from a box — a crypt has three
   * usable faces, not six — so the map states them and `buildLevel` counts them.
   *
   * The census is derived from this list plus the real placeable-floor count, so
   * the numbers the director makes roster decisions from cannot drift from the
   * geometry the player is standing in.
   */
  surfaces: SurfaceSlot[];
  /**
   * Wall faces that refuse traps (sim/wallgrid.ts).
   *
   * The inversion: every exposed face is buildable, and a map names the exceptions.
   * Keep them rare and explicable — rock the Company never cut, consecrated stone —
   * because the player reads them as a colour, not as a list.
   */
  noBuildWalls?: NoBuildRegion[];
  /** §4's environmental one-shots. The generator guarantees at least one per site. */
  envSlots?: EnvSlotDef[];
  /** Regions the flow field will not route through, with no geometry (ore chutes). */
  navBlock?: { x0: number; z0: number; x1: number; z1: number }[];
  /** Floor that accepts arcane traps only. Map 05 (the Reliquary) is the first. */
  unhallowed?: { x0: number; z0: number; x1: number; z1: number }[];
  /** Scenery hooks: the hanging tree, the bell frame. Not trap surfaces yet. */
  env: number;
  /**
   * Sky, roof, fog and lighting (MAPS §9 item 9). Optional: everything without
   * one is open air, which is what `render/look.ts` hard-coded before the
   * Undertown needed a map with no sky in it.
   */
  atmosphere?: Atmosphere;
  /**
   * Buildings the player can pay to open (MAPS §5). Opening one re-runs `build`
   * and re-bakes the field, so a site with openables has no fixed geometry.
   */
  openables?: OpenableDef[];
  /** Rounds this site covers. Inclusive; the last site's `to` is Infinity. */
  from: number;
  to: number;
  /**
   * `open[i]` says whether openable `i` has been bought. Static sites take no
   * argument and ignore it; the Undertown rebuilds around it, which is why this
   * is called again on every purchase rather than only at load.
   */
  build: (open?: readonly boolean[]) => Box[];
}

// ── Map 01 — Boot Hill, First Light ────────────────────────────────────────
// 48 × 32 · boothill · 2 gates · rounds 1–3 of every run.
// Built from the exact build table in MAPS §4. What it invalidates: nothing.
// It is the control every other map is measured against.

function buildBootHill(): Box[] {
  const b: Box[] = [];

  /* Perimeter, on the grid. Walls are whole tiles now (sim/kit.ts) — the run at
     z = 0 occupies the tile row z 0-2 rather than straddling the boundary. */
  wall(b, 0, 0, 48, 0);
  wall(b, 0, 30, 48, 30);
  wall(b, 0, 0, 0, 32);
  wall(b, 46, 0, 46, 32);

  // The orchard fence, with a 4m gap at z 14–18. Round 1 is one lane and one
  // pinch — and per §21.2 note 2 the gap is deliberately wider than a single Tar
  // Seep can seal, so coverage is the player's problem from the first minute.
  /* The fence, and its gap is now measured in TILES: z 14-18 is two whole tiles, which
     survives the agent-radius padding with room to spare. The old 4m gap between two
     0.6m fences was 4m of geometry and ~3.1m of passable field; this is 4m of both. */
  wall(b, 30, 0, 30, 14);
  wall(b, 30, 18, 30, 24);
  // The fence stops at z=26 and this flank wall leaves a longer southern route:
  // the flow field prefers the pinch, shoved bodies take the loop.
  /*
   * z 22-24, and the width is the point.
   *
   * The southern loop has to be **three tiles**, not two. A blockade is one tile wide
   * and pads to 2.9m, so in a 4m (2-tile) corridor it leaves nothing — every tile in
   * it refuses with "that would seal the last way through", which is true and useless.
   * Three tiles means the outer two accept a brace and only the middle seals, which is
   * exactly the zigzag the trap exists to build.
   *
   * This is the corridor that becomes the *only* route the moment the player braces
   * the pinch, so it is the one that most needs to be tunnellable.
   */
  wall(b, 30, 22, 38, 22);

  // The crypt row — the most load-bearing geometry on the map. It breaks the
  // gate-1 sightline down z=16, breaks gate-2's diagonal from (28,0), turns one
  // pinch into two, and provides the map's only three wall faces.
  slab(b, 16, 6, 20, 10, 3.5);
  slab(b, 16, 14, 20, 20, 3.5);
  slab(b, 16, 24, 20, 28, 3.5);

  // The player's plinth. North of the Rift ring, never on it (§21.1 note 3).
  /* 1.2m plinth reached by four 0.30m treads. The rise MUST be <= 
     PLAYER.stepOffset (0.35) or the flight is unclimbable however good the
     collision code is — 0.45 was, which is how the steps stayed decorative. */
  // A deck, not a block: decks are ridden via groundHeight, so the flight
  // actually leads somewhere. A solid 1.2m block would be a wall at the top step.
  deck(b, 10, 9, 6, 5, 1.2, 1.2, true);
  steps(b, 16.0, 9, 4, 0.3, 0.9, 5, -1);

  // Pillars flank the lane and never block it.
  pillar(b, 18, 21);
  pillar(b, 31.5, 11);
  pillar(b, 31.5, 23);

  // Headstones: 0.9m, so `bakeBlocked` ignores them (it only blocks y1 >= 1.0).
  // They break sight and block nothing, which is exactly what a graveyard should
  // do to a firing line.
  const stones: [number, number][] = [
    [5, 4], [8, 6], [4, 11], [12, 4], [15, 6], [6, 21], [11, 24], [4, 27],
    [14, 28], [8, 29], [16, 22], [12, 19], [3, 17], [7, 13], [13, 12],
    [22, 4], [26, 6], [24, 12], [22, 20], [26, 22], [24, 29], [27, 17],
    [17, 3], [20, 30],
  ];
  for (const [x, z] of stones) block(b, x, z, 0.5, 0.28, 0.9, BOX.prop);

  return b;
}

const BOOT_HILL: SiteDef = {
  id: SITE.bootHill,
  key: "boothill",
  name: "BOOT HILL · FIRST LIGHT",
  kit: "boothill",
  width: 48,
  depth: 32,
  cell: 1,
  gates: [
    /* x = 43, not 46: a tile-thick wall occupies x 46-48 and pads to 45.55, so the
       old spawn point is now inside the masonry. Gates sit clear of the wall they
       come through — the same lesson as z = 3 below, one migration later. */
    { x: 43, z: 16, fromRound: 1 },
    // Round 3 opens a gate *inside* the fence. A player who spent everything at
    // the pinch now watches a lane they never covered — and the two lanes
    // converge at the middle crypt, 11m out, so defence in depth already covers
    // both. A chokepoint is a place, not a strategy.
    // z=3, not z=0: the ±1.4m spawn jitter at z=1 pushed bodies through the
    // perimeter wall, and collision then ejected them outside the map.
    { x: 28, z: 3, fromRound: 3 },
  ],
  rift: { x: 8, z: 16, radius: OBJECTIVE.riftRadius },
  playerStart: { x: 12, z: 16, yaw: -Math.PI / 2 },
  /*
   * Floor-first by design, and the scarcity is the lesson.
   *
   * Three wall faces — the east side of each crypt, facing the bodies — is
   * deliberately not enough to build a wall-trap strategy on, and one ceiling
   * anchor is deliberately one. A player who learns "bolt iron to the walls" here
   * arrives at Hollow Creek with ten faces and a real decision. The Buzzard
   * unlocks at round 5, two rounds after they have left.
   */
  /*
   * The three authored wall mounts that used to live here are gone: every exposed
   * face is a build tile now, derived from the geometry (sim/wallgrid.ts). Ceiling
   * anchors and chalk circles stay authored, because those are genuinely discrete
   * places rather than a surface with an extent.
   */
  surfaces: [
    // The gallows crossbeam over the lane. One roost, covering the pinch.
    { surface: SURF.ceiling, x: 24, z: 16, y: 4.4 },
    { surface: SURF.sigil, x: 24.5, z: 12.5, y: 0 },
    { surface: SURF.sigil, x: 24.5, z: 20.5, y: 0 },
    { surface: SURF.sigil, x: 15.5, z: 10.5, y: 0 },
    { surface: SURF.sigil, x: 15.5, z: 21.5, y: 0 },
  ],
  env: 1,
  /* The hanging tree, which the census has claimed since M1.0 without anything
     standing there. Over the lane, east of the crypt row: shoot it down on whatever
     is underneath, once per visit. */
  envSlots: [{ key: "tree", name: "The hanging tree", x: 24, z: 16, resetSalt: 15 }],
  /*
   * The crypts are consecrated ground, and the one place on Map 01 that refuses iron.
   *
   * Exactly one exception on the whole map, on purpose. A no-build face is a rule the
   * player reads as a colour, and a map with many of them teaches nothing except that
   * walls are unreliable — where a single row of graves that will not take a nail is
   * a fact about this place, and it puts the map's best cover permanently off limits
   * to the player's best answer.
   */
  noBuildWalls: [
    { x0: 16.5, z0: 5.5, x1: 21.5, z1: 27.5, why: "consecrated: the crypt row" },
  ],
  from: 1,
  to: 3,
  build: buildBootHill,
};

// ── The M0 pinch, retained ─────────────────────────────────────────────────
// Not one of the five anchor sites; it is the shipped M0 layout, kept as the
// round 4+ site so site rotation is real before Map 02 is authored. Its census
// is honest about what it offers, which is: a corridor.

function buildCreekPinch(): Box[] {
  const b: Box[] = [];

  wall(b, 0, 0, 44, 0);
  wall(b, 0, 32, 44, 32);
  wall(b, 0, 0, 0, 34);
  wall(b, 42, 0, 42, 34);

  wall(b, 26, 0, 26, 14);
  wall(b, 26, 18, 26, 26);
  /* z 26-28, not 30. A tile-thick flank wall at z 30-32 pads to 30.45 and the south
     wall at 32-34 pads back to 31.55 — between them the southern loop had no passable
     cell at all, and the route the map's whole "shoved bodies take the long way"
     design depends on was silently gone. Two tiles further north leaves 2m of it. */
  wall(b, 26, 26, 34, 26);

  slab(b, 18, 6, 22, 10, 1.2);
  slab(b, 18, 24, 22, 28, 1.2);

  /*
   * The creek the map is named after, at last.
   *
   * A flooded cut running the north edge of the pinch: two tiles wide, impassable, and
   * see-through. It narrows the northern approach without adding a wall — which is the
   * point of hazards. A Powder Plate on the far bank throws bodies *into* it, and a
   * launched body clears it, so it is a feature to build around rather than a border.
   */
  hazard(b, 28, 4, 42, 8);
  pillar(b, 18, 13);
  pillar(b, 18, 21);
  pillar(b, 31.5, 11);
  pillar(b, 31.5, 23);

  deck(b, 10, 11, 6, 5, 1.2, 1.2, true);
  steps(b, 16.0, 11, 4, 0.3, 0.9, 5, -1);

  // One low deck, so `groundHeight`'s y0 handling has something real to stand
  // under and MAPS §9 item 3 is exercised by the shipped game rather than only
  // by a test.
  deck(b, 20, 17, 4, 3, 0.3);

  return b;
}

const CREEK_PINCH: SiteDef = {
  id: SITE.creekPinch,
  key: "creekpinch",
  name: "HOLLOW CREEK · THE PINCH",
  kit: "creek",
  width: 44,
  depth: 34,
  cell: 1,
  gates: [
    // Clear of the tile-thick east wall at x 42-44 (see Boot Hill's note).
    { x: 39, z: 17, fromRound: 1 },
    { x: 39, z: 29, fromRound: 6 },
  ],
  rift: { x: 5.5, z: 17, radius: OBJECTIVE.riftRadius },
  playerStart: { x: 13, z: 17, yaw: -Math.PI / 2 },
  /*
   * A corridor, but a *furnished* one: ten wall faces and four roof anchors, which
   * is what makes arriving here at round 4 read as a promotion rather than a
   * sidestep. The east-facing fence panels see the bodies first; the west faces
   * cover what gets through; the pillars cover the flanks.
   */
  surfaces: [
    { surface: SURF.ceiling, x: 30, z: 17, y: 4.2 },
    { surface: SURF.ceiling, x: 24, z: 17, y: 4.2 },
    { surface: SURF.ceiling, x: 18, z: 17, y: 4.2 },
    { surface: SURF.ceiling, x: 13, z: 17, y: 4.2 },
    { surface: SURF.sigil, x: 29.5, z: 13.5, y: 0 },
    { surface: SURF.sigil, x: 29.5, z: 20.5, y: 0 },
    { surface: SURF.sigil, x: 23.5, z: 12.5, y: 0 },
    { surface: SURF.sigil, x: 23.5, z: 21.5, y: 0 },
    { surface: SURF.sigil, x: 16.5, z: 17.5, y: 0 },
    { surface: SURF.sigil, x: 11.5, z: 17.5, y: 0 },
  ],
  env: 1,
  /* §4 guarantees at least one environmental slot per site, and the retained M0 map
     had none. The winding gear over the deck at the pinch is it. */
  envSlots: [{ key: "gear", name: "The winding gear", x: 20, z: 17, resetSalt: 15 }],
  /*
   * Retired from rotation now that Map 02 is authored, but kept buildable: it is
   * the shipped M0 layout, `sim.test.ts` runs its whole suite on it, and every
   * recorded replay from before the Undertown landed refers to it by id. Deleting
   * it would invalidate all three for no gain. `from > to` keeps it out of
   * `siteForRound` without a second flag.
   */
  from: Infinity,
  to: -Infinity,
  build: buildCreekPinch,
};

// ── Map 02 — Hollow Creek, Undertown ───────────────────────────────────────
// 80 × 48 × 12 · creek · subterranean · rounds 4+. Geometry in `undertown.ts`,
// which is large enough to deserve its own file. What it invalidates: the
// finished build — this is the only site whose shape the player can change.

const UNDERTOWN: SiteDef = {
  id: SITE.undertown,
  key: "undertown",
  name: "HOLLOW CREEK · UNDERTOWN",
  kit: "creek",
  width: 80,
  depth: 48,
  cell: 1,
  gates: [
    // The drifts the Company drove to reach the seam — which is also why Main
    // Street is straight and 8m wide.
    { x: 3, z: 24, fromRound: 1 },
    { x: 77, z: 24, fromRound: 1 },
    // The Fall: bodies come *down* the rubble cone rather than out of a tunnel,
    // and every Buzzard enters here. A flier arriving through the ceiling, on
    // the one map that has a ceiling.
    { x: 71, z: 37, fromRound: 3 },
    // The Breach. Ten metres from the Rift with a clear line to it, which breaks
    // §11 guarantee 4 outright — and it exists only because the player paid 150
    // scrap to let the Debt out. The generator may never do this. An author may,
    // once, with the ghost path drawn in advance.
    { x: 34, z: 44, fromRound: 1, requiresOpen: OPEN.jail },
  ],
  rift: { x: 36, z: 40, radius: OBJECTIVE.riftRadius },
  playerStart: { x: 42, z: 43, yaw: Math.PI },
  surfaces: UNDERTOWN_SURFACES,
  /*
   * The rib, taken straight from the map's own note: "untouched strata the town was
   * built around. Never opens." Rock the Company never cut does not take a nail
   * either, so the one face on this map that refuses traps is the one the fiction
   * already said was different.
   */
  noBuildWalls: [{ x0: 33.5, z0: 5.5, x1: 46.5, z1: 18.5, why: "the rib: untouched strata" }],
  env: UNDERTOWN_ENV.length,
  envSlots: UNDERTOWN_ENV,
  atmosphere: UNDERTOWN_AIR,
  openables: UNDERTOWN_OPENABLES,
  from: 4,
  /* 4-7, then the run goes underground. */
  to: 7,
  build: buildUndertown,
};

// ── Map 04 — The Crossroads, Hanging Day ───────────────────────────────────
// 56 × 56 · 4 gates · rounds 10+. Geometry in `crossroads.ts`.
// What it invalidates: **the chokepoint.** There isn't one, and there is no way to
// make one — see MAPS §7, and §13 open question 1, which is what this map answers.

const CROSSROADS: SiteDef = {
  id: SITE.crossroads,
  key: "crossroads",
  name: "THE CROSSROADS · HANGING DAY",
  kit: "boothill",
  width: CROSSROADS_WIDTH,
  depth: CROSSROADS_DEPTH,
  cell: 1,
  /*
   * Four, from round one, and never a fifth.
   *
   * §7 is explicit: four columns of icons is the most the Bill can carry in the build
   * phase, and §4 requires the full manifest be readable there. All four open at once
   * because the map's whole argument is 360 degrees of approach — staggering them
   * would make it a normal map for its first few rounds and then not.
   *
   * Spawns sit 3m inside the wall line, not on it: the ±1.4m spawn jitter at the
   * threshold pushed bodies through the perimeter on Boot Hill (§21.7 bug 4).
   */
  gates: [
    { x: 28, z: 3, fromRound: 1 },
    { x: 28, z: 53, fromRound: 1 },
    { x: 3, z: 28, fromRound: 1 },
    { x: 53, z: 28, fromRound: 1 },
  ],
  rift: { x: 28, z: 28, radius: OBJECTIVE.riftRadius },
  /* South of the scaffold, facing it. There is no good side of this map to start on,
     which is the point — every direction is someone's road. */
  playerStart: { x: 28, z: 34, yaw: 0 },
  surfaces: CROSSROADS_SURFACES,
  env: CROSSROADS_ENV.length,
  envSlots: CROSSROADS_ENV,
  /*
   * 12+. §7 calls round 10 its boss round and "then rounds 12+"; bosses do not exist
   * yet, so the Crossroads takes the tail.
   *
   * The doc's bands overlap on purpose — Map 03 is "rounds 8-18" and Map 04 is "10,
   * then 12+" — because a run is meant to *choose* among the sites legal for its
   * round. `siteForRound` is a linear lookup and cannot express that yet, so the bands
   * are cut to be adjacent. Picking among candidates is generator work (M3).
   */
  from: 12,
  to: Infinity,
  build: buildCrossroads,
};

// ── Map 03 — Shaft Nine, The Deepings ──────────────────────────────────────
// 64 × 48 across three levels · 3 gates and one from above · rounds 8-18.
// What it invalidates: **the flat build.** Geometry in `shaft.ts`.

const SHAFT: SiteDef = {
  id: SITE.shaft,
  key: "shaft",
  name: "SHAFT NINE · THE DEEPINGS",
  kit: "shaft",
  width: SHAFT_WIDTH,
  depth: SHAFT_DEPTH,
  cell: 1,
  /*
   * Three gates, and each is a different problem (MAPS §6).
   *
   * G1 walks the full rail lane west then the ramp — the long lane the carts are
   * built for. G2 arrives above the rib and has to find a winze first. G3 opens on the
   * **stope** at round 3 and bypasses the ramp entirely, which is the round the ramp
   * build stops being enough.
   *
   * The Cage (G4) is deliberately absent. It is §11 guarantee 4's second authored
   * break and MAPS §6 says its mitigation "must ship with it" — three seconds of
   * visible descent with the winch audio starting 1.5s before. A spawn point without
   * that telegraph is exactly the thing §8 forbids, so it waits for the descent rather
   * than shipping as an ordinary gate that happens to be very close to the Rift.
   */
  gates: [
    { x: 61, z: 24, fromRound: 1 },
    { x: 3, z: 9, fromRound: 1 },
    { x: 61, z: 42, fromRound: 3 },
  ],
  /* The shaft head itself — the hole they opened — at the bottom of the cut. */
  rift: { x: 26, z: 38, radius: OBJECTIVE.riftRadius },
  playerStart: { x: 32, z: 38, yaw: Math.PI },
  surfaces: SHAFT_SURFACES,
  env: SHAFT_ENV.length,
  envSlots: SHAFT_ENV,
  navBlock: SHAFT_NAVBLOCK,
  atmosphere: SHAFT_AIR,
  /* 8-11. MAPS §6 says rounds 8-18; the tail goes to the Crossroads. */
  from: 8,
  to: 11,
  build: buildShaft,
};

export const SITES: SiteDef[] = [BOOT_HILL, CREEK_PINCH, UNDERTOWN, CROSSROADS, SHAFT];

export const siteDef = (id: number): SiteDef => SITES[id] ?? SITES[0];

/** Which site round `r` is played on. */
export function siteForRound(r: number): SiteId {
  for (const s of SITES) {
    if (r >= s.from && r <= s.to) return s.id;
  }
  return SITES[SITES.length - 1].id;
}
