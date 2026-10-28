import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { loadSeries, saveNight } from "./api";
import { BOWLERS, BOWLER_BY_KEY, GAMES, formatNight, todayLocal } from "./bowlers";
import { lastBalls, pickerGroups } from "./balls";
import { nights } from "./stats";
import {
  MAX_BOARD,
  MIN_BOARD,
  addRoll,
  addRollToFrame,
  isSplit,
  maxScore,
  nextRoll,
  playFrame,
  scoreGame,
  undoRoll,
} from "./scoring";
import {
  blankDraft,
  clearDraft,
  draftFromNight,
  draftStarted,
  draftToSave,
  gameDone,
  gameTotal,
  loadDraft,
  storeDraft,
  withDefaultBalls,
} from "./laneDraft";
import PinDeck from "./parts/PinDeck";
import Scorecard from "./parts/Scorecard";
import { BallSelect } from "./parts/BallPicker";
import "./Bowler.css";
import "./parts/balls.css";
import "./LaneMode.css";

/*
 * /bowler/lane: score a night ball by ball at the alley, one-handed on a
 * phone. Tap the pins still standing (or Strike / Spare / Gutter) and the
 * card, the running score and the best possible finish update as you go.
 *
 * Every ball rewrites the draft in localStorage (laneDraft.js), so a closed
 * app or no signal loses nothing; the night goes to the server in one save
 * once the games are done. Tapping a finished frame on the card re-enters
 * it: frames 1-9 each get a fresh rack, so redoing one never breaks the
 * rest, only the totals move.
 */
const EMPTY_FRAME = { rolls: [], standing: [] };
const DETAILS_PREF = "bowler-lane-details";

const buzz = (pattern) => {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* no haptics here */
  }
};

const readPref = () => {
  try {
    return window.localStorage.getItem(DETAILS_PREF) === "1";
  } catch {
    return false;
  }
};

const writePref = (on) => {
  try {
    window.localStorage.setItem(DETAILS_PREF, on ? "1" : "0");
  } catch {
    /* falls back to closed next time */
  }
};

const clampBoard = (n) => Math.min(MAX_BOARD, Math.max(MIN_BOARD, n));

const Board = ({ id, label, value, start, onChange }) => (
  <div className="bw-lm-board">
    <label htmlFor={id}>{label}</label>
    <div className="bw-lm-stepper">
      <button
        type="button"
        aria-label={`${label}: one board left`}
        onClick={() => onChange(value === "" ? start : clampBoard(value - 1))}
      >
        <i className="fa-solid fa-minus" aria-hidden="true" />
      </button>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="-"
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
          onChange(digits === "" ? "" : clampBoard(Number(digits)));
        }}
      />
      <button
        type="button"
        aria-label={`${label}: one board right`}
        onClick={() => onChange(value === "" ? start : clampBoard(value + 1))}
      >
        <i className="fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
  </div>
);

const LaneMode = () => {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => loadDraft() || blankDraft(todayLocal()));
  const [series, setSeries] = useState(null);
  const [bag, setBag] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [standing, setStanding] = useState([]); // pins tapped as still up
  const [pocket, setPocket] = useState(null); // first-ball details for this frame
  const [target, setTarget] = useState(""); //   (the target carries over)
  const [actual, setActual] = useState("");
  const [redo, setRedo] = useState(null); // { frame, work } while re-entering a frame
  const [offer, setOffer] = useState(null); // a saved night waiting on "replace the draft?"
  const [said, setSaid] = useState("");
  const [flash, setFlash] = useState(null);
  const [details, setDetails] = useState(readPref);
  const [error, setError] = useState(null); // { at: "lane" | "save", text }
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => storeDraft(draft), [draft]);

  const load = useCallback(async () => {
    const result = await loadSeries(getToken);
    if (result.ok) {
      setSeries(result.series);
      setBag(result.balls);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const usual = useMemo(() => (series ? lastBalls(series, bag) : {}), [series, bag]);
  useEffect(() => setDraft((d) => withDefaultBalls(d, usual)), [usual]);

  // ?night=YYYY-MM-DD (a score sheet's "Edit frames") loads a saved night,
  // unless a different night is mid-entry here; then it asks first.
  const wanted = params.get("night");
  useEffect(() => {
    if (!wanted || series === null) return;
    setParams({}, { replace: true });
    const night = nights(series).find((n) => n.date === wanted);
    if (!night) return;
    const current = draftRef.current;
    const next = draftFromNight(wanted, night.rows);
    if (!draftStarted(current)) setDraft(next);
    else if (current.bowledOn !== wanted) setOffer(next);
  }, [wanted, series, setParams]);

  const who = draft.active.bowler;
  const gi = draft.active.game;
  const game = draft.bowlers[who].games[gi];
  const framed = game.mode === "frames";
  const work = redo ? playFrame(redo.work, redo.frame) : null;
  const at = redo
    ? { frame: redo.frame, roll: work.shots.length, rack: work.next }
    : nextRoll(game.frames);
  const fresh = Boolean(at && at.rack.fresh);
  const leave = standing.slice().sort((a, b) => a - b);
  const score = scoreGame(game.frames);
  const best = maxScore(game.frames);
  const ready = draftToSave(draft);
  const groups = pickerGroups(bag, who, game.ball ? [Number(game.ball)] : []);

  const patchGame = (patch) =>
    setDraft((d) => {
      const games = d.bowlers[who].games.map((g, i) =>
        i === gi ? { ...g, ...(typeof patch === "function" ? patch(g) : patch) } : g
      );
      return { ...d, bowlers: { ...d.bowlers, [who]: { games } } };
    });

  const clearBall = () => {
    setStanding([]);
    setError(null);
  };

  const go = (bowler, index) => {
    setDraft((d) => ({ ...d, active: { bowler, game: index } }));
    setRedo(null);
    setPocket(null);
    setActual("");
    setSaid("");
    clearBall();
  };

  const toggle = (pin) =>
    setStanding((s) => (s.includes(pin) ? s.filter((p) => p !== pin) : [...s, pin]));

  function firstBallDetails() {
    const extra = {};
    if (pocket !== null) extra.pocket = pocket;
    if (target !== "") extra.target = target;
    if (actual !== "") extra.actual = actual;
    return extra;
  }

  function announce(left) {
    const mark = left.length === 0 ? (fresh ? "Strike" : "Spare") : fresh && isSplit(left) ? "Split" : null;
    const down = at.rack.count - left.length;
    setSaid(mark ? `${mark}!` : `${down} down${left.length ? `, ${left.join("-")} left` : ""}`);
    if (mark) setFlash({ id: Date.now(), text: mark });
    if (left.length === 0) buzz(fresh ? [14, 60, 14] : 12);
  }

  function record(left) {
    if (!at) return;
    const extra = at.roll === 0 ? firstBallDetails() : {};
    if (redo) {
      const result = addRollToFrame(redo.work, redo.frame, left);
      if (!result.ok) {
        setError({ at: "lane", text: result.error });
        return;
      }
      const next = { ...result.value, ...extra };
      if (playFrame(next, redo.frame).next === null) {
        patchGame((g) => ({ frames: g.frames.map((f, i) => (i === redo.frame ? next : f)) }));
        setRedo(null);
      } else {
        setRedo({ ...redo, work: next });
      }
    } else {
      const result = addRoll(game.frames, left);
      if (!result.ok) {
        setError({ at: "lane", text: result.error });
        return;
      }
      patchGame({ frames: result.value.map((f, i) => (i === at.frame ? { ...f, ...extra } : f)) });
    }
    if (at.roll === 0) {
      setPocket(null);
      setActual("");
    }
    clearBall();
    announce(left);
  }

  function undo() {
    clearBall();
    setSaid("");
    if (redo) {
      if (redo.work.rolls.length) setRedo({ ...redo, work: undoRoll([redo.work])[0] || EMPTY_FRAME });
      else setRedo(null);
      return;
    }
    patchGame((g) => ({ frames: undoRoll(g.frames) }));
  }

  function reenter(index) {
    const old = game.frames[index];
    setRedo({ frame: index, work: EMPTY_FRAME });
    setPocket(typeof old.pocket === "boolean" ? old.pocket : null);
    setActual(old.actual ?? "");
    if (old.target !== undefined) setTarget(old.target);
    setSaid("");
    clearBall();
  }

  const toggleDetails = () =>
    setDetails((on) => {
      writePref(!on);
      return !on;
    });

  async function save() {
    if (!ready.ok) {
      setError({ at: "save", text: ready.error });
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveNight(getToken, ready.value);
    setSaving(false);
    if (!result.ok) {
      setError({ at: "save", text: result.error });
      return;
    }
    clearDraft();
    const { bowledOn, entries } = ready.value;
    navigate("/bowler", { state: { saved: { bowledOn, entries } } });
  }

  function startOver() {
    setDraft(blankDraft(todayLocal(), usual));
    setRedo(null);
    setDiscarding(false);
    setSaid("");
    clearBall();
  }

  const over = framed && !redo && at === null;
  const name = BOWLER_BY_KEY[who].name;
  const seriesSoFar = (key) =>
    draft.bowlers[key].games.reduce((sum, g) => sum + (gameTotal(g) || 0), 0);

  return (
    <div className="bw bw-lm">
      <Helmet>
        <title>Lane | Bowler</title>
      </Helmet>

      <header className="bw-lm-top">
        <Link to="/bowler" className="bw-home">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Bowler
        </Link>
        <label className="bw-lm-date">
          <span className="sr-only">League night</span>
          <i className="fa-regular fa-calendar" aria-hidden="true" />
          <input
            type="date"
            value={draft.bowledOn}
            max={todayLocal()}
            onChange={(e) => e.target.value && setDraft((d) => ({ ...d, bowledOn: e.target.value }))}
          />
        </label>
      </header>

      {offer && (
        <div className="bw-lm-offer" role="alert">
          <p>
            There's an unsaved night from {formatNight(draft.bowledOn)} on this phone.
          </p>
          <div>
            <button
              type="button"
              className="bw-btn bw-btn--ghost"
              onClick={() => {
                setDraft(offer);
                setOffer(null);
                go(offer.active.bowler, 0);
              }}
            >
              Edit {formatNight(offer.bowledOn)} instead
            </button>
            <button type="button" className="bw-link" onClick={() => setOffer(null)}>
              Keep going
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <p className="bw-lm-note">
          <i className="fa-solid fa-wifi" aria-hidden="true" /> Can't reach the server, so the
          ball bag isn't loaded. Scoring still works and stays on this phone until you save.{" "}
          <button type="button" className="bw-link" onClick={load}>
            Retry
          </button>
        </p>
      )}

      <div className="bw-lm-who" role="tablist" aria-label="Bowler">
        {BOWLERS.map((b) => (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={who === b.key}
            className={`bw-lm-who-tab bw-lm-who-tab--${b.key} ${who === b.key ? "is-on" : ""}`}
            onClick={() => go(b.key, gi)}
          >
            <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" />
            {b.name}
            <small>{seriesSoFar(b.key) || ""}</small>
          </button>
        ))}
      </div>

      <div className="bw-lm-games" role="tablist" aria-label="Game">
        {draft.bowlers[who].games.map((g, i) => {
          const total = gameTotal(g);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={gi === i}
              className={`bw-lm-game ${gi === i ? "is-on" : ""}`}
              onClick={() => go(who, i)}
            >
              <span>Game {i + 1}</span>
              <b>
                {total ?? "-"}
                {gameDone(g) && <i className="fa-solid fa-check" aria-label="finished" />}
              </b>
            </button>
          );
        })}
      </div>

      {framed ? (
        <section className="bw-lm-play" aria-label={`${name}, game ${gi + 1}`}>
          <Scorecard
            frames={game.frames}
            current={at ? at.frame : null}
            onPick={reenter}
            label={`${name}, game ${gi + 1} score sheet`}
            className="bw-lm-sheet"
          />

          <div className="bw-lm-status">
            <p className="bw-lm-where">
              {redo
                ? `Re-entering frame ${redo.frame + 1}`
                : at
                ? `Frame ${at.frame + 1} · ball ${at.roll + 1}`
                : `Game ${gi + 1} is in`}
            </p>
            <p className="bw-lm-score">
              <span>{score.total}</span>
              {!score.complete && <small>max {best}</small>}
            </p>
          </div>

          {over ? (
            <div className="bw-lm-over">
              <p>
                <span className="bw-lm-over-score">{score.total}</span>
                {score.total === 300 ? "Perfect. Frame that card." : `${name}, game ${gi + 1}`}
              </p>
              {gi < GAMES - 1 ? (
                <button type="button" className="bw-btn bw-btn--primary" onClick={() => go(who, gi + 1)}>
                  Game {gi + 2} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              ) : (
                <p className="bw-muted">That's the set. Save it below when everyone's done.</p>
              )}
              <button type="button" className="bw-link" onClick={undo}>
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Undo last ball
              </button>
            </div>
          ) : (
            <>
              <div className="bw-lm-deck">
                <PinDeck rack={at.rack} standing={standing} onToggle={toggle} />
                {flash && (
                  <span
                    key={flash.id}
                    className="bw-lm-flash"
                    aria-hidden="true"
                    onAnimationEnd={() => setFlash(null)}
                  >
                    {flash.text}
                  </span>
                )}
              </div>

              <p className="bw-lm-leave" aria-live="polite">
                {leave.length ? (
                  <>
                    Leave {leave.join("-")}
                    {fresh && isSplit(leave) && <span className="bw-lm-split">Split</span>}
                  </>
                ) : (
                  said || (fresh ? "Tap any pins left standing" : "Tap the pins still up")
                )}
              </p>

              <div className="bw-lm-actions">
                <button type="button" className="bw-lm-act" onClick={() => record(at.rack.pins)}>
                  {fresh ? "Gutter" : "Miss"}
                </button>
                <button
                  type="button"
                  className="bw-lm-act bw-lm-act--enter"
                  disabled={!standing.length}
                  onClick={() => record(leave)}
                >
                  {standing.length ? `${at.rack.count - standing.length} down` : "Enter"}
                </button>
                <button type="button" className="bw-lm-act bw-lm-act--mark" onClick={() => record([])}>
                  {fresh ? "Strike" : "Spare"}
                </button>
              </div>

              {error && error.at === "lane" && (
                <p className="bw-error" role="alert">
                  {error.text}
                </p>
              )}

              <div className="bw-lm-tools">
                <button
                  type="button"
                  className="bw-link"
                  onClick={undo}
                  disabled={!redo && !game.frames.length}
                >
                  <i className="fa-solid fa-rotate-left" aria-hidden="true" />{" "}
                  {redo && !redo.work.rolls.length ? "Cancel re-entry" : "Undo ball"}
                </button>
                {at.roll === 0 && (
                  <button type="button" className="bw-link" aria-expanded={details} onClick={toggleDetails}>
                    <i className="fa-solid fa-sliders" aria-hidden="true" /> Boards & pocket
                  </button>
                )}
                {!redo && !game.frames.length && (
                  <button type="button" className="bw-link" onClick={() => patchGame({ mode: "score", score: "" })}>
                    <i className="fa-solid fa-keyboard" aria-hidden="true" /> Just the score
                  </button>
                )}
              </div>

              {details && at.roll === 0 && (
                <div className="bw-lm-details">
                  <div className="bw-lm-pocket" role="group" aria-label="Did the first ball hit the pocket?">
                    <span>Pocket</span>
                    <button
                      type="button"
                      aria-pressed={pocket === true}
                      onClick={() => setPocket(pocket === true ? null : true)}
                    >
                      Hit
                    </button>
                    <button
                      type="button"
                      aria-pressed={pocket === false}
                      onClick={() => setPocket(pocket === false ? null : false)}
                    >
                      Missed
                    </button>
                  </div>
                  <Board id="bw-lm-target" label="Target board" value={target} start={10} onChange={setTarget} />
                  <Board
                    id="bw-lm-actual"
                    label="Crossed at"
                    value={actual}
                    start={target === "" ? 10 : target}
                    onChange={setActual}
                  />
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="bw-lm-typed" aria-label={`${name}, game ${gi + 1}`}>
          <label htmlFor="bw-lm-score">
            {name}'s game {gi + 1}
          </label>
          <input
            id="bw-lm-score"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={game.score}
            onChange={(e) => patchGame({ score: e.target.value.replace(/\D/g, "").slice(0, 3) })}
          />
          <button type="button" className="bw-link" onClick={() => patchGame({ mode: "frames", score: "" })}>
            <i className="fa-solid fa-hand-pointer" aria-hidden="true" /> Track frames instead
          </button>
        </section>
      )}

      <div className="bw-lm-meta">
        <div className="bw-lm-field">
          <label htmlFor="bw-lm-lanes">Lanes</label>
          <div className="bw-lm-lanes">
            <input
              id="bw-lm-lanes"
              inputMode="numeric"
              autoComplete="off"
              placeholder="13"
              value={game.lanes}
              onChange={(e) =>
                patchGame({ lanes: e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 2) })
              }
            />
            {game.lanes && <span aria-hidden="true">&ndash;{Number(game.lanes) + 1}</span>}
          </div>
        </div>
        {groups.length > 0 && (
          <div className="bw-lm-field">
            <label htmlFor="bw-lm-ball">Ball</label>
            <BallSelect
              id="bw-lm-ball"
              value={game.ball}
              groups={groups}
              onChange={(v) => patchGame({ ball: v })}
            />
          </div>
        )}
      </div>

      <section className="bw-lm-save" aria-label="Save the night">
        <div className="bw-lm-field">
          <label htmlFor="bw-lm-note">Note (optional)</label>
          <input
            id="bw-lm-note"
            type="text"
            maxLength={200}
            placeholder="Oily lanes, new ball..."
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
        </div>
        <p className={`bw-lm-ready ${ready.ok ? "is-ok" : ""}`}>
          {ready.ok
            ? ready.value.entries
                .map((e) => `${BOWLER_BY_KEY[e.bowler].name} ${e.games.reduce((a, b) => a + b, 0)}`)
                .join(" · ")
            : ready.error}
        </p>
        {error && error.at === "save" && (
          <p className="bw-error" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {error.text}
          </p>
        )}
        <div className="bw-lm-savebar">
          <button
            type="button"
            className="bw-btn bw-btn--primary"
            disabled={!ready.ok || saving}
            onClick={save}
          >
            <i className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-bowling-ball"}`} aria-hidden="true" />{" "}
            {saving ? "Saving" : "Save night"}
          </button>
          {draftStarted(draft) &&
            (discarding ? (
              <>
                <button type="button" className="bw-link bw-link--danger" onClick={startOver}>
                  Yes, clear it
                </button>
                <button type="button" className="bw-link" onClick={() => setDiscarding(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="bw-link" onClick={() => setDiscarding(true)}>
                Start over
              </button>
            ))}
        </div>
      </section>
    </div>
  );
};

export default LaneMode;
