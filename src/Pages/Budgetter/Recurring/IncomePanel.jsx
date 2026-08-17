import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import {
  fmtMoney,
  fmtMoneyExact,
  currentMonthKey,
  recurringActiveIn,
  monthlyIncomeCents,
  addMonths,
  CADENCES,
} from "../format";
import "./RecurringPanel.css";

/*
 * Income sources — the top half of the Monthly tab. A source is an amount +
 * cadence (weekly pay, biweekly pay, monthly salary…) normalized to a
 * monthly average for the dashboard's savings math. Same [start, end]
 * window model as monthly payments: "End" stops it going forward, history
 * stays correct. Shares RecurringPanel.css (.rec-*).
 */
const EMPTY_FORM = { label: "", amount: "", cadence: "weekly", startMonth: "" };

const cadenceLabel = (value) =>
  CADENCES.find((c) => c.value === value)?.label || value;

const IncomePanel = ({ onMutate, refreshToken }) => {
  const { getToken } = useAuth();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    const { res, data } = await budgetFetch(getToken, "/api/budget/income");
    if (res.ok && data) setItems(data.income || []);
    setLoaded(true);
  }, [getToken]);

  // refreshToken: a household join swaps the whole ledger under this
  // already-mounted list, so a bump from Budgetter has to reach it.
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
  const monthlyTotal = active.reduce((s, i) => s + monthlyIncomeCents(i), 0);

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
    const { res, data } = await budgetFetch(getToken, "/api/budget/income", {
      method: "POST",
      body: JSON.stringify({
        label: form.label.trim(),
        amountCents,
        cadence: form.cadence,
        startMonth: form.startMonth || undefined,
      }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      setForm(EMPTY_FORM);
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't add that income source.");
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditForm({
      label: item.label,
      amount: String(item.amount_cents / 100),
      cadence: item.cadence,
      startMonth: item.start_month || "",
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
    const { res, data } = await budgetFetch(getToken, "/api/budget/income", {
      method: "PATCH",
      body: JSON.stringify({
        id,
        label: editForm.label.trim(),
        amountCents,
        cadence: editForm.cadence,
        startMonth: editForm.startMonth || undefined,
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

  // Same "End" semantics as RecurringPanel: end_month = LAST month, because
  // a source stays active through its end month — ending at the current one
  // would leave it in this month's math and this list, looking like a no-op.
  const endItem = async (id) => {
    setError("");
    setBusy(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/income", {
      method: "PATCH",
      body: JSON.stringify({ id, endMonth: addMonths(thisMonth, -1) }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't end that income source.");
    }
  };

  const remove = async (id) => {
    setError("");
    setBusy(true);
    const { res, data } = await budgetFetch(getToken, `/api/budget/income?id=${id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't delete that income source.");
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
            <input
              className="rec-input-amount"
              inputMode="decimal"
              placeholder="$"
              value={editForm.amount}
              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <select
              value={editForm.cadence}
              onChange={(e) => setEditForm((f) => ({ ...f, cadence: e.target.value }))}
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="month"
              className="rec-input-month"
              title="Since when this income has been coming in — backdating fills earlier months' savings"
              aria-label="Income since (month)"
              value={editForm.startMonth}
              onChange={(e) => setEditForm((f) => ({ ...f, startMonth: e.target.value }))}
            />
            <div className="rec-actions">
              <button
                type="button"
                className="rec-btn rec-btn--primary"
                onClick={() => saveEdit(item.id)}
                disabled={busy}
              >
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
              <span className="rec-cat rec-cat--income">
                {fmtMoneyExact(item.amount_cents)} {cadenceLabel(item.cadence)}
              </span>
            </div>
            <span className="rec-due">
              {item.start_month < thisMonth ? `since ${item.start_month}` : ""}
              {isEnded && item.end_month ? ` · ended ${item.end_month}` : " "}
            </span>
            <span className="rec-amount">≈ {fmtMoney(monthlyIncomeCents(item))}/mo</span>
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
                <button
                  type="button"
                  className="rec-btn rec-btn--danger"
                  onClick={() => remove(item.id)}
                >
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
          <h2 className="rec-h">Income</h2>
          <p className="rec-sub">
            Paycheques and other regular money in. Weekly and biweekly pay is
            averaged to a monthly figure (×52÷12) so savings read against a
            steady baseline.
          </p>
        </div>
        <div className="rec-total rec-total--income">
          <span className="rec-total-label">Income / month</span>
          <span className="rec-total-value">≈ {fmtMoney(monthlyTotal)}</span>
        </div>
      </div>

      <form className="rec-add" onSubmit={add}>
        <input
          placeholder='Label — e.g. "Paycheque"'
          value={form.label}
          maxLength={60}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        />
        <input
          className="rec-input-amount"
          placeholder="$"
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        />
        <select
          value={form.cadence}
          onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}
        >
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="month"
          className="rec-input-month"
          title="Since when — backdate (e.g. 2026-04) and past months' savings fill in. Blank = this month."
          aria-label="Income since (month) — blank means this month"
          value={form.startMonth}
          onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))}
        />
        <button type="submit" className="rec-btn rec-btn--primary" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="rec-error">{error}</p>}

      {!loaded ? (
        <p className="rec-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rec-empty">
          No income yet. Add your pay and the dashboard starts showing how
          much you actually save each month.
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
    </div>
  );
};

export default IncomePanel;
