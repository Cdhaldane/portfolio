// Live help on the lane screen, pure: your record on the leave in front of
// you, and what the game on the lane still needs to beat your average, your
// best and the other bowler.
//
// "History" is every saved night except the one on the phone (when a saved
// night is re-opened for frames, its old copy mustn't count twice), plus
// the games already on the phone tonight.
import { BOWLERS } from "./bowlers";
import { framedGames, leaveBook, leaveKey } from "./frameStats";
import { seriesFor } from "./stats";
import { gameDone, gameTotal } from "./laneDraft";

const before = (series, draft, bowler) =>
  seriesFor(series || [], bowler).filter((r) => r.bowledOn !== draft.bowledOn);

/** Framed games for one bowler: saved history plus tonight's on the phone. */
export function gamesFor(series, draft, bowler) {
  const saved = before(series, draft, bowler).flatMap(framedGames);
  const tonight = draft.bowlers[bowler].games
    .filter((g) => g.mode === "frames" && g.frames.length)
    .map((g) => g.frames);
  return [...saved, ...tonight];
}

/** The book of every leave this bowler has faced (see frameStats.leaveBook). */
export const bookFor = (series, draft, bowler) => leaveBook(gamesFor(series, draft, bowler));

export const leaveName = (pins) => (pins.length === 1 ? `${pins[0]} pin` : pins.join("-"));

/**
 * Your record on a leave: { name, made, chances, pct, split } (zero chances
 * the first time you see it), or null for a full rack or unknown pins.
 */
export function oddsFor(book, pins) {
  if (!pins || !pins.length || pins.length === 10) return null;
  const seen = book.leaves.get(leaveKey(pins));
  return { name: leaveName(pins), made: 0, chances: 0, pct: null, split: false, ...seen };
}

/**
 * Targets for the game on the lane, each
 *   { id, label, target, need, state: "on" | "done" | "gone" }
 * "done" once the score so far already beats it, "gone" once even a strike
 * on every ball left can't. `score` is the known running score and `best`
 * the best possible finish (scoring.maxScore).
 */
export function needsFor({ series, draft, bowler, game, score, best }) {
  const out = [];
  const add = (id, label, target) =>
    out.push({
      id,
      label,
      target,
      need: Math.max(0, target - score),
      state: score >= target ? "done" : best < target ? "gone" : "on",
    });

  const games = before(series, draft, bowler).flatMap((r) => r.games);
  if (games.length) {
    const average = games.reduce((a, b) => a + b, 0) / games.length;
    add("avg", `Average ${Math.round(average * 10) / 10}`, Math.floor(average) + 1);
    const high = Math.max(...games);
    if (high < 300) add("high", `Best game ${high}`, high + 1);
  }

  const other = BOWLERS.find((b) => b.key !== bowler);
  const theirs = draft.bowlers[other.key].games[game];
  if (theirs && gameDone(theirs)) {
    const total = gameTotal(theirs);
    add("rival", `${other.name}'s ${total}`, total + 1);
  }
  return out;
}
