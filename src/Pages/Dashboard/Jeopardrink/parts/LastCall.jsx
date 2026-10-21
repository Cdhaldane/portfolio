import React, { useEffect, useState } from "react";
import { clampWager, maxFinalWager } from "../board";
import { describeCallout, money } from "../callouts";
import { PHASE } from "../gameReducer";
import { play } from "../sfx";
import { CalloutBanner } from "./Scoreboard";

/*
 * LAST CALL (Final Jeopardy): secret wagers, one clue, 30 seconds, then the
 * host judges from last place up. Phones type their wager and answer; the
 * host enters wagers for everyone else.
 */

const THINK_SECONDS = 30;

const WagerRow = ({ player, wager, fromPhone, dispatch }) => {
  const max = maxFinalWager(player.score);
  const [draft, setDraft] = useState(wager === undefined ? "" : String(wager));
  const commit = () => {
    if (draft === "") return;
    const amount = clampWager(draft, max);
    setDraft(String(amount));
    if (amount !== wager) dispatch({ type: "LC_WAGER", pid: player.id, amount });
  };
  return (
    <li className="jd-lc-row">
      <span className="jd-lc-name">
        {player.name}
        <em>{money(player.score)} · max {money(max)}</em>
      </span>
      {/* A phone's wager is secret; a dead phone falls back to the host typing it. */}
      {fromPhone && wager !== undefined ? (
        <span className="jd-tag is-on">LOCKED IN</span>
      ) : (
        <input
          className="jd-input jd-lc-input"
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          placeholder={fromPhone ? "On phone…" : "Wager"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          aria-label={`${player.name}'s wager`}
        />
      )}
    </li>
  );
};

const Wagers = ({ game, dispatch }) => {
  const { wagers } = game.lc;
  const ready = game.players.filter((p) => wagers[p.id] !== undefined).length;
  return (
    <>
      <p className="jd-fine">
        Phones wager on their phones. Everyone else whispers it to you. Anything you don't get counts as $0.
      </p>
      <ul className="jd-lc-list">
        {game.players.map((p) => (
          <WagerRow key={p.id} player={p} wager={wagers[p.id]} fromPhone={p.phone} dispatch={dispatch} />
        ))}
      </ul>
      <button type="button" className="jd-primary" onClick={() => dispatch({ type: "LC_REVEAL" })}>
        REVEAL THE CLUE ({ready}/{game.players.length} IN) <i className="fa-solid fa-eye" />
      </button>
    </>
  );
};

const ThinkClock = () => {
  const [left, setLeft] = useState(THINK_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      play("timesUp");
      return undefined;
    }
    if (left <= 5) play("tick");
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className={`jd-think ${left <= 5 ? "is-late" : ""}`} role="timer" aria-label={`${left} seconds left`}>
      <span className="jd-think-bar" style={{ transform: `scaleX(${left / THINK_SECONDS})` }} />
      <span className="jd-think-num">{left}</span>
    </div>
  );
};

const Think = ({ game, dispatch }) => {
  const phones = game.players.filter((p) => p.phone);
  const answered = phones.filter((p) => game.lc.answers[p.id]).length;
  return (
    <>
      <div className="jd-card">
        <p className="jd-card-meta">
          <span>{game.finalClue.cat}</span>
          <span className="jd-card-value">LAST CALL</span>
        </p>
        <p className="jd-clue">{game.finalClue.q}</p>
      </div>
      <ThinkClock />
      {phones.length > 0 && (
        <p className="jd-fine">
          {answered}/{phones.length} phones answered. Everyone else: write it down.
        </p>
      )}
      <button type="button" className="jd-primary" onClick={() => dispatch({ type: "LC_TO_JUDGE" })}>
        PENCILS DOWN <i className="fa-solid fa-pencil" />
      </button>
    </>
  );
};

const Judge = ({ game, dispatch }) => {
  const { lc } = game;
  const nameOf = (pid) => (game.players.find((p) => p.id === pid) || {}).name;
  // Like the show: reveal from last place up.
  const order = [...game.players].sort((a, b) => a.score - b.score);
  const done = order.every((p) => p.id in lc.judged);
  return (
    <>
      <div className="jd-answer is-shown">
        <span className="jd-answer-tag">Correct response</span>
        <span className="jd-answer-text">{game.finalClue.a}</span>
      </div>
      <CalloutBanner callout={game.callout} describe={(c) => describeCallout(c, nameOf, game.settings.drinking)} />
      <ul className="jd-lc-list">
        {order.map((p) => {
          const verdict = lc.judged[p.id];
          return (
            <li key={p.id} className={`jd-lc-row ${verdict === undefined ? "" : verdict ? "is-right" : "is-wrong"}`}>
              <span className="jd-lc-name">
                {p.name}
                <em>
                  {p.phone ? lc.answers[p.id] || "(no answer sent)" : "Say it out loud"} · wagered {money(lc.wagers[p.id] || 0)}
                </em>
              </span>
              {verdict === undefined ? (
                <span className="jd-lc-judge">
                  <button type="button" className="jd-right jd-small" onClick={() => dispatch({ type: "LC_JUDGE", pid: p.id, correct: true })} aria-label={`${p.name} got it right`}>
                    <i className="fa-solid fa-check" />
                  </button>
                  <button type="button" className="jd-wrong jd-small" onClick={() => dispatch({ type: "LC_JUDGE", pid: p.id, correct: false })} aria-label={`${p.name} got it wrong`}>
                    <i className="fa-solid fa-xmark" />
                  </button>
                </span>
              ) : (
                <span className="jd-lc-score">{money(p.score)}</span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="jd-primary" onClick={() => dispatch({ type: "FINISH" })}>
        {done ? "CROWN THE CHAMPION" : "SKIP TO THE RESULTS"} <i className="fa-solid fa-crown" />
      </button>
    </>
  );
};

const LastCall = ({ game, dispatch }) => (
  <div className="jd-lastcall">
    <p className="jd-kicker">Last Call</p>
    <h2 className="jd-lc-cat">{game.finalClue.cat}</h2>
    {game.phase === PHASE.LC_WAGER && <Wagers game={game} dispatch={dispatch} />}
    {game.phase === PHASE.LC_CLUE && <Think game={game} dispatch={dispatch} />}
    {game.phase === PHASE.LC_JUDGE && <Judge game={game} dispatch={dispatch} />}
  </div>
);

export default LastCall;
