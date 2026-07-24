// Shared auth for /api/budget/* — NOT an endpoint itself (Vercel ignores
// files under api/ that are prefixed with an underscore).
//
// Every budget function calls requireUser(req) before touching data. It:
//   1. verifies the Clerk session JWT from the Authorization header
//      (signature, expiry, issuer, authorized party) via @clerk/backend, and
//   2. checks the verified user id against BUDGET_ALLOWED_USER_IDS.
//
// The allowlist is fail-closed: unset or empty means NOBODY gets in, so a
// Clerk misconfiguration (e.g. sign-ups accidentally enabled) still can't
// expose anyone's data. The 403 echoes the caller's own user id so adding
// yourself is copy-paste, same trick as the dashboard gate's IP echo.
//
// Env (set in .env.local for `vercel dev`, Vercel dashboard for prod):
//   CLERK_SECRET_KEY         sk_test_... / sk_live_... from Clerk
//   BUDGET_ALLOWED_USER_IDS  comma-separated, e.g. "user_2abc..., user_2def..."
const { verifyToken } = require("@clerk/backend");

// Local dev fallback: an unlinked `vercel dev` doesn't inject env into
// functions. Pull secrets from .env.local if they aren't already present.
if (!process.env.CLERK_SECRET_KEY) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — requireUser degrades to a 503 below */
  }
}

// Browser-issued session tokens carry an `azp` (authorized party) claim;
// rejecting unknown origins stops a token minted on another site being
// replayed here. Tokens without `azp` (e.g. backend-issued) still pass.
const AUTHORIZED_PARTIES = [
  "https://charliehaldane.ca",
  "https://www.charliehaldane.ca",
  "http://localhost:3030", // CRA dev server (npm start)
  "http://localhost:3000", // vercel dev
];

class HttpError extends Error {
  constructor(status, payload) {
    super(payload.error || "HTTP error");
    this.status = status;
    this.payload = payload;
  }
}

function allowedUserIds() {
  return (process.env.BUDGET_ALLOWED_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Verify the caller's Clerk session and allowlist membership.
 * @returns {Promise<{ userId: string, claims: object }>}
 * @throws {HttpError} 401 (no/bad token), 403 (not allowlisted), 503 (unconfigured)
 */
async function requireUser(req) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new HttpError(503, {
      error: "Auth isn't configured on the server (CLERK_SECRET_KEY is unset).",
      code: "unconfigured",
    });
  }

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw new HttpError(401, {
      error: "Sign in required.",
      code: "unauthenticated",
    });
  }

  let claims;
  try {
    claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    });
  } catch (_) {
    // Expired, tampered, wrong instance, wrong azp — all the same to the caller.
    throw new HttpError(401, {
      error: "Session invalid or expired — sign in again.",
      code: "unauthenticated",
    });
  }

  const userId = claims.sub;
  if (!allowedUserIds().includes(userId)) {
    throw new HttpError(403, {
      error: "This account isn't on the Budgetter allowlist.",
      code: "not_allowlisted",
      // Their own id, shown only to them — copy it into BUDGET_ALLOWED_USER_IDS.
      userId,
    });
  }

  return { userId, claims };
}

/** Translate a requireUser() throw into a JSON response. */
function sendAuthError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json(err.payload);
  }
  console.error("Budget auth error:", err);
  return res.status(500).json({ error: "Something went wrong." });
}

module.exports = { requireUser, sendAuthError, HttpError };
