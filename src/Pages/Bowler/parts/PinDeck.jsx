import "./frames.css";

/*
 * The ten pins as seen from the approach: 7-10 across the back, the 1 pin
 * nearest you. PinDeck is the big tappable one on the lane screen (tap the
 * pins still standing after the ball); Rack is a small static diagram for
 * leaves in the stats.
 *
 * Each pin spans two of eight half-columns, so the rows interleave like a
 * real rack without any absolute positioning.
 */
const SPOT = {
  7: [1, 1],
  8: [3, 1],
  9: [5, 1],
  10: [7, 1],
  4: [2, 2],
  5: [4, 2],
  6: [6, 2],
  2: [3, 3],
  3: [5, 3],
  1: [4, 4],
};
const ORDER = [7, 8, 9, 10, 4, 5, 6, 2, 3, 1];
const place = (pin) => ({ gridColumn: `${SPOT[pin][0]} / span 2`, gridRow: SPOT[pin][1] });

const PinDeck = ({ rack, standing, onToggle, disabled = false }) => (
  <div className="bw-deck" role="group" aria-label="Tap the pins still standing">
    {ORDER.map((pin) => {
      const inRack = Boolean(rack && rack.pins && rack.pins.includes(pin));
      const up = standing.includes(pin);
      const state = !inRack ? "is-down" : up ? "is-up" : "is-falling";
      return (
        <button
          key={pin}
          type="button"
          className={`bw-deck-pin ${state}`}
          style={place(pin)}
          aria-pressed={inRack ? up : undefined}
          aria-label={inRack ? `Pin ${pin}` : `Pin ${pin}, already down`}
          disabled={disabled || !inRack}
          onClick={() => onToggle(pin)}
        >
          <span className="bw-deck-num">{pin}</span>
        </button>
      );
    })}
  </div>
);

export const Rack = ({ pins, className = "" }) => (
  <span className={`bw-rack ${className}`} role="img" aria-label={`Leave ${pins.join("-")}`}>
    {ORDER.map((pin) => (
      <span key={pin} className={pins.includes(pin) ? "is-up" : ""} style={place(pin)} />
    ))}
  </span>
);

export default PinDeck;
