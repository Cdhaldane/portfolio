/*
 * System 2 — DirectorSystem. Spawns the round.
 *
 * The game is endless and the round number is the score (§4), so this is the
 * difficulty curve of the whole game. Three rules shape it:
 *
 *  1. **Count grows faster than HP.** A horde game should get *wider*, not
 *     spongier — more bodies means more trap chains and more decisions.
 *  2. **Every 5th round is an elite round**: far fewer bodies, much tougher, worth
 *     much more. A change of question rather than more of the same.
 *  3. **A debut is gentle.** The round an archetype first appears, at most
 *     DEBUT_CAP of them spawn (§8). The player gets to *learn* the Buzzard before
 *     meeting six of them, which is the difference between hard and unfair.
 */

import { DEBUT_CAP, ENEMIES, isDebutRound, unlockedFor, type EnemyDef } from "../enemies.ts";
import { GATE_SPAWN_REACH, activeGates, cellOf } from "../level.ts";
import { ROUND, WAVE } from "../tuning.ts";
import { clamp } from "../math.ts";
import { PHASE, isEliteRound, spawnEnemy, type World } from "../world.ts";

export function directorSystem(w: World): void {
  if (w.phase !== PHASE.combat) return;
  if (w.spawnedThisWave >= w.roundQuota) return;
  if (w.tick < w.nextSpawnTick) return;

  const defId = pickArchetype(w);
  // Only gates that have opened by this round (§4, MAPS §9 item 6).
  const gates = activeGates(w.level, w.round);
  const gate = gates[w.streams.director.int(gates.length)];
  // Scatter arrivals across the gate mouth so they don't spawn inside one another
  // and get shoved apart on frame one.
  const jitter = w.streams.director.range(-1.4, 1.4);

  /*
   * Clamp the jittered arrival inside the map and out of geometry. A gate authored
   * a metre from the perimeter put bodies *through* the wall, where collision then
   * ejected them outside the level to shove uselessly at it forever. Authored maps
   * should not be able to cause that, so the director guards it centrally.
   */
  let sx = gate.x;
  let sz = clamp(gate.z + jitter, 1.2, w.level.depth - 1.2);
  sx = clamp(sx, 1.2, w.level.width - 1.2);
  const cell = cellOf(w.level, sx, sz);
  if (cell < 0 || w.level.blocked[cell]) {
    sx = clamp(gate.x, 1.2, w.level.width - 1.2);
    sz = clamp(gate.z, 1.2, w.level.depth - 1.2);
    /*
     * The gate's own centre can be legally walled now: a blockade at the mouth
     * narrows the lane, and `wouldSealLane` only promises the spawn AREA keeps a
     * route. So when the centre is inside a blockade's padded skirt, walk the
     * same GATE_SPAWN_REACH the placement rule reasons over and start the body
     * on the nearest cell that actually routes — arriving beside the barricade
     * and walking around it, instead of standing in the skirt fighting the
     * collision. Deterministic: fixed scan order, nearest wins, no RNG.
     */
    const c2 = cellOf(w.level, sx, sz);
    if (c2 < 0 || w.level.blocked[c2]) {
      let bestD = Infinity;
      for (let dz = -GATE_SPAWN_REACH; dz <= GATE_SPAWN_REACH; dz += w.level.cell) {
        for (let dx = -GATE_SPAWN_REACH; dx <= GATE_SPAWN_REACH; dx += w.level.cell) {
          const x = clamp(gate.x + dx, 1.2, w.level.width - 1.2);
          const z = clamp(gate.z + dz, 1.2, w.level.depth - 1.2);
          const c = cellOf(w.level, x, z);
          if (c < 0 || w.level.blocked[c] || !Number.isFinite(w.level.dist[c])) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            sx = x;
            sz = z;
          }
        }
      }
    }
  }

  const i = spawnEnemy(w, sx, sz, defId);
  if (i >= 0) {
    const def = ENEMIES[defId];
    const elite = isEliteRound(w.round);
    const hp = def.maxHp * w.enemyHpScale * (elite ? ROUND.eliteHpMultiplier : 1);
    w.enemies.hp[i] = hp;
    w.enemies.maxHp[i] = hp;
    w.enemies.elite[i] = elite ? 1 : 0;
    w.spawnedByDef[defId]++;
  }

  w.spawnedThisWave++;
  w.nextSpawnTick = w.tick + spawnInterval(w.round);
}

/**
 * Composition constraint #6 (MAPS §3 G7): may this site answer this archetype?
 *
 * Exported because the map tests assert it directly — a site that unlocks an
 * archetype it cannot answer is a content bug, and it should fail in `node`, not
 * in someone's run.
 */
export function siteCanAnswer(def: EnemyDef, w: World): boolean {
  const req = def.requires;
  if (!req) return true;
  const c = w.level.census;
  if (req.verticalSurfaces !== undefined && c.wall + c.ceiling < req.verticalSurfaces) {
    return false;
  }
  if (req.ceilings !== undefined && c.ceiling < req.ceilings) return false;
  if (req.sigils !== undefined && c.sigil < req.sigils) return false;
  if (req.perCeiling !== undefined) {
    if (w.spawnedByDef[def.id] >= Math.max(1, c.ceiling * req.perCeiling)) return false;
  }
  return true;
}

/**
 * Weighted draw from the unlocked roster, with the debut cap and the site's
 * surface census both applied.
 *
 * Uses the `director` stream only — composition must never share randomness with
 * combat, or a lucky damage roll would change who shows up (§13 rule 2).
 */
function pickArchetype(w: World): number {
  const pool = unlockedFor(w.round);

  const eligible = (def: EnemyDef): boolean => {
    if (isDebutRound(def, w.round) && w.spawnedByDef[def.id] >= DEBUT_CAP) return false;
    return siteCanAnswer(def, w);
  };

  let total = 0;
  for (let i = 0; i < pool.length; i++) if (eligible(pool[i])) total += pool[i].weight;
  // Everything else is barred by the site or its debut cap: fall back to the
  // horde filler, which every map can always answer.
  if (total <= 0) return 0;

  let roll = w.streams.director.int(total);
  for (let i = 0; i < pool.length; i++) {
    const def = pool[i];
    if (!eligible(def)) continue;
    roll -= def.weight;
    if (roll < 0) return def.id;
  }
  return 0;
}

export function spawnInterval(round: number): number {
  const sec = Math.max(
    ROUND.minIntervalSec,
    ROUND.baseIntervalSec - (round - 1) * ROUND.intervalPerRound,
  );
  return Math.round(sec * 60);
}

/**
 * HP multiplier for a round, under the two-regime curve (§4, decision 20).
 *
 * Linear at `hpPerRound` until `hpRampRound`, then **compounding** at
 * `hpPerRoundLate`. Compounding is the point: past the body cap, HP is the only
 * lever still moving, and a linear term would flatten out exactly where the game
 * needs to keep climbing.
 *
 * Continuous at the join — round 30 gives the same number under either branch —
 * so the difficulty never steps.
 */
export function hpScaleForRound(round: number): number {
  const linear = 1 + (Math.min(round, ROUND.hpRampRound) - 1) * ROUND.hpPerRound;
  if (round <= ROUND.hpRampRound) return linear;
  return linear * (1 + ROUND.hpPerRoundLate) ** (round - ROUND.hpRampRound);
}

/** Called when a round is armed: bakes the per-round scalars once. */
export function applyRoundScaling(w: World): void {
  w.enemyHpScale = hpScaleForRound(w.round);
  w.enemySpeedScale = Math.min(
    ROUND.speedCapMultiplier,
    1 + (w.round - 1) * ROUND.speedPerRound,
  );
  w.spawnedByDef.fill(0);
  w.nextSpawnTick = w.tick + WAVE.firstSpawnTick;
}
