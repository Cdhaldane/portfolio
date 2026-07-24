// Line fixtures mirror a real July 2026 Triangle Mastercard statement,
// including the layout traps: the page-1 account summary (whose lines echo
// section names), the right-hand info column merging onto row lines, wrapped
// descriptions with the amount on either visual line, the Sport Chek
// re-itemization table, and the interest-rate table whose first row starts
// with the word "Purchases".
import { parseTriangleStatement } from "./pdf-parsers";

const seg = (text, x) => ({ x, text });

const STATEMENT_LINES = [
  "Your Triangle™ Mastercard Statement",
  "Statement date: July 4, 2026",
  "For the period: June 5, 2026 to July 4, 2026",
  // -- page 1 account summary: echoes section names, must import nothing --
  "Your account summary",
  "Balance from your last statement $585.47",
  "Payments received Jun 5 to Jul 4, 2026 -585.47",
  "Returns and other credits 0.00",
  "Total credits -$585.47",
  "Purchases 443.10",
  "Cash transactions 0.00",
  "Fees 0.00",
  "Interest charges 15.75",
  "Total charges $458.85",
  "Your New Balance $458.85",
  "Credit limit $1,000.00 Available credit $541.15",
  // -- page 2 transaction tables --
  "Details of your account summary",
  "Payments received - Jun 5 to Jul 4, 2026",
  "TRANSACTION DATE POSTING DATE TRANSACTION DESCRIPTION AMOUNT ($)",
  "Jun 26 Jun 29 BC CTRL CU PMT/PMT BC CTRL CU -585.47",
  "Total payments received -$585.47",
  "Purchases",
  "TRANSACTION DATE POSTING DATE TRANSACTION DESCRIPTION AMOUNT ($)",
  "Purchases - Card #5446 12XX XXXX 1678",
  // info column merged onto the row's visual line (real pdf.js behaviour)
  {
    text: "Jun 06 Jun 08 COSTCO WHOLESALE W591 119.83 Billing errors: If you believe an error has been made",
    segments: [
      seg("Jun 06", 100), seg("Jun 08", 140),
      seg("COSTCO WHOLESALE W591", 200), seg("119.83", 520),
      seg("Billing errors: If you believe an error has been made", 640),
    ],
  },
  // wrapped description sharing its line with more info-column prose
  {
    text: "PETERBOROUGH ON If your card has been stolen or lost: Please call us",
    segments: [
      seg("PETERBOROUGH ON", 200),
      seg("If your card has been stolen or lost: Please call us", 640),
    ],
  },
  "Jun 06 Jun 08 COSTCO GAS W591 PETERBOROUGH ON 77.88",
  "Jun 07 Jun 08 TACO BELL 6334 PETERBOROUGH ON 16.70",
  // wrap with the amount on the SECOND visual line
  "Jun 13 Jun 15 STEAMGAMES.COM 4259522 BELLEVUE",
  "WA 25.00",
  // wrap with the amount on the FIRST visual line
  "Jun 22 Jun 22 ENERCARE HOME SERVICES MARKHAM 29.23",
  "ON",
  "Jun 23 Jun 24 COSTCO WHOLESALE W591 10.72",
  "PETERBOROUGH ON",
  "Jun 23 Jun 25 MTO TSD SO PETERBOROUG 90.00",
  "PETERBOROUGH ON",
  "Jun 27 Jun 29 #298 SPORT CHEK PETERBOROUGH ON 47.45",
  "Jun 27 Jun 29 TACO BELL 6334 PETERBOROUGH ON 26.29",
  "Total purchases for 5446 12XX XXXX 1678 $443.10",
  "Total purchases $443.10",
  "Interest charges",
  "TRANSACTION DATE POSTING DATE TRANSACTION DESCRIPTION AMOUNT ($)",
  "Jul 04 Jul 04 INTEREST CHARGES 15.75",
  "Total interest charges $15.75",
  // -- page 3: neither table below may contribute rows --
  "Other details about your account",
  "Details of your interest charges",
  "Purchases 21.99% 0.06024% 15.75",
  "Cash Transactions and Fees 22.99% 0.06298% 0.00",
  "Total interest charges $15.75",
  "Details of your Sport Chek store purchases",
  "Jun 27 Jun 29 1 SC REUSABLE BAG SM 9 2.00",
  "1 MERCHANDISE 39.99",
  "PST 0.00",
  "GST/HST 5.46",
  "Total for transaction $47.45",
];

describe("parseTriangleStatement", () => {
  const result = parseTriangleStatement(STATEMENT_LINES);

  it("parses the statement", () => {
    expect(result.ok).toBe(true);
  });

  it("finds exactly the 11 real transactions (payment + 9 purchases + interest)", () => {
    expect(result.rows).toHaveLength(11);
  });

  it("infers the year from the statement period", () => {
    expect(result.rows[0].postedDate).toBe("2026-06-26");
    expect(result.rows.at(-1).postedDate).toBe("2026-07-04");
  });

  it("keeps the payment as a negative (credit) amount", () => {
    const payment = result.rows.find((r) => r.merchantRaw.includes("BC CTRL CU"));
    expect(payment.amountCents).toBe(-58547);
  });

  it("ignores the info column merged onto a row's line", () => {
    const costco = result.rows.find((r) => r.amountCents === 11983);
    expect(costco.merchantRaw).toBe("COSTCO WHOLESALE W591 PETERBOROUGH ON");
  });

  it("joins a wrapped description when the amount is on the second line", () => {
    const steam = result.rows.find((r) => r.merchantRaw.startsWith("STEAMGAMES"));
    expect(steam.merchantRaw).toBe("STEAMGAMES.COM 4259522 BELLEVUE WA");
    expect(steam.amountCents).toBe(2500);
    expect(steam.postedDate).toBe("2026-06-13");
  });

  it("joins a wrapped description when the amount is on the first line", () => {
    const enercare = result.rows.find((r) => r.merchantRaw.startsWith("ENERCARE"));
    expect(enercare.merchantRaw).toBe("ENERCARE HOME SERVICES MARKHAM ON");
  });

  it("excludes the Sport Chek itemization and interest-rate tables", () => {
    expect(result.rows.some((r) => r.merchantRaw.includes("REUSABLE BAG"))).toBe(false);
    expect(result.rows.some((r) => /21\.99/.test(r.merchantRaw))).toBe(false);
  });

  it("cross-checks every section total against the statement's own", () => {
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    const purchases = result.checks.find((c) => c.key === "purchases");
    expect(purchases.parsedCents).toBe(44310);
    expect(purchases.statedCents).toBe(44310);
  });

  it("keeps a wrapped fragment when info-column lines interleave (real page-2 geometry)", () => {
    const interleaved = parseTriangleStatement([
      "For the period: June 5, 2026 to July 4, 2026",
      { text: "Purchases", segments: [seg("Purchases", 34)] },
      {
        text: "Jun 06 Jun 08 COSTCO WHOLESALE W591 119.83 • excluding charges for optional products",
        segments: [
          seg("Jun 06 Jun 08 COSTCO WHOLESALE W591", 47),
          seg("119.83", 345),
          seg("• excluding charges for optional products", 383),
        ],
      },
      // info-column lines between the row and its wrapped fragment
      {
        text: "Bank or Affiliates (e.g. credit balance insurance for your account) after the",
        segments: [seg("Bank or Affiliates (e.g. credit balance insurance for your account) after the", 386)],
      },
      { text: "PETERBOROUGH ON", segments: [seg("PETERBOROUGH ON", 128)] },
      { text: "first month.", segments: [seg("first month.", 386)] },
      {
        text: "Jun 06 Jun 08 COSTCO GAS W591 PETERBOROUGH ON 77.88",
        segments: [seg("Jun 06 Jun 08 COSTCO GAS W591 PETERBOROUGH ON", 47), seg("77.88", 346)],
      },
      { text: "Total purchases $197.71", segments: [seg("Total purchases", 39), seg("$197.71", 323)] },
    ]);
    expect(interleaved.ok).toBe(true);
    expect(interleaved.rows[0].merchantRaw).toBe("COSTCO WHOLESALE W591 PETERBOROUGH ON");
    expect(interleaved.rows).toHaveLength(2);
  });

  it("assigns each side of a Dec→Jan statement its own year", () => {
    const wrap = parseTriangleStatement([
      "For the period: December 5, 2026 to January 4, 2027",
      "Purchases",
      "Dec 06 Dec 08 COSTCO WHOLESALE W591 PETERBOROUGH ON 50.00",
      "Jan 02 Jan 03 TIM HORTONS #4821 PETERBOROUGH ON 5.25",
      "Total purchases $55.25",
    ]);
    expect(wrap.ok).toBe(true);
    expect(wrap.rows.map((r) => r.postedDate)).toEqual(["2026-12-06", "2027-01-02"]);
  });

  it("rejects a PDF with no statement period", () => {
    const other = parseTriangleStatement(["Some other bank", "Jan 01 Jan 02 THING 5.00"]);
    expect(other.ok).toBe(false);
    expect(other.error).toMatch(/statement period/i);
  });

  it("rejects a Triangle-looking PDF with no readable rows", () => {
    const empty = parseTriangleStatement([
      "For the period: June 5, 2026 to July 4, 2026",
      "Purchases",
      "Total purchases $0.00",
    ]);
    expect(empty.ok).toBe(false);
  });
});
