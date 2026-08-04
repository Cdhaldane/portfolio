import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fmtMoney,
  fmtMoneyExact,
  monthShort,
  monthLong,
  addMonths,
  monthDiff,
  currentMonthKey,
  fixedForMonth,
  incomeForMonth,
} from "../format";
import { niceMax, topRoundedBar, endRoundedBar } from "../chart";
import {
  amortize,
  purchaseCosts,
  spendBaseline,
  paymentLimits,
  affordablePrice,
  verdict,
  downPaymentRunway,
} from "./loan";
import "./AffordPanel.css";

/*
 * Afford — the big-purchase planner. Built for the car question ("what can I
 * actually put down and pay every month?") but the model is generic: a price,
 * some cash up front, a loan, and running costs.
 *
 * Two halves that have to agree:
 *   1. WHAT IT COSTS — amortization, done in loan.js (pure, unit-tested).
 *   2. WHAT FITS — a trailing-6-month baseline of real income and real
 *      spending, straight out of /api/budget/summary. The surplus definition
 *      is byte-for-byte the dashboard's "saved this month", so the two
 *      surfaces can never tell different stories.
 *
 * Nothing here writes to the ledger. A scenario is inputs only (budget_plans);
 * the projection appears in the dashboard's numbers only when you explicitly
 * push the payment into Monthly payments — and then only the payment and
 * insurance, because fuel and maintenance arrive as card charges and would
 * double-count (the same rule the on_card flag enforces elsewhere).
 *
 * Charts follow the house dataviz method: spending is a MAGNITUDE job, so the
 * only data hues are the two validated steps of the blue ramp already used by
 * the dashboard (--blue for money you already spend, --blue-deep for the new
 * commitment). Income stays a neutral ink benchmark tick, sage/coral stay
 * status-only and always ride with signed words.
 */

// -- chart geometry (same viewBox contract as the dashboard's chart) --
const VBW = 720;
const VBH = 240;
const PAD = { l: 52, r: 12, t: 24, b: 30 };
const SEG_GAP = 2;
const BAL_VBH = 200;
const BAL_PAD = { l: 52, r: 60, t: 20, b: 28 };

const WINDOW = 6; // months of history the recommendation is based on
const MAX_PROJECTED = 36; // bound the chart if the purchase is years out

const TERMS = [24, 36, 48, 60, 72, 84];
const HORIZONS = [12, 24];

// The API's ceilings (plans.js), enforced here too — so a fat-fingered extra
// zero can never render a $5.7M payment the server would refuse to save. The
// clamp is visible: saving writes the clamped value back into the form.
const MONEY_MAX = 100_000_000; // $1M
const RUNNING_MAX = 1_000_000; // $10k/month
const RUNWAY_MAX = 120; // past ten years of saving, say so in words

const nextMonthKey = () => addMonths(currentMonthKey(), 1);

/**
 * One axis, one unit. The DIVISOR is chosen from the axis maximum and then
 * applied to every tick — letting each tick pick its own scale gives you
 * "$10K" sitting above "$5,000", and the reader has to re-scale halfway down
 * the axis. (fmtMoney's own compact mode is per-value by design, which is
 * right for prose and wrong for an axis.)
 */
const axisFormat = (maxCents) => {
  const max = Math.abs(maxCents) / 100;
  const step = (n, digits) =>
    n.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (max >= 1000000) return (cents) => `$${step(cents / 100 / 1000000, 1)}M`;
  if (max >= 10000) return (cents) => `$${step(cents / 100 / 1000, 1)}K`;
  return (cents) => `$${step(Math.round(cents / 100), 0)}`;
};

const DEFAULT_FORM = {
  label: "New car",
  price: "30000",
  tax: "13",
  down: "5000",
  tradeIn: "",
  apr: "6.9",
  term: "60",
  insurance: "150",
  fuel: "200",
  maintenance: "75",
  startMonth: "",
};

// Inputs are text so a half-typed "1" never becomes a NaN chart. Anything
// unparseable reads as zero, which shows up honestly in the numbers.
const dollarsToCents = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const pctToBps = (s) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const clampInt = (s, fallback, min, max) => {
  const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const formToPlan = (form) => {
  const money = (s) => Math.min(MONEY_MAX, dollarsToCents(s));
  const running = (s) => Math.min(RUNNING_MAX, dollarsToCents(s));
  return {
    label: form.label.trim() || "Purchase",
    priceCents: money(form.price),
    taxBps: Math.min(3000, pctToBps(form.tax)),
    downCents: money(form.down),
    tradeInCents: money(form.tradeIn),
    aprBps: Math.min(5000, pctToBps(form.apr)),
    termMonths: clampInt(form.term, 60, 1, 120),
    insuranceCents: running(form.insurance),
    fuelCents: running(form.fuel),
    maintenanceCents: running(form.maintenance),
    startMonth: form.startMonth || nextMonthKey(),
  };
};

const planToForm = (row) => ({
  label: row.label,
  price: String(row.price_cents / 100),
  tax: String(row.tax_bps / 100),
  down: row.down_cents ? String(row.down_cents / 100) : "",
  tradeIn: row.trade_in_cents ? String(row.trade_in_cents / 100) : "",
  apr: String(row.apr_bps / 100),
  term: String(row.term_months),
  insurance: row.insurance_cents ? String(row.insurance_cents / 100) : "",
  fuel: row.fuel_cents ? String(row.fuel_cents / 100) : "",
  maintenance: row.maintenance_cents ? String(row.maintenance_cents / 100) : "",
  startMonth: row.start_month,
});

/** Everything derived from one scenario's inputs — used by the panel and by
 *  the compare table, so a saved plan's row and the open chart always agree. */
const derive = (input) => {
  const costs = purchaseCosts(input);
  const loan = amortize(costs.financedCents, input.aprBps, input.termMonths);
  const runningCents =
    input.insuranceCents + input.fuelCents + input.maintenanceCents;
  return {
    ...input,
    ...costs,
    loan,
    runningCents,
    totalMonthlyCents: loan.payment + runningCents,
  };
};

const AffordPanel = ({ fetchJson, refreshToken, onMutate, onOpenMonthly }) => {
  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(null); // null = unsaved draft
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    startMonth: nextMonthKey(),
  }));
  const [horizon, setHorizon] = useState(12);
  const [tip, setTip] = useState(null);
  const [balTip, setBalTip] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const [pushed, setPushed] = useState(null); // { id, text } after "add to Monthly"

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    const [summaryRes, plansRes] = await Promise.all([
      fetchJson("/api/budget/summary"),
      fetchJson("/api/budget/plans"),
    ]);
    setBusy(false);
    if (!summaryRes.res.ok || !summaryRes.data) {
      setError(summaryRes.data?.error || "Couldn't load your spending — try again.");
    } else {
      setSummary(summaryRes.data);
    }
    if (plansRes.res.ok && plansRes.data) setPlans(plansRes.data.plans || []);
  }, [fetchJson]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const recurring = useMemo(() => summary?.recurring || [], [summary]);
  const incomeSources = useMemo(() => summary?.income || [], [summary]);

  // ---- what the household actually earns and spends ----

  // month key -> card charges (statement spending only, weighted by count_pct
  // upstream in SQL).
  const cardByMonth = useMemo(() => {
    const index = new Map();
    for (const row of summary?.months || []) {
      index.set(row.month, (index.get(row.month) || 0) + row.spend_cents);
    }
    return index;
  }, [summary]);

  const baselineRows = useMemo(() => {
    const keys = [...cardByMonth.keys()].sort();
    if (!keys.length) return [];
    // The current calendar month is nearly always a PARTIAL statement.
    // Counting it would understate spending and inflate the recommendation —
    // the dangerous direction to be wrong in — so drop it whenever there's
    // enough history to stand without it.
    const thisMonth = currentMonthKey();
    const usable =
      keys[keys.length - 1] === thisMonth && keys.length > 3
        ? keys.slice(0, -1)
        : keys;
    return usable.slice(-WINDOW).map((key) => ({
      key,
      income: incomeForMonth(incomeSources, key),
      card: cardByMonth.get(key) || 0,
      fixed: fixedForMonth(recurring, key),
    }));
  }, [cardByMonth, incomeSources, recurring]);

  const baseline = useMemo(() => spendBaseline(baselineRows), [baselineRows]);
  const limits = useMemo(
    () => paymentLimits({ avgIncome: baseline.avgIncome, avgSurplus: baseline.avgSurplus }),
    [baseline]
  );

  // ---- what the scenario costs ----

  const plan = useMemo(() => derive(formToPlan(form)), [form]);
  const { loan, runningCents, totalMonthlyCents } = plan;

  const call = useMemo(
    () =>
      verdict({
        totalMonthlyCents,
        limits,
        leanestSurplus: baseline.leanest?.surplus ?? null,
      }),
    [totalMonthlyCents, limits, baseline]
  );

  const maxPrice = useMemo(
    () =>
      affordablePrice({
        limitCents: limits.recommended,
        runningCents,
        aprBps: plan.aprBps,
        termMonths: plan.termMonths,
        cashCents: plan.cashDownCents,
        taxBps: plan.taxBps,
      }),
    [limits.recommended, runningCents, plan]
  );

  // Saved scenarios, costed. Memoized because it amortizes every scenario's
  // full term and the form re-renders on every keystroke.
  const comparisons = useMemo(
    () =>
      plans.map((row) => ({
        row,
        derived: derive({
          priceCents: row.price_cents,
          taxBps: row.tax_bps,
          downCents: row.down_cents,
          tradeInCents: row.trade_in_cents,
          aprBps: row.apr_bps,
          termMonths: row.term_months,
          insuranceCents: row.insurance_cents,
          fuelCents: row.fuel_cents,
          maintenanceCents: row.maintenance_cents,
        }),
      })),
    [plans]
  );

  const runway = downPaymentRunway(plan.downCents, baseline.avgSurplus);
  // What's left of the recommended limit once the running costs are paid —
  // when this is <= 0 there's no room for a loan at all, only cash.
  const loanRoomCents =
    limits.recommended == null ? null : limits.recommended - runningCents;

  // ---- chart 1: monthly money out, before and after ----

  const flow = useMemo(() => {
    const history = baselineRows.map((row) => ({
      key: row.key,
      label: monthShort(row.key),
      longLabel: monthLong(row.key),
      base: row.card + row.fixed,
      payment: 0,
      running: 0,
      income: row.income,
      projected: false,
    }));

    const lastReal = baselineRows.length
      ? baselineRows[baselineRows.length - 1].key
      : null;
    const firstProjected = lastReal ? addMonths(lastReal, 1) : currentMonthKey();
    // A purchase month in the past can't be charted as future — the plan
    // keeps the user's value, the projection starts where history ends.
    const buyMonth =
      plan.startMonth > firstProjected ? plan.startMonth : firstProjected;
    const lead = Math.max(0, Math.min(MAX_PROJECTED - 1, monthDiff(firstProjected, buyMonth)));
    const count = Math.min(MAX_PROJECTED, lead + horizon);

    const projected = [];
    for (let i = 0; i < count; i++) {
      const key = addMonths(firstProjected, i);
      const since = monthDiff(buyMonth, key);
      const owned = since >= 0;
      projected.push({
        key,
        label: monthShort(key),
        longLabel: monthLong(key),
        base: baseline.avgOutflow,
        // The payment stops when the loan is paid off; the running costs
        // don't. Visible whenever the horizon outlives the term.
        payment: owned && since < plan.termMonths ? loan.payment : 0,
        running: owned ? runningCents : 0,
        income: incomeForMonth(incomeSources, key),
        projected: true,
      });
    }

    const bars = [...history, ...projected].map((b) => ({
      ...b,
      car: b.payment + b.running,
      total: b.base + b.payment + b.running,
    }));
    return {
      bars,
      buyMonth,
      buyIndex: bars.findIndex((b) => b.key === buyMonth),
      yMax: niceMax(Math.max(...bars.map((b) => Math.max(b.total, b.income)), 1)),
    };
  }, [baselineRows, baseline.avgOutflow, plan, loan.payment, runningCents, horizon, incomeSources]);

  // ---- chart 2: what's owed vs what's been paid, whole term ----

  const payoff = useMemo(() => {
    // Month 0 is the drive-away moment: you've paid the cash, you owe the
    // loan. Point n is therefore the state at the START of month
    // startMonth + n, after n payments — which is why the payoff month (the
    // month of the LAST payment) is months − 1, matching the end_month the
    // "add to Monthly payments" button writes.
    const points = [
      { n: 0, key: plan.startMonth, balance: plan.financedCents, paid: plan.cashDownCents, interest: 0 },
      ...loan.rows.map((r) => ({
        n: r.n,
        key: addMonths(plan.startMonth, r.n),
        balance: r.balance,
        paid: plan.cashDownCents + r.cumPaid,
        interest: r.cumInterest,
      })),
    ];
    return {
      points,
      yMax: niceMax(Math.max(plan.financedCents, points[points.length - 1].paid, 1)),
      payoffMonth: addMonths(plan.startMonth, Math.max(0, loan.months - 1)),
    };
  }, [plan, loan]);

  // ---- scenario persistence ----

  const selectPlan = (row) => {
    setActiveId(row.id);
    setForm(planToForm(row));
    setSaveError("");
    setPushed(null);
  };

  const newPlan = () => {
    setActiveId(null);
    setForm({ ...DEFAULT_FORM, startMonth: nextMonthKey() });
    setSaveError("");
    setPushed(null);
  };

  const savePlan = async () => {
    setSaveError("");
    setSaving(true);
    const body = formToPlan(form);
    const { res, data } = await fetchJson("/api/budget/plans", {
      method: activeId ? "PATCH" : "POST",
      body: JSON.stringify(activeId ? { id: activeId, ...body } : body),
    });
    setSaving(false);
    if (!res.ok || !data?.ok) {
      setSaveError(data?.error || "Couldn't save that scenario.");
      return;
    }
    // The saved row is authoritative (the server rounds and clamps), so adopt
    // it. A response without one — the dev preview's stubbed mutations —
    // falls back to a reload rather than throwing.
    if (!data.plan) {
      await load();
      return;
    }
    setPlans((prev) =>
      activeId
        ? prev.map((p) => (p.id === data.plan.id ? data.plan : p))
        : [...prev, data.plan]
    );
    setActiveId(data.plan.id);
    setForm(planToForm(data.plan));
  };

  const deletePlan = async () => {
    if (!activeId) return;
    setSaveError("");
    setSaving(true);
    const { res, data } = await fetchJson(`/api/budget/plans?id=${activeId}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (res.ok && data?.ok) {
      setPlans((prev) => prev.filter((p) => p.id !== activeId));
      newPlan();
    } else {
      setSaveError(data?.error || "Couldn't delete that scenario.");
    }
  };

  /*
   * Commit the scenario to the ledger as real fixed costs. Only the loan
   * payment and insurance go in: fuel and maintenance land on a card and
   * arrive via statement upload, so tracking them here as well would
   * double-count exactly what the on_card flag exists to prevent.
   *
   * The payment carries an end month (the loan's last payment), which is the
   * whole reason budget_recurring has one — the dashboard stops counting it
   * the month the car is paid off, with no cleanup to remember.
   */
  const pushToMonthly = async () => {
    setSaveError("");
    setSaving(true);
    const created = [];
    const items = [
      {
        label: `${plan.label} — loan payment`,
        amountCents: loan.payment,
        endMonth: addMonths(plan.startMonth, Math.max(0, loan.months - 1)),
        skip: loan.payment <= 0,
      },
      {
        label: `${plan.label} — insurance`,
        amountCents: plan.insuranceCents,
        endMonth: null,
        skip: plan.insuranceCents <= 0,
      },
    ];
    for (const item of items) {
      if (item.skip) continue;
      const { res, data } = await fetchJson("/api/budget/recurring", {
        method: "POST",
        body: JSON.stringify({
          label: item.label,
          category: "Transport",
          amountCents: item.amountCents,
          startMonth: plan.startMonth,
          endMonth: item.endMonth,
          onCard: false,
        }),
      });
      if (!res.ok || !data?.ok) {
        setSaving(false);
        setSaveError(data?.error || "Couldn't add that to Monthly payments.");
        return;
      }
      created.push(`${item.label} (${fmtMoneyExact(item.amountCents)}/mo)`);
    }
    setSaving(false);
    if (!created.length) {
      setSaveError("Nothing to add — there's no payment or insurance in this scenario.");
      return;
    }
    setPushed({ id: activeId ?? "draft", text: created.join(" and ") });
    onMutate?.();
  };

  // ---- render ----

  if (busy && !summary) {
    return <p className="afp-loading">Working out what you can afford…</p>;
  }
  if (error && !summary) {
    return (
      <div className="afp-empty">
        <p>{error}</p>
        <button type="button" className="afp-chip" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  const field = (key, label, props = {}) => (
    <label className="afp-field">
      <span className="afp-field-label">{label}</span>
      <input
        className="afp-input"
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...props}
      />
    </label>
  );

  // Chart 1 geometry.
  const plotW = VBW - PAD.l - PAD.r;
  const plotH = VBH - PAD.t - PAD.b;
  const bandW = plotW / flow.bars.length;
  const barW = Math.min(24, Math.max(6, bandW * 0.6));
  const baseY = PAD.t + plotH;
  const hOf = (cents) => (cents / flow.yMax) * plotH;
  const flowTick = axisFormat(flow.yMax);

  // Chart 2 geometry.
  const balW = VBW - BAL_PAD.l - BAL_PAD.r;
  const balH = BAL_VBH - BAL_PAD.t - BAL_PAD.b;
  const balX = (n) =>
    BAL_PAD.l + (payoff.points.length > 1 ? (balW * n) / (payoff.points.length - 1) : 0);
  const balY = (cents) => BAL_PAD.t + balH - (cents / payoff.yMax) * balH;
  const payoffTick = axisFormat(payoff.yMax);
  const line = (pick) =>
    payoff.points.map((p) => `${balX(p.n)},${balY(pick(p))}`).join(" ");
  // Same vertices as the line, closed down to the baseline for the wash.
  const area = (pick) =>
    `M ${balX(0)},${BAL_PAD.t + balH} ` +
    payoff.points.map((p) => `L ${balX(p.n)},${balY(pick(p))}`).join(" ") +
    ` L ${balX(payoff.points.length - 1)},${BAL_PAD.t + balH} Z`;

  const overCeiling = limits.known && totalMonthlyCents > limits.ceiling;
  const meterPct =
    limits.known && limits.ceiling > 0
      ? Math.min(100, (totalMonthlyCents / limits.ceiling) * 100)
      : 0;
  const recPct =
    limits.known && limits.ceiling > 0
      ? Math.min(100, (limits.recommended / limits.ceiling) * 100)
      : 0;

  const alreadyPushed = pushed && pushed.id === (activeId ?? "draft");

  return (
    <div className={`afp ${busy ? "is-refreshing" : ""}`}>
      {error && summary && (
        <div className="afp-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="afp-chip afp-chip--small" onClick={load}>
            Retry
          </button>
        </div>
      )}

      <div className="afp-head">
        <div>
          <h2 className="afp-h">Can I afford it?</h2>
          <p className="afp-sub">
            Model a big purchase — a car, a truck, a caravan — against what you
            actually earn and spend.{" "}
            {baseline.monthCount > 0 ? (
              <>
                The recommendation comes from your last {baseline.monthCount}{" "}
                month{baseline.monthCount === 1 ? "" : "s"} of real statements
                and bills
              </>
            ) : (
              <>
                Upload a statement and add your income in the Monthly tab and
                the recommendation below fills itself in
              </>
            )}
            ; nothing on this page touches your ledger until you push it into
            Monthly payments.
          </p>
        </div>
      </div>

      {/* ---- saved scenarios ---- */}
      <div className="afp-scenarios" aria-label="Saved scenarios">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`afp-scenario ${activeId === p.id ? "is-active" : ""}`}
            onClick={() => selectPlan(p)}
          >
            {p.label}
            <span className="afp-scenario-sub">{fmtMoney(p.price_cents, { compact: true })}</span>
          </button>
        ))}
        <button
          type="button"
          className={`afp-scenario afp-scenario--new ${activeId === null ? "is-active" : ""}`}
          onClick={newPlan}
        >
          + New scenario
        </button>
      </div>

      {/* ---- the scenario form ---- */}
      <div className="afp-card">
        <div className="afp-form">
          <label className="afp-field afp-field--wide">
            <span className="afp-field-label">What is it</span>
            <input
              className="afp-input"
              maxLength={60}
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </label>
          {field("price", "Price (before tax)")}
          {field("tax", "Sales tax %", { title: "13% HST in Ontario" })}
          {field("down", "Cash down")}
          {field("tradeIn", "Trade-in")}
          {field("apr", "Interest rate %")}
          <label className="afp-field">
            <span className="afp-field-label">Term</span>
            <select
              className="afp-input"
              value={form.term}
              onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
            >
              {TERMS.map((t) => (
                <option key={t} value={String(t)}>
                  {t} months
                </option>
              ))}
            </select>
          </label>
          <label className="afp-field">
            <span className="afp-field-label">Buying in</span>
            <input
              type="month"
              className="afp-input"
              value={form.startMonth}
              onChange={(e) => setForm((f) => ({ ...f, startMonth: e.target.value }))}
            />
          </label>
        </div>

        <p className="afp-form-h">
          Running costs — the <em>extra</em> per month, on top of what you
          already spend
          {baseline.monthCount > 0 && (
            <span className="afp-form-hint">
              {" "}
              · you average {fmtMoney(baseline.avgOutflow)}/mo of card + fixed
              spending today
            </span>
          )}
        </p>
        <div className="afp-form">
          {field("insurance", "Insurance / mo")}
          {field("fuel", "Fuel / mo")}
          {field("maintenance", "Maintenance / mo")}
        </div>

        <div className="afp-form-actions">
          <button type="button" className="afp-chip" onClick={savePlan} disabled={saving}>
            {activeId ? "Save changes" : "Save scenario"}
          </button>
          {activeId && (
            <button
              type="button"
              className="afp-btn afp-btn--danger"
              onClick={deletePlan}
              disabled={saving}
            >
              Delete
            </button>
          )}
          {saveError && <p className="afp-error">{saveError}</p>}
        </div>
      </div>

      {/* ---- the answer ---- */}
      <div className="afp-card afp-answer">
        <div className="afp-hero">
          <p className="afp-hero-label">Monthly payment</p>
          <p className="afp-hero-value">{fmtMoneyExact(loan.payment)}</p>
          <p className="afp-hero-sub">
            {loan.months > 0
              ? `${fmtMoney(plan.financedCents)} financed at ${(plan.aprBps / 100).toFixed(
                  2
                )}% over ${loan.months} months`
              : "Paid in cash — nothing financed"}
          </p>
        </div>

        <div className="afp-tiles">
          <div className="afp-tile">
            <p className="afp-tile-label">All-in monthly</p>
            <p className="afp-tile-value">{fmtMoney(totalMonthlyCents)}</p>
            <p className="afp-tile-sub">
              payment + {fmtMoney(runningCents)} running
            </p>
          </div>
          <div className="afp-tile">
            <p className="afp-tile-label">Recommended limit</p>
            <p className="afp-tile-value">
              {limits.known ? fmtMoney(limits.recommended) : "—"}
            </p>
            <p className="afp-tile-sub">
              {limits.known
                ? "for everything the car costs"
                : "add income in the Monthly tab"}
            </p>
          </div>
          <div className="afp-tile">
            <p className="afp-tile-label">That buys about</p>
            <p className="afp-tile-value">
              {maxPrice != null ? fmtMoney(maxPrice, { compact: true }) : "—"}
            </p>
            <p className="afp-tile-sub">
              {maxPrice == null
                ? "needs income on file"
                : loanRoomCents > 0
                ? `sticker price at ${(plan.aprBps / 100).toFixed(2)}% / ${
                    plan.termMonths
                  } mo with ${fmtMoney(plan.cashDownCents)} down`
                : `cash only — ${fmtMoney(
                    runningCents
                  )}/mo of running costs already passes the limit`}
            </p>
          </div>
          <div className="afp-tile">
            <p className="afp-tile-label">Cost of borrowing</p>
            <p className="afp-tile-value">{fmtMoney(loan.totalInterest)}</p>
            <p className="afp-tile-sub">
              {plan.financedCents > 0
                ? `${Math.round((loan.totalInterest / plan.financedCents) * 100)}% on top of the loan`
                : "no interest — no loan"}
            </p>
          </div>
        </div>

        {/* Affordability meter: the track IS the ceiling (every spare dollar),
            so running past the end of it is literally spending money you
            don't have. The tick marks the recommendation. State is never
            color-alone — the verdict below always says it in words. */}
        {limits.known && limits.ceiling > 0 ? (
          <div className="afp-meter-block">
            <div className="afp-meter" role="img" aria-label={`${fmtMoney(totalMonthlyCents)} of car costs against ${fmtMoney(limits.ceiling)} of spare cash`}>
              <div
                className={`afp-meter-fill ${overCeiling ? "is-over" : ""}`}
                style={{ width: `${meterPct}%` }}
              />
              <div className="afp-meter-tick" style={{ left: `${recPct}%` }} />
            </div>
            <div className="afp-meter-scale">
              <span>$0</span>
              <span className="afp-meter-mid">
                ▲ recommended {fmtMoney(limits.recommended)}
              </span>
              <span>{fmtMoney(limits.ceiling)} spare</span>
            </div>
          </div>
        ) : null}

        <div className={`afp-verdict is-${call.level}`}>
          {call.level === "fits" && (
            <p className="afp-verdict-main">
              ✓ Fits — {fmtMoney(totalMonthlyCents)} a month is{" "}
              {fmtMoney(call.room)} under your recommended limit, and you'd
              still be saving about{" "}
              {fmtMoney(Math.max(0, baseline.avgSurplus - totalMonthlyCents))} a
              month.
            </p>
          )}
          {call.level === "tight" && (
            <p className="afp-verdict-main">
              ▲ Tight — {fmtMoney(totalMonthlyCents)} a month is{" "}
              {fmtMoney(call.overBy)} over the recommended{" "}
              {fmtMoney(limits.recommended)}. Doable, but it eats{" "}
              {Math.round((totalMonthlyCents / Math.max(1, baseline.avgSurplus)) * 100)}
              % of your spare cash — a bad month has nowhere to go.
            </p>
          )}
          {call.level === "over" && (
            <p className="afp-verdict-main">
              ▲ Over — {fmtMoney(totalMonthlyCents)} a month is{" "}
              {fmtMoney(call.overBy)} more than you have spare. On these
              numbers the payment comes out of savings or credit every single
              month.
            </p>
          )}
          {call.level === "unknown" && (
            <p className="afp-verdict-main">
              No income on file, so there's nothing to measure this against.
              Add your paycheques in the{" "}
              <button type="button" className="afp-link" onClick={() => onOpenMonthly?.()}>
                Monthly tab
              </button>{" "}
              and this page will tell you what fits.
            </p>
          )}
          {call.dipsInLeanMonth && baseline.leanest && (
            <p className="afp-verdict-note">
              {baseline.leanest.surplus >= 0 ? (
                <>
                  Watch out: in your leanest month (
                  {monthLong(baseline.leanest.key)}) you only had{" "}
                  {fmtMoney(baseline.leanest.surplus)} spare — this payment
                  would have come straight out of savings that month.
                </>
              ) : (
                <>
                  Watch out: your leanest month (
                  {monthLong(baseline.leanest.key)}) was already{" "}
                  {fmtMoney(-baseline.leanest.surplus)} short before any car
                  payment.
                </>
              )}
            </p>
          )}
          {runway != null && runway > 0 && (
            <p className="afp-verdict-note">
              At {fmtMoney(baseline.avgSurplus)} saved a month,{" "}
              {fmtMoney(plan.downCents)} of cash down takes{" "}
              {runway > RUNWAY_MAX ? (
                <strong>more than ten years</strong>
              ) : (
                <>
                  about{" "}
                  <strong>
                    {runway} month{runway === 1 ? "" : "s"}
                  </strong>{" "}
                  ({monthLong(addMonths(currentMonthKey(), runway))})
                </>
              )}{" "}
              to put together.
            </p>
          )}
        </div>

        {limits.known && (
          <table className="afp-limits">
            <caption className="afp-limits-caption">
              Monthly limits for everything the vehicle costs
            </caption>
            <tbody>
              <tr className="is-headline">
                <th scope="row">Recommended</th>
                <td>{fmtMoney(limits.recommended)}</td>
                <td>the lower of the two lines below — start here</td>
              </tr>
              <tr>
                <th scope="row">Comfortable</th>
                <td>{fmtMoney(limits.comfortable)}</td>
                <td>half your spare cash; the savings habit survives</td>
              </tr>
              <tr>
                <th scope="row">Rule of thumb</th>
                <td>{fmtMoney(limits.ruleOfThumb)}</td>
                <td>the 20/4/10 guide: all transport under 10% of income</td>
              </tr>
              <tr>
                <th scope="row">Stretch</th>
                <td>{fmtMoney(limits.stretch)}</td>
                <td>three quarters of it; thin cushion</td>
              </tr>
              <tr>
                <th scope="row">Ceiling</th>
                <td>{fmtMoney(limits.ceiling)}</td>
                <td>every spare dollar — you save nothing</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="afp-push">
          {alreadyPushed ? (
            <p className="afp-push-done">
              ✓ Added {pushed.text} to Monthly payments.{" "}
              <button type="button" className="afp-link" onClick={() => onOpenMonthly?.()}>
                Open the Monthly tab
              </button>
            </p>
          ) : (
            <>
              <button
                type="button"
                className="afp-btn"
                onClick={pushToMonthly}
                disabled={saving || loan.payment <= 0}
              >
                Bought it — add to Monthly payments
              </button>
              <p className="afp-push-hint">
                Creates the payment (ending{" "}
                {monthLong(addMonths(plan.startMonth, Math.max(0, loan.months - 1)))})
                and the insurance as fixed monthly costs. Fuel and maintenance
                are left out on purpose — those arrive as card charges, and
                counting them twice is the one thing this app refuses to do.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ---- chart 1: monthly outflow, before and after ---- */}
      <div className="afp-card">
        <div className="afp-card-head">
          <h3 className="afp-h3">
            Money out per month
            <span className="afp-h-sub">
              {baseline.monthCount > 0
                ? ` · history, then projected at your ${baseline.monthCount}-month average`
                : " · projected"}
              {" · ▲ "}
              {monthLong(flow.buyMonth)}
            </span>
          </h3>
          <div className="afp-legend" aria-hidden="true">
            <span className="afp-legend-item">
              <span className="afp-swatch afp-swatch--base" /> Today's spending
            </span>
            <span className="afp-legend-item">
              <span className="afp-swatch afp-swatch--car" /> {plan.label}
            </span>
            {baseline.hasIncome && (
              <span className="afp-legend-item">
                <span className="afp-swatch afp-swatch--income" /> Income
              </span>
            )}
          </div>
        </div>
        <div className="afp-toggle" role="tablist" aria-label="Projection length">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              role="tab"
              aria-selected={horizon === h}
              className={`afp-toggle-btn ${horizon === h ? "is-active" : ""}`}
              onClick={() => setHorizon(h)}
            >
              {h} months
            </button>
          ))}
        </div>
        <div className="afp-chartwrap">
          <div className="afp-chartinner">
            <svg
              viewBox={`0 0 ${VBW} ${VBH}`}
              className="afp-chart"
              role="img"
              aria-label={`Stacked bars of monthly money out: ${fmtMoney(
                baseline.avgOutflow
              )} of current spending, plus ${fmtMoney(
                totalMonthlyCents
              )} for the ${plan.label} from ${monthLong(flow.buyMonth)}`}
            >
              {[0.5, 1].map((f) => (
                <g key={f}>
                  <line
                    className="afp-grid"
                    x1={PAD.l}
                    x2={VBW - PAD.r}
                    y1={baseY - plotH * f}
                    y2={baseY - plotH * f}
                  />
                  <text className="afp-tick" x={PAD.l - 6} y={baseY - plotH * f + 3}>
                    {flowTick(flow.yMax * f)}
                  </text>
                </g>
              ))}
              <line className="afp-axis" x1={PAD.l} x2={VBW - PAD.r} y1={baseY} y2={baseY} />

              {/* Purchase divider — where the projection changes character. */}
              {flow.buyIndex > 0 && (
                <line
                  className="afp-divider"
                  x1={PAD.l + flow.buyIndex * bandW}
                  x2={PAD.l + flow.buyIndex * bandW}
                  y1={PAD.t}
                  y2={baseY}
                />
              )}

              {flow.bars.map((b, i) => {
                const x = PAD.l + i * bandW + (bandW - barW) / 2;
                const cx = x + barW / 2;
                const hBase = hOf(b.base);
                const hCar = hOf(b.car);
                const gap = hBase > 0 && hCar > SEG_GAP + 4 ? SEG_GAP : 0;
                const yTop = baseY - hBase - hCar;
                const isBuy = b.key === flow.buyMonth;
                const showTip = () =>
                  setTip({
                    leftPct: Math.min(88, Math.max(12, (cx / VBW) * 100)),
                    topPct: Math.max(42, (Math.min(yTop, baseY - 8) / VBH) * 100),
                    title: b.longLabel + (b.projected ? " · projected" : ""),
                    value: fmtMoney(b.total),
                    rows: [
                      { key: "base", label: b.projected ? "current spending (avg)" : "card + fixed", value: fmtMoney(b.base) },
                      ...(b.payment > 0
                        ? [{ key: "car", label: "loan payment", value: fmtMoney(b.payment) }]
                        : []),
                      ...(b.running > 0
                        ? [{ key: "car", label: "running costs", value: fmtMoney(b.running) }]
                        : []),
                      ...(b.income > 0
                        ? [
                            { key: "income", label: "income", value: fmtMoney(b.income) },
                            {
                              key: "left",
                              label: b.income - b.total >= 0 ? "left over" : "short",
                              value: fmtMoney(Math.abs(b.income - b.total)),
                            },
                          ]
                        : []),
                    ],
                  });
                return (
                  <g key={b.key} className={isBuy ? "is-focus" : ""}>
                    {hBase > 0 &&
                      (hCar > 0 ? (
                        <rect
                          className="afp-seg afp-seg--base"
                          x={x}
                          y={baseY - hBase}
                          width={barW}
                          height={hBase}
                        />
                      ) : (
                        <path
                          className="afp-seg afp-seg--base"
                          d={topRoundedBar(x, baseY - hBase, barW, hBase)}
                        />
                      ))}
                    {hCar > 0 && (
                      <path
                        className="afp-seg afp-seg--car"
                        d={topRoundedBar(x, yTop, barW, Math.max(1, hCar - gap))}
                      />
                    )}
                    {b.income > 0 && (
                      <line
                        className="afp-income-tick"
                        x1={x - 3}
                        x2={x + barW + 3}
                        y1={baseY - hOf(b.income)}
                        y2={baseY - hOf(b.income)}
                      />
                    )}
                    {/* One direct label: the month the car arrives. Placed
                        above whichever is higher, the bar or the income tick,
                        so it can never sit on top of the benchmark line. */}
                    {isBuy && (
                      <text
                        className="afp-bar-label"
                        x={cx}
                        y={Math.max(
                          10,
                          Math.min(yTop, b.income > 0 ? baseY - hOf(b.income) : yTop) - 7
                        )}
                      >
                        {/* Full precision on the one direct label — the axis
                            is where rounding to "$4K" belongs. */}
                        {fmtMoney(b.total)}
                      </text>
                    )}
                    <text className="afp-xlabel" x={cx} y={VBH - 12}>
                      {b.label}
                    </text>
                    {isBuy && (
                      <text className="afp-xmark" x={cx} y={VBH - 2}>
                        ▲
                      </text>
                    )}
                    <rect
                      className="afp-hit"
                      x={PAD.l + i * bandW}
                      y={PAD.t}
                      width={bandW}
                      height={plotH}
                      tabIndex={0}
                      aria-label={`${b.longLabel}${
                        b.projected ? " projected" : ""
                      }: ${fmtMoney(b.total)} out, ${fmtMoney(b.base)} existing, ${fmtMoney(
                        b.car
                      )} vehicle${b.income > 0 ? `, ${fmtMoney(b.income)} income` : ""}`}
                      onMouseEnter={showTip}
                      onMouseLeave={() => setTip(null)}
                      onFocus={showTip}
                      onBlur={() => setTip(null)}
                    />
                  </g>
                );
              })}
            </svg>
            {tip && (
              <div className="afp-tip" style={{ left: `${tip.leftPct}%`, top: `${tip.topPct}%` }}>
                <strong>{tip.value}</strong>
                <span>{tip.title}</span>
                {tip.rows.map((r) => (
                  <span key={r.label} className="afp-tip-row">
                    <i className={`afp-tip-key afp-tip-key--${r.key}`} />
                    {r.value} {r.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- chart 2: the loan's life ---- */}
      {loan.months > 0 && (
        <div className="afp-card">
          <div className="afp-card-head">
            <h3 className="afp-h3">
              The loan
              <span className="afp-h-sub"> · paid off {monthLong(payoff.payoffMonth)}</span>
            </h3>
            <div className="afp-legend" aria-hidden="true">
              <span className="afp-legend-item">
                <span className="afp-swatch afp-swatch--base" /> Still owed
              </span>
              <span className="afp-legend-item">
                <span className="afp-swatch afp-swatch--car" /> Cash paid
              </span>
            </div>
          </div>
          <div className="afp-chartwrap">
            <div className="afp-chartinner">
              <svg
                viewBox={`0 0 ${VBW} ${BAL_VBH}`}
                className="afp-chart"
                role="img"
                aria-label={`Line chart: the ${fmtMoney(
                  plan.financedCents
                )} balance falling to zero by ${monthLong(
                  payoff.payoffMonth
                )} while total cash paid climbs to ${fmtMoney(
                  payoff.points[payoff.points.length - 1].paid
                )}`}
                onMouseLeave={() => setBalTip(null)}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const vx = ((e.clientX - rect.left) / rect.width) * VBW;
                  const t = (vx - BAL_PAD.l) / balW;
                  const n = Math.round(t * (payoff.points.length - 1));
                  const p = payoff.points[Math.min(payoff.points.length - 1, Math.max(0, n))];
                  if (!p) return;
                  setBalTip(p);
                }}
              >
                {[0.5, 1].map((f) => (
                  <g key={f}>
                    <line
                      className="afp-grid"
                      x1={BAL_PAD.l}
                      x2={VBW - BAL_PAD.r}
                      y1={BAL_PAD.t + balH * (1 - f)}
                      y2={BAL_PAD.t + balH * (1 - f)}
                    />
                    <text
                      className="afp-tick"
                      x={BAL_PAD.l - 6}
                      y={BAL_PAD.t + balH * (1 - f) + 3}
                    >
                      {payoffTick(payoff.yMax * f)}
                    </text>
                  </g>
                ))}
                <line
                  className="afp-axis"
                  x1={BAL_PAD.l}
                  x2={VBW - BAL_PAD.r}
                  y1={BAL_PAD.t + balH}
                  y2={BAL_PAD.t + balH}
                />

                {/* Balance owed: 10% wash under a 2px line. */}
                <path className="afp-area" d={area((p) => p.balance)} />
                <polyline className="afp-line afp-line--owed" points={line((p) => p.balance)} />
                <polyline className="afp-line afp-line--paid" points={line((p) => p.paid)} />

                {/* Year marks only — a tick per month would be a picket fence. */}
                {payoff.points.map((p) =>
                  p.n > 0 && p.n % 12 === 0 ? (
                    <text
                      key={p.n}
                      className="afp-xlabel"
                      x={balX(p.n)}
                      y={BAL_VBH - 8}
                    >
                      {monthShort(p.key)} '{p.key.slice(2, 4)}
                    </text>
                  ) : null
                )}
                <text className="afp-xlabel" x={balX(0)} y={BAL_VBH - 8}>
                  {monthShort(plan.startMonth)} '{plan.startMonth.slice(2, 4)}
                </text>

                {/* Endpoint labels, the only direct values on the plot. */}
                <text
                  className="afp-end-label"
                  x={balX(payoff.points.length - 1) + 8}
                  y={balY(payoff.points[payoff.points.length - 1].paid) + 4}
                >
                  {fmtMoney(payoff.points[payoff.points.length - 1].paid, {
                    compact: true,
                  })}
                </text>
                <text
                  className="afp-end-label"
                  x={balX(payoff.points.length - 1) + 8}
                  y={BAL_PAD.t + balH + 4}
                >
                  $0
                </text>

                {balTip && (
                  <g className="afp-cross" aria-hidden="true">
                    <line
                      x1={balX(balTip.n)}
                      x2={balX(balTip.n)}
                      y1={BAL_PAD.t}
                      y2={BAL_PAD.t + balH}
                    />
                    <circle className="afp-dot afp-dot--owed" cx={balX(balTip.n)} cy={balY(balTip.balance)} r="4" />
                    <circle className="afp-dot afp-dot--paid" cx={balX(balTip.n)} cy={balY(balTip.paid)} r="4" />
                  </g>
                )}
              </svg>
              {/* The tooltip hangs DOWN from near the top (--hang): this
                  chart's plot is short enough that one anchored above the
                  crosshair gets clipped by the scrollport. */}
              {balTip && (
                <div
                  className="afp-tip afp-tip--hang"
                  style={{
                    left: `${Math.min(88, Math.max(12, (balX(balTip.n) / VBW) * 100))}%`,
                    top: "6%",
                  }}
                >
                  <strong>{monthLong(balTip.key)}</strong>
                  <span>
                    {balTip.n === 0
                      ? "drive-away"
                      : `after ${balTip.n} payment${balTip.n === 1 ? "" : "s"}`}
                  </span>
                  <span className="afp-tip-row">
                    <i className="afp-tip-key afp-tip-key--base" />
                    {fmtMoney(balTip.balance)} still owed
                  </span>
                  <span className="afp-tip-row">
                    <i className="afp-tip-key afp-tip-key--car" />
                    {fmtMoney(balTip.paid)} paid in
                  </span>
                  <span>{fmtMoney(balTip.interest)} of it interest</span>
                </div>
              )}
            </div>
          </div>

          {/* Where every dollar goes: one bar, two segments, both labelled
              under their own end so nothing depends on matching a color. */}
          <p className="afp-split-h">
            Every dollar you'll hand over the counter
            {plan.cashDownCents > 0 && `, after the ${fmtMoney(plan.cashDownCents)} down`}
          </p>
          <svg
            viewBox="0 0 720 42"
            className="afp-split"
            role="img"
            aria-label={`${fmtMoney(plan.financedCents)} of loan versus ${fmtMoney(
              loan.totalInterest
            )} of interest`}
          >
            {(() => {
              const total = plan.financedCents + loan.totalInterest || 1;
              const w = (cents) => (cents / total) * 720;
              const pw = Math.max(0, w(plan.financedCents) - SEG_GAP);
              return (
                <>
                  <rect
                    className="afp-split-seg afp-split-seg--principal"
                    x="0"
                    y="2"
                    width={pw}
                    height="16"
                  />
                  <text className="afp-split-label" x="0" y="34">
                    {fmtMoney(plan.financedCents)} loan
                  </text>
                  {loan.totalInterest > 0 && (
                    <>
                      <path
                        className="afp-split-seg afp-split-seg--interest"
                        d={endRoundedBar(
                          w(plan.financedCents),
                          2,
                          Math.max(1, w(loan.totalInterest)),
                          16
                        )}
                      />
                      <text className="afp-split-label afp-split-label--end" x="720" y="34">
                        {fmtMoney(loan.totalInterest)} interest
                      </text>
                    </>
                  )}
                </>
              );
            })()}
          </svg>
        </div>
      )}

      {/* ---- the numbers (the charts' table twin) ---- */}
      <div className="afp-card">
        <button
          type="button"
          className="afp-btn"
          aria-expanded={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? "Hide the numbers" : "Show the numbers"}
        </button>

        {showTable && (
          <div className="afp-tables">
            <div className="afp-table-wrap">
              <table className="afp-table">
                <caption>Money out per month</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Existing</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Running</th>
                    <th scope="col">Total out</th>
                    <th scope="col">Income</th>
                    <th scope="col">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.bars.map((b) => (
                    <tr key={b.key} className={b.projected ? "is-projected" : ""}>
                      <th scope="row">
                        {b.key}
                        {b.projected ? " ·" : ""}
                      </th>
                      <td>{fmtMoney(b.base)}</td>
                      <td>{b.payment ? fmtMoney(b.payment) : "—"}</td>
                      <td>{b.running ? fmtMoney(b.running) : "—"}</td>
                      <td>{fmtMoney(b.total)}</td>
                      <td>{b.income ? fmtMoney(b.income) : "—"}</td>
                      <td className={b.income > 0 && b.income - b.total < 0 ? "is-bad" : ""}>
                        {b.income > 0
                          ? `${b.income - b.total < 0 ? "−" : ""}${fmtMoney(
                              Math.abs(b.income - b.total)
                            )}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="afp-table-note">
                · = projected. Existing spending after that point is your{" "}
                {baseline.monthCount}-month average, not a forecast of it.
              </p>
            </div>

            {loan.months > 0 && (
              <div className="afp-table-wrap">
                <table className="afp-table">
                  <caption>Payment schedule</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Month</th>
                      <th scope="col">Payment</th>
                      <th scope="col">Interest</th>
                      <th scope="col">Principal</th>
                      <th scope="col">Owed after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loan.rows.map((r) => (
                      <tr key={r.n}>
                        <th scope="row">{r.n}</th>
                        {/* Payment #1 lands IN the purchase month — the same
                            month the chart above starts charging for the car. */}
                        <td>{addMonths(plan.startMonth, r.n - 1)}</td>
                        <td>{fmtMoneyExact(r.payment)}</td>
                        <td>{fmtMoneyExact(r.interest)}</td>
                        <td>{fmtMoneyExact(r.principal)}</td>
                        <td>{fmtMoneyExact(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- compare saved scenarios ---- */}
      {plans.length > 1 && (
        <div className="afp-card">
          <h3 className="afp-h3">Side by side</h3>
          <div className="afp-table-wrap">
            <table className="afp-table">
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Price</th>
                  <th scope="col">Down</th>
                  <th scope="col">Term</th>
                  <th scope="col">Payment</th>
                  <th scope="col">All-in / mo</th>
                  <th scope="col">Interest</th>
                  <th scope="col">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map(({ row, derived: d }) => {
                  const v = verdict({
                    totalMonthlyCents: d.totalMonthlyCents,
                    limits,
                    leanestSurplus: baseline.leanest?.surplus ?? null,
                  });
                  const words = {
                    fits: "fits",
                    tight: "tight",
                    over: "over",
                    unknown: "—",
                  };
                  return (
                    <tr key={row.id} className={activeId === row.id ? "is-active" : ""}>
                      <th scope="row">
                        <button type="button" className="afp-link" onClick={() => selectPlan(row)}>
                          {row.label}
                        </button>
                      </th>
                      <td>{fmtMoney(row.price_cents)}</td>
                      <td>{fmtMoney(row.down_cents + row.trade_in_cents)}</td>
                      <td>{row.term_months} mo</td>
                      <td>{fmtMoneyExact(d.loan.payment)}</td>
                      <td>{fmtMoney(d.totalMonthlyCents)}</td>
                      <td>{fmtMoney(d.loan.totalInterest)}</td>
                      <td
                        className={
                          v.level === "fits" ? "is-good" : v.level === "unknown" ? "" : "is-bad"
                        }
                      >
                        {words[v.level]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AffordPanel;
