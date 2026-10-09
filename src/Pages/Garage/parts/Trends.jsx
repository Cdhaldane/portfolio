import { useEffect, useMemo, useRef, useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { fmtDate } from "../format";
import { METRICS, METRIC_BY_KEY, beforeAfter, formatMetric, markers, trendPoints } from "../logs";

/*
 * One number per log over time, on a real date axis: peak charge air, max
 * knock or mean LTFT. Watch/warn bands sit behind the points. Mods and
 * repairs from the work log, and tune changes from the logs themselves, are
 * dated markers; pick one to split the trend into before/after averages.
 * That's the intercooler question: did the peak come down?
 */
const H = 300;
const PAD = { top: 18, right: 18, bottom: 34, left: 48 };
const DAY = 86400000;

function useWidth(el) {
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

const ms = (iso) => Date.parse(`${iso}T12:00:00Z`);

// A point counts as "under" the pointer within this many px, either way.
const HIT_PX = 28;

const Trends = ({ car, logs, events, loading, onOpen }) => {
  const [metricKey, setMetricKey] = useState("catMaxC");
  const [split, setSplit] = useState("");
  const [wrap, setWrap] = useState(null);
  const width = useWidth(wrap);
  // { i, near, touch }: the point nearest the pointer, whether it's close
  // enough to click, and whether a tap (not a hover) chose it.
  const [hover, setHover] = useState(null);
  const pointerType = useRef("mouse");
  const metric = METRIC_BY_KEY[metricKey];

  const points = useMemo(() => trendPoints(logs, metricKey), [logs, metricKey]);
  const marks = useMemo(() => markers(events, logs), [events, logs]);
  const compare = useMemo(() => (split ? beforeAfter(points, split) : null), [points, split]);

  if (loading) return <div className="gr-row gr-row--ghost gr-row--tall" aria-busy="true" />;
  if (points.length < 2) {
    return (
      <div className="gr-empty">
        <i className="fa-solid fa-chart-line" aria-hidden="true" />
        <h2>Trends need two logs with the engine running.</h2>
        <p>
          {car.key === "golf"
            ? "Upload a few Accessport logs and each one becomes a point here."
            : "Cayenne logs come through AndrOBD, which isn't supported yet."}
        </p>
      </div>
    );
  }

  const xs = [...points.map((p) => ms(p.date)), ...marks.map((m) => ms(m.date))];
  let d0 = Math.min(...xs);
  let d1 = Math.max(...xs);
  if (d1 - d0 < 7 * DAY) {
    d0 -= 3 * DAY;
    d1 += 3 * DAY;
  }
  const th = metric.thresholds;
  const values = points.map((p) => p.value);
  const signed = metric.key === "ltftMeanPct";
  let lo = Math.min(...values, signed ? -th.watch : 0);
  let hi = Math.max(...values, signed ? th.watch : th.watch || 1);
  if (metric.key === "catMaxC") hi = Math.max(hi, th.warn + 5);
  if (metric.key === "knockMaxDeg") hi = Math.max(hi, th.warn + 0.5);
  const padY = (hi - lo) * 0.08;
  lo -= padY;
  hi += padY;

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (iso) => PAD.left + ((ms(iso) - d0) / (d1 - d0)) * innerW;
  const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const clampY = (v) => Math.min(Math.max(y(v), PAD.top), PAD.top + innerH);

  const bands = signed
    ? [
        { from: th.watch, to: th.warn, level: "watch" },
        { from: -th.warn, to: -th.watch, level: "watch" },
        { from: th.warn, to: hi, level: "warn" },
        { from: lo, to: -th.warn, level: "warn" },
      ]
    : [
        { from: metric.key === "knockMaxDeg" ? 0.0001 : th.watch, to: th.warn, level: "watch" },
        { from: th.warn, to: hi, level: "warn" },
      ];

  const step = (hi - lo) / 4;
  const yTicks = [0, 1, 2, 3, 4].map((i) => lo + step * i);
  const months = [];
  const start = new Date(d0);
  for (let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); m.getTime() <= d1; m.setUTCMonth(m.getUTCMonth() + 1)) {
    months.push(m.toISOString().slice(0, 10));
  }
  // About one label per 64px, so a year or more of history doesn't collide on a phone.
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(innerW / 64))));
  const dateTicks =
    months.length >= 2
      ? months.filter((_, i) => i % every === 0)
      : [...new Set([points[0].date, points[points.length - 1].date])];
  const hovered = hover === null ? null : points[hover.i];
  const hoveredLog = hovered ? logs.find((l) => l.id === hovered.id) : null;

  /** The point nearest the pointer in screen distance, so same-day logs stack but stay pickable. */
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * (width / r.width);
    const py = (e.clientY - r.top) * (H / r.height);
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(x(p.date) - px, y(p.value) - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return { i: best, near: bestD <= HIT_PX };
  };
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");

  return (
    <Reveal as="section" className="gr-trends" aria-labelledby="gr-trends-title">
      <div className="gr-section-head">
        <h2 id="gr-trends-title" className="gr-h2">
          {metric.label}
        </h2>
        <div className="gr-seg" role="group" aria-label="Metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`gr-seg-btn ${m.key === metricKey ? "is-on" : ""}`}
              aria-pressed={m.key === metricKey}
              onClick={() => setMetricKey(m.key)}
            >
              {m.short}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={setWrap}
        className="gr-trend-chart"
        onPointerLeave={() => setHover((h) => (h && h.touch ? h : null))}
      >
        <svg
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`${metric.label} per log, ${points.length} logs from ${fmtDate(points[0].date)} to ${fmtDate(points[points.length - 1].date)}. Open a log from the Logs tab.`}
          style={{ cursor: hover && hover.near && onOpen ? "pointer" : "default" }}
          onPointerDown={(e) => {
            pointerType.current = e.pointerType;
          }}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse") setHover({ ...pick(e), touch: false });
          }}
          onClick={(e) => {
            const p = pick(e);
            if (!p.near) {
              setHover(null);
              return;
            }
            // Mouse: open straight away. Touch: the first tap shows the
            // point, a second tap on it (or the tip's button) opens it.
            if (pointerType.current === "mouse" || (hover && hover.touch && hover.i === p.i)) {
              if (onOpen) onOpen(points[p.i].id);
            } else {
              setHover({ ...p, touch: true });
            }
          }}
        >
          {bands.map((b) => (
            <rect
              key={`${b.from}-${b.level}`}
              className={`gr-band gr-band--${b.level}`}
              x={PAD.left}
              width={innerW}
              y={clampY(b.to)}
              height={Math.max(0, clampY(b.from) - clampY(b.to))}
            />
          ))}
          {yTicks.map((v) => (
            <g key={v}>
              <line className="gr-grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="gr-axis-tick" x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end">
                {v.toFixed(metric.digits === 0 ? 0 : 1)}
              </text>
            </g>
          ))}
          {dateTicks.map((iso) => (
            <text key={iso} className="gr-axis-tick" x={x(iso)} y={H - 10} textAnchor="middle">
              {fmtDate(iso, { month: "short", ...(months.length >= 2 ? {} : { day: "numeric" }) })}
            </text>
          ))}
          {marks.map((m) => (
            <g key={m.id} className={`gr-mark gr-mark--${m.kind} ${split === m.date ? "is-on" : ""}`}>
              <line x1={x(m.date)} x2={x(m.date)} y1={PAD.top} y2={PAD.top + innerH} />
              <circle cx={x(m.date)} cy={PAD.top} r="4" />
            </g>
          ))}
          {compare && compare.before.mean !== null && (
            <line className="gr-avg" x1={PAD.left} x2={x(split)} y1={y(compare.before.mean)} y2={y(compare.before.mean)} />
          )}
          {compare && compare.after.mean !== null && (
            <line className="gr-avg" x1={x(split)} x2={width - PAD.right} y1={y(compare.after.mean)} y2={y(compare.after.mean)} />
          )}
          <path className="gr-trend-line" d={path} />
          {hovered && (
            <line
              className="gr-cross"
              x1={x(hovered.date)}
              x2={x(hovered.date)}
              y1={PAD.top}
              y2={PAD.top + innerH}
            />
          )}
          {points.map((p, i) => {
            const hot = hover && hover.i === i;
            return (
              <circle
                key={p.id}
                className={`gr-trend-dot gr-trend-dot--${p.level} ${hot ? "is-hot" : ""}`}
                cx={x(p.date)}
                cy={y(p.value)}
                r={hot ? 7 : 5}
              />
            );
          })}
        </svg>
        {hovered && (
          <div
            className={`gr-tip ${hover.touch ? "is-interactive" : ""}`}
            style={{ left: Math.min(Math.max(x(hovered.date), 90), width - 90) }}
          >
            <p className="gr-tip-date">{fmtDate(hovered.date)}</p>
            <p className="gr-tip-value">{formatMetric(metricKey, hovered.value)}</p>
            {hoveredLog && <p className="gr-tip-file">{hoveredLog.filename}</p>}
            {onOpen && hover.touch ? (
              <button type="button" className="gr-tip-open" onClick={() => onOpen(hovered.id)}>
                Open log <i className="fa-solid fa-arrow-right" aria-hidden="true" />
              </button>
            ) : (
              onOpen && hover.near && <p className="gr-tip-hint">Click to open</p>
            )}
          </div>
        )}
      </div>

      {metricKey === "catMaxC" && (
        <p className="gr-caveat">
          Peak charge air follows the weather as much as the car. Compare logs from similar days.
        </p>
      )}

      <div className="gr-compare">
        <label className="gr-field">
          <span>Before and after</span>
          <select value={split} onChange={(e) => setSplit(e.target.value)}>
            <option value="">Pick a mod, repair or tune change</option>
            {marks.map((m) => (
              <option key={m.id} value={m.date}>
                {fmtDate(m.date)} · {m.label}
              </option>
            ))}
          </select>
        </label>
        {!marks.length && (
          <p className="gr-muted">Log a mod or repair in the work log and it shows up here as a marker.</p>
        )}
        {compare && (
          <dl className="gr-compare-result">
            <div>
              <dt>Before · {compare.before.n} log{compare.before.n === 1 ? "" : "s"}</dt>
              <dd>{formatMetric(metricKey, compare.before.mean)}</dd>
            </div>
            <div>
              <dt>After · {compare.after.n} log{compare.after.n === 1 ? "" : "s"}</dt>
              <dd>{formatMetric(metricKey, compare.after.mean)}</dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd>
                {compare.delta === null
                  ? "Needs logs on both sides"
                  : `${compare.delta > 0 ? "+" : ""}${compare.delta.toFixed(metric.digits)}${metric.unit}`}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </Reveal>
  );
};

export default Trends;
