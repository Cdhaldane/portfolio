// Pure helpers for importing a CHEQUING/DEBIT statement, as opposed to a
// credit-card one. No DB or network calls — see budget-chequing.test.js.
//
// WHY THIS EXISTS
//
// A card statement is almost entirely spending: import every row and the
// dashboard is right. A bank-account statement is not. On a real month of
// one, most rows are money *moving* rather than money *spent*, and three
// kinds of row will actively corrupt the numbers if counted:
//
// 1. **Credit-card payments** ("Online Bill Payment Canadian Tire
//    Mastercard"). Those charges are already in Budgetter, imported from
//    the card's own statement. Counting the payment counts the same
//    spending twice.
// 2. **Internal transfers** ("Withdrawal Weekly deposit from Charlie" to a
//    joint account, "MD Tfr to …6011", weekly investment contributions).
//    The money hasn't left the household — it's savings. A $500 weekly
//    transfer would invent ~$2,200/month of spending that never happened,
//    and wreck the savings rate at the same time.
// 3. **Fixed bills already declared in the Income & bills tab** (407 ETR,
//    insurance, a loan payment). The dashboard already overlays the
//    declared amount onto every month it's active, so importing the real
//    debit on top double-counts the fixed costs.
//
// The first two are pattern work and handled here by CHEQUING_RULES. The
// third can't be — it depends on what this household actually declared — so
// matchDeclaredBills() compares each debit against the live budget_recurring
// rows and the upload's dry-run hands the user a per-row choice.
//
// This is the mirror image of the existing `on_card` rule (a declared bill
// billed to a tracked card is excluded from dashboard math because the real
// charge arrives by upload). Here the declared bill stays the source of
// truth and the imported duplicate is what gets excluded — same principle,
// opposite side, and the user picks per bill.
//
// EXCLUDING, NOT DROPPING: an excluded row is still imported, with
// count_pct = 0. amount_cents is never rewritten, so the real movement
// stays auditable and visible in the Transactions list with a 0% chip, and
// one click in the UI promotes it back to counting. Dropping rows instead
// would silently lose the bank's own record.

// Ordered; first match wins. Patterns are matched on WORD BOUNDARIES
// against merchant_clean (uppercased), the same way DEFAULT_CATEGORY_RULES
// in budget-normalize.js are — so "VISA" can't fire inside "VISALIA".
//
// countPct 0 = imported but excluded from every total. 100 = counts
// normally (still useful here for the *category*, which these rows would
// otherwise get wrong: a card-payment row must never be filed under the
// store's own name).
const CHEQUING_RULES = [
  // --- Credit-card payments: already imported from the card's statement ---
  ["MASTERCARD", "Card payment", 0, "pays a credit card"],
  ["VISA", "Card payment", 0, "pays a credit card"],
  ["AMERICAN EXPRESS", "Card payment", 0, "pays a credit card"],
  ["AMEX", "Card payment", 0, "pays a credit card"],
  ["CITI CARDS", "Card payment", 0, "pays a credit card"],
  ["CREDIT CARD", "Card payment", 0, "pays a credit card"],
  ["CAPITAL ONE", "Card payment", 0, "pays a credit card"],
  ["TRIANGLE", "Card payment", 0, "pays a credit card"],
  // --- Internal transfers and savings: money that hasn't left ---
  ["WEEKLY DEPOSIT FROM", "Transfers", 0, "moves money to another account"],
  ["TRANSFER FROM", "Transfers", 0, "moves money between your accounts"],
  ["TRANSFER TO", "Transfers", 0, "moves money between your accounts"],
  ["TFR FROM", "Transfers", 0, "moves money between your accounts"],
  ["TFR TO", "Transfers", 0, "moves money between your accounts"],
  ["OWN ACCOUNT", "Transfers", 0, "moves money between your accounts"],
  ["AVISO FNCL", "Transfers", 0, "an investment contribution, not spending"],
  ["TFSA", "Transfers", 0, "an investment contribution, not spending"],
  ["RRSP", "Transfers", 0, "an investment contribution, not spending"],
  ["RRIF", "Transfers", 0, "an investment contribution, not spending"],
  // --- Pay coming in. These are credits (negative here), so they already
  //     fall out of every spend total; the rule is about labelling them,
  //     and income itself stays declared in the Income & bills tab. ---
  ["PAYROLL", "Income", 100, "pay coming in"],
  ["DIRECT DEPOSIT", "Income", 100, "a deposit, not spending"],
  // --- Cash out: real money out, just not attributable to a merchant ---
  ["CASH WITHDRAWAL", "Cash", 100, "cash out of the account"],
  ["ATM WITHDRAWAL", "Cash", 100, "cash out of the account"],
  ["ABM WITHDRAWAL", "Cash", 100, "cash out of the account"],
  // --- Account fees and real outflows a card statement never shows ---
  ["MONTHLY PLAN FEE", "Fees", 100, "an account fee"],
  ["ACCOUNT FEE", "Fees", 100, "an account fee"],
  ["OVERDRAFT", "Fees", 100, "an account fee"],
  ["407 ETR", "Transport", 100, "road tolls"],
  ["NSLSC", "Bills", 100, "a student loan payment"],
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CHEQUING_MATCHERS = CHEQUING_RULES.map(([pattern, category, countPct, reason]) => ({
  pattern,
  re: new RegExp(`\\b${escapeRegex(pattern)}\\b`),
  category,
  countPct,
  reason,
}));

/**
 * How should this row of a chequing statement be treated? Returns
 * { category, countPct, reason, pattern } for a recognized row, or null to
 * leave it as ordinary spending for the normal category rules to label.
 */
function chequingTreatment(merchantClean) {
  const clean = String(merchantClean || "").toUpperCase();
  for (const m of CHEQUING_MATCHERS) {
    if (m.re.test(clean)) {
      return { category: m.category, countPct: m.countPct, reason: m.reason, pattern: m.pattern };
    }
  }
  return null;
}

// Words that carry no identifying signal in a bill label, so requiring them
// to appear in the statement description would sink every match.
const LABEL_STOPWORDS = new Set([
  "THE", "AND", "FOR", "MY", "OUR", "BILL", "BILLS", "PAYMENT", "PAYMENTS",
  "MONTHLY", "PAY", "ACCOUNT", "FEE", "AUTO",
]);

const labelTokens = (label) =>
  String(label || "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 2 && !LABEL_STOPWORDS.has(t));

const monthKey = (postedDate) => String(postedDate || "").slice(0, 7);

const billActiveIn = (bill, ym) =>
  !!ym &&
  String(bill.start_month || "") <= ym &&
  (!bill.end_month || ym <= String(bill.end_month));

// Circular distance in days, so a bill due on the 1st matches a debit on
// the 29th of the month before.
const dueDayDistance = (dueDay, postedDate) => {
  const day = Number(String(postedDate || "").slice(8, 10));
  if (!dueDay || !day) return null;
  const raw = Math.abs(dueDay - day);
  return Math.min(raw, 31 - raw);
};

/**
 * Does this debit look like a fixed bill the household already declared?
 *
 * Confidence is deliberately conservative, because a false match hides real
 * spending while a miss only double-counts something the user can see and
 * fix in the review table:
 *
 * - **high**: the bill's own words appear in the statement description
 *   ("407 ETR" in "Online Bill Payment 407 ETR"), or the amount matches the
 *   declared one to the cent in a month the bill is active. Either is
 *   decisive on its own.
 * - **likely**: the amount is within 5% (or $2) AND the debit lands within
 *   3 days of the declared due day. Two weak signals agreeing.
 * - no match otherwise. A near-miss amount alone is not enough — round
 *   numbers collide too easily.
 *
 * ⚠️ The "likely" window is deliberately tight. It exists for a bill whose
 * label shares no words with how the bank prints it ("Car insurance" vs
 * "AVIVA INSURANCE") and whose amount drifts a little month to month. Widen
 * it and it starts swallowing ordinary purchases that happen to land near a
 * due date for a similar amount — which HIDES real spending, the one
 * failure mode worse than double-counting, because nothing on screen says
 * it happened. A bill whose amount genuinely swings (a toll or hydro bill)
 * is matched by its label instead, which is exact.
 *
 * `on_card` bills are skipped: their real charges arrive on a card
 * statement, so a chequing debit resembling one is a coincidence.
 */
function matchDeclaredBill(row, bills) {
  if (!(row.amountCents > 0)) return null; // deposits are never a bill payment
  const ym = monthKey(row.postedDate);
  const clean = String(row.merchantClean || "").toUpperCase();

  let best = null;
  for (const bill of bills) {
    if (bill.on_card) continue;
    const declared = Number(bill.amount_cents);
    if (!Number.isFinite(declared) || declared <= 0) continue;
    if (!billActiveIn(bill, ym)) continue;

    const tokens = labelTokens(bill.label);
    const labelHit = tokens.length > 0 && tokens.every((t) => clean.includes(t));
    const delta = Math.abs(row.amountCents - declared);
    const exactAmount = delta === 0;
    const closeAmount = delta <= Math.max(200, Math.round(declared * 0.05));
    const distance = dueDayDistance(bill.due_day, row.postedDate);
    const dueNear = distance != null && distance <= 3;

    let confidence = null;
    if (labelHit || exactAmount) confidence = "high";
    else if (closeAmount && dueNear) confidence = "likely";
    if (!confidence) continue;

    const rank = confidence === "high" ? 0 : 1;
    if (!best || rank < best.rank || (rank === best.rank && delta < best.delta)) {
      best = {
        rank,
        delta,
        recurringId: bill.id,
        label: bill.label,
        category: bill.category || "Bills",
        declaredCents: declared,
        confidence,
      };
    }
  }
  if (!best) return null;
  const { rank, delta, ...match } = best;
  return match;
}

/**
 * Decide how every row of a chequing upload should be treated, combining
 * the pattern rules with declared-bill matching.
 *
 * Precedence, in order:
 *
 * 1. **A pattern rule that excludes the row wins outright.** A description
 *    that says TRANSFER or names a credit card has identified itself; it
 *    must not be second-guessed by a heuristic on amount and date. Skipping
 *    the match here is also what stops a real transfer from being labelled
 *    as somebody's bill — a $500.00 weekly transfer landing on the 28th
 *    otherwise looked exactly like a $540 toll bill due on the 28th.
 * 2. **Then a declared bill.** A household that declared "407 ETR" means
 *    it, and the dashboard already counts that declaration, so the imported
 *    duplicate is what gives way.
 * 3. **Then a pattern rule that only categorizes** (tolls, a loan payment,
 *    cash out) — real spending, just better labelled.
 * 4. Otherwise ordinary spending, left to the normal category rules.
 *
 * `rows` are candidates carrying { postedDate, merchantClean, amountCents }.
 * Returns one entry per row, in the same order.
 */
function chequingTreatments(rows, bills = []) {
  return rows.map((row) => {
    const treatment = chequingTreatment(row.merchantClean);
    if (treatment && treatment.countPct === 0) return { ...treatment, billMatch: null };

    const billMatch = matchDeclaredBill(row, bills);
    if (billMatch) {
      return {
        category: billMatch.category,
        countPct: 0,
        reason: `already covered by your "${billMatch.label}" bill`,
        billMatch,
      };
    }
    if (treatment) return { ...treatment, billMatch: null };
    return { category: null, countPct: 100, reason: null, billMatch: null };
  });
}

module.exports = {
  CHEQUING_RULES,
  CHEQUING_MATCHERS,
  chequingTreatment,
  chequingTreatments,
  matchDeclaredBill,
  labelTokens,
};
