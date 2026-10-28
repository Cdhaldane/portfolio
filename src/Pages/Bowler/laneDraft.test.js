import {
  blankDraft,
  draftFromNight,
  draftStarted,
  draftToSave,
  gameDone,
  gameTotal,
  withDefaultBalls,
} from "./laneDraft";

const strikes = Array.from({ length: 9 }, () => ({ rolls: [10], standing: [[]] }));
const PERFECT = [...strikes, { rolls: [10, 10, 10], standing: [[], [], []] }];

const withGames = (draft, bowler, games) => ({
  ...draft,
  bowlers: {
    ...draft.bowlers,
    [bowler]: { games: draft.bowlers[bowler].games.map((g, i) => ({ ...g, ...games[i] })) },
  },
});

test("a blank draft isn't started and can't be saved", () => {
  const d = blankDraft("2026-10-27");
  expect(draftStarted(d)).toBe(false);
  expect(draftToSave(d)).toEqual({ ok: false, error: "Nothing bowled yet." });
});

test("a bowler who started needs all three games", () => {
  const d = withGames(blankDraft("2026-10-27"), "cha", [{ frames: PERFECT }, { frames: strikes.slice(0, 4) }, {}]);
  expect(draftStarted(d)).toBe(true);
  expect(draftToSave(d).error).toBe("Charlie's game 2 isn't finished yet.");

  const two = withGames(d, "cha", [{}, { frames: PERFECT }, {}]);
  expect(draftToSave(two).error).toBe("Charlie still has game 3 to bowl.");

  const typed = withGames(two, "cha", [{}, {}, { mode: "score", score: "301" }]);
  expect(draftToSave(typed).error).toMatch(/game 3 needs a score/);
});

test("a finished night becomes the API's save request", () => {
  const d = withGames(blankDraft("2026-10-27"), "cha", [
    { frames: PERFECT, lanes: "13", ball: "4" },
    { mode: "score", score: "187", lanes: "15" },
    { frames: PERFECT },
  ]);
  const r = draftToSave({ ...d, note: "league week 9" });
  expect(r.ok).toBe(true);
  expect(r.value).toEqual({
    bowledOn: "2026-10-27",
    note: "league week 9",
    source: "lane",
    entries: [
      {
        bowler: "cha",
        games: [300, 187, 300],
        frames: [PERFECT, null, PERFECT],
        lanes: [13, 15, null],
        balls: [4, null, null],
      },
    ],
  });
});

test("game totals and done-ness for the tabs", () => {
  expect(gameTotal({ mode: "frames", frames: [] })).toBeNull();
  expect(gameTotal({ mode: "frames", frames: strikes.slice(0, 3) })).toBe(30);
  expect(gameTotal({ mode: "score", score: "212" })).toBe(212);
  expect(gameDone({ mode: "frames", frames: PERFECT })).toBe(true);
  expect(gameDone({ mode: "frames", frames: strikes })).toBe(false);
  expect(gameDone({ mode: "score", score: "" })).toBe(false);
});

test("a saved night comes back as an editable draft", () => {
  const rows = {
    cha: {
      games: [300, 150, 160],
      frames: [PERFECT, null, null],
      lanes: [13, 13, null],
      balls: [4, 4, null],
      note: "new ball",
    },
    van: null,
  };
  const d = draftFromNight("2026-10-20", rows);
  expect(d.active).toEqual({ bowler: "cha", game: 0 });
  expect(d.note).toBe("new ball");
  expect(d.bowlers.cha.games[0]).toEqual({ mode: "frames", frames: PERFECT, score: "", lanes: "13", ball: "4" });
  expect(d.bowlers.cha.games[1]).toEqual({ mode: "score", frames: [], score: "150", lanes: "13", ball: "4" });
  expect(draftStarted(d)).toBe(true);
  expect(draftToSave(d).value.entries.map((e) => e.games)).toEqual([[300, 150, 160]]);
});

test("rows from before frames existed load as typed scores", () => {
  const d = draftFromNight("2026-09-01", { cha: { games: [150, 160, 170], balls: [null, null, null] }, van: null });
  expect(d.bowlers.cha.games.map((g) => g.mode)).toEqual(["score", "score", "score"]);
});

test("usual balls fill only untouched games", () => {
  const d = withGames(blankDraft("2026-10-27"), "cha", [{ frames: strikes.slice(0, 1) }, {}, { ball: "9" }]);
  const filled = withDefaultBalls(d, { cha: 4, van: null });
  expect(filled.bowlers.cha.games.map((g) => g.ball)).toEqual(["", "4", "9"]);
  expect(filled.bowlers.van).toBe(d.bowlers.van);
  expect(withDefaultBalls(filled, { cha: 4 })).toBe(filled);
});
