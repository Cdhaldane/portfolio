/*
 * sim/abilities.ts — the two verbs every weapon carries, on `Q` and `E`.
 *
 * §7.3 / decision 20. Abilities belong to the **weapon**, not the character:
 * each archetype already had exactly one signature weapon, so "the character's
 * kit" and "the weapon's kit" were always the same list under two names. Folding
 * them halves the balancing surface and means abilities travel with a weapon
 * when it is bought with Ash (§10).
 *
 * Same posture as `traps.ts`: an ability is **data** — a cooldown, a shape, and
 * a list of declarative effects. Adding one is an entry here plus (rarely) a new
 * effect kind, never a new system.
 *
 * Each weapon's pair is deliberately one **setup** verb and one **payoff** verb,
 * so `Q` and `E` are never interchangeable. Dead Reckoning creates a lane and
 * Steady exploits it; Peal softens a crowd and Scattershot moves it; Blasting
 * Charge launches and Assay Mark makes the landing hurt; Wake makes bodies and
 * Fan the Hammer makes bodies.
 */

import { ticks } from "./tuning.ts";

/** Which weapon a player is carrying. Index into `WEAPONS`. */
export const WEAPON = {
  absolution: 0,
  longAccount: 1,
  benediction: 2,
  assay: 3,
  twinSermons: 4,
} as const;

export type WeaponId = (typeof WEAPON)[keyof typeof WEAPON];

/** Which of the two keys. Kept as an index so the sim never sees a keycode. */
export const ABILITY_SLOT = { q: 0, e: 1 } as const;

/**
 * What an ability does when it fires.
 *
 * Kept declarative and deliberately small: everything here is expressible with
 * primitives the sim already has (self buffs, marks, launches, spawns), so the
 * first pass needs no new physics. Anything that would need a new primitive is
 * listed in `pending` rather than half-built.
 */
export type AbilityEffect =
  /** Temporary multiplier on the player's own weapon damage. */
  | { kind: "selfDamage"; mult: number; ticks: number }
  /** Lock movement — the cost half of a brace. */
  | { kind: "root"; ticks: number }
  /** Mark everything in radius: takes `amp` more damage for `ticks`. */
  | { kind: "markArea"; radius: number; amp: number; ticks: number }
  /** Mark a single aimed target, harder and longer than an area mark. */
  | { kind: "markTarget"; amp: number; ticks: number; scrapMult: number }
  /** Stagger + fear everything in radius. */
  | { kind: "fearArea"; radius: number; ticks: number }
  /** Amplify every trap inside a radius for a while. */
  | { kind: "trapBuff"; radius: number; mult: number; ticks: number }
  /** Knock bodies away from the player. */
  | { kind: "knockback"; radius: number; force: number; up: number }
  /** Shove the player themselves — recoil as mobility. */
  | { kind: "selfLaunch"; back: number; up: number }
  /** Immediate damage in a radius. */
  | { kind: "damageArea"; radius: number; amount: number }
  /** Raise nearby corpses as temporary allies. */
  | { kind: "raiseCorpses"; radius: number; cap: number; ticks: number }
  /** Empty the cylinder on its own cadence, without spending it. */
  | { kind: "freeFire"; shots: number; ticks: number; interval: number }
  /** Every shot passes through every body on the ray. */
  | { kind: "pierce"; ticks: number }
  /** Lob a keg that detonates on the second press. */
  | { kind: "throwCharge"; radius: number; amount: number; up: number; fuse: number };

export interface AbilityDef {
  key: string;
  name: string;
  /** One line, shown in the HUD. A verb the player can't read doesn't exist. */
  blurb: string;
  cooldown: number;
  effects: AbilityEffect[];
  /**
   * Effects that need a sim primitive which does not exist yet. Declared rather
   * than silently dropped, so the gap is visible in the data instead of being
   * discovered as a missing feature.
   */
  pending?: string;
}

export interface WeaponDef {
  id: WeaponId;
  key: string;
  name: string;
  /** Ash price in the Coffin (§10). The starting revolver is free. */
  ash: number;
  /** Exactly two: `Q` then `E`. */
  abilities: [AbilityDef, AbilityDef];
}

export const WEAPONS: WeaponDef[] = [
  {
    id: WEAPON.absolution,
    key: "absolution",
    name: "ABSOLUTION",
    ash: 0,
    abilities: [
      {
        key: "fanTheHammer",
        name: "FAN THE HAMMER",
        blurb: "Empty the cylinder in a second and a half.",
        cooldown: ticks(10),
        // 6 shots over 1.5s — 4/sec against the revolver's 2.5.
        effects: [{ kind: "freeFire", shots: 6, ticks: ticks(1.8), interval: ticks(0.25) }],
      },
      {
        key: "steady",
        name: "STEADY",
        blurb: "Brace: +40% damage for 3s. You cannot move.",
        cooldown: ticks(14),
        effects: [
          { kind: "selfDamage", mult: 1.4, ticks: ticks(3) },
          { kind: "root", ticks: ticks(3) },
        ],
      },
    ],
  },
  {
    id: WEAPON.longAccount,
    key: "longAccount",
    name: "LONG ACCOUNT",
    ash: 400,
    abilities: [
      {
        key: "deadReckoning",
        name: "DEAD RECKONING",
        blurb: "Paint a lane: everything in it takes +50% for 8s.",
        cooldown: ticks(24),
        effects: [
          { kind: "markArea", radius: 9, amp: 0.5, ticks: ticks(8) },
          { kind: "pierce", ticks: ticks(8) },
        ],
      },
      {
        key: "steady",
        name: "STEADY",
        blurb: "Brace: no spread, +40% damage for 3s. You cannot move.",
        cooldown: ticks(14),
        effects: [
          { kind: "selfDamage", mult: 1.4, ticks: ticks(3) },
          { kind: "root", ticks: ticks(3) },
        ],
      },
    ],
  },
  {
    id: WEAPON.benediction,
    key: "benediction",
    name: "BENEDICTION",
    ash: 500,
    abilities: [
      {
        key: "peal",
        name: "PEAL",
        blurb: "Bell pulse: fear in 7m, and traps there hit +50% for 4s.",
        cooldown: ticks(20),
        effects: [
          { kind: "fearArea", radius: 7, ticks: ticks(3) },
          { kind: "trapBuff", radius: 7, mult: 1.5, ticks: ticks(4) },
        ],
      },
      {
        key: "scattershot",
        name: "SCATTERSHOT",
        blurb: "Both barrels: 6m knockback, and it throws you back 5m.",
        cooldown: ticks(12),
        effects: [
          { kind: "damageArea", radius: 6, amount: 90 },
          { kind: "knockback", radius: 6, force: 6, up: 1.5 },
          { kind: "selfLaunch", back: 5, up: 3 },
        ],
      },
    ],
  },
  {
    id: WEAPON.assay,
    key: "assay",
    name: "ASSAY",
    ash: 650,
    abilities: [
      {
        key: "blastingCharge",
        name: "BLASTING CHARGE",
        blurb: "Lob a keg: 100 damage in 4m, launches bodies 10m up.",
        cooldown: ticks(18),
        effects: [
          { kind: "throwCharge", radius: 4, amount: 100, up: 10, fuse: ticks(4) },
        ],
      },
      {
        key: "assayMark",
        name: "ASSAY MARK",
        blurb: "Tag one body: +60% damage from traps, triple scrap.",
        cooldown: ticks(16),
        effects: [{ kind: "markTarget", amp: 0.6, ticks: ticks(10), scrapMult: 3 }],
      },
    ],
  },
  {
    id: WEAPON.twinSermons,
    key: "twinSermons",
    name: "TWIN SERMONS",
    ash: 900,
    abilities: [
      {
        key: "wake",
        name: "WAKE",
        blurb: "Every corpse within 8m rises for 15s.",
        cooldown: ticks(30),
        effects: [{ kind: "raiseCorpses", radius: 8, cap: 4, ticks: ticks(15) }],
      },
      {
        key: "fanTheHammer",
        name: "FAN THE HAMMER",
        blurb: "Empty both cylinders: 12 rounds in 1.5s, no reload cost.",
        cooldown: ticks(10),
        // Twice the rounds in the same window: 8/sec, the reason it is the 900-Ash gun.
        effects: [{ kind: "freeFire", shots: 12, ticks: ticks(1.8), interval: ticks(0.125) }],
      },
    ],
  },
];

export function weaponDef(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[WEAPON.absolution];
}

export function abilityDef(weapon: number, slot: number): AbilityDef {
  return weaponDef(weapon).abilities[slot === ABILITY_SLOT.e ? 1 : 0];
}
