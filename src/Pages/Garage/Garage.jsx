import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, UserButton } from "@clerk/clerk-react";
import { loadGarage, reanalyze } from "./api";
import { CARS, CAR_BY_KEY, todayLocal } from "./cars";
import { configChanges } from "./logs";
import { currentOdometer, kmPerDay, serviceStatus } from "./service";
import CarHero from "./parts/CarHero";
import LogList from "./parts/LogList";
import Uploader from "./parts/Uploader";
import LogDetail from "./parts/LogDetail";
import WorkLog from "./parts/WorkLog";
import ServicePlan from "./parts/ServicePlan";
import Trends from "./parts/Trends";
import "./Garage.css";

/*
 * /garage: datalogs, a work log and a service schedule for two cars.
 *
 * Owns the one piece of server state (every log summary plus the work log)
 * and derives the rest per car with pure functions (logs.js, service.js).
 * Car, tab and the open log live in the URL, so a phone's back button closes
 * a log and a link reopens exactly what was on screen.
 */
const TABS = [
  { key: "logs", label: "Logs" },
  { key: "work", label: "Work log" },
  { key: "service", label: "Service" },
  { key: "trends", label: "Trends" },
];
const TOAST_MS = 3200;

const Garage = () => {
  const { getToken } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [reanalysing, setReanalysing] = useState(false);

  const notify = useCallback((text, tone = "ok") => setToast({ text, tone, id: Date.now() }), []);

  const carKey = CAR_BY_KEY[params.get("car")] ? params.get("car") : CARS[0].key;
  const car = CAR_BY_KEY[carKey];
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "logs";
  const openId = Number(params.get("log")) || null;

  const go = useCallback(
    (changes, { push = false, state } = {}) => {
      const next = new URLSearchParams(params);
      Object.entries(changes).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
      setParams(next, { replace: !push, state });
    },
    [params, setParams]
  );

  const openLog = useCallback(
    (id) => go({ log: String(id) }, { push: true, state: { fromList: true } }),
    [go]
  );

  // A log opened from the list pushed a history entry; closing it steps back
  // so the phone's back button isn't left with a duplicate list entry. A log
  // reached any other way (a shared link) closes in place.
  const closeLog = useCallback(() => {
    if (location.state && location.state.fromList) navigate(-1);
    else go({ log: null });
  }, [location.state, navigate, go]);

  const refresh = useCallback(async () => {
    const result = await loadGarage(getToken);
    if (result.ok) {
      setData(result);
      setLoadError(null);
    } else {
      setLoadError(result.error);
      setData((prev) => prev || { logs: [], events: [], stale: 0 });
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const loading = data === null;
  const today = todayLocal();

  const derived = useMemo(() => {
    const logs = (data?.logs || []).filter((l) => l.car === carKey);
    const events = (data?.events || []).filter((e) => e.car === carKey);
    return {
      logs,
      events,
      changes: configChanges(data?.logs || []),
      statuses: serviceStatus(car.service, events, today),
      odo: currentOdometer(events),
      rate: kmPerDay(events),
    };
  }, [data, carKey, car, today]);

  const runReanalyze = useCallback(async () => {
    setReanalysing(true);
    let afterId = 0;
    let total = 0;
    let failed = 0;
    let error = null;
    for (;;) {
      const r = await reanalyze(getToken, afterId);
      if (!r.ok) {
        error = r.error;
        break;
      }
      total += r.updated;
      failed += r.failed;
      afterId = r.lastId;
      if (r.remaining === 0 || r.updated + r.failed === 0) break;
    }
    setReanalysing(false);
    const done = `Re-analysed ${total} log${total === 1 ? "" : "s"}.`;
    if (error) notify(total ? `${done} Then: ${error}` : error, "error");
    else if (failed) notify(`${done} ${failed} couldn't be read and kept their old results.`, "error");
    else if (total) notify(done);
    refresh();
  }, [getToken, refresh, notify]);

  const clearDraft = useCallback(() => setDraft(null), []);

  const logService = useCallback(
    (item) => {
      setDraft({
        kind: "service",
        label: item.label,
        services: [item.key],
        odometerKm: derived.odo ? derived.odo.km : "",
        n: Date.now(),
      });
      go({ tab: "work" });
    },
    [derived.odo, go]
  );

  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].key;
    go({ tab: next });
    document.getElementById(`gr-tab-${next}`)?.focus();
  };

  const counts = {
    logs: derived.logs.length,
    work: derived.events.length,
    service: derived.statuses.filter((s) => s.status === "overdue" || s.status === "soon").length,
    trends: null,
  };

  return (
    <div className="gr" data-car={carKey}>
      <div className="gr-backdrop" aria-hidden="true" />

      <header className="gr-top">
        <Link to="/" className="gr-home">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Site
        </Link>
        <div className="gr-switch" role="group" aria-label="Car">
          {CARS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`gr-switch-btn ${c.key === carKey ? "is-on" : ""}`}
              aria-pressed={c.key === carKey}
              data-car={c.key}
              onClick={() => go({ car: c.key, log: null })}
            >
              <span className="gr-switch-dot" aria-hidden="true" />
              {c.name}
            </button>
          ))}
        </div>
        <UserButton />
      </header>

      <CarHero
        key={carKey}
        car={car}
        logs={derived.logs}
        statuses={derived.statuses}
        odo={derived.odo}
        loading={loading}
        today={today}
      />

      {loadError && (
        <p className="gr-banner" role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {loadError}
          <button type="button" className="gr-link" onClick={refresh}>
            Retry
          </button>
        </p>
      )}

      {data && data.stale > 0 && (
        <p className="gr-banner gr-banner--info" role="status">
          <i className="fa-solid fa-rotate" aria-hidden="true" />
          {data.stale} log{data.stale === 1 ? " was" : "s were"} checked by an older version of the analysis.
          <button type="button" className="gr-link" onClick={runReanalyze} disabled={reanalysing}>
            {reanalysing ? "Re-analysing…" : "Re-analyse"}
          </button>
        </p>
      )}

      {openId && (
        <LogDetail
          key={openId}
          getToken={getToken}
          id={openId}
          changes={derived.changes.get(openId)}
          onBack={closeLog}
          onChanged={refresh}
          onDeleted={() => {
            notify("Log deleted.");
            closeLog();
            refresh();
          }}
        />
      )}
      {/* Kept mounted (hidden) under an open log, so staged uploads and form
          drafts survive a look at one log. */}
      <main className="gr-main" hidden={Boolean(openId)}>
        <div className="gr-tabs" role="tablist" aria-label="Garage sections" onKeyDown={onTabKey}>
          {TABS.map((t, i) => (
            <button
              key={t.key}
              id={`gr-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls="gr-panel"
              tabIndex={tab === t.key ? 0 : -1}
              className={`gr-tab ${tab === t.key ? "is-on" : ""}`}
              onClick={() => go({ tab: t.key })}
            >
              <span className="gr-tab-n">{String(i + 1).padStart(2, "0")}</span>
              {t.label}
              {counts[t.key] ? <span className="gr-tab-count">{counts[t.key]}</span> : null}
            </button>
          ))}
        </div>

        <section id="gr-panel" role="tabpanel" aria-labelledby={`gr-tab-${tab}`}>
          {/* Outside the keyed panel: switching tab or car must not throw
              away files that are staged or mid-check. */}
          <div hidden={tab !== "logs"}>
            <Uploader
              getToken={getToken}
              car={carKey}
              onSaved={(n) => {
                notify(`Saved ${n} log${n === 1 ? "" : "s"}.`);
                refresh();
              }}
            />
          </div>
          <div className="gr-panel" key={`${tab}-${carKey}`}>
            {tab === "logs" && (
              <LogList
                loading={loading}
                logs={derived.logs}
                changes={derived.changes}
                car={car}
                onOpen={openLog}
              />
            )}
            {tab === "work" && (
              <WorkLog
                getToken={getToken}
                car={car}
                events={derived.events}
                loading={loading}
                draft={draft}
                today={today}
                onDraftUsed={clearDraft}
                onChanged={refresh}
                onToast={notify}
              />
            )}
            {tab === "service" && (
              <ServicePlan
                getToken={getToken}
                car={car}
                statuses={derived.statuses}
                odo={derived.odo}
                rate={derived.rate}
                loading={loading}
                today={today}
                onLog={logService}
                onChanged={refresh}
                onToast={notify}
              />
            )}
            {tab === "trends" && (
              <Trends car={car} logs={derived.logs} events={derived.events} loading={loading} onOpen={openLog} />
            )}
          </div>
        </section>
      </main>

      {toast && (
        <p key={toast.id} className={`gr-toast ${toast.tone === "error" ? "gr-toast--error" : ""}`} role="status">
          <i
            className={`fa-solid ${toast.tone === "error" ? "fa-triangle-exclamation" : "fa-check"}`}
            aria-hidden="true"
          />{" "}
          {toast.text}
        </p>
      )}
    </div>
  );
};

export default Garage;
