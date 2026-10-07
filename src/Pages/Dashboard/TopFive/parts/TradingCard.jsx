import { memo } from "react";
import { motion } from "framer-motion";
import { rarityOf } from "../top5.data";
import "./TradingCard.css";

const SYMBOLS = { common: 1, uncommon: 1, rare: 1, ultra: 2, legendary: 1 };

/** A Font Awesome glyph with a stacked extrusion (light from the upper left). */
export const Glyph = ({ icon, className = "" }) => (
  <span className={`td-glyph ${className}`} aria-hidden="true">
    {[4, 3, 2, 1].map((i) => (
      <i key={i} className={`fa-solid ${icon} td-glyph-layer`} style={{ "--i": i }} />
    ))}
    <i className={`fa-solid ${icon} td-glyph-face`} />
  </span>
);

const Flourish = ({ kind }) => {
  if (kind === "steam") {
    return (
      <span className="td-steam" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (kind === "spin") return <span className="td-record" aria-hidden="true" />;
  if (kind === "scan") return <span className="td-scan" aria-hidden="true" />;
  return (
    <span className="td-sparkles" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
};

const Front = ({ pack, card, rank, tier, collector, live, lite, shiny, popped, sheenKey, hit }) => {
  const rarity = rarityOf(rank);
  const foil = live ? <span className={`td-foil ${lite ? "is-lite" : ""}`} aria-hidden="true" /> : null;
  return (
    <>
      <div className="td-card-frame">
        <div className="td-card-head">
          <span className="td-card-rank">#{rank}</span>
          <h3 className="td-card-title">{card.title}</h3>
          <span className="td-card-sym" aria-hidden="true">
            {Array.from({ length: SYMBOLS[tier] || 1 }, (_, k) => (
              <i key={k} className={`fa-solid ${rarityOf(rank).symbol}`} />
            ))}
          </span>
        </div>
        <div className={`td-card-art ${shiny ? "is-shiny" : ""}`}>
          {popped ? null : <Glyph icon={card.icon} />}
          {tier === "rare" ? foil : null}
          {shiny ? <span className="td-card-stamp">Shiny</span> : null}
        </div>
        <div className="td-card-type">
          <span>
            {pack.kind} · {rarity.label}
          </span>
          <span className="td-card-code">{rarity.code}</span>
        </div>
        <div className="td-card-text">
          <p className="td-card-take">{card.take}</p>
          <p className="td-card-meta">{card.meta}</p>
        </div>
        <div className="td-card-foot">
          <span>Illus. C. Haldane</span>
          <span>{collector}</span>
        </div>
      </div>
      {tier === "legendary" ? (
        <>
          <span className="td-card-ed" aria-hidden="true">
            <span>1st Edition</span>
          </span>
          <span className="td-card-auto" aria-hidden="true">
            Charlie
          </span>
        </>
      ) : null}
      <span className="td-sheen" aria-hidden="true" />
      {sheenKey ? <span key={sheenKey} className="td-sheen-pass" aria-hidden="true" /> : null}
      {tier === "ultra" || tier === "legendary" ? foil : null}
      {live ? <span className={`td-glare ${lite ? "is-lite" : ""}`} aria-hidden="true" /> : null}
      {hit ? <button type="button" className="td-card-hit" {...hit} /> : null}
    </>
  );
};

const Back = ({ pack, card, pulledAt, detailed }) => (
  <>
    <div className="td-back-art" aria-hidden="true">
      <span className="td-back-ring">
        <span>Top</span>
        <span>Deck</span>
      </span>
      <span className="td-back-code">TD1</span>
    </div>
    {detailed ? (
      <div className="td-back-notes">
        <p className="td-note">{card.fun}</p>
        <ul className="td-stats">
          {pack.statLabels.map((label, k) => (
            <li key={label} style={{ "--v": card.stats[k] / 10, "--k": k }}>
              <span className="td-stat-label">{label}</span>
              <span className="td-stat-bar">
                <span />
              </span>
              <b>{card.stats[k]}</b>
            </li>
          ))}
        </ul>
        <p className="td-back-foot">
          {pulledAt ? `Pulled ${pulledAt} · ` : ""}Pull rate: guaranteed (it's my list)
        </p>
      </div>
    ) : null}
  </>
);

/*
 * The two faces (plus the legendary pop-out) of one card. Rendered inside the
 * slot > tilt > flip chain owned by CardHand; everything here is a flat leaf,
 * which is the only place opacity, overflow and blend modes are allowed.
 */
const TradingCard = memo(function TradingCard({
  pack,
  card,
  rank,
  tier,
  collector,
  concealed,
  detailed,
  backShown,
  live,
  lite,
  shiny,
  pulledAt,
  flourish,
  frontVis,
  backVis,
  sheenKey,
  hit,
}) {
  // Only the real #1 pops out: in god mode every card is legendary, and a
  // pop layer 36px forward would draw over its neighbour in the fan.
  const popped = rank === 1 && tier === "legendary" && !concealed;
  return (
    <>
      <motion.div
        className={`td-face td-face--front td-tier-${tier}`}
        style={{ visibility: frontVis }}
        aria-hidden={concealed || backShown}
      >
        {concealed ? null : (
          <Front
            pack={pack}
            card={card}
            rank={rank}
            tier={tier}
            collector={collector}
            live={live}
            lite={lite}
            shiny={shiny}
            popped={popped}
            sheenKey={sheenKey}
            hit={hit}
          />
        )}
      </motion.div>
      <motion.div
        className={`td-face td-face--back ${backShown ? "is-shown" : ""}`}
        style={{ visibility: backVis }}
        aria-hidden={!backShown}
      >
        <Back pack={pack} card={card} pulledAt={pulledAt} detailed={detailed} />
      </motion.div>
      {popped ? (
        <motion.div className={`td-pop td-pop--${flourish}`} style={{ visibility: frontVis }} aria-hidden="true">
          <Flourish kind={flourish} />
          <Glyph icon={card.icon} className={shiny ? "is-shiny" : ""} />
          <i className="fa-solid fa-crown td-pop-crown" />
        </motion.div>
      ) : null}
    </>
  );
});

export default TradingCard;
