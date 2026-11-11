import { Link } from "react-router-dom";
import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS } from "../bowlers";
import { NEAR, SPREAD, leanText } from "../lanePlay";
import "./lanePlay.css";

/*
 * Lane play: where the first ball really goes and where each bowler bowls
 * best. Two columns, one per bowler, each with
 *   - the miss chart: first balls by how far they crossed from the target
 *     board, outside on the left, inside on the right, the on-target bins
 *     lit. Bars grow in (transform only) when the section scrolls in;
 *   - strike rate on target against off it, and the most-used targets;
 *   - averages by lane pair, each bar diverging from the bowler's overall
 *     average, with the best and toughest pair tagged.
 * Everything here comes from what's noted while scoring live, so each
 * empty part says what to note.
 */
const binLabel = (i) => {
  const miss = i - SPREAD;
  if (miss === 0) return "on target";
  const edge = Math.abs(miss) === SPREAD ? "+" : "";
  return `${Math.abs(miss)}${edge} ${miss < 0 ? "outside" : "inside"}`;
};

const MissChart = ({ bins }) => {
  const top = Math.max(1, ...bins);
  const summary = bins.map((n, i) => `${n} ${binLabel(i)}`).join(", ");
  return (
    <figure className="bw-lp-chart">
      <div className="bw-lp-bars" role="img" aria-label={`First balls by miss: ${summary}`}>
        {bins.map((n, i) => {
          const miss = i - SPREAD;
          const tone = miss === 0 ? "is-hit" : Math.abs(miss) <= NEAR ? "is-near" : "";
          return (
            <span key={i} className={`bw-lp-bin ${tone}`} style={{ "--i": i }}>
              <span className="bw-lp-bar" style={{ "--h": n / top }} />
              <span className="bw-lp-count" aria-hidden="true">
                {n || ""}
              </span>
            </span>
          );
        })}
      </div>
      <figcaption className="bw-lp-axis" aria-hidden="true">
        <span>outside</span>
        <span>target</span>
        <span>inside</span>
      </figcaption>
    </figure>
  );
};

const pct = (r) => (r.pct === null ? "-" : `${Math.round(r.pct)}%`);

const Accuracy = ({ boards }) => {
  if (!boards.throws) {
    return (
      <p className="bw-muted bw-lp-none">
        Note the target board and where the ball crossed (Boards &amp; pocket, when you score live)
        and your miss pattern shows up here.
      </p>
    );
  }
  return (
    <>
      <p className="bw-lp-big">
        <b>{pct(boards.onTarget)}</b>
        <span>
          within a board of the target
          <small>
            {boards.onTarget.made} of {boards.throws} first balls
          </small>
        </span>
      </p>
      <p className="bw-lp-lean">{leanText(boards.lean)}</p>
      <MissChart bins={boards.bins} />
      <dl className="bw-lp-strikes">
        <div>
          <dt>Strikes on target</dt>
          <dd>
            {pct(boards.strikeNear)}
            <small>{boards.strikeNear.chances} balls</small>
          </dd>
        </div>
        <div>
          <dt>Strikes off it</dt>
          <dd>
            {pct(boards.strikeFar)}
            <small>{boards.strikeFar.chances} balls</small>
          </dd>
        </div>
      </dl>
      <ul className="bw-lp-targets" aria-label="Most-used target boards">
        {boards.targets.map((t) => (
          <li key={t.board}>
            <span className="bw-lp-board">Board {t.board}</span>
            <span>
              {t.throws} {t.throws === 1 ? "ball" : "balls"}
            </span>
            <span>{pct(t.strike)} strikes</span>
          </li>
        ))}
      </ul>
    </>
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

const LanePlay = ({ boards, lanes }) => {
  const any = BOWLERS.some((b) => boards[b.key].throws > 0 || lanes[b.key].pairs.length > 0);

  if (!any) {
    return (
      <Reveal as="section" className="bw-lp bw-lp--empty" aria-labelledby="bw-lp-title">
        <h2 id="bw-lp-title" className="bw-h2">
          Lane play
        </h2>
        <p>
          When you score live, note the lane pair and, under Boards &amp; pocket, the board you
          aimed at and the one the ball crossed. This fills in with where your first ball really
          goes, how often that's a strike, and which pairs treat you best.
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
            <Accuracy boards={boards[b.key]} />
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
