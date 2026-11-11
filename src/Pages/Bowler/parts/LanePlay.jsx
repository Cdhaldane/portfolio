import { Link } from "react-router-dom";
import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS } from "../bowlers";
import { handOf } from "../hand";
import { BOARD, HEIGHT, HOOK_Y, WIDTH, aimName, boardX, linePath } from "../laneLine";
import LaneBed from "./LaneBed";
import "./lanePlay.css";

/*
 * Lane play: the lines the first ball takes and where each bowler bowls
 * best. Two columns, one per bowler, each with
 *   - the lines chart: the latest first balls drawn on the lane from where
 *     they were aimed and where they hooked, strikes in the bowler's colour
 *     and the rest faint, with the hook zone that strikes most lit. The
 *     lines draw themselves on when the section scrolls in;
 *   - the aims used most, with how often each strikes and where it hooks;
 *   - averages by lane pair, each bar diverging from the bowler's overall
 *     average, with the best and toughest pair tagged.
 * Everything here comes from what's noted while scoring live, so each
 * empty part says what to note.
 */
const pct = (r) => (r.pct === null ? "-" : `${Math.round(r.pct)}%`);
const boards = (from, to) => (from === to ? `board ${from}` : `boards ${from}–${to}`);

const LinesChart = ({ lines, hand, name }) => {
  const { recent, zone } = lines;
  // Misses first, so the strikes draw over them.
  const drawn = recent.map((l, i) => ({ ...l, i })).sort((a, b) => a.strike - b.strike);
  const strikes = recent.filter((l) => l.strike).length;
  const zoneX = zone && Math.min(boardX(zone.from, hand), boardX(zone.to, hand)) - BOARD / 2;
  return (
    <figure className="bw-lp-lane">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${name}'s last ${recent.length} first balls on the lane, ${strikes} of them strikes${
          zone ? `; hooking at ${boards(zone.from, zone.to)} strikes most` : ""
        }.`}
      >
        <LaneBed hand={hand} />
        {zone && (
          <rect
            x={zoneX}
            y={HOOK_Y - 16}
            width={(zone.to - zone.from + 1) * BOARD}
            height={32}
            rx="4"
            className="bw-lp-zone"
          />
        )}
        {drawn.map((l) => (
          <path
            key={l.i}
            d={linePath(l.aim, l.hook, hand)}
            pathLength="1"
            className={`bw-lp-path ${l.strike ? "is-strike" : ""}`}
            style={{ "--i": l.i }}
          />
        ))}
      </svg>
      <figcaption className="bw-lp-legend" aria-hidden="true">
        <span className="is-strike">strike</span>
        <span>no strike</span>
        {zone && <span className="is-zone">strike zone</span>}
      </figcaption>
    </figure>
  );
};

const FirstBall = ({ lines, hand, name }) => {
  if (!lines.throws) {
    return (
      <p className="bw-muted bw-lp-none">
        Tap where you aimed and where the ball hooked (Aim &amp; hook, when you score live) and your
        lines draw themselves here.
      </p>
    );
  }
  const { zone } = lines;
  return (
    <div className="bw-lp-first">
      <LinesChart lines={lines} hand={hand} name={name} />
      <div className="bw-lp-first-text">
        <p className="bw-lp-big">
          <b>{pct(lines.strike)}</b>
          <span>
            strikes
            <small>
              {lines.strike.made} of {lines.throws} marked first balls
            </small>
          </span>
        </p>
        <p className="bw-lp-zone-text">
          {zone ? (
            <>
              Hooking at <b>{boards(zone.from, zone.to)}</b> strikes {zone.strike.made} of {zone.throws} (
              {pct(zone.strike)}).
            </>
          ) : (
            "Mark a few more and the hook that strikes most lights up."
          )}
        </p>
        <ul className="bw-lp-targets" aria-label="Aims used most">
          {lines.aims.map((a) => (
            <li key={a.board}>
              <span className="bw-lp-board">{aimName(a.board, hand)}</span>
              <span>
                {a.throws} {a.throws === 1 ? "ball" : "balls"} · {pct(a.strike)} strikes · hooks near{" "}
                {Math.round(a.hook)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const Pairs = ({ lanes }) => {
  if (!lanes.pairs.length) {
    return (
      <p className="bw-muted bw-lp-none">
        Add the lane number when you score and you'll see which pairs treat you best.
      </p>
    );
  }
  const reach = Math.max(10, ...lanes.pairs.map((p) => Math.abs(p.diff || 0)));
  return (
    <ol className="bw-lp-pairs">
      {lanes.pairs.map((p) => {
        const tag = p.lane === lanes.best ? "best" : p.lane === lanes.worst ? "toughest" : null;
        const diff = p.diff === null ? 0 : p.diff;
        return (
          <li key={p.lane} className={tag ? `is-${tag}` : ""}>
            <span className="bw-lp-pair">
              {p.label.replace("-", "–")}
              {tag && <small>{tag}</small>}
            </span>
            <span className="bw-lp-games">
              {p.games} {p.games === 1 ? "game" : "games"}
            </span>
            <span className="bw-lp-avg">{Math.round(p.average)}</span>
            <span
              className={`bw-lp-diff ${diff >= 0 ? "is-up" : "is-down"}`}
              style={{ "--d": Math.min(1, Math.abs(diff) / reach) }}
              aria-label={`${diff >= 0 ? "+" : "-"}${Math.abs(diff)} against your average`}
            >
              <span className="bw-lp-diff-bar" aria-hidden="true" />
              <span className="bw-lp-diff-num" aria-hidden="true">
                {diff >= 0 ? "+" : "−"}
                {Math.abs(Math.round(diff))}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const LanePlay = ({ lines, lanes }) => {
  const any = BOWLERS.some((b) => lines[b.key].throws > 0 || lanes[b.key].pairs.length > 0);

  if (!any) {
    return (
      <Reveal as="section" className="bw-lp bw-lp--empty" aria-labelledby="bw-lp-title">
        <h2 id="bw-lp-title" className="bw-h2">
          Lane play
        </h2>
        <p>
          When you score live, note the lane pair and, under Aim &amp; hook, tap the lane where you
          aimed and where the ball hooked. This fills in with the lines your first ball takes,
          where it needs to hook to strike, and which pairs treat you best.
        </p>
        <Link to="/bowler/lane" className="bw-btn bw-btn--ghost">
          <i className="fa-solid fa-bowling-ball" aria-hidden="true" /> Score live
        </Link>
      </Reveal>
    );
  }

  return (
    <Reveal as="section" className="bw-lp" aria-labelledby="bw-lp-title">
      <h2 id="bw-lp-title" className="bw-h2">
        Lane play
      </h2>
      <div className="bw-lp-grid">
        {BOWLERS.map((b) => (
          <div key={b.key} className={`bw-lp-col bw-lp-col--${b.key}`}>
            <h3>
              <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" /> {b.name}
            </h3>
            <h4>First ball</h4>
            <FirstBall lines={lines[b.key]} hand={handOf(b.key)} name={b.name} />
            <h4>
              By lane pair
              {lanes[b.key].overall !== null && <small>against a {Math.round(lanes[b.key].overall)} average</small>}
            </h4>
            <Pairs lanes={lanes[b.key]} />
          </div>
        ))}
      </div>
    </Reveal>
  );
};

export default LanePlay;
