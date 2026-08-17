import { useCallback, useEffect, useState } from "react";
import SpendingDashboard from "./Dashboard/SpendingDashboard";
import AffordPanel from "./Afford/AffordPanel";
import BudBackground from "./BudBackground";
import "./Budgetter.css";

/*
 * /budgetter-preview — DEVELOPMENT ONLY (the route is mounted behind a
 * NODE_ENV check in App.js, so this chunk never ships to production).
 *
 * Renders the real SpendingDashboard against rich mock data, outside the
 * Clerk gate and without a database, so the design can be reviewed and
 * screenshotted in both themes without signing in. Mock data only — no
 * real financial information.
 */

const MONTHS = [
  "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
  "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
];

// Seeded-ish variety without Math.random: amounts derived from indices.
const CATS = {
  Groceries: [52000, 61000, 58000, 63000, 71000, 54000, 56000, 60000, 62000, 59000, 64000, 61200],
  Dining: [21000, 26000, 31000, 24000, 38000, 19000, 22000, 27000, 25000, 30000, 33000, 46500],
  Shopping: [18000, 9000, 22000, 35000, 62000, 8000, 12000, 15000, 21000, 17000, 26000, 19800],
  Transport: [14000, 15500, 13000, 16000, 12000, 15000, 14500, 13800, 15200, 14100, 12600, 12561],
  Entertainment: [4000, 6500, 3000, 5500, 9000, 2500, 4800, 3900, 6100, 4400, 5200, 678],
  Health: [11000, 4000, 9000, 6000, 5000, 12000, 3000, 7500, 8200, 4600, 9100, 13797],
  Bills: [12677, 12677, 12677, 12677, 12677, 12677, 12677, 12677, 12677, 12677, 12677, 12677],
  uncategorized: [0, 0, 3000, 0, 8000, 0, 0, 2500, 0, 0, 4200, 31900],
};

// mine_* mock: "your" cards carry roughly 60% of the household's spending,
// varying by category index so the Mine/Household toggle visibly reshapes
// the chart in the preview.
const months = [];
Object.entries(CATS).forEach(([category, amounts], c) => {
  amounts.forEach((cents, i) => {
    if (cents > 0) {
      const tx = Math.max(1, Math.round(cents / 4000));
      const mineShare = [0.8, 0.55, 0.4, 0.7, 0.5, 0.65, 0.5, 0.6][c % 8];
      months.push({
        month: MONTHS[i],
        category,
        spend_cents: cents,
        tx_count: tx,
        mine_cents: Math.round(cents * mineShare),
        mine_tx_count: Math.max(1, Math.round(tx * mineShare)),
      });
    }
  });
});

const merchants = [];
// [merchant row..., mineShare] — 1 = all yours, 0 = all theirs.
const pushMerchant = (month, merchant_clean, spend_cents, tx_count, mineShare) =>
  merchants.push({
    month,
    merchant_clean,
    spend_cents,
    tx_count,
    mine_cents: Math.round(spend_cents * mineShare),
    mine_tx_count: Math.round(tx_count * mineShare),
  });
MONTHS.forEach((month, i) => {
  pushMerchant(month, "FRESHCO", 32000 + (i % 4) * 2500, 4, 0.5);
  pushMerchant(month, "AMZN MKTP CA", 9000 + (i % 3) * 900, 3, 1);
  pushMerchant(month, "MCDONALD'S", 5400 + (i % 5) * 700, 3, 0.67);
  pushMerchant(month, "AYLMER ESSO", 12000 + (i % 2) * 1400, 2, 0);
  if (i >= 9) {
    // Stable last-3-months charge — should trip the subscription detector
    // (yours, so it shows in both scopes).
    pushMerchant(month, "CRUNCHYROLL", 1149, 1, 1);
  }
  if (i === 11) {
    pushMerchant(month, "OLYMPIA RESTAURANT", 24301, 1, 1);
    pushMerchant(month, "SHOPPERS DRUG MART", 13797, 3, 0.33);
  }
});

const MOCK_SUMMARY = {
  configured: true,
  months,
  merchants,
  budgets: [
    { category: "Dining", monthly_cents: 40000 },
    { category: "Groceries", monthly_cents: 70000 },
    { category: "Shopping", monthly_cents: 25000 },
  ],
  recurring: [
    { id: 1, label: "Mortgage", category: "Housing", amount_cents: 185000, due_day: 1, start_month: "2025-08", end_month: null },
    { id: 2, label: "Car insurance", category: "Bills", amount_cents: 22000, due_day: 15, start_month: "2025-08", end_month: null },
    { id: 3, label: "Hydro", category: "Bills", amount_cents: 11850, due_day: 22, start_month: "2025-08", end_month: null },
    { id: 4, label: "Netflix", category: "Subscriptions", amount_cents: 2099, due_day: 8, start_month: "2026-01", end_month: null, on_card: true },
  ],
  income: [
    { id: 1, label: "Paycheque", amount_cents: 90000, cadence: "weekly", start_month: "2025-08", end_month: null },
    { id: 2, label: "Side projects", amount_cents: 25000, cadence: "monthly", start_month: "2025-08", end_month: null },
  ],
  accounts: [
    { id: 1, label: "Amex Gold", bank: "amex", last_tx_date: "2026-07-17", tx_count: 412 },
    { id: 2, label: "Triangle MC", bank: "triangle", last_tx_date: "2026-05-12", tx_count: 96 },
  ],
  uncategorizedCount: 7,
};

// Two saved scenarios so the Afford tab's compare table and the "tight vs
// fits" verdict states are both visible in a screenshot.
const MOCK_PLANS = [
  {
    id: 1,
    label: "Used RAV4",
    price_cents: 2800000,
    tax_bps: 1300,
    down_cents: 500000,
    trade_in_cents: 200000,
    apr_bps: 690,
    term_months: 60,
    insurance_cents: 15000,
    fuel_cents: 20000,
    maintenance_cents: 7500,
    start_month: "2026-09",
    created_at: "2026-07-20T12:00:00Z",
  },
  {
    id: 2,
    label: "New Civic",
    price_cents: 3400000,
    tax_bps: 1300,
    down_cents: 300000,
    trade_in_cents: 0,
    apr_bps: 499,
    term_months: 84,
    insurance_cents: 18000,
    fuel_cents: 16000,
    maintenance_cents: 5000,
    start_month: "2026-09",
    created_at: "2026-07-21T12:00:00Z",
  },
];

const DevPreview = () => {
  const [tab, setTab] = useState("dashboard");

  // ?theme=dark|light forces the theme — lets headless screenshot tooling
  // capture both modes without touching localStorage.
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("theme");
    if (forced === "dark" || forced === "light") {
      document.documentElement.setAttribute("data-theme", forced);
    }
  }, []);

  const fetchJson = useCallback(async (path) => {
    if (path.startsWith("/api/budget/summary")) {
      return { res: { ok: true, status: 200 }, data: MOCK_SUMMARY };
    }
    if (path.startsWith("/api/budget/plans")) {
      return { res: { ok: true, status: 200 }, data: { configured: true, plans: MOCK_PLANS } };
    }
    if (path.startsWith("/api/budget/transactions")) {
      // Drill-down mock: a handful of plausible charges for the requested
      // category/period.
      const params = new URLSearchParams(path.split("?")[1] || "");
      const category = params.get("category") || "uncategorized";
      const month = params.get("month") || "2026-07";
      const SAMPLES = {
        Groceries: [["FRESHCO", 6423], ["FRESHCO", 8817], ["COSTCO", 14290], ["FARM BOY", 3170]],
        Dining: [["MCDONALD'S", 1231], ["OSMOW'S", 2710], ["CORA", 5818], ["MOFER COFFEE", 1440]],
        Shopping: [["AMZN MKTP CA", 1819], ["WINNERS", 2823], ["DOLLARAMA", 424]],
        Bills: [["BELL CANADA", 8722], ["FREEDOM MOBILE", 3955]],
        uncategorized: [["OCEANPAYMENT*SHOP", 18780], ["HTSP-* PETERBOROUGH", 122], ["SP UNION KINGDOM", 13100]],
      };
      const rows = (SAMPLES[category] || [["SAMPLE CHARGE", 4200]]).map(([m, cents], i) => ({
        id: i + 1,
        posted_date: `${month}-${String(3 + i * 6).padStart(2, "0")}`,
        merchant_clean: m,
        amount_cents: cents,
        category,
        account_label: "Amex Gold",
        // Demo split/exclude states in the drill-down.
        count_pct: i === 1 ? 50 : i === 2 ? 0 : 100,
      }));
      return { res: { ok: true, status: 200 }, data: { configured: true, transactions: rows } };
    }
    // Mutations succeed as no-ops; the preview is stateless by design.
    return { res: { ok: true, status: 200 }, data: { ok: true } };
  }, []);

  return (
    <div className="bud">
      <BudBackground />
      <div className="bud-inner">
        <header className="bud-head">
          <p className="bud-kicker">Private / Budgetter · DESIGN PREVIEW (mock data)</p>
          <h1 className="bud-title">Spending, watched.</h1>
          <p className="bud-sub">
            Signed in as <strong>preview@localhost</strong>.
          </p>
        </header>

        {/* Only the two data-driven tabs are wired here — the rest are shown
            for layout fidelity. */}
        <nav className="bud-tabs" aria-label="Budgetter sections">
          <button
            type="button"
            className={`bud-tab ${tab === "dashboard" ? "is-active" : ""}`}
            onClick={() => setTab("dashboard")}
          >
            Dashboard
          </button>
          <button type="button" className="bud-tab">Upload</button>
          <button type="button" className="bud-tab">Transactions</button>
          <button type="button" className="bud-tab">Monthly</button>
          <button
            type="button"
            className={`bud-tab ${tab === "afford" ? "is-active" : ""}`}
            onClick={() => setTab("afford")}
          >
            Afford
          </button>
        </nav>

        {tab === "dashboard" ? (
          <SpendingDashboard
            refreshToken={0}
            fetchJson={fetchJson}
            onMutate={() => {}}
            onOpenTransactions={() => {}}
            shared
            youUserId="user_preview"
          />
        ) : (
          <AffordPanel refreshToken={0} fetchJson={fetchJson} onMutate={() => {}} />
        )}
      </div>
    </div>
  );
};

export default DevPreview;
