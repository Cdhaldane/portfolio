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
 * are art-directed billboards in the geometry rather than a raymarch.
 *
 * Antialiasing *is* handled here, because it has to be: `antialias: true` on the
 * renderer only covers the default framebuffer, which a composer never draws to.
 * See `AntiAliasing` for which technique won and what it was measured against.
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
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
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
  /**
   * Fraction of the composer target the bloom chain runs at.
   *
   * **This is the single most important number in this file for frame time.**
   * `UnrealBloomPass` is `nMips = 5`, each mip taking a horizontal *and* a vertical
   * separable blur, plus a luminosity high-pass and a composite — **12 fullscreen
   * half-float passes**, out of 16 in the whole stack. The frame before post existed
   * had exactly one pass, to an RGBA8 default framebuffer with free hardware MSAA.
   * Adding this stack measured as 120fps → 50fps on the dev 3070.
   *
   * The pass already halves internally (its largest mip is `resolution / 2`), so
   * 0.5 here puts the largest mip at a quarter of the target and makes the whole
   * chain **4× cheaper**. Bloom is a deliberately wide blur; there is almost nothing
   * to see at full resolution that a quarter does not also give you, which makes
   * this the cheapest large win available.
   */
  scale: 0.5,
} as const;

/**
 * `?post=0` and `?bloom=0`, so frame cost can be attributed without a rebuild.
 *
 * Bloom is 12 of the 16 passes, so `?bloom=0` is the measurement that matters: it
 * isolates the dominant term from everything else in one page reload, next to the
 * F3 perf overlay which already reports fps, frameMs and renderMs.
 */
function urlFlag(name: string): boolean | null {
  if (typeof location === "undefined") return null;
  const raw = new URLSearchParams(location.search).get(name);
  if (raw === null) return null;
  return raw !== "0" && raw !== "false";
}

export interface PostOptions {
  /**
   * §14.2 gives the Low tier "tonemap only". When false, `render()` draws straight
   * to the canvas and no composer target is allocated at all.
   */
  enabled?: boolean;
  /**
   * MSAA samples on the composer target.
   *
   * Antialiasing, which **has to be handled here rather than on the renderer.**
   * `WebGLRenderer({ antialias: true })` only antialiases the *default
   * framebuffer*, which a composer bypasses entirely — so introducing post
   * silently turned AA off for the whole game. It matters more here than in most
   * games: §17.1's outline pass draws thin dark lines, and a jagged one-pixel line
   * is the most visible aliasing there is. See `AntiAliasing` for the measurements.
   */
  aa?: AntiAliasing;
  /**
   * Bloom is 12 of the stack's 16 passes. Off, the rest of post costs 4 passes.
   * Overridden by `?bloom=0`.
   */
  bloom?: boolean;
}

/**
 * How to antialias inside the composer.
 *
 * `"fxaa"` is the default, and that was decided by measurement rather than taste.
 * MSAA is the better technique for thin geometric edges, but on a half-float
 * composer target it was the single most expensive thing in the frame: the smoke
 * test's rasteriser managed **1 frame in 1.2s at both 4× and 2×, and 2 frames at
 * 0×** — a clean bisection. Memory says the same thing from the other side: a
 * 1920×1080 RGBA16F target costs `1920 × 1080 × 8 × samples`, so 4× is ≈66MB and
 * 2× ≈33MB against §14.2's 96MB *whole-game* texture budget, with §22 R12 warning
 * that the ceiling on 8GB machines is real.
 *
 * FXAA costs one cheap fullscreen pass, no extra memory and no resolve. It softens
 * thin lines slightly, which is a genuine loss given §17.1's outline pass — so
 * `"msaa2"`/`"msaa4"` stay available for a High tier on real hardware, and §22 R20
 * is the reason the *default* is the conservative one rather than the one that
 * looks best on this desk.
 */
export type AntiAliasing = "none" | "fxaa" | "msaa2" | "msaa4";

const MSAA_SAMPLES: Record<AntiAliasing, number> = {
  none: 0,
  fxaa: 0,
  msaa2: 2,
  msaa4: 4,
};

export class Post {
  /** Flip at runtime; the composer stays allocated so it can flip back. */
  enabled: boolean;

  private readonly composer: EffectComposer;
  /** Null when bloom is off — the pass is never constructed, so nor are its 13 targets. */
  private readonly bloom: UnrealBloomPass | null;
  private readonly grade: ShaderPass;
  private readonly target: WebGLRenderTarget;
  private time = 0;
  /** Damped per §20: photosensitivity and reduced-motion both land here. */
  private motion = 1;
  private readonly motionQuery: MediaQueryList | null;

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
    this.enabled = urlFlag("post") ?? opts.enabled ?? true;

    // Half-float, so bloom has values above 1 to work with. An 8-bit target would
    // clip every highlight to white before the threshold ever saw it. Samples
    // restore the MSAA the composer took away — see PostOptions.samples.
    const aa = opts.aa ?? "fxaa";
    this.target = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: MSAA_SAMPLES[aa],
    });
    this.composer = new EffectComposer(renderer, this.target);

    this.composer.addPass(new RenderPass(scene, camera));

    if (urlFlag("bloom") ?? opts.bloom ?? true) {
      this.bloom = new UnrealBloomPass(
        // Placeholder; setSize() gives it the real one before the first frame.
        new Vector2(1, 1),
        BLOOM.strength,
        BLOOM.radius,
        BLOOM.threshold,
      );
      this.composer.addPass(this.bloom);
    } else {
      this.bloom = null;
    }

    this.composer.addPass(new OutputPass());

    // FXAA after tonemapping and before the grade: it wants the final LDR image to
    // find edges in, and running it *after* the grain would smear the grain into
    // streaks instead of antialiasing anything.
    if (aa === "fxaa") this.composer.addPass(new FXAAPass());

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

    /*
     * §20: honour `prefers-reduced-motion` without being asked.
     *
     * Of everything in this stack, exactly two things move: the animated film
     * grain and the aberration pulse on damage. Both are flicker, so both are what
     * the setting is for. The vignette and the split-tone stay — neither moves, and
     * both are load-bearing for the look.
     *
     * Read here rather than plumbed down from the UI so that the shelf and the game
     * both get it for free, and so that no caller can forget.
     */
    this.motionQuery =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    this.motionQuery?.addEventListener("change", this.syncMotionPreference);
    this.syncMotionPreference();
  }

  private readonly syncMotionPreference = (): void => {
    this.setMotionScale(this.motionQuery?.matches ? 0 : 1);
  };

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

  /**
   * Size the stack.
   *
   * **Callers currently pass CSS pixels, and the canvas is up to 1.5× that.**
   * `look.ts` does `setPixelRatio(min(devicePixelRatio, 1.5))`, so the drawing
   * buffer is larger than what `scene.ts` and `shelf.ts` hand in here — the scene
   * therefore renders into a 1× target and the final pass upscales it to a 1.5×
   * canvas. Two consequences, and they pull in opposite directions:
   *
   *  - the image is **softer than it should be**, which is a real quality bug;
   *  - post is running at an effective render scale of ~0.67, which is the only
   *    reason it is not ~2.25× more expensive than it already is.
   *
   * §14.2 does sanction render scale as a tier setting (0.85 / 0.7) and dynamic
   * resolution as "the real safety net" — so this is a legitimate *setting*, it just
   * arrived by accident rather than by choice. The one-line fix is to derive from
   * `renderer.getDrawingBufferSize()` here instead of trusting the caller, and it
   * should be made *after* the bloom change above has been measured on its own,
   * because doing both at once makes neither attributable.
   */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    // Quarter-resolution bloom chain once its own internal halving is applied.
    this.bloom?.setSize(
      Math.max(1, Math.round(width * BLOOM.scale)),
      Math.max(1, Math.round(height * BLOOM.scale)),
    );
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
    this.motionQuery?.removeEventListener("change", this.syncMotionPreference);
    // Hand `info` back, or a renderer reused after this stops counting anything.
    this.renderer.info.autoReset = true;
    this.composer.dispose();
    this.target.dispose();
  }
}
