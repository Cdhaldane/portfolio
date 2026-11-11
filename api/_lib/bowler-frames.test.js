// The overhead-screen read: printed marks → count-only frames.
const test = require("node:test");
const assert = require("node:assert/strict");
const { marksToFrame, sanitizeFrames } = require("./bowler-normalize");

const f = (...marks) => ({ marks, running: null });

test("marksToFrame turns printed marks into pin counts", () => {
  assert.deepEqual(marksToFrame(["X"]), { rolls: [10], standing: null });
  assert.deepEqual(marksToFrame(["7", "/"]), { rolls: [7, 3], standing: null });
  assert.deepEqual(marksToFrame(["-", "/"]), { rolls: [0, 10], standing: null });
  assert.deepEqual(marksToFrame(["G", "X"]), { rolls: [0, 10], standing: null }); // X after a gutter is a spare
  assert.deepEqual(marksToFrame(["F", "8"]), { rolls: [0, 8], standing: null });
  assert.deepEqual(marksToFrame(["X", "X", "X"]), { rolls: [10, 10, 10], standing: null });
  assert.deepEqual(marksToFrame(["9", "/", "X"]), { rolls: [9, 1, 10], standing: null });
  assert.deepEqual(marksToFrame(["x", " 8 ", "-"]), { rolls: [10, 8, 0], standing: null });
});

test("marksToFrame refuses marks no frame could have", () => {
  assert.equal(marksToFrame(["/"]), null); // spare on the first ball
  assert.equal(marksToFrame(["7", "X"]), null); // strike at a 3-pin rack
  assert.equal(marksToFrame(["7", "5"]), null); // 12 pins
  assert.equal(marksToFrame(["?"]), null);
  assert.equal(marksToFrame([]), null);
  assert.equal(marksToFrame("X"), null);
});

test("sanitizeFrames scores a full game and checks the screen's own totals", () => {
  const frames = [
    f("X"), f("7", "/"), f("9", "-"), f("X"), f("X"),
    f("8", "1"), f("-", "/"), f("X"), f("6", "3"), f("X", "9", "/"),
  ];
  const running = [20, 39, 48, 76, 95, 104, 124, 143, 152, 172];
  frames.forEach((fr, i) => (fr.running = running[i]));
  const r = sanitizeFrames({ bowlers: [{ name: "CHARLIE H", frames, total: 172 }] });
  assert.equal(r.readable, true);
  const [cha] = r.bowlers;
  assert.equal(cha.key, "cha");
  assert.equal(cha.frames.length, 10);
  assert.equal(cha.score, 172);
  assert.equal(cha.complete, true);
  assert.equal(cha.mismatch, false);
  assert.equal(cha.problem, null);
  assert.ok(cha.frames.every((fr) => fr.standing === null));
});

test("sanitizeFrames flags a read whose running totals disagree", () => {
  const frames = [f("X"), f("7", "2"), f("8", "1")];
  frames[0].running = 19;
  frames[1].running = 29; // really 28
  const r = sanitizeFrames({ bowlers: [{ name: "Vanessa", frames, total: null }] });
  assert.equal(r.bowlers[0].mismatch, true);
  assert.equal(r.bowlers[0].score, 37);
  assert.equal(r.bowlers[0].complete, false);
});

test("a complete game whose printed total disagrees is flagged too", () => {
  const frames = Array.from({ length: 9 }, () => f("X")).concat([f("X", "X", "X")]);
  const r = sanitizeFrames({ bowlers: [{ name: "Charlie", frames, total: 290 }] });
  assert.equal(r.bowlers[0].score, 300);
  assert.equal(r.bowlers[0].mismatch, true);
});

test("sanitizeFrames keeps finished frames and stops at trouble", () => {
  const midGame = sanitizeFrames({
    bowlers: [{ name: "Vanessa", frames: [f("9", "/"), f("X"), f("7")], total: null }],
  });
  assert.equal(midGame.bowlers[0].frames.length, 2); // frame 3 is still being bowled
  assert.equal(midGame.bowlers[0].problem, null);

  const unbowled = sanitizeFrames({
    bowlers: [{ name: "Vanessa", frames: [f("9", "/"), { marks: [], running: null }], total: null }],
  });
  assert.equal(unbowled.bowlers[0].frames.length, 1);
  assert.equal(unbowled.bowlers[0].problem, null);

  const garbled = sanitizeFrames({
    bowlers: [{ name: "Charlie", frames: [f("9", "/"), f("8", "5"), f("X")], total: null }],
  });
  assert.equal(garbled.bowlers[0].frames.length, 1);
  assert.match(garbled.bowlers[0].problem, /Frame 2/);

  const skipped = sanitizeFrames({
    bowlers: [{ name: "Charlie", frames: [f("9", "/"), f("8"), f("X")], total: null }],
  });
  assert.equal(skipped.bowlers[0].frames.length, 1);
  assert.match(skipped.bowlers[0].problem, /Frame 2 looks unfinished/);

  const nothing = sanitizeFrames({ bowlers: [{ name: "Guest", frames: [f("/")], total: null }] });
  assert.equal(nothing.readable, false);
  assert.equal(nothing.bowlers[0].key, null);
  assert.deepEqual(sanitizeFrames(null), { bowlers: [], readable: false });
});
