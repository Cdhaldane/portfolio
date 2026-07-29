// Vercel serverless function — ALL /api/budget/* routes.
//
// One dynamic function instead of ten files: Vercel's Hobby plan caps a
// deployment at 12 serverless functions and counts FILES under api/, not
// routes. The real handlers live in api/_lib/handlers/ (the underscore
// prefix keeps Vercel from bundling them as functions) and keep their
// requireUser()-first shape; this file only routes. URLs are unchanged —
// /api/budget/summary arrives here with req.query.action === "summary".
const handlers = {
  me: require("../_lib/handlers/me.js"),
  accounts: require("../_lib/handlers/accounts.js"),
  upload: require("../_lib/handlers/upload.js"),
  transactions: require("../_lib/handlers/transactions.js"),
  summary: require("../_lib/handlers/summary.js"),
  budgets: require("../_lib/handlers/budgets.js"),
  categorize: require("../_lib/handlers/categorize.js"),
  recurring: require("../_lib/handlers/recurring.js"),
  income: require("../_lib/handlers/income.js"),
  household: require("../_lib/handlers/household.js"),
  reminders: require("../_lib/handlers/reminders.js"),
};

module.exports = async (req, res) => {
  const handler = handlers[req.query?.action];
  if (!handler) {
    return res.status(404).json({ error: "Not found" });
  }
  return handler(req, res);
};
