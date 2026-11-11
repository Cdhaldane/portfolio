// Lane play for /bowler: where the first ball actually goes, from the
// target and crossed-at boards noted on the lane screen, and how each lane
// pair treats you. Pure; nothing mutates its input.
//
// Boards count from the bowler's own gutter (scoring.js), so a positive
// miss is "inside" (deeper, toward the middle) and a negative one
// "outside" (toward your gutter) for righties and lefties alike.
import { framedGames } from "./frameStats";
import { seriesFor } from "./stats";

/** Within this many boards counts as hitting your target. */
export const NEAR = 1;
/** The miss chart runs -SPREAD..+SPREAD; its end bins hold everything past them. */
export const SPREAD = 4;
/** A lane pair needs this many games before it can be your best or toughest. */
export const MIN_PAIR_GAMES = 2;

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (made, chances) => ({
  made,
  chances,
  pct: chances ? round1((made / chances) * 100) : null,
});
const strikeRate = (list) => rate(list.filter((t) => t.strike).length, list.length);

/** Every first ball with both boards noted: { target, miss, strike }. */
function throwsOf(series, bowler) {
  const throws = [];
  seriesFor(series, bowler).forEach((row) =>
    framedGames(row).forEach((frames) =>
      frames.forEach((f) => {
        if (Number.isInteger(f.target) && Number.isInteger(f.actual)) {
          throws.push({ target: f.target, miss: f.actual - f.target, strike: f.rolls[0] === 10 });
        }
      })
    )
  );
  return throws;
}

/**
 * First-ball accuracy for one bowler:
 *   throws        how many first balls had both boards noted
 *   onTarget      { made, chances, pct } within NEAR boards
 *   lean          the average miss in boards (+ inside, - outside), or null
 *   spread        the average miss either way, or null
 *   bins          counts for misses -SPREAD..+SPREAD (ends include beyond)
 *   strikeNear    strike rate when on target
 *   strikeFar     strike rate when not
 *   targets       the three most-used target boards: { board, throws, strike, lean }
 */
export function boardStats(series, bowler) {
  const throws = throwsOf(series, bowler);
  const bins = Array.from({ length: SPREAD * 2 + 1 }, () => 0);
  throws.forEach((t) => {
    bins[Math.max(-SPREAD, Math.min(SPREAD, t.miss)) + SPREAD] += 1;
  });

  const byTarget = new Map();
  throws.forEach((t) => byTarget.set(t.target, [...(byTarget.get(t.target) || []), t]));
  const targets = [...byTarget]
    .map(([board, list]) => ({
      board,
      throws: list.length,
      strike: strikeRate(list),
      lean: round1(mean(list.map((t) => t.miss))),
    }))
    .sort((a, b) => b.throws - a.throws || a.board - b.board)
    .slice(0, 3);

  const near = throws.filter((t) => Math.abs(t.miss) <= NEAR);
  const lean = mean(throws.map((t) => t.miss));
  const spread = mean(throws.map((t) => Math.abs(t.miss)));
  return {
    throws: throws.length,
    onTarget: rate(near.length, throws.length),
    lean: lean === null ? null : round1(lean),
    spread: spread === null ? null : round1(spread),
    bins,
    strikeNear: strikeRate(near),
    strikeFar: strikeRate(throws.filter((t) => Math.abs(t.miss) > NEAR)),
    targets,
  };
}

/** The miss pattern in words, or null without throws. */
export function leanText(lean) {
  if (lean === null) return null;
  if (Math.abs(lean) < 0.5) return "Right on your line, on average.";
  const boards = Math.abs(lean) === 1 ? "a board" : `${Math.abs(lean)} boards`;
  return lean > 0 ? `Misses inside by ${boards} on average.` : `Misses outside by ${boards} on average.`;
}

/**
 * Averages by lane pair (the stored lane is the pair's left lane):
 *   games      games with a lane noted
 *   overall    the bowler's average over every game, the yardstick
 *   pairs      [{ lane, label, games, average, diff }], most-bowled first
 *   best/worst the lane of the best and toughest pair with MIN_PAIR_GAMES,
 *              null until two pairs qualify
 */
export function lanePairs(series, bowler) {
  const rows = seriesFor(series, bowler);
  const all = rows.flatMap((r) => r.games);
  const overall = mean(all);
  const byLane = new Map();
  rows.forEach((row) => {
    const lanes = Array.isArray(row.lanes) ? row.lanes : [];
    row.games.forEach((score, i) => {
      if (Number.isInteger(lanes[i])) byLane.set(lanes[i], [...(byLane.get(lanes[i]) || []), score]);
    });
  });

  const pairs = [...byLane]
    .map(([lane, scores]) => {
      const average = mean(scores);
      return {
        lane,
        label: `${lane}-${lane + 1}`,
        games: scores.length,
        average: round1(average),
        diff: overall === null ? null : round1(average - overall),
      };
    })
    .sort((a, b) => b.games - a.games || b.average - a.average || a.lane - b.lane);

  const ranked = pairs.filter((p) => p.games >= MIN_PAIR_GAMES).sort((a, b) => b.average - a.average);
  const enough = ranked.length >= 2 && ranked[0].average !== ranked[ranked.length - 1].average;
  return {
    games: pairs.reduce((n, p) => n + p.games, 0),
    overall: overall === null ? null : round1(overall),
    pairs,
    best: enough ? ranked[0].lane : null,
    worst: enough ? ranked[ranked.length - 1].lane : null,
  };
}
