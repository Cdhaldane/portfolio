/*
 * render/materials.ts — the one shader every asset is styled through.
 *
 * GALLOWS_HYMN.md §17.1 specifies "banded toon + outline", and §17.9 makes this
 * file the load-bearing half of the cohesion strategy:
 *
 *   > One shader for everything. Two meshes from different generators under one
 *   > shader read as one world; the same two under a physically-accurate shader
 *   > read as two asset packs.
 *
 * That is why this exists as a factory rather than as materials scattered across
 * `actors.ts` and `scene.ts`. Every lit surface in the game — hero, horde, traps,
 * architecture, dressing — comes out of `toonMaterial()`, so restyling the whole
 * game is one edit here.
 *
 * ## Why MeshToonMaterial rather than a patched MeshStandardMaterial
 *
 * §17.1 allows either "a custom ShaderMaterial (or MeshStandardMaterial with
 * onBeforeCompile injections)". three ships a toon lighting model already, and it
 * quantises the diffuse term through a `gradientMap` lookup — which *is* the hard
 * 3-band ramp the spec asks for, correctly integrated with shadows, fog and every
 * light type. Hand-patching the physical BRDF to fake the same thing would be more
 * code and more fragile for an identical result.
 *
 * What we lose is `roughness`/`metalness`, and that loss is the point: §17.1 says
 * "Not full PBR". The traps used to vary both per element; under a banded ramp
 * those knobs did nothing a value change couldn't do better.
 *
 * ## What is injected on top
 *
 * Only the rim. three's toon material has no Fresnel term, and §17.1 is explicit
 * that the rim is what separates a body from its background at forty-on-screen —
 * the rule being "enemies are *always* darker than their background or rim-lit
 * against it, never mid-on-mid". `look.ts` currently stands in for this with a
 * second directional light; see the note there.
 */

import {
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
} from "three";

import { COLOR } from "./palette.ts";

/* ── the ramp ────────────────────────────────────────────────────────────── */

/**
 * Three bands, and the crispness is the style.
 *
 * three samples this at `dot(N, L) * 0.5 + 0.5` with `NearestFilter`, so a
 * three-texel texture gives exactly three tones with hard terminators between
 * them. A smooth ramp here lands back in stylized-realism (§17.1).
 *
 * The values are not evenly spaced on purpose: the shadow band sits low enough to
 * read as shadow rather than as "slightly darker", and the two lit bands are close
 * together so a curved surface reads as *one* lit form with a highlight rather than
 * as three stripes.
 */
const BANDS = [0.32, 0.74, 1.0];

function bandRamp(levels: readonly number[]): DataTexture {
  const data = new Uint8Array(levels.length);
  for (let i = 0; i < levels.length; i++) data[i] = Math.round(levels[i] * 255);
  const tex = new DataTexture(data, levels.length, 1, RedFormat, UnsignedByteType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** One texture shared by every material in the game. */
let ramp: DataTexture | null = null;
function sharedRamp(): DataTexture {
  ramp ??= bandRamp(BANDS);
  return ramp;
}

/* ── the rim ─────────────────────────────────────────────────────────────── */

/**
 * Fresnel rim strength per surface class — and these are deliberately *small*.
 *
 * §17.1 asks for "a strong Fresnel rim", and the first pass took that literally at
 * 0.5 for characters. Looking at it in the shelf showed why that can't work here:
 *
 * **A Fresnel rim needs smooth normals. Our geometry is flat-shaded on purpose.**
 *
 * `models/build.ts` gives every facet its own face normal, because hard faceting
 * is the correct read under a banded ramp. But that means `dot(N, V)` is *constant
 * across a whole facet* — so instead of a bright line hugging the silhouette, the
 * rim lands as a uniform wash on every facet that happens to face away. At 0.5 the
 * result was orange blotches over the Ironjaw and the hero, not a rim.
 *
 * So the separation job that §17.1 assigns to the rim is done by the **outline**
 * instead, which is the mechanism that actually suits faceted art. What's left
 * here is a small warm lift on grazing facets — worth keeping, because it stops
 * the darkest facets going fully flat, but it is no longer load-bearing.
 *
 * Recorded rather than quietly tuned, because the doc still says "strong" and the
 * reason it can't be is a property of the art direction, not of these numbers.
 */
export const RIM = {
  character: 0.15,
  prop: 0.1,
  architecture: 0.03,
} as const;

/**
 * How tightly the rim hugs the silhouette. Higher = thinner band.
 *
 * Raised from 2.6: a tighter falloff confines the lift to facets that are nearly
 * edge-on, which is the closest a flat-shaded mesh gets to a real rim.
 */
const RIM_POWER = 4.5;

function rimPatch(strength: number, colour: Color): (shader: { fragmentShader: string }) => void {
  // Inlined as GLSL literals rather than uniforms: nothing animates these, and
  // uniforms added from onBeforeCompile need their own lifetime management for no
  // benefit. Vite reloads the module on edit, which is the tuning loop we want.
  const r = colour.r.toFixed(4);
  const g = colour.g.toFixed(4);
  const b = colour.b.toFixed(4);
  const s = strength.toFixed(4);

  return (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      /* glsl */ `
      // Fresnel rim (§17.1). vViewPosition points from the fragment toward the
      // camera, so this is the facing ratio: 1 at the silhouette, 0 head-on.
      {
        float facing = clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );
        float rim = pow( 1.0 - facing, ${RIM_POWER.toFixed(2)} );
        gl_FragColor.rgb += vec3( ${r}, ${g}, ${b} ) * rim * ${s};
      }
      #include <dithering_fragment>`,
    );
  };
}

/* ── the material ────────────────────────────────────────────────────────── */

export interface ToonOptions {
  /** Baked per-part colour lives in the vertex stream for every model. */
  vertexColors?: boolean;
  /** Rim strength — pick from `RIM`, don't invent a number. */
  rim?: number;
  transparent?: boolean;
  opacity?: number;
  doubleSided?: boolean;
  /** Multiplied over the vertex colour. Leave white unless there's a reason. */
  color?: Color | number;
}

export function toonMaterial(opts: ToonOptions = {}): MeshToonMaterial {
  const material = new MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    vertexColors: opts.vertexColors ?? true,
    gradientMap: sharedRamp(),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.doubleSided ? DoubleSide : undefined,
  });

  const rim = opts.rim ?? RIM.prop;
  if (rim > 0) {
    // `lamp` pulled halfway to white. The rim is additive, so the raw swatch —
    // a fully saturated orange — tints the entire frame warm rather than lifting
    // it. Same reasoning as the moonlight in look.ts: a light is a value, and
    // spending a palette hue on it spends a signal the palette needs elsewhere.
    material.onBeforeCompile = rimPatch(
      rim,
      new Color(COLOR.lamp).lerp(new Color(0xffffff), 0.5),
    );
    // Two materials with the same program cache key share a compiled program, and
    // three's key does not know about our injection — so materials with different
    // rim strengths must not collide.
    material.customProgramCacheKey = () => `gh-toon-rim-${rim.toFixed(3)}`;
  }

  return material;
}

/* ── the outline ─────────────────────────────────────────────────────────── */

/**
 * Inverted-hull outline (§17.1): the same geometry, back faces only, pushed out
 * along its normals and drawn flat black.
 *
 * A `ShaderMaterial` rather than a patched `MeshBasicMaterial`, because basic
 * material's vertex shader does not compute `objectNormal` unless something else
 * asks it to — so the chunk we need may or may not be there depending on
 * unrelated material settings. Assembling three's own chunks by hand is both
 * shorter and impossible to break that way, and `<project_vertex>` brings
 * instancing support with it, which is what lets a 220-body horde get outlines
 * for one extra draw call per archetype.
 *
 * **Not for architecture.** An outline on every edge of a modular kit reads as a
 * wireframe, and the kit's silhouette is already carried by its value structure.
 */
export function outlineMaterial(thickness = 0.018): ShaderMaterial {
  return new ShaderMaterial({
    // Not a uniform, for the same reason as the rim: nothing animates it.
    // No morph or skinning chunks: nothing in this game is a SkinnedMesh (the hero
    // is a rig of rigid parts, §17.6), and including chunks we don't need is how
    // you acquire a compile error that depends on a three version bump.
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      void main() {
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        transformed += objectNormal * ${thickness.toFixed(5)};
        #include <project_vertex>
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 outlineColor;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4( outlineColor, 1.0 );
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      // `void`, not pure black: the palette owns every colour in the game (§17.1),
      // and a true-black outline against a `void` background disappears.
      outlineColor: { value: new Color(COLOR.void).multiplyScalar(1.35) },
    },
    // The whole trick: draw only the faces pointing away, so the expanded hull
    // shows exactly where the real mesh does not cover it.
    side: BackSide,
    fog: false,
  });
}

/**
 * Outline a plain mesh by parenting the hull to it.
 *
 * A child inherits its parent's world transform for free, so nothing has to be
 * kept in sync per frame. Works for the hero's rigid parts and for anything in
 * the shelf; does **not** work for an `InstancedMesh`, whose children are not
 * instanced — see `instancedOutline`.
 */
export function attachOutline(source: Mesh, thickness?: number): Mesh {
  const outline = new Mesh(source.geometry, outlineMaterial(thickness));
  outline.castShadow = false;
  outline.receiveShadow = false;
  source.add(outline);
  return outline;
}

/**
 * Outline an instanced pool with a sibling pool that **shares its transform
 * buffer**.
 *
 * This is what makes outlines affordable on a 220-body horde: one extra draw call
 * per archetype and zero extra matrix maths, because `instanceMatrix` is the same
 * `InstancedBufferAttribute` object on both meshes. The caller must mirror `count`
 * each frame — the transforms come along on their own, the count does not.
 */
export function instancedOutline(source: InstancedMesh, thickness?: number): InstancedMesh {
  const outline = new InstancedMesh(
    source.geometry,
    outlineMaterial(thickness),
    source.instanceMatrix.count,
  );
  outline.instanceMatrix = source.instanceMatrix;
  outline.frustumCulled = false;
  outline.castShadow = false;
  outline.count = 0;
  // Behind the bodies it outlines, so a body never gets a rim of its own hull
  // drawn over its front faces.
  outline.renderOrder = (source.renderOrder ?? 0) - 1;
  return outline;
}

/** Dispose the module-level ramp. For tests and hot-reload, not for gameplay. */
export function disposeSharedMaterials(): void {
  ramp?.dispose();
  ramp = null;
}
