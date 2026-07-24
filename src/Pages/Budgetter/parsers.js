// Client-side CSV parsing for statement uploads. Nothing here is trusted by
// the server — /api/budget/upload independently re-validates every field —
// so this module's only job is turning a messy export into a best-effort
// {postedDate, merchantRaw, amountCents} guess plus a column mapping the
// user confirms before anything is sent.
//
// The TD column layout hasn't been verified against a live export yet, so
// this deliberately doesn't hard-code bank-specific parsers that would just
// be guesses dressed up as certainty. Instead: one heuristic header detector
// + a manual mapping fallback that works for any CSV shape, always shown to
// the user for confirmation. (Amex is verified against a real export;
// Canadian Tire / Triangle only offers PDFs — see pdf-parsers.js.)
import Papa from "papaparse";

const FIELD_SYNONYMS = {
  date: ["date", "transaction date", "posted date", "posting date", "trans date"],
  description: ["description", "merchant", "details", "transaction", "payee", "memo"],
  amount: ["amount", "amount cad", "amount cdn", "amount ($)"],
  debit: ["debit", "withdrawal", "withdrawals", "charge", "charges"],
  credit: ["credit", "credits", "payment", "payments", "deposit", "deposits"],
};

function scoreHeaderRow(row) {
  const lower = row.map((c) => String(c || "").trim().toLowerCase());
  const guess = {};
  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    const idx = lower.findIndex((cell) => synonyms.includes(cell));
    if (idx !== -1) guess[field] = idx;
  }
  return guess;
}

/**
 * Parse raw CSV text into a table plus a best-effort column-mapping guess.
 * Never commits to the guess — callers always show it for confirmation.
 * Returns { headerRow, rows, guess, hasHeader }.
 */
export function parseCsvFile(text) {
  const { data } = Papa.parse(text.trim(), { skipEmptyLines: true });
  if (!data.length) return { headerRow: null, rows: [], guess: {}, hasHeader: false };

  const firstRowGuess = scoreHeaderRow(data[0]);
  const hasHeader = Object.keys(firstRowGuess).length >= 2; // date + at least one more field

  if (hasHeader) {
    return { headerRow: data[0], rows: data.slice(1), guess: firstRowGuess, hasHeader: true };
  }

  // Headerless fallback: TD's common export is Date, Description, Debit,
  // Credit, Balance — offered as a starting *guess* only, never auto-applied.
  const columnCount = data[0].length;
  const guess =
    columnCount >= 4
      ? { date: 0, description: 1, debit: 2, credit: 3 }
      : columnCount === 3
      ? { date: 0, description: 1, amount: 2 }
      : {};

  return { headerRow: null, rows: data, guess, hasHeader: false };
}

const pad = (n) => String(n).padStart(2, "0");
const MONTH_NAMES = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const DATE_FORMATS = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => `${m[1]}-${pad(m[2])}-${pad(m[3])}`],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => `${m[3]}-${pad(m[1])}-${pad(m[2])}`], // MM/DD/YYYY
  [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => `${m[3]}-${pad(m[1])}-${pad(m[2])}`], // MM-DD-YYYY
  [
    // "17 Jul 2026" / "17 July 2026" — Amex's export format.
    /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/,
    (m) => {
      const month = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
      return month ? `${m[3]}-${month}-${pad(m[1])}` : null;
    },
  ],
];

/** Best-effort normalize to YYYY-MM-DD; null if unrecognized. The server re-validates regardless. */
export function normalizeDate(raw) {
  const s = String(raw || "").trim();
  for (const [re, fmt] of DATE_FORMATS) {
    const m = s.match(re);
    if (m) {
      const result = fmt(m);
      if (result) return result;
    }
  }
  return null;
}

/** "$1,234.56" / "1234.56" / "(12.00)" -> 123456 / 123456 / -1200 (integer cents). */
export function parseAmountToCents(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Math.round(parseFloat(cleaned) * 100);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

/**
 * Cosmetic preview only — the server derives its own merchant_clean
 * independently and always keeps merchant_raw too, so an over-eager strip
 * here never loses data, only makes the preview a little too tidy.
 * Mirrors cleanMerchant() in api/_lib/budget-normalize.js; keep them in sync.
 */
export function previewMerchant(raw) {
  let s = String(raw || "").trim().replace(/\s+/g, " ");
  // Payment-processor sub-merchant codes: "AMZN MKTP CA*SL3XG3FH3 866-216-1072" -> "AMZN MKTP CA"
  s = s.replace(/\*[A-Z0-9]{5,}\b.*$/i, "");
  // Trailing support/reference phone numbers: "FREEDOM MOBILE 877-946-3184" -> "FREEDOM MOBILE"
  s = s.replace(/\s*\d{3}[-.\s]\d{3}[-.\s]\d{4}\s*$/, "");
  // Trailing store/reference numbers: "TIM HORTONS #4821" -> "TIM HORTONS"
  s = s.replace(/\s*#?\d{4,}\s*$/, "");
  return s.trim().toUpperCase();
}

export const MAPPING_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description / merchant", required: true },
  { key: "amount", label: "Amount (single column)", required: false },
  { key: "debit", label: "Debit / charge", required: false },
  { key: "credit", label: "Credit / payment", required: false },
];

/**
 * Apply a confirmed column mapping to raw rows.
 * mapping: { date, description, amount } OR { date, description, debit, credit }
 * flipSign: this export shows charges as negative (internally, spend is always positive).
 * Returns { rows: [{postedDate, merchantRaw, amountCents, _preview}], errors: [{row, reason}] }
 */
export function applyMapping(rows, mapping, { flipSign = false } = {}) {
  const out = [];
  const errors = [];

  rows.forEach((cells, i) => {
    const merchantRaw = String(cells[mapping.description] ?? "").trim();
    const postedDate = normalizeDate(cells[mapping.date]);

    let amountCents = null;
    if (mapping.amount != null) {
      amountCents = parseAmountToCents(cells[mapping.amount]);
      if (amountCents != null && flipSign) amountCents = -amountCents;
    } else {
      const debit = mapping.debit != null ? parseAmountToCents(cells[mapping.debit]) : null;
      const credit = mapping.credit != null ? parseAmountToCents(cells[mapping.credit]) : null;
      if (debit) amountCents = Math.abs(debit);
      else if (credit) amountCents = -Math.abs(credit);
    }

    if (!merchantRaw || !postedDate || amountCents == null) {
      errors.push({
        row: i,
        reason: "Couldn't read date, description, or amount on this row.",
        raw: {
          date: mapping.date != null ? cells[mapping.date] : undefined,
          description: mapping.description != null ? cells[mapping.description] : undefined,
          amount: mapping.amount != null ? cells[mapping.amount] : undefined,
          debit: mapping.debit != null ? cells[mapping.debit] : undefined,
          credit: mapping.credit != null ? cells[mapping.credit] : undefined,
        },
        parsedOk: { date: !!postedDate, description: !!merchantRaw, amount: amountCents != null },
      });
      return;
    }

    out.push({ postedDate, merchantRaw, amountCents, _preview: previewMerchant(merchantRaw) });
  });

  return { rows: out, errors };
}
