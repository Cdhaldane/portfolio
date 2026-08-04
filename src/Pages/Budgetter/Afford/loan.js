/*
 * Purchase-planner math — loan amortization plus "what monthly payment can
 * this household actually carry?".
 *
 * Every function here is pure and works in the app's storage units: integer
 * CENTS for money and BASIS POINTS for rates (690 bps = 6.9%), so nothing
 * drifts through a float and the numbers can be unit-tested without a DOM,
 * a database or a Clerk session. Dollars and percentages exist only at the
 * form/display edge, exactly like the rest of Budgetter.
 */

/** Monthly interest rate as a float. 690 bps (6.9% APR) -> 0.00575 */
export const monthlyRate = (aprBps) => aprBps / 10000 / 12;

/**
 * The level payment that clears `principalCents` in exactly `termMonths`.
 * Standard amortization: P = L·r / (1 − (1+r)^−n), with the 0% case falling
 * back to plain division (rounded UP so n payments always cover the loan).
 */
export function paymentFor(principalCents, aprBps, termMonths) {
  if (!(principalCents > 0) || !(termMonths > 0)) return 0;
  const r = monthlyRate(aprBps);
  if (r <= 0) return Math.ceil(principalCents / termMonths);
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -termMonths)));
}

/**
 * The inverse — the largest loan a given monthly payment can carry. This is
 * what turns "you can afford $450/month" into "…which is about $23,000 of
 * car", the number someone actually shops with.
 */
export function principalFor(paymentCents, aprBps, termMonths) {
  if (!(paymentCents > 0) || !(termMonths > 0)) return 0;
  const r = monthlyRate(aprBps);
  if (r <= 0) return paymentCents * termMonths;
  return Math.floor((paymentCents * (1 - Math.pow(1 + r, -termMonths))) / r);
}

/**
 * Month-by-month schedule. Interest accrues on the outstanding balance, so
 * the split between interest and principal moves every month even though the
 * payment doesn't — that shift is the thing worth visualizing.
 *
 * The final payment absorbs rounding drift (it pays off whatever is left
 * rather than overshooting into a negative balance), which is what a real
 * lender does and keeps `totalPaid − principal === totalInterest` exact.
 */
export function amortize(principalCents, aprBps, termMonths) {
  const payment = paymentFor(principalCents, aprBps, termMonths);
  const r = monthlyRate(aprBps);
  const rows = [];
  let balance = principalCents;
  let cumPaid = 0;
  let cumInterest = 0;

  // Bounded by termMonths, so a pathological rate can't spin forever.
  for (let n = 1; n <= termMonths && balance > 0; n++) {
    const interest = r > 0 ? Math.round(balance * r) : 0;
    let principal = payment - interest;
    let paid = payment;
    // Last month (or a payment that would overshoot): settle the balance.
    if (principal >= balance || n === termMonths) {
      principal = balance;
      paid = balance + interest;
    }
    balance -= principal;
    cumPaid += paid;
    cumInterest += interest;
    rows.push({ n, payment: paid, interest, principal, balance, cumPaid, cumInterest });
  }

  return {
    payment,
    rows,
    months: rows.length,
    totalPaid: cumPaid,
    totalInterest: cumInterest,
  };
}

/**
 * What the whole purchase costs in cash, ignoring time.
 *   financed = price + tax − cash down − trade-in
 * Tax applies to the sticker price (Canadian provincial sales tax is charged
 * on the vehicle, not on what's left after the down payment).
 */
export function purchaseCosts({
  priceCents = 0,
  taxBps = 0,
  downCents = 0,
  tradeInCents = 0,
}) {
  const taxCents = Math.round((priceCents * taxBps) / 10000);
  const allIn = priceCents + taxCents;
  const cashDown = Math.min(downCents + tradeInCents, allIn);
  return {
    taxCents,
    allInCents: allIn,
    cashDownCents: cashDown,
    financedCents: Math.max(0, allIn - cashDown),
    // Lenders and the 20/4/10 rule of thumb both talk in "% down".
    downPct: allIn > 0 ? (cashDown / allIn) * 100 : 0,
  };
}

/**
 * Trailing-window baseline: what this household earns, spends and keeps in a
 * typical month. `rows` are newest-last, each { key, income, card, fixed }.
 *
 * `surplus` uses the same definition as the dashboard's "saved this month"
 * (income − card charges − off-card fixed bills) so the two surfaces can
 * never disagree about what spare money means.
 */
export function spendBaseline(rows) {
  const months = rows.map((row) => {
    const outflow = row.card + row.fixed;
    return { ...row, outflow, surplus: row.income > 0 ? row.income - outflow : null };
  });
  const n = months.length;
  const avg = (pick) =>
    n ? Math.round(months.reduce((sum, m) => sum + pick(m), 0) / n) : 0;
  const withIncome = months.filter((m) => m.surplus != null);
  // The leanest month is the honest stress test — an average hides the
  // December that ate every spare dollar.
  const leanest = withIncome.length
    ? withIncome.reduce((worst, m) => (m.surplus < worst.surplus ? m : worst))
    : null;

  return {
    months,
    monthCount: n,
    avgIncome: avg((m) => m.income),
    avgCard: avg((m) => m.card),
    avgFixed: avg((m) => m.fixed),
    avgOutflow: avg((m) => m.outflow),
    avgSurplus: withIncome.length
      ? Math.round(withIncome.reduce((s, m) => s + m.surplus, 0) / withIncome.length)
      : null,
    leanest,
    hasIncome: withIncome.length > 0,
  };
}

/**
 * Monthly limits for EVERYTHING a vehicle costs (loan payment + insurance +
 * fuel + maintenance), from the baseline above.
 *
 *   comfortable — half the spare cash: the car moves in, the savings habit
 *                 survives. This is the headline recommendation.
 *   stretch     — three quarters of it: doable, thinner cushion.
 *   ceiling     — every spare dollar. Above this the household saves nothing
 *                 and any bad month is funded by debt.
 *   ruleOfThumb — the 20/4/10 guideline's third number: all transportation
 *                 costs under 10% of income.
 *
 * `recommended` is deliberately the LOWER of comfortable and the rule of
 * thumb: a household with a huge surplus and modest income shouldn't be told
 * it can carry half its surplus in car costs just because the cash clears.
 */
export function paymentLimits({ avgIncome = 0, avgSurplus = null }) {
  const ruleOfThumb = Math.max(0, Math.round(avgIncome * 0.1));
  if (avgSurplus == null) {
    return { known: false, comfortable: null, stretch: null, ceiling: null, ruleOfThumb, recommended: null };
  }
  const spare = Math.max(0, avgSurplus);
  const comfortable = Math.round(spare * 0.5);
  return {
    known: true,
    comfortable,
    stretch: Math.round(spare * 0.75),
    ceiling: spare,
    ruleOfThumb,
    recommended: Math.min(comfortable, ruleOfThumb),
  };
}

/**
 * "So what car does that buy?" — turn a total monthly limit into a sticker
 * price, by subtracting the running costs, treating the rest as a loan
 * payment, and adding back the cash you're putting in.
 */
export function affordablePrice({
  limitCents,
  runningCents = 0,
  aprBps = 0,
  termMonths = 60,
  cashCents = 0,
  taxBps = 0,
}) {
  if (limitCents == null) return null;
  const forLoan = limitCents - runningCents;
  if (forLoan <= 0) {
    // Running costs alone already eat the limit — the affordable price is
    // whatever cash is on hand, nothing financed.
    return Math.max(0, Math.round((cashCents * 10000) / (10000 + taxBps)));
  }
  const allIn = principalFor(forLoan, aprBps, termMonths) + cashCents;
  return Math.max(0, Math.round((allIn * 10000) / (10000 + taxBps)));
}

/**
 * How the proposed purchase lands against the limits. Returns a level plus
 * the facts behind it — the UI always prints the reason in words, so the
 * verdict never rides on color alone.
 */
export function verdict({ totalMonthlyCents, limits, leanestSurplus }) {
  if (!limits.known) return { level: "unknown" };
  const { recommended, ceiling } = limits;
  const dipsInLeanMonth = leanestSurplus != null && totalMonthlyCents > leanestSurplus;
  if (totalMonthlyCents > ceiling) {
    return { level: "over", overBy: totalMonthlyCents - ceiling, dipsInLeanMonth };
  }
  if (totalMonthlyCents > recommended) {
    return { level: "tight", overBy: totalMonthlyCents - recommended, dipsInLeanMonth };
  }
  return { level: "fits", room: recommended - totalMonthlyCents, dipsInLeanMonth };
}

/**
 * Months of saving needed to reach the cash down payment, at the current
 * surplus. Answers "when could I actually do this?" — null when there's no
 * income on file or the household isn't saving anything.
 */
export function downPaymentRunway(downCents, avgSurplus) {
  if (!downCents) return 0;
  if (avgSurplus == null || avgSurplus <= 0) return null;
  return Math.ceil(downCents / avgSurplus);
}
