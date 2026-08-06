/*
 * render/scene.ts — everything three.js, and nothing else.
 *
 * Reads interpolated sim state once per frame and writes transforms. It never
 * mutates the world, and the sim never imports this file (§12.2) — that
 * boundary is what makes the headless tests and replays possible.
 */

import {
  BackSide,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  RingGeometry,
  Scene,
  PlaneGeometry,
  InstancedMesh,
  Vector3,
  WebGLRenderer,
  CylinderGeometry,
  DoubleSide,
} from "three";

import { cameraPose, makePose, rightX, rightZ } from "../sim/aim.ts";
import type { Listener } from "../audio/index.ts";
import { EV } from "../sim/events.ts";
import { cellOfSlot, groundHeight, tileCenterX, tileCenterY, tileCenterZ } from "../sim/level.ts";
import { SKY } from "../sim/atmosphere.ts";
import { GhostPaths } from "./paths.ts";
import { SURF, sideYaw } from "../sim/surfaces.ts";
import { trapAtCell } from "../sim/world.ts";
import { lerp } from "../sim/math.ts";
import { ENEMIES } from "../sim/enemies.ts";
import { TRAPS, TRIGGER } from "../sim/traps.ts";
import { LIMITS, PLAYER } from "../sim/tuning.ts";
import { PHASE, type World } from "../sim/world.ts";
import {
  GHOST_BAD,
  buildEnemyPool,
  buildHero,
  buildPlacementGhost,
  buildShadowPool,
  buildTrapPool,
  type EnemyPool,
  type HeroRig,
  type TrapPool,
} from "./actors.ts";
import type { HeroId } from "./models/hero.ts";
import { Motes, Sparks } from "./fx.ts";
import { NUM, Numbers } from "./numbers.ts";
import { buildBoxGeometry, buildFloorGeometry, buildGridGeometry } from "./mesher.ts";
import { RIM, toonMaterial } from "./materials.ts";
import { Post } from "./post/index.ts";
import {
  applyRendererLook,
  applySceneAtmosphere,
  applySceneLighting,
  moonDirection,
} from "./look.ts";
import {
  buildDressingGeometry,
  buildHillsGeometry,
  buildSkyGeometry,
  buildStarfield,
} from "./models/props.ts";
import { COLOR, ELEM_SWATCH } from "./palette.ts";

const tmpMatrix = new Matrix4();
const tmpWing = new Matrix4();
const tmpRotation = new Matrix4();
const tmpScale = new Vector3();
const tmpColor = new Color();

/*
 * Status washes, as *multipliers* over the model's baked colours.
 *
 * Each is a swatch pulled most of the way back toward white, because these
 * multiply: a raw `hex` (0.31, 0.94, 0.88) over a brown rag gives a muddy green,
 * where the same hue at half strength reads as a body someone has marked. The
 * §3 colour contract still decides which hue means what; this only decides how
 * hard it lands.
 */
const SOAK_WASH = new Color(0x59636e);
const MARK_WASH = new Color(COLOR.hex).lerp(new Color(0xffffff), 0.45);
const BURN_WASH = new Color(COLOR.ember).lerp(new Color(0xffffff), 0.3);
const ELITE_WASH = new Color(COLOR.oxblood).lerp(new Color(0xffffff), 0.35);

export interface RenderStats {
  drawCalls: number;
  triangles: number;
}

export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private pose = makePose();
  private hero: HeroRig;
  private enemies: EnemyPool;
  private traps: TrapPool;
  /** Build-phase route preview (§4). Hidden the moment the bell rings. */
  private ghostPaths = new GhostPaths();
  private sparks = new Sparks();
  private motes = new Motes();
  private numbers: Numbers;
  /** Sky, stars and moon. Translated to the camera each frame — see buildSky. */
  private sky = new Group();
  /** One pool for every blob shadow on screen — the horde plus the hero (§14.4). */
  private shadows = buildShadowPool(LIMITS.maxEnemies + 1);
  /** Warm light carried by the hero, sourced from the lantern on their belt. */
  private heroLight: PointLight;
  /** Locomotion phase, advanced by distance travelled rather than by time. */
  private stride = 0;
  /** 0..1, how far the gun arm is up. Rises when firing, decays back to a rest. */
  private aimUp = 0;
  /** Recoil impulse, decayed per frame. */
  private recoil = 0;
  /** Milliseconds of hit stop the host should honour before its next step. */
  hitStopRequest = 0;
  /** How many mount marks are being drawn. Read by the debug hook only. */
  marksShown = 0;
  private ghost: Mesh;
  private ghostRing: Mesh;
  /**
   * Chalk squares on every free mount of the armed trap's class.
   *
   * This is the answer to "put a grid on the walls", and deliberately not a grid: a
   * uniform lattice would promise that any face takes iron, which is the exact claim
   * the surface census exists to deny (Boot Hill has three faces, not forty). Marks
   * at the real mount points tell the truth and are easier to aim at.
   */
  private slotMarks: InstancedMesh;
  /** Per-type live instance counts, reused each frame. */
  private trapCounts: Int32Array;
  private enemyCounts!: Int32Array;
  // Assigned by buildStatic(), which the constructor calls before anything reads
  // them; TS can't see through the indirection.
  private grid!: LineSegments;
  private gridMaterial!: LineBasicMaterial;
  private rift!: Mesh;
  private riftRing!: Mesh;
  private muzzleLight: PointLight;
  private muzzleTimer = 0;
  private shake = 0;
  private hurtFlash = 0;
  private time = 0;
  /** Presentation-owned: enemy facing, smoothed from velocity (§12.4 note). */
  private enemyYaw = new Float32Array(0);

  /**
   * The §14.5 post stack. Constructed last, because it needs the finished scene
   * and camera, and `resize()` immediately after gives it its real dimensions.
   */
  private post: Post;

  private readonly canvas: HTMLCanvasElement;
  /** Which body to build. Undefined defers to the URL, then to Amos. */
  private readonly heroId?: HeroId;

  constructor(canvas: HTMLCanvasElement, world: World, hero?: HeroId) {
    this.canvas = canvas;
    this.heroId = hero;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    // Tonemap, shadows and atmosphere come from render/look.ts, which the shelf
    // scene shares — a review scene lit differently from the game is worse than
    // no review scene at all.
    applyRendererLook(this.renderer);

    this.camera = new PerspectiveCamera(75, 1, 0.1, 220);

    applySceneAtmosphere(this.scene, world.level.atmosphere);

    this.buildSky(world);
    this.buildStatic(world);
    this.scene.add(this.shadows);
    // `undefined` falls through to `defaultHeroId()`, which reads `?hero=` —
    // so the URL still works for anyone bypassing the menu (a capture harness,
    // a bookmark), and the menu simply overrides it when it has an opinion.
    this.hero = buildHero(this.heroId);
    this.scene.add(this.hero.group);
    this.enemies = buildEnemyPool();
    for (let i = 0; i < this.enemies.bodies.length; i++) {
      this.scene.add(this.enemies.bodies[i], this.enemies.outlines[i]);
      const wings = this.enemies.wings[i];
      if (wings) this.scene.add(wings.left, wings.right);
    }
    this.enemyCounts = new Int32Array(this.enemies.bodies.length);
    this.enemyYaw = new Float32Array(world.enemies.alive.length);
    this.traps = buildTrapPool();
    for (let i = 0; i < this.traps.bodies.length; i++) {
      this.scene.add(this.traps.bodies[i], this.traps.rings[i], this.traps.outlines[i]);
    }
    this.ghost = buildPlacementGhost();
    this.scene.add(this.ghost);
    this.ghostRing = new Mesh(
      new RingGeometry(0.9, 1, 30),
      new MeshBasicMaterial({
        color: COLOR.hex.getHex(),
        transparent: true,
        opacity: 0.4,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.visible = false;
    this.ghostRing.renderOrder = 5;
    this.scene.add(this.ghostRing);
    // A plane per mount, unlit and depth-write-free so it reads as chalk on the
    // surface rather than a floating card.
    this.slotMarks = new InstancedMesh(
      new PlaneGeometry(0.62, 0.62),
      new MeshBasicMaterial({
        color: COLOR.bone.getHex(),
        transparent: true,
        opacity: 0.34,
        side: DoubleSide,
        depthWrite: false,
      }),
      64,
    );
    this.slotMarks.frustumCulled = false;
    this.slotMarks.visible = false;
    this.slotMarks.renderOrder = 4;
    this.scene.add(this.slotMarks);
    this.trapCounts = new Int32Array(this.traps.bodies.length);
    this.scene.add(this.sparks.mesh, this.motes.mesh, this.ghostPaths.mesh);

    this.numbers = new Numbers(canvas.parentElement ?? document.body);

    this.muzzleLight = new PointLight(COLOR.lamp.getHex(), 0, 9, 2);
    this.scene.add(this.muzzleLight);

    /*
     * The Vigil's lantern.
     *
     * Not decoration — it is the fix for the single worst thing in the baseline
     * screenshot, where a `grave` coat under nothing but moonlight and a low
     * bounce read as a black pill. A third-person camera only ever sees the side
     * of the hero facing *away* from any world light, so the hero needs a light
     * of their own, and §3's "grounded first, magic second" means it has to come
     * from something: hence the lantern modelled on the belt (models/hero.ts).
     *
     * Short range, so it lights the hero and the ground they stand on without
     * turning the night into an afternoon.
     */
    this.heroLight = new PointLight(COLOR.lamp.getHex(), 6.5, 7.5, 2);
    this.scene.add(this.heroLight);

    this.post = new Post(this.renderer, this.scene, this.camera);

    this.resize();
  }

  /**
   * Sky dome, stars and moon, parented to a group that follows the camera.
   *
   * Following matters for a mundane reason: the dome is 200m across and the far
   * plane is 220m, so a dome fixed at the site's centre would clip out of the
   * frustum the moment the player walked toward it. Translating it with the
   * viewer keeps every point of it at a constant distance. It never *rotates*,
   * which is why the moon disc can be oriented once at build time.
   */
  private buildSky(world: World): void {
    const level = world.level;
    /*
     * There is no sky thirty metres down (MAPS §5). Dome, starfield and moon disc
     * are all surface-only scenery, and drawing them inside a sealed cavern is the
     * single most obvious way to make the Undertown look like a field at night.
     */
    if (level.atmosphere.sky === SKY.cavern) return;
    const moon = moonDirection({ width: level.width, depth: level.depth });

    const sky = new Mesh(
      buildSkyGeometry(moon),
      new MeshBasicMaterial({
        vertexColors: true,
        side: BackSide,
        depthWrite: false,
        // Fogging the sky would flatten the gradient into one grey — the fog is
        // meant to blend the *world* into the sky, not the sky into itself.
        fog: false,
      }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -3;
    this.sky.add(sky);

    this.sky.add(buildStarfield());

    // The moon itself. Oriented once toward the group's origin, which is where
    // the camera always is.
    const disc = new Mesh(
      new CylinderGeometry(5.2, 5.2, 0.1, 22),
      new MeshBasicMaterial({ color: COLOR.sunbleach.getHex(), fog: false }),
    );
    disc.position.set(moon.x * 170, moon.y * 170, moon.z * 170);
    disc.lookAt(0, 0, 0);
    // lookAt aims -Z at the target; a cylinder's face is +Y, so tip it up.
    disc.rotateX(Math.PI / 2);
    disc.renderOrder = -2;
    this.sky.add(disc);

    this.scene.add(this.sky);
  }

  private buildStatic(world: World): void {
    const level = world.level;

    const floor = new Mesh(
      // The boxes are handed over so the floor can bake a contact shadow around
      // each one — the cheapest possible version of §14.4's baked AO.
      buildFloorGeometry(level.width, level.depth, level.boxes),
      toonMaterial({ rim: RIM.architecture }),
    );
    floor.receiveShadow = true;
    this.scene.add(floor);

    /*
     * The Bone Orchard: everything decorative, in one draw call.
     *
     * §3 names this site "headstones, iron fencing, a hanging tree, open
     * sightlines, wind" and none of it existed — the site was a floor, four
     * walls and some cover blocks. All of it is placed outside the perimeter or
     * under 20cm (see models/props.ts), so none of it can touch gameplay.
     */
    const dressing = new Mesh(
      buildDressingGeometry(level),
      toonMaterial({ rim: RIM.prop }),
    );
    dressing.castShadow = true;
    dressing.receiveShadow = true;
    this.scene.add(dressing);

    // Hills, sitting most of the way inside the fog so the site has a beyond.
    const hills = new Mesh(
      buildHillsGeometry(level),
      toonMaterial({ rim: RIM.architecture }),
    );
    this.scene.add(hills);

    // The whole site: one geometry, one draw call (§14.2).
    const boxes = new Mesh(
      buildBoxGeometry(level.boxes),
      toonMaterial({ rim: RIM.architecture }),
    );
    boxes.castShadow = true;
    boxes.receiveShadow = true;
    this.scene.add(boxes);

    this.gridMaterial = new LineBasicMaterial({
      color: COLOR.bone.getHex(),
      transparent: true,
      opacity: 0.05,
    });
    this.grid = new LineSegments(
      buildGridGeometry(level.width, level.depth, level.tile),
      this.gridMaterial,
    );
    this.scene.add(this.grid);

    // The Rift: a cold leak in the ground. The only cyan thing that isn't a
    // threat, and the thing you are protecting.
    this.rift = new Mesh(
      new CylinderGeometry(level.rift.radius * 0.55, level.rift.radius * 0.8, 5.5, 20, 1, true),
      new MeshBasicMaterial({
        color: COLOR.bell.getHex(),
        transparent: true,
        opacity: 0.16,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    this.rift.position.set(level.rift.x, 2.75, level.rift.z);
    this.scene.add(this.rift);

    this.riftRing = new Mesh(
      new RingGeometry(level.rift.radius * 0.9, level.rift.radius, 28),
      new MeshBasicMaterial({
        color: COLOR.bell.getHex(),
        transparent: true,
        opacity: 0.75,
        side: DoubleSide,
      }),
    );
    this.riftRing.rotation.x = -Math.PI / 2;
    this.riftRing.position.set(level.rift.x, 0.02, level.rift.z);
    this.scene.add(this.riftRing);

    const riftLight = new PointLight(COLOR.bell.getHex(), 9, 18, 2);
    riftLight.position.set(level.rift.x, 1.6, level.rift.z);
    this.scene.add(riftLight);

    /*
     * Gates burn warm so the two ends of the site never read the same.
     *
     * The two glowing posts that used to stand here are now a timber arch with
     * hanging lanterns, built as part of the dressing (models/props.ts). Only
     * the lights stay behind — one per lantern rather than one per gate, so the
     * glow has a visible source instead of hanging in the air.
     */
    for (const gate of level.gates) {
      for (const side of [-1.5, 1.5]) {
        const lamp = new PointLight(COLOR.ember.getHex(), 5, 15, 2);
        lamp.position.set(gate.x, 3.3, gate.z + side);
        this.scene.add(lamp);
      }
    }

    // Moonlight and bounce: see render/look.ts for why the moon is a cool value
    // rather than a cyan hue. Shared with the shelf scene.
    applySceneLighting(
      this.scene,
      { width: level.width, depth: level.depth },
      level.atmosphere,
    );
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Warm every shader before the first frame — §22 R4 (compile hitching). */
  async warmUp(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  /**
   * Read the sim's event ring into sparks, lights, numbers and shake.
   *
   * It does NOT clear the ring: audio reads the same events, and whoever clears
   * first would silence the other. The host owns the drain (§12.4's
   * EventFlushSystem drains to presentation *and* audio *and* UI).
   */
  consumeEvents(world: World): void {
    const ev = world.events;
    for (let i = 0; i < ev.count; i++) {
      const x = ev.x[i];
      const y = ev.y[i];
      const z = ev.z[i];
      switch (ev.kind[i]) {
        case EV.muzzle:
          this.muzzleTimer = 0.06;
          this.shake = Math.min(1, this.shake + 0.35);
          // §14.6 wants recoil as camera *and* animation offset. The camera half
          // is the shake above; this is the arm half, and it is what makes the
          // revolver look like it went off rather than emitted a light.
          this.recoil = 1;
          this.sparks.burst(x, y, z, 4, COLOR.lamp, 3.2, 0.07, 0.16);
          break;
        case EV.bulletImpact:
          this.sparks.burst(x, y, z, 5, COLOR.sunbleach, 2.4, 0.05, 0.3);
          break;
        case EV.enemyHit:
          this.sparks.burst(x, y, z, 6, COLOR.oxblood, 2.8, 0.07, 0.35);
          this.numbers.push(NUM.hit, x, y, z, ev.a[i]);
          break;
        case EV.enemyKilled:
          this.sparks.burst(x, y, z, 14, COLOR.oxblood, 3.4, 0.1, 0.6);
          this.sparks.burst(x, y, z, 6, COLOR.ash, 1.6, 0.14, 0.9);
          break;
        case EV.trapUpgraded:
          this.sparks.burst(x, 0.2, z, 16, COLOR.lamp, 2.6, 0.08, 0.6);
          break;
        case EV.trapFired:
          this.sparks.burst(x, 0.2, z, 12, COLOR.ember, 4.2, 0.09, 0.4);
          this.shake = Math.min(1, this.shake + 0.5);
          break;
        case EV.trapPlaced:
          this.sparks.burst(x, 0.15, z, 8, COLOR.hex, 1.8, 0.07, 0.4);
          break;
        case EV.trapSold:
          this.sparks.burst(x, 0.15, z, 6, COLOR.lamp, 1.5, 0.06, 0.35);
          break;
        case EV.ignite:
          // The headline synergy gets the biggest effect in the game so far.
          this.sparks.burst(x, y, z, 22, COLOR.ember, 4.6, 0.12, 0.75);
          this.sparks.burst(x, y, z, 10, COLOR.lamp, 2.2, 0.16, 1.1);
          this.shake = Math.min(1, this.shake + 0.55);
          // `a` is 0 when a *trap* was lit rather than a body ignited.
          if (ev.a[i] > 0) this.numbers.push(NUM.ignite, x, y, z, ev.a[i]);
          break;
        case EV.launched:
          this.sparks.burst(x, y, z, 10, COLOR.lamp, 3.4, 0.08, 0.45);
          break;
        case EV.statusApplied:
          this.sparks.burst(x, y, z, 2, COLOR.hex, 1.1, 0.05, 0.25);
          break;
        case EV.roundCleared:
          this.shake = Math.min(1, this.shake + 0.25);
          break;
        case EV.booted:
          // The signature verb gets a signature kick — and a hit stop, which is
          // what makes a kick *land* rather than just happen (§14.6).
          this.sparks.burst(x, y, z, 14, COLOR.lamp, 4.2, 0.1, 0.4);
          this.shake = Math.min(1, this.shake + 0.45);
          this.hitStopRequest = Math.max(this.hitStopRequest, 70);
          break;
        case EV.armourClang:
          // Sparks, not blood: the point is that this did nothing.
          this.sparks.burst(x, y, z, 7, COLOR.sunbleach, 3.6, 0.05, 0.22);
          this.numbers.push(NUM.clang, x, y, z, 0);
          break;
        case EV.playerHurt:
          this.hurtFlash = 1;
          this.shake = Math.min(1, this.shake + 0.7);
          this.numbers.push(NUM.hurt, x, y, z, ev.a[i]);
          break;
        case EV.enemyWindup:
          this.sparks.burst(x, y, z, 3, COLOR.oxblood, 1.2, 0.06, 0.3);
          break;
        case EV.leak:
          this.sparks.burst(x, y, z, 18, COLOR.bell, 3.0, 0.11, 0.8);
          this.shake = Math.min(1, this.shake + 0.7);
          break;
      }
    }
  }

  /**
   * Procedural locomotion for the hero rig.
   *
   * §17.6 routes real animation through Mixamo's 28-clip set, and this is not a
   * substitute for that — it is what stops the intervening milestones shipping a
   * statue. The whole thing is six sine waves off one phase, and the phase is
   * advanced by **distance travelled**, not by wall-clock time, which is the one
   * detail that makes it read: feet then keep pace with the ground at any speed,
   * and stop dead the moment the player does, with no blend tree.
   *
   * When the Mixamo clips land, this method is what gets replaced. The rig it
   * drives (`HeroRig`) is already the hierarchy a skeleton wants.
   */
  private animateHero(grounded: boolean, speed: number, dt: number): void {
    const rig = this.hero;

    // Stride length ~1.35m, so a 6.5 m/s walk is a bit under 5 steps a second.
    this.stride += (speed / 1.35) * Math.PI * dt;
    const walking = grounded && speed > 0.35;
    // Blend the whole gait out when standing still rather than freezing it
    // mid-step, which would leave one leg permanently forward.
    const gait = Math.min(1, speed / 3.2);
    const swing = walking ? Math.sin(this.stride) * 0.62 * gait : 0;
    const lift = walking ? Math.abs(Math.sin(this.stride)) : 0;

    // Legs counter-swing; arms follow the opposite leg, as they do on a person.
    rig.legR.rotation.x = swing;
    rig.legL.rotation.x = -swing;

    // Airborne: tuck the legs instead of running in mid-air.
    if (!grounded) {
      rig.legR.rotation.x = 0.55;
      rig.legL.rotation.x = 0.22;
    }

    // Two bobs per stride (one per foot), so the body drops as each foot lands.
    const bob = walking ? -lift * 0.045 * gait : Math.sin(this.time * 1.6) * 0.006;
    rig.body.position.y = bob;
    // A slight lean into the run, and a roll with the stride.
    rig.hips.rotation.x = -Math.min(0.16, speed * 0.016);
    rig.hips.rotation.z = walking ? Math.sin(this.stride) * 0.035 * gait : 0;
    // The head counter-rotates so it stays level — cheap, and it is most of what
    // separates "walking" from "being carried".
    rig.head.rotation.z = -rig.hips.rotation.z * 1.4;
    rig.head.rotation.x = -rig.hips.rotation.x * 0.7 + Math.sin(this.time * 1.3) * 0.012;

    /*
     * The gun arm. Rest is a low ready, firing brings it level.
     *
     * `+π/2` on the shoulder is exactly level, because the arm and the revolver
     * are both authored down the -Y axis (models/hero.ts) — the whole reason
     * they are is so that aiming is one number rather than a two-joint solve.
     */
    this.aimUp += ((this.muzzleTimer > 0 ? 1 : 0.42) - this.aimUp) * Math.min(1, dt * 9);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    rig.armR.rotation.x = this.aimUp * 1.5 + this.recoil * 0.5;
    rig.armR.rotation.z = -this.aimUp * 0.12;
    // The off arm swings with the walk and tucks when the gun comes up.
    rig.armL.rotation.x = -swing * 0.55 - this.aimUp * 0.25;
    rig.armL.rotation.z = 0.06;
  }

  /**
   * Write one blob shadow and return the next free slot.
   *
   * @param groundY the surface it lands on, so a body on the high ground casts
   *                onto the high ground rather than through it to the floor.
   * @param bodyY   where the body actually is; the gap between the two is the
   *                altitude, which spreads and fades the blob.
   */
  private pushShadow(
    index: number,
    x: number,
    z: number,
    groundY: number,
    bodyY: number,
    radius: number,
  ): number {
    if (index >= this.shadows.instanceMatrix.count) return index;
    const altitude = Math.max(0, bodyY - groundY);
    // Spread with height and give up entirely past 8m: a Buzzard at cruise is
    // over the walls, and a hard disc under it would read as a second enemy.
    const spread = 1 + Math.min(1.4, altitude * 0.22);
    if (altitude > 8) return index;
    const r = radius * spread * 0.5;
    tmpMatrix.makeScale(r, 1, r);
    tmpMatrix.setPosition(x, groundY + 0.03, z);
    this.shadows.setMatrixAt(index, tmpMatrix);
    return index + 1;
  }

  /**
   * Where the ears are. The camera position plus its right vector is everything
   * the stereo panner needs (audio/pool.ts explains why a PannerNode is overkill).
   */
  listener(world: World): Listener {
    return {
      x: this.pose.x,
      y: this.pose.y,
      z: this.pose.z,
      rightX: rightX(world.player.yaw),
      rightZ: rightZ(world.player.yaw),
    };
  }

  /**
   * @param alpha 0..1 between the previous and current sim tick (§12.3).
   * @param dt    real seconds since the last frame — for presentation-only motion.
   */
  render(world: World, alpha: number, dt: number, aimCell: number, canPlace: boolean): void {
    this.time += dt;

    // ── camera ────────────────────────────────────────────────────────────
    cameraPose(world, alpha, this.pose);
    this.shake = Math.max(0, this.shake - dt * 4.5);
    const shakeAmp = this.shake * this.shake * 0.045;
    this.camera.position.set(
      this.pose.x + Math.sin(this.time * 71) * shakeAmp,
      this.pose.y + Math.sin(this.time * 53) * shakeAmp,
      this.pose.z + Math.cos(this.time * 67) * shakeAmp,
    );
    this.camera.lookAt(
      this.pose.x + this.pose.dx,
      this.pose.y + this.pose.dy,
      this.pose.z + this.pose.dz,
    );
    if (this.camera.fov !== this.pose.fov) {
      this.camera.fov = this.pose.fov;
      this.camera.updateProjectionMatrix();
    }

    // ── hero ──────────────────────────────────────────────────────────────
    const p = world.player;
    const hx = lerp(p.px, p.x, alpha);
    const hy = lerp(p.py, p.y, alpha);
    const hz = lerp(p.pz, p.z, alpha);
    this.hero.group.position.set(hx, hy, hz);
    this.hero.group.rotation.y = lerp(p.pyaw, p.yaw, alpha);
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    this.animateHero(p.grounded, speed, dt);

    // The lantern sits on the left hip and the light should come from *there*,
    // not from the centre of the body — an off-centre source is most of what
    // makes a carried light read as carried.
    const yaw = this.hero.group.rotation.y;
    this.heroLight.position.set(
      hx - Math.cos(yaw) * 0.26,
      hy + 0.95,
      hz + Math.sin(yaw) * 0.26,
    );
    // A slow flicker, because it is an oil lamp.
    this.heroLight.intensity = 6.5 + Math.sin(this.time * 7.3) * 0.5 + Math.sin(this.time * 2.1) * 0.3;

    // ── enemies ───────────────────────────────────────────────────────────
    let shadowCount = 0;
    // The hero's own contact shadow. The moon casts a real one, but only from
    // one direction and only when they are not under geometry; the blob is what
    // keeps the feet attached to the ground everywhere else.
    shadowCount = this.pushShadow(
      shadowCount,
      hx,
      hz,
      groundHeight(world.level, hx, hz, hy + 0.2),
      hy,
      PLAYER.radius * 2.4,
    );

    const e = world.enemies;
    for (let k = 0; k < this.enemyCounts.length; k++) this.enemyCounts[k] = 0;

    for (let i = 0; i < e.alive.length; i++) {
      if (!e.alive[i]) continue;
      const defId = e.defId[i];
      const def = ENEMIES[defId];
      if (!def) continue;
      const body = this.enemies.bodies[defId];
      const n = this.enemyCounts[defId]++;

      const ex = lerp(e.px[i], e.x[i], alpha);
      const ey = lerp(e.py[i], e.y[i], alpha);
      const ez = lerp(e.pz[i], e.z[i], alpha);
      const s = this.enemies.scale[i] * (e.elite[i] === 1 ? 1.42 : 1);

      // Facing lives in render, not the sim: velocity → target yaw, smoothed.
      // (Math.atan2 is implementation-defined across JS engines, so it must never
      // touch simulation state — §13 rule 5.)
      const vx = e.vx[i];
      const vz = e.vz[i];
      if (vx * vx + vz * vz > 0.04) {
        const target = Math.atan2(-vx, -vz);
        let d = target - this.enemyYaw[i];
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.enemyYaw[i] += d * Math.min(1, dt * 9);
      }

      const held = e.hold[i] > 0;
      const winding = e.windup[i] > 0;
      // A clamped body lurches and shudders; a body mid-swing rears back. Both
      // are tells the player has to be able to read at a glance (§14.6).
      const lurch = held ? Math.sin(this.time * 26 + i) * 0.05 : 0;
      const squash = held ? 0.82 : 1;
      // Fliers bob so the altitude reads as flight rather than a floating bug.
      const bob = def.flying ? Math.sin(this.time * 6 + i * 1.7) * 0.16 : 0;

      /*
       * The shamble.
       *
       * §14.3 says real crowd animation is a VAT bake, and that is still the
       * plan — but a horde of perfectly rigid bodies gliding at you is the
       * single most obvious "unfinished" tell a game can have, and it costs
       * nothing to fix approximately. Phase comes from the per-instance hash so
       * forty bodies never march in step, and the rate comes from the enemy's
       * own speed so a Buzzard doesn't shuffle like a Dustkin.
       *
       * Three components, all folded into the one matrix that was already being
       * written: a vertical step, a roll onto the weighted foot, and a squash so
       * the step reads as weight rather than as hovering.
       */
      const moving = vx * vx + vz * vz > 0.05;
      const gait = this.time * def.speed * 2.6 + this.enemies.phase[i];
      const step = moving && !held ? Math.abs(Math.sin(gait)) : 0;
      const roll = moving && !held ? Math.sin(gait) * 0.07 : 0;
      const stepY = def.flying ? 0 : step * 0.055 * def.height * 0.5;
      const stretch = def.flying ? 1 : 1 + step * 0.035 - 0.018;

      // Roll is applied about Z (a lean onto the planted foot) after the facing
      // yaw, which is why this composes rather than using makeRotationY alone.
      tmpMatrix.makeRotationY(this.enemyYaw[i] + lurch);
      tmpRotation.makeRotationZ(roll);
      tmpMatrix.multiply(tmpRotation);
      tmpScale.set(s, s * squash * stretch, s);
      tmpMatrix.scale(tmpScale);
      // Models are authored base-at-origin, so the sim's feet position IS the
      // instance position — no half-height offset, and no second matrix for a
      // head that is now part of the mesh.
      tmpMatrix.setPosition(ex, ey + bob + stepY, ez);
      body.setMatrixAt(n, tmpMatrix);

      // Wings, hinged at the shoulder so a flap is a rotation about Z. Fliers
      // beat harder when they are climbing, which falls out of using the same
      // bob phase.
      const wings = this.enemies.wings[defId];
      if (wings) {
        const flap = Math.sin(this.time * 7.5 + this.enemies.phase[i]) * 0.62 - 0.12;
        for (const [mesh, dir] of [
          [wings.right, 1],
          [wings.left, -1],
        ] as const) {
          tmpWing.makeRotationY(this.enemyYaw[i]);
          tmpRotation.makeRotationZ(flap * dir);
          tmpWing.multiply(tmpRotation);
          tmpScale.set(s, s, s);
          tmpWing.scale(tmpScale);
          tmpWing.setPosition(ex, ey + bob + stepY + wings.y * s, ez);
          mesh.setMatrixAt(n, tmpWing);
        }
      }

      /*
       * Status is READ OFF THE BODY, not off the HUD (§6).
       *
       * This changed shape when the models landed. The instance colour used to
       * BE the body's colour, because a capsule had none of its own; now
       * identity is baked per-part in the vertex stream and this multiplies over
       * all of it. So every status is expressed as a *modulation* — a wash
       * toward a hue, or a brightening — and the model's own rags, iron and bone
       * survive underneath instead of collapsing to one flat tint.
       *
       * Brightening deliberately goes past 1. Instance colours are not clamped,
       * so `>1` is how a burning body glows and a winding-up attacker flares
       * without an emissive map or a second material.
       */
      const flash = e.hitFlash[i] / 6;
      tmpColor.setScalar(this.enemies.tint[i]);
      if (e.soaked[i] > 0) tmpColor.lerp(SOAK_WASH, 0.62);
      if (e.marked[i] > 0) tmpColor.lerp(MARK_WASH, 0.6);
      if (e.burning[i] > 0) {
        tmpColor.lerp(BURN_WASH, 0.7);
        tmpColor.multiplyScalar(1.25 + Math.sin(this.time * 18 + i) * 0.22);
      }
      if (e.elite[i] === 1) tmpColor.lerp(ELITE_WASH, 0.5);
      if (held) tmpColor.lerp(ELITE_WASH, 0.35);
      if (winding) tmpColor.multiplyScalar(1.55);
      if (flash > 0) tmpColor.multiplyScalar(1 + flash * 1.6);
      body.setColorAt(n, tmpColor);

      // Blob shadow, projected onto whatever surface is under this body. Fliers
      // get a wider, and therefore softer-reading, pool the higher they are.
      shadowCount = this.pushShadow(
        shadowCount,
        ex,
        ez,
        groundHeight(world.level, ex, ez, ey + 0.2),
        ey,
        def.radius * 2.2 * s,
      );
    }

    for (let k = 0; k < this.enemies.bodies.length; k++) {
      const body = this.enemies.bodies[k];
      body.count = this.enemyCounts[k];
      // The outline shares this pool's transform buffer, so only the count has to
      // be carried across (§17.1, render/materials.ts).
      this.enemies.outlines[k].count = this.enemyCounts[k];
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      const wings = this.enemies.wings[k];
      if (wings) {
        wings.left.count = this.enemyCounts[k];
        wings.right.count = this.enemyCounts[k];
        wings.left.instanceMatrix.needsUpdate = true;
        wings.right.instanceMatrix.needsUpdate = true;
      }
    }

    this.shadows.count = shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;

    // ── traps ─────────────────────────────────────────────────────────────
    const tr = world.traps;
    for (let k = 0; k < this.trapCounts.length; k++) this.trapCounts[k] = 0;

    for (let i = 0; i < tr.alive.length; i++) {
      if (!tr.alive[i]) continue;
      const defId = tr.defId[i];
      const def = TRAPS[defId];
      if (!def) continue;
      const body = this.traps.bodies[defId];
      const ring = this.traps.rings[defId];
      const n = this.trapCounts[defId]++;

      // Auras have no cooldown, so they are always "armed".
      const armed = def.trigger === TRIGGER.aura || tr.cooldown[i] === 0;
      const justFired = tr.fired[i] > 0;
      const elem = COLOR[ELEM_SWATCH[def.elem]];
      const upgraded = tr.upgrade[i] !== 0;

      // Every model authors its own base at y=0 (render/models/traps.ts), so the
      // only lift is an epsilon to keep baseboards off the floor plane.
      const LIFT = 0.01;
      // A trap that just went off kicks, then settles.
      const kick = justFired ? (tr.fired[i] / 18) * 0.1 : 0;
      // Wall and roof mounts carry their own height and facing (sim/world.ts).
      tmpMatrix.makeRotationY(tr.yaw[i]);
      tmpMatrix.setPosition(tr.x[i], tr.y[i] + LIFT + kick, tr.z[i]);
      body.setMatrixAt(n, tmpMatrix);

      // The instance colour modulates STATE, not hue.
      //
      // It multiplies over every baked vertex colour in the model, so putting the
      // element hue here — as this did before the models landed — would collapse a
      // five-material bear trap into one flat cyan-or-rust blob. Identity now
      // lives in the geometry (§17.1 "one flat colour per part"); this only says
      // armed / cooling / firing. Upgraded traps take a slight element wash so a
      // built-out lane still reads at a glance.
      if (justFired) tmpColor.copy(COLOR.sunbleach).multiplyScalar(1.8);
      else {
        tmpColor.setScalar(armed ? 1 : 0.52);
        if (upgraded) tmpColor.lerp(elem, 0.16);
      }
      body.setColorAt(n, tmpColor);

      // The reach ring is the trap's tell: it pulses while armed, dims on
      // cooldown, and flashes when it fires (§14.6). A trap whose radius you
      // cannot see is a trap you cannot plan around.
      const pulse = armed ? 0.5 + Math.sin(this.time * 3.2 + defId) * 0.16 : 0.12;
      tmpMatrix.makeRotationX(-Math.PI / 2);
      // An upgraded trap wears a slightly wider, hotter ring, so a built-out lane
      // is readable at a glance rather than only in the build panel.
      const ringScale = upgraded ? 1.1 : 1;
      tmpScale.set(ringScale, ringScale, 1);
      tmpMatrix.scale(tmpScale);
      /* Deliberately on the floor even for a wall or roof mount: the ring answers
         "what ground does this cover", and one hovering at 4.4m answers nothing. */
      tmpMatrix.setPosition(tr.x[i], 0.022, tr.z[i]);
      ring.setMatrixAt(n, tmpMatrix);
      tmpColor
        .copy(elem)
        .multiplyScalar((justFired ? 2.4 : pulse * 1.6) * (upgraded ? 1.7 : 1));
      ring.setColorAt(n, tmpColor);
    }

    for (let k = 0; k < this.traps.bodies.length; k++) {
      const body = this.traps.bodies[k];
      const ring = this.traps.rings[k];
      body.count = this.trapCounts[k];
      ring.count = this.trapCounts[k];
      this.traps.outlines[k].count = this.trapCounts[k];
      body.instanceMatrix.needsUpdate = true;
      ring.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    }

    // ── build mode ────────────────────────────────────────────────────────
    const building = p.buildMode && world.phase !== PHASE.lost;
    this.gridMaterial.opacity = building ? 0.22 : 0.05;
    // Chalk every free mount of the armed class, so "where can this go" is a
    // question the world answers rather than one the player has to guess.
    const armedDef = TRAPS[p.slot];
    if (building && armedDef && armedDef.surface !== SURF.floor) {
      let n = 0;
      const slots = world.level.slots;
      for (let i = 0; i < slots.length && n < this.slotMarks.count; i++) {
        const s = slots[i];
        if (s.surface !== armedDef.surface) continue;
        if (trapAtCell(world, cellOfSlot(i)) >= 0) continue;
        if (s.surface === SURF.ceiling) {
          // Face down off the beam.
          tmpMatrix.makeRotationX(Math.PI / 2);
        } else if (s.surface === SURF.sigil) {
          tmpMatrix.makeRotationX(-Math.PI / 2);
        } else {
          tmpMatrix.makeRotationY(sideYaw(s.side ?? 0));
        }
        tmpMatrix.setPosition(s.x, s.surface === SURF.sigil ? 0.02 : s.y, s.z);
        this.slotMarks.setMatrixAt(n, tmpMatrix);
        n++;
      }
      this.slotMarks.count = n;
      this.slotMarks.visible = n > 0;
      this.slotMarks.instanceMatrix.needsUpdate = true;
      this.marksShown = n;
    } else {
      this.slotMarks.visible = false;
      this.marksShown = 0;
    }

    if (building && aimCell >= 0) {
      const def = TRAPS[p.slot];
      this.ghost.visible = true;
      // Slot-aware: `tileCenter*` resolves mount ids as well as build tiles, so the
      // ghost lands on the wall face or the roof beam without special-casing here.
      // Fill the tile, less a hair so the grid line still reads underneath.
      const gs = world.level.tile * 0.94;
      this.ghost.scale.set(gs, 1, gs);
      this.ghost.position.set(
        tileCenterX(world.level, aimCell),
        tileCenterY(world.level, aimCell) + 0.05 + Math.sin(this.time * 4) * 0.015,
        tileCenterZ(world.level, aimCell),
      );
      const elem = COLOR[ELEM_SWATCH[def ? def.elem : 0]];
      const mat = this.ghost.material as MeshBasicMaterial;
      mat.color.copy(canPlace ? elem : GHOST_BAD);
      mat.opacity = canPlace ? 0.42 : 0.26;

      // Show the reach you are about to buy, in the armed trap's own colour.
      const r = Math.max(0.2, def ? def.radius : 0.8);
      this.ghostRing.visible = true;
      this.ghostRing.scale.set(r, r, 1);
      this.ghostRing.position.set(this.ghost.position.x, 0.03, this.ghost.position.z);
      (this.ghostRing.material as MeshBasicMaterial).color.copy(
        canPlace ? elem : GHOST_BAD,
      );
    } else {
      this.ghost.visible = false;
      this.ghostRing.visible = false;
    }

    // ── fx ────────────────────────────────────────────────────────────────
    this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
    this.muzzleLight.intensity = (this.muzzleTimer / 0.06) * 22;
    this.muzzleLight.position.set(hx, hy + 1.1, hz);

    this.rift.rotation.y += dt * 0.22;
    (this.riftRing.material as MeshBasicMaterial).opacity =
      0.5 + Math.sin(this.time * 1.7) * 0.18;

    // Taking a hit crushes the fog toward oxblood for a moment. Cheap, and it
    // reads in peripheral vision where a HUD flash does not.
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4);
    if (this.scene.fog) {
      this.scene.fog.color.copy(COLOR.ash).lerp(COLOR.oxblood, this.hurtFlash * 0.8);
    }

    // The sky travels with the viewer so its 200m shell always sits inside the
    // 220m far plane (buildSky). It never rotates, so nothing parallaxes wrongly.
    this.sky.position.copy(this.camera.position);

    /*
     * The paths are re-traced only when a lane could have moved (site, round, a
     * building bought) and drawn only in the build phase — §4's "ghost paths
     * shown from each active gate", and the reason a 100-scrap purchase that
     * re-routes the crowd is a visible consequence rather than an ambush.
     */
    this.ghostPaths.sync(world.level, world.round);
    this.ghostPaths.update(dt, this.time, world.phase === PHASE.build);

    this.numbers.update(dt, this.camera, this.canvas.clientWidth, this.canvas.clientHeight);
    this.sparks.update(dt, this.time);
    this.motes.update(dt, this.time, this.camera.position.x, this.camera.position.z);

    // §14.6's radial flash and chromatic pulse. The fog tint above is the
    // world-space half of the same cue; this is the screen-space half.
    this.post.setHurt(this.hurtFlash);
    this.post.render(dt);
  }

  stats(): RenderStats {
    const info = this.renderer.info.render;
    return { drawCalls: info.calls, triangles: info.triangles };
  }

  /**
   * The screen-centre ray itself: origin then unit direction, into `out[0..5]`.
   *
   * Wall and roof mounts are picked by aim proximity rather than by intersecting
   * the ground plane, so the host needs the ray, not a point (sim/surfaces.ts).
   */
  aimRayInto(out: Float64Array): boolean {
    out[0] = this.pose.x;
    out[1] = this.pose.y;
    out[2] = this.pose.z;
    out[3] = this.pose.dx;
    out[4] = this.pose.dy;
    out[5] = this.pose.dz;
    return true;
  }

  /** Screen-centre ray → floor cell, for the build-mode ghost. */
  aimPoint(out: Vector3): boolean {
    const dy = this.pose.dy;
    if (dy >= -0.0001) return false;
    const t = -this.pose.y / dy;
    if (t < 0 || t > 40) return false;
    out.set(this.pose.x + this.pose.dx * t, 0, this.pose.z + this.pose.dz * t);
    return true;
  }

  /**
   * Swap the hero body without rebuilding anything else.
   *
   * The muster screen previews both choices live, and the site genuinely needs a
   * new `World` — but the hero is a *render-only* choice, so rebuilding the
   * simulation, the level and a WebGL context to change a hat was both wasteful
   * and the riskiest thing on the screen: every rebuild tears down a renderer
   * and stands another one up, and doing that on a click is how you find out
   * which module-scoped resource does not survive it.
   *
   * Swapping in place makes flicking between the two Vigils instant, which is
   * also how anyone actually compares them.
   */
  setHero(hero: HeroId): void {
    this.scene.remove(this.hero.group);
    // The old rig's geometry is ours alone; the material is shared, so it is
    // deliberately left alone (disposing it would break the incoming hero).
    this.hero.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.hero = buildHero(hero);
    this.scene.add(this.hero.group);
  }

  dispose(): void {
    this.numbers.dispose();
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
  }
}
