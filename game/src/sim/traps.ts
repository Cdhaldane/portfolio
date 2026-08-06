/*
 * sim/traps.ts — the trap catalog, as data.
 *
 * Two rules govern this file, and they're the whole reason it exists separately:
 *
 *  1. **Traps are data, not code.** A `TrapDef` is a cost, a trigger mode, an
 *     element and a list of declarative effects. Adding a trap is a new entry
 *     here plus (rarely) a new effect kind — never a new system. This is the
 *     seed of the content pipeline in GALLOWS_HYMN.md §12.6.
 *
 *  2. **Every trap must make another trap better.** A trap whose only job is
 *     damage is a worse version of the revolver. So each one carries an
 *     `element` and applies *statuses*, and the damage pipeline resolves the
 *     interactions between them (§6 synergy map). The synergy string is shown
 *     in the hotbar, because a combo the player can't discover doesn't exist.
 */

import { ticks } from "./tuning.ts";
import { SURF, type SurfaceClass } from "./surfaces.ts";

/** What a trap is made of. Drives interactions in the damage pipeline. */
export const ELEM = {
  iron: 0,
  tar: 1,
  fire: 2,
  powder: 3,
  arcane: 4,
} as const;

export type Elem = (typeof ELEM)[keyof typeof ELEM];

/** How a trap decides to act. */
export const TRIGGER = {
  /** Fires once on the nearest valid target, then goes on cooldown. */
  proximity: 0,
  /** Always on: applies its effects to everything in radius, every tick. */
  aura: 1,
  /** Fires on a fixed interval regardless of what's standing there. */
  periodic: 2,
  /**
   * Never fires. It works by *existing* — the Dead Man's Brace changes the map
   * rather than hurting anything, so the trap system skips it entirely.
   */
  inert: 3,
} as const;

export type Trigger = (typeof TRIGGER)[keyof typeof TRIGGER];

/**
 * What a trap can touch.
 *
 * Every trap in the M0.5 catalog was implicitly `ground`, and `runAura` says why:
 * airborne bodies are above a ground effect, not standing in it — "this one line is
 * the Buzzard's whole argument". That was true, and it left the Buzzard with no
 * answer but the revolver. Reach makes the exception expressible instead of
 * hard-coded, so a roof trap can hunt what a floor trap cannot.
 *
 * Airborne includes *launched* bodies, not only fliers, which is why a Bone Plate
 * feeding a Buzzard Roost is a combo rather than a coincidence.
 */
export const REACH = {
  ground: 0,
  air: 1,
  both: 2,
} as const;

export type Reach = (typeof REACH)[keyof typeof REACH];

export type TrapEffect =
  | { kind: "damage"; amount: number }
  | { kind: "hold"; ticks: number }
  | { kind: "soak"; ticks: number }
  | { kind: "burn"; ticks: number; dps: number }
  | { kind: "slow"; ticks: number; factor: number }
  | { kind: "mark"; ticks: number; amp: number }
  | { kind: "launch"; up: number; out: number };

/**
 * A trap upgrade.
 *
 * §6's rule: **exactly two, mutually exclusive.** Never three, never linear
 * levels. Two forces the upgrade to be an identity choice — "which trap is this
 * now" — instead of a number that goes up, and it means the answer is never
 * obvious enough to stop being a decision.
 *
 * An upgrade is a data override, not code: `resolve()` merges it over the base
 * def once at module load, so runtime cost is an array index.
 */
export interface UpgradeDef {
  key: string;
  name: string;
  /** One line, shown in the build panel. Must state the trade, not just the gain. */
  blurb: string;
  override: Partial<
    Pick<
      TrapDef,
      "cooldown" | "radius" | "maxTargets" | "effects" | "litEffects" | "litTicks"
    >
  >;
}

export interface TrapDef {
  id: number;
  key: string;
  name: string;
  /** Two or three letters for the hotbar slot. */
  glyph: string;
  cost: number;
  elem: Elem;
  trigger: Trigger;
  /**
   * Where it mounts (MAPS §9 item 5). Placement is validated against the site's
   * authored surface slots, so a site with three wall faces offers three, however
   * much wall it appears to have.
   */
  surface: SurfaceClass;
  /** What it can touch. See `REACH`. */
  reach: Reach;
  /** Ticks between activations. Ignored by auras. */
  cooldown: number;
  radius: number;
  /** How many bodies a proximity trigger grabs at once. */
  maxTargets: number;
  effects: TrapEffect[];
  /**
   * If set, this trap can be SET ALIGHT by a fire trap overlapping it, and while
   * lit it runs these effects instead of its normal ones.
   *
   * This is the strongest expression of "traps work together" in the game: it is
   * a trap changing another *trap*, not just an enemy. A Tar Seep on its own is a
   * slow; a Tar Seep with a Brimstone Vent beside it is a burning lake.
   */
  litEffects?: TrapEffect[];
  /** Fire traps light any overlapping `litEffects` trap when they activate. */
  ignitesGround?: boolean;
  /** Overrides LIT_TICKS for this trap when it sets ground alight. */
  litTicks?: number;
  /** Shown under the hotbar. The combo has to be discoverable. */
  synergy: string;
  /**
   * Exactly two, or none.
   *
   * None is not laziness: §6 wants an upgrade to be an identity choice, and an
   * unbreakable blockade with no effects and no hit points has nothing to choose
   * between. A pair invented to fill the slot would be the fake choice the rule
   * exists to forbid. When blockades gain hit points, they gain a real pair.
   */
  upgrades?: [UpgradeDef, UpgradeDef];
  /**
   * This trap is an obstacle: it reroutes bodies instead of touching them.
   *
   * The level keeps a flag per build tile and `rebake` turns those into boxes the
   * flow field respects (sim/level.ts). Enemies only — you and your shots pass
   * through your own.
   */
  blocks?: boolean;
}

/*
 * The M0.5 loadout: five traps chosen so that every one of them makes at least
 * two of the others better.
 *
 *   Tar makes Vent triple.        Vent burns what Tar soaked.
 *   Jaws holds things still       so Vent and Plate can't miss.
 *   Plate throws things           into Jaws, Tar and Vent.
 *   Sigil multiplies all four.
 *
 * There is deliberately no "just damage" trap in the starting set.
 */
/*
 * A NOTE ON RADII AND THE BUILD TILE.
 *
 * Every `radius` here is metres, and the build tile is 2m (`BUILD_TILE`). Two rules
 * govern them, and they pull in opposite directions:
 *
 *  1. **A trap must cover its own tile.** A 2m tile's circumscribed radius is 1.41m,
 *     so anything below that leaves its own corners untouched — a body clipping the
 *     corner of your Jaws tile and walking away reads as broken, not as tight.
 *  2. **A lane-scale trap must not swallow the map.** Doubling the Roost's 9m would
 *     put most of a 48x32 site inside one trap.
 *
 * So tile-scale traps doubled when the tile grew from 1m to 2m, and lane-scale ones
 * grew 1.2-1.6x. Costs did NOT change, and that is deliberate: the tile count fell
 * 4x while tile-scale coverage rose 4x, so "lane covered per scrap" is unchanged.
 */
export const TRAPS: TrapDef[] = [
  {
    id: 0,
    key: "jaws",
    name: "Jaws of Perdition",
    glyph: "JAW",
    cost: 30,
    elem: ELEM.iron,
    trigger: TRIGGER.proximity,
    surface: SURF.floor,
    reach: REACH.ground,
    cooldown: ticks(4),
    radius: 1.7,
    maxTargets: 1,
    effects: [
      { kind: "damage", amount: 25 },
      { kind: "hold", ticks: ticks(2) },
    ],
    synergy: "Held things take +25% from everything and can't walk away.",
    upgrades: [
      {
        key: "rusted",
        name: "Rusted Jaws",
        blurb: "Bleeds them out. Less damage up front, half the hold.",
        override: {
          effects: [
            { kind: "damage", amount: 18 },
            { kind: "hold", ticks: ticks(1) },
            { kind: "burn", ticks: ticks(5), dps: 7 },
          ],
        },
      },
      {
        key: "wolf",
        name: "Wolf Trap",
        blurb: "Wider jaws that catch THREE at once. Bites softer for it.",
        override: {
          maxTargets: 3,
          /* The radius has to grow with maxTargets or the upgrade is a lie:
             separation keeps bodies 0.9m apart (2 × DUSTKIN.radius), so three of
             them span 1.8m and simply cannot fit inside the base 0.85m reach. */
          radius: 2.6,
          effects: [
            { kind: "damage", amount: 16 },
            { kind: "hold", ticks: ticks(2) },
          ],
        },
      },
    ],
  },
  {
    id: 1,
    key: "tar",
    name: "Tar Seep",
    glyph: "TAR",
    cost: 40,
    elem: ELEM.tar,
    trigger: TRIGGER.aura,
    surface: SURF.floor,
    reach: REACH.ground,
    cooldown: 0,
    radius: 3,
    maxTargets: 1,
    effects: [
      { kind: "slow", ticks: ticks(0.5), factor: 0.45 },
      { kind: "soak", ticks: ticks(5) },
    ],
    // While alight the pool stops soaking and starts cooking. Damage on an aura
    // is per-second, not per-tick.
    litEffects: [
      { kind: "slow", ticks: ticks(0.5), factor: 0.45 },
      { kind: "damage", amount: 24 },
      { kind: "burn", ticks: ticks(2), dps: 8 },
    ],
    synergy: "No damage alone. Soaked things take TRIPLE from fire — and fire SETS THE POOL ALIGHT.",
    upgrades: [
      {
        key: "deep",
        name: "Deep Seep",
        blurb: "Half again as wide, and it holds them longer. Burns no hotter.",
        override: {
          radius: 4.4,
          effects: [
            { kind: "slow", ticks: ticks(0.5), factor: 0.34 },
            { kind: "soak", ticks: ticks(6) },
          ],
          litEffects: [
            { kind: "slow", ticks: ticks(0.5), factor: 0.34 },
            { kind: "damage", amount: 20 },
            { kind: "burn", ticks: ticks(2), dps: 8 },
          ],
        },
      },
      {
        key: "kerosene",
        name: "Kerosene Cut",
        blurb: "Cooks far hotter once lit — but thins out, so soak fades fast.",
        override: {
          effects: [
            { kind: "slow", ticks: ticks(0.5), factor: 0.5 },
            { kind: "soak", ticks: ticks(2) },
          ],
          litEffects: [
            { kind: "slow", ticks: ticks(0.5), factor: 0.5 },
            { kind: "damage", amount: 44 },
            { kind: "burn", ticks: ticks(3), dps: 12 },
          ],
          litTicks: ticks(6),
        },
      },
    ],
  },
  {
    id: 2,
    key: "vent",
    name: "Brimstone Vent",
    glyph: "VNT",
    cost: 55,
    elem: ELEM.fire,
    trigger: TRIGGER.periodic,
    surface: SURF.floor,
    reach: REACH.ground,
    cooldown: ticks(2.5),
    radius: 2.4,
    maxTargets: 1,
    effects: [
      { kind: "damage", amount: 16 },
      { kind: "burn", ticks: ticks(4), dps: 7 },
    ],
    ignitesGround: true,
    synergy: "Sets any Tar it touches on fire. Pair them and the lane cooks itself.",
    upgrades: [
      {
        key: "bellows",
        name: "Bellows Vent",
        blurb: "Belches twice as often. Each breath is weaker.",
        override: {
          cooldown: ticks(1.2),
          effects: [
            { kind: "damage", amount: 10 },
            { kind: "burn", ticks: ticks(3), dps: 6 },
          ],
        },
      },
      {
        key: "wildfire",
        name: "Wildfire Vent",
        blurb: "Reaches much further and keeps ground alight far longer.",
        override: {
          radius: 4,
          litTicks: ticks(9),
          effects: [
            { kind: "damage", amount: 14 },
            { kind: "burn", ticks: ticks(5), dps: 7 },
          ],
        },
      },
    ],
  },
  {
    id: 3,
    key: "plate",
    name: "Powder Plate",
    glyph: "PLT",
    cost: 50,
    elem: ELEM.powder,
    trigger: TRIGGER.proximity,
    surface: SURF.floor,
    reach: REACH.ground,
    cooldown: ticks(7),
    radius: 2,
    maxTargets: 1,
    effects: [
      { kind: "damage", amount: 30 },
      { kind: "launch", up: 8.5, out: 5.5 },
    ],
    synergy: "Throws them into your other traps, and the landing hurts.",
    upgrades: [
      {
        key: "blackpowder",
        name: "Black Powder",
        blurb: "A killing charge. Hits far harder — and throws nothing anywhere.",
        override: {
          effects: [{ kind: "damage", amount: 78 }],
        },
      },
      {
        key: "fools",
        name: "Fool's Charge",
        blurb: "Barely scratches them. Hurls them across the room, twice as often.",
        override: {
          cooldown: ticks(4),
          effects: [
            { kind: "damage", amount: 12 },
            { kind: "launch", up: 11.5, out: 10 },
          ],
        },
      },
    ],
  },
  {
    id: 4,
    key: "sigil",
    name: "Sigil of Nine",
    glyph: "IX",
    cost: 90,
    elem: ELEM.arcane,
    trigger: TRIGGER.aura,
    surface: SURF.floor,
    reach: REACH.ground,
    cooldown: 0,
    radius: 4.0,
    maxTargets: 1,
    effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.5 }],
    synergy: "Deals no damage. Everything inside takes +50%. Put it on the pinch.",
    upgrades: [
      {
        key: "ninefold",
        name: "Ninefold",
        blurb: "+90% inside — but the circle shrinks to a doorway.",
        override: {
          radius: 2.6,
          effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.9 }],
        },
      },
      {
        key: "wide",
        name: "Wide Circle",
        blurb: "Covers half the lane. Only +30% for it.",
        override: {
          radius: 6.1,
          effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.3 }],
        },
      },
    ],
  },

  /*
   * ── Wall and ceiling (M1.1) ──────────────────────────────────────────────
   *
   * The five floor traps all answer "what happens when a body walks HERE". These
   * four answer "what happens along this whole stretch", which is a different
   * question, and it is why they read as a second tier rather than five more of the
   * same. Each still obeys the rule that a trap must make another trap better:
   *
   *   Ports shove bodies off their line   into whatever is on the floor.
   *   Coil holds them in the Vent's cone   and in every aura you own.
   *   Lantern marks what it lights         including fliers nothing else can touch.
   *   Roost is the only reach into the air  — and Plate throws bodies up to it.
   */
  {
    id: 5,
    key: "ports",
    name: "Scattergun Ports",
    glyph: "PRT",
    cost: 85,
    elem: ELEM.powder,
    trigger: TRIGGER.proximity,
    surface: SURF.wall,
    // Buckshot at chest height catches a body mid-launch, so it reads as both.
    reach: REACH.both,
    cooldown: ticks(2.4),
    radius: 8.0,
    maxTargets: 3,
    effects: [
      { kind: "damage", amount: 30 },
      /* Shoved out along the wall's normal, into the lane. A trap that MOVES
         bodies is worth more than its damage, because it decides which of your
         other traps they meet next. */
      { kind: "launch", up: 2.4, out: 5.5 },
    ],
    synergy: "Blasts bodies off their line into whatever you laid on the floor.",
    upgrades: [
      {
        key: "choke",
        name: "Choked Barrels",
        blurb: "One body, hit twice as hard. Nothing beside it is touched.",
        override: {
          maxTargets: 1,
          effects: [
            { kind: "damage", amount: 64 },
            { kind: "launch", up: 2.8, out: 6.5 },
          ],
        },
      },
      {
        key: "swan",
        name: "Swan Shot",
        blurb: "Sweeps five at once. Barely stings any of them.",
        override: {
          maxTargets: 5,
          effects: [
            { kind: "damage", amount: 17 },
            { kind: "launch", up: 1.6, out: 3.5 },
          ],
        },
      },
    ],
  },
  {
    id: 6,
    key: "coil",
    name: "Barbed Coil",
    glyph: "CIL",
    cost: 55,
    elem: ELEM.iron,
    trigger: TRIGGER.aura,
    surface: SURF.wall,
    reach: REACH.ground,
    cooldown: 0,
    radius: 4.8,
    maxTargets: 1,
    effects: [
      { kind: "damage", amount: 9 },
      { kind: "slow", ticks: ticks(0.3), factor: 0.55 },
    ],
    synergy: "Slowed bodies sit in every aura you own for nearly twice as long.",
    upgrades: [
      {
        key: "rusted",
        name: "Rusted Wire",
        blurb: "Tears far worse. Barely slows them down.",
        override: {
          effects: [
            { kind: "damage", amount: 17 },
            { kind: "slow", ticks: ticks(0.3), factor: 0.85 },
          ],
        },
      },
      {
        key: "tangled",
        name: "Tangle",
        blurb: "Nearly stops them dead, and does almost nothing itself.",
        override: {
          radius: 5.8,
          effects: [
            { kind: "damage", amount: 3 },
            { kind: "slow", ticks: ticks(0.3), factor: 0.3 },
          ],
        },
      },
    ],
  },
  {
    id: 7,
    key: "lantern",
    name: "Hex Lantern",
    glyph: "LTN",
    cost: 110,
    elem: ELEM.arcane,
    trigger: TRIGGER.aura,
    surface: SURF.wall,
    /* Green light does not care what is standing and what is flying. This is the
       Buzzard's *partial* answer: a lantern will never kill one, but everything
       else you own hits it harder while it is lit. */
    reach: REACH.both,
    cooldown: 0,
    radius: 7,
    maxTargets: 1,
    effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.4 }],
    synergy: "Marks everything it lights — fliers too. No damage of its own.",
    upgrades: [
      {
        key: "greenflame",
        name: "Green Flame",
        blurb: "Floods the whole lane. Only +25% inside it.",
        override: {
          radius: 11.2,
          effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.25 }],
        },
      },
      {
        key: "judas",
        name: "Judas Light",
        blurb: "+75%, in a pool you could step over.",
        override: {
          radius: 3.6,
          effects: [{ kind: "mark", ticks: ticks(0.6), amp: 0.75 }],
        },
      },
    ],
  },
  {
    id: 8,
    key: "roost",
    name: "Buzzard Roost",
    glyph: "RST",
    cost: 120,
    elem: ELEM.iron,
    trigger: TRIGGER.proximity,
    surface: SURF.ceiling,
    /*
     * Air ONLY, and that is the point rather than a limitation.
     *
     * §8 lists the Buzzard's counter as a roost and the Rattler's as "wall and
     * ceiling coverage"; until now neither existed, so a flier's only answer was
     * the revolver and the ceiling column of every census was decoration. A roost
     * that also shot the ground would be a strictly better floor trap, and the
     * player would never have to think about altitude again.
     */
    reach: REACH.air,
    cooldown: ticks(2.8),
    radius: 10.8,
    maxTargets: 2,
    effects: [{ kind: "damage", amount: 38 }],
    synergy: "The only reach you have into the air. Plate throws bodies up to it.",
    upgrades: [
      {
        key: "pair",
        name: "Mated Pair",
        blurb: "Four passes instead of two, each one lighter.",
        override: {
          maxTargets: 4,
          effects: [{ kind: "damage", amount: 24 }],
        },
      },
      {
        key: "carrion",
        name: "Carrion Hunger",
        blurb: "Takes a flier out in one pass, then needs a long while.",
        override: {
          cooldown: ticks(5),
          maxTargets: 1,
          effects: [{ kind: "damage", amount: 82 }],
        },
      },
    ],
  },
  {
    id: 9,
    key: "brace",
    name: "Dead Man's Brace",
    glyph: "BRC",
    cost: 35,
    elem: ELEM.iron,
    trigger: TRIGGER.inert,
    surface: SURF.floor,
    reach: REACH.ground,
    blocks: true,
    cooldown: 0,
    /* Reach is meaningless for an obstacle, but it must still cover its own tile or
       the ring the renderer draws would lie about the ground it occupies. */
    radius: 1.45,
    maxTargets: 0,
    effects: [],
    synergy: "Bends the lane. Bodies you reroute walk into everything else you own.",
  },
];

/**
 * Every (trap, upgrade) pair resolved once at module load.
 *
 * `RESOLVED[defId][0]` is the base trap; `[1]` and `[2]` are its two upgrades.
 * Merging at load rather than per tick means an upgraded trap costs an array
 * index at runtime — no allocation in the hot loop (§12.5), and no branch in the
 * trap system that knows what an upgrade is.
 */
export const RESOLVED: TrapDef[][] = TRAPS.map((base) => [
  base,
  base.upgrades ? { ...base, ...base.upgrades[0].override } : base,
  base.upgrades ? { ...base, ...base.upgrades[1].override } : base,
]);

/** The def actually in play for a placed trap. `upgrade` is 0, 1 or 2. */
export function resolved(defId: number, upgrade: number): TrapDef {
  const row = RESOLVED[defId] ?? RESOLVED[0];
  return row[upgrade] ?? row[0];
}

/** §5: an upgrade costs half again the trap's own price. */
export const UPGRADE_COST_MULTIPLIER = 1.5;

export function upgradeCost(defId: number): number {
  return Math.round((TRAPS[defId] ?? TRAPS[0]).cost * UPGRADE_COST_MULTIPLIER);
}

export const trapDef = (id: number): TrapDef => TRAPS[id] ?? TRAPS[0];

/** How long ground stays alight after a fire trap touches it. */
export const LIT_TICKS = ticks(4);

/** The hotbar is the trap list, in order. Slots are stable across a run. */
export const HOTBAR_SLOTS = TRAPS.length;
