import React from "react";
import { roundName } from "../board";
import { Scoreboard } from "./Scoreboard";

/*
 * The big blue board. Six columns on a wide screen; below 720px each
 * category becomes a row of five values (same DOM, CSS re-flows it).
 */

const Board = ({ game, dispatch }) => {
  const board = game.boards[game.round];
  const controller = game.players.find((p) => p.id === game.control);
  const left = board.cats.reduce((n, cat) => n + cat.clues.filter((cl) => !cl.used).length, 0);

  return (
    <div className="jd-boardview">
      <div className="jd-round-head">
        <h2 className="jd-round-name">{roundName(game.round)}</h2>
        <p className="jd-round-meta">
          {controller ? (
            <>
              <i className="fa-solid fa-crown" aria-hidden="true" /> <strong>{controller.name}</strong> picks
            </>
          ) : (
            "Pick a clue"
          )}
          <span className="jd-dot" aria-hidden="true" />
          {left} left
        </p>
      </div>

      <div className="jd-board">
        {board.cats.map((cat, col) => (
          <div className="jd-col" key={cat.id} style={{ "--col": col }}>
            <h3 className="jd-cat">
              <span>{cat.name}</span>
            </h3>
            {cat.clues.map((cl, row) => (
              <button
                key={row}
                type="button"
                className={`jd-cell ${cl.used ? "is-used" : ""}`}
                style={{ "--row": row }}
                disabled={cl.used}
                onClick={() => dispatch({ type: "PICK", col, row })}
                aria-label={cl.used ? `${cat.name}, $${cl.value}, played` : `${cat.name} for $${cl.value}`}
              >
                {!cl.used && <span>${cl.value}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <Scoreboard
        players={game.players}
        control={game.control}
        onPick={(pid) => dispatch({ type: "SET_CONTROL", pid })}
        pickLabel="Give control to"
      />
      <div className="jd-board-foot">
        <p className="jd-fine">Tap a name to hand them control.</p>
        <button type="button" className="jd-ghost jd-small" onClick={() => dispatch({ type: "END_ROUND" })}>
          END ROUND EARLY
        </button>
      </div>
    </div>
  );
};

export default Board;
