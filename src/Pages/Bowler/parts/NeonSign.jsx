import { useRef, useState } from "react";

/*
 * The hero's neon sign. Easter egg: tap it five times quickly and the "e"
 * shorts out and drops off ("Bowl r"). One more tap fixes it.
 */
const WORD = "Bowler";
const FALL_INDEX = 4; // the "e"
const TAPS_TO_BREAK = 5;
const TAP_WINDOW_MS = 1800;

const NeonSign = ({ onBreak }) => {
  const [broken, setBroken] = useState(false);
  const taps = useRef([]);

  const onTap = () => {
    if (broken) {
      setBroken(false);
      taps.current = [];
      return;
    }
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < TAP_WINDOW_MS), now];
    if (taps.current.length >= TAPS_TO_BREAK) {
      taps.current = [];
      setBroken(true);
      onBreak();
    }
  };

  return (
    <h1 className="bw-sign">
      <button type="button" className={`bw-sign-btn ${broken ? "is-broken" : ""}`} onClick={onTap}>
        <span className="bw-sign-word" aria-hidden="true">
          {WORD.split("").map((ch, i) => (
            <span key={i} className={i === FALL_INDEX ? "bw-sign-e" : undefined}>
              {ch}
            </span>
          ))}
        </span>
        <span className="sr-only">Bowler</span>
      </button>
    </h1>
  );
};

export default NeonSign;
