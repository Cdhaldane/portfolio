// Vercel serverless function — POST /api/budget/categorize
// Backfills categories for the household's existing *uncategorized* rows
// using the household's own rules first, then the built-in defaults (same
// categoryFor the ingest path uses, so a re-upload and a backfill can never
// disagree). Rows anyone already categorized by hand are never touched.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");
const { categoryFor } = require("../budget-normalize");

module.exports = async (req, res) => {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) {
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    // Longest pattern first — same deterministic order as upload.js, so a
    // backfill and a re-upload can never categorize the same merchant
    // differently.
    const rules = await sql`
      SELECT pattern, category FROM budget_category_rules
       WHERE household_id = ${household.id}
       ORDER BY length(pattern) DESC, pattern ASC
    `;
    const rows = await sql`
      SELECT id, merchant_clean
        FROM budget_transactions
       WHERE household_id = ${household.id} AND category = 'uncategorized'
    `;

    const changes = rows
      .map((r) => ({ id: r.id, category: categoryFor(r.merchant_clean, rules) }))
      .filter((c) => c.category !== "uncategorized");

    let updated = 0;
    if (changes.length) {
      const results = await sql.transaction(
        changes.map(
          (c) => sql`
            UPDATE budget_transactions SET category = ${c.category}
             WHERE id = ${c.id} AND household_id = ${household.id}
            RETURNING id
          `
        )
      );
      updated = results.reduce((sum, r) => sum + r.length, 0);
    }

    return res
      .status(200)
      .json({ ok: true, updated, remaining: rows.length - updated });
  } catch (err) {
    console.error("Budget categorize error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
