/*
 * sim/tuning.ts — every gameplay constant, in one reviewable place.
 *
 * This is the seed of the `balance.json` described in GALLOWS_HYMN.md §12.6:
 * for M0 it's a TS module so the values are typed and tree-shaken; at M2 it
 * becomes loaded JSON so tuning sessions produce diffs instead of rebuilds.
 */

export const SIM_HZ = 60;
export const STEP = 1 / SIM_HZ;
/** Catch-up ceiling (§12.3): beyond this we drop time rather than fall behind. */
export const MAX_CATCHUP_STEPS = 5;

/** Convert seconds to whole sim ticks (the sim's only unit of time). */
export const ticks = (seconds: number): number => Math.round(seconds * SIM_HZ);

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.62,
  walkSpeed: 6.5,
  sprintSpeed: 9.5,
  groundAccel: 60,
  groundFriction: 55,
  airAccel: 21, // 0.35 of ground accel — the §7 air-control number
  gravity: 22, // game-feel gravity, not 9.81
  jumpApex: 1.4,
  coyoteTicks: ticks(0.1), // §7: 100ms — non-negotiable for a trap game
  jumpBufferTicks: ticks(0.12), // §7: 120ms
  stepOffset: 0.35,
  maxHp: 100,
  /** Pitch clamp, radians. Slightly short of straight up/down. */
  pitchLimit: 1.45,
} as const;

/** Derived so apex height stays the authored value if gravity changes. */
export const JUMP_VELOCITY = Math.sqrt(2 * PLAYER.gravity * PLAYER.jumpApex);

/** §7 camera: full body visible, Orcs Must Die framing. */
export const CAMERA = {
  boom: 3.4,
  height: 1.85,
  shoulder: 0.35,
  downAngle: 0.14, // ~8 degrees
  fov: 75,
  aimBoom: 2.6,
  aimShoulder: 0.5,
  aimFov: 68,
  aimBlendTicks: ticks(0.12),
} as const;

/** Absolution — the starting revolver (§7). */
export const REVOLVER = {
  damage: 34,
  magazine: 6,
  fireCooldownTicks: ticks(0.4), // 2.5 rounds/sec
  reloadTicks: ticks(1.5),
  range: 60,
  /** Enemies within this radius of the ray count as hit (generous, by design). */
  hitPad: 0.08,
} as const;

/**
 * The Boot (§7) — the most important verb in the game.
 *
 * It is what stops the player being a spectator with a gun: a cooldown kick that
 * launches a body into the machinery they built. Every trap in the catalog is
 * designed around "something arrives here", and the Boot is how the player
 * decides *what* arrives *where*.
 */
export const BOOT = {
  cooldown: ticks(1.5),
  damage: 15,
  /** Reach from the player's centre, and how wide a cone counts as "in front". */
  range: 2.3,
  coneDot: 0.45,
  up: 6.5,
  out: 9,
  /** Ticks during which a trap kill still counts as "the Boot set that up". */
  creditTicks: ticks(3),
} as const;

/** Per-kill point multipliers (§5). Style is the score. */
export const KILL = {
  base: 10,
  byTrap: 1.5,
  byGun: 1.3,
  afterBoot: 2.0,
  airborne: 1.75,
  /** Rolling window in which kills join the same poker hand. */
  handWindow: ticks(4),
  /** A kill this close to the Rift upgrades a Straight to a Straight Flush. */
  riftRadius: 2.5,
} as const;

/** The player can now be killed by something other than arithmetic. */
export const SURVIVAL = {
  /** Ticks of invulnerability after taking a hit, so a crowd can't chain-stun. */
  invulnTicks: ticks(0.55),
  /** Health is restored between rounds: melee is a round-scoped threat. */
  healOnRoundClear: 1,
} as const;

/** Statuses and the interactions between them (§6). */
export const STATUS = {
  /** Held enemies are helpless: everything hits them harder. */
  heldAmp: 0.25,
  /** Fire landing on a soaked target. The headline synergy. */
  igniteMultiplier: 3,
  /** Ignition also refreshes burn for this long. */
  igniteBurnTicks: 60,
  igniteBurnDps: 9,
} as const;

/** Launched bodies (Powder Plate, and the Boot at M2). */
export const LAUNCH = {
  gravity: 20,
  /** Landing faster than this hurts. */
  fallSafeSpeed: 6,
  fallDamagePerMetreSecond: 3.4,
  /** Airborne enemies keep this much of their steering. */
  airControl: 0.15,
} as const;

/**
 * Endless rounds (§4). The point of the game is the highest round reached, so
 * the curve has to stay gentle enough to learn on and steep enough that nobody
 * gets bored surviving. Enemy count grows faster than enemy HP, because a horde
 * game should get *wider*, not spongier.
 */
export const ROUND = {
  firstRound: 1,
  baseCount: 6,
  countPerRound: 2.2,
  countCap: 90,
  baseIntervalSec: 2.1,
  intervalPerRound: 0.075,
  minIntervalSec: 0.42,
  /*
   * HP scales in two regimes (§4, decision 20).
   *
   * Count is the primary lever while it still has room: `6 + 2.2×round` reaches
   * `countCap` 90 at round 38, and after that speed is near its own cap and the
   * spawn interval is at its floor — so an endless game would simply stop
   * escalating. Past `hpRampRound` the curve hands the job to HP.
   *
   * The sponge risk this creates is answered by the combo system, not by the
   * curve: an open hand amplifies TRAP damage (§5), so the player's answer grows
   * with the same skill the score measures.
   */
  hpPerRound: 0.11,
  hpRampRound: 30,
  hpPerRoundLate: 0.18,
  speedPerRound: 0.016,
  speedCapMultiplier: 1.55,
  /** Every Nth round is an elite round: fewer, tougher, worth more. */
  eliteEvery: 5,
  eliteHpMultiplier: 3.4,
  eliteScrapMultiplier: 4,
  eliteCountFactor: 0.45,
  /** Vigil restored for clearing a round, capped at the starting value. */
  vigilPerRound: 3,
} as const;

/**
 * The combo system's grip on the rest of the game (§5, decision 20).
 *
 * The hand is not only a scoreboard: while it is open it amplifies TRAP damage,
 * which is what makes ROUND's steeper late HP curve survivable without turning
 * the endgame into chip damage. Traps only — see `TRAP_SOURCES` in
 * `systems/combat.ts`, which is the single definition of "the machinery did it".
 */
export const COMBO = {
  /** Trap damage gained per card in the open hand. */
  ampPerCard: 0.08,
  /** Hard ceiling. MAX_HAND is 8, so a full hand lands exactly here. */
  ampCap: 1.6,
} as const;

/** Round-end payout (§5). */
export const PAYOUT = {
  base: 45,
  perRound: 13,
  perKill: 2,
  noLeakBonus: 55,
} as const;

export const DUSTKIN = {
  /* 45, deliberately: two revolver rounds (68) drop one outright, while Jaws'
     25 does NOT — so the trap's verb stays *hold*, and the satisfying kill is
     "wound it with the gun, let the trap finish it". That interplay is the whole
     pillar (§1), so the number that produces it is a design decision, not a
     placeholder. */
  maxHp: 45,
  speed: 2.6,
  radius: 0.45,
  height: 1.8,
  scrap: 4,
  /** Damage dealt to the Vigil when one reaches the Rift. */
  leakCost: 1,
  turnRate: 6.0,
} as const;

/** Jaws of Perdition — the starting floor trap (§6, trap #1). */
export const JAWS = {
  cost: 30,
  damage: 25,
  holdTicks: ticks(2),
  cooldownTicks: ticks(4),
  triggerRadius: 0.85,
} as const;

export const OBJECTIVE = {
  startingVigil: 20,
  riftRadius: 2.2,
} as const;

export const ECONOMY = {
  /*
   * 160, so round 1 can afford the signature pair — Tar Seep (40) + Brimstone
   * Vent (55) — AND a Jaws (30) with change. A first round that cannot build the
   * combo the whole trap catalog is designed around teaches the player nothing,
   * and the first round is the only one they are guaranteed to see.
   */
  startingScrap: 160,
} as const;

/** M0 wave: one gate, a steady trickle, enough to need a trap or two. */
export const WAVE = {
  count: 14,
  firstSpawnTick: ticks(3),
  spawnIntervalTicks: ticks(2.2),
} as const;

export const LIMITS = {
  maxEnemies: 256,
  maxTraps: 64,
  maxEvents: 256,
} as const;
