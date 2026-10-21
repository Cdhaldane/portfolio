import React, { useState } from "react";
import { useParams } from "react-router-dom";
import { money } from "../callouts";
import { usePlayerRoom } from "./usePlayerRoom";
import { CalloutFlash, PhoneStage } from "./PhoneViews";
import "./Buzzer.css";

/*
 * JEOPARDRINK! — the player's phone, at /buzz or /buzz/CODE. Public on
 * purpose (friends shouldn't need the dashboard password); a room code
 * from the host is the only way in.
 */

const CODE_LETTERS = /[^BCDFGHJKLMNPQRSTVWXZ]/g;
const cleanCode = (v) => String(v || "").toUpperCase().replace(CODE_LETTERS, "").slice(0, 4);

const JoinForm = ({ initialCode, onJoin }) => {
  const [code, setCode] = useState(cleanCode(initialCode));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 4) return setError("Room codes are four letters. Ask the host.");
    if (!name.trim()) return setError("What do we call you?");
    setBusy(true);
    setError("");
    const res = await onJoin(code, name.trim());
    setBusy(false);
    if (!res.ok) setError(res.error || "Couldn't join. Check the code.");
    return undefined;
  };

  return (
    <form className="jb-form jb-join" onSubmit={submit}>
      <h1 className="jb-logo">
        JEOPAR<em>DRINK!</em>
      </h1>
      <p className="jb-fine">Grab a buzzer. The host has the room code.</p>
      <label className="jb-label" htmlFor="jb-code">
        Room code
      </label>
      <input
        id="jb-code"
        className="jb-input jb-input--code"
        value={code}
        onChange={(e) => setCode(cleanCode(e.target.value))}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="ABCD"
      />
      <label className="jb-label" htmlFor="jb-name">
        Your name
      </label>
      <input
        id="jb-name"
        className="jb-input"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
        autoComplete="nickname"
        placeholder="Name on the scoreboard"
      />
      {error && (
        <p className="jb-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="jb-primary" disabled={busy}>
        {busy ? "JOINING…" : "I'M IN"}
      </button>
    </form>
  );
};

const RoomHeader = ({ me, self, status, onLeave }) => (
  <header className="jb-top">
    <div className="jb-me">
      <span className="jb-me-name">{me.name}</span>
      <span className={`jb-me-score ${self && self.score < 0 ? "is-neg" : ""}`}>{money(self ? self.score : 0)}</span>
    </div>
    <span className={`jb-status is-${status}`} title={status === "live" ? "Connected" : "Reconnecting"}>
      <span className="jb-status-dot" aria-hidden="true" /> {me.code}
    </span>
    <button type="button" className="jb-leave" onClick={onLeave} aria-label="Leave this room">
      <i className="fa-solid fa-right-from-bracket" />
    </button>
  </header>
);

const Buzzer = () => {
  const { code } = useParams();
  const player = usePlayerRoom(cleanCode(code));
  const { me, status, state } = player;

  if (!me) {
    return (
      <div className="jb">
        <JoinForm initialCode={code} onJoin={player.join} />
      </div>
    );
  }

  const roster = (state && state.roster) || [];
  const self = roster.find((p) => p.id === me.playerId) || null;
  const nameOf = (pid) => (roster.find((p) => p.id === pid) || {}).name;

  return (
    <div className="jb">
      <RoomHeader me={me} self={self} status={status} onLeave={player.leave} />
      <main className="jb-main">
        {status === "gone" ? (
          <div className="jb-gone">
            <p className="jb-big">This room has closed.</p>
            <p className="jb-fine">If the host opened a new one, grab the new code.</p>
            <button type="button" className="jb-primary" onClick={player.leave}>
              JOIN ANOTHER ROOM
            </button>
          </div>
        ) : state ? (
          <PhoneStage state={state} me={me} first={player.first} onBuzz={player.buzz} onSubmit={player.submit} />
        ) : (
          <p className="jb-big jb-wait">Connecting…</p>
        )}
      </main>
      {state && (
        <CalloutFlash callout={state.callout} meId={me.playerId} nameOf={nameOf} drinking={state.drinking !== false} />
      )}
    </div>
  );
};

export default Buzzer;
