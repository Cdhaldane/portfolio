// Vercel serverless function — GET /api/budget/summary
// One round-trip for everything the dashboard needs: spend per month per
// category (charges only — credits/payments excluded), the household's
// budgets, and how many charges are still uncategorized. All scoped to the
// household resolved from the verified caller; aggregation happens in SQL so
// the payload stays small no matter how many transactions accumulate.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");

module.exports = async (req, res) => {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) {
    return res.status(200).json({
      configured: false,
      months: [],
      merchants: [],
      budgets: [],
      recurring: [],
      income: [],
      uncategorizedCount: 0,
    });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    // Amounts are weighted by count_pct (100 = full, 50 = split, 0 =
    // excluded) so reimbursed/shared charges don't distort totals.
    const months = await sql`
      SELECT to_char(posted_date, 'YYYY-MM') AS month,
             category,
             SUM(ROUND(amount_cents * count_pct / 100.0))::int AS spend_cents,
             COUNT(*) FILTER (WHERE count_pct > 0)::int AS tx_count
        FROM budget_transactions
       WHERE household_id = ${household.id} AND amount_cents > 0
       GROUP BY 1, 2
      HAVING SUM(ROUND(amount_cents * count_pct / 100.0)) > 0
       ORDER BY 1 ASC
    `;

    // Per-month per-merchant totals power the "top merchants" ranking and
    // the subscription detector. Fine at personal scale; if a user ever has
    // thousands of distinct merchants this becomes a windowed query.
    const merchants = await sql`
      SELECT to_char(posted_date, 'YYYY-MM') AS month,
             merchant_clean,
             SUM(ROUND(amount_cents * count_pct / 100.0))::int AS spend_cents,
             COUNT(*) FILTER (WHERE count_pct > 0)::int AS tx_count
        FROM budget_transactions
       WHERE household_id = ${household.id} AND amount_cents > 0
       GROUP BY 1, 2
      HAVING SUM(ROUND(amount_cents * count_pct / 100.0)) > 0
       ORDER BY 1 ASC
    `;

    const budgets = await sql`
      SELECT category, monthly_cents
        FROM budget_budgets
       WHERE household_id = ${household.id}
       ORDER BY category ASC
    `;

    const recurring = await sql`
      SELECT id, label, category, amount_cents, due_day, start_month, end_month, on_card
        FROM budget_recurring
       WHERE household_id = ${household.id}
       ORDER BY amount_cents DESC, label ASC
    `;

    const income = await sql`
      SELECT id, label, amount_cents, cadence, start_month, end_month
        FROM budget_income
       WHERE household_id = ${household.id}
       ORDER BY amount_cents DESC, label ASC
    `;

    const [{ count: uncategorizedCount }] = await sql`
      SELECT COUNT(*)::int AS count
        FROM budget_transactions
       WHERE household_id = ${household.id} AND category = 'uncategorized'
         AND amount_cents > 0 AND count_pct > 0
    `;

    // Per-account data freshness for the dashboard's "did I upload?" chips.
    const accounts = await sql`
      SELECT a.id, a.label, a.bank,
             to_char(MAX(t.posted_date), 'YYYY-MM-DD') AS last_tx_date,
             COUNT(t.id)::int AS tx_count
        FROM budget_accounts a
        LEFT JOIN budget_transactions t
          ON t.account_id = a.id AND t.household_id = a.household_id
       WHERE a.household_id = ${household.id}
       GROUP BY a.id, a.label, a.bank
       ORDER BY a.label ASC
    `;

    return res.status(200).json({
      configured: true,
      months,
      merchants,
      budgets,
      recurring,
      income,
      accounts,
      uncategorizedCount,
    });
  } catch (err) {
    console.error("Budget summary error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
