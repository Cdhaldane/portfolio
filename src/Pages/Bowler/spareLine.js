// How to pick up a spare, worked out from the leave and the bowler's own
// curve: the line that converts it, every time. Never "take one for the
// count"; a split gets the best way to make it, however tight.
//
// Everything here is real lane geometry in inches: x across the lane from
// its middle (left is positive, as the bowler sees it), y down the lane
// from the foul line.
//
// A line is a ball: laid down at x0, rolling at `slope` (inches across per
// inch down) straight through the arrows to the breakpoint at 40 ft, then
// hooking: by the head pin it has moved `hook` inches off the straight
// line (positive to the left, a right-hander's hook). hook 0 is a straight
// ball.
//
// The pins are deliberately simple. The ball knocks every pin it touches.
// A struck pin flies off along the line of centres at contact (billiard-
// ball style), carrying less the thinner it was hit; it knocks any pin it
// touches on the way and comes back off the kickbacks (the side walls at
// the deck) if it gets there. The solver slides each line across the lane
// at a fan of angles and keeps the widest window that takes every pin,
// favouring the cross-lane angle (pins on the right shot from the left
// and vice versa).
//
// The bowler's own curve comes first. Where it struggles (a big hook
// carries the ball away from the corner pin on its own side) the solver
// weighs less hook, a straight ball, and for a bowler who can curve it
// the other way, a reverse curve; each costs a little window, so the
// natural shot wins unless another is clearly roomier. When nothing
// converts with normal pin action, the pins have to fly further than
// usual (more speed): it asks for livelier pins until a line works.
//
// Boards: `board` is counted from the right gutter, as a right-hander
// counts (board 20 is the middle). The UI flips it to the bowler's own
// gutter for a left-hander.
import { MAX_BOARD } from "./scoring";

export const LANE_IN = 41.5;
export const IN_PER_BOARD = LANE_IN / MAX_BOARD;
export const HEAD_IN = 60 * 12; // the head pin, 60 ft out
export const BREAK_IN = 40 * 12; // where the ball stops skidding and hooks
export const ROW_IN = 6 * Math.sqrt(3); // rows of the rack: 12 in equilateral triangles
export const BALL_R = 4.25;
export const PIN_R = 2.385; // at the belly
export const KICKBACK_IN = LANE_IN / 2 + 9.25; // the side walls, past the gutters
export const POCKET = 17.5; // the 1-3 pocket's board (1-2 for a lefty), from your own gutter

const BALL_HIT = BALL_R + PIN_R; // centres this close and the ball touches the pin
const PIN_HIT = 5.5; // a falling pin's reach: wider than its belly, it tumbles
const BALL_CARRY = 40; // how far a pin hit flush flies, in inches
const PIN_CARRY = 0.75; // a pin knocked by a pin keeps this much of the carry
const REBOUND = 0.6; // and this much off a kickback
export const PIN_SPEED = 0.6; // pins fly slower than the ball rolls
const EDGE = LANE_IN / 2 - 1.5; // past this the ball's centre is in the gutter
const LAY_EDGE = 13.5 * IN_PER_BOARD; // the furthest out a ball gets laid down
const HOOK_LEN = HEAD_IN - BREAK_IN;
const ENTER_IN = HEAD_IN - 36; // the ball runs straight from here: the deck is short
const BACK_IN = HEAD_IN + 3 * ROW_IN;
const STEP = 0.2; // inches between the lines the solver tries (a fifth of a board)
const FINE_STEP = 0.02; // for the last-resort search, where windows are slivers

// The angles tried, as slopes of the line across the lane (0.04 crosses
// ~27 boards on the way to the pins), and how many boards of window an
// angle gives up per 0.01 it strays from the cross-lane one.
const SLOPES = [-0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04];
const OFF_ANGLE = 0.8;
// Shares of the bowler's hook to try, and what each costs in boards of
// window: their own curve is free, less of it or straight costs a little,
// curving it the other way (for those who can) a little more.
const NATURAL = [1, 0.6, 0.3, 0];
const REVERSE = [-0.3, -0.6, -1];
const curveCost = (share) => (share >= 0 ? (1 - share) * 3 : 4 - share * 0.5);
const MAX_ROOM = (2 * (BALL_R + PIN_R)) / (LANE_IN / MAX_BOARD); // a single pin, hit anywhere on it
const LIVELY = [1, 1.6, 2.5, 4, 8, 16, 32]; // how much further than usual the pins fly

// Pins by half pin-spacings left of the head pin (6 in each) and row.
const RACK = {
  1: [0, 0],
  2: [1, 1],
  3: [-1, 1],
  4: [2, 2],
  5: [0, 2],
  6: [-2, 2],
  7: [3, 3],
  8: [1, 3],
  9: [-1, 3],
  10: [-3, 3],
};

const SPOTS = {};
Object.entries(RACK).forEach(([pin, [left, row]]) => {
  SPOTS[pin] = Object.freeze({ x: left * 6, y: HEAD_IN + row * ROW_IN });
});

/** Where a pin stands: { x, y } in inches. */
export const pinAt = (pin) => SPOTS[pin];
export const boardOf = (x) => MAX_BOARD / 2 + 0.5 + x / IN_PER_BOARD;

/** How far out the arrows are at a board, in inches: 13 ft outside, 16 ft in the middle. */
export const arrowsIn = (board) => (13 + 3 * Math.max(0, 1 - Math.abs(board - 20) / 15)) * 12;

const unit = (x, y) => {
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
};

/** Where a line ({ x0, slope, hook }) is at y: straight to the breakpoint, then the hook. */
export function pathX(line, y) {
  const u = Math.max(0, y - BREAK_IN) / HOOK_LEN;
  return line.x0 + line.slope * y + line.hook * u * u;
}

/** Which way the ball is heading at y, as inches across per inch down. */
export function pathSlope(line, y) {
  return line.slope + (2 * line.hook * Math.max(0, y - BREAK_IN)) / (HOOK_LEN * HOOK_LEN);
}

/** True if the ball stays on the lane all the way to the back row. */
function onLane(line) {
  const ys = [0, BREAK_IN, BACK_IN];
  if (line.hook) {
    // Where the hook turns it round, if it does before the back row.
    const turn = BREAK_IN - (line.slope * HOOK_LEN * HOOK_LEN) / (2 * line.hook);
    if (turn > BREAK_IN && turn < BACK_IN) ys.push(turn);
  }
  return ys.every((y) => Math.abs(pathX(line, y)) <= EDGE);
}

/**
 * How far a ball comes back between the breakpoint and the pins, in
 * boards toward the bowler's far side, for a first ball aimed at board
 * `target` that hooked at `hook` (both from their own gutter) and went
 * into the pocket: the gap between the pocket and where the skid line
 * would have taken it.
 */
export function bendOf(target, hook) {
  const skid = (hook - target) / (BREAK_IN - arrowsIn(target));
  return POCKET - (hook + skid * (HEAD_IN - BREAK_IN));
}

/** Where a pin heading `dir` from `from` turns back off a kickback, in inches along, or Infinity. */
const toKickback = (from, dir) => (dir.x === 0 ? Infinity : (Math.sign(dir.x) * KICKBACK_IN - from.x) / dir.x);

/**
 * Where a knocked pin goes in `distance` inches from `from` heading `dir`,
 * back off a kickback if it gets there: the points it passes, start to end.
 */
export function pinFlight(from, dir, distance) {
  const wall = toKickback(from, dir);
  if (wall >= distance) {
    return [from, { x: from.x + dir.x * distance, y: from.y + dir.y * distance }];
  }
  const at = { x: from.x + dir.x * wall, y: from.y + dir.y * wall };
  const back = distance - wall;
  return [from, at, { x: at.x - dir.x * back, y: at.y + dir.y * back }];
}

// The movers in flight during one roll (the ball, then each knocked pin
// and its rebound off a kickback), as flat arrays reused roll after roll:
// the solver rolls tens of thousands of lines, so this loop allocates
// nothing. 1 ball + 2 per pin fits.
const SLOTS = 24;
const FX = new Float64Array(SLOTS); // where it set off
const FY = new Float64Array(SLOTS);
const DX = new Float64Array(SLOTS); // which way, a unit vector
const DY = new Float64Array(SLOTS);
const REACH = new Float64Array(SLOTS); // centres this close and it touches a pin
const RANGE = new Float64Array(SLOTS); // how far it can still go
const T0 = new Float64Array(SLOTS); // when it set off, in ball inches
const SPEED = new Float64Array(SLOTS);
const CARRY = new Float64Array(SLOTS); // what a pin it hits flush carries
const GONE = new Float64Array(SLOTS); // how far it had flown before this leg
const BY = new Int8Array(SLOTS); // 0 the ball, else the pin

function put(i, fx, fy, dx, dy, reach, range, t0, speed, carry, gone, by) {
  FX[i] = fx;
  FY[i] = fy;
  DX[i] = dx;
  DY[i] = dy;
  REACH[i] = reach;
  RANGE[i] = range;
  T0[i] = t0;
  SPEED[i] = speed;
  CARRY[i] = carry;
  GONE[i] = gone;
  BY[i] = by;
}

/**
 * Roll one line at a leave: the pins it knocks down as a bitmask (bit p
 * for pin p), or -1 when the ball's in the gutter before the pins.
 * `lively` scales how far pins fly. With `record`, each pin knocked is
 * pushed onto it in order:
 *   { pin, t, by, dir, carry, off, at, gone }
 * t in "ball inches" (the time the ball would take to roll that far),
 * `by` the pin that knocked it (0 for the ball), `off` how far off-centre
 * the hit was (positive: the pin was to the mover's left), `at` where the
 * mover was when it touched and `gone` how far it had flown by then.
 */
function knock(leave, line, lively, record) {
  if (!onLane(line)) return -1;
  // Over the last few feet the ball is as good as straight.
  const s = pathSlope(line, ENTER_IN);
  const norm = Math.hypot(s, 1);
  put(0, pathX(line, ENTER_IN), ENTER_IN, s / norm, 1 / norm, BALL_HIT, Infinity, 0, 1, BALL_CARRY * lively, 0, 0);
  let n = 1;
  let up = 0;
  for (let j = 0; j < leave.length; j += 1) up |= 1 << leave[j];
  let down = 0;
  for (;;) {
    let t = Infinity;
    let pin = 0;
    let m = -1;
    let travel = 0;
    // Pins only ever fall, so a mover with nothing left in reach never
    // will have: drop it as we go.
    let live = 0;
    for (let i = 0; i < n; i += 1) {
      let any = false;
      let mine = false;
      for (let j = 0; j < leave.length; j += 1) {
        const p = leave[j];
        if (!(up & (1 << p))) continue;
        const wx = SPOTS[p].x - FX[i];
        const wy = SPOTS[p].y - FY[i];
        const along = wx * DX[i] + wy * DY[i];
        if (along <= 0) continue;
        const off = wx * DY[i] - wy * DX[i];
        if (Math.abs(off) >= REACH[i]) continue;
        const d = along - Math.sqrt(REACH[i] * REACH[i] - off * off);
        if (d > RANGE[i]) continue;
        any = true;
        const when = T0[i] + d / SPEED[i];
        if (when < t) {
          t = when;
          pin = p;
          travel = d;
          mine = true;
        }
      }
      if (!any) continue;
      if (mine) m = live;
      if (live !== i) put(live, FX[i], FY[i], DX[i], DY[i], REACH[i], RANGE[i], T0[i], SPEED[i], CARRY[i], GONE[i], BY[i]);
      live += 1;
    }
    n = live;
    if (m < 0) return down;

    // The touch: the pin flies off along the line of centres.
    const cx = FX[m] + DX[m] * travel;
    const cy = FY[m] + DY[m] * travel;
    const dir = unit(SPOTS[pin].x - cx, SPOTS[pin].y - cy);
    const cos = dir.x * DX[m] + dir.y * DY[m];
    const carry = CARRY[m] * (BY[m] === 0 ? 1 : PIN_CARRY) * Math.max(0, cos);
    if (record) {
      const off = (SPOTS[pin].x - FX[m]) * DY[m] - (SPOTS[pin].y - FY[m]) * DX[m];
      record.push({ pin, t, by: BY[m], dir, carry, off, at: { x: cx, y: cy }, gone: GONE[m] + travel });
    }
    up &= ~(1 << pin);
    down |= 1 << pin;

    // Its flight: straight, and back off a kickback if it gets there.
    const from = SPOTS[pin];
    const wall = toKickback(from, dir);
    if (wall >= carry) {
      put(n, from.x, from.y, dir.x, dir.y, PIN_HIT, carry, t, PIN_SPEED, carry, 0, pin);
      n += 1;
    } else {
      put(n, from.x, from.y, dir.x, dir.y, PIN_HIT, wall, t, PIN_SPEED, carry, 0, pin);
      const wx = from.x + dir.x * wall;
      const wy = from.y + dir.y * wall;
      const back = carry * REBOUND;
      put(n + 1, wx, wy, -dir.x, dir.y, PIN_HIT, (carry - wall) * REBOUND, t + wall / PIN_SPEED, PIN_SPEED, back, wall, pin);
      n += 2;
    }
  }
}

/**
 * Roll one line at a leave: the pins it knocks down, in order (see
 * knock()'s `record`), or null when the ball's in the gutter first.
 */
export function roll(leave, line, lively = 1) {
  const hits = [];
  return knock(leave, line, lively, hits) < 0 ? null : hits;
}

const centre = (pins) => pins.reduce((s, p) => s + pinAt(p).x, 0) / pins.length;
const maskOf = (pins) => pins.reduce((m, p) => m | (1 << p), 0);

/**
 * The cross-lane angle for pins centred at x, as the slope of the line
 * from where the ball's laid down to where it meets the pins: straight
 * down the middle, more angle the further out they are.
 */
const chordFor = (x) => (1.6 * x) / HEAD_IN;

/**
 * Slide a line across the lane at one chord angle and hook: for each spot
 * at the head pin (every `step` inches) the pins it takes, as a bitmask
 * (0 in the gutter).
 */
function scan(leave, chord, hook, lively, step) {
  const slope = chord - hook / HEAD_IN;
  const line = { x0: 0, slope, hook };
  // Only lines that pass within the ball's reach of a standing pin can
  // take anything; past the head pin the ball drifts at most this much.
  const xs = leave.map((p) => SPOTS[p].x);
  const drift = Math.abs(pathSlope(line, ENTER_IN)) * (BACK_IN - HEAD_IN) + 1;
  const from = Math.max(-EDGE, Math.min(...xs) - BALL_HIT - drift);
  const to = Math.min(EDGE, Math.max(...xs) + BALL_HIT + drift);
  const heads = [];
  const masks = [];
  // Stepped out from the middle, so a leave and its mirror image see mirror-image lines.
  for (let k = Math.ceil(from / step); k * step <= to; k += 1) {
    const head = k * step;
    line.x0 = head - chord * HEAD_IN;
    heads.push(head);
    masks.push(Math.max(0, knock(leave, line, lively, null)));
  }
  return { chord, slope, hook, heads, masks };
}

/**
 * The widest run of a scan that takes every pin in `want`:
 * { chord, slope, hook, head, width } with `width` the window in boards
 * and `head` its middle, slid in if that would mean laying the ball down
 * further out than anyone does.
 */
function windowIn({ chord, slope, hook, heads, masks }, want) {
  // Heads whose laydown is in reach: |head - chord * HEAD_IN| <= LAY_EDGE.
  const lo = chord * HEAD_IN - LAY_EDGE;
  const hi = chord * HEAD_IN + LAY_EDGE;
  let best = null;
  let start = -1;
  for (let i = 0; i <= masks.length; i += 1) {
    const ok = i < masks.length && (masks[i] & want) === want;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const a = heads[start];
      const b = heads[i - 1];
      const width = (b - a) / IN_PER_BOARD;
      if (Math.max(a, lo) <= Math.min(b, hi)) {
        const head = Math.min(Math.min(b, hi), Math.max(Math.max(a, lo), (a + b) / 2));
        // Two windows as wide: the one laid down nearer the middle (the
        // same choice from either side, so mirror-image leaves agree).
        const lay = Math.abs(head - chord * HEAD_IN);
        if (!best || width > best.width + 1e-9 || (width > best.width - 1e-9 && lay < best.lay)) {
          best = { chord, slope, hook, head, width, lay };
        }
      }
      start = -1;
    }
  }
  return best;
}

/**
 * The line to use. Every pairing of a share of the bowler's hook with an
 * angle from the fan has a cost in boards of window (curveCost, plus
 * OFF_ANGLE per 0.01 off the cross-lane angle), and the widest window
 * after costs wins. Pairings are tried cheapest first, and the search
 * stops once none left could beat the best so far even with the widest
 * window there is. Normal pin action first; livelier pins only if
 * nothing converts it.
 */
function solve(pins, hook, bothWays) {
  const shares = !hook ? [0] : bothWays ? [...NATURAL, ...REVERSE] : NATURAL;
  const ideal = chordFor(centre(pins));
  const mask = maskOf(pins);
  const options = [];
  shares.forEach((share) =>
    SLOPES.forEach((chord) =>
      options.push({ share, chord, cost: curveCost(share) + (OFF_ANGLE * Math.abs(chord - ideal)) / 0.01 })
    )
  );
  options.sort((a, b) => a.cost - b.cost);
  const tries = [...LIVELY.map((lively) => [lively, STEP]), [LIVELY[LIVELY.length - 1], FINE_STEP]];
  for (let i = 0; i < tries.length; i += 1) {
    const [lively, step] = tries[i];
    let best = null;
    for (let j = 0; j < options.length; j += 1) {
      const { share, chord, cost } = options[j];
      if (best && best.score >= MAX_ROOM - cost) break;
      const w = windowIn(scan(pins, chord, hook * share, lively, step), mask);
      const score = w && w.width - cost;
      // A tie goes to the gentler angle, then the nearer laydown: choices
      // that look the same from either side of the lane.
      const better =
        w &&
        (!best ||
          score > best.score + 1e-9 ||
          (score > best.score - 1e-9 &&
            (Math.abs(chord) < Math.abs(best.chord) - 1e-9 ||
              (Math.abs(chord) < Math.abs(best.chord) + 1e-9 && w.lay < best.lay))));
      if (better) best = { ...w, score, share, lively };
    }
    if (best) return best;
  }
  return null;
}

/** Which way the line crosses the lane, in the bowler's words. */
const sideOf = (x0) => (Math.abs(x0) < 2 ? "middle" : x0 > 0 ? "left" : "right");

/**
 * The plan for a leave (pins still standing, 1-10) and a bowler's hook
 * (inches at the head pin, positive to the left; 0 for a straight ball;
 * `bothWays` if they can curve it the other way too):
 *   { leave, x0, slope, hook, hookShare, lively, laydown, target, targetIn,
 *     breakpoint, room, from, key, hit, hits }
 * `hook` is the hook the line actually uses and `hookShare` that as a
 * share of the bowler's (1; less where it takes hook off; negative curved
 * the other way). `lively` is
 * 1 unless the pins have to fly further than usual. `laydown`, `target`
 * (where it crosses the arrows) and `breakpoint` are boards from the right
 * gutter, fractional. `room` is the window in boards; `key` the first pin
 * the ball touches and `hit` how: "flush", "left" or "right" (the side of
 * the pin the ball catches), or "thin-left" / "thin-right". `hits` is
 * roll()'s result for the line. Null for no pins or a full rack.
 */
export function spareLine(leave, { hook = 0, bothWays = false } = {}) {
  const pins = [...new Set(leave)].filter((p) => RACK[p]).sort((a, b) => a - b);
  if (!pins.length || pins.length === 10) return null;
  const win = solve(pins, hook, bothWays);
  if (!win) return null;

  const line = { x0: win.head - win.chord * HEAD_IN, slope: win.slope, hook: win.hook };
  // Where the line crosses the arrows, which sit deeper toward the middle.
  let targetIn = arrowsIn(20);
  for (let i = 0; i < 4; i += 1) targetIn = arrowsIn(boardOf(pathX(line, targetIn)));
  const hits = roll(pins, line, win.lively);
  const off = hits[0].off; // positive: the pin is left of the ball, so the ball catches its right side
  const side = off > 0 ? "right" : "left";
  const hit = Math.abs(off) < 1 ? "flush" : Math.abs(off) > 4.5 ? `thin-${side}` : side;

  return {
    leave: pins,
    ...line,
    hookShare: win.share ?? 0,
    lively: win.lively,
    laydown: boardOf(line.x0),
    target: boardOf(pathX(line, targetIn)),
    targetIn,
    breakpoint: boardOf(pathX(line, BREAK_IN)),
    room: win.width,
    from: sideOf(line.x0),
    key: hits[0].pin,
    hit,
    hits,
  };
}
