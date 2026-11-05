// Labels and number formatting shared by the Pantry views. Keep the keys in
// step with CATEGORIES / LOCATIONS in api/_lib/pantry-normalize.js.

export const LOCATIONS = [
  { key: "fridge", label: "Fridge" },
  { key: "freezer", label: "Freezer" },
  { key: "pantry", label: "Pantry" },
  { key: "counter", label: "Counter" },
  { key: "home", label: "Around the house" },
];

export const CATEGORIES = [
  { key: "produce", label: "Produce" },
  { key: "dairy", label: "Dairy & eggs" },
  { key: "meat", label: "Meat" },
  { key: "seafood", label: "Seafood" },
  { key: "bakery", label: "Bakery" },
  { key: "pantry", label: "Dry goods" },
  { key: "frozen", label: "Frozen" },
  { key: "snacks", label: "Snacks" },
  { key: "drinks", label: "Drinks" },
  { key: "household", label: "Household" },
  { key: "other", label: "Other" },
];

export const locationLabel = (key) => (LOCATIONS.find((l) => l.key === key) || LOCATIONS[2]).label;

/** Packs on hand, the way you'd say it: "3", "1½", "a little". */
export function qtyText(qty) {
  if (qty <= 0) return "none";
  if (qty < 1) return qty <= 0.25 ? "a little" : qty <= 0.5 ? "half" : "most of one";
  const whole = Math.floor(qty);
  const frac = qty - whole;
  const tail = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : frac === 0.75 ? "¾" : "";
  return `${whole}${tail}`;
}

/** Step the count: whole packs above one, quarters below. */
export function stepQty(qty, dir) {
  if (dir > 0) return qty < 1 ? Math.min(1, qty + 0.25) : Math.min(999, qty + 1);
  return qty > 1 ? Math.max(1, qty - 1) : Math.max(0, qty - 0.25);
}

const DAY = new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Tue 4 Nov" from "2026-11-04". */
export function dayText(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return DAY.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from, to) {
  const n = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return Math.round(n(to) - n(from));
}

/** "today", "yesterday", "3 days ago", "Tue 4 Nov". */
export function agoText(iso, today) {
  if (!iso) return "";
  const days = daysBetween(iso, today);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return dayText(iso);
}

export const money = (cents) =>
  cents == null ? "" : `$${(cents / 100).toFixed(cents % 100 === 0 && cents >= 1000 ? 0 : 2)}`;

/** The one-word badge for an item, or null when there's nothing to flag. */
export function badgeFor(status) {
  if (!status) return null;
  if (status.state === "out") return { tone: "out", label: "Out" };
  if (status.state === "low") return { tone: "low", label: "Low" };
  if (status.state === "due") return { tone: "due", label: "Due" };
  if (status.stale) return { tone: "stale", label: "Still got it?" };
  if (status.expired && status.useSoon) return { tone: "soon", label: "Check it" };
  if (status.useSoon) return { tone: "soon", label: "Use soon" };
  return null;
}

/** A sentence about an item's rhythm: "Usually every 7 days · next around Tue 4 Nov". */
export function rhythmText(item) {
  const s = item.status || {};
  const parts = [];
  if (s.cadence) parts.push(`Usually every ${s.cadence} day${s.cadence === 1 ? "" : "s"}`);
  if (s.dueOn) parts.push(`next around ${dayText(s.dueOn)}`);
  return parts.join(" · ");
}
