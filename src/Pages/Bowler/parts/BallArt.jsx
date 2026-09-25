import { forwardRef, useId } from "react";
import { DEFAULT_BALL_COLOR } from "../balls";

/*
 * A resin bowling ball, drawn in a 100x100 box.
 *
 * Two layers, on purpose:
 *   .bw-orb-spin   colour + seeded marbling + finger holes. This is the
 *                  surface, so it's the only thing that ever rotates.
 *   light          specular, falloff and rim, fixed to the page's light.
 * Spinning the surface under still lighting is what makes a rotation read
 * as a roll instead of a sticker turning.
 *
 * The marbling is feTurbulence seeded per ball, so every ball in the bag
 * has its own swirl and keeps it between visits.
 */
const cleanId = (id) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export const BallBody = forwardRef(function BallBody({ color, seed = 7, holes = true }, spinRef) {
  const uid = `bw${cleanId(useId())}`;
  const fill = color || DEFAULT_BALL_COLOR;
  const turn = (seed * 47) % 360;

  return (
    <>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
        {/* Thin pearl veins: 1 - 5x the noise, so only the valleys glow. */}
        <filter id={`${uid}-veins`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.016 0.048" numOctaves="2" seed={seed} />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -5 0 0 0 1.05"
          />
        </filter>
        {/* Broad dark clouds underneath, for depth. */}
        <filter id={`${uid}-clouds`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed={seed + 11} />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 2.4 0 0 -1.05"
          />
        </filter>
        <radialGradient id={`${uid}-hole`} cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#050507" />
          <stop offset="0.8" stopColor="#15151b" />
          <stop offset="1" stopColor="#2c2c35" />
        </radialGradient>
        <radialGradient id={`${uid}-light`} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.22" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#000" stopOpacity="0.2" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id={`${uid}-gloss`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        <g ref={spinRef} className="bw-orb-spin">
          <circle cx="50" cy="50" r="50" fill={fill} />
          <g transform={`rotate(${turn} 50 50)`}>
            <rect x="-10" y="-10" width="120" height="120" filter={`url(#${uid}-clouds)`} opacity="0.4" />
            <rect x="-10" y="-10" width="120" height="120" filter={`url(#${uid}-veins)`} opacity="0.42" />
          </g>
          {holes && (
            <g>
              <circle cx="41" cy="31" r="5.4" fill={`url(#${uid}-hole)`} />
              <circle cx="58" cy="28" r="5.4" fill={`url(#${uid}-hole)`} />
              <circle cx="50" cy="49" r="6.6" fill={`url(#${uid}-hole)`} />
              {/* The pin: every drilled ball shows one. */}
              <circle cx="68" cy="64" r="1.7" fill="#fff" opacity="0.55" />
            </g>
          )}
        </g>
      </g>

      <circle cx="50" cy="50" r="50" fill={`url(#${uid}-light)`} />
      <ellipse
        cx="33"
        cy="24"
        rx="12"
        ry="7"
        transform="rotate(-32 33 24)"
        fill={`url(#${uid}-gloss)`}
        opacity="0.75"
      />
      <circle cx="50" cy="50" r="49.4" fill="none" stroke="#000" strokeOpacity="0.28" strokeWidth="1.2" />
    </>
  );
});

/**
 * The ball as an inline element. `spinRef` lands on the surface layer.
 * Leave `size` out to let CSS size it (via --orb).
 */
const BallArt = forwardRef(function BallArt(
  { color, seed, size, label, holes = true, className = "", style },
  spinRef
) {
  return (
    <span
      className={`bw-orb ${className}`.trim()}
      style={{ ...(size ? { "--orb": `${size}px` } : null), ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 100 100" focusable="false" aria-hidden="true">
        <BallBody ref={spinRef} color={color} seed={seed} holes={holes} />
      </svg>
    </span>
  );
});

export default BallArt;
