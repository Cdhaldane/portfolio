import { Link } from "react-router-dom";
import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS, MAX_GAME } from "../bowlers";
import { Rack } from "./PinDeck";

/*
 * Why the scores move: the two bowlers side by side, one row per frame
 * stat. It's a real table (screen readers get it as-is); each value has a
 * thin bar on that row's own honest scale (0-100%, 0-10 pins, 0-300), and
 * the better number of the pair is bold. Ink carries the numbers; the
 * series colour only marks whose bar it is.
 *
 * Frame stats only count games entered frame by frame, so the header says
 * how many that is, and a bowler with none shows dashes, not zeros.
 */
const rate = (pick) => ({
  get: (s) => pick(s.frames).pct,
  scale: 100,
  show: (v) => `${v}%`,
  sub: (s) => {
    const r = pick(s.frames);
    return r.chances ? `${r.made} of ${r.chances}` : null;
  },
});

const ROWS = [
  { id: "strike", label: "Strikes", ...rate((f) => f.strike) },
  { id: "spare", label: "Spares", ...rate((f) => f.spare) },
  { id: "single", label: "Single-pin spares", ...rate((f) => f.single) },
  { id: "multi", label: "Multi-pin spares", hint: "not splits", ...rate((f) => f.multi) },
  { id: "split", label: "Splits picked up", ...rate((f) => f.split) },
  { id: "pocket", label: "Pocket hits", hint: "when noted", ...rate((f) => f.pocket) },
  {
    id: "first",
    label: "First-ball average",
    get: (s) => s.frames.firstBall,
    scale: 10,
    show: (v) => v.toFixed(1),
    sub: () => "pins",
  },
  {
    id: "opens",
    label: "Open frames",
    hint: "fewer is better",
    get: (s) => s.frames.opensPerGame,
    scale: 10,
    lowerWins: true,
    show: (v) => v.toFixed(1),
    sub: () => "per game",
  },
  ...[0, 1, 2].map((i) => ({
    id: `g${i + 1}`,
    label: `Game ${i + 1} average`,
    hint: i === 0 ? "every game" : null,
    get: (s) => s.scores.splits[i],
    scale: MAX_GAME,
    show: (v) => Math.round(v),
    sub: () => null,
  })),
];

function leader(row, values) {
  const [a, b] = values;
  if (a === null || b === null || a === b) return null;
  return (row.lowerWins ? a < b : a > b) ? 0 : 1;
}

const Leaves = ({ name, leaves }) => (
  <div className="bw-fs-leaves-col">
    <h3>{name}'s most common leaves</h3>
    {leaves.length ? (
      <ol>
        {leaves.map((l) => (
          <li key={l.key}>
            <Rack pins={l.pins} />
            <span className="bw-fs-leave-key">
              {l.key}
              {l.split && <small>split</small>}
            </span>
            <span className="bw-fs-leave-seen">{l.chances}&times;</span>
            <span className="bw-fs-leave-rate">
              {l.pct}%<small> made</small>
            </span>
          </li>
        ))}
      </ol>
    ) : (
      <p className="bw-muted">No leaves tracked yet.</p>
    )}
  </div>
);

const FrameStats = ({ frames, stats }) => {
  const framed = BOWLERS.some((b) => frames[b.key].games > 0);

  if (!framed) {
    return (
      <Reveal as="section" className="bw-fs bw-fs--empty" aria-labelledby="bw-fs-title">
        <h2 id="bw-fs-title" className="bw-h2">
          Frame by frame
        </h2>
        <p>
          Score a night ball by ball and this fills in: strike and spare rates, single pins
          against buckets and splits, open frames, pocket hits and the leaves you see most.
        </p>
        <Link to="/bowler/lane" className="bw-btn bw-btn--ghost">
          <i className="fa-solid fa-bowling-ball" aria-hidden="true" /> Score live
        </Link>
      </Reveal>
    );
  }

  const both = Object.fromEntries(
    BOWLERS.map((b) => [b.key, { frames: frames[b.key], scores: stats[b.key] }])
  );

  return (
    <Reveal as="section" className="bw-fs" aria-labelledby="bw-fs-title">
      <h2 id="bw-fs-title" className="bw-h2">
        Frame by frame
      </h2>
      <p className="bw-fs-cover">
        {BOWLERS.map((b) => (
          <span key={b.key}>
            <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" /> {b.name}:{" "}
            {frames[b.key].games} of {frames[b.key].totalGames} games tracked
          </span>
        ))}
      </p>

      <div className="bw-fs-scroll">
        <table className="bw-fs-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Stat</span>
              </th>
              {BOWLERS.map((b) => (
                <th key={b.key} scope="col">
                  <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" /> {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const values = BOWLERS.map((b) => {
                const v = row.get(both[b.key]);
                return v === null || v === undefined ? null : v;
              });
              const lead = leader(row, values);
              return (
                <tr key={row.id}>
                  <th scope="row">
                    {row.label}
                    {row.hint && <small>{row.hint}</small>}
                  </th>
                  {BOWLERS.map((b, i) => {
                    const v = values[i];
                    const sub = v === null ? null : row.sub(both[b.key]);
                    return (
                      <td key={b.key} className={`bw-fs-cell bw-fs-cell--${b.key}`}>
                        <span className={`bw-fs-val ${lead === i ? "is-lead" : ""}`}>
                          {v === null ? "-" : row.show(v)}
                        </span>
                        {sub && <span className="bw-fs-sub">{sub}</span>}
                        <span
                          className="bw-fs-bar"
                          style={{ "--w": v === null ? 0 : Math.min(1, v / row.scale) }}
                          aria-hidden="true"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bw-fs-leaves">
        {BOWLERS.map((b) => (
          <Leaves key={b.key} name={b.name} leaves={frames[b.key].leaves} />
        ))}
      </div>
    </Reveal>
  );
};

export default FrameStats;
