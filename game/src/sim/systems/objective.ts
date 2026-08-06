/*
 * System 14 — ObjectiveSystem. Leaks, Vigil, and the round loop.
 *
 * This is where "get to the highest round" is implemented (§4). Clearing a round
 * pays out, restores a little Vigil, and drops you back into an untimed build
 * phase to spend the money. Losing the Vigil ends the run and the round you died
 * on is your score.
 *
 * The payout scales with *performance*, not just survival: a round cleared without
 * a single leak pays a large bonus, and kills pay per body. That preserves the
 * rule from §5 that turtling has to starve — you can hide behind traps and still
 * bank money, but you'll bank far less of it than someone in the room.
 */

import { EV } from "../events.ts";
import { OBJECTIVE, PAYOUT, ROUND, SURVIVAL } from "../tuning.ts";
import { enemyDef } from "../enemies.ts";
import { PHASE, killEnemy, removeTrap, roundQuota, type World } from "../world.ts";
import { buildLevel } from "../level.ts";
import { siteForRound } from "../sites.ts";
import { trapRefund } from "./command.ts";
import { upgradeCost } from "../traps.ts";

export function objectiveSystem(w: World): void {
  const e = w.enemies;
  const rift = w.level.rift;
  const r2 = rift.radius * rift.radius;

  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    // Distance is measured on the ground plane only — a Buzzard leaks by
    // crossing the Rift from above, which is exactly its threat.
    const dx = e.x[i] - rift.x;
    const dz = e.z[i] - rift.z;
    if (dx * dx + dz * dz > r2) continue;

    // Through. No scrap for the player — a leak pays nothing.
    const def = enemyDef(e.defId[i]);
    w.events.push(EV.leak, e.x[i], e.y[i] + 1, e.z[i], def.leakCost);
    killEnemy(w, i);
    w.leaks++;
    w.roundLeaks++;
    w.vigil -= e.elite[i] === 1 ? def.leakCost * 3 : def.leakCost;

    if (w.vigil <= 0) {
      w.vigil = 0;
      if (w.phase !== PHASE.lost) {
        w.phase = PHASE.lost;
        // The round you died on is the score.
        w.events.push(EV.runLost, 0, 0, 0, w.round);
      }
      return;
    }
  }

  if (w.phase !== PHASE.combat) return;
  if (w.spawnedThisWave < w.roundQuota || w.enemies.count > 0) return;

  // ── round cleared ────────────────────────────────────────────────────────
  const noLeak = w.roundLeaks === 0;
  const payout =
    PAYOUT.base +
    w.round * PAYOUT.perRound +
    w.roundKills * PAYOUT.perKill +
    (noLeak ? PAYOUT.noLeakBonus : 0);

  w.scrap += payout;
  w.lastPayout = payout;
  w.vigil = Math.min(OBJECTIVE.startingVigil, w.vigil + ROUND.vigilPerRound);
  // Health comes back between rounds, so melee is a threat scoped to the round
  // you are actually fighting rather than an unrecoverable drip.
  w.player.hp = Math.min(
    w.player.maxHp,
    w.player.hp + w.player.maxHp * SURVIVAL.healOnRoundClear,
  );

  w.events.push(EV.roundCleared, 0, 0, 0, payout);
  if (noLeak) w.events.push(EV.perfectRound, 0, 0, 0, w.round);

  // Arm the next round and hand control back to the player. The build phase is
  // untimed on purpose (§4) — no timer pressure while planning.
  w.round++;
  if (w.round > w.highestRound) w.highestRound = w.round;
  w.roundQuota = roundQuota(w.round);
  w.spawnedThisWave = 0;
  w.roundKills = 0;
  w.roundLeaks = 0;
  w.phase = PHASE.build;
  moveSiteIfDue(w);
}

/**
 * Travel, if the new round belongs to a different site (MAPS §2 "Appears").
 *
 * Traps do NOT come with you — they are bolted to a floor you have left, and §4's
 * site loop always ended with arriving somewhere new. But they are **refunded in
 * full**, because losing a round's spending to a transition the player did not
 * choose would be a punishment for progressing. The scrap carries; the geometry
 * knowledge does not.
 */
function moveSiteIfDue(w: World): void {
  w.siteJustChanged = false;
  // The player picked this ground on the muster screen and the run stays on it.
  // Checked before `siteForRound` so a locked run never even asks.
  if (w.siteLocked) return;
  const next = siteForRound(w.round);
  if (next === w.level.siteId) return;

  for (let i = 0; i < w.traps.alive.length; i++) {
    if (!w.traps.alive[i]) continue;
    w.scrap += trapRefund(w, w.traps.defId[i]);
    if (w.traps.upgrade[i] !== 0) w.scrap += upgradeCost(w.traps.defId[i]);
    removeTrap(w, i);
  }

  w.level = buildLevel(next);
  w.player.x = w.level.playerStart.x;
  w.player.z = w.level.playerStart.z;
  w.player.y = 0;
  w.player.px = w.player.x;
  w.player.pz = w.player.z;
  w.player.py = 0;
  w.player.vx = 0;
  w.player.vy = 0;
  w.player.vz = 0;
  w.player.yaw = w.level.playerStart.yaw;
  w.player.pyaw = w.player.yaw;
  w.siteJustChanged = true;
  w.events.push(EV.siteEntered, 0, 0, 0, next);
}
