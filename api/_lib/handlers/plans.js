// Vercel serverless function — /api/budget/plans
// Saved big-purchase scenarios for the Afford tab ("a $28k used SUV, $5k
// down, 6.9% over 60 months"). Pure inputs only: every derived number —
// payment, interest, verdict, affordable price — is computed in the browser
// from src/Pages/Budgetter/Afford/loan.js, so a formula fix never needs a
// backfill and two members always see the same arithmetic.
//
// Scenarios belong to the HOUSEHOLD, not the member: buying a car is a
// household decision, so both people see and edit the same plans.
//
//   GET    -> list all scenarios
//   POST   -> { label, priceCents, taxBps?, downCents?, tradeInCents?, aprBps?,
//              termMonths, insuranceCents?, fuelCents?, maintenanceCents?,
//              startMonth? }
//   PATCH  -> { id, ...any of the above }   partial update
//   DELETE -> ?id=N
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");

const LABEL_MAX = 60;
const AMOUNT_MAX = 100_000_000; // $1M — same ceiling as a recurring payment
const RUNNING_MAX = 1_000_000; // $10k/month of insurance/fuel/maintenance
const TAX_BPS_MAX = 3000; // 30%
const APR_BPS_MAX = 5000; // 50% — beyond this it isn't a car loan
const TERM_MAX = 120; // 10 years
const PLAN_MAX = 12; // scenarios per household
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const COLS = `id, label, price_cents, tax_bps, down_cents, trade_in_cents,
              apr_bps, term_months, insurance_cents, fuel_cents,
              maintenance_cents, start_month, created_at`;

const currentMonth = () => new Date().toISOString().slice(0, 7);

const intInRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Shared field validation for POST and PATCH. Returns an error string, or
 * null when the (already-merged) scenario is valid.
 */
function validate(p) {
  if (!p.label || p.label.length > LABEL_MAX) {
    return 'A label is required (e.g. "Used RAV4").';
  }
  if (!intInRange(p.priceCents, 1, AMOUNT_MAX)) {
    return "Price must be a positive dollar amount.";
  }
  if (!intInRange(p.taxBps, 0, TAX_BPS_MAX)) {
    return "Sales tax must be between 0 and 30%.";
  }
  if (!intInRange(p.downCents, 0, AMOUNT_MAX)) {
    return "Down payment must be a dollar amount.";
  }
  if (!intInRange(p.tradeInCents, 0, AMOUNT_MAX)) {
    return "Trade-in must be a dollar amount.";
  }
  if (!intInRange(p.aprBps, 0, APR_BPS_MAX)) {
    return "Interest rate must be between 0 and 50%.";
  }
  if (!intInRange(p.termMonths, 1, TERM_MAX)) {
    return "Term must be between 1 and 120 months.";
  }
  for (const [key, label] of [
    ["insuranceCents", "Insurance"],
    ["fuelCents", "Fuel"],
    ["maintenanceCents", "Maintenance"],
  ]) {
    if (!intInRange(p[key], 0, RUNNING_MAX)) {
      return `${label} must be a monthly dollar amount under $10,000.`;
    }
  }
  if (!MONTH_RE.test(p.startMonth)) {
    return "Purchase month must be YYYY-MM.";
  }
  return null;
}

/** Body -> integer fields, falling back to `cur` (PATCH) or a default (POST). */
function readFields(body, cur) {
  const num = (key, fallback) =>
    body?.[key] == null ? fallback : Math.round(Number(body[key]));
  return {
    label: body?.label != null ? String(body.label).trim() : cur.label,
    priceCents: num("priceCents", cur.priceCents),
    taxBps: num("taxBps", cur.taxBps),
    downCents: num("downCents", cur.downCents),
    tradeInCents: num("tradeInCents", cur.tradeInCents),
    aprBps: num("aprBps", cur.aprBps),
    termMonths: num("termMonths", cur.termMonths),
    insuranceCents: num("insuranceCents", cur.insuranceCents),
    fuelCents: num("fuelCents", cur.fuelCents),
    maintenanceCents: num("maintenanceCents", cur.maintenanceCents),
    startMonth: body?.startMonth != null ? String(body.startMonth) : cur.startMonth,
  };
}

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
      return res.status(200).json({ configured: false, plans: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    if (req.method === "GET") {
      const plans = await sql.query(
        `SELECT ${COLS} FROM budget_plans
          WHERE household_id = $1
          ORDER BY created_at ASC, id ASC`,
        [household.id]
      );
      return res.status(200).json({ configured: true, plans });
    }

    if (req.method === "POST") {
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM budget_plans
         WHERE household_id = ${household.id}
      `;
      if (count >= PLAN_MAX) {
        return res.status(400).json({
          error: `That's ${PLAN_MAX} scenarios already — delete one to add another.`,
        });
      }

      const p = readFields(req.body, {
        label: "",
        priceCents: NaN,
        taxBps: 0,
        downCents: 0,
        tradeInCents: 0,
        aprBps: 0,
        termMonths: NaN,
        insuranceCents: 0,
        fuelCents: 0,
        maintenanceCents: 0,
        startMonth: currentMonth(),
      });
      const invalid = validate(p);
      if (invalid) return res.status(400).json({ error: invalid });

      const [plan] = await sql.query(
        `INSERT INTO budget_plans
           (user_id, household_id, label, price_cents, tax_bps, down_cents,
            trade_in_cents, apr_bps, term_months, insurance_cents, fuel_cents,
            maintenance_cents, start_month)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING ${COLS}`,
        [
          userId,
          household.id,
          p.label,
          p.priceCents,
          p.taxBps,
          p.downCents,
          p.tradeInCents,
          p.aprBps,
          p.termMonths,
          p.insuranceCents,
          p.fuelCents,
          p.maintenanceCents,
          p.startMonth,
        ]
      );
      return res.status(201).json({ ok: true, plan });
    }

    if (req.method === "PATCH") {
      const id = parseInt(req.body?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const existing = await sql.query(
        `SELECT ${COLS} FROM budget_plans WHERE id = $1 AND household_id = $2`,
        [id, household.id]
      );
      if (!existing.length) return res.status(404).json({ error: "No such scenario." });
      const row = existing[0];

      const p = readFields(req.body, {
        label: row.label,
        priceCents: row.price_cents,
        taxBps: row.tax_bps,
        downCents: row.down_cents,
        tradeInCents: row.trade_in_cents,
        aprBps: row.apr_bps,
        termMonths: row.term_months,
        insuranceCents: row.insurance_cents,
        fuelCents: row.fuel_cents,
        maintenanceCents: row.maintenance_cents,
        startMonth: row.start_month,
      });
      const invalid = validate(p);
      if (invalid) return res.status(400).json({ error: invalid });

      const [plan] = await sql.query(
        `UPDATE budget_plans
            SET label = $3, price_cents = $4, tax_bps = $5, down_cents = $6,
                trade_in_cents = $7, apr_bps = $8, term_months = $9,
                insurance_cents = $10, fuel_cents = $11, maintenance_cents = $12,
                start_month = $13
          WHERE id = $1 AND household_id = $2
        RETURNING ${COLS}`,
        [
          id,
          household.id,
          p.label,
          p.priceCents,
          p.taxBps,
          p.downCents,
          p.tradeInCents,
          p.aprBps,
          p.termMonths,
          p.insuranceCents,
          p.fuelCents,
          p.maintenanceCents,
          p.startMonth,
        ]
      );
      return res.status(200).json({ ok: true, plan });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const deleted = await sql`
        DELETE FROM budget_plans
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id
      `;
      if (!deleted.length) return res.status(404).json({ error: "No such scenario." });
      return res.status(200).json({ ok: true, removed: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget plans error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
