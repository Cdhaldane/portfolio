import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClock } from "../format";

/*
 * A datalog viewer: one lane per channel, stacked on a shared time axis, the
 * way Accessport Manager and every logging tool lays it out, because channels
 * in different units can't share a y-axis honestly. One crosshair runs
 * through every lane and each lane head reads its value at the cursor. WOT
 * pulls are shaded across all lanes; watch/warn lines sit on the lanes that
 * have them (charge air, knock, trims).
 *
 * Zoom: drag across the plot with a mouse, or use a pull chip (works on a
 * phone, where a drag has to stay a scroll). Each zoom asks the API for that
 * window at full resolution; the series arrive min/max-decimated, so a
 * one-sample knock spike is never averaged away.
 */
const LANE_H = 84;
const PAD_L = 48;
const PAD_R = 12;
const AXIS_H = 24;
const MIN_DRAG_PX = 8;
const GROUP_ORDER = [
  "Engine", "Boost & air", "Ignition & knock", "Fuel", "Temperatures",
  "Torque", "Valvetrain", "Transmission (DSG)", "Other",
];
const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

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

/** Index of the sample nearest time v (t ascending). */
function nearest(t, v) {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < v) lo = mid;
    else hi = mid;
  }
  return Math.abs(t[lo] - v) <= Math.abs(t[hi] - v) ? lo : hi;
}

function domain(ys, thresholds) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of ys) {
    if (v === null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  const span = hi - lo || Math.abs(hi) || 1;
  // Pull a reference line into view when it's near the data, so "how close
  // did it get" is visible; ignore ones far off the scale.
  for (const th of thresholds) {
    if (th.value >= lo - span * 0.6 && th.value <= hi + span * 0.6) {
      lo = Math.min(lo, th.value);
      hi = Math.max(hi, th.value);
    }
  }
  const pad = (hi - lo || 1) * 0.08;
  return [lo - pad, hi + pad];
}

const fmtValue = (v, unit) => {
  if (v === null || v === undefined) return "–";
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
};

function ChannelPicker({ channels, cols, max, onChange, onClose }) {
  const groups = useMemo(() => {
    const by = new Map();
    for (const ch of channels) by.set(ch.group, [...(by.get(ch.group) || []), ch]);
    return [...by.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [channels]);
  const full = cols.length >= max;
  return (
    <div className="gr-picker" role="group" aria-label="Choose channels">
      <div className="gr-picker-head">
        <p>
          {cols.length} of {max} lanes
        </p>
        <button type="button" className="gr-link" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="gr-picker-groups">
        {groups.map(([group, list]) => (
          <fieldset key={group} className="gr-picker-group">
            <legend>{group}</legend>
            {list.map((ch) => {
              const on = cols.includes(ch.key);
              return (
                <label key={ch.key} className={`gr-picker-item ${!ch.hasData ? "is-empty" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!ch.hasData || (!on && full)}
                    onChange={() => onChange(on ? cols.filter((c) => c !== ch.key) : [...cols, ch.key])}
                  />
                  <span>{ch.label}</span>
                  <small>{ch.hasData ? ch.unit : "empty"}</small>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

const ChannelChart = ({ channels, data, cols, pulls, zoomed, loading, maxLanes, onCols, onZoom, onReset }) => {
  const [plotEl, setPlotEl] = useState(null);
  const width = useWidth(plotEl);
  const [hover, setHover] = useState(null);
  const [drag, setDrag] = useState(null);
  const [picking, setPicking] = useState(false);
  const dragRef = useRef(null);

  const byKey = useMemo(() => new Map(channels.map((c) => [c.key, c])), [channels]);

  // A zoom or channel change brings a new time array; an index into the old
  // one would point past its end.
  useEffect(() => setHover(null), [data]);
  const t = useMemo(() => (data && data.t) || [], [data]);
  const lanes = useMemo(
    () =>
      cols
        .filter((k) => data && data.series && data.series[k] && byKey.has(k))
        .map((k) => {
          const ch = byKey.get(k);
          const ys = data.series[k];
          return { ch, ys, dom: domain(ys, ch.thresholds || []) };
        }),
    [cols, data, byKey]
  );

  const firstT = t.find((v) => v !== null);
  const lastT = [...t].reverse().find((v) => v !== null);
  const t0 = firstT ?? 0;
  const t1 = lastT ?? 1;
  const innerW = Math.max(width - PAD_L - PAD_R, 10);
  const x = (v) => PAD_L + ((v - t0) / (t1 - t0 || 1)) * innerW;
  const tAt = (px) => t0 + ((px - PAD_L) / innerW) * (t1 - t0);

  const step = TIME_STEPS.find((s) => (innerW / ((t1 - t0) / s)) >= 72) || 3600;
  const ticks = [];
  for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) ticks.push(v);

  const visiblePulls = (pulls || [])
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.end_s >= t0 && p.start_s <= t1);

  const localX = (e) => e.clientX - e.currentTarget.getBoundingClientRect().left;

  const onMove = (e) => {
    if (!t.length) return;
    const px = localX(e);
    setHover(nearest(t, tAt(Math.min(Math.max(px, PAD_L), PAD_L + innerW))));
    if (dragRef.current) {
      dragRef.current = { ...dragRef.current, x1: px };
      setDrag(dragRef.current);
    }
  };
  const onDown = (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    dragRef.current = { x0: localX(e), x1: localX(e) };
    setDrag(dragRef.current);
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d && Math.abs(d.x1 - d.x0) >= MIN_DRAG_PX) {
      const a = tAt(Math.min(d.x0, d.x1));
      const b = tAt(Math.max(d.x0, d.x1));
      onZoom(Math.max(a, t0), Math.min(b, t1));
    }
  };

  const hoverT = hover !== null && t[hover] !== null && t[hover] !== undefined ? t[hover] : null;

  return (
    <section className="gr-chart" aria-labelledby="gr-chart-title">
      <div className="gr-chart-bar">
        <h2 id="gr-chart-title" className="gr-h3">
          Channels
        </h2>
        <button type="button" className="gr-btn gr-btn--ghost" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          <i className="fa-solid fa-sliders" aria-hidden="true" /> {cols.length} lane{cols.length === 1 ? "" : "s"}
        </button>
        {(pulls || []).map((p, i) => (
          <button
            key={p.start_s}
            type="button"
            className="gr-chip gr-chip--btn"
            onClick={() => onZoom(Math.max(0, p.start_s - 2), p.end_s + 2)}
          >
            <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" /> Pull {i + 1}
          </button>
        ))}
        {zoomed && (
          <button type="button" className="gr-chip gr-chip--btn" onClick={onReset}>
            <i className="fa-solid fa-expand" aria-hidden="true" /> Whole log
          </button>
        )}
        {loading && <span className="gr-spinner" aria-label="Loading" />}
      </div>

      {picking && (
        <ChannelPicker
          channels={channels}
          cols={cols}
          max={maxLanes}
          onChange={onCols}
          onClose={() => setPicking(false)}
        />
      )}

      {lanes.length === 0 ? (
        <p className="gr-muted">Pick a channel to plot.</p>
      ) : (
        <div
          ref={setPlotEl}
          className={`gr-plot ${loading ? "is-loading" : ""}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => {
            setHover(null);
            dragRef.current = null;
            setDrag(null);
          }}
        >
          <p className="sr-only">
            Datalog chart of {lanes.map((l) => l.ch.label).join(", ")}, from {fmtClock(t0)} to {fmtClock(t1)}. Each
            lane head shows the value under the cursor.
          </p>
          {lanes.map(({ ch, ys, dom: [lo, hi] }) => {
            const y = (v) => LANE_H - ((v - lo) / (hi - lo)) * LANE_H;
            let d = "";
            let pen = false;
            for (let i = 0; i < t.length; i += 1) {
              const v = ys[i];
              if (v === null || t[i] === null) {
                pen = false;
                continue;
              }
              d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
              pen = true;
            }
            const value = hoverT !== null ? ys[hover] : null;
            return (
              <div key={ch.key} className="gr-lane">
                <div className="gr-lane-head">
                  <span className="gr-lane-label">{ch.label}</span>
                  <span className="gr-lane-value">{hoverT !== null ? fmtValue(value, ch.unit) : ch.unit}</span>
                  <button
                    type="button"
                    className="gr-lane-x"
                    onClick={() => onCols(cols.filter((c) => c !== ch.key))}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                    <span className="sr-only">Remove {ch.label}</span>
                  </button>
                </div>
                <svg viewBox={`0 0 ${width} ${LANE_H}`} width="100%" height={LANE_H} aria-hidden="true">
                  {visiblePulls.map((p) => (
                    <rect
                      key={p.n}
                      className="gr-pull-band"
                      x={x(Math.max(p.start_s, t0))}
                      width={Math.max(2, x(Math.min(p.end_s, t1)) - x(Math.max(p.start_s, t0)))}
                      y="0"
                      height={LANE_H}
                    />
                  ))}
                  <line className="gr-lane-base" x1={PAD_L} x2={width - PAD_R} y1={LANE_H - 0.5} y2={LANE_H - 0.5} />
                  {(ch.thresholds || [])
                    .filter((th) => th.value > lo && th.value < hi)
                    .map((th) => (
                      <line
                        key={`${th.value}`}
                        className={`gr-threshold gr-threshold--${th.level}`}
                        x1={PAD_L}
                        x2={width - PAD_R}
                        y1={y(th.value)}
                        y2={y(th.value)}
                      />
                    ))}
                  <text className="gr-lane-tick" x={PAD_L - 6} y={10} textAnchor="end">
                    {fmtValue(hi, "")}
                  </text>
                  <text className="gr-lane-tick" x={PAD_L - 6} y={LANE_H - 3} textAnchor="end">
                    {fmtValue(lo, "")}
                  </text>
                  <path className="gr-lane-line" d={d} />
                  {hoverT !== null && (
                    <>
                      <line className="gr-cross" x1={x(hoverT)} x2={x(hoverT)} y1="0" y2={LANE_H} />
                      {value !== null && <circle className="gr-cross-dot" cx={x(hoverT)} cy={y(value)} r="3.5" />}
                    </>
                  )}
                </svg>
              </div>
            );
          })}
          <svg className="gr-axis" viewBox={`0 0 ${width} ${AXIS_H}`} width="100%" height={AXIS_H} aria-hidden="true">
            {ticks.map((v) => (
              <text key={v} className="gr-axis-tick" x={x(v)} y={16} textAnchor="middle">
                {fmtClock(v)}
              </text>
            ))}
            {hoverT !== null && (
              <text className="gr-axis-hot" x={Math.min(Math.max(x(hoverT), PAD_L + 18), width - PAD_R - 18)} y={16} textAnchor="middle">
                {hoverT.toFixed(1)} s
              </text>
            )}
          </svg>
          {drag && (
            <div
              className="gr-brush"
              style={{ left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0) }}
            />
          )}
        </div>
      )}
      <p className="gr-chart-hint">
        {data && data.decimated
          ? `Showing ${t.length.toLocaleString("en-CA")} of ${data.rawPoints.toLocaleString("en-CA")} samples, peaks kept. `
          : ""}
        Drag across the plot to zoom{pulls && pulls.length ? ", or jump to a pull" : ""}.
      </p>
    </section>
  );
};

export default ChannelChart;
