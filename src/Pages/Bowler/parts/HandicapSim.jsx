import { useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS, HANDICAP_BASIS, HANDICAP_PERCENT } from "../bowlers";
import { handicapFor } from "../stats";
import { nightsToTarget, pinsNeeded, simulate } from "../insights";

/*
 * Two dials: "what if I bowl X next week?" and "what does it take to
 * average Y?". Both read the bowler's all-time totals, the same numbers the
 * league's handicap uses.
 */
const MAX_SERIES = 900;

const HandicapSim = ({ totals, stats }) => {
  const withNights = BOWLERS.filter((b) => totals[b.key].count > 0);
  const [who, setWho] = useState(withNights[0] ? withNights[0].key : null);
  const current = who ? stats[who] : null;
  const [next, setNext] = useState(() =>
    current && current.average ? Math.round(current.average * 3) : 450
  );
  const [target, setTarget] = useState(() =>
    current && current.average ? Math.floor(current.average / 10) * 10 + 10 : 150
  );

  if (!who) return null;

  const t = totals[who];
  const after = simulate(t, next);
  const need = pinsNeeded(t, target);
  const nights = nightsToTarget(t, target);
  const delta = Math.round((after.average - current.average) * 10) / 10;

  const pick = (key) => {
    setWho(key);
    const s = stats[key];
    setNext(Math.round(s.average * 3));
    setTarget(Math.floor(s.average / 10) * 10 + 10);
  };

  let targetAnswer;
  if (target <= current.average) {
    targetAnswer = "You're already there. Dream bigger.";
  } else if (need <= MAX_SERIES) {
    targetAnswer = `Bowl a ${need} series next week (${Math.ceil(need / 3)} a game).`;
  } else if (nights) {
    targetAnswer = `Not in one night. At a 600 pace that's about ${nights} nights.`;
  } else {
    targetAnswer = "Out of reach at a 600 pace. Time for a new ball.";
  }

  return (
    <Reveal as="section" className="bw-sim" aria-labelledby="bw-sim-title">
      <div className="bw-sim-head">
        <h2 id="bw-sim-title" className="bw-h2">
          Handicap simulator
        </h2>
        {withNights.length > 1 && (
          <div className="bw-tabs" role="tablist" aria-label="Bowler">
            {withNights.map((b) => (
              <button
                key={b.key}
                type="button"
                role="tab"
                aria-selected={who === b.key}
                className={`bw-tab ${who === b.key ? "is-on" : ""}`}
                onClick={() => pick(b.key)}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bw-sim-grid">
        <div className="bw-sim-dial">
          <label htmlFor="bw-sim-next">If next week's series is</label>
          <output className="bw-sim-big">{next}</output>
          <input
            id="bw-sim-next"
            type="range"
            min="0"
            max={MAX_SERIES}
            step="1"
            value={next}
            onChange={(e) => setNext(Number(e.target.value))}
          />
          <dl className="bw-sim-out">
            <div>
              <dt>New average</dt>
              <dd>
                {after.average.toFixed(1)}{" "}
                <small className={delta >= 0 ? "is-up" : "is-down"}>
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}
                </small>
              </dd>
            </div>
            <div>
              <dt>Handicap</dt>
              <dd>
                {after.handicap} <small>from {current.handicap}</small>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bw-sim-dial">
          <label htmlFor="bw-sim-target">To average</label>
          <output className="bw-sim-big">{target}</output>
          <input
            id="bw-sim-target"
            type="range"
            min="60"
            max="250"
            step="1"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          />
          <p className="bw-sim-answer">{targetAnswer}</p>
          <p className="bw-sim-note">
            Handicap there: {handicapFor(target)} ({Math.round(HANDICAP_PERCENT * 100)}% of{" "}
            {HANDICAP_BASIS} minus average)
          </p>
        </div>
      </div>
    </Reveal>
  );
};

export default HandicapSim;
