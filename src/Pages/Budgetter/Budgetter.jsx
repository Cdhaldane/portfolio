import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { budgetFetch } from "./api";
import SpendingDashboard from "./Dashboard/SpendingDashboard";
import UploadPanel from "./Upload/UploadPanel";
import TransactionsList from "./Transactions/TransactionsList";
import RecurringPanel from "./Recurring/RecurringPanel";
import IncomePanel from "./Recurring/IncomePanel";
import BudBackground from "./BudBackground";
import "./Budgetter.css";

/*
 * /budgetter — Dashboard · Upload · Transactions · Monthly.
 *
 * All tabs stay mounted (toggled via `hidden`) so each keeps its state when
 * you flip between them. Refresh wiring is intentionally BIdirectional:
 *   - an import bumps refreshToken (dashboard refetches) and refreshes the list
 *   - a category edit in the list bumps refreshToken (dashboard refetches)
 *   - a dashboard mutation (auto-categorize) refreshes the list
 *   - a Monthly-payments change bumps refreshToken (dashboard refetches)
 *
 * fetchJson wraps the Clerk token so SpendingDashboard never touches Clerk
 * hooks directly — the dev-only preview route renders it with a mock.
 */
const Budgetter = () => {
  const { getToken, signOut } = useAuth();
  const { user } = useUser();
  const [check, setCheck] = useState({ state: "checking" });
  const [tab, setTab] = useState("dashboard");
  const [refreshToken, setRefreshToken] = useState(0);
  const listRef = useRef(null);

  const fetchJson = useCallback(
    (path, options) => budgetFetch(getToken, path, options),
    [getToken]
  );

  const runCheck = useCallback(async () => {
    setCheck({ state: "checking" });
    const { res, data } = await fetchJson("/api/budget/me");
    if (!data) return setCheck({ state: "offline" });
    if (res.ok && data.ok) return setCheck({ state: "ok", userId: data.userId });
    if (res.status === 403) return setCheck({ state: "denied", userId: data.userId });
    if (res.status === 503) return setCheck({ state: "unconfigured" });
    return setCheck({ state: "unauthenticated" });
  }, [fetchJson]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const identity =
    user?.primaryEmailAddress?.emailAddress || user?.fullName || "you";

  const refreshDashboard = () => setRefreshToken((t) => t + 1);

  const onImported = () => {
    listRef.current?.refresh();
    refreshDashboard();
    setTab("dashboard");
  };

  return (
    <div className="bud">
      <BudBackground />
      <div className="bud-inner">
        <header className="bud-head">
          <p className="bud-kicker">Private / Budgetter</p>
          <h1 className="bud-title">Spending, watched.</h1>
          <p className="bud-sub">
            Signed in as <strong>{identity}</strong>.
          </p>
        </header>

        <section
          className={`bud-status bud-status--${check.state} ${
            check.state === "ok" ? "bud-status--compact" : ""
          }`}
          aria-live="polite"
        >
          <span className="bud-status-dot" aria-hidden="true" />
          {check.state === "checking" && <p>Verifying the API link…</p>}
          {check.state === "ok" && <p>Connected</p>}
          {check.state === "denied" && (
            <p>
              Signed in, but not on the allowlist. Add{" "}
              <code>{check.userId}</code> to{" "}
              <code>BUDGET_ALLOWED_USER_IDS</code> and try again.
            </p>
          )}
          {check.state === "unconfigured" && (
            <p>
              The server is missing <code>CLERK_SECRET_KEY</code> — set it in{" "}
              <code>.env.local</code> (and the Vercel dashboard for prod).
            </p>
          )}
          {check.state === "unauthenticated" && (
            <p>The API rejected the session — try signing out and back in.</p>
          )}
          {check.state === "offline" && (
            <p>
              API not reachable. Locally, run <code>vercel dev</code> so the
              functions are served alongside the app.
            </p>
          )}
          {check.state !== "checking" && check.state !== "ok" && (
            <button type="button" className="bud-retry" onClick={runCheck}>
              Retry
            </button>
          )}
        </section>

        <nav className="bud-tabs" aria-label="Budgetter sections">
          {[
            ["dashboard", "Dashboard"],
            ["upload", "Upload"],
            ["transactions", "Transactions"],
            ["monthly", "Monthly"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`bud-tab ${tab === key ? "is-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div hidden={tab !== "dashboard"}>
          <SpendingDashboard
            refreshToken={refreshToken}
            fetchJson={fetchJson}
            onMutate={() => listRef.current?.refresh()}
            onOpenTransactions={(category) => {
              listRef.current?.setFilters({ category });
              setTab("transactions");
            }}
            onOpenUpload={() => setTab("upload")}
          />
        </div>
        <div hidden={tab !== "upload"}>
          <UploadPanel onImported={onImported} />
        </div>
        <div hidden={tab !== "transactions"}>
          <TransactionsList ref={listRef} onMutate={refreshDashboard} />
        </div>
        <div hidden={tab !== "monthly"} className="bud-monthly">
          <IncomePanel onMutate={refreshDashboard} />
          <RecurringPanel onMutate={refreshDashboard} />
        </div>

        <button type="button" className="bud-signout" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
};

export default Budgetter;
