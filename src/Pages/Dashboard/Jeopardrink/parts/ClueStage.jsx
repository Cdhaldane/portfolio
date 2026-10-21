import React, { useState } from "react";
import { clampWager, maxWager } from "../board";
import { describeCallout, money } from "../callouts";
import { PHASE } from "../gameReducer";
import { CalloutBanner, Scoreboard } from "./Scoreboard";

/*
 * One clue, start to finish: the Daily Double wager, reading the clue,
 * opening buzzers, judging, and the reveal. Keyed per clue by the parent,
 * so local UI (answer peek, wager draft) resets every time.
 */

const WagerPanel = ({ game, dispatch, catName }) => {
  const pid = game.clue.answering;
  const player = game.players.find((p) => p.id === pid);
  const max = maxWager(player ? player.score : 0, game.round);
  const [draft, setDraft] = useState(() => String(Math.min(Math.max(player ? player.score : 0, 0), max)));
  const amount = clampWager(draft, max);
  const step = game.round === 0 ? 100 : 200;

  return (
    <div className="jd-dd">
      <div className="jd-dd-splash" aria-label="Daily Double Shot">
        <span>DAILY</span>
        <span>DOUBLE</span>
        <span className="jd-dd-shot">SHOT!</span>
      </div>
      <p className="jd-dd-cat">{catName}</p>

      <p className="jd-label">Who found it?</p>
      <Scoreboard
        players={game.players}
        highlight={pid}
        onPick={(id) => dispatch({ type: "DD_PLAYER", pid: id })}
        pickLabel="Daily Double for"
      />

      <div className="jd-wager">
        <button type="button" className="jd-step" onClick={() => setDraft(String(clampWager(amount - step, max)))} aria-label="Lower the wager">
          <i className="fa-solid fa-minus" />
        </button>
        <label className="jd-wager-field">
          <span>$</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Wager"
          />
        </label>
        <button type="button" className="jd-step" onClick={() => setDraft(String(clampWager(amount + step, max)))} aria-label="Raise the wager">
          <i className="fa-solid fa-plus" />
        </button>
      </div>
      <div className="jd-presets">
        <button type="button" className="jd-ghost jd-small" onClick={() => setDraft(String(Math.round(max / 2 / 100) * 100))}>
          HALF
        </button>
        <button type="button" className="jd-ghost jd-small" onClick={() => setDraft(String(max))}>
          TRUE DAILY DOUBLE
        </button>
      </div>
      <p className="jd-fine">
        Up to {money(max)}.{game.settings.drinking ? " Nail it: hand out 3 sips. Blow it: take a shot." : ""}
      </p>
      <button type="button" className="jd-primary" onClick={() => dispatch({ type: "WAGER", amount })} disabled={!player}>
        LOCK IN {money(amount)}
      </button>
    </div>
  );
};

const AnswerCard = ({ answer, resolved }) => {
  const [peek, setPeek] = useState(false);
  const shown = peek || resolved;
  return (
    <button
      type="button"
      className={`jd-answer ${shown ? "is-shown" : ""}`}
      onClick={() => setPeek((v) => !v)}
      disabled={resolved}
      aria-pressed={resolved ? undefined : peek}
    >
      <span className="jd-answer-tag">
        {resolved ? "Correct response" : shown ? "Host eyes only · tap to hide" : "Host eyes only · tap to peek"}
      </span>
      <span className="jd-answer-text" aria-hidden={!shown}>
        {answer}
      </span>
    </button>
  );
};

const OpenControls = ({ game, dispatch, roomLive }) => {
  const { clue } = game;
  return (
    <div className="jd-controls">
      {roomLive &&
        (clue.buzzOpen ? (
          <div className="jd-live" key={game.buzzSeq}>
            <span className="jd-live-dot" aria-hidden="true" /> BUZZERS LIVE
            <span className="jd-shotclock" aria-hidden="true" />
          </div>
        ) : (
          <button type="button" className="jd-primary jd-open" onClick={() => dispatch({ type: "OPEN_BUZZ" })}>
            <i className="fa-solid fa-bell" /> OPEN BUZZERS
          </button>
        ))}
      <p className="jd-label">{roomLive ? "Or tap whoever rang in first" : "Who rang in first?"}</p>
      <Scoreboard
        players={game.players}
        locked={clue.locked}
        onPick={(pid) => dispatch({ type: "BUZZ_IN", pid })}
        pickLabel="Answering:"
      />
      <button type="button" className="jd-ghost" onClick={() => dispatch({ type: "NOBODY" })}>
        <i className="fa-solid fa-hourglass-end" /> NOBODY GOT IT
      </button>
    </div>
  );
};

const JudgePanel = ({ name, dd, dispatch }) => (
  <div className="jd-judge">
    <p className="jd-label">{dd ? "Daily Double Shot" : "Rang in"}</p>
    <p className="jd-answering">{name}</p>
    <div className="jd-judge-btns">
      <button type="button" className="jd-right" onClick={() => dispatch({ type: "JUDGE", correct: true })}>
        <i className="fa-solid fa-check" /> CORRECT
      </button>
      <button type="button" className="jd-wrong" onClick={() => dispatch({ type: "JUDGE", correct: false })}>
        <i className="fa-solid fa-xmark" /> WRONG
      </button>
    </div>
  </div>
);

const ClueStage = ({ game, dispatch, roomLive }) => {
  const { clue } = game;
  const cat = game.boards[game.round].cats[clue.col];
  const cell = cat.clues[clue.row];
  const nameOf = (pid) => (game.players.find((p) => p.id === pid) || {}).name;
  const describe = (c) => describeCallout(c, nameOf, game.settings.drinking);

  if (game.phase === PHASE.WAGER) return <WagerPanel game={game} dispatch={dispatch} catName={cat.name} />;

  return (
    <div className="jd-stage">
      <div className="jd-card">
        <p className="jd-card-meta">
          <span>{cat.name}</span>
          <span className="jd-card-value">{clue.dd ? `DD · ${money(clue.wager || 0)}` : `$${clue.value}`}</span>
        </p>
        <p className="jd-clue">{cell.q}</p>
        {cat.hint && <p className="jd-hint">{cat.hint}</p>}
      </div>

      <AnswerCard answer={cell.a} resolved={Boolean(clue.resolved)} />
      <CalloutBanner callout={game.callout} describe={describe} />

      {!clue.resolved && !clue.answering && <OpenControls game={game} dispatch={dispatch} roomLive={roomLive} />}
      {!clue.resolved && clue.answering && <JudgePanel name={nameOf(clue.answering)} dd={clue.dd} dispatch={dispatch} />}
      {clue.resolved && (
        <button type="button" className="jd-primary jd-back" onClick={() => dispatch({ type: "CLOSE_CLUE" })}>
          BACK TO THE BOARD <i className="fa-solid fa-table-cells" />
        </button>
      )}
    </div>
  );
};

export default ClueStage;
