// Service schedule maths for /garage. Pure: input is one car's work-log
// entries (the API's events) and its service items from cars.js.
//
// An item's next due point is the last entry that covered it plus the
// interval, by km or by months, whichever comes first. "Soon" means within
// 30 days, or within a tenth of the km interval (at least 1,000 km). When the
// odometer has been logged over a couple of weeks or more, the km side also
// gets a projected date from the average daily distance.
import { addDays, addMonths, daysBetween } from "./format";

const SOON_DAYS = 30;
const SOON_KM_SHARE = 0.1;
const SOON_KM_MIN = 1000;
const RATE_MIN_SPAN_DAYS = 14;

/** The highest km logged for a car, with the day it was read. */
export function currentOdometer(events) {
  let best = null;
  for (const e of events) {
    if (e.odometerKm === null || e.odometerKm === undefined) continue;
    if (!best || e.odometerKm > best.km || (e.odometerKm === best.km && e.happenedOn > best.date)) {
      best = { km: e.odometerKm, date: e.happenedOn };
    }
  }
  return best;
}

/** Average km per day between the first and last readings, once they're 2+ weeks apart. */
export function kmPerDay(events) {
  const readings = events
    .filter((e) => e.odometerKm !== null && e.odometerKm !== undefined)
    .map((e) => [e.happenedOn, e.odometerKm])
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
  if (readings.length < 2) return null;
  const [d0, k0] = readings[0];
  const [d1, k1] = readings[readings.length - 1];
  const span = daysBetween(d0, d1);
  if (span < RATE_MIN_SPAN_DAYS || k1 <= k0) return null;
  return (k1 - k0) / span;
}

/** The most recent entry that covered a service item, or null. */
export function lastDone(events, key) {
  let best = null;
  for (const e of events) {
    if (!Array.isArray(e.services) || !e.services.includes(key)) continue;
    const later =
      !best ||
      e.happenedOn > best.happenedOn ||
      (e.happenedOn === best.happenedOn && (e.odometerKm ?? -1) > (best.odometerKm ?? -1));
    if (later) best = e;
  }
  return best;
}

const URGENCY = { overdue: 0, soon: 1, ok: 2, untracked: 3, unknown: 4 };

/**
 * Where every service item stands on `today`, most urgent first.
 *   status   "overdue" | "soon" | "ok"
 *            | "untracked" (logged, but without the km its interval needs)
 *            | "unknown"   (never logged)
 *   fraction share of the interval used, by km or time, whichever is further along
 *   eta      projected day the km interval runs out, when the driving rate is known
 */
export function serviceStatus(items, events, today) {
  const odo = currentOdometer(events);
  const rate = kmPerDay(events);
  const rows = items.map((item) => {
    const last = lastDone(events, item.key);
    const row = {
      item,
      last,
      status: "unknown",
      fraction: null,
      dueKm: null,
      kmLeft: null,
      dueDate: null,
      daysLeft: null,
      eta: null,
    };
    if (!last) return row;

    let kmFraction = null;
    if (item.km && last.odometerKm !== null && last.odometerKm !== undefined) {
      row.dueKm = last.odometerKm + item.km;
      if (odo) {
        row.kmLeft = row.dueKm - odo.km;
        kmFraction = (odo.km - last.odometerKm) / item.km;
        if (rate) row.eta = addDays(odo.date, Math.round(row.kmLeft / rate));
      }
    }
    let timeFraction = null;
    if (item.months) {
      row.dueDate = addMonths(last.happenedOn, item.months);
      row.daysLeft = daysBetween(today, row.dueDate);
      timeFraction = daysBetween(last.happenedOn, today) / daysBetween(last.happenedOn, row.dueDate);
    }

    const fractions = [kmFraction, timeFraction].filter((f) => f !== null);
    if (!fractions.length) {
      row.status = "untracked";
      return row;
    }
    row.fraction = Math.max(...fractions);
    const soonKm = item.km ? Math.max(SOON_KM_MIN, item.km * SOON_KM_SHARE) : 0;
    const overdue = (row.kmLeft !== null && row.kmLeft < 0) || (row.daysLeft !== null && row.daysLeft < 0);
    const soon =
      (row.kmLeft !== null && row.kmLeft <= soonKm) ||
      (row.daysLeft !== null && row.daysLeft <= SOON_DAYS) ||
      (row.eta !== null && daysBetween(today, row.eta) <= SOON_DAYS);
    row.status = overdue ? "overdue" : soon ? "soon" : "ok";
    return row;
  });
  return rows.sort(
    (a, b) => URGENCY[a.status] - URGENCY[b.status] || (b.fraction ?? -1) - (a.fraction ?? -1)
  );
}

/** The most urgent item that can actually be measured, or null. */
export const nextDue = (statuses) =>
  statuses.find((s) => s.status === "overdue" || s.status === "soon" || s.status === "ok") || null;

/** Money spent on a car, all time and in one calendar year. */
export function spending(events, year) {
  let all = 0;
  let inYear = 0;
  for (const e of events) {
    if (!e.costCents) continue;
    all += e.costCents;
    if (e.happenedOn.startsWith(String(year))) inYear += e.costCents;
  }
  return { all, inYear };
}
