// The planner's numbers are the whole feature — if the amortization or the
// affordability limits are wrong, the chart is a confident lie. Payment
// figures below are cross-checked against a standard loan calculator.
import {
  paymentFor,
  principalFor,
  amortize,
  purchaseCosts,
  spendBaseline,
  paymentLimits,
  affordablePrice,
  verdict,
  downPaymentRunway,
} from "./loan";

describe("paymentFor", () => {
  it("matches a standard amortization table", () => {
    // $25,000 @ 6.9% over 60 months = $493.85/mo
    expect(paymentFor(2500000, 690, 60)).toBe(49385);
    // $30,000 @ 4.99% over 72 months = $483.01/mo
    expect(paymentFor(3000000, 499, 72)).toBe(48301);
  });

  it("divides evenly at 0%", () => {
    expect(paymentFor(1200000, 0, 48)).toBe(25000);
  });

  it("rounds a 0% loan UP so the term still covers it", () => {
    // $1,000.00 over 3 months: 333.34 + 333.33 + 333.33
    expect(paymentFor(100000, 0, 3)).toBe(33334);
  });

  it("is zero when there's nothing to finance", () => {
    expect(paymentFor(0, 690, 60)).toBe(0);
    expect(paymentFor(-500, 690, 60)).toBe(0);
    expect(paymentFor(2500000, 690, 0)).toBe(0);
  });
});

describe("principalFor", () => {
  it("inverts paymentFor", () => {
    const principal = principalFor(49385, 690, 60);
    // Back within a dollar of the loan that produces this payment (a whole
    // cent of payment is worth ~50c of principal at this term).
    expect(Math.abs(principal - 2500000)).toBeLessThanOrEqual(100);
    expect(paymentFor(principal, 690, 60)).toBe(49385);
  });

  it("is payment x term at 0%", () => {
    expect(principalFor(25000, 0, 48)).toBe(1200000);
  });
});

describe("amortize", () => {
  const loan = amortize(2500000, 690, 60);

  it("runs the full term and lands exactly on zero", () => {
    expect(loan.months).toBe(60);
    expect(loan.rows[59].balance).toBe(0);
  });

  it("keeps totalPaid - principal === totalInterest", () => {
    expect(loan.totalPaid - 2500000).toBe(loan.totalInterest);
  });

  it("charges interest on the opening balance, then less each month", () => {
    // 25,000 x 6.9%/12 = 143.75 in month one.
    expect(loan.rows[0].interest).toBe(14375);
    expect(loan.rows[1].interest).toBeLessThan(loan.rows[0].interest);
    expect(loan.rows[59].interest).toBeLessThan(loan.rows[0].interest);
  });

  it("splits every payment into interest + principal", () => {
    for (const row of loan.rows) {
      expect(row.interest + row.principal).toBe(row.payment);
    }
  });

  it("totals about $4,631 of interest on a 25k/6.9%/60 loan", () => {
    expect(Math.round(loan.totalInterest / 100)).toBe(4631);
  });

  it("handles a 0% loan", () => {
    const free = amortize(100000, 0, 3);
    expect(free.totalInterest).toBe(0);
    expect(free.totalPaid).toBe(100000);
    expect(free.rows.at(-1).balance).toBe(0);
  });

  it("has nothing to schedule for a cash purchase", () => {
    expect(amortize(0, 690, 60).rows).toHaveLength(0);
  });
});

describe("purchaseCosts", () => {
  it("taxes the sticker price, then subtracts cash and trade-in", () => {
    const c = purchaseCosts({
      priceCents: 2800000,
      taxBps: 1300,
      downCents: 500000,
      tradeInCents: 300000,
    });
    expect(c.taxCents).toBe(364000); // 13% of 28,000
    expect(c.allInCents).toBe(3164000);
    expect(c.financedCents).toBe(2364000);
    expect(Math.round(c.downPct)).toBe(25);
  });

  it("never finances a negative amount", () => {
    const c = purchaseCosts({ priceCents: 500000, taxBps: 1300, downCents: 900000 });
    expect(c.financedCents).toBe(0);
    expect(c.cashDownCents).toBe(565000); // clamped to the all-in price
  });
});

describe("spendBaseline", () => {
  const rows = [
    { key: "2026-02", income: 500000, card: 200000, fixed: 180000 },
    { key: "2026-03", income: 500000, card: 260000, fixed: 180000 },
    { key: "2026-04", income: 500000, card: 220000, fixed: 180000 },
  ];

  it("averages income, spend and surplus", () => {
    const b = spendBaseline(rows);
    expect(b.avgIncome).toBe(500000);
    expect(b.avgCard).toBe(226667);
    expect(b.avgOutflow).toBe(406667);
    expect(b.avgSurplus).toBe(93333);
    expect(b.hasIncome).toBe(true);
  });

  it("finds the leanest month, not the average one", () => {
    expect(spendBaseline(rows).leanest.key).toBe("2026-03");
    expect(spendBaseline(rows).leanest.surplus).toBe(60000);
  });

  it("reports no surplus at all when income isn't on file", () => {
    const b = spendBaseline([{ key: "2026-04", income: 0, card: 220000, fixed: 180000 }]);
    expect(b.hasIncome).toBe(false);
    expect(b.avgSurplus).toBe(null);
    expect(b.avgOutflow).toBe(400000);
  });

  it("survives an empty window", () => {
    const b = spendBaseline([]);
    expect(b.monthCount).toBe(0);
    expect(b.avgOutflow).toBe(0);
    expect(b.leanest).toBe(null);
  });
});

describe("paymentLimits", () => {
  it("tiers the spare cash and applies the 10%-of-income rule", () => {
    const l = paymentLimits({ avgIncome: 600000, avgSurplus: 200000 });
    expect(l.comfortable).toBe(100000);
    expect(l.stretch).toBe(150000);
    expect(l.ceiling).toBe(200000);
    expect(l.ruleOfThumb).toBe(60000);
    // Rule of thumb bites first here.
    expect(l.recommended).toBe(60000);
  });

  it("recommends half the surplus when that's the tighter number", () => {
    const l = paymentLimits({ avgIncome: 1000000, avgSurplus: 100000 });
    expect(l.recommended).toBe(50000);
  });

  it("recommends nothing when the household is already overspending", () => {
    const l = paymentLimits({ avgIncome: 400000, avgSurplus: -50000 });
    expect(l.comfortable).toBe(0);
    expect(l.ceiling).toBe(0);
    expect(l.recommended).toBe(0);
  });

  it("is unknown without income", () => {
    expect(paymentLimits({ avgIncome: 0, avgSurplus: null }).known).toBe(false);
  });
});

describe("affordablePrice", () => {
  it("turns a monthly limit into a sticker price", () => {
    // $700/mo total, $325 of it running costs -> $375 for the loan.
    const price = affordablePrice({
      limitCents: 70000,
      runningCents: 32500,
      aprBps: 690,
      termMonths: 60,
      cashCents: 500000,
      taxBps: 1300,
    });
    // Re-derive: that price + tax − cash should need ~$375/mo.
    const { financedCents } = purchaseCosts({
      priceCents: price,
      taxBps: 1300,
      downCents: 500000,
    });
    expect(Math.abs(paymentFor(financedCents, 690, 60) - 37500)).toBeLessThanOrEqual(50);
  });

  it("falls back to cash-only when running costs eat the whole limit", () => {
    const price = affordablePrice({
      limitCents: 20000,
      runningCents: 30000,
      cashCents: 226000,
      taxBps: 1300,
    });
    expect(price).toBe(200000); // $2,000 + 13% tax = the $2,260 on hand
  });

  it("is null when there's no limit to work from", () => {
    expect(affordablePrice({ limitCents: null })).toBe(null);
  });
});

describe("verdict", () => {
  const limits = paymentLimits({ avgIncome: 800000, avgSurplus: 200000 }); // rec 80000
  const leanest = 60000;

  it("fits under the recommendation", () => {
    const v = verdict({ totalMonthlyCents: 50000, limits, leanestSurplus: leanest });
    expect(v.level).toBe("fits");
    expect(v.room).toBe(30000);
    expect(v.dipsInLeanMonth).toBe(false);
  });

  it("is tight between the recommendation and the ceiling", () => {
    const v = verdict({ totalMonthlyCents: 120000, limits, leanestSurplus: leanest });
    expect(v.level).toBe("tight");
    expect(v.overBy).toBe(40000);
    expect(v.dipsInLeanMonth).toBe(true);
  });

  it("is over past the ceiling", () => {
    expect(verdict({ totalMonthlyCents: 250000, limits, leanestSurplus: leanest }).level).toBe("over");
  });

  it("flags a payment that only the average month can absorb", () => {
    const v = verdict({ totalMonthlyCents: 70000, limits, leanestSurplus: leanest });
    expect(v.level).toBe("fits");
    expect(v.dipsInLeanMonth).toBe(true);
  });
});

describe("downPaymentRunway", () => {
  it("rounds up to whole months of saving", () => {
    expect(downPaymentRunway(500000, 200000)).toBe(3);
    expect(downPaymentRunway(400000, 200000)).toBe(2);
  });

  it("is instant with no down payment", () => {
    expect(downPaymentRunway(0, 200000)).toBe(0);
  });

  it("is unknowable without a surplus", () => {
    expect(downPaymentRunway(500000, null)).toBe(null);
    expect(downPaymentRunway(500000, -100)).toBe(null);
  });
});
