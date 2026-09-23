import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS, formatNight } from "../bowlers";

/*
 * The household rivalry. Only nights BOTH bowled count. The split bar is a
 * part-to-whole of nights won (no background track): two segments that
 * meet, with a 2px surface gap between them.
 */
const HeadToHead = ({ loading, h2h, stats }) => {
  if (loading) return null;
  const [a, b] = BOWLERS;
  const decided = h2h.nights.a + h2h.nights.b;
  const leader =
    h2h.nights.a === h2h.nights.b ? null : h2h.nights.a > h2h.nights.b ? a : b;
  const avgGap =
    stats.cha.average !== null && stats.van.average !== null
      ? Math.abs(stats.cha.average - stats.van.average).toFixed(1)
      : null;

  return (
    <Reveal as="section" className="bw-h2h" aria-labelledby="bw-h2h-title">
      <h2 id="bw-h2h-title" className="bw-h2">
        {leader ? `${leader.name} leads the rivalry` : "The rivalry"}
      </h2>

      {h2h.shared === 0 ? (
        <p className="bw-muted">Bowl the same night to start the head-to-head.</p>
      ) : (
        <div className="bw-h2h-grid">
          <div className="bw-h2h-score" aria-label={`Nights won: ${a.name} ${h2h.nights.a}, ${b.name} ${h2h.nights.b}`}>
            <span className="bw-h2h-side">
              <span className="bw-chip bw-chip--cha" aria-hidden="true" /> {a.short}
            </span>
            <span className="bw-h2h-big">{h2h.nights.a}</span>
            <span className="bw-h2h-dash" aria-hidden="true">:</span>
            <span className="bw-h2h-big">{h2h.nights.b}</span>
            <span className="bw-h2h-side">
              {b.short} <span className="bw-chip bw-chip--van" aria-hidden="true" />
            </span>
          </div>

          {decided > 0 && (
            <div className="bw-h2h-split" aria-hidden="true">
              <span className="bw-h2h-seg bw-h2h-seg--cha" style={{ flexGrow: h2h.nights.a }} />
              <span className="bw-h2h-seg bw-h2h-seg--van" style={{ flexGrow: h2h.nights.b }} />
            </div>
          )}

          <dl className="bw-h2h-facts">
            <div>
              <dt>Nights head to head</dt>
              <dd>
                {h2h.shared}
                {h2h.nights.tie > 0 && <small> ({h2h.nights.tie} tied)</small>}
              </dd>
            </div>
            <div>
              <dt>Games won</dt>
              <dd>
                {h2h.games.a} <small>to</small> {h2h.games.b}
              </dd>
            </div>
            <div>
              <dt>Biggest blowout</dt>
              <dd>
                {h2h.biggest ? (
                  <>
                    {h2h.biggest.margin}
                    <small>
                      {" "}
                      pins, {BOWLERS.find((bw) => bw.key === h2h.biggest.winner).name},{" "}
                      {formatNight(h2h.biggest.date)}
                    </small>
                  </>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>Average gap</dt>
              <dd>
                {avgGap ?? "-"}
                {avgGap && <small> pins/game</small>}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Reveal>
  );
};

export default HeadToHead;
