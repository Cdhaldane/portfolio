import React, { useEffect, useRef, useState } from "react";
import { describeCallout, money } from "../callouts";
import { play } from "../sfx";

/*
 * Everything a player's phone shows, one view per host phase. Players get
 * the categories and a buzzer, never the clue text (that's the host's job
 * to read out).
 */

const vibrate = (pattern) => {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* no haptics, no problem */
  }
};

const ranked = (roster) => [...roster].sort((a, b) => b.score - a.score);

const Standings = ({ roster, meId }) => (
  <ol className="jb-standings">
    {ranked(roster).map((p, i) => (
      <li key={p.id} className={p.id === meId ? "is-me" : ""}>
        <span className="jb-rank">{i + 1}</span>
        <span className="jb-standing-name">{p.name}</span>
        <span className={`jb-standing-score ${p.score < 0 ? "is-neg" : ""}`}>{money(p.score)}</span>
      </li>
    ))}
  </ol>
);

const MiniBoard = ({ board }) => (
  <div className="jb-board">
    {board.map((cat, col) => (
      <div className="jb-col" key={col}>
        <p className="jb-cat">{cat.name}</p>
        <div className="jb-cells">
          {cat.cells.map((cell, row) => (
            <span key={row} className={`jb-cell ${cell.used ? "is-used" : ""}`}>
              {cell.used ? "" : `$${cell.value}`}
            </span>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const BoardView = ({ state, meId, nameOf }) => {
  const mine = state.control === meId;
  return (
    <>
      <div className={`jb-callbar ${mine ? "is-mine" : ""}`}>
        {mine ? (
          <>
            <strong>YOUR PICK!</strong> Shout a category and a value.
          </>
        ) : state.control ? (
          <>
            <strong>{nameOf(state.control)}</strong> is picking.
          </>
        ) : (
          "The host is picking."
        )}
      </div>
      {state.board && <MiniBoard board={state.board} />}
    </>
  );
};

/** Which face the buzzer shows, from the room state and this phone's press. */
function buzzerFace({ state, meId, nameOf, pressed, beatBy }) {
  const { clue, buzz, answering } = state;
  if (clue.resolved) return { mode: "done", label: "TIME'S UP", sub: clue.answer ? `Answer: ${clue.answer}` : "" };
  if (clue.dd) {
    return answering === meId
      ? { mode: "up", label: "THAT'S YOU!", sub: "Daily Double Shot. Answer the host." }
      : { mode: "idle", label: "DAILY DOUBLE", sub: `${nameOf(answering) || "Someone"} goes solo.` };
  }
  if (answering === meId) return { mode: "up", label: "YOU'RE UP!", sub: "Answer out loud. Phrase it as a question." };
  if (answering) return { mode: "idle", label: `${String(nameOf(answering) || "Someone").toUpperCase()} RANG IN`, sub: "Pray they blow it." };
  if (buzz.locked.includes(meId)) return { mode: "out", label: "LOCKED OUT", sub: "You had your shot." };
  if (pressed) {
    return beatBy
      ? { mode: "pressed", label: "TOO SLOW", sub: `${nameOf(beatBy) || "Someone"} beat you to it.` }
      : { mode: "pressed", label: "BUZZED!", sub: "Waiting on the host…" };
  }
  if (!buzz.open) return { mode: "armed", label: "WAIT FOR IT…", sub: "Buzzers open when the host finishes reading." };
  return { mode: "live", label: "BUZZ!", sub: "" };
}

const BuzzerButton = ({ state, meId, nameOf, first, onBuzz }) => {
  const seq = state.buzz.seq;
  const [pressedSeq, setPressedSeq] = useState(null);
  const fired = useRef(null);
  const pressed = pressedSeq === seq;
  const beatBy = pressed && first && first !== meId ? first : null;
  const face = buzzerFace({ state, meId, nameOf, pressed, beatBy });

  const press = (e) => {
    if (e) e.preventDefault();
    if (face.mode !== "live" || fired.current === seq) return;
    fired.current = seq;
    setPressedSeq(seq);
    play("buzz");
    vibrate(40);
    onBuzz();
  };

  return (
    <div className="jb-buzzwrap">
      <button
        type="button"
        className={`jb-buzzer is-${face.mode}`}
        onPointerDown={press}
        onClick={press}
        disabled={face.mode !== "live"}
      >
        <span className="jb-buzzer-label">{face.label}</span>
      </button>
      <p className="jb-buzz-sub" aria-live="polite">
        {face.sub}
      </p>
    </div>
  );
};

const ClueView = ({ state, meId, nameOf, first, onBuzz }) => (
  <>
    <div className="jb-cluehead">
      <span className="jb-cluecat">{state.clue.cat}</span>
      <span className="jb-clueval">{state.clue.dd ? "DAILY DOUBLE" : `$${state.clue.value}`}</span>
    </div>
    <BuzzerButton key={`${state.clue.cat}:${state.clue.value}`} state={state} meId={meId} nameOf={nameOf} first={first} onBuzz={onBuzz} />
  </>
);

const DoubleView = ({ state, meId, nameOf }) => (
  <div className="jb-dd">
    <p className="jb-dd-splash">
      DAILY DOUBLE <em>SHOT!</em>
    </p>
    <p className="jb-big">
      {state.answering === meId
        ? "That's you. Tell the host your wager."
        : `${nameOf(state.answering) || "Someone"} found it. Thoughts and prayers.`}
    </p>
  </div>
);

const LcWager = ({ state, self, onSubmit }) => {
  const max = Math.max(self ? self.score : 0, 0);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(null);
  const [error, setError] = useState("");
  const locked = sent !== null || (self && state.lastCall.wagered.includes(self.id));

  const send = async (e) => {
    e.preventDefault();
    const amount = Math.min(Math.max(Math.round(Number(draft) || 0), 0), max);
    const res = await onSubmit({ wager: amount });
    if (res.ok) setSent(amount);
    else setError(res.error || "Couldn't send that.");
  };

  if (locked) {
    return <p className="jb-big">Locked in{sent !== null ? ` at ${money(sent)}` : ""}. No take-backs.</p>;
  }
  return (
    <form className="jb-form" onSubmit={send}>
      <label className="jb-label" htmlFor="jb-wager">
        Your secret wager (up to {money(max)})
      </label>
      <input
        id="jb-wager"
        className="jb-input jb-input--big"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="0"
      />
      {max === 0 && <p className="jb-fine">Broke? You still play for your liver.</p>}
      {error && <p className="jb-error">{error}</p>}
      <button type="submit" className="jb-primary">
        LOCK IT IN
      </button>
    </form>
  );
};

const LcAnswer = ({ onSubmit }) => {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const res = await onSubmit({ answer: draft });
    if (res.ok) {
      setSent(draft.trim());
      setError("");
    } else setError(res.error || "Couldn't send that.");
  };
  return (
    <form className="jb-form" onSubmit={send}>
      <label className="jb-label" htmlFor="jb-answer">
        Listen to the host, then write your response
      </label>
      <input
        id="jb-answer"
        className="jb-input"
        maxLength={80}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="What is…"
        autoComplete="off"
      />
      {sent && <p className="jb-fine">Sent: “{sent}”. You can change it until pencils down.</p>}
      {error && <p className="jb-error">{error}</p>}
      <button type="submit" className="jb-primary">
        {sent ? "UPDATE ANSWER" : "SEND ANSWER"}
      </button>
    </form>
  );
};

const LcJudging = ({ state, meId, drinking }) => {
  const verdict = state.lastCall.judged[meId];
  if (verdict === undefined) return <p className="jb-big">The host is judging, last place first. Sweat.</p>;
  return verdict ? (
    <p className="jb-big jb-good">YOU GOT IT! 🎉</p>
  ) : (
    <p className="jb-big jb-bad">{drinking ? "Wrong. Finish your drink. 🍺" : "Wrong. So close."}</p>
  );
};

const LastCallView = ({ state, self, meId, onSubmit }) => (
  <>
    <p className="jb-kicker">Last Call</p>
    <h2 className="jb-title">{state.lastCall ? state.lastCall.cat : ""}</h2>
    {state.phase === "lc-wager" && state.lastCall && <LcWager state={state} self={self} onSubmit={onSubmit} />}
    {state.phase === "lc-clue" && <LcAnswer onSubmit={onSubmit} />}
    {state.phase === "lc-judge" && state.lastCall && <LcJudging state={state} meId={meId} drinking={state.drinking} />}
  </>
);

const OverView = ({ state, meId }) => {
  const order = ranked(state.roster);
  const place = order.findIndex((p) => p.id === meId);
  return (
    <>
      <p className="jb-kicker">That's the game</p>
      <h2 className="jb-title">{place === 0 ? "YOU WON! 👑" : place > 0 ? `You placed #${place + 1}` : "Final scores"}</h2>
      <Standings roster={state.roster} meId={meId} />
      {state.lastCall && state.lastCall.answer && <p className="jb-fine">Last Call answer: {state.lastCall.answer}</p>}
    </>
  );
};

/** Full-screen flash when a callout is about you (or everyone). Tap to dismiss. */
export const CalloutFlash = ({ callout, meId, nameOf, drinking }) => {
  const [dismissed, setDismissed] = useState(() => (callout ? callout.id : 0));
  const mine = Boolean(callout) && callout.id > dismissed && (callout.kind === "everyone" || callout.pid === meId);
  const id = callout ? callout.id : 0;
  const kind = callout ? callout.kind : null;

  useEffect(() => {
    if (!mine) return undefined;
    const good = kind === "score" || kind === "give";
    play(good ? "right" : "wrong");
    vibrate(good ? 60 : [220, 90, 220]);
    const t = setTimeout(() => setDismissed(id), 4500);
    return () => clearTimeout(t);
  }, [mine, id, kind]);

  if (!mine) return null;
  const c = describeCallout(callout, nameOf, drinking);
  if (!c) return null;
  return (
    <button type="button" className={`jb-flash is-${c.tone}`} onClick={() => setDismissed(id)} aria-label="Dismiss">
      <strong>{c.title}</strong>
      <span>{c.line}</span>
      <em>tap to close</em>
    </button>
  );
};

/** The latest callout as a quiet ticker, so everyone hears what happened. */
const Ticker = ({ callout, nameOf, drinking }) => {
  const c = describeCallout(callout, nameOf, drinking);
  return c ? (
    <p key={callout.id} className={`jb-ticker is-${c.tone}`}>
      {c.title} <span>{c.line}</span>
    </p>
  ) : null;
};

export const PhoneStage = ({ state, me, first, onBuzz, onSubmit }) => {
  const meId = me.playerId;
  const roster = state.roster || []; // the lobby has no roster yet
  const nameOf = (pid) => (roster.find((p) => p.id === pid) || {}).name;
  const self = roster.find((p) => p.id === meId) || null;

  switch (state.phase) {
    case "lobby":
      return <p className="jb-big">You're in, {me.name}! Waiting for the host to start. Grab a drink.</p>;
    case "board":
      return (
        <>
          <BoardView state={state} meId={meId} nameOf={nameOf} />
          <Ticker callout={state.callout} nameOf={nameOf} drinking={state.drinking} />
        </>
      );
    case "wager":
      return <DoubleView state={state} meId={meId} nameOf={nameOf} />;
    case "clue":
      return (
        <>
          <ClueView state={state} meId={meId} nameOf={nameOf} first={first} onBuzz={onBuzz} />
          <Ticker callout={state.callout} nameOf={nameOf} drinking={state.drinking} />
        </>
      );
    case "break":
      return (
        <>
          <p className="jb-kicker">Intermission</p>
          <h2 className="jb-title">How we're doing</h2>
          <Standings roster={state.roster} meId={meId} />
        </>
      );
    case "lc-wager":
    case "lc-clue":
    case "lc-judge":
      return <LastCallView state={state} self={self} meId={meId} onSubmit={onSubmit} />;
    case "over":
      return <OverView state={state} meId={meId} />;
    default:
      return null;
  }
};
