import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  SPECTRUMS,
  shuffle,
  drawSpectrum,
  randomTarget,
  scoreGuess,
} from "./spectrums";
import "./Wavelength.css";

/* ============================================================
   WAVELENGTH — pass-the-phone telepathy party game.
   One player (the PSYCHIC) sees a hidden target on a spectrum
   dial and gives a one-word clue; the team turns the dial to
   match. Self-contained cyberpunk node, namespaced .wv-*.
   ============================================================ */

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- dial geometry (SVG, top semicircle) ---------- */
const VB_W = 320;
const VB_H = 182;
const CX = 160;
const CY = 166;
const R_TRACK = 132; // band / track centerline
const R_NEEDLE = 138; // needle reaches just past the track

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// value 0 → far left (180°), value 1 → far right (0°), 0.5 → top (90°).
const pointOnArc = (value, r) => {
  const a = Math.PI * (1 - clamp01(value));
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
};

// Arc path from the smaller value (left) to the larger (right), over the top.
const arcPath = (vA, vB, r) => {
  const a = pointOnArc(clamp01(vA), r);
  const b = pointOnArc(clamp01(vB), r);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(
    2
  )} ${b.y.toFixed(2)}`;
};

const BAND_DEFS = [
  { from: -0.15, to: -0.09, cls: "wv-band2" },
  { from: 0.09, to: 0.15, cls: "wv-band2" },
  { from: -0.09, to: -0.035, cls: "wv-band3" },
  { from: 0.035, to: 0.09, cls: "wv-band3" },
  { from: -0.035, to: 0.035, cls: "wv-band4" },
];

/* The dial itself — used static-with-target (clue), draggable-blank (guess),
   and revealed-with-needle (reveal). */
const Dial = ({ value, target, showBands, interactive, onChange, reduced }) => {
  const svgRef = useRef(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);

  const valueFromEvent = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return 0.5;
    const rect = svg.getBoundingClientRect();
    const cxPx = rect.left + (CX / VB_W) * rect.width;
    const cyPx = rect.top + (CY / VB_H) * rect.height;
    const angle = Math.atan2(-(clientY - cyPx), clientX - cxPx);
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    return clamp01(1 - clamped / Math.PI);
  }, []);

  const pushValue = useCallback(
    (clientX, clientY) => {
      if (!onChange) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() =>
        onChange(valueFromEvent(clientX, clientY))
      );
    },
    [onChange, valueFromEvent]
  );

  useEffect(() => {
    if (!interactive) return undefined;
    const move = (e) => {
      if (!draggingRef.current) return;
      const t = e.touches ? e.touches[0] : e;
      pushValue(t.clientX, t.clientY);
      if (e.cancelable) e.preventDefault();
    };
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      cancelAnimationFrame(rafRef.current);
    };
  }, [interactive, pushValue]);

  const onPointerDown = (e) => {
    if (!interactive) return;
    draggingRef.current = true;
    pushValue(e.clientX, e.clientY);
  };

  const onKeyDown = (e) => {
    if (!interactive || !onChange) return;
    const step = e.shiftKey ? 0.005 : 0.02;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      onChange(clamp01((value ?? 0.5) - step));
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      onChange(clamp01((value ?? 0.5) + step));
      e.preventDefault();
    }
  };

  const needle = value == null ? null : pointOnArc(value, R_NEEDLE);

  return (
    <svg
      ref={svgRef}
      className={`wv-dial ${interactive ? "is-interactive" : ""} ${
        showBands ? "is-revealed" : ""
      } ${reduced ? "is-reduced" : ""}`}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role={interactive ? "slider" : "img"}
      aria-label={
        interactive
          ? "Spectrum dial — drag or use arrow keys to set the team's guess"
          : "Spectrum dial"
      }
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 100 : undefined}
      aria-valuenow={
        interactive && value != null ? Math.round(value * 100) : undefined
      }
      tabIndex={interactive ? 0 : -1}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {/* neutral track */}
      <path className="wv-track" d={arcPath(0, 1, R_TRACK)} />

      {/* scoring bands (revealed only) */}
      <g className="wv-bands" aria-hidden="true">
        {target != null &&
          BAND_DEFS.map((b, i) => (
            <path
              key={i}
              className={b.cls}
              d={arcPath(target + b.from, target + b.to, R_TRACK)}
            />
          ))}
      </g>

      {/* center hub */}
      <circle className="wv-hub" cx={CX} cy={CY} r={7} />

      {/* needle */}
      {needle && (
        <g className="wv-needle">
          <line x1={CX} y1={CY} x2={needle.x} y2={needle.y} />
          <circle cx={needle.x} cy={needle.y} r={5.5} />
        </g>
      )}
    </svg>
  );
};

const Wavelength = () => {
  const reduced = prefersReducedMotion();

  const [phase, setPhase] = useState("setup"); // setup | clue | guess | reveal
  const [players, setPlayers] = useState(["", ""]);
  const [error, setError] = useState("");

  // Deck "bag" deals spectrums without repeats; it's internal bookkeeping and
  // never drives rendering, so a ref keeps it out of the render cycle.
  const bagRef = useRef();
  if (bagRef.current === undefined) bagRef.current = shuffle(SPECTRUMS);
  const [round, setRound] = useState(null); // { spectrum, target, psychic }
  const [roundNum, setRoundNum] = useState(0);
  const [total, setTotal] = useState(0);

  const [revealedTarget, setRevealedTarget] = useState(false);
  const [clueText, setClueText] = useState("");
  const [guess, setGuess] = useState(0.5);
  const [lastScore, setLastScore] = useState(0);

  const updatePlayer = (idx, value) =>
    setPlayers((p) => p.map((n, i) => (i === idx ? value : n)));
  const addPlayer = () =>
    setPlayers((p) => (p.length >= MAX_PLAYERS ? p : [...p, ""]));
  const removePlayer = (idx) =>
    setPlayers((p) => (p.length <= MIN_PLAYERS ? p : p.filter((_, i) => i !== idx)));

  const dealRound = useCallback((psychic) => {
    const { item, bag } = drawSpectrum(bagRef.current);
    bagRef.current = bag;
    setRound({ spectrum: item, target: randomTarget(), psychic });
  }, []);

  const startGame = () => {
    const roster = players.map((p) => p.trim()).filter(Boolean);
    if (roster.length < MIN_PLAYERS) {
      setError(`Need at least ${MIN_PLAYERS} players.`);
      return;
    }
    if (new Set(roster.map((r) => r.toLowerCase())).size !== roster.length) {
      setError("Player names must be unique.");
      return;
    }
    setError("");
    setPlayers(roster);
    setTotal(0);
    setRoundNum(1);
    setRevealedTarget(false);
    setClueText("");
    setGuess(0.5);
    dealRound(0);
    setPhase("clue");
  };

  const passToTeam = () => {
    setRevealedTarget(false);
    setGuess(0.5);
    setPhase("guess");
  };

  const lockGuess = () => {
    if (!round) return;
    setLastScore(scoreGuess(guess, round.target));
    setTotal((t) => t + scoreGuess(guess, round.target));
    setPhase("reveal");
  };

  const nextRound = () => {
    if (!round) return;
    const nextPsychic = (round.psychic + 1) % players.length;
    setRoundNum((n) => n + 1);
    setRevealedTarget(false);
    setClueText("");
    setGuess(0.5);
    dealRound(nextPsychic);
    setPhase("clue");
  };

  const newGame = () => {
    setPhase("setup");
    setRound(null);
    setTotal(0);
    setRoundNum(0);
  };

  /* ---------- SETUP ---------- */
  if (phase === "setup") {
    const filled = players.filter((p) => p.trim()).length;
    return (
      <div className="wv">
        <WvFrame title="WAVELENGTH" subtitle="TELEPATHY CALIBRATION TERMINAL">
          <section className="wv-panel">
            <header className="wv-panel-head">
              <span className="wv-led" />
              <h2>ROSTER</h2>
              <span className="wv-count">
                {filled} / {MAX_PLAYERS}
              </span>
            </header>

            <div className="wv-roster">
              {players.map((name, i) => (
                <div className="wv-input-row" key={i}>
                  <span className="wv-input-idx">{String(i + 1).padStart(2, "0")}</span>
                  <input
                    className="wv-input"
                    value={name}
                    maxLength={18}
                    placeholder={`PLAYER ${i + 1}`}
                    onChange={(e) => updatePlayer(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && i === players.length - 1) addPlayer();
                    }}
                  />
                  <button
                    className="wv-icon-btn"
                    onClick={() => removePlayer(i)}
                    aria-label={`Remove player ${i + 1}`}
                    disabled={players.length <= MIN_PLAYERS}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ))}
            </div>

            <button
              className="wv-add"
              onClick={addPlayer}
              disabled={players.length >= MAX_PLAYERS}
            >
              <i className="fa-solid fa-plus" /> ADD PLAYER
            </button>
          </section>

          <section className="wv-panel wv-howto">
            <p>
              <strong>1.</strong> The psychic peeks at a hidden target on the
              spectrum and gives a <em>one-word</em> clue.
            </p>
            <p>
              <strong>2.</strong> The rest of the team turns the dial to where
              they think the target sits.
            </p>
            <p>
              <strong>3.</strong> Score by how close you land — bullseye is{" "}
              <em>4</em>, then <em>3</em>, then <em>2</em>. Build a team total.
            </p>
          </section>

          {error && <p className="wv-error">{`// ${error}`}</p>}

          <button className="wv-deploy" onClick={startGame}>
            <span>CALIBRATE & BEGIN</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </WvFrame>
      </div>
    );
  }

  if (!round) return null;
  const psychicName = players[round.psychic];

  /* ---------- CLUE (psychic's private screen) ---------- */
  if (phase === "clue") {
    return (
      <div className="wv">
        <WvFrame title="WAVELENGTH" subtitle={`ROUND ${roundNum} · PSYCHIC HANDOFF`}>
          {!revealedTarget ? (
            <button className="wv-reveal-card" onClick={() => setRevealedTarget(true)}>
              <span className="wv-card-tag">EYES ONLY</span>
              <i className="fa-solid fa-brain wv-card-glyph" />
              <h3>{psychicName}</h3>
              <p>TAP TO RECEIVE THE TARGET</p>
              <span className="wv-card-hint-line">shield the screen from the team</span>
            </button>
          ) : (
            <>
              <SpectrumLabels spectrum={round.spectrum} />
              <Dial target={round.target} showBands value={null} reduced={reduced} />
              <p className="wv-target-note">
                <i className="fa-solid fa-bullseye" /> Give a one-word clue that
                points the team here.
              </p>

              <label className="wv-clue-label" htmlFor="wv-clue">
                LOG YOUR CLUE <em>(optional — or just say it aloud)</em>
              </label>
              <input
                id="wv-clue"
                className="wv-input wv-clue-input"
                value={clueText}
                maxLength={32}
                placeholder="ONE WORD…"
                onChange={(e) => setClueText(e.target.value)}
              />

              <button className="wv-deploy wv-deploy--alt" onClick={passToTeam}>
                <i className="fa-solid fa-lock" />
                <span>HIDE & PASS TO TEAM</span>
              </button>
            </>
          )}
        </WvFrame>
      </div>
    );
  }

  /* ---------- GUESS (team turns the dial) ---------- */
  if (phase === "guess") {
    return (
      <div className="wv">
        <WvFrame title="WAVELENGTH" subtitle={`ROUND ${roundNum} · TEAM GUESS`}>
          <SpectrumLabels spectrum={round.spectrum} />
          {clueText.trim() && (
            <p className="wv-clue-display">
              CLUE · <strong>{clueText.trim()}</strong>
            </p>
          )}
          <Dial
            value={guess}
            target={null}
            showBands={false}
            interactive
            onChange={setGuess}
            reduced={reduced}
          />
          <p className="wv-target-note">
            <i className="fa-solid fa-hand-pointer" /> Drag the dial (or use
            arrow keys) to your team's best guess.
          </p>
          <button className="wv-deploy" onClick={lockGuess}>
            <span>LOCK GUESS</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </WvFrame>
      </div>
    );
  }

  /* ---------- REVEAL ---------- */
  const hit = lastScore > 0;
  return (
    <div className="wv">
      <WvFrame title="WAVELENGTH" subtitle={`ROUND ${roundNum} · SIGNAL LOCKED`}>
        <SpectrumLabels spectrum={round.spectrum} />
        <Dial value={guess} target={round.target} showBands reduced={reduced} />

        <section className={`wv-score ${hit ? "is-hit" : "is-miss"}`}>
          <span className="wv-score-val">+{lastScore}</span>
          <span className="wv-score-label">
            {lastScore === 4
              ? "BULLSEYE — PERFECT READ"
              : lastScore === 3
              ? "DIALED IN"
              : lastScore === 2
              ? "ON THE EDGE"
              : "OFF THE WAVELENGTH"}
          </span>
        </section>

        <div className="wv-tally">
          <div className="wv-tally-item">
            <span className="wv-tally-val">{total}</span>
            <span className="wv-tally-label">TEAM TOTAL</span>
          </div>
          <div className="wv-tally-item">
            <span className="wv-tally-val">{roundNum}</span>
            <span className="wv-tally-label">ROUNDS</span>
          </div>
        </div>

        <div className="wv-actions">
          <button className="wv-deploy" onClick={nextRound}>
            <i className="fa-solid fa-rotate" />
            <span>NEXT ROUND</span>
          </button>
          <button className="wv-ghost" onClick={newGame}>
            <i className="fa-solid fa-users-gear" />
            <span>EDIT ROSTER</span>
          </button>
        </div>
      </WvFrame>
    </div>
  );
};

/* Spectrum end-labels above the dial. */
const SpectrumLabels = ({ spectrum }) => (
  <div className="wv-poles">
    <span className="wv-pole wv-pole--l">
      <i className="fa-solid fa-caret-left" /> {spectrum.left}
    </span>
    <span className="wv-pole-tick" aria-hidden="true" />
    <span className="wv-pole wv-pole--r">
      {spectrum.right} <i className="fa-solid fa-caret-right" />
    </span>
  </div>
);

/* Shared chrome — title bar, corner brackets, scanlines, back link. */
const WvFrame = ({ title, subtitle, children }) => (
  <div className="wv-shell">
    <div className="wv-scan" aria-hidden="true" />
    <span className="wv-corner wv-corner--tl" aria-hidden="true" />
    <span className="wv-corner wv-corner--tr" aria-hidden="true" />
    <span className="wv-corner wv-corner--bl" aria-hidden="true" />
    <span className="wv-corner wv-corner--br" aria-hidden="true" />

    <header className="wv-titlebar">
      <Link to="/dashboard" className="wv-back" aria-label="Back to dashboard">
        <i className="fa-solid fa-chevron-left" />
      </Link>
      <div className="wv-titlebar-text">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <span className="wv-status">
        <span className="wv-led wv-led--cyan" /> ONLINE
      </span>
    </header>

    <div className="wv-body">{children}</div>
  </div>
);

export default Wavelength;
