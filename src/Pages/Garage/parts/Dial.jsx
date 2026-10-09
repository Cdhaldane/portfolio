/*
 * One analog gauge. 270 degrees of sweep, like the Golf's cluster, with
 * watch/warn zones painted on the track. On mount the needle does the
 * ignition sweep (to the stop and back to its value); after that it eases
 * between values. The motion lives in CSS (.gr-needle) so reduced motion
 * just drops it.
 */
const START = -135;
const SWEEP = 270;
const C = 100;
const R = 78;

const polar = (deg, r = R) => {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)];
};

function arc(f0, f1, r = R) {
  const a0 = START + SWEEP * f0;
  const a1 = START + SWEEP * f1;
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const TICKS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * @param fraction  0..1 along the scale (clamped a little past the stop), or null
 * @param zones     [{ from, to, level }] as fractions
 * @param scale     [left label, right label]
 */
const Dial = ({ fraction, zones = [], scale = [], readout, unit, label, sub }) => {
  const f = fraction === null || fraction === undefined ? 0 : Math.min(Math.max(fraction, 0), 1.04);
  const angle = START + SWEEP * f;
  return (
    <figure className="gr-dial">
      <svg viewBox="0 0 200 172" aria-hidden="true">
        <path className="gr-dial-track" d={arc(0, 1)} />
        {zones.map((z) => (
          <path key={`${z.from}-${z.level}`} className={`gr-dial-zone gr-dial-zone--${z.level}`} d={arc(z.from, z.to)} />
        ))}
        {fraction !== null && fraction !== undefined && (
          <path className="gr-dial-fill" d={arc(0, Math.max(0.001, Math.min(f, 1)), R - 9)} />
        )}
        {TICKS.map((t) => {
          const major = Math.round(t * 20) % 5 === 0;
          const [x0, y0] = polar(START + SWEEP * t, R + 6);
          const [x1, y1] = polar(START + SWEEP * t, R + (major ? 14 : 10));
          return (
            <line key={t} className={`gr-dial-tick ${major ? "is-major" : ""}`} x1={x0} y1={y0} x2={x1} y2={y1} />
          );
        })}
        {scale[0] !== undefined && (
          <text className="gr-dial-scale" x={polar(START, R - 22)[0]} y={polar(START, R - 22)[1] + 4} textAnchor="middle">
            {scale[0]}
          </text>
        )}
        {scale[1] !== undefined && (
          <text className="gr-dial-scale" x={polar(START + SWEEP, R - 22)[0]} y={polar(START + SWEEP, R - 22)[1] + 4} textAnchor="middle">
            {scale[1]}
          </text>
        )}
        <g className="gr-needle" style={{ "--a": `${angle}deg` }}>
          <path d={`M ${C - 3} ${C + 14} L ${C} ${C - R + 8} L ${C + 3} ${C + 14} Z`} />
        </g>
        <circle className="gr-dial-hub" cx={C} cy={C} r="7" />
        <text className="gr-dial-readout" x={C} y={C + 44} textAnchor="middle">
          {readout}
          {unit && <tspan className="gr-dial-unit"> {unit}</tspan>}
        </text>
      </svg>
      <figcaption>
        <span className="gr-dial-label">{label}</span>
        {/* The drawn readout is inside the aria-hidden SVG; say it here. */}
        <span className="sr-only">
          {readout}
          {unit ? ` ${unit}` : ""}
        </span>
        {sub && <span className="gr-dial-sub">{sub}</span>}
      </figcaption>
    </figure>
  );
};

export default Dial;
