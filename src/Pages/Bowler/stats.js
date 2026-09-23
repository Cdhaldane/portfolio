// Pure stat crunching for /bowler. Input is the API's series list:
//   [{ id, bowler, bowledOn: "YYYY-MM-DD", games: [g1, g2, g3], ... }]
// Nothing here mutates its input; every function returns fresh values.
import { BOWLERS, HANDICAP_BASIS, HANDICAP_PERCENT } from "./bowlers";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const seriesTotal = (s) => sum(s.games);

const byDate = (a, b) => (a.bowledOn < b.bowledOn ? -1 : a.bowledOn > b.bowledOn ? 1 : 0);

export const seriesFor = (series, bowler) =>
  series.filter((s) => s.bowler === bowler).slice().sort(byDate);

function stdDev(xs) {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function handicapFor(average) {
  if (average === null) return null;
  return Math.max(0, Math.floor((HANDICAP_BASIS - average) * HANDICAP_PERCENT));
}

/** Average of games bowled strictly before `date` (what the house knew). */
export function averageBefore(rows, date) {
  const games = rows.filter((r) => r.bowledOn < date).flatMap((r) => r.games);
  return round1(mean(games));
}

function bestBy(rows, score) {
  return rows.reduce(
    (best, r) => {
      const value = score(r);
      return value > best.score ? { score: value, date: r.bowledOn } : best;
    },
    { score: -1, date: null }
  );
}

const SPLIT_LABELS = ["Fast starter", "Mid-set surger", "Closer"];

/** Every headline number for one bowler. Null-safe for zero nights. */
export function bowlerStats(series, bowler) {
  const rows = seriesFor(series, bowler);
  const games = rows.flatMap((r) => r.games);
  const average = round1(mean(games));

  const highGame = rows.reduce(
    (best, r) => {
      const top = Math.max(...r.games);
      return top > best.score ? { score: top, date: r.bowledOn } : best;
    },
    { score: -1, date: null }
  );
  const highSeries = bestBy(rows, seriesTotal);

  // Form: the last three nights against everything before them.
  const recent = rows.slice(-3).flatMap((r) => r.games);
  const earlier = rows.slice(0, -3).flatMap((r) => r.games);
  const form =
    earlier.length && recent.length ? round1(mean(recent) - mean(earlier)) : null;

  const splits = [0, 1, 2].map((i) => round1(mean(rows.map((r) => r.games[i]))));
  const bestSplit =
    rows.length >= 2
      ? splits.reduce((best, v, i) => (v > splits[best] ? i : best), 0)
      : null;

  return {
    bowler,
    nights: rows.length,
    games: games.length,
    average,
    handicap: handicapFor(average),
    highGame: highGame.date ? highGame : null,
    highSeries: highSeries.date ? highSeries : null,
    stdDev: round1(stdDev(games)),
    form,
    splits,
    splitLabel: bestSplit === null ? null : SPLIT_LABELS[bestSplit],
    over150: games.filter((g) => g >= 150).length,
    over200: games.filter((g) => g >= 200).length,
    streak: beatAverageStreak(rows),
  };
}

/** Consecutive most-recent nights whose series average beat the prior average. */
export function beatAverageStreak(rows) {
  let streak = 0;
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const prior = averageBefore(rows, rows[i].bowledOn);
    if (prior !== null && mean(rows[i].games) > prior) streak += 1;
    else break;
  }
  return streak;
}

/** Nights both bowled, with who took the series and each game. */
export function headToHead(series) {
  const [a, b] = BOWLERS.map((bw) => seriesFor(series, bw.key));
  const bByDate = new Map(b.map((r) => [r.bowledOn, r]));
  const shared = a.filter((r) => bByDate.has(r.bowledOn));

  const tally = shared.reduce(
    (acc, ra) => {
      const rb = bByDate.get(ra.bowledOn);
      const ta = seriesTotal(ra);
      const tb = seriesTotal(rb);
      const games = ra.games.reduce(
        (g, score, i) => ({
          a: g.a + (score > rb.games[i] ? 1 : 0),
          b: g.b + (rb.games[i] > score ? 1 : 0),
        }),
        { a: 0, b: 0 }
      );
      const margin = Math.abs(ta - tb);
      const biggest =
        margin > acc.biggest.margin
          ? { margin, date: ra.bowledOn, winner: ta > tb ? BOWLERS[0].key : BOWLERS[1].key }
          : acc.biggest;
      return {
        nights: {
          a: acc.nights.a + (ta > tb ? 1 : 0),
          b: acc.nights.b + (tb > ta ? 1 : 0),
          tie: acc.nights.tie + (ta === tb ? 1 : 0),
        },
        games: { a: acc.games.a + games.a, b: acc.games.b + games.b },
        biggest,
      };
    },
    { nights: { a: 0, b: 0, tie: 0 }, games: { a: 0, b: 0 }, biggest: { margin: 0 } }
  );

  return {
    shared: shared.length,
    nights: tally.nights,
    games: tally.games,
    biggest: tally.biggest.margin > 0 ? tally.biggest : null,
  };
}

/** One point per league night: each bowler's series average (or null). */
export function trendPoints(series) {
  const dates = [...new Set(series.map((s) => s.bowledOn))].sort();
  return dates.map((date) => {
    const point = { date };
    BOWLERS.forEach(({ key }) => {
      const row = series.find((s) => s.bowler === key && s.bowledOn === date);
      point[key] = row ? round1(seriesTotal(row) / row.games.length) : null;
      point[`${key}Games`] = row ? row.games : null;
    });
    return point;
  });
}

/** League nights, newest first, each with both bowlers' rows. */
export function nights(series) {
  const dates = [...new Set(series.map((s) => s.bowledOn))].sort().reverse();
  return dates.map((date) => ({
    date,
    rows: Object.fromEntries(
      BOWLERS.map(({ key }) => [
        key,
        series.find((s) => s.bowler === key && s.bowledOn === date) || null,
      ])
    ),
  }));
}

const BADGES = [
  {
    id: "century",
    icon: "fa-bowling-ball",
    label: "Double Century",
    desc: "Bowl a 200+ game",
    test: (r) => r.games.some((g) => g >= 200),
  },
  {
    id: "clean",
    icon: "fa-broom",
    label: "Clean Sheet",
    desc: "All three games at 150+",
    test: (r) => r.games.every((g) => g >= 150),
  },
  {
    id: "500",
    icon: "fa-fire",
    label: "500 Series",
    desc: "A 500+ three-game series",
    test: (r) => seriesTotal(r) >= 500,
  },
  {
    id: "600",
    icon: "fa-crown",
    label: "600 Club",
    desc: "A 600+ three-game series",
    test: (r) => seriesTotal(r) >= 600,
  },
  {
    id: "comeback",
    icon: "fa-arrow-trend-up",
    label: "Comeback Kid",
    desc: "Game 3 beats game 1 by 40+",
    test: (r) => r.games[2] - r.games[0] >= 40,
  },
  {
    id: "steady",
    icon: "fa-scale-balanced",
    label: "Steady Hands",
    desc: "Three games within 15 pins",
    test: (r) => Math.max(...r.games) - Math.min(...r.games) <= 15,
  },
  {
    id: "regular",
    icon: "fa-calendar-check",
    label: "League Regular",
    desc: "Bowl 10 league nights",
    test: (_r, i) => i >= 9,
  },
];

/** Every badge with the first night each bowler earned it (or null). */
export function badges(series, bowler) {
  const rows = seriesFor(series, bowler);
  return BADGES.map(({ test, ...badge }) => {
    const idx = rows.findIndex((r, i) => test(r, i));
    return { ...badge, earnedOn: idx >= 0 ? rows[idx].bowledOn : null };
  });
}

export { seriesTotal };
