// The lane picture behind "Aim & hook" on the lane page and the lines chart
// in Lane play: the lane from above as you stand on the approach, foul line
// at the bottom and the pins at the top. A first ball's line is two boards:
// where you aimed (down at the arrows) and where it hooked (the breakpoint,
// about 40 ft out). From those the ball's path draws itself: straight
// through the aim out to the hook, then the curve back into the pocket.
//
// Boards count from the bowler's own gutter (scoring.js): a right-hander's
// board 1 is the right edge, a left-hander's the left. `hand` only mirrors
// the picture; the stored boards mean the same thing either way.
//
// Across the lane it's to scale (39 boards); along it it's squashed, or the
// picture would be twenty times taller than it is wide.
import { MAX_BOARD, MIN_BOARD } from "./scoring";

export const BOARD = 6; // viewBox units per board
export const GUTTER = 12;
export const WIDTH = GUTTER * 2 + BOARD * MAX_BOARD; // 258
export const HEIGHT = 244;
export const FOUL_Y = 232;
export const DOTS_Y = 216; // the dots, ~7 ft out
export const ARROW_Y = 194; // the outside arrows; the chevron peaks at the
export const ARROW_PEAK = 12; //   middle arrow, this much further out
export const HOOK_Y = 114; // the breakpoint row, ~40 ft
export const PIN_Y = 58; // the head pin, 60 ft
export const ROW = 14; // pin rows, squashed like the lane
export const POCKET = 17.5; // the 1-3 pocket (1-2 for a lefty)

export const ARROWS = [5, 10, 15, 20, 25, 30, 35];
export const DOTS = [3, 5, 8, 11, 14, 26, 29, 32, 35, 37];

// Pins by how far left of the head pin they stand, in boards (12 in apart),
// as the bowler sees them: the 7 is far left, the 10 far right.
const PIN_SPREAD = 12 / (41.5 / MAX_BOARD) / 2; // half a pin spacing, ~5.6 boards
export const PIN_SPOTS = [
  [1, 0, 0],
  [2, 1, 1],
  [3, -1, 1],
  [4, 2, 2],
  [5, 0, 2],
  [6, -2, 2],
  [7, 3, 3],
  [8, 1, 3],
  [9, -1, 3],
  [10, -3, 3],
].map(([pin, left, row]) => ({ pin, x: WIDTH / 2 - left * PIN_SPREAD * BOARD, y: PIN_Y - row * ROW }));

/** Which half of the picture a tap is in: near the arrows aims, past them hooks. */
const SPLIT_Y = (ARROW_Y - ARROW_PEAK + HOOK_Y) / 2;
export const markAt = (y) => (y > SPLIT_Y ? "aim" : "hook");

const clampBoard = (b) => Math.min(MAX_BOARD, Math.max(MIN_BOARD, b));

/** The x of a board's centre (fractions allowed, for the pocket). */
export const boardX = (board, hand = "R") =>
  GUTTER + (hand === "L" ? board - 0.5 : MAX_BOARD - board + 0.5) * BOARD;

/** The board under an x, kept on the lane. */
export function boardAt(x, hand = "R") {
  const fromLeft = Math.floor((x - GUTTER) / BOARD); // 0 = the left edge board
  return clampBoard(hand === "L" ? fromLeft + 1 : MAX_BOARD - fromLeft);
}

/** How far out the arrows are at a board: a chevron, the middle arrow deepest. */
export const arrowY = (board) => ARROW_Y - ARROW_PEAK * Math.max(0, 1 - Math.abs(board - 20) / 15);

/** One board toward the left or right of the picture, as boards. */
export const stepBoard = (board, dir, hand = "R") =>
  clampBoard(board + (dir === "left" ? 1 : -1) * (hand === "L" ? -1 : 1));

const r1 = (n) => Math.round(n * 10) / 10;
const LEFT_EDGE = GUTTER + 2;
const RIGHT_EDGE = WIDTH - GUTTER - 2;

/**
 * The SVG path for a first ball aimed at `aim` that hooked at `hook`: the
 * skid line run back to the foul line, out through the aim to the
 * breakpoint, then a curve that leaves along the skid and comes into the
 * pocket from the side the ball was on.
 */
export function linePath(aim, hook, hand = "R") {
  const ax = boardX(aim, hand);
  const ay = arrowY(aim);
  const hx = boardX(hook, hand);
  const hy = HOOK_Y;
  const back = (FOUL_Y - ay) / (ay - hy);
  const lx = Math.min(RIGHT_EDGE, Math.max(LEFT_EDGE, ax + (ax - hx) * back));
  const skid = Math.hypot(hx - lx, hy - FOUL_Y) || 1;
  const c1x = hx + ((hx - lx) / skid) * 30;
  const c1y = hy + ((hy - FOUL_Y) / skid) * 30;
  const px = boardX(POCKET, hand);
  const py = PIN_Y + 7;
  const c2x = px + (hx - px) * 0.25;
  const c2y = py + 36;
  return `M ${r1(lx)} ${FOUL_Y} L ${r1(hx)} ${hy} C ${r1(c1x)} ${r1(c1y)}, ${r1(c2x)} ${c2y}, ${r1(px)} ${py}`;
}

const ORDINAL = ["1st", "2nd", "3rd", "middle", "5th", "6th", "7th"];

/**
 * A board in arrow terms, the way you'd say it at the lane: "2nd arrow",
 * "2 left of the 3rd arrow". Arrows count from your own gutter.
 */
export function aimName(board, hand = "R") {
  const n = Math.min(7, Math.max(1, Math.round(board / 5)));
  const arrow = `${ORDINAL[n - 1]} arrow`;
  const off = board - n * 5;
  if (!off) return arrow;
  // Higher boards are further from your gutter: left for a right-hander.
  const side = (off > 0) === (hand !== "L") ? "left" : "right";
  return `${Math.abs(off)} ${side} of the ${arrow}`;
}
