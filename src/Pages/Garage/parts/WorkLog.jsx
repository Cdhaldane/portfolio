import { useEffect, useMemo, useRef, useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { deleteEvent } from "../api";
import { KINDS, KIND_BY_KEY } from "../cars";
import { fmtDate, fmtKm, fmtMoney } from "../format";
import { spending } from "../service";
import EntryForm, { toForm } from "./EntryForm";

/*
 * Everything done to one car: services, repairs, mods, inspections and bare
 * odometer readings, newest first and grouped by year. Up top, what it has
 * cost and the build sheet (every mod, oldest first: what's on the car now).
 * Exports as CSV, which is the service history a buyer asks for.
 */
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(car, events, serviceLabels) {
  const head = ["Date", "Car", "Kind", "What", "Odometer (km)", "Cost (CAD)", "Done by", "Parts", "Counts as", "Notes"];
  const rows = events.map((e) => [
    e.happenedOn,
    `${car.year} ${car.make} ${car.name}`,
    KIND_BY_KEY[e.kind].label,
    e.label,
    e.odometerKm ?? "",
    e.costCents === null ? "" : (e.costCents / 100).toFixed(2),
    e.doneBy,
    e.parts,
    e.services.map((k) => serviceLabels[k] || k).join("; "),
    e.note,
  ]);
  const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${car.name.toLowerCase().replace(/\s+/g, "-")}-work-log-${new Date().toLocaleDateString("en-CA")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same tick can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WorkLog = ({ getToken, car, events, loading, draft, today, onDraftUsed, onChanged, onToast }) => {
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("all");
  const [confirming, setConfirming] = useState(null);
  const [error, setError] = useState(null);
  const formRef = useRef(null);

  // A "Log it" from the Service tab arrives as a draft: open the form with it.
  useEffect(() => {
    if (!draft) return;
    setForm({ key: draft.n, initial: draft });
    onDraftUsed();
  }, [draft, onDraftUsed]);

  useEffect(() => {
    if (form) formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [form]);

  const serviceLabels = useMemo(
    () => Object.fromEntries(car.service.map((s) => [s.key, s.label])),
    [car]
  );
  const shops = useMemo(
    () => ["DIY", ...new Set(events.map((e) => e.doneBy).filter((s) => s && s !== "DIY"))],
    [events]
  );
  const year = Number(today.slice(0, 4));
  const spent = useMemo(() => spending(events, year), [events, year]);
  const mods = useMemo(() => events.filter((e) => e.kind === "mod").reverse(), [events]);
  const kindsPresent = KINDS.filter((k) => events.some((e) => e.kind === k.key));
  // A filter whose last entry was just deleted (or re-kinded) falls back to
  // all, so the list never goes blank with its chips hidden.
  const active = kindsPresent.length > 1 && kindsPresent.some((k) => k.key === filter) ? filter : "all";
  const shown = active === "all" ? events : events.filter((e) => e.kind === active);
  const byYear = shown.reduce((acc, e) => {
    const y = e.happenedOn.slice(0, 4);
    (acc[y] = acc[y] || []).push(e);
    return acc;
  }, {});
  const lastService = events.find((e) => e.kind === "service");

  const remove = async (id) => {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    const r = await deleteEvent(getToken, id);
    if (r.ok) {
      onToast("Entry deleted.");
      onChanged();
    } else setError(r.error);
  };

  return (
    <div className="gr-work">
      <div className="gr-stats">
        <div className="gr-stat">
          <span className="gr-stat-label">Spent in {year}</span>
          <span className="gr-stat-value">{fmtMoney(spent.inYear)}</span>
        </div>
        <div className="gr-stat">
          <span className="gr-stat-label">All time</span>
          <span className="gr-stat-value">{fmtMoney(spent.all)}</span>
        </div>
        <div className="gr-stat">
          <span className="gr-stat-label">Entries</span>
          <span className="gr-stat-value">{events.length}</span>
        </div>
        <div className="gr-stat">
          <span className="gr-stat-label">Last service</span>
          <span className="gr-stat-value gr-stat-value--text">
            {lastService ? fmtDate(lastService.happenedOn, { month: "short", day: "numeric" }) : "–"}
            {lastService && <small>{lastService.label}</small>}
          </span>
        </div>
      </div>

      <div className="gr-work-bar">
        {!form && (
          <button type="button" className="gr-btn gr-btn--primary" onClick={() => setForm({ key: Date.now(), initial: {} })}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add an entry
          </button>
        )}
        {events.length > 0 && (
          <button type="button" className="gr-btn gr-btn--ghost" onClick={() => exportCsv(car, events, serviceLabels)}>
            <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export CSV
          </button>
        )}
      </div>

      {form && (
        <div ref={formRef}>
          <EntryForm
            key={form.key}
            getToken={getToken}
            car={car}
            initial={form.initial}
            today={today}
            shops={shops}
            onCancel={() => setForm(null)}
            onSaved={() => {
              onToast(form.initial.id ? "Entry updated." : "Added to the work log.");
              setForm(null);
              onChanged();
            }}
          />
        </div>
      )}

      {error && (
        <p className="gr-banner" role="alert">
          {error}
        </p>
      )}

      {mods.length > 0 && (
        <Reveal as="section" className="gr-card gr-build" aria-labelledby="gr-build-title">
          <h2 id="gr-build-title" className="gr-h3">
            Build sheet
          </h2>
          <ol className="gr-build-list">
            {mods.map((m) => (
              <li key={m.id}>
                <span className="gr-build-date">{fmtDate(m.happenedOn, { month: "short", year: "numeric" })}</span>
                <span>{m.label}</span>
                {m.parts && <small>{m.parts}</small>}
              </li>
            ))}
          </ol>
        </Reveal>
      )}

      {kindsPresent.length > 1 && (
        <div className="gr-filters" role="group" aria-label="Show">
          {[{ key: "all", label: "All" }, ...kindsPresent].map((k) => (
            <button
              key={k.key}
              type="button"
              className={`gr-chip gr-chip--btn ${active === k.key ? "is-on" : ""}`}
              aria-pressed={active === k.key}
              onClick={() => setFilter(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="gr-row gr-row--ghost gr-row--tall" aria-busy="true" />
      ) : events.length === 0 ? (
        <div className="gr-empty">
          <i className="fa-solid fa-screwdriver-wrench" aria-hidden="true" />
          <h2>Nothing logged for the {car.name} yet.</h2>
          <p>
            Start with the last oil change and today's odometer reading. Services, repairs and mods all land here, and
            the Service tab counts down from them.
          </p>
        </div>
      ) : (
        Object.entries(byYear)
          .sort((a, b) => b[0] - a[0])
          .map(([y, list]) => (
            <section key={y} className="gr-year" aria-label={y}>
              <h3 className="gr-year-head">
                {y}
                <span>{fmtMoney(list.reduce((a, e) => a + (e.costCents || 0), 0))}</span>
              </h3>
              <ol className="gr-timeline">
                {list.map((e) => {
                  const kind = KIND_BY_KEY[e.kind];
                  return (
                    <li key={e.id} className={`gr-entry gr-entry--${e.kind}`}>
                      <span className="gr-entry-date">
                        {fmtDate(e.happenedOn, { month: "short", day: "numeric" })}
                      </span>
                      <span className="gr-entry-dot" aria-hidden="true">
                        <i className={`fa-solid ${kind.icon}`} />
                      </span>
                      <div className="gr-entry-body">
                        <p className="gr-entry-title">
                          {e.kind === "reading" ? `Odometer ${fmtKm(e.odometerKm)}` : e.label}
                          <span className="gr-entry-kind">{kind.label}</span>
                        </p>
                        {e.kind !== "reading" && (e.odometerKm !== null || e.costCents !== null || e.doneBy) && (
                          <p className="gr-entry-meta">
                            {[
                              e.odometerKm !== null && fmtKm(e.odometerKm),
                              e.costCents !== null && fmtMoney(e.costCents),
                              e.doneBy,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {e.parts && <p className="gr-entry-parts">{e.parts}</p>}
                        {e.services.length > 0 && (
                          <p className="gr-entry-services">
                            {e.services.map((k) => (
                              <span key={k} className="gr-chip">
                                {serviceLabels[k] || k}
                              </span>
                            ))}
                          </p>
                        )}
                        {e.note && <p className="gr-entry-note">{e.note}</p>}
                        <p className="gr-entry-actions">
                          <button type="button" className="gr-link" onClick={() => setForm({ key: Date.now(), initial: toForm(e) })}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`gr-link ${confirming === e.id ? "is-danger" : ""}`}
                            onClick={() => remove(e.id)}
                          >
                            {confirming === e.id ? "Tap again to delete" : "Delete"}
                          </button>
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
      )}
    </div>
  );
};

export default WorkLog;
