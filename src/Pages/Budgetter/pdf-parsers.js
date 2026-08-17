// Pure statement-PDF parsing — Canadian Tire / Triangle Mastercard, TD, and
// American Express. Takes the *text lines* already extracted from the PDF
// (see pdf-extract.js, kept separate so this stays unit-testable without
// pdf.js) and returns the same {postedDate, merchantRaw, amountCents} rows
// the CSV path produces. Verified against a real July 2026 Triangle
// statement. Nothing here is trusted by the server — /api/budget/upload
// re-validates every field.
//
// Triangle layout notes the state machine below encodes:
// - Transactions live under "Payments received", "Purchases", "Interest
//   charges" (and, on some statements, "Cash transactions"/"Fees") section
//   headings, each closed by a "Total …" line carrying a stated total we
//   can cross-check against the rows we parsed.
// - A row is "Jun 06  Jun 08  COSTCO WHOLESALE W591  119.83" — transaction
//   date, posting date, description, amount. No year anywhere on the row;
//   it's inferred from the "For the period: … to …" line (handles the
//   Dec→Jan statement that spans two years).
// - Long descriptions wrap ("COSTCO WHOLESALE W591" / "PETERBOROUGH ON"),
//   sometimes with the amount on the first visual line, sometimes the last.
// - "Details of your Sport Chek store purchases" re-itemizes rows already
//   counted under Purchases and must be skipped, as must the per-rate table
//   under "Details of your interest charges" (its first row starts with the
//   word "Purchases" — the section-start matches below are exact-match to
//   avoid tripping on it).
import { parseAmountToCents, previewMerchant } from "./parsers";

const MONTH_NUM = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
// Dollar amounts always carry cents on this statement; requiring the ".dd"
// keeps reference numbers ("STEAMGAMES.COM 4259522") out of the amount slot.
const AMOUNT_RE = "(-?\\(?\\$?[\\d,]{1,10}\\.\\d{2}\\)?)";

const PERIOD_SPAN = `([a-z]+)\\s+(\\d{1,2}),?\\s*(\\d{4})\\s+to\\s+([a-z]+)\\s+(\\d{1,2}),?\\s*(\\d{4})`;
// Triangle: "For the period: June 5, 2026 to July 4, 2026"
const PERIOD_RE = new RegExp(`for the period:?\\s*${PERIOD_SPAN}`, "i");
// TD: "STATEMENT PERIOD: May 28, 2026 to June 29, 2026" — also the marker
// that distinguishes a TD statement from a Triangle one.
const TD_PERIOD_RE = new RegExp(`statement period:?\\s*${PERIOD_SPAN}`, "i");
const STATEMENT_DATE_RE = /statement date:?\s*([a-z]+)\s+(\d{1,2}),?\s*(\d{4})/i;

const periodFromSpan = (m) => {
  const sm = MONTH_NUM[m[1].slice(0, 3).toLowerCase()];
  const em = MONTH_NUM[m[4].slice(0, 3).toLowerCase()];
  if (!sm || !em) return null;
  return {
    startMonth: sm, startYear: Number(m[3]),
    endMonth: em, endYear: Number(m[6]),
    label: `${m[1]} ${m[2]}, ${m[3]} – ${m[4]} ${m[5]}, ${m[6]}`,
  };
};

// Full row: both dates + description + the first amount-shaped token.
// Anything after the amount is ignored — pdf text extraction can merge the
// page's right-hand info column onto the same visual line.
const TX_FULL = new RegExp(
  `^${MONTH_RE}\\.?\\s+(\\d{1,2})\\s+${MONTH_RE}\\.?\\s+(\\d{1,2})\\s+(.+?)\\s+${AMOUNT_RE}(?:\\s|$)`,
  "i"
);
// Row start whose amount landed on the wrapped line below.
const TX_START = new RegExp(
  `^${MONTH_RE}\\.?\\s+(\\d{1,2})\\s+${MONTH_RE}\\.?\\s+(\\d{1,2})\\s+(\\S.*?)$`,
  "i"
);
const AMOUNT_TAIL = new RegExp(`^(.*?)\\s*${AMOUNT_RE}$`, "i");

// Exact-ish matches on purpose — see layout notes above.
const SECTION_STARTS = [
  [/^payments received\b/i, "payments"],
  [/^purchases(\s*-\s*card\b.*)?$/i, "purchases"],
  [/^interest charges$/i, "interest"],
  [/^cash transactions$/i, "cash"],
  [/^cash advances$/i, "cash"],
  [/^fees$/i, "fees"],
];
const SECTION_EXIT = /^(details of your|other details|ways to pay|information about|triangle rewards)/i;
const TOTAL_RE = new RegExp(
  `^total\\s+(payments received|purchases|interest charges|cash transactions|cash advances|fees)\\b.*?${AMOUNT_RE}(?:\\s|$)`,
  "i"
);
const TOTAL_SECTION = {
  "payments received": "payments",
  purchases: "purchases",
  "interest charges": "interest",
  "cash transactions": "cash",
  "cash advances": "cash",
  fees: "fees",
};

// Wrapped-description fragments are short and printed in caps ("PETERBOROUGH
// ON", "WA"); the info-column prose that can share a visual line is neither.
const CONTINUATION_RE = /^[A-Z0-9][A-Z0-9 &#'.,*/()-]{0,39}$/;
const CONTINUATION_STOP = /^(transaction|posting|amount|account number|page \d)/i;

const cleanLine = (s) =>
  String(s || "")
    .replace(/ /g, " ") // non-breaking spaces from pdf text extraction
    .replace(/\s?\.{2,}\s?/g, " ") // dotted leader rules between table cells
    .replace(/\s+/g, " ")
    .trim();

function parsePeriod(texts) {
  for (const t of texts) {
    const m = t.match(PERIOD_RE);
    if (m) {
      const period = periodFromSpan(m);
      if (period) return period;
    }
  }
  // Older statements sometimes only carry "Statement date: July 4, 2026" —
  // treat it as the period end and assume a one-month window behind it.
  for (const t of texts) {
    const m = t.match(STATEMENT_DATE_RE);
    if (m) {
      const em = MONTH_NUM[m[1].slice(0, 3).toLowerCase()];
      if (!em) continue;
      const endYear = Number(m[3]);
      const startMonth = em === 1 ? 12 : em - 1;
      return {
        startMonth, startYear: em === 1 ? endYear - 1 : endYear,
        endMonth: em, endYear,
        label: `statement dated ${m[1]} ${m[2]}, ${m[3]}`,
      };
    }
  }
  return null;
}

/**
 * Rows print no year, so borrow it from the statement period. Same-year
 * periods are trivial; a Dec→Jan statement assigns Jul–Dec transaction
 * months to the start year and Jan–Jun to the end year (a period never
 * spans more than ~2 months, so "which side of new year" is unambiguous).
 */
function yearFor(month, period) {
  if (period.startYear === period.endYear) return period.startYear;
  return month >= 7 ? period.startYear : period.endYear;
}

const pad2 = (n) => String(n).padStart(2, "0");

function makeRow(monthName, dayStr, desc, amountToken, period) {
  const month = MONTH_NUM[monthName.slice(0, 3).toLowerCase()];
  const day = Number(dayStr);
  if (!month || day < 1 || day > 31) return null;
  const amountCents = parseAmountToCents(amountToken);
  if (amountCents == null || amountCents === 0) return null;
  const merchantRaw = desc.trim();
  if (!merchantRaw) return null;
  return {
    postedDate: `${yearFor(month, period)}-${pad2(month)}-${pad2(day)}`,
    merchantRaw,
    amountCents,
    _preview: previewMerchant(merchantRaw),
  };
}

/**
 * Parse a Triangle/Canadian Tire statement from extracted PDF lines.
 * `lines` entries are either plain strings (tests) or {text, segments}
 * objects from pdf-extract.js — segments[0] is the leftmost run of text on
 * the visual line, used to keep wrapped-description handling from swallowing
 * the page's right-hand info column.
 *
 * Returns { ok:true, rows, period, checks, sections } or { ok:false, error }.
 * `checks` compares each section's stated "Total …" against the sum of the
 * rows we actually parsed — surfaced in the UI so a layout drift can never
 * silently import garbage.
 */
export function parseTriangleStatement(lines) {
  const norm = lines.map((l) =>
    typeof l === "string"
      ? { text: cleanLine(l), first: cleanLine(l), firstX: null }
      : {
          text: cleanLine(l.text),
          first: cleanLine(l.segments?.[0]?.text ?? l.text),
          firstX: l.segments?.[0]?.x ?? null,
        }
  );

  const period = parsePeriod(norm.map((l) => l.text));
  if (!period) {
    return {
      ok: false,
      error:
        "Couldn't find the statement period in this PDF — it doesn't look like a Canadian Tire (Triangle) statement.",
    };
  }

  const rows = [];
  const sums = {};
  const stated = {};
  let section = null;
  let lastRow = null; // last emitted row, still eligible for a wrapped line
  let lastRowJoins = 0;
  let openRow = null; // dates+description seen, amount expected on next line
  let tableX = null; // left edge of the transaction table, learned from rows

  for (const { text, first, firstX } of norm) {
    if (!text) continue;

    // The page's right-hand info column interleaves its own lines *between*
    // a row and its wrapped description fragment. Once we know where the
    // table's left edge is, lines that start far to its right are that
    // column — skip them without disturbing continuation state. (On the real
    // statement the table starts at x≈47, wrapped fragments at x≈128, and
    // the info column at x≈383.)
    if (tableX != null && firstX != null && firstX > tableX + 250) continue;

    const total = text.match(TOTAL_RE);
    if (total) {
      stated[TOTAL_SECTION[total[1].toLowerCase()]] = parseAmountToCents(total[2]);
      section = null;
      lastRow = openRow = null;
      continue;
    }

    const start = SECTION_STARTS.find(([re]) => re.test(text));
    if (start) {
      section = start[1];
      lastRow = openRow = null;
      continue;
    }

    if (SECTION_EXIT.test(text)) {
      section = null;
      lastRow = openRow = null;
      continue;
    }

    if (!section) continue;

    const full = text.match(TX_FULL);
    if (full) {
      const row = makeRow(full[1], full[2], full[5], full[6], period);
      if (row) {
        rows.push(row);
        sums[section] = (sums[section] || 0) + row.amountCents;
        lastRow = row;
        lastRowJoins = 0;
        if (firstX != null) tableX = firstX;
      } else {
        lastRow = null;
      }
      openRow = null;
      continue;
    }

    // Dates with no amount on the line: the description wrapped and the
    // amount prints beside its continuation below.
    const startOnly = text.match(TX_START);
    if (startOnly) {
      openRow = { monthName: startOnly[1], day: startOnly[2], desc: startOnly[5] };
      lastRow = null;
      if (firstX != null) tableX = firstX;
      continue;
    }

    if (openRow) {
      const tail = text.match(AMOUNT_TAIL);
      const fragment = tail ? tail[1] : null;
      if (tail && (fragment === "" || CONTINUATION_RE.test(fragment))) {
        const desc = `${openRow.desc} ${fragment}`.trim();
        const row = makeRow(openRow.monthName, openRow.day, desc, tail[2], period);
        if (row) {
          rows.push(row);
          sums[section] = (sums[section] || 0) + row.amountCents;
          lastRow = row;
          lastRowJoins = 0;
        }
        openRow = null;
        continue;
      }
      openRow = null;
    }

    // Wrapped continuation of the previous row's description. Judged on the
    // line's leftmost segment only, and capped at two joins, so stray page
    // furniture can't keep accreting onto a merchant name.
    if (
      lastRow &&
      lastRowJoins < 2 &&
      first &&
      CONTINUATION_RE.test(first) &&
      !CONTINUATION_STOP.test(first)
    ) {
      lastRow.merchantRaw = `${lastRow.merchantRaw} ${first}`;
      lastRow._preview = previewMerchant(lastRow.merchantRaw);
      lastRowJoins += 1;
      continue;
    }

    lastRow = null;
  }

  if (!rows.length) {
    return {
      ok: false,
      error:
        "Found the statement period but no transactions — if this Triangle statement looks different from usual, the parser needs updating.",
    };
  }

  const CHECK_LABELS = {
    payments: "Payments received",
    purchases: "Purchases",
    interest: "Interest charges",
    cash: "Cash transactions",
    fees: "Fees",
  };
  const checks = Object.keys(stated)
    .filter((key) => stated[key] != null)
    .map((key) => ({
      key,
      label: CHECK_LABELS[key] || key,
      statedCents: stated[key],
      parsedCents: sums[key] || 0,
      ok: stated[key] === (sums[key] || 0),
    }));

  return { ok: true, rows, period, checks, sections: sums };
}

/**
 * Parse a TD credit-card statement. Verified against a real June 2026
 * First Class Travel statement. TD's layout differs from Triangle's:
 *
 * - No section headings — one transactions table flows across pages
 *   (columns at x≈47/95 dates, x≈140 description, amount right-aligned),
 *   ending at "TOTAL NEW BALANCE". Payments are negative rows inline.
 * - Wrapped description fragments print at exactly the description
 *   column's x — a far stronger continuation signal than text shape, so
 *   when geometry is available it replaces the uppercase heuristic
 *   (page headers like "TD FIRST CLASS TRAVEL CARD" are uppercase and
 *   would otherwise qualify).
 * - The right-hand "CALCULATING YOUR BALANCE" box states Purchases &
 *   Other Charges and Payments & Credits — collected in a pre-pass
 *   (those lines can merge onto row lines) and cross-checked against
 *   the parsed sums.
 */
export function parseTdStatement(lines) {
  const norm = lines.map((l) =>
    typeof l === "string"
      ? { text: cleanLine(l), first: cleanLine(l), firstX: null, segments: null }
      : {
          text: cleanLine(l.text),
          first: cleanLine(l.segments?.[0]?.text ?? l.text),
          firstX: l.segments?.[0]?.x ?? null,
          segments: l.segments || null,
        }
  );

  let period = null;
  let statedPurchases = null;
  let statedPayments = null;
  for (const { text } of norm) {
    if (!period) {
      const m = text.match(TD_PERIOD_RE);
      if (m) period = periodFromSpan(m);
    }
    const p = text.match(/purchases\s*&\s*other charges\s+\$?([\d,]{1,10}\.\d{2})/i);
    if (p) statedPurchases = parseAmountToCents(p[1]);
    const c = text.match(/payments\s*&\s*credits\s+-?\$?([\d,]{1,10}\.\d{2})/i);
    if (c) statedPayments = -parseAmountToCents(c[1]); // printed positive, rows are negative
  }
  if (!period) {
    return {
      ok: false,
      error: "Couldn't find the statement period in this PDF — it doesn't look like a TD statement.",
    };
  }

  // x of the segment where a row's description starts.
  const descXFor = (segments, desc) => {
    if (!segments || !desc) return null;
    const head = desc.slice(0, Math.min(8, desc.length));
    return segments.find((s) => cleanLine(s.text).startsWith(head))?.x ?? null;
  };
  const CONTINUATION_STOP_TD = /^(td |transaction|posting|date|activity|amount|total|previous|statement|new balance|continued)/i;

  const rows = [];
  let purchases = 0;
  let payments = 0;
  let lastRow = null;
  let lastRowJoins = 0;
  let lastDescX = null;
  let openRow = null;
  let tableX = null;
  let done = false;

  const record = (row) => {
    rows.push(row);
    if (row.amountCents < 0) payments += row.amountCents;
    else purchases += row.amountCents;
    lastRow = row;
    lastRowJoins = 0;
  };

  for (const { text, first, firstX, segments } of norm) {
    if (done || !text) continue;

    if (/^total new balance\b/i.test(text)) {
      done = true; // everything after is offers / agreement changes
      continue;
    }

    // Right-hand info boxes interleave between rows and their wrapped
    // fragments; skip them without touching continuation state (stated
    // totals were already collected in the pre-pass above).
    if (tableX != null && firstX != null && firstX > tableX + 250) continue;

    const full = text.match(TX_FULL);
    if (full) {
      const row = makeRow(full[1], full[2], full[5], full[6], period);
      if (row) {
        record(row);
        lastDescX = descXFor(segments, full[5]);
        if (firstX != null) tableX = firstX;
      } else {
        lastRow = null;
      }
      openRow = null;
      continue;
    }

    const startOnly = text.match(TX_START);
    if (startOnly) {
      openRow = { monthName: startOnly[1], day: startOnly[2], desc: startOnly[5] };
      lastRow = null;
      lastDescX = descXFor(segments, startOnly[5]);
      if (firstX != null) tableX = firstX;
      continue;
    }

    // A wrapped fragment sits at the description column's x. Without
    // geometry (string fixtures), fall back to the uppercase heuristic.
    const looksLikeFragment =
      first &&
      first.length <= 40 &&
      !CONTINUATION_STOP_TD.test(first) &&
      (firstX != null && lastDescX != null
        ? Math.abs(firstX - lastDescX) <= 12
        : CONTINUATION_RE.test(first));

    if (openRow) {
      const tail = text.match(AMOUNT_TAIL);
      if (tail && (tail[1] === "" || looksLikeFragment)) {
        const row = makeRow(
          openRow.monthName,
          openRow.day,
          `${openRow.desc} ${tail[1]}`.trim(),
          tail[2],
          period
        );
        if (row) record(row);
        openRow = null;
        continue;
      }
      openRow = null;
    }

    if (lastRow && lastRowJoins < 2 && looksLikeFragment) {
      lastRow.merchantRaw = `${lastRow.merchantRaw} ${first}`;
      lastRow._preview = previewMerchant(lastRow.merchantRaw);
      lastRowJoins += 1;
      continue;
    }

    lastRow = null;
  }

  if (!rows.length) {
    return {
      ok: false,
      error:
        "Found the statement period but no transactions — if this TD statement looks different from usual, the parser needs updating.",
    };
  }

  const checks = [];
  if (statedPurchases != null) {
    checks.push({
      key: "purchases",
      label: "Purchases & other charges",
      statedCents: statedPurchases,
      parsedCents: purchases,
      ok: statedPurchases === purchases,
    });
  }
  if (statedPayments != null) {
    checks.push({
      key: "payments",
      label: "Payments & credits",
      statedCents: statedPayments,
      parsedCents: payments,
      ok: statedPayments === payments,
    });
  }

  return { ok: true, rows, period, checks, sections: { purchases, payments } };
}

// ---- Amex ----
//
// Verified against a real August 2026 Cobalt statement. Amex's layout is the
// tamest of the three:
// - No period line; every page header prints the opening and closing dates
//   side by side ("Jul 16, 2026  Aug 15, 2026") under "Opening Date /
//   Closing Date" — the first line carrying two adjacent full dates is it.
// - Sections: "New Payments" (payments, negative), "New Transactions for
//   <CARDMEMBER>" (one per cardmember, refunds negative inline) and "Other
//   Account Transactions" (fees — the monthly membership fee lives here).
//   Each closes with a "Total of …" line to cross-check; the New
//   Transactions total's cardmember name sometimes wraps BELOW the amount's
//   visual line, so the total regex doesn't require it.
// - Rows never wrap ("Jul 16 Jul 17 SHEIN DISTRIBUTION CANA TORONTO -26.25"),
//   so there is deliberately NO continuation handling: anything that isn't a
//   row, a section marker or a total ("Reference AT…" under payments, page
//   furniture, the interleaved page-3 header) is simply ignored.
// - The Membership Rewards summary re-itemizes charges with NUMERIC dates
//   (07/19/2026), which can't match the month-name row shape — and the
//   "About Your …" / offers pages reset the section anyway.
const AMEX_MARKER_RE = /american express|amex bank of canada/i;
const AMEX_PERIOD_RE = new RegExp(
  `${MONTH_RE}[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\s+${MONTH_RE}[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`,
  "i"
);
const AMEX_SECTION_STARTS = [
  [/^new payments$/i, "payments"],
  [/^new transactions\b/i, "purchases"],
  [/^other account transactions$/i, "other"],
];
const AMEX_SECTION_EXIT = /^(membership rewards|about your|your offers)/i;
const AMEX_TOTAL_RE = new RegExp(
  `^total of (payment activity|new transactions|other account transactions)\\b.*?${AMOUNT_RE}(?:\\s|$)`,
  "i"
);
const AMEX_TOTAL_SECTION = {
  "payment activity": "payments",
  "new transactions": "purchases",
  "other account transactions": "other",
};

/**
 * Parse an American Express statement from extracted PDF lines. Same
 * contract as the Triangle/TD parsers: {ok, rows, period, checks, sections}
 * with every section's stated total compared against the parsed sum, so a
 * layout redesign fails loudly instead of importing garbage.
 */
export function parseAmexStatement(lines) {
  const texts = lines.map((l) => cleanLine(typeof l === "string" ? l : l.text));

  let period = null;
  for (const t of texts) {
    const m = t.match(AMEX_PERIOD_RE);
    if (m) {
      period = periodFromSpan(m);
      if (period) break;
    }
  }
  if (!period) {
    return {
      ok: false,
      error:
        "Couldn't find the opening/closing dates in this PDF — it doesn't look like an Amex statement.",
    };
  }

  const rows = [];
  const sums = {};
  const stated = {};
  let section = null;

  for (const text of texts) {
    if (!text) continue;

    const total = text.match(AMEX_TOTAL_RE);
    if (total) {
      const key = AMEX_TOTAL_SECTION[total[1].toLowerCase()];
      // Accumulate: a shared account prints one "Total of New Transactions
      // for <NAME>" per cardmember.
      stated[key] = (stated[key] || 0) + parseAmountToCents(total[2]);
      section = null;
      continue;
    }

    const start = AMEX_SECTION_STARTS.find(([re]) => re.test(text));
    if (start) {
      section = start[1];
      continue;
    }

    if (AMEX_SECTION_EXIT.test(text)) {
      section = null;
      continue;
    }

    if (!section) continue;

    const full = text.match(TX_FULL);
    if (full) {
      const row = makeRow(full[1], full[2], full[5], full[6], period);
      if (row) {
        rows.push(row);
        sums[section] = (sums[section] || 0) + row.amountCents;
      }
    }
    // Everything else inside a section is furniture — see layout notes.
  }

  if (!rows.length) {
    return {
      ok: false,
      error:
        "Found the statement dates but no transactions — if this Amex statement looks different from usual, the parser needs updating.",
    };
  }

  const AMEX_CHECK_LABELS = {
    payments: "Payment activity",
    purchases: "New transactions",
    other: "Other account charges",
  };
  const checks = Object.keys(stated)
    .filter((key) => stated[key] != null)
    .map((key) => ({
      key,
      label: AMEX_CHECK_LABELS[key] || key,
      statedCents: stated[key],
      parsedCents: sums[key] || 0,
      ok: stated[key] === (sums[key] || 0),
    }));

  return { ok: true, rows, period, checks, sections: sums };
}

/**
 * Detect which bank produced a statement PDF and parse accordingly.
 * Triangle prints "For the period: … to …"; TD prints
 * "STATEMENT PERIOD: … to …"; Amex is recognized by its brand text.
 */
export function parseStatementPdf(lines) {
  const texts = lines.map((l) => cleanLine(typeof l === "string" ? l : l.text));
  if (texts.some((t) => PERIOD_RE.test(t))) return parseTriangleStatement(lines);
  if (texts.some((t) => TD_PERIOD_RE.test(t))) return parseTdStatement(lines);
  if (texts.some((t) => AMEX_MARKER_RE.test(t))) return parseAmexStatement(lines);
  return {
    ok: false,
    error:
      "Couldn't recognize this PDF — Amex, Canadian Tire (Triangle) and TD statements are supported so far.",
  };
}
