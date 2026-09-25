import { useEffect, useRef } from "react";
import { animate, spring } from "animejs";
import { useReducedMotion } from "framer-motion";
import { ballLabel, ballSeed, byId, pickerGroups } from "../balls";
import BallArt from "./BallArt";

/*
 * Which ball, inside one bowler's score sheet. One pick covers the night;
 * "Switched balls?" splits it into a pick per game, lined up under the
 * game boxes. `value` is always three select values ("" = not tracked),
 * so the form never has to care which mode it's in.
 */
const PickOrb = ({ ball }) => {
  const spinRef = useRef(null);
  const liftRef = useRef(null);
  const reduce = useReducedMotion();
  const first = useRef(true);
  const id = ball ? ball.id : null;

  // Picking a ball gives it a spin, so the change registers at a glance.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (reduce || id === null || !spinRef.current) return undefined;
    const turn = animate(spinRef.current, {
      rotate: "+=320",
      ease: spring({ bounce: 0.35, duration: 800 }),
    });
    const pop = animate(liftRef.current, {
      scale: [0.7, 1],
      ease: spring({ bounce: 0.5, duration: 600 }),
    });
    return () => {
      turn.pause();
      pop.pause();
    };
  }, [id, reduce]);

  return (
    <span ref={liftRef} className="bw-pick-orb">
      {ball ? (
        <BallArt ref={spinRef} color={ball.color} seed={ballSeed(ball)} size={30} />
      ) : (
        <span className="bw-pick-none" aria-hidden="true" />
      )}
    </span>
  );
};

const Select = ({ id, value, disabled, groups, onChange }) => (
  <span className="bw-select">
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not tracked</option>
      {groups.map((g) => (
        <optgroup key={g.owner} label={g.label}>
          {g.balls.map((b) => (
            <option key={b.id} value={String(b.id)}>
              {ballLabel(b)}
              {b.retired ? " (retired)" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
    <i className="fa-solid fa-chevron-down" aria-hidden="true" />
  </span>
);

const BallPicker = ({ bowler, balls, value, split, disabled, onChange, onAddBall }) => {
  const selected = value.filter(Boolean).map(Number);
  const groups = pickerGroups(balls, bowler, selected);
  const lookup = byId(balls);
  const ballAt = (v) => (v === "" ? null : lookup.get(Number(v)) || null);

  if (!groups.length) {
    return (
      <p className="bw-pick-empty">
        <span className="bw-pick-none" aria-hidden="true" />
        <span>
          Want to know which ball scores best?{" "}
          <button type="button" className="bw-link" onClick={onAddBall}>
            Put a ball in the bag
          </button>
        </span>
      </p>
    );
  }

  if (!split) {
    return (
      <div className="bw-pick">
        <label htmlFor={`bw-ball-${bowler}`}>Ball</label>
        <div className="bw-pick-row">
          <PickOrb ball={ballAt(value[0])} />
          <Select
            id={`bw-ball-${bowler}`}
            value={value[0]}
            disabled={disabled}
            groups={groups}
            onChange={(v) => onChange([v, v, v], false)}
          />
          <button
            type="button"
            className="bw-link bw-pick-mode"
            disabled={disabled}
            onClick={() => onChange(value, true)}
          >
            <i className="fa-solid fa-shuffle" aria-hidden="true" /> Switched balls?
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bw-pick bw-pick--split">
      <div className="bw-pick-games">
        {value.map((v, i) => (
          <div key={i} className="bw-pick-game">
            <label htmlFor={`bw-ball-${bowler}-${i}`}>Game {i + 1} ball</label>
            <div className="bw-pick-row">
              <PickOrb ball={ballAt(v)} />
              <Select
                id={`bw-ball-${bowler}-${i}`}
                value={v}
                disabled={disabled}
                groups={groups}
                onChange={(next) => onChange(value.map((old, j) => (j === i ? next : old)), true)}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="bw-link bw-pick-mode"
        disabled={disabled}
        onClick={() => onChange([value[0], value[0], value[0]], false)}
      >
        <i className="fa-solid fa-link" aria-hidden="true" /> Same ball all night
      </button>
    </div>
  );
};

export default BallPicker;
