import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS } from "../bowlers";

/*
 * "What to chase next week." Progress is a ten-pin rack with that many
 * pins standing lit, not a bar in a track: 7/10 of the way = 7 pins up.
 */
const Rack = ({ progress }) => {
  const lit = Math.round(progress * 10);
  // Back row first so the rack reads like a pin deck from the bowler.
  const rows = [[6, 7, 8, 9], [3, 4, 5], [1, 2], [0]];
  return (
    <span className="bw-rack" role="img" aria-label={`${lit} of 10`}>
      {rows.map((row, r) => (
        <span key={r} className="bw-rack-row">
          {row.map((i) => (
            <span key={i} className={`bw-rack-pin ${i < lit ? "is-up" : ""}`} />
          ))}
        </span>
      ))}
    </span>
  );
};

const Milestones = ({ goals }) => {
  const any = BOWLERS.some((b) => goals[b.key].length);
  if (!any) return null;

  return (
    <Reveal as="section" className="bw-goals" aria-labelledby="bw-goals-title">
      <h2 id="bw-goals-title" className="bw-h2">
        Next week's targets
      </h2>
      <div className="bw-goals-grid">
        {BOWLERS.map(({ key, name }) => (
          <div key={key} className="bw-goals-col">
            <h3 className="bw-goals-name">
              <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" /> {name}
            </h3>
            {goals[key].length ? (
              <ul>
                {goals[key].map((g) => (
                  <li key={g.id} className="bw-goal">
                    <Rack progress={g.progress} />
                    <div>
                      <p className="bw-goal-label">{g.label}</p>
                      <p className="bw-goal-detail">{g.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bw-muted">Bowl a night to get targets.</p>
            )}
          </div>
        ))}
      </div>
    </Reveal>
  );
};

export default Milestones;
