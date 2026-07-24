// Vercel serverless function — GET/PUT /api/budget/budgets
// GET -> the caller's per-category monthly budgets.
// PUT -> upsert one: { category, monthlyCents }. monthlyCents of 0 (or null)
//        deletes the budget — "no budget" is the absence of a row, so the
//        dashboard never has to disambiguate 0 from unset.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");

const CATEGORY_MAX = 40;
const MONTHLY_CENTS_MAX = 100_000_000; // $1M/month is safely beyond sane

module.exports = async (req, res) => {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  const sql = getSql();
  if (!sql) {
    if (req.method === "GET") {
      return res.status(200).json({ configured: false, budgets: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);

    if (req.method === "GET") {
      const budgets = await sql`
        SELECT category, monthly_cents
          FROM budget_budgets
         WHERE user_id = ${userId}
         ORDER BY category ASC
      `;
      return res.status(200).json({ configured: true, budgets });
    }

    if (req.method === "PUT") {
      const category = String(req.body?.category || "").trim();
      if (!category || category.length > CATEGORY_MAX) {
        return res.status(400).json({ error: "A valid category is required." });
      }

      const raw = req.body?.monthlyCents;
      const monthlyCents = raw == null ? 0 : Number(raw);
      if (!Number.isInteger(monthlyCents) || monthlyCents < 0 || monthlyCents > MONTHLY_CENTS_MAX) {
        return res.status(400).json({ error: "Budget amount is out of range." });
      }

      if (monthlyCents === 0) {
        await sql`
          DELETE FROM budget_budgets
           WHERE user_id = ${userId} AND category = ${category}
        `;
        return res.status(200).json({ ok: true, removed: true, category });
      }

      const [budget] = await sql`
        INSERT INTO budget_budgets (user_id, category, monthly_cents)
        VALUES (${userId}, ${category}, ${monthlyCents})
        ON CONFLICT (user_id, category) DO UPDATE SET monthly_cents = EXCLUDED.monthly_cents
        RETURNING category, monthly_cents
      `;
      return res.status(200).json({ ok: true, budget });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget budgets error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
