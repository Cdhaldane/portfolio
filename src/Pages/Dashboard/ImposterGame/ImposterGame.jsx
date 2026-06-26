import React, { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORIES } from "./words";
import "./ImposterGame.css";

/* Rare chance the whole crew is the imposter — pure chaos round. */
const ALL_IMPOSTER_CHANCE = 0.06;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

const randInt = (n) => Math.floor(Math.random() * n);

const ImposterGame = () => {
  const [phase, setPhase] = useState("setup"); // setup | reveal | play
  const [players, setPlayers] = useState(["", "", ""]);
  const [selectedIds, setSelectedIds] = useState([CATEGORIES[0].id]);
  const [hintEnabled, setHintEnabled] = useState(true);
  const [error, setError] = useState("");

  // Active round payload.
  const [round, setRound] = useState(null);
  // reveal cursor
  const [current, setCurrent] = useState(0);
  const [showRole, setShowRole] = useState(false);
  // end-of-round disclosure
  const [busted, setBusted] = useState(false);

  const allSelected = selectedIds.length === CATEGORIES.length;

  const toggleCategory = (id) => {
    setError("");
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const toggleAll = () => {
    setError("");
    setSelectedIds(allSelected ? [] : CATEGORIES.map((c) => c.id));
  };

  const updatePlayer = (idx, value) =>
    setPlayers((p) => p.map((n, i) => (i === idx ? value : n)));

  const addPlayer = () =>
    setPlayers((p) => (p.length >= MAX_PLAYERS ? p : [...p, ""]));

  const removePlayer = (idx) =>
    setPlayers((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== idx)));

  const dealRound = useCallback(
    (roster, cats) => {
      const n = roster.length;
      const allImposter = Math.random() < ALL_IMPOSTER_CHANCE;
      const imposters = new Set();
      if (allImposter) {
        roster.forEach((_, i) => imposters.add(i));
      } else {
        imposters.add(randInt(n));
      }

      // Each round draws from a random one of the selected datasets, so the
      // category shown to players stays a meaningful, single clue.
      const cat = cats[randInt(cats.length)];
      const word = cat.words[randInt(cat.words.length)];
      // Decoy hint: a different in-theme word so the imposter can bluff.
      let hint = "";
      if (cat.words.length > 1) {
        do {
          hint = cat.words[randInt(cat.words.length)];
        } while (hint === word);
      }

      return {
        roster,
        cats,
        categoryName: cat.name,
        categoryIcon: cat.icon,
        word,
        hint,
        imposters,
        allImposter,
        starter: roster[randInt(n)],
      };
    },
    []
  );

  const startGame = () => {
    const roster = players.map((p) => p.trim()).filter(Boolean);
    if (roster.length < MIN_PLAYERS) {
      setError(`Need at least ${MIN_PLAYERS} agents in the roster.`);
      return;
    }
    if (new Set(roster.map((r) => r.toLowerCase())).size !== roster.length) {
      setError("Agent callsigns must be unique.");
      return;
    }
    const chosen = CATEGORIES.filter((c) => selectedIds.includes(c.id));
    if (chosen.length === 0) {
      setError("Select at least one dataset.");
      return;
    }
    setError("");
    setRound(dealRound(roster, chosen));
    setCurrent(0);
    setShowRole(false);
    setBusted(false);
    setPhase("reveal");
  };

  const nextPlayer = () => {
    if (!round) return;
    if (current < round.roster.length - 1) {
      setCurrent((c) => c + 1);
      setShowRole(false);
    } else {
      setPhase("play");
    }
  };

  const newRound = () => {
    if (!round) return;
    setRound(dealRound(round.roster, round.cats));
    setCurrent(0);
    setShowRole(false);
    setBusted(false);
    setPhase("reveal");
  };

  const newGame = () => {
    setPhase("setup");
    setRound(null);
    setBusted(false);
  };

  /* ---------- SETUP ---------- */
  if (phase === "setup") {
    return (
      <div className="imp">
        <ImpFrame title="WORD//IMPOSTER" subtitle="ROLE ASSIGNMENT TERMINAL">
          <section className="imp-panel">
            <header className="imp-panel-head">
              <span className="imp-led" />
              <h2>ROSTER</h2>
              <span className="imp-count">
                {players.filter((p) => p.trim()).length} / {MAX_PLAYERS}
              </span>
            </header>

            <div className="imp-roster">
              {players.map((name, i) => (
                <div className="imp-input-row" key={i}>
                  <span className="imp-input-idx">{String(i + 1).padStart(2, "0")}</span>
                  <input
                    className="imp-input"
                    value={name}
                    maxLength={18}
                    placeholder={`AGENT ${i + 1}`}
                    onChange={(e) => updatePlayer(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && i === players.length - 1) addPlayer();
                    }}
                  />
                  <button
                    className="imp-icon-btn"
                    onClick={() => removePlayer(i)}
                    aria-label={`Remove agent ${i + 1}`}
                    disabled={players.length <= 1}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ))}
            </div>

            <button
              className="imp-add"
              onClick={addPlayer}
              disabled={players.length >= MAX_PLAYERS}
            >
              <i className="fa-solid fa-plus" /> ADD AGENT
            </button>
          </section>

          <section className="imp-panel">
            <header className="imp-panel-head">
              <span className="imp-led imp-led--cyan" />
              <h2>DATASETS</h2>
              <span className="imp-count">
                {selectedIds.length} / {CATEGORIES.length} ACTIVE
              </span>
              <button
                className="imp-selectall"
                onClick={toggleAll}
                type="button"
              >
                <i className={`fa-solid ${allSelected ? "fa-xmark" : "fa-check-double"}`} />
                {allSelected ? "CLEAR" : "ALL"}
              </button>
            </header>

            <div className="imp-cats">
              {CATEGORIES.map((c) => {
                const on = selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    className={`imp-cat ${on ? "is-active" : ""}`}
                    onClick={() => toggleCategory(c.id)}
                    aria-pressed={on}
                  >
                    <span className="imp-cat-check" aria-hidden="true">
                      <i className="fa-solid fa-check" />
                    </span>
                    <i className={`fa-solid ${c.icon}`} />
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="imp-panel imp-panel--row">
            <button
              className={`imp-toggle ${hintEnabled ? "is-on" : ""}`}
              onClick={() => setHintEnabled((v) => !v)}
              role="switch"
              aria-checked={hintEnabled}
            >
              <span className="imp-toggle-track">
                <span className="imp-toggle-knob" />
              </span>
              <span className="imp-toggle-label">
                IMPOSTER HINT
                <em>{hintEnabled ? "ENABLED" : "DISABLED"}</em>
              </span>
            </button>
          </section>

          {error && <p className="imp-error">{`// ${error}`}</p>}

          <button className="imp-deploy" onClick={startGame}>
            <span>INITIALIZE ROUND</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </ImpFrame>
      </div>
    );
  }

  /* ---------- REVEAL (pass-the-device) ---------- */
  if (phase === "reveal" && round) {
    const name = round.roster[current];
    const isImposter = round.imposters.has(current);
    const total = round.roster.length;

    return (
      <div className="imp">
        <ImpFrame
          title="WORD//IMPOSTER"
          subtitle={`SECURE HANDOFF · ${current + 1}/${total}`}
        >
          <div className="imp-progress">
            {round.roster.map((_, i) => (
              <span
                key={i}
                className={`imp-pip ${i < current ? "done" : ""} ${
                  i === current ? "active" : ""
                }`}
              />
            ))}
          </div>

          <button
            className={`imp-card ${showRole ? "is-open" : ""} ${
              showRole && isImposter ? "is-imposter" : ""
            }`}
            onClick={() => !showRole && setShowRole(true)}
          >
            <div className="imp-card-face imp-card-front">
              <span className="imp-card-tag">CLASSIFIED</span>
              <i className="fa-solid fa-fingerprint imp-card-glyph" />
              <h3>{name}</h3>
              <p>TAP TO DECRYPT YOUR ROLE</p>
              <span className="imp-card-hint-line">eyes only — shield the screen</span>
            </div>

            <div className="imp-card-face imp-card-back">
              <span className="imp-card-cat">
                <i className={`fa-solid ${round.categoryIcon}`} /> {round.categoryName}
              </span>

              {isImposter ? (
                <>
                  <span className="imp-role-tag imp-role-tag--bad">{"// ROLE"}</span>
                  <h3 className="imp-glitch" data-text="IMPOSTER">
                    IMPOSTER
                  </h3>
                  <p className="imp-role-sub">Blend in. Don't get caught.</p>
                  {hintEnabled && round.hint && (
                    <span className="imp-decoy">
                      DECOY&nbsp;<strong>{round.hint}</strong>
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="imp-role-tag">{"// THE WORD"}</span>
                  <h3 className="imp-word">{round.word}</h3>
                  <p className="imp-role-sub">Memorize it. Find the imposter.</p>
                </>
              )}
            </div>
          </button>

          {showRole && (
            <button className="imp-deploy imp-deploy--alt" onClick={nextPlayer}>
              <i className="fa-solid fa-lock" />
              <span>
                {current < total - 1
                  ? `LOCK & PASS TO ${round.roster[current + 1].toUpperCase()}`
                  : "LOCK & BEGIN"}
              </span>
            </button>
          )}
        </ImpFrame>
      </div>
    );
  }

  /* ---------- PLAY ---------- */
  if (phase === "play" && round) {
    return (
      <div className="imp">
        <ImpFrame title="WORD//IMPOSTER" subtitle="ROUND LIVE">
          <section className="imp-panel imp-starter">
            <span className="imp-led imp-led--cyan" />
            <p className="imp-starter-label">FIRST TO SPEAK</p>
            <h2 className="imp-starter-name imp-glitch" data-text={round.starter}>
              {round.starter}
            </h2>
            <p className="imp-starter-cat">
              <i className={`fa-solid ${round.categoryIcon}`} /> CATEGORY · {round.categoryName}
            </p>
          </section>

          <div className="imp-rules">
            <p>Say one word linked to the secret. Don't be obvious — the imposter is listening.</p>
            <p>Vote when ready. Catch the imposter, or get fooled.</p>
          </div>

          {!busted ? (
            <button className="imp-deploy imp-deploy--danger" onClick={() => setBusted(true)}>
              <i className="fa-solid fa-eye" />
              <span>REVEAL THE TRUTH</span>
            </button>
          ) : (
            <section className="imp-reveal-final">
              {round.allImposter ? (
                <div className="imp-final imp-final--chaos">
                  <span className="imp-role-tag imp-role-tag--bad">{"// SYSTEM BREACH"}</span>
                  <h2 className="imp-glitch" data-text="EVERYONE">EVERYONE</h2>
                  <p>The whole crew was the imposter. There was no word. Chaos.</p>
                </div>
              ) : (
                <div className="imp-final">
                  <p className="imp-final-label">THE IMPOSTER WAS</p>
                  <h2 className="imp-glitch imp-glitch--bad" data-text={round.roster[[...round.imposters][0]]}>
                    {round.roster[[...round.imposters][0]]}
                  </h2>
                  <p className="imp-final-word">
                    SECRET WORD · <strong>{round.word}</strong>
                  </p>
                </div>
              )}
            </section>
          )}

          <div className="imp-actions">
            <button className="imp-deploy imp-deploy--alt" onClick={newRound}>
              <i className="fa-solid fa-rotate" />
              <span>NEW ROUND</span>
            </button>
            <button className="imp-ghost" onClick={newGame}>
              <i className="fa-solid fa-users-gear" />
              <span>EDIT ROSTER</span>
            </button>
          </div>
        </ImpFrame>
      </div>
    );
  }

  return null;
};

/* Shared chrome — title bar, corner brackets, scanlines, back link. */
const ImpFrame = ({ title, subtitle, children }) => (
  <div className="imp-shell">
    <div className="imp-scan" aria-hidden="true" />
    <span className="imp-corner imp-corner--tl" aria-hidden="true" />
    <span className="imp-corner imp-corner--tr" aria-hidden="true" />
    <span className="imp-corner imp-corner--bl" aria-hidden="true" />
    <span className="imp-corner imp-corner--br" aria-hidden="true" />

    <header className="imp-titlebar">
      <Link to="/dashboard" className="imp-back" aria-label="Back to dashboard">
        <i className="fa-solid fa-chevron-left" />
      </Link>
      <div className="imp-titlebar-text">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <span className="imp-status">
        <span className="imp-led imp-led--cyan" /> ONLINE
      </span>
    </header>

    <div className="imp-body">{children}</div>
  </div>
);

export default ImposterGame;
