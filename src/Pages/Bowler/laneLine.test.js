import { HEAD_IN, LANE_IN, pinAt } from "./spareLine";
import {
  ARROW_Y,
  BALL_RADIUS,
  DOTS_Y,
  FOUL_Y,
  GUTTER,
  HEIGHT,
  HOOK_Y,
  PIN_SPOTS,
  PIT_Y,
  PIN_Y,
  POCKET,
  POCKET_Y,
  WIDTH,
  aimName,
  arrowY,
  boardAt,
  boardX,
  laneX,
  laneY,
  linePath,
  markAt,
  stepBoard,
} from "./laneLine";

const BOARDS = Array.from({ length: 39 }, (_, i) => i + 1);
const numbers = (path) => path.match(/-?\d+(\.\d+)?/g).map(Number);

test("every board maps to an x and back, for either hand", () => {
  ["R", "L"].forEach((hand) => BOARDS.forEach((b) => expect(boardAt(boardX(b, hand), hand)).toBe(b)));
});

test("board 1 is your own gutter: right for a right-hander, left for a lefty", () => {
  expect(boardX(1, "R")).toBeGreaterThan(boardX(39, "R"));
  expect(boardX(1, "L")).toBeLessThan(boardX(39, "L"));
  expect(boardX(20, "R")).toBe(WIDTH / 2);
  expect(boardX(20, "L")).toBe(WIDTH / 2);
  // Taps in the gutters stay on the lane.
  expect(boardAt(0, "R")).toBe(39);
  expect(boardAt(WIDTH, "R")).toBe(1);
});

test("taps by the arrows aim, taps up the lane hook", () => {
  expect(markAt(arrowY(10))).toBe("aim");
  expect(markAt(FOUL_Y)).toBe("aim");
  expect(markAt(HOOK_Y)).toBe("hook");
  expect(markAt(PIN_Y)).toBe("hook");
});

test("the arrows make a chevron, the middle one furthest out", () => {
  expect(arrowY(20)).toBeLessThan(arrowY(15));
  expect(arrowY(15)).toBeLessThan(arrowY(5));
  expect(arrowY(5)).toBe(arrowY(35));
});

test("nudging moves the mark the way the arrow points", () => {
  expect(stepBoard(10, "left", "R")).toBe(11);
  expect(stepBoard(10, "right", "R")).toBe(9);
  expect(stepBoard(10, "left", "L")).toBe(9);
  expect(stepBoard(39, "left", "R")).toBe(39);
  expect(stepBoard(1, "right", "R")).toBe(1);
});

test("aims read in arrows", () => {
  expect(aimName(10)).toBe("2nd arrow");
  expect(aimName(20)).toBe("middle arrow");
  expect(aimName(12)).toBe("2 left of the 2nd arrow");
  expect(aimName(13)).toBe("2 right of the 3rd arrow");
  expect(aimName(12, "L")).toBe("2 right of the 2nd arrow");
  expect(aimName(1)).toBe("4 right of the 1st arrow");
});

test("the line runs from the foul line through the aim, out to the hook and into the pocket", () => {
  const [lx, ly, hx, hy, , , , , px, py] = numbers(linePath(10, 6, "R"));
  expect(ly).toBe(FOUL_Y);
  expect([hx, hy]).toEqual([boardX(6), HOOK_Y]);
  expect([px, py]).toEqual([boardX(POCKET), POCKET_Y]);
  // The aim sits on the straight part.
  const t = (FOUL_Y - arrowY(10)) / (FOUL_Y - HOOK_Y);
  expect(lx + (hx - lx) * t).toBeCloseTo(boardX(10), 0);
  // Out toward the gutter before it comes back: a right-hander's hook.
  expect(lx).toBeLessThan(hx);
  expect(px).toBeLessThan(hx);
});

test("a lefty's line is the right-hander's in the mirror", () => {
  const right = numbers(linePath(12, 7, "R"));
  const left = numbers(linePath(12, 7, "L"));
  right.forEach((n, i) => {
    if (i % 2 === 0) expect(Math.abs(n + left[i] - WIDTH)).toBeLessThan(0.11);
    else expect(left[i]).toBe(n);
  });
});

test("it's shaped like a lane: long and narrow, not a square", () => {
  expect(HEIGHT / WIDTH).toBeGreaterThan(2.5);
  // Most of the picture is the 60 ft from the foul line to the pins.
  expect((FOUL_Y - PIN_Y) / HEIGHT).toBeGreaterThan(0.7);
});

test("landmarks sit at their true distances down the lane", () => {
  const out = (y) => (FOUL_Y - y) / (FOUL_Y - laneY(HEAD_IN - 8)); // share of the lane before the deck
  expect(out(DOTS_Y)).toBeCloseTo(7 / 59.33, 2);
  expect(out(ARROW_Y)).toBeCloseTo(13 / 59.33, 2);
  expect(out(HOOK_Y)).toBeCloseTo(40 / 59.33, 2);
  // And in order: foul line, dots, arrows, breakpoint, pins, pit.
  [FOUL_Y, DOTS_Y, ARROW_Y, HOOK_Y, PIN_Y, PIT_Y].reduce((below, y) => {
    expect(y).toBeLessThan(below);
    return y;
  }, HEIGHT);
});

test("across the lane it's to scale: boards, pins and ball", () => {
  expect(laneX(-LANE_IN / 2) - laneX(LANE_IN / 2)).toBeCloseTo(WIDTH - GUTTER * 2);
  expect(laneX(0)).toBe(boardX(20));
  // An 8.5 in ball is about a fifth of the lane.
  expect((BALL_RADIUS * 2) / (WIDTH - GUTTER * 2)).toBeCloseTo(8.5 / 41.5, 3);
  // The 10 pin is on a right-hander's 3rd board, a lefty's 37th.
  const ten = PIN_SPOTS.find((s) => s.pin === 10);
  expect(boardAt(ten.x, "R")).toBe(3);
  expect(boardAt(ten.x, "L")).toBe(37);
});

test("the rack is a triangle, not a squashed line of pins", () => {
  const spot = (pin) => PIN_SPOTS.find((s) => s.pin === pin);
  const depth = spot(1).y - spot(7).y;
  const width = spot(10).x - spot(7).x;
  expect(depth / width).toBeGreaterThan(0.6); // a true rack is 0.87
});

test("the picture is continuous where the pin deck's scale takes over", () => {
  const near = laneY(HEAD_IN - 8.001);
  const far = laneY(HEAD_IN - 7.999);
  expect(Math.abs(near - far)).toBeLessThan(0.01);
  expect(laneY(0)).toBe(FOUL_Y);
  expect(laneY(pinAt(1).y)).toBe(PIN_Y);
});
