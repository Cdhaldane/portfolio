import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS } from "../bowlers";
import { ALL_TIME, MIN_SEASON_NIGHTS, bestSeasonKey } from "../seasons";

/*
 * SeasonBar scopes every stat panel below it to one season (or all time).
 * SeasonCompare lays the seasons side by side and crowns each bowler's
 * best (min three nights, and only once there's a second season to beat).
 */
export const SeasonBar = ({ seasons, value, onChange }) => {
  if (seasons.length < 1) return null;
  const options = [{ key: ALL_TIME, label: "All time" }, ...seasons];
  return (
    <nav className="bw-seasonbar" aria-label="Season">
      {options.map((s) => (
        <button
          key={s.key}
          type="button"
          aria-pressed={value === s.key}
          className={`bw-season-pill ${value === s.key ? "is-on" : ""}`}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
};

export const SeasonCompare = ({ summary }) => {
  if (summary.length < 2) return null;
  const best = Object.fromEntries(BOWLERS.map((b) => [b.key, bestSeasonKey(summary, b.key)]));

  return (
    <Reveal as="section" className="bw-seasons" aria-labelledby="bw-seasons-title">
      <h2 id="bw-seasons-title" className="bw-h2">
        Season by season
      </h2>
      <div className="bw-seasons-row">
        {summary
          .slice()
          .reverse()
          .map((season) => (
            <article key={season.key} className="bw-season-card">
              <h3>{season.label}</h3>
              <dl>
                {BOWLERS.map(({ key, short }) => {
                  const b = season.byBowler[key];
                  return (
                    <div key={key} className="bw-season-line">
                      <dt>
                        <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" /> {short}
                        {best[key] === season.key && (
                          <span className="bw-season-crown" title="Best season">
                            <i className="fa-solid fa-crown" aria-hidden="true" />
                            <span className="sr-only">best season</span>
                          </span>
                        )}
                      </dt>
                      <dd>
                        {b.nights ? (
                          <>
                            <strong>{b.average.toFixed(1)}</strong>
                            <small>
                              {b.nights} {b.nights === 1 ? "night" : "nights"}, high {b.highSeries}
                            </small>
                          </>
                        ) : (
                          <small>Sat this one out</small>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </article>
          ))}
      </div>
      <p className="bw-muted bw-seasons-note">
        Best season needs at least {MIN_SEASON_NIGHTS} nights.
      </p>
    </Reveal>
  );
};
