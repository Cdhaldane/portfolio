/*
 * render/look.ts — the one definition of how this game is lit and tonemapped.
 *
 * Extracted from `scene.ts` when the shelf scene (`render/shelf.ts`) landed, for
 * one reason that is the whole point of having a shelf at all: **a review scene
 * that lights assets differently from the game is worse than no review scene.**
 * It tells you your assets cohere when they don't, or that they clash when they
 * don't. So the lighting, the atmosphere and the tonemap live here, and both the
 * play scene and the shelf call the same functions.
 *
 * If you tune a value in this file, you tune it for both. That's the contract.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  type Scene,
  type WebGLRenderer,
} from "three";

import { COLOR } from "./palette.ts";
import { OPEN_AIR, SKY, type Atmosphere } from "../sim/atmosphere.ts";

/** How big the lit area is, so the shadow camera and the moon can be placed. */
export interface LookExtent {
  width: number;
  depth: number;
}

export function applyRendererLook(renderer: WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
}

/**
 * Moonlight: `bell` pulled most of the way to white.
 *
 * Values tuned against screenshots, not guessed. Two constraints fight here:
 *
 *  - The palette is deliberately dark (§17.1), so the lighting has to do real
 *    work or the whole site reads as one black shape.
 *  - Saturated cyan is *mechanical information* (§3): it must only ever mean
 *    Choir / arcane / "physical traps won't work here". Lighting the floor with
 *    `bell` spends that signal on scenery.
 *
 * So it's a cool *value* that reads as night without claiming the hue. Lights
 * aren't albedo, so this is not palette drift; the 14 swatches still own every
 * surface colour.
 */
export function moonlightColour(): Color {
  return new Color(COLOR.bell).lerp(new Color(0xffffff), 0.72);
}

/**
 * The colour the world dissolves into at distance.
 *
 * Shared with the sky dome's horizon band (`models/props.ts`), and that sharing
 * is the point: if the fog and the horizon disagree, the far wall of the site
 * ends on a visible seam against the sky. Same reasoning as moonlight — a cool
 * *value* lifted toward `bell` without claiming the hue, because §3 reserves
 * saturated cyan for the Choir.
 */
export function horizonColour(): Color {
  return new Color(COLOR.ash).lerp(new Color(COLOR.bell), 0.3);
}

/**
 * Which way the moon actually is, as a unit vector.
 *
 * Derived from the same numbers `applySceneLighting` places the light with, so
 * the sky's glow and the moon disc can't drift away from the direction the
 * shadows are being cast from — which is the kind of mistake that reads as
 * "wrong" long before anyone works out why.
 */
export function moonDirection(extent: LookExtent): { x: number; y: number; z: number } {
  const x = extent.width * 0.35;
  const y = 26;
  const z = -extent.depth * 0.3;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

export function applySceneAtmosphere(scene: Scene, air: Atmosphere = OPEN_AIR): void {
  const cavern = air.sky === SKY.cavern;
  /*
   * Underground the world does not dissolve into a horizon, it dissolves into
   * unlit rock — so the fog goes to `void` rather than to the sky colour, and the
   * background with it. Get this wrong and a sealed cavern reads as an open field
   * on an overcast day, which is the one thing the Undertown must never look like.
   */
  const far = cavern ? new Color(COLOR.void).lerp(new Color(COLOR.ash), 0.35) : horizonColour();
  // The background still matters even with a dome in front of it: it is what
  // shows through before the dome draws, and what the shelf falls back to.
  scene.background = far.clone().multiplyScalar(cavern ? 0.35 : 0.55);
  scene.fog = new Fog(far.getHex(), air.fogNear, air.fogFar);
}

/**
 * One shadow-casting directional (§14.4) plus a low bounce. Returns the moon so
 * a caller can retarget it — the shelf aims it at the display rows rather than
 * at the middle of a site.
 */
export function applySceneLighting(
  scene: Scene,
  extent: LookExtent,
  air: Atmosphere = OPEN_AIR,
): DirectionalLight {
  const moonlight = moonlightColour();
  /*
   * `air.moon` is 0 underground, and that zero is the Undertown's whole lighting
   * brief (MAPS §5): with no directional term, everything visible is either the
   * hemisphere bounce or a lamp somebody placed. The light object is still created
   * and still returned — the shelf retargets it, and a null here would spread an
   * optional through every caller for no gain.
   */
  const moon = new DirectionalLight(moonlight.getHex(), air.moon);
  moon.visible = air.moon > 0;
  moon.position.set(extent.width * 0.75, 26, extent.depth * 0.2);
  moon.target.position.set(extent.width * 0.4, 0, extent.depth * 0.5);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -30;
  moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 30;
  moon.shadow.camera.bottom = -30;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 80;
  moon.shadow.bias = -0.0008;
  scene.add(moon, moon.target);

  /*
   * A second directional, opposite the moon, casting no shadow: the rim.
   *
   * §17.1 has a hard rule that enemies are "always darker than their background
   * or rim-lit against it — never mid-on-mid", and the baseline screenshot is
   * exactly the failure it warns about: a `grave`-coloured coat on a `dust`
   * floor, both mid-value, with the hero reading as one black lump. A key light
   * can't fix that — it lights the side facing it, and this camera only ever
   * sees the side facing away.
   *
   * The shipping answer at §17.1 is a Fresnel rim term in the toon shader. This
   * is the same idea one tier down: a cheap back-light in the lamp hue that
   * catches the top and edges of everything the moon misses. It gets no shadow
   * map, so it costs one extra light term and nothing else.
   */
  const rim = new DirectionalLight(COLOR.lamp.getHex(), 0.85);
  rim.position.set(-extent.width * 0.3, 14, extent.depth * 1.25);
  rim.target.position.set(extent.width * 0.5, 1, extent.depth * 0.5);
  scene.add(rim, rim.target);

  // Ground bounce stays low: crank it and warm dust light turns the night into
  // an afternoon. Lifted 0.62 → 0.78 now that there is a sky dome for it to be
  // consistent with — the ambient was standing in for a sky that wasn't there.
  /*
   * The bounce. Underground it is doing the job of both the sky and the moon, so
   * the sites carry their own figure — and the *sky* colour goes warm, because
   * what is overhead down there is lamplit rock rather than a cold night.
   */
  const above = air.sky === SKY.cavern ? COLOR.timberDark : moonlight;
  scene.add(new HemisphereLight(above.getHex(), COLOR.dust.getHex(), air.hemi));
  scene.add(new AmbientLight(COLOR.bone.getHex(), 0.3));

  return moon;
}
