import { DD_GIVE_SIPS, boardCleared, clampWager, maxFinalWager, maxWager, sipsFor } from "./board";

/*
 * The whole host-side game as one pure reducer:
 *
 *   setup -> board <-> (wager ->) clue -> break -> ... -> lc-wager -> lc-clue -> lc-judge -> over
 *
 * Buzzes from phones arrive as plain BUZZ_IN actions, exactly like the host
 * tapping a name, so phone and no-phone games share every rule. State is
 * never mutated. `withHistory` wraps it with undo, because the host has
 * been drinking too.
 */

export const PHASE = Object.freeze({
  SETUP: "setup",
  BOARD: "board",
  WAGER: "wager",
  CLUE: "clue",
  BREAK: "break",
  LC_WAGER: "lc-wager",
  LC_CLUE: "lc-clue",
  LC_JUDGE: "lc-judge",
  OVER: "over",
});

export const DEFAULT_SETTINGS = Object.freeze({ rounds: 2, lastCall: true, drinking: true, phones: false });

export const initGame = () => ({
  phase: PHASE.SETUP,
  settings: DEFAULT_SETTINGS,
  players: [], // { id, name, phone, score }
  boards: [],
  round: 0,
  control: null, // who picks the next clue
  clue: null,
  finalClue: null,
  lc: null, // Last Call progress: { wagers, answers, judged } keyed by player id
  buzzSeq: 0, // every buzzer window gets a fresh number, so stale buzzes never count
  callout: null, // the latest "DRINK!" / "+$400" banner, mirrored to phones
  calloutSeq: 0,
});

const hasPlayer = (state, pid) => state.players.some((p) => p.id === pid);
const scoreOf = (state, pid) => (state.players.find((p) => p.id === pid) || { score: 0 }).score;
const addScore = (players, pid, delta) =>
  players.map((p) => (p.id === pid ? { ...p, score: p.score + delta } : p));

const withCallout = (state, callout) => ({
  ...state,
  callout: { ...callout, id: state.calloutSeq + 1 },
  calloutSeq: state.calloutSeq + 1,
});

const lowestScorer = (players) =>
  players.reduce((low, p) => (low === null || p.score < low.score ? p : low), null);

const markUsed = (boards, round, col, row) =>
  boards.map((board, r) =>
    r !== round
      ? board
      : {
          ...board,
          cats: board.cats.map((cat, c) =>
            c !== col
              ? cat
              : { ...cat, clues: cat.clues.map((cl, i) => (i === row ? { ...cl, used: true } : cl)) }
          ),
        }
  );

const openBuzzers = (state) => ({
  ...state,
  buzzSeq: state.buzzSeq + 1,
  clue: { ...state.clue, buzzOpen: true, answering: null },
});

/* ---------- board & clue ---------- */

function pick(state, { col, row }) {
  const cell = state.boards[state.round]?.cats[col]?.clues[row];
  if (!cell || cell.used) return state;
  const clue = {
    col,
    row,
    value: cell.value,
    dd: cell.dd,
    wager: null,
    answering: cell.dd ? state.control : null,
    locked: [],
    buzzOpen: false,
    resolved: null, // "correct" | "stumped" | "nobody" | "dd-right" | "dd-wrong"
    winner: null,
  };
  return { ...state, phase: cell.dd ? PHASE.WAGER : PHASE.CLUE, clue, callout: null };
}

function buzzIn(state, { pid }) {
  const { clue } = state;
  if (!clue || clue.resolved || !hasPlayer(state, pid) || clue.locked.includes(pid)) return state;
  if (clue.dd) return state; // a Daily Double Shot is a solo act
  return { ...state, clue: { ...clue, answering: pid, buzzOpen: false } };
}

function judgeDouble(state, correct) {
  const { clue } = state;
  const pid = clue.answering;
  const delta = correct ? clue.wager : -clue.wager;
  const next = {
    ...state,
    players: addScore(state.players, pid, delta),
    control: correct ? pid : state.control,
    clue: { ...clue, resolved: correct ? "dd-right" : "dd-wrong", winner: correct ? pid : null },
  };
  return withCallout(
    next,
    correct
      ? { kind: "give", pid, sips: DD_GIVE_SIPS, points: clue.wager }
      : { kind: "shot", pid, points: -clue.wager }
  );
}

function judge(state, { correct }) {
  const { clue } = state;
  if (!clue || clue.resolved || !clue.answering) return state;
  if (clue.dd) return judgeDouble(state, correct);

  const pid = clue.answering;
  if (correct) {
    const next = {
      ...state,
      players: addScore(state.players, pid, clue.value),
      control: pid,
      clue: { ...clue, resolved: "correct", winner: pid },
    };
    return withCallout(next, { kind: "score", pid, points: clue.value });
  }

  const locked = [...clue.locked, pid];
  const everyoneOut = state.players.every((p) => locked.includes(p.id));
  let next = {
    ...state,
    players: addScore(state.players, pid, -clue.value),
    clue: { ...clue, locked, answering: null, resolved: everyoneOut ? "stumped" : null },
  };
  // With phones in play the buzzers re-arm for everyone still standing.
  if (!everyoneOut && state.settings.phones) next = openBuzzers(next);
  return withCallout(next, { kind: "drink", pid, sips: sipsFor(clue.row), points: -clue.value });
}

function nobody(state) {
  const { clue } = state;
  if (!clue || clue.resolved) return state;
  const next = { ...state, clue: { ...clue, resolved: "nobody", buzzOpen: false, answering: null } };
  return withCallout(next, { kind: "everyone", sips: 1 });
}

function closeClue(state) {
  const { clue } = state;
  if (!clue) return state;
  const boards = markUsed(state.boards, state.round, clue.col, clue.row);
  const done = boardCleared(boards[state.round]);
  return { ...state, boards, clue: null, callout: null, phase: done ? PHASE.BREAK : PHASE.BOARD };
}

function nextRound(state) {
  if (state.round < state.boards.length - 1) {
    // Like the show: whoever's trailing picks first in the new round.
    const low = lowestScorer(state.players);
    return { ...state, phase: PHASE.BOARD, round: state.round + 1, control: low ? low.id : null, callout: null };
  }
  if (state.settings.lastCall && state.finalClue) {
    return { ...state, phase: PHASE.LC_WAGER, lc: { wagers: {}, answers: {}, judged: {} }, callout: null };
  }
  return { ...state, phase: PHASE.OVER, callout: null };
}

/* ---------- last call ---------- */

function lcWager(state, { pid, amount }) {
  if (!state.lc || !hasPlayer(state, pid) || state.phase !== PHASE.LC_WAGER) return state;
  const wager = clampWager(amount, maxFinalWager(scoreOf(state, pid)));
  return { ...state, lc: { ...state.lc, wagers: { ...state.lc.wagers, [pid]: wager } } };
}

/** Merge what phones submitted. Host-entered wagers win; answers only ever fill in. */
function lcSync(state, { finals }) {
  if (!state.lc || !finals) return state;
  let { wagers, answers } = state.lc;
  let changed = false;
  Object.entries(finals).forEach(([pid, f]) => {
    if (!hasPlayer(state, pid)) return;
    if (Number.isInteger(f.wager) && wagers[pid] === undefined && state.phase === PHASE.LC_WAGER) {
      wagers = { ...wagers, [pid]: clampWager(f.wager, maxFinalWager(scoreOf(state, pid))) };
      changed = true;
    }
    const judged = pid in state.lc.judged;
    if (!judged && typeof f.answer === "string" && f.answer && answers[pid] !== f.answer) {
      answers = { ...answers, [pid]: f.answer };
      changed = true;
    }
  });
  return changed ? { ...state, lc: { ...state.lc, wagers, answers } } : state;
}

function lcJudge(state, { pid, correct }) {
  const { lc } = state;
  if (!lc || state.phase !== PHASE.LC_JUDGE || !hasPlayer(state, pid) || pid in lc.judged) return state;
  const wager = lc.wagers[pid] || 0;
  const next = {
    ...state,
    players: addScore(state.players, pid, correct ? wager : -wager),
    lc: { ...lc, judged: { ...lc.judged, [pid]: correct } },
  };
  return withCallout(next, correct ? { kind: "score", pid, points: wager } : { kind: "finish", pid, points: -wager });
}

/* ---------- setup & roster ---------- */

function start(state, { players, settings, boards, finalClue, starter }) {
  return {
    ...initGame(),
    buzzSeq: state.buzzSeq,
    calloutSeq: state.calloutSeq,
    phase: PHASE.BOARD,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: players.map((p) => ({ id: p.id, name: p.name, phone: Boolean(p.phone), score: 0 })),
    boards,
    finalClue,
    control: starter,
  };
}

function addPlayer(state, { player }) {
  if (state.phase === PHASE.SETUP || hasPlayer(state, player.id)) return state;
  return { ...state, players: [...state.players, { id: player.id, name: player.name, phone: true, score: 0 }] };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "START":
      return start(state, action);
    case "REMATCH":
      return start(state, { ...action, players: state.players, settings: state.settings });
    case "RESET":
      return { ...initGame(), buzzSeq: state.buzzSeq, calloutSeq: state.calloutSeq };
    case "ADD_PLAYER":
      return addPlayer(state, action);
    case "SET_CONTROL":
      return hasPlayer(state, action.pid) ? { ...state, control: action.pid } : state;
    case "PICK":
      return state.phase === PHASE.BOARD ? pick(state, action) : state;
    case "DD_PLAYER":
      return state.phase === PHASE.WAGER && hasPlayer(state, action.pid)
        ? { ...state, clue: { ...state.clue, answering: action.pid } }
        : state;
    case "WAGER": {
      if (state.phase !== PHASE.WAGER || !state.clue.answering) return state;
      const max = maxWager(scoreOf(state, state.clue.answering), state.round);
      return { ...state, phase: PHASE.CLUE, clue: { ...state.clue, wager: clampWager(action.amount, max) } };
    }
    case "OPEN_BUZZ":
      return state.clue && !state.clue.resolved && !state.clue.dd ? openBuzzers(state) : state;
    case "BUZZ_IN":
      return buzzIn(state, action);
    case "JUDGE":
      return judge(state, action);
    case "NOBODY":
      return nobody(state);
    case "CLOSE_CLUE":
      return closeClue(state);
    case "END_ROUND":
      return state.phase === PHASE.BOARD ? { ...state, phase: PHASE.BREAK, callout: null } : state;
    case "NEXT_ROUND":
      return state.phase === PHASE.BREAK ? nextRound(state) : state;
    case "LC_WAGER":
      return lcWager(state, action);
    case "LC_SYNC":
      return lcSync(state, action);
    case "LC_REVEAL":
      return state.phase === PHASE.LC_WAGER ? { ...state, phase: PHASE.LC_CLUE } : state;
    case "LC_TO_JUDGE":
      return state.phase === PHASE.LC_CLUE ? { ...state, phase: PHASE.LC_JUDGE } : state;
    case "LC_JUDGE":
      return lcJudge(state, action);
    case "FINISH":
      return { ...state, phase: PHASE.OVER, callout: null };
    default:
      return state;
  }
}

/* ---------- undo ---------- */

// Things the room told us (joins, typed answers) aren't the host's decisions,
// so they never become undo steps and survive an undo.
const EXTERNAL = new Set(["ADD_PLAYER", "LC_SYNC"]);
const FRESH = new Set(["START", "REMATCH", "RESET"]);
const HISTORY_CAP = 40;

const carryExternal = (prev, cur) => {
  const missing = cur.players.filter((p) => !prev.players.some((q) => q.id === p.id));
  const lc = prev.lc && cur.lc ? { ...prev.lc, answers: { ...prev.lc.answers, ...cur.lc.answers } } : prev.lc;
  // Counters only move forward. A restored open buzzer gets a fresh window,
  // or buzzes from the attempt we just undid would count again.
  const reopen = prev.clue && prev.clue.buzzOpen ? 1 : 0;
  return {
    ...prev,
    players: [...prev.players, ...missing.map((p) => ({ ...p, score: 0 }))],
    lc,
    buzzSeq: Math.max(prev.buzzSeq, cur.buzzSeq) + reopen,
    calloutSeq: Math.max(prev.calloutSeq, cur.calloutSeq),
  };
};

export const initHistory = (present = initGame()) => ({ past: [], present });

export function withHistory(history, action) {
  if (action.type === "UNDO") {
    if (!history.past.length) return history;
    const prev = history.past[history.past.length - 1];
    return { past: history.past.slice(0, -1), present: carryExternal(prev, history.present) };
  }
  if (action.type === "RESTORE") return initHistory(action.state);

  const next = gameReducer(history.present, action);
  if (next === history.present) return history;
  if (EXTERNAL.has(action.type)) return { ...history, present: next };
  const past = FRESH.has(action.type) ? [] : [...history.past, history.present].slice(-HISTORY_CAP);
  return { past, present: next };
}
