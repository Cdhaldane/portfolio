// Line fixtures mirror a real July 2026 Triangle Mastercard statement,
// including the layout traps: the page-1 account summary (whose lines echo
// section names), the right-hand info column merging onto row lines, wrapped
// descriptions with the amount on either visual line, the Sport Chek
// re-itemization table, and the interest-rate table whose first row starts
// with the word "Purchases".
import {
  parseTriangleStatement,
  parseTdStatement,
  parseAmexStatement,
  parseStatementPdf,
} from "./pdf-parsers";

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

// Fixtures mirror a real June 2026 TD First Class Travel statement: one
// table flowing across pages with no section headings, page headers between
// row runs, right-hand info boxes (sometimes merged onto row lines), and
// the "CALCULATING YOUR BALANCE" box carrying the stated totals.
describe("parseTdStatement", () => {
  const row = (dates, desc, amount, extra = []) => ({
    text: `${dates[0]} ${dates[1]} ${desc} ${amount}${extra.length ? " " + extra.map((s) => s.text).join(" ") : ""}`,
    segments: [
      seg(dates[0], 47),
      seg(dates[1], 95),
      seg(desc, 140),
      seg(amount, 320),
      ...extra,
    ],
  });
  const frag = (text) => ({ text, segments: [seg(text, 140)] });
  const sidebar = (text) => ({ text, segments: [seg(text, 361)] });

  const TD_LINES = [
    { text: "TD FIRST CLASS TRAVEL CARD", segments: [seg("TD FIRST CLASS TRAVEL CARD", 47)] },
    "STATEMENT DATE: June 29, 2026 1 OF 5",
    "STATEMENT PERIOD: May 28, 2026 to June 29, 2026",
    { text: "TRANSACTION POSTING", segments: [seg("TRANSACTION POSTING", 49)] },
    { text: "DATE DATE ACTIVITY DESCRIPTION AMOUNT($)", segments: [seg("DATE", 49), seg("DATE", 97), seg("ACTIVITY DESCRIPTION", 140), seg("AMOUNT($)", 309)] },
    { text: "PREVIOUS STATEMENT BALANCE $607.64", segments: [seg("PREVIOUS STATEMENT BALANCE", 140), seg("$607.64", 314)] },
    // row with the info column merged onto its visual line
    row(["MAY 26", "MAY 28"], "SUBWAY 14653 PETERBOROUGH", "$11.02", [seg("Credit Limit", 361), seg("$6,000", 553)]),
    // wrapped description, info-box lines interleaved between
    row(["MAY 29", "JUN 1"], "WAL-MART SUPERCENTER#3071", "$64.12"),
    sidebar("The estimated time to pay your New Balance in full"),
    frag("PETERBOROUGH"),
    row(["MAY 29", "JUN 1"], "PAYMENT - THANK YOU", "-$634.99"),
    // mixed-case merchant, single-digit day
    row(["JUN 1", "JUN 2"], "TheChildrensPlace3260 PETERBOROUGH", "$15.73"),
    row(["JUN 9", "JUN 10"], "PULSE PHYSIOTHERAPY ON NORTH", "$90.00"),
    frag("VANCOU"),
    // stated totals in the right-hand box
    sidebar("CALCULATING YOUR BALANCE"),
    { text: "Payments & Credits $2,086.91", segments: [seg("Payments & Credits", 371), seg("$2,086.91", 538)] },
    { text: "Purchases & Other Charges $180.87", segments: [seg("Purchases & Other Charges", 371), seg("$180.87", 542)] },
    { text: "Continued", segments: [seg("Continued", 311)] },
    // next page header — must NOT be swallowed as a description fragment
    { text: "TD FIRST CLASS TRAVEL CARD", segments: [seg("TD FIRST CLASS TRAVEL CARD", 47)] },
    row(["JUN 26", "JUN 29"], "PAYMENT - THANK YOU", "-$1,451.92"),
    { text: "TOTAL NEW BALANCE $449.55", segments: [seg("TOTAL NEW BALANCE", 140), seg("$449.55", 320)] },
    // post-table offer pages: nothing below may become a row
    row(["JUN 30", "JUN 30"], "SHOULD NOT APPEAR", "$99.99"),
  ];

  const result = parseTdStatement(TD_LINES);

  it("parses the statement", () => {
    expect(result.ok).toBe(true);
  });

  it("finds the rows and stops at TOTAL NEW BALANCE", () => {
    expect(result.rows).toHaveLength(6);
    expect(result.rows.some((r) => r.merchantRaw.includes("SHOULD NOT APPEAR"))).toBe(false);
  });

  it("uses the transaction date with the period's year", () => {
    expect(result.rows[0].postedDate).toBe("2026-05-26");
    expect(result.rows[3].postedDate).toBe("2026-06-01");
  });

  it("keeps payments as negative amounts", () => {
    const payments = result.rows.filter((r) => r.amountCents < 0);
    expect(payments.map((r) => r.amountCents)).toEqual([-63499, -145192]);
  });

  it("joins wrapped fragments by description-column x, across info-box lines", () => {
    const walmart = result.rows.find((r) => r.merchantRaw.startsWith("WAL-MART"));
    expect(walmart.merchantRaw).toBe("WAL-MART SUPERCENTER#3071 PETERBOROUGH");
    const pulse = result.rows.find((r) => r.merchantRaw.startsWith("PULSE"));
    expect(pulse.merchantRaw).toBe("PULSE PHYSIOTHERAPY ON NORTH VANCOU");
  });

  it("never appends a page header as a description fragment", () => {
    expect(result.rows.some((r) => r.merchantRaw.includes("TRAVEL CARD"))).toBe(false);
  });

  it("ignores the previous-balance pseudo-row and merged info-column text", () => {
    expect(result.rows.some((r) => /607\.?64/.test(r.merchantRaw))).toBe(false);
    const subway = result.rows.find((r) => r.merchantRaw.startsWith("SUBWAY"));
    expect(subway.merchantRaw).toBe("SUBWAY 14653 PETERBOROUGH");
    expect(subway.amountCents).toBe(1102);
  });

  it("cross-checks both stated totals", () => {
    const purchases = result.checks.find((c) => c.key === "purchases");
    const payments = result.checks.find((c) => c.key === "payments");
    expect(purchases).toEqual(expect.objectContaining({ statedCents: 18087, parsedCents: 18087, ok: true }));
    expect(payments).toEqual(expect.objectContaining({ statedCents: -208691, parsedCents: -208691, ok: true }));
  });
});

// Fixtures mirror a real August 2026 Amex Cobalt statement (cardmember name
// swapped): the page-1 account summary, "Reference AT…" lines under
// payments, refunds negative inline among purchases, the page-3 header
// interleaving mid-section, the "Total of New Transactions for" line whose
// cardmember name wraps BELOW the amount, the membership fee under "Other
// Account Transactions", the interest-rate table whose first row starts with
// "Purchases", and the Membership Rewards re-itemization (numeric dates).
describe("parseAmexStatement", () => {
  const AMEX_LINES = [
    // -- page 1 --
    "American Express Cobalt Card",
    "Statement of Account",
    "Page 1 / 8",
    "Prepared For Account Number Opening Date Closing Date",
    "ALEX SAMPLE XXXX XXXXX4 81001 Jul 16, 2026 Aug 15, 2026",
    "ACCOUNT SUMMARY",
    "Previous Balance $1,065.63",
    "Less Payments $1,065.63",
    "Less Other Credits $0.00",
    "Plus Interest $0.00",
    "Plus Purchases $1,149.67",
    "Plus Fees $15.99",
    "Equals New Balance $1,165.66",
    "Minimum Amount Due on Sep 5, 2026 $10.00",
    "Statement includes payments and charges received by Aug 15, 2026",
    // -- page 2 --
    "Your Transactions",
    "Transaction Date Posting Date Details Amount ($)",
    "New Payments",
    "Jul 16 Jul 16 PAYMENT RECEIVED - THANK YOU -500.00",
    "Reference AT261970007000010015308",
    "Jul 24 Jul 24 PAYMENT RECEIVED - THANK YOU -565.63",
    "Reference AT262050007000010016507",
    "Total of Payment Activity -1,065.63",
    "New Transactions for ALEX SAMPLE",
    "Jul 16 Jul 17 SHEIN DISTRIBUTION CANA TORONTO -26.25",
    "Jul 17 Jul 18 AMZN MKTP CA*I32BC7R13 866-216-1072 79.09",
    "Jul 17 Jul 19 FOODLAND #3396 BOWMANVI ENNISMORE 15.37",
    "Jul 19 Jul 19 AMZN MKTP CA*VW1WW7MJ3 866-216-1072 20.87",
    "Jul 19 Jul 20 IKEA BURLINGTON BURLINGTON 293.62",
    "Jul 19 Jul 20 HOUSE FITNESS PETERBOROUGH 28.25",
    "Jul 20 Jul 21 AMZN MKTP CA*X324O8J83 866-216-1072 28.80",
    "Jul 24 Jul 24 AD FREE FOR PRIMEVIDEO PRIME VIDEO 3.38",
    "Jul 25 Jul 25 AIRWALXHK*STYLEVANA AIR HK 187.73",
    "Jul 26 Jul 27 WIKIPEDIA GIFT SAN FRANCISCO 2.75",
    "Jul 27 Jul 28 PARKHILL ANIMAL HOSPIT SELWYN 214.70",
    "Jul 31 Aug 1 AMAZON.CA PRIME MEMBER AMAZON.CA/PRI 5.64",
    "Aug 2 Aug 3 HOUSE FITNESS PETERBOROUGH 28.25",
    // -- page-3 header interleaves MID-SECTION and must not disturb it --
    "American Express Cobalt Card",
    "Statement of Account",
    "Page 3 / 8",
    "Prepared For Account Number Opening Date Closing Date",
    "ALEX SAMPLE XXXX XXXXX4 81001 Jul 16, 2026 Aug 15, 2026",
    "Your Transactions",
    "Transaction Date Posting Date Details Amount ($)",
    "Aug 3 Aug 4 AMZN MKTP CA*567JX5CB1 866-216-1072 25.98",
    "Aug 3 Aug 4 AMZN MKTP CA*561SL6LK0 866-216-1072 22.59",
    "Aug 3 Aug 4 AMZN MKTP CA*561O70ZI0 866-216-1072 19.20",
    "Aug 3 Aug 4 AMZN MKTP CA*563GK1FC2 866-216-1072 18.07",
    "Aug 4 Aug 6 FRESHCO #2927 PETERBORO PETERBOROUGH 47.25",
    "Aug 6 Aug 7 APPLE.COM/BILL TORONTO 3.35",
    "Aug 8 Aug 8 STATEMENT HOUSE Peterborough 33.90",
    "Aug 9 Aug 9 AMZN MKTP CA 866-216-1072 -22.59",
    "Aug 9 Aug 9 AMZN MKTP CA 866-216-1072 -25.98",
    "Aug 9 Aug 10 LOVISA 60308 PETERBOROUGH 86.98",
    "Aug 11 Aug 12 FLOWERTOWN CANNABIS INC BRIDGENORTH 21.46",
    "Aug 13 Aug 14 AMAZON.CA*5H4QL9S71 866-216-1072 9.03",
    "Aug 14 Aug 14 WAL-MART 3071 3071 PETERBOROUGH 20.35",
    "Aug 14 Aug 14 AMAZON.CA*5H0L68981 866-216-1072 7.88",
    // cardmember name wraps BELOW the total's visual line
    "Total of New Transactions for 1,149.67",
    "ALEX SAMPLE",
    "Other Account Transactions",
    "Aug 15 Aug 15 MEMBERSHIP FEE INSTALLMENT 15.99",
    "Total of Other Account Transactions 15.99",
    // -- pages 4-8: nothing below may contribute rows --
    "About Your Credit Limit",
    "About Your Interest Rates",
    "Purchases 0.0603% 0.00 21.99% 21.99% 25.99% 29.99%",
    "About Your Statement",
    "Membership Rewards",
    "Account Summary from 07/16/2026 to 08/15/2026",
    "07/19/2026 FOODLAND #3396 BOWMANVI ENNISMORE $15.37 77",
    "08/06/2026 FRESHCO #2927 PETERBORO PETERBOROUGH $47.25 236",
    "5 pts/$1 Eligible Food/Drink $62.62 313",
    "Your Offers and Account Information",
  ];

  const result = parseAmexStatement(AMEX_LINES);

  it("parses the statement", () => {
    expect(result.ok).toBe(true);
  });

  it("finds exactly the 30 real rows (2 payments + 27 transactions + 1 fee)", () => {
    expect(result.rows).toHaveLength(30);
  });

  it("takes the period from the Opening/Closing Date header", () => {
    expect(result.period.label).toBe("Jul 16, 2026 – Aug 15, 2026");
  });

  it("uses the transaction date with the period's year", () => {
    expect(result.rows[0].postedDate).toBe("2026-07-16");
    expect(result.rows.at(-1).postedDate).toBe("2026-08-15");
    const prime = result.rows.find((r) => r.merchantRaw.includes("PRIME MEMBER"));
    expect(prime.postedDate).toBe("2026-07-31");
  });

  it("keeps payments negative and untouched by their Reference lines", () => {
    const payments = result.rows.filter((r) => r.merchantRaw === "PAYMENT RECEIVED - THANK YOU");
    expect(payments.map((r) => r.amountCents)).toEqual([-50000, -56563]);
    expect(result.rows.some((r) => /reference|AT2619/i.test(r.merchantRaw))).toBe(false);
  });

  it("keeps refunds negative inline among purchases", () => {
    const shein = result.rows.find((r) => r.merchantRaw.startsWith("SHEIN"));
    expect(shein.amountCents).toBe(-2625);
  });

  it("imports the membership fee from Other Account Transactions", () => {
    const fee = result.rows.find((r) => r.merchantRaw === "MEMBERSHIP FEE INSTALLMENT");
    expect(fee.amountCents).toBe(1599);
  });

  it("cross-checks all three stated totals, including the wrapped-name one", () => {
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    const purchases = result.checks.find((c) => c.key === "purchases");
    expect(purchases.statedCents).toBe(114967);
    expect(purchases.parsedCents).toBe(114967);
    const payments = result.checks.find((c) => c.key === "payments");
    expect(payments.statedCents).toBe(-106563);
  });

  it("imports nothing from the rewards re-itemization or rate tables", () => {
    expect(result.rows.filter((r) => r.merchantRaw.includes("FOODLAND"))).toHaveLength(1);
    expect(result.rows.some((r) => /21\.99|Eligible/i.test(r.merchantRaw))).toBe(false);
  });

  it("assigns each side of a Dec→Jan statement its own year", () => {
    const wrap = parseAmexStatement([
      "American Express Cobalt Card",
      "ALEX SAMPLE XXXX XXXXX4 81001 Dec 16, 2026 Jan 15, 2027",
      "New Transactions for ALEX SAMPLE",
      "Dec 20 Dec 21 FRESHCO #2927 PETERBORO PETERBOROUGH 50.00",
      "Jan 3 Jan 4 TIM HORTONS #4821 PETERBOROUGH 5.25",
      "Total of New Transactions for 55.25",
    ]);
    expect(wrap.ok).toBe(true);
    expect(wrap.rows.map((r) => r.postedDate)).toEqual(["2026-12-20", "2027-01-03"]);
  });

  it("rejects a PDF with no opening/closing dates", () => {
    const other = parseAmexStatement(["Some other bank", "Jan 01 Jan 02 THING 5.00"]);
    expect(other.ok).toBe(false);
    expect(other.error).toMatch(/opening\/closing/i);
  });

  it("rejects an Amex-looking PDF with no readable rows", () => {
    const empty = parseAmexStatement([
      "ALEX SAMPLE XXXX XXXXX4 81001 Jul 16, 2026 Aug 15, 2026",
      "New Payments",
      "Total of Payment Activity 0.00",
    ]);
    expect(empty.ok).toBe(false);
  });
});

describe("parseStatementPdf (bank detection)", () => {
  it("routes Triangle statements by their period line", () => {
    const r = parseStatementPdf([
      "For the period: June 5, 2026 to July 4, 2026",
      "Purchases",
      "Jun 06 Jun 08 COSTCO WHOLESALE W591 119.83",
      "Total purchases $119.83",
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0].merchantRaw).toBe("COSTCO WHOLESALE W591");
  });

  it("routes TD statements by their period line", () => {
    const r = parseStatementPdf([
      "STATEMENT PERIOD: May 28, 2026 to June 29, 2026",
      "MAY 26 MAY 28 SUBWAY 14653 PETERBOROUGH $11.02",
      "TOTAL NEW BALANCE $11.02",
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0].merchantRaw).toBe("SUBWAY 14653 PETERBOROUGH");
  });

  it("routes Amex statements by their brand text", () => {
    const r = parseStatementPdf([
      "Amex Bank of Canada",
      "ALEX SAMPLE XXXX XXXXX4 81001 Jul 16, 2026 Aug 15, 2026",
      "New Transactions for ALEX SAMPLE",
      "Jul 19 Jul 20 IKEA BURLINGTON BURLINGTON 293.62",
      "Total of New Transactions for 293.62",
    ]);
    expect(r.ok).toBe(true);
    expect(r.rows[0].merchantRaw).toBe("IKEA BURLINGTON BURLINGTON");
  });

  it("rejects PDFs from unknown banks", () => {
    const r = parseStatementPdf(["Some Other Bank", "Jan 01 Jan 02 THING 5.00"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/recognize/i);
  });
});
