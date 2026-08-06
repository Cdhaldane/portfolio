/*
 * render/actors.ts — the things that move.
 *
 * The hero and the roster are code-authored models (`render/models/`), assembled
 * here into the objects the renderer drives. Two shapes matter:
 *
 * **The hero is a rig, not a mesh.** §7 commits to a full-body camera, so the
 * player looks at this character for the entire run; a rigid model sliding across
 * the ground fails that on the first frame. It ships as seven parts around real
 * pivots (`HeroRig`) and `scene.ts` drives them procedurally from the sim's own
 * velocity. §17.6 replaces the *driver* with Mixamo clips later — the hierarchy
 * is already the one a skeleton would want.
 *
 * **Enemies are `InstancedMesh` from the very first spike**, not because 14 of
 * them need it but because the VAT crowd path at §14.3 is a retrofit nightmare if
 * the renderer was written around one-mesh-per-enemy. The instancing plumbing —
 * per-instance transforms, per-instance colour, a count that shrinks — is all
 * here already.
 *
 * One thing left the pool: heads. They used to be a second `InstancedMesh` per
 * archetype, needed only because a capsule has no head. Authored models have
 * their own, so that is one less draw call, one less matrix upload per body per
 * frame, and one less place for the two halves to disagree about where the neck
 * is.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
} from "three";
import { LIMITS } from "../sim/tuning.ts";
import { ENEMIES, type EnemyDef } from "../sim/enemies.ts";
import { TRAPS } from "../sim/traps.ts";
import { COLOR } from "./palette.ts";
import { RIM, attachOutline, instancedOutline, toonMaterial } from "./materials.ts";
import { buildTrapGeometry } from "./models/traps.ts";
import {
  JOINTS,
  buildHeroParts,
  defaultHeroId,
  type HeroId,
} from "./models/hero.ts";
import { buildEnemyGeometry, buildWingGeometry, wingHinge } from "./models/enemies.ts";

/* ── the hero ────────────────────────────────────────────────────────────── */

/**
 * The joints `scene.ts` animates. Named for what they do rather than for the
 * bones they stand in for, because the procedural driver thinks in swings and
 * leans, not in a skeleton.
 */
export interface HeroRig {
  group: Group;
  /** Whole-body vertical offset: the walk bob and the airborne tuck. */
  body: Group;
  /** Hips: sway and the lean into a run. */
  hips: Group;
  head: Group;
  armR: Group;
  armL: Group;
  legR: Group;
  legL: Group;
  /** Muzzle, in world space once the rig has been updated. */
  gunTip: Object3D;
}

/**
 * One material for every part of the hero.
 *
 * Colour lives in the vertex stream (§17.1 "one flat colour per part"), so seven
 * parts still share one material and one shader. Roughness is high and metalness
 * near zero: this is wool, leather and bone, and a shiny hero under a night sky
 * picks up specular highlights that fight the silhouette.
 */
function heroMaterial() {
  // §17.1's banded ramp, via render/materials.ts. Roughness and metalness are gone
  // with PBR and are not missed: under a hard terminator they were doing nothing a
  // value change couldn't do better, and a shiny hero picked up specular
  // highlights that fought the silhouette.
  //
  // The hero takes the strongest rim in the game. It is on screen 100% of the
  // time, seen from behind — the side the moon never lights — and §17.1's
  // never-mid-on-mid rule is unsatisfiable for it by any key light.
  return toonMaterial({ rim: RIM.character });
}

/**
 * Build a hero rig.
 *
 * Which body it is turns out to be the *only* thing this function needs to know
 * about the choice, and nothing downstream needs to know at all: `scene.ts` and
 * the procedural locomotion driver read joints and parts, so a second hero is
 * data (HEROES.md §4). That is the payoff of the shared-rig contract, and it is
 * why the argument has a default — the call sites never had to change.
 */
export function buildHero(hero: HeroId = defaultHeroId()): HeroRig {
  const parts = buildHeroParts(hero);
  const JOINT = JOINTS[hero];
  const material = heroMaterial();

  const limb = (geometry: BufferGeometry, x: number, y: number): Group => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    // The hull is a child, so it follows the joint it hangs off with no per-frame
    // bookkeeping — which is the only reason outlining an animated rig is cheap.
    attachOutline(mesh);
    pivot.add(mesh);
    return pivot;
  };

  const group = new Group();
  const body = new Group();
  group.add(body);

  // Legs hang off the body, not off the hips, so a hip lean doesn't take the
  // feet with it — the fastest way to make procedural locomotion look drunk.
  const legR = limb(parts.legR, JOINT.hipX, JOINT.legTop);
  const legL = limb(parts.legL, -JOINT.hipX, JOINT.legTop);
  body.add(legR, legL);

  const hips = new Group();
  hips.position.y = JOINT.hips;
  body.add(hips);

  // Everything above the waist is authored around the hip pivot, so the torso
  // mesh itself hangs at the origin of `hips`.
  const torso = new Mesh(parts.torso, material);
  torso.castShadow = true;
  attachOutline(torso);
  hips.add(torso);

  const lantern = new Mesh(parts.lantern, material);
  // On the left hip, clear of the holster and of the gun arm's swing. -0.1 in
  // hip space is the 0.84m the geometry was shaded for (models/hero.ts).
  lantern.position.set(-0.24, -0.1, -0.04);
  hips.add(lantern);

  const head = limb(parts.head, 0, JOINT.neck - JOINT.hips);
  hips.add(head);

  const armR = limb(parts.armR, JOINT.shoulderX, JOINT.shoulder - JOINT.hips);
  const armL = limb(parts.armL, -JOINT.shoulderX, JOINT.shoulder - JOINT.hips);
  hips.add(armR, armL);

  // The revolver rides the gun hand. Authored along -Y in the arm's own space,
  // so raising the arm to level also levels the barrel (models/hero.ts).
  const revolver = new Mesh(parts.revolver, material);
  revolver.position.y = -0.62;
  revolver.castShadow = true;
  armR.add(revolver);

  const gunTip = new Object3D();
  gunTip.position.set(0, -0.4, 0);
  revolver.add(gunTip);

  return { group, body, hips, head, armR, armL, legR, legL, gunTip };
}

/* ── blob shadows ────────────────────────────────────────────────────────── */

/**
 * A soft round shadow, as geometry with **vertex alpha**.
 *
 * §14.4 is explicit that the horde does not cast real shadows — 200 skinned
 * shadow draws is the entire shadow-pass budget — and gets "a soft blob-shadow
 * decal projected on the ground" instead. Without one, every body in the
 * baseline screenshot floats: a shadow is the only thing that says where a
 * *flier* is over the ground, which is mechanically load-bearing for an enemy
 * whose whole argument is that it is above your traps (§8).
 *
 * The falloff is a 4-component colour attribute rather than a texture, so this
 * costs no image, no fetch and no atlas slot. three enables `USE_COLOR_ALPHA`
 * off the attribute's itemSize, and the material's alpha then multiplies down to
 * nothing at the rim.
 */
function buildBlobShadowGeometry(): BufferGeometry {
  const SEG = 18;
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];

  const push = (x: number, z: number, a: number): void => {
    pos.push(x, 0, z);
    nrm.push(0, 1, 0);
    col.push(1, 1, 1, a);
  };

  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    // Centre → rim → rim, wound so the disc faces +Y.
    push(0, 0, 1);
    push(Math.cos(a1), Math.sin(a1), 0);
    push(Math.cos(a0), Math.sin(a0), 0);
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 4));
  g.computeBoundingSphere();
  return g;
}

/** One pool for every shadow in the scene — hero included. One draw call. */
export function buildShadowPool(count: number): InstancedMesh {
  const mesh = new InstancedMesh(
    buildBlobShadowGeometry(),
    new MeshBasicMaterial({
      color: 0x000000,
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
    count,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;
  // Over the floor and the grid, under the traps' reach rings.
  mesh.renderOrder = 2;
  return mesh;
}

/* ── enemies ─────────────────────────────────────────────────────────────── */

/**
 * One instanced pool per enemy archetype, plus wing pools for the fliers.
 *
 * Silhouette is the only thing that identifies an enemy at 40 bodies on screen
 * (§1: legible chaos), so a Dustkin, an Ironjaw and a Buzzard must not be the
 * same capsule at different scales. Per-def pools also keep the VAT crowd path at
 * §14.3 a drop-in: each archetype already has its own mesh, material and instance
 * buffers.
 */
export interface EnemyPool {
  /** Indexed by EnemyDef.id. */
  bodies: InstancedMesh[];
  /**
   * Indexed by EnemyDef.id; null for anything that doesn't fly. Wings are their
   * own pools so they can rotate about a hinge — the flap has to be a transform,
   * because an `InstancedMesh` cannot deform per instance without the VAT shader
   * that is still §14.3's future work.
   */
  wings: ({ left: InstancedMesh; right: InstancedMesh; y: number; z: number } | null)[];
  /**
   * Inverted-hull outlines, one per body pool, sharing their transform buffers
   * (§17.1). `scene.ts` must mirror `count` onto these every frame — the matrices
   * arrive on their own, the count does not.
   */
  outlines: InstancedMesh[];
  /** Deterministic per-index cosmetic variation, so no two read identically. */
  scale: Float32Array;
  tint: Float32Array;
  /** Per-index gait offset, so a crowd doesn't march in lockstep. */
  phase: Float32Array;
}

function enemyMaterial() {
  // Instance colour carries state, vertex colour carries identity, and the ramp
  // carries the style (§17.1). The armour roughness/metalness split is gone with
  // PBR — an Ironjaw now reads as armoured by its silhouette and its darker
  // `grave` vertex colour, which is how §1 wanted it identified anyway.
  return toonMaterial({ rim: RIM.character });
}

/** Exported so the shelf scene (render/shelf.ts) shows the real silhouettes. */
export function enemyBodyGeometry(def: EnemyDef): BufferGeometry {
  return buildEnemyGeometry(def);
}

export function buildEnemyPool(): EnemyPool {
  const n = LIMITS.maxEnemies;
  const bodies: InstancedMesh[] = [];
  const wings: EnemyPool["wings"] = [];
  const outlines: InstancedMesh[] = [];

  for (let d = 0; d < ENEMIES.length; d++) {
    const def = ENEMIES[d];

    const body = new InstancedMesh(buildEnemyGeometry(def), enemyMaterial(), n);
    body.castShadow = false; // §14.4: the horde gets blob shadows, not real ones
    body.frustumCulled = false;
    body.count = 0;
    bodies.push(body);
    // One extra draw call per archetype for the whole horde's outlines.
    outlines.push(instancedOutline(body));

    if (!def.flying) {
      wings.push(null);
      continue;
    }

    const hinge = wingHinge(def);
    const wing = (side: 1 | -1): InstancedMesh => {
      const mesh = new InstancedMesh(buildWingGeometry(def, side), enemyMaterial(), n);
      mesh.frustumCulled = false;
      mesh.count = 0;
      return mesh;
    };
    wings.push({ left: wing(-1), right: wing(1), y: hinge.y, z: hinge.z });
  }

  // Variation baked once at build time: same every run, costs nothing per frame.
  const scale = new Float32Array(n);
  const tint = new Float32Array(n);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // A cheap hash of the index — deterministic and stream-free.
    const h = ((i * 2654435761) >>> 0) / 4294967296;
    scale[i] = 0.9 + h * 0.22;
    tint[i] = 0.82 + (((i * 40503) >>> 0) % 100) / 100 * 0.3;
    phase[i] = (((i * 2246822519) >>> 0) / 4294967296) * Math.PI * 2;
  }

  return { bodies, wings, outlines, scale, tint, phase };
}

/* ── traps ───────────────────────────────────────────────────────────────── */

/**
 * One instanced pool per trap type, plus a shared radius ring.
 *
 * Five traps that all looked like the same grey plate would defeat the point of
 * having five traps (§1: legible chaos). Each gets its own silhouette and its own
 * element colour, and the ring shows its actual reach — a trap whose radius you
 * can't see is a trap you can't plan around.
 */
export interface TrapPool {
  /** Indexed by TrapDef.id. */
  bodies: InstancedMesh[];
  rings: InstancedMesh[];
  /** Inverted hulls sharing the body pools' transform buffers. Mirror `count`. */
  outlines: InstancedMesh[];
}

export function buildTrapPool(): TrapPool {
  const n = LIMITS.maxTraps;
  const bodies: InstancedMesh[] = [];
  const rings: InstancedMesh[] = [];
  const outlines: InstancedMesh[] = [];

  for (let i = 0; i < TRAPS.length; i++) {
    const def = TRAPS[i];

    const body = new InstancedMesh(
      // Code-authored cartoony models (§23.1 decision 15). Per-part colour is
      // baked into the vertex stream, because an InstancedMesh gets exactly one
      // material — so `vertexColors` is not optional here, and the per-instance
      // colour in scene.ts modulates *state* rather than hue.
      buildTrapGeometry(def.key),
      // Props take a weaker rim than characters: a trap sits on the floor with the
      // ground behind it, not sky, so it needs less help separating (§17.1).
      toonMaterial({ rim: RIM.prop }),
      n,
    );
    body.frustumCulled = false;
    body.receiveShadow = true;
    body.count = 0;
    bodies.push(body);
    outlines.push(instancedOutline(body));

    const ring = new InstancedMesh(
      new RingGeometry(Math.max(0.1, def.radius - 0.09), def.radius, 24),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55,
        side: DoubleSide,
        depthWrite: false,
      }),
      n,
    );
    ring.frustumCulled = false;
    ring.count = 0;
    ring.renderOrder = 4;
    rings.push(ring);
  }

  return { bodies, rings, outlines };
}

/** The translucent cell under the crosshair while building. */
/**
 * The placement ghost, sized to a build tile.
 *
 * Scaled at render time from `level.tile` rather than baked, so the one tile-size
 * constant still governs it — a ghost that disagreed with the grid overlay by even a
 * little would make every placement feel imprecise.
 */
export function buildPlacementGhost(): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1, 0.06, 1),
    new MeshBasicMaterial({ color: COLOR.hex, transparent: true, opacity: 0.35 }),
  );
  mesh.visible = false;
  return mesh;
}

export const GHOST_OK = new Color(COLOR.hex);
export const GHOST_BAD = new Color(COLOR.oxblood);
