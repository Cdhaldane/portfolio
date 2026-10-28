import { useState } from "react";
import { Link } from "react-router-dom";
import { deleteSeries } from "../api";
import { BOWLERS, formatNight } from "../bowlers";
import { seriesTotal } from "../stats";
import { ballRuns, gamesLabel } from "../balls";
import { framedGames, framesOf, nightFrameStats } from "../frameStats";
import Scorecard from "./Scorecard";

/*
 * Every league night as a little paper score sheet, newest first. Edit
 * reloads the night into the entry form; delete is a two-tap confirm.
 * Tagged nights list the ball(s) each bowler threw under the scores, and
 * nights scored frame by frame open up (full width) into their cards.
 */
const PAGE = 6;

const SOURCES = {
  lane: ["fa-bowling-ball", "Scored ball by ball"],
  photo: ["fa-camera", "Read from a photo"],
  manual: ["fa-keyboard", "Typed in"],
};

const pct = (r) => (r.pct === null ? "-" : `${Math.round(r.pct)}%`);

const NightFrames = ({ night }) => (
  <div className="bw-night-frames">
    {BOWLERS.map((b) => {
      const row = night.rows[b.key];
      if (!row || !framedGames(row).length) return null;
      const s = nightFrameStats(row);
      return (
        <div key={b.key} className="bw-night-bowler">
          <p className="bw-night-line">
            <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" /> {b.name}
            <span>
              strikes {pct(s.strike)} · spares {pct(s.spare)} · {s.opensPerGame} open/game
            </span>
          </p>
          {framesOf(row).map(
            (frames, i) =>
              frames && (
                <div key={i} className="bw-night-game">
                  <span>G{i + 1}</span>
                  <Scorecard frames={frames} label={`${b.name}, game ${i + 1}: ${row.games[i]}`} />
                </div>
              )
          )}
        </div>
      );
    })}
  </div>
);

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
  const [open, setOpen] = useState(false);
  const present = BOWLERS.map((b) => night.rows[b.key]).filter(Boolean);
  const source = ["lane", "photo"].find((src) => present.some((r) => r.source === src)) || "manual";
  const [sourceIcon, sourceLabel] = SOURCES[source];
  const framed = present.some((r) => framedGames(r).length > 0);
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
    <li className={`bw-night ${open ? "is-open" : ""}`}>
      <header className="bw-night-head">
        <time dateTime={night.date}>
          {formatNight(night.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
        </time>
        <span className="bw-night-src" title={sourceLabel}>
          <i className={`fa-solid ${sourceIcon}`} aria-hidden="true" />
          <span className="sr-only">{sourceLabel}</span>
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
      {open && <NightFrames night={night} />}
      {error && (
        <p className="bw-error" role="alert">
          {error}
        </p>
      )}
      <div className="bw-night-actions">
        {framed && (
          <button type="button" className="bw-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <i className="fa-solid fa-table-cells" aria-hidden="true" /> {open ? "Hide frames" : "Frames"}
          </button>
        )}
        <button type="button" className="bw-link" onClick={() => onWrap(night.date)}>
          <i className="fa-solid fa-image" aria-hidden="true" /> Wrap card
        </button>
        <button type="button" className="bw-link" onClick={() => onEdit(night)}>
          <i className="fa-solid fa-pen" aria-hidden="true" /> Edit
        </button>
        <Link to={`/bowler/lane?night=${night.date}`} className="bw-link">
          <i className="fa-solid fa-hand-pointer" aria-hidden="true" /> {framed ? "Edit frames" : "Add frames"}
        </Link>
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
