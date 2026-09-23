// Forward-looking numbers: milestones to chase, the handicap simulator,
// tonight's (joke) betting line, and the facts on a night's wrap card.
// Pure functions over the API's series list; nothing mutates its input.
import { BOWLERS, GAMES, MAX_GAME } from "./bowlers";
import { averageBefore, bowlerStats, handicapFor, seriesFor, seriesTotal } from "./stats";

const MAX_SERIES = GAMES * MAX_GAME;
// A strong-but-human pace used to answer "how many nights to get there?"
const GOOD_PACE_SERIES = 600;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function totals(series, bowler) {
  const games = seriesFor(series, bowler).flatMap((r) => r.games);
  return { sum: sum(games), count: games.length };
}

/** Pins needed across the next series to lift the average to `target`. */
export function pinsNeeded({ sum: s, count }, target) {
  return Math.ceil(target * (count + GAMES) - s);
}

/** Average and handicap after one more series of `nextSeries` pins. */
export function simulate({ sum: s, count }, nextSeries) {
  const average = Math.round(((s + nextSeries) / (count + GAMES)) * 10) / 10;
  return { average, handicap: handicapFor(average) };
}

/** Nights at `pace` needed to reach `target`, or null if the pace can't. */
export function nightsToTarget({ sum: s, count }, target, pace = GOOD_PACE_SERIES) {
  const perNight = pace - GAMES * target;
  if (perNight <= 0) return null;
  return Math.max(1, Math.ceil((target * count - s) / perNight));
}

// ---- milestones ----

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Up to four goals worth chasing next week, closest first. `progress` is
 * 0..1 so the page can light that fraction of a ten-pin rack.
 */
export function milestones(series, bowler) {
  const rows = seriesFor(series, bowler);
  if (!rows.length) return [];
  const st = bowlerStats(series, bowler);
  const t = totals(series, bowler);
  const goals = [];

  const nextAvg = Math.floor(st.average / 10) * 10 + 10;
  const need = pinsNeeded(t, nextAvg);
  if (need <= MAX_SERIES) {
    goals.push({
      id: "avg",
      label: `A ${nextAvg} average`,
      detail: `Bowl a ${need} series next week`,
      progress: clamp01(1 - (nextAvg - st.average) / 10),
    });
  }

  const bestGame = st.highGame.score;
  if (bestGame < 200) {
    goals.push({
      id: "200",
      label: "Your first 200 game",
      detail: `${200 - bestGame} pins past your best of ${bestGame}`,
      progress: clamp01(bestGame / 200),
    });
  } else {
    goals.push({
      id: "hg",
      label: `Beat your ${bestGame} high game`,
      detail: `${bestGame + 1 - Math.round(st.average)} pins over your average in one game`,
      progress: clamp01(st.average / (bestGame + 1)),
    });
  }

  const bestSeries = st.highSeries.score;
  const seriesTarget = bestSeries >= 600 ? bestSeries + 1 : bestSeries >= 500 ? 600 : 500;
  goals.push({
    id: "series",
    label: seriesTarget > 600 ? `A ${seriesTarget} series` : `The ${seriesTarget} series`,
    detail: `${seriesTarget - bestSeries} short of your best (${bestSeries})`,
    progress: clamp01(bestSeries / seriesTarget),
  });

  const bestLow = Math.max(...rows.map((r) => Math.min(...r.games)));
  if (bestLow < 150) {
    goals.push({
      id: "clean",
      label: "Clean Sheet trophy",
      detail: `All three at 150+. Your best low game is ${bestLow}`,
      progress: clamp01(bestLow / 150),
    });
  }

  if (rows.length < 10) {
    goals.push({
      id: "regular",
      label: "League Regular trophy",
      detail: `${10 - rows.length} more ${10 - rows.length === 1 ? "night" : "nights"} to go`,
      progress: rows.length / 10,
    });
  }

  return goals.sort((a, b) => b.progress - a.progress).slice(0, 4);
}

// ---- tonight's line (for fun) ----

// Abramowitz-Stegun 7.1.26: plenty accurate for a joke betting line.
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** American moneyline for a win probability, rounded to the nearest 5. */
export function moneyline(p) {
  const raw = p >= 0.5 ? -(p / (1 - p)) * 100 : ((1 - p) / p) * 100;
  const rounded = Math.round(raw / 5) * 5;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** Recency-weighted projection of next series (last five nights, 5..1). */
export function projectedSeries(series, bowler) {
  const recent = seriesFor(series, bowler).slice(-5);
  if (!recent.length) return null;
  const weights = recent.map((_, i) => i + 1);
  const weighted = sum(recent.map((r, i) => seriesTotal(r) * weights[i]));
  return Math.round(weighted / sum(weights));
}

/**
 * Probability the first bowler out-bowls the second over a series, from
 * projections and each bowler's game-to-game swing. Null until both have
 * at least two nights (a swing needs more than one data point).
 */
export function tonightsLine(series) {
  const [a, b] = BOWLERS.map(({ key }) => ({
    key,
    stats: bowlerStats(series, key),
    projected: projectedSeries(series, key),
  }));
  if (a.stats.nights < 2 || b.stats.nights < 2) return null;
  // Series spread: game sd * sqrt(3); floor it so a freakishly steady
  // bowler doesn't produce infinite odds.
  const sd = (s) => Math.max(s.stats.stdDev || 0, 8) * Math.sqrt(GAMES);
  const z = (a.projected - b.projected) / Math.sqrt(sd(a) ** 2 + sd(b) ** 2);
  const pA = Math.min(0.97, Math.max(0.03, normalCdf(z)));
  return {
    [a.key]: { projected: a.projected, p: pA, line: moneyline(pA) },
    [b.key]: { projected: b.projected, p: 1 - pA, line: moneyline(1 - pA) },
    favourite: pA >= 0.5 ? a.key : b.key,
  };
}

// ---- wrap card + celebration ----

function clubStreak(rows, date) {
  const upTo = rows.filter((r) => r.bowledOn <= date);
  let streak = 0;
  for (let i = upTo.length - 1; i >= 0 && upTo[i].games.some((g) => g >= 200); i -= 1) {
    streak += 1;
  }
  return streak;
}

/** Everything the wrap card says about one night. */
export function wrapFacts(series, date) {
  const bowlers = BOWLERS.map(({ key, name }) => {
    const rows = seriesFor(series, key);
    const row = rows.find((r) => r.bowledOn === date);
    if (!row) return null;
    const before = rows.filter((r) => r.bowledOn < date);
    const prior = averageBefore(rows, date);
    const total = seriesTotal(row);
    const prevHighGame = Math.max(-1, ...before.flatMap((r) => r.games));
    const prevHighSeries = Math.max(-1, ...before.map(seriesTotal));
    return {
      key,
      name,
      games: row.games,
      total,
      priorAvg: prior,
      beat: prior === null ? null : row.games.filter((g) => g > prior).length,
      pbGame: before.length > 0 && Math.max(...row.games) > prevHighGame,
      pbSeries: before.length > 0 && total > prevHighSeries,
      clubStreak: clubStreak(rows, date),
    };
  }).filter(Boolean);

  return { date, bowlers, lines: bowlers.map(factLine) };
}

function factLine(b) {
  const bits = [`${b.name} ${b.total}`];
  if (b.pbSeries) bits.push("a new high series");
  else if (b.pbGame) bits.push(`a new high game (${Math.max(...b.games)})`);
  if (b.beat !== null) bits.push(`${b.beat} of 3 games above average`);
  if (b.clubStreak > 1) bits.push(`200 club streak at ${b.clubStreak}`);
  else if (b.clubStreak === 1) bits.push("made the 200 club");
  return bits.join(", ");
}

/** Which save animation fits the games just entered. */
export function celebrationFor(entries) {
  const games = entries.flatMap((e) => e.games);
  if (games.some((g) => g === MAX_GAME)) return "perfect";
  if (games.some((g) => g >= 200)) return "club";
  if (games.some((g) => g < 80)) return "gutter";
  return "strike";
}

