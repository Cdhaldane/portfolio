import React, { useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS } from "../board";
import { HOUSE_RULES } from "../callouts";
import { CodeLetters, JoinQr, inviteLink } from "./JoinQr";

/*
 * Pre-game: open a phone-buzzer room (optional), add anyone without a
 * phone, pick the game length and whether the drinking rules are on.
 */

const joinHost = () => window.location.host;
const localId = (i) => `local-${i}-${Math.random().toString(36).slice(2, 8)}`;

const Toggle = ({ on, onChange, label, detail, ariaLabel }) => (
  <button
    type="button"
    className={`jd-toggle ${on ? "is-on" : ""}`}
    role="switch"
    aria-checked={on}
    aria-label={ariaLabel}
    onClick={() => onChange(!on)}
  >
    <span className="jd-toggle-track">
      <span className="jd-toggle-knob" />
    </span>
    <span className="jd-toggle-text">
      {label}
      <em>{detail}</em>
    </span>
  </button>
);

const ResumeCard = ({ saved, onResume, onDiscard }) => (
  <section className="jd-panel jd-resume">
    <div>
      <p className="jd-kicker">Game in progress</p>
      <p className="jd-resume-line">
        {saved.game.players.length} players{saved.room ? ` · room ${saved.room.code}` : ""}
      </p>
    </div>
    <div className="jd-resume-actions">
      <button type="button" className="jd-primary" onClick={onResume}>
        <i className="fa-solid fa-play" /> RESUME
      </button>
      <button type="button" className="jd-ghost" onClick={onDiscard}>
        START FRESH
      </button>
    </div>
  </section>
);

const RoomPanel = ({ room, benched, onBench }) => {
  const [copied, setCopied] = useState(false);
  if (room.status === "creating" || room.status === "idle") {
    return <p className="jd-fine">Opening a room…</p>;
  }
  if (room.status !== "live") {
    return (
      <div className="jd-roomerr">
        <p>{room.status === "gone" ? "That room closed." : room.error || "Couldn't open a room."} You can still play by tapping names.</p>
        <button type="button" className="jd-ghost" onClick={room.retry}>
          <i className="fa-solid fa-rotate" /> TRY AGAIN
        </button>
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const players = room.players.filter((p) => !benched.includes(p.id));
  return (
    <>
      <div className="jd-roomcode">
        <span className="jd-roomcode-label">Scan to grab a buzzer</span>
        <JoinQr code={room.code} />
        <span className="jd-roomcode-label">
          or go to <strong>{joinHost()}/buzz</strong> and enter
        </span>
        <CodeLetters code={room.code} />
        <button type="button" className="jd-ghost jd-copy" onClick={copy}>
          <i className={`fa-solid ${copied ? "fa-check" : "fa-link"}`} /> {copied ? "LINK COPIED" : "COPY INVITE LINK"}
        </button>
      </div>
      <p className="jd-label">{players.length ? "On their phones" : "Waiting for phones to join…"}</p>
      {players.length > 0 && (
        <ul className="jd-joined">
          {players.map((p) => (
            <li key={p.id}>
              <i className="fa-solid fa-mobile-screen" /> {p.name}
              <button type="button" className="jd-x" onClick={() => onBench(p.id)} aria-label={`Remove ${p.name}`}>
                <i className="fa-solid fa-xmark" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

const Setup = ({ saved, onResume, onDiscard, phones, onPhones, room, benched, onBench, onStart }) => {
  const [names, setNames] = useState(["", ""]);
  const [rounds, setRounds] = useState(2);
  const [lastCall, setLastCall] = useState(true);
  const [drinking, setDrinking] = useState(true);
  const [error, setError] = useState("");

  const live = phones && room.status === "live";
  const phonePlayers = live ? room.players.filter((p) => !benched.includes(p.id)) : [];
  const manual = names.map((n) => n.trim()).filter(Boolean);
  const total = manual.length + phonePlayers.length;

  const setName = (i, value) => setNames((list) => list.map((n, j) => (j === i ? value : n)));
  const addName = () => setNames((list) => (list.length >= MAX_PLAYERS ? list : [...list, ""]));
  const dropName = (i) => setNames((list) => (list.length <= 1 ? [""] : list.filter((_, j) => j !== i)));

  const start = () => {
    const roster = [
      ...phonePlayers.map((p) => ({ id: p.id, name: p.name, phone: true })),
      ...manual.map((name, i) => ({ id: localId(i), name, phone: false })),
    ];
    if (roster.length < MIN_PLAYERS) return setError(`You need at least ${MIN_PLAYERS} players. Even drunk Jeopardy needs a rival.`);
    if (roster.length > MAX_PLAYERS) return setError(`${MAX_PLAYERS} players max. Make it teams?`);
    if (new Set(roster.map((p) => p.name.toLowerCase())).size !== roster.length) {
      return setError("Two players have the same name. Add a last initial.");
    }
    setError("");
    return onStart(roster, { rounds, lastCall, drinking, phones: live });
  };

  return (
    <div className="jd-setup">
      <section className="jd-hero">
        <p className="jd-kicker">This is…</p>
        <h1 className="jd-hero-title">
          JEOPAR<em>DRINK!</em>
        </h1>
        <p className="jd-hero-sub">
          Your host: Alex Trebev (that's you). You see the clues and answers. Everyone else gets a buzzer and a
          bad decision.
        </p>
      </section>

      {saved && <ResumeCard saved={saved} onResume={onResume} onDiscard={onDiscard} />}

      <section className="jd-panel">
        <header className="jd-panel-head">
          <span className="jd-num">01</span>
          <h2>Phone buzzers</h2>
          <Toggle on={phones} onChange={onPhones} label="" detail={phones ? "ON" : "OFF"} ariaLabel="Phone buzzers" />
        </header>
        {phones ? (
          <RoomPanel room={room} benched={benched} onBench={onBench} />
        ) : (
          <p className="jd-fine">No phones? No problem. Players slap the table and you tap whoever rang in first.</p>
        )}
      </section>

      <section className="jd-panel">
        <header className="jd-panel-head">
          <span className="jd-num">02</span>
          <h2>{phones ? "Anyone without a phone" : "Players"}</h2>
          <span className="jd-count">
            {total} / {MAX_PLAYERS}
          </span>
        </header>
        <div className="jd-names">
          {names.map((name, i) => (
            <div className="jd-name-row" key={i}>
              <input
                className="jd-input"
                value={name}
                maxLength={20}
                placeholder={`Player ${i + 1}`}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => setName(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && i === names.length - 1) addName();
                }}
              />
              <button type="button" className="jd-x" onClick={() => dropName(i)} aria-label={`Remove player ${i + 1}`}>
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="jd-ghost" onClick={addName} disabled={names.length >= MAX_PLAYERS}>
          <i className="fa-solid fa-plus" /> ADD PLAYER
        </button>
      </section>

      <section className="jd-panel">
        <header className="jd-panel-head">
          <span className="jd-num">03</span>
          <h2>The game</h2>
        </header>
        <div className="jd-seg" role="radiogroup" aria-label="Game length">
          {[
            { n: 1, label: "QUICK", detail: "1 round · ~20 min" },
            { n: 2, label: "FULL", detail: "2 rounds · ~45 min" },
          ].map((opt) => (
            <button
              key={opt.n}
              type="button"
              role="radio"
              aria-checked={rounds === opt.n}
              className={`jd-seg-opt ${rounds === opt.n ? "is-on" : ""}`}
              onClick={() => setRounds(opt.n)}
            >
              <strong>{opt.label}</strong>
              <span>{opt.detail}</span>
            </button>
          ))}
        </div>
        <div className="jd-toggles">
          <Toggle on={lastCall} onChange={setLastCall} label="Last Call" detail="Final Jeopardy, with wagers" />
          <Toggle on={drinking} onChange={setDrinking} label="Drinking rules" detail={drinking ? "Sips, shots, the works" : "Sober mode: points only"} />
        </div>
        {drinking && (
          <ul className="jd-rules">
            {HOUSE_RULES.map((r) => (
              <li key={r.icon}>
                <i className={`fa-solid ${r.icon}`} aria-hidden="true" /> {r.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="jd-error" role="alert">{error}</p>}

      <button type="button" className="jd-primary jd-go" onClick={start}>
        LET'S PLAY <i className="fa-solid fa-angles-right" />
      </button>
    </div>
  );
};

export default Setup;
