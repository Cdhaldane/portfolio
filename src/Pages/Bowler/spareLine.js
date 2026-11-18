// How to pick up a spare, worked out from the leave: a straight ball,
// shot cross-lane, through the pins on the side that takes them all.
//
// Everything here is real lane geometry in inches: x across the lane from
// its middle (left is positive, as the bowler sees it), y down the lane
// from the foul line. A line is a straight ball, x = x0 + slope * y.
//
// The model is deliberately simple. The ball rolls straight through and
// knocks every pin it touches. A struck pin flies off along the line of
// centres at contact (billiard-ball style), carrying less the thinner it
// was hit, and knocks any pin it touches on the way. The ball's angle is
// set by the cross-lane rule (pins on the right are shot from the left and
// vice versa, more angle the further out they are); along that angle the
// solver slides the line across the lane and keeps the widest window that
// takes every pin. A window too narrow to hit on purpose means a split
// you'd rather pick one pin (or a few) off of.
//
// Boards: `board` is counted from the right gutter, as a right-hander
// counts (board 20 is the middle). The UI flips it to the bowler's own
// gutter for a left-hander; the physics doesn't care which hand rolls it.
import { MAX_BOARD } from "./scoring";

export const LANE_IN = 41.5;
export const IN_PER_BOARD = LANE_IN / MAX_BOARD;
export const HEAD_IN = 60 * 12; // the head pin, 60 ft out
export const ROW_IN = 6 * Math.sqrt(3); // rows of the rack: 12 in equilateral triangles
export const BALL_R = 4.25;
export const PIN_R = 2.385; // at the belly

const BALL_HIT = BALL_R + PIN_R; // centres this close and the ball touches the pin
const PIN_HIT = 5.5; // a falling pin's reach: wider than its belly, it tumbles
const BALL_CARRY = 40; // how far a pin hit flush flies, in inches
const PIN_CARRY = 0.75; // a pin knocked by a pin keeps this much of the carry
const PIN_SPEED = 0.6; // pins fly slower than the ball rolls
const EDGE = LANE_IN / 2 - 1.5; // past this the ball's centre is in the gutter
const LAY_EDGE = 13.5 * IN_PER_BOARD; // the furthest out a ball gets laid down
const STEP = 0.2; // inches between the lines the solver tries (a fifth of a board)
const BACK_IN = HEAD_IN + 3 * ROW_IN;

const MAKE_WINDOW = 1; // boards: narrower than this, pick pins off instead
const PICK_WINDOW = 2; // boards: what picking off has to leave you
// The angles tried, as slopes (0.04 crosses ~27 boards on the way to the
// pins), and how many boards of window an angle gives up per 0.01 it
// strays from the cross-lane one.
const SLOPES = [-0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04];
const OFF_ANGLE = 0.8;

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

/**
 * How far a mover travels before it touches the pin at p, or -1 if it
 * passes it (or runs out of carry first). The hot loop: no allocations.
 */
function reaches(m, p) {
  const wx = p.x - m.from.x;
  const wy = p.y - m.from.y;
  const along = wx * m.dir.x + wy * m.dir.y;
  if (along <= 0) return -1;
  const off = wx * m.dir.y - wy * m.dir.x;
  if (Math.abs(off) >= m.reach) return -1;
  const travel = along - Math.sqrt(m.reach * m.reach - off * off);
  return travel > m.range ? -1 : travel;
}

/**
 * The touch itself: where the mover was, which way the pin flies (along
 * the line of centres) and how far off-centre the hit was (positive: the
 * pin was to the mover's left).
 */
function contact(m, p, travel) {
  const x = m.from.x + m.dir.x * travel;
  const y = m.from.y + m.dir.y * travel;
  const off = (p.x - m.from.x) * m.dir.y - (p.y - m.from.y) * m.dir.x;
  return { off, at: { x, y }, dir: unit(p.x - x, p.y - y) };
}

/**
 * Roll one line at a leave. Returns the pins it knocks down, in order:
 * { pin, t, by, dir, carry, off, at } with t in "ball inches" (the time
 * the ball would take to roll that far), `by` the pin that knocked it
 * (0 for the ball) and `at` where the mover was when it touched. Null
 * when the line is in the gutter before the pins.
 */
export function roll(leave, x0, slope) {
  if (Math.abs(x0) > EDGE || Math.abs(x0 + slope * BACK_IN) > EDGE) return null;
  const ball = { from: { x: x0, y: 0 }, dir: unit(slope, 1), reach: BALL_HIT, range: Infinity, t0: 0 };
  ball.speed = 1;
  ball.by = 0;
  ball.carry = BALL_CARRY;
  const movers = [ball];
  const hits = [];
  let up = leave.slice();
  for (;;) {
    let t = Infinity;
    let pin = 0;
    let m = null;
    let travel = 0;
    for (let i = 0; i < movers.length; i += 1) {
      for (let j = 0; j < up.length; j += 1) {
        const d = reaches(movers[i], SPOTS[up[j]]);
        const when = d < 0 ? Infinity : movers[i].t0 + d / movers[i].speed;
        if (when < t) {
          t = when;
          pin = up[j];
          m = movers[i];
          travel = d;
        }
      }
    }
    if (!m) return hits;
    const c = contact(m, SPOTS[pin], travel);
    const cos = c.dir.x * m.dir.x + c.dir.y * m.dir.y;
    const carry = m.carry * (m === ball ? 1 : PIN_CARRY) * Math.max(0, cos);
    up = up.filter((p) => p !== pin);
    hits.push({ pin, t, by: m.by, dir: c.dir, carry, off: c.off, at: c.at });
    movers.push({ from: SPOTS[pin], dir: c.dir, reach: PIN_HIT, range: carry, t0: t, speed: PIN_SPEED, by: pin, carry });
  }
}

const centre = (pins) => pins.reduce((s, p) => s + pinAt(p).x, 0) / pins.length;
const maskOf = (pins) => pins.reduce((m, p) => m | (1 << p), 0);

/**
 * The cross-lane angle for pins centred at x: straight down the middle,
 * more angle the further out they are, laid down on the other side.
 */
const slopeFor = (x) => (x + 0.6 * x) / HEAD_IN;

/**
 * Slide a line at one angle across the lane: for each spot at the head pin
 * (every STEP inches) the pins it takes, as a bitmask (0 in the gutter).
 */
function scan(leave, slope) {
  const heads = [];
  const masks = [];
  // Stepped out from the middle, so a leave and its mirror image see mirror-image lines.
  const n = Math.floor(EDGE / STEP);
  for (let k = -n; k <= n; k += 1) {
    const head = k * STEP;
    const hits = roll(leave, head - slope * HEAD_IN, slope);
    heads.push(head);
    masks.push(hits ? maskOf(hits.map((h) => h.pin)) : 0);
  }
  return { slope, heads, masks };
}

/**
 * The widest run of a scan that takes every pin in `want`:
 * { slope, head, width } with `width` the whole window in boards and
 * `head` its middle, slid in if that would mean laying the ball down
 * further out than anyone does. Runs only playable from out there don't
 * count.
 */
function windowIn({ slope, heads, masks }, want) {
  // Heads whose laydown is in reach: |head - slope * HEAD_IN| <= LAY_EDGE.
  const lo = slope * HEAD_IN - LAY_EDGE;
  const hi = slope * HEAD_IN + LAY_EDGE;
  let best = null;
  let start = -1;
  for (let i = 0; i <= masks.length; i += 1) {
    const ok = i < masks.length && (masks[i] & want) === want;
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      const a = heads[start];
      const b = heads[i - 1];
      const width = (b - a) / IN_PER_BOARD;
      if (Math.max(a, lo) <= Math.min(b, hi) && (!best || width > best.width)) {
        best = { slope, head: Math.min(Math.min(b, hi), Math.max(Math.max(a, lo), (a + b) / 2)), width };
      }
      start = -1;
    }
  }
  return best;
}

function subsets(pins, size) {
  if (size === 0) return [[]];
  if (pins.length < size) return [];
  const [first, ...rest] = pins;
  return [...subsets(rest, size - 1).map((s) => [first, ...s]), ...subsets(rest, size)];
}

/**
 * The best line for the pins in `want` across every angle: the widest
 * window, less a little for each step away from the cross-lane angle, so
 * the conventional line wins unless another is clearly roomier.
 */
function bestFor(scans, want) {
  const ideal = slopeFor(centre(want));
  const mask = maskOf(want);
  let best = null;
  scans.forEach((sc) => {
    const w = windowIn(sc, mask);
    if (!w) return;
    const score = w.width - (OFF_ANGLE * Math.abs(sc.slope - ideal)) / 0.01;
    if (!best || score > best.score) best = { ...w, score };
  });
  return best;
}

/** Picking off a split: the most pins one line can still count on. */
function pickOff(pins, scans) {
  for (let size = pins.length - 1; size >= 1; size -= 1) {
    let best = null;
    subsets(pins, size).forEach((want) => {
      const w = bestFor(scans, want);
      if (w && w.width >= PICK_WINDOW && (!best || w.score > best.win.score)) best = { win: w, take: want };
    });
    if (best) return best;
  }
  return null;
}

/** Which way the line crosses the lane, in the bowler's words. */
const sideOf = (x0) => (Math.abs(x0) < 2 ? "middle" : x0 > 0 ? "left" : "right");

/**
 * The plan for a leave (pins still standing, 1-10):
 *   { leave, make, take, x0, slope, laydown, target, targetIn, room,
 *     from, key, hit, hits }
 * `make` is false for a split you should pick off; `take` is the pins the
 * line goes for (all of them when `make`). `laydown` and `target` are
 * boards from the right gutter (fractional; round them to talk), the
 * target where the line crosses the arrows. `room` is the window in
 * boards; `key` the first pin the ball touches and `hit` how: "flush",
 * "left" or "right" (the side of the pin the ball catches), or "thin-left"
 * / "thin-right". `hits` is roll()'s result for the chosen line.
 */
export function spareLine(leave) {
  const pins = [...new Set(leave)].filter((p) => RACK[p]).sort((a, b) => a - b);
  if (!pins.length || pins.length === 10) return null;

  const scans = SLOPES.map((slope) => scan(pins, slope));
  const all = bestFor(scans, pins);
  const make = Boolean(all && all.width >= MAKE_WINDOW);
  const pick = make ? null : pickOff(pins, scans);
  if (!make && !pick) return null;
  const win = make ? all : pick.win;
  const take = make ? pins : pick.take;

  const { slope, head, width } = win;
  const x0 = head - slope * HEAD_IN;
  // Where the line crosses the arrows, which sit deeper toward the middle.
  let targetIn = arrowsIn(20);
  for (let i = 0; i < 4; i += 1) targetIn = arrowsIn(boardOf(x0 + slope * targetIn));
  const hits = roll(pins, x0, slope);
  const first = hits.find((h) => h.by === 0);
  const off = first.off; // positive: the pin is left of the ball, so the ball catches its right side
  const side = off > 0 ? "right" : "left";
  const hit = Math.abs(off) < 1 ? "flush" : Math.abs(off) > 4.5 ? `thin-${side}` : side;

  return {
    leave: pins,
    make,
    take,
    x0,
    slope,
    laydown: boardOf(x0),
    target: boardOf(x0 + slope * targetIn),
    targetIn,
    room: width,
    from: sideOf(x0),
    key: first.pin,
    hit,
    hits,
  };
}
