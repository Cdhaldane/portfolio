/*
 * render/paths.ts — the ghost paths, drawn on the ground.
 *
 * The build-phase preview from GALLOWS_HYMN.md §4: one glowing ribbon per active
 * gate, flowing toward the Rift, gone the moment the bell rings.
 *
 * **A ribbon, not a line.** `LineBasicMaterial.linewidth` is ignored by every
 * WebGL implementation — you get one physical pixel whatever you ask for — and a
 * 1px thread seen from a 3.4m boom over a 80m site is not a route, it is a
 * scratch on the monitor. So the path is real geometry: a strip of quads ~0.55m
 * wide laid on the floor, which is also what makes it read the way Orcs Must
 * Die's does.
 *
 * **It is draped, not projected.** Every vertex samples `groundHeight`, so the
 * ribbon climbs the Undertown's rubble cone and rides its boardwalks instead of
 * disappearing into them. That costs a `groundHeight` call per vertex, which is
 * fine because this is rebuilt on a build-phase event and never per frame.
 *
 * One geometry for all gates (they are one strip list with degenerate joins), so
 * the whole preview is a single draw call against the §14.2 budget of 250.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Uniform,
} from "three";

import { activeGates, groundHeight, type Level } from "../sim/level.ts";
import { pathSignature, tracePath } from "../sim/paths.ts";
import { COLOR } from "./palette.ts";

/** Half-width of the ribbon, metres. */
const HALF = 0.28;
/** Lift off the floor: above the 0.012 grid and the 0.022 trap rings. */
const LIFT = 0.035;

/*
 * Dashes flow gate → Rift, which is the whole informational job: the player has
 * to read *direction*, not just position. `vU` is metres travelled, so the dash
 * pitch is a real-world 2.9m regardless of how long the path is — two paths of
 * different lengths scroll at the same speed instead of one looking frantic.
 */
const VERT = /* glsl */ `
  attribute float aU;
  attribute float aFade;
  varying float vU;
  varying float vFade;
  void main() {
    vU = aU;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  varying float vU;
  varying float vFade;
  void main() {
    float f = fract(vU * 0.34 - uTime * 0.85);
    // A soft chevron rather than a hard dash: hard edges alias badly on a
    // ground plane at this camera angle.
    float dash = smoothstep(0.0, 0.35, f) * smoothstep(1.0, 0.55, f);
    float a = (0.16 + dash * 0.84) * vFade * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class GhostPaths {
  readonly mesh: Mesh;

  private material: ShaderMaterial;
  private signature = "";
  /** 0..1 fade, so the paths dissolve on round start instead of popping out. */
  private alpha = 0;

  private pts: number[] = [];
  private pos: number[] = [];
  private us: number[] = [];
  private fades: number[] = [];

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        // `ember` is the gate colour (§3): warm means "yours / the way in", and
        // it keeps the path off cyan, which is reserved for the Choir and would
        // read as "traps don't work here" — the opposite of the truth.
        uColor: new Uniform(COLOR.ember.clone()),
        uTime: new Uniform(0),
        uAlpha: new Uniform(0),
      },
      transparent: true,
      depthWrite: false,
      // Lets the ribbon sit on the floor without z-fighting the grid lines.
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * Re-trace and rebuild, but only when something that moves a lane has changed.
   *
   * Tracing walks the flow field a step at a time and draping calls
   * `groundHeight` per vertex, so this is emphatically not frame work — the
   * signature check is what keeps it off the hot path.
   */
  sync(level: Level, round: number): void {
    const sig = pathSignature(level, round);
    if (sig === this.signature) return;
    this.signature = sig;
    this.rebuild(level, round);
  }

  private rebuild(level: Level, round: number): void {
    this.pos.length = 0;
    this.us.length = 0;
    this.fades.length = 0;
    const index: number[] = [];

    for (const gate of activeGates(level, round)) {
      this.pts.length = 0;
      const n = tracePath(level, gate.x, gate.z, this.pts);
      if (n < 2) continue;

      const base = this.pos.length / 3;
      let u = 0;

      // Total up front: the end-fade needs distance-remaining, and caching it on
      // point count would silently reuse one gate's length for another with the
      // same number of turns.
      let total = 0;
      for (let i = 1; i < n; i++) {
        total += Math.hypot(
          this.pts[i * 2] - this.pts[(i - 1) * 2],
          this.pts[i * 2 + 1] - this.pts[(i - 1) * 2 + 1],
        );
      }

      for (let i = 0; i < n; i++) {
        const x = this.pts[i * 2];
        const z = this.pts[i * 2 + 1];

        // Tangent from the neighbours, so corners get a mitre rather than a kink.
        const px = this.pts[Math.max(0, i - 1) * 2];
        const pz = this.pts[Math.max(0, i - 1) * 2 + 1];
        const nx = this.pts[Math.min(n - 1, i + 1) * 2];
        const nz = this.pts[Math.min(n - 1, i + 1) * 2 + 1];
        let tx = nx - px;
        let tz = nz - pz;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;

        if (i > 0) {
          u += Math.hypot(x - this.pts[(i - 1) * 2], z - this.pts[(i - 1) * 2 + 1]);
        }

        // Left normal in XZ.
        const lx = -tz * HALF;
        const lz = tx * HALF;
        const y = groundHeight(level, x, z, 2.2) + LIFT;

        /*
         * Fade both ends. At the gate it stops the ribbon from ending in a hard
         * bar across the spawn arch; at the Rift it stops a bright wedge sitting
         * on top of the objective, which is the one thing on screen that must
         * stay legible.
         */
        const fromGate = Math.min(1, u / 3);
        const toRift = Math.min(1, (total - u) / 2.5);
        const fade = Math.min(fromGate, toRift);

        this.pos.push(x + lx, y, z + lz, x - lx, y, z - lz);
        this.us.push(u, u);
        this.fades.push(fade, fade);

        if (i < n - 1) {
          const a = base + i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }

    const g = this.mesh.geometry;
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("aU", new BufferAttribute(new Float32Array(this.us), 1));
    g.setAttribute("aFade", new BufferAttribute(new Float32Array(this.fades), 1));
    g.setIndex(index);
    g.computeBoundingSphere();
  }

  /**
   * `show` is the build phase. The fade is 180ms rather than a hard cut: the
   * paths vanishing *is* the round starting, and a dissolve reads as the world
   * doing something while a pop reads as a bug.
   */
  update(dt: number, time: number, show: boolean): void {
    const target = show ? 1 : 0;
    const rate = show ? 4 : 6;
    this.alpha += (target - this.alpha) * Math.min(1, dt * rate);
    if (this.alpha < 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAlpha.value = this.alpha;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
