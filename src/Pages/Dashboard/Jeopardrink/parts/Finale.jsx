import React from "react";
import { money } from "../callouts";
import { Standings, ranked } from "./Scoreboard";

/* The podium, the decrees, and the "one more?" */

const CONFETTI = 18;

const Finale = ({ game, onRematch, onNewGame }) => {
  const order = ranked(game.players);
  const top = order.length ? order[0].score : 0;
  const champs = order.filter((p) => p.score === top);
  const last = order.length > 1 ? order[order.length - 1] : null;

  return (
    <div className="jd-finale">
      <div className="jd-confetti" aria-hidden="true">
        {Array.from({ length: CONFETTI }, (_, i) => (
          <span key={i} style={{ "--i": i }} />
        ))}
      </div>
      <p className="jd-kicker">{champs.length > 1 ? "Tonight's co-champions" : "Tonight's champion"}</p>
      <h2 className="jd-champ">{champs.map((p) => p.name).join(" & ")}</h2>
      <p className="jd-champ-score">{money(top)}</p>

      {game.settings.drinking && (
        <ul className="jd-decrees">
          <li>
            <i className="fa-solid fa-crown" aria-hidden="true" /> {champs.length > 1 ? "The champs make" : `${champs[0].name} makes`} a new
            house rule.
          </li>
          {last && last.score < top && (
            <li>
              <i className="fa-solid fa-beer-mug-empty" aria-hidden="true" /> {last.name}, finish your drink.
            </li>
          )}
        </ul>
      )}

      <Standings players={game.players} />
      {game.finalClue && game.lc && <p className="jd-fine">Last Call answer: {game.finalClue.a}</p>}

      <div className="jd-finale-actions">
        <button type="button" className="jd-primary" onClick={onRematch}>
          <i className="fa-solid fa-rotate" /> REMATCH, SAME CREW
        </button>
        <button type="button" className="jd-ghost" onClick={onNewGame}>
          NEW GAME
        </button>
      </div>
    </div>
  );
};

export default Finale;
