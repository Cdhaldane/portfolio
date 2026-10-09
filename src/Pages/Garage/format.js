// Text formatting for /garage: dates, distances, money, durations. Units are
// shown as logged (psi, mph from the Accessport); distances in the work log
// are km because that's what the odometers read.

const NUM = new Intl.NumberFormat("en-CA");
const MONEY = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export const fmtNum = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "–"
    : n.toLocaleString("en-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtKm = (n) => (n === null || n === undefined ? "–" : `${NUM.format(n)} km`);

export const fmtMoney = (cents) => (cents === null || cents === undefined ? "–" : MONEY.format(cents / 100));

/** "Oct 4, 2026" (or a shorter form via opts). Dates are plain days, so pin noon. */
export const fmtDate = (iso, opts = { month: "short", day: "numeric", year: "numeric" }) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", opts) : "–";

/** 792 → "13 min 12 s"; 4000 → "1 h 6 min"; 42.3 → "42 s". */
export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Chart axis time: 75.4 → "1:15". */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Whole days from one ISO day to another (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** ISO day plus whole months, clamped to the month's last day (Jan 31 + 1 → Feb 28). */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** ISO day plus whole days. */
export function addDays(iso, days) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** "in 3 weeks", "2 months ago", "today". Rough on purpose. */
export function fmtRelativeDays(days) {
  if (days === 0) return "today";
  const abs = Math.abs(days);
  const [n, unit] =
    abs < 14 ? [abs, "day"] : abs < 60 ? [Math.round(abs / 7), "week"] : abs < 730 ? [Math.round(abs / 30.4), "month"] : [Math.round(abs / 365.25), "year"];
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return days > 0 ? `in ${text}` : `${text} ago`;
}
