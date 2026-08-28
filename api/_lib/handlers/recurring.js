// Vercel serverless function — /api/budget/recurring
// Manual fixed monthly payments (mortgage, insurance, hydro…) that never
// show up on an uploaded card statement. These are NOT materialized into
// budget_transactions — the dashboard overlays them per month based on
// [start_month, end_month], so editing an item retroactively fixes history
// and there's no cron job to break.
//
// A bill may be OWNED by one member (member_user_id) or shared by the whole
// household (NULL, the default — mortgage, hydro). The per-member dashboard
// math counts owned bills in full for their owner and splits shared ones
// evenly among active members.
//
//   GET    -> list all items (active and ended)
//   POST   -> { label, category, amountCents, dueDay?, startMonth?, endMonth?,
//              onCard?, paidFrom?, memberUserId? }
//              endMonth on create is for a cost with a KNOWN finish — a car
//              loan's last payment, a 12-month contract — so the dashboard
//              stops counting it on its own with nothing to remember later.
//   PATCH  -> { id, ...same fields..., endMonth?, memberUserId? }  partial
//              update; memberUserId null makes the bill shared again
//   DELETE -> ?id=N  remove entirely (PATCH endMonth to stop-but-keep-history)
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold, activeMemberIds } = require("../budget-household");

const LABEL_MAX = 60;
const CATEGORY_MAX = 40;
const PAID_FROM_MAX = 40;
const AMOUNT_MAX = 100_000_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const currentMonth = () => new Date().toISOString().slice(0, 7);

function validAmount(v) {
  return Number.isInteger(v) && v > 0 && v <= AMOUNT_MAX;
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
      return res.status(200).json({ configured: false, recurring: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    if (req.method === "GET") {
      const recurring = await sql`
        SELECT id, label, category, amount_cents, due_day, start_month, end_month, on_card, paid_from, member_user_id
          FROM budget_recurring
         WHERE household_id = ${household.id}
         ORDER BY amount_cents DESC, label ASC
      `;
      return res.status(200).json({ configured: true, recurring });
    }

    if (req.method === "POST") {
      const label = String(req.body?.label || "").trim();
      const category = String(req.body?.category || "Bills").trim();
      const amountCents = Number(req.body?.amountCents);
      const dueDay = req.body?.dueDay == null ? null : Number(req.body.dueDay);
      const startMonth = String(req.body?.startMonth || currentMonth());
      const endMonth =
        req.body?.endMonth == null || req.body.endMonth === ""
          ? null
          : String(req.body.endMonth);
      const onCard = req.body?.onCard === true;
      const paidFrom =
        req.body?.paidFrom == null ? null : String(req.body.paidFrom).trim() || null;
      // NULL = shared household bill (the default); a named owner must be an
      // active member (same check as card assignment).
      let memberUserId = null;
      if (req.body?.memberUserId) {
        memberUserId = String(req.body.memberUserId);
        const members = await activeMemberIds(sql, household.id);
        if (!members.includes(memberUserId)) {
          return res.status(400).json({ error: "That person isn't in this household." });
        }
      }

      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: 'A label is required (e.g. "Mortgage").' });
      }
      if (!category || category.length > CATEGORY_MAX) {
        return res.status(400).json({ error: "A valid category is required." });
      }
      if (paidFrom != null && paidFrom.length > PAID_FROM_MAX) {
        return res.status(400).json({ error: "Paid-from label is too long." });
      }
      if (!validAmount(amountCents)) {
        return res.status(400).json({ error: "Amount must be a positive dollar value." });
      }
      if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
        return res.status(400).json({ error: "Due day must be between 1 and 31." });
      }
      if (!MONTH_RE.test(startMonth) || (endMonth != null && !MONTH_RE.test(endMonth))) {
        return res.status(400).json({ error: "Months must be YYYY-MM." });
      }
      if (endMonth != null && endMonth < startMonth) {
        return res.status(400).json({ error: "End month can't be before the start month." });
      }

      const [item] = await sql`
        INSERT INTO budget_recurring (user_id, household_id, label, category, amount_cents, due_day, start_month, end_month, on_card, paid_from, member_user_id)
        VALUES (${userId}, ${household.id}, ${label}, ${category}, ${amountCents}, ${dueDay}, ${startMonth}, ${endMonth}, ${onCard}, ${paidFrom}, ${memberUserId})
        RETURNING id, label, category, amount_cents, due_day, start_month, end_month, on_card, paid_from, member_user_id
      `;
      return res.status(201).json({ ok: true, item });
    }

    if (req.method === "PATCH") {
      const id = parseInt(req.body?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const existing = await sql`
        SELECT id, label, category, amount_cents, due_day, start_month, end_month, on_card, paid_from, member_user_id
          FROM budget_recurring
         WHERE id = ${id} AND household_id = ${household.id}
      `;
      if (!existing.length) return res.status(404).json({ error: "No such item." });
      const cur = existing[0];

      // Nullable merge like paidFrom: explicit null makes the bill shared
      // again. Only an ownership CHANGE is validated against active members —
      // a bill still attributed to a departed member (soft-removed, kept for
      // history) must stay editable.
      let memberUserId = cur.member_user_id;
      if (req.body?.memberUserId !== undefined) {
        memberUserId = req.body.memberUserId == null ? null : String(req.body.memberUserId);
        if (memberUserId != null && memberUserId !== cur.member_user_id) {
          const members = await activeMemberIds(sql, household.id);
          if (!members.includes(memberUserId)) {
            return res.status(400).json({ error: "That person isn't in this household." });
          }
        }
      }

      const label =
        req.body?.label != null ? String(req.body.label).trim() : cur.label;
      const category =
        req.body?.category != null ? String(req.body.category).trim() : cur.category;
      const amountCents =
        req.body?.amountCents != null ? Number(req.body.amountCents) : cur.amount_cents;
      const dueDay =
        req.body?.dueDay !== undefined
          ? req.body.dueDay == null
            ? null
            : Number(req.body.dueDay)
          : cur.due_day;
      const startMonth =
        req.body?.startMonth != null ? String(req.body.startMonth) : cur.start_month;
      const onCard =
        req.body?.onCard !== undefined ? req.body.onCard === true : cur.on_card;
      const paidFrom =
        req.body?.paidFrom !== undefined
          ? req.body.paidFrom == null
            ? null
            : String(req.body.paidFrom).trim() || null
          : cur.paid_from;
      const endMonth =
        req.body?.endMonth !== undefined
          ? req.body.endMonth == null || req.body.endMonth === ""
            ? null
            : String(req.body.endMonth)
          : cur.end_month;

      if (!label || label.length > LABEL_MAX) {
        return res.status(400).json({ error: "Label is required." });
      }
      if (!category || category.length > CATEGORY_MAX) {
        return res.status(400).json({ error: "A valid category is required." });
      }
      if (!validAmount(amountCents)) {
        return res.status(400).json({ error: "Amount must be a positive dollar value." });
      }
      if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
        return res.status(400).json({ error: "Due day must be between 1 and 31." });
      }
      if (paidFrom != null && paidFrom.length > PAID_FROM_MAX) {
        return res.status(400).json({ error: "Paid-from label is too long." });
      }
      if (!MONTH_RE.test(startMonth) || (endMonth != null && !MONTH_RE.test(endMonth))) {
        return res.status(400).json({ error: "Months must be YYYY-MM." });
      }
      if (endMonth != null && endMonth < startMonth) {
        return res.status(400).json({ error: "End month can't be before the start month." });
      }

      const [item] = await sql`
        UPDATE budget_recurring
           SET label = ${label}, category = ${category}, amount_cents = ${amountCents},
               due_day = ${dueDay}, start_month = ${startMonth}, end_month = ${endMonth},
               on_card = ${onCard}, paid_from = ${paidFrom}, member_user_id = ${memberUserId}
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id, label, category, amount_cents, due_day, start_month, end_month, on_card, paid_from, member_user_id
      `;
      return res.status(200).json({ ok: true, item });
    }

    if (req.method === "DELETE") {
      const id = parseInt(req.query?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid id is required." });
      }
      const deleted = await sql`
        DELETE FROM budget_recurring
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id
      `;
      if (!deleted.length) return res.status(404).json({ error: "No such item." });
      return res.status(200).json({ ok: true, removed: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget recurring error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
