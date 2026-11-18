// The lane picture behind "Aim & hook" and the spare line on the lane page,
// and the lines chart in Lane play: the lane from above as you stand on the
// approach, foul line at the bottom and the pins at the top. A first ball's
// line is two boards: where you aimed (down at the arrows) and where it
// hooked (the breakpoint, about 40 ft out). From those the ball's path
// draws itself: straight through the aim out to the hook, then the curve
// back into the pocket.
//
// Boards count from the bowler's own gutter (scoring.js): a right-hander's
// board 1 is the right edge, a left-hander's the left. `hand` only mirrors
// the picture; the stored boards mean the same thing either way.
//
// Across the lane it's to scale (39 boards, pins and ball true size), and
// so is the pin deck, give or take: a real rack is a triangle. Down the
// lane it's squashed about 9 to 1, or the picture would be seventeen times
// taller than it is wide. Landmarks sit at their true distances: dots at
// 7 ft, arrows 13-16 ft, the breakpoint row at 40 ft, the head pin at 60.
// laneX / laneY map real inches (spareLine.js) onto it.
import { MAX_BOARD, MIN_BOARD } from "./scoring";
import { BALL_R, HEAD_IN, IN_PER_BOARD, PIN_R, ROW_IN, arrowsIn, pinAt } from "./spareLine";

export const BOARD = 6; // viewBox units per board
export const GUTTER = 12;
export const WIDTH = GUTTER * 2 + BOARD * MAX_BOARD; // 258
export const HEIGHT = 674;
export const FOUL_Y = 650;
export const PIT_Y = 14; // the back edge of the pin deck
export const ROW = 46; // between rows of the rack (58.6 would be true)
export const PIN_Y = PIT_Y + 16 + 3 * ROW; // the head pin

const ACROSS = BOARD / IN_PER_BOARD; // units per inch across the lane
const DECK = ROW / ROW_IN; // units per inch along the pin deck
const DECK_FROM = HEAD_IN - 8; // the deck's scale takes over just short of the head pin
export const DECK_Y = PIN_Y + 8 * DECK;
const ALONG = (FOUL_Y - DECK_Y) / DECK_FROM; // units per inch along the lane

/** A spot on the real lane (inches: x left of the middle, y past the foul line) in the picture. */
export const laneX = (x) => WIDTH / 2 - x * ACROSS;
export const laneY = (y) => (y >= DECK_FROM ? PIN_Y - (y - HEAD_IN) * DECK : FOUL_Y - y * ALONG);

export const PIN_RADIUS = PIN_R * ACROSS;
export const BALL_RADIUS = BALL_R * ACROSS;
export const DOTS_Y = Math.round(laneY(7 * 12));
export const ARROW_Y = Math.round(laneY(arrowsIn(5))); // the outside arrows; the chevron peaks at the
export const ARROW_PEAK = ARROW_Y - Math.round(laneY(arrowsIn(20))); //   middle arrow, this much further out
export const HOOK_Y = Math.round(laneY(40 * 12)); // the breakpoint row
export const HOOK_BAND = 34; // half the height of the row a hook tap lands in
export const POCKET = 17.5; // the 1-3 pocket (1-2 for a lefty)
export const POCKET_Y = Math.round(laneY(HEAD_IN - 6)); // the ball's centre as it meets the head pin

export const ARROWS = [5, 10, 15, 20, 25, 30, 35];
export const DOTS = [3, 5, 8, 11, 14, 26, 29, 32, 35, 37];

// Where each pin stands in the picture, as the bowler sees them: the 7 far
// left, the 10 far right.
export const PIN_SPOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((pin) => {
  const { x, y } = pinAt(pin);
  return { pin, x: laneX(x), y: laneY(y) };
});

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
  const px = boardX(POCKET, hand);
  const py = POCKET_Y;
  const leg = hy - py;
  const c1x = hx + ((hx - lx) / skid) * leg * 0.6;
  const c1y = hy + ((hy - FOUL_Y) / skid) * leg * 0.6;
  const c2x = px + (hx - px) * 0.25;
  const c2y = py + leg * 0.7;
  return `M ${r1(lx)} ${FOUL_Y} L ${r1(hx)} ${hy} C ${r1(c1x)} ${r1(c1y)}, ${r1(c2x)} ${r1(c2y)}, ${r1(px)} ${py}`;
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
