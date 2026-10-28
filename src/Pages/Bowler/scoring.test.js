import {
  addRoll,
  checkFrame,
  checkGame,
  frameMarks,
  isSplit,
  maxScore,
  nextRoll,
  scoreGame,
  undoRoll,
} from "./scoring";

// Build count-only frames from scoreboard marks, one token per frame:
//   G("X 7/ 9- X -8 8/ -6 X X X81")
function G(line) {
  return line.split(" ").map((token) => {
    let rack = 10;
    const rolls = [...token].map((c) => {
      const down = c === "X" ? 10 : c === "/" ? rack : c === "-" ? 0 : Number(c);
      rack = rack - down === 0 ? 10 : rack - down;
      return down;
    });
    return { rolls, standing: null };
  });
}

const score = (line) => scoreGame(G(line));

describe("scoreGame", () => {
  test("a perfect game is 300, thirty a frame", () => {
    const s = score("X X X X X X X X X XXX");
    expect(s.total).toBe(300);
    expect(s.complete).toBe(true);
    expect(s.running).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  });

  test("all gutters is 0", () => {
    expect(score("-- -- -- -- -- -- -- -- -- --")).toMatchObject({ total: 0, complete: true });
  });

  test("all spares", () => {
    expect(score("5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/ 5/5").total).toBe(150);
    expect(score("9/ 9/ 9/ 9/ 9/ 9/ 9/ 9/ 9/ 9/9").total).toBe(190);
    expect(score("-/ -/ -/ -/ -/ -/ -/ -/ -/ -/-").total).toBe(100);
  });

  test("all nines, no marks", () => {
    expect(score("9- 9- 9- 9- 9- 9- 9- 9- 9- 9-").total).toBe(90);
  });

  test("a mixed game frame by frame", () => {
    expect(score("X 7/ 9- X -8 8/ -6 X X X81").running).toEqual([
      20, 39, 48, 66, 74, 84, 90, 120, 148, 167,
    ]);
  });

  test.each([
    ["XXX", 30],
    ["XX7", 27],
    ["X7/", 20],
    ["X72", 19],
    ["X--", 10],
    ["7/X", 20],
    ["7/5", 15],
    ["-/-", 10],
    ["72", 9],
    ["--", 0],
  ])("10th frame %s scores %i on its own", (tenth, expected) => {
    const s = score(`-- -- -- -- -- -- -- -- -- ${tenth}`);
    expect(s.total).toBe(expected);
    expect(s.complete).toBe(true);
  });

  test("a 9th-frame strike takes its bonus from the 10th", () => {
    expect(score("-- -- -- -- -- -- -- -- X X72").running.slice(-2)).toEqual([27, 46]);
    expect(score("-- -- -- -- -- -- -- -- X 7/X").running.slice(-2)).toEqual([20, 40]);
  });

  test("an unfinished game knows what it can and can't score yet", () => {
    expect(score("X X 5")).toMatchObject({ running: [25, null, null], total: 25, complete: false });
    expect(score("9- 7/")).toMatchObject({ running: [9, null], total: 9 });
    expect(scoreGame([])).toMatchObject({ running: [], total: 0, complete: false });
  });
});

describe("checkGame", () => {
  test("accepts a complete game with pins and details", () => {
    const frames = G("X X X X X X X X X XXX");
    frames[0] = { rolls: [7, 2], standing: [[10, 3, 6], [10]], target: 12, actual: 10, pocket: false };
    const r = checkGame(frames);
    expect(r.ok).toBe(true);
    expect(r.value[0]).toEqual({
      rolls: [7, 2],
      standing: [[3, 6, 10], [10]],
      target: 12,
      actual: 10,
      pocket: false,
    });
  });

  test.each([
    ["more than 10 pins in a frame", G("75 -- -- -- -- -- -- -- -- --")],
    ["a ball after a strike in frames 1-9", [{ rolls: [10, 0] }, ...G("-- -- -- -- -- -- -- -- --")]],
    ["a third ball in an open 10th", G("-- -- -- -- -- -- -- -- -- 721")],
    ["more pins than the 10th's leftover rack", [...G("-- -- -- -- -- -- -- -- --"), { rolls: [10, 7, 5] }]],
    ["eleven frames", G("-- -- -- -- -- -- -- -- -- -- --")],
    ["nine frames", G("-- -- -- -- -- -- -- -- --")],
    ["a missing fill ball", G("-- -- -- -- -- -- -- -- -- X7")],
    ["an unfinished middle frame", [{ rolls: [7] }, ...G("-- -- -- -- -- -- -- -- --")]],
    ["a negative roll", [{ rolls: [-1, 0] }, ...G("-- -- -- -- -- -- -- -- --")]],
    ["a fractional roll", [{ rolls: [4.5, 0] }, ...G("-- -- -- -- -- -- -- -- --")]],
    ["not a list", "XXXXXXXXXXXX"],
  ])("rejects %s", (_label, frames) => {
    const r = checkGame(frames);
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe("string");
  });

  test("allows an unfinished last frame only as a draft", () => {
    const draft = [...G("X 7/"), { rolls: [8], standing: null }];
    expect(checkGame(draft, { partial: true }).ok).toBe(true);
    expect(checkGame(draft).ok).toBe(false);
    expect(checkGame([{ rolls: [8] }, ...G("X")], { partial: true }).ok).toBe(false);
  });
});

describe("checkFrame pin rules", () => {
  test("standing pins must match the count", () => {
    expect(checkFrame({ rolls: [7, 2], standing: [[3, 6], [10]] }, 0).ok).toBe(false);
  });

  test("a second ball can't knock down a pin that was already down", () => {
    // 7 left the 3-6-10; the 1 pin can't be "standing" after ball two.
    const r = checkFrame({ rolls: [7, 2], standing: [[3, 6, 10], [1]] }, 0);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already down/);
  });

  test("the 10th re-racks after a strike, so any pin can stand again", () => {
    expect(checkFrame({ rolls: [10, 9, 1], standing: [[], [7], []] }, 9).ok).toBe(true);
  });

  test.each([
    ["pin 11", [[11, 3, 6], [10]]],
    ["pin 0", [[0, 3, 6], [10]]],
    ["a pin twice", [[3, 3, 6], [3]]],
    ["one list short", [[3, 6, 10]]],
  ])("rejects %s", (_label, standing) => {
    expect(checkFrame({ rolls: [7, 2], standing }, 0).ok).toBe(false);
  });

  test("boards are 1-39", () => {
    expect(checkFrame({ rolls: [10], target: 40 }, 0).ok).toBe(false);
    expect(checkFrame({ rolls: [10], actual: 0 }, 0).ok).toBe(false);
    expect(checkFrame({ rolls: [10], target: "15", actual: "" }, 0).value).toEqual({
      rolls: [10],
      standing: null,
      target: 15,
    });
  });
});

describe("isSplit", () => {
  test.each([
    [[7, 10]],
    [[4, 6]],
    [[4, 6, 7, 10]],
    [[4, 7, 10]],
    [[6, 7, 10]],
    [[2, 7]],
    [[3, 10]],
    [[5, 7]],
    [[5, 10]],
    [[8, 10]],
    [[4, 5]],
    [[5, 6]],
    [[7, 9]],
    [[2, 10]],
    [[3, 7]],
  ])("%j is a split", (pins) => {
    expect(isSplit(pins)).toBe(true);
  });

  test.each([
    [[10]],
    [[7]],
    [[2, 8]],
    [[3, 9]],
    [[6, 10]],
    [[3, 6, 10]],
    [[2, 4, 5, 8]],
    [[3, 5, 6, 9]],
    [[4, 7]],
    [[1, 2, 4, 10]], // washout: head pin still up
    [[1, 7, 10]],
    [[]],
    [null],
  ])("%j is not", (pins) => {
    expect(isSplit(pins)).toBe(false);
  });
});

describe("frameMarks", () => {
  test("marks strikes, spares, misses and splits", () => {
    expect(frameMarks({ rolls: [10], standing: [[]] }, 0)).toEqual([{ mark: "X", split: false }]);
    expect(frameMarks({ rolls: [8, 2], standing: [[7, 10], []] }, 0)).toEqual([
      { mark: "8", split: true },
      { mark: "/", split: false },
    ]);
    expect(frameMarks({ rolls: [0, 9], standing: null }, 0).map((m) => m.mark)).toEqual(["-", "9"]);
    expect(frameMarks({ rolls: [10, 10, 7], standing: null }, 9).map((m) => m.mark)).toEqual(["X", "X", "7"]);
    expect(frameMarks({ rolls: [7, 3, 10], standing: null }, 9).map((m) => m.mark)).toEqual(["7", "/", "X"]);
    // Ten down on the second ball after a gutter is a spare, not a strike.
    expect(frameMarks({ rolls: [0, 10], standing: null }, 0).map((m) => m.mark)).toEqual(["-", "/"]);
    expect(frameMarks({ rolls: [0, 10, 10], standing: null }, 9).map((m) => m.mark)).toEqual(["-", "/", "X"]);
  });
});

describe("entry helpers", () => {
  test("pins left drive the game forward ball by ball", () => {
    let game = [];
    expect(nextRoll(game)).toMatchObject({ frame: 0, roll: 0, rack: { count: 10 } });
    game = addRoll(game, []).value; // strike
    expect(nextRoll(game)).toMatchObject({ frame: 1, roll: 0 });
    game = addRoll(game, [10, 3, 6]).value; // leaves the 3-6-10
    expect(nextRoll(game)).toMatchObject({ frame: 1, roll: 1, rack: { count: 3, pins: [3, 6, 10] } });
    game = addRoll(game, [10]).value;
    expect(game[1]).toEqual({ rolls: [7, 2], standing: [[3, 6, 10], [10]] });
    expect(scoreGame(game).running).toEqual([19, 28]);
  });

  test("rejects a ball that leaves a pin already down", () => {
    const game = addRoll([], [3, 6, 10]).value;
    expect(addRoll(game, [1]).ok).toBe(false);
  });

  test("the 10th takes three balls after a strike and stops after an open", () => {
    let game = G("-- -- -- -- -- -- -- -- --").map((f) => ({ rolls: f.rolls, standing: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]] }));
    expect(checkGame(game, { partial: true }).ok).toBe(true);
    const open = addRoll(addRoll(game, [7]).value, [7]).value;
    expect(nextRoll(open)).toBeNull();
    let strike = addRoll(game, []).value;
    strike = addRoll(strike, [4, 7, 10]).value;
    expect(nextRoll(strike)).toMatchObject({ frame: 9, roll: 2, rack: { count: 3 } });
    strike = addRoll(strike, []).value;
    expect(nextRoll(strike)).toBeNull();
    expect(scoreGame(strike)).toMatchObject({ total: 20, complete: true });
    expect(addRoll(strike, []).ok).toBe(false);
  });

  test("undo takes back one ball at a time", () => {
    const game = addRoll(addRoll([], [10]).value, []).value;
    expect(undoRoll(game)).toEqual([{ rolls: [9], standing: [[10]] }]);
    expect(undoRoll(undoRoll(game))).toEqual([]);
    expect(undoRoll([])).toEqual([]);
  });

  test("maxScore assumes every ball left is a strike or spare", () => {
    expect(maxScore([])).toBe(300);
    expect(maxScore(G("9-"))).toBe(279);
    expect(maxScore(G("9"))).toBe(290);
    expect(maxScore(G("X X X X X X X X X XXX"))).toBe(300);
  });
});

// The API requires this file as-is and the page bundles it, so a Babel
// helper import injected into a CommonJS file would break the build at
// runtime. Run the same preset the production build does and make sure
// nothing gets pulled in.
test("the production build compiles scoring.js without helper imports", () => {
  const babel = require("@babel/core");
  const saved = { babel: process.env.BABEL_ENV, browsers: process.env.BROWSERSLIST_ENV };
  process.env.BABEL_ENV = "production";
  process.env.BROWSERSLIST_ENV = "production";
  try {
    const { code } = babel.transformFileSync(require.resolve("./scoring"), {
      babelrc: false,
      configFile: false,
      caller: { name: "babel-loader", supportsStaticESM: true, supportsDynamicImport: true },
      presets: [[require.resolve("babel-preset-react-app"), { runtime: "automatic" }]],
    });
    expect(code).not.toMatch(/@babel\/runtime|^\s*import\s/m);
    expect(code).toMatch(/module\.exports/);
  } finally {
    const restore = (key, value) =>
      value === undefined ? delete process.env[key] : (process.env[key] = value);
    restore("BABEL_ENV", saved.babel);
    restore("BROWSERSLIST_ENV", saved.browsers);
  }
});
