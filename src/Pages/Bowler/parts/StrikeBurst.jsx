import { useEffect, useState } from "react";
import "./StrikeBurst.css";

/*
 * Save feedback: a ball rolls in, ten pins scatter, a neon STRIKE flashes.
 * Pure CSS keyframes (transform/opacity only), unmounted after it plays.
 * Under reduced motion it's a plain, still "Saved" toast.
 */
const DURATION = 1900;
// Pin deck, back row first, as [x, y] offsets from the head pin.
const DECK = [
  [-3, -3], [-1, -3], [1, -3], [3, -3],
  [-2, -2], [0, -2], [2, -2],
  [-1, -1], [1, -1],
  [0, 0],
];

const StrikeBurst = ({ trigger }) => {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!trigger) return undefined;
    setActive(trigger);
    const t = setTimeout(() => setActive(0), DURATION);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!active) return null;

  return (
    <div className="sb" key={active} role="status" aria-live="polite">
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
      <p className="sb-word">
        <span aria-hidden="true">Strike!</span>
        <span className="sr-only">Night saved</span>
      </p>
    </div>
  );
};

export default StrikeBurst;
