// Canonical category list shared by the transactions editor and the
// dashboard's budget controls. Mirrors the categories the server's rules
// emit — DEFAULT_CATEGORY_RULES in api/_lib/budget-normalize.js, plus
// CHEQUING_RULES in api/_lib/budget-chequing.js for the three that only a
// bank-account statement produces.
export const CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining",
  "Transport",
  "Bills",
  "Subscriptions",
  "Shopping",
  "Travel",
  "Health",
  "Entertainment",
  "Fees",
  "Payments",
  "Income",
  // Chequing/debit statements only. "Transfers" and "Card payment" rows are
  // imported at 0% (they'd double-count real spending otherwise), so these
  // two normally hold no counted money at all — they exist so the row can
  // still be labelled honestly rather than filed under a merchant.
  "Transfers",
  "Card payment",
  "Cash",
  "Other",
];
