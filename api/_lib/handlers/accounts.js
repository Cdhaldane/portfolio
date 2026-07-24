// Vercel serverless function — GET/POST /api/budget/accounts
// GET  -> list the caller's accounts (never another user's — every query is
//         scoped by user_id from the verified session, not a client-supplied id).
// POST -> create an account. "last4" is validated to be exactly 4 digits;
//         both it and the free-text label are checked against PAN-shaped
//         digit runs so a full card number can never land in the DB, even
//         by accident — this app's security story depends on that being true.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");

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

    if (req.method === "GET") {
      const accounts = await sql`
        SELECT id, bank, label, last4, created_at
          FROM budget_accounts
         WHERE user_id = ${userId}
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

      const inserted = await sql`
        INSERT INTO budget_accounts (user_id, bank, label, last4)
        VALUES (${userId}, ${cleanBank}, ${cleanLabel}, ${cleanLast4})
        RETURNING id, bank, label, last4, created_at
      `;
      return res.status(201).json({ ok: true, account: inserted[0] });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Budget accounts error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
