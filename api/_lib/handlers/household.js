// Vercel serverless function — /api/budget/household
//
// Everything about WHO shares this ledger. The household itself is resolved
// from the verified session (never from the request body), so every branch
// here can only ever act on the caller's own household.
//
//   GET    -> household, members, live invites (owner only), card ownership,
//             and spend-per-person for the latest month + trailing year
//   POST   -> { action: "invite", label? }  owner mints a code (shown once)
//             { action: "join", code }      redeem someone else's code
//   PATCH  -> { name }                      rename the household (any member)
//             { displayName }               name yourself
//             { memberUserId, displayName } owner names someone else
//   DELETE -> ?memberUserId=…  remove a person (owner)
//             ?inviteId=…      revoke an unused invite (owner)
const { requireUser, sendAuthError, HttpError } = require("../budget-auth");
const { getSql, ensureTables } = require("../budget-db");
const {
  HOUSEHOLD_NAME_MAX,
  DISPLAY_NAME_MAX,
  resolveHousehold,
  listMembers,
  createInvite,
  redeemInvite,
  removeMember,
} = require("../budget-household");

/** Spend per PERSON, attributed by whose card it is — not who uploaded it. */
async function spendByMember(sql, householdId) {
  const [{ latest_month: latestMonth }] = await sql`
    SELECT to_char(MAX(posted_date), 'YYYY-MM') AS latest_month
      FROM budget_transactions
     WHERE household_id = ${householdId} AND amount_cents > 0
  `;
  if (!latestMonth) return { latestMonth: null, spend: [] };

  const monthStart = `${latestMonth}-01`;
  // Trailing 12 months ending with the latest month that has data.
  const [year, month] = latestMonth.split("-").map(Number);
  const windowStart = new Date(Date.UTC(year, month - 12, 1)).toISOString().slice(0, 10);

  const spend = await sql`
    SELECT COALESCE(a.member_user_id, a.user_id) AS member_user_id,
           SUM(ROUND(t.amount_cents * t.count_pct / 100.0))
             FILTER (WHERE t.posted_date >= ${monthStart})::int AS latest_cents,
           SUM(ROUND(t.amount_cents * t.count_pct / 100.0))::int AS window_cents
      FROM budget_transactions t
      JOIN budget_accounts a ON a.id = t.account_id
     WHERE t.household_id = ${householdId}
       AND t.amount_cents > 0
       AND t.posted_date >= ${windowStart}
     GROUP BY 1
     ORDER BY 3 DESC
  `;
  return { latestMonth, spend };
}

async function handleGet(sql, res, userId, household) {
  const [members, accounts, { latestMonth, spend }] = await Promise.all([
    listMembers(sql, household.id),
    sql`
      SELECT id, label, bank, last4, member_user_id, user_id
        FROM budget_accounts
       WHERE household_id = ${household.id}
       ORDER BY label ASC
    `,
    spendByMember(sql, household.id),
  ]);

  // Codes themselves are unrecoverable (hash-only storage) — the list exists
  // so an owner can see what's outstanding and revoke it.
  const invites = household.isOwner
    ? await sql`
        SELECT id, label, created_at, expires_at
          FROM budget_household_invites
         WHERE household_id = ${household.id}
           AND redeemed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC
      `
    : [];

  return res.status(200).json({
    configured: true,
    household: {
      id: household.id,
      name: household.name,
      role: household.role,
      isOwner: household.isOwner,
    },
    you: { userId },
    members: members.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      role: m.role,
      joinedAt: m.joined_at,
      removedAt: m.removed_at,
      isYou: m.user_id === userId,
    })),
    invites,
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      bank: a.bank,
      last4: a.last4,
      memberUserId: a.member_user_id || a.user_id,
    })),
    latestMonth,
    spendByMember: spend.map((s) => ({
      userId: s.member_user_id,
      latestCents: s.latest_cents || 0,
      windowCents: s.window_cents || 0,
    })),
  });
}

async function handlePost(sql, req, res, userId, household) {
  const action = String(req.body?.action || "");

  if (action === "invite") {
    const { invite, code } = await createInvite(sql, household, userId, req.body?.label);
    // The only time this code is ever readable.
    return res.status(201).json({ ok: true, code, invite });
  }

  if (action === "join") {
    const joined = await redeemInvite(sql, userId, household, req.body?.code);
    return res.status(200).json({
      ok: true,
      household: { id: joined.id, name: joined.name, role: joined.role, isOwner: false },
    });
  }

  return res.status(400).json({ error: 'action must be "invite" or "join".' });
}

async function handlePatch(sql, req, res, userId, household) {
  const wantsName = req.body?.name !== undefined;
  const wantsDisplayName = req.body?.displayName !== undefined;

  if (wantsName) {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > HOUSEHOLD_NAME_MAX) {
      return res
        .status(400)
        .json({ error: `A name is required, up to ${HOUSEHOLD_NAME_MAX} characters.` });
    }
    const [updated] = await sql`
      UPDATE budget_households SET name = ${name}
       WHERE id = ${household.id}
      RETURNING id, name
    `;
    return res.status(200).json({ ok: true, household: updated });
  }

  if (wantsDisplayName) {
    const raw = req.body.displayName;
    const displayName = raw == null ? null : String(raw).trim().slice(0, DISPLAY_NAME_MAX) || null;
    // Naming someone else is an owner-only courtesy so a shared ledger can
    // read "Sarah" instead of a Clerk id before she's set her own name.
    const target = req.body?.memberUserId ? String(req.body.memberUserId) : userId;
    if (target !== userId && !household.isOwner) {
      return res.status(403).json({ error: "Only the household owner can rename other members." });
    }
    const updated = await sql`
      UPDATE budget_household_members SET display_name = ${displayName}
       WHERE household_id = ${household.id} AND user_id = ${target} AND removed_at IS NULL
      RETURNING user_id, display_name
    `;
    if (!updated.length) {
      return res.status(404).json({ error: "That person isn't in this household." });
    }
    return res.status(200).json({ ok: true, member: updated[0] });
  }

  return res.status(400).json({ error: "Nothing to update." });
}

async function handleDelete(sql, req, res, userId, household) {
  const memberUserId = req.query?.memberUserId ? String(req.query.memberUserId) : null;
  const inviteId = req.query?.inviteId ? parseInt(req.query.inviteId, 10) : null;

  if (memberUserId) {
    const removed = await removeMember(sql, household, userId, memberUserId);
    return res.status(200).json({ ok: true, removed });
  }

  if (Number.isInteger(inviteId)) {
    if (!household.isOwner) {
      return res.status(403).json({ error: "Only the household owner can revoke invites." });
    }
    const revoked = await sql`
      DELETE FROM budget_household_invites
       WHERE id = ${inviteId} AND household_id = ${household.id} AND redeemed_at IS NULL
      RETURNING id
    `;
    if (!revoked.length) return res.status(404).json({ error: "No such invite." });
    return res.status(200).json({ ok: true, removed: true });
  }

  return res.status(400).json({ error: "memberUserId or inviteId is required." });
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
      return res.status(200).json({ configured: false, members: [] });
    }
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);
    const household = await resolveHousehold(sql, userId);

    // These MUST be awaited, not just returned: a returned promise's
    // rejection escapes the try/catch below, and the expected refusals from
    // the household helpers (bad invite code, not the owner, would-orphan
    // data) all arrive as rejections. Awaiting is what turns them into the
    // 4xx JSON responses the UI shows.
    if (req.method === "GET") return await handleGet(sql, res, userId, household);
    if (req.method === "POST") return await handlePost(sql, req, res, userId, household);
    if (req.method === "PATCH") return await handlePatch(sql, req, res, userId, household);
    if (req.method === "DELETE") return await handleDelete(sql, req, res, userId, household);

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    // The household helpers signal expected refusals (bad code, not the
    // owner, would-orphan-data) as HttpError — those are user-facing.
    if (err instanceof HttpError) {
      return res.status(err.status).json(err.payload);
    }
    console.error("Budget household error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
