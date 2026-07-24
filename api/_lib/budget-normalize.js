// Pure helpers for /api/budget/upload — validation, merchant cleanup, dedup
// hashing, and category-rule matching. No DB or network calls, so these are
// cheap to unit-test directly (see the smoke test at the bottom of upload.js
// callers). Kept separate from budget-db.js, which owns everything that
// actually talks to Postgres.
const crypto = require("crypto");

const MAX_ROWS_PER_UPLOAD = 2000;
const MERCHANT_MAX = 300;
const FILENAME_MAX = 200;
const AMOUNT_CENTS_MAX_ABS = 100_000_000; // $1,000,000.00 — generous, not unbounded
const DAY_MS = 86400000;
const MIN_DATE_MS = Date.UTC(2000, 0, 1);

/**
 * Validate + coerce one client-submitted row. Returns either
 * { valid: true, postedDate, merchantRaw, amountCents } or
 * { valid: false, reason }. Never trusts anything beyond these three raw
 * fields — merchant_clean, category, and dedup_hash are always derived
 * server-side from merchantRaw, never accepted from the client.
 */
function normalizeRow(row) {
  const merchantRaw = String(row?.merchantRaw ?? "").trim();
  if (!merchantRaw) return { valid: false, reason: "Missing merchant/description." };
  if (merchantRaw.length > MERCHANT_MAX) {
    return { valid: false, reason: `Merchant text longer than ${MERCHANT_MAX} characters.` };
  }

  const dateStr = String(row?.postedDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, reason: `"${dateStr}" isn't a YYYY-MM-DD date.` };
  }
  const dateMs = Date.parse(`${dateStr}T00:00:00Z`);
  // Date.parse silently rolls invalid days over instead of rejecting them
  // (e.g. "2026-02-30" becomes March 2) — reject anything that doesn't
  // round-trip back to the exact same Y-M-D.
  if (Number.isNaN(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== dateStr) {
    return { valid: false, reason: `"${dateStr}" isn't a real date.` };
  }
  if (dateMs < MIN_DATE_MS || dateMs > Date.now() + DAY_MS) {
    return { valid: false, reason: `${dateStr} is out of range.` };
  }

  const amountCents = Number(row?.amountCents);
  if (!Number.isInteger(amountCents) || Math.abs(amountCents) > AMOUNT_CENTS_MAX_ABS) {
    return { valid: false, reason: "Amount is missing or out of a sane range." };
  }

  return { valid: true, postedDate: dateStr, merchantRaw, amountCents };
}

/**
 * "TIM HORTONS #4821 TORONTO ON" -> "TIM HORTONS" — conservative cleanup.
 * Mirrors previewMerchant() in src/Pages/Budgetter/parsers.js; keep in sync.
 * merchant_raw is always stored alongside this, so over-stripping here never
 * loses data — it only makes the display name a little too tidy.
 */
function cleanMerchant(raw) {
  const original = String(raw || "").trim().replace(/\s+/g, " ");
  let s = original;
  // Payment-processor sub-merchant codes: "AMZN MKTP CA*SL3XG3FH3 866-216-1072" -> "AMZN MKTP CA"
  s = s.replace(/\*[A-Z0-9]{5,}\b.*$/i, "");
  // Trailing support/reference phone numbers: "FREEDOM MOBILE 877-946-3184" -> "FREEDOM MOBILE"
  s = s.replace(/\s*\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*$/, "");
  // Trailing store/reference numbers: "TIM HORTONS #4821" -> "TIM HORTONS"
  s = s.replace(/\s*#?\d{4,}\s*$/, "");
  s = s.trim();
  // A reference-only description ("#4821", a bare number) can strip to
  // nothing. Fall back to the raw text: an empty merchant_clean would
  // create a matches-everything category rule via applyToFuture and an
  // over-broad dedup key.
  return (s || original).toUpperCase();
}

/**
 * Stable per-user identity for a transaction, used for idempotent
 * re-uploads. `occurrence` disambiguates genuinely repeated rows in one
 * file (two identical coffees on the same day) — the Nth identical tuple
 * gets |N appended, so re-uploading the same statement still dedupes while
 * real same-day repeats are kept. The first occurrence omits the suffix so
 * hashes for existing single rows are unchanged.
 *
 * Note: the hash includes merchant_clean, so future cleanMerchant changes
 * re-key affected rows and can double-import on overlap — change it only
 * with that in mind (documented in BUDGETTER.md).
 */
function dedupHash(userId, accountId, postedDate, amountCents, merchantClean, occurrence = 0) {
  const suffix = occurrence > 0 ? `|${occurrence}` : "";
  return crypto
    .createHash("sha256")
    .update(`${userId}|${accountId}|${postedDate}|${amountCents}|${merchantClean}${suffix}`)
    .digest("hex");
}

// Built-in fallback rules for common (mostly Canadian) merchants, applied
// AFTER the user's own rules so a personal override always wins. Order
// matters within the list — first match wins (e.g. "UBER EATS" must precede
// "UBER"). Patterns match as substrings of the cleaned, uppercased merchant.
const DEFAULT_CATEGORY_RULES = [
  // Dining
  ["UBER EATS", "Dining"], ["TIM HORTONS", "Dining"], ["MCDONALD", "Dining"],
  ["STARBUCKS", "Dining"], ["SUBWAY", "Dining"], ["HARVEY", "Dining"],
  ["WENDY", "Dining"], ["A&W", "Dining"], ["KFC", "Dining"], ["BURGER", "Dining"],
  ["PIZZA", "Dining"], ["RESTAURANT", "Dining"], ["CAFE", "Dining"],
  ["COFFEE", "Dining"], ["BAKERY", "Dining"], ["OSMOW", "Dining"],
  ["CORA", "Dining"], ["CINNABON", "Dining"], ["DAIRY QUEEN", "Dining"],
  ["BOSTON PIZZA", "Dining"], ["MILK TEA", "Dining"], ["JAPADOG", "Dining"],
  // Groceries
  ["FRESHCO", "Groceries"], ["LOBLAW", "Groceries"], ["NO FRILLS", "Groceries"],
  ["SOBEYS", "Groceries"], ["FOOD BASICS", "Groceries"], ["COSTCO", "Groceries"],
  ["WALMART", "Groceries"], ["FARM BOY", "Groceries"], ["GIANT TIGER", "Groceries"],
  ["INDEPENDENT GROCER", "Groceries"], ["METRO", "Groceries"], ["MARKET", "Groceries"],
  // Transport (fuel/transit/rideshare)
  ["CANADIAN TIRE GAS", "Transport"], ["ESSO", "Transport"], ["SHELL", "Transport"],
  ["PETRO", "Transport"], ["ULTRAMAR", "Transport"], ["PIONEER", "Transport"],
  ["UBER", "Transport"], ["LYFT", "Transport"], ["PRESTO", "Transport"],
  ["GO TRANSIT", "Transport"],
  // Bills
  ["BELL CANADA", "Bills"], ["ROGERS", "Bills"], ["TELUS", "Bills"],
  ["FREEDOM MOBILE", "Bills"], ["FIDO", "Bills"], ["KOODO", "Bills"],
  ["HYDRO", "Bills"], ["ENBRIDGE", "Bills"], ["TOWNSHIP", "Bills"],
  ["INSURANCE", "Bills"],
  // Subscriptions
  ["NETFLIX", "Subscriptions"], ["SPOTIFY", "Subscriptions"],
  ["DISNEY", "Subscriptions"], ["CRAVE", "Subscriptions"],
  ["APPLE.COM/BILL", "Subscriptions"], ["GOOGLE ONE", "Subscriptions"],
  ["PRIME MEMBER", "Subscriptions"], ["YOUTUBE", "Subscriptions"],
  ["PATREON", "Subscriptions"], ["OPENAI", "Subscriptions"],
  ["ANTHROPIC", "Subscriptions"],
  // Shopping
  ["AMZN", "Shopping"], ["AMAZON", "Shopping"], ["WINNERS", "Shopping"],
  ["HOMESENSE", "Shopping"], ["MARSHALLS", "Shopping"], ["DOLLARAMA", "Shopping"],
  ["OLD NAVY", "Shopping"], ["H&M", "Shopping"], ["CANADIAN TIRE", "Shopping"],
  ["IKEA", "Shopping"], ["BEST BUY", "Shopping"], ["GOOGLE STORE", "Shopping"],
  ["THE BAY", "Shopping"], ["INDIGO", "Shopping"], ["SPORT CHEK", "Shopping"],
  // Entertainment
  ["CINEPLEX", "Entertainment"], ["STEAM", "Entertainment"],
  ["PLAYSTATION", "Entertainment"], ["NINTENDO", "Entertainment"],
  ["XBOX", "Entertainment"], ["TICKETMASTER", "Entertainment"],
  ["LANDMARK CINEMA", "Entertainment"],
  // Health
  ["SHOPPERS DRUG MART", "Health"], ["REXALL", "Health"], ["PHARMA", "Health"],
  ["DENTAL", "Health"], ["PHYSIO", "Health"], ["OPTOMETR", "Health"],
  ["GOODLIFE", "Health"],
  // Travel
  ["AIR CANADA", "Travel"], ["WESTJET", "Travel"], ["PORTER AIR", "Travel"],
  ["VIA RAIL", "Travel"], ["EXPEDIA", "Travel"], ["AIRBNB", "Travel"],
  ["BOOKING.COM", "Travel"], ["HOTEL", "Travel"], ["MOTEL", "Travel"],
  // Fees ("INTEREST CHARGES" needs its own entry — the \b matcher means the
  // singular pattern can't match the plural, which is how Triangle prints it)
  ["INTEREST CHARGE", "Fees"], ["INTEREST CHARGES", "Fees"], ["ANNUAL FEE", "Fees"],
  ["SERVICE CHARGE", "Fees"], ["NSF FEE", "Fees"],
  // Housing
  ["MORTGAGE", "Housing"], ["PROPERTY TAX", "Housing"], ["CONDO FEE", "Housing"],
  // Statement payments — transfers, not spending. Credits never count in
  // any total regardless of category; this label just keeps the list tidy.
  ["PAYMENT RECEIVED", "Payments"], ["PAYMENT - THANK YOU", "Payments"],
];

// Default rules match on WORD BOUNDARIES, not raw substrings — "ESSO" must
// not fire inside "ESPRESSO". Compiled once per warm instance.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DEFAULT_RULE_MATCHERS = DEFAULT_CATEGORY_RULES.map(([pattern, category]) => ({
  re: new RegExp(`\\b${escapeRegex(pattern)}\\b`),
  category,
}));

/**
 * First matching rule wins. The user's own rules run first (their overrides
 * always beat the built-ins) as substring matches — they're created from
 * full merchant_clean values, so substring is what the user asked for.
 * Built-in defaults then match on word boundaries. Callers must pass user
 * rules in a deterministic order (longest pattern first — see the ORDER BY
 * at each call site); empty patterns are skipped defensively since
 * "".includes matches everything.
 */
function categoryFor(merchantClean, rules) {
  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (merchantClean.includes(rule.pattern.toUpperCase())) return rule.category;
  }
  for (const { re, category } of DEFAULT_RULE_MATCHERS) {
    if (re.test(merchantClean)) return category;
  }
  return "uncategorized";
}

module.exports = {
  MAX_ROWS_PER_UPLOAD,
  MERCHANT_MAX,
  FILENAME_MAX,
  AMOUNT_CENTS_MAX_ABS,
  normalizeRow,
  cleanMerchant,
  dedupHash,
  categoryFor,
  DEFAULT_CATEGORY_RULES,
};
