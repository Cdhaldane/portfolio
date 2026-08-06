/*
 * render/icons.ts — hotbar icons, rendered from the traps themselves.
 *
 * §7 decision 17: the hotbar needs pictures, and they must not be hand-drawn.
 * Decision 15 already makes every trap a parameterized `BufferGeometry`, so the
 * icon is generated from that same mesh rather than authored beside it. A drawn
 * icon starts lying the moment a trap is retuned — and retuning is the stated
 * advantage of code-authored props. This one cannot drift, because there is only
 * one source.
 *
 * It also keeps 23 icons out of the §17.12 art budget, which is the critical
 * path from M4 onward.
 *
 * Cost: one throwaway WebGL context at boot, ~9 draws, then disposed. The main
 * renderer is never touched — this deliberately does not borrow it, because
 * stealing the render target mid-frame is exactly the kind of coupling that
 * turns into a heisenbug later.
 */

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import { COLOR } from "./palette.ts";
import { TRAP_MODELS, buildTrapGeometry } from "./models/traps.ts";

/** Icon edge in device pixels. 96 is 2× the 48px slot — crisp on retina. */
const SIZE = 96;

/**
 * Three-quarter view, matching how the player sees a trap on the ground.
 * A pure side or top view reads as an ambiguous blob for most of the roster;
 * this angle keeps the silhouette that §17.1 says has to do the work.
 */
const DIR = new Vector3(0.55, 0.62, 0.55).normalize();

export type TrapIcons = Record<string, string>;

/**
 * Render every trap model to a data URL, keyed by model name.
 *
 * Returns an empty map rather than throwing when WebGL is unavailable (headless
 * tests, a context-limited browser). The hotbar falls back to its text glyph, so
 * a missing icon is a cosmetic downgrade and never a crash.
 */
export function renderTrapIcons(keys: string[] = Object.keys(TRAP_MODELS)): TrapIcons {
  const out: TrapIcons = {};

  let canvas: HTMLCanvasElement;
  let renderer: WebGLRenderer;
  try {
    canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return out;
  }

  try {
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearAlpha(0);

    const scene = new Scene();
    /* Traps carry their colours in vertex attributes (decision 15), so the icon
     * needs an unlit material that just shows them — matching the flat, banded
     * read of the world shader closely enough at 48px, without dragging the
     * game's full material setup into a boot-time utility. */
    const material = new MeshBasicMaterial({ vertexColors: true });
    const key = new DirectionalLight(COLOR.sunbleach, 1);
    key.position.copy(DIR);
    scene.add(key, new AmbientLight(COLOR.dust, 0.6));

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

    for (const name of keys) {
      const geometry = buildTrapGeometry(name);
      const mesh = new Mesh(geometry, material);
      scene.add(mesh);

      /* Frame the model rather than assuming a size: traps range from a 0.5m
       * bear trap to a 2m lantern post, and a fixed camera would crop half the
       * roster. Fit the bounding sphere, then pad so nothing touches the edge. */
      const box = new Box3().setFromObject(mesh);
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 0.5;
      const half = radius * 1.15;

      camera.left = -half;
      camera.right = half;
      camera.top = half;
      camera.bottom = -half;
      camera.position.copy(centre).addScaledVector(DIR, radius * 8);
      camera.lookAt(centre);
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
      out[name] = canvas.toDataURL("image/png");

      scene.remove(mesh);
      geometry.dispose();
    }

    material.dispose();
  } catch {
    /* Partial results are still useful — whatever rendered before the failure
     * is returned, and the rest fall back to glyphs. */
  } finally {
    /* Free the context immediately. Browsers cap concurrent WebGL contexts, and
     * the game needs its own for the whole session. */
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  return out;
}
