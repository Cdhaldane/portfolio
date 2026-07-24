import { useCallback, useEffect } from "react";
import SpendingDashboard from "./Dashboard/SpendingDashboard";
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

const months = [];
for (const [category, amounts] of Object.entries(CATS)) {
  amounts.forEach((cents, i) => {
    if (cents > 0) {
      months.push({
        month: MONTHS[i],
        category,
        spend_cents: cents,
        tx_count: Math.max(1, Math.round(cents / 4000)),
      });
    }
  });
}

const merchants = [];
MONTHS.forEach((month, i) => {
  merchants.push(
    { month, merchant_clean: "FRESHCO", spend_cents: 32000 + (i % 4) * 2500, tx_count: 4 },
    { month, merchant_clean: "AMZN MKTP CA", spend_cents: 9000 + (i % 3) * 900, tx_count: 3 },
    { month, merchant_clean: "MCDONALD'S", spend_cents: 5400 + (i % 5) * 700, tx_count: 3 },
    { month, merchant_clean: "AYLMER ESSO", spend_cents: 12000 + (i % 2) * 1400, tx_count: 2 }
  );
  if (i >= 9) {
    // Stable last-3-months charge — should trip the subscription detector.
    merchants.push({ month, merchant_clean: "CRUNCHYROLL", spend_cents: 1149, tx_count: 1 });
  }
  if (i === 11) {
    merchants.push(
      { month, merchant_clean: "OLYMPIA RESTAURANT", spend_cents: 24301, tx_count: 1 },
      { month, merchant_clean: "SHOPPERS DRUG MART", spend_cents: 13797, tx_count: 3 }
    );
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

const DevPreview = () => {
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

        <nav className="bud-tabs" aria-label="Budgetter sections">
          <button type="button" className="bud-tab is-active">Dashboard</button>
          <button type="button" className="bud-tab">Upload</button>
          <button type="button" className="bud-tab">Transactions</button>
          <button type="button" className="bud-tab">Monthly</button>
        </nav>

        <SpendingDashboard
          refreshToken={0}
          fetchJson={fetchJson}
          onMutate={() => {}}
          onOpenTransactions={() => {}}
        />
      </div>
    </div>
  );
};

export default DevPreview;
