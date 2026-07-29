// Vercel serverless function — GET /api/budget/me
// Smoke test for the Budgetter auth chain: verifies the Clerk session token
// and the allowlist, then echoes who you are and which household you're in.
// Every other /api/budget/* endpoint follows this exact shape: requireUser()
// first, resolveHousehold() second, data third.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  // The auth chain is the point of this endpoint, so a missing database still
  // reports ok:true — it just can't say which household yet.
  const sql = getSql();
  if (!sql) {
    return res.status(200).json({ ok: true, userId, household: null });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);
    return res.status(200).json({
      ok: true,
      userId,
      household: {
        id: household.id,
        name: household.name,
        role: household.role,
        isOwner: household.isOwner,
      },
    });
  } catch (err) {
    console.error("Budget me error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
