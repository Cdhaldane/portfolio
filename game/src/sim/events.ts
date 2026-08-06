/*
 * sim/events.ts — the one-way channel from simulation to presentation.
 *
 * The sim never calls into render, audio or React. It appends to this ring
 * buffer and `EventFlushSystem` drains it once per tick (§12.4). VFX, sound and
 * HUD are all *reads* of this stream, which is why damage numbers and hit
 * sounds can never disagree with what actually happened.
 *
 * Struct-of-arrays with a numeric `kind` discriminant: no per-event object, so
 * no allocation in the hot loop (§12.5).
 */

import { LIMITS } from "./tuning.ts";

export const EV = {
  muzzle: 0,
  bulletImpact: 1,
  enemyHit: 2,
  enemyKilled: 3,
  trapFired: 4,
  trapPlaced: 5,
  placeDenied: 6,
  reloadStart: 7,
  reloadEnd: 8,
  leak: 9,
  waveCleared: 10,
  runLost: 11,
  waveStarted: 12,
  /** Fire met soaked ground — the headline synergy landing (§6). */
  ignite: 13,
  /** A no-damage trap did its job (Tar, Sigil). */
  statusApplied: 14,
  launched: 15,
  roundCleared: 16,
  perfectRound: 17,
  trapSold: 18,
  /** The Boot connected. */
  booted: 19,
  /** The Boot swung and hit nothing. */
  bootWhiff: 20,
  /** Damage clanged off armour — the Ironjaw's teaching moment. */
  armourClang: 21,
  /** An enemy started a telegraphed swing. */
  enemyWindup: 22,
  playerHurt: 23,
  playerDied: 24,
  /** A poker hand closed and banked (§5). `a` is the HandId. */
  handScored: 25,
  trapUpgraded: 26,
  /** Arrived at a new site. `a` is the SiteId. */
  siteEntered: 27,
} as const;

export type EvKind = (typeof EV)[keyof typeof EV];

export class EventRing {
  readonly kind = new Uint8Array(LIMITS.maxEvents);
  readonly x = new Float32Array(LIMITS.maxEvents);
  readonly y = new Float32Array(LIMITS.maxEvents);
  readonly z = new Float32Array(LIMITS.maxEvents);
  /** Meaning depends on kind: damage dealt, trap id, enemy id… */
  readonly a = new Float32Array(LIMITS.maxEvents);
  count = 0;

  push(kind: EvKind, x = 0, y = 0, z = 0, a = 0): void {
    if (this.count >= LIMITS.maxEvents) return; // drop rather than grow
    const i = this.count++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.a[i] = a;
  }

  clear(): void {
    this.count = 0;
  }
}
