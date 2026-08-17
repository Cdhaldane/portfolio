/*
 * sim/hash.ts — a fingerprint of simulation state.
 *
 * Recorded into the replay every 600 ticks (§13, rule 9). The determinism test
 * replays a command log and asserts the hashes match; in co-op the same value
 * becomes the desync detector for free.
 *
 * FNV-1a over the raw bytes of the state that matters. Presentation-only values
 * (hit flashes, aim blend) are deliberately excluded — a cosmetic change must
 * never invalidate a replay.
 */

import type { World } from "./world.ts";

const F64 = new Float64Array(1);
const BYTES = new Uint8Array(F64.buffer);

export class Hasher {
  private h = 0x811c9dc5;

  int(v: number): void {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
      x >>>= 8;
    }
  }

  /** Hash a float via its exact bytes — no rounding, no locale, no drift. */
  float(v: number): void {
    F64[0] = v;
    for (let i = 0; i < 8; i++) {
      this.h ^= BYTES[i];
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  get value(): number {
    return this.h >>> 0;
  }
}

export function hashWorld(w: World): number {
  const h = new Hasher();
  h.int(w.tick);
  h.int(w.phase);
  h.int(w.scrap);
  h.int(w.vigil);
  h.int(w.kills);
  h.int(w.leaks);
  h.int(w.shotsFired);
  h.int(w.shotsHit);
  h.int(w.spawnedThisWave);
  h.int(w.nextSpawnTick);
  h.int(w.nextSpawnId);
  h.int(w.round);
  h.int(w.tally);
  h.int(w.lastHand);
  h.int(w.hand.count);
  h.int(w.hand.expiry);
  h.int(w.hand.clean ? 1 : 0);
  h.float(w.hand.points);
  h.int(w.roundQuota);
  h.int(w.roundKills);
  h.int(w.roundLeaks);
  h.float(w.enemyHpScale);
  h.float(w.enemySpeedScale);
  // Dev-menu state is sim state: it changes behaviour, so it is fingerprinted.
  h.int(w.freeBuild ? 1 : 0);
  h.int(w.debugUsed ? 1 : 0);
  h.int(w.player.god ? 1 : 0);

  const p = w.player;
  h.float(p.x);
  h.float(p.y);
  h.float(p.z);
  h.float(p.vx);
  h.float(p.vy);
  h.float(p.vz);
  h.float(p.yaw);
  h.float(p.pitch);
  h.int(p.grounded ? 1 : 0);
  h.int(p.coyote);
  h.int(p.jumpBuffer);
  h.int(p.ammo);
  h.int(p.fireCooldown);
  h.int(p.reloadTicks);
  h.int(p.slot);
  h.int(p.invuln);
  h.int(p.bootCooldown);
  h.float(p.hp);

  // Fixed index order, always the whole pool: entity recycling must not be able
  // to permute the hash.
  const e = w.enemies;
  for (let i = 0; i < e.alive.length; i++) {
    h.int(e.alive[i]);
    if (!e.alive[i]) continue;
    h.int(e.spawnId[i]);
    h.int(e.defId[i]);
    h.int(e.booted[i]);
    h.int(e.attackCd[i]);
    h.int(e.windup[i]);
    h.float(e.x[i]);
    h.float(e.y[i]);
    h.float(e.z[i]);
    h.float(e.vx[i]);
    h.float(e.vz[i]);
    h.float(e.vy[i]);
    h.int(e.grounded[i]);
    h.float(e.hp[i]);
    h.int(e.hold[i]);
    h.int(e.soaked[i]);
    h.int(e.burning[i]);
    h.int(e.marked[i]);
    h.int(e.slowed[i]);
    h.int(e.elite[i]);
  }

  const t = w.traps;
  for (let i = 0; i < t.alive.length; i++) {
    h.int(t.alive[i]);
    if (!t.alive[i]) continue;
    h.int(t.cell[i]);
    h.float(t.y[i]);
    h.float(t.yaw[i]);
    h.int(t.cooldown[i]);
    h.int(t.defId[i]);
    h.int(t.lit[i]);
    h.int(t.upgrade[i]);
  }

  return h.value;
}
