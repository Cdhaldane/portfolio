import Reveal from "../../../Components/Reveal/Reveal";
import { HEURISTICS_CAVEAT } from "../cars";
import { fmtDate, fmtDuration } from "../format";
import { formatMetric, metricLevel } from "../logs";
import Level from "./Level";

/*
 * One car's logs, newest first. Each row opens the log. The three numbers
 * that trend (peak charge air, max knock, mean LTFT) wear their watch/warn
 * colour, and a log whose tune or firmware differs from the one before it
 * says so, since a new map changes what "normal" looks like.
 */
const Metric = ({ k, value }) => {
  const level = metricLevel(k, value);
  return (
    <span className={`gr-metric ${level ? `gr-metric--${level}` : ""}`}>{formatMetric(k, value)}</span>
  );
};

const LogList = ({ loading, logs, changes, car, onOpen }) => {
  if (loading) {
    return (
      <div className="gr-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="gr-row gr-row--ghost" />
        ))}
      </div>
    );
  }

  if (!logs.length) {
    return (
      <div className="gr-empty">
        <i className="fa-solid fa-chart-line" aria-hidden="true" />
        <h2>No logs for the {car.name} yet.</h2>
        <p>
          {car.key === "golf"
            ? "Pull datalogs off the Accessport (Accessport Manager, Filter → Datalogs) and drop the CSVs above."
            : "AndrOBD logs aren't supported yet. The Cayenne's work log and service schedule work now."}
        </p>
      </div>
    );
  }

  return (
    <section className="gr-logs" aria-labelledby="gr-logs-title">
      {/* Only the head reveals: a list several screens tall can never reach
          the observer's 15% threshold, so wrapping it would leave it hidden. */}
      <Reveal className="gr-section-head">
        <h2 id="gr-logs-title" className="gr-h2">
          {logs.length} log{logs.length === 1 ? "" : "s"}
        </h2>
        <p className="gr-caveat">{HEURISTICS_CAVEAT}</p>
      </Reveal>
      <div className="gr-list-head" aria-hidden="true">
        <span>Date</span>
        <span>Log</span>
        <span>Length</span>
        <span>Status</span>
        <span>Peak CAT</span>
        <span>Max knock</span>
        <span>LTFT</span>
        <span>Pulls</span>
      </div>
      <ul className="gr-list">
        {logs.map((log) => {
          const change = changes.get(log.id);
          return (
            <li key={log.id}>
              <button type="button" className="gr-row" onClick={() => onOpen(log.id)}>
                <span className="gr-row-date">
                  {fmtDate(log.recordedOn, { month: "short", day: "numeric" })}
                  <small>{log.recordedOn.slice(0, 4)}</small>
                </span>
                <span className="gr-row-name">
                  {log.filename}
                  {change && (
                    <span className="gr-chip gr-chip--tune" title={change.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("\n")}>
                      <i className="fa-solid fa-microchip" aria-hidden="true" /> New {change.map((c) => c.label).join(" + ")}
                    </span>
                  )}
                  {log.note && <small className="gr-row-note">{log.note}</small>}
                </span>
                <span className="gr-row-len">{fmtDuration(log.durationS)}</span>
                <span className="gr-row-status">
                  <Level level={log.worstLevel} />
                </span>
                <span className="gr-row-m" data-label="Peak CAT">
                  <Metric k="catMaxC" value={log.catMaxC} />
                </span>
                <span className="gr-row-m" data-label="Max knock">
                  <Metric k="knockMaxDeg" value={log.knockMaxDeg} />
                </span>
                <span className="gr-row-m" data-label="LTFT">
                  <Metric k="ltftMeanPct" value={log.ltftMeanPct} />
                </span>
                <span className="gr-row-m" data-label="Pulls">
                  <span className="gr-metric">{log.pullCount}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default LogList;
