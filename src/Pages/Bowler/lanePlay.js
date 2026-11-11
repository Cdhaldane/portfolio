// Lane play for /bowler: the lines your first ball takes, from the aim and
// hook boards tapped on the lane picture while scoring live, and how each
// lane pair treats you. Pure; nothing mutates its input.
//
// Boards count from the bowler's own gutter (scoring.js), so "aimed at 10,
// hooked at 6" is the same line for a right- or a left-hander. Frames noted
// before the picture (a target and a crossed-at board, no hook) don't draw.
import { framedGames } from "./frameStats";
import { seriesFor } from "./stats";

/** The chart draws this many of the latest lines. */
export const RECENT = 30;
/** A hook zone needs this many first balls before it can be the strike zone. */
export const MIN_ZONE = 3;
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

/** Every first ball with an aim and a hook, oldest first: { aim, hook, strike }. */
function linesOf(series, bowler) {
  const lines = [];
  seriesFor(series, bowler).forEach((row) =>
    framedGames(row).forEach((frames) =>
      frames.forEach((f) => {
        if (Number.isInteger(f.target) && Number.isInteger(f.hook)) {
          lines.push({ aim: f.target, hook: f.hook, strike: f.rolls[0] === 10 });
        }
      })
    )
  );
  return lines;
}

/**
 * The three boards around which hooking strikes most often (at least
 * MIN_ZONE balls and one strike in it): { from, to, throws, strike }.
 */
function strikeZone(lines) {
  const centres = [...new Set(lines.map((l) => l.hook))].sort((a, b) => a - b);
  let best = null;
  centres.forEach((c) => {
    const near = lines.filter((l) => Math.abs(l.hook - c) <= 1);
    const strike = strikeRate(near);
    if (near.length < MIN_ZONE || !strike.made) return;
    if (!best || strike.pct > best.strike.pct || (strike.pct === best.strike.pct && near.length > best.throws)) {
      const hooks = near.map((l) => l.hook);
      best = { from: Math.min(...hooks), to: Math.max(...hooks), throws: near.length, strike };
    }
  });
  return best;
}

/**
 * First-ball lines for one bowler:
 *   throws   first balls with both an aim and a hook marked
 *   strike   the strike rate over them
 *   recent   the latest RECENT lines, oldest first, for the chart
 *   aims     the three most-used aims: { board, throws, strike, hook },
 *            hook being where the ball turned on average from that aim
 *   zone     where hooking strikes most: { from, to, throws, strike }, or null
 */
export function lineStats(series, bowler) {
  const lines = linesOf(series, bowler);
  const byAim = new Map();
  lines.forEach((l) => byAim.set(l.aim, [...(byAim.get(l.aim) || []), l]));
  const aims = [...byAim]
    .map(([board, list]) => ({
      board,
      throws: list.length,
      strike: strikeRate(list),
      hook: round1(mean(list.map((l) => l.hook))),
    }))
    .sort((a, b) => b.throws - a.throws || a.board - b.board)
    .slice(0, 3);
  return {
    throws: lines.length,
    strike: strikeRate(lines),
    recent: lines.slice(-RECENT),
    aims,
    zone: strikeZone(lines),
  };
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
