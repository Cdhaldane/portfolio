// Pure invite-code helpers for household invites. No DB, no network — so
// this is directly unit-testable (`npm run test:api`).
//
// Security shape: the plaintext code is shown to the inviter exactly once and
// only its sha256 is stored, so a leaked database row can't be redeemed. The
// code alone is never sufficient anyway — the redeemer still has to hold a
// Clerk session AND be on BUDGET_ALLOWED_USER_IDS, which is the real gate.
const crypto = require("crypto");

// Crockford-flavoured alphabet: no I, L, O, U, 0 or 1, so a code read out
// over the phone can't be mistyped into a different valid code. 30 symbols ^
// 8 characters ≈ 39 bits of entropy.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
const INVITE_TTL_DAYS = 7;

/** A fresh code, hyphenated for reading aloud: "K7QP-3MTZ". */
function newInviteCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt is uniform over the range — no modulo bias.
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Strip formatting and case so "k7qp-3mtz", "K7QP 3MTZ" and "K7QP3MTZ" all
 * redeem the same invite. Returns null for anything that isn't a
 * well-formed code — callers treat null as "invalid code", never as a
 * lookup for the empty string.
 */
function normalizeInviteCode(input) {
  const stripped = String(input == null ? "" : input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== CODE_LENGTH) return null;
  for (const ch of stripped) {
    if (!ALPHABET.includes(ch)) return null;
  }
  return stripped;
}

/** sha256 of the normalized code, or null if the code is malformed. */
function hashInviteCode(input) {
  const normalized = normalizeInviteCode(input);
  if (!normalized) return null;
  return crypto
    .createHash("sha256")
    .update(`budget-invite|${normalized}`)
    .digest("hex");
}

/** Expiry for a code minted now. `from` is injectable for tests. */
function inviteExpiry(from = new Date()) {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86400000);
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  INVITE_TTL_DAYS,
  newInviteCode,
  normalizeInviteCode,
  hashInviteCode,
  inviteExpiry,
};
