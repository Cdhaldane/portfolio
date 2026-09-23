// League seasons, derived from the night's date. No stored season field:
// most leagues run a fall block (Aug-Dec), a spring block (Jan-Apr) and an
// optional summer league (May-Jul), so the calendar is the source of truth.
import { BOWLERS } from "./bowlers";
import { bowlerStats } from "./stats";

export const ALL_TIME = "all";

export function seasonOf(iso) {
  const [year, month] = iso.split("-").map(Number);
  if (month >= 8) return { key: `${year}-fall`, label: `Fall ${year}`, order: year * 10 + 3 };
  if (month <= 4) return { key: `${year}-spring`, label: `Spring ${year}`, order: year * 10 + 1 };
  return { key: `${year}-summer`, label: `Summer ${year}`, order: year * 10 + 2 };
}

/** Seasons that have at least one night, oldest first. */
export function seasonList(series) {
  const byKey = new Map(series.map((s) => [seasonOf(s.bowledOn).key, seasonOf(s.bowledOn)]));
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

export function inSeason(series, key) {
  return key === ALL_TIME ? series : series.filter((s) => seasonOf(s.bowledOn).key === key);
}

/** Per-season, per-bowler headline numbers for the comparison view. */
export function seasonSummary(series) {
  return seasonList(series).map((season) => {
    const rows = inSeason(series, season.key);
    return {
      ...season,
      byBowler: Object.fromEntries(
        BOWLERS.map(({ key }) => {
          const s = bowlerStats(rows, key);
          return [
            key,
            {
              nights: s.nights,
              average: s.average,
              highSeries: s.highSeries ? s.highSeries.score : null,
              highGame: s.highGame ? s.highGame.score : null,
            },
          ];
        })
      ),
    };
  });
}

// A two-night season shouldn't out-rank a real one on a lucky week.
export const MIN_SEASON_NIGHTS = 3;

/** The season key with the bowler's best average (min nights), or null. */
export function bestSeasonKey(summary, bowler) {
  const eligible = summary.filter((s) => s.byBowler[bowler].nights >= MIN_SEASON_NIGHTS);
  if (eligible.length < 2) return null; // "best" needs something to beat
  return eligible.reduce((best, s) =>
    s.byBowler[bowler].average > best.byBowler[bowler].average ? s : best
  ).key;
}
