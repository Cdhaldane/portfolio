import React from "react";
import { money } from "../callouts";

/*
 * Player chips (live scores, who's in control, who's locked out) and the
 * ranked standings used between rounds and at the finale. Chips become
 * buttons when `onPick` is given: hand over control, pick who rang in.
 */

const ChipBody = ({ player, control }) => (
  <>
    {player.id === control && <i className="fa-solid fa-crown jd-chip-crown" aria-hidden="true" />}
    <span className="jd-chip-name">
      {player.name}
      {player.phone && <i className="fa-solid fa-mobile-screen jd-chip-phone" aria-hidden="true" />}
    </span>
    <span className={`jd-chip-score ${player.score < 0 ? "is-neg" : ""}`}>{money(player.score)}</span>
  </>
);

export const Scoreboard = ({ players, control = null, highlight = null, locked = [], onPick, pickLabel = "" }) => (
  <ul className="jd-chips" aria-label="Scores">
    {players.map((p) => {
      const out = locked.includes(p.id);
      const cls = `jd-chip ${p.id === highlight ? "is-hot" : ""} ${out ? "is-out" : ""} ${
        p.id === control ? "is-control" : ""
      }`;
      return (
        <li key={p.id}>
          {onPick ? (
            <button
              type="button"
              className={cls}
              onClick={() => onPick(p.id)}
              disabled={out}
              aria-label={`${pickLabel} ${p.name}, ${money(p.score)}`}
            >
              <ChipBody player={p} control={control} />
            </button>
          ) : (
            <div className={cls}>
              <ChipBody player={p} control={control} />
            </div>
          )}
        </li>
      );
    })}
  </ul>
);

export const ranked = (players) => [...players].sort((a, b) => b.score - a.score);

export const Standings = ({ players }) => (
  <ol className="jd-standings">
    {ranked(players).map((p, i) => (
      <li key={p.id} className={i === 0 ? "is-first" : ""} style={{ "--i": i }}>
        <span className="jd-rank">{String(i + 1).padStart(2, "0")}</span>
        <span className="jd-standing-name">{p.name}</span>
        <span className={`jd-standing-score ${p.score < 0 ? "is-neg" : ""}`}>{money(p.score)}</span>
      </li>
    ))}
  </ol>
);

export const CalloutBanner = ({ callout, describe }) => {
  const c = describe(callout);
  if (!c) return null;
  return (
    <div key={callout.id} className={`jd-callout is-${c.tone}`} role="status">
      <strong>{c.title}</strong>
      <span>{c.line}</span>
    </div>
  );
};
