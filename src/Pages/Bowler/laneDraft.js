// The night being bowled on the lane screen, kept on the phone between
// balls. One draft at a time in localStorage, rewritten after every ball,
// so a closed app, a dead tab or no signal at the alley loses nothing; it
// only goes to the server once the games are done.
//
// Per bowler, per game (strings are form values, "" = blank):
//   { mode: "frames" | "score", frames: Frame[], score: "", lanes: "", ball: "" }
import { BOWLERS, GAMES, MAX_GAME } from "./bowlers";
import { checkGame, scoreGame } from "./scoring";

const KEY = "bowler-lane-v1";

export const blankGame = (ball = null) => ({
  mode: "frames",
  frames: [],
  score: "",
  lanes: "",
  ball: ball ? String(ball) : "",
});

export const blankDraft = (bowledOn, lastBalls = {}) => ({
  bowledOn,
  note: "",
  active: { bowler: BOWLERS[0].key, game: 0 },
  bowlers: Object.fromEntries(
    BOWLERS.map(({ key }) => [
      key,
      { games: Array.from({ length: GAMES }, () => blankGame(lastBalls[key])) },
    ])
  ),
});

export const gameStarted = (g) => g.frames.length > 0 || g.score !== "";
export const bowlerStarted = (draft, key) => draft.bowlers[key].games.some(gameStarted);
export const draftStarted = (draft) => BOWLERS.some(({ key }) => bowlerStarted(draft, key));

const validScore = (v) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= MAX_GAME;

/** A game's score so far (null before the first ball / without a score). */
export function gameTotal(game) {
  if (game.mode === "score") return validScore(game.score) ? Number(game.score) : null;
  return game.frames.length ? scoreGame(game.frames).total : null;
}

export const gameDone = (game) =>
  game.mode === "score" ? validScore(game.score) : checkGame(game.frames).ok;

// Anything that doesn't look like a draft (old shape, hand-edited storage)
// is dropped rather than half-trusted.
function looksRight(d) {
  return (
    d &&
    typeof d.bowledOn === "string" &&
    d.active &&
    BOWLERS.every(({ key }) => {
      const b = d.bowlers && d.bowlers[key];
      return (
        b &&
        Array.isArray(b.games) &&
        b.games.length === GAMES &&
        b.games.every((g) => g && Array.isArray(g.frames) && checkGame(g.frames, { partial: true }).ok)
      );
    })
  );
}

export function loadDraft() {
  try {
    const d = JSON.parse(window.localStorage.getItem(KEY));
    return looksRight(d) ? d : null;
  } catch {
    return null;
  }
}

export function storeDraft(draft) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* private mode or full storage: the screen still works, just not across reloads */
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Fill still-blank ball picks with each bowler's usual ball. */
export function withDefaultBalls(draft, lastBalls) {
  let changed = false;
  const bowlers = { ...draft.bowlers };
  BOWLERS.forEach(({ key }) => {
    if (!lastBalls[key]) return;
    const games = bowlers[key].games.map((g) => {
      if (g.ball !== "" || gameStarted(g)) return g;
      changed = true;
      return { ...g, ball: String(lastBalls[key]) };
    });
    bowlers[key] = { games };
  });
  return changed ? { ...draft, bowlers } : draft;
}

/** A saved night (both bowlers' API rows, either may be null) back as a draft. */
export function draftFromNight(date, rows) {
  const draft = blankDraft(date);
  BOWLERS.forEach(({ key }) => {
    const row = rows[key];
    if (!row) return;
    const frames = row.frames || [null, null, null];
    const lanes = row.lanes || [null, null, null];
    const balls = row.balls || [null, null, null];
    draft.bowlers[key] = {
      games: row.games.map((score, i) => ({
        mode: frames[i] ? "frames" : "score",
        frames: frames[i] || [],
        score: frames[i] ? "" : String(score),
        lanes: lanes[i] === null ? "" : String(lanes[i]),
        ball: balls[i] === null ? "" : String(balls[i]),
      })),
    };
  });
  const first = BOWLERS.find(({ key }) => rows[key]);
  draft.active = { bowler: (first || BOWLERS[0]).key, game: 0 };
  draft.note = (BOWLERS.map(({ key }) => rows[key]).find((r) => r && r.note) || {}).note || "";
  return draft;
}

/**
 * The save request for a finished draft, or what's still missing. Bowlers
 * who haven't thrown a ball sit the night out; anyone who has needs all
 * three games, framed or typed.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function draftToSave(draft) {
  const playing = BOWLERS.filter(({ key }) => bowlerStarted(draft, key));
  if (!playing.length) return { ok: false, error: "Nothing bowled yet." };

  for (const { key, name } of playing) {
    const games = draft.bowlers[key].games;
    for (let i = 0; i < GAMES; i += 1) {
      const g = games[i];
      if (g.mode === "score" && !validScore(g.score)) {
        return { ok: false, error: `${name}'s game ${i + 1} needs a score from 0 to ${MAX_GAME}.` };
      }
      if (g.mode === "frames" && !checkGame(g.frames).ok) {
        return {
          ok: false,
          error: g.frames.length
            ? `${name}'s game ${i + 1} isn't finished yet.`
            : `${name} still has game ${i + 1} to bowl.`,
        };
      }
    }
  }

  const id = (v) => (v === "" ? null : Number(v));
  return {
    ok: true,
    value: {
      bowledOn: draft.bowledOn,
      note: draft.note,
      source: "lane",
      entries: playing.map(({ key }) => {
        const games = draft.bowlers[key].games;
        const framed = (g) => g.mode === "frames";
        return {
          bowler: key,
          games: games.map((g) => (framed(g) ? scoreGame(g.frames).total : Number(g.score))),
          frames: games.map((g) => (framed(g) ? g.frames : null)),
          lanes: games.map((g) => id(g.lanes)),
          balls: games.map((g) => id(g.ball)),
        };
      }),
    },
  };
}
