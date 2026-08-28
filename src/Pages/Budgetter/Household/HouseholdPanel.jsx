import { useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import { fmtMoney } from "../format";
import { activeMembers, memberLabel, memberInitials } from "../members";
import Dropdown from "../Dropdown";
import "./HouseholdPanel.css";

/*
 * Household tab — who shares this ledger.
 *
 * The data comes from Budgetter (one /api/budget/household fetch, shared with
 * the Transactions list so both agree on names); this panel owns the
 * mutations and calls onReload() after each one.
 *
 * Joining is code-based on purpose: the owner mints a code, reads it out, and
 * the other person types it in. Nobody has to copy a Clerk user id around,
 * and the code is only half the gate — the API allowlist is still the thing
 * that decides who can reach Budgetter at all.
 */
const HouseholdPanel = ({ data, loading, error, onReload, onMutate }) => {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");

  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameTarget, setNameTarget] = useState(null); // member being renamed
  const [memberNameDraft, setMemberNameDraft] = useState("");

  const [inviteLabel, setInviteLabel] = useState("");
  const [freshCode, setFreshCode] = useState(null);
  const [copied, setCopied] = useState(false);

  const [joinCode, setJoinCode] = useState("");

  const youId = data?.you?.userId;
  // Memoized so the derived lists below don't see a fresh array every render.
  const members = useMemo(() => data?.members || [], [data]);
  const active = useMemo(() => activeMembers(members), [members]);
  const departed = useMemo(() => members.filter((m) => m.removedAt), [members]);
  const isOwner = Boolean(data?.household?.isOwner);
  const shared = active.length > 1;
  // Only somebody alone in their own household can join another one; the API
  // enforces the same rule (plus "and it must be empty").
  const canJoin = isOwner && active.length === 1;

  const call = async (options, { onOk } = {}) => {
    setBusy(true);
    setFailure("");
    setNotice("");
    const { res, data: body } = await budgetFetch(getToken, "/api/budget/household", options);
    setBusy(false);
    if (!res.ok || !body?.ok) {
      setFailure(
        res.status === 0
          ? "Couldn't reach the API — check your connection and try again."
          : body?.error || "That didn't work. Try again."
      );
      return null;
    }
    onOk?.(body);
    onReload?.();
    return body;
  };

  const saveHouseholdName = async () => {
    const name = nameDraft.trim();
    if (!name) return;
    const ok = await call(
      { method: "PATCH", body: JSON.stringify({ name }) },
      { onOk: () => setNotice("Household renamed.") }
    );
    if (ok) setRenaming(false);
  };

  const saveMemberName = async (userId) => {
    const displayName = memberNameDraft.trim();
    const ok = await call(
      {
        method: "PATCH",
        body: JSON.stringify({ memberUserId: userId, displayName: displayName || null }),
      },
      { onOk: () => setNotice("Name updated.") }
    );
    if (ok) setNameTarget(null);
  };

  const createInvite = async () => {
    setFreshCode(null);
    setCopied(false);
    await call(
      {
        method: "POST",
        body: JSON.stringify({ action: "invite", label: inviteLabel.trim() || undefined }),
      },
      {
        onOk: (body) => {
          setFreshCode({ code: body.code, expiresAt: body.invite?.expires_at });
          setInviteLabel("");
        },
      }
    );
  };

  const removeMember = async (userId, label) => {
    if (!window.confirm(`Remove ${label} from this household? They'll lose access immediately.`)) {
      return;
    }
    setBusy(true);
    setFailure("");
    const { res, data: body } = await budgetFetch(
      getToken,
      `/api/budget/household?memberUserId=${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!res.ok || !body?.ok) {
      setFailure(body?.error || "Couldn't remove that person.");
      return;
    }
    setNotice(`${label} no longer has access.`);
    onReload?.();
  };

  const revoke = async (id) => {
    setBusy(true);
    setFailure("");
    const { res, data: body } = await budgetFetch(
      getToken,
      `/api/budget/household?inviteId=${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!res.ok || !body?.ok) {
      setFailure(body?.error || "Couldn't revoke that invite.");
      return;
    }
    setNotice("Invite revoked.");
    onReload?.();
  };

  const join = async (e) => {
    e.preventDefault();
    const body = await call(
      { method: "POST", body: JSON.stringify({ action: "join", code: joinCode }) },
      { onOk: (b) => setNotice(`You're in — welcome to ${b.household?.name || "the household"}.`) }
    );
    if (body) {
      setJoinCode("");
      // Everything on screen belongs to a different ledger now.
      onMutate?.();
    }
  };

  const assignCard = async (accountId, memberUserId) => {
    setBusy(true);
    setFailure("");
    const { res, data: body } = await budgetFetch(getToken, "/api/budget/accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: accountId, memberUserId }),
    });
    setBusy(false);
    if (!res.ok || !body?.ok) {
      setFailure(body?.error || "Couldn't reassign that card.");
      return;
    }
    onReload?.();
    onMutate?.();
  };

  const copyCode = async () => {
    if (!freshCode?.code) return;
    try {
      await navigator.clipboard.writeText(freshCode.code);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, permissions) — the code is
      // on screen to read out, so this is a nicety, not a failure path.
      setFailure("Couldn't copy automatically — select the code and copy it.");
    }
  };

  const spendLookup = useMemo(() => {
    const map = new Map();
    for (const row of data?.spendByMember || []) map.set(row.userId, row);
    return map;
  }, [data]);

  if (loading && !data) {
    return <p className="hh-hint">Loading household…</p>;
  }
  if (error && !data) {
    return (
      <div className="hh-empty">
        <p>{error}</p>
        <button type="button" className="hh-btn" onClick={onReload}>
          Retry
        </button>
      </div>
    );
  }
  if (data && data.configured === false) {
    return (
      <div className="hh-empty">
        <p>The database isn't configured yet — no household to show.</p>
      </div>
    );
  }

  return (
    <div className="hh">
      <div className="hh-head">
        <div>
          <p className="hh-kicker">Household</p>
          {renaming ? (
            <div className="hh-rename">
              <input
                autoFocus
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveHouseholdName();
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label="Household name"
              />
              <button type="button" className="hh-btn" disabled={busy} onClick={saveHouseholdName}>
                Save
              </button>
              <button type="button" className="hh-btn hh-btn--quiet" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <h2 className="hh-h">
              {data?.household?.name || "My household"}
              <button
                type="button"
                className="hh-inline"
                onClick={() => {
                  setNameDraft(data?.household?.name || "");
                  setRenaming(true);
                }}
              >
                rename
              </button>
            </h2>
          )}
          <p className="hh-sub">
            {shared
              ? `${active.length} people share this ledger — every card, bill, budget and
                 income source below is common ground.`
              : `Everything in Budgetter belongs to this household. Invite someone and you
                 both see the same numbers.`}
          </p>
        </div>
        <span className={`hh-role ${isOwner ? "hh-role--owner" : ""}`}>
          {isOwner ? "Owner" : "Member"}
        </span>
      </div>

      {notice && <p className="hh-notice">{notice}</p>}
      {failure && <p className="hh-error">{failure}</p>}

      <section className="hh-card">
        <h3 className="hh-h3">People</h3>
        <ul className="hh-people">
          {active.map((member) => {
            const label = memberLabel(member, youId);
            const spend = spendLookup.get(member.userId);
            return (
              <li className="hh-person" key={member.userId}>
                <span className="hh-avatar" aria-hidden="true">
                  {memberInitials(label)}
                </span>
                <span className="hh-person-main">
                  {nameTarget === member.userId ? (
                    <span className="hh-rename">
                      <input
                        autoFocus
                        value={memberNameDraft}
                        maxLength={40}
                        placeholder="e.g. Sarah"
                        onChange={(e) => setMemberNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveMemberName(member.userId);
                          if (e.key === "Escape") setNameTarget(null);
                        }}
                        aria-label="Display name"
                      />
                      <button
                        type="button"
                        className="hh-btn"
                        disabled={busy}
                        onClick={() => saveMemberName(member.userId)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="hh-btn hh-btn--quiet"
                        onClick={() => setNameTarget(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <>
                      <span className="hh-person-name">
                        {label}
                        {member.isYou && <span className="hh-you">you</span>}
                        {member.role === "owner" && <span className="hh-tag">owner</span>}
                      </span>
                      <span className="hh-person-meta">
                        {spend
                          ? `${fmtMoney(spend.latestCents)} on their cards in ${
                              data?.latestMonth || "the latest month"
                            }`
                          : "no card spending recorded yet"}
                      </span>
                    </>
                  )}
                </span>
                <span className="hh-person-actions">
                  {(member.isYou || isOwner) && nameTarget !== member.userId && (
                    <button
                      type="button"
                      className="hh-btn hh-btn--quiet"
                      onClick={() => {
                        setMemberNameDraft(member.displayName || "");
                        setNameTarget(member.userId);
                      }}
                    >
                      {member.displayName ? "Rename" : "Name"}
                    </button>
                  )}
                  {isOwner && !member.isYou && member.role !== "owner" && (
                    <button
                      type="button"
                      className="hh-btn hh-btn--danger"
                      disabled={busy}
                      onClick={() => removeMember(member.userId, label)}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {departed.length > 0 && (
          <p className="hh-hint">
            Previously here: {departed.map((m) => memberLabel(m, youId)).join(", ")}. Their
            imports and edits stay in the ledger, still credited to them.
          </p>
        )}
      </section>

      {isOwner && (
        <section className="hh-card">
          <h3 className="hh-h3">Invite someone</h3>
          <p className="hh-sub">
            They need a Budgetter account (created by hand — sign-ups are off) and to be on the
            API allowlist. Then this code puts them in your household.
          </p>

          {freshCode ? (
            <div className="hh-code" role="status">
              <span className="hh-code-label">Read this out — it won't be shown again</span>
              <strong className="hh-code-value">{freshCode.code}</strong>
              <span className="hh-code-actions">
                <button type="button" className="hh-btn" onClick={copyCode}>
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  className="hh-btn hh-btn--quiet"
                  onClick={() => setFreshCode(null)}
                >
                  Done
                </button>
              </span>
              <span className="hh-code-meta">
                Single use, expires in 7 days. Only its hash is stored, so it can't be looked up
                later — revoke and issue a new one if it goes astray.
              </span>
            </div>
          ) : (
            <div className="hh-inviteform">
              <input
                value={inviteLabel}
                maxLength={60}
                placeholder="Who's it for? (optional)"
                onChange={(e) => setInviteLabel(e.target.value)}
                aria-label="Invite label"
              />
              <button type="button" className="hh-btn hh-btn--primary" disabled={busy} onClick={createInvite}>
                Create invite code
              </button>
            </div>
          )}

          {(data?.invites || []).length > 0 && (
            <ul className="hh-invites">
              {data.invites.map((invite) => (
                <li key={invite.id}>
                  <span className="hh-invite-label">{invite.label || "Unlabelled invite"}</span>
                  <span className="hh-invite-meta">
                    expires {new Date(invite.expires_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    className="hh-btn hh-btn--quiet"
                    disabled={busy}
                    onClick={() => revoke(invite.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canJoin && (
        <section className="hh-card">
          <h3 className="hh-h3">Got an invite code?</h3>
          <p className="hh-sub">
            Joining someone else's household replaces this empty one. If you've already added
            data here, clear it out first — nothing is merged or deleted behind your back.
          </p>
          <form className="hh-inviteform" onSubmit={join}>
            <input
              value={joinCode}
              maxLength={20}
              placeholder="XXXX-XXXX"
              onChange={(e) => setJoinCode(e.target.value)}
              aria-label="Invite code"
            />
            <button type="submit" className="hh-btn hh-btn--primary" disabled={busy || !joinCode.trim()}>
              Join household
            </button>
          </form>
        </section>
      )}

      {shared && (data?.accounts || []).length > 0 && (
        <section className="hh-card">
          <h3 className="hh-h3">Whose card is whose</h3>
          <p className="hh-sub">
            Spend-per-person reads this, not who uploaded the statement — so one person can
            import everything and the split still comes out right.
          </p>
          <ul className="hh-cards">
            {data.accounts.map((account) => (
              <li key={account.id}>
                <span className="hh-card-label">
                  {account.label}
                  {account.last4 && <span className="hh-last4">••{account.last4}</span>}
                </span>
                <Dropdown
                  ariaLabel={`Who owns ${account.label}`}
                  value={account.memberUserId || ""}
                  disabled={busy}
                  onChange={(v) => assignCard(account.id, v)}
                  options={active.map((member) => ({
                    value: member.userId,
                    label: memberLabel(member, youId),
                  }))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Spend-per-person moved to the dashboard's "Per person" card, where
          it sits beside income and savings — this tab stays pure admin. */}
    </div>
  );
};

export default HouseholdPanel;
