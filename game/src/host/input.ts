/*
 * host/input.ts — devices in, commands out.
 *
 * The host samples devices every *frame* and the sim consumes them every *tick*
 * (§12.3). Look deltas accumulate here; buttons are latched by CommandBuffer so
 * a click landing between ticks is never dropped.
 *
 * This file is the only place in the codebase that touches the keyboard, the
 * mouse or pointer lock.
 */

import { CMD, CommandBuffer, lookCmd, moveCmd } from "../sim/commands.ts";
import { clamp } from "../sim/math.ts";
import { PLAYER } from "../sim/tuning.ts";
import { HOTBAR_SLOTS } from "../sim/traps.ts";

export interface InputOptions {
  sensitivity: number;
  invertY: boolean;
}

export class Input {
  readonly buffer = new CommandBuffer();
  readonly opts: InputOptions = { sensitivity: 0.0022, invertY: false };

  private keys = new Set<string>();
  private yaw: number;
  private pitch: number;
  private locked = false;
  private firing = false;
  private disposers: (() => void)[] = [];

  /** Set by the host each frame: the grid cell under the crosshair, or -1. */
  aimCell = -1;
  /** True while the build overlay is up. */
  buildMode = false;
  /** Armed hotbar slot, mirrored from the sim so the wheel can step it. */
  slot = 0;
  /** True when the crosshair is on a placed, un-upgraded trap. */
  onUpgradable = false;

  onPointerLockChange: ((locked: boolean) => void) | null = null;
  onPause: (() => void) | null = null;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, startYaw: number, startPitch: number) {
    this.canvas = canvas;
    this.yaw = startYaw;
    this.pitch = startPitch;
    this.attach();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  requestLock(): void {
    void this.canvas.requestPointerLock();
  }

  private attach(): void {
    const add = <K extends keyof DocumentEventMap>(
      target: Document | HTMLElement | Window,
      type: K,
      fn: (ev: DocumentEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };

    add(document, "keydown", (e) => {
      // Never swallow the browser's own shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const code = e.code;
      if (!this.keys.has(code)) this.onKeyDown(code);
      this.keys.add(code);
      if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    });

    add(document, "keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        this.buffer.press({ t: CMD.sprint, on: false });
      }
    });

    add(document, "mousemove", (e) => {
      if (!this.locked) return;
      const s = this.opts.sensitivity;
      this.yaw -= e.movementX * s;
      const dy = e.movementY * s * (this.opts.invertY ? 1 : -1);
      this.pitch = clamp(this.pitch + dy, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    });

    add(this.canvas, "mousedown", (e) => {
      if (!this.locked) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        if (this.buildMode) {
          if (this.aimCell >= 0) this.buffer.press({ t: CMD.place, cell: this.aimCell });
        } else {
          this.firing = true;
          this.buffer.press({ t: CMD.fire });
        }
      }
      // Middle mouse also kicks: it wants to be reachable without leaving WASD.
      if (e.button === 1) {
        e.preventDefault();
        this.buffer.press({ t: CMD.boot });
      }
      if (e.button === 2) {
        // In build mode the right button sells instead of aiming: the cursor is
        // already a placement cursor, so making it a *removal* cursor is the
        // least surprising thing it can do.
        if (this.buildMode) {
          if (this.aimCell >= 0) this.buffer.press({ t: CMD.sell, cell: this.aimCell });
        } else {
          this.buffer.press({ t: CMD.aim, on: true });
        }
      }
    });

    add(document, "mouseup", (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.buffer.press({ t: CMD.aim, on: false });
    });

    add(this.canvas, "contextmenu", (e) => e.preventDefault());

    // The wheel cycles the hotbar — the fastest way to swap traps mid-round.
    add(
      this.canvas,
      "wheel",
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        /*
         * The wheel walks the whole HUD row, weapon included — row 0 is the
         * revolver, rows 1..N are traps. Scrolling past the first trap should
         * put the gun back in your hands rather than wrapping to the last trap,
         * because "keep scrolling until I'm shooting again" is what players
         * actually do under pressure.
         */
        const dir = e.deltaY > 0 ? 1 : -1;
        const rows = HOTBAR_SLOTS + 1;
        const row = (this.buildMode ? this.slot + 1 : 0) + dir;
        const next = ((row % rows) + rows) % rows;
        if (next === 0) {
          this.buildMode = false;
          this.buffer.press({ t: CMD.buildMode, on: false });
        } else {
          this.slot = next - 1;
          this.buildMode = true;
          this.buffer.press({ t: CMD.selectSlot, slot: this.slot });
        }
      },
      { passive: false },
    );

    add(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        // Releasing the mouse must not leave keys stuck down.
        this.keys.clear();
        this.firing = false;
        this.buffer.setAxis(moveCmd(0, 0));
        this.onPause?.();
      }
      this.onPointerLockChange?.(this.locked);
    });

    // Losing focus mid-sprint should not strand the player running.
    add(window, "blur", () => {
      this.keys.clear();
      this.firing = false;
      this.buffer.setAxis(moveCmd(0, 0));
    });
  }

  private onKeyDown(code: string): void {
    switch (code) {
      case "Space":
        this.buffer.press({ t: CMD.jump });
        break;
      case "KeyR":
        this.buffer.press({ t: CMD.reload });
        break;
      case "KeyE":
        this.buffer.press({ t: CMD.boot });
        break;
      // The two branches of a trap's upgrade (§6). Only meaningful while the
      // crosshair is on one, which is what the build panel is showing.
      case "KeyZ":
        if (this.buildMode && this.onUpgradable && this.aimCell >= 0) {
          this.buffer.press({ t: CMD.upgrade, cell: this.aimCell, choice: 1 });
        }
        break;
      case "KeyX":
        if (this.buildMode && this.onUpgradable && this.aimCell >= 0) {
          this.buffer.press({ t: CMD.upgrade, cell: this.aimCell, choice: 2 });
        }
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.buffer.press({ t: CMD.sprint, on: true });
        break;
      case "KeyQ":
        // Kept as a toggle, unlike `1`: a quick there-and-back to the last armed
        // trap is worth a key, and it's already in muscle memory from M0.5.
        this.buildMode = !this.buildMode;
        this.buffer.press({ t: CMD.buildMode, on: this.buildMode });
        break;
      /*
       * §7 decision 17 — row index 0 is the revolver, 1..N are traps.
       *
       * The sim still numbers *trap* slots 0..N-1 and that must not change:
       * `selectSlot` is a recorded command, so renumbering it would invalidate
       * every stored replay and the state hashes that check them (§13). The
       * weapon lives in the HUD row only; pressing `1` is expressed to the sim
       * as "leave build mode", which is exactly what holstering already was.
       */
      case "Digit1":
        this.buildMode = false;
        this.buffer.press({ t: CMD.buildMode, on: false });
        break;
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5":
      case "Digit6":
      case "Digit7":
      case "Digit8":
      case "Digit9":
      case "Digit0":
      /* The row keeps going past `0`. Ten traps plus the revolver need eleven keys,
         and the Dead Man's Brace was the tenth trap — unreachable by keyboard and
         only findable with the mouse wheel until these two landed. `-` and `=` are
         where the number row actually continues, so the hint on the slot stays
         truthful. */
      case "Minus":
      case "Equal": {
        // 2..9 are traps 0..7; then `0`, `-`, `=` continue to traps 8, 9 and 10.
        const digit =
          code === "Minus" ? 11 : code === "Equal" ? 12 : Number(code.slice(5)) || 10;
        const slot = digit - 2;
        if (slot >= 0 && slot < HOTBAR_SLOTS) {
          this.slot = slot;
          this.buildMode = true;
          this.buffer.press({ t: CMD.selectSlot, slot });
        }
        break;
      }
      case "KeyF":
      case "Enter":
        this.buffer.press({ t: CMD.startWave });
        break;
    }
  }

  /** Called once per frame, before the sim catches up. */
  sample(): void {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    this.buffer.setAxis(moveCmd(x, y));
    this.buffer.setAxis(lookCmd(this.yaw, this.pitch));

    // Hold-to-fire: the revolver's own cooldown paces it, so repeating the
    // intent every frame is correct and lets fanning arrive later for free.
    if (this.firing && !this.buildMode) this.buffer.press({ t: CMD.fire });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

const PREVENT_DEFAULT = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
]);
