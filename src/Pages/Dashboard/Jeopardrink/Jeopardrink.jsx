import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { buildGame, roundName } from "./board";
import { PHASE, initHistory, withHistory } from "./gameReducer";
import { publicView } from "./publicView";
import { useHostRoom } from "./useHostRoom";
import { play } from "./sfx";
import Frame from "./parts/Frame";
import Setup from "./parts/Setup";
import Board from "./parts/Board";
import ClueStage from "./parts/ClueStage";
import Break from "./parts/Break";
import LastCall from "./parts/LastCall";
import Finale from "./parts/Finale";
import { JoinSheet } from "./parts/JoinQr";
import "./Jeopardrink.css";
import "./JeopardrinkStage.css";

/*
 * JEOPARDRINK! — host screen. A Jeopardy spoof for a room full of friends:
 * the host holds this device (clues + answers), everyone else buzzes from
 * their phone at /buzz, or slaps the table and the host taps their name.
 *
 * Game rules live in gameReducer.js; this file wires them to the phone
 * room, local save/resume and sound.
 */

const SAVE_KEY = "jeopardrink-save-v1";
const SAVE_TTL = 14 * 60 * 60 * 1000; // matches the room's lifetime

const loadSave = () => {
  try {
    const save = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (!save || !save.game || save.game.phase === PHASE.SETUP) return null;
    return Date.now() - save.savedAt < SAVE_TTL ? save : null;
  } catch {
    return null;
  }
};
const writeSave = (game, room) => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ game, room, savedAt: Date.now() }));
  } catch {
    /* private mode or full storage: the game just won't survive a refresh */
  }
};
const clearSave = () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
};

const SOUND_FOR = { score: "right", drink: "wrong", everyone: "timesUp", give: "cheers", shot: "wrong", finish: "wrong" };

const subtitleFor = (game) => {
  switch (game.phase) {
    case PHASE.SETUP:
      return "Hosted by Alex Trebev";
    case PHASE.BREAK:
      return "Intermission";
    case PHASE.LC_WAGER:
    case PHASE.LC_CLUE:
    case PHASE.LC_JUDGE:
      return "Last Call";
    case PHASE.OVER:
      return "That's the game";
    default:
      return roundName(game.round);
  }
};

const randomStarter = (players) => players[Math.floor(Math.random() * players.length)].id;

/** Mirror the room into the game: new phones join, the first buzz rings in, Last Call submissions land. */
function useRoomSync(game, room, benched, dispatch) {
  const inGame = game.phase !== PHASE.SETUP;
  const { players: joined, buzzes, seq, finals } = room;

  useEffect(() => {
    if (!inGame) return;
    joined.forEach((p) => {
      if (!benched.includes(p.id) && !game.players.some((q) => q.id === p.id)) {
        dispatch({ type: "ADD_PLAYER", player: p });
      }
    });
  }, [inGame, joined, game.players, benched, dispatch]);

  // Each buzzer window rings in at most once, so an undo can't re-trigger it.
  const rungSeq = useRef(null);
  const { clue, buzzSeq } = game;
  useEffect(() => {
    if (!clue || !clue.buzzOpen || clue.answering || seq !== buzzSeq || rungSeq.current === buzzSeq) return;
    const first = buzzes.find((pid) => !clue.locked.includes(pid) && game.players.some((p) => p.id === pid));
    if (!first) return;
    rungSeq.current = buzzSeq;
    play("ringIn");
    dispatch({ type: "BUZZ_IN", pid: first });
  }, [clue, buzzSeq, seq, buzzes, game.players, dispatch]);

  const hasLastCall = Boolean(game.lc);
  useEffect(() => {
    if (hasLastCall) dispatch({ type: "LC_SYNC", finals });
  }, [hasLastCall, finals, game.phase, dispatch]);
}

/** Sounds for callouts and the Daily Double reveal. Only new callouts play. */
function useGameSounds(game) {
  const heard = useRef(game.calloutSeq);
  const id = game.callout ? game.callout.id : 0;
  const kind = game.callout ? game.callout.kind : null;
  useEffect(() => {
    if (!id || id <= heard.current) return;
    heard.current = id;
    play(SOUND_FOR[kind]);
  }, [id, kind]);

  const isWager = game.phase === PHASE.WAGER;
  useEffect(() => {
    if (isWager) play("dailyDouble");
  }, [isWager]);
}

const Jeopardrink = () => {
  const [history, dispatch] = useReducer(withHistory, undefined, () => initHistory());
  const game = history.present;
  const [saved, setSaved] = useState(loadSave);
  const [phonesWanted, setPhonesWanted] = useState(true);
  const [roomCreds, setRoomCreds] = useState(null);
  const [benched, setBenched] = useState([]);
  const [showJoin, setShowJoin] = useState(false);
  const closeJoin = useCallback(() => setShowJoin(false), []);

  const inGame = game.phase !== PHASE.SETUP;
  // While a saved game is on offer, don't open a room it might not need.
  const phonesOn = inGame ? game.settings.phones : phonesWanted && !saved;
  const view = useMemo(() => publicView(game), [game]);
  const room = useHostRoom({ enabled: phonesOn, room: phonesOn ? roomCreds : null, onRoom: setRoomCreds, view });
  const roomLive = phonesOn && room.status === "live";

  useRoomSync(game, room, benched, dispatch);
  useGameSounds(game);

  useEffect(() => {
    if (inGame) writeSave(game, roomCreds);
  }, [game, roomCreds, inGame]);

  const start = useCallback((players, settings) => {
    const { boards, finalClue } = buildGame({ rounds: settings.rounds });
    clearSave();
    setSaved(null);
    dispatch({ type: "START", players, settings, boards, finalClue, starter: randomStarter(players) });
  }, []);

  const resume = () => {
    dispatch({ type: "RESTORE", state: saved.game });
    setRoomCreds(saved.room || null);
    setSaved(null);
  };

  const discard = () => {
    clearSave();
    setSaved(null);
  };

  const rematch = () => {
    const { boards, finalClue } = buildGame({ rounds: game.settings.rounds });
    dispatch({ type: "REMATCH", boards, finalClue, starter: randomStarter(game.players) });
  };

  // Keeps the room open, so phones carry straight into the next game.
  const newGame = () => {
    clearSave();
    dispatch({ type: "RESET" });
  };

  const bench = (pid) => setBenched((list) => (list.includes(pid) ? list : [...list, pid]));

  const roomTrouble = inGame && phonesOn && (room.status === "gone" || room.status === "error");

  let body = null;
  switch (game.phase) {
    case PHASE.SETUP:
      body = (
        <Setup
          saved={saved}
          onResume={resume}
          onDiscard={discard}
          phones={phonesWanted}
          onPhones={setPhonesWanted}
          room={room}
          benched={benched}
          onBench={bench}
          onStart={start}
        />
      );
      break;
    case PHASE.BOARD:
      body = <Board game={game} dispatch={dispatch} />;
      break;
    case PHASE.WAGER:
    case PHASE.CLUE:
      body = (
        <ClueStage
          key={`${game.round}:${game.clue.col}:${game.clue.row}`}
          game={game}
          dispatch={dispatch}
          roomLive={roomLive}
        />
      );
      break;
    case PHASE.BREAK:
      body = <Break game={game} dispatch={dispatch} />;
      break;
    case PHASE.LC_WAGER:
    case PHASE.LC_CLUE:
    case PHASE.LC_JUDGE:
      body = <LastCall game={game} dispatch={dispatch} />;
      break;
    case PHASE.OVER:
      body = <Finale game={game} onRematch={rematch} onNewGame={newGame} />;
      break;
    default:
      body = null;
  }

  return (
    <Frame
      subtitle={subtitleFor(game)}
      roomCode={roomLive ? room.code : null}
      onRoomClick={() => setShowJoin(true)}
      canUndo={history.past.length > 0}
      onUndo={inGame ? () => dispatch({ type: "UNDO" }) : null}
      wide={game.phase === PHASE.BOARD}
    >
      {roomTrouble && (
        <div className="jd-banner" role="alert">
          <span>
            {room.status === "gone" ? "The buzzer room closed." : "Phone buzzers are offline."} Tap names to keep playing.
          </span>
          <button
            type="button"
            className="jd-ghost jd-small"
            onClick={room.status === "gone" ? () => setRoomCreds(null) : room.retry}
          >
            {room.status === "gone" ? "OPEN A NEW ROOM" : "RETRY"}
          </button>
        </div>
      )}
      {body}
      {showJoin && roomLive && <JoinSheet code={room.code} onClose={closeJoin} />}
    </Frame>
  );
};

export default Jeopardrink;
