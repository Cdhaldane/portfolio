// Merchant names here are the real cleaned descriptions a Kawartha /
// Libro chequing statement produces (see pdf-parsers.test.js for the PDF
// fixture they come from), so these tests are about the actual month of
// money that motivated the feature, not invented strings.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  chequingTreatment,
  chequingTreatments,
  matchDeclaredBill,
  labelTokens,
  CHEQUING_RULES,
} = require("./budget-chequing");

const CARD_PAYMENT = "ONLINE BILL PAYMENT CANADIAN TIRE MASTERCARD";
const CITI = "ONLINE BILL PAYMENT HOME DEPOT - CITI CARDS";
const WEEKLY = "WITHDRAWAL WEEKLY DEPOSIT FROM CHARLIE";
const TFR_OUT = "WITHDRAWAL MD TFR TO (…6011) CK";
const TFR_IN = "DEPOSIT TRANSFER FROM (…6011)";
const AVISO = "EXTERNAL WITHDRAWAL MISCELLANEOUS PAYMENTS AVISO FNCL";
const PAYROLL = "EXTERNAL DEPOSIT PAYROLL DEPOSIT NATIONAL SHUNT SERVICE LTD CPT";
const POS = "POINT OF SALE WITHDRAWAL ALMOST PERFECT";
const TOLLS = "ONLINE BILL PAYMENT 407 ETR";
const INSURANCE = "EXTERNAL WITHDRAWAL INSURANCE AVIVA INSURANCE (…9301) 10";
const LOAN = "EXTERNAL WITHDRAWAL MISCELLANEOUS PAYMENTS NSLSC (…7632)";

test("credit-card payments are excluded, not filed under the store", () => {
  // The Triangle statement's purchases are already imported; counting the
  // payment too would count that spending twice. And it must NOT land in
  // Shopping via the built-in "CANADIAN TIRE" rule.
  assert.deepEqual(chequingTreatment(CARD_PAYMENT), {
    category: "Card payment",
    countPct: 0,
    reason: "pays a credit card",
    pattern: "MASTERCARD",
  });
  assert.equal(chequingTreatment(CITI).countPct, 0);
  assert.equal(chequingTreatment(CITI).category, "Card payment");
});

test("internal transfers are excluded in both directions", () => {
  // ~$2,200/month of phantom spending if these counted.
  assert.equal(chequingTreatment(WEEKLY).category, "Transfers");
  assert.equal(chequingTreatment(WEEKLY).countPct, 0);
  assert.equal(chequingTreatment(TFR_OUT).countPct, 0);
  assert.equal(chequingTreatment(TFR_IN).countPct, 0);
  assert.equal(chequingTreatment(AVISO).countPct, 0);
  assert.match(chequingTreatment(AVISO).reason, /investment/);
});

test("payroll is labelled but left counting (it is a credit either way)", () => {
  const t = chequingTreatment(PAYROLL);
  assert.equal(t.category, "Income");
  assert.equal(t.countPct, 100);
});

test("real debit-card spending is left alone for the normal rules", () => {
  assert.equal(chequingTreatment(POS), null);
});

test("patterns match on word boundaries, not substrings", () => {
  // A real purchase at a merchant whose name merely contains a rule
  // pattern must stay ordinary spending.
  assert.equal(chequingTreatment("VISALIA FARM SUPPLY"), null);
  assert.equal(chequingTreatment("POS PURCHASE AMEXPRESSO CAFE"), null);
  assert.equal(chequingTreatment("TFSANDWICH SHOP"), null);
  // But the pattern on its own boundary does fire, whatever wording the
  // bank wraps it in.
  assert.equal(chequingTreatment("PAYMENT TO VISA").category, "Card payment");
});

test("known outflows get a sensible category but still count", () => {
  assert.deepEqual(
    { ...chequingTreatment(TOLLS) },
    { category: "Transport", countPct: 100, reason: "road tolls", pattern: "407 ETR" }
  );
  assert.equal(chequingTreatment(LOAN).category, "Bills");
  assert.equal(chequingTreatment(LOAN).countPct, 100);
});

test("every rule declares a category and a valid countPct", () => {
  for (const [pattern, category, countPct, reason] of CHEQUING_RULES) {
    assert.ok(pattern && typeof pattern === "string", `${pattern}: pattern`);
    assert.ok(category && typeof category === "string", `${pattern}: category`);
    assert.ok(Number.isInteger(countPct) && countPct >= 0 && countPct <= 100, `${pattern}: pct`);
    assert.ok(reason && typeof reason === "string", `${pattern}: reason`);
  }
});

// ---- declared-bill matching ----

const bill = (over) => ({
  id: 1,
  label: "407 ETR",
  category: "Transport",
  amount_cents: 54000,
  due_day: 28,
  start_month: "2026-01",
  end_month: null,
  on_card: false,
  ...over,
});

const row = (over) => ({
  postedDate: "2026-08-28",
  merchantClean: TOLLS,
  amountCents: 57386,
  ...over,
});

test("the bill's own words in the description are a high-confidence match", () => {
  const m = matchDeclaredBill(row(), [bill()]);
  assert.equal(m.confidence, "high");
  assert.equal(m.label, "407 ETR");
  assert.equal(m.declaredCents, 54000);
});

test("an exact amount matches even when the label shares no words", () => {
  const m = matchDeclaredBill(
    row({ merchantClean: INSURANCE, amountCents: 18749, postedDate: "2026-09-02" }),
    [bill({ id: 2, label: "Car insurance", category: "Bills", amount_cents: 18749, due_day: 2 })]
  );
  assert.equal(m.confidence, "high");
  assert.equal(m.label, "Car insurance");
});

test("a near amount needs the due day to agree before it counts as a match", () => {
  const declared = bill({ id: 2, label: "Car insurance", amount_cents: 18000, due_day: 2 });
  const near = row({ merchantClean: INSURANCE, amountCents: 18749, postedDate: "2026-09-02" });
  assert.equal(matchDeclaredBill(near, [declared]).confidence, "likely");
  // Same amounts, but the debit lands nowhere near the declared due day.
  assert.equal(
    matchDeclaredBill({ ...near, postedDate: "2026-09-17" }, [declared]),
    null
  );
});

test("a due day near the turn of the month still matches", () => {
  const declared = bill({ id: 3, label: "Hydro", amount_cents: 12000, due_day: 1 });
  const m = matchDeclaredBill(
    row({ merchantClean: "PREAUTH DEBIT UTILITY", amountCents: 12500, postedDate: "2026-08-29" }),
    [declared]
  );
  assert.equal(m.confidence, "likely");
});

test("bills outside their active window never match", () => {
  assert.equal(matchDeclaredBill(row(), [bill({ end_month: "2026-06" })]), null);
  assert.equal(matchDeclaredBill(row(), [bill({ start_month: "2026-10" })]), null);
});

test("on_card bills are skipped — their real charge arrives on a card", () => {
  assert.equal(matchDeclaredBill(row(), [bill({ on_card: true })]), null);
});

test("deposits are never treated as a bill payment", () => {
  assert.equal(
    matchDeclaredBill(row({ amountCents: -57386 }), [bill()]),
    null
  );
});

test("the most confident, closest bill wins when several could match", () => {
  const m = matchDeclaredBill(row({ amountCents: 54000 }), [
    bill({ id: 9, label: "Something else", amount_cents: 54000, due_day: 28 }),
    bill({ id: 7, label: "407 ETR", amount_cents: 99999, due_day: 1 }),
  ]);
  // Both are "high" (one by exact amount, one by label), so the tie breaks
  // on the smaller amount delta.
  assert.equal(m.recurringId, 9);
});

test("a matched bill is excluded and credited to the bill by name", () => {
  const [treatment] = chequingTreatments([row()], [bill()]);
  assert.equal(treatment.countPct, 0);
  assert.equal(treatment.category, "Transport");
  assert.match(treatment.reason, /407 ETR/);
  assert.equal(treatment.billMatch.confidence, "high");
});

test("a bill match beats the pattern rules for the same row", () => {
  // "407 ETR" has a pattern rule that would count it; the declared bill
  // takes precedence, because the dashboard already counts that bill.
  const [withBill] = chequingTreatments([row()], [bill()]);
  const [without] = chequingTreatments([row()], []);
  assert.equal(withBill.countPct, 0);
  assert.equal(without.countPct, 100);
  assert.equal(without.category, "Transport");
});

test("the whole real statement classifies as expected", () => {
  const rows = [
    { postedDate: "2026-08-07", merchantClean: AVISO, amountCents: 2500 },
    { postedDate: "2026-08-07", merchantClean: WEEKLY, amountCents: 50000 },
    { postedDate: "2026-08-07", merchantClean: TFR_IN, amountCents: -2500 },
    { postedDate: "2026-08-08", merchantClean: TFR_OUT, amountCents: 6290 },
    { postedDate: "2026-08-12", merchantClean: PAYROLL, amountCents: -99965 },
    { postedDate: "2026-08-13", merchantClean: CARD_PAYMENT, amountCents: 110570 },
    { postedDate: "2026-08-26", merchantClean: POS, amountCents: 1481 },
    { postedDate: "2026-08-27", merchantClean: CITI, amountCents: 10000 },
    { postedDate: "2026-08-28", merchantClean: TOLLS, amountCents: 57386 },
    { postedDate: "2026-08-31", merchantClean: LOAN, amountCents: 22509 },
    { postedDate: "2026-09-02", merchantClean: INSURANCE, amountCents: 18749 },
  ];
  const bills = [
    bill(),
    bill({ id: 2, label: "Car insurance", category: "Bills", amount_cents: 18749, due_day: 2 }),
  ];
  const treatments = chequingTreatments(rows, bills);
  const counted = rows.filter((r, i) => treatments[i].countPct > 0 && r.amountCents > 0);

  // Of eleven rows, the only money the dashboard should call spending is
  // the one real debit-card purchase and the student loan payment.
  assert.deepEqual(
    counted.map((r) => r.amountCents),
    [1481, 22509]
  );
  // Everything else is imported but excluded, with a reason to show.
  assert.ok(treatments.filter((t) => t.countPct === 0).length === 8);
  assert.ok(treatments.every((t) => t.countPct === 100 || t.reason));
});

test("labelTokens drops filler so a bill label can still match", () => {
  assert.deepEqual(labelTokens("The monthly hydro bill"), ["HYDRO"]);
  assert.deepEqual(labelTokens("407 ETR"), ["407", "ETR"]);
  assert.deepEqual(labelTokens("Payment"), []);
});

test("a label of pure filler never matches everything", () => {
  // labelTokens() empties out, so labelHit must be false rather than
  // vacuously true — otherwise one badly named bill would swallow the
  // whole statement.
  const m = matchDeclaredBill(row({ amountCents: 999 }), [
    bill({ label: "monthly payment", amount_cents: 54000, due_day: 1 }),
  ]);
  assert.equal(m, null);
});
