import { PHASE, gameReducer, initGame, initHistory, withHistory } from "./gameReducer";
import { publicView } from "./publicView";

/** Deep-freeze so any in-place mutation inside the reducer throws. */
const freeze = (obj) => {
  Object.values(obj).forEach((v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v);
  });
  return Object.freeze(obj);
};

const run = (state, ...actions) => actions.reduce((s, a) => gameReducer(freeze(s), a), state);

const cell = (value, extra = {}) => ({ q: `Clue ${value}`, a: `Answer ${value}`, value, dd: false, used: false, ...extra });

// Two tiny boards: 2 categories x 2 clues. Board 1's (1,1) is a Daily Double.
const BOARDS = [
  { cats: [
    { id: "a", name: "Alpha", hint: "", clues: [cell(200), cell(400)] },
    { id: "b", name: "Bravo", hint: "", clues: [cell(200), cell(400, { dd: true })] },
  ] },
  { cats: [
    { id: "c", name: "Charlie", hint: "", clues: [cell(400), cell(800)] },
    { id: "d", name: "Delta", hint: "", clues: [cell(400), cell(800)] },
  ] },
];
const FINAL = { cat: "Finale", q: "Last clue", a: "Last answer" };
const PLAYERS = [
  { id: "p1", name: "Dana" },
  { id: "p2", name: "Sam", phone: true },
  { id: "p3", name: "Rio" },
];

const startAction = (settings = {}) => ({
  type: "START",
  players: PLAYERS,
  settings,
  boards: BOARDS,
  finalClue: FINAL,
  starter: "p1",
});

const started = (settings) => run(initGame(), startAction(settings));
const score = (state, pid) => state.players.find((p) => p.id === pid).score;

test("START deals the board and hands control to the starter", () => {
  const s = started();
  expect(s.phase).toBe(PHASE.BOARD);
  expect(s.control).toBe("p1");
  expect(s.players.map((p) => p.score)).toEqual([0, 0, 0]);
  expect(s.players[1].phone).toBe(true);
});

test("a correct answer scores, takes control and burns the cell", () => {
  const s = run(
    started(),
    { type: "PICK", col: 0, row: 1 },
    { type: "BUZZ_IN", pid: "p2" },
    { type: "JUDGE", correct: true }
  );
  expect(score(s, "p2")).toBe(400);
  expect(s.control).toBe("p2");
  expect(s.callout).toMatchObject({ kind: "score", pid: "p2", points: 400 });
  const back = run(s, { type: "CLOSE_CLUE" });
  expect(back.phase).toBe(PHASE.BOARD);
  expect(back.boards[0].cats[0].clues[1].used).toBe(true);
  expect(run(back, { type: "PICK", col: 0, row: 1 })).toBe(back); // used cells are dead
});

test("a wrong answer costs points, pours sips and locks the player out", () => {
  const s = run(
    started(),
    { type: "PICK", col: 0, row: 0 },
    { type: "BUZZ_IN", pid: "p1" },
    { type: "JUDGE", correct: false }
  );
  expect(score(s, "p1")).toBe(-200);
  expect(s.callout).toMatchObject({ kind: "drink", pid: "p1", sips: 1 });
  expect(s.clue.locked).toEqual(["p1"]);
  expect(s.clue.resolved).toBeNull();
  expect(run(s, { type: "BUZZ_IN", pid: "p1" })).toBe(s);
});

test("with phones, a wrong answer re-arms the buzzers on a fresh window", () => {
  const s = run(started({ phones: true }), { type: "PICK", col: 0, row: 0 }, { type: "OPEN_BUZZ" });
  expect(s.clue.buzzOpen).toBe(true);
  const seq = s.buzzSeq;
  const after = run(s, { type: "BUZZ_IN", pid: "p2" }, { type: "JUDGE", correct: false });
  expect(after.clue.buzzOpen).toBe(true);
  expect(after.buzzSeq).toBe(seq + 1);
});

test("everyone wrong ends the clue as stumped", () => {
  const s = run(
    started(),
    { type: "PICK", col: 0, row: 0 },
    ...["p1", "p2", "p3"].flatMap((pid) => [{ type: "BUZZ_IN", pid }, { type: "JUDGE", correct: false }])
  );
  expect(s.clue.resolved).toBe("stumped");
});

test("NOBODY reveals and makes everyone sip", () => {
  const s = run(started(), { type: "PICK", col: 1, row: 0 }, { type: "NOBODY" });
  expect(s.clue.resolved).toBe("nobody");
  expect(s.callout).toMatchObject({ kind: "everyone", sips: 1 });
});

test("Daily Double Shot: wager, solo answer, hand out sips on a win", () => {
  let s = run(started(), { type: "PICK", col: 1, row: 1 });
  expect(s.phase).toBe(PHASE.WAGER);
  expect(s.clue.answering).toBe("p1");
  s = run(s, { type: "DD_PLAYER", pid: "p3" }, { type: "WAGER", amount: 99999 });
  expect(s.phase).toBe(PHASE.CLUE);
  expect(s.clue.wager).toBe(1000); // broke players can bet up to the round's top value
  expect(run(s, { type: "BUZZ_IN", pid: "p2" })).toBe(s); // nobody else can jump in
  s = run(s, { type: "JUDGE", correct: true });
  expect(score(s, "p3")).toBe(1000);
  expect(s.callout).toMatchObject({ kind: "give", pid: "p3", sips: 3 });
});

test("Daily Double Shot: blow it and take a shot", () => {
  const s = run(
    started(),
    { type: "PICK", col: 1, row: 1 },
    { type: "WAGER", amount: 500 },
    { type: "JUDGE", correct: false }
  );
  expect(score(s, "p1")).toBe(-500);
  expect(s.callout).toMatchObject({ kind: "shot", pid: "p1" });
});

const clearBoard = (state) =>
  [[0, 0], [0, 1], [1, 0], [1, 1]].reduce((s, [col, row]) => {
    const picked = run(s, { type: "PICK", col, row });
    const ready = picked.phase === PHASE.WAGER ? run(picked, { type: "WAGER", amount: 0 }) : picked;
    return run(ready, { type: "NOBODY" }, { type: "CLOSE_CLUE" });
  }, state);

test("clearing the board breaks, and the trailing player picks first in round 2", () => {
  const scored = run(
    started(),
    { type: "PICK", col: 0, row: 0 },
    { type: "BUZZ_IN", pid: "p3" },
    { type: "JUDGE", correct: false },
    { type: "NOBODY" },
    { type: "CLOSE_CLUE" }
  );
  const s = clearBoard(scored);
  expect(s.phase).toBe(PHASE.BREAK);
  const r2 = run(s, { type: "NEXT_ROUND" });
  expect(r2.round).toBe(1);
  expect(r2.control).toBe("p3");
});

test("Last Call: wagers clamp, phones fill in, judging settles scores", () => {
  let s = started({ rounds: 1 });
  s = { ...s, boards: [BOARDS[0]], players: s.players.map((p) => ({ ...p, score: 1000 })) };
  s = run(clearBoard(s), { type: "NEXT_ROUND" });
  expect(s.phase).toBe(PHASE.LC_WAGER);
  s = run(
    s,
    { type: "LC_WAGER", pid: "p1", amount: 5000 },
    { type: "LC_SYNC", finals: { p2: { wager: 300, answer: null }, ghost: { wager: 1 } } }
  );
  expect(s.lc.wagers).toEqual({ p1: 1000, p2: 300 });
  s = run(s, { type: "LC_REVEAL" }, { type: "LC_SYNC", finals: { p2: { wager: 999, answer: "Last answer" } } });
  expect(s.lc.wagers.p2).toBe(300); // wagers lock once the clue is out
  expect(s.lc.answers.p2).toBe("Last answer");
  s = run(
    s,
    { type: "LC_TO_JUDGE" },
    { type: "LC_JUDGE", pid: "p1", correct: false },
    { type: "LC_JUDGE", pid: "p2", correct: true }
  );
  expect(score(s, "p1")).toBe(0);
  expect(score(s, "p2")).toBe(1300);
  expect(run(s, { type: "LC_JUDGE", pid: "p2", correct: true })).toBe(s); // judged once
  expect(run(s, { type: "FINISH" }).phase).toBe(PHASE.OVER);
});

test("players who join mid-game are added once, with phones", () => {
  const p = { id: "p9", name: "Late Larry" };
  const s = run(started(), { type: "ADD_PLAYER", player: p }, { type: "ADD_PLAYER", player: p });
  expect(s.players.filter((x) => x.id === "p9")).toHaveLength(1);
  expect(s.players.at(-1).phone).toBe(true);
});

test("REMATCH keeps the crew and zeroes the scores", () => {
  const s = run(started(), { type: "PICK", col: 0, row: 0 }, { type: "BUZZ_IN", pid: "p2" }, { type: "JUDGE", correct: true });
  const again = run(s, { type: "REMATCH", boards: BOARDS, finalClue: FINAL, starter: "p3" });
  expect(again.players.map((p) => p.score)).toEqual([0, 0, 0]);
  expect(again.control).toBe("p3");
  expect(again.callout).toBeNull();
});

describe("undo", () => {
  const step = (h, ...actions) => actions.reduce(withHistory, h);

  test("undo rewinds a misjudged answer", () => {
    let h = step(initHistory(), startAction(), { type: "PICK", col: 0, row: 0 }, { type: "BUZZ_IN", pid: "p1" });
    h = step(h, { type: "JUDGE", correct: false });
    expect(score(h.present, "p1")).toBe(-200);
    h = step(h, { type: "UNDO" }, { type: "JUDGE", correct: true });
    expect(score(h.present, "p1")).toBe(200);
  });

  test("joins survive an undo and counters never go backwards", () => {
    let h = step(initHistory(), startAction({ phones: true }), { type: "PICK", col: 0, row: 0 }, { type: "OPEN_BUZZ" });
    const openSeq = h.present.buzzSeq;
    h = step(h, { type: "BUZZ_IN", pid: "p2" }, { type: "ADD_PLAYER", player: { id: "p9", name: "Late" } });
    h = step(h, { type: "UNDO" });
    expect(h.present.clue.buzzOpen).toBe(true);
    expect(h.present.buzzSeq).toBeGreaterThan(openSeq); // a fresh window, old buzzes don't count
    expect(h.present.players.some((p) => p.id === "p9")).toBe(true);
  });

  test("nothing to undo right after START", () => {
    const h = step(initHistory(), startAction());
    expect(step(h, { type: "UNDO" })).toBe(h);
  });
});

describe("publicView", () => {
  test("the lobby says nothing", () => {
    expect(publicView(initGame())).toEqual({ phase: "lobby" });
  });

  test("clue text never leaves the host; the answer only once resolved", () => {
    const live = run(started(), { type: "PICK", col: 0, row: 1 });
    const view = publicView(live);
    expect(JSON.stringify(view)).not.toContain("Clue 400");
    expect(view.clue).toMatchObject({ cat: "Alpha", value: 400, answer: null });
    expect(view.board[0].cells[1]).toEqual({ value: 400, used: false });
    const done = run(live, { type: "NOBODY" });
    expect(publicView(done).clue.answer).toBe("Answer 400");
  });

  test("Last Call hides who wagered what", () => {
    let s = started({ rounds: 1 });
    s = run(clearBoard({ ...s, boards: [BOARDS[0]] }), { type: "NEXT_ROUND" }, { type: "LC_WAGER", pid: "p1", amount: 0 });
    const view = publicView(s);
    expect(view.lastCall).toMatchObject({ cat: "Finale", wagered: ["p1"], answer: null });
    expect(JSON.stringify(view)).not.toContain("Last clue");
  });
});
