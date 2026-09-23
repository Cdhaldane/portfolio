import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS } from "../bowlers";

/*
 * A joke sportsbook board for next league night: recency-weighted
 * projected series and a moneyline from each bowler's swing. Flip-board
 * digits, amber on black.
 */
const Flip = ({ text }) => (
  <span className="bw-flip" aria-hidden="true">
    {String(text)
      .split("")
      .map((ch, i) => (
        <span key={i} className="bw-flip-cell" style={{ "--d": i }}>
          {ch}
        </span>
      ))}
  </span>
);

const TonightsLine = ({ line }) => {
  if (!line) return null;
  const fav = BOWLERS.find((b) => b.key === line.favourite);

  return (
    <Reveal as="section" className="bw-line-board" aria-labelledby="bw-line-title">
      <div className="bw-line-head">
        <h2 id="bw-line-title" className="bw-h2">
          Next week's line
        </h2>
        <p className="bw-line-disclaimer">For bragging rights only. Loser buys the pitcher.</p>
      </div>
      <table className="bw-line-table">
        <thead>
          <tr>
            <th scope="col">Bowler</th>
            <th scope="col">Projected</th>
            <th scope="col">Win %</th>
            <th scope="col">Line</th>
          </tr>
        </thead>
        <tbody>
          {BOWLERS.map(({ key, name }) => {
            const row = line[key];
            const pct = Math.round(row.p * 100);
            return (
              <tr key={key} className={key === line.favourite ? "is-fav" : ""}>
                <th scope="row">
                  <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" /> {name}
                </th>
                <td>
                  <Flip text={row.projected} />
                  <span className="sr-only">{row.projected}</span>
                </td>
                <td>
                  <Flip text={`${pct}%`} />
                  <span className="sr-only">{pct}%</span>
                </td>
                <td>
                  <Flip text={row.line} />
                  <span className="sr-only">{row.line}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="bw-line-foot">
        {fav.name} is the favourite. Odds come from the last five nights, weighted toward
        the most recent.
      </p>
    </Reveal>
  );
};

export default TonightsLine;
