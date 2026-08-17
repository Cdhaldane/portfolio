/*
 * sim/atmosphere.ts — what the air is like, per site.
 *
 * Engine work item 9 from GALLOWS_HYMN_MAPS.md §9. `render/look.ts` hard-codes
 * `Fog(ash, 30, 110)`, one moon, a sky dome, a starfield and a ring of hills. All
 * five are correct for Boot Hill and all five are *wrong* for a town that fell
 * thirty metres into a cavern (MAPS §5) — there is no sky down there to draw.
 *
 * It lives in `sim/` rather than `render/` for the same reason the camera pose
 * does (§21.1 note 1): it is authored per site, so it is part of the map's data,
 * and the sim owns the map. No system reads it and nothing here can affect the
 * state hash — it is carried through and handed to the renderer, which is its
 * only consumer.
 */

export const SKY = {
  /** Moon, stars, a dome, and hills beyond the perimeter. */
  open: 0,
  /** Sealed rock overhead. No dome, no moon, no horizon, no beyond. */
  cavern: 1,
} as const;

export type SkyKind = (typeof SKY)[keyof typeof SKY];

/** A shaft of daylight falling through a hole in the roof (MAPS §5, the Fall). */
export interface LightShaft {
  x: number;
  z: number;
  radius: number;
  /** Metres from the floor to the breach. Taller than `roof`, by definition. */
  height: number;
}

/**
 * An authored lantern: a warm point light with a visible source.
 *
 * Underground the hemisphere is a floor, not an image — MAPS §6's own rule is
 * that when a cavern reads too dark "the fix is lantern density rather than fog
 * distance", so lanterns are site data the way gates are. The renderer hangs a
 * light here and the dressing builds the lantern it hangs from, because a glow
 * with no source reads as a bug (the gate-arch rule, scene.ts).
 */
export interface LampDef {
  x: number;
  /** Height of the flame, absolute metres — lamps hang at gallery height too. */
  y: number;
  z: number;
  /** Standing lamp: the dressing adds a post from the ground to the bracket. */
  post?: boolean;
}

export interface Atmosphere {
  sky: SkyKind;
  /**
   * Metres of rock overhead, and the height ceiling traps mount at. 0 = open air,
   * which is also what "there is no ceiling to mount to" means to the census.
   */
  roof: number;
  fogNear: number;
  fogFar: number;
  /** Directional (moon) intensity. Underground this is 0, and that is the point. */
  moon: number;
  /** Hemisphere bounce. It carries the whole image once the moon is gone. */
  hemi: number;
  shaft?: LightShaft;
  /** Authored lantern pools. The dark sites carry their own light sources. */
  lamps?: LampDef[];
}

/**
 * Boot Hill, and the default for anything that does not say otherwise.
 *
 * The four numbers are the ones `render/look.ts` has been hard-coding since M0,
 * lifted verbatim so that moving them into data changed nothing on screen.
 */
export const OPEN_AIR: Atmosphere = {
  sky: SKY.open,
  roof: 0,
  fogNear: 30,
  fogFar: 110,
  moon: 2.3,
  hemi: 0.62,
};

/**
 * The Undertown (MAPS §5).
 *
 * Rock at 12m, the fog pulled in to cave distances, and **`moon: 0`** — no
 * directional light at all. That last number is the whole reason this file
 * exists, and it is the one that makes the map a lighting problem: with the moon
 * gone, everything visible is either the hemisphere term or a lamp somebody
 * placed. §2's "warm candle-orange against cold blue-black" stops being a palette
 * note and becomes the only thing on screen.
 *
 * The single exception is the shaft over the Fall, thirty metres up through
 * broken strata — the one cold light in the map, and the reason its rubble cone
 * reads from the far end of the street.
 */
export const UNDERTOWN_AIR: Atmosphere = {
  sky: SKY.cavern,
  roof: 12,
  fogNear: 14,
  fogFar: 55,
  moon: 0,
  // Lifted from 0.30: with no moon, the bounce is doing the job of both.
  hemi: 0.34,
  shaft: { x: 71, z: 37, radius: 7, height: 30 },
};
