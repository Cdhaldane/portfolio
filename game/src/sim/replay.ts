/*
 * sim/replay.ts — a run, as data.
 *
 * §13 promised this and M0 only half-built it: the sim was made deterministic and
 * hash-checkable, but nothing ever recorded a run. This finishes it.
 *
 * A replay is the run seed plus the command stream, and nothing else. It is not a
 * video and not a state dump — it is the *inputs*, replayed through the same
 * deterministic simulation to reproduce the run exactly. That single fact buys
 * four things the project has been promising all along:
 *
 *   - free bug repro (a seed and a command log reproduce any crash),
 *   - attract-mode footage without a capture pipeline (§19.2),
 *   - leaderboard verification that isn't "trust the client" (§18.3),
 *   - and the desync detector co-op would need (§13).
 *
 * Storage is sparse-by-construction: only ticks that carried a command appear, and
 * in a 40-minute run the overwhelming majority don't. No RLE needed.
 */

import type { Command, TickInput } from "./commands.ts";
import { hashWorld } from "./hash.ts";
import { step } from "./step.ts";
import { createWorld, type World } from "./world.ts";

/** Bumped whenever a change would invalidate stored replays. */
export const REPLAY_VERSION = 1;

/** §13 rule 9: fingerprint the world every 10 seconds. */
export const HASH_INTERVAL = 600;

export interface ReplayOutcome {
  round: number;
  tally: number;
  kills: number;
  leaks: number;
  /** Wall-clock milliseconds. Presentation only — never read by the sim. */
  durationMs: number;
}

export interface Replay {
  version: number;
  seed: number;
  /**
   * The ground the run started on, and whether it stayed there.
   *
   * A replay is "the run seed plus the command stream, and nothing else" only as
   * long as the seed alone determines the world. The muster screen broke that:
   * two runs on the same seed now differ if one picked the Undertown, and a
   * replay that omitted the choice would rebuild Boot Hill, hand the same
   * commands to a different map, and diverge from its own fingerprints at the
   * first checkpoint — reported as a determinism bug in the sim, which it would
   * not be.
   *
   * Optional so recordings made before the menu existed still decode; both fall
   * back to the defaults `createWorld` already used.
   */
  site?: number;
  siteLocked?: boolean;
  /** Total ticks simulated. */
  ticks: number;
  /** Sparse: `[tick, commands]`, only for ticks that carried any. */
  cmds: [number, Command[]][];
  /** Sparse: `[tick, hash]` checkpoints. */
  hashes: [number, number][];
  outcome: ReplayOutcome;
  /** ISO date, for the run list. Not used by verification. */
  recordedAt: string;
}

/**
 * Records as the run plays. Costs one array push per tick that has input, which
 * in practice is a small fraction of ticks.
 */
export class Recorder {
  readonly seed: number;
  /** The muster-screen choices, so the replay can rebuild the same world. */
  readonly site: number;
  readonly siteLocked: boolean;
  private cmds: [number, Command[]][] = [];
  private hashes: [number, number][] = [];
  private startedAt = 0;
  ticks = 0;

  constructor(seed: number, nowMs: number, site = 0, siteLocked = false) {
    this.seed = seed;
    this.site = site;
    this.siteLocked = siteLocked;
    this.startedAt = nowMs;
  }

  /**
   * Call immediately before `step()`, with the exact input the sim will consume.
   * The world is passed so a checkpoint can be taken *after* the step, on the
   * caller's next call — see `note()`.
   */
  record(input: TickInput): void {
    if (input.cmds.length > 0) {
      // Copy: the command buffer reuses its arrays between ticks.
      this.cmds.push([input.tick, input.cmds.slice()]);
    }
    this.ticks = input.tick + 1;
  }

  /** Take a hash checkpoint if this tick is due one. */
  checkpoint(w: World): void {
    if (w.tick % HASH_INTERVAL !== 0) return;
    this.hashes.push([w.tick, hashWorld(w)]);
  }

  finish(w: World, nowMs: number): Replay {
    // Always fingerprint the final state, whatever tick it landed on.
    this.hashes.push([w.tick, hashWorld(w)]);
    return {
      version: REPLAY_VERSION,
      seed: this.seed,
      site: this.site,
      siteLocked: this.siteLocked,
      ticks: this.ticks,
      cmds: this.cmds,
      hashes: this.hashes,
      outcome: {
        round: w.round,
        tally: w.tally,
        kills: w.kills,
        leaks: w.leaks,
        durationMs: Math.max(0, Math.round(nowMs - this.startedAt)),
      },
      recordedAt: new Date(nowMs).toISOString(),
    };
  }
}

export function encode(r: Replay): string {
  return JSON.stringify(r);
}

export function decode(text: string): Replay | null {
  try {
    const r = JSON.parse(text) as Replay;
    if (typeof r !== "object" || r === null) return null;
    if (r.version !== REPLAY_VERSION) return null;
    if (typeof r.seed !== "number" || !Array.isArray(r.cmds)) return null;
    return r;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  ok: boolean;
  /** Tick of the first checkpoint that disagreed, or -1. */
  divergedAt: number;
  expected: number;
  actual: number;
  /** The world at the end of the replay, for inspection or a ghost camera. */
  world: World;
}

/**
 * Replay a recorded run and check it against its own fingerprints.
 *
 * This is the function that makes every other promise in §13 real: if it returns
 * ok, the simulation is genuinely deterministic across this build, and the replay
 * is a faithful record. If it returns a divergence tick, something in the sim read
 * a value it shouldn't have — wall clock, `Math.random`, iteration order.
 */
export function verify(r: Replay): VerifyResult {
  // `?? undefined` rather than `?? 0`: undefined lets createWorld apply its own
  // default site, which is what pre-menu recordings were made against.
  const w = createWorld(r.seed, r.site ?? undefined, r.siteLocked ?? false);
  const byTick = new Map<number, Command[]>();
  for (const [tick, cmds] of r.cmds) byTick.set(tick, cmds);

  let next = 0;
  const empty: Command[] = [];

  for (let i = 0; i < r.ticks; i++) {
    // Checkpoints are recorded before the step at that tick, so compare first.
    while (next < r.hashes.length && r.hashes[next][0] === w.tick) {
      const [tick, expected] = r.hashes[next];
      const actual = hashWorld(w);
      if (actual !== expected) {
        return { ok: false, divergedAt: tick, expected, actual, world: w };
      }
      next++;
    }
    step(w, { tick: w.tick, playerId: 0, cmds: byTick.get(w.tick) ?? empty });
    w.events.clear();
  }

  // The final fingerprint, taken after the last step.
  while (next < r.hashes.length) {
    const [tick, expected] = r.hashes[next];
    if (tick !== w.tick) {
      next++;
      continue;
    }
    const actual = hashWorld(w);
    if (actual !== expected) {
      return { ok: false, divergedAt: tick, expected, actual, world: w };
    }
    next++;
  }

  return { ok: true, divergedAt: -1, expected: 0, actual: 0, world: w };
}

/** Rough size, for the HUD and for deciding what's worth uploading (§18.3). */
export function sizeBytes(r: Replay): number {
  return encode(r).length;
}
