import { motion, useReducedMotion } from "framer-motion";
import { BOWLERS, formatNight } from "../bowlers";

/*
 * Achievements as a scroll-snap shelf of trophies. Each trophy shows both
 * bowlers' slots, lit with the night it was first earned.
 */
const TrophyShelf = ({ trophies }) => {
  const reduce = useReducedMotion();
  const catalog = trophies[BOWLERS[0].key];
  const earnedCount = BOWLERS.reduce(
    (n, b) => n + trophies[b.key].filter((t) => t.earnedOn).length,
    0
  );

  return (
    <section className="bw-trophies" aria-labelledby="bw-trophy-title">
      <h2 id="bw-trophy-title" className="bw-h2">
        Trophy case <small>{earnedCount} of {catalog.length * BOWLERS.length} lit</small>
      </h2>
      <ul className="bw-shelf">
        {catalog.map((badge, i) => {
          const lit = BOWLERS.some((b) => trophies[b.key][i].earnedOn);
          return (
            <motion.li
              key={badge.id}
              className={`bw-trophy ${lit ? "is-lit" : ""}`}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={reduce ? undefined : { y: -6, rotate: -1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ type: "spring", stiffness: 160, damping: 16, delay: i * 0.05 }}
            >
              <span className="bw-trophy-icon" aria-hidden="true">
                <i className={`fa-solid ${badge.icon}`} />
              </span>
              <h3>{badge.label}</h3>
              <p className="bw-trophy-desc">{badge.desc}</p>
              <ul className="bw-trophy-slots">
                {BOWLERS.map((b) => {
                  const on = trophies[b.key][i].earnedOn;
                  return (
                    <li key={b.key} className={on ? "is-on" : ""}>
                      <span className={`bw-chip bw-chip--${b.key}`} aria-hidden="true" />
                      <span>{b.short}</span>
                      <span className="bw-trophy-when">{on ? formatNight(on) : "locked"}</span>
                    </li>
                  );
                })}
              </ul>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
};

export default TrophyShelf;
