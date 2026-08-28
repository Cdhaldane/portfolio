import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import { CATEGORIES } from "../categories";
import {
  fmtMoneyExact,
  fmtMoney,
  currentMonthKey,
  recurringActiveIn,
  addMonths,
} from "../format";
import { activeMembers, memberLabel, labelForUserId } from "../members";
import Dropdown from "../Dropdown";
import "./RecurringPanel.css";

/*
 * Bills manager — the fixed costs that never hit a card statement
 * (mortgage, insurance, hydro, water…). Items live in budget_recurring with
 * a [start_month, end_month] window; the dashboard overlays them onto every
 * month in that window, so editing an amount here retroactively corrects
 * history (that's a feature: you're modelling the bill, not bookkeeping
 * each payment).
 *
 * A bill is SHARED by default (the whole household's — the per-person
 * dashboard splits it evenly), or it can belong to one member ("Whose
 * bill"). Ownership UI only appears in a shared household.
 */
const EMPTY_FORM = {
  label: "",
  category: "Bills",
  amount: "",
  dueDay: "",
  onCard: false,
  paidFrom: "",
  startMonth: "",
  memberUserId: "",
};

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const RecurringPanel = ({ onMutate, refreshToken, members, youUserId }) => {
  const { getToken } = useAuth();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const memberList = useMemo(() => activeMembers(members || []), [members]);
  const shared = memberList.length > 1;

  const load = useCallback(async () => {
    const { res, data } = await budgetFetch(getToken, "/api/budget/recurring");
    if (res.ok && data) setItems(data.recurring || []);
    setLoaded(true);
  }, [getToken]);

  // refreshToken: a write from another tab (the Afford planner pushing a car
  // payment in) has to reach this already-mounted list.
  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const thisMonth = currentMonthKey();
  const active = useMemo(
    () => items.filter((i) => recurringActiveIn(i, thisMonth)),
    [items, thisMonth]
  );
  const ended = useMemo(
    () => items.filter((i) => !recurringActiveIn(i, thisMonth)),
    [items, thisMonth]
  );
  // Account names already in use, offered as datalist suggestions so
  // "Joint chequing" is typed once and picked ever after.
  const paidFromOptions = useMemo(
    () => [...new Set(items.map((i) => i.paid_from).filter(Boolean))].sort(),
    [items]
  );
  // On-card bills are listed and reminded about, but their charges arrive
  // via statement upload — only off-card items count as "fixed" money out.
  const totalCents = active
    .filter((i) => !i.on_card)
    .reduce((s, i) => s + i.amount_cents, 0);
  const onCardCents = active
    .filter((i) => i.on_card)
    .reduce((s, i) => s + i.amount_cents, 0);

  // Next 30 days of due dates, from due_day on active items.
  const upcoming = useMemo(() => {
    const now = new Date();
    const out = [];
    for (const item of active) {
      if (!item.due_day) continue;
      for (const monthOffset of [0, 1]) {
        const base = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
        const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const due = new Date(
          base.getFullYear(),
          base.getMonth(),
          Math.min(item.due_day, lastDay)
        );
        const days = Math.ceil((due - now) / 86400000);
        if (days >= 0 && days <= 30) {
          out.push({ ...item, due, days });
          break;
        }
      }
    }
    return out.sort((a, b) => a.due - b.due);
  }, [active]);

  const parseAmount = (s) => {
    const dollars = parseFloat(String(s).replace(/[^0-9.]/g, ""));
    return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
  };

  const add = async (e) => {
    e.preventDefault();
    setError("");
    const amountCents = parseAmount(form.amount);
    if (!form.label.trim() || !amountCents) {
      setError("A label and a positive amount are required.");
      return;
    }
    setBusy(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/recurring", {
      method: "POST",
      body: JSON.stringify({
        label: form.label.trim(),
        category: form.category,
        amountCents,
        dueDay: form.dueDay ? Number(form.dueDay) : null,
        onCard: form.onCard,
        paidFrom: form.paidFrom.trim() || null,
        startMonth: form.startMonth || undefined,
        memberUserId: form.memberUserId || null, // null = shared household bill
      }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      setForm(EMPTY_FORM);
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't add that payment.");
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      label: item.label,
      category: item.category,
      amount: String(item.amount_cents / 100),
      dueDay: item.due_day ? String(item.due_day) : "",
      onCard: Boolean(item.on_card),
      paidFrom: item.paid_from || "",
      startMonth: item.start_month || "",
      memberUserId: item.member_user_id || "",
    });
  };

  const saveEdit = async (id) => {
    setError("");
    const amountCents = parseAmount(editForm.amount);
    if (!editForm.label.trim() || !amountCents) {
      setError("A label and a positive amount are required.");
      return;
    }
    setBusy(true);
    // Send the owner only when it actually changed — the server keeps the
    // current owner when the key is absent, which keeps bills attributed to
    // a departed member editable (and their history intact).
    const curOwner = items.find((i) => i.id === id)?.member_user_id || "";
    const ownerChanged = (editForm.memberUserId || "") !== curOwner;
    const { res, data } = await budgetFetch(getToken, "/api/budget/recurring", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        label: editForm.label.trim(),
        category: editForm.category,
        amountCents,
        dueDay: editForm.dueDay ? Number(editForm.dueDay) : null,
        onCard: editForm.onCard,
        paidFrom: editForm.paidFrom.trim() || null,
        startMonth: editForm.startMonth || undefined,
        ...(ownerChanged ? { memberUserId: editForm.memberUserId || null } : {}),
      }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      setEditingId(null);
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't save that change.");
    }
  };

  // "End" = stop counting from this month on, i.e. end_month = LAST month
  // (an item stays active through its end month, so ending at the current
  // month would leave it in this month's math — and in this list — looking
  // like the button did nothing).
  const endItem = async (id) => {
    setError("");
    setBusy(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/recurring", {
      method: "PATCH",
      body: JSON.stringify({ id, endMonth: addMonths(thisMonth, -1) }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't end that payment.");
    }
  };

  const remove = async (id) => {
    setError("");
    setBusy(true);
    const { res, data } = await budgetFetch(
      getToken,
      `/api/budget/recurring?id=${id}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (res.ok && data?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't delete that payment.");
    }
  };

  const itemRow = (item) => {
    const isEditing = editingId === item.id;
    const isEnded = !recurringActiveIn(item, thisMonth);
    return (
      <div className={`rec-row ${isEnded ? "is-ended" : ""}`} key={item.id}>
        {isEditing ? (
          <div className="rec-edit">
            <input
              value={editForm.label}
              maxLength={60}
              onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
            />
            <Dropdown
              ariaLabel="Category"
              value={editForm.category}
              onChange={(v) => setEditForm((f) => ({ ...f, category: v }))}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <input
              className="rec-input-amount"
              inputMode="decimal"
              placeholder="$"
              value={editForm.amount}
              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input
              className="rec-input-day"
              inputMode="numeric"
              placeholder="Day"
              value={editForm.dueDay}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, dueDay: e.target.value.replace(/\D/g, "") }))
              }
            />
            <input
              className="rec-input-from"
              placeholder="Paid from"
              maxLength={40}
              list="rec-paidfrom-options"
              value={editForm.paidFrom}
              onChange={(e) => setEditForm((f) => ({ ...f, paidFrom: e.target.value }))}
            />
            {shared && (
              <Dropdown
                ariaLabel="Whose bill"
                value={editForm.memberUserId}
                onChange={(v) => setEditForm((f) => ({ ...f, memberUserId: v }))}
                options={[
                  { value: "", label: "Shared" },
                  // a departed owner still displays (kept for history) but
                  // can't be re-picked once changed away
                  ...(editForm.memberUserId &&
                  !memberList.some((m) => m.userId === editForm.memberUserId)
                    ? [
                        {
                          value: editForm.memberUserId,
                          label: `${labelForUserId(editForm.memberUserId, members || [], youUserId)} (left)`,
                          disabled: true,
                        },
                      ]
                    : []),
                  ...memberList.map((m) => ({
                    value: m.userId,
                    label:
                      memberLabel(m, youUserId) === "You"
                        ? "Yours"
                        : `${memberLabel(m, youUserId)}'s`,
                  })),
                ]}
              />
            )}
            <input
              type="month"
              className="rec-input-month"
              title="Since when you've been paying this — backdating fills earlier months on the dashboard"
              aria-label="Paying since (month)"
              value={editForm.startMonth}
              onChange={(e) => setEditForm((f) => ({ ...f, startMonth: e.target.value }))}
            />
            <label className="rec-check">
              <input
                type="checkbox"
                checked={editForm.onCard}
                onChange={(e) => setEditForm((f) => ({ ...f, onCard: e.target.checked }))}
              />
              billed to my card
            </label>
            <div className="rec-actions">
              <button type="button" className="rec-btn rec-btn--primary" onClick={() => saveEdit(item.id)} disabled={busy}>
                Save
              </button>
              <button type="button" className="rec-btn" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rec-main">
              <span className="rec-label">{item.label}</span>
              <span className="rec-cat">{item.category}</span>
              {item.paid_from && (
                <span
                  className="rec-cat rec-from"
                  title={`Paid from ${item.paid_from}`}
                >
                  {item.paid_from}
                </span>
              )}
              {item.on_card && (
                <span
                  className="rec-cat rec-oncard"
                  title="Charged to a tracked card — its statement charges are what count, so this amount is never added on top"
                >
                  on card
                </span>
              )}
              {shared && item.member_user_id && (
                <span
                  className="rec-cat rec-person"
                  title="This bill belongs to one person — it counts only in their per-person view"
                >
                  {labelForUserId(item.member_user_id, memberList, youUserId)}
                </span>
              )}
            </div>
            <span className="rec-due">
              {item.due_day ? `due the ${ordinal(item.due_day)}` : " "}
              {item.start_month < thisMonth ? ` · since ${item.start_month}` : ""}
              {isEnded && item.end_month ? ` · ended ${item.end_month}` : ""}
            </span>
            <span className="rec-amount">{fmtMoneyExact(item.amount_cents)}</span>
            <div className="rec-actions">
              <button type="button" className="rec-btn" onClick={() => startEdit(item)}>
                Edit
              </button>
              {!isEnded && item.start_month < thisMonth ? (
                <button
                  type="button"
                  className="rec-btn"
                  onClick={() => endItem(item.id)}
                  title="Stop counting it from this month on — earlier months keep it"
                >
                  End
                </button>
              ) : (
                // Ended items, and items that only started this month —
                // nothing to "end", there's no history worth keeping.
                <button type="button" className="rec-btn rec-btn--danger" onClick={() => remove(item.id)}>
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="rec">
      <div className="rec-head">
        <div>
          <h2 className="rec-h">Bills</h2>
          <p className="rec-sub">
            Fixed costs — mortgage, insurance, hydro. The dashboard folds
            these into every month they're active.
            {shared &&
              " Bills are shared by default (split evenly in per-person views); mark one as someone's if it's theirs alone."}{" "}
            For bills charged to a card you upload (cell phone, streaming),
            tick <em>billed to my card</em>: they're listed and reminded
            about here, but the statement charges are what count — never
            both.
          </p>
        </div>
        <div className="rec-total">
          <span className="rec-total-label">Fixed / month</span>
          <span className="rec-total-value">{fmtMoney(totalCents)}</span>
          {onCardCents > 0 && (
            <span className="rec-total-sub">
              + {fmtMoney(onCardCents)} billed to cards
            </span>
          )}
        </div>
      </div>

      <form className="rec-add" onSubmit={add}>
        <input
          placeholder='Label — e.g. "Mortgage"'
          value={form.label}
          maxLength={60}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        />
        <Dropdown
          ariaLabel="Category"
          value={form.category}
          onChange={(v) => setForm((f) => ({ ...f, category: v }))}
          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
        <input
          className="rec-input-amount"
          placeholder="$ / month"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
        <input
          className="rec-input-day"
          placeholder="Due day"
          inputMode="numeric"
          maxLength={2}
          value={form.dueDay}
          onChange={(e) => setForm((f) => ({ ...f, dueDay: e.target.value.replace(/\D/g, "") }))}
        />
        <input
          className="rec-input-from"
          placeholder="Paid from — e.g. Joint chequing"
          maxLength={40}
          list="rec-paidfrom-options"
          value={form.paidFrom}
          onChange={(e) => setForm((f) => ({ ...f, paidFrom: e.target.value }))}
          title="Which account this comes out of — chequing, joint account, a card. Just a label, so each account's list can be reconciled against its own statement."
        />
        <datalist id="rec-paidfrom-options">
          {paidFromOptions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {shared && (
          <Dropdown
            ariaLabel="Whose bill — shared splits evenly in per-person views"
            title="Shared bills split evenly between you in per-person views; a personal bill counts only for its owner"
            value={form.memberUserId}
            onChange={(v) => setForm((f) => ({ ...f, memberUserId: v }))}
            options={[
              { value: "", label: "Shared" },
              ...memberList.map((m) => ({
                value: m.userId,
                label:
                  memberLabel(m, youUserId) === "You"
                    ? "Yours"
                    : `${memberLabel(m, youUserId)}'s`,
              })),
            ]}
          />
        )}
        <input
          type="month"
          className="rec-input-month"
          title='Since when — backdate (e.g. 2026-04) and the dashboard fills those months too. Blank = this month.'
          aria-label="Paying since (month) — blank means this month"
          value={form.startMonth}
          onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))}
        />
        <label
          className="rec-check"
          title="Tick this if the bill is charged to a card you upload statements for — it'll be listed and reminded about, but only the statement charges count, so nothing double-counts"
        >
          <input
            type="checkbox"
            checked={form.onCard}
            onChange={(e) => setForm((f) => ({ ...f, onCard: e.target.checked }))}
          />
          billed to my card
        </label>
        <button type="submit" className="rec-btn rec-btn--primary" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="rec-error">{error}</p>}

      {!loaded ? (
        <p className="rec-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rec-empty">
          Nothing yet. Add your fixed bills above and the dashboard starts
          telling the whole story, not just the card.
        </p>
      ) : (
        <>
          <div className="rec-list">{active.map(itemRow)}</div>
          {ended.length > 0 && (
            <>
              <p className="rec-ended-h">Ended</p>
              <div className="rec-list">{ended.map(itemRow)}</div>
            </>
          )}
        </>
      )}

      {upcoming.length > 0 && (
        <div className="rec-upcoming">
          <h3 className="rec-h3">Next 30 days</h3>
          {upcoming.map((u) => (
            <div className="rec-up-row" key={u.id}>
              <span className="rec-up-when">
                {u.days === 0 ? "today" : u.days === 1 ? "tomorrow" : `in ${u.days} days`}
              </span>
              <span className="rec-up-label">{u.label}</span>
              <span className="rec-amount">{fmtMoneyExact(u.amount_cents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RecurringPanel;
