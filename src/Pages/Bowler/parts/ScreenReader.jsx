import { useState } from "react";
import { readScreen } from "../api";
import { BOWLERS } from "../bowlers";
import { prepareScoreboardPhoto } from "../image";
import Scorecard from "./Scorecard";

/*
 * "Read the screen" on the lane page: snap the alley's overhead score
 * screen and Claude reads the game frame by frame. Nothing is applied until
 * it's been looked at: each bowler the screen shows gets a little score
 * sheet, a who-is-this picker (pre-set when the name matches), and a flag
 * when the screen's own running totals disagree with the read.
 *
 * The read only has pin counts, not which pins stood, so it fills scores,
 * strikes and spares; leaves still come from tapping pins live. A read
 * of a game still going keeps the finished frames, and live scoring picks
 * up from the next one.
 */
const pickDefaults = (bowlers) => {
  const taken = new Set();
  return bowlers.map((b) => {
    if (!b.key || !b.frames.length || taken.has(b.key)) return "";
    taken.add(b.key);
    return b.key;
  });
};

const ScreenReader = ({ getToken, game, draft, onApply }) => {
  const [status, setStatus] = useState("idle"); // idle | reading | read
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null);
  const [assign, setAssign] = useState([]);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setStatus("reading");
    try {
      const photo = await prepareScoreboardPhoto(file);
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(photo.previewUrl); // no preview here
      const result = await readScreen(getToken, photo);
      if (!result.ok) throw new Error(result.error);
      if (!result.read.readable) {
        throw new Error("Couldn't find any frames in that photo. Try a straighter shot of the screen.");
      }
      setRead(result.read);
      setAssign(pickDefaults(result.read.bowlers));
      setStatus("read");
    } catch (err) {
      setStatus("idle");
      setError(err.message || "Couldn't read that photo.");
    }
  }

  const close = () => {
    setRead(null);
    setStatus("idle");
  };

  const chosen = read
    ? read.bowlers
        .map((b, i) => ({ key: assign[i], frames: b.frames }))
        .filter((c) => c.key && c.frames.length)
    : [];
  const replacing = chosen
    .filter((c) => draft.bowlers[c.key].games[game].frames.length > 0)
    .map((c) => BOWLERS.find((b) => b.key === c.key).name);

  function apply() {
    onApply(Object.fromEntries(chosen.map((c) => [c.key, c.frames])));
    close();
  }

  function setWho(index, key) {
    // One row per bowler: picking someone frees the row that had them.
    setAssign((list) => list.map((k, i) => (i === index ? key : k === key && key ? "" : k)));
  }

  return (
    <>
      <label className={`bw-link bw-lm-snap ${status === "reading" ? "is-busy" : ""}`}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={status === "reading"}
          onChange={(e) => {
            handleFile(e.target.files && e.target.files[0]);
            e.target.value = "";
          }}
        />
        <i
          className={`fa-solid ${status === "reading" ? "fa-spinner fa-spin" : "fa-camera"}`}
          aria-hidden="true"
        />{" "}
        {status === "reading" ? "Reading the screen" : "Read the screen"}
      </label>

      {error && (
        <p className="bw-error bw-lm-snap-error" role="alert">
          {error}
        </p>
      )}

      {read && (
        <section className="bw-lm-read" aria-label={`The screen's game ${game + 1}`}>
          <p className="bw-lm-read-head">
            <i className="fa-solid fa-display" aria-hidden="true" /> From the screen, for game {game + 1}
          </p>
          {read.bowlers.map((b, i) => (
            <div key={`${b.name}-${i}`} className="bw-lm-read-row">
              <div className="bw-lm-read-who">
                <span className="bw-lm-read-name">{b.name}</span>
                <select
                  aria-label={`Who is ${b.name}?`}
                  value={assign[i] || ""}
                  disabled={!b.frames.length}
                  onChange={(e) => setWho(i, e.target.value)}
                >
                  <option value="">Skip</option>
                  {BOWLERS.map((bw) => (
                    <option key={bw.key} value={bw.key}>
                      {bw.name}
                    </option>
                  ))}
                </select>
              </div>
              {b.frames.length > 0 ? (
                <>
                  <Scorecard
                    frames={b.frames}
                    label={`${b.name} on the screen: ${b.score}`}
                    className="bw-lm-sheet"
                  />
                  <p className="bw-lm-read-meta">
                    <b>{b.score}</b>
                    {b.complete ? " · all ten frames" : ` · through frame ${b.frames.length}`}
                  </p>
                </>
              ) : (
                <p className="bw-muted">No frames read for {b.name}.</p>
              )}
              {b.mismatch && (
                <p className="bw-lm-read-warn">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> The screen's own
                  running totals don't all match this read. Check it against the screen.
                </p>
              )}
              {b.problem && <p className="bw-muted bw-lm-read-note">{b.problem}</p>}
            </div>
          ))}
          {replacing.length > 0 && (
            <p className="bw-muted bw-lm-read-note">
              Replaces what's on the phone for {replacing.join(" and ")}'s game {game + 1}.
            </p>
          )}
          <div className="bw-lm-read-actions">
            <button type="button" className="bw-btn bw-btn--primary" disabled={!chosen.length} onClick={apply}>
              <i className="fa-solid fa-check" aria-hidden="true" /> Use for game {game + 1}
            </button>
            <button type="button" className="bw-link" onClick={close}>
              Not now
            </button>
          </div>
        </section>
      )}
    </>
  );
};

export default ScreenReader;
