/*
 * Replay tests — the ones that make §13 more than a comment.
 *
 * §13 claimed a run is fully described by its seed plus its command stream, and
 * that hash checkpoints would catch any drift. Everything else the project has
 * promised rests on that being literally true: bug repro from a seed, attract-mode
 * footage, leaderboard verification that isn't "trust the client", and the desync
 * detector co-op would need.
 *
 *   node --experimental-strip-types --test tests/replay.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CMD, type Command } from "../src/sim/commands.ts";
import { hashWorld } from "../src/sim/hash.ts";
import {
  HASH_INTERVAL,
  REPLAY_VERSION,
  Recorder,
  decode,
  encode,
  sizeBytes,
  verify,
} from "../src/sim/replay.ts";
import { step } from "../src/sim/step.ts";
import { buildLevel, isPlaceable, tileOf } from "../src/sim/level.ts";
import { createWorld, type World } from "../src/sim/world.ts";

const TRAP = { jaws: 0, tar: 1, vent: 2, plate: 3, sigil: 4 } as const;

/*
 * Three build tiles on Boot Hill's lane, computed from metres.
 *
 * The literals these replace (730/729/774) were nav cells, and two of the three sat
 * inside the Rift's 2.2m keep-out ring — so the vent and the jaws were refused every
 * run and only the tar ever landed. A replay test proves the recorder reproduces
 * whatever happened; it has no way to notice that what happened was nothing.
 */
const LANE = (() => {
  const l = buildLevel();
  const tiles = [27, 25, 23].map((x) => tileOf(l, x, 17));
  for (const t of tiles) {
    if (!isPlaceable(l, t)) throw new Error("Boot Hill lane tile " + t + " is not placeable");
  }
  return tiles;
})();

/** A scripted run that touches every system that writes state. */
function script(tick: number): Command[] {
  if (tick === 3) {
    return [{ t: CMD.selectSlot, slot: TRAP.tar }, { t: CMD.place, cell: LANE[0] }];
  }
  if (tick === 4) {
    return [{ t: CMD.selectSlot, slot: TRAP.vent }, { t: CMD.place, cell: LANE[1] }];
  }
  if (tick === 5) return [{ t: CMD.upgrade, cell: LANE[0], choice: 2 }];
  if (tick === 6) {
    return [{ t: CMD.selectSlot, slot: TRAP.jaws }, { t: CMD.place, cell: LANE[2] }];
  }
  // Arming a slot enters build mode (§6), and nothing else leaves it: without
  // this the player spends the whole run holding a trap and every `fire` below is
  // silently discarded.
  if (tick === 8) return [{ t: CMD.buildMode, on: false }];
  if (tick === 10) return [{ t: CMD.startWave }];
  if (tick === 40) return [{ t: CMD.move, x: 0.4, y: 1 }, { t: CMD.sprint, on: true }];
  if (tick === 200) return [{ t: CMD.jump }];
  if (tick === 260) return [{ t: CMD.move, x: -1, y: 0.2 }];
  if (tick % 47 === 0) return [{ t: CMD.fire }];
  if (tick % 91 === 0) return [{ t: CMD.boot }];
  if (tick % 61 === 0) {
    return [{ t: CMD.look, yaw: -1.4 + tick * 0.0006, pitch: -0.12 }];
  }
  return [];
}

/** Play a run through a Recorder exactly the way the host loop does. */
function playAndRecord(seed: number, ticks: number) {
  const w = createWorld(seed);
  const rec = new Recorder(seed, 0);
  for (let i = 0; i < ticks; i++) {
    const cmds = script(w.tick);
    rec.checkpoint(w);
    rec.record({ tick: w.tick, playerId: 0, cmds });
    step(w, { tick: w.tick, playerId: 0, cmds });
    w.events.clear();
  }
  return { world: w, replay: rec.finish(w, 12_345) };
}

describe("replay recording (§13)", () => {
  it("records only the ticks that carried input", () => {
    const { replay } = playAndRecord(0xa11ce, 900);
    assert.equal(replay.ticks, 900);
    assert.ok(replay.cmds.length > 0, "something should have been recorded");
    assert.ok(
      replay.cmds.length < 900,
      `a sparse log should be far shorter than the run (${replay.cmds.length}/900)`,
    );
    for (const [, cmds] of replay.cmds) {
      assert.ok(cmds.length > 0, "empty command lists must not be stored");
    }
  });

  it("fingerprints on schedule and at the end", () => {
    const { replay } = playAndRecord(0xa11ce, 1500);
    const ticksSeen = replay.hashes.map(([t]) => t);
    assert.ok(ticksSeen.includes(0));
    assert.ok(ticksSeen.includes(HASH_INTERVAL));
    assert.ok(ticksSeen.includes(HASH_INTERVAL * 2));
    assert.equal(ticksSeen[ticksSeen.length - 1], 1500, "the final state is hashed");
  });

  it("carries the outcome, so a run list needs no replaying", () => {
    const { world, replay } = playAndRecord(0xbeef, 1200);
    assert.equal(replay.outcome.round, world.round);
    assert.equal(replay.outcome.tally, world.tally);
    assert.equal(replay.outcome.kills, world.kills);
    assert.equal(replay.outcome.leaks, world.leaks);
    assert.equal(replay.version, REPLAY_VERSION);
  });
});

describe("replay verification", () => {
  it("reproduces the run exactly", () => {
    const { world, replay } = playAndRecord(0xc0ffee, 1500);
    const result = verify(replay);
    assert.equal(result.divergedAt, -1, `diverged at tick ${result.divergedAt}`);
    assert.ok(result.ok);
    // Not just the checkpoints: the whole final state must match.
    assert.equal(hashWorld(result.world), hashWorld(world));
    assert.equal(result.world.round, world.round);
    assert.equal(result.world.tally, world.tally);
  });

  it("survives a round trip through text", () => {
    const { replay } = playAndRecord(0xd15ea5e, 900);
    const text = encode(replay);
    const back = decode(text);
    assert.ok(back, "a replay we just wrote must decode");
    assert.equal(back.seed, replay.seed);
    assert.equal(back.ticks, replay.ticks);
    assert.ok(verify(back).ok, "and still verify after the round trip");
  });

  it("catches a tampered command log", () => {
    // The leaderboard's actual defence (§18.3): a spoofer has to forge a
    // *consistent* run, not just a number.
    const { replay } = playAndRecord(0x5eed, 900);
    const tampered = decode(encode(replay))!;
    // Inject movement that never happened. A `move` is unambiguously
    // state-changing, unlike a `fire` the sim might legitimately ignore.
    tampered.cmds.push([500, [{ t: CMD.move, x: 1, y: 1 }]]);
    tampered.cmds.sort((a, b) => a[0] - b[0]);
    const result = verify(tampered);
    assert.equal(result.ok, false, "an edited log must not verify");
    assert.ok(result.divergedAt > 0);
  });

  it("catches a tampered outcome by ignoring it", () => {
    // Editing the claimed score does not change what the log replays to, which
    // is exactly why the server can recompute rather than trust.
    const { replay } = playAndRecord(0x5eed2, 900);
    const lying = decode(encode(replay))!;
    lying.outcome.tally = 999_999;
    const result = verify(lying);
    assert.ok(result.ok, "the log itself is still valid…");
    assert.notEqual(
      result.world.tally,
      lying.outcome.tally,
      "…but the replayed tally exposes the lie",
    );
  });

  it("rejects a replay from a different version", () => {
    const { replay } = playAndRecord(0x1234, 120);
    const text = encode({ ...replay, version: REPLAY_VERSION + 1 });
    assert.equal(decode(text), null);
  });

  it("rejects malformed input without throwing", () => {
    assert.equal(decode("not json"), null);
    assert.equal(decode("null"), null);
    assert.equal(decode("{}"), null);
  });

  it("stays small enough to store per leaderboard entry (§18.3)", () => {
    // Ten minutes of play. §13 estimated tens of KB; hold it to that.
    const { replay } = playAndRecord(0x9999, 60 * 60 * 10);
    const bytes = sizeBytes(replay);
    assert.ok(
      bytes < 512 * 1024,
      `a 10-minute replay should be well under 512KB, got ${(bytes / 1024).toFixed(0)}KB`,
    );
  });
});

describe("profile persistence (pure half)", () => {
  it("tracks bests and reports when one is beaten", async () => {
    const { emptyProfile, recordRun } = await import("../src/host/persist.ts");
    let p = emptyProfile("k");

    let r = recordRun(p, base({ round: 7, tally: 1200 }), 1);
    assert.ok(r.newBestRound && r.newBestTally, "the first run is always a best");
    p = r.profile;
    assert.equal(p.bestRound, 7);
    assert.equal(p.bestTally, 1200);

    r = recordRun(p, base({ round: 4, tally: 4000 }), 2);
    assert.equal(r.newBestRound, false, "round 4 does not beat 7");
    assert.equal(r.newBestTally, true, "but the tally does");
    p = r.profile;
    assert.equal(p.bestRound, 7, "a worse round must not lower the best");
    assert.equal(p.bestTally, 4000);
    assert.equal(p.runsPlayed, 2);
    assert.equal(p.runs[0].round, 4, "most recent run first");
  });

  it("caps the run list", async () => {
    const { MAX_RUNS, emptyProfile, recordRun } = await import("../src/host/persist.ts");
    let p = emptyProfile("k");
    for (let i = 0; i < MAX_RUNS + 8; i++) {
      p = recordRun(p, base({ round: i, tally: i * 10 }), i).profile;
    }
    assert.equal(p.runs.length, MAX_RUNS);
    assert.equal(p.runsPlayed, MAX_RUNS + 8, "the count keeps going past the cap");
    assert.equal(p.runs[0].round, MAX_RUNS + 7, "and the newest is kept");
  });

  it("repairs a damaged or missing blob instead of losing the profile", async () => {
    const { normalize } = await import("../src/host/persist.ts");
    assert.equal(normalize(null, "fallback").playerKey, "fallback");
    assert.equal(normalize("garbage", "fallback").bestRound, 0);
    const partial = normalize({ bestRound: 12 }, "fallback");
    assert.equal(partial.bestRound, 12);
    assert.equal(partial.playerKey, "fallback", "a missing key is minted, not left blank");
    assert.deepEqual(partial.runs, []);
  });
});

function base(over: { round: number; tally: number }) {
  return {
    round: over.round,
    tally: over.tally,
    kills: 0,
    leaks: 0,
    durationMs: 1000,
  };
}

// Keep the type import meaningful to readers of this file.
export type { World };
