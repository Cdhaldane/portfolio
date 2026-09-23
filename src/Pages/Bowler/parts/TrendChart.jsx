import { useEffect, useMemo, useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS, formatNight } from "../bowlers";

/*
 * Series average (pins per game) per league night, one line per bowler.
 * Single y-axis, 2px lines, >=8px markers with a surface ring, recessive
 * grid, a legend plus direct end labels, and a crosshair tooltip. Gaps
 * (a night one of you skipped) break the line instead of bridging it.
 * A table view carries the same numbers for screen readers.
 */
const H = 280;
const PAD = { top: 18, right: 64, bottom: 30, left: 40 };
const TICK_STEP = 20;

// Takes the element itself (from a callback ref) so the observer re-attaches
// whenever the chart div mounts: after loading, or when leaving table view.
function useWidth(el) {
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/** Split a series into runs of consecutive non-null points. */
function segments(points, key, x, y) {
  return points
    .reduce(
      (runs, p, i) => {
        if (p[key] === null) return [...runs, []];
        const last = runs[runs.length - 1];
        return [...runs.slice(0, -1), [...last, [x(i), y(p[key])]]];
      },
      [[]]
    )
    .filter((run) => run.length > 1)
    .map((run) => run.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(""));
}

const TrendChart = ({ loading, points }) => {
  const [wrapEl, setWrapEl] = useState(null);
  const width = useWidth(wrapEl);
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);

  const geo = useMemo(() => {
    const values = points.flatMap((p) => BOWLERS.map((b) => p[b.key])).filter((v) => v !== null);
    const lo = Math.floor((Math.min(...values, 100) - 10) / TICK_STEP) * TICK_STEP;
    const hi = Math.ceil((Math.max(...values, 150) + 10) / TICK_STEP) * TICK_STEP;
    const innerW = Math.max(width - PAD.left - PAD.right, 10);
    const innerH = H - PAD.top - PAD.bottom;
    const n = points.length;
    const x = (i) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
    const ticks = [];
    for (let t = lo; t <= hi; t += TICK_STEP) ticks.push(t);
    return { x, y, ticks, innerW };
  }, [points, width]);

  if (loading || points.length === 0) return null;

  const pick = (clientX, target) => {
    const px = clientX - target.getBoundingClientRect().left;
    const n = points.length;
    const idx =
      n <= 1 ? 0 : Math.round(((px - PAD.left) / geo.innerW) * (n - 1));
    setHover(Math.min(Math.max(idx, 0), n - 1));
  };

  const hovered = hover === null ? null : points[hover];
  const tipLeft = hovered ? Math.min(Math.max(geo.x(hover), 90), width - 90) : 0;
  const lastIdx = (key) => {
    for (let i = points.length - 1; i >= 0; i -= 1) if (points[i][key] !== null) return i;
    return -1;
  };

  return (
    <Reveal as="section" className="bw-trend" aria-labelledby="bw-trend-title">
      <div className="bw-trend-head">
        <h2 id="bw-trend-title" className="bw-h2">
          Average per night
        </h2>
        <div className="bw-legend">
          {BOWLERS.map((b) => (
            <span key={b.key} className="bw-legend-item">
              <span className={`bw-legend-swatch bw-legend-swatch--${b.key}`} aria-hidden="true" />
              {b.name}
            </span>
          ))}
          <button type="button" className="bw-link" onClick={() => setAsTable((t) => !t)}>
            {asTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="bw-table-wrap">
          <table className="bw-table">
            <thead>
              <tr>
                <th scope="col">Night</th>
                {BOWLERS.map((b) => (
                  <th key={b.key} scope="col">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row">{formatNight(p.date, { month: "short", day: "numeric", year: "numeric" })}</th>
                  {BOWLERS.map((b) => (
                    <td key={b.key}>{p[b.key] ?? "-"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={setWrapEl} className="bw-chart" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label="Line chart of each bowler's average per league night. Use Show table for the numbers."
            onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
            onTouchStart={(e) => e.touches[0] && pick(e.touches[0].clientX, e.currentTarget)}
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line
                  className="bw-grid"
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geo.y(t)}
                  y2={geo.y(t)}
                />
                <text className="bw-axis" x={PAD.left - 8} y={geo.y(t)} dy="0.32em" textAnchor="end">
                  {t}
                </text>
              </g>
            ))}

            {points.map((p, i) =>
              i === 0 || i === points.length - 1 || points.length <= 6 ? (
                <text
                  key={p.date}
                  className="bw-axis"
                  x={geo.x(i)}
                  y={H - 8}
                  textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                >
                  {formatNight(p.date)}
                </text>
              ) : null
            )}

            {hovered && (
              <line
                className="bw-cross"
                x1={geo.x(hover)}
                x2={geo.x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
              />
            )}

            {BOWLERS.map((b) => (
              <g key={b.key} className={`bw-series bw-series--${b.key}`}>
                {segments(points, b.key, geo.x, geo.y).map((d) => (
                  <path key={d} d={d} className="bw-line" pathLength="1" />
                ))}
                {points.map((p, i) =>
                  p[b.key] === null ? null : (
                    <circle
                      key={p.date}
                      className={`bw-dot ${hover === i ? "is-hot" : ""}`}
                      cx={geo.x(i)}
                      cy={geo.y(p[b.key])}
                      r={hover === i ? 6 : 4.5}
                    />
                  )
                )}
                {lastIdx(b.key) >= 0 && (
                  <text
                    className="bw-end-label"
                    x={geo.x(lastIdx(b.key)) + 10}
                    y={geo.y(points[lastIdx(b.key)][b.key])}
                    dy="0.32em"
                  >
                    {b.short}
                  </text>
                )}
              </g>
            ))}
          </svg>

          {hovered && (
            <div className="bw-tip" style={{ left: tipLeft }} role="status">
              <p className="bw-tip-date">
                {formatNight(hovered.date, { weekday: "short", month: "short", day: "numeric" })}
              </p>
              {BOWLERS.map((b) => (
                <p key={b.key} className="bw-tip-row">
                  <span className={`bw-legend-swatch bw-legend-swatch--${b.key}`} aria-hidden="true" />
                  <span>{b.name}</span>
                  <strong>{hovered[b.key] ?? "-"}</strong>
                  {hovered[`${b.key}Games`] && (
                    <small>{hovered[`${b.key}Games`].join(" / ")}</small>
                  )}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Reveal>
  );
};

export default TrendChart;
