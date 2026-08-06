/*
 * sim/commands.ts — the ONLY way input reaches the simulation.
 *
 * Input is sampled per frame and applied per tick (§12.3). Buttons are latched
 * so a click between ticks is never dropped — that's the root cause of "my shot
 * didn't register". Floats are quantized on the way in (§13, rule 7).
 *
 * A replay is nothing but the run seed plus the TickInput stream, which is why
 * this file is small and boring on purpose.
 */

import { quantize } from "./math.ts";

export const CMD = {
  move: 0,
  look: 1,
  fire: 2,
  reload: 3,
  jump: 4,
  sprint: 5,
  buildMode: 6,
  place: 7,
  startWave: 8,
  aim: 9,
  selectSlot: 10,
  sell: 11,
  boot: 12,
  upgrade: 13,
} as const;

export type CmdKind = (typeof CMD)[keyof typeof CMD];

export type Command =
  /** Stick/WASD intent in camera space, each axis in [-1, 1]. */
  | { t: typeof CMD.move; x: number; y: number }
  /** Absolute look angles in radians (already accumulated by the host). */
  | { t: typeof CMD.look; yaw: number; pitch: number }
  | { t: typeof CMD.fire }
  | { t: typeof CMD.reload }
  | { t: typeof CMD.jump }
  | { t: typeof CMD.sprint; on: boolean }
  | { t: typeof CMD.buildMode; on: boolean }
  /** Place the equipped trap at a grid cell. */
  | { t: typeof CMD.place; cell: number }
  /** Ring the bell: leave the untimed build phase (§4). */
  | { t: typeof CMD.startWave }
  /** Aim down the barrel — tightens the boom and FOV (§7). */
  | { t: typeof CMD.aim; on: boolean }
  /** Arm a hotbar slot. Also enters build mode. */
  | { t: typeof CMD.selectSlot; slot: number }
  /** Sell the trap in a cell, for a refund. */
  | { t: typeof CMD.sell; cell: number }
  /** The Boot: kick a body into your own machinery (§7). */
  | { t: typeof CMD.boot }
  /** Upgrade the trap in a cell down one of its two branches (§6). */
  | { t: typeof CMD.upgrade; cell: number; choice: 1 | 2 };

export interface TickInput {
  tick: number;
  playerId: number;
  cmds: Command[];
}

const MOVE_STEPS = 1000;
const LOOK_STEPS = 8192;

export function moveCmd(x: number, y: number): Command {
  return {
    t: CMD.move,
    x: quantize(x, MOVE_STEPS),
    y: quantize(y, MOVE_STEPS),
  };
}

export function lookCmd(yaw: number, pitch: number): Command {
  return {
    t: CMD.look,
    yaw: quantize(yaw, LOOK_STEPS),
    pitch: quantize(pitch, LOOK_STEPS),
  };
}

/**
 * Collects intents between sim ticks and hands them over as one TickInput.
 * Continuous axes are overwritten (latest wins); discrete presses are latched
 * so nothing is lost between ticks.
 */
export class CommandBuffer {
  private axes: Command[] = [];
  private latched: Command[] = [];

  setAxis(cmd: Command): void {
    for (let i = 0; i < this.axes.length; i++) {
      if (this.axes[i].t === cmd.t) {
        this.axes[i] = cmd;
        return;
      }
    }
    this.axes.push(cmd);
  }

  press(cmd: Command): void {
    this.latched.push(cmd);
  }

  /** Drain into a TickInput for `tick`. Axes persist; latched presses clear. */
  take(tick: number, playerId = 0): TickInput {
    const cmds: Command[] = [];
    for (let i = 0; i < this.axes.length; i++) cmds.push(this.axes[i]);
    for (let i = 0; i < this.latched.length; i++) cmds.push(this.latched[i]);
    this.latched.length = 0;
    return { tick, playerId, cmds };
  }
}
