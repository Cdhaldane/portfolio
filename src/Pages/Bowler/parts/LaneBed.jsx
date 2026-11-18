import { useId } from "react";
import {
  ARROWS,
  BOARD,
  DECK_Y,
  DOTS,
  DOTS_Y,
  FOUL_Y,
  GUTTER,
  HEIGHT,
  PIN_RADIUS,
  PIN_SPOTS,
  PIT_Y,
  WIDTH,
  arrowY,
  boardX,
} from "../laneLine";
import "./laneBed.css";

/*
 * The lane itself, for the inside of an <svg viewBox="0 0 WIDTH HEIGHT">:
 * gutters, the 39 boards, the dots and arrows you aim with, the foul line,
 * the pin deck and the pit behind it, and the rack. Shared by the
 * aim-and-hook picker, the spare line and the lines chart so they read as
 * the same lane. `hand` mirrors the markings for a left-hander; `standing`
 * is the pins drawn up (the rest show as their spots).
 */
const ALL = PIN_SPOTS.map((s) => s.pin);

/** One pin from above, centred on 0 0: the belly and the red neck stripes. */
export const Pin = () => (
  <>
    <circle r={PIN_RADIUS} className="bw-bed-pin" />
    <circle r={PIN_RADIUS * 0.52} className="bw-bed-neck" />
  </>
);

const LaneBed = ({ hand = "R", standing = ALL }) => {
  const uid = `bwbed${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const laneW = WIDTH - GUTTER * 2;
  return (
    <g className="bw-bed" aria-hidden="true">
      <defs>
        <pattern id={`${uid}-boards`} x={GUTTER} width={BOARD} height="10" patternUnits="userSpaceOnUse">
          <rect x={BOARD - 0.4} width="0.4" height="10" className="bw-bed-seam" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} className="bw-bed-gutter" />
      <rect x={GUTTER} width={laneW} height={HEIGHT} className="bw-bed-wood" />
      <rect x={GUTTER} width={laneW} height={HEIGHT} fill={`url(#${uid}-boards)`} />
      <rect x={GUTTER} y={PIT_Y} width={laneW} height={DECK_Y - PIT_Y} className="bw-bed-deck" />
      <rect width={WIDTH} height={PIT_Y} className="bw-bed-pit" />
      <rect x={GUTTER} y={FOUL_Y} width={laneW} height={HEIGHT - FOUL_Y} className="bw-bed-approach" />
      <line x1={GUTTER} x2={WIDTH - GUTTER} y1={FOUL_Y} y2={FOUL_Y} className="bw-bed-foul" />
      {DOTS.map((b) => (
        <circle key={b} cx={boardX(b, hand)} cy={DOTS_Y} r="1.6" className="bw-bed-mark" />
      ))}
      {ARROWS.map((b) => {
        const x = boardX(b, hand);
        const y = arrowY(b);
        return <path key={b} d={`M ${x} ${y - 14} L ${x + 3} ${y} L ${x - 3} ${y} Z`} className="bw-bed-mark" />;
      })}
      {PIN_SPOTS.map(({ pin, x, y }) =>
        standing.includes(pin) ? (
          <g key={pin} transform={`translate(${x} ${y})`}>
            <Pin />
          </g>
        ) : (
          <circle key={pin} cx={x} cy={y} r="3" className="bw-bed-spot" />
        )
      )}
    </g>
  );
};

export default LaneBed;
