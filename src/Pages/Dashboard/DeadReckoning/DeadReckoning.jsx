import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MAP_W, MAP_H, LAT_TOP, PX_PER_DEG, LAND_PATH } from "./worldPath";
import { getDailyRounds, randomPerson, dayIndexFor, ROUNDS_PER_DAY } from "./people";
import { isCorrectGuess } from "./fuzzy";
import "./DeadReckoning.css";

/* ============================================================
   DEAD // RECKONING — two pins, one life. A green pin marks a
   birth, a red pin marks a death; identify the famous person.
   Daily: 3 dossiers, shared worldwide, with a leaderboard.
   Namespaced .dr-*.
   ============================================================ */

const BASE_SCORE = 1000;
const WRONG_COST = 75;
const HINT_COSTS = { field: 150, initials: 250 };
const MIN_SOLVE_SCORE = 100;
const STORE_KEY = "dr-daily-v1";
const NAME_KEY = "dr-callsign";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const project = (lat, lng) => ({
  x: (lng + 180) * PX_PER_DEG,
  y: (LAT_TOP - Math.max(-60, Math.min(LAT_TOP, lat))) * PX_PER_DEG,
});

const pct = (v, total) => `${Math.max(2, Math.min(98, (v / total) * 100))}%`;

const scoreFor = (state, solved) => {
  if (!solved) return 0;
  let s = BASE_SCORE - state.wrong.length * WRONG_COST;
  if (state.hints.field) s -= HINT_COSTS.field;
  if (state.hints.initials) s -= HINT_COSTS.initials;
  return Math.max(MIN_SOLVE_SCORE, s);
};

const initials = (name) =>
  name
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z]/.test(w))
    .map((w) => w[0].toUpperCase() + ".")
    .join(" ");

const freshRound = () => ({ wrong: [], hints: { field: false, initials: false } });

const loadDaily = (day) => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (raw[day]) return raw[day];
  } catch (_) {
    /* corrupt storage — start clean */
  }
  return {
    current: 0,
    scores: Array(ROUNDS_PER_DAY).fill(null),
    round: freshRound(),
    done: false,
    submitted: false,
  };
};

const persistDaily = (day, state) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ [day]: state }));
  } catch (_) {
    /* storage full/blocked — non-fatal */
  }
};

/* ---------------- map ---------------- */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const MapPanel = ({ person, revealed, reduce }) => {
  const b = project(person.born.lat, person.born.lng);
  const d = project(person.died.lat, person.died.lng);

  // ---- zoom & pan ----
  // The view lives in a ref and is written to CSS variables inside a rAF so
  // wheel/drag stays off the React render path (see CLAUDE.md motion rules).
  const mapRef = useRef(null);
  const view = useRef({ z: 1, tx: 0, ty: 0 });
  const raf = useRef(0);
  const pointers = useRef(new Map());
  const [zoomLevel, setZoomLevel] = useState(1);

  const applyView = useCallback(() => {
    const el = mapRef.current;
    if (!el) return;
    const { z, tx, ty } = view.current;
    el.style.setProperty("--z", z);
    el.style.setProperty("--tx", `${tx}px`);
    el.style.setProperty("--ty", `${ty}px`);
    // single-finger vertical page scroll stays native until we're zoomed in
    el.style.touchAction = z > 1 ? "none" : "pan-y";
  }, []);

  const scheduleView = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      applyView();
    });
  }, [applyView]);

  const clampView = useCallback(() => {
    const el = mapRef.current;
    if (!el) return;
    const v = view.current;
    v.tx = Math.min(0, Math.max(el.clientWidth * (1 - v.z), v.tx));
    v.ty = Math.min(0, Math.max(el.clientHeight * (1 - v.z), v.ty));
  }, []);

  const zoomAt = useCallback(
    (mx, my, factor) => {
      const v = view.current;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
      if (nz === v.z) return;
      // keep the point under the cursor fixed while the scale changes
      v.tx = mx - ((mx - v.tx) * nz) / v.z;
      v.ty = my - ((my - v.ty) * nz) / v.z;
      v.z = nz;
      clampView();
      scheduleView();
      setZoomLevel(nz);
    },
    [clampView, scheduleView]
  );

  // The +/− buttons zoom toward the midpoint of the two pins (that's what the
  // player is squinting at), falling back to the viewport center when the
  // pair wraps the antimeridian.
  const zoomCenter = (factor) => {
    const el = mapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    let px = w / 2;
    let py = h / 2;
    if (Math.abs(b.x - d.x) <= MAP_W / 2) {
      const v = view.current;
      const scale = w / MAP_W; // world div == map element at z=1
      px = ((b.x + d.x) / 2) * scale * v.z + v.tx;
      py = ((b.y + d.y) / 2) * scale * v.z + v.ty;
      px = Math.max(0, Math.min(w, px));
      py = Math.max(0, Math.min(h, py));
    }
    zoomAt(px, py, factor);
  };

  const resetView = useCallback(() => {
    view.current = { z: 1, tx: 0, ty: 0 };
    pointers.current.clear();
    setZoomLevel(1);
    applyView();
  }, [applyView]);

  // fresh dossier -> fresh framing
  useEffect(() => {
    resetView();
  }, [person, resetView]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // wheel needs preventDefault, so it can't be a passive React handler
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.3 : 1 / 1.3);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e) => {
    if (e.target.closest(".dr-map-zoom")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const v = view.current;
    if (pts.size === 1) {
      // drag to pan (only meaningful when zoomed in)
      if (v.z > 1) {
        v.tx += e.clientX - prev.x;
        v.ty += e.clientY - prev.y;
        clampView();
        scheduleView();
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (pts.size === 2) {
      // pinch: zoom by the distance ratio around the midpoint, pan with it
      const [a, c] = [...pts.entries()].map(([id, p]) =>
        id === e.pointerId ? { x: e.clientX, y: e.clientY, prev: p } : { ...p, prev: p }
      );
      const prevDist = Math.hypot(a.prev.x - c.prev.x, a.prev.y - c.prev.y);
      const dist = Math.hypot(a.x - c.x, a.y - c.y);
      const r = e.currentTarget.getBoundingClientRect();
      const mid = { x: (a.x + c.x) / 2 - r.left, y: (a.y + c.y) / 2 - r.top };
      const prevMid = {
        x: (a.prev.x + c.prev.x) / 2 - r.left,
        y: (a.prev.y + c.prev.y) / 2 - r.top,
      };
      v.tx += mid.x - prevMid.x;
      v.ty += mid.y - prevMid.y;
      if (prevDist > 0) zoomAt(mid.x, mid.y, dist / prevDist);
      else {
        clampView();
        scheduleView();
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };

  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
  };

  const onDoubleClick = (e) => {
    if (e.target.closest(".dr-map-zoom")) return;
    const r = e.currentTarget.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, 2);
  };
  const samePlace = Math.abs(b.x - d.x) < 6 && Math.abs(b.y - d.y) < 6;
  // Skip the connector when the pair wraps the antimeridian — a line dragged
  // across the whole map reads as noise, not a route.
  const wraps = Math.abs(b.x - d.x) > MAP_W / 2;
  const arc = useMemo(() => {
    if (samePlace || wraps) return null;
    const mx = (b.x + d.x) / 2;
    const my = (b.y + d.y) / 2 - Math.min(70, Math.hypot(d.x - b.x, d.y - b.y) * 0.25);
    return `M${b.x},${b.y} Q${mx},${my} ${d.x},${d.y}`;
  }, [b.x, b.y, d.x, d.y, samePlace, wraps]);

  // When the two pins sit close together, side-by-side labels collide — face
  // each label away from the other pin, and stagger the death label downward.
  const crowded = !samePlace && Math.abs(b.x - d.x) < 190 && Math.abs(b.y - d.y) < 60;

  const labelSide = (point, kind) => {
    let side = "right";
    if (crowded) {
      const other = kind === "born" ? d : b;
      side = point.x >= other.x ? "right" : "left";
    }
    // never hang a label off the map edge
    if (point.x > MAP_W * 0.82) side = "left";
    else if (point.x < MAP_W * 0.1) side = "right";
    return side;
  };

  const pin = (p, point, kind, extra = "") => (
    <div
      className={`dr-pin dr-pin--${kind}${reduce ? " is-reduced" : ""}`}
      style={{ left: pct(point.x, MAP_W), top: pct(point.y, MAP_H) }}
    >
      <span className="dr-pin-dot" />
      <span className="dr-pin-ring" />
      <span
        className={`dr-pin-label${labelSide(point, kind) === "left" ? " is-left" : ""}${
          kind === "died" && crowded ? " is-below" : ""
        }${extra}`}
      >
        <em>{kind === "born" ? "BORN" : "DIED"}</em>
        {kind === "born" ? p.born.date : p.died.date}
        {revealed && <i>{kind === "born" ? p.born.place : p.died.place}</i>}
      </span>
    </div>
  );

  return (
    <div
      ref={mapRef}
      className={`dr-map${zoomLevel > 1 ? " is-zoomed" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
      aria-label="World map with birth and death locations"
    >
      <div className="dr-map-world">
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet">
          <path className="dr-land" d={LAND_PATH} />
          {arc && <path className="dr-arc" d={arc} />}
        </svg>
        {samePlace ? (
          <>
            {pin(person, b, "born", " is-above")}
            <div
              className="dr-pin dr-pin--died dr-pin--stacked"
              style={{ left: pct(d.x, MAP_W), top: pct(d.y, MAP_H) }}
            >
              <span className="dr-pin-dot" />
              <span className={`dr-pin-label is-below${d.x > MAP_W * 0.8 ? " is-left" : ""}`}>
                <em>DIED</em>
                {person.died.date}
                {revealed && <i>{person.died.place}</i>}
              </span>
            </div>
          </>
        ) : (
          <>
            {pin(person, b, "born")}
            {pin(person, d, "died")}
          </>
        )}
      </div>
      <div className="dr-map-zoom">
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoomLevel >= MAX_ZOOM}
          onClick={() => zoomCenter(1.6)}
        >
          <i className="fa-solid fa-plus" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoomLevel <= MIN_ZOOM}
          onClick={() => zoomCenter(1 / 1.6)}
        >
          <i className="fa-solid fa-minus" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          disabled={zoomLevel <= MIN_ZOOM}
          onClick={resetView}
        >
          <i className="fa-solid fa-crosshairs" />
        </button>
      </div>
    </div>
  );
};

/* ---------------- leaderboard ---------------- */

const Leaderboard = ({ day, total, submitted, onSubmitted }) => {
  const [entries, setEntries] = useState(null); // null = loading
  const [configured, setConfigured] = useState(true);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (_) {
      return "";
    }
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);

  const refresh = useCallback(() => {
    fetch(`/api/reckoning?day=${day}`)
      .then((r) => r.json())
      .then((data) => {
        setConfigured(data.configured !== false);
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      })
      .catch(() => {
        setConfigured(false);
        setEntries([]);
      });
  }, [day]);

  useEffect(refresh, [refresh]);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim() || sending) return;
    setSending(true);
    setError("");
    fetch("/api/reckoning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, name: name.trim(), score: total }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Submission failed.");
        try {
          localStorage.setItem(NAME_KEY, name.trim());
        } catch (_) {
          /* non-fatal */
        }
        setJustSent(true);
        onSubmitted();
        refresh();
      })
      .catch((err) => setError(err.message))
      .finally(() => setSending(false));
  };

  return (
    <div className="dr-board">
      <h3 className="dr-board-head">
        <i className="fa-solid fa-ranking-star" /> DAILY LEADERBOARD
      </h3>

      {!submitted && configured && (
        <form className="dr-board-form" onSubmit={submit}>
          <input
            className="dr-input"
            type="text"
            maxLength={24}
            placeholder="CALL SIGN"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Leaderboard name"
          />
          <button className="dr-btn dr-btn--primary" type="submit" disabled={sending || !name.trim()}>
            {sending ? "…" : "POST SCORE"}
          </button>
        </form>
      )}
      {justSent && <p className="dr-board-note">Logged. Welcome to the record.</p>}
      {error && <p className="dr-board-err">{error}</p>}

      {entries === null ? (
        <p className="dr-board-note">Pulling records…</p>
      ) : !configured ? (
        <p className="dr-board-note">Leaderboard offline — scores are local only today.</p>
      ) : entries.length === 0 ? (
        <p className="dr-board-note">No entries yet. Set the first mark.</p>
      ) : (
        <ol className="dr-board-list">
          {entries.map((e, i) => (
            <li key={`${e.name}-${i}`}>
              <span className="dr-board-rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="dr-board-name">{e.name}</span>
              <span className="dr-board-score">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

/* ---------------- countdown ---------------- */

const useMidnightCountdown = (active) => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const s = Math.max(0, Math.floor((next - now) / 1000));
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      setLabel(`${h}:${m}:${sec}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);
  return label;
};

/* ---------------- main ---------------- */

const DeadReckoning = () => {
  const reduce = useMemo(prefersReducedMotion, []);
  const { day, rounds: dailyRounds } = useMemo(() => getDailyRounds(), []);

  const [mode, setMode] = useState("daily"); // 'daily' | 'free'
  const [daily, setDaily] = useState(() => loadDaily(day));

  // free-play session
  const [freeRound, setFreeRound] = useState(() => randomPerson());
  const [freeState, setFreeState] = useState(freshRound);
  const [freeTotal, setFreeTotal] = useState(0);
  const [freePlayed, setFreePlayed] = useState(0);
  const freeSeen = useRef(new Set());

  // shared round UI
  const [guess, setGuess] = useState("");
  const [reveal, setReveal] = useState(null); // { person, score, solved }
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  const isDaily = mode === "daily";
  const dailyDone = daily.done;
  const person = isDaily ? dailyRounds[daily.current] : freeRound.person;
  const roundState = isDaily ? daily.round : freeState;
  const roundNum = isDaily ? daily.current + 1 : freePlayed + 1;
  const countdown = useMidnightCountdown(isDaily && dailyDone);

  const setRoundState = (updater) => {
    if (isDaily) {
      setDaily((prev) => {
        const next = { ...prev, round: updater(prev.round) };
        persistDaily(day, next);
        return next;
      });
    } else {
      setFreeState(updater);
    }
  };

  const finishRound = useCallback(
    (solved) => {
      const state = isDaily ? daily.round : freeState;
      const score = scoreFor(state, solved);
      setReveal({ person, score, solved });
      if (isDaily) {
        setDaily((prev) => {
          const scores = prev.scores.slice();
          scores[prev.current] = score;
          const last = prev.current >= ROUNDS_PER_DAY - 1;
          const next = {
            ...prev,
            scores,
            current: last ? prev.current : prev.current + 1,
            round: freshRound(),
            done: last,
          };
          persistDaily(day, next);
          return next;
        });
      } else {
        setFreeTotal((t) => t + score);
        setFreePlayed((n) => n + 1);
      }
    },
    [isDaily, daily.round, freeState, person, day]
  );

  const submitGuess = (e) => {
    e.preventDefault();
    const g = guess.trim();
    if (!g || reveal) return;
    if (isCorrectGuess(g, person)) {
      setGuess("");
      finishRound(true);
    } else {
      setRoundState((r) => ({ ...r, wrong: [...r.wrong, g] }));
      setGuess("");
      setShake(true);
      setTimeout(() => setShake(false), 450);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const takeHint = (kind) => {
    if (roundState.hints[kind] || reveal) return;
    setRoundState((r) => ({ ...r, hints: { ...r.hints, [kind]: true } }));
  };

  const nextRound = () => {
    setReveal(null);
    setGuess("");
    if (!isDaily) {
      freeSeen.current.add(freeRound.index);
      if (freeSeen.current.size >= 150) freeSeen.current.clear();
      setFreeRound(randomPerson(freeSeen.current));
      setFreeState(freshRound());
    }
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const switchMode = (m) => {
    if (m === mode) return;
    setMode(m);
    setReveal(null);
    setGuess("");
  };

  const liveScore = scoreFor(roundState, true);
  const dailyTotal = daily.scores.reduce((a, b) => a + (b || 0), 0);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  const showBoard = isDaily && dailyDone && !reveal;
  // During a reveal the daily pointer has already advanced — keep showing the
  // person the reveal belongs to, never the next dossier's pins.
  const displayPerson = reveal ? reveal.person : person;

  return (
    <div className="dr">
      <div className="dr-shell">
        <span className="dr-corner dr-corner--tl" />
        <span className="dr-corner dr-corner--tr" />
        <span className="dr-corner dr-corner--bl" />
        <span className="dr-corner dr-corner--br" />
        <div className="dr-scan" aria-hidden="true" />

        <header className="dr-titlebar">
          <Link to="/dashboard" className="dr-back" aria-label="Back to console">
            <i className="fa-solid fa-angle-left" />
          </Link>
          <div className="dr-titlebar-text">
            <h1>
              DEAD<span>{"//"}</span>RECKONING
            </h1>
            <span>
              {dateLabel} · DOSSIER #{String(((day % 999) + 999) % 999).padStart(3, "0")}
            </span>
          </div>
          <div className="dr-modes" role="tablist" aria-label="Game mode">
            <button
              type="button"
              role="tab"
              aria-selected={isDaily}
              className={`dr-mode${isDaily ? " is-on" : ""}`}
              onClick={() => switchMode("daily")}
            >
              DAILY
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isDaily}
              className={`dr-mode${!isDaily ? " is-on" : ""}`}
              onClick={() => switchMode("free")}
            >
              FREE
            </button>
          </div>
        </header>

        {/* status strip */}
        <div className="dr-status">
          {isDaily ? (
            <>
              <span className="dr-status-item">
                ROUND <b>{dailyDone ? ROUNDS_PER_DAY : roundNum}/{ROUNDS_PER_DAY}</b>
              </span>
              <span className="dr-status-dots">
                {daily.scores.map((s, i) => (
                  <span
                    key={i}
                    className={`dr-dot${
                      s !== null ? (s > 0 ? " is-hit" : " is-miss") : i === daily.current && !dailyDone ? " is-live" : ""
                    }`}
                  />
                ))}
              </span>
              <span className="dr-status-item">
                TOTAL <b>{dailyTotal}</b>
              </span>
            </>
          ) : (
            <>
              <span className="dr-status-item">
                ROUND <b>{roundNum}</b>
              </span>
              <span className="dr-status-item">
                SESSION <b>{freeTotal}</b>
              </span>
            </>
          )}
          {!showBoard && !reveal && (
            <span className="dr-status-item dr-status-item--right">
              AT STAKE <b>{liveScore}</b>
            </span>
          )}
        </div>

        {showBoard ? (
          /* ---- daily complete: recap + leaderboard ---- */
          <div className="dr-final">
            <div className="dr-final-score">
              <span className="dr-final-label">FINAL RECKONING</span>
              <span className="dr-final-value">
                {dailyTotal}
                <em>/{ROUNDS_PER_DAY * BASE_SCORE}</em>
              </span>
              <div className="dr-final-rounds">
                {daily.scores.map((s, i) => (
                  <span key={i} className="dr-final-chip">
                    R{i + 1} <b>{s || 0}</b>
                  </span>
                ))}
              </div>
              <p className="dr-final-next">
                NEW DOSSIERS IN <b>{countdown}</b>
              </p>
            </div>
            <Leaderboard
              day={day}
              total={dailyTotal}
              submitted={daily.submitted}
              onSubmitted={() =>
                setDaily((prev) => {
                  const next = { ...prev, submitted: true };
                  persistDaily(day, next);
                  return next;
                })
              }
            />
          </div>
        ) : (
          <>
            <MapPanel person={displayPerson} revealed={!!reveal} reduce={reduce} />

            {reveal ? (
              /* ---- round reveal ---- */
              <div className={`dr-reveal${reveal.solved ? " is-solved" : " is-failed"}`}>
                <span className="dr-reveal-tag">
                  {reveal.solved ? "IDENTITY CONFIRMED" : "CASE CLOSED — UNSOLVED"}
                </span>
                <h2 className="dr-reveal-name">{reveal.person.name}</h2>
                <p className="dr-reveal-field">{reveal.person.field}</p>
                <p className="dr-reveal-span">
                  <span className="dr-reveal-b">{reveal.person.born.place}</span>
                  <i className="fa-solid fa-arrow-right-long" />
                  <span className="dr-reveal-d">{reveal.person.died.place}</span>
                </p>
                <p className="dr-reveal-score">
                  +{reveal.score} <em>PTS</em>
                </p>
                <button type="button" className="dr-btn dr-btn--primary" onClick={nextRound} autoFocus>
                  {isDaily && dailyDone ? "SEE THE BOARD" : "NEXT DOSSIER"}{" "}
                  <i className="fa-solid fa-angles-right" />
                </button>
              </div>
            ) : (
              /* ---- guessing UI ---- */
              <div className="dr-console">
                <form className={`dr-guess${shake ? " is-shake" : ""}`} onSubmit={submitGuess}>
                  <i className="fa-solid fa-fingerprint dr-guess-icon" />
                  <input
                    ref={inputRef}
                    className="dr-input dr-guess-input"
                    type="text"
                    placeholder="WHO WAS THIS? (misspellings forgiven)"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    aria-label="Your guess"
                  />
                  <button className="dr-btn dr-btn--primary" type="submit" disabled={!guess.trim()}>
                    GUESS
                  </button>
                </form>

                <div className="dr-tools">
                  <button
                    type="button"
                    className="dr-btn dr-hint"
                    disabled={roundState.hints.field}
                    onClick={() => takeHint("field")}
                  >
                    <i className="fa-solid fa-briefcase" />
                    {roundState.hints.field ? person.field : `OCCUPATION −${HINT_COSTS.field}`}
                  </button>
                  <button
                    type="button"
                    className="dr-btn dr-hint"
                    disabled={roundState.hints.initials}
                    onClick={() => takeHint("initials")}
                  >
                    <i className="fa-solid fa-signature" />
                    {roundState.hints.initials ? initials(person.name) : `INITIALS −${HINT_COSTS.initials}`}
                  </button>
                  <button type="button" className="dr-btn dr-btn--danger" onClick={() => finishRound(false)}>
                    <i className="fa-solid fa-flag" /> GIVE UP
                  </button>
                </div>

                {roundState.wrong.length > 0 && (
                  <ul className="dr-misses" aria-label="Wrong guesses">
                    {roundState.wrong.map((w, i) => (
                      <li key={`${w}-${i}`}>
                        <i className="fa-solid fa-xmark" /> {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <footer className="dr-foot">
          <span>
            <span className="dr-led dr-led--green" /> BORN
          </span>
          <span>
            <span className="dr-led dr-led--red" /> DIED
          </span>
          <span className="dr-foot-mono">200 case files on record</span>
        </footer>
      </div>
    </div>
  );
};

export default DeadReckoning;
