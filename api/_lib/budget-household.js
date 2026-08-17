// Household resolution + membership for /api/budget/* — NOT an endpoint
// (the `_lib` prefix keeps Vercel from routing to it).
//
// Every data handler runs requireUser() first (identity + allowlist, no DB)
// and then resolveHousehold() to learn WHICH LEDGER that person belongs to.
// The household id is the only tenancy filter in the app; a caller can never
// name one, it is always derived from their verified session.
//
//   requireUser()      -> who are you, and are you allowed in at all?
//   resolveHousehold() -> whose books are you looking at?
//
// ⚠️ hashScope: budget_transactions.dedup_hash was originally salted with the
// uploader's user id. It is now salted with the household OWNER's user id,
// which is byte-identical for every pre-household row (that owner *was* the
// only uploader) — so re-uploading an old statement still dedupes, and two
// members uploading the same statement produce the same hash instead of
// double-importing. Never salt it with the *caller's* id.
const { HttpError } = require("./budget-auth");
const { hashInviteCode, inviteExpiry, newInviteCode } = require("./budget-invite");

const HOUSEHOLD_NAME_MAX = 60;
const DISPLAY_NAME_MAX = 40;
const INVITE_LABEL_MAX = 60;
const MAX_ACTIVE_INVITES = 5;

const shapeHousehold = (row, role) => ({
  id: row.id,
  name: row.name,
  ownerUserId: row.owner_user_id,
  hashScope: row.owner_user_id,
  role,
  isOwner: role === "owner",
});

/**
 * The household this verified user belongs to, creating a private one on
 * first sight so a freshly allowlisted person always lands somewhere valid
 * (they can then redeem an invite to join someone else's).
 */
async function resolveHousehold(sql, userId) {
  const rows = await sql`
    SELECT h.id, h.name, h.owner_user_id, m.role
      FROM budget_household_members m
      JOIN budget_households h ON h.id = m.household_id
     WHERE m.user_id = ${userId} AND m.removed_at IS NULL
     LIMIT 1
  `;
  if (rows.length) return shapeHousehold(rows[0], rows[0].role);

  // First request from this user. ON CONFLICT covers two cold starts racing
  // each other, and covers the case where they still own an empty household
  // they were previously removed from.
  await sql`
    INSERT INTO budget_households (owner_user_id, name)
    VALUES (${userId}, 'My household')
    ON CONFLICT (owner_user_id) DO NOTHING
  `;
  const [created] = await sql`
    SELECT id, name, owner_user_id FROM budget_households
     WHERE owner_user_id = ${userId}
  `;
  await sql`
    INSERT INTO budget_household_members (household_id, user_id, role, removed_at)
    VALUES (${created.id}, ${userId}, 'owner', NULL)
    ON CONFLICT (household_id, user_id)
      DO UPDATE SET removed_at = NULL, role = 'owner'
  `;
  return shapeHousehold(created, "owner");
}

/** Active members first, then departed ones (kept for name resolution). */
async function listMembers(sql, householdId) {
  return sql`
    SELECT user_id, role, display_name, joined_at, removed_at
      FROM budget_household_members
     WHERE household_id = ${householdId}
     ORDER BY (removed_at IS NOT NULL), joined_at ASC
  `;
}

/** Just the ids of people currently in the household (reminders fan out here). */
async function activeMemberIds(sql, householdId) {
  const rows = await sql`
    SELECT user_id FROM budget_household_members
     WHERE household_id = ${householdId} AND removed_at IS NULL
     ORDER BY joined_at ASC
  `;
  return rows.map((r) => r.user_id);
}

/** Does this household hold anything a join would orphan? */
async function householdHasData(sql, householdId) {
  // budget_plans counts too: an owner's household row is DELETEd on join and
  // every tenant table cascades, so saved Afford scenarios would silently
  // vanish. (Category rules are deliberately absent — they're derivable and
  // there's no UI to clear them, so counting them could wedge a join.)
  const [{ count }] = await sql`
    SELECT (
      (SELECT COUNT(*) FROM budget_transactions WHERE household_id = ${householdId}) +
      (SELECT COUNT(*) FROM budget_accounts     WHERE household_id = ${householdId}) +
      (SELECT COUNT(*) FROM budget_recurring    WHERE household_id = ${householdId}) +
      (SELECT COUNT(*) FROM budget_income       WHERE household_id = ${householdId}) +
      (SELECT COUNT(*) FROM budget_budgets      WHERE household_id = ${householdId}) +
      (SELECT COUNT(*) FROM budget_plans        WHERE household_id = ${householdId})
    )::int AS count
  `;
  return count > 0;
}

/**
 * Mint an invite for `household`. Returns the plaintext code ONCE — only its
 * hash is stored, so it can never be shown again (revoke and re-issue
 * instead). Owner-only; capped so a stale pile of live codes can't build up.
 */
async function createInvite(sql, household, createdBy, label) {
  if (!household.isOwner) {
    throw new HttpError(403, { error: "Only the household owner can invite people." });
  }
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM budget_household_invites
     WHERE household_id = ${household.id}
       AND redeemed_at IS NULL AND expires_at > now()
  `;
  if (count >= MAX_ACTIVE_INVITES) {
    throw new HttpError(400, {
      error: `You already have ${count} unused invites — revoke one before making another.`,
    });
  }

  const code = newInviteCode();
  const cleanLabel = String(label || "").trim().slice(0, INVITE_LABEL_MAX) || null;
  const expiresAt = inviteExpiry();
  const [invite] = await sql`
    INSERT INTO budget_household_invites
      (household_id, code_hash, label, created_by, expires_at)
    VALUES
      (${household.id}, ${hashInviteCode(code)}, ${cleanLabel}, ${createdBy}, ${expiresAt.toISOString()})
    RETURNING id, label, created_at, expires_at
  `;
  return { invite, code };
}

/**
 * Redeem `code` and move `userId` into the inviting household.
 *
 * Refuses rather than merges: if the joiner's current household holds any
 * data, or has other people in it, the join is rejected with a message
 * explaining why. Nothing is silently deleted or combined.
 */
async function redeemInvite(sql, userId, current, code) {
  const codeHash = hashInviteCode(code);
  if (!codeHash) {
    throw new HttpError(400, { error: "That doesn't look like an invite code." });
  }

  const [invite] = await sql`
    SELECT i.id, i.household_id, h.name, h.owner_user_id
      FROM budget_household_invites i
      JOIN budget_households h ON h.id = i.household_id
     WHERE i.code_hash = ${codeHash}
       AND i.redeemed_at IS NULL
       AND i.expires_at > now()
  `;
  if (!invite) {
    throw new HttpError(400, { error: "That invite code is invalid, used, or expired." });
  }
  if (invite.household_id === current.id) {
    throw new HttpError(400, { error: "You're already in that household." });
  }

  const others = await sql`
    SELECT user_id FROM budget_household_members
     WHERE household_id = ${current.id} AND removed_at IS NULL AND user_id != ${userId}
  `;
  if (others.length) {
    throw new HttpError(400, {
      error:
        "You're sharing your current household with someone else. Ask them to remove you before you join another.",
    });
  }
  if (await householdHasData(sql, current.id)) {
    throw new HttpError(400, {
      error:
        "Your current household already has data in it. Joining would leave it orphaned — clear it out first, or have the other person join you instead.",
    });
  }

  // Vacate the old household, then take the seat in the new one. The partial
  // unique index (one active membership per person) makes the order matter,
  // and sql.transaction keeps all three writes in one round trip so a
  // failure can't leave the user in neither household.
  const vacate = current.isOwner
    ? sql`DELETE FROM budget_households WHERE id = ${current.id} AND owner_user_id = ${userId}`
    : sql`
        UPDATE budget_household_members SET removed_at = now()
         WHERE household_id = ${current.id} AND user_id = ${userId}
      `;
  await sql.transaction([
    vacate,
    sql`
      INSERT INTO budget_household_members (household_id, user_id, role, removed_at)
      VALUES (${invite.household_id}, ${userId}, 'member', NULL)
      ON CONFLICT (household_id, user_id)
        DO UPDATE SET removed_at = NULL, role = 'member', joined_at = now()
    `,
    sql`
      UPDATE budget_household_invites
         SET redeemed_by = ${userId}, redeemed_at = now()
       WHERE id = ${invite.id} AND redeemed_at IS NULL
    `,
  ]);

  return {
    id: invite.household_id,
    name: invite.name,
    ownerUserId: invite.owner_user_id,
    hashScope: invite.owner_user_id,
    role: "member",
    isOwner: false,
  };
}

/** Owner-only. Soft-removes so their rows keep resolving to a name. */
async function removeMember(sql, household, actorUserId, targetUserId) {
  if (!household.isOwner) {
    throw new HttpError(403, { error: "Only the household owner can remove people." });
  }
  if (targetUserId === household.ownerUserId) {
    throw new HttpError(400, { error: "The owner can't be removed from their own household." });
  }
  const removed = await sql`
    UPDATE budget_household_members SET removed_at = now()
     WHERE household_id = ${household.id}
       AND user_id = ${targetUserId}
       AND removed_at IS NULL
    RETURNING user_id
  `;
  if (!removed.length) {
    throw new HttpError(404, { error: "That person isn't in this household." });
  }
  return removed[0].user_id;
}

module.exports = {
  HOUSEHOLD_NAME_MAX,
  DISPLAY_NAME_MAX,
  INVITE_LABEL_MAX,
  resolveHousehold,
  listMembers,
  activeMemberIds,
  householdHasData,
  createInvite,
  redeemInvite,
  removeMember,
};
