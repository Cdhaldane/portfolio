// League-night reminder logic for /bowler. Pure, NOT an endpoint.
//
// There's no "league night" setting: the saved nights say when league is.
// The weekday most of the recent nights fell on is league night, as long as
// the last one was recent enough that the season is still running. The
// reminder then says what series moves each bowler's average up a pin.
const { BOWLERS } = require("./bowler-normalize");

const TZ = process.env.REMINDER_TZ || "America/Toronto";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Look back this far for the pattern (a season's worth)...
const WINDOW_DAYS = 120;
// ...and stop reminding once league's been quiet this long (season over).
const QUIET_DAYS = 22;
const MIN_NIGHTS = 2;
const MAX_SERIES = 900;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso) => Date.parse(`${iso}T12:00:00Z`) / DAY_MS;
const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** Today's date (YYYY-MM-DD) where league happens. */
function todayIn(tz = TZ, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * League night from the saved nights: { weekday, label, nights, last }, or
 * null while there isn't a pattern yet or the season looks over.
 */
function leagueNight(series, today) {
  const dates = [...new Set(series.map((r) => r.bowledOn))].filter((d) => d <= today).sort();
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  if (dayNumber(today) - dayNumber(last) > QUIET_DAYS) return null;

  const recent = dates.filter((d) => dayNumber(today) - dayNumber(d) <= WINDOW_DAYS);
  const counts = new Map();
  recent.forEach((d) => counts.set(weekdayOf(d), (counts.get(weekdayOf(d)) || 0) + 1));
  // Most nights wins; a tie goes to the weekday of the latest night.
  let weekday = weekdayOf(last);
  counts.forEach((n, day) => {
    if (n > (counts.get(weekday) || 0)) weekday = day;
  });
  const nights = counts.get(weekday) || 0;
  if (nights < MIN_NIGHTS) return null;
  return { weekday, label: WEEKDAYS[weekday], nights, last };
}

/**
 * What one bowler needs tonight to lift their average by a pin (the next
 * whole number): { name, target, series }, or null without history or when
 * it'd take more than a perfect set.
 */
function nextPin(series, bowler) {
  const games = series.filter((r) => r.bowler === bowler).flatMap((r) => r.games);
  if (!games.length) return null;
  const total = games.reduce((a, b) => a + b, 0);
  const target = Math.floor(total / games.length) + 1;
  const needed = target * (games.length + 3) - total;
  return needed <= MAX_SERIES ? { name: BOWLERS[bowler], target, series: needed } : null;
}

/** Today's push, or null when it isn't league night (or it's already in). */
function reminderFor(series, today) {
  const league = leagueNight(series, today);
  if (!league || weekdayOf(today) !== league.weekday) return null;
  if (series.some((r) => r.bowledOn === today)) return null;
  const lines = Object.keys(BOWLERS)
    .map((key) => nextPin(series, key))
    .filter(Boolean)
    .map((n) => `${n.name}: a ${n.series} series lifts you to ${n.target}.`);
  return {
    title: "League night",
    body: lines.length ? lines.join(" ") : "Bring the bag. Score it live tonight.",
    url: "/bowler/lane",
    tag: "bowler-league",
  };
}

module.exports = { TZ, WEEKDAYS, todayIn, weekdayOf, leagueNight, nextPin, reminderFor };
