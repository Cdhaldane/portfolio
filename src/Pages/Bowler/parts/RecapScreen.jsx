import { BOWLERS, formatNight } from "../bowlers";
import { averageBefore, seriesFor, seriesTotal } from "../stats";
import "./RecapScreen.css";

/*
 * The hero: the latest league night, redrawn as the alley's own recap sheet
 * (brown field, green neon rules, chunky white italic numerals). Each game
 * gets the screen's check or cross: did it beat that bowler's average going
 * into the night?
 */
const Mark = ({ beat }) =>
  beat === null ? null : (
    <span className={`rs-mark ${beat ? "is-beat" : "is-miss"}`}>
      <i className={`fa-solid ${beat ? "fa-check" : "fa-xmark"}`} aria-hidden="true" />
      <span className="sr-only">{beat ? "beat average" : "under average"}</span>
    </span>
  );

function footerLine(night) {
  const [a, b] = BOWLERS.map(({ key }) => night.rows[key]);
  if (!a || !b) {
    const solo = a || b;
    return `${BOWLERS.find((bw) => bw.key === solo.bowler).name} bowled ${seriesTotal(solo)}`;
  }
  const ta = seriesTotal(a);
  const tb = seriesTotal(b);
  if (ta === tb) return `Dead even at ${ta}. Rematch next week`;
  const winner = ta > tb ? BOWLERS[0] : BOWLERS[1];
  return `${winner.name} takes the night by ${Math.abs(ta - tb)} pins`;
}

const RecapScreen = ({ loading, night, series }) => {
  let body;
  if (loading) {
    body = <p className="rs-status rs-blink">Loading recap</p>;
  } else if (!night) {
    body = <p className="rs-status">Insert first night</p>;
  } else {
    body = (
      <table className="rs-table">
        <caption className="sr-only">Recap for {formatNight(night.date)}</caption>
        <thead>
          <tr>
            <th scope="col" className="rs-team">
              {formatNight(night.date, { weekday: "short", month: "short", day: "numeric" })}
            </th>
            <th scope="col">1st</th>
            <th scope="col">2nd</th>
            <th scope="col">3rd</th>
            <th scope="col" className="rs-total-h">Totals</th>
          </tr>
        </thead>
        <tbody>
          {BOWLERS.map(({ key, name }, rowIdx) => {
            const row = night.rows[key];
            const prior = averageBefore(seriesFor(series, key), night.date);
            return (
              <tr key={key} style={{ "--row": rowIdx }}>
                <th scope="row" className="rs-name">
                  <span className={`rs-chip rs-chip--${key}`} aria-hidden="true" />
                  {name}
                </th>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="rs-num">
                    {row ? (
                      <>
                        <Mark beat={prior === null ? null : row.games[i] > prior} />
                        {row.games[i]}
                      </>
                    ) : (
                      <span className="rs-dash">-</span>
                    )}
                  </td>
                ))}
                <td className="rs-num rs-total">{row ? seriesTotal(row) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <figure className="rs" aria-label="Latest league night recap">
      <div className="rs-bezel">
        <div className="rs-screen">
          {body}
          <p className="rs-footer" aria-live="polite">
            {night && !loading ? footerLine(night) : "Snap the screen after league"}
          </p>
        </div>
      </div>
      <div className="rs-stand" aria-hidden="true" />
    </figure>
  );
};

export default RecapScreen;
