/*
 * sim/env.ts — environmental one-shot traps (MAPS §9 item 7, §4).
 *
 * §4 promises "1–3 environmental trap slots (rail line, chandelier anchor, chute) —
 * free to activate once, then cost salt to reset. Sites that roll these are memorable;
 * the generator guarantees at least one per site." The data has existed for a while —
 * `UNDERTOWN_ENV` names a hoist, a chandelier, a bell and the winding gear — with
 * nothing in the game able to fire one.
 *
 * ## They are shot, not pressed
 *
 * The obvious implementation is an interact key, and it is the wrong one. This is a
 * third-person shooter whose fantasy is a lantern in one hand and a revolver in the
 * other; "shoot the rope holding the chandelier" is a thing the player already knows
 * how to do, needs no key, no prompt and no tutorial, and rewards the aim the rest of
 * the game is built on. An interact key would also collide with `E` (the Boot).
 *
 * It costs one thing: an env slot has to be *visibly* shootable, which is a rendering
 * obligation, not a simulation one.
 *
 * ## Reset is deferred, and honestly
 *
 * "Then cost salt to reset" is not implemented, because **salt is not implemented** —
 * it is the §5 meta currency and nothing in the sim tracks it yet. `resetSalt` is
 * carried on the definition so the maps that already declare it stay truthful, and
 * the moment salt lands this becomes a spend rather than a rewrite.
 */

import { ticks } from "./tuning.ts";

export interface EnvSlotDef {
  key: string;
  name: string;
  x: number;
  z: number;
  /** Only usable once the building holding it is open (Undertown's Boarding). */
  requiresOpen?: number;
  /** Free the first time; this many salt to reset (§4). Not yet spendable. */
  resetSalt: number;
  /**
   * Absolute height, when the thing does not hang.
   *
   * The default — ground plus 3.2m — is right for a chandelier, a hoist or a gibbet
   * and wrong for a mine cart, which sits *on* the rail. It is also wrong anywhere
   * `groundHeight` answers about a surface the slot is not on: Shaft Nine's carts sit
   * on the gallery with a catwalk 5m above them, so the default put them at 14.2m,
   * hanging from a walkway instead of standing on the track.
   */
  y?: number;
}

/** What firing one does. Kept here rather than on the map so sites stay layout. */
export interface EnvKind {
  /** Metres. Generous — this is a once-per-site moment, not a trap. */
  radius: number;
  damage: number;
  /** Ticks of hold applied to survivors, so the payoff is a *window*, not a number. */
  hold: number;
  /** How big a target it is to shoot, in metres. */
  hitRadius: number;
}

/**
 * One profile, deliberately.
 *
 * A chandelier and a freight hoist should eventually differ, but inventing five sets
 * of numbers before any of them has been played would be tuning fiction. One shared
 * profile makes the mechanic real and leaves the differentiation for when there is
 * something to differentiate against.
 */
export const ENV_KIND: EnvKind = {
  radius: 5,
  damage: 240,
  hold: ticks(2),
  hitRadius: 0.6,
};

/** Runtime state: where they are, and whether this site has spent them. */
export interface EnvSlots {
  def: EnvSlotDef[];
  /** 1 = already fired. Per level, so travelling to a new site restores them. */
  used: Uint8Array;
  /** Mount height, for the shot test and the renderer. */
  y: Float32Array;
}

export function makeEnvSlots(defs: EnvSlotDef[], heightAt: (x: number, z: number) => number): EnvSlots {
  const y = new Float32Array(defs.length);
  for (let i = 0; i < defs.length; i++) {
    // Hung above head height by default: a thing you shoot down, not walk into.
    y[i] = defs[i].y ?? heightAt(defs[i].x, defs[i].z) + 3.2;
  }
  return { def: defs, used: new Uint8Array(defs.length), y };
}

/**
 * Is this slot available to shoot right now?
 *
 * `requiresOpen` is Undertown's: the chandelier is inside the saloon, and the saloon
 * is boarded until the player pays. A slot behind a closed building is not a secret,
 * it is simply not there yet.
 */
export function envReady(slots: EnvSlots, i: number, isOpen: (index: number) => boolean): boolean {
  if (slots.used[i]) return false;
  const req = slots.def[i].requiresOpen;
  return req === undefined || isOpen(req);
}
