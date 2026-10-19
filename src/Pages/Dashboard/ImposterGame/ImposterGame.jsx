import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CATEGORIES, GROUPS } from "./words";
import { MAX_PLAYERS, MIN_PLAYERS, dealRound, maxImposters } from "./deal";
import "./ImposterGame.css";

/* The roster and rules survive leaving the page; the deck remembers what it dealt. */
const SETUP_KEY = "imp-setup-v1";
const RECENT_KEY = "imp-recent-v1";

const readStore = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeStore = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep playing, just don't remember */
  }
};

const KNOWN_IDS = new Set(CATEGORIES.map((c) => c.id));

const DEFAULT_SETUP = {
  players: ["", "", ""],
  selectedIds: CATEGORIES.map((c) => c.id),
  hint: true,
  imposters: 1,
  chaos: true,
};

/* Whatever's stored is trusted only as far as it still makes sense. */
const loadSetup = () => {
  const s = readStore(SETUP_KEY, {}) || {};
  const players = Array.isArray(s.players)
    ? s.players.filter((p) => typeof p === "string").slice(0, MAX_PLAYERS)
    : [];
  while (players.length < MIN_PLAYERS) players.push("");
  const ids = Array.isArray(s.selectedIds) ? s.selectedIds.filter((id) => KNOWN_IDS.has(id)) : [];
  return {
    players,
    selectedIds: ids.length ? ids : DEFAULT_SETUP.selectedIds,
    hint: typeof s.hint === "boolean" ? s.hint : DEFAULT_SETUP.hint,
    imposters: [1, 2, 3].includes(s.imposters) ? s.imposters : DEFAULT_SETUP.imposters,
    chaos: typeof s.chaos === "boolean" ? s.chaos : DEFAULT_SETUP.chaos,
  };
};

const loadRecent = () => {
  const r = readStore(RECENT_KEY, []);
  return Array.isArray(r) ? r.filter((k) => typeof k === "string") : [];
};

const cleanRoster = (players) => players.map((p) => p.trim()).filter(Boolean);

const ImposterGame = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [setup, setSetup] = useState(loadSetup);
  const { players, selectedIds, hint: hintEnabled, chaos } = setup;
  const [error, setError] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const [focusIdx, setFocusIdx] = useState(null);
  const inputRefs = useRef([]);

  const [phase, setPhase] = useState("setup"); // setup | reveal | play
  const [round, setRound] = useState(null);
  const [current, setCurrent] = useState(0);
  const [showRole, setShowRole] = useState(false);
  const [seen, setSeen] = useState(false);
  const [busted, setBusted] = useState(false);
  const [peek, setPeek] = useState(null);

  useEffect(() => writeStore(SETUP_KEY, setup), [setup]);

  useEffect(() => {
    if (focusIdx === null) return;
    inputRefs.current[focusIdx]?.focus();
    setFocusIdx(null);
  }, [focusIdx]);

  // A second tap confirms CLEAR; it disarms itself if you don't.
  useEffect(() => {
    if (!clearArmed) return undefined;
    const t = setTimeout(() => setClearArmed(false), 2500);
    return () => clearTimeout(t);
  }, [clearArmed]);

  /*
   * A round is its own history entry, so the browser / phone back gesture
   * steps back to setup instead of leaving the game.
   */
  const inRound = Boolean(location.state && location.state.impRound);
  const wasInRound = useRef(inRound);
  useEffect(() => {
    if (wasInRound.current && !inRound) {
      setPhase("setup");
      setPeek(null);
    }
    wasInRound.current = inRound;
  }, [inRound]);

  // A reload mid-round lands on setup; drop the stale round entry with it.
  useEffect(() => {
    if (wasInRound.current) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roster = cleanRoster(players);
  const lowerNames = roster.map((r) => r.toLowerCase());
  const isDupe = (name) => {
    const k = name.trim().toLowerCase();
    return k !== "" && lowerNames.indexOf(k) !== lowerNames.lastIndexOf(k);
  };
  const imposterCap = maxImposters(Math.max(roster.length, MIN_PLAYERS));
  const imposterCount = Math.min(setup.imposters, imposterCap);

  const chosen = CATEGORIES.filter((c) => selectedIds.includes(c.id));
  const poolSize = chosen.reduce((sum, c) => sum + c.words.length, 0);
  const allSelected = selectedIds.length === CATEGORIES.length;

  const patch = (changes) => setSetup((s) => ({ ...s, ...changes }));

  /* ---------- roster ---------- */
  const updatePlayer = (idx, value) =>
    setSetup((s) => ({ ...s, players: s.players.map((n, i) => (i === idx ? value : n)) }));

  const addPlayer = () => {
    if (players.length >= MAX_PLAYERS) return;
    patch({ players: [...players, ""] });
    setFocusIdx(players.length);
  };

  const removePlayer = (idx) =>
    setSetup((s) =>
      s.players.length <= 1 ? s : { ...s, players: s.players.filter((_, i) => i !== idx) }
    );

  const onPlayerKey = (e, i) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (i < players.length - 1) setFocusIdx(i + 1);
    else if (players[i].trim()) addPlayer();
  };

  const clearRoster = () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    patch({ players: ["", "", ""] });
    setFocusIdx(0);
  };

  /* ---------- datasets ---------- */
  const toggleCategory = (id) => {
    setError("");
    setSetup((s) => ({
      ...s,
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    }));
  };

  const toggleAll = () => {
    setError("");
    patch({ selectedIds: allSelected ? [] : CATEGORIES.map((c) => c.id) });
  };

  const toggleGroup = (group) => {
    setError("");
    const ids = group.categories.map((c) => c.id);
    const full = ids.every((id) => selectedIds.includes(id));
    patch({
      selectedIds: full
        ? selectedIds.filter((id) => !ids.includes(id))
        : [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))],
    });
  };

  /* ---------- rounds ---------- */
  const deal = (lastStarter) => {
    const { round: next, recent } = dealRound({
      roster,
      cats: chosen,
      imposterCount,
      chaos,
      recent: loadRecent(),
      lastStarter,
    });
    writeStore(RECENT_KEY, recent);
    setRound(next);
    setCurrent(0);
    setShowRole(false);
    setSeen(false);
    setBusted(false);
    setPeek(null);
    setPhase("reveal");
  };

  const startGame = () => {
    if (roster.length < MIN_PLAYERS) {
      setError(`Need at least ${MIN_PLAYERS} agents in the roster.`);
      return;
    }
    if (new Set(lowerNames).size !== roster.length) {
      setError("Agent callsigns must be unique.");
      return;
    }
    if (chosen.length === 0) {
      setError("Select at least one dataset.");
      return;
    }
    setError("");
    deal(round ? round.roster[round.starter] : null);
    if (!inRound) navigate(location.pathname, { state: { impRound: true } });
  };

  const newRound = () => deal(round.roster[round.starter]);

  // Back to setup with everything intact — popping the round's history entry
  // when there is one, so browser history stays in step.
  const backToSetup = () => {
    if (inRound) navigate(-1);
    else setPhase("setup");
  };

  const toggleRole = () => {
    setShowRole((v) => !v);
    setSeen(true);
  };

  const nextPlayer = () => {
    if (current < round.roster.length - 1) {
      setCurrent((c) => c + 1);
      setShowRole(false);
      setSeen(false);
    } else {
      setPhase("play");
    }
  };

  const roleOf = (seat) => {
    const imposter = round.imposters.includes(seat);
    return {
      name: round.roster[seat],
      imposter,
      hint: imposter && hintEnabled ? round.hintFor[seat] : null,
      word: round.word,
      category: round.category,
    };
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
                {roster.length} / {MAX_PLAYERS}
              </span>
              {players.some((p) => p.trim()) && (
                <button
                  type="button"
                  className={`imp-selectall ${clearArmed ? "is-armed" : ""}`}
                  onClick={clearRoster}
                  onBlur={() => setClearArmed(false)}
                >
                  <i className={`fa-solid ${clearArmed ? "fa-triangle-exclamation" : "fa-eraser"}`} />
                  {clearArmed ? "CONFIRM" : "CLEAR"}
                </button>
              )}
            </header>

            <div className="imp-roster">
              {players.map((name, i) => {
                const dupe = isDupe(name);
                return (
                  <div className="imp-input-row" key={i}>
                    <span className="imp-input-idx">{String(i + 1).padStart(2, "0")}</span>
                    <input
                      ref={(el) => (inputRefs.current[i] = el)}
                      className={`imp-input ${dupe ? "is-dupe" : ""}`}
                      value={name}
                      maxLength={18}
                      placeholder={`AGENT ${i + 1}`}
                      aria-label={`Agent ${i + 1} name`}
                      aria-invalid={dupe || undefined}
                      enterKeyHint={i < players.length - 1 ? "next" : "done"}
                      autoComplete="off"
                      autoCapitalize="words"
                      onChange={(e) => updatePlayer(i, e.target.value)}
                      onKeyDown={(e) => onPlayerKey(e, i)}
                    />
                    <button
                      type="button"
                      className="imp-icon-btn"
                      onClick={() => removePlayer(i)}
                      aria-label={`Remove agent ${i + 1}`}
                      disabled={players.length <= 1}
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
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
                {selectedIds.length} / {CATEGORIES.length} · {poolSize.toLocaleString()} WORDS
              </span>
              <button className="imp-selectall" onClick={toggleAll} type="button">
                <i className={`fa-solid ${allSelected ? "fa-xmark" : "fa-check-double"}`} />
                {allSelected ? "CLEAR" : "ALL"}
              </button>
            </header>

            {GROUPS.map((g) => {
              const on = g.categories.filter((c) => selectedIds.includes(c.id)).length;
              const full = on === g.categories.length;
              return (
                <div className="imp-group" key={g.id}>
                  <div className="imp-group-head">
                    <span>{g.name}</span>
                    <button
                      type="button"
                      className="imp-group-toggle"
                      onClick={() => toggleGroup(g)}
                      aria-label={`${full ? "Deselect" : "Select"} all ${g.name}`}
                    >
                      {full ? "NONE" : "ALL"}
                    </button>
                  </div>
                  <div className="imp-cats">
                    {g.categories.map((c) => {
                      const active = selectedIds.includes(c.id);
                      return (
                        <button
                          type="button"
                          key={c.id}
                          className={`imp-cat ${active ? "is-active" : ""}`}
                          onClick={() => toggleCategory(c.id)}
                          aria-pressed={active}
                        >
                          <span className="imp-cat-check" aria-hidden="true">
                            <i className="fa-solid fa-check" />
                          </span>
                          <i className={c.icon} aria-hidden="true" />
                          <span>{c.name}</span>
                          <span className="imp-cat-n" aria-hidden="true">
                            {c.words.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="imp-panel imp-rules-panel">
            <div className="imp-setting">
              <span className="imp-toggle-label">
                IMPOSTERS
                <em>
                  {setup.imposters > imposterCap
                    ? `${setup.imposters} NEEDS ${setup.imposters * 2 + 1}+ AGENTS`
                    : "HIDDEN AMONG THE CREW"}
                </em>
              </span>
              <div className="imp-seg" role="radiogroup" aria-label="Number of imposters">
                {[1, 2, 3].map((k) => (
                  <button
                    type="button"
                    key={k}
                    role="radio"
                    aria-checked={imposterCount === k}
                    className={`imp-seg-btn ${imposterCount === k ? "is-on" : ""}`}
                    disabled={k > imposterCap}
                    onClick={() => patch({ imposters: k })}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              on={hintEnabled}
              label="IMPOSTER HINT"
              detail={hintEnabled ? "A CLUE LINKED TO THE WORD" : "FLYING BLIND"}
              onClick={() => patch({ hint: !hintEnabled })}
            />
            <Toggle
              on={chaos}
              label="CHAOS ROUNDS"
              detail={chaos ? "RARELY, EVERYONE'S THE IMPOSTER" : "DISABLED"}
              onClick={() => patch({ chaos: !chaos })}
            />
          </section>

          {error && <p className="imp-error">{`// ${error}`}</p>}

          <button type="button" className="imp-deploy" onClick={startGame}>
            <span>INITIALIZE ROUND</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </ImpFrame>
      </div>
    );
  }

  /* ---------- REVEAL (pass-the-device) ---------- */
  if (phase === "reveal" && round) {
    const total = round.roster.length;

    return (
      <div className="imp">
        <ImpFrame
          title="WORD//IMPOSTER"
          subtitle={`SECURE HANDOFF · ${current + 1}/${total}`}
          onBack={backToSetup}
        >
          <div className="imp-progress">
            {round.roster.map((_, i) => (
              <span
                key={i}
                className={`imp-pip ${i < current ? "done" : ""} ${i === current ? "active" : ""}`}
              />
            ))}
          </div>

          {/* Keyed per agent: the card mounts face-down for the next person,
              so the flip-back never flashes their role to the last one. */}
          <RoleCard key={current} role={roleOf(current)} open={showRole} onToggle={toggleRole} />

          {seen && (
            <button type="button" className="imp-deploy imp-deploy--alt" onClick={nextPlayer}>
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
    const imposterNames = round.imposters.map((i) => round.roster[i]);

    return (
      <div className="imp">
        <ImpFrame title="WORD//IMPOSTER" subtitle="ROUND LIVE" onBack={backToSetup}>
          <section className="imp-panel imp-starter">
            <span className="imp-led imp-led--cyan" />
            <p className="imp-starter-label">FIRST TO SPEAK</p>
            <h2 className="imp-starter-name imp-glitch" data-text={round.roster[round.starter]}>
              {round.roster[round.starter]}
            </h2>
            <p className="imp-starter-cat">
              <i className={round.category.icon} /> CATEGORY · {round.category.name}
            </p>
            <ol className="imp-order" aria-label="Speaking order">
              {round.order.map((seat, k) => (
                <li key={seat} className={k === 0 ? "is-first" : ""}>
                  <span>{String(k + 1).padStart(2, "0")}</span>
                  {round.roster[seat]}
                </li>
              ))}
            </ol>
          </section>

          <div className="imp-rules">
            <p>Say one word linked to the secret. Don't be obvious — the imposter is listening.</p>
            <p>Vote when ready. Catch the imposter, or get fooled.</p>
          </div>

          {!busted && (
            <div className="imp-peek">
              <span className="imp-peek-label">FORGOT YOUR ROLE? TAP YOUR NAME</span>
              <div className="imp-peek-names">
                {round.roster.map((name, seat) => (
                  <button
                    type="button"
                    key={seat}
                    className="imp-chip"
                    onClick={() => setPeek(seat)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!busted ? (
            <button
              type="button"
              className="imp-deploy imp-deploy--danger"
              onClick={() => setBusted(true)}
            >
              <i className="fa-solid fa-eye" />
              <span>REVEAL THE TRUTH</span>
            </button>
          ) : (
            <section className="imp-reveal-final">
              {round.allImposter ? (
                <div className="imp-final imp-final--chaos">
                  <span className="imp-role-tag imp-role-tag--bad">{"// SYSTEM BREACH"}</span>
                  <h2 className="imp-glitch" data-text="EVERYONE">
                    EVERYONE
                  </h2>
                  <p>The whole crew was the imposter. Nobody had the word.</p>
                  <p className="imp-final-word">
                    THE HINTS ALL POINTED AT · <strong>{round.word}</strong>
                  </p>
                </div>
              ) : (
                <div className="imp-final">
                  <p className="imp-final-label">
                    {imposterNames.length > 1 ? "THE IMPOSTERS WERE" : "THE IMPOSTER WAS"}
                  </p>
                  {imposterNames.map((name) => (
                    <h2 key={name} className="imp-glitch imp-glitch--bad" data-text={name}>
                      {name}
                    </h2>
                  ))}
                  <p className="imp-final-word">
                    SECRET WORD · <strong>{round.word}</strong>
                  </p>
                  {hintEnabled && (
                    <p className="imp-final-hint">
                      {round.imposters.length > 1
                        ? round.imposters
                            .map((seat) => `${round.roster[seat]}: ${round.hintFor[seat]}`)
                            .join(" · ")
                        : `HINT · ${round.hintFor[round.imposters[0]]}`}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          <div className="imp-actions">
            <button type="button" className="imp-deploy imp-deploy--alt" onClick={newRound}>
              <i className="fa-solid fa-rotate" />
              <span>NEW ROUND</span>
            </button>
            <button type="button" className="imp-ghost" onClick={backToSetup}>
              <i className="fa-solid fa-users-gear" />
              <span>EDIT ROSTER</span>
            </button>
          </div>

          {peek !== null && <PeekSheet role={roleOf(peek)} onClose={() => setPeek(null)} />}
        </ImpFrame>
      </div>
    );
  }

  return null;
};

/* The flip card one agent sees. Its secret only renders while it's open. */
const RoleCard = ({ role, open, onToggle }) => (
  <button
    type="button"
    className={`imp-card ${open ? "is-open" : ""} ${open && role.imposter ? "is-imposter" : ""}`}
    onClick={onToggle}
    aria-label={open ? `Hide ${role.name}'s role` : `Reveal ${role.name}'s role`}
  >
    <div className="imp-card-face imp-card-front">
      <span className="imp-card-tag">CLASSIFIED</span>
      <i className="fa-solid fa-fingerprint imp-card-glyph" />
      <h3>{role.name}</h3>
      <p>TAP TO DECRYPT YOUR ROLE</p>
      <span className="imp-card-hint-line">eyes only — shield the screen</span>
    </div>

    <div className="imp-card-face imp-card-back" aria-live="polite">
      {open && (
        <>
          <span className="imp-card-cat">
            <i className={role.category.icon} /> {role.category.name}
          </span>

          {role.imposter ? (
            <>
              <span className="imp-role-tag imp-role-tag--bad">{"// ROLE"}</span>
              <h3 className="imp-glitch" data-text="IMPOSTER">
                IMPOSTER
              </h3>
              <p className="imp-role-sub">Blend in. Don't get caught.</p>
              {role.hint && (
                <span className="imp-decoy">
                  HINT&nbsp;<strong>{role.hint}</strong>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="imp-role-tag">{"// THE WORD"}</span>
              <h3 className="imp-word">{role.word}</h3>
              <p className="imp-role-sub">Memorize it. Find the imposter.</p>
            </>
          )}
          <span className="imp-card-hint-line">tap to hide</span>
        </>
      )}
    </div>
  </button>
);

/* Re-check one agent's role mid-round, then hand the phone back. */
const PeekSheet = ({ role, onClose }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="imp-sheet" role="dialog" aria-modal="true" aria-label={`${role.name}'s role`}>
      <div className="imp-sheet-inner">
        <RoleCard role={role} open={open} onToggle={() => setOpen((v) => !v)} />
        <button type="button" className="imp-deploy imp-deploy--alt" onClick={onClose}>
          <i className="fa-solid fa-lock" />
          <span>LOCK & RETURN</span>
        </button>
      </div>
    </div>
  );
};

const Toggle = ({ on, label, detail, onClick }) => (
  <button
    type="button"
    className={`imp-toggle ${on ? "is-on" : ""}`}
    onClick={onClick}
    role="switch"
    aria-checked={on}
  >
    <span className="imp-toggle-track">
      <span className="imp-toggle-knob" />
    </span>
    <span className="imp-toggle-label">
      {label}
      <em>{detail}</em>
    </span>
  </button>
);

/* Shared chrome — title bar, corner brackets, scanlines, back control. Mid-round
   the back control returns to setup; from setup it leaves for the dashboard. */
const ImpFrame = ({ title, subtitle, onBack, children }) => (
  <div className="imp-shell">
    <div className="imp-scan" aria-hidden="true" />
    <span className="imp-corner imp-corner--tl" aria-hidden="true" />
    <span className="imp-corner imp-corner--tr" aria-hidden="true" />
    <span className="imp-corner imp-corner--bl" aria-hidden="true" />
    <span className="imp-corner imp-corner--br" aria-hidden="true" />

    <header className="imp-titlebar">
      {onBack ? (
        <button type="button" className="imp-back" onClick={onBack} aria-label="Back to setup">
          <i className="fa-solid fa-chevron-left" />
        </button>
      ) : (
        <Link to="/dashboard" className="imp-back" aria-label="Back to dashboard">
          <i className="fa-solid fa-chevron-left" />
        </Link>
      )}
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
