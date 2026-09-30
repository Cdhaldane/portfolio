import { memo, useEffect, useMemo } from "react";
import { prand } from "../poses";
import "./Burst.css";

const COLORS = ["#2f6bff", "#6f9a5e", "#ff5d3b", "#ffd36b", "#ff2bd6", "#22f0ff"];
const FOIL = ["#f4efe3", "#ffd36b", "#c9cedb", "#22f0ff"];

// G in px/s². Flight times in seconds. Apex lands at 40% of the flight:
// apex = -0.08·G·t², end = +0.1·G·t² (an exact parabola; see Burst CSS).
const PRESETS = {
  confetti: { g: 1400, tMin: 0.95, tMax: 1.3, spread: 280, size: [7, 11], colors: COLORS },
  flecks: { g: 1600, tMin: 0.7, tMax: 1.0, spread: 200, size: [4, 8], colors: FOIL },
  dots: { g: 0, tMin: 0.45, tMax: 0.55, spread: 80, size: [4, 6], colors: COLORS },
};

const bits = (kind, count, seed) => {
  const p = PRESETS[kind];
  return Array.from({ length: count }, (_, i) => {
    const n = i + seed * 97;
    const t = p.tMin + (p.tMax - p.tMin) * prand(n * 7 + 3);
    const size = p.size[0] + (p.size[1] - p.size[0]) * prand(n * 17 + 6);
    const color = p.colors[Math.floor(prand(n * 19 + 8) * p.colors.length)];
    if (p.g === 0) {
      // A radial pop: straight out, decelerating.
      const a = (i / count) * Math.PI * 2 + prand(n) * 0.5;
      const r = p.spread * (0.65 + 0.35 * prand(n * 3 + 1));
      return { t, size, color, dx: Math.cos(a) * r, dy: Math.sin(a) * r, rot: 0, delay: 0 };
    }
    const lift = 0.75 + 0.5 * prand(n * 13 + 5);
    return {
      t,
      size,
      color,
      dx: (prand(n * 5 + 2) * 2 - 1) * p.spread,
      apex: -0.08 * p.g * t * t * lift,
      end: 0.1 * p.g * t * t,
      rot: (prand(n * 11 + 4) * 2 - 1) * 720 * t,
      delay: prand(n * 23 + 9) * 0.06,
    };
  });
};

/*
 * Index-seeded particles (particle-burst rule): a fixed pool, each position a
 * pure ballistic function of time, compiled to CSS custom properties so the
 * flight is compositor-only with zero JS per frame. Unmounts itself (via
 * onDone) after its longest flight.
 */
const Burst = memo(function Burst({ kind, count, seed = 0, x = 0, y = 0, onDone }) {
  const list = useMemo(() => bits(kind, count, seed), [kind, count, seed]);
  const longest = useMemo(
    () => list.reduce((m, b) => Math.max(m, b.t + b.delay), 0),
    [list]
  );

  useEffect(() => {
    if (!onDone) return undefined;
    const timer = setTimeout(onDone, longest * 1000 + 80);
    return () => clearTimeout(timer);
  }, [longest, onDone]);

  return (
    <span className={`td-burst td-burst--${kind}`} style={{ left: x, top: y }} aria-hidden="true">
      {list.map((b, i) => (
        <span
          key={i}
          className="td-bit"
          style={{
            "--t": `${b.t}s`,
            "--delay": `${b.delay}s`,
            "--dx": `${b.dx}px`,
            "--dy": `${b.dy || 0}px`,
            "--apex": `${b.apex || 0}px`,
            "--end": `${b.end || 0}px`,
            "--rot": `${b.rot}deg`,
            "--s": `${b.size}px`,
            "--c": b.color,
          }}
        >
          <i />
        </span>
      ))}
    </span>
  );
});

export default Burst;
