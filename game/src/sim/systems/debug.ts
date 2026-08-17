/*
 * sim/systems/debug.ts — the dev menu's half inside the simulation.
 *
 * Every cheat here arrives as a `CMD.debug` command through the same stream as
 * every shot and every placement, and that is the entire design: a cheat that
 * poked the world from the host would diverge from its own replay at the next
 * hash checkpoint and report itself as a §13 determinism bug. A cheat that is
 * *recorded* is just input — replays of debugged runs verify, the state hash
 * stays honest, and the headless tests can drive the menu the same way the UI
 * does.
 *
 * The one non-negotiable: `w.debugUsed` is set before anything else happens,
 * the flag is one-way, and the host refuses to submit a flagged run to the
 * leaderboard. Dev tools are for looking at the game, not at the board.
 */

import { DBG } from "../commands.ts";
import { ENEMIES } from "../enemies.ts";
import { activeGates } from "../level.ts";
import { clamp } from "../math.ts";
import { OBJECTIVE } from "../tuning.ts";
import { PHASE, killEnemy, roundQuota, spawnEnemy, type World } from "../world.ts";
import { hpScaleForRound } from "./director.ts";
import { moveSiteIfDue } from "./objective.ts";

export function applyDebug(w: World, action: number, value: number): void {
  w.debugUsed = true;

  switch (action) {
    case DBG.round:
      jumpToRound(w, Math.round(value));
      break;

    case DBG.scrap:
      w.scrap = Math.max(0, w.scrap + Math.round(value));
      break;

    case DBG.freeBuild:
      w.freeBuild = value !== 0;
      break;

    case DBG.god:
      w.player.god = value !== 0;
      break;

    case DBG.heal:
      w.player.hp = w.player.maxHp;
      w.vigil = OBJECTIVE.startingVigil;
      break;

    case DBG.killAll:
      despawnAll(w);
      break;

    case DBG.endRound:
      /*
       * Clear the round the way the objective system would: satisfy the quota,
       * empty the field, and let the NEXT tick's objectiveSystem close it —
       * payout, Vigil, build phase and site travel all included. Re-implementing
       * the round transition here would be a second copy that drifts.
       */
      if (w.phase !== PHASE.combat) return;
      despawnAll(w);
      w.spawnedThisWave = w.roundQuota;
      break;

    case DBG.spawn: {
      const defId = clamp(Math.round(value), 0, ENEMIES.length - 1);
      const def = ENEMIES[defId];
      const gates = activeGates(w.level, w.round);
      const gate = gates[0];
      if (!gate) return;
      // Deterministic scatter without touching the director's RNG stream: a
      // debug spawn must not change who the director sends next.
      const jitter = ((w.nextSpawnId % 5) - 2) * 0.5;
      const i = spawnEnemy(
        w,
        clamp(gate.x, 1.2, w.level.width - 1.2),
        clamp(gate.z + jitter, 1.2, w.level.depth - 1.2),
        defId,
      );
      if (i >= 0) {
        // The HP the director would give it this round, minus the elite roll —
        // a test spawn should be the archetype itself, not the round's variant.
        const hp = def.maxHp * hpScaleForRound(w.round);
        w.enemies.hp[i] = hp;
        w.enemies.maxHp[i] = hp;
      }
      break;
    }
  }
}

/**
 * Jump straight to `round`, back in the build phase, on the site that round
 * belongs to. A clean slate on arrival — full HP and Vigil — because the point
 * of jumping to round 12 is to test round 12, not to arrive at it dying.
 */
function jumpToRound(w: World, round: number): void {
  const r = clamp(round, 1, 999);
  despawnAll(w);

  w.round = r;
  if (r > w.highestRound) w.highestRound = r;
  w.roundQuota = roundQuota(r);
  w.spawnedThisWave = 0;
  w.roundKills = 0;
  w.roundLeaks = 0;
  w.phase = PHASE.build;
  w.player.hp = w.player.maxHp;
  w.vigil = OBJECTIVE.startingVigil;
  // Rotation runs travel with the round — the same rule the real transition
  // applies, from the same function, so a jump lands where playing would.
  moveSiteIfDue(w);
}

/** Every body off the field, silently: no kill credit, no scrap, no events. */
function despawnAll(w: World): void {
  const e = w.enemies;
  for (let i = 0; i < e.alive.length; i++) {
    if (e.alive[i]) killEnemy(w, i);
  }
}
