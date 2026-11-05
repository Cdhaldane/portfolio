// Stock state for /pantry: what's out, what's low, what's probably due and
// what needs using soon. Pure functions over the plain item objects that
// pantry-db.js returns, so the API, the daily digest and the kitchen feed
// all agree. NOT an endpoint.
//
// Days are plain "YYYY-MM-DD" strings in the household's zone (Toronto by
// default). They compare correctly as strings, and the day math below never
// touches local time, so a 9pm upload can't slip a day.
//
//   out   qty is 0
//   low   qty is at or under the item's low mark (default "a little left")
//   due   nobody has logged it running out, but it's been bought at least
//         three times and the usual gap since the last purchase has passed.
//         This is what makes the list useful without tapping every use.
//   useSoon  perishable and within two days of its shelf life since purchase,
//            or up to three days past it ("check it")
//   stale    further past than that: it was almost certainly eaten without
//            anyone logging it, so the page asks "still got it?" instead of
//            nagging about it forever
const TZ = process.env.PANTRY_TZ || "America/Toronto";

const MIN_PURCHASES = 3; // two gaps before a cadence means anything
const RECENT_GAPS = 8;
const USE_SOON_DAYS = 2;
const STALE_AFTER_DAYS = 3;
const AUTO_STAPLE_PURCHASES = 2;

const DAY_MS = 86400000;

function todayIn(tz = TZ, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const dayNum = (iso) =>
  Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);
const isoOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (iso, days) => isoOf(dayNum(iso) + days);
const daysBetween = (from, to) => dayNum(to) - dayNum(from);

/** Median days between distinct purchase days, or null below three purchases. */
function cadenceDays(dates) {
  const days = [...new Set(dates || [])].sort().map(dayNum);
  if (days.length < MIN_PURCHASES) return null;
  const gaps = days
    .slice(1)
    .map((d, i) => d - days[i])
    .slice(-RECENT_GAPS);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.max(1, Math.round(median));
}

/** "Keep it stocked": the item's own setting, else bought twice or more. */
const isStaple = (item) =>
  item.staple == null ? (item.purchases || []).length >= AUTO_STAPLE_PURCHASES : item.staple;

/**
 * @param {object} item a pantry-db item (qty, lowAt, lastBoughtOn, countedOn,
 *   shelfDays, snoozeUntil, purchases)
 * @param {string} today YYYY-MM-DD
 */
function statusOf(item, today) {
  const cadence = cadenceDays(item.purchases);
  const dueOn = cadence && item.lastBoughtOn ? addDays(item.lastBoughtOn, cadence) : null;
  const useBy =
    item.shelfDays && item.lastBoughtOn && item.qty > 0
      ? addDays(item.lastBoughtOn, item.shelfDays)
      : null;

  let state = "ok";
  if (item.qty <= 0) state = "out";
  else if (item.qty <= item.lowAt) state = "low";
  // A count logged on or after the due day beats the guess.
  else if (dueOn && today >= dueOn && !(item.countedOn && item.countedOn >= dueOn)) state = "due";

  const snoozed = Boolean(item.snoozeUntil) && item.snoozeUntil > today;
  const daysLeft = useBy ? daysBetween(today, useBy) : null;
  return {
    state,
    cadence,
    dueOn,
    useBy,
    useSoon: useBy != null && daysLeft <= USE_SOON_DAYS && daysLeft >= -STALE_AFTER_DAYS,
    expired: useBy != null && daysLeft < 0,
    stale: useBy != null && daysLeft < -STALE_AFTER_DAYS,
    staple: isStaple(item),
    onList: state !== "ok" && !snoozed && !item.archived,
  };
}

const withStatus = (items, today) => items.map((item) => ({ ...item, status: statusOf(item, today) }));

// ---------------------------------------------------------------------------
// Words, for the kitchen speaker and the push digest.

/** "Milk 2%" reads as "milk 2%" mid-sentence; "PC chips" keeps its capitals. */
function spoken(name) {
  return /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

/** "a", "a and b", "a, b and c", "a, b, c and 4 more". */
function joinNames(names, max = 5) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  if (extra > 0) return `${shown.join(", ")} and ${extra} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * What the kitchen needs to know, in lists and as one sentence to read aloud.
 * @param {object[]} items items with .status (see withStatus)
 * @param {{ name: string }[]} extras free-text list entries
 */
function kitchenSummary(items, extras, today) {
  const listed = items.filter((i) => i.status.onList);
  const out = listed.filter((i) => i.status.state === "out").sort(byName);
  const low = listed
    .filter((i) => i.status.state === "low" || i.status.state === "due")
    .sort(byName);
  const useSoon = items
    .filter((i) => i.status.useSoon && i.qty > 0)
    .sort((a, b) => (a.status.useBy < b.status.useBy ? -1 : a.status.useBy > b.status.useBy ? 1 : byName(a, b)));
  const extraNames = extras.map((e) => e.name);

  const parts = [];
  if (out.length) parts.push(`You're out of ${joinNames(out.map((i) => spoken(i.name)))}.`);
  if (low.length) parts.push(`Running low on ${joinNames(low.map((i) => spoken(i.name)))}.`);
  if (extraNames.length) parts.push(`Also on the list: ${joinNames(extraNames.map(spoken))}.`);
  const fresh = useSoon.filter((i) => !i.status.expired);
  const turning = useSoon.filter((i) => i.status.expired);
  if (fresh.length) parts.push(`Use the ${joinNames(fresh.map((i) => spoken(i.name)), 3)} soon.`);
  if (turning.length) parts.push(`Check the ${joinNames(turning.map((i) => spoken(i.name)), 3)}, it may have turned.`);
  const say = parts.length ? parts.join(" ") : "The pantry's in good shape. Nothing's running low.";

  const brief = (i) => ({ id: i.id, name: i.name, location: i.location, state: i.status.state, useBy: i.status.useBy });
  return {
    today,
    out: out.map(brief),
    low: low.map(brief),
    useSoon: useSoon.map(brief),
    extras: extraNames,
    say,
  };
}

/**
 * The daily push: only what's new since the last one, so a week of "still
 * out of saffron" never nags. `seen` is the key list stored after the last
 * digest; the returned `keys` replace it.
 */
function digestFor(items, extras, today, seen = []) {
  const summary = kitchenSummary(items, extras, today);
  const keyed = [
    ...summary.out.map((i) => ({ i, key: `${i.id}:out` })),
    ...summary.low.map((i) => ({ i, key: `${i.id}:${i.state}` })),
    ...summary.useSoon.map((i) => ({ i, key: `${i.id}:use:${i.useBy}` })),
  ];
  const keys = [...new Set(keyed.map((k) => k.key))];
  const already = new Set(seen);
  const fresh = keyed.filter((k) => !already.has(k.key));
  if (!fresh.length) return { payload: null, keys };

  const freshIds = new Set(fresh.map((k) => k.i.id));
  const names = (list) => list.filter((i) => freshIds.has(i.id)).map((i) => i.name);
  const lines = [];
  const outNames = names(summary.out);
  const lowNames = names(summary.low);
  const soonNames = names(summary.useSoon);
  if (outNames.length) lines.push(`Out: ${joinNames(outNames, 4)}`);
  if (lowNames.length) lines.push(`Low: ${joinNames(lowNames, 4)}`);
  if (soonNames.length) lines.push(`Use soon: ${joinNames(soonNames, 3)}`);
  const listCount = summary.out.length + summary.low.length + summary.extras.length;
  return {
    payload: {
      title: listCount ? `Pantry · ${listCount} on the list` : "Pantry",
      body: lines.join(" · "),
      url: outNames.length || lowNames.length ? "/pantry?tab=list" : "/pantry?tab=cook",
      tag: "pantry-digest",
    },
    keys,
  };
}

module.exports = {
  TZ,
  todayIn,
  addDays,
  daysBetween,
  cadenceDays,
  isStaple,
  statusOf,
  withStatus,
  spoken,
  joinNames,
  kitchenSummary,
  digestFor,
};
