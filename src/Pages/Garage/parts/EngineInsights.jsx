import { useEffect, useMemo, useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { fmtClock, fmtNum } from "../format";
import Level from "./Level";
import "./EngineInsights.css";

/*
 * How the engine behaved under load, from mqbtel's per-pull insights: a power
 * curve (hp, torque, timing and charge air by rpm), how much headroom the fuel
 * pump, airflow and torque limits had left, and how the DSG shifted. One pull
 * is in focus at a time, in the car's colour; any others stay as grey context
 * lines on the same axes. Hovering one chart moves the cursor on all four.
 */
const H = 168;
const PAD = { top: 10, right: 12, bottom: 24, left: 40 };
const STEP = 250; // mqbtel's CURVE_RPM_STEP
const HPFP_WATCH_PCT = 95; // mqbtel's HPFP_WATCH_PCT

const CURVES = [
  {
    key: "hp",
    label: "Power",
    fmt: (v) => `${fmtNum(v)} hp`,
    lead: (p) => (p.peak_hp === null ? null : `${fmtNum(p.peak_hp)} hp @ ${fmtNum(p.peak_hp_rpm)}`),
  },
  {
    key: "torque_ftlb",
    label: "Torque",
    fmt: (v) => `${fmtNum(v)} ft-lb`,
    lead: (p) => {
      const top = p.curve.reduce((a, c) => (a === null || c.torque_ftlb > a.torque_ftlb ? c : a), null);
      return top && `${fmtNum(top.torque_ftlb)} ft-lb @ ${fmtNum(top.rpm)}`;
    },
  },
  {
    key: "timing_deg",
    label: "Ignition timing",
    fmt: (v) => `${v.toFixed(1)}°`,
    lead: (p) => (p.timing_median_deg === null ? null : `median ${p.timing_median_deg.toFixed(1)}°`),
  },
  {
    key: "cat_c",
    label: "Charge air",
    fmt: (v) => `${fmtNum(v)} °C`,
    lead: (p) => (p.cat_max_c === null ? null : `peak ${fmtNum(p.cat_max_c)} °C`),
  },
];

const HEADROOM = [
  {
    key: "hpfp_max_pct",
    label: "Fuel pump",
    about: "Peak effective volume of the high-pressure pump. At 100% it has nothing left to give.",
  },
  {
    key: "airflow_pct",
    label: "Airflow",
    about: "Median air mass achieved against what the ECU asked for.",
  },
  {
    key: "torque_ceiling_pct",
    label: "Torque vs ceiling",
    about: "Peak torque against the engine's torque ceiling.",
  },
  {
    key: "torque_limited_pct",
    label: "On a torque limiter",
    about: "Share of the pull with a torque limiter in charge.",
  },
];

function useWidth(el) {
  const [width, setWidth] = useState(360);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** SVG path through a curve's bins, broken wherever a bin is missing. */
function linePath(curve, key, x, y) {
  let d = "";
  let prev = null;
  for (const c of curve) {
    if (c[key] === null) {
      prev = null;
      continue;
    }
    d += `${prev !== null && c.rpm - prev === STEP ? "L" : "M"}${x(c.rpm).toFixed(1)},${y(c[key]).toFixed(1)}`;
    prev = c.rpm;
  }
  return d;
}

const CurveChart = ({ def, pulls, focus, domain, hover, onHover }) => {
  const [wrap, setWrap] = useState(null);
  const width = useWidth(wrap);
  const pull = pulls[focus];
  const values = pulls.flatMap((p) => p.curve.map((c) => c[def.key]).filter((v) => v !== null));
  if (!values.length) return null;

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.12, def.key === "timing_deg" ? 1 : 5);
  lo -= pad;
  hi += pad;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (rpm) => PAD.left + ((rpm + STEP / 2 - domain[0]) / (domain[1] - domain[0])) * innerW;
  const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const yTicks = [lo + pad, (lo + hi) / 2, hi - pad];
  const xTicks = [];
  for (let r = Math.ceil(domain[0] / 1000) * 1000; r <= domain[1]; r += 1000) xTicks.push(r);

  const at = hover === null ? null : pull.curve.find((c) => c.rpm === hover && c[def.key] !== null);
  const lead = def.lead(pull);

  /** The focused pull's bin nearest the pointer. */
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * (width / r.width);
    let best = null;
    for (const c of pull.curve) {
      if (c[def.key] === null) continue;
      if (best === null || Math.abs(x(c.rpm) - px) < Math.abs(x(best.rpm) - px)) best = c;
    }
    return best ? best.rpm : null;
  };

  return (
    <figure className="gr-ins-chart" ref={setWrap}>
      <figcaption className="gr-ins-chart-head">
        <span className="gr-ins-chart-label">{def.label}</span>
        <span className="gr-ins-chart-value">
          {at ? `${fmtNum(at.rpm)}–${fmtNum(at.rpm + STEP)} rpm · ${def.fmt(at[def.key])}` : lead || "–"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`${def.label} by rpm for pull ${focus + 1}${lead ? `: ${lead}` : ""}. The table under the charts lists every band.`}
        onPointerMove={(e) => onHover(pick(e))}
        onPointerDown={(e) => onHover(pick(e))}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") onHover(null);
        }}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line className="gr-grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="gr-axis-tick" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {xTicks.map((r) => (
          <text key={r} className="gr-axis-tick" x={x(r - STEP / 2)} y={H - 6} textAnchor="middle">
            {r / 1000}k
          </text>
        ))}
        {pulls.map((p, i) =>
          i === focus ? null : <path key={p.start_s} className="gr-ins-ghost" d={linePath(p.curve, def.key, x, y)} />
        )}
        <path className="gr-ins-line" d={linePath(pull.curve, def.key, x, y)} />
        {pull.curve.map((c) =>
          c[def.key] === null ? null : (
            <circle
              key={c.rpm}
              className={`gr-ins-dot ${at && at.rpm === c.rpm ? "is-hot" : ""}`}
              cx={x(c.rpm)}
              cy={y(c[def.key])}
              r={at && at.rpm === c.rpm ? 5.5 : 4}
            />
          )
        )}
        {at && <line className="gr-cross" x1={x(at.rpm)} x2={x(at.rpm)} y1={PAD.top} y2={PAD.top + innerH} />}
      </svg>
    </figure>
  );
};

const Meter = ({ item, value }) => {
  const watch = item.key === "hpfp_max_pct" && value >= HPFP_WATCH_PCT;
  return (
    <li className="gr-ins-meter">
      <div className="gr-ins-meter-top">
        <span className="gr-ins-meter-label">{item.label}</span>
        {watch && <Level level="watch" />}
        <span className="gr-ins-meter-value">{fmtNum(value)}%</span>
      </div>
      <div
        className="gr-ins-track"
        role="meter"
        aria-label={item.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <span className="gr-ins-fill" style={{ "--v": Math.min(Math.max(value, 0), 100) / 100 }} />
      </div>
      <p className="gr-ins-about">{item.about}</p>
    </li>
  );
};

const EngineInsights = ({ summary }) => {
  const pulls = useMemo(() => summary.pulls.filter((p) => p.curve && p.curve.length), [summary.pulls]);
  const shifts = summary.shifts || [];
  const strongest = pulls.reduce((best, p, i) => ((p.peak_hp ?? -1) > (pulls[best]?.peak_hp ?? -1) ? i : best), 0);
  const [focus, setFocus] = useState(strongest);
  const [hover, setHover] = useState(null);
  const pull = pulls[Math.min(focus, pulls.length - 1)] || null;

  const domain = useMemo(() => {
    const rpms = pulls.flatMap((p) => p.curve.map((c) => c.rpm));
    return rpms.length ? [Math.min(...rpms), Math.max(...rpms) + STEP] : [0, 1];
  }, [pulls]);

  if (!pulls.length && !shifts.length) return null;
  const headroom = pull ? HEADROOM.filter((h) => pull[h.key] !== null && pull[h.key] !== undefined) : [];
  const handovers = shifts.map((s) => s.handover_s).filter((v) => v !== null);
  const inPull = (s) => pull && s.at_s >= pull.start_s && s.at_s <= pull.end_s;

  return (
    <Reveal as="section" className="gr-ins" aria-labelledby="gr-ins-title">
      <div className="gr-section-head">
        <h2 id="gr-ins-title" className="gr-h3">
          Engine insights
        </h2>
        {pulls.length > 1 && (
          <div className="gr-seg" role="group" aria-label="Pull in focus">
            {pulls.map((p, i) => (
              <button
                key={p.start_s}
                type="button"
                className={`gr-seg-btn ${i === focus ? "is-on" : ""}`}
                aria-pressed={i === focus}
                onClick={() => {
                  setFocus(i);
                  setHover(null);
                }}
              >
                Pull {summary.pulls.indexOf(p) + 1} · {fmtClock(p.start_s)}
              </button>
            ))}
          </div>
        )}
      </div>

      {pull && (
        <>
          <p className="gr-ins-legend">
            <span className="gr-ins-key gr-ins-key--focus" aria-hidden="true" />
            Pull {summary.pulls.indexOf(pull) + 1}, {fmtClock(pull.start_s)}–{fmtClock(pull.end_s)}
            {pulls.length > 1 && (
              <>
                <span className="gr-ins-key gr-ins-key--ghost" aria-hidden="true" />
                {pulls.length === 2 ? "the other pull" : "the other pulls"}
              </>
            )}
          </p>
          <div className="gr-ins-curves">
            {CURVES.map((def) => (
              <CurveChart
                key={def.key}
                def={def}
                pulls={pulls}
                focus={pulls.indexOf(pull)}
                domain={domain}
                hover={hover}
                onHover={setHover}
              />
            ))}
          </div>
          <p className="gr-caveat">
            Power is the ECU&apos;s own torque figure times rpm: crank power, not a dyno reading. Each point is the
            median of a {STEP} rpm band, with the moments around a shift left out.
          </p>
          <details className="gr-ins-table">
            <summary>Curve as a table</summary>
            <div className="gr-table-wrap" data-lenis-prevent>
              <table className="gr-table">
                <thead>
                  <tr>
                    <th scope="col">RPM</th>
                    <th scope="col">Power</th>
                    <th scope="col">Torque</th>
                    <th scope="col">Timing</th>
                    <th scope="col">Boost</th>
                    <th scope="col">Charge air</th>
                  </tr>
                </thead>
                <tbody>
                  {pull.curve.map((c) => (
                    <tr key={c.rpm}>
                      <th scope="row">
                        {fmtNum(c.rpm)}–{fmtNum(c.rpm + STEP)}
                      </th>
                      <td>{fmtNum(c.hp)} hp</td>
                      <td>{fmtNum(c.torque_ftlb)} ft-lb</td>
                      <td>{c.timing_deg === null ? "–" : `${c.timing_deg.toFixed(1)}°`}</td>
                      <td>{c.boost_psi === null ? "–" : `${c.boost_psi.toFixed(1)} psi`}</td>
                      <td>{c.cat_c === null ? "–" : `${fmtNum(c.cat_c)} °C`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {headroom.length > 0 && (
            <div className="gr-ins-block">
              <h3 className="gr-ins-h">Headroom</h3>
              <ul className="gr-ins-meters">
                {headroom.map((item) => (
                  <Meter key={`${item.key}-${pull.start_s}`} item={item} value={pull[item.key]} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {shifts.length > 0 && (
        <div className="gr-ins-block">
          <h3 className="gr-ins-h">DSG shifts under load</h3>
          <dl className="gr-ins-facts">
            <div>
              <dt>Median shift</dt>
              <dd>{handovers.length ? `${median(handovers).toFixed(2)} s` : "–"}</dd>
            </div>
            <div>
              <dt>Upshifts</dt>
              <dd>{shifts.length}</dd>
            </div>
            {summary.clutch_slip_rpm !== null && summary.clutch_slip_rpm !== undefined && (
              <div>
                <dt>Clutch 1 slip</dt>
                <dd>{fmtNum(summary.clutch_slip_rpm)} rpm</dd>
              </div>
            )}
          </dl>
          <div className="gr-table-wrap" data-lenis-prevent>
            <table className="gr-table">
              <thead>
                <tr>
                  <th scope="col">Shift</th>
                  <th scope="col">At</th>
                  <th scope="col">RPM</th>
                  <th scope="col">Torque</th>
                  <th scope="col">Gear chosen → handover</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.at_s} className={inPull(s) ? "is-in-pull" : undefined}>
                    <th scope="row">
                      {s.from_gear}→{s.to_gear}
                      {inPull(s) && <small> in pull</small>}
                    </th>
                    <td>{fmtClock(s.at_s)}</td>
                    <td>{fmtNum(s.rpm)}</td>
                    <td>{fmtNum(s.torque_ftlb)} ft-lb</td>
                    <td>{s.handover_s === null ? "No clear handover" : `${s.handover_s.toFixed(2)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gr-caveat">
            Timed from the moment the gearbox picks the next gear to the rpm drop once torque moves over. Useful as
            a trend across logs; there&apos;s no pass mark. Clutch 1 drives gears 1, 3 and 5; clutch 2 isn&apos;t
            logged.
          </p>
        </div>
      )}
    </Reveal>
  );
};

export default EngineInsights;
