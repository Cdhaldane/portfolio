import { PHASE } from "./gameReducer";

/*
 * The slice of host state that's safe to mirror to players' phones. Clue
 * text never leaves the host's screen (players get categories and a buzzer),
 * and an answer only goes out once its clue is resolved. The API re-validates
 * this exact shape (api/_lib/jeopardy-normalize.js), so change both together.
 */

export const LOBBY = "lobby";
const BOARD_PHASES = [PHASE.BOARD, PHASE.WAGER, PHASE.CLUE, PHASE.BREAK];

const boardView = (board) =>
  board.cats.map((cat) => ({
    name: cat.name,
    cells: cat.clues.map((cl) => ({ value: cl.value, used: cl.used })),
  }));

const clueView = (state, board) => {
  const { clue } = state;
  if (!clue || !board) return null;
  const cat = board.cats[clue.col];
  return {
    cat: cat.name,
    value: clue.value,
    dd: clue.dd,
    wager: clue.wager,
    resolved: clue.resolved,
    answer: clue.resolved ? cat.clues[clue.row].a : null,
  };
};

const lastCallView = (state) =>
  state.lc && state.finalClue
    ? {
        cat: state.finalClue.cat,
        wagered: Object.keys(state.lc.wagers),
        answered: Object.keys(state.lc.answers),
        judged: state.lc.judged,
        answer: state.phase === PHASE.OVER ? state.finalClue.a : null,
      }
    : null;

export function publicView(state) {
  if (state.phase === PHASE.SETUP) return { phase: LOBBY };
  const board = state.boards[state.round] || null;
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.boards.length,
    board: board && BOARD_PHASES.includes(state.phase) ? boardView(board) : null,
    clue: clueView(state, board),
    buzz: {
      open: Boolean(state.clue && state.clue.buzzOpen),
      seq: state.buzzSeq,
      locked: state.clue ? state.clue.locked : [],
    },
    answering: state.clue ? state.clue.answering : null,
    control: state.control,
    roster: state.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
    callout: state.callout,
    lastCall: lastCallView(state),
    drinking: state.settings.drinking,
  };
}
