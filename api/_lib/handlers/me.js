// Vercel serverless function — GET /api/budget/me
// Smoke test for the Budgetter auth chain: verifies the Clerk session token
// and the allowlist, then echoes who you are. Every future /api/budget/*
// endpoint follows this exact shape: requireUser() first, data second.
const { requireUser, sendAuthError } = require("../budget-auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId } = await requireUser(req);
    return res.status(200).json({ ok: true, userId });
  } catch (err) {
    return sendAuthError(res, err);
  }
};
