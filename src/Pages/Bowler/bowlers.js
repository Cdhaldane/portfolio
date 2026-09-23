// The two tracked bowlers. Keys match the API's stored ids.
export const BOWLERS = [
  { key: "cha", name: "Charlie", short: "CHA" },
  { key: "van", name: "Vanessa", short: "VAN" },
];

export const BOWLER_BY_KEY = Object.fromEntries(BOWLERS.map((b) => [b.key, b]));

export const GAMES = 3;
export const MAX_GAME = 300;

// League handicap is usually a percentage of the gap to a basis score. These
// are the most common house numbers. The card labels the result as an
// estimate, since every league sets its own.
export const HANDICAP_BASIS = 220;
export const HANDICAP_PERCENT = 0.9;

/** Today's date (YYYY-MM-DD) where league actually happens. */
export const todayLocal = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export const formatNight = (iso, opts = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", opts);
