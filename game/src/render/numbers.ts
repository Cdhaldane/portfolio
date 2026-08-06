/*
 * render/numbers.ts — floating damage numbers.
 *
 * Deliberately DOM, not 3D text. A world-space text mesh needs a font atlas, an
 * SDF shader and a per-glyph instancing scheme; a pool of 32 absolutely-positioned
 * spans needs none of that, renders crisper at 12px than any texture atlas, and
 * costs a handful of `style` writes per frame. When the VFX system arrives at M4
 * this can be swapped for instanced quads behind the same `push()` call.
 *
 * The point of it is legibility, not decoration: without numbers, the ×3 ignite,
 * the ×1.5 mark and the Ironjaw's armour clang are all invisible, and the player
 * has no way to learn the systems (§6).
 */

import { Vector3 } from "three";
import type { Camera } from "three";
import { CSS } from "./palette.ts";

const MAX = 32;
const LIFE = 0.85;

export const NUM = {
  hit: 0,
  ignite: 1,
  clang: 2,
  boot: 3,
  hurt: 4,
} as const;

export type NumKind = (typeof NUM)[keyof typeof NUM];

const STYLE: Record<NumKind, { color: string; size: number; weight: number }> = {
  [NUM.hit]: { color: CSS.sunbleach, size: 15, weight: 600 },
  // The signature synergy gets the loudest number in the game.
  [NUM.ignite]: { color: CSS.ember, size: 24, weight: 700 },
  // Sparks, not damage: the clang has to read as "that did nothing".
  [NUM.clang]: { color: CSS.grave, size: 13, weight: 600 },
  [NUM.boot]: { color: CSS.lamp, size: 17, weight: 700 },
  [NUM.hurt]: { color: CSS.oxblood, size: 20, weight: 700 },
};

const tmp = new Vector3();

export class Numbers {
  private root: HTMLDivElement;
  private els: HTMLSpanElement[] = [];
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private drift = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private next = 0;
  private seed = 0x5d3b;

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "gh-numbers";
    host.appendChild(this.root);
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement("span");
      el.style.opacity = "0";
      this.root.appendChild(el);
      this.els.push(el);
    }
  }

  /** Cosmetic-only randomness: never the sim's streams (§13 rule 2). */
  private rand(): number {
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s | 0;
    return ((s >>> 0) % 1000) / 1000;
  }

  push(kind: NumKind, x: number, y: number, z: number, amount: number): void {
    const i = this.next++ % MAX;
    const el = this.els[i];
    const style = STYLE[kind];

    // Sub-1 numbers are burn ticks: they'd spam the screen with "0".
    const rounded = Math.round(amount);
    if (kind === NUM.hit && rounded < 1) return;

    el.textContent = kind === NUM.clang ? "CLANG" : String(rounded);
    el.style.color = style.color;
    el.style.fontSize = `${style.size}px`;
    el.style.fontWeight = String(style.weight);

    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vy[i] = 1.6 + this.rand() * 0.9;
    this.drift[i] = (this.rand() - 0.5) * 1.2;
    this.life[i] = LIFE;
  }

  update(dt: number, camera: Camera, width: number, height: number): void {
    for (let i = 0; i < MAX; i++) {
      const el = this.els[i];
      if (this.life[i] <= 0) {
        if (el.style.opacity !== "0") el.style.opacity = "0";
        continue;
      }
      this.life[i] -= dt;
      this.y[i] += this.vy[i] * dt;
      this.vy[i] -= 2.6 * dt;
      this.x[i] += this.drift[i] * dt;

      tmp.set(this.x[i], this.y[i], this.z[i]).project(camera);
      // Behind the camera: hide rather than mirror it onto the screen.
      if (tmp.z > 1) {
        el.style.opacity = "0";
        continue;
      }
      const sx = (tmp.x * 0.5 + 0.5) * width;
      const sy = (-tmp.y * 0.5 + 0.5) * height;
      const t = Math.max(0, this.life[i] / LIFE);
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      el.style.opacity = (t * t).toFixed(3);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
