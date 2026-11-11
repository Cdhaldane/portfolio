import { useId } from "react";
import {
  ARROWS,
  BOARD,
  DOTS,
  DOTS_Y,
  FOUL_Y,
  GUTTER,
  HEIGHT,
  PIN_SPOTS,
  PIN_Y,
  WIDTH,
  arrowY,
  boardX,
} from "../laneLine";
import "./laneBed.css";

/*
 * The lane itself, for the inside of an <svg viewBox="0 0 WIDTH HEIGHT">:
 * gutters, the 39 boards, the dots and arrows you aim with, the foul line
 * and a full rack. Shared by the aim-and-hook picker and the lines chart so
 * they read as the same lane. `hand` mirrors it for a left-hander.
 */
const LaneBed = ({ hand = "R" }) => {
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
      <rect x={GUTTER} width={laneW} height={PIN_Y + 12} className="bw-bed-deck" />
      <rect x={GUTTER} y={FOUL_Y} width={laneW} height={HEIGHT - FOUL_Y} className="bw-bed-approach" />
      <line x1={GUTTER} x2={WIDTH - GUTTER} y1={FOUL_Y} y2={FOUL_Y} className="bw-bed-foul" />
      {DOTS.map((b) => (
        <circle key={b} cx={boardX(b, hand)} cy={DOTS_Y} r="1.3" className="bw-bed-mark" />
      ))}
      {ARROWS.map((b) => {
        const x = boardX(b, hand);
        const y = arrowY(b);
        return <path key={b} d={`M ${x} ${y - 8} L ${x + 2.6} ${y} L ${x - 2.6} ${y} Z`} className="bw-bed-mark" />;
      })}
      {PIN_SPOTS.map(({ pin, x, y }) => (
        <g key={pin} transform={`translate(${x} ${y})`}>
          <circle r="5.2" className="bw-bed-pin" />
          <circle r="3" className="bw-bed-neck" />
        </g>
      ))}
    </g>
  );
};

export default LaneBed;
