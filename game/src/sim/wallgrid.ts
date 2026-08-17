/*
 * sim/wallgrid.ts — walls as a placement lattice.
 *
 * This replaces the authored-mount model from M1.1, and the reversal is deliberate
 * rather than a correction of a bug. That model listed the faces a trap could bolt
 * to, which made wall traps scarce on purpose — Boot Hill offered three mounts on
 * forty faces of geometry. Playing it, scarcity read as *arbitrariness*: there is
 * nothing about the third crypt that explains why it takes iron and the fence does
 * not, and a player cannot plan around a rule they cannot see the shape of.
 *
 * So the polarity flips. **Every exposed wall face is a lattice of build tiles**,
 * derived from the geometry the same way the floor grid is, and a map declares the
 * faces that REFUSE traps instead of the ones that accept them. Exclusions are the
 * rare, explicable case — a rock rib, a chapel wall, something the fiction says you
 * do not hammer into — and they are painted a different colour, so the rule is
 * legible from across the room instead of being discovered by clicking.
 *
 * Three properties fall out of deriving rather than authoring:
 *
 *  1. **Nothing to keep in sync.** A map that grows a building grows wall tiles.
 *     `UNDERTOWN_SURFACES` had to be hand-listed and hand-counted; this does not.
 *  2. **The census stops being a promise and becomes a measurement** (MAPS §3 G7).
 *  3. **Placement is exact, not snapped.** A face lattice has real cells, so the
 *     crosshair can raycast onto one instead of picking the nearest thing within a
 *     forgiving cone — the aim tolerance M1.1 needed was a symptom of the mounts
 *     being sparse points rather than a surface.
 */

import { BOX, isSolidKind, type Level } from "./level.ts";
import { SIDE, SURF, sideNormalX, sideNormalZ, type Side } from "./surfaces.ts";

/**
 * Wall tiles get their own cell-id range, above `SLOT_BASE`.
 *
 * Same trick and the same reason: one `cell` field identifies any placement — floor
 * tile, authored mount, or wall tile — so commands, `trapAtCell`, sell, upgrade and
 * the replay format stay untouched.
 */
export const WALL_BASE = 2_000_000;

export const wallCellOf = (index: number): number => WALL_BASE + index;

/** The wall tile a cell id refers to, or -1. */
export function wallOfCell(cellId: number): number {
  return cellId >= WALL_BASE ? cellId - WALL_BASE : -1;
}

export interface WallTile {
  /** Centre of the tile, pushed just clear of the face so nothing z-fights. */
  x: number;
  y: number;
  z: number;
  side: Side;
  /** Authored refusal: rendered in a different material and never placeable. */
  noBuild: boolean;
}

/** An authored no-build region, in metres. Any wall tile inside it refuses traps. */
export interface NoBuildRegion {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Optional height band; omitted means the whole face. */
  y0?: number;
  y1?: number;
  /** Shown nowhere yet, but it keeps the map readable to the next person. */
  why?: string;
}

/** How far off the face a trap's origin sits. Keeps meshes out of the masonry. */
export const FACE_OFFSET = 0.06;

/** Below this a "wall" is a kerb. Nothing mounts there. */
const MIN_MOUNT_Y = 0.5;

/**
 * One square of a wall's grid.
 *
 * `cu`/`cy` are the centre — where a trap mounts. `u0..u1`/`y0..y1` are the square
 * clipped to the wall it lies on — where the masonry is drawn. They differ only at a
 * wall's ends, where a square is cut short by the geometry but keeps its centre.
 */
export interface FaceSquare {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  cu: number;
  cy: number;
}

/**
 * The grid squares on one wall face — **the single definition of where a wall's grid
 * is**, used by the build lattice and by the mesher that draws the courses.
 *
 * It exists because they were two implementations, and they disagreed. The lattice
 * counted rows up from a minimum mount height and the mesher divided each face into
 * equal parts, so on a 4m wall traps mounted at y = 1.8 and 3.8 while the visible
 * courses sat at 1 and 3 — every trap floating 0.8m above the square it appeared to be
 * on. Two schemes that happen to agree are a coincidence waiting to end; one that both
 * callers read is a fact.
 *
 * **Squares are world-aligned, exactly like the floor.** `tileOf` buckets the floor by
 * `floor(x / tile)`, so floor centres land on odd metres; bucketing walls the same way
 * puts a wall square directly above the floor square beneath it and makes a two-square
 * wall read as two squares. Centring the lattice on each *face* instead — which is what
 * the mesher did — means two walls meeting at a corner have courses that do not line
 * up, and no amount of texturing hides that.
 *
 * A square is kept when at least three quarters of it lies on the wall. That threshold
 * also guarantees its centre does, so a trap can never mount on a square that is mostly
 * hanging off the end of a fence.
 */
export function faceSquares(
  uFrom: number,
  uTo: number,
  yFrom: number,
  yTo: number,
  tile: number,
): FaceSquare[] {
  const out: FaceSquare[] = [];
  const enough = tile * 0.75;

  const uStart = Math.floor(uFrom / tile);
  const uEnd = Math.floor((uTo - 1e-9) / tile);
  const yStart = Math.floor(yFrom / tile);
  const yEnd = Math.floor((yTo - 1e-9) / tile);

  for (let bu = uStart; bu <= uEnd; bu++) {
    const bu0 = bu * tile;
    const bu1 = bu0 + tile;
    const u0 = Math.max(bu0, uFrom);
    const u1 = Math.min(bu1, uTo);
    if (u1 - u0 < enough) continue;

    for (let by = yStart; by <= yEnd; by++) {
      const by0 = by * tile;
      const by1 = by0 + tile;
      const y0 = Math.max(by0, yFrom);
      const y1 = Math.min(by1, yTo);
      if (y1 - y0 < enough) continue;
      const cy = by0 + tile / 2;
      if (cy < MIN_MOUNT_Y) continue;
      out.push({ u0, u1, y0, y1, cu: bu0 + tile / 2, cy });
    }
  }
  return out;
}

/** The four vertical faces of a box, parameterised for `faceSquares`. */
export function boxFaces(b: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}): { ox: number; oz: number; ux: number; uz: number; uFrom: number; uTo: number; side: Side }[] {
  return [
    { ox: b.x1, oz: 0, ux: 0, uz: 1, uFrom: b.z0, uTo: b.z1, side: SIDE.east },
    { ox: b.x0, oz: 0, ux: 0, uz: 1, uFrom: b.z0, uTo: b.z1, side: SIDE.west },
    { ox: 0, oz: b.z1, ux: 1, uz: 0, uFrom: b.x0, uTo: b.x1, side: SIDE.south },
    { ox: 0, oz: b.z0, ux: 1, uz: 0, uFrom: b.x0, uTo: b.x1, side: SIDE.north },
  ];
}

/**
 * Is the space just outside this face open?
 *
 * A face buried in another box — the inside of a party wall, the back of a building
 * pushed against rock — is not a surface anybody can reach, and offering tiles on it
 * would put traps inside solid geometry. Probing a point rather than doing exact
 * face-vs-face clipping is the right trade: it is O(boxes) per face instead of
 * O(boxes²), and the failure it can produce (a tile on a face that is *mostly*
 * buried) is cosmetic, where the failure exact clipping would still have — a face
 * flush against another — is the same one.
 */
function faceIsExposed(level: Level, x: number, y: number, z: number, side: Side): boolean {
  const px = x + sideNormalX(side) * 0.5;
  const pz = z + sideNormalZ(side) * 0.5;
  if (px < 0 || pz < 0 || px > level.width || pz > level.depth) return false;
  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    if (!isSolidKind(b.kind)) continue;
    if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1 && y > b.y0 && y < b.y1) {
      return false;
    }
  }
  return true;
}

function inRegion(r: NoBuildRegion, x: number, y: number, z: number): boolean {
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return false;
  if (r.y0 !== undefined && y < r.y0) return false;
  if (r.y1 !== undefined && y > r.y1) return false;
  return true;
}

/**
 * Subdivide every exposed wall face into build tiles.
 *
 * Faces are walked in a fixed order — box index, then side, then column, then row —
 * so a wall tile's id is stable for a given level. That matters more than it looks:
 * ids go into recorded commands, so an unstable ordering would make replays
 * reproduce a *different placement* on the same input (§13 rule 4).
 */
export function buildWallTiles(level: Level, noBuild: NoBuildRegion[] = []): WallTile[] {
  const out: WallTile[] = [];
  const step = level.tile;

  for (let i = 0; i < level.boxes.length; i++) {
    const b = level.boxes[i];
    // Only real, standing geometry has faces worth mounting on. Decks and props are
    // walkables and scenery; a 0.9m headstone is not a wall.
    if (!isSolidKind(b.kind) || b.kind === BOX.step) continue;
    if (b.y1 - b.y0 < MIN_MOUNT_Y + step * 0.5) continue;

    for (const f of boxFaces(b)) {
      for (const sq of faceSquares(f.uFrom, f.uTo, b.y0, b.y1, step)) {
        const x = f.ux !== 0 ? sq.cu : f.ox;
        const z = f.uz !== 0 ? sq.cu : f.oz;
        if (!faceIsExposed(level, x, sq.cy, z, f.side)) continue;
        let refused = false;
        for (let n = 0; n < noBuild.length; n++) {
          if (inRegion(noBuild[n], x, sq.cy, z)) {
            refused = true;
            break;
          }
        }
        out.push({
          x: x + sideNormalX(f.side) * FACE_OFFSET,
          y: sq.cy,
          z: z + sideNormalZ(f.side) * FACE_OFFSET,
          side: f.side,
          noBuild: refused,
        });
      }
    }
  }
  return out;
}

/**
 * The wall tile a ray hits, or -1.
 *
 * Exact rather than snapped: the crosshair has to land ON the tile, the way the floor
 * grid works. `maxT` is generous because you build from across a room, but a face you
 * cannot see is never a face you can build on — the ray stops at the first thing it
 * meets, which is what makes shooting through your own crosshair honest.
 */
export function wallTileAtRay(
  tiles: WallTile[],
  level: Level,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  let best = -1;
  let bestT = maxT;
  const half = level.tile / 2;

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const nx = sideNormalX(t.side);
    const nz = sideNormalZ(t.side);
    // Facing away? Not a surface you are looking at.
    const denom = dx * nx + dz * nz;
    if (denom > -1e-6) continue;
    const hit = ((t.x - ox) * nx + (t.z - oz) * nz) / denom;
    if (hit < 0.2 || hit >= bestT) continue;

    const hx = ox + dx * hit;
    const hy = oy + dy * hit;
    const hz = oz + dz * hit;
    if (hy < t.y - half || hy > t.y + half) continue;
    // Along the face: X for a north/south face, Z for an east/west one.
    const along = nx !== 0 ? hz - t.z : hx - t.x;
    if (along < -half || along > half) continue;

    bestT = hit;
    best = i;
  }
  return best;
}

/** Counts for the surface census (MAPS §3 G7), measured rather than promised. */
export function wallCensus(tiles: WallTile[]): { wall: number; noBuild: number } {
  let wall = 0;
  let noBuild = 0;
  for (const t of tiles) {
    if (t.noBuild) noBuild++;
    else wall++;
  }
  return { wall, noBuild };
}

export const WALL_SURFACE = SURF.wall;
