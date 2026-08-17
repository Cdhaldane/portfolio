/*
 * sim/level.ts — the level, generated from code.
 *
 * This is "Path A" from GALLOWS_HYMN.md §17.0: environment geometry as
 * parameterized data emitted by a small kit vocabulary (wall runs, blocks,
 * pillars, steps) rather than authored in Blender. The render layer turns the
 * same boxes into merged geometry, so the grey-box you need for M0 IS the
 * candidate shipping art.
 *
 * Also bakes the flow field. Enemies never run A* — one Dijkstra pass from the
 * Rift gives every cell a direction, and 220 units then cost O(1) each per tick
 * (§15.1).
 */

import { DUSTKIN } from "./tuning.ts";
import { OPEN_AIR, type Atmosphere } from "./atmosphere.ts";
import { makeEnvSlots, type EnvSlots } from "./env.ts";
import { type OpenableDef } from "./undertown.ts";
import { siteDef, siteForRound, type GateDef } from "./sites.ts";
import {
  WALL_BASE,
  buildWallTiles,
  wallCensus,
  wallOfCell,
  type NoBuildRegion,
  type WallTile,
} from "./wallgrid.ts";
import {
  SURF,
  censusOf,
  nearestSlot,
  type SurfaceCensus,
  type SurfaceClass,
  type SurfaceSlot,
} from "./surfaces.ts";

export type { SurfaceCensus } from "./surfaces.ts";

/**
 * Wall, ceiling and sigil mounts live in a **separate cell-id space** starting
 * here: mount `n` is addressed as cell `SLOT_BASE + n`.
 *
 * A wall face does not belong to a floor cell in any useful way — the face of a
 * crypt is *inside* the crypt's own blocked cells — so mounts cannot be addressed
 * by the grid. Giving them their own range instead means `cell` stays the single
 * identity for every trap in the game, and `place`, `sell`, `upgrade`,
 * `trapAtCell` and the recorded replay format all keep working untouched. The
 * alternative (a second id field threaded through commands) would have bumped
 * REPLAY_VERSION and invalidated every replay for no gain.
 */
export const SLOT_BASE = 1_000_000;

/**
 * The mount a synthetic cell id refers to, or -1 for a floor tile or a wall tile.
 *
 * The upper bound is not decoration. Wall tiles live above `WALL_BASE`, which is also
 * above `SLOT_BASE`, so without it a wall id decodes as a nonsense mount index — id
 * 2,000,236 read back as "mount 1,000,236" and every caller that checked mounts
 * before walls would have quietly taken the wrong branch.
 */
export function slotOfCell(cellIndex: number): number {
  if (cellIndex < SLOT_BASE || cellIndex >= WALL_BASE) return -1;
  return cellIndex - SLOT_BASE;
}

export const cellOfSlot = (slot: number): number => SLOT_BASE + slot;

/**
 * The build tile, in metres.
 *
 * One knob for the whole game's build granularity: trap models are authored at 1m
 * and scaled by `tile`, so changing this number changes tile size, trap size, the
 * ghost, the grid overlay and the blockade footprint together.
 */
export const BUILD_TILE = 2;

export const BOX = {
  wall: 0,
  block: 1,
  pillar: 2,
  step: 3,
  /**
   * A boardwalk, platform or catwalk: the one kit piece with a non-zero `y0`
   * (MAPS §9 item 2). Everything else sits on the floor.
   */
  deck: 4,
  /** Decor: headstones, troughs, wagons. Breaks sight, blocks nothing. */
  prop: 5,
  /**
   * Water, lava, a flooded cut — ground nothing walks on.
   *
   * The inverse of a prop: it stops movement and pathing while blocking neither sight
   * nor shots. Flat (2cm), so a horizontal ray passes straight over it and the map
   * still reads as open across it.
   */
  hazard: 6,
} as const;

export type BoxKind = (typeof BOX)[keyof typeof BOX];

/**
 * Is this kind an obstacle, for both pathing AND collision?
 *
 * One predicate, used by `bakeBlocked` and `resolveCircle`, because they used to
 * disagree and the disagreement softlocked rounds. `bakeBlocked` ignored anything
 * under 1m while `resolveCircle` treated anything above the step height as a wall,
 * so a 0.9m headstone was invisible to the flow field and solid to the body
 * walking into it: the field said west, collision said no, and the body wedged
 * there for the rest of the run.
 *
 * The rule now: walkables (steps, decks) are never obstacles — you ride them via
 * `groundHeight`. Decor is never an obstacle. Everything else is, to both systems.
 */
export function isSolidKind(kind: BoxKind): boolean {
  return kind !== BOX.step && kind !== BOX.deck && kind !== BOX.prop;
}

/** Flat ground you cannot cross. Handled apart from height everywhere it matters. */
export const isHazardKind = (kind: BoxKind): boolean => kind === BOX.hazard;

export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  kind: BoxKind;
  /**
   * Authored: this surface refuses floor traps.
   *
   * MAPS §4 wants the player's plinth unbuildable and Map 02's boardwalks
   * buildable, and both are decks — so it cannot be inferred from kind or height.
   * Whether high ground is a firing position or a trap bed is a design decision,
   * exactly like the surface census, so the map says which.
   */
  noBuild?: boolean;
}

export interface Level {
  /** Which SiteDef this was built from (sim/sites.ts). */
  siteId: number;
  name: string;
  width: number;
  depth: number;
  /*
   * TWO GRIDS, and the reason is arithmetic rather than taste.
   *
   * `cell` is the **nav** grid: the resolution of `blocked`, `dist` and the flow
   * field. `tile` is the **build** grid: where traps and blockades snap. They used
   * to be one 1m grid, and coarsening that single grid to 2m closes Boot Hill's
   * orchard gap outright — `bakeBlocked` marks every cell *touched* by geometry
   * inflated by the 0.45m agent radius, so a 0.6m fence claims a 4m band, and the
   * deliberate 4m gap at z 14-18 becomes two cells that the two fence segments each
   * claim. Zero passable cells, which is the M1.0 softlock all over again (§21.7).
   *
   * So the build grid gets coarse (chunky tiles, traps you can see) and the nav grid
   * stays fine (bodies that can still find the gap). Nothing about the world's scale
   * changes: the player is still 1.8m and a Dustkin's radius is still 0.45m.
   */
  cell: number;
  gw: number;
  gh: number;
  /** Build tile size in metres. Must be a whole multiple of `cell`. */
  tile: number;
  /** Build grid width/height in tiles. */
  tw: number;
  th: number;
  /** `tile / cell` — how many nav cells span one build tile, per axis. */
  navPerTile: number;
  boxes: Box[];
  /**
   * Enemy spawn gates. `fromRound` is when each starts sending bodies — §4 wants
   * a site to escalate *spatially*, not only numerically.
   */
  gates: GateDef[];
  /**
   * What this site can answer (MAPS §3 G7). The director reads it and refuses to
   * send an archetype the geometry has no counter for.
   */
  census: SurfaceCensus;
  /**
   * Authored mount points: wall faces, ceiling anchors, chalk sigils. Addressed as
   * cells via `SLOT_BASE`. The census is *derived* from this list, so the two can
   * never drift apart (a hand-counted census is a comment that can quietly stop
   * being true, and the director makes roster decisions from it).
   */
  slots: SurfaceSlot[];
  /**
   * Every wall build tile, derived from the geometry (sim/wallgrid.ts).
   *
   * Rebuilt by `rebake`, because Undertown lets the player open buildings and a new
   * doorway is new wall. Blockades are deliberately NOT a mounting surface: they are
   * the player's own geometry and letting traps ride them would make a Brace a
   * two-for-one, which is not what it costs.
   */
  wallTiles: WallTile[];
  rift: { x: number; z: number; radius: number };
  playerStart: { x: number; z: number; yaw: number };
  /** Sky, roof, fog and lighting. Presentation-only — no system reads it. */
  atmosphere: Atmosphere;
  /** Buildings this site sells (MAPS §5). Empty on every static site. */
  openables: OpenableDef[];
  /**
   * Which openables have been bought, parallel to `openables`.
   *
   * This is sim state, so it is hashed and replayed: a run where the player
   * opened the saloon on round 6 has to replay against the geometry that opening
   * produced. That works because the geometry is a pure function of this array —
   * `build(open)` — and never of anything else (§13).
   */
  open: boolean[];
  /**
   * One flag per build tile: a player-built blockade stands here.
   *
   * Blockades are the only geometry the *player* authors, which is why they live on
   * the level rather than being derived from `world.traps` — `rebake` has to see
   * them, and it never sees the world. The command system owns writing this and
   * calling `rebake` afterwards.
   */
  blockTiles: Uint8Array;
  /**
   * The same blockades as boxes, rebuilt by `rebake`.
   *
   * Kept OUT of `boxes` on purpose. A blockade stops enemies and nothing else — the
   * player and their bullets pass straight through — so it must be invisible to
   * `resolveCircle` for the player and to `rayLevel` for hitscan, while enemy
   * collision opts in explicitly.
   */
  blockBoxes: Box[];
  /** 1 = impassable for a DUSTKIN-radius agent. */
  blocked: Uint8Array;
  /** Cost-to-Rift per cell; Infinity where unreachable. */
  dist: Float32Array;
  /** Authored faces that refuse traps. The exception, not the rule. */
  noBuildWalls: NoBuildRegion[];
  /** §4's one-shot environmental traps. At least one per site (MAPS §9 item 7). */
  envSlots: EnvSlots;
  /**
   * Regions the flow field refuses to route through, with no geometry behind them.
   *
   * Shaft Nine's ore chutes: one-way drops the field "will not path down", but which
   * the *player* can boot a body through for 6m of fall damage. MAPS §6 names the two
   * options — a field per level with link cells, or non-navigable chutes — and calls
   * the second "cheaper, correct for this map". This is that.
   *
   * It is deliberately not a `Box`: a box would stop the body as well as the path, and
   * the whole point of a chute is that things can go down it.
   */
  navBlock: { x0: number; z0: number; x1: number; z1: number }[];
  /** Regions of floor that accept arcane traps only (MAPS §9 item 5). */
  unhallowed: { x0: number; z0: number; x1: number; z1: number }[];
  /** Scratch for `wouldSealLane`'s reachability passes. Never read outside it. */
  reachScratch: Uint8Array;
  reachQueue: Int32Array;
  /** Unit direction toward the Rift per cell. */
  flowX: Float32Array;
  flowZ: Float32Array;
  /**
   * Bumped by every `rebake`. Presentation reads it as "the routes may have
   * moved" — it is what lets the ghost paths re-trace when a blockade goes up
   * or comes down without diffing the field itself (sim/paths.ts).
   */
  bakeEpoch: number;
}

// ── flow field bake ────────────────────────────────────────────────────────

/**
 * Block the cells a `radius`-wide body genuinely cannot stand in.
 *
 * **Exact, not conservative, and the difference is half the map.**
 *
 * This used to inflate the box by the agent radius and then mark every cell the
 * inflated band *touched*. Because a band that overhangs a cell by a millimetre claims
 * the whole cell, a 2m wall blocked 4m of navigation and a 1-tile blockade consumed two
 * tiles of passage. Every map was systematically narrower than it looked: Boot Hill's
 * 4m orchard gap carried 2m of field, which is why three separate gaps had to be
 * widened and why the player could see four open squares and be told a blockade would
 * seal the last way through.
 *
 * The right test is the one a body actually has to pass: a cell is blocked when the
 * distance from its **centre** to the box is less than the radius. Exact for a circular
 * agent against an AABB, the same cost, and it makes a gap as wide as it looks.
 */
function markInflated(
  level: Level,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius: number,
): void {
  const { gw, gh, cell, blocked } = level;
  const cx0 = Math.max(0, Math.floor((x0 - radius) / cell));
  const cx1 = Math.min(gw - 1, Math.floor((x1 + radius) / cell));
  const cz0 = Math.max(0, Math.floor((z0 - radius) / cell));
  const cz1 = Math.min(gh - 1, Math.floor((z1 + radius) / cell));
  const r2 = radius * radius;

  for (let cz = cz0; cz <= cz1; cz++) {
    const pz = (cz + 0.5) * cell;
    const dz = Math.max(z0 - pz, 0, pz - z1);
    for (let cx = cx0; cx <= cx1; cx++) {
      const px = (cx + 0.5) * cell;
      const dx = Math.max(x0 - px, 0, px - x1);
      // Centre inside the box gives dx = dz = 0, which is blocked, as it must be.
      if (dx * dx + dz * dz < r2) blocked[cz * gw + cx] = 1;
    }
  }
}

function bakeBlocked(level: Level): void {
  const { gw, gh, cell, boxes, blocked } = level;
  const pad = DUSTKIN.radius;
  blocked.fill(0);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    // Only solid geometry tall enough to stop a walker blocks the field, and the
    // same predicate governs collision (see isSolidKind).
    /* Hazards are exempt from the height rule: water is 2cm tall and impassable, and
       the 1m threshold exists to let bodies walk over kerbs, not lakes. */
    if (!isSolidKind(box.kind)) continue;
    if (!isHazardKind(box.kind) && box.y1 < 1.0) continue;
    markInflated(level, box.x0, box.z0, box.x1, box.z1, pad);
  }
  // Authored no-path regions: a chute is a hole in the graph, not a wall.
  for (let i = 0; i < level.navBlock.length; i++) {
    const r = level.navBlock[i];
    const cx0 = Math.max(0, Math.floor(r.x0 / cell));
    const cx1 = Math.min(gw - 1, Math.floor(r.x1 / cell));
    const cz0 = Math.max(0, Math.floor(r.z0 / cell));
    const cz1 = Math.min(gh - 1, Math.floor(r.z1 / cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) blocked[cz * gw + cx] = 1;
    }
  }
  /* Player-built blockades block the field too, or the whole trap would do nothing.
     They are padded identically: a body has to fit past one, not clip it. */
  for (let i = 0; i < level.blockBoxes.length; i++) {
    const box = level.blockBoxes[i];
    markInflated(level, box.x0, box.z0, box.x1, box.z1, pad);
  }
}

const DIAG = Math.SQRT2;

/**
 * Relaxation-sweep Dijkstra. The grid is ~1.5k cells and this runs once per
 * site, so the simple algorithm wins: no heap, no tie-breaking subtleties,
 * deterministic by construction.
 */
function bakeDistance(level: Level): void {
  const { gw, gh, blocked, dist } = level;
  dist.fill(Infinity);

  const rc =
    Math.floor(level.rift.z / level.cell) * gw + Math.floor(level.rift.x / level.cell);
  dist[rc] = 0;

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 512) {
    changed = false;
    // Alternate sweep direction so information propagates both ways quickly.
    for (let pass = 0; pass < 2; pass++) {
      const start = pass === 0 ? 0 : gw * gh - 1;
      const end = pass === 0 ? gw * gh : -1;
      const stride = pass === 0 ? 1 : -1;
      for (let i = start; i !== end; i += stride) {
        if (blocked[i]) continue;
        const cx = i % gw;
        const cz = (i / gw) | 0;
        let best = dist[i];
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
            const ni = nz * gw + nx;
            if (blocked[ni]) continue;
            // No corner cutting: a diagonal needs both orthogonals open.
            if (dx !== 0 && dz !== 0) {
              if (blocked[cz * gw + nx] || blocked[nz * gw + cx]) continue;
            }
            const step = dx !== 0 && dz !== 0 ? DIAG : 1;
            const cand = dist[ni] + step;
            if (cand < best) best = cand;
          }
        }
        if (best < dist[i]) {
          dist[i] = best;
          changed = true;
        }
      }
    }
  }
}

function bakeFlow(level: Level): void {
  const { gw, gh, blocked, dist, flowX, flowZ } = level;
  for (let cz = 0; cz < gh; cz++) {
    for (let cx = 0; cx < gw; cx++) {
      const i = cz * gw + cx;
      flowX[i] = 0;
      flowZ[i] = 0;
      if (blocked[i] || !isFinite(dist[i])) continue;

      let bestD = dist[i];
      let bx = 0;
      let bz = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
          const ni = nz * gw + nx;
          if (blocked[ni] || !isFinite(dist[ni])) continue;
          if (dx !== 0 && dz !== 0) {
            if (blocked[cz * gw + nx] || blocked[nz * gw + cx]) continue;
          }
          if (dist[ni] < bestD) {
            bestD = dist[ni];
            bx = dx;
            bz = dz;
          }
        }
      }
      const l = Math.sqrt(bx * bx + bz * bz);
      if (l > 0) {
        flowX[i] = bx / l;
        flowZ[i] = bz / l;
      }
    }
  }
}

/** Build and bake a site. Defaults to whichever site owns round 1. */
export function buildLevel(siteId: number = siteForRound(1)): Level {
  const def = siteDef(siteId);
  const gw = Math.ceil(def.width / def.cell);
  const gh = Math.ceil(def.depth / def.cell);
  const tile = def.tile ?? BUILD_TILE;
  const navPerTile = Math.round(tile / def.cell);
  const tw = Math.ceil(def.width / tile);
  const th = Math.ceil(def.depth / tile);
  const level: Level = {
    siteId: def.id,
    name: def.name,
    width: def.width,
    depth: def.depth,
    cell: def.cell,
    gw,
    gh,
    tile,
    tw,
    th,
    navPerTile,
    boxes: def.build([]),
    gates: def.gates,
    // Overwritten by `rebake` below; the floor count needs a baked field.
    census: censusOf(def.surfaces, 0, def.env),
    /*
     * Authored WALL mounts are dropped: the wall lattice supersedes them.
     *
     * Filtered here rather than deleted from each map so no site file has to change
     * — including `undertown.ts`, which is being written in parallel. Ceiling anchors
     * and chalk sigils stay authored, because those genuinely are discrete places
     * (one roof beam, one circle) rather than a surface with an extent.
     */
    slots: def.surfaces.filter((s) => s.surface !== SURF.wall),
    wallTiles: [],
    rift: def.rift,
    playerStart: def.playerStart,
    atmosphere: def.atmosphere ?? OPEN_AIR,
    openables: def.openables ?? [],
    open: (def.openables ?? []).map(() => false),
    noBuildWalls: def.noBuildWalls ?? [],
    navBlock: def.navBlock ?? [],
    unhallowed: def.unhallowed ?? [],
    // Built after the boxes exist: each hangs above the ground it stands on.
    envSlots: makeEnvSlots([], () => 0),
    blockTiles: new Uint8Array(tw * th),
    blockBoxes: [],
    blocked: new Uint8Array(gw * gh),
    dist: new Float32Array(gw * gh),
    flowX: new Float32Array(gw * gh),
    flowZ: new Float32Array(gw * gh),
    reachScratch: new Uint8Array(gw * gh),
    reachQueue: new Int32Array(gw * gh),
    bakeEpoch: 0,
  };
  rebake(level);
  /* After `rebake`, because each slot hangs above the ground beneath it and
     `groundHeight` needs the boxes baked to answer. */
  level.envSlots = makeEnvSlots(def.envSlots ?? [], (x, z) => groundHeight(level, x, z));
  return level;
}

/**
 * Re-run the three bake passes (MAPS §9 item 8).
 *
 * Split out because Hollow Creek lets the *player* change the geometry mid-site,
 * so the field is no longer a one-time bake. Cheap enough to call outright: the
 * grid is ~1.5k cells.
 */
export function rebake(level: Level): void {
  level.bakeEpoch++;
  bakeBlockades(level);
  bakeBlocked(level);
  bakeDistance(level);
  bakeFlow(level);
  level.wallTiles = buildWallTiles(level, level.noBuildWalls);
  // Walls are measured too, now that they are derived rather than listed.
  const walls = wallCensus(level.wallTiles);
  // The census is recounted, never authored. Hollow Creek lets the player change
  // the geometry mid-site, so even the floor count is not a constant — and the
  // director makes roster decisions from these numbers (MAPS §3 G7).
  level.census = censusOf(level.slots, placeableCount(level), level.census.env);
  level.census.wall = walls.wall;
  level.census.noBuildWall = walls.noBuild;
}

/**
 * Turn the blockade flags into boxes.
 *
 * Height 2m: over `bakeBlocked`'s 1.0m threshold so the flow field routes around it,
 * and tall enough to read as a barricade rather than a kerb. It is not a wall — you
 * can walk and shoot through your own — so this never enters `level.boxes`.
 */
function bakeBlockades(level: Level): void {
  level.blockBoxes.length = 0;
  const half = level.tile / 2;
  for (let t = 0; t < level.blockTiles.length; t++) {
    if (!level.blockTiles[t]) continue;
    const x = tileCenterX(level, t);
    const z = tileCenterZ(level, t);
    level.blockBoxes.push({
      x0: x - half,
      x1: x + half,
      z0: z - half,
      z1: z + half,
      y0: 0,
      y1: 2,
      kind: BOX.block,
    });
  }
}

/**
 * Would a blockade on this tile cut a gate off from the Rift?
 *
 * The rule the player is promised: **a lane can be narrowed but never sealed.**
 *
 * Two properties matter as much as the answer:
 *
 *  1. **It is pure.** It mutates nothing and allocates nothing, running two BFS
 *     passes over preallocated scratch. That is not tidiness — the build ghost asks
 *     this question every frame from the *host*, and a mutate-test-restore version
 *     would have the renderer writing sim state, which breaks §12.2 and determinism
 *     in the same stroke.
 *  2. **It compares against what is reachable NOW, not against the gate list.**
 *     Some gates are legitimately unreachable already — Undertown's Fall breach sits
 *     behind a building the player has not paid to open — and a rule phrased as
 *     "every gate must reach the Rift" would refuse every blockade on that map
 *     forever. "Do not take away a route that currently exists" is the honest
 *     version, and it still covers gates that open in later rounds, because those
 *     are reachable long before they are active.
 *  3. **A gate is its spawn AREA, not one nav cell.** The first version tested the
 *     cell under the gate's exact centre, and a blockade whose padded footprint
 *     merely touched that cell read as a seal — even though the director scatters
 *     spawns across the gate mouth and a body arriving beside the barricade walks
 *     around it without breaking stride. Every false "can't place that" this rule
 *     ever produced was this case: the lane was narrowed, the route survived, and
 *     the single-cell test couldn't see it. A gate now counts as routed while ANY
 *     cell in its spawn reach still reaches the Rift.
 */
export function wouldSealLane(level: Level, tile: number): boolean {
  if (tile < 0 || tile >= level.blockTiles.length) return false;
  if (level.blockTiles[tile]) return false; // already there, nothing changes

  const gates = level.gates;
  if (gates.length === 0) return false;

  // Reachability as it stands, then as it would be — same yardstick both times.
  reach(level, -1);
  const wasReachable: boolean[] = [];
  for (let i = 0; i < gates.length; i++) {
    wasReachable.push(gateReached(level, gates[i].x, gates[i].z));
  }

  reach(level, tile);
  for (let i = 0; i < gates.length; i++) {
    if (!wasReachable[i]) continue;
    if (!gateReached(level, gates[i].x, gates[i].z)) return true;
  }
  return false;
}

/**
 * How far from a gate's centre a body may actually start, metres: the director's
 * ±1.4m spawn jitter plus a body radius, rounded up to whole cells. This is the
 * radius `wouldSealLane` and the director both reason over — one constant, so the
 * placement rule and the spawner can never disagree about what a gate is.
 */
export const GATE_SPAWN_REACH = 2;

/** `gateHasRoute`, but over `wouldSealLane`'s flood scratch instead of the bake. */
function gateReached(level: Level, gx: number, gz: number): boolean {
  const seen = level.reachScratch;
  for (let dz = -GATE_SPAWN_REACH; dz <= GATE_SPAWN_REACH; dz += level.cell) {
    for (let dx = -GATE_SPAWN_REACH; dx <= GATE_SPAWN_REACH; dx += level.cell) {
      const c = cellOf(level, gx + dx, gz + dz);
      if (c >= 0 && seen[c] === 1) return true;
    }
  }
  return false;
}

/**
 * The post-bake truth `wouldSealLane` predicts: can a body spawned at this gate
 * still route to the Rift? Exported so the tests hold the preview to exactly
 * this yardstick, and nothing else.
 */
export function gateHasRoute(level: Level, gx: number, gz: number): boolean {
  for (let dz = -GATE_SPAWN_REACH; dz <= GATE_SPAWN_REACH; dz += level.cell) {
    for (let dx = -GATE_SPAWN_REACH; dx <= GATE_SPAWN_REACH; dx += level.cell) {
      const c = cellOf(level, gx + dx, gz + dz);
      if (c >= 0 && !level.blocked[c] && Number.isFinite(level.dist[c])) return true;
    }
  }
  return false;
}

/**
 * Flood the walkable grid from the Rift into `level.reachScratch`.
 *
 * `extraTile >= 0` treats that build tile as though a blockade already stood on it,
 * padded by the agent radius exactly as `bakeBlocked` pads real geometry — otherwise
 * the preview would allow placements that seal the lane once baked.
 */
function reach(level: Level, extraTile: number): void {
  const { gw, gh, blocked, reachScratch: seen, reachQueue: queue } = level;
  seen.fill(0);

  // The candidate's padded footprint, in nav cells.
  let bx0 = 1;
  let bx1 = 0;
  let bz0 = 1;
  let bz1 = 0;
  if (extraTile >= 0) {
    const pad = DUSTKIN.radius;
    const half = level.tile / 2;
    const cx = tileCenterX(level, extraTile);
    const cz = tileCenterZ(level, extraTile);
    bx0 = Math.max(0, Math.floor((cx - half - pad) / level.cell));
    bx1 = Math.min(gw - 1, Math.floor((cx + half + pad) / level.cell));
    bz0 = Math.max(0, Math.floor((cz - half - pad) / level.cell));
    bz1 = Math.min(gh - 1, Math.floor((cz + half + pad) / level.cell));
  }
  const candidate = (c: number): boolean => {
    if (extraTile < 0) return false;
    const x = c % gw;
    const z = (c / gw) | 0;
    return x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1;
  };

  const start = cellOf(level, level.rift.x, level.rift.z);
  if (start < 0) return;
  let head = 0;
  let tail = 0;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++];
    const x = c % gw;
    const z = (c / gw) | 0;
    /*
     * EIGHT-connected, because `bakeDistance` is.
     *
     * This was four, and the mismatch was a real bug rather than a rounding
     * difference: a cell reachable only on a diagonal is reachable to the bake and not
     * to a 4-neighbour flood, so `wouldSealLane` decided such a gate was *already*
     * unreachable, skipped it, and cheerfully approved a blockade that cut it off. On
     * Boot Hill that let 64 legal placements seal a gate one at a time.
     *
     * A preview walking different connectivity from the thing it previews is the same
     * class of lie as a ghost path drawn by different code than the enemies steer by.
     */
    for (let d = 0; d < 8; d++) {
      const nx = x + [1, -1, 0, 0, 1, 1, -1, -1][d];
      const nz = z + [0, 0, 1, -1, 1, -1, 1, -1][d];
      if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
      const n = nz * gw + nx;
      if (seen[n]) continue;
      if (blocked[n]) continue;
      if (candidate(n)) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
}

/** How many build tiles actually accept a trap right now. */
export function placeableCount(level: Level): number {
  let n = 0;
  const tiles = level.tw * level.th;
  for (let i = 0; i < tiles; i++) if (isPlaceable(level, i)) n++;
  return n;
}

/**
 * Gates sending bodies on `round`.
 *
 * A gate with `requiresOpen` stays shut until the player buys that building —
 * which is how the Undertown's Breach can sit ten metres from the Rift without
 * the base map violating §11 guarantee 4.
 */
export function activeGates(level: Level, round: number): GateDef[] {
  const out: GateDef[] = [];
  for (const g of level.gates) {
    if (round < g.fromRound) continue;
    if (g.requiresOpen !== undefined && !level.open[g.requiresOpen]) continue;
    out.push(g);
  }
  return out.length > 0 ? out : level.gates.slice(0, 1);
}

/**
 * Buy an openable: rebuild the geometry around it and re-bake the field.
 *
 * Returns the scrap cost, or 0 if the index is bad or it is already open — the
 * caller charges, so this stays a pure geometry operation and the economy lives
 * in one place.
 *
 * Cheap enough to call outright (~3,800 cells, one relaxation sweep) and it only
 * ever runs from the build phase on a button press, never mid-wave. Trap cells do
 * NOT move: a trap standing where a wall just appeared is the player's problem,
 * and telling them so in the ghost preview is why the preview exists.
 */
export function openBuilding(level: Level, index: number): number {
  if (index < 0 || index >= level.openables.length) return 0;
  if (level.open[index]) return 0;
  level.open[index] = true;
  level.boxes = siteDef(level.siteId).build(level.open);
  rebake(level);
  return level.openables[index].cost;
}

// ── queries ────────────────────────────────────────────────────────────────

export function cellOf(level: Level, x: number, z: number): number {
  const cx = Math.floor(x / level.cell);
  const cz = Math.floor(z / level.cell);
  if (cx < 0 || cz < 0 || cx >= level.gw || cz >= level.gh) return -1;
  return cz * level.gw + cx;
}

/*
 * Slot-aware on purpose: every caller that turns a trap's `cell` into a world
 * position — events, damage numbers, HUD, the render ghost — then handles wall and
 * ceiling traps without knowing they exist.
 */
export function cellCenterX(level: Level, cellIndex: number): number {
  const s = slotOfCell(cellIndex);
  if (s >= 0) return level.slots[s]?.x ?? 0;
  return ((cellIndex % level.gw) + 0.5) * level.cell;
}

export function cellCenterZ(level: Level, cellIndex: number): number {
  const s = slotOfCell(cellIndex);
  if (s >= 0) return level.slots[s]?.z ?? 0;
  return (((cellIndex / level.gw) | 0) + 0.5) * level.cell;
}

/* ── the build grid ────────────────────────────────────────────────────────
 *
 * A *tile* is where a trap goes; a *cell* is where a body walks. Every function
 * below is tile-space, and they are named apart from their nav counterparts on
 * purpose — a same-named function whose meaning quietly changed is exactly how this
 * split would introduce a silent bug.
 *
 * Tile ids share the id space with mount ids (`SLOT_BASE`), because a trap's
 * placement is one opaque handle whether it went on the ground or on a wall.
 */

/** The build tile containing a point, or -1 off the map. */
export function tileOf(level: Level, x: number, z: number): number {
  const tx = Math.floor(x / level.tile);
  const tz = Math.floor(z / level.tile);
  if (tx < 0 || tz < 0 || tx >= level.tw || tz >= level.th) return -1;
  return tz * level.tw + tx;
}

export function tileCenterX(level: Level, tileId: number): number {
  const w = wallOfCell(tileId);
  if (w >= 0) return level.wallTiles[w]?.x ?? 0;
  const s = slotOfCell(tileId);
  if (s >= 0) return level.slots[s]?.x ?? 0;
  return ((tileId % level.tw) + 0.5) * level.tile;
}

export function tileCenterZ(level: Level, tileId: number): number {
  const w = wallOfCell(tileId);
  if (w >= 0) return level.wallTiles[w]?.z ?? 0;
  const s = slotOfCell(tileId);
  if (s >= 0) return level.slots[s]?.z ?? 0;
  return (((tileId / level.tw) | 0) + 0.5) * level.tile;
}

/** Mount height, or the ground under a floor tile. */
export function tileCenterY(level: Level, tileId: number): number {
  const w = wallOfCell(tileId);
  if (w >= 0) return level.wallTiles[w]?.y ?? 0;
  const s = slotOfCell(tileId);
  if (s >= 0) return level.slots[s]?.y ?? 0;
  return groundHeight(level, tileCenterX(level, tileId), tileCenterZ(level, tileId));
}

/** The nav cell under a build tile's centre, or -1. */
export function navCellOfTile(level: Level, tileId: number): number {
  if (tileId < 0 || tileId >= level.tw * level.th) return -1;
  return cellOf(level, tileCenterX(level, tileId), tileCenterZ(level, tileId));
}

/** Mount height. Floor traps sit on whatever they were placed on. */
export function cellCenterY(level: Level, cellIndex: number): number {
  const s = slotOfCell(cellIndex);
  if (s >= 0) return level.slots[s]?.y ?? 0;
  return groundHeight(level, cellCenterX(level, cellIndex), cellCenterZ(level, cellIndex));
}

/**
 * Can a trap of this surface class mount at this cell id?
 *
 * The surface class is the trap's, so this is the one gate §6 asks for: "placement
 * is validated against surface tags". Floor traps take the grid rule; everything
 * else must land on an authored mount of a matching class.
 */
export function isPlaceableFor(
  level: Level,
  tileId: number,
  surface: SurfaceClass,
): boolean {
  /* Any exposed wall face takes iron unless the map says otherwise — the inversion
     from M1.1, where a map listed the few faces that did (sim/wallgrid.ts). */
  const w = wallOfCell(tileId);
  if (w >= 0) {
    const t = level.wallTiles[w];
    return t !== undefined && !t.noBuild && surface === SURF.wall;
  }
  const s = slotOfCell(tileId);
  if (s >= 0) {
    const slot = level.slots[s];
    return slot !== undefined && slot.surface === surface;
  }
  return surface === SURF.floor && isPlaceable(level, tileId);
}

/**
 * Unhallowed ground: open floor that accepts **arcane traps only** (MAPS §9 item 5).
 *
 * A region rather than a mount — the Reliquary's floor is still floor, it simply
 * refuses iron and powder. Kept separate from `isPlaceableFor` because it is a rule
 * about the trap's *element*, not about the surface it sits on, and conflating the two
 * is what would make "sigil" and "unhallowed" look like the same idea.
 *
 * No site declares any yet; Map 05 is the first, and §21 lists it first to cut. The
 * rule lives here so the class is real rather than a name in an enum.
 */
export function isUnhallowedOk(level: Level, tileId: number, elem: number): boolean {
  const x = tileCenterX(level, tileId);
  const z = tileCenterZ(level, tileId);
  for (let i = 0; i < level.unhallowed.length; i++) {
    const r = level.unhallowed[i];
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return elem === ELEM_ARCANE;
  }
  return true;
}

/** ELEM.arcane, inlined: sim/level.ts must not depend on the trap catalog. */
const ELEM_ARCANE = 4;

/**
 * The mount a point is nearest to, as a cell id, or -1.
 *
 * `taken` is passed in rather than read from the world because `level.ts` must not
 * import `world.ts` — the level is data the sim reads, not part of it.
 */
export function slotCellNear(
  level: Level,
  surface: SurfaceClass,
  x: number,
  z: number,
  taken: (cellId: number) => boolean,
): number {
  const i = nearestSlot(level.slots, surface, x, z, (idx) => taken(cellOfSlot(idx)));
  return i < 0 ? -1 : cellOfSlot(i);
}

/** True if a trap may be placed here: on the floor, unblocked, off the Rift. */
/**
 * Can a floor trap go on this build tile?
 *
 * A **footprint** test, not a point test, which the bigger tile forces: a 2m tile
 * whose centre happens to be clear can still have half of itself inside a wall, and
 * the old centre-only rule would have let a trap sit in the masonry.
 *
 * Note what it deliberately does NOT use: `blocked`. That array is inflated by the
 * agent radius because it answers "can a body walk here", and building is a
 * different question — a trap may sit flush against a wall it could never stand
 * 0.45m from. Reachability still matters (you cannot build inside sealed rock), so
 * that comes from `dist` at the tile centre, which is Infinity for blocked cells
 * anyway.
 */
export function isPlaceable(level: Level, tileId: number): boolean {
  if (tileId < 0 || tileId >= level.tw * level.th) return false;

  const x = tileCenterX(level, tileId);
  const z = tileCenterZ(level, tileId);
  const half = level.tile / 2;

  /*
   * Reachable ground: a tile in a sealed void is not a trap bed.
   *
   * ANY covered nav cell will do, and testing only the centre one was a bug. `dist`
   * is Infinity throughout a wall's *inflated* skirt — which is a pathing fact, about
   * where a body's centre may be, not a building one. A 48m map puts tile centres at
   * 1.0 and 47.0, and only the far one lands inside the east wall's skirt, so the
   * centre test killed one whole border and left the opposite one alive. Forty tiles,
   * asymmetrically, for a reason no player could ever have guessed.
   */
  let reachable = false;
  const cx0 = Math.max(0, Math.floor((x - half) / level.cell));
  const cx1 = Math.min(level.gw - 1, Math.ceil((x + half) / level.cell) - 1);
  const cz0 = Math.max(0, Math.floor((z - half) / level.cell));
  const cz1 = Math.min(level.gh - 1, Math.ceil((z + half) / level.cell) - 1);
  for (let cz = cz0; cz <= cz1 && !reachable; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (isFinite(level.dist[cz * level.gw + cx])) {
        reachable = true;
        break;
      }
    }
  }
  if (!reachable) return false;

  /*
   * The Rift's own ring stays clear (§21.1 note 3, G2) — measured to the tile
   * CENTRE, not to its corner.
   *
   * Inflating the keep-out by half a tile turned a 2.2m ring into a 3.2m disc and
   * quietly deleted a band of buildable floor right where the last stand happens.
   * G2 asks that no trap be placed *in* the ring, which is a question about where
   * the trap is, not about whether its tile overhangs.
   */
  const dx = x - level.rift.x;
  const dz = z - level.rift.z;
  if (dx * dx + dz * dz < level.rift.radius * level.rift.radius) return false;

  /*
   * Floor traps are for the floor — but "the floor" is a *kind*, not a height
   * (MAPS §9 item 4). The old rule rejected any box under 1m, which correctly
   * refused the player's plinth and its steps, and would also have refused Hollow
   * Creek's 0.30m boardwalks, which must be placeable.
   */
  const x0 = x - half;
  const x1 = x + half;
  const z0 = z - half;
  const z1 = z + half;
  const area = level.tile * level.tile;
  let covered = 0;

  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    // AABB overlap of the tile footprint against the box.
    if (x1 <= b.x0 || x0 >= b.x1 || z1 <= b.z0 || z0 >= b.z1) continue;
    if (b.kind === BOX.deck && !b.noBuild) continue; // boardwalks are buildable
    if (b.kind === BOX.prop) continue; // scenery does not block building

    /*
     * Standing ON it is always refused — you cannot build on top of a wall, a
     * pillar, or a plinth the author marked no-build.
     */
    const onIt = x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
    if (onIt) return false;

    covered += (Math.min(x1, b.x1) - Math.max(x0, b.x0)) *
      (Math.min(z1, b.z1) - Math.max(z0, b.z0));
  }

  /*
   * OVERLAP IS A MATTER OF DEGREE, and treating it as a yes/no was a real bug.
   *
   * The first version of this refused a tile that touched any solid geometry at all.
   * A perimeter wall is 0.6m thick and centred on the map boundary, so it reaches
   * 0.3m — 15% — into the first tile, and that killed **every border tile on every
   * map**: 76 of them on Boot Hill, plus a whole column beside each fence, right
   * where a player most wants to build.
   *
   * A tile is a trap bed if it is *mostly* open floor. A quarter is the line: a wall
   * or fence clipping an edge is fine, a crypt eating half the tile is not. The
   * centre test above is what stops that generosity from letting anything sit inside
   * a pillar.
   */
  return covered <= area * 0.25;
}

/**
 * Direction toward the Rift from an arbitrary point, robust to dead cells.
 *
 * **Why this exists, and why it is not optional.** `blocked` is inflated by the
 * agent radius so the field never routes a body into a wall — but collision only
 * pushes bodies out of *actual* geometry. A body can therefore legally stand in a
 * cell the field considers blocked: just outside a crypt, inside its 0.45m skirt.
 * Such a cell has `dist = Infinity` and zero flow, so a body there received no
 * direction at all and froze in place forever, **softlocking the round** — it
 * could never reach the Rift, and the round could never clear.
 *
 * Found by six Dustkin standing motionless at (16.1, 10.1) on Boot Hill. It was
 * latent in the shipped M0 site too; that map simply never trapped anyone in a
 * skirt. The fallback is a ring search for the nearest cell that does know the
 * way, and failing that, straight at the Rift.
 *
 * Writes a unit direction into `out` (length 2) to stay allocation-free.
 */
export function flowDir(level: Level, x: number, z: number, out: Float64Array): void {
  const cell = cellOf(level, x, z);
  if (cell >= 0 && (level.flowX[cell] !== 0 || level.flowZ[cell] !== 0)) {
    out[0] = level.flowX[cell];
    out[1] = level.flowZ[cell];
    return;
  }

  if (cell >= 0) {
    const cx = cell % level.gw;
    const cz = (cell / level.gw) | 0;
    let bestDist = Infinity;
    let bestX = 0;
    let bestZ = 0;
    for (let r = 1; r <= 4 && !isFinite(bestDist); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          // Only the ring, not the square already searched.
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= level.gw || nz >= level.gh) continue;
          const ni = nz * level.gw + nx;
          if (level.blocked[ni] || !isFinite(level.dist[ni])) continue;
          if (level.dist[ni] < bestDist) {
            bestDist = level.dist[ni];
            bestX = (nx + 0.5) * level.cell - x;
            bestZ = (nz + 0.5) * level.cell - z;
          }
        }
      }
    }
    if (isFinite(bestDist)) {
      const l = Math.sqrt(bestX * bestX + bestZ * bestZ) || 1;
      out[0] = bestX / l;
      out[1] = bestZ / l;
      return;
    }
  }

  // Last resort: the Rift is that way. Better a body pressed against a wall than
  // a body that never moves again.
  const dx = level.rift.x - x;
  const dz = level.rift.z - z;
  const l = Math.sqrt(dx * dx + dz * dz) || 1;
  out[0] = dx / l;
  out[1] = dz / l;
}

/**
 * Ground height under (x, z), considering only surfaces at or below `maxY`.
 *
 * Two caps, and both matter:
 *
 *  - `maxY` stops a body snapping to the top of a 4m wall it is merely brushing.
 *  - **`b.y0` is honoured** (MAPS §9 item 3). Before this, any box whose footprint
 *    contained (x, z) contributed its `y1`, so a player walking *under* a catwalk
 *    was teleported onto it. That made decks — and therefore Shaft Nine's third
 *    axis — impossible. A surface only counts as ground if its underside is at or
 *    below where we are standing.
 *
 * Called from the player controller, the launch/landing code and the placement
 * ghost, so the contract change was written as a test first.
 */
export function groundHeight(level: Level, x: number, z: number, maxY = Infinity): number {
  let y = 0;
  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    if (b.y1 <= y || b.y1 > maxY) continue;
    // Standing under a raised deck must not snap us to its top face.
    if (b.y0 > maxY) continue;
    y = b.y1;
  }
  return y;
}
