/*
 * System 1 — CommandSystem. Applies player intent from the tick's command list.
 *
 * Nothing else in the sim reads input. That's what makes a replay a complete
 * description of a run (§13).
 */

import { CMD, type TickInput } from "../commands.ts";
import { EV } from "../events.ts";
import {
  isPlaceableFor,
  rebake,
  slotOfCell,
  tileCenterX,
  tileCenterY,
  tileCenterZ,
  wouldSealLane,
} from "../level.ts";
import { sideYaw } from "../surfaces.ts";
import { clamp } from "../math.ts";
import { PLAYER, ticks } from "../tuning.ts";
import { HOTBAR_SLOTS, TRAPS, trapDef, upgradeCost } from "../traps.ts";
import { PHASE, addTrap, removeTrap, trapAtCell, type World } from "../world.ts";
import { applyRoundScaling } from "./director.ts";

/**
 * Building during combat carries a surcharge (§5): it stays possible, so you can
 * react to a lane collapsing, but it's a real decision rather than a free one.
 */
export const COMBAT_SURCHARGE = 1.25;

export function trapCost(w: World, defId: number): number {
  const base = trapDef(defId).cost;
  return w.phase === PHASE.combat ? Math.round(base * COMBAT_SURCHARGE) : base;
}

/** Refund is full during build, half once the bodies are moving. */
export function trapRefund(w: World, defId: number): number {
  const base = trapDef(defId).cost;
  return w.phase === PHASE.combat ? Math.round(base * 0.5) : base;
}

export function commandSystem(w: World, input: TickInput): void {
  const p = w.player;
  p.wantFire = false;
  p.wantReload = false;
  p.wantBoot = false;

  for (let i = 0; i < input.cmds.length; i++) {
    const c = input.cmds[i];
    switch (c.t) {
      case CMD.move:
        p.inMoveX = clamp(c.x, -1, 1);
        p.inMoveY = clamp(c.y, -1, 1);
        break;
      case CMD.look:
        p.yaw = c.yaw;
        p.pitch = clamp(c.pitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);
        break;
      case CMD.fire:
        p.wantFire = true;
        break;
      case CMD.reload:
        p.wantReload = true;
        break;
      case CMD.boot:
        p.wantBoot = true;
        break;
      case CMD.jump:
        p.jumpBuffer = PLAYER.jumpBufferTicks;
        break;
      case CMD.sprint:
        p.sprinting = c.on;
        break;
      case CMD.aim:
        p.aiming = c.on;
        break;
      case CMD.buildMode:
        p.buildMode = c.on;
        break;
      case CMD.selectSlot:
        // Arming a slot enters build mode: one keystroke from "shooting" to
        // "placing", because during a round you have no time for two.
        if (c.slot >= 0 && c.slot < HOTBAR_SLOTS) {
          p.slot = c.slot;
          p.buildMode = true;
        }
        break;
      case CMD.place:
        placeTrap(w, c.cell);
        break;
      case CMD.sell:
        sellTrap(w, c.cell);
        break;
      case CMD.upgrade:
        upgradeTrap(w, c.cell, c.choice);
        break;
      case CMD.startWave:
        if (w.phase === PHASE.build) {
          w.phase = PHASE.combat;
          w.waveStartTick = w.tick;
          applyRoundScaling(w);
          w.events.push(EV.waveStarted, 0, 0, 0, w.round);
        }
        break;
    }
  }
}

function placeTrap(w: World, cell: number): void {
  const defId = w.player.slot;
  const cost = trapCost(w, defId);
  const safeCell = Math.max(cell, 0);
  const def = defId < TRAPS.length ? TRAPS[defId] : undefined;

  if (
    def === undefined ||
    // §6: placement is validated against surface tags. A wall trap needs one of
    // the site's authored wall mounts; a floor trap needs open ground.
    !isPlaceableFor(w.level, cell, def.surface) ||
    trapAtCell(w, cell) >= 0 ||
    w.scrap < cost ||
    w.phase === PHASE.lost ||
    /*
     * A lane can be narrowed but never sealed.
     *
     * Checked here rather than in `isPlaceable` because it is a question about this
     * *trap* — only an obstacle can seal anything — and because it costs two grid
     * floods, which the other eight traps should not pay for on every placement.
     */
    (def.blocks === true && wouldSealLane(w.level, cell))
  ) {
    w.events.push(
      EV.placeDenied,
      tileCenterX(w.level, safeCell),
      tileCenterY(w.level, safeCell),
      tileCenterZ(w.level, safeCell),
    );
    return;
  }

  const x = tileCenterX(w.level, cell);
  const z = tileCenterZ(w.level, cell);
  const y = tileCenterY(w.level, cell);
  const slot = slotOfCell(cell);
  const yaw = slot >= 0 ? sideYaw(w.level.slots[slot].side ?? 0) : 0;
  const id = addTrap(w, cell, x, z, defId, y, yaw);
  if (id < 0) {
    w.events.push(EV.placeDenied, x, y, z);
    return;
  }
  w.scrap -= cost;
  // A trap dropped mid-round needs a beat before it bites, or placing one under
  // an enemy's feet would be a free kill.
  w.traps.cooldown[id] = w.phase === PHASE.combat ? ticks(0.5) : 0;
  /*
   * An obstacle changes the map, so the field has to be rebuilt before the next
   * tick — bodies already walking the old flow would otherwise carry a stale
   * direction into it, and step through the gap it was meant to close.
   */
  if (def.blocks === true) {
    w.level.blockTiles[cell] = 1;
    rebake(w.level);
  }
  w.events.push(EV.trapPlaced, x, y, z, defId);
}

/**
 * Take one of a trap's two branches. Irreversible — selling and rebuilding is the
 * only way back, which is what makes the choice a commitment rather than a menu.
 */
function upgradeTrap(w: World, cell: number, choice: 1 | 2): void {
  const id = trapAtCell(w, cell);
  const x = tileCenterX(w.level, Math.max(cell, 0));
  const z = tileCenterZ(w.level, Math.max(cell, 0));
  /* A trap with no branches has nothing to buy. Without this the Dead Man's Brace
     would take the scrap, mark itself upgraded, and resolve to its own base def —
     paying full price for nothing at all. */
  const hasBranches = id >= 0 && TRAPS[w.traps.defId[id]]?.upgrades !== undefined;
  if (id < 0 || !hasBranches || w.traps.upgrade[id] !== 0 || w.phase === PHASE.lost) {
    w.events.push(EV.placeDenied, x, 0, z);
    return;
  }
  const cost = upgradeCost(w.traps.defId[id]);
  if (w.scrap < cost) {
    w.events.push(EV.placeDenied, x, 0, z);
    return;
  }
  w.scrap -= cost;
  w.traps.upgrade[id] = choice;
  w.events.push(EV.trapUpgraded, w.traps.x[id], 0, w.traps.z[id], w.traps.defId[id]);
}

function sellTrap(w: World, cell: number): void {
  const id = trapAtCell(w, cell);
  if (id < 0) {
    w.events.push(EV.placeDenied, tileCenterX(w.level, Math.max(cell, 0)), 0, tileCenterZ(w.level, Math.max(cell, 0)));
    return;
  }
  w.scrap += trapRefund(w, w.traps.defId[id]);
  // Refund the upgrade too, on the same build/combat terms.
  if (w.traps.upgrade[id] !== 0) {
    const up = upgradeCost(w.traps.defId[id]);
    w.scrap += w.phase === PHASE.combat ? Math.round(up * 0.5) : up;
  }
  w.events.push(EV.trapSold, w.traps.x[id], 0, w.traps.z[id], w.traps.defId[id]);
  const wasObstacle = TRAPS[w.traps.defId[id]]?.blocks === true;
  removeTrap(w, id);
  // Pulling an obstacle down reopens the lane it bent, so the field has to follow.
  if (wasObstacle) {
    w.level.blockTiles[cell] = 0;
    rebake(w.level);
  }
}
