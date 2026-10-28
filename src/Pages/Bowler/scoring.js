// Ten-pin rules for /bowler: rack state, validation, scoring and split
// detection over one game's frames. Pure, no imports, nothing mutated.
//
// CommonJS on purpose: api/_lib/bowler-normalize.js requires this exact
// file, so the server and the page can never disagree about a score. Keep
// it dependency-free and skip object spread / async: Babel would inject
// helper imports into the production bundle and break the module
// (scoring.test.js checks the build output stays import-free).
//
// A frame:
//   { rolls: [7, 2], standing: [[3, 6, 10], [10]] | null,
//     target?: 12, actual?: 10, pocket?: true }
// `standing` is the pins still up after each roll, 1-10 with the 1 pin at
// the front and 7-10 the back row, left to right. Null means only the
// counts were recorded. `target` / `actual` are boards (1-39, counted from
// the bowler's own gutter); `pocket` is whether the first ball hit it.

const FRAMES = 10;
const PINS = 10;
const FULL_RACK = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const MIN_BOARD = 1;
const MAX_BOARD = 39;

// `fresh` matters: after a first-ball gutter the second ball also faces ten
// pins, but clearing them is a spare, not a strike.
const freshRack = () => ({ count: PINS, pins: FULL_RACK, fresh: true });

/**
 * Walk a (possibly unfinished) frame. Returns every shot with the rack it
 * was thrown at and what it left, plus `next`: the rack the next roll is
 * thrown at, or null once the frame is over. `error` is set (and the walk
 * stops) at the first roll the rules don't allow.
 */
function playFrame(frame, index) {
  const tenth = index === FRAMES - 1;
  const where = `Frame ${index + 1}`;
  const rolls = frame.rolls;
  const standing = frame.standing || null;
  const shots = [];
  let rack = freshRack();

  for (let k = 0; k < rolls.length; k += 1) {
    if (rack === null) {
      return { shots, next: null, error: `${where} has too many rolls.` };
    }
    const down = rolls[k];
    if (!Number.isInteger(down) || down < 0 || down > rack.count) {
      return {
        shots,
        next: rack,
        error: `${where}, ball ${k + 1}: ${down} pins down, but only ${rack.count} were standing.`,
      };
    }
    let left = { count: rack.count - down, pins: null };
    if (standing) {
      const after = standing[k];
      if (!after.every((p) => rack.pins.indexOf(p) !== -1)) {
        return {
          shots,
          next: rack,
          error: `${where}, ball ${k + 1} leaves a pin standing that was already down.`,
        };
      }
      if (after.length !== left.count) {
        return {
          shots,
          next: rack,
          error: `${where}, ball ${k + 1}: ${down} down doesn't match the ${after.length} pins marked standing.`,
        };
      }
      left = { count: left.count, pins: after };
    }
    shots.push({ rack, down, left });
    rack = rackAfter(shots, tenth);
  }
  return { shots, next: rack, error: null };
}

// Frames 1-9 end on a strike or after two balls. The 10th racks up fresh
// after any strike or spare and allows a third ball only if the first two
// cleared a rack.
function rackAfter(shots, tenth) {
  const n = shots.length;
  const last = shots[n - 1];
  if (!tenth) return last.left.count === 0 || n === 2 ? null : last.left;
  if (n === 3) return null;
  if (last.left.count === 0) return freshRack();
  if (n === 2 && shots[0].left.count !== 0) return null; // open 10th
  return last.left;
}

const isBoard = (n) => Number.isInteger(n) && n >= MIN_BOARD && n <= MAX_BOARD;

function cleanPins(list) {
  if (!Array.isArray(list)) return null;
  const pins = list.map(Number);
  if (!pins.every((p) => Number.isInteger(p) && p >= 1 && p <= PINS)) return null;
  if (new Set(pins).size !== pins.length) return null;
  return pins.slice().sort((a, b) => a - b);
}

/**
 * Validate and normalize one frame (sorted pins, only known fields).
 * Doesn't require the frame to be finished; checkGame decides that.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function checkFrame(raw, index) {
  const where = `Frame ${index + 1}`;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rolls)) {
    return { ok: false, error: `${where} is missing its rolls.` };
  }
  const rolls = raw.rolls.map(Number);
  let standing = null;
  if (raw.standing !== undefined && raw.standing !== null) {
    if (!Array.isArray(raw.standing) || raw.standing.length !== rolls.length) {
      return { ok: false, error: `${where} needs the pins standing after every ball.` };
    }
    standing = raw.standing.map(cleanPins);
    if (standing.indexOf(null) !== -1) {
      return { ok: false, error: `${where} has a pin that isn't 1 to 10 (or the same pin twice).` };
    }
  }

  const frame = { rolls: rolls, standing: standing };
  const walk = playFrame(frame, index);
  if (walk.error) return { ok: false, error: walk.error };

  ["target", "actual"].forEach((field) => {
    const v = raw[field];
    if (v !== undefined && v !== null && v !== "") frame[field] = Number(v);
  });
  if (
    (frame.target !== undefined && !isBoard(frame.target)) ||
    (frame.actual !== undefined && !isBoard(frame.actual))
  ) {
    return { ok: false, error: `${where}: boards run from ${MIN_BOARD} to ${MAX_BOARD}.` };
  }
  if (typeof raw.pocket === "boolean") frame.pocket = raw.pocket;
  return { ok: true, value: frame };
}

const frameDone = (frame, index) => playFrame(frame, index).next === null;

/**
 * Validate a whole game. With `partial`, the last frame may be unfinished
 * and fewer than ten frames are fine (an in-progress draft).
 * @returns {{ ok: true, value: object[] } | { ok: false, error: string }}
 */
function checkGame(raw, options) {
  const partial = Boolean(options && options.partial);
  if (!Array.isArray(raw)) return { ok: false, error: "A game needs its frames." };
  if (raw.length > FRAMES) return { ok: false, error: "A game has ten frames, no more." };
  if (!partial && raw.length !== FRAMES) {
    return { ok: false, error: `That game only has ${raw.length} of its ten frames.` };
  }
  const frames = [];
  for (let i = 0; i < raw.length; i += 1) {
    const result = checkFrame(raw[i], i);
    if (!result.ok) return result;
    const last = i === raw.length - 1;
    if (!frameDone(result.value, i) && (!partial || !last)) {
      return { ok: false, error: `Frame ${i + 1} isn't finished.` };
    }
    frames.push(result.value);
  }
  return { ok: true, value: frames };
}

/**
 * Standard scoring. `running` is the cumulative score per frame, null from
 * the first frame whose bonus balls haven't been thrown yet. `total` is the
 * last known running score (0 before any), `complete` once all ten are in.
 */
function scoreGame(frames) {
  const flat = [];
  frames.forEach((f) => f.rolls.forEach((r) => flat.push(r)));
  const running = [];
  let cum = 0;
  let known = true;
  let at = 0;

  frames.forEach((f, i) => {
    const r = f.rolls;
    let value = null;
    if (i < FRAMES - 1) {
      if (r[0] === PINS) {
        if (flat.length > at + 2) value = PINS + flat[at + 1] + flat[at + 2];
      } else if (r.length === 2 && r[0] + r[1] === PINS) {
        if (flat.length > at + 2) value = PINS + flat[at + 2];
      } else if (r.length === 2) {
        value = r[0] + r[1];
      }
    } else if (frameDone(f, i)) {
      value = r.reduce((a, b) => a + b, 0);
    }
    at += r.length;
    known = known && value !== null;
    cum = known ? cum + value : cum;
    running.push(known ? cum : null);
  });

  const complete = frames.length === FRAMES && running[FRAMES - 1] !== null;
  return { running, total: cum, complete };
}

/** Scoreboard marks for one frame: X, /, - or the count, plus split flags. */
function frameMarks(frame, index) {
  return playFrame(frame, index).shots.map((s) => {
    let mark = String(s.down);
    if (s.rack.fresh && s.down === PINS) mark = "X";
    else if (s.left.count === 0) mark = "/";
    else if (s.down === 0) mark = "-";
    return { mark, split: Boolean(s.rack.fresh) && isSplit(s.left.pins) };
  });
}

// Two pins "touch" when one sits diagonally behind the other, or directly
// behind it two rows back (2-8, 3-9, 1-5 are double wood, not splits).
// Neighbours in the same row deliberately don't: with the pin in front of
// them gone, 4-5 or 8-9 is a split by the USBC definition.
const LINKS = Object.freeze({
  1: [2, 3, 5],
  2: [1, 4, 5, 8],
  3: [1, 5, 6, 9],
  4: [2, 7, 8],
  5: [1, 2, 3, 8, 9],
  6: [3, 9, 10],
  7: [4],
  8: [2, 4, 5],
  9: [3, 5, 6],
  10: [6],
});

/** A first-ball leave is a split: head pin down, standing pins don't touch. */
function isSplit(pins) {
  if (!pins || pins.length < 2 || pins.indexOf(1) !== -1) return false;
  const up = new Set(pins);
  const seen = new Set([pins[0]]);
  const queue = [pins[0]];
  while (queue.length) {
    LINKS[queue.pop()].forEach((p) => {
      if (up.has(p) && !seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    });
  }
  return seen.size < up.size;
}

/** Where the next ball goes: { frame, roll, rack }, or null when the game is over. */
function nextRoll(frames) {
  const n = frames.length;
  if (n) {
    const walk = playFrame(frames[n - 1], n - 1);
    if (walk.next) return { frame: n - 1, roll: walk.shots.length, rack: walk.next };
  }
  return n < FRAMES ? { frame: n, roll: 0, rack: freshRack() } : null;
}

/**
 * Add one ball to a frame given the pins it left standing.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function addRollToFrame(frame, index, left) {
  const base = frame || { rolls: [], standing: [] };
  const walk = playFrame(base, index);
  if (!walk.next) return { ok: false, error: `Frame ${index + 1} is already finished.` };
  const next = Object.assign({}, base, {
    rolls: base.rolls.concat(walk.next.count - left.length),
    standing: (base.standing || []).concat([left.slice().sort((a, b) => a - b)]),
  });
  return checkFrame(next, index);
}

/** The game with one more ball thrown, leaving `left` standing. */
function addRoll(frames, left) {
  const at = nextRoll(frames);
  if (!at) return { ok: false, error: "That game is already over." };
  const result = addRollToFrame(frames[at.frame], at.frame, left);
  if (!result.ok) return result;
  const next = frames.slice(0, at.frame);
  next.push(result.value);
  return { ok: true, value: next };
}

/** The game with its last ball taken back. */
function undoRoll(frames) {
  const n = frames.length;
  if (!n) return frames;
  const last = frames[n - 1];
  if (last.rolls.length <= 1) return frames.slice(0, n - 1);
  const trimmed = Object.assign({}, last, {
    rolls: last.rolls.slice(0, -1),
    standing: last.standing ? last.standing.slice(0, -1) : null,
  });
  return frames.slice(0, n - 1).concat([trimmed]);
}

/** The best this game can still finish with: every ball left a strike or spare. */
function maxScore(frames) {
  let game = frames;
  for (let at = nextRoll(game); at; at = nextRoll(game)) {
    const base = game[at.frame] || { rolls: [], standing: [] };
    const cleared = Object.assign({}, base, {
      rolls: base.rolls.concat(at.rack.count),
      standing: base.standing ? base.standing.concat([[]]) : null,
    });
    game = game.slice(0, at.frame).concat([cleared]);
  }
  return scoreGame(game).total;
}

module.exports = {
  FRAMES,
  PINS,
  FULL_RACK,
  MIN_BOARD,
  MAX_BOARD,
  playFrame,
  checkFrame,
  checkGame,
  scoreGame,
  frameMarks,
  isSplit,
  nextRoll,
  addRollToFrame,
  addRoll,
  undoRoll,
  maxScore,
};
