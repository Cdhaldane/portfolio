/*
 * render/fx.ts — pooled, additive, allocation-free sparks.
 *
 * One InstancedMesh, a fixed-size ring, no per-particle objects and one shared
 * scratch matrix (§12.5). It's a spike-scale stand-in for the GPU particle
 * system at §14.5, but the *shape* is the same: presentation reads the sim's
 * event stream and never asks it anything.
 *
 * Small glowing cubes rather than billboards: no per-instance lookAt, and
 * tumbling debris suits splintering wood and struck iron better than soft puffs.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
} from "three";

import { COLOR } from "./palette.ts";

const MAX = 192;
const tmpMatrix = new Matrix4();
const tmpColor = new Color();
const tmpScale = new Vector3();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export class Sparks {
  readonly mesh: InstancedMesh;

  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private r = new Float32Array(MAX);
  private g = new Float32Array(MAX);
  private b = new Float32Array(MAX);
  private next = 0;
  /** Cosmetic-only randomness: its own source, never the sim's (§13 rule 2). */
  private seed = 0x2f6bff;

  constructor() {
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX;
    this.mesh.renderOrder = 10;
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, HIDDEN);
  }

  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s | 0;
    return ((s >>> 0) % 100000) / 100000;
  }

  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: Color,
    speed: number,
    size: number,
    life: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.next++ % MAX;
      this.x[i] = x;
      this.y[i] = y;
      this.z[i] = z;
      const a = this.rand() * Math.PI * 2;
      const up = 0.3 + this.rand() * 1.1;
      const sp = speed * (0.45 + this.rand() * 0.9);
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = up * sp;
      this.vz[i] = Math.sin(a) * sp;
      this.spin[i] = (this.rand() - 0.5) * 22;
      this.maxLife[i] = life * (0.7 + this.rand() * 0.6);
      this.life[i] = this.maxLife[i];
      this.size[i] = size * (0.6 + this.rand() * 0.8);
      this.r[i] = color.r;
      this.g[i] = color.g;
      this.b[i] = color.b;
    }
  }

  update(dt: number, time: number): void {
    const m = this.mesh;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        m.setMatrixAt(i, HIDDEN);
        continue;
      }
      this.life[i] -= dt;
      this.vy[i] -= 9 * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.y[i] < 0.03) {
        this.y[i] = 0.03;
        this.vy[i] *= -0.28;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const s = this.size[i] * t;
      tmpMatrix.makeRotationY(time * this.spin[i]);
      tmpMatrix.scale(tmpScale.set(s, s, s));
      tmpMatrix.setPosition(this.x[i], this.y[i], this.z[i]);
      m.setMatrixAt(i, tmpMatrix);
      tmpColor.setRGB(this.r[i] * t, this.g[i] * t, this.b[i] * t);
      m.setColorAt(i, tmpColor);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

/**
 * Dust in the air, drifting on the wind.
 *
 * §14.5 lists god rays "as art-directed billboard shafts in the geometry, *not*
 * volumetric raymarching" and adds that "dust motes do the rest". This is the
 * dust motes half, and it turns out to be the half that matters: an outdoor
 * night scene with perfectly clear air reads as a vacuum, and §3 gives Boot Hill
 * "open sightlines, wind" as a defining feature.
 *
 * Implemented as one wrapped volume that follows the camera rather than a field
 * covering the site. The player can only ever see motes within a few metres, so
 * simulating them anywhere else is pure waste — 140 instances in a 26m box that
 * moves with the viewer looks identical to thousands spread over the map.
 */
const MOTE_COUNT = 140;
/** Edge of the wrapping box, metres. Motes leaving one side re-enter the other. */
const MOTE_SPAN = 26;

export class Motes {
  readonly mesh: InstancedMesh;

  private x = new Float32Array(MOTE_COUNT);
  private y = new Float32Array(MOTE_COUNT);
  private z = new Float32Array(MOTE_COUNT);
  private drift = new Float32Array(MOTE_COUNT);
  private size = new Float32Array(MOTE_COUNT);

  constructor() {
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({
        // `bone` rather than `dust`: additive blending against a night sky eats
        // most of a mid-value swatch, and invisible dust is not worth 140 draws.
        color: COLOR.bone.getHex(),
        transparent: true,
        opacity: 0.42,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
      MOTE_COUNT,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = MOTE_COUNT;
    this.mesh.renderOrder = 9;

    // Hashed, not random: the same air every run (§13 rule 2 — cosmetic
    // randomness gets its own source, and a deterministic one costs nothing).
    for (let i = 0; i < MOTE_COUNT; i++) {
      const h = (n: number): number => (((i * 2654435761 + n * 40503) >>> 0) % 10000) / 10000;
      this.x[i] = h(1) * MOTE_SPAN;
      this.y[i] = h(2) * 7 + 0.2;
      this.z[i] = h(3) * MOTE_SPAN;
      this.drift[i] = 0.25 + h(4) * 0.55;
      this.size[i] = 0.016 + h(5) * 0.028;
    }
  }

  /**
   * @param cx,cz where the viewer is. The volume is kept centred on them, so
   *              motes are always where they can actually be seen.
   */
  update(dt: number, time: number, cx: number, cz: number): void {
    const m = this.mesh;
    const originX = cx - MOTE_SPAN / 2;
    const originZ = cz - MOTE_SPAN / 2;

    for (let i = 0; i < MOTE_COUNT; i++) {
      // A steady wind along +X with a slow vertical wander. Motes fall very
      // slowly; anything faster reads as rain.
      this.x[i] += this.drift[i] * dt;
      this.y[i] += Math.sin(time * 0.6 + i) * 0.06 * dt - 0.04 * dt;

      // Wrap into the box around the viewer.
      let px = this.x[i];
      let pz = this.z[i];
      px = originX + (((px - originX) % MOTE_SPAN) + MOTE_SPAN) % MOTE_SPAN;
      pz = originZ + (((pz - originZ) % MOTE_SPAN) + MOTE_SPAN) % MOTE_SPAN;
      if (this.y[i] < 0.15 || this.y[i] > 7.5) this.y[i] = 0.2 + ((i * 37) % 60) / 10;

      const s = this.size[i];
      tmpMatrix.makeRotationY(time * 0.4 + i);
      tmpMatrix.scale(tmpScale.set(s, s, s));
      tmpMatrix.setPosition(px, this.y[i], pz);
      m.setMatrixAt(i, tmpMatrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }
}
