import { motion, useReducedMotion } from "framer-motion";
import { BOWLERS, HANDICAP_BASIS, formatNight } from "../bowlers";
import CountUp from "./CountUp";

/*
 * One "ball return" card per bowler: the average as the hero number, then
 * bests, handicap, form and which game of the set they own.
 */
const Stat = ({ label, value, sub }) => (
  <div className="bw-stat">
    <dt>{label}</dt>
    <dd>
      <span className="bw-stat-value">{value}</span>
      {sub && <span className="bw-stat-sub">{sub}</span>}
    </dd>
  </div>
);

function formLine(stats) {
  if (stats.form === null) return "Form shows after four nights";
  if (stats.form === 0) return "Dead level with your average lately";
  const up = stats.form > 0;
  return (
    <>
      <i className={`fa-solid ${up ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}`} aria-hidden="true" />{" "}
      {up ? "+" : ""}
      {stats.form} pins/game over the last 3 nights
    </>
  );
}

const Splits = ({ splits }) => {
  const top = Math.max(...splits.filter((s) => s !== null), 1);
  return (
    <div className="bw-splits" aria-label="Average by game of the set">
      {splits.map((s, i) => (
        <div key={i} className="bw-split">
          <span
            className="bw-split-bar"
            style={{ "--h": s === null ? 0 : s / top }}
            aria-hidden="true"
          />
          <span className="bw-split-val">{s === null ? "-" : Math.round(s)}</span>
          <span className="bw-split-label">G{i + 1}</span>
        </div>
      ))}
    </div>
  );
};

const Skeleton = () => (
  <div className="bw-cards">
    {BOWLERS.map((b) => (
      <div key={b.key} className="bw-card bw-card--skeleton" aria-hidden="true">
        <span className="bw-skel bw-skel--title" />
        <span className="bw-skel bw-skel--hero" />
        <span className="bw-skel bw-skel--row" />
      </div>
    ))}
  </div>
);

const BowlerCards = ({ loading, stats }) => {
  const reduce = useReducedMotion();
  if (loading) return <Skeleton />;

  return (
    <section className="bw-cards" aria-label="Bowler stats">
      {BOWLERS.map(({ key, name }, i) => {
        const s = stats[key];
        return (
          <motion.article
            key={key}
            className={`bw-card bw-card--${key}`}
            initial={reduce ? false : { opacity: 0, y: 28, rotate: i ? 1.5 : -1.5 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ type: "spring", stiffness: 110, damping: 18, delay: i * 0.08 }}
          >
            <header className="bw-card-head">
              <span className={`bw-ball bw-ball--${key}`} aria-hidden="true" />
              <h3>{name}</h3>
              <span className="bw-card-nights">
                {s.nights} {s.nights === 1 ? "night" : "nights"}
              </span>
            </header>

            <p className="bw-card-avg">
              <CountUp value={s.average} decimals={1} className="bw-card-avg-num" />
              <span className="bw-card-avg-label">average</span>
            </p>
            <p className="bw-card-form">{formLine(s)}</p>

            <dl className="bw-stats">
              <Stat
                label="High game"
                value={s.highGame ? s.highGame.score : "-"}
                sub={s.highGame && formatNight(s.highGame.date)}
              />
              <Stat
                label="High series"
                value={s.highSeries ? s.highSeries.score : "-"}
                sub={s.highSeries && formatNight(s.highSeries.date)}
              />
              <Stat
                label="Handicap"
                value={s.handicap ?? "-"}
                sub={`est. 90% of ${HANDICAP_BASIS}`}
              />
              <Stat label="200 games" value={s.over200} sub={`${s.over150} at 150+`} />
            </dl>

            <footer className="bw-card-foot">
              <div>
                <p className="bw-card-foot-title">{s.splitLabel || "Game splits"}</p>
                <p className="bw-card-foot-sub">
                  {s.streak > 1
                    ? `${s.streak} nights in a row over average`
                    : s.stdDev !== null
                    ? `Typical swing ±${Math.round(s.stdDev)} pins`
                    : "Bowl a few nights to unlock"}
                </p>
              </div>
              <Splits splits={s.splits} />
            </footer>
          </motion.article>
        );
      })}
    </section>
  );
};

export default BowlerCards;
