/*
 * render/post/grade.ts — split-tone, vignette, grain, dither, aberration, hurt.
 *
 * Six effects from GALLOWS_HYMN.md §14.5 in **one** fragment shader, on purpose:
 * §14.1 budgets 2.5ms for the whole render submit, and six ShaderPasses would be
 * six full-screen reads and writes for work that fits in one.
 *
 * ## Why this pass runs *after* tonemapping
 *
 * §14.5's stated reason for the dither is the one that fixes the order:
 *
 *   > Film grain + ordered dither at low amplitude. Kills gradient banding in the
 *   > dark mine interiors — a real problem at 8-bit output, and the fix is nearly
 *   > free.
 *
 * Banding happens at the **final 8-bit quantisation**. Dithering in linear HDR and
 * then tonemapping squashes the noise back below one LSB in exactly the dark
 * regions it was added for, so the pass has to be last: after `OutputPass` has
 * tonemapped and encoded, immediately before the write to the default framebuffer.
 *
 * That also means the grade works in display space rather than linear, which for a
 * stylized look is a feature — the split-tone is art direction, not colour science,
 * and it is far easier to dial in on values you can actually see.
 *
 * The banding problem got *worse* the day the toon shader landed: a hard 3-band
 * ramp over a deliberately dark palette (§17.1) is precisely the content that
 * shows quantisation steps on a large soft gradient.
 */

import { Vector2, Vector3 } from "three";

/**
 * Cool shadows, warm highlights — the Buried palette in one node (§14.5).
 *
 * Multipliers either side of white rather than colours to blend toward, so a
 * neutral surface stays neutral in the midtones and only the extremes tint. The
 * split is deliberately slight; §3 reserves saturated cyan for the Choir, and a
 * heavy cool grade in the shadows would spend that signal on the whole frame.
 */
const SHADOW_TINT = new Vector3(0.9, 0.96, 1.08);
const HIGHLIGHT_TINT = new Vector3(1.07, 1.0, 0.92);

/** Radial red flash on player damage (§14.6). Oxblood, per the §3 contract. */
const HURT_COLOUR = new Vector3(0.48, 0.12, 0.14);

export const GradeShader = {
  name: "GallowsGrade",

  uniforms: {
    tDiffuse: { value: null as unknown },
    /** Seconds. Only the grain uses it, and only when it is allowed to animate. */
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    /** Film grain amplitude, in units of output range. ~0.012 is "barely there". */
    uGrain: { value: 0.012 },
    /** 0 = off, 1 = full corner darkening. */
    uVignette: { value: 0.55 },
    /** 0..1 damage flash, driven from the sim's own hurt timer. */
    uHurt: { value: 0 },
    /** Radial chromatic aberration at the edges. §14.5: "very restrained". */
    uAberration: { value: 0.0022 },
    /** Ordered dither amplitude in LSBs. 1.0 = ±0.5/255. */
    uDither: { value: 1 },
    uShadowTint: { value: SHADOW_TINT },
    uHighlightTint: { value: HIGHLIGHT_TINT },
    uHurtColour: { value: HURT_COLOUR },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uHurt;
    uniform float uAberration;
    uniform float uDither;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform vec3 uHurtColour;
    varying vec2 vUv;

    float hash12( vec2 p ) {
      return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    }

    // 4x4 ordered dither without a lookup array.
    //
    // GLSL ES 1.0 — which three still emits unless a shader opts into GLSL3 —
    // forbids indexing a const array with a non-constant index, so the textbook
    // Bayer matrix cannot simply be written down. This is the standard recursive
    // formulation, which produces the same 4x4 pattern arithmetically.
    float bayer2( vec2 a ) {
      a = floor( a );
      return fract( a.x * 0.5 + a.y * a.y * 0.75 );
    }
    float bayer4( vec2 a ) {
      return bayer2( 0.5 * a ) * 0.25 + bayer2( a );
    }

    void main() {
      vec2 centred = vUv - 0.5;
      float r2 = dot( centred, centred );

      // 1. Chromatic aberration, radial and edges-only. The hurt flash drives it
      //    hard for a few frames, which is §14.6's "3-frame chromatic pulse".
      vec2 offset = centred * r2 * uAberration * ( 1.0 + uHurt * 7.0 );
      vec3 colour = vec3(
        texture2D( tDiffuse, vUv + offset ).r,
        texture2D( tDiffuse, vUv ).g,
        texture2D( tDiffuse, vUv - offset ).b
      );

      // 2. Split tone by luminance.
      float luma = dot( colour, vec3( 0.2126, 0.7152, 0.0722 ) );
      colour *= mix( uShadowTint, uHighlightTint, smoothstep( 0.12, 0.82, luma ) );

      // 3. Vignette.
      float vig = smoothstep( 0.95, 0.18, r2 * 1.7 );
      colour *= mix( 1.0, vig, uVignette );

      // 4. Damage flash, strongest at the edges so it never hides the crosshair.
      colour = mix(
        colour,
        uHurtColour,
        clamp( uHurt, 0.0, 1.0 ) * smoothstep( 0.02, 0.42, r2 ) * 0.8
      );

      // 5. Film grain. Centred so it neither lifts nor crushes the average.
      float grain = hash12( vUv * uResolution + fract( uTime ) * 137.0 ) - 0.5;
      colour += grain * uGrain;

      // 6. Ordered dither, last. Sub-LSB noise so the 8-bit write breaks a
      //    gradient into a pattern instead of a step.
      colour += ( bayer4( gl_FragCoord.xy ) - 0.5 ) * uDither / 255.0;

      gl_FragColor = vec4( colour, 1.0 );
    }
  `,
};
