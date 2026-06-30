import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SAMPLE_WORDS, shuffle } from "./sampleWords";
import "./Fishbowl.css";

/* ============================================================
   FISHBOWL — one bowl of words, three escalating rounds:
   1) DESCRIBE  2) ONE WORD  3) CHARADES.
   Two teams race a clock to clear the bowl. Self-contained
   cyberpunk node, namespaced .fb-*.
   ============================================================ */

const MIN_WORDS = 8;
const TIMER_OPTIONS = [45, 60, 90];
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

const ROUNDS = [
  {
    name: "DESCRIBE",
    icon: "fa-comment-dots",
    rule: "Say anything except the word itself — no rhymes, no spelling.",
  },
  {
    name: "ONE WORD",
    icon: "fa-comment",
    rule: "A single word is your only clue. Make it count.",
  },
  {
    name: "CHARADES",
    icon: "fa-person-running",
    rule: "Act it out. No talking, no sounds, no pointing at objects.",
  },
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Fishbowl = () => {
  const reduced = prefersReducedMotion();

  const [phase, setPhase] = useState("setup"); // setup|ready|playing|turnEnd|roundBreak|gameOver

  // setup
  const [bowl, setBowl] = useState([]);
  const [draft, setDraft] = useState("");
  const [teamNames, setTeamNames] = useState(["TEAM ALPHA", "TEAM BRAVO"]);
  const [timerLen, setTimerLen] = useState(60);
  const [allowSkip, setAllowSkip] = useState(true);
  const [error, setError] = useState("");

  // game
  const [teams, setTeams] = useState([0, 0]); // scores by index
  const [roundIdx, setRoundIdx] = useState(0);
  const [activeTeam, setActiveTeam] = useState(0);
  const [remaining, setRemaining] = useState([]);
  const [current, setCurrent] = useState(null);
  const [turnGuessed, setTurnGuessed] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lastTurnTeam, setLastTurnTeam] = useState(0);

  const endTimeRef = useRef(0);
  const endTurnRef = useRef(() => {});

  /* ---------- setup actions ---------- */
  const addWord = () => {
    const w = draft.trim();
    if (!w) return;
    setBowl((b) => [...b, w]);
    setDraft("");
  };
  const undoWord = () => setBowl((b) => b.slice(0, -1));
  const addSamples = () =>
    setBowl((b) => {
      const have = new Set(b.map((w) => w.toLowerCase()));
      const fresh = SAMPLE_WORDS.filter((w) => !have.has(w.toLowerCase()));
      return [...b, ...fresh];
    });
  const updateTeamName = (idx, value) =>
    setTeamNames((t) => t.map((n, i) => (i === idx ? value : n)));

  const startGame = () => {
    if (bowl.length < MIN_WORDS) {
      setError(`Add at least ${MIN_WORDS} words to the bowl (${bowl.length} so far).`);
      return;
    }
    if (teamNames.some((n) => !n.trim())) {
      setError("Both teams need a name.");
      return;
    }
    setError("");
    setTeams([0, 0]);
    setRoundIdx(0);
    setActiveTeam(0);
    setRemaining(shuffle(bowl));
    setCurrent(null);
    setPhase("ready");
  };

  /* ---------- turn lifecycle ---------- */
  const startTurn = () => {
    if (!remaining.length) return;
    const [next, ...rest] = remaining;
    setCurrent(next);
    setRemaining(rest);
    setTurnGuessed(0);
    setSecondsLeft(timerLen);
    endTimeRef.current = Date.now() + timerLen * 1000;
    setPhase("playing");
  };

  const endRound = () => {
    setLastTurnTeam(activeTeam);
    setPhase(roundIdx < ROUNDS.length - 1 ? "roundBreak" : "gameOver");
  };

  const gotIt = () => {
    if (current == null) return;
    setTeams((t) => t.map((s, i) => (i === activeTeam ? s + 1 : s)));
    setTurnGuessed((n) => n + 1);
    if (!remaining.length) {
      // that was the final word in the bowl for this round
      setCurrent(null);
      endRound();
      return;
    }
    const [next, ...rest] = remaining;
    setCurrent(next);
    setRemaining(rest);
  };

  const skip = () => {
    if (!allowSkip || current == null || !remaining.length) return;
    const [next, ...rest] = remaining;
    setCurrent(next);
    setRemaining([...rest, current]);
  };

  // Kept in a ref so the timer interval always calls the freshest version.
  const endTurn = () => {
    setLastTurnTeam(activeTeam);
    if (current != null) {
      setRemaining((r) => [...r, current]);
      setCurrent(null);
    }
    setPhase("turnEnd");
  };
  endTurnRef.current = endTurn;

  const passTurn = () => {
    setActiveTeam((t) => 1 - t);
    setPhase("ready");
  };

  const startNextRound = () => {
    setRoundIdx((r) => r + 1);
    setRemaining(shuffle(bowl));
    setCurrent(null);
    setActiveTeam((t) => 1 - t);
    setPhase("ready");
  };

  const playAgain = () => {
    setTeams([0, 0]);
    setRoundIdx(0);
    setActiveTeam(0);
    setRemaining(shuffle(bowl));
    setCurrent(null);
    setPhase("ready");
  };

  const newGame = () => {
    setBowl([]);
    setDraft("");
    setError("");
    setPhase("setup");
  };

  /* ---------- countdown ---------- */
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const tick = () => {
      const ms = endTimeRef.current - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0) endTurnRef.current();
    };
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [phase]);

  const round = ROUNDS[roundIdx];

  /* ---------- SETUP ---------- */
  if (phase === "setup") {
    return (
      <div className="fb">
        <FbFrame title="FISHBOWL" subtitle="WORD INTAKE TERMINAL">
          <section className="fb-panel">
            <header className="fb-panel-head">
              <span className="fb-led" />
              <h2>FILL THE BOWL</h2>
              <span className="fb-count">{bowl.length} WORDS</span>
            </header>

            <p className="fb-hint">
              Pass the device around — everyone secretly adds a few words,
              names, or phrases. Aim for ~4–5 each. Only the count shows.
            </p>

            <div className="fb-input-row">
              <input
                className="fb-input"
                value={draft}
                maxLength={42}
                placeholder="ADD A WORD OR PHRASE…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addWord();
                }}
              />
              <button className="fb-icon-btn fb-icon-btn--add" onClick={addWord} aria-label="Add word">
                <i className="fa-solid fa-plus" />
              </button>
            </div>

            <div className="fb-bowl-actions">
              <button className="fb-mini" onClick={undoWord} disabled={!bowl.length}>
                <i className="fa-solid fa-rotate-left" /> UNDO LAST
              </button>
              <button className="fb-mini" onClick={addSamples}>
                <i className="fa-solid fa-dice" /> ADD SAMPLES
              </button>
            </div>
          </section>

          <section className="fb-panel">
            <header className="fb-panel-head">
              <span className="fb-led fb-led--cyan" />
              <h2>TEAMS</h2>
            </header>
            <div className="fb-teams-setup">
              {teamNames.map((name, i) => (
                <input
                  key={i}
                  className={`fb-input fb-team-input fb-team-input--${i}`}
                  value={name}
                  maxLength={20}
                  aria-label={`Team ${i + 1} name`}
                  onChange={(e) => updateTeamName(i, e.target.value)}
                />
              ))}
            </div>
          </section>

          <section className="fb-panel fb-config">
            <div className="fb-config-row">
              <span className="fb-config-label">TURN TIMER</span>
              <div className="fb-segmented">
                {TIMER_OPTIONS.map((t) => (
                  <button
                    key={t}
                    className={`fb-seg ${timerLen === t ? "is-on" : ""}`}
                    onClick={() => setTimerLen(t)}
                    aria-pressed={timerLen === t}
                  >
                    {t}s
                  </button>
                ))}
              </div>
            </div>

            <button
              className={`fb-toggle ${allowSkip ? "is-on" : ""}`}
              onClick={() => setAllowSkip((v) => !v)}
              role="switch"
              aria-checked={allowSkip}
            >
              <span className="fb-toggle-track">
                <span className="fb-toggle-knob" />
              </span>
              <span className="fb-toggle-label">
                ALLOW SKIPS<em>{allowSkip ? "ENABLED" : "DISABLED"}</em>
              </span>
            </button>
          </section>

          {error && <p className="fb-error">{`// ${error}`}</p>}

          <button className="fb-deploy" onClick={startGame}>
            <span>SEAL THE BOWL & START</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </FbFrame>
      </div>
    );
  }

  /* ---------- READY (pass to clue-giver) ---------- */
  if (phase === "ready") {
    return (
      <div className="fb">
        <FbFrame title="FISHBOWL" subtitle={`ROUND ${roundIdx + 1} OF 3`}>
          <RoundBadge round={round} num={roundIdx + 1} />
          <p className="fb-rule">{round.rule}</p>

          <section className="fb-upteam" style={teamAccent(activeTeam)}>
            <span className="fb-upteam-label">ON THE CLOCK</span>
            <h2 className="fb-upteam-name">{teamNames[activeTeam]}</h2>
            <p className="fb-upteam-sub">
              Hand the phone to one clue-giver. Tap start when your team is ready.
            </p>
          </section>

          <Scoreboard teamNames={teamNames} teams={teams} activeTeam={activeTeam} />

          <button className="fb-deploy" onClick={startTurn}>
            <i className="fa-solid fa-play" />
            <span>START {timerLen}s TURN</span>
          </button>
        </FbFrame>
      </div>
    );
  }

  /* ---------- PLAYING ---------- */
  if (phase === "playing") {
    const frac = timerLen ? secondsLeft / timerLen : 0;
    const ringCls = frac > 0.5 ? "ok" : frac > 0.25 ? "warn" : "low";
    return (
      <div className="fb">
        <FbFrame title="FISHBOWL" subtitle={`${round.name} · ${teamNames[activeTeam]}`}>
          <div className="fb-play-top">
            <div className={`fb-timer fb-timer--${ringCls} ${!reduced && secondsLeft <= 10 ? "is-low" : ""}`}>
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className="fb-timer-track" cx="60" cy="60" r={RING_R} />
                <circle
                  className="fb-timer-fill"
                  cx="60"
                  cy="60"
                  r={RING_R}
                  style={{
                    strokeDasharray: RING_C,
                    strokeDashoffset: RING_C * (1 - frac),
                  }}
                />
              </svg>
              <span className="fb-timer-num" aria-label={`${secondsLeft} seconds left`}>
                {secondsLeft}
              </span>
            </div>
            <div className="fb-play-meta">
              <span className="fb-bowl-left">
                <i className="fa-solid fa-layer-group" /> {remaining.length + (current ? 1 : 0)} LEFT
              </span>
              <span className="fb-turn-got">GOT {turnGuessed} THIS TURN</span>
            </div>
          </div>

          <div className="fb-word-stage">
            <span className="fb-word-tag">
              <i className={`fa-solid ${round.icon}`} /> {round.name}
            </span>
            <h2 className="fb-word">{current}</h2>
          </div>

          <div className="fb-play-actions">
            {allowSkip && (
              <button
                className="fb-skip"
                onClick={skip}
                disabled={!remaining.length}
              >
                <i className="fa-solid fa-forward" />
                <span>SKIP</span>
              </button>
            )}
            <button className="fb-got" onClick={gotIt}>
              <i className="fa-solid fa-check" />
              <span>GOT IT</span>
            </button>
          </div>
        </FbFrame>
      </div>
    );
  }

  /* ---------- TURN END (time up) ---------- */
  if (phase === "turnEnd") {
    return (
      <div className="fb">
        <FbFrame title="FISHBOWL" subtitle={`ROUND ${roundIdx + 1} · TIME`}>
          <section className="fb-timeup">
            <i className="fa-solid fa-hourglass-end fb-timeup-glyph" />
            <h2 className="fb-glitch" data-text="TIME!">TIME!</h2>
            <p>
              <strong style={{ color: teamColor(lastTurnTeam) }}>
                {teamNames[lastTurnTeam]}
              </strong>{" "}
              cleared <strong>{turnGuessed}</strong> this turn.
            </p>
          </section>

          <Scoreboard teamNames={teamNames} teams={teams} activeTeam={1 - activeTeam} />

          <p className="fb-rule">
            <i className="fa-solid fa-layer-group" /> {remaining.length} words still
            in the bowl this round.
          </p>

          <button className="fb-deploy" onClick={passTurn}>
            <i className="fa-solid fa-people-arrows" />
            <span>PASS TO {teamNames[1 - activeTeam]}</span>
          </button>
        </FbFrame>
      </div>
    );
  }

  /* ---------- ROUND BREAK (bowl emptied) ---------- */
  if (phase === "roundBreak") {
    const next = ROUNDS[roundIdx + 1];
    return (
      <div className="fb">
        <FbFrame title="FISHBOWL" subtitle={`ROUND ${roundIdx + 1} COMPLETE`}>
          <section className="fb-banner">
            <span className="fb-banner-tag">BOWL EMPTIED</span>
            <h2 className="fb-glitch" data-text={`ROUND ${roundIdx + 1} DONE`}>
              ROUND {roundIdx + 1} DONE
            </h2>
          </section>

          <Scoreboard teamNames={teamNames} teams={teams} activeTeam={-1} />

          <section className="fb-next">
            <span className="fb-next-label">UP NEXT</span>
            <RoundBadge round={next} num={roundIdx + 2} />
            <p className="fb-rule">{next.rule}</p>
            <p className="fb-next-sub">
              Same words, refilled. {teamNames[1 - activeTeam]} starts.
            </p>
          </section>

          <button className="fb-deploy" onClick={startNextRound}>
            <span>START ROUND {roundIdx + 2}</span>
            <i className="fa-solid fa-angles-right" />
          </button>
        </FbFrame>
      </div>
    );
  }

  /* ---------- GAME OVER ---------- */
  const winner =
    teams[0] === teams[1] ? null : teams[0] > teams[1] ? 0 : 1;
  return (
    <div className="fb">
      <FbFrame title="FISHBOWL" subtitle="FINAL TALLY">
        <section className="fb-banner fb-banner--final">
          <span className="fb-banner-tag">GAME OVER</span>
          {winner == null ? (
            <h2 className="fb-glitch" data-text="DEAD HEAT">DEAD HEAT</h2>
          ) : (
            <h2 className="fb-glitch" data-text={teamNames[winner]} style={{ color: teamColor(winner) }}>
              {teamNames[winner]} WINS
            </h2>
          )}
        </section>

        <Scoreboard teamNames={teamNames} teams={teams} activeTeam={winner ?? -1} />

        <div className="fb-actions">
          <button className="fb-deploy" onClick={playAgain}>
            <i className="fa-solid fa-rotate" />
            <span>PLAY AGAIN</span>
          </button>
          <button className="fb-ghost" onClick={newGame}>
            <i className="fa-solid fa-pen-to-square" />
            <span>NEW BOWL</span>
          </button>
        </div>
      </FbFrame>
    </div>
  );
};

/* ---------- helpers / subcomponents ---------- */
const TEAM_COLORS = ["#22f0ff", "#ff2bd6"];
const teamColor = (i) => TEAM_COLORS[i] || "#6f8aa3";
const teamAccent = (i) => ({ "--team": teamColor(i) });

const RoundBadge = ({ round, num }) => (
  <div className="fb-round-badge">
    <span className="fb-round-num">{String(num).padStart(2, "0")}</span>
    <i className={`fa-solid ${round.icon}`} />
    <span className="fb-round-name">{round.name}</span>
  </div>
);

const Scoreboard = ({ teamNames, teams, activeTeam }) => (
  <div className="fb-scoreboard">
    {teamNames.map((name, i) => (
      <div
        key={i}
        className={`fb-score-card ${activeTeam === i ? "is-active" : ""}`}
        style={teamAccent(i)}
      >
        <span className="fb-score-name">{name}</span>
        <span className="fb-score-val">{teams[i]}</span>
      </div>
    ))}
  </div>
);

const FbFrame = ({ title, subtitle, children }) => (
  <div className="fb-shell">
    <div className="fb-scan" aria-hidden="true" />
    <span className="fb-corner fb-corner--tl" aria-hidden="true" />
    <span className="fb-corner fb-corner--tr" aria-hidden="true" />
    <span className="fb-corner fb-corner--bl" aria-hidden="true" />
    <span className="fb-corner fb-corner--br" aria-hidden="true" />

    <header className="fb-titlebar">
      <Link to="/dashboard" className="fb-back" aria-label="Back to dashboard">
        <i className="fa-solid fa-chevron-left" />
      </Link>
      <div className="fb-titlebar-text">
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </div>
      <span className="fb-status">
        <span className="fb-led fb-led--cyan" /> ONLINE
      </span>
    </header>

    <div className="fb-body">{children}</div>
  </div>
);

export default Fishbowl;
