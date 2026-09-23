import { useEffect, useState } from "react";
import "./StrikeBurst.css";

/*
 * Save feedback, picked by the games just saved (celebrationFor):
 *   strike  - ball rolls in, ten pins scatter, neon STRIKE
 *   club    - same, gold "200 CLUB"
 *   perfect - same plus confetti, "PERFECT 300"
 *   gutter  - the ball drifts off into the gutter, pins stay up. Womp.
 * Pure CSS keyframes (transform/opacity only), unmounted after it plays.
 * Under reduced motion it's a plain, still toast.
 */
const DURATION = { strike: 1900, club: 2300, perfect: 3200, gutter: 2400 };
const WORDS = {
  strike: "Strike!",
  club: "200 Club!",
  perfect: "Perfect 300!",
  gutter: "Gutter ball",
};
// Pin deck, back row first, as [x, y] offsets from the head pin.
const DECK = [
  [-3, -3], [-1, -3], [1, -3], [3, -3],
  [-2, -2], [0, -2], [2, -2],
  [-1, -1], [1, -1],
  [0, 0],
];
const CONFETTI = Array.from({ length: 28 }, (_, i) => i);

const StrikeBurst = ({ trigger, variant = "strike" }) => {
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!trigger) return undefined;
    setActive({ id: trigger, variant });
    const t = setTimeout(() => setActive(null), DURATION[variant] || DURATION.strike);
    return () => clearTimeout(t);
    // Only a new trigger replays it; variant arrives alongside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (!active) return null;
  const v = active.variant;

  return (
    <div className={`sb sb--${v}`} key={active.id} role="status" aria-live="polite">
      <div className="sb-deck" aria-hidden="true">
        {DECK.map(([x, y], i) => (
          <span
            key={i}
            className="sb-pin"
            style={{
              "--x": x,
              "--y": y,
              "--fx": `${(x || (i % 2 ? 1 : -1)) * (60 + i * 14)}px`,
              "--fy": `${-80 - (3 + y) * 30}px`,
              "--fr": `${(x >= 0 ? 1 : -1) * (160 + i * 40)}deg`,
            }}
          />
        ))}
      </div>
      <span className="sb-ball" aria-hidden="true" />
      {v === "perfect" && (
        <div className="sb-confetti" aria-hidden="true">
          {CONFETTI.map((i) => (
            <span
              key={i}
              style={{
                "--cx": `${(i * 37) % 100}vw`,
                "--cd": `${(i % 7) * 90}ms`,
                "--cr": `${(i * 53) % 360}deg`,
                "--hue": (i * 47) % 360,
              }}
            />
          ))}
        </div>
      )}
      <p className="sb-word">
        <span aria-hidden="true">{WORDS[v]}</span>
        <span className="sr-only">Night saved</span>
      </p>
    </div>
  );
};

export default StrikeBurst;
