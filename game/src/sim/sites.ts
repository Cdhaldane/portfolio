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
import { block, deck, pillar, steps, wallRun } from "./kit.ts";
import { SIDE, SURF, type SurfaceSlot } from "./surfaces.ts";
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

  // Perimeter.
  wallRun(b, 0, 0, 48, 0);
  wallRun(b, 0, 32, 48, 32);
  wallRun(b, 0, 0, 0, 32);
  wallRun(b, 48, 0, 48, 32);

  // The orchard fence, with a 4m gap at z 14–18. Round 1 is one lane and one
  // pinch — and per §21.2 note 2 the gap is deliberately wider than a single Tar
  // Seep can seal, so coverage is the player's problem from the first minute.
  wallRun(b, 30, 0, 30, 14);
  wallRun(b, 30, 18, 30, 26);
  // The fence stops at z=26 and this flank wall leaves a longer southern route:
  // the flow field prefers the pinch, shoved bodies take the loop.
  wallRun(b, 30, 28, 38, 28);

  // The crypt row — the most load-bearing geometry on the map. It breaks the
  // gate-1 sightline down z=16, breaks gate-2's diagonal from (28,0), turns one
  // pinch into two, and provides the map's only three wall faces.
  block(b, 19, 8, 4, 4, 3.5);
  block(b, 19, 16, 4, 6, 3.5);
  block(b, 19, 25, 4, 4, 3.5);

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
    { x: 46, z: 16, fromRound: 1 },
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
  surfaces: [
    { surface: SURF.wall, x: 21.15, z: 8, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 21.15, z: 16, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 21.15, z: 25, y: 1.4, side: SIDE.east },
    // The gallows crossbeam over the lane. One roost, covering the pinch.
    { surface: SURF.ceiling, x: 24, z: 16, y: 4.4 },
    { surface: SURF.sigil, x: 24.5, z: 12.5, y: 0 },
    { surface: SURF.sigil, x: 24.5, z: 20.5, y: 0 },
    { surface: SURF.sigil, x: 15.5, z: 10.5, y: 0 },
    { surface: SURF.sigil, x: 15.5, z: 21.5, y: 0 },
  ],
  env: 1,
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

  wallRun(b, 0, 0, 44, 0);
  wallRun(b, 0, 34, 44, 34);
  wallRun(b, 0, 0, 0, 34);
  wallRun(b, 44, 0, 44, 34);

  wallRun(b, 26, 0, 26, 15);
  wallRun(b, 26, 19, 26, 27);
  wallRun(b, 26, 30, 34, 30);

  block(b, 20, 8, 3, 2.4, 1.2);
  block(b, 20, 26, 3, 2.4, 1.2);
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
    { x: 41, z: 17, fromRound: 1 },
    { x: 41, z: 29, fromRound: 6 },
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
    { surface: SURF.wall, x: 26.45, z: 6, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 26.45, z: 11, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 26.45, z: 22, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 26.45, z: 25.5, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 25.55, z: 8.5, y: 1.4, side: SIDE.west },
    { surface: SURF.wall, x: 25.55, z: 24, y: 1.4, side: SIDE.west },
    { surface: SURF.wall, x: 31.95, z: 11, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 31.95, z: 23, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 18.45, z: 13, y: 1.4, side: SIDE.east },
    { surface: SURF.wall, x: 18.45, z: 21, y: 1.4, side: SIDE.east },
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
  env: 0,
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
  env: UNDERTOWN_ENV.length,
  atmosphere: UNDERTOWN_AIR,
  openables: UNDERTOWN_OPENABLES,
  from: 4,
  to: Infinity,
  build: buildUndertown,
};

export const SITES: SiteDef[] = [BOOT_HILL, CREEK_PINCH, UNDERTOWN];

export const siteDef = (id: number): SiteDef => SITES[id] ?? SITES[0];

/** Which site round `r` is played on. */
export function siteForRound(r: number): SiteId {
  for (const s of SITES) {
    if (r >= s.from && r <= s.to) return s.id;
  }
  return SITES[SITES.length - 1].id;
}
