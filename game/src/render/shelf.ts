/*
 * render/shelf.ts — the debug room. Every asset in a row, under game lighting.
 *
 * GALLOWS_HYMN.md §17.9 asks for exactly this, and gives the reason:
 *
 *   > Cohesion problems are invisible per-asset and obvious in a row.
 *
 * That is the entire justification. A trap looks fine on its own; five traps in a
 * line next to an enemy and a wall is where you see that one is too detailed, one
 * is the wrong value, and two are the same height. With sources as heterogeneous
 * as this project's (§22 R23: CC0 + AI-generated + code-generated in one scene)
 * the shelf is not a nice-to-have, it's the mitigation.
 *
 * Three things make it honest rather than decorative:
 *
 *  1. **It shares the game's lighting and tonemap** via `render/look.ts`. A review
 *     scene lit its own way is actively misleading.
 *  2. **It shows the architecture kit alongside the props.** Prop-vs-prop cohesion
 *     is the easy half; prop-vs-*wall* is where Path A actually gets judged.
 *  3. **It has a silhouette mode** (press S) — flat black on bone, which is the
 *     §17.10 acceptance test ("readable as a black shape at 64px") made pressable
 *     instead of imagined. Shrink the window and you have the 64px check.
 *
 * Deliberately NOT sim-driven. Nothing here creates a world, steps a tick or
 * places a real trap: it instantiates geometry directly. That keeps the whole
 * module unable to affect gameplay or determinism, and it means traps can be
 * shown standing still rather than firing at an enemy that wants to walk away.
 */

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import { BOX, type Box } from "../sim/level.ts";
import { ENEMIES } from "../sim/enemies.ts";
import { TRAPS } from "../sim/traps.ts";
import { buildHero, enemyBodyGeometry } from "./actors.ts";
import { buildWingGeometry, wingHinge } from "./models/enemies.ts";
import { HEROES } from "./models/hero.ts";
import {
  applyRendererLook,
  applySceneAtmosphere,
  applySceneLighting,
} from "./look.ts";
import { buildBoxGeometry, buildFloorGeometry } from "./mesher.ts";
import { RIM, attachOutline, toonMaterial } from "./materials.ts";
import { Post } from "./post/index.ts";
import { buildTrapGeometry } from "./models/traps.ts";
import { COLOR } from "./palette.ts";

/** Spacing between items in a row. Wide enough that silhouettes never merge. */
const PITCH = 1.9;
/*
 * Rows run *away* from the default camera, smallest first.
 *
 * Learned by looking: with the traps furthest away, the 1.8m enemies stood
 * directly in front of the 0.3m bear trap and hid three of the five models
 * outright. Depth order has to run small→large or the review scene reviews the
 * back of an Ironjaw.
 */
const ROW_TRAPS = 0;
const ROW_ENEMIES = -3.6;
const ROW_HERO = -7;
const ROW_KIT = -11;
/** The floor is square and covers all the rows. */
const EXTENT = 26;

interface Label {
  el: HTMLDivElement;
  anchor: Vector3;
}

export class Shelf {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  /**
   * Orbit state. Yaw/pitch in radians, distance in metres.
   *
   * Near-front-on by default: a slight yaw reads the 3D form, but a steep oblique
   * angle compresses the rows into each other and makes heights impossible to
   * compare — which is half of what the shelf is for.
   */
  private yaw = -0.26;
  private pitch = 0.3;
  private dist = 12;
  private readonly target = new Vector3(0, 0.9, -3.2);

  private dragging = false;
  private autoRotate = false;
  private silhouette = false;
  private raf = 0;
  private last = 0;
  /**
   * Held so silhouette mode can restore it. Nulling `scene.fog` and then
   * "restoring" it from itself loses it permanently — the fog never comes back
   * and every later review happens without it.
   */
  private readonly fog: Scene["fog"];

  /**
   * Ground and architecture kit, grouped so silhouette mode can hide them.
   *
   * Without this the floor silhouettes too and the whole frame is one black mass —
   * which is exactly what the first version did. The §17.10 test is "is this
   * *asset* readable as a black shape", so the asset has to be the only black
   * shape in the frame.
   */
  private readonly context = new Group();
  /**
   * Every inverted-hull outline, so `O` can toggle them.
   *
   * Being able to switch the outline off is the whole reason it's worth tracking:
   * outline thickness is the one value in the toon look that is *only* judgeable
   * by A/B, because too thick reads as a sticker and too thin reads as nothing.
   */
  private readonly outlined: Mesh[] = [];
  private labels: Label[] = [];
  private readonly labelHost: HTMLDivElement;
  private readonly silhouetteMaterial = new MeshBasicMaterial({ color: 0x000000 });
  private readonly projected = new Vector3();

  /**
   * The §14.5 post stack. Judged here first: grain amplitude, vignette strength
   * and bloom threshold are all values you can only set by looking at them, and
   * `P` toggles the whole stack so the comparison is one keypress.
   */
  private post!: Post;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    applyRendererLook(this.renderer);
    applySceneAtmosphere(this.scene);
    this.fog = this.scene.fog;

    this.camera = new PerspectiveCamera(60, 1, 0.1, 220);

    // Lighting is aimed at the rows rather than at the middle of a site, but the
    // colours, intensities and shadow settings are the game's own.
    const moon = applySceneLighting(this.scene, { width: EXTENT, depth: EXTENT });
    moon.position.set(9, 20, -6);
    moon.target.position.set(0, 0, ROW_ENEMIES * 0.5);

    this.labelHost = document.createElement("div");
    this.labelHost.className = "gh-shelf-labels";
    (canvas.parentElement ?? document.body).appendChild(this.labelHost);

    this.scene.add(this.context);
    this.buildGround();
    this.buildKit();
    this.buildTraps();
    this.buildEnemies();
    this.buildHero();

    this.post = new Post(this.renderer, this.scene, this.camera);

    this.bindInput();
    this.resize();
  }

  /* ── contents ──────────────────────────────────────────────────────────── */

  private buildGround(): void {
    const floor = new Mesh(
      buildFloorGeometry(EXTENT, EXTENT),
      toonMaterial({ rim: RIM.architecture }),
    );
    // buildFloorGeometry spans 0..extent, so recentre it over the rows.
    floor.position.set(-EXTENT / 2, 0, -EXTENT / 2 - 3.2);
    floor.receiveShadow = true;
    this.context.add(floor);
  }

  /**
   * A slice of the architecture kit behind the rows.
   *
   * This is the comparison that matters most and the one a per-asset review can
   * never make: a code-generated wall next to a code-generated trap, same shader,
   * same light. If the trap looks like it belongs to a different game than the
   * wall, that shows up here and nowhere else.
   */
  private buildKit(): void {
    const boxes: Box[] = [];
    const backZ = ROW_KIT;
    // A wall run.
    boxes.push({ x0: -6, x1: 2, y0: 0, y1: 3.2, z0: backZ, z1: backZ + 0.5, kind: BOX.wall });
    // A block and a pillar, so more than one kit swatch is on display.
    boxes.push({ x0: 2.6, x1: 5, y0: 0, y1: 1.2, z0: backZ, z1: backZ + 1.6, kind: BOX.block });
    boxes.push({
      x0: 5.6,
      x1: 6.4,
      y0: 0,
      y1: 3.4,
      z0: backZ + 0.2,
      z1: backZ + 1,
      kind: BOX.pillar,
    });
    // Steps, which are the piece most likely to read as programmer art.
    for (let i = 0; i < 4; i++) {
      boxes.push({
        x0: -8.4,
        x1: -6.4,
        y0: 0,
        y1: 0.3 + i * 0.3,
        z0: backZ + 0.6 + i * 0.5,
        z1: backZ + 1.1 + i * 0.5,
        kind: BOX.step,
      });
    }

    // Architecture gets the ramp but almost no rim and no outline at all: §17.1
    // keeps both off the kit, because an outlined edge on every modular piece
    // reads as a wireframe.
    const mesh = new Mesh(buildBoxGeometry(boxes), toonMaterial({ rim: RIM.architecture }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.context.add(mesh);
  }

  private rowX(i: number, count: number): number {
    return (i - (count - 1) / 2) * PITCH;
  }

  private buildTraps(): void {
    for (let i = 0; i < TRAPS.length; i++) {
      const def = TRAPS[i];
      const x = this.rowX(i, TRAPS.length);
      // Toon, not standard: §17.1's banded ramp is what the assets are authored
      // for, so reviewing them under anything else reviews the wrong game. The
      // per-element roughness/metalness this used to carry is gone with PBR.
      const mesh = new Mesh(buildTrapGeometry(def.key), toonMaterial({ rim: RIM.prop }));
      mesh.position.set(x, 0.01, ROW_TRAPS);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.outlined.push(attachOutline(mesh));
      this.addLabel(def.name, x, 0.75, ROW_TRAPS);
    }
  }

  /**
   * Enemies at their *base* colour only.
   *
   * The play scene tints them per-instance for status (soaked, burning, marked)
   * and for elite. Reproducing that here would be reproducing a second copy of
   * scene.ts's status logic, which would drift; the shelf's job is the asset, not
   * the state machine. Armour and flight do change the base read, so those two
   * are kept.
   */
  private buildEnemies(): void {
    for (let i = 0; i < ENEMIES.length; i++) {
      const def = ENEMIES[i];
      const x = this.rowX(i, ENEMIES.length);

      // Base colour only. The play scene multiplies a status wash over this per
      // instance (soaked, burning, marked, elite); reproducing that here would be
      // a second copy of scene.ts's state machine, and it would drift. The
      // shelf's job is the asset, not the state.
      //
      // Characters take the strong rim: §17.1's rule is that a body is never
      // mid-on-mid against its background, and forty of them is where it bites.
      const material = toonMaterial({ rim: RIM.character });

      // Models are authored base-at-origin, so a walker stands at y=0 and a
      // flier is lifted to a plausible cruise for review.
      const y = def.flying ? 1.4 : 0;
      const body = new Mesh(enemyBodyGeometry(def), material);
      body.position.set(x, y, ROW_ENEMIES);
      body.castShadow = true;
      this.scene.add(body);
      this.outlined.push(attachOutline(body));

      // Fliers keep their wings in separate meshes so they can flap in play
      // (actors.ts); the shelf has to add them back or a Buzzard reviews as a
      // wingless torpedo.
      if (def.flying) {
        const hinge = wingHinge(def);
        for (const side of [1, -1] as const) {
          const wing = new Mesh(buildWingGeometry(def, side), material);
          wing.position.set(x, y + hinge.y, ROW_ENEMIES);
          wing.castShadow = true;
          this.scene.add(wing);
          this.outlined.push(attachOutline(wing));
        }
      }

      this.addLabel(def.name, x, y + def.height + 0.35, ROW_ENEMIES);
    }
  }

  /**
   * Both playable bodies, side by side.
   *
   * This is the single most important row on the shelf now, and it is the one
   * §17.9's "cohesion problems are invisible per-asset and obvious in a row"
   * argument was written for. HEROES.md §3 commits the two heroes to opposing
   * letterforms — Amos a T, Ada an I — and that is a claim about how they look
   * *next to each other*, which no amount of looking at either one alone can
   * check. Press `S` here and the silhouette test either passes or it doesn't.
   */
  private buildHero(): void {
    for (let i = 0; i < HEROES.length; i++) {
      const profile = HEROES[i];
      const x = this.rowX(i, HEROES.length) * 1.15;
      const { group } = buildHero(profile.id);
      group.position.set(x, 0, ROW_HERO);
      this.scene.add(group);
      this.addLabel(`${profile.name} · ${profile.role}`, x, 2.15, ROW_HERO);
    }

    // A 1.8m scale post beside them. Wrong-scale assets are the single most
    // common cohesion failure and the hardest to see without a reference — and
    // with two heroes it also proves they are the same height, which the shared
    // rig (HEROES.md §4) requires and the eye will not verify on its own.
    const post = new Mesh(
      new BoxGeometry(0.12, 1.8, 0.12),
      toonMaterial({ color: COLOR.oxblood, vertexColors: false, rim: RIM.prop }),
    );
    post.position.set(-2.4, 0.9, ROW_HERO);
    this.scene.add(post);
    this.addLabel("1.8m", -2.4, 2.0, ROW_HERO);
  }

  /* ── labels ────────────────────────────────────────────────────────────── */

  /**
   * Labels are plain DOM positioned imperatively each frame, following the same
   * pattern as the floating damage numbers. React is never asked to re-render per
   * frame (§12.2).
   */
  private addLabel(text: string, x: number, y: number, z: number): void {
    const el = document.createElement("div");
    el.className = "gh-shelf-label";
    el.textContent = text;
    this.labelHost.appendChild(el);
    this.labels.push({ el, anchor: new Vector3(x, y, z) });
  }

  private syncLabels(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const label of this.labels) {
      if (this.silhouette) {
        label.el.style.opacity = "0";
        continue;
      }
      this.projected.copy(label.anchor).project(this.camera);
      const behind = this.projected.z > 1;
      label.el.style.opacity = behind ? "0" : "1";
      if (behind) continue;
      const sx = (this.projected.x * 0.5 + 0.5) * w;
      const sy = (-this.projected.y * 0.5 + 0.5) * h;
      label.el.style.transform = `translate(-50%, -100%) translate(${sx}px, ${sy}px)`;
    }
  }

  /* ── input ─────────────────────────────────────────────────────────────── */

  private bindInput(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKey);
  }

  private onPointerDown = (): void => {
    this.dragging = true;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * 0.005;
    this.pitch = Math.min(1.35, Math.max(-0.15, this.pitch - e.movementY * 0.004));
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.dist = Math.min(40, Math.max(3, this.dist + e.deltaY * 0.01));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === "KeyS") {
      this.silhouette = !this.silhouette;
      // Flat black on bone: the §17.10 "readable at 64px" test, made pressable.
      this.scene.overrideMaterial = this.silhouette ? this.silhouetteMaterial : null;
      this.scene.background = new Color(this.silhouette ? COLOR.sunbleach : COLOR.void);
      // Fog would grey the silhouettes out and defeat the test.
      this.scene.fog = this.silhouette ? null : this.fog;
      // Ground and kit must go, or every asset merges into one black mass.
      this.context.visible = !this.silhouette;
      /*
       * And post has to go with them.
       *
       * Silhouette mode is a *measurement*, not a look: §17.10 asks whether an
       * asset reads as a black shape at 64px. Grain speckles the flat bone
       * background, the vignette darkens two corners of it, and the chromatic
       * aberration puts colour fringes on exactly the black edges being judged.
       * Every one of those corrupts the reading it is being used to take.
       */
      this.post.enabled = !this.silhouette;
    }
    if (e.code === "KeyR") this.autoRotate = !this.autoRotate;
    if (e.code === "KeyP") this.post.enabled = !this.post.enabled;
    if (e.code === "KeyO") {
      for (const o of this.outlined) o.visible = !o.visible;
    }
    if (e.code === "Digit1") this.target.set(0, 0.35, ROW_TRAPS);
    if (e.code === "Digit2") this.target.set(0, 0.9, ROW_ENEMIES);
    if (e.code === "Digit3") this.target.set(0, 0.9, ROW_HERO);
    if (e.code === "Digit4") this.target.set(0, 1.4, ROW_KIT);
  };

  /* ── loop ──────────────────────────────────────────────────────────────── */

  start(): void {
    this.last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      if (this.autoRotate) this.yaw += dt * 0.35;

      const cp = Math.cos(this.pitch);
      this.camera.position.set(
        this.target.x + Math.sin(this.yaw) * this.dist * cp,
        this.target.y + Math.sin(this.pitch) * this.dist,
        this.target.z + Math.cos(this.yaw) * this.dist * cp,
      );
      this.camera.lookAt(this.target);

      this.syncLabels();
      this.post.render(dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.post.dispose();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    this.labelHost.remove();
    this.labels = [];
    // three leaks aggressively if you don't do this (§22 R12).
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.silhouetteMaterial.dispose();
    this.renderer.dispose();
  }
}
