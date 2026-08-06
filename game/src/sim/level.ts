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
import { type OpenableDef } from "./undertown.ts";
import { siteDef, siteForRound, type GateDef } from "./sites.ts";
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

/** The mount a synthetic cell id refers to, or -1 if it's an ordinary floor cell. */
export function slotOfCell(cellIndex: number): number {
  return cellIndex >= SLOT_BASE ? cellIndex - SLOT_BASE : -1;
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
  /** Scratch for `wouldSealLane`'s reachability passes. Never read outside it. */
  reachScratch: Uint8Array;
  reachQueue: Int32Array;
  /** Unit direction toward the Rift per cell. */
  flowX: Float32Array;
  flowZ: Float32Array;
}

// ── flow field bake ────────────────────────────────────────────────────────

function bakeBlocked(level: Level): void {
  const { gw, gh, cell, boxes, blocked } = level;
  const pad = DUSTKIN.radius;
  blocked.fill(0);
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    // Only solid geometry tall enough to stop a walker blocks the field, and the
    // same predicate governs collision (see isSolidKind).
    if (!isSolidKind(box.kind) || box.y1 < 1.0) continue;
    const cx0 = Math.max(0, Math.floor((box.x0 - pad) / cell));
    const cx1 = Math.min(gw - 1, Math.floor((box.x1 + pad) / cell));
    const cz0 = Math.max(0, Math.floor((box.z0 - pad) / cell));
    const cz1 = Math.min(gh - 1, Math.floor((box.z1 + pad) / cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) blocked[cz * gw + cx] = 1;
    }
  }
  /* Player-built blockades block the field too, or the whole trap would do nothing.
     They are padded identically: a body has to fit past one, not clip it. */
  for (let i = 0; i < level.blockBoxes.length; i++) {
    const box = level.blockBoxes[i];
    const cx0 = Math.max(0, Math.floor((box.x0 - pad) / cell));
    const cx1 = Math.min(gw - 1, Math.floor((box.x1 + pad) / cell));
    const cz0 = Math.max(0, Math.floor((box.z0 - pad) / cell));
    const cz1 = Math.min(gh - 1, Math.floor((box.z1 + pad) / cell));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) blocked[cz * gw + cx] = 1;
    }
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
    slots: def.surfaces,
    rift: def.rift,
    playerStart: def.playerStart,
    atmosphere: def.atmosphere ?? OPEN_AIR,
    openables: def.openables ?? [],
    open: (def.openables ?? []).map(() => false),
    blockTiles: new Uint8Array(tw * th),
    blockBoxes: [],
    blocked: new Uint8Array(gw * gh),
    dist: new Float32Array(gw * gh),
    flowX: new Float32Array(gw * gh),
    flowZ: new Float32Array(gw * gh),
    reachScratch: new Uint8Array(gw * gh),
    reachQueue: new Int32Array(gw * gh),
  };
  rebake(level);
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
  bakeBlockades(level);
  bakeBlocked(level);
  bakeDistance(level);
  bakeFlow(level);
  // The census is recounted, never authored. Hollow Creek lets the player change
  // the geometry mid-site, so even the floor count is not a constant — and the
  // director makes roster decisions from these numbers (MAPS §3 G7).
  level.census = censusOf(level.slots, placeableCount(level), level.census.env);
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
 */
export function wouldSealLane(level: Level, tile: number): boolean {
  if (tile < 0 || tile >= level.blockTiles.length) return false;
  if (level.blockTiles[tile]) return false; // already there, nothing changes

  const gates = level.gates;
  if (gates.length === 0) return false;

  // Reachability as it stands, then as it would be.
  reach(level, -1);
  const before = level.reachScratch;
  const wasReachable: boolean[] = [];
  for (let i = 0; i < gates.length; i++) {
    const c = cellOf(level, gates[i].x, gates[i].z);
    wasReachable.push(c >= 0 && before[c] === 1);
  }

  reach(level, tile);
  const after = level.reachScratch;
  for (let i = 0; i < gates.length; i++) {
    if (!wasReachable[i]) continue;
    const c = cellOf(level, gates[i].x, gates[i].z);
    if (c < 0 || after[c] !== 1) return true;
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
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const nz = z + (d === 2 ? 1 : d === 3 ? -1 : 0);
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
  const s = slotOfCell(tileId);
  if (s >= 0) return level.slots[s]?.x ?? 0;
  return ((tileId % level.tw) + 0.5) * level.tile;
}

export function tileCenterZ(level: Level, tileId: number): number {
  const s = slotOfCell(tileId);
  if (s >= 0) return level.slots[s]?.z ?? 0;
  return (((tileId / level.tw) | 0) + 0.5) * level.tile;
}

/** Mount height, or the ground under a floor tile. */
export function tileCenterY(level: Level, tileId: number): number {
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
  const s = slotOfCell(tileId);
  if (s >= 0) {
    const slot = level.slots[s];
    return slot !== undefined && slot.surface === surface;
  }
  return surface === SURF.floor && isPlaceable(level, tileId);
}

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

  // Reachable ground: a tile in a sealed void is not a trap bed.
  const nav = cellOf(level, x, z);
  if (nav < 0 || !isFinite(level.dist[nav])) return false;

  // The Rift's own ring stays clear, footprint and all (§21.1 note 3).
  const dx = x - level.rift.x;
  const dz = z - level.rift.z;
  const keepOut = level.rift.radius + half;
  if (dx * dx + dz * dz < keepOut * keepOut) return false;

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
  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    // AABB overlap of the tile footprint against the box.
    if (x1 <= b.x0 || x0 >= b.x1 || z1 <= b.z0 || z0 >= b.z1) continue;
    if (b.noBuild) return false; // the author said so
    if (b.kind === BOX.deck) continue; // boardwalks are buildable
    if (b.kind === BOX.prop) continue; // scenery does not block building
    if (b.y1 < 1.0) return false; // steps and low cover: not a trap surface
    return false; // any solid geometry under the footprint
  }
  return true;
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
