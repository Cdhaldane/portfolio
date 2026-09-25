import { useState } from "react";
import { deleteSeries } from "../api";
import { BOWLERS, formatNight } from "../bowlers";
import { seriesTotal } from "../stats";
import { ballRuns, gamesLabel } from "../balls";

/*
 * Every league night as a little paper score sheet, newest first. Edit
 * reloads the night into the entry form; delete is a two-tap confirm.
 * Tagged nights list the ball(s) each bowler threw under the scores.
 */
const PAGE = 6;

const BallLine = ({ night, ballsById }) => {
  const lines = BOWLERS.map((b) => ({
    ...b,
    runs: night.rows[b.key] ? ballRuns(night.rows[b.key], ballsById) : [],
  })).filter((l) => l.runs.length);
  if (!lines.length) return null;
  return (
    <ul className="bw-night-balls">
      {lines.map(({ key, short, runs }) => (
        <li key={key}>
          <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" />
          <span className="sr-only">{short}:</span>
          {runs.map(({ ball, games }) => (
            <span key={ball.id} className="bw-night-ball">
              <span className="bw-dot" style={{ "--ball": ball.color }} aria-hidden="true" />
              {ball.name}
              {gamesLabel(games) && <small>{gamesLabel(games)}</small>}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
};

const NightSheet = ({ night, ballsById, getToken, onEdit, onWrap, onDeleted }) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const present = BOWLERS.map((b) => night.rows[b.key]).filter(Boolean);
  const fromPhoto = present.some((r) => r.source === "photo");
  const note = present.find((r) => r.note)?.note;

  async function remove() {
    setBusy(true);
    setError(null);
    // One night can be two rows; delete each, then refresh once.
    const results = await Promise.all(present.map((r) => deleteSeries(getToken, r.id)));
    setBusy(false);
    const failed = results.find((r) => !r.ok);
    if (failed) {
      setError(failed.error);
      setConfirming(false);
    }
    onDeleted();
  }

  return (
    <li className="bw-night">
      <header className="bw-night-head">
        <time dateTime={night.date}>
          {formatNight(night.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </time>
        <span className="bw-night-src" title={fromPhoto ? "Read from a photo" : "Typed in"}>
          <i className={`fa-solid ${fromPhoto ? "fa-camera" : "fa-keyboard"}`} aria-hidden="true" />
          <span className="sr-only">{fromPhoto ? "Read from a photo" : "Typed in"}</span>
        </span>
      </header>
      <table className="bw-night-table">
        <tbody>
          {BOWLERS.map((b) => {
            const row = night.rows[b.key];
            return (
              <tr key={b.key}>
                <th scope="row">
                  <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" /> {b.short}
                </th>
                {[0, 1, 2].map((i) => (
                  <td key={i}>{row ? row.games[i] : "-"}</td>
                ))}
                <td className="bw-night-total">{row ? seriesTotal(row) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <BallLine night={night} ballsById={ballsById} />
      {note && <p className="bw-night-note">{note}</p>}
      {error && (
        <p className="bw-error" role="alert">
          {error}
        </p>
      )}
      <div className="bw-night-actions">
        <button type="button" className="bw-link" onClick={() => onWrap(night.date)}>
          <i className="fa-solid fa-image" aria-hidden="true" /> Wrap card
        </button>
        <button type="button" className="bw-link" onClick={() => onEdit(night)}>
          <i className="fa-solid fa-pen" aria-hidden="true" /> Edit
        </button>
        {confirming ? (
          <>
            <button type="button" className="bw-link bw-link--danger" disabled={busy} onClick={remove}>
              {busy ? "Deleting" : "Yes, delete"}
            </button>
            <button type="button" className="bw-link" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="bw-link" onClick={() => setConfirming(true)}>
            <i className="fa-solid fa-trash-can" aria-hidden="true" /> Delete
          </button>
        )}
      </div>
    </li>
  );
};

const History = ({ nights, ballsById, getToken, onEdit, onWrap, onDeleted }) => {
  const [showAll, setShowAll] = useState(false);
  if (!nights.length) return null;
  const visible = showAll ? nights : nights.slice(0, PAGE);

  return (
    <section className="bw-history" aria-labelledby="bw-history-title">
      <h2 id="bw-history-title" className="bw-h2">
        Score sheets
      </h2>
      <ul className="bw-nights">
        {visible.map((n) => (
          <NightSheet
            key={n.date}
            night={n}
            ballsById={ballsById}
            getToken={getToken}
            onEdit={onEdit}
            onWrap={onWrap}
            onDeleted={onDeleted}
          />
        ))}
      </ul>
      {nights.length > PAGE && (
        <button type="button" className="bw-btn bw-btn--ghost" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show recent only" : `Show all ${nights.length} nights`}
        </button>
      )}
    </section>
  );
};

export default History;
