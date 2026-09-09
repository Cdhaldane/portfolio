// End-to-end import test for a chequing statement: the real PDF fixture
// through the real parser, then through the *actual server modules* that
// classify it (required straight out of api/_lib — there is no mirrored
// copy to drift). It asserts the one number the whole feature exists for:
// how much of a bank statement the dashboard should call spending.
//
// The month in the fixture moves $4,894.85 out of the account. Almost none
// of that is spending — it's a credit-card payment for charges already
// imported from the card's own statement, weekly transfers to a joint
// account, weekly investment contributions, and two bills the household
// already declares in the Income & bills tab. Import it naively and the
// dashboard invents thousands of dollars of spending that never happened.
import { parseKawarthaStatement } from "./pdf-parsers";
import { KAWARTHA_LINES } from "./__fixtures__/kawarthaStatement";

const { cleanMerchant, categoryFor } = require("../../../api/_lib/budget-normalize");
const {
  chequingTreatments,
  CHEQUING_MATCHERS,
} = require("../../../api/_lib/budget-chequing");

// What the household has declared in the Income & bills tab. 407 ETR is
// declared at an estimate ($540 vs the real $573.86); the insurance is
// declared at the exact amount.
const DECLARED_BILLS = [
  {
    id: 1,
    label: "407 ETR",
    category: "Transport",
    amount_cents: 54000,
    due_day: 28,
    start_month: "2026-01",
    end_month: null,
    on_card: false,
  },
  {
    id: 2,
    label: "Car insurance",
    category: "Bills",
    amount_cents: 18749,
    due_day: 2,
    start_month: "2026-01",
    end_month: null,
    on_card: false,
  },
];

/**
 * Mirrors the pipeline in api/_lib/handlers/upload.js: clean the merchant,
 * work out the treatment, then pick the category with user rules first,
 * chequing rules second, built-in merchant defaults last.
 */
function importStatement(rows, bills, userRules = []) {
  const candidates = rows.map((r) => ({
    postedDate: r.postedDate,
    merchantClean: cleanMerchant(r.merchantRaw),
    amountCents: r.amountCents,
  }));
  const treatments = chequingTreatments(candidates, bills);
  return candidates.map((row, i) => {
    const t = treatments[i];
    return {
      ...row,
      category: t.billMatch
        ? t.category
        : categoryFor(row.merchantClean, userRules, CHEQUING_MATCHERS),
      countPct: t.countPct,
      reason: t.reason,
      billMatch: t.billMatch,
    };
  });
}

// What the dashboard counts: positive amounts only (a credit is never
// spend), weighted by count_pct.
const spendCents = (imported) =>
  imported.reduce(
    (sum, r) => (r.amountCents > 0 ? sum + Math.round((r.amountCents * r.countPct) / 100) : sum),
    0
  );

describe("importing a real chequing statement", () => {
  const parsed = parseKawarthaStatement(KAWARTHA_LINES);
  const imported = importStatement(parsed.rows, DECLARED_BILLS);

  test("the parser hands over a clean, reconciled statement", () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.every((c) => c.ok)).toBe(true);
    expect(parsed.chainMismatches).toEqual([]);
    expect(imported).toHaveLength(26);
  });

  test("$4,894.85 of debits is only $239.90 of actual spending", () => {
    // Every debit on the statement, in Budgetter's money-out sign.
    const allDebits = imported
      .filter((r) => r.amountCents > 0)
      .reduce((s, r) => s + r.amountCents, 0);
    expect(allDebits).toBe(489485);

    // …of which this is the only money genuinely spent: one debit-card
    // purchase and one student-loan payment.
    expect(spendCents(imported)).toBe(23990);
    expect(
      imported
        .filter((r) => r.amountCents > 0 && r.countPct > 0)
        .map((r) => [r.merchantClean, r.amountCents, r.category])
    ).toEqual([
      ["POINT OF SALE WITHDRAWAL ALMOST PERFECT", 1481, "uncategorized"],
      ["EXTERNAL WITHDRAWAL MISCELLANEOUS PAYMENTS NSLSC (…7632)", 22509, "Bills"],
    ]);
  });

  test("the credit-card payment does not double-count the card's charges", () => {
    const payments = imported.filter((r) => r.category === "Card payment");
    expect(payments.map((r) => r.amountCents)).toEqual([110570, 10000]);
    expect(payments.every((r) => r.countPct === 0)).toBe(true);
    // And specifically NOT filed under the store via the built-in
    // "CANADIAN TIRE" -> Shopping rule.
    expect(imported.some((r) => r.category === "Shopping")).toBe(false);
  });

  test("transfers to the joint account and investments are held back", () => {
    const transfers = imported.filter((r) => r.category === "Transfers");
    // 5 weekly $500 transfers, 5 weekly $25 investment contributions, one
    // $62.90 transfer out, and 5 transfers in.
    expect(transfers).toHaveLength(16);
    expect(transfers.every((r) => r.countPct === 0)).toBe(true);
    const wouldHaveBeenSpend = transfers
      .filter((r) => r.amountCents > 0)
      .reduce((s, r) => s + r.amountCents, 0);
    expect(wouldHaveBeenSpend).toBe(268790); // $2,687.90 of phantom spending

    // Regression: the Aug 28 $500.00 transfer lands on the 28th, which is
    // also the declared due day of a $540 toll bill. Fuzzy amount+date
    // matching used to claim it as that bill — mislabelling a transfer, and
    // proving the same coincidence could hide a real purchase.
    const aug28 = transfers.find(
      (r) => r.postedDate === "2026-08-28" && r.amountCents === 50000
    );
    expect(aug28).toBeDefined();
    expect(aug28.billMatch).toBeNull();
  });

  test("declared bills are matched and excluded, at an estimate or exactly", () => {
    const matched = imported.filter((r) => r.billMatch);
    expect(
      matched.map((r) => [r.billMatch.label, r.amountCents, r.billMatch.confidence])
    ).toEqual([
      // Named in the description, so matched despite the $540 estimate.
      ["407 ETR", 57386, "high"],
      // Nothing in common with "Car insurance", but exact to the cent.
      ["Car insurance", 18749, "high"],
    ]);
    expect(matched.every((r) => r.countPct === 0)).toBe(true);
    expect(matched.map((r) => r.category)).toEqual(["Transport", "Bills"]);
  });

  test("without those bills declared, the same rows count as real spending", () => {
    // The point of matching: it defers to what the household declared. Take
    // the declarations away and the money has to be counted somewhere.
    const undeclared = importStatement(parsed.rows, []);
    expect(spendCents(undeclared)).toBe(23990 + 57386 + 18749);
    expect(undeclared.find((r) => r.merchantClean.includes("407 ETR")).category).toBe("Transport");
  });

  test("pay is labelled as income and never counts as spending", () => {
    const pay = imported.filter((r) => r.category === "Income");
    expect(pay).toHaveLength(4);
    // Credits, so they fall out of the spend total by sign alone —
    // budget_income stays the source of truth for what comes in.
    expect(pay.every((r) => r.amountCents < 0)).toBe(true);
    expect(spendCents(pay)).toBe(0);
  });

  test("a stale personal rule cannot resurrect a double-count", () => {
    // A user rule beats the chequing rules on the LABEL — that's by design.
    // It must not touch count_pct, or one old "CANADIAN TIRE -> Shopping"
    // rule would quietly re-count a $1,105.70 card payment as shopping.
    const withRule = importStatement(parsed.rows, DECLARED_BILLS, [
      { pattern: "CANADIAN TIRE", category: "Shopping" },
    ]);
    const payment = withRule.find((r) => r.amountCents === 110570);
    expect(payment.category).toBe("Shopping");
    expect(payment.countPct).toBe(0);
    expect(spendCents(withRule)).toBe(23990);
  });

  test("every held-back row can explain itself to the user", () => {
    for (const row of imported.filter((r) => r.countPct === 0)) {
      expect(typeof row.reason).toBe("string");
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });
});
