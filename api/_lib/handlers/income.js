// Vercel serverless function — /api/budget/income
// Income sources (paycheques). Same window model as budget_recurring:
// [start_month, end_month] scopes when a source counts, so editing an
// amount retroactively corrects history. `cadence` says how often the
// amount lands; the client normalizes to a monthly average (weekly ×52/12,
// biweekly ×26/12, semimonthly ×2) — no payday-calendar math on purpose:
// savings-per-month reads best against a steady income baseline.
//
//   GET    -> list all sources
//   POST   -> { label, amountCents, cadence, startMonth? }
//   PATCH  -> { id, ...same fields..., endMonth? }
//   DELETE -> ?id=N
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");

const LABEL_MAX = 60;
const AMOUNT_MAX = 100_000_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CADENCES = ["weekly", "biweekly", "semimonthly", "monthly"];

const currentMonth = () => new Date().toISOString().slice(0, 7);
const validAmount = (v) => Number.isInteger(v) && v > 0 && v <= AMOUNT_MAX;

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
      return res.status(200).json({ configured: false, income: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    if (req.method === "GET") {
      const income = await sql`
        SELECT id, label, amount_cents, cadence, start_month, end_month
          FROM budget_income
         WHERE household_id = ${household.id}
         ORDER BY amount_cents DESC, label ASC
      `;
      return res.status(200).json({ configured: true, income });
    }

    if (req.method === "POST") {
      const label = String(req.body?.label || "").trim();
      const amountCents = Number(req.body?.amountCents);
      const cadence = String(req.body?.cadence || "monthly");
      const startMonth = String(req.body?.startMonth || currentMonth());

      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: 'A label is required (e.g. "Paycheque").' });
      }
      if (!validAmount(amountCents)) {
        return res.status(400).json({ error: "Amount must be a positive dollar value." });
      }
      if (!CADENCES.includes(cadence)) {
        return res.status(400).json({ error: "Cadence must be weekly, biweekly, semimonthly, or monthly." });
      }
      if (!MONTH_RE.test(startMonth)) {
        return res.status(400).json({ error: "Start month must be YYYY-MM." });
      }

      const [item] = await sql`
        INSERT INTO budget_income (user_id, household_id, label, amount_cents, cadence, start_month)
        VALUES (${userId}, ${household.id}, ${label}, ${amountCents}, ${cadence}, ${startMonth})
        RETURNING id, label, amount_cents, cadence, start_month, end_month
      `;
      return res.status(201).json({ ok: true, item });
    }

    if (req.method === "PATCH") {
      const id = parseInt(req.body?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const existing = await sql`
        SELECT id, label, amount_cents, cadence, start_month, end_month
          FROM budget_income
         WHERE id = ${id} AND household_id = ${household.id}
      `;
      if (!existing.length) return res.status(404).json({ error: "No such source." });
      const cur = existing[0];

      const label = req.body?.label != null ? String(req.body.label).trim() : cur.label;
      const amountCents =
        req.body?.amountCents != null ? Number(req.body.amountCents) : cur.amount_cents;
      const cadence = req.body?.cadence != null ? String(req.body.cadence) : cur.cadence;
      const startMonth =
        req.body?.startMonth != null ? String(req.body.startMonth) : cur.start_month;
      const endMonth =
        req.body?.endMonth !== undefined
          ? req.body.endMonth == null || req.body.endMonth === ""
            ? null
            : String(req.body.endMonth)
          : cur.end_month;

      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: "Label is required." });
      }
      if (!validAmount(amountCents)) {
        return res.status(400).json({ error: "Amount must be a positive dollar value." });
      }
      if (!CADENCES.includes(cadence)) {
        return res.status(400).json({ error: "Invalid cadence." });
      }
      if (!MONTH_RE.test(startMonth) || (endMonth != null && !MONTH_RE.test(endMonth))) {
        return res.status(400).json({ error: "Months must be YYYY-MM." });
      }
      if (endMonth != null && endMonth < startMonth) {
        return res.status(400).json({ error: "End month can't be before the start month." });
      }

      const [item] = await sql`
        UPDATE budget_income
           SET label = ${label}, amount_cents = ${amountCents}, cadence = ${cadence},
               start_month = ${startMonth}, end_month = ${endMonth}
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id, label, amount_cents, cadence, start_month, end_month
      `;
      return res.status(200).json({ ok: true, item });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const deleted = await sql`
        DELETE FROM budget_income
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id
      `;
      if (!deleted.length) return res.status(404).json({ error: "No such source." });
      return res.status(200).json({ ok: true, removed: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget income error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
