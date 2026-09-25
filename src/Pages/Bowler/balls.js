// Pure ball-bag helpers for /bowler. Series rows carry
//   balls: [id | null, id | null, id | null]   (one per game)
// and the bag is [{ id, owner, name, weight, color, retired }].
// Nothing here mutates its input.
import { BOWLERS, BOWLER_BY_KEY } from "./bowlers";

export const BALL_WEIGHTS = Array.from({ length: 11 }, (_, i) => i + 6); // 6-16 lb

// Resin-ball colours that read well as a marbled sphere on both themes.
// Keep DEFAULT_BALL_COLOR in sync with api/_lib/bowler-normalize.js.
export const BALL_COLORS = [
  { hex: "#1f5fd1", name: "Blue" },
  { hex: "#c8282e", name: "Red" },
  { hex: "#6b3fc4", name: "Purple" },
  { hex: "#e0569b", name: "Pink" },
  { hex: "#0f9a8c", name: "Teal" },
  { hex: "#ef7d22", name: "Orange" },
  { hex: "#3f8f3a", name: "Green" },
  { hex: "#26262c", name: "Black" },
];
export const DEFAULT_BALL_COLOR = BALL_COLORS[0].hex;

// A ball's number beside "the rest of your games" only means something
// once both sides have at least a night's worth.
const MIN_COMPARE = 3;
// "Best ball" needs two nights with it, and a rival in the bag.
const MIN_BEST = 6;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

export const ballsOf = (row) =>
  Array.isArray(row.balls) ? row.balls : [null, null, null];

export const byId = (balls) => new Map(balls.map((b) => [b.id, b]));

export const ballLabel = (ball) =>
  `${ball.name}${ball.weight ? ` · ${ball.weight} lb` : ""}`;

/**
 * Every ball with how each bowler has thrown it:
 *   by[bowler] = { games, average, high, vsRest }
 * `vsRest` is this ball's average minus the bowler's average with anything
 * else (other balls and untagged games), or null while either side is thin.
 */
export function ballReport(series, balls) {
  const empty = () => Object.fromEntries(BOWLERS.map(({ key }) => [key, []]));
  const thrown = new Map(balls.map((b) => [b.id, empty()]));
  const everything = empty();

  series.forEach((row) => {
    if (!everything[row.bowler]) return;
    const ids = ballsOf(row);
    row.games.forEach((score, i) => {
      const id = ids[i] ?? null;
      everything[row.bowler].push({ score, id });
      if (id !== null && thrown.has(id)) thrown.get(id)[row.bowler].push(score);
    });
  });

  return balls.map((ball) => ({
    ...ball,
    by: Object.fromEntries(
      BOWLERS.map(({ key }) => {
        const scores = thrown.get(ball.id)[key];
        const rest = everything[key].filter((g) => g.id !== ball.id).map((g) => g.score);
        const comparable = scores.length >= MIN_COMPARE && rest.length >= MIN_COMPARE;
        return [
          key,
          {
            games: scores.length,
            average: round1(mean(scores)),
            high: scores.length ? Math.max(...scores) : null,
            vsRest: comparable ? round1(mean(scores) - mean(rest)) : null,
          },
        ];
      })
    ),
  }));
}

// Stand-in for the hero and the lane until there's a real ball in the bag.
export const HOUSE_BALL = Object.freeze({
  id: 0,
  owner: null,
  name: "House ball",
  weight: null,
  color: "#c8282e",
  retired: false,
});

/**
 * The ball to show off: the best owner-average among active balls with a
 * night's worth of games, else the newest active ball, else null.
 */
export function featuredBall(report) {
  const live = report.filter((b) => !b.retired);
  const thrown = live.filter((b) => b.by[b.owner].games >= MIN_COMPARE);
  if (thrown.length) {
    return thrown.reduce((best, b) =>
      b.by[b.owner].average > best.by[best.owner].average ? b : best
    );
  }
  return live.length ? live[live.length - 1] : null;
}

/** The owner's highest-average ball, once two of theirs have enough games. */
export function bestBall(report, bowler) {
  const contenders = report.filter(
    (b) => b.owner === bowler && b.by[bowler].games >= MIN_BEST
  );
  if (contenders.length < 2) return null;
  return contenders.reduce((best, b) =>
    b.by[bowler].average > best.by[bowler].average ? b : best
  ).id;
}

/**
 * The ball each bowler finished their latest tagged night with, so the
 * picker can default to it. Null when that ball has since been retired.
 */
export function lastBalls(series, balls) {
  const live = new Set(balls.filter((b) => !b.retired).map((b) => b.id));
  return Object.fromEntries(
    BOWLERS.map(({ key }) => {
      const rows = series
        .filter((s) => s.bowler === key)
        .sort((a, b) => (a.bowledOn < b.bowledOn ? 1 : a.bowledOn > b.bowledOn ? -1 : 0));
      for (const row of rows) {
        const ids = ballsOf(row).filter((id) => id !== null);
        if (ids.length) {
          const last = ids[ids.length - 1];
          return [key, live.has(last) ? last : null];
        }
      }
      return [key, null];
    })
  );
}

/** Untagged games per bowler (older nights, or nights nobody tagged). */
export function untaggedGames(series) {
  const counts = Object.fromEntries(BOWLERS.map(({ key }) => [key, 0]));
  series.forEach((row) => {
    if (counts[row.bowler] === undefined) return;
    counts[row.bowler] += ballsOf(row).filter((id) => id === null).length;
  });
  return counts;
}

/**
 * Picker options for one bowler: their own bag first, then the other's
 * (borrowing happens). Retired balls stay out unless already selected.
 */
export function pickerGroups(balls, bowler, selected = []) {
  const order = [bowler, ...BOWLERS.map((b) => b.key).filter((k) => k !== bowler)];
  return order
    .map((owner) => ({
      owner,
      label: `${BOWLER_BY_KEY[owner].name}'s bag`,
      balls: balls.filter(
        (b) => b.owner === owner && (!b.retired || selected.includes(b.id))
      ),
    }))
    .filter((g) => g.balls.length);
}

/**
 * One row's balls as runs for a score sheet:
 *   [{ ball, games: [1, 2] }, { ball, games: [3] }]
 * Unknown / untagged games are skipped.
 */
export function ballRuns(row, ballsById) {
  const runs = [];
  ballsOf(row).forEach((id, i) => {
    const ball = id === null ? null : ballsById.get(id);
    if (!ball) return;
    const existing = runs.find((r) => r.ball.id === id);
    if (existing) existing.games.push(i + 1);
    else runs.push({ ball, games: [i + 1] });
  });
  return runs;
}

/** "G1-2", "G3", "G1 & 3". Empty when the ball covered the whole set. */
export function gamesLabel(games, total = 3) {
  if (games.length === total) return "";
  const consecutive = games.every((g, i) => i === 0 || g === games[i - 1] + 1);
  if (games.length === 1) return `G${games[0]}`;
  return consecutive
    ? `G${games[0]}–${games[games.length - 1]}`
    : `G${games.join(" & ")}`;
}

/** Stable small integer per ball, so its marbling never reshuffles. */
export const ballSeed = (ball) => (((ball && ball.id) || 7) * 37) % 997;
