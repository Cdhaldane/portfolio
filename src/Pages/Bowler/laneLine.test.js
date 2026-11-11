import {
  FOUL_Y,
  HOOK_Y,
  PIN_Y,
  POCKET,
  WIDTH,
  aimName,
  arrowY,
  boardAt,
  boardX,
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
  expect([px, py]).toEqual([boardX(POCKET), PIN_Y + 7]);
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
