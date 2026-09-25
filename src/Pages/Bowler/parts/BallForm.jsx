import { useEffect, useId, useRef, useState } from "react";
import { animate, spring } from "animejs";
import { useReducedMotion } from "framer-motion";
import { deleteBall, saveBall } from "../api";
import { BOWLERS } from "../bowlers";
import { BALL_COLORS, BALL_WEIGHTS, DEFAULT_BALL_COLOR, ballSeed } from "../balls";
import BallArt from "./BallArt";

/*
 * Add a ball to a bag, or edit one. The preview is the real render, so
 * picking a colour shows exactly what the bag and the lane will show,
 * with a spin and a squash so the change lands.
 */
const draftFrom = (ball, owner) => ({
  name: ball ? ball.name : "",
  weight: ball && ball.weight ? String(ball.weight) : "",
  color: ball ? ball.color : DEFAULT_BALL_COLOR,
  owner: ball ? ball.owner : owner,
  retired: ball ? ball.retired : false,
});

const BallForm = ({ ball, owner, getToken, thrown = 0, onDone, onCancel }) => {
  const uid = useId();
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState(() => draftFrom(ball, owner));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef(null);
  const spinRef = useRef(null);
  const liftRef = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (reduce) return undefined;
    const turn = animate(spinRef.current, {
      rotate: "+=240",
      ease: spring({ bounce: 0.3, duration: 900 }),
    });
    const squash = animate(liftRef.current, {
      scaleX: [1.14, 1],
      scaleY: [0.86, 1],
      ease: spring({ bounce: 0.55, duration: 700 }),
    });
    return () => {
      turn.pause();
      squash.pause();
    };
  }, [draft.color, reduce]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const custom = !BALL_COLORS.some((c) => c.hex === draft.color);

  async function submit(e) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError("Give the ball a name.");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await saveBall(getToken, {
      id: ball ? ball.id : undefined,
      owner: draft.owner,
      name: draft.name,
      weight: draft.weight === "" ? null : Number(draft.weight),
      color: draft.color,
      retired: draft.retired,
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    await onDone(result.ball);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await deleteBall(getToken, ball.id);
    if (!result.ok) {
      setBusy(false);
      setConfirming(false);
      setError(result.error);
      return;
    }
    await onDone(null);
  }

  return (
    <form
      className="bw-form bw-ballform"
      onSubmit={submit}
      noValidate
      aria-label={ball ? `Edit ${ball.name}` : "Add a ball"}
    >
      <div className="bw-ballform-preview" aria-hidden="true">
        <span ref={liftRef} className="bw-ballform-lift">
          <BallArt ref={spinRef} color={draft.color} seed={ballSeed(ball)} size={96} />
        </span>
        <span className="bw-ballform-shadow" />
      </div>

      <div className="bw-ballform-fields">
        <div className="bw-field">
          <label htmlFor={`${uid}-name`}>Name</label>
          <input
            ref={nameRef}
            id={`${uid}-name`}
            type="text"
            maxLength={40}
            autoComplete="off"
            placeholder="Hammer Black Widow"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div className="bw-ballform-row">
          <div className="bw-field">
            <label htmlFor={`${uid}-weight`}>Weight</label>
            <span className="bw-select">
              <select
                id={`${uid}-weight`}
                value={draft.weight}
                onChange={(e) => set({ weight: e.target.value })}
              >
                <option value="">Not sure</option>
                {BALL_WEIGHTS.map((w) => (
                  <option key={w} value={String(w)}>
                    {w} lb
                  </option>
                ))}
              </select>
              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </span>
          </div>

          <fieldset className="bw-seg">
            <legend>Bag</legend>
            <div className="bw-seg-opts">
              {BOWLERS.map(({ key, name }) => (
                <label key={key} className="bw-seg-opt">
                  <input
                    type="radio"
                    name={`${uid}-owner`}
                    value={key}
                    checked={draft.owner === key}
                    onChange={() => set({ owner: key })}
                  />
                  <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" /> {name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="bw-swatches">
          <legend>Colour</legend>
          <div className="bw-swatch-row">
            {BALL_COLORS.map((c) => (
              <label key={c.hex} className="bw-swatch" style={{ "--ball": c.hex }} title={c.name}>
                <input
                  type="radio"
                  name={`${uid}-color`}
                  value={c.hex}
                  checked={draft.color === c.hex}
                  onChange={() => set({ color: c.hex })}
                />
                <span className="sr-only">{c.name}</span>
              </label>
            ))}
            <label
              className={`bw-swatch bw-swatch--custom ${custom ? "is-on" : ""}`}
              style={custom ? { "--ball": draft.color } : undefined}
              title="Any colour"
            >
              <input
                type="color"
                value={draft.color}
                onChange={(e) => set({ color: e.target.value.toLowerCase() })}
              />
              <i className="fa-solid fa-eye-dropper" aria-hidden="true" />
              <span className="sr-only">Any colour</span>
            </label>
          </div>
        </fieldset>

        {ball && (
          <label className="bw-ballform-retire">
            <input
              type="checkbox"
              checked={draft.retired}
              onChange={(e) => set({ retired: e.target.checked })}
            />
            Retired
            <span className="bw-muted">keeps its stats, leaves the picker</span>
          </label>
        )}

        {error && (
          <p className="bw-error" role="alert">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {error}
          </p>
        )}

        <div className="bw-actions">
          <button type="submit" className="bw-btn bw-btn--primary" disabled={busy}>
            <i className={`fa-solid ${busy ? "fa-spinner fa-spin" : "fa-check"}`} aria-hidden="true" />{" "}
            {busy ? "Saving" : ball ? "Save ball" : "Put it in the bag"}
          </button>
          <button type="button" className="bw-btn bw-btn--ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {ball &&
            (confirming ? (
              <span className="bw-ballform-confirm">
                <button type="button" className="bw-link bw-link--danger" disabled={busy} onClick={remove}>
                  Yes, delete{thrown ? ` (unlinks ${thrown} ${thrown === 1 ? "game" : "games"})` : ""}
                </button>
                <button type="button" className="bw-link" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="bw-link bw-link--danger" onClick={() => setConfirming(true)}>
                <i className="fa-solid fa-trash-can" aria-hidden="true" /> Delete
              </button>
            ))}
        </div>
      </div>
    </form>
  );
};

export default BallForm;
