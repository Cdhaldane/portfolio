import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import { CATEGORIES as CATEGORY_SUGGESTIONS } from "../categories";
import { activeMembers, memberLabel, labelForUserId } from "../members";
import Dropdown from "../Dropdown";
import "./TransactionsList.css";

const PAGE_SIZE = 100;
const EXPORT_PAGE = 500;

// posted_date arrives as a "YYYY-MM-DD" string (to_char in the API); slice
// defensively and format in UTC so viewers west of Greenwich don't see
// every transaction a day early.
const formatDate = (iso) => {
  const key = String(iso).slice(0, 10);
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatAmount = (cents) => {
  const abs = (Math.abs(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `+$${abs}` : `$${abs}`;
};

// Neutralize spreadsheet formula injection when exporting untrusted
// merchant strings ("=SUM(...)", "@cmd", ...).
const csvCell = (value) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/*
 * Transaction table with inline category editing, merchant search, category
 * and member filters, and CSV export. Exposes refresh() via ref; calls
 * onMutate after a category edit so the dashboard's summary refetches.
 *
 * `members` comes from the shared household fetch in Budgetter. When more
 * than one person is in the household, every row gains an "added by" credit
 * and a per-member filter appears; solo households never see either.
 */
const TransactionsList = forwardRef(({ onMutate, members, youUserId }, ref) => {
  const { getToken } = useAuth();
  const [rows, setRows] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  // Combined member filter: "" (everything), "card:<id>" (whose card the
  // charge is on — ownership), or "added:<id>" (who imported the row —
  // attribution; a different question, see BUDGETTER.md). In a shared
  // household it DEFAULTS to your own cards. null = untouched, so the
  // default can settle once the async household fetch lands without ever
  // stomping an explicit choice.
  const [who, setWho] = useState(null);
  const [exporting, setExporting] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editApplyFuture, setEditApplyFuture] = useState(false);
  const [saving, setSaving] = useState(false);

  // Split/exclude editor: which row's count-percentage picker is open.
  const [splitId, setSplitId] = useState(null);
  const [splitSaving, setSplitSaving] = useState(false);

  // Attribution UI only earns its space in a shared household.
  const memberList = useMemo(() => activeMembers(members || []), [members]);
  const shared = memberList.length > 1;

  const effectiveWho = who ?? (shared && youUserId ? `card:${youUserId}` : "");
  const whoKind = effectiveWho ? effectiveWho.slice(0, effectiveWho.indexOf(":")) : "";
  const whoId = effectiveWho ? effectiveWho.slice(effectiveWho.indexOf(":") + 1) : "";
  const cardOf = whoKind === "card" ? whoId : "";
  const addedBy = whoKind === "added" ? whoId : "";

  // Monotonic sequence: a response only applies if no newer load() started
  // after it — kills the refresh()-vs-Load-more race (stale page appended
  // onto a fresh page 0, duplicate keys).
  const loadSeq = useRef(0);
  const filtersRef = useRef({ q: "", category: "", addedBy: "", cardOf: "" });
  filtersRef.current = { q, category, addedBy, cardOf };

  const load = useCallback(
    async (offset = 0) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError("");
      const { q: fq, category: fc, addedBy: fa, cardOf: fo } = filtersRef.current;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (fq) params.set("q", fq);
      if (fc) params.set("category", fc);
      if (fa) params.set("addedBy", fa);
      if (fo) params.set("cardOf", fo);
      const { res, data } = await budgetFetch(
        getToken,
        `/api/budget/transactions?${params}`
      );
      if (seq !== loadSeq.current) return; // superseded by a newer request
      setLoading(false);
      if (!res.ok || !data) {
        setError(
          res.status === 0
            ? "Couldn't reach the API — check your connection and retry."
            : data?.error || "Couldn't load transactions — try again."
        );
        return;
      }
      setConfigured(data.configured !== false);
      setRows((prev) => (offset === 0 ? data.transactions : [...prev, ...data.transactions]));
      setHasMore(data.transactions.length === PAGE_SIZE);
    },
    [getToken]
  );

  // Initial load + debounced reload when filters change. effectiveWho also
  // moves when the household fetch first lands (the "your cards" default).
  useEffect(() => {
    const t = setTimeout(() => load(0), q ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, q, category, effectiveWho]);

  useImperativeHandle(
    ref,
    () => ({
      refresh: () => load(0),
      // Used by the dashboard's "All <category> transactions →" jump; the
      // filter-change effect fires the reload.
      setFilters: ({ category: cat = "", q: query = "" } = {}) => {
        setCategory(cat);
        setQ(query);
      },
    }),
    [load]
  );

  const exportCsv = async () => {
    setExporting(true);
    const all = [];
    let offset = 0;
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({ limit: String(EXPORT_PAGE), offset: String(offset) });
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      if (addedBy) params.set("addedBy", addedBy);
      if (cardOf) params.set("cardOf", cardOf);
      const { res, data } = await budgetFetch(getToken, `/api/budget/transactions?${params}`);
      if (!res.ok || !data) break;
      all.push(...data.transactions);
      if (data.transactions.length < EXPORT_PAGE) break;
      offset += EXPORT_PAGE;
    }
    setExporting(false);
    if (!all.length) return;
    const header = "Date,Merchant,Account,Category,Amount,CountedPct,CountedAmount,AddedBy";
    const lines = all.map((r) => {
      const pct = r.count_pct ?? 100;
      return [
        csvCell(String(r.posted_date).slice(0, 10)),
        csvCell(r.merchant_clean),
        csvCell(r.account_label),
        csvCell(r.category),
        (r.amount_cents / 100).toFixed(2),
        String(pct),
        (Math.round((r.amount_cents * pct) / 100) / 100).toFixed(2),
        csvCell(r.added_by_name || labelForUserId(r.added_by, memberList, youUserId)),
      ].join(",");
    });
    const blob = new Blob([`${header}\n${lines.join("\n")}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "budgetter-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditValue(row.category === "uncategorized" ? "" : row.category);
    setEditApplyFuture(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
    setEditApplyFuture(false);
  };

  const savePct = async (id, pct) => {
    setSplitSaving(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/transactions", {
      method: "PATCH",
      body: JSON.stringify({ id, countPct: pct }),
    });
    setSplitSaving(false);
    if (res.ok && data?.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, count_pct: pct } : r)));
      setSplitId(null);
      onMutate?.(); // totals changed — dashboard must refetch
    } else {
      setError(data?.error || "Couldn't save that change.");
    }
  };

  const saveEdit = async (id) => {
    const newCategory = editValue.trim();
    if (!newCategory) return;
    setSaving(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/transactions", {
      method: "PATCH",
      body: JSON.stringify({ id, category: newCategory, applyToFuture: editApplyFuture }),
    });
    setSaving(false);
    if (res.ok && data?.ok) {
      if (data.backfilled > 0) {
        load(0);
      } else {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, category: newCategory } : r)));
      }
      cancelEdit();
      onMutate?.();
    } else {
      setError(data?.error || "Couldn't save that category.");
    }
  };

  const hasFilters = Boolean(q || category || effectiveWho);

  if (!configured) {
    return (
      <div className="txl-empty">
        <p>The database isn't configured yet — nothing to show.</p>
      </div>
    );
  }

  return (
    <div className="txl">
      <div className="txl-filters">
        <input
          type="search"
          className="txl-search"
          placeholder="Search merchants…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search merchants"
        />
        <Dropdown
          variant="pill"
          ariaLabel="Filter by category"
          value={category}
          onChange={(v) => setCategory(v)}
          options={[
            { value: "", label: "All categories" },
            { value: "uncategorized", label: "uncategorized" },
            ...CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
          ]}
        />
        {shared && (
          <Dropdown
            variant="pill"
            ariaLabel="Filter by whose card, or by who added it"
            value={effectiveWho}
            onChange={(v) => setWho(v)}
            groups={[
              { label: "", options: [{ value: "", label: "Everything" }] },
              {
                label: "Whose card",
                options: memberList.map((m) => ({
                  value: `card:${m.userId}`,
                  label:
                    m.userId === youUserId
                      ? "Your cards"
                      : `${memberLabel(m, youUserId)}'s cards`,
                })),
              },
              {
                label: "Who added it",
                options: memberList.map((m) => ({
                  value: `added:${m.userId}`,
                  label: `Added by ${m.userId === youUserId ? "you" : memberLabel(m, youUserId)}`,
                })),
              },
            ]}
          />
        )}
        <button
          type="button"
          className="txl-export"
          onClick={exportCsv}
          disabled={exporting || rows.length === 0}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {error && rows.length === 0 && !loading ? (
        <div className="txl-empty">
          <p>{error}</p>
          <button type="button" className="txl-more" onClick={() => load(0)}>
            Retry
          </button>
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="txl-empty">
          <p>
            {hasFilters
              ? "Nothing matches those filters."
              : "No transactions yet — upload a statement to get started."}
          </p>
        </div>
      ) : (
        <>
          {error && <p className="txl-error">{error}</p>}

          <div className="txl-table" role="table" aria-label="Transactions">
            <div className="txl-row txl-row--head" role="row">
              <span role="columnheader">Date</span>
              <span role="columnheader">Merchant</span>
              <span role="columnheader">Account</span>
              <span role="columnheader">Category</span>
              <span role="columnheader" className="txl-col-amount">
                Amount
              </span>
            </div>

            {rows.map((row) => {
              const pct = row.count_pct ?? 100;
              const effective = Math.round((row.amount_cents * pct) / 100);
              return (
              <div
                className={`txl-row ${pct === 0 ? "txl-row--excluded" : ""}`}
                role="row"
                key={row.id}
              >
                <span role="cell" className="txl-date">
                  {formatDate(row.posted_date)}
                </span>
                <span role="cell" className="txl-merchant">
                  {row.merchant_clean}
                </span>
                <span role="cell" className="txl-account">
                  <span className="txl-account-name">{row.account_label}</span>
                  {shared && row.added_by && (
                    <span className="txl-addedby">
                      {labelForUserId(row.added_by, memberList, youUserId)} added this
                    </span>
                  )}
                </span>
                <span role="cell" className="txl-category">
                  {editingId === row.id ? (
                    <span className="txl-edit">
                      <input
                        autoFocus
                        list="budget-category-suggestions"
                        value={editValue}
                        maxLength={40}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(row.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <label className="txl-edit-future">
                        <input
                          type="checkbox"
                          checked={editApplyFuture}
                          onChange={(e) => setEditApplyFuture(e.target.checked)}
                        />
                        apply to matching transactions
                      </label>
                      <span className="txl-edit-actions">
                        <button type="button" onClick={() => saveEdit(row.id)} disabled={saving}>
                          Save
                        </button>
                        <button type="button" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`txl-badge ${
                        row.category === "uncategorized" ? "txl-badge--empty" : ""
                      }`}
                      onClick={() => startEdit(row)}
                    >
                      {row.category === "uncategorized" ? "+ categorize" : row.category}
                    </button>
                  )}
                </span>
                <span
                  role="cell"
                  className={`txl-amount ${row.amount_cents < 0 ? "txl-amount--credit" : ""}`}
                >
                  <button
                    type="button"
                    className="txl-amount-btn"
                    onClick={() => setSplitId(splitId === row.id ? null : row.id)}
                    title={
                      pct < 100
                        ? `Counting ${pct}% of ${formatAmount(row.amount_cents)} — click to change`
                        : "Click to split or exclude this charge"
                    }
                  >
                    {formatAmount(pct === 0 ? row.amount_cents : effective)}
                    {pct > 0 && pct < 100 && <span className="txl-pct">{pct}%</span>}
                    {pct === 0 && <span className="txl-pct">excl.</span>}
                  </button>
                </span>

                {splitId === row.id && (
                  <div className="txl-split" role="cell">
                    <span className="txl-split-label">
                      How much of this counts? (splits, reimbursements)
                    </span>
                    <span className="txl-split-btns">
                      {[100, 75, 50, 25, 0].map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`txl-split-btn ${pct === p ? "is-active" : ""}`}
                          disabled={splitSaving}
                          onClick={() => savePct(row.id, p)}
                        >
                          {p === 100 ? "Full" : p === 0 ? "Exclude" : `${p}%`}
                        </button>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            );
            })}
          </div>

          <datalist id="budget-category-suggestions">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          {loading && <p className="txl-hint">Loading…</p>}
          {hasMore && !loading && (
            <button type="button" className="txl-more" onClick={() => load(rows.length)}>
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
});

TransactionsList.displayName = "TransactionsList";

export default TransactionsList;
