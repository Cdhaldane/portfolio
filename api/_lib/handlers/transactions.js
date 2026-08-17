// Vercel serverless function — GET/PATCH /api/budget/transactions
// GET   -> paginated list for the caller's household, optionally scoped to
//          one account or one member (ownership of that account is not
//          re-checked here beyond the household_id filter — a mismatched
//          accountId just returns nothing). Each row carries `added_by` (the
//          member who imported or created it) so a shared ledger can say who
//          did what.
// PATCH -> set one transaction's category. With applyToFuture, also upserts
//          a category_rule and backfills the household's OTHER transactions
//          that (a) match the same cleaned merchant name and (b) are still
//          at the 'uncategorized' default — never overwrites a category
//          someone set deliberately elsewhere.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");

const CATEGORY_MAX = 40;
const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 500;

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
      return res.status(200).json({ configured: false, transactions: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    if (req.method === "GET") {
      const limit = Math.min(
        LIST_MAX_LIMIT,
        Math.max(1, parseInt(req.query?.limit, 10) || LIST_DEFAULT_LIMIT)
      );
      const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);
      const accountId = req.query?.accountId ? parseInt(req.query.accountId, 10) : null;
      if (accountId !== null && !Number.isInteger(accountId)) {
        return res.status(400).json({ error: "accountId must be a number." });
      }
      // Optional filters. `q` matches the cleaned merchant name; the % and _
      // LIKE metacharacters are escaped so user input can't turn into a
      // pattern (values themselves are parameterized by the driver).
      const q = String(req.query?.q || "").trim().slice(0, 80);
      const category = String(req.query?.category || "").trim().slice(0, CATEGORY_MAX);
      const qLike = q ? `%${q.replace(/[\\%_]/g, "\\$&").toUpperCase()}%` : null;
      // "Show me only the rows Sarah added." Unknown ids simply match
      // nothing — the household filter is what enforces access.
      const addedBy = String(req.query?.addedBy || "").trim().slice(0, 80) || null;
      // "Only charges on X's cards" — account OWNERSHIP (member_user_id),
      // which is a different question from addedBy (who imported the row).
      // Same posture: unknown ids match nothing inside the household.
      const cardOf = String(req.query?.cardOf || "").trim().slice(0, 80) || null;

      // Period scoping for dashboard drill-downs: month=YYYY-MM or
      // year=YYYY (month wins). Expressed as a [from, to) date range so the
      // (user_id, posted_date) index stays usable.
      const monthParam = String(req.query?.month || "").trim();
      const yearParam = String(req.query?.year || "").trim();
      let from = null;
      let to = null;
      if (monthParam) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
          return res.status(400).json({ error: "month must be YYYY-MM." });
        }
        const [y, m] = monthParam.split("-").map(Number);
        from = `${monthParam}-01`;
        const next = new Date(Date.UTC(y, m, 1));
        to = next.toISOString().slice(0, 10);
      } else if (yearParam) {
        if (!/^\d{4}$/.test(yearParam)) {
          return res.status(400).json({ error: "year must be YYYY." });
        }
        from = `${yearParam}-01-01`;
        to = `${Number(yearParam) + 1}-01-01`;
      }

      // posted_date is serialized via to_char: the Neon driver returns DATE
      // columns as JS Date objects, which JSON-serialize as full ISO
      // timestamps and shift by a day (or break parsing) in the client.
      const rows = await sql`
        SELECT t.id, t.account_id, a.label AS account_label,
               to_char(t.posted_date, 'YYYY-MM-DD') AS posted_date,
               t.merchant_clean, t.amount_cents, t.category, t.count_pct, t.created_at,
               t.user_id AS added_by, m.display_name AS added_by_name
          FROM budget_transactions t
          JOIN budget_accounts a ON a.id = t.account_id
          LEFT JOIN budget_household_members m
                 ON m.household_id = t.household_id AND m.user_id = t.user_id
         WHERE t.household_id = ${household.id}
           AND (${accountId}::int IS NULL OR t.account_id = ${accountId})
           AND (${qLike}::text IS NULL OR t.merchant_clean LIKE ${qLike})
           AND (${category || null}::text IS NULL OR t.category = ${category})
           AND (${addedBy}::text IS NULL OR t.user_id = ${addedBy})
           AND (${cardOf}::text IS NULL OR a.member_user_id = ${cardOf})
           AND (${from}::date IS NULL OR t.posted_date >= ${from})
           AND (${to}::date IS NULL OR t.posted_date < ${to})
         ORDER BY t.posted_date DESC, t.id DESC
         LIMIT ${limit} OFFSET ${offset}
      `;
      return res.status(200).json({ configured: true, transactions: rows });
    }

    if (req.method === "PATCH") {
      const id = parseInt(req.body?.id, 10);
      const hasCategory = req.body?.category !== undefined;
      const hasCountPct = req.body?.countPct !== undefined;
      const category = hasCategory ? String(req.body.category || "").trim() : null;
      const applyToFuture = req.body?.applyToFuture === true;

      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid transaction id is required." });
      }
      if (!hasCategory && !hasCountPct) {
        return res.status(400).json({ error: "Nothing to update." });
      }
      if (hasCategory && !category) {
        return res.status(400).json({ error: "A category is required." });
      }
      if (hasCategory && category.length > CATEGORY_MAX) {
        return res
          .status(400)
          .json({ error: `Category must be ${CATEGORY_MAX} characters or fewer.` });
      }

      // countPct: how much of the charge counts (0 = excluded, 50 = split,
      // 100 = full). Whole percents only.
      let countPct = null;
      if (hasCountPct) {
        countPct = Number(req.body.countPct);
        if (!Number.isInteger(countPct) || countPct < 0 || countPct > 100) {
          return res
            .status(400)
            .json({ error: "countPct must be a whole number from 0 to 100." });
        }
      }

      // COALESCE(NULL, col) keeps the existing value for whichever field
      // this PATCH doesn't carry.
      const updated = await sql`
        UPDATE budget_transactions
           SET category = COALESCE(${hasCategory ? category : null}, category),
               count_pct = COALESCE(${hasCountPct ? countPct : null}::int, count_pct)
         WHERE id = ${id} AND household_id = ${household.id}
         RETURNING id, merchant_clean, category, count_pct
      `;
      if (!updated.length) {
        return res.status(404).json({ error: "No such transaction." });
      }
      const tx = updated[0];

      let backfilled = 0;
      // Guard: an empty pattern would match every merchant forever (both
      // the includes() below and categoryFor at ingest) — refuse to create
      // a rule from a transaction whose merchant_clean is somehow empty.
      // applyToFuture only makes sense on a category change.
      if (applyToFuture && hasCategory && tx.merchant_clean) {
        const pattern = tx.merchant_clean;
        // Rules are household-wide: a rule either member creates applies to
        // every future import, whoever uploads it.
        await sql`
          INSERT INTO budget_category_rules (user_id, household_id, pattern, category)
          VALUES (${userId}, ${household.id}, ${pattern}, ${category})
          ON CONFLICT (household_id, pattern) DO UPDATE SET category = EXCLUDED.category
        `;

        const candidates = await sql`
          SELECT id, merchant_clean FROM budget_transactions
           WHERE household_id = ${household.id} AND category = 'uncategorized' AND id != ${id}
        `;
        const matchIds = candidates
          .filter((c) => c.merchant_clean.includes(pattern))
          .map((c) => c.id);

        if (matchIds.length) {
          const results = await sql.transaction(
            matchIds.map(
              (matchId) => sql`
                UPDATE budget_transactions SET category = ${category}
                 WHERE id = ${matchId} AND household_id = ${household.id}
                RETURNING id
              `
            )
          );
          backfilled = results.reduce((sum, r) => sum + r.length, 0);
        }
      }

      return res.status(200).json({ ok: true, transaction: tx, backfilled });
    }

    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget transactions error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
