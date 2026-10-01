import { CARDS_PER_PACK, allBaseOpened, visiblePacks } from "./top5.data";

/*
 * The whole TOP DECK flow as one pure reducer, so every beat (and every way
 * of skipping one) is testable without animation:
 *
 *   shelf -> sealed -> ripping -> dealing -> legend -> reveal -> hand <-> inspect
 *
 * The animation layer only reports completions ("ripped", "landed",
 * "revealed"); it never decides what comes next. State is never mutated.
 */

export const PHASE = Object.freeze({
  SHELF: "shelf",
  SEALED: "sealed",
  RIPPING: "ripping",
  DEALING: "dealing",
  LEGEND: "legend",
  REVEAL: "reveal",
  HAND: "hand",
  INSPECT: "inspect",
});

const RITUAL = [PHASE.RIPPING, PHASE.DEALING, PHASE.LEGEND, PHASE.REVEAL];
const SWITCHABLE = [PHASE.SEALED, PHASE.HAND, PHASE.INSPECT];
// #5 to #2 deal into the fan; the #1 waits face-down for its reveal.
const LANDINGS = CARDS_PER_PACK - 1;

const wrap = (i, n) => ((i % n) + n) % n;
const isCardIndex = (i) => Number.isInteger(i) && i >= 0 && i < CARDS_PER_PACK;

export const initDeck = ({ opened = {}, bonus = false } = {}) => ({
  phase: PHASE.SHELF,
  packId: null,
  lastPackId: null,
  entry: null, // how the table was entered: "ritual" | "reopen" | "switch"
  run: 0, // bumps on every fresh deal, so the animation layer can reset
  switchDir: 0,
  dealt: 0,
  revealed: false,
  skipped: false,
  inspected: null,
  lastInspected: null,
  opened,
  bonus: bonus || allBaseOpened(opened),
});

export const isTableOpen = (s) => s.phase !== PHASE.SHELF;
export const isRitual = (s) => RITUAL.includes(s.phase);
export const visibleOrder = (s) => visiblePacks(s.opened, s.bonus).map((p) => p.id);

const markOpened = (state, today) => {
  if (state.opened[state.packId]) return state;
  const opened = { ...state.opened, [state.packId]: { pulledAt: today } };
  return { ...state, opened, bonus: state.bonus || allBaseOpened(opened) };
};

const enterPack = (state, packId, entry, switchDir) => {
  const isOpen = Boolean(state.opened[packId]);
  return {
    ...state,
    packId,
    entry: entry === "switch" ? entry : isOpen ? "reopen" : "ritual",
    run: state.run + 1,
    switchDir,
    phase: isOpen ? PHASE.HAND : PHASE.SEALED,
    dealt: isOpen ? CARDS_PER_PACK : 0,
    revealed: isOpen,
    skipped: false,
    inspected: null,
    lastInspected: null,
  };
};

const finish = (state, today) => ({
  ...markOpened(state, today),
  phase: PHASE.HAND,
  dealt: CARDS_PER_PACK,
  revealed: true,
  skipped: state.phase !== PHASE.SEALED,
  inspected: null,
});

const toShelf = (state, today) => {
  const base = isRitual(state) ? markOpened(state, today) : state;
  return {
    ...base,
    phase: PHASE.SHELF,
    lastPackId: state.packId,
    packId: null,
    entry: null,
    switchDir: 0,
    skipped: false,
    inspected: null,
    lastInspected: null,
  };
};

const land = (state, index) => {
  if (state.phase !== PHASE.DEALING) return state;
  if (!Number.isInteger(index) || index < 0 || index >= LANDINGS) return state;
  const dealt = Math.max(state.dealt, index + 1);
  if (dealt === state.dealt) return state;
  return { ...state, dealt, phase: dealt >= LANDINGS ? PHASE.LEGEND : PHASE.DEALING };
};

const switchPack = (state, delta) => {
  if (!SWITCHABLE.includes(state.phase)) return state;
  const order = visibleOrder(state);
  const dir = Math.sign(delta) || 1;
  const next = order[wrap(order.indexOf(state.packId) + dir, order.length)];
  return enterPack(state, next, "switch", dir);
};

const reseal = (state) => {
  if (state.phase !== PHASE.HAND && state.phase !== PHASE.INSPECT) return state;
  const opened = Object.fromEntries(
    Object.entries(state.opened).filter(([id]) => id !== state.packId)
  );
  return {
    ...state,
    opened,
    phase: PHASE.SEALED,
    entry: "ritual",
    run: state.run + 1,
    switchDir: 0,
    dealt: 0,
    revealed: false,
    skipped: false,
    inspected: null,
    lastInspected: null,
  };
};

const escape = (state, today) => {
  if (state.phase === PHASE.INSPECT) {
    return { ...state, phase: PHASE.HAND, lastInspected: state.inspected, inspected: null };
  }
  if (isRitual(state)) return finish(state, today);
  if (state.phase === PHASE.HAND || state.phase === PHASE.SEALED) return toShelf(state, today);
  return state;
};

export function deckReducer(state, action) {
  switch (action.type) {
    case "pick":
      if (state.phase !== PHASE.SHELF) return state;
      if (!visibleOrder(state).includes(action.packId)) return state;
      return enterPack(state, action.packId, "ritual", 0);
    case "rip":
      // A ripped pack always deals from its wrapper, however it was reached.
      return state.phase === PHASE.SEALED ? { ...state, phase: PHASE.RIPPING, entry: "ritual" } : state;
    case "ripped":
      return state.phase === PHASE.RIPPING ? { ...state, phase: PHASE.DEALING, dealt: 0 } : state;
    case "landed":
      return land(state, action.index);
    case "reveal":
      if (state.phase !== PHASE.LEGEND) return state;
      return { ...markOpened(state, action.today), phase: PHASE.REVEAL, revealed: true };
    case "revealed":
      if (state.phase !== PHASE.REVEAL) return state;
      return { ...state, phase: PHASE.HAND, dealt: CARDS_PER_PACK };
    case "finish":
      if (state.phase !== PHASE.SEALED && !isRitual(state)) return state;
      return finish(state, action.today);
    case "inspect":
      if (state.phase !== PHASE.HAND && state.phase !== PHASE.INSPECT) return state;
      if (!isCardIndex(action.index)) return state;
      return { ...state, phase: PHASE.INSPECT, inspected: action.index };
    case "step":
      if (state.phase !== PHASE.INSPECT) return state;
      return { ...state, inspected: wrap(state.inspected + action.delta, CARDS_PER_PACK) };
    case "close":
      if (state.phase !== PHASE.INSPECT) return state;
      return { ...state, phase: PHASE.HAND, lastInspected: state.inspected, inspected: null };
    case "switch":
      return switchPack(state, action.delta);
    case "reseal":
      return reseal(state);
    case "shelf":
      return state.phase === PHASE.SHELF ? state : toShelf(state, action.today);
    case "escape":
      return escape(state, action.today);
    default:
      return state;
  }
}
