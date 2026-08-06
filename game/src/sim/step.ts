/*
 * sim/step.ts — one simulation tick.
 *
 * The system order below IS gameplay (§12.4) and must not be reshuffled
 * casually. M0 runs the subset of the sixteen systems that M0 content needs;
 * the numbering is kept so the gaps are visible rather than forgotten.
 *
 * Contract: this function reads only (a) the command list for this tick,
 * (b) the seeded RNG streams, and (c) prior state. No wall clock, no DOM, no
 * three.js, no Math.random (§13).
 */

import type { TickInput } from "./commands.ts";
import { commandSystem } from "./systems/command.ts";
import { directorSystem } from "./systems/director.ts";
import {
  enemyCollisionSystem,
  enemyMoveSystem,
  meleeSystem,
  playerPushSystem,
  separationSystem,
  statusSystem,
} from "./systems/enemy.ts";
import { bootSystem, comboSystem } from "./systems/combat.ts";
import { objectiveSystem } from "./systems/objective.ts";
import { playerMoveSystem, playerWeaponSystem } from "./systems/player.ts";
import { trapSystem } from "./systems/trap.ts";
import type { World } from "./world.ts";

/** Copy current transforms into the `p*` mirrors that render interpolates from. */
function snapshotPrevious(w: World): void {
  const p = w.player;
  p.px = p.x;
  p.py = p.y;
  p.pz = p.z;
  p.pyaw = p.yaw;
  p.ppitch = p.pitch;

  const e = w.enemies;
  for (let i = 0; i < e.alive.length; i++) {
    if (!e.alive[i]) continue;
    e.px[i] = e.x[i];
    e.py[i] = e.y[i];
    e.pz[i] = e.z[i];
  }
}

export function step(w: World, input: TickInput): void {
  snapshotPrevious(w);

  commandSystem(w, input); //  1
  directorSystem(w); //  2
  statusSystem(w); //  3
  meleeSystem(w); //  4  (the melee half of ThinkSystem)
  // 5 NavSystem        — worker paths for exception units, M3
  enemyMoveSystem(w); //  6  (flow-field locomotion)
  separationSystem(w); //  7
  playerMoveSystem(w); //  6/8 (player half)
  playerPushSystem(w); //  7  (player vs crowd)
  enemyCollisionSystem(w); //  8
  trapSystem(w); //  9
  bootSystem(w); // 10 (the Boot, before the gun: kick then shoot)
  playerWeaponSystem(w); // 10 (hitscan) + 11/12 via damageEnemy
  comboSystem(w); // 13 (poker hands)
  objectiveSystem(w); // 14
  // 15 EventFlushSystem — the host drains the ring after presenting
  // 16 SnapshotSystem   — done at the top of the next step

  w.tick++;
}
