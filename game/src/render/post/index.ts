/*
 * render/post/index.ts — the §14.5 post stack.
 *
 * Four passes, in an order that is decided by where each effect has to live:
 *
 *   RenderPass ──► UnrealBloomPass ──► OutputPass ──► GradePass (to screen)
 *                  HDR, pre-tonemap    tonemap+sRGB   display space, last
 *
 *  - **Bloom before tonemapping**, because it is an HDR effect: it needs values
 *    above 1 to bloom, and tonemapping is what removes them.
 *  - **Grade after tonemapping**, because its dither exists to fight the final
 *    8-bit quantisation (see post/grade.ts).
 *
 * ## Hand-rolled on three's own composer, not `postprocessing`
 *
 * Appendix A lists pmndrs `postprocessing` 6.39.4, and it is a better library — it
 * merges effects into one pass automatically, which is exactly what grade.ts does
 * by hand. It is not installed, and for four effects it would be a new dependency
 * to avoid writing ~80 lines. It would also put a second shader framework behind
 * the §14.7 renderer-backend seam, which is the thing that seam exists to keep
 * thin. Revisit if the stack grows past god rays.
 *
 * ## Deliberately not here
 *
 * §14.5 rules out SSAO (baked instead), SSR, TAA and motion blur, and says god rays
 * are art-directed billboards in the geometry rather than a raymarch. Antialiasing
 * stays MSAA on the main target (`WebGLRenderer({ antialias: true })`) — note that
 * MSAA does *not* survive a composer's render target, so an FXAA pass is the likely
 * follow-up if edges read badly. Left out for now rather than guessed at.
 */

import {
  HalfFloatType,
  Vector2,
  type Camera,
  type Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { GradeShader } from "./grade.ts";

/**
 * Bloom tuning (§14.5: "selective bloom on emissives only… threshold high, radius
 * wide").
 *
 * True selective bloom means a second scene render with everything non-emissive
 * masked black, which costs a full extra pass. A high threshold buys most of it for
 * free *given this palette*: the toon ramp caps a surface at its swatch value, and
 * the 14 swatches top out around 0.9 — so almost nothing except genuine light
 * sources (the Rift's `bell`, gate-post `ember`, muzzle flash, sparks) clears 0.85.
 *
 * If a bright wall ever starts blooming, that is the signal to spend the extra pass
 * rather than to lower the threshold.
 */
const BLOOM = {
  strength: 0.62,
  radius: 0.85,
  threshold: 0.85,
} as const;

export interface PostOptions {
  /**
   * §14.2 gives the Low tier "tonemap only". When false, `render()` draws straight
   * to the canvas and no composer target is allocated at all.
   */
  enabled?: boolean;
}

export class Post {
  /** Flip at runtime; the composer stays allocated so it can flip back. */
  enabled: boolean;

  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly target: WebGLRenderTarget;
  private time = 0;
  /** Damped per §20: photosensitivity and reduced-motion both land here. */
  private motion = 1;

  // Explicit fields rather than constructor parameter properties: the project sets
  // `erasableSyntaxOnly`, because Node's `--experimental-strip-types` can only
  // erase types, and a parameter property emits an assignment.
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, opts: PostOptions = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = opts.enabled ?? true;

    // Half-float, so bloom has values above 1 to work with. An 8-bit target would
    // clip every highlight to white before the threshold ever saw it.
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, this.target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      // Placeholder; setSize() gives it the real one before the first frame.
      new Vector2(1, 1),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);

    /*
     * Take over `renderer.info` bookkeeping.
     *
     * three resets `info.render` at the top of every `render()` call, and a
     * composer calls `render()` once per pass — so by the time a frame is done,
     * `info` describes only the final fullscreen quad. That silently turned the
     * perf HUD and the smoke test's draw-call assertion into "1 call, 1 triangle".
     *
     * Resetting once per frame instead accumulates every pass, which is both the
     * fix and the more honest number: §14.1 budgets 2.5ms for the whole render
     * submit, and post is part of that submit.
     */
    renderer.info.autoReset = false;
  }

  /** 0..1 damage flash. Fed from the renderer's existing hurt timer (§14.6). */
  setHurt(v: number): void {
    this.grade.uniforms.uHurt.value = Math.max(0, Math.min(1, v));
  }

  /**
   * §20: reduced motion and "reduce flashes" both damp the same things — the
   * animated grain and the aberration pulse. The vignette and the split-tone stay,
   * because neither moves and both are load-bearing for the look.
   */
  setMotionScale(scale: number): void {
    this.motion = Math.max(0, Math.min(1, scale));
    this.grade.uniforms.uGrain.value = 0.012 * this.motion;
    this.grade.uniforms.uAberration.value = 0.0022 * this.motion;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
    this.grade.uniforms.uResolution.value.set(width, height);
  }

  render(dt: number): void {
    // Once per frame, before anything draws — see the note in the constructor.
    this.renderer.info.reset();

    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    // Grain animates on wall-clock, not on ticks: it is presentation-only and must
    // keep moving while the sim is paused (§12.3 — pause stops stepping, not
    // rendering).
    this.time += dt * this.motion;
    this.grade.uniforms.uTime.value = this.time;
    this.composer.render(dt);
  }

  dispose(): void {
    // Hand `info` back, or a renderer reused after this stops counting anything.
    this.renderer.info.autoReset = true;
    this.composer.dispose();
    this.target.dispose();
  }
}
