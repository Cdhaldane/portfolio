import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES } from "../categories";
import { niceMax, topRoundedBar, bottomRoundedBar } from "../chart";
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
import { activeMembers, memberLabel, memberInitials } from "../members";
import Dropdown from "../Dropdown";
import "./SpendingDashboard.css";

/*
 * Spending dashboard — card spending from uploaded statements PLUS the
 * bills and income managed in the Income & bills tab, overlaid per month.
 *
 * In a shared household everything on this page answers for ONE scope at a
 * time — the whole household or a single member — driven by the pills in
 * the controls row. A member's numbers are real, not estimates: their cards'
 * charges, their own bills plus an even 1/N share of shared bills, and their
 * own income sources. Budgets are the one deliberate exception (a household
 * cap tracked against one person would under-report) and say so with a chip.
 *
 * Chart design per the dataviz method: spending is a magnitude job, so the
 * palette is the blue ramp only — card spend in --blue, fixed costs in
 * --blue-deep (two steps of one ramp, separated by lightness and a 2px
 * surface gap, with a legend because there are now two series). The saved
 * chart is a polarity job: diverging bars around a $0 baseline where the
 * POSITION carries the sign and sage/coral only reinforce it, always beside
 * signed words.
 *
 * Receives fetchJson(path, options) from the parent instead of touching
 * Clerk directly, so the dev-only preview route can render it with mock
 * data outside the auth gate.
 */

const VBW = 720;
const VBH = 240;
const PAD = { l: 48, r: 10, t: 22, b: 28 };
const SEG_GAP = 2; // surface gap between stacked segments, in viewBox px
const SAV_VBH = 190; // saved-by-month chart height (same width contract)
const SAV_PAD = { l: 48, r: 10, t: 22, b: 26 };

const titleCase = (s) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// month key -> { card, txCount, byCategory: Map } (card spending only).
// The summary splits rows by card owner; pass a member user id to keep only
// that person's charges, or null for the whole household. Always sums with
// += — several rows can share a (month, category).
const buildMonthIndex = (rows, member) => {
  const index = new Map();
  for (const row of rows) {
    if (member && row.member_user_id !== member) continue;
    let entry = index.get(row.month);
    if (!entry) {
      entry = { card: 0, txCount: 0, byCategory: new Map() };
      index.set(row.month, entry);
    }
    entry.card += row.spend_cents;
    entry.txCount += row.tx_count;
    entry.byCategory.set(row.category, (entry.byCategory.get(row.category) || 0) + row.spend_cents);
  }
  return index;
};

const SpendingDashboard = ({
  refreshToken,
  onMutate,
  fetchJson,
  onOpenTransactions,
  onOpenUpload,
  shared,
  youUserId,
  members,
}) => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [granularity, setGranularity] = useState("months");
  // Whose money is on screen: "household", "mine" (the signed-in caller — a
  // sentinel rather than an id so the stored preference means "me" for
  // whoever opens this browser), or another member's user id. Defaults to
  // your own view; solo households are always effectively household.
  const [scope, setScope] = useState(() => {
    try {
      return localStorage.getItem("bud-dash-scope") || "mine";
    } catch {
      return "mine";
    }
  });
  const setScopePersist = (next) => {
    setScope(next);
    try {
      localStorage.setItem("bud-dash-scope", next);
    } catch {
      /* storage blocked — the toggle still works for this session */
    }
  };
  const memberList = useMemo(() => activeMembers(members || []), [members]);
  const memberCount = Math.max(1, memberList.length);
  // The member whose money is on screen, or null for the whole household.
  // A stored id whose member has since left falls back to household.
  const scopeMember = useMemo(() => {
    if (!shared || scope === "household") return null;
    const id = scope === "mine" ? youUserId : scope;
    return id && memberList.some((m) => m.userId === id) ? id : null;
  }, [shared, scope, youUserId, memberList]);
  const personal = scopeMember != null;
  const scopeLabel = personal
    ? memberLabel(
        memberList.find((m) => m.userId === scopeMember),
        youUserId
      )
    : null;
  const [selected, setSelected] = useState(null);
  const [tip, setTip] = useState(null);
  const [savTip, setSavTip] = useState(null);
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

  // The active scope's bills and income. A member's bills are the ones they
  // own in full plus an even 1/N share of shared (unowned) bills — marked
  // _share so the UI can say so; their income is whatever sources they own.
  // Household scope passes both lists through untouched, so every formula
  // downstream is scope-agnostic.
  const scopedRecurring = useMemo(() => {
    if (!scopeMember) return recurring;
    const out = [];
    for (const r of recurring) {
      if (r.member_user_id === scopeMember) out.push(r);
      else if (!r.member_user_id)
        out.push({ ...r, amount_cents: Math.round(r.amount_cents / memberCount), _share: true });
    }
    return out;
  }, [recurring, scopeMember, memberCount]);
  const scopedIncome = useMemo(
    () => (scopeMember ? income.filter((s) => s.member_user_id === scopeMember) : income),
    [income, scopeMember]
  );
  const hasScopedIncome = scopedIncome.length > 0;

  // Two parallel indexes: monthIndexAll is ALWAYS the whole household — the
  // budgets card reads it, and it anchors the month window so the chart's
  // x-axis doesn't shift when the scope flips. monthIndex is the active
  // scope everything else reads.
  const monthIndexAll = useMemo(() => buildMonthIndex(data?.months || [], null), [data]);
  const monthIndex = useMemo(
    () => (scopeMember ? buildMonthIndex(data?.months || [], scopeMember) : monthIndexAll),
    [data, scopeMember, monthIndexAll]
  );

  // Merchant rows aggregated to (month, merchant) in the active scope. The
  // API splits rows per card owner, so this ALWAYS re-aggregates — the
  // subscription detector's "exactly once a month" test needs true totals,
  // not one member's slice clobbering another's.
  const merchantRows = useMemo(() => {
    const acc = new Map();
    for (const r of data?.merchants || []) {
      if (scopeMember && r.member_user_id !== scopeMember) continue;
      const k = `${r.month} ${r.merchant_clean}`;
      const cur = acc.get(k);
      if (cur) {
        cur.spend_cents += r.spend_cents;
        cur.tx_count += r.tx_count;
      } else {
        acc.set(k, {
          month: r.month,
          merchant_clean: r.merchant_clean,
          spend_cents: r.spend_cents,
          tx_count: r.tx_count,
        });
      }
    }
    return [...acc.values()].filter((r) => r.spend_cents > 0 || r.tx_count > 0);
  }, [data, scopeMember]);

  const monthKeys = useMemo(() => [...monthIndexAll.keys()].sort(), [monthIndexAll]);
  const latestMonth = monthKeys[monthKeys.length - 1] || null;

  const fixedForYear = useCallback(
    (year) => {
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        if (latestMonth && key > latestMonth) break;
        sum += fixedForMonth(scopedRecurring, key);
      }
      return sum;
    },
    [scopedRecurring, latestMonth]
  );

  const incomeForYear = useCallback(
    (year) => {
      let sum = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${String(m).padStart(2, "0")}`;
        if (latestMonth && key > latestMonth) break;
        sum += incomeForMonth(scopedIncome, key);
      }
      return sum;
    },
    [scopedIncome, latestMonth]
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
        const fixed = fixedForMonth(scopedRecurring, key);
        const monthIncome = incomeForMonth(scopedIncome, key);
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
    // Years anchor on the HOUSEHOLD month keys (like the months window does)
    // so a member scope with no card rows in a year still charts their bills
    // and income — and the series can never come back empty, which would
    // trip the "no data" early return and unmount every control.
    const byYear = new Map();
    for (const k of monthKeys) {
      const year = k.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { card: 0, txCount: 0 });
    }
    for (const [key, entry] of monthIndex) {
      const y = byYear.get(key.slice(0, 4));
      if (!y) continue;
      y.card += entry.card;
      y.txCount += entry.txCount;
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
  }, [granularity, latestMonth, monthKeys, monthIndex, scopedRecurring, scopedIncome, fixedForYear, incomeForYear]);

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

  // Changing period, granularity or scope invalidates an open drill-down.
  useEffect(() => {
    setDrill(null);
  }, [selected, granularity, scopeMember]);

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
      // A member scope drills into that member's cards only, matching the
      // rows that produced the number being drilled.
      if (scopeMember) params.set("cardOf", scopeMember);
      const { res, data: body } = await fetchJson(`/api/budget/transactions?${params}`);
      setDrill((cur) => {
        if (!cur || cur.category !== category) return cur; // superseded
        if (!res.ok || !body) {
          return { ...cur, loading: false, error: "Couldn't load those charges." };
        }
        return { ...cur, loading: false, rows: body.transactions || [] };
      });
    },
    [drill, selected, fetchJson, scopeMember]
  );

  // Fixed (recurring) items that contribute to a category in the selected
  // period — shown at the top of the drill-down, since they aren't card
  // transactions and won't come back from the API. In a member scope the
  // scoped list already carries their share of shared bills (_share).
  const drillFixedItems = useMemo(() => {
    if (!drill || !selected) return [];
    const isMonth = selected.length === 7;
    return scopedRecurring
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
  }, [drill, selected, scopedRecurring, latestMonth]);

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
    const fixed = fixedForMonth(scopedRecurring, selected);
    const monthIncome = incomeForMonth(scopedIncome, selected);
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
  }, [series, selected, monthIndex, scopedRecurring, scopedIncome]);
  const hasFixed = recurring.length > 0;
  // Whether the ACTIVE scope has fixed segments / income ticks to draw.
  const chartHasFixed = scopedRecurring.length > 0;
  const chartHasIncome = hasScopedIncome;

  // Card + fixed spending by category for a period, from a given month
  // index and recurring list — the scoped analytics and the always-household
  // budget math share this shape.
  const categoryTotalsFor = useCallback(
    (periodKey, index, recurringList) => {
      const sums = new Map();
      if (!periodKey) return sums;
      const isMonth = periodKey.length === 7;
      for (const [monthKey, entry] of index) {
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
      for (const item of recurringList) {
        if (item.on_card) continue; // real charges already in card data
        for (const mk of monthsInPeriod) {
          if (recurringActiveIn(item, mk)) {
            sums.set(item.category, (sums.get(item.category) || 0) + item.amount_cents);
          }
        }
      }
      return sums;
    },
    [latestMonth]
  );

  // Active-scope merge: categories fold in the scope's bills (a member's own
  // plus their share of shared ones) alongside their cards.
  const mergedByCategory = useCallback(
    (periodKey) => categoryTotalsFor(periodKey, monthIndex, scopedRecurring),
    [categoryTotalsFor, monthIndex, scopedRecurring]
  );

  // Budgets keep score against the WHOLE household in either scope — a
  // household cap tracked against one person's charges would under-report.
  const householdSpentByCategory = useMemo(
    () => categoryTotalsFor(selected, monthIndexAll, recurring),
    [categoryTotalsFor, selected, monthIndexAll, recurring]
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
  // already itemized by name in the Income & bills tab).
  const topMerchants = useMemo(() => {
    if (!selected) return [];
    const isMonth = selected.length === 7;
    const sums = new Map();
    for (const row of merchantRows) {
      const inPeriod = isMonth ? row.month === selected : row.month.startsWith(selected);
      if (!inPeriod) continue;
      const cur = sums.get(row.merchant_clean) || { cents: 0, count: 0 };
      cur.cents += row.spend_cents;
      cur.count += row.tx_count;
      sums.set(row.merchant_clean, cur);
    }
    return [...sums.entries()]
      .map(([merchant, v]) => ({ merchant, ...v }))
      .filter((m) => m.cents > 0)
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 6);
  }, [selected, merchantRows]);

  const maxMerchant = topMerchants.length ? topMerchants[0].cents : 0;

  // Month-over-month category movers (months mode only).
  const movers = useMemo(() => {
    if (granularity !== "months" || !selected) return [];
    const prevKey = addMonths(selected, -1);
    if (!monthIndex.has(prevKey) && fixedForMonth(scopedRecurring, prevKey) === 0) return [];
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
  }, [granularity, selected, monthIndex, scopedRecurring, mergedByCategory]);

  // Subscription detector: merchant charged EXACTLY ONCE per month in >=2
  // of the last 3 data months, with stable amounts, and not already tracked
  // in Monthly payments. The once-per-month requirement is what separates a
  // Netflix from a grocery store — stable monthly grocery totals are a
  // habit, not a subscription.
  const detectedSubs = useMemo(() => {
    const recent = monthKeys.slice(-3);
    if (recent.length < 2) return [];
    const byMerchant = new Map();
    for (const row of merchantRows) {
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
  }, [monthKeys, merchantRows, recurring]);

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
      setError(body?.error || "Couldn't add that to the bills list.");
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

  // KPI tiles — every number answers for the active scope: a member's tiles
  // use their cards, their bills (incl. their share of shared ones), and
  // their own income, so "saved" is real per-person math, not an estimate.
  const tiles = useMemo(() => {
    if (!latestMonth) return null;
    const totalFor = (key) =>
      (monthIndex.get(key)?.card || 0) + fixedForMonth(scopedRecurring, key);
    const savedFor = (key) => {
      const inc = incomeForMonth(scopedIncome, key);
      if (inc <= 0) return null;
      return inc - totalFor(key);
    };
    const prevKey = addMonths(latestMonth, -1);
    const hasPrev =
      monthIndex.has(prevKey) || fixedForMonth(scopedRecurring, prevKey) > 0;
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
    const latestIncome = incomeForMonth(scopedIncome, latestMonth);
    const latestSaved = savedFor(latestMonth);
    const prevSaved = hasPrev ? savedFor(prevKey) : null;
    return {
      latestKey: latestMonth,
      latestTotal: totalFor(latestMonth),
      delta: hasPrev ? totalFor(latestMonth) - totalFor(prevKey) : null,
      prevLabel: hasPrev ? monthShort(prevKey) : null,
      fixedNow: fixedForMonth(scopedRecurring, latestMonth),
      avg: spark.length
        ? Math.round(spark.reduce((a, b) => a + b, 0) / spark.length)
        : 0,
      spark,
      // savings story (only when the scope has income configured)
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
  }, [latestMonth, monthIndex, monthKeys, scopedRecurring, scopedIncome]);

  // Savings for the SELECTED period, for the insights card — same
  // scope-true definition as the tile, month or year.
  const selectedSavings = useMemo(() => {
    if (!selected) return null;
    const keys =
      selected.length === 7
        ? [selected]
        : Array.from({ length: 12 }, (_, i) => `${selected}-${String(i + 1).padStart(2, "0")}`)
            .filter((k) => !latestMonth || k <= latestMonth);
    const inc = keys.reduce((s, k) => s + incomeForMonth(scopedIncome, k), 0);
    if (inc <= 0) return null;
    const out = keys.reduce(
      (s, k) => s + (monthIndex.get(k)?.card || 0) + fixedForMonth(scopedRecurring, k),
      0
    );
    return { income: inc, saved: inc - out };
  }, [selected, latestMonth, scopedIncome, monthIndex, scopedRecurring]);

  // Per-person comparison for the selected period — always BOTH members,
  // whatever scope is active (it's the side-by-side the scope pills switch
  // between). Card spend attributes by card owner; bills by owner + even
  // share of shared; income by owner.
  const peopleStats = useMemo(() => {
    if (!shared || !selected || memberList.length < 2) return [];
    const keys =
      selected.length === 7
        ? [selected]
        : Array.from({ length: 12 }, (_, i) => `${selected}-${String(i + 1).padStart(2, "0")}`)
            .filter((k) => !latestMonth || k <= latestMonth);
    // member userId -> month -> card cents, straight off the raw rows
    const cardBy = new Map();
    for (const r of data?.months || []) {
      let inner = cardBy.get(r.member_user_id);
      if (!inner) {
        inner = new Map();
        cardBy.set(r.member_user_id, inner);
      }
      inner.set(r.month, (inner.get(r.month) || 0) + r.spend_cents);
    }
    // Per-bill share rounding, EXACTLY like scopedRecurring builds a member's
    // list — round(sum/N) instead would disagree with the member's own tiles
    // by a cent per bill.
    const sharedShares = recurring
      .filter((r) => !r.member_user_id)
      .map((r) => ({ ...r, amount_cents: Math.round(r.amount_cents / memberCount) }));
    return memberList.map((m) => {
      const bills = [
        ...recurring.filter((r) => r.member_user_id === m.userId),
        ...sharedShares,
      ];
      const ownIncome = income.filter((s) => s.member_user_id === m.userId);
      let out = 0;
      let inc = 0;
      for (const k of keys) {
        out += cardBy.get(m.userId)?.get(k) || 0;
        out += fixedForMonth(bills, k);
        inc += incomeForMonth(ownIncome, k);
      }
      return {
        userId: m.userId,
        label: memberLabel(m, youUserId),
        out,
        income: inc,
        saved: inc > 0 ? inc - out : null,
      };
    });
  }, [shared, selected, memberList, latestMonth, data, recurring, income, memberCount, youUserId]);
  const maxPersonOut = peopleStats.reduce((mx, p) => Math.max(mx, p.out), 0);

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

  // Saved-by-month chart: diverging bars around a $0 baseline. One linear
  // scale spans the nice-rounded extremes on each side, so a dollar is the
  // same height above and below zero; the baseline sits wherever that puts
  // it. Same horizontal geometry as chart 1 — the months line up.
  const savPlotH = SAV_VBH - SAV_PAD.t - SAV_PAD.b;
  const savedVals = series.map((s) => s.saved ?? 0);
  const savHiRaw = Math.max(0, ...savedVals);
  const savLoRaw = Math.max(0, ...savedVals.map((v) => -v));
  const savHi = savHiRaw > 0 ? niceMax(savHiRaw) : 0;
  const savLo = savLoRaw > 0 ? niceMax(savLoRaw) : 0;
  const savRange = savHi + savLo || 100;
  const savScale = savPlotH / savRange;
  const savZeroY = SAV_PAD.t + savHi * savScale;
  const savedMonths = series.filter((s) => s.saved != null).length;

  const budgets = data?.budgets || [];
  const budgetCategoryOptions = CATEGORIES.filter(
    (c) => !budgets.some((b) => b.category === c)
  );
  const spentFor = (category) => householdSpentByCategory.get(category) || 0;

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

          {hasScopedIncome && tiles.latestSaved != null ? (
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
              <p className="bdb-tile-label">
                {personal ? "Bills / month" : "Fixed monthly"}
              </p>
              <p className="bdb-tile-value">{fmtMoney(tiles.fixedNow, { compact: true })}</p>
              <p className="bdb-tile-sub">
                {scopedRecurring.length
                  ? `${
                      scopedRecurring.filter(
                        (r) => recurringActiveIn(r, latestMonth) && !r.on_card
                      ).length
                    } payments${personal ? " incl. shared splits" : ""} · Income & bills tab`
                  : "add bills in the Income & bills tab"}
              </p>
            </div>
          )}

          {hasScopedIncome ? (
            <div className="bdb-tile">
              <p className="bdb-tile-label">Income per month</p>
              <p className="bdb-tile-value">≈ {fmtMoney(tiles.latestIncome, { compact: true })}</p>
              <p className="bdb-tile-sub">
                {scopedIncome.filter((s) => recurringActiveIn(s, latestMonth)).length} source
                {scopedIncome.filter((s) => recurringActiveIn(s, latestMonth)).length === 1
                  ? ""
                  : "s"}{" "}
                · Income & bills tab
              </p>
            </div>
          ) : (
            <div className="bdb-tile">
              <p className="bdb-tile-label">Average per month</p>
              <p className="bdb-tile-value">{fmtMoney(tiles.avg, { compact: true })}</p>
              <p className="bdb-tile-sub">
                {personal ? "cards + bill share, charted window" : "card + fixed, charted window"}
              </p>
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
        {/* Whose money — one pill per member plus the whole household. Only
            a question worth asking when the ledger is actually shared. */}
        {shared && (
          <div className="bdb-toggle" role="tablist" aria-label="Whose money">
            <button
              type="button"
              role="tab"
              aria-selected={!personal}
              className={`bdb-toggle-btn ${!personal ? "is-active" : ""}`}
              onClick={() => setScopePersist("household")}
            >
              Household
            </button>
            {memberList.map((m) => {
              const label = memberLabel(m, youUserId);
              const active = scopeMember === m.userId;
              return (
                <button
                  key={m.userId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`bdb-toggle-btn bdb-toggle-btn--person ${active ? "is-active" : ""}`}
                  onClick={() =>
                    setScopePersist(m.userId === youUserId ? "mine" : m.userId)
                  }
                >
                  <span className="bdb-scope-ava" aria-hidden="true">
                    {memberInitials(label)}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
        )}
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
        <Dropdown
          variant="pill"
          ariaLabel={`Show ${granularity === "months" ? "month" : "year"}`}
          value={selected || ""}
          onChange={(v) => setSelected(v)}
          options={periodOptions.map((k) => ({
            value: k,
            label: k.length === 7 ? monthLong(k) : k,
          }))}
        />
      </div>

      {/* ---- stacked bar chart ---- */}
      <div className="bdb-card">
        <div className="bdb-card-head">
          <h2 className="bdb-h">
            {scopeLabel ? (scopeLabel === "You" ? "Your spending" : `${scopeLabel}'s spending`) : "Spending"}{" "}
            by {granularity === "months" ? "month" : "year"}
          </h2>
          {(chartHasFixed || chartHasIncome) && (
            <div className="bdb-legend" aria-hidden="true">
              <span className="bdb-legend-item">
                <span className="bdb-swatch bdb-swatch--card" /> Card
              </span>
              {chartHasFixed && (
                <span className="bdb-legend-item">
                  <span className="bdb-swatch bdb-swatch--fixed" /> Fixed
                </span>
              )}
              {chartHasIncome && (
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
            aria-label={`Stacked bar chart of ${
              scopeLabel ? `${scopeLabel === "You" ? "your" : `${scopeLabel}'s`} ` : ""
            }card and fixed spending per ${granularity === "months" ? "month" : "year"}`}
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
              if (chartHasFixed) {
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
                    aria-label={`${s.longLabel}: ${fmtMoney(s.total)} total${
                      chartHasFixed
                        ? `, ${fmtMoney(s.card)} card, ${fmtMoney(s.fixed)} fixed`
                        : ""
                    }${
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

      {/* ---- saved by month (diverging) ---- */}
      {chartHasIncome && savedMonths > 0 ? (
        <div className="bdb-card">
          <div className="bdb-card-head">
            <h2 className="bdb-h">
              {scopeLabel
                ? scopeLabel === "You"
                  ? "What you kept"
                  : `What ${scopeLabel} kept`
                : "What the household kept"}{" "}
              by {granularity === "months" ? "month" : "year"}
              <span className="bdb-h-sub"> · income − money out</span>
            </h2>
          </div>
          <div className="bdb-chartwrap">
            <div className="bdb-chartinner">
              <svg
                viewBox={`0 0 ${VBW} ${SAV_VBH}`}
                className="bdb-chart"
                role="img"
                aria-label={`Diverging bar chart of money ${
                  scopeLabel ? `${scopeLabel === "You" ? "you" : scopeLabel} kept` : "the household kept"
                } per ${granularity === "months" ? "month" : "year"} — bars above zero are savings, below are overspend`}
              >
                {/* Extreme tick labels only render when they clear the $0
                    label — a lopsided scale (saved $50 / overspent $2,000)
                    would otherwise overprint the two 10px texts. */}
                {savHi > 0 && (
                  <g>
                    <line
                      className="bdb-grid"
                      x1={PAD.l}
                      x2={VBW - PAD.r}
                      y1={SAV_PAD.t}
                      y2={SAV_PAD.t}
                    />
                    {savHi * savScale >= 14 && (
                      <text className="bdb-tick" x={PAD.l - 6} y={SAV_PAD.t + 3}>
                        {fmtMoney(savHi, { compact: true })}
                      </text>
                    )}
                  </g>
                )}
                {savLo > 0 && (
                  <g>
                    <line
                      className="bdb-grid"
                      x1={PAD.l}
                      x2={VBW - PAD.r}
                      y1={savZeroY + savLo * savScale}
                      y2={savZeroY + savLo * savScale}
                    />
                    {savLo * savScale >= 14 && (
                      <text
                        className="bdb-tick"
                        x={PAD.l - 6}
                        y={savZeroY + savLo * savScale + 3}
                      >
                        −{fmtMoney(savLo, { compact: true })}
                      </text>
                    )}
                  </g>
                )}
                {/* the $0 baseline is the diverging midpoint */}
                <line className="bdb-axis" x1={PAD.l} x2={VBW - PAD.r} y1={savZeroY} y2={savZeroY} />
                <text className="bdb-tick" x={PAD.l - 6} y={savZeroY + 3}>
                  $0
                </text>

                {series.map((s, i) => {
                  const x = PAD.l + i * bandW + (bandW - barW) / 2;
                  const cx = x + barW / 2;
                  const isSelected = s.key === selected;
                  if (s.saved == null) {
                    // No income recorded for this band — an axis label with
                    // no bar reads honestly as "unknown", not "$0 saved".
                    return (
                      <g key={s.key}>
                        <text className="bdb-xlabel" x={cx} y={SAV_VBH - 8}>
                          {s.label}
                        </text>
                      </g>
                    );
                  }
                  const h = Math.abs(s.saved) * savScale;
                  const pos = s.saved >= 0;
                  const showSavTip = () =>
                    setSavTip({
                      leftPct: Math.min(90, Math.max(10, (cx / VBW) * 100)),
                      // Floor at 52%: this chart is shorter than chart 1, so
                      // the same 45% would let a 3-row tip clip at the top of
                      // the scroll wrap.
                      topPct: Math.max(52, ((pos ? savZeroY - h : savZeroY) / SAV_VBH) * 100),
                      title: s.longLabel,
                      value: `${pos ? "saved" : "overspent"} ${fmtMoney(Math.abs(s.saved))}`,
                      rows: [
                        { key: "income", label: "income", value: fmtMoney(s.income) },
                        // neutral key — the blue "card" key means card-only
                        // in the chart above, and this value is card + bills
                        { key: "out", label: "money out", value: fmtMoney(s.total) },
                      ],
                    });
                  return (
                    <g key={s.key} className={isSelected ? "is-selected" : ""}>
                      {h > 0.5 ? (
                        <path
                          className={`bdb-sav ${pos ? "bdb-sav--pos" : "bdb-sav--neg"}`}
                          d={
                            pos
                              ? topRoundedBar(x, savZeroY - h, barW, h)
                              : bottomRoundedBar(x, savZeroY, barW, h)
                          }
                        />
                      ) : (
                        // Broke-even months still get a visible mark on the line.
                        <line
                          className="bdb-sav-zero"
                          x1={x}
                          x2={x + barW}
                          y1={savZeroY}
                          y2={savZeroY}
                        />
                      )}
                      {isSelected && (
                        <text
                          className="bdb-bar-label"
                          x={cx}
                          y={pos ? Math.max(10, savZeroY - h - 6) : Math.min(SAV_VBH - 18, savZeroY + h + 12)}
                        >
                          {s.saved < 0 ? "−" : ""}
                          {fmtMoney(Math.abs(s.saved), { compact: true })}
                        </text>
                      )}
                      <text className="bdb-xlabel" x={cx} y={SAV_VBH - 8}>
                        {s.label}
                      </text>
                      <rect
                        className="bdb-hit"
                        x={PAD.l + i * bandW}
                        y={SAV_PAD.t}
                        width={bandW}
                        height={savPlotH}
                        tabIndex={0}
                        role="button"
                        aria-label={`${s.longLabel}: ${
                          s.saved >= 0 ? "saved" : "overspent"
                        } ${fmtMoney(Math.abs(s.saved))} of ${fmtMoney(s.income)} income`}
                        onMouseEnter={showSavTip}
                        onMouseLeave={() => setSavTip(null)}
                        onFocus={showSavTip}
                        onBlur={() => setSavTip(null)}
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
              {savTip && (
                <div
                  className="bdb-tip"
                  style={{ left: `${savTip.leftPct}%`, top: `${savTip.topPct}%` }}
                >
                  <strong>{savTip.value}</strong>
                  <span>{savTip.title}</span>
                  {savTip.rows.map((r) => (
                    <span key={r.key} className="bdb-tip-row">
                      <i className={`bdb-tip-key bdb-tip-key--${r.key}`} />
                      {r.value} {r.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bdb-card">
          <h2 className="bdb-h">
            {scopeLabel ? `What ${scopeLabel === "You" ? "you" : scopeLabel} kept` : "What you kept"}
            <span className="bdb-h-sub"> · income − money out</span>
          </h2>
          <p className="bdb-sub">
            {hasScopedIncome
              ? `${
                  personal
                    ? scopeLabel === "You"
                      ? "Your"
                      : `${scopeLabel}'s`
                    : "The household's"
                } income sources don't overlap the charted ${
                  granularity === "months" ? "months" : "years"
                } — adjust a source's start or end month in the Income & bills tab to fill them in.`
              : personal
              ? `No income sources for ${
                  scopeLabel === "You" ? "you" : scopeLabel
                } yet — assign paycheques in the Income & bills tab and this chart starts tracking what's kept each month.`
              : "Add income in the Income & bills tab and this chart starts tracking what the household keeps each month."}
          </p>
        </div>
      )}

      {/* ---- per person ---- */}
      {peopleStats.length > 1 && (
        <div className="bdb-card">
          <h2 className="bdb-h">
            Per person
            {selectedEntry && <span className="bdb-h-sub"> · {selectedEntry.longLabel}</span>}
          </h2>
          <div className="bdb-people">
            {peopleStats.map((p) => {
              const active = scopeMember === p.userId;
              return (
                <button
                  key={p.userId}
                  type="button"
                  className={`bdb-person ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  aria-describedby="bdb-people-note"
                  onClick={() =>
                    setScopePersist(
                      active ? "household" : p.userId === youUserId ? "mine" : p.userId
                    )
                  }
                  title={
                    active
                      ? "Back to the household view"
                      : `Focus the dashboard on ${p.label === "You" ? "your" : `${p.label}'s`} money`
                  }
                >
                  <span className="bdb-person-head">
                    <span className="bdb-person-ava" aria-hidden="true">
                      {memberInitials(p.label)}
                    </span>
                    <span className="bdb-person-name">{p.label}</span>
                  </span>
                  <span className="bdb-person-row">
                    <span className="bdb-person-k">money out</span>
                    <span className="bdb-person-v">{fmtMoney(p.out)}</span>
                  </span>
                  <span className="bdb-person-bar" aria-hidden="true">
                    <span
                      className="bdb-cat-fill"
                      style={{ width: `${maxPersonOut ? (p.out / maxPersonOut) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="bdb-person-row">
                    <span className="bdb-person-k">income</span>
                    <span className="bdb-person-v">
                      {p.income > 0 ? `≈ ${fmtMoney(p.income)}` : "—"}
                    </span>
                  </span>
                  <span className="bdb-person-row">
                    <span className="bdb-person-k">{p.saved != null && p.saved < 0 ? "short" : "kept"}</span>
                    <span
                      className={`bdb-person-v ${
                        p.saved == null ? "" : p.saved >= 0 ? "is-good" : "is-bad"
                      }`}
                    >
                      {p.saved == null
                        ? "—"
                        : `${p.saved < 0 ? "−" : ""}${fmtMoney(Math.abs(p.saved))}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="bdb-people-note" id="bdb-people-note">
            Cards count for whoever owns them; shared bills split evenly. Tap a person to focus
            the whole dashboard on them.
          </p>
        </div>
      )}

      <div className="bdb-grid2">
        {/* ---- category breakdown ---- */}
        <div className="bdb-card">
          <h2 className="bdb-h">
            {selectedEntry ? selectedEntry.longLabel : ""} by category
            {personal ? (
              <span className="bdb-h-sub"> · cards + bill share</span>
            ) : (
              hasFixed && <span className="bdb-h-sub"> · card + fixed</span>
            )}
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
                            <span className="bdb-drill-merchant">
                              {item.label}
                              {item._share && (
                                <em className="bdb-drill-flag"> your share of shared</em>
                              )}
                            </span>
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
            {personal && <span className="bdb-scope-chip">household</span>}
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
                <Dropdown
                  ariaLabel="Budget category"
                  value={newBudget.category}
                  onChange={(v) => setNewBudget((b) => ({ ...b, category: v }))}
                  options={[
                    { value: "", label: "Category…" },
                    ...budgetCategoryOptions.map((c) => ({ value: c, label: c })),
                  ]}
                />
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
                  the fixed costs + budgets already account for. Household
                  numbers in either scope — income isn't per-person — so it
                  reads income directly rather than the scoped entry. */}
              {hasIncome &&
                selectedEntry &&
                incomeForMonth(income, selectedEntry.key) > 0 &&
                (() => {
                  const monthIncome = incomeForMonth(income, selectedEntry.key);
                  const budgetsTotal = budgets.reduce((s, b) => s + b.monthly_cents, 0);
                  const fixedSel = fixedForMonth(recurring, selectedEntry.key);
                  const planned = budgetsTotal + fixedSel;
                  const left = monthIncome - planned;
                  return (
                    <p className="bdb-planned">
                      Fixed {fmtMoney(fixedSel)} + budgets {fmtMoney(budgetsTotal)} ={" "}
                      {fmtMoney(planned)} of ≈{fmtMoney(monthIncome)} income
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

          {selectedSavings && selectedEntry && (
            <div className="bdb-insight-block">
              <p className="bdb-insight-h">Savings · {selectedEntry.longLabel}</p>
              <p
                className={`bdb-insight-row ${
                  selectedSavings.saved >= 0 ? "is-good" : "is-bad"
                }`}
              >
                {selectedSavings.saved >= 0 ? "▼" : "▲"}{" "}
                {selectedSavings.saved >= 0
                  ? `Saved ${fmtMoney(selectedSavings.saved)}`
                  : `Overspent by ${fmtMoney(-selectedSavings.saved)}`}
                {` — ${Math.round(
                  (Math.abs(selectedSavings.saved) / selectedSavings.income) * 100
                )}% of ${fmtMoney(selectedSavings.income)} income`}
              </p>
            </div>
          )}

          {movers.length === 0 && detectedSubs.length === 0 && !selectedSavings && (
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
