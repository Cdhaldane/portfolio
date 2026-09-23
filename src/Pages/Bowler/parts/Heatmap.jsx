import Reveal from "../../../Components/Reveal/Reveal";
import { BOWLERS, formatNight } from "../bowlers";
import { seriesFor, seriesTotal } from "../stats";

/*
 * One square per league WEEK (league is weekly, so a day grid would be six
 * empty squares for every full one). Each bowler's squares are a single-
 * hue ramp of their own series range, light to dark. A skipped week is an
 * outlined hole.
 */
const DAY = 24 * 60 * 60 * 1000;
const LEVELS = 5;

const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
};

function weeksBetween(first, last) {
  const out = [];
  for (let t = new Date(`${first}T12:00:00Z`).getTime(); ; t += 7 * DAY) {
    const iso = new Date(t).toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= last) return out;
  }
}

const Heatmap = ({ series }) => {
  if (!series.length) return null;
  const dates = series.map((s) => s.bowledOn).sort();
  const weeks = weeksBetween(mondayOf(dates[0]), mondayOf(dates[dates.length - 1]));

  const rows = BOWLERS.map(({ key, name }) => {
    const mine = seriesFor(series, key);
    const byWeek = new Map(mine.map((r) => [mondayOf(r.bowledOn), r]));
    const totalsList = mine.map(seriesTotal);
    const lo = Math.min(...totalsList);
    const hi = Math.max(...totalsList);
    const level = (v) => (hi === lo ? 3 : 1 + Math.round(((v - lo) / (hi - lo)) * (LEVELS - 1)));
    return { key, name, byWeek, level };
  });

  return (
    <Reveal as="section" className="bw-heat" aria-labelledby="bw-heat-title">
      <h2 id="bw-heat-title" className="bw-h2">
        League calendar
      </h2>
      <div className="bw-heat-scroll">
        <div className="bw-heat-grid" style={{ "--weeks": weeks.length }}>
          <div className="bw-heat-row bw-heat-row--head" aria-hidden="true">
            <span />
            {weeks.map((w, i) => {
              const month = formatNight(w, { month: "short" });
              const show = i === 0 || formatNight(weeks[i - 1], { month: "short" }) !== month;
              return (
                <span key={w} className="bw-heat-month">
                  {show ? month : ""}
                </span>
              );
            })}
          </div>
          {rows.map((row) => (
            <div key={row.key} className="bw-heat-row" role="list" aria-label={`${row.name}'s league nights`}>
              <span className="bw-heat-name">
                <span className={`bw-chip bw-chip--${row.key}`} aria-hidden="true" /> {row.name}
              </span>
              {weeks.map((w) => {
                const night = row.byWeek.get(w);
                if (!night) {
                  return <span key={w} className="bw-heat-cell is-empty" role="listitem" aria-label={`Week of ${formatNight(w)}: no bowling`} />;
                }
                const total = seriesTotal(night);
                const label = `${formatNight(night.bowledOn)}: ${total} (${night.games.join(", ")})`;
                return (
                  <span
                    key={w}
                    className={`bw-heat-cell bw-heat-cell--${row.key}`}
                    style={{ "--lvl": row.level(total) }}
                    role="listitem"
                    aria-label={label}
                    title={label}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="bw-heat-legend" aria-hidden="true">
        Lower series
        {Array.from({ length: LEVELS }, (_, i) => (
          <span key={i} className="bw-heat-cell bw-heat-cell--legend" style={{ "--lvl": i + 1 }} />
        ))}
        Higher, for each bowler's own range
      </p>
    </Reveal>
  );
};

export default Heatmap;
