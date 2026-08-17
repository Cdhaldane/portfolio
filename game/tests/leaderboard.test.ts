/*
 * tests/leaderboard.test.ts — the game and the server agree about what a run is.
 *
 * `api/_lib/hymn-run.test.js` tests the validator's rules against replays *it builds
 * itself*, which proves the rules are self-consistent and nothing more. The failure
 * that actually threatens this feature is different and quieter: the validator
 * describes `Recorder`, and `Recorder` can change.
 *
 * Bump `HASH_INTERVAL`, take one more fingerprint in `finish()`, add a field to
 * `ReplayOutcome` — and the server starts rejecting every genuine run with a message
 * about checkpoint counts, while both test suites stay green. That is the worst kind
 * of bug: it only appears in production, only for real players, and both halves look
 * correct in isolation.
 *
 * So this file plays actual rounds, records them with the real `Recorder`, and pushes
 * the result through the real validator — loaded across the module-system boundary
 * with `createRequire`, because the sim is ESM TypeScript and the API is CommonJS.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

import { CMD, type Command, type TickInput } from "../src/sim/commands.ts";
import { Recorder, HASH_INTERVAL, REPLAY_VERSION, type Replay } from "../src/sim/replay.ts";
import { tileOf } from "../src/sim/level.ts";
import { SITE } from "../src/sim/sites.ts";
import { step } from "../src/sim/step.ts";
import { createWorld, type World } from "../src/sim/world.ts";

const require_ = createRequire(import.meta.url);
const hymn = require_("../../api/_lib/hymn-run.js") as {
  HASH_INTERVAL: number;
  REPLAY_VERSION: number;
  checkReplayShape: (r: unknown) => string | null;
  validateSubmission: (b: unknown) => { error?: string; run?: Record<string, unknown> };
};

/** Play `seconds` of a real run and hand back what the recorder produced. */
function playedRun(seconds: number, seed = 4242): { world: World; replay: Replay } {
  const w = createWorld(seed, SITE.bootHill);
  w.scrap = 5000;
  // Out of the lane, so the run lasts long enough to be interesting.
  w.player.x = 2;
  w.player.z = 2;
  w.player.px = 2;
  w.player.pz = 2;

  const rec = new Recorder(seed, 0, SITE.bootHill, false);
  const tile = tileOf(w.level, 27, 17);

  for (let t = 0; t < seconds * 60; t++) {
    let cmds: Command[] = [];
    if (t === 2) cmds = [{ t: CMD.selectSlot, slot: 1 }, { t: CMD.place, cell: tile }];
    else if (t === 5) cmds = [{ t: CMD.buildMode, on: false }];
    else if (t === 8) cmds = [{ t: CMD.startWave }];
    else if (t % 37 === 0) cmds = [{ t: CMD.fire }];
    else if (t % 53 === 0) cmds = [{ t: CMD.look, yaw: t * 0.001, pitch: -0.1 }];

    const input: TickInput = { tick: w.tick, playerId: 0, cmds };
    rec.checkpoint(w);
    rec.record(input);
    step(w, input);
    w.events.clear();
  }
  return { world: w, replay: rec.finish(w, seconds * 1000) };
}

describe("the game and the leaderboard agree", () => {
  it("shares its replay constants with the server", () => {
    // The two live in different languages and module systems and cannot import each
    // other, so the only thing keeping them equal is this assertion.
    assert.equal(hymn.REPLAY_VERSION, REPLAY_VERSION, "REPLAY_VERSION has drifted");
    assert.equal(hymn.HASH_INTERVAL, HASH_INTERVAL, "HASH_INTERVAL has drifted");
  });

  it("accepts a genuine recorded run", () => {
    const { replay } = playedRun(120);
    assert.equal(
      hymn.checkReplayShape(replay),
      null,
      "the server rejected a replay its own recorder produced",
    );

    const { error, run } = hymn.validateSubmission({
      playerKey: "gh-test-key",
      name: "Amos",
      replay,
    });
    assert.equal(error, undefined, `a real run was refused: ${error}`);
    assert.ok(run);
    assert.equal(run.round, replay.outcome.round);
    assert.equal(run.seed, replay.seed);
    assert.equal(run.ticks, replay.ticks);
  });

  it("accepts runs of very different lengths", () => {
    /*
     * The checkpoint-count rule is exact, so it is most likely to be wrong at the
     * boundaries — a run that ends exactly on a checkpoint tick, and one that ends
     * one tick after.
     */
    for (const seconds of [1, 9, 10, 11, 60, 240]) {
      const { replay } = playedRun(seconds);
      assert.equal(
        hymn.checkReplayShape(replay),
        null,
        `a ${seconds}s run (${replay.ticks} ticks, ${replay.hashes.length} checkpoints) was refused`,
      );
    }
  });

  it("refuses a run whose claimed round has been edited upward", () => {
    // The forgery the structural checks exist to make expensive.
    const { replay } = playedRun(30);
    const tampered = { ...replay, outcome: { ...replay.outcome, round: 200 } };
    const { error } = hymn.validateSubmission({
      playerKey: "gh-test-key",
      name: "Amos",
      replay: tampered,
    });
    assert.match(String(error), /not possible/, "an inflated round was accepted");
  });

  it("refuses a run whose command log has been padded", () => {
    const { replay } = playedRun(30);
    const tampered = {
      ...replay,
      cmds: [...replay.cmds, [replay.ticks + 500, [{ t: CMD.fire }]]],
    };
    assert.match(
      String(hymn.checkReplayShape(tampered)),
      /outside the run/,
      "a command after the end of the run was accepted",
    );
  });

  it("produces a replay small enough to store", () => {
    // The board keeps one replay per player, so size is a storage decision, not just
    // a bandwidth one.
    const { replay } = playedRun(240);
    const bytes = JSON.stringify(replay).length;
    assert.ok(bytes < 60_000, `four minutes of play encodes to ${bytes} bytes`);
  });
});
