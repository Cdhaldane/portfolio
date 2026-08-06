/*
 * sim/enemies.ts — the roster, as data.
 *
 * The rule from GALLOWS_HYMN.md §8: **every enemy is an argument.** Each one
 * exists to invalidate one lazy strategy, so that the player's build has to keep
 * answering new questions instead of scaling one answer.
 *
 *   Dustkin  — invalidates nothing. It teaches. It is the horde.
 *   Ironjaw  — invalidates CHIP DAMAGE. Hits under its armour threshold clang off,
 *              so burn ticks and lit ground do nothing. Answer: big single hits
 *              (revolver, Jaws, Powder Plate) or amplifiers that push a small hit
 *              over the threshold.
 *   Buzzard  — invalidates THE GROUND. It flies over every trap you own and every
 *              chokepoint you built. Answer: the revolver. This is the enemy that
 *              finally gives the gun a job.
 *
 * Anything referencing "the basic enemy" should read `ENEMIES[ENEMY.dustkin]`
 * rather than a constant, because every system now works per-entity.
 */

import { ticks } from "./tuning.ts";

export const ENEMY = {
  dustkin: 0,
  ironjaw: 1,
  buzzard: 2,
} as const;

export type EnemyId = (typeof ENEMY)[keyof typeof ENEMY];

export interface MeleeDef {
  damage: number;
  /** Distance from the player's centre at which it can start a swing. */
  range: number;
  /** Ticks of telegraph before the hit lands — the player's window to move. */
  windup: number;
  cooldown: number;
}

export interface EnemyDef {
  id: number;
  key: string;
  name: string;
  maxHp: number;
  speed: number;
  radius: number;
  height: number;
  turnRate: number;
  /** Scrap paid on death. */
  scrap: number;
  /** Vigil charged if it reaches the Rift. */
  leakCost: number;
  /** Scoring tier: base points are `tier × 10` (§5). */
  tier: number;
  /** Earliest round this can appear. */
  unlockRound: number;
  /** Relative draw weight once unlocked. */
  weight: number;
  /**
   * Damage below this is reduced to a clang. Checked AFTER amplifiers, on
   * purpose: marking an Ironjaw so your small hits start landing is a real and
   * teachable synergy, while burn ticks should never chew through plate.
   */
  armour: number;
  /** Flies: ignores ground traps, chokepoints and the flow field entirely. */
  flying: boolean;
  /** Cruise altitude for fliers — above the 4m walls, so it reads as "over". */
  flightHeight: number;
  melee?: MeleeDef;
  /**
   * What the *site* must offer before this archetype may spawn (MAPS §3 G7).
   *
   * §8's invalidation table quietly assumes the answers exist: "Rattler —
   * invalidates floor traps — counter: wall and ceiling coverage" is only true on
   * a map that HAS wall and ceiling surfaces. An archetype with no answer is not
   * difficulty, it is a map with no answer. The director enforces this.
   */
  requires?: {
    /** Minimum `wall + ceiling` faces on the site. */
    verticalSurfaces?: number;
    /** Minimum traceable sigil slots. */
    sigils?: number;
    /** Hard cap on simultaneous spawns per round, as a multiple of `ceiling`. */
    perCeiling?: number;
  };
}

export const ENEMIES: EnemyDef[] = [
  {
    id: ENEMY.dustkin,
    key: "dustkin",
    name: "Dustkin",
    /* 45, deliberately: two revolver rounds (68) drop one outright while Jaws'
       25 does not, so the trap's verb stays *hold* and the satisfying kill is
       "wound it with the gun, let the trap finish it" (§21.1 note 2). */
    maxHp: 45,
    speed: 2.6,
    radius: 0.45,
    height: 1.8,
    turnRate: 6,
    scrap: 4,
    leakCost: 1,
    tier: 1,
    unlockRound: 1,
    weight: 10,
    armour: 0,
    flying: false,
    flightHeight: 0,
    melee: { damage: 9, range: 1.15, windup: ticks(0.36), cooldown: ticks(1.2) },
  },
  {
    id: ENEMY.ironjaw,
    key: "ironjaw",
    name: "Ironjaw",
    maxHp: 120,
    speed: 2.0,
    radius: 0.55,
    height: 1.95,
    turnRate: 4.5,
    scrap: 9,
    leakCost: 2,
    tier: 2,
    unlockRound: 3,
    weight: 4,
    armour: 20,
    flying: false,
    flightHeight: 0,
    melee: { damage: 16, range: 1.3, windup: ticks(0.52), cooldown: ticks(1.6) },
  },
  {
    id: ENEMY.buzzard,
    key: "buzzard",
    name: "Buzzard",
    maxHp: 30,
    speed: 4.2,
    radius: 0.42,
    height: 1.0,
    turnRate: 3.2,
    scrap: 7,
    leakCost: 1,
    tier: 2,
    unlockRound: 5,
    weight: 4,
    armour: 0,
    flying: true,
    /* Above the 4m walls: it has to read as flying OVER the site, not through it.
       Deliberately no melee — a flier that also hurts you is two arguments in one
       body, and its whole job is "the ground does not help you here". */
    flightHeight: 4.6,
    melee: undefined,
    /*
     * Capped at two per ceiling anchor. Boot Hill has one (the hanging tree), so
     * even if a Buzzard could reach it there would be at most two — and it
     * unlocks at round 5, two rounds after the player leaves. The cap is what
     * makes that timing a design choice rather than a coincidence.
     */
    requires: { perCeiling: 2 },
  },
];

export const enemyDef = (id: number): EnemyDef => ENEMIES[id] ?? ENEMIES[0];

/** Which defs may appear in round `r`. */
export function unlockedFor(round: number): EnemyDef[] {
  return ENEMIES.filter((d) => d.unlockRound <= round);
}

/** True on the round an archetype first appears — §8 gives it a gentle debut. */
export function isDebutRound(def: EnemyDef, round: number): boolean {
  return def.unlockRound === round;
}

/** §8: a debut is always alone, in small numbers, so the player can learn it. */
export const DEBUT_CAP = 2;
