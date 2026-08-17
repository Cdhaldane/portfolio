/*
 * sim/enemies.ts — the roster, as data.
 *
 * The rule from GALLOWS_HYMN.md §8: **every enemy is an argument.** Each one
 * exists to invalidate one lazy strategy, so that the player's build has to keep
 * answering new questions instead of scaling one answer.
 *
 *   Dustkin  — invalidates nothing. It teaches. It is the horde.
 *   Coyote   — invalidates STANDING STILL AT ONE CHOKE. Fast, fragile, and it
 *              arrives in numbers: a build that answers one slow queue leaks to
 *              the things that sprint past it. Answer: coverage, and the Boot.
 *              (§8's full argument — pathing to the least-trapped lane — is
 *              NavSystem work at M3; the speed half of the argument ships now.)
 *   Ironjaw  — invalidates CHIP DAMAGE. Hits under its armour threshold clang off,
 *              so burn ticks and lit ground do nothing. Answer: big single hits
 *              (revolver, Jaws, Powder Plate) or amplifiers that push a small hit
 *              over the threshold.
 *   Preacher — invalidates SLOW ATTRITION. It heals every body around it and
 *              cleanses their slows, so a wear-them-down lane stops working while
 *              it stands. Answer: your gun. It is a priority *target*, not a
 *              priority threat — it never attacks (§8, ENEMIES.md §4).
 *   Buzzard  — invalidates THE GROUND. It flies over every trap you own and every
 *              chokepoint you built. Answer: the revolver. This is the enemy that
 *              finally gives the gun a job.
 *   Colossus — invalidates EVERYTHING CHEAP. Armoured mass with a health pool no
 *              single trap answers: it walks through a lane built for Dustkin
 *              arithmetic. Answer: amplifier stacking and focus fire — the whole
 *              kit at once, which is the point of a tier-4 unit.
 *
 * Anything referencing "the basic enemy" should read `ENEMIES[ENEMY.dustkin]`
 * rather than a constant, because every system now works per-entity.
 */

import { ticks } from "./tuning.ts";

export const ENEMY = {
  dustkin: 0,
  ironjaw: 1,
  buzzard: 2,
  coyote: 3,
  preacher: 4,
  colossus: 5,
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
   * The Hollow Preacher's hymn: restores `rate` HP/s to every OTHER enemy within
   * `radius` and cleanses their slows. Never itself — the §8 answer is "kill it
   * yourself", and a self-healing priority target turns that answer into a DPS
   * check instead of a decision. It keeps singing while clamped in a trap, on
   * purpose: traps must not be the answer to the anti-trap unit.
   */
  heal?: { rate: number; radius: number };
  /**
   * What the *site* must offer before this archetype may spawn (MAPS §3 G7).
   *
   * §8's invalidation table quietly assumes the answers exist: "Rattler —
   * invalidates floor traps — counter: wall and ceiling coverage" is only true on
   * a map that HAS wall and ceiling surfaces. An archetype with no answer is not
   * difficulty, it is a map with no answer. The director enforces this.
   */
  requires?: {
    /**
     * Minimum `wall + ceiling` faces on the site.
     *
     * Nearly always satisfied since walls became a derived lattice — every exposed
     * face is buildable, so a map can no longer be wall-poor. Kept because a future
     * site genuinely can be (a canyon floor, an open plain), but `ceilings` below is
     * the lever that still has teeth.
     */
    verticalSurfaces?: number;
    /** Minimum authored roof anchors. Still genuinely scarce — one beam is one place. */
    ceilings?: number;
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
  {
    id: ENEMY.coyote,
    key: "coyote",
    name: "Coyote",
    /* 24, so Jaws (25) drops one outright. The Dustkin note above keeps Jaws'
       verb as *hold* on the horde; against the pack the same trap gets to be a
       clean kill, which is what makes covering the second lane feel like an
       answer rather than a tax. One revolver round (34) also kills. */
    maxHp: 24,
    /* Faster than anything else on the ground (Dustkin 2.6, and the speed cap
       multiplies this). The whole argument is "your one chokepoint is not where
       I will be". */
    speed: 4.4,
    radius: 0.4,
    height: 0.85,
    turnRate: 9,
    scrap: 3,
    leakCost: 1,
    tier: 1,
    unlockRound: 2,
    /* Weight 6 against the Dustkin's 10: the pack is a fixture of most rounds
       without displacing the horde (§8 constraint 3 wants ≥40% tier-1 filler,
       and both of these are tier 1). */
    weight: 6,
    armour: 0,
    flying: false,
    flightHeight: 0,
    /* Nips: fast windup, small damage. A Coyote that lands one bite is an
       annoyance; four of them circling you is the actual threat. */
    melee: { damage: 6, range: 1.0, windup: ticks(0.26), cooldown: ticks(0.9) },
  },
  {
    id: ENEMY.preacher,
    key: "preacher",
    name: "Hollow Preacher",
    /* 65: two revolver rounds (68) drop one. "Kill it yourself" has to cost a
       deliberate weapon-swap moment, not a whole magazine — the tax is your
       attention, not your ammunition. */
    maxHp: 65,
    /* Processional. It should arrive after the bodies it heals, walking like a
       sermon — the player sees the horde stop dying before they see why. */
    speed: 1.7,
    radius: 0.5,
    height: 2.2,
    turnRate: 4,
    scrap: 12,
    leakCost: 2,
    tier: 2,
    unlockRound: 4,
    weight: 3,
    armour: 0,
    flying: false,
    flightHeight: 0,
    /* Deliberately no melee — same reasoning as the Buzzard. Its whole job is
       "your lane has stopped working"; a healer that also hits you is two
       arguments in one body. */
    melee: undefined,
    /* §8's numbers verbatim: 15 HP/s in 8m. See the field doc for the rules. */
    heal: { rate: 15, radius: 8 },
  },
  {
    id: ENEMY.colossus,
    key: "colossus",
    name: "Marrow Colossus",
    /* 520 base. §8's table says "2500 HP" — that is what one IS at Act-III
       scale, not what it spawns with at its round-8 debut: hpScaleForRound and
       the elite multiplier climb it past 2500 by the mid-teens. A base of 2500
       at round 8 would not be an argument, it would be a wall. */
    maxHp: 520,
    speed: 1.4,
    radius: 0.8,
    height: 2.8,
    turnRate: 3,
    scrap: 45,
    leakCost: 4,
    tier: 4,
    unlockRound: 8,
    weight: 1,
    /* The Ironjaw's threshold, not a higher one: the Colossus is not a second
       armour lesson. Its argument is the health pool — everything the Ironjaw
       taught still applies, it just isn't *enough* any more. */
    armour: 20,
    flying: false,
    flightHeight: 0,
    melee: { damage: 28, range: 1.8, windup: ticks(0.7), cooldown: ticks(2.2) },
    /* §8 also gives it "breaks barricades". Blockades are unbreakable by decree
       right now (§6), so that half of the argument is deferred with them —
       tracked in ENEMIES.md §7. */
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
