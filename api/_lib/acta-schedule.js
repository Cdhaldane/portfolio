// Calendar rules for Acta Diurna (/acta). NOT an endpoint.
//
// Dates are plain "YYYY-MM-DD" strings anchored to Toronto, because "today's
// lesson" means Charlie's morning, not UTC's. Every helper here is pure date
// arithmetic on those strings (done in UTC so DST never shifts a day).
//
// The week has a fixed rhythm: Monday to Saturday each get one lesson of a
// set kind, and Sunday is a review day with no new lesson. A season is five
// such weeks, so 30 topics, and always starts on a Monday.
const TZ = process.env.ACTA_TZ || "America/Toronto";

/** The kind of lesson each weekday slot carries, Monday (0) to Saturday (5). */
const SLOT_KINDS = ["person", "place", "moment", "idea", "object", "meanwhile"];
const WEEKS_PER_SEASON = 5;
const TOPICS_PER_SEASON = WEEKS_PER_SEASON * SLOT_KINDS.length;
/** Start gathering sources for a lesson this many days before it goes live. */
const LEAD_DAYS = 10;
/** Ask Claude for the next season once fewer than this many lesson days are scheduled. */
const PROPOSE_WHEN_DAYS_LEFT = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in the Acta timezone. */
function todayISO(now = new Date(), tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const fromDate = (d) => d.toISOString().slice(0, 10);

function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** 0 = Sunday … 6 = Saturday, like Date#getDay. */
function weekday(iso) {
  return toDate(iso).getUTCDay();
}

function daysBetween(from, to) {
  return Math.round((toDate(to) - toDate(from)) / 86400000);
}

const isReviewDay = (iso) => weekday(iso) === 0;

/** The first Monday on or after `iso`. */
function mondayOnOrAfter(iso) {
  const wd = weekday(iso);
  return addDays(iso, (8 - wd) % 7);
}

/**
 * Where a newly approved season starts: the first Monday at least two days
 * out (generation needs a little runway), and never before the week after
 * the last lesson already on the calendar.
 */
function seasonStart(today, lastScheduled = null) {
  let start = mondayOnOrAfter(addDays(today, 2));
  if (lastScheduled) {
    const afterLast = mondayOnOrAfter(addDays(lastScheduled, 1));
    if (afterLast > start) start = afterLast;
  }
  return start;
}

/** The publish date for topic `position` (0-based) of a season starting on `start`. */
function slotDate(start, position) {
  const week = Math.floor(position / SLOT_KINDS.length);
  const slot = position % SLOT_KINDS.length;
  return addDays(start, week * 7 + slot);
}

const slotKind = (position) => SLOT_KINDS[position % SLOT_KINDS.length];

/** Lesson days (Mon–Sat) from `from` (exclusive) up to and including `to`. */
function lessonDaysBetween(from, to) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (!isReviewDay(d)) n += 1;
  return n;
}

module.exports = {
  TZ,
  SLOT_KINDS,
  WEEKS_PER_SEASON,
  TOPICS_PER_SEASON,
  LEAD_DAYS,
  PROPOSE_WHEN_DAYS_LEFT,
  isIsoDate,
  todayISO,
  addDays,
  weekday,
  daysBetween,
  isReviewDay,
  mondayOnOrAfter,
  seasonStart,
  slotDate,
  slotKind,
  lessonDaysBetween,
};
