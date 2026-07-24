import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES } from "../categories";
import {
  fmtMoney,
  fmtMoneyExact,
  monthShort,
  monthLong,
  addMonths,
  fixedForMonth,
  incomeForMonth,
  recurringActiveIn,
} from "../format";
import "./SpendingDashboard.css";

/*
 * Spending dashboard — card spending from uploaded statements PLUS the
 * fixed monthly payments managed in the Monthly tab, overlaid per month.
 *
 * Chart design per the dataviz method: spending is a magnitude job, so the
 * palette is the blue ramp only — card spend in --blue, fixed costs in
 * --blue-deep (two steps of one ramp, separated by lightness and a 2px
 * surface gap, with a legend because there are now two series). Sage/coral
 * remain status-only and always ride with signed text.
 *
 * Receives fetchJson(path, options) from the parent instead of touching
 * Clerk directly, so the dev-only preview route can render it with mock
 * data outside the auth gate.
 */

const VBW = 720;
const VBH = 240;
const PAD = { l: 48, r: 10, t: 22, b: 28 };
const SEG_GAP = 2; // surface gap between stacked segments, in viewBox px

const niceMax = (v) => {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * exp >= v) return m * exp;
  }
  return 10 * exp;
};

// Bar segment with a 4px rounded data-end and a square baseline end.
const topRoundedBar = (x, y, w, h) => {
  const r = Math.min(4, h, w / 2);
  const yb = y + h;
  return `M ${x} ${yb} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${yb} Z`;
};

const titleCase = (s) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const SpendingDashboard = ({
  refreshToken,
  onMutate,
  fetchJson,
  onOpenTransactions,
  onOpenUpload,
}) => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [granularity, setGranularity] = useState("months");
  const [selected, setSelected] = useState(null);
  const [tip, setTip] = useState(null);
  const [catBusy, setCatBusy] = useState(false);
  const [trackBusy, setTrackBusy] = useState(null);

  const [editingCat, setEditingCat] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [newBudget, setNewBudget] = useState({ category: "", amount: "" });
  const [budgetError, setBudgetError] = useState("");

  // Category drill-down: which breakdown row is expanded, and its charges.
  const [drill, setDrill] = useState(null); // { category, loading, rows, error }

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const { res, data: body } = await fetchJson("/api/budget/summary");
    setBusy(false);
    if (!res.ok || !body) {
      setError(body?.error || "Couldn't load the summary — try again.");
      return;
    }
    setData(body);
  }, [fetchJson]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const recurring = useMemo(() => data?.recurring || [], [data]);
  const income = useMemo(() => data?.income || [], [data]);
  const hasIncome = income.length > 0;

  // month key -> { card, txCount, byCategory: Map } (card spending only)
  const monthIndex = useMemo(() => {
    const index = new Map();
    for (const row of data?.months || []) {
      let entry = index.get(row.month);
      if (!entry) {
        entry = { card: 0, txCount: 0, byCategory: new Map() };
        index.set(row.month, entry);
      }
      entry.card += row.spend_cents;
      entry.txCount += row.tx_count;
      entry.byCategory.set(
        row.category,
        (entry.byCategory.get(row.category) || 0) + row.spend_cents
      );
    }
    return index;
  }, [data]);

  const monthKeys = useMemo(() => [...monthIndex.keys()].sort(), [monthIndex]);
  const latestMonth = monthKeys[monthKeys.length - 1] || null;

  const fixedForYear = useCallback(
    (year) => {
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        if (latestMonth && key > latestMonth) break;
        sum += fixedForMonth(recurring, key);
      }
      return sum;
    },
    [recurring, latestMonth]
  );

  const incomeForYear = useCallback(
    (year) => {
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        if (latestMonth && key > latestMonth) break;
        sum += incomeForMonth(income, key);
      }
      return sum;
    },
    [income, latestMonth]
  );

  // Bar series: last 12 calendar months (gaps zero-filled) or one per year.
  // Each band carries card + fixed separately for the stacked render.
  const series = useMemo(() => {
    if (!latestMonth) return [];
    if (granularity === "months") {
      const floor = addMonths(latestMonth, -11);
      const start = monthKeys[0] > floor ? monthKeys[0] : floor;
      const out = [];
      let key = start;
      while (key <= latestMonth) {
        const entry = monthIndex.get(key);
        const card = entry?.card || 0;
        const fixed = fixedForMonth(recurring, key);
        const monthIncome = incomeForMonth(income, key);
        out.push({
          key,
          label: monthShort(key),
          longLabel: monthLong(key),
          card,
          fixed,
          total: card + fixed,
          income: monthIncome,
          saved: monthIncome > 0 ? monthIncome - (card + fixed) : null,
          txCount: entry?.txCount || 0,
        });
        key = addMonths(key, 1);
      }
      return out;
    }
    const byYear = new Map();
    for (const [key, entry] of monthIndex) {
      const year = key.slice(0, 4);
      const y = byYear.get(year) || { card: 0, txCount: 0 };
      y.card += entry.card;
      y.txCount += entry.txCount;
      byYear.set(year, y);
    }
    return [...byYear.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([year, v]) => {
        const fixed = fixedForYear(year);
        const yearIncome = incomeForYear(year);
        return {
          key: year,
          label: year,
          longLabel: year,
          card: v.card,
          fixed,
          total: v.card + fixed,
          income: yearIncome,
          saved: yearIncome > 0 ? yearIncome - (v.card + fixed) : null,
          txCount: v.txCount,
        };
      });
  }, [granularity, latestMonth, monthKeys, monthIndex, recurring, income, fixedForYear, incomeForYear]);

  // Every period selectable in the dropdown — newest first. Months run the
  // full calendar range from the first data month, NOT just the chart's
  // 12-month window, so older statements stay reachable.
  const periodOptions = useMemo(() => {
    if (!latestMonth) return [];
    if (granularity === "months") {
      const out = [];
      let key = monthKeys[0];
      while (key <= latestMonth) {
        out.push(key);
        key = addMonths(key, 1);
      }
      return out.reverse();
    }
    return [...new Set(monthKeys.map((k) => k.slice(0, 4)))].sort().reverse();
  }, [granularity, monthKeys, latestMonth]);

  useEffect(() => {
    if (!periodOptions.length) return;
    if (!periodOptions.includes(selected)) {
      setSelected(periodOptions[0]);
    }
  }, [periodOptions, selected]);

  // Changing period or granularity invalidates an open drill-down.
  useEffect(() => {
    setDrill(null);
  }, [selected, granularity]);

  const toggleDrill = useCallback(
    async (category) => {
      if (drill?.category === category) {
        setDrill(null);
        return;
      }
      if (!selected) return;
      setDrill({ category, loading: true, rows: [], error: "" });
      const params = new URLSearchParams({ category, limit: "200" });
      if (selected.length === 7) params.set("month", selected);
      else params.set("year", selected);
      const { res, data: body } = await fetchJson(`/api/budget/transactions?${params}`);
      setDrill((cur) => {
        if (!cur || cur.category !== category) return cur; // superseded
        if (!res.ok || !body) {
          return { ...cur, loading: false, error: "Couldn't load those charges." };
        }
        return { ...cur, loading: false, rows: body.transactions || [] };
      });
    },
    [drill, selected, fetchJson]
  );

  // Fixed (recurring) items that contribute to a category in the selected
  // period — shown at the top of the drill-down, since they aren't card
  // transactions and won't come back from the API.
  const drillFixedItems = useMemo(() => {
    if (!drill || !selected) return [];
    const isMonth = selected.length === 7;
    return recurring
      .map((item) => {
        if (item.category !== drill.category || item.on_card) return null;
        if (isMonth) {
          return recurringActiveIn(item, selected) ? { ...item, monthsActive: 1 } : null;
        }
        let n = 0;
        for (let m = 1; m <= 12; m++) {
          const key = `${selected}-${String(m).padStart(2, "0")}`;
          if (latestMonth && key > latestMonth) break;
          if (recurringActiveIn(item, key)) n++;
        }
        return n > 0 ? { ...item, monthsActive: n } : null;
      })
      .filter(Boolean);
  }, [drill, selected, recurring, latestMonth]);

  // The selected period's numbers. Usually straight out of the chart series,
  // but a month picked from the dropdown can predate the charted window —
  // synthesize the same shape from the raw month index so every card still
  // has its data. (Years are always all in the series.)
  const selectedEntry = useMemo(() => {
    const inSeries = series.find((s) => s.key === selected);
    if (inSeries) return inSeries;
    if (!selected || selected.length !== 7) return null;
    const entry = monthIndex.get(selected);
    const card = entry?.card || 0;
    const fixed = fixedForMonth(recurring, selected);
    const monthIncome = incomeForMonth(income, selected);
    return {
      key: selected,
      label: monthShort(selected),
      longLabel: monthLong(selected),
      card,
      fixed,
      total: card + fixed,
      income: monthIncome,
      saved: monthIncome > 0 ? monthIncome - (card + fixed) : null,
      txCount: entry?.txCount || 0,
    };
  }, [series, selected, monthIndex, recurring, income]);
  const hasFixed = recurring.length > 0;

  // Merged card + fixed spending by category for a period.
  const mergedByCategory = useCallback(
    (periodKey) => {
      const sums = new Map();
      if (!periodKey) return sums;
      const isMonth = periodKey.length === 7;
      for (const [monthKey, entry] of monthIndex) {
        const inPeriod = isMonth ? monthKey === periodKey : monthKey.startsWith(periodKey);
        if (!inPeriod) continue;
        for (const [cat, cents] of entry.byCategory) {
          sums.set(cat, (sums.get(cat) || 0) + cents);
        }
      }
      const monthsInPeriod = isMonth
        ? [periodKey]
        : Array.from({ length: 12 }, (_, i) => `${periodKey}-${String(i + 1).padStart(2, "0")}`)
            .filter((k) => !latestMonth || k <= latestMonth);
      for (const item of recurring) {
        if (item.on_card) continue; // real charges already in card data
        for (const mk of monthsInPeriod) {
          if (recurringActiveIn(item, mk)) {
            sums.set(item.category, (sums.get(item.category) || 0) + item.amount_cents);
          }
        }
      }
      return sums;
    },
    [monthIndex, recurring, latestMonth]
  );

  const breakdown = useMemo(() => {
    const sums = mergedByCategory(selected);
    const total = [...sums.values()].reduce((a, b) => a + b, 0);
    return [...sums.entries()]
      .map(([category, cents]) => ({
        category,
        cents,
        pct: total ? (cents / total) * 100 : 0,
      }))
      .sort((a, b) => b.cents - a.cents);
  }, [selected, mergedByCategory]);

  const maxBreakdown = breakdown.length ? breakdown[0].cents : 0;

  // Top merchants for the selected period (card data only — fixed items are
  // already itemized by name in the Monthly tab).
  const topMerchants = useMemo(() => {
    if (!selected) return [];
    const isMonth = selected.length === 7;
    const sums = new Map();
    for (const row of data?.merchants || []) {
      const inPeriod = isMonth ? row.month === selected : row.month.startsWith(selected);
      if (!inPeriod) continue;
      const cur = sums.get(row.merchant_clean) || { cents: 0, count: 0 };
      cur.cents += row.spend_cents;
      cur.count += row.tx_count;
      sums.set(row.merchant_clean, cur);
    }
    return [...sums.entries()]
      .map(([merchant, v]) => ({ merchant, ...v }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 6);
  }, [selected, data]);

  const maxMerchant = topMerchants.length ? topMerchants[0].cents : 0;

  // Month-over-month category movers (months mode only).
  const movers = useMemo(() => {
    if (granularity !== "months" || !selected) return [];
    const prevKey = addMonths(selected, -1);
    if (!monthIndex.has(prevKey) && fixedForMonth(recurring, prevKey) === 0) return [];
    const cur = mergedByCategory(selected);
    const prev = mergedByCategory(prevKey);
    const cats = new Set([...cur.keys(), ...prev.keys()]);
    return [...cats]
      .map((cat) => ({
        category: cat,
        delta: (cur.get(cat) || 0) - (prev.get(cat) || 0),
        prevLabel: monthShort(prevKey),
      }))
      .filter((m) => Math.abs(m.delta) >= 500)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
  }, [granularity, selected, monthIndex, recurring, mergedByCategory]);

  // Subscription detector: merchant charged EXACTLY ONCE per month in >=2
  // of the last 3 data months, with stable amounts, and not already tracked
  // in Monthly payments. The once-per-month requirement is what separates a
  // Netflix from a grocery store — stable monthly grocery totals are a
  // habit, not a subscription.
  const detectedSubs = useMemo(() => {
    const recent = monthKeys.slice(-3);
    if (recent.length < 2) return [];
    const byMerchant = new Map();
    for (const row of data?.merchants || []) {
      if (!recent.includes(row.month)) continue;
      const entry = byMerchant.get(row.merchant_clean) || new Map();
      entry.set(row.month, { cents: row.spend_cents, count: row.tx_count });
      byMerchant.set(row.merchant_clean, entry);
    }
    const out = [];
    for (const [merchant, months] of byMerchant) {
      if (months.size < 2) continue;
      const entries = [...months.values()];
      if (entries.some((e) => e.count !== 1)) continue;
      const amounts = entries.map((e) => e.cents);
      const max = Math.max(...amounts);
      const min = Math.min(...amounts);
      if (max - min > Math.max(300, max * 0.2)) continue;
      const alreadyTracked = recurring.some((r) => {
        const label = r.label.toUpperCase();
        return label.includes(merchant) || merchant.includes(label);
      });
      if (alreadyTracked) continue;
      out.push({ merchant, amountCents: amounts[amounts.length - 1], months: months.size });
    }
    return out.sort((a, b) => b.amountCents - a.amountCents).slice(0, 4);
  }, [monthKeys, data, recurring]);

  const autoCategorize = async () => {
    setCatBusy(true);
    setError("");
    const { res, data: body } = await fetchJson("/api/budget/categorize", {
      method: "POST",
      body: JSON.stringify({}),
    });
    setCatBusy(false);
    if (res.ok && body?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(body?.error || "Auto-categorize failed — try again.");
    }
  };

  const trackSubscription = async (sub) => {
    setTrackBusy(sub.merchant);
    setError("");
    // onCard: detected subs come FROM statement data, so their charges are
    // already counted — tracking is for visibility, never double-counting.
    const { res, data: body } = await fetchJson("/api/budget/recurring", {
      method: "POST",
      body: JSON.stringify({
        label: titleCase(sub.merchant),
        category: "Subscriptions",
        amountCents: sub.amountCents,
        onCard: true,
      }),
    });
    setTrackBusy(null);
    if (res.ok && body?.ok) {
      await load();
      onMutate?.();
    } else {
      setError(body?.error || "Couldn't add that to Monthly payments.");
    }
  };

  const saveBudget = async (category, dollarsStr, { allowRemove = false } = {}) => {
    setBudgetError("");
    const dollars = parseFloat(String(dollarsStr).replace(/[^0-9.]/g, ""));
    // Only the explicit Remove button may submit 0 — a fat-fingered
    // non-numeric edit must NOT silently delete the budget (0 means delete
    // server-side).
    if (!Number.isFinite(dollars) || (dollars <= 0 && !allowRemove)) {
      setBudgetError("Enter a dollar amount, e.g. 400.");
      return;
    }
    const monthlyCents = allowRemove && dollars <= 0 ? 0 : Math.round(dollars * 100);
    const { res, data: body } = await fetchJson("/api/budget/budgets", {
      method: "PUT",
      body: JSON.stringify({ category, monthlyCents }),
    });
    if (res.ok && body?.ok) {
      setEditingCat(null);
      setNewBudget({ category: "", amount: "" });
      await load();
    } else {
      setBudgetError(body?.error || "Couldn't save that budget.");
    }
  };

  // KPI tiles.
  const tiles = useMemo(() => {
    if (!latestMonth) return null;
    const totalFor = (key) =>
      (monthIndex.get(key)?.card || 0) + fixedForMonth(recurring, key);
    const savedFor = (key) => {
      const inc = incomeForMonth(income, key);
      return inc > 0 ? inc - totalFor(key) : null;
    };
    const prevKey = addMonths(latestMonth, -1);
    const hasPrev = monthIndex.has(prevKey) || fixedForMonth(recurring, prevKey) > 0;
    const floor = addMonths(latestMonth, -11);
    const start = monthKeys[0] > floor ? monthKeys[0] : floor;
    const spark = [];
    let windowSaved = 0;
    let windowSavedMonths = 0;
    let k = start;
    while (k <= latestMonth) {
      spark.push(totalFor(k));
      const s = savedFor(k);
      if (s != null) {
        windowSaved += s;
        windowSavedMonths += 1;
      }
      k = addMonths(k, 1);
    }
    const latestIncome = incomeForMonth(income, latestMonth);
    const latestSaved = savedFor(latestMonth);
    const prevSaved = hasPrev ? savedFor(prevKey) : null;
    return {
      latestKey: latestMonth,
      latestTotal: totalFor(latestMonth),
      delta: hasPrev ? totalFor(latestMonth) - totalFor(prevKey) : null,
      prevLabel: hasPrev ? monthShort(prevKey) : null,
      fixedNow: fixedForMonth(recurring, latestMonth),
      avg: spark.length
        ? Math.round(spark.reduce((a, b) => a + b, 0) / spark.length)
        : 0,
      spark,
      // savings story (only when income is configured)
      latestIncome,
      latestSaved,
      savedRate:
        latestSaved != null && latestIncome > 0
          ? Math.round((latestSaved / latestIncome) * 100)
          : null,
      savedDelta:
        latestSaved != null && prevSaved != null ? latestSaved - prevSaved : null,
      windowSaved,
      windowSavedMonths,
    };
  }, [latestMonth, monthIndex, monthKeys, recurring, income]);

  // ----- render -----

  if (!data && busy) {
    return <p className="bdb-loading">Loading the dashboard…</p>;
  }
  if (error && !data) {
    return (
      <div className="bdb-empty">
        <p>{error}</p>
        <button type="button" className="bdb-chip" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (data && data.configured === false) {
    return (
      <div className="bdb-empty">
        <p>The database isn't configured yet — nothing to chart.</p>
      </div>
    );
  }
  if (!series.length) {
    return (
      <div className="bdb-empty">
        <p>No spending data yet. Upload a statement and the dashboard lights up.</p>
      </div>
    );
  }

  const plotW = VBW - PAD.l - PAD.r;
  const plotH = VBH - PAD.t - PAD.b;
  const bandW = plotW / series.length;
  const barW = Math.min(24, bandW * 0.55);
  // The scale must accommodate the income benchmark ticks, not just spend.
  const yMax = niceMax(
    Math.max(...series.map((s) => Math.max(s.total, s.income || 0)))
  );
  const heightFor = (cents) => (cents / yMax) * plotH;
  const baseY = PAD.t + plotH;

  const budgets = data?.budgets || [];
  const budgetCategoryOptions = CATEGORIES.filter(
    (c) => !budgets.some((b) => b.category === c)
  );
  const spentFor = (category) =>
    breakdown.find((b) => b.category === category)?.cents || 0;

  // Statement freshness per account. Stale = no transactions in ~40 days
  // (a statement cycle plus grace) — the nudge to go upload.
  const accountFreshness = (data?.accounts || []).map((a) => {
    if (!a.last_tx_date) return { ...a, state: "empty", label2: "no data yet" };
    const days = Math.floor(
      (Date.now() - Date.parse(`${a.last_tx_date}T00:00:00Z`)) / 86400000
    );
    const pretty = new Date(`${a.last_tx_date}T00:00:00Z`).toLocaleDateString(
      undefined,
      { month: "short", day: "numeric", timeZone: "UTC" }
    );
    return days > 40
      ? { ...a, state: "stale", label2: `nothing since ${pretty}` }
      : { ...a, state: "fresh", label2: `data through ${pretty}` };
  });

  return (
    <div className={`bdb ${busy ? "is-refreshing" : ""}`}>
      {/* A refresh that fails after data has loaded must be visible — the
          stale numbers would otherwise present as current. */}
      {error && data && (
        <div className="bdb-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="bdb-chip bdb-chip--small" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {/* ---- statement freshness ---- */}
      {accountFreshness.length > 0 && (
        <div className="bdb-fresh" aria-label="Statement freshness">
          {accountFreshness.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`bdb-fresh-chip is-${a.state}`}
              onClick={() => onOpenUpload?.()}
              title={
                a.state === "fresh"
                  ? `${a.label} is up to date — click to upload more`
                  : `${a.label} needs a statement upload`
              }
            >
              <span className="bdb-fresh-dot" aria-hidden="true" />
              {a.label} · {a.label2}
            </button>
          ))}
        </div>
      )}

      {/* ---- KPI tiles ---- */}
      {tiles && (
        <div className="bdb-tiles">
          <div className="bdb-tile">
            <p className="bdb-tile-label">{monthLong(tiles.latestKey)} spend</p>
            <p className="bdb-tile-value">{fmtMoney(tiles.latestTotal, { compact: true })}</p>
            {tiles.delta != null && (
              <p
                className={`bdb-tile-delta ${
                  tiles.delta > 0 ? "is-bad" : tiles.delta < 0 ? "is-good" : ""
                }`}
              >
                {tiles.delta > 0 ? "▲" : tiles.delta < 0 ? "▼" : "•"}{" "}
                {fmtMoney(Math.abs(tiles.delta), { compact: true })} vs {tiles.prevLabel}
              </p>
            )}
            {tiles.spark.length > 1 && (
              <svg className="bdb-spark" viewBox="0 0 96 28" role="img" aria-label="Monthly spend trend">
                {(() => {
                  const max = Math.max(...tiles.spark, 1);
                  const pts = tiles.spark.map((v, i) => [
                    4 + (88 * i) / (tiles.spark.length - 1),
                    24 - (20 * v) / max,
                  ]);
                  const last = pts[pts.length - 1];
                  return (
                    <>
                      <polyline
                        className="bdb-spark-line"
                        points={pts.map((p) => p.join(",")).join(" ")}
                      />
                      <circle className="bdb-spark-dot" cx={last[0]} cy={last[1]} r="3" />
                    </>
                  );
                })()}
              </svg>
            )}
          </div>

          {hasIncome && tiles.latestSaved != null ? (
            <div className="bdb-tile">
              <p className="bdb-tile-label">{monthLong(tiles.latestKey)} saved</p>
              <p
                className={`bdb-tile-value ${
                  tiles.latestSaved > 0 ? "is-good" : tiles.latestSaved < 0 ? "is-bad" : ""
                }`}
              >
                {tiles.latestSaved < 0 ? "−" : ""}
                {fmtMoney(Math.abs(tiles.latestSaved), { compact: true })}
              </p>
              {tiles.savedDelta != null && (
                <p
                  className={`bdb-tile-delta ${
                    tiles.savedDelta > 0 ? "is-good" : tiles.savedDelta < 0 ? "is-bad" : ""
                  }`}
                >
                  {tiles.savedDelta > 0 ? "▲" : tiles.savedDelta < 0 ? "▼" : "•"}{" "}
                  {fmtMoney(Math.abs(tiles.savedDelta), { compact: true })} vs {tiles.prevLabel}
                </p>
              )}
              <p className="bdb-tile-sub">
                {tiles.savedRate != null
                  ? `${tiles.savedRate}% of income`
                  : ""}
                {tiles.windowSavedMonths > 1
                  ? ` · ${tiles.windowSaved < 0 ? "−" : ""}${fmtMoney(
                      Math.abs(tiles.windowSaved),
                      { compact: true }
                    )} over ${tiles.windowSavedMonths} mo`
                  : ""}
              </p>
            </div>
          ) : (
            <div className="bdb-tile">
              <p className="bdb-tile-label">Fixed monthly</p>
              <p className="bdb-tile-value">{fmtMoney(tiles.fixedNow, { compact: true })}</p>
              <p className="bdb-tile-sub">
                {recurring.length
                  ? `${
                      recurring.filter(
                        (r) => recurringActiveIn(r, latestMonth) && !r.on_card
                      ).length
                    } payments · Monthly tab`
                  : "add bills in the Monthly tab"}
              </p>
            </div>
          )}

          {hasIncome ? (
            <div className="bdb-tile">
              <p className="bdb-tile-label">Income per month</p>
              <p className="bdb-tile-value">≈ {fmtMoney(tiles.latestIncome, { compact: true })}</p>
              <p className="bdb-tile-sub">
                {income.filter((s) => recurringActiveIn(s, latestMonth)).length} source
                {income.filter((s) => recurringActiveIn(s, latestMonth)).length === 1 ? "" : "s"}{" "}
                · Monthly tab
              </p>
            </div>
          ) : (
            <div className="bdb-tile">
              <p className="bdb-tile-label">Average per month</p>
              <p className="bdb-tile-value">{fmtMoney(tiles.avg, { compact: true })}</p>
              <p className="bdb-tile-sub">card + fixed, charted window</p>
            </div>
          )}

          <div className="bdb-tile">
            <p className="bdb-tile-label">Uncategorized charges</p>
            <p className="bdb-tile-value">{data.uncategorizedCount}</p>
            {data.uncategorizedCount > 0 ? (
              <button type="button" className="bdb-chip" onClick={autoCategorize} disabled={catBusy}>
                {catBusy ? "Sorting…" : "Auto-categorize"}
              </button>
            ) : (
              <p className="bdb-tile-sub">all sorted ✓</p>
            )}
          </div>
        </div>
      )}

      {/* ---- controls ---- */}
      <div className="bdb-controls">
        <div className="bdb-toggle" role="tablist" aria-label="Granularity">
          {["months", "years"].map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={granularity === g}
              className={`bdb-toggle-btn ${granularity === g ? "is-active" : ""}`}
              onClick={() => {
                setGranularity(g);
                setSelected(null);
              }}
            >
              {g === "months" ? "Months" : "Years"}
            </button>
          ))}
        </div>

        {/* Same state the chart's bar-click sets — this is just the explicit,
            always-visible way to move the cards below to another period. */}
        <select
          className="bdb-period-select"
          value={selected || ""}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={`Show ${granularity === "months" ? "month" : "year"}`}
        >
          {periodOptions.map((k) => (
            <option key={k} value={k}>
              {k.length === 7 ? monthLong(k) : k}
            </option>
          ))}
        </select>
      </div>

      {/* ---- stacked bar chart ---- */}
      <div className="bdb-card">
        <div className="bdb-card-head">
          <h2 className="bdb-h">
            Spending by {granularity === "months" ? "month" : "year"}
          </h2>
          {(hasFixed || hasIncome) && (
            <div className="bdb-legend" aria-hidden="true">
              <span className="bdb-legend-item">
                <span className="bdb-swatch bdb-swatch--card" /> Card
              </span>
              {hasFixed && (
                <span className="bdb-legend-item">
                  <span className="bdb-swatch bdb-swatch--fixed" /> Fixed
                </span>
              )}
              {hasIncome && (
                <span className="bdb-legend-item">
                  <span className="bdb-swatch bdb-swatch--income" /> Income
                </span>
              )}
            </div>
          )}
        </div>
        {/* chartwrap scrolls horizontally on narrow screens; chartinner is
            the tooltip's positioning context so % coordinates track the SVG
            even when it's wider than the viewport. */}
        <div className="bdb-chartwrap">
          <div className="bdb-chartinner">
          <svg
            viewBox={`0 0 ${VBW} ${VBH}`}
            className="bdb-chart"
            role="img"
            aria-label={`Stacked bar chart of card and fixed spending per ${
              granularity === "months" ? "month" : "year"
            }`}
          >
            {[0.5, 1].map((f) => (
              <g key={f}>
                <line
                  className="bdb-grid"
                  x1={PAD.l}
                  x2={VBW - PAD.r}
                  y1={baseY - plotH * f}
                  y2={baseY - plotH * f}
                />
                <text className="bdb-tick" x={PAD.l - 6} y={baseY - plotH * f + 3}>
                  {fmtMoney(yMax * f, { compact: true })}
                </text>
              </g>
            ))}
            <line className="bdb-axis" x1={PAD.l} x2={VBW - PAD.r} y1={baseY} y2={baseY} />

            {series.map((s, i) => {
              const x = PAD.l + i * bandW + (bandW - barW) / 2;
              const hFixed = heightFor(s.fixed);
              const hCard = heightFor(s.card);
              const isSelected = s.key === selected;
              const cx = x + barW / 2;
              const yTop = baseY - hFixed - hCard;
              // Clamped: the chartwrap's overflow-x:auto also clips
              // vertically, so a tooltip anchored above a tall bar (or past
              // the last band) would be cut off / spawn a scrollbar.
              const tipRows = [];
              if (hasFixed) {
                tipRows.push(
                  { key: "card", label: "card", value: fmtMoney(s.card) },
                  { key: "fixed", label: "fixed", value: fmtMoney(s.fixed) }
                );
              }
              if (s.income > 0) {
                tipRows.push({ key: "income", label: "income", value: fmtMoney(s.income) });
                tipRows.push({
                  key: "saved",
                  label: s.saved >= 0 ? "saved" : "over",
                  value: fmtMoney(Math.abs(s.saved)),
                });
              }
              const showTip = () =>
                setTip({
                  leftPct: Math.min(90, Math.max(10, (cx / VBW) * 100)),
                  topPct: Math.max(
                    45,
                    (Math.min(yTop, baseY - 8) / VBH) * 100
                  ),
                  title: s.longLabel,
                  value: fmtMoney(s.total),
                  rows: tipRows,
                  sub: `${s.txCount} card transaction${s.txCount === 1 ? "" : "s"}`,
                });
              // The fixed segment sits on the baseline (square); the card
              // segment stacks above it behind a 2px surface gap and takes
              // the rounded data-end. Whichever segment is topmost gets the
              // rounded end.
              const gap = hFixed > 0 && hCard > SEG_GAP + 4 ? SEG_GAP : 0;
              return (
                <g key={s.key} className={isSelected ? "is-selected" : ""}>
                  {hFixed > 0 &&
                    (hCard > 0 ? (
                      <rect
                        className="bdb-seg bdb-seg--fixed"
                        x={x}
                        y={baseY - hFixed}
                        width={barW}
                        height={hFixed}
                      />
                    ) : (
                      <path
                        className="bdb-seg bdb-seg--fixed"
                        d={topRoundedBar(x, baseY - hFixed, barW, hFixed)}
                      />
                    ))}
                  {hCard > 0 && (
                    <path
                      className="bdb-seg bdb-seg--card"
                      d={topRoundedBar(x, yTop, barW, Math.max(1, hCard - gap))}
                    />
                  )}
                  {/* Income benchmark tick (bullet-chart style): bar above
                      the tick = spent more than earned that period. */}
                  {s.income > 0 && (
                    <line
                      className="bdb-income-tick"
                      x1={x - 4}
                      x2={x + barW + 4}
                      y1={baseY - heightFor(s.income)}
                      y2={baseY - heightFor(s.income)}
                    />
                  )}
                  {isSelected && s.total > 0 && (
                    <text className="bdb-bar-label" x={cx} y={yTop - 6}>
                      {fmtMoney(s.total, { compact: true })}
                    </text>
                  )}
                  <text className="bdb-xlabel" x={cx} y={VBH - 8}>
                    {s.label}
                  </text>
                  <rect
                    className="bdb-hit"
                    x={PAD.l + i * bandW}
                    y={PAD.t}
                    width={bandW}
                    height={plotH}
                    tabIndex={0}
                    role="button"
                    aria-label={`${s.longLabel}: ${fmtMoney(s.total)} total, ${fmtMoney(
                      s.card
                    )} card, ${fmtMoney(s.fixed)} fixed${
                      s.income > 0
                        ? `, ${fmtMoney(s.income)} income, ${
                            s.saved >= 0 ? "saved" : "overspent"
                          } ${fmtMoney(Math.abs(s.saved))}`
                        : ""
                    }`}
                    onMouseEnter={showTip}
                    onMouseLeave={() => setTip(null)}
                    onFocus={showTip}
                    onBlur={() => setTip(null)}
                    onClick={() => setSelected(s.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(s.key);
                      }
                    }}
                  />
                </g>
              );
            })}
          </svg>
          {tip && (
            <div className="bdb-tip" style={{ left: `${tip.leftPct}%`, top: `${tip.topPct}%` }}>
              <strong>{tip.value}</strong>
              <span>{tip.title}</span>
              {tip.rows.map((r) => (
                <span key={r.key} className="bdb-tip-row">
                  <i className={`bdb-tip-key bdb-tip-key--${r.key}`} />
                  {r.value} {r.label.toLowerCase()}
                </span>
              ))}
              <span>{tip.sub}</span>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="bdb-grid2">
        {/* ---- category breakdown ---- */}
        <div className="bdb-card">
          <h2 className="bdb-h">
            {selectedEntry ? selectedEntry.longLabel : ""} by category
            {hasFixed && <span className="bdb-h-sub"> · card + fixed</span>}
          </h2>
          {breakdown.length === 0 ? (
            <p className="bdb-sub">No charges in this period.</p>
          ) : (
            <div className="bdb-cats">
              {breakdown.map((b) => {
                const isOpen = drill?.category === b.category;
                return (
                  <div key={b.category}>
                    <button
                      type="button"
                      className={`bdb-cat bdb-cat--btn ${isOpen ? "is-open" : ""}`}
                      aria-expanded={isOpen}
                      onClick={() => toggleDrill(b.category)}
                      title={`Show ${b.category} charges`}
                    >
                      <span
                        className={`bdb-cat-name ${
                          b.category === "uncategorized" ? "is-muted" : ""
                        }`}
                      >
                        <span className="bdb-cat-caret" aria-hidden="true">
                          {isOpen ? "▾" : "▸"}
                        </span>
                        {b.category}
                      </span>
                      <span className="bdb-cat-bar">
                        <span
                          className={`bdb-cat-fill ${
                            b.category === "uncategorized" ? "is-muted" : ""
                          }`}
                          style={{
                            width: `${maxBreakdown ? (b.cents / maxBreakdown) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <span className="bdb-cat-value">{fmtMoney(b.cents)}</span>
                      <span className="bdb-cat-pct">{Math.round(b.pct)}%</span>
                    </button>

                    {isOpen && (
                      <div className="bdb-drill">
                        {drillFixedItems.map((item) => (
                          <div className="bdb-drill-row" key={`fixed-${item.id}`}>
                            <span className="bdb-drill-date" title="Monthly payment">
                              ↻ monthly
                            </span>
                            <span className="bdb-drill-merchant">{item.label}</span>
                            <span className="bdb-drill-amount">
                              {item.monthsActive > 1
                                ? `${fmtMoneyExact(item.amount_cents)} × ${item.monthsActive}`
                                : fmtMoneyExact(item.amount_cents)}
                            </span>
                          </div>
                        ))}

                        {drill.loading ? (
                          <p className="bdb-drill-hint">Loading charges…</p>
                        ) : drill.error ? (
                          <p className="bdb-drill-hint">{drill.error}</p>
                        ) : drill.rows.length === 0 && drillFixedItems.length === 0 ? (
                          <p className="bdb-drill-hint">No individual charges found.</p>
                        ) : (
                          drill.rows.map((row) => {
                            const pct = row.count_pct ?? 100;
                            const effective = Math.round((row.amount_cents * pct) / 100);
                            return (
                              <div
                                className={`bdb-drill-row ${pct === 0 ? "is-excluded" : ""}`}
                                key={row.id}
                              >
                                <span className="bdb-drill-date">
                                  {String(row.posted_date).slice(5, 10)}
                                </span>
                                <span className="bdb-drill-merchant" title={row.merchant_clean}>
                                  {titleCase(row.merchant_clean)}
                                  {pct === 0 && <em className="bdb-drill-flag"> excluded</em>}
                                  {pct > 0 && pct < 100 && (
                                    <em className="bdb-drill-flag"> {pct}% counted</em>
                                  )}
                                </span>
                                <span
                                  className="bdb-drill-amount"
                                  title={
                                    pct < 100
                                      ? `Full charge ${fmtMoneyExact(row.amount_cents)}`
                                      : undefined
                                  }
                                >
                                  {fmtMoneyExact(pct === 0 ? row.amount_cents : effective)}
                                </span>
                              </div>
                            );
                          })
                        )}

                        {!drill.loading && onOpenTransactions && (
                          <button
                            type="button"
                            className="bdb-drill-all"
                            onClick={() => onOpenTransactions(b.category)}
                          >
                            All {b.category} transactions →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- budgets ---- */}
        <div className="bdb-card">
          <h2 className="bdb-h">
            Budgets{" "}
            {granularity === "months" && selectedEntry ? (
              <span className="bdb-h-sub">· {selectedEntry.longLabel}</span>
            ) : null}
          </h2>

          {granularity === "years" ? (
            <p className="bdb-sub">Budgets are monthly — switch to Months to track them.</p>
          ) : (
            <>
              {budgets.length === 0 && (
                <p className="bdb-sub">
                  No budgets yet. Set a monthly cap per category and this card keeps score.
                </p>
              )}
              <div className="bdb-budgets">
                {budgets.map((b) => {
                  const spent = spentFor(b.category);
                  const pct = b.monthly_cents ? (spent / b.monthly_cents) * 100 : 0;
                  const over = spent > b.monthly_cents;
                  return (
                    <div className="bdb-budget" key={b.category}>
                      <div className="bdb-budget-top">
                        <span className="bdb-cat-name">{b.category}</span>
                        {editingCat === b.category ? (
                          <span className="bdb-budget-edit">
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveBudget(b.category, editValue);
                                if (e.key === "Escape") setEditingCat(null);
                              }}
                            />
                            <button type="button" onClick={() => saveBudget(b.category, editValue)}>
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => saveBudget(b.category, "0", { allowRemove: true })}
                            >
                              Remove
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="bdb-budget-nums"
                            onClick={() => {
                              setEditingCat(b.category);
                              setEditValue(String(b.monthly_cents / 100));
                            }}
                            title="Edit budget"
                          >
                            {fmtMoney(spent)} / {fmtMoney(b.monthly_cents)}
                          </button>
                        )}
                      </div>
                      <div className="bdb-meter">
                        <div
                          className={`bdb-meter-fill ${over ? "is-over" : ""}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      {over && (
                        <p className="bdb-over">▲ {fmtMoney(spent - b.monthly_cents)} over budget</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="bdb-budget-new">
                <select
                  value={newBudget.category}
                  onChange={(e) => setNewBudget((v) => ({ ...v, category: e.target.value }))}
                >
                  <option value="">Category…</option>
                  {budgetCategoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="$ / month"
                  inputMode="decimal"
                  value={newBudget.amount}
                  onChange={(e) => setNewBudget((v) => ({ ...v, amount: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newBudget.category && newBudget.amount) {
                      saveBudget(newBudget.category, newBudget.amount);
                    }
                  }}
                />
                <button
                  type="button"
                  className="bdb-chip"
                  disabled={!newBudget.category || !newBudget.amount}
                  onClick={() => saveBudget(newBudget.category, newBudget.amount)}
                >
                  Add
                </button>
              </div>
              {budgetError && <p className="bdb-error">{budgetError}</p>}

              {/* Zero-based-budgeting pulse: how much of the month's income
                  the fixed costs + budgets already account for. */}
              {hasIncome &&
                selectedEntry?.income > 0 &&
                (() => {
                  const budgetsTotal = budgets.reduce((s, b) => s + b.monthly_cents, 0);
                  const fixedSel = fixedForMonth(recurring, selectedEntry.key);
                  const planned = budgetsTotal + fixedSel;
                  const left = selectedEntry.income - planned;
                  return (
                    <p className="bdb-planned">
                      Fixed {fmtMoney(fixedSel)} + budgets {fmtMoney(budgetsTotal)} ={" "}
                      {fmtMoney(planned)} of ≈{fmtMoney(selectedEntry.income)} income
                      {left >= 0
                        ? ` · ${fmtMoney(left)} unplanned`
                        : ` · over-planned by ${fmtMoney(-left)}`}
                    </p>
                  );
                })()}
            </>
          )}
        </div>
      </div>

      <div className="bdb-grid2">
        {/* ---- top merchants ---- */}
        <div className="bdb-card">
          <h2 className="bdb-h">
            Top merchants
            {selectedEntry && <span className="bdb-h-sub"> · {selectedEntry.longLabel}</span>}
          </h2>
          {topMerchants.length === 0 ? (
            <p className="bdb-sub">No card charges in this period.</p>
          ) : (
            <div className="bdb-cats">
              {topMerchants.map((m) => (
                <div className="bdb-cat" key={m.merchant}>
                  <span className="bdb-cat-name" title={m.merchant}>
                    {titleCase(m.merchant)}
                  </span>
                  <span className="bdb-cat-bar">
                    <span
                      className="bdb-cat-fill"
                      style={{ width: `${maxMerchant ? (m.cents / maxMerchant) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="bdb-cat-value">{fmtMoney(m.cents)}</span>
                  <span className="bdb-cat-pct">×{m.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- insights ---- */}
        <div className="bdb-card">
          <h2 className="bdb-h">Insights</h2>

          {selectedEntry?.saved != null && (
            <div className="bdb-insight-block">
              <p className="bdb-insight-h">Savings · {selectedEntry.longLabel}</p>
              <p
                className={`bdb-insight-row ${
                  selectedEntry.saved >= 0 ? "is-good" : "is-bad"
                }`}
              >
                {selectedEntry.saved >= 0 ? "▼" : "▲"}{" "}
                {selectedEntry.saved >= 0
                  ? `Saved ${fmtMoney(selectedEntry.saved)}`
                  : `Overspent by ${fmtMoney(-selectedEntry.saved)}`}
                {selectedEntry.income > 0
                  ? ` — ${Math.round(
                      (Math.abs(selectedEntry.saved) / selectedEntry.income) * 100
                    )}% of ${fmtMoney(selectedEntry.income)} income`
                  : ""}
              </p>
            </div>
          )}

          {movers.length === 0 && detectedSubs.length === 0 && selectedEntry?.saved == null && (
            <p className="bdb-sub">
              Nothing notable yet — insights appear once there's a month to compare
              against.
            </p>
          )}

          {movers.length > 0 && (
            <div className="bdb-insight-block">
              <p className="bdb-insight-h">Biggest changes vs {movers[0].prevLabel}</p>
              {movers.map((m) => (
                <p
                  key={m.category}
                  className={`bdb-insight-row ${m.delta > 0 ? "is-bad" : "is-good"}`}
                >
                  {m.delta > 0 ? "▲" : "▼"} {m.category}:{" "}
                  {m.delta > 0 ? "+" : "−"}
                  {fmtMoney(Math.abs(m.delta))}
                </p>
              ))}
            </div>
          )}

          {detectedSubs.length > 0 && (
            <div className="bdb-insight-block">
              <p className="bdb-insight-h">Looks recurring — track it?</p>
              {detectedSubs.map((sub) => (
                <div key={sub.merchant} className="bdb-sub-row">
                  <span className="bdb-sub-name" title={sub.merchant}>
                    {titleCase(sub.merchant)}
                  </span>
                  <span className="bdb-cat-value">~{fmtMoney(sub.amountCents)}/mo</span>
                  <button
                    type="button"
                    className="bdb-chip bdb-chip--small"
                    disabled={trackBusy === sub.merchant}
                    onClick={() => trackSubscription(sub)}
                  >
                    {trackBusy === sub.merchant ? "Adding…" : "Track"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpendingDashboard;
