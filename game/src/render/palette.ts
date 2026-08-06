/*
 * render/palette.ts — the 14 swatches from GALLOWS_HYMN.md §17.1.
 *
 * Every colour in the game comes from here. That's the whole cohesion strategy
 * (§17.9): heterogeneous sources, one palette, one shader. Enforcing it from the
 * first grey-box means there is never a "de-colourise everything" pass later.
 */

import { Color } from "three";

export const HEX = {
  void: 0x0b0a0c,
  ash: 0x232227,
  grave: 0x3b3a3d,
  dust: 0x6e6559,
  bone: 0xc9bfa8,
  sunbleach: 0xe6dfc8,
  timber: 0x5a4433,
  timberDark: 0x33261c,
  rust: 0x8a4a2b,
  oxblood: 0x7a1f24,
  lamp: 0xffab5e,
  ember: 0xff5d3b,
  hex: 0x4ff0e0,
  bell: 0x9be3ff,
} as const;

export type SwatchName = keyof typeof HEX;

export const COLOR: Record<SwatchName, Color> = Object.fromEntries(
  (Object.keys(HEX) as SwatchName[]).map((k) => [k, new Color(HEX[k])]),
) as Record<SwatchName, Color>;

/** Element (sim/traps.ts) → swatch. Keeps the §3 colour contract in one place. */
export const ELEM_SWATCH: SwatchName[] = ["bone", "timberDark", "ember", "lamp", "hex"];

/** CSS strings for the HUD, so React and three never drift apart. */
export const CSS: Record<SwatchName, string> = Object.fromEntries(
  (Object.keys(HEX) as SwatchName[]).map((k) => [
    k,
    `#${HEX[k].toString(16).padStart(6, "0")}`,
  ]),
) as Record<SwatchName, string>;
