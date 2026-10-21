import React from "react";
import { roundName } from "../board";
import { Standings } from "./Scoreboard";

/* Between rounds: the standings and what's next. */

const nextStep = (game) => {
  if (game.round < game.boards.length - 1) {
    return { label: "ON TO DOUBLE JEOPARDRINK!", detail: "Values double. Whoever's trailing picks first." };
  }
  if (game.settings.lastCall) {
    return { label: "LAST CALL", detail: "One clue. Everyone wagers. Wrong answers finish their drink." };
  }
  return { label: "FINAL SCORES", detail: "That's the game." };
};

const Break = ({ game, dispatch }) => {
  const next = nextStep(game);
  return (
    <div className="jd-break">
      <p className="jd-kicker">End of {roundName(game.round)}</p>
      <h2 className="jd-break-title">How we're doing</h2>
      <Standings players={game.players} />
      <p className="jd-fine">{next.detail}</p>
      <button type="button" className="jd-primary" onClick={() => dispatch({ type: "NEXT_ROUND" })}>
        {next.label} <i className="fa-solid fa-angles-right" />
      </button>
    </div>
  );
};

export default Break;
