// Shared money/date formatting for the Budgetter surfaces. Everything works
// in integer cents and "YYYY-MM" month keys (which compare correctly as
// strings) — dollars and Date objects only ever appear at the display edge.

export const fmtMoney = (cents, { compact = false } = {}) => {
  const dollars = cents / 100;
  // An M step as well as a K one, so an axis tick on a car loan reads "$1.2M"
  // rather than "$1,200K".
  if (compact && Math.abs(dollars) >= 1000000) {
    return `$${(dollars / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  }
  if (compact && Math.abs(dollars) >= 10000) {
    return `$${(dollars / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  }
  return `$${Math.round(dollars).toLocaleString()}`;
};

export const fmtMoneyExact = (cents) =>
  `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const monthShort = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });

export const monthLong = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export const addMonths = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Whole months from `a` to `b` — negative when b is earlier. */
export const monthDiff = (a, b) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

export const currentMonthKey = () => new Date().toISOString().slice(0, 7);

/** Is a windowed item (recurring payment OR income source) active in a given "YYYY-MM" month? */
export const recurringActiveIn = (item, monthKey) =>
  item.start_month <= monthKey && (!item.end_month || monthKey <= item.end_month);

/**
 * Sum of active recurring items for one month — EXCLUDING items billed to a
 * tracked card (on_card): their real charges arrive via statement upload,
 * so counting the recurring amount too would double-count them. On-card
 * items exist for the Monthly tab's list/due-dates, not for dashboard math.
 */
export const fixedForMonth = (recurring, monthKey) =>
  recurring.reduce(
    (sum, r) =>
      recurringActiveIn(r, monthKey) && !r.on_card ? sum + r.amount_cents : sum,
    0
  );

// Pay cadences normalized to a monthly AVERAGE (weekly pay lands 52 times a
// year, not 48) — savings-per-month reads best against a steady baseline,
// so no payday-calendar math on purpose.
export const CADENCES = [
  { value: "weekly", label: "per week", perMonth: 52 / 12 },
  { value: "biweekly", label: "every 2 weeks", perMonth: 26 / 12 },
  { value: "semimonthly", label: "twice a month", perMonth: 2 },
  { value: "monthly", label: "per month", perMonth: 1 },
];

export const monthlyIncomeCents = (source) => {
  const cadence = CADENCES.find((c) => c.value === source.cadence);
  return Math.round(source.amount_cents * (cadence ? cadence.perMonth : 1));
};

/** Normalized monthly income from all sources active in a month. */
export const incomeForMonth = (sources, monthKey) =>
  sources.reduce(
    (sum, s) => (recurringActiveIn(s, monthKey) ? sum + monthlyIncomeCents(s) : sum),
    0
  );
