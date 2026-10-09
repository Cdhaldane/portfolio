import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteLog, editLog, loadLog } from "../api";
import { CARS, CAR_BY_KEY, HEURISTICS_CAVEAT, todayLocal } from "../cars";
import { DEFAULT_PRESET, MAX_LANES, presetCols, presetsFor } from "../channelPresets";
import { fmtClock, fmtDate, fmtDuration, fmtNum } from "../format";
import Level from "./Level";
import ChannelChart from "./ChannelChart";
import EngineInsights from "./EngineInsights";

/*
 * One log: what it is (date, car, maps), what the analysis found, which
 * checks could run and why the others couldn't, the full-load pulls, and the
 * channels on a time axis. Opens on the health-check preset (one lane per
 * automated check); the other presets each frame one system.
 */
const FINDING_ORDER = { warn: 0, watch: 1, info: 2, ok: 3 };
const STATUS_TEXT = { idle: "Idle", missing: "Missing" };

const LogDetail = ({ getToken, id, changes, onBack, onChanged, onDeleted }) => {
  const [state, setState] = useState({ status: "loading" });
  const [view, setView] = useState({ cols: DEFAULT_PRESET.lanes, t0: null, t1: null });
  const [chartBusy, setChartBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await loadLog(getToken, id, { cols: DEFAULT_PRESET.lanes });
      if (!live) return;
      if (!r.ok) {
        setState({ status: "error", error: r.error });
        return;
      }
      let cols = presetCols(DEFAULT_PRESET, r.channels);
      if (!cols.length) cols = r.channels.filter((c) => c.hasData).map((c) => c.key).slice(0, 4);
      let series = r.series;
      // Spares or the fallback weren't in the first request; fetch what will actually show.
      if (cols.some((c) => !DEFAULT_PRESET.lanes.includes(c))) {
        const more = await loadLog(getToken, id, { cols });
        if (!live) return;
        series = more.ok ? more.series : null;
      }
      setView({ cols, t0: null, t1: null });
      setState({ status: "ready", log: r.log, channels: r.channels, checks: r.checks, series });
    })();
    return () => {
      live = false;
    };
  }, [getToken, id]);

  const request = useCallback(
    async (next) => {
      setView(next);
      if (!next.cols.length) return;
      const mine = ++reqId.current;
      setChartBusy(true);
      const r = await loadLog(getToken, id, next);
      if (mine !== reqId.current) return;
      setChartBusy(false);
      if (r.ok) setState((s) => ({ ...s, series: r.series }));
      else setError(r.error);
    },
    [getToken, id]
  );

  const presets = useMemo(() => (state.channels ? presetsFor(state.channels) : []), [state.channels]);

  if (state.status === "loading") {
    return (
      <main className="gr-main gr-detail" aria-busy="true">
        <button type="button" className="gr-back" onClick={onBack}>
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> All logs
        </button>
        <div className="gr-row gr-row--ghost gr-row--tall" />
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="gr-main gr-detail">
        <button type="button" className="gr-back" onClick={onBack}>
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> All logs
        </button>
        <p className="gr-banner" role="alert">
          {state.error}
        </p>
      </main>
    );
  }

  const { log, channels, checks, series } = state;
  const s = log.summary;
  const engineOff = s.checks.every((c) => c.status === "idle" && c.detail === "Engine not running.");
  const findings = [...s.findings].sort((a, b) => FINDING_ORDER[a.level] - FINDING_ORDER[b.level]);
  const requires = Object.fromEntries((checks || []).map((c) => [c.name, c.requires]));
  const rate = log.durationS > 0 ? log.samples / log.durationS : null;

  const saveEdit = async () => {
    setSaving(true);
    setError(null);
    const r = await editLog(getToken, {
      id: log.id,
      car: editing.car,
      recordedOn: editing.recordedOn,
      note: editing.note,
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState((st) => ({ ...st, log: { ...st.log, ...r.log, summary: st.log.summary } }));
    setEditing(null);
    onChanged();
  };

  const remove = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const r = await deleteLog(getToken, log.id);
    if (r.ok) onDeleted();
    else {
      setConfirming(false);
      setError(r.error);
    }
  };

  return (
    <main className="gr-main gr-detail">
      <button type="button" className="gr-back" onClick={onBack}>
        <i className="fa-solid fa-arrow-left" aria-hidden="true" /> All logs
      </button>

      <header className="gr-detail-head">
        <div>
          <p className="gr-kicker">
            {CAR_BY_KEY[log.car].name} · {log.source === "cobb" ? "Accessport" : "mqbtel"} log
          </p>
          <h2 className="gr-detail-title">
            {fmtDate(log.recordedOn, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
          </h2>
          <p className="gr-detail-file">{log.filename}</p>
        </div>
        <div className="gr-detail-actions">
          {!editing && (
            <button
              type="button"
              className="gr-btn gr-btn--ghost"
              onClick={() => setEditing({ car: log.car, recordedOn: log.recordedOn, note: log.note || "" })}
            >
              <i className="fa-solid fa-pen" aria-hidden="true" /> Edit
            </button>
          )}
          <button type="button" className={`gr-btn gr-btn--ghost ${confirming ? "is-danger" : ""}`} onClick={remove}>
            <i className="fa-solid fa-trash" aria-hidden="true" /> {confirming ? "Tap again to delete" : "Delete"}
          </button>
        </div>
      </header>

      {editing && (
        <form
          className="gr-card gr-form gr-form--inline"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <label className="gr-field">
            <span>Recorded on</span>
            <input
              type="date"
              required
              max={todayLocal()}
              value={editing.recordedOn}
              onChange={(e) => setEditing({ ...editing, recordedOn: e.target.value })}
            />
          </label>
          <label className="gr-field">
            <span>Car</span>
            <select value={editing.car} onChange={(e) => setEditing({ ...editing, car: e.target.value })}>
              {CARS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="gr-field gr-field--wide">
            <span>Note</span>
            <input
              type="text"
              maxLength={300}
              placeholder="Cold start, highway, 93 octane…"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="gr-form-actions">
            <button type="submit" className="gr-btn gr-btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="gr-link" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="gr-banner" role="alert">
          {error}
        </p>
      )}

      <dl className="gr-facts">
        <div>
          <dt>Length</dt>
          <dd>{fmtDuration(log.durationS)}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>
            {fmtNum(log.samples)}
            {rate ? <small> · {rate.toFixed(1)} Hz</small> : null}
          </dd>
        </div>
        {log.ecuMap && (
          <div className="gr-facts-wide">
            <dt>ECU map</dt>
            <dd>{log.ecuMap.replace(/\.ptm$/i, "")}</dd>
          </div>
        )}
        {log.tcmMap && (
          <div className="gr-facts-wide">
            <dt>TCM map</dt>
            <dd>{log.tcmMap.replace(/\.ptm$/i, "")}</dd>
          </div>
        )}
        {log.apFirmware && (
          <div>
            <dt>AP firmware</dt>
            <dd>{log.apFirmware}</dd>
          </div>
        )}
        {log.note && (
          <div className="gr-facts-wide">
            <dt>Note</dt>
            <dd>{log.note}</dd>
          </div>
        )}
      </dl>

      {changes && (
        <p className="gr-banner gr-banner--info">
          <i className="fa-solid fa-microchip" aria-hidden="true" />
          First log on a new {changes.map((c) => c.label).join(" and ")}:{" "}
          {changes.map((c) => `${c.from.replace(/\.ptm$/i, "")} → ${c.to.replace(/\.ptm$/i, "")}`).join("; ")}.
        </p>
      )}

      <section className="gr-findings" aria-labelledby="gr-findings-title">
        <div className="gr-section-head">
          <h2 id="gr-findings-title" className="gr-h2">
            Findings
          </h2>
          <p className="gr-caveat">{HEURISTICS_CAVEAT}</p>
        </div>
        {engineOff ? (
          <p className="gr-empty-line">
            <i className="fa-solid fa-power-off" aria-hidden="true" /> The engine wasn't running in this log (ignition on
            only), so there was nothing to check.
          </p>
        ) : (
          <ul className="gr-finding-list">
            {findings.map((f, i) => (
              <li key={i} className={`gr-finding gr-finding--${f.level}`}>
                <Level level={f.level} />
                <p>{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!engineOff && (
        <section className="gr-checks" aria-labelledby="gr-checks-title">
          <h2 id="gr-checks-title" className="gr-h3">
            Every check
          </h2>
          <ul className="gr-check-grid">
            {s.checks.map((c) => (
              <li key={c.name} className={`gr-check is-${c.status}`}>
                <div className="gr-check-top">
                  <span className="gr-check-name">{c.label}</span>
                  {c.status === "ran" ? (
                    <Level level={c.level || "ok"} />
                  ) : (
                    <span className="gr-check-status">{STATUS_TEXT[c.status]}</span>
                  )}
                </div>
                <p className="gr-check-detail">{c.detail}</p>
                {c.status !== "ran" && requires[c.name] && <p className="gr-check-needs">Needs: {requires[c.name]}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.pulls.length > 0 && (
        <section className="gr-pulls" aria-labelledby="gr-pulls-title">
          <h2 id="gr-pulls-title" className="gr-h3">
            Full-load pulls
          </h2>
          <div className="gr-table-wrap" data-lenis-prevent>
            <table className="gr-table">
              <thead>
                <tr>
                  <th scope="col">Pull</th>
                  <th scope="col">Time</th>
                  <th scope="col">RPM</th>
                  <th scope="col">Gear</th>
                  <th scope="col">Peak boost</th>
                  <th scope="col">Peak torque</th>
                  <th scope="col">Max knock</th>
                  <th scope="col">Charge air</th>
                  <th scope="col">
                    <span className="sr-only">Zoom</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.pulls.map((p, i) => (
                  <tr key={p.start_s}>
                    <th scope="row">{i + 1}</th>
                    <td>
                      {fmtClock(p.start_s)}–{fmtClock(p.end_s)} <small>{(p.end_s - p.start_s).toFixed(1)} s</small>
                    </td>
                    <td>
                      {fmtNum(p.rpm_start)}→{fmtNum(p.rpm_end)}
                    </td>
                    <td>{p.gear ?? "–"}</td>
                    <td>{p.peak_boost_psi === null ? "–" : `${p.peak_boost_psi.toFixed(1)} psi`}</td>
                    <td>{p.peak_torque_ftlb === null ? "–" : `${fmtNum(p.peak_torque_ftlb)} ft-lb`}</td>
                    <td>{p.max_knock_deg === null ? "–" : `${p.max_knock_deg.toFixed(2)}°`}</td>
                    <td>
                      {p.cat_start_c === null ? "–" : `${fmtNum(p.cat_start_c)}→${fmtNum(p.cat_end_c)} °C`}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="gr-link"
                        onClick={() => request({ ...view, t0: Math.max(0, p.start_s - 2), t1: p.end_s + 2 })}
                      >
                        Zoom
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!engineOff && <EngineInsights summary={s} />}

      <ChannelChart
        channels={channels}
        data={series}
        cols={view.cols}
        presets={presets}
        pulls={s.pulls}
        zoomed={view.t0 !== null || view.t1 !== null}
        loading={chartBusy}
        maxLanes={MAX_LANES}
        onCols={(cols) => request({ ...view, cols })}
        onZoom={(t0, t1) => request({ ...view, t0, t1 })}
        onReset={() => request({ ...view, t0: null, t1: null })}
      />
    </main>
  );
};

export default LogDetail;
