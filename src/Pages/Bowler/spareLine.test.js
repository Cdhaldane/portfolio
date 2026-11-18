import { IN_PER_BOARD, KICKBACK_IN, bendOf, boardOf, pinAt, roll, spareLine } from "./spareLine";

const MIRROR = { 1: 1, 2: 3, 3: 2, 4: 6, 5: 5, 6: 4, 7: 10, 8: 9, 9: 8, 10: 7 };
const mirror = (pins) => pins.map((p) => MIRROR[p]).sort((a, b) => a - b);
const downed = (plan) => roll(plan.leave, plan, plan.lively).map((h) => h.pin);
const HOOK = bendOf(10, 6) * IN_PER_BOARD; // aimed at the 2nd arrow, broke at 6: a big right-hander's hook

// Every leave a second ball can face: any 1 to 9 of the ten pins.
const LEAVES = [];
for (let mask = 1; mask < 1023; mask += 1) {
  LEAVES.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((_, i) => mask & (1 << i)));
}
const converts = (plan) => {
  expect(plan).not.toBeNull();
  expect(downed(plan).sort((a, b) => a - b)).toEqual(plan.leave);
  expect(plan.laydown).toBeGreaterThanOrEqual(5);
  expect(plan.laydown).toBeLessThanOrEqual(35);
};

test("a hook is read off a marked first ball: how far it came back into the pocket", () => {
  // Aimed at board 10, hooked at 6: the skid line runs out to ~3 by the pins, the pocket's 17.5.
  expect(bendOf(10, 6)).toBeCloseTo(14.6, 1);
  // Straight through the arrows into the pocket: no hook at all.
  expect(bendOf(17.5, 17.5)).toBeCloseTo(0);
});

test("corner pins are shot cross-lane: the 10 from the left, the 7 from the right", () => {
  const ten = spareLine([10]);
  expect(ten.from).toBe("left");
  expect(ten.laydown).toBeGreaterThan(28);
  expect(ten.target).toBeGreaterThan(20);
  expect(ten.target).toBeLessThan(ten.laydown);

  const seven = spareLine([7]);
  expect(seven.from).toBe("right");
  expect(seven.laydown).toBeLessThan(12);
  expect(seven.target).toBeLessThan(20);
});

test("the head pin and the 5 are straight up the middle", () => {
  [[1], [5], [1, 5]].forEach((leave) => {
    const plan = spareLine(leave);
    expect(plan.from).toBe("middle");
    expect(plan.hit).toBe("flush");
    expect(Math.round(plan.target)).toBe(20);
  });
});

test("the bucket goes with room to spare", () => {
  const plan = spareLine([2, 4, 5, 8]);
  expect(plan.key).toBe(2);
  expect(plan.room).toBeGreaterThan(5);
  converts(plan);
});

test("baby splits slide the front pin into the corner", () => {
  const threeTen = spareLine([3, 10]);
  expect(threeTen.key).toBe(3);
  expect(threeTen.hit).toMatch(/left/); // catch the 3's left side, it goes right
  expect(threeTen.hits.find((h) => h.pin === 10).by).toBe(3);

  const twoSeven = spareLine([2, 7]);
  expect(twoSeven.hit).toMatch(/right/);
  expect(twoSeven.hits.find((h) => h.pin === 7).by).toBe(2);
});

test("the 2-10 is makeable: clip the 2's left side and it takes the 10", () => {
  const plan = spareLine([2, 10]);
  expect(plan.key).toBe(2);
  expect(plan.hit).toBe("thin-left");
  expect(plan.hits.find((h) => h.pin === 10).by).toBe(2);
  expect(plan.lively).toBe(1);
});

test("the 7-10 goes off the kickback: a pin flies into the side wall and back across", () => {
  [spareLine([7, 10]), spareLine([7, 10], { hook: HOOK, bothWays: true })].forEach((plan) => {
    converts(plan);
    const [first, second] = plan.hits;
    expect(second.by).toBe(first.pin);
    // The first pin flew further than the wall before it took the other one.
    expect(second.gone).toBeGreaterThan(KICKBACK_IN - Math.abs(pinAt(first.pin).x));
  });
});

test("every leave gets a line that makes it, never one for the count", () => {
  LEAVES.forEach((leave) => converts(spareLine(leave)));
});

test("with a hook, every small leave still gets a line that makes it", () => {
  LEAVES.filter((leave) => leave.length <= 3).forEach((leave) => {
    const plan = spareLine(leave, { hook: HOOK, bothWays: true });
    converts(plan);
    expect(Math.abs(plan.hookShare)).toBeLessThanOrEqual(1);
  });
});

test("your hook bends the line: it plays further right, and comes back left into the pins", () => {
  [[3], [6], [3, 6, 10], [2, 4, 5, 8]].forEach((leave) => {
    const straight = spareLine(leave);
    const hooked = spareLine(leave, { hook: HOOK });
    if (hooked.hook === 0) return; // took the hook off for this one
    expect(hooked.hook).toBeGreaterThan(0); // a right-hander's comes back left
    expect(hooked.breakpoint).toBeLessThan(straight.breakpoint);
    converts(hooked);
  });
  // The single 3 keeps a hook on it.
  expect(spareLine([3], { hook: HOOK }).hook).toBeGreaterThan(0);
});

test("where a big hook can't reach the corner, it takes hook off", () => {
  const plan = spareLine([10], { hook: HOOK });
  expect(plan.hookShare).toBeLessThan(1);
  expect(plan.hookShare).toBeGreaterThanOrEqual(0);
  converts(plan);
});

test("curving it the other way is only on the table for a bowler who can", () => {
  const leave = [1, 6, 7];
  expect(spareLine(leave, { hook: HOOK, bothWays: true }).hookShare).toBeLessThan(0);
  expect(spareLine(leave, { hook: HOOK }).hookShare).toBeGreaterThanOrEqual(0);
});

test("a leave and its mirror image get mirror-image lines, hook and all", () => {
  LEAVES.filter((leave) => leave.length <= 3).forEach((leave) => {
    [0, HOOK].forEach((hook) => {
      // A straight ball at a leave that's its own mirror (7-10) can go either way.
      if (!hook && mirror(leave).join() === leave.join()) return;
      const plan = spareLine(leave, { hook });
      const other = spareLine(mirror(leave), { hook: -hook });
      expect(other.hookShare).toBe(plan.hookShare);
      expect(other.laydown).toBeCloseTo(40 - plan.laydown, 0);
      expect(other.target).toBeCloseTo(40 - plan.target, 0);
    });
  });
});

test("boards count from the right gutter with 20 in the middle", () => {
  expect(boardOf(0)).toBe(20);
  expect(boardOf(41.5 / 2)).toBeCloseTo(39.5);
  expect(boardOf(-41.5 / 2)).toBeCloseTo(0.5);
});

test("nothing to pick up, nothing to say", () => {
  expect(spareLine([])).toBeNull();
  expect(spareLine([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeNull();
});
