// Vercel serverless function — GET/POST/PATCH /api/budget/accounts
// GET   -> list the household's cards (never another household's — every
//          query is scoped by the household resolved from the verified
//          session, not by a client-supplied id).
// POST  -> create a card. "last4" is validated to be exactly 4 digits; both
//          it and the free-text label are checked against PAN-shaped digit
//          runs so a full card number can never land in the DB, even by
//          accident — this app's security story depends on that being true.
// PATCH -> relabel a card or reassign whose card it is (member_user_id). That
//          assignment is what spend-per-person reads: the uploader of a
//          statement is not necessarily the person who spent the money.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold, activeMemberIds } = require("../budget-household");

const BANKS = ["amex", "td", "triangle", "other"];
const LABEL_MAX = 60;

// Visa/Mastercard/Amex PANs run 13-19 digits, with or without separators.
const looksLikeFullCardNumber = (s) => /\d[\d \-]{11,18}\d/.test(s);

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
      return res.status(200).json({ configured: false, accounts: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    if (req.method === "GET") {
      const accounts = await sql`
        SELECT id, bank, label, last4, created_at,
               COALESCE(member_user_id, user_id) AS member_user_id,
               user_id AS added_by
          FROM budget_accounts
         WHERE household_id = ${household.id}
         ORDER BY created_at ASC
      `;
      return res.status(200).json({ configured: true, accounts });
    }

    if (req.method === "POST") {
      const { bank, label, last4 } = req.body || {};
      const cleanBank = BANKS.includes(bank) ? bank : "other";
      const cleanLabel = String(label || "").trim();

      if (!cleanLabel) {
        return res
          .status(400)
          .json({ error: 'A label is required (e.g. "Amex Cobalt").' });
      }
      if (cleanLabel.length > LABEL_MAX) {
        return res
          .status(400)
          .json({ error: `Label must be ${LABEL_MAX} characters or fewer.` });
      }
      if (looksLikeFullCardNumber(cleanLabel)) {
        return res.status(400).json({
          error: "That looks like a full card number — use a nickname instead.",
        });
      }

      let cleanLast4 = null;
      if (last4 != null && String(last4).trim() !== "") {
        cleanLast4 = String(last4).trim();
        if (!/^\d{4}$/.test(cleanLast4)) {
          return res.status(400).json({
            error: "Only the last 4 digits — never the full card number.",
          });
        }
      }

      // Whose card it is defaults to whoever added it; a card can only ever
      // be assigned to a current member of this household.
      let memberUserId = userId;
      if (req.body?.memberUserId) {
        memberUserId = String(req.body.memberUserId);
        const members = await activeMemberIds(sql, household.id);
        if (!members.includes(memberUserId)) {
          return res.status(400).json({ error: "That person isn't in this household." });
        }
      }

      const inserted = await sql`
        INSERT INTO budget_accounts (user_id, household_id, member_user_id, bank, label, last4)
        VALUES (${userId}, ${household.id}, ${memberUserId}, ${cleanBank}, ${cleanLabel}, ${cleanLast4})
        RETURNING id, bank, label, last4, member_user_id, created_at
      `;
      return res.status(201).json({ ok: true, account: inserted[0] });
    }

    if (req.method === "PATCH") {
      const id = parseInt(req.body?.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "A valid account id is required." });
      }

      const existing = await sql`
        SELECT id, bank, label, last4, user_id, member_user_id
          FROM budget_accounts
         WHERE id = ${id} AND household_id = ${household.id}
      `;
      if (!existing.length) return res.status(404).json({ error: "No such account." });
      const current = existing[0];

      let label = current.label;
      if (req.body?.label !== undefined) {
        label = String(req.body.label || "").trim();
        if (!label || label.length > LABEL_MAX) {
          return res
            .status(400)
            .json({ error: `Label must be 1-${LABEL_MAX} characters.` });
        }
        if (looksLikeFullCardNumber(label)) {
          return res.status(400).json({
            error: "That looks like a full card number — use a nickname instead.",
          });
        }
      }

      let memberUserId = current.member_user_id || current.user_id;
      if (req.body?.memberUserId !== undefined) {
        memberUserId = String(req.body.memberUserId || "");
        const members = await activeMemberIds(sql, household.id);
        if (!members.includes(memberUserId)) {
          return res.status(400).json({ error: "That person isn't in this household." });
        }
      }

      const [account] = await sql`
        UPDATE budget_accounts
           SET label = ${label}, member_user_id = ${memberUserId}
         WHERE id = ${id} AND household_id = ${household.id}
        RETURNING id, bank, label, last4, member_user_id, created_at
      `;
      return res.status(200).json({ ok: true, account });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget accounts error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
