import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activePreset } from "../channelPresets";
import { fmtClock } from "../format";

/*
 * A datalog viewer: one lane per channel, stacked on a shared time axis, the
 * way Accessport Manager and every logging tool lays it out, because channels
 * in different units can't share a y-axis honestly. Full-load pulls are shaded
 * across all lanes; watch/warn lines sit on the lanes that have them.
 *
 * Reading it:
 *   - The cursor snaps to the nearest point in the lane under it, height
 *     included, so a one-sample spike or dip is caught from ~14px away
 *     instead of needing the exact pixel column.
 *   - On a peak or dip, the other lanes line up on their own peak or dip
 *     within ~16px, so one click reads every channel's high point of the
 *     same event (a lane that peaked a beat later shows when, in the readout).
 *   - Each lane marks its highest and lowest point in view (▲ ▼); the
 *     buttons in the lane head jump straight to them.
 *   - Click or tap pins cursor A, then B: the readout under the plot lists
 *     every lane at both and the change between them. Click a pin to drop it.
 *   - Keyboard: arrows step a sample (Shift: 10), Enter pins, Esc clears.
 *
 * Zoom: drag across the plot with a mouse, use a pull chip, or zoom to A–B.
 * Each zoom asks the API for that window at full resolution; the series
 * arrive min/max-decimated, so a peak is never averaged away.
 *
 * Presets swap in a whole set of lanes at once and keep the zoom, so one
 * pull can be read through each system in turn.
 */
const LANE_H = 104;
// From this many lanes on, each gets shorter so a full preset sits closer to one screen.
const COMPACT_FROM = 6;
const LANE_H_COMPACT = 80;
const PAD_L = 52;
const PAD_R = 14;
const AXIS_H = 24;
const MIN_DRAG_PX = 8;
const TAP_SLOP_PX = 10;
const SNAP_PX = 14;
// Peak alignment: a point is a peak (or dip) if it's the highest (lowest) in
// its lane within MODE_PX; the other lanes then take their own peak (dip)
// within ALIGN_PX. Min/max decimation emits each bucket's min and max in time
// order, so at one index one lane can be showing its max and the next its min.
const MODE_PX = 6;
const ALIGN_PX = 16;
const PIN_HIT_PX = 6;
const GROUP_ORDER = [
  "Engine", "Boost & air", "Ignition & knock", "Fuel", "Temperatures",
  "Torque", "Valvetrain", "Transmission (DSG)", "Other",
];
const TIME_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const PIN_IDS = ["A", "B"];

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

/** Index of the sample nearest time v (t ascending, nulls tolerated at the ends). */
function nearest(t, v) {
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] !== null && t[mid] < v) lo = mid;
    else hi = mid;
  }
  return Math.abs((t[lo] ?? Infinity) - v) <= Math.abs((t[hi] ?? Infinity) - v) ? lo : hi;
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
  const pad = (hi - lo || 1) * 0.12;
  return [lo - pad, hi + pad];
}

/** Indices of the highest and lowest non-null values. */
function extremes(ys) {
  let iMax = -1;
  let iMin = -1;
  for (let i = 0; i < ys.length; i += 1) {
    const v = ys[i];
    if (v === null) continue;
    if (iMax === -1 || v > ys[iMax]) iMax = i;
    if (iMin === -1 || v < ys[iMin]) iMin = i;
  }
  return { iMax, iMin };
}

/** Index of the highest ("max") or lowest ("min") value in [i0, i1], or -1. */
function extremeIn(ys, t, i0, i1, mode) {
  let best = -1;
  for (let i = i0; i <= i1; i += 1) {
    const v = ys[i];
    if (v === null || t[i] === null) continue;
    if (best === -1 || (mode === "max" ? v > ys[best] : v < ys[best])) best = i;
  }
  return best;
}

const digitsFor = (v) => {
  const abs = Math.abs(v);
  return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
};

const fmtValue = (v, unit = "") => {
  if (v === null || v === undefined) return "–";
  const d = digitsFor(v);
  const text = v.toLocaleString("en-CA", { minimumFractionDigits: d, maximumFractionDigits: d });
  return unit ? `${text} ${unit}` : text;
};

const fmtDelta = (v, unit) => {
  if (v === null || Number.isNaN(v)) return "–";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmtValue(Math.abs(v), unit)}`;
};

/** 83.42 → "1:23.4" */
const fmtTime = (s) => `${fmtClock(Math.floor(s))}.${Math.floor((s % 1) * 10)}`;

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

const ChannelChart = ({ channels, data, cols, presets, pulls, zoomed, loading, maxLanes, onCols, onZoom, onReset }) => {
  const [plotEl, setPlotEl] = useState(null);
  const width = useWidth(plotEl);
  const [hover, setHover] = useState(null); // { i, lane } — i indexes the current t
  const [pins, setPins] = useState([]); // [{ id, t, values: { key: value } }]
  const [drag, setDrag] = useState(null);
  const [picking, setPicking] = useState(false);
  const dragRef = useRef(null);
  const downRef = useRef(null);

  const byKey = useMemo(() => new Map(channels.map((c) => [c.key, c])), [channels]);

  // A zoom or channel change brings a new time array; an index into the old
  // one would point past its end. Pins are times, so they survive.
  useEffect(() => setHover(null), [data]);

  const t = useMemo(() => (data && data.t) || [], [data]);
  const shown = useMemo(
    () => cols.filter((k) => data && data.series && data.series[k] && byKey.has(k)),
    [cols, data, byKey]
  );
  const laneH = shown.length >= COMPACT_FROM ? LANE_H_COMPACT : LANE_H;
  const lanes = useMemo(
    () =>
      shown.map((k) => {
        const ch = byKey.get(k);
        const ys = data.series[k];
        const [lo, hi] = domain(ys, ch.thresholds || []);
        return { ch, ys, lo, hi, y: (v) => laneH - ((v - lo) / (hi - lo)) * laneH, ...extremes(ys) };
      }),
    [shown, data, byKey, laneH]
  );
  const laneByKey = useMemo(() => new Map(lanes.map((l) => [l.ch.key, l])), [lanes]);
  const preset = presets ? activePreset(presets, cols) : null;

  const firstT = t.find((v) => v !== null);
  const lastT = [...t].reverse().find((v) => v !== null);
  const t0 = firstT ?? 0;
  const t1 = lastT ?? 1;
  const innerW = Math.max(width - PAD_L - PAD_R, 10);
  const x = useCallback((v) => PAD_L + ((v - t0) / (t1 - t0 || 1)) * innerW, [t0, t1, innerW]);

  // The lines only change with the data or the width. Built in the render,
  // every hover would redo every lane's points on each pointer move.
  const paths = useMemo(
    () =>
      new Map(
        lanes.map(({ ch, ys, y }) => {
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
          return [ch.key, d];
        })
      ),
    [lanes, t, x]
  );
  const tAt = (px) => t0 + ((Math.min(Math.max(px, PAD_L), PAD_L + innerW) - PAD_L) / innerW) * (t1 - t0);

  const step = TIME_STEPS.find((s) => innerW / ((t1 - t0) / s) >= 72) || 3600;
  const ticks = [];
  for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) ticks.push(v);

  const visiblePulls = (pulls || [])
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p) => p.end_s >= t0 && p.start_s <= t1);

  /**
   * The sample under the pointer: the nearest point in screen distance within
   * SNAP_PX either side, in the lane the pointer is over; plain nearest-in-
   * time when it's over a lane head or the axis.
   */
  function snap(e) {
    const rect = plotEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const iTime = nearest(t, tAt(px));
    const laneEl = e.target && e.target.closest ? e.target.closest("[data-lane]") : null;
    const lane = laneEl ? laneByKey.get(laneEl.getAttribute("data-lane")) : null;
    if (!lane) return { i: iTime, lane: null };
    const py = e.clientY - laneEl.getBoundingClientRect().top;
    const i0 = nearest(t, tAt(px - SNAP_PX));
    const i1 = nearest(t, tAt(px + SNAP_PX));
    let best = iTime;
    let bestD = Infinity;
    for (let i = i0; i <= i1; i += 1) {
      const v = lane.ys[i];
      if (v === null || t[i] === null) continue;
      const dx = x(t[i]) - px;
      const dy = lane.y(v) - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { i: best, lane: lane.ch.key, picks: align(lane, best) };
  }

  /**
   * Line the other lanes up with a peak or dip: when sample i is the highest
   * (or lowest) point of `src` within MODE_PX, every lane takes its own
   * highest (lowest) point within ALIGN_PX. Returns { laneKey: index }, or
   * null when i is mid-slope or flat (then every lane reads sample i).
   */
  function align(src, i, forced = null) {
    if (!src || t[i] === null || t[i] === undefined) return null;
    const px = x(t[i]);
    let mode = forced;
    if (!mode) {
      const m0 = nearest(t, tAt(px - MODE_PX));
      const m1 = nearest(t, tAt(px + MODE_PX));
      const jMax = extremeIn(src.ys, t, m0, m1, "max");
      const jMin = extremeIn(src.ys, t, m0, m1, "min");
      if (jMax === -1 || src.ys[jMax] === src.ys[jMin]) return null;
      mode = src.ys[i] === src.ys[jMax] ? "max" : src.ys[i] === src.ys[jMin] ? "min" : null;
      if (!mode) return null;
    }
    const a0 = nearest(t, tAt(px - ALIGN_PX));
    const a1 = nearest(t, tAt(px + ALIGN_PX));
    const picks = {};
    for (const lane of lanes) {
      const j = lane === src ? i : extremeIn(lane.ys, t, a0, a1, mode);
      picks[lane.ch.key] = j === -1 ? i : j;
    }
    return picks;
  }

  /** The sample a lane reads for a cursor: its aligned peak, or the cursor's own. */
  const pickFor = (cursor, key) =>
    cursor.picks && cursor.picks[key] !== undefined ? cursor.picks[key] : cursor.i;

  /** Pin A, then B; a third pin starts over; pinning on a pin removes it. */
  function togglePin(i, picks = null) {
    const tp = t[i];
    if (tp === null || tp === undefined) return;
    const at = (l) => pickFor({ i, picks }, l.ch.key);
    setPins((prev) => {
      const hit = prev.find((p) => Math.abs(x(p.t) - x(tp)) <= PIN_HIT_PX);
      const kept = hit ? prev.filter((p) => p !== hit) : prev.length >= PIN_IDS.length ? [] : prev;
      const pin = {
        t: tp,
        values: Object.fromEntries(lanes.map((l) => [l.ch.key, l.ys[at(l)]])),
        times: Object.fromEntries(lanes.map((l) => [l.ch.key, t[at(l)]])),
      };
      const next = hit ? kept : [...kept, pin];
      return next.map((p, k) => ({ ...p, id: PIN_IDS[k] }));
    });
  }

  const onMove = (e) => {
    if (!t.length || !plotEl) return;
    if (e.pointerType === "mouse" || !downRef.current) setHover(snap(e));
    if (dragRef.current) {
      dragRef.current = { ...dragRef.current, x1: e.clientX - plotEl.getBoundingClientRect().left };
      setDrag(dragRef.current);
    }
  };
  const onDown = (e) => {
    if (e.target.closest && e.target.closest("button")) return;
    downRef.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
    if (e.pointerType === "mouse" && e.button === 0) {
      const px = e.clientX - plotEl.getBoundingClientRect().left;
      dragRef.current = { x0: px, x1: px };
      setDrag(dragRef.current);
    }
  };
  const onUp = (e) => {
    const down = downRef.current;
    const d = dragRef.current;
    downRef.current = null;
    dragRef.current = null;
    setDrag(null);
    if (!down || !t.length) return;
    if (d && Math.abs(d.x1 - d.x0) >= MIN_DRAG_PX) {
      onZoom(Math.max(tAt(Math.min(d.x0, d.x1)), t0), Math.min(tAt(Math.max(d.x0, d.x1)), t1));
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX) return; // a scroll, not a tap
    const s = snap(e);
    setHover(s);
    togglePin(s.i, s.picks);
  };

  const onKey = (e) => {
    if (!t.length) return;
    const last = t.length - 1;
    const from = hover ? hover.i : Math.round(last / 2);
    const move = (i) => {
      e.preventDefault();
      const next = Math.min(Math.max(i, 0), last);
      const lane = hover ? hover.lane : null;
      setHover({ i: next, lane, picks: lane ? align(laneByKey.get(lane), next) : null });
    };
    const n = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight") move(from + n);
    else if (e.key === "ArrowLeft") move(from - n);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if ((e.key === "Enter" || e.key === " ") && hover) {
      e.preventDefault();
      togglePin(hover.i, hover.picks);
    } else if (e.key === "Escape") {
      setPins([]);
      setHover(null);
    }
  };

  // ▲/▼ pin a lane's extreme and line every other lane up on its own.
  const jumpTo = (lane, i, mode) => {
    const picks = align(lane, i, mode);
    setHover({ i, lane: lane.ch.key, picks });
    togglePin(i, picks);
  };

  const hoverT = hover && t[hover.i] !== null && t[hover.i] !== undefined ? t[hover.i] : null;
  const inView = (tp) => tp >= t0 && tp <= t1;
  const pinValue = (pin, lane) =>
    pin.values[lane.ch.key] !== undefined
      ? pin.values[lane.ch.key]
      : inView(pin.t)
        ? lane.ys[nearest(t, pin.t)]
        : null;
  /** When a lane's aligned peak sits off the pin's own time (a lane added later reads the pin time). */
  const pinTime = (pin, lane) =>
    pin.times && pin.times[lane.ch.key] !== undefined && pin.times[lane.ch.key] !== null
      ? pin.times[lane.ch.key]
      : pin.t;
  // Shown in the readout when a lane peaked a beat before or after the pin.
  const offAt = (pin, lane) => {
    const pt = pinTime(pin, lane);
    return Math.abs(pt - pin.t) >= 0.1 ? <small className="gr-readout-at">@{fmtTime(pt)}</small> : null;
  };
  const [pinA, pinB] = pins;

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

      {presets && presets.length > 0 && (
        <div className="gr-presets">
          <div className="gr-filters" role="group" aria-label="Lane presets">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`gr-chip gr-chip--btn ${preset === p ? "is-on" : ""}`}
                aria-pressed={preset === p}
                onClick={() => preset !== p && onCols(p.cols)}
              >
                <i className={`fa-solid ${p.icon}`} aria-hidden="true" /> {p.label}
              </button>
            ))}
          </div>
          <p className="gr-preset-about">{preset ? preset.about : "Your own lanes. A preset swaps in its set."}</p>
        </div>
      )}

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
          tabIndex={0}
          aria-describedby="gr-plot-help"
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => {
            downRef.current = null;
            dragRef.current = null;
            setDrag(null);
          }}
          onPointerLeave={() => {
            setHover(null);
            dragRef.current = null;
            setDrag(null);
          }}
          onKeyDown={onKey}
        >
          <p id="gr-plot-help" className="sr-only">
            Datalog chart of {lanes.map((l) => l.ch.label).join(", ")}, from {fmtClock(t0)} to {fmtClock(t1)}. Left
            and right arrows step through samples, Enter pins a cursor, Escape clears pins. Each lane head reads the
            value at the cursor.
          </p>
          {lanes.map((lane) => {
            const { ch, ys, lo, hi, y, iMax, iMin } = lane;
            // This lane's own sample for the cursor: its aligned peak/dip when there is one.
            const iL = hoverT !== null ? pickFor(hover, ch.key) : null;
            const tL = iL !== null ? t[iL] : null;
            const value = iL !== null && tL !== null ? ys[iL] : null;
            const hot = hover && hover.lane === ch.key;
            const flat = iMax === -1 || ys[iMax] === ys[iMin] || t[iMax] === null || t[iMin] === null;
            const mark = (i, up) => {
              const px = Math.min(Math.max(x(t[i]), PAD_L + 6), width - PAD_R - 6);
              const py = y(ys[i]) + (up ? -7 : 7);
              const tip = up ? -4 : 4;
              return `M${px - 4},${py - tip}L${px + 4},${py - tip}L${px},${py + tip}Z`;
            };
            return (
              <div key={ch.key} className={`gr-lane ${hot ? "is-hot" : ""}`}>
                <div className="gr-lane-head">
                  <span className="gr-lane-label">{ch.label}</span>
                  <span className="gr-lane-value">{hoverT !== null ? fmtValue(value, ch.unit) : ch.unit}</span>
                  {!flat && (
                    <span className="gr-lane-ext">
                      <button
                        type="button"
                        className="gr-ext-btn"
                        title="Jump to the highest point in view and pin it"
                        onClick={() => jumpTo(lane, iMax, "max")}
                      >
                        <span aria-hidden="true">▲</span>
                        <span className="sr-only">Highest {ch.label}:</span> {fmtValue(ys[iMax])}
                      </button>
                      <button
                        type="button"
                        className="gr-ext-btn"
                        title="Jump to the lowest point in view and pin it"
                        onClick={() => jumpTo(lane, iMin, "min")}
                      >
                        <span aria-hidden="true">▼</span>
                        <span className="sr-only">Lowest {ch.label}:</span> {fmtValue(ys[iMin])}
                      </button>
                    </span>
                  )}
                  <button type="button" className="gr-lane-x" onClick={() => onCols(cols.filter((c) => c !== ch.key))}>
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                    <span className="sr-only">Remove {ch.label}</span>
                  </button>
                </div>
                <svg data-lane={ch.key} viewBox={`0 0 ${width} ${laneH}`} width="100%" height={laneH} aria-hidden="true">
                  {visiblePulls.map((p) => (
                    <rect
                      key={p.n}
                      className="gr-pull-band"
                      x={x(Math.max(p.start_s, t0))}
                      width={Math.max(2, x(Math.min(p.end_s, t1)) - x(Math.max(p.start_s, t0)))}
                      y="0"
                      height={laneH}
                    />
                  ))}
                  <line className="gr-lane-base" x1={PAD_L} x2={width - PAD_R} y1={laneH - 0.5} y2={laneH - 0.5} />
                  <line className="gr-lane-mid" x1={PAD_L} x2={width - PAD_R} y1={laneH / 2} y2={laneH / 2} />
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
                    {fmtValue(hi)}
                  </text>
                  <text className="gr-lane-tick" x={PAD_L - 6} y={laneH / 2 + 3} textAnchor="end">
                    {fmtValue((hi + lo) / 2)}
                  </text>
                  <text className="gr-lane-tick" x={PAD_L - 6} y={laneH - 3} textAnchor="end">
                    {fmtValue(lo)}
                  </text>
                  <path className="gr-lane-line" d={paths.get(ch.key)} />
                  {!flat && (
                    <>
                      <path className="gr-ext gr-ext--max" d={mark(iMax, true)} />
                      <path className="gr-ext gr-ext--min" d={mark(iMin, false)} />
                    </>
                  )}
                  {pins.filter((p) => inView(p.t)).map((p) => {
                    const v = pinValue(p, lane);
                    const px = x(p.t);
                    const dx = x(pinTime(p, lane));
                    const has = v !== null && v !== undefined;
                    return (
                      <g key={p.id} className="gr-pin">
                        <line x1={px} x2={px} y1="0" y2={laneH} />
                        {/* This lane peaked a moment off the pin: tie its dot back to the line. */}
                        {has && Math.abs(dx - px) > 1.5 && <line className="gr-pin-link" x1={px} x2={dx} y1={y(v)} y2={y(v)} />}
                        {has && <circle cx={dx} cy={y(v)} r="4" />}
                      </g>
                    );
                  })}
                  {hoverT !== null && (
                    <>
                      <line className="gr-cross" x1={x(hoverT)} x2={x(hoverT)} y1="0" y2={laneH} />
                      {value !== null && Math.abs(x(tL) - x(hoverT)) > 1.5 && (
                        <line className="gr-cross-link" x1={x(hoverT)} x2={x(tL)} y1={y(value)} y2={y(value)} />
                      )}
                      {value !== null && (
                        <circle className={`gr-cross-dot ${hot ? "is-hot" : ""}`} cx={x(tL)} cy={y(value)} r={hot ? 5.5 : 3.5} />
                      )}
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
            {pins.filter((p) => inView(p.t)).map((p) => (
              <g key={p.id} className="gr-pin-flag">
                <rect x={x(p.t) - 8} y={3} width={16} height={16} rx={4} />
                <text x={x(p.t)} y={15} textAnchor="middle">
                  {p.id}
                </text>
              </g>
            ))}
            {hoverT !== null && (
              <text className="gr-axis-hot" x={Math.min(Math.max(x(hoverT), PAD_L + 22), width - PAD_R - 22)} y={16} textAnchor="middle">
                {fmtTime(hoverT)}
              </text>
            )}
          </svg>
          {drag && Math.abs(drag.x1 - drag.x0) >= 2 && (
            <div className="gr-brush" style={{ left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0) }} />
          )}
        </div>
      )}

      {pins.length > 0 && (
        <div className="gr-readout">
          <div className="gr-readout-bar">
            <p className="gr-readout-title">
              {pinB ? `A → B · ${fmtDelta(pinB.t - pinA.t, "s")}` : `Pinned at ${fmtTime(pinA.t)}`}
            </p>
            {pinB && (
              <button
                type="button"
                className="gr-chip gr-chip--btn"
                onClick={() => onZoom(Math.max(0, Math.min(pinA.t, pinB.t) - 0.5), Math.max(pinA.t, pinB.t) + 0.5)}
              >
                <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true" /> Zoom to A–B
              </button>
            )}
            <button type="button" className="gr-link" onClick={() => setPins([])}>
              Clear
            </button>
          </div>
          <div className="gr-table-wrap" data-lenis-prevent>
            <table className="gr-table gr-readout-table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  {pins.map((p) => (
                    <th key={p.id} scope="col">
                      <span className="gr-pin-tag">{p.id}</span> {fmtTime(p.t)}
                    </th>
                  ))}
                  {pinB && <th scope="col">Change</th>}
                </tr>
              </thead>
              <tbody>
                {lanes.map((lane) => {
                  const a = pinValue(pinA, lane);
                  const b = pinB ? pinValue(pinB, lane) : null;
                  return (
                    <tr key={lane.ch.key}>
                      <th scope="row">{lane.ch.label}</th>
                      <td>
                        {fmtValue(a, lane.ch.unit)} {offAt(pinA, lane)}
                      </td>
                      {pinB && (
                        <td>
                          {fmtValue(b, lane.ch.unit)} {offAt(pinB, lane)}
                        </td>
                      )}
                      {pinB && <td>{a === null || b === null ? "–" : fmtDelta(b - a, lane.ch.unit)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="gr-chart-hint">
        {data && data.decimated
          ? `Showing ${t.length.toLocaleString("en-CA")} of ${data.rawPoints.toLocaleString("en-CA")} samples, peaks kept; zoom in for exact timing. `
          : ""}
        Hover snaps to the nearest point and lines peaks up across lanes · click to pin A and B · drag to zoom
        {pulls && pulls.length ? " · or jump to a pull" : ""}.
      </p>
    </section>
  );
};

export default ChannelChart;
