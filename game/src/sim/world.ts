/*
 * sim/world.ts — all simulation state, and nothing else.
 *
 * Entities are struct-of-arrays over typed arrays with a free-list, which is
 * the shape bitECS formalizes at M1 (§12.4). Doing it by hand for M0 keeps the
 * spike dependency-free while making the migration mechanical.
 *
 * Every mutable float that presentation interpolates has a `p*` mirror holding
 * last tick's value (§12.3) — without it a 60Hz sim judders visibly on a 144Hz
 * display.
 */

import { buildLevel, groundHeight, type Level } from "./level.ts";
import { siteForRound } from "./sites.ts";
import { ENEMIES, enemyDef } from "./enemies.ts";
import { makeHand, type HandState } from "./combo.ts";
import { EventRing } from "./events.ts";
import { makeStreams, type Streams } from "./rng.ts";
import {
  CAMERA,
  ECONOMY,
  LIMITS,
  OBJECTIVE,
  PLAYER,
  REVOLVER,
  ROUND,
  WAVE,
} from "./tuning.ts";

/** How many bodies round `r` sends. Elite rounds send fewer, tougher ones. */
export function roundQuota(r: number): number {
  const raw = ROUND.baseCount + (r - 1) * ROUND.countPerRound;
  const elite = r % ROUND.eliteEvery === 0;
  const scaled = elite ? raw * ROUND.eliteCountFactor : raw;
  return Math.max(3, Math.min(ROUND.countCap, Math.round(scaled)));
}

export const isEliteRound = (r: number): boolean => r % ROUND.eliteEvery === 0;

export const PHASE = {
  build: 0,
  combat: 1,
  cleared: 2,
  lost: 3,
} as const;

export type Phase = (typeof PHASE)[keyof typeof PHASE];

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  pyaw: number;
  ppitch: number;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  hp: number;
  maxHp: number;
  invuln: number;
  /** Dev-menu god mode (CMD.debug): damagePlayer becomes a no-op. */
  god: boolean;
  bootCooldown: number;
  /** Which weapon is carried (§7.3). Decides the two ability slots. */
  weapon: number;
  /** Cooldown ticks remaining for ability Q and E. */
  abilityCooldown: [number, number];
  /** Ticks left on a self-damage buff, and its multiplier while it lasts. */
  buffTicks: number;
  buffDamage: number;
  /** Ticks left rooted — the cost half of a brace. */
  rootTicks: number;
  /** Ticks during which the revolver pierces every body on the ray (§7.3). */
  pierceTicks: number;
  /** Shots left in a free-fire burst, and the ticks it may span. */
  freeShots: number;
  freeFireTicks: number;
  /** Ticks between shots in a burst, and the countdown to the next one. */
  freeFireInterval: number;
  freeFireDelay: number;
  ammo: number;
  fireCooldown: number;
  reloadTicks: number;
  sprinting: boolean;
  aiming: boolean;
  buildMode: boolean;
  /** Which hotbar slot is armed. */
  slot: number;
  /** 0..1 blend toward the aim-in camera, ticked by the camera system. */
  aimBlend: number;
  /** Intent for this tick, written by CommandSystem. */
  inMoveX: number;
  inMoveY: number;
  wantFire: boolean;
  wantReload: boolean;
  wantBoot: boolean;
}

export interface Enemies {
  alive: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  /** Vertical velocity — enemies get launched (Powder Plate, and the Boot at M2). */
  vy: Float32Array;
  grounded: Uint8Array;
  /** Index into ENEMIES (sim/enemies.ts). */
  defId: Uint8Array;
  hp: Float32Array;
  maxHp: Float32Array;
  /** Ticks left in which a trap kill is credited to the Boot (§7). */
  booted: Uint16Array;
  /** Melee: ticks until the next swing may start, and telegraph remaining. */
  attackCd: Uint16Array;
  windup: Uint16Array;
  /** Ticks remaining clamped in a trap. */
  hold: Uint16Array;
  /** Status timers, in ticks. Soaked + fire is the headline interaction. */
  soaked: Uint16Array;
  burning: Uint16Array;
  burnDps: Float32Array;
  marked: Uint16Array;
  markAmp: Float32Array;
  /** Ticks of fear remaining: the body flees the player instead of the Rift. */
  feared: Uint16Array;
  slowed: Uint16Array;
  slowFactor: Float32Array;
  /** 1 = an elite for this round: tougher, worth more. */
  elite: Uint8Array;
  /** Monotonic id — the stable sort key for order-sensitive work (§13 rule 4). */
  spawnId: Int32Array;
  /** Ticks since last damaged, for the hit flash. */
  hitFlash: Uint8Array;
  count: number;
  free: number[];
}

export interface Traps {
  alive: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  /** Mount height. 0 for floor traps; 1.4m on a wall, 4m+ on a roof beam. */
  y: Float32Array;
  /** Which way a wall mount faces. Its launch and its mesh both use it. */
  yaw: Float32Array;
  /**
   * Cell id — and for wall/ceiling traps that is a synthetic id in the
   * `SLOT_BASE` range, not a grid cell (see sim/level.ts). Keeping one identity
   * for every trap is what lets place/sell/upgrade stay unchanged.
   */
  cell: Int32Array;
  cooldown: Uint16Array;
  /** Ticks of an external damage buff (Peal), and its multiplier. */
  buffTicks: Uint16Array;
  buffMult: Float32Array;
  /** Index into TRAPS (sim/traps.ts). */
  defId: Uint8Array;
  /** Ticks since this trap last did something — presentation reads it. */
  fired: Uint16Array;
  /** Ticks of "on fire" remaining, for traps with litEffects (§6). */
  lit: Uint16Array;
  /** 0 = base, 1 or 2 = which of the two upgrades it took (§6). */
  upgrade: Uint8Array;
  count: number;
  free: number[];
}

/**
 * The three things a weapon ability can leave lying around.
 *
 * All fixed-capacity, all struct-of-arrays, all deterministic — the same rules
 * as every other pool (§12.5, §13). Deliberately one struct rather than three
 * files: they are small, they tick together, and splitting them would triple the
 * plumbing for no gain.
 */
export interface Summons {
  /** Thrown charges: fly, land, then detonate on fuse or on a second press. */
  keg: {
    alive: Uint8Array;
    x: Float64Array;
    y: Float64Array;
    z: Float64Array;
    vx: Float64Array;
    vy: Float64Array;
    vz: Float64Array;
    fuse: Uint16Array;
    radius: Float32Array;
    damage: Float32Array;
    up: Float32Array;
  };
  /**
   * Where bodies fell, and for how long they can still be raised.
   *
   * Enemies free their slot the instant they die, so without this a corpse is
   * unrecoverable one tick later and Wake would have nothing to work with.
   */
  corpse: {
    alive: Uint8Array;
    x: Float64Array;
    y: Float64Array;
    z: Float64Array;
    ttl: Uint16Array;
  };
  /** Raised gunslingers: stationary, timed, and they shoot the nearest body. */
  revenant: {
    alive: Uint8Array;
    x: Float64Array;
    y: Float64Array;
    z: Float64Array;
    ttl: Uint16Array;
    cooldown: Uint16Array;
  };
}

export interface World {
  tick: number;
  seed: number;
  phase: Phase;
  /** Reassigned when a run travels between sites. */
  level: Level;
  streams: Streams;
  player: PlayerState;
  enemies: Enemies;
  traps: Traps;
  /** Bodies the player put in the world: kegs, corpses, revenants (§7.3). */
  summons: Summons;
  events: EventRing;

  scrap: number;
  vigil: number;
  kills: number;
  leaks: number;
  shotsFired: number;
  shotsHit: number;

  /** Round/director state. The round number IS the score (§4). */
  round: number;
  highestRound: number;
  roundQuota: number;
  spawnedThisWave: number;
  nextSpawnTick: number;
  waveStartTick: number;
  nextSpawnId: number;
  roundKills: number;
  roundLeaks: number;
  /** Baked once per round by applyRoundScaling(), read every tick. */
  enemyHpScale: number;
  enemySpeedScale: number;
  /** Payout from the round just cleared, so the HUD can show the breakdown. */
  lastPayout: number;
  /** Set for one round after arriving somewhere new, so the HUD can announce it. */
  siteJustChanged: boolean;
  /**
   * The player chose this ground and the run stays on it.
   *
   * Set when a specific map is picked on the muster screen rather than
   * `ROTATION` (the default). §4's site rotation is the *designed* run — the
   * geometry puzzle refreshing every few rounds is content — so locking is
   * strictly opt-in, and picking "rotation" leaves the sim behaving exactly as
   * it did before there was a menu.
   *
   * It lives on the World rather than in the UI because it changes what the
   * simulation does, which means it is part of the run's identity: a replay
   * (§13) carries it, and a replay that dropped it would rebuild the wrong
   * geometry on round 4 and diverge from its own fingerprints.
   */
  siteLocked: boolean;

  /** Style score (§5). The hand in progress, and what it has banked. */
  hand: HandState;
  tally: number;
  /** Last hand that scored, for the HUD stamp. */
  lastHand: number;
  lastHandPoints: number;
  bestHand: number;
  /** Spawns per def this round, so a debut can be capped (§8). */
  spawnedByDef: Int32Array;

  /** Dev-menu free build (CMD.debug): traps and upgrades cost nothing. */
  freeBuild: boolean;
  /**
   * Any debug command has touched this run. The host reads it to keep the run
   * off the leaderboard — a cheated round count is not a score, and the flag
   * travels with the sim so a replay of a cheated run knows it is one too.
   */
  debugUsed: boolean;
}

function makeEnemies(): Enemies {
  const n = LIMITS.maxEnemies;
  const free: number[] = [];
  for (let i = n - 1; i >= 0; i--) free.push(i);
  return {
    alive: new Uint8Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    pz: new Float32Array(n),
    vx: new Float32Array(n),
    vz: new Float32Array(n),
    vy: new Float32Array(n),
    grounded: new Uint8Array(n),
    defId: new Uint8Array(n),
    hp: new Float32Array(n),
    maxHp: new Float32Array(n),
    booted: new Uint16Array(n),
    attackCd: new Uint16Array(n),
    windup: new Uint16Array(n),
    hold: new Uint16Array(n),
    soaked: new Uint16Array(n),
    burning: new Uint16Array(n),
    burnDps: new Float32Array(n),
    marked: new Uint16Array(n),
    markAmp: new Float32Array(n),
    feared: new Uint16Array(n),
    slowed: new Uint16Array(n),
    slowFactor: new Float32Array(n),
    elite: new Uint8Array(n),
    spawnId: new Int32Array(n),
    hitFlash: new Uint8Array(n),
    count: 0,
    free,
  };
}

function makeTraps(): Traps {
  const n = LIMITS.maxTraps;
  const free: number[] = [];
  for (let i = n - 1; i >= 0; i--) free.push(i);
  return {
    alive: new Uint8Array(n),
    x: new Float32Array(n),
    z: new Float32Array(n),
    y: new Float32Array(n),
    yaw: new Float32Array(n),
    cell: new Int32Array(n),
    cooldown: new Uint16Array(n),
    buffTicks: new Uint16Array(n),
    buffMult: new Float32Array(n),
    defId: new Uint8Array(n),
    fired: new Uint16Array(n),
    lit: new Uint16Array(n),
    upgrade: new Uint8Array(n),
    count: 0,
    free,
  };
}

export function createWorld(
  seed: number,
  // Annotated `number`, not `SiteId`: the default would otherwise narrow the
  // parameter to the union, and both callers that pass one — the muster screen
  // and a decoded replay — hold a plain number that no longer carries proof of
  // its provenance. `siteDef` already falls back on anything out of range, which
  // is the right behaviour for a hand-edited replay file.
  siteId: number = siteForRound(ROUND.firstRound),
  lockSite = false,
): World {
  const level = buildLevel(siteId);
  const player: PlayerState = {
    x: level.playerStart.x,
    y: 0,
    z: level.playerStart.z,
    px: level.playerStart.x,
    py: 0,
    pz: level.playerStart.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: level.playerStart.yaw,
    // §7 asks for an 8° downward camera so the ground reads. A fixed camera
    // tilt would break the centred crosshair, so we start the player's own
    // pitch slightly down instead — same result, no parallax lie (see aim.ts).
    pitch: -CAMERA.downAngle,
    pyaw: level.playerStart.yaw,
    ppitch: -CAMERA.downAngle,
    grounded: true,
    coyote: 0,
    jumpBuffer: 0,
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    invuln: 0,
    god: false,
    bootCooldown: 0,
    weapon: 0,
    abilityCooldown: [0, 0],
    buffTicks: 0,
    buffDamage: 1,
    rootTicks: 0,
    pierceTicks: 0,
    freeShots: 0,
    freeFireTicks: 0,
    freeFireInterval: 0,
    freeFireDelay: 0,
    ammo: REVOLVER.magazine,
    fireCooldown: 0,
    reloadTicks: 0,
    sprinting: false,
    aiming: false,
    buildMode: false,
    slot: 0,
    aimBlend: 0,
    inMoveX: 0,
    inMoveY: 0,
    wantFire: false,
    wantReload: false,
    wantBoot: false,
  };

  return {
    tick: 0,
    seed,
    phase: PHASE.build,
    level,
    streams: makeStreams(seed),
    player,
    enemies: makeEnemies(),
    traps: makeTraps(),
    summons: makeSummons(),
    events: new EventRing(),
    scrap: ECONOMY.startingScrap,
    vigil: OBJECTIVE.startingVigil,
    kills: 0,
    leaks: 0,
    shotsFired: 0,
    shotsHit: 0,
    round: ROUND.firstRound,
    highestRound: ROUND.firstRound,
    roundQuota: roundQuota(ROUND.firstRound),
    spawnedThisWave: 0,
    nextSpawnTick: WAVE.firstSpawnTick,
    waveStartTick: 0,
    nextSpawnId: 1,
    roundKills: 0,
    roundLeaks: 0,
    enemyHpScale: 1,
    enemySpeedScale: 1,
    lastPayout: 0,
    siteJustChanged: false,
    siteLocked: lockSite,
    hand: makeHand(),
    tally: 0,
    lastHand: 0,
    lastHandPoints: 0,
    bestHand: 0,
    spawnedByDef: new Int32Array(ENEMIES.length),
    freeBuild: false,
    debugUsed: false,
  };
}

// ── pool helpers ───────────────────────────────────────────────────────────

export function spawnEnemy(w: World, x: number, z: number, defId = 0): number {
  const e = w.enemies;
  const i = e.free.pop();
  if (i === undefined) return -1;
  /*
   * Spawn ON the ground, not at 0. Shaft Nine's gallery gates stand on a +6
   * deck, and a body spawned at 0 walked the whole lane in the void underneath
   * it, surfacing through the ramp's treads — enemies visibly clipping out of a
   * staircase. The 8m probe takes the tallest floor a gate can stand on (the
   * gallery) while ignoring the catwalks (+11) and the rock tops above them,
   * neither of which any gate may spawn on. Flat maps read 0, exactly as before.
   */
  const ground = groundHeight(w.level, x, z, 8);
  e.alive[i] = 1;
  e.x[i] = x;
  e.z[i] = z;
  e.y[i] = ground;
  e.px[i] = x;
  e.pz[i] = z;
  e.py[i] = ground;
  e.vx[i] = 0;
  e.vz[i] = 0;
  e.vy[i] = 0;
  e.grounded[i] = 1;
  e.booted[i] = 0;
  e.attackCd[i] = 0;
  e.windup[i] = 0;
  e.hp[i] = 0; // filled by the caller from the EnemyDef
  e.maxHp[i] = 0;
  e.hold[i] = 0;
  e.soaked[i] = 0;
  e.burning[i] = 0;
  e.burnDps[i] = 0;
  e.marked[i] = 0;
  e.markAmp[i] = 0;
  e.slowed[i] = 0;
  e.slowFactor[i] = 1;
  e.elite[i] = 0;
  e.hitFlash[i] = 0;
  e.spawnId[i] = w.nextSpawnId++;
  e.defId[i] = defId;
  const def = enemyDef(defId);
  // Fliers enter at altitude; walkers start on the deck.
  if (def.flying) {
    e.y[i] = def.flightHeight;
    e.py[i] = def.flightHeight;
    e.grounded[i] = 0;
  }
  e.count++;
  return i;
}

/** Fixed-capacity pools for everything an ability can leave behind (§7.3). */
export const SUMMON_LIMITS = { kegs: 8, corpses: 64, revenants: 8 } as const;
/** How long a body stays raisable. 8s — long enough to be a plan, not a reflex. */
export const CORPSE_TTL = 480;

function makeSummons(): Summons {
  const k = SUMMON_LIMITS.kegs;
  const c = SUMMON_LIMITS.corpses;
  const r = SUMMON_LIMITS.revenants;
  return {
    keg: {
      alive: new Uint8Array(k),
      x: new Float64Array(k), y: new Float64Array(k), z: new Float64Array(k),
      vx: new Float64Array(k), vy: new Float64Array(k), vz: new Float64Array(k),
      fuse: new Uint16Array(k),
      radius: new Float32Array(k), damage: new Float32Array(k), up: new Float32Array(k),
    },
    corpse: {
      alive: new Uint8Array(c),
      x: new Float64Array(c), y: new Float64Array(c), z: new Float64Array(c),
      ttl: new Uint16Array(c),
    },
    revenant: {
      alive: new Uint8Array(r),
      x: new Float64Array(r), y: new Float64Array(r), z: new Float64Array(r),
      ttl: new Uint16Array(r), cooldown: new Uint16Array(r),
    },
  };
}

/**
 * First free slot in a pool, or -1.
 *
 * Lowest index rather than a free-list: the pools are tiny and a deterministic
 * scan keeps replay behaviour obvious (§13 rule 4) without another array to keep
 * in sync.
 */
export function firstFree(alive: Uint8Array): number {
  for (let i = 0; i < alive.length; i++) if (!alive[i]) return i;
  return -1;
}

export function killEnemy(w: World, i: number): void {
  const e = w.enemies;
  if (!e.alive[i]) return;

  /* Leave a corpse behind. The enemy slot is reused immediately, so a body that
   * is not recorded here cannot be raised a tick later (§7.3 Wake). Oldest is
   * overwritten when full, which keeps the freshest kills raisable — those are
   * the ones near the player. */
  const c = w.summons.corpse;
  let slot = firstFree(c.alive);
  if (slot < 0) {
    slot = 0;
    for (let k = 1; k < c.alive.length; k++) if (c.ttl[k] < c.ttl[slot]) slot = k;
  }
  c.alive[slot] = 1;
  c.x[slot] = e.x[i];
  c.y[slot] = e.y[i];
  c.z[slot] = e.z[i];
  c.ttl[slot] = CORPSE_TTL;

  e.alive[i] = 0;
  e.count--;
  e.free.push(i);
}

export function addTrap(
  w: World,
  cell: number,
  x: number,
  z: number,
  defId: number,
  y = 0,
  yaw = 0,
): number {
  const t = w.traps;
  const i = t.free.pop();
  if (i === undefined) return -1;
  t.alive[i] = 1;
  t.cell[i] = cell;
  t.x[i] = x;
  t.z[i] = z;
  t.y[i] = y;
  t.yaw[i] = yaw;
  t.cooldown[i] = 0;
  t.defId[i] = defId;
  t.fired[i] = 0;
  t.lit[i] = 0;
  t.upgrade[i] = 0;
  t.count++;
  return i;
}

export function removeTrap(w: World, i: number): void {
  const t = w.traps;
  if (!t.alive[i]) return;
  t.alive[i] = 0;
  t.count--;
  t.free.push(i);
}

export function trapAtCell(w: World, cell: number): number {
  const t = w.traps;
  for (let i = 0; i < t.alive.length; i++) {
    if (t.alive[i] && t.cell[i] === cell) return i;
  }
  return -1;
}
