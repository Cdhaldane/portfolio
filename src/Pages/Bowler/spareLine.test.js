import { boardOf, roll, spareLine } from "./spareLine";

const MIRROR = { 1: 1, 2: 3, 3: 2, 4: 6, 5: 5, 6: 4, 7: 10, 8: 9, 9: 8, 10: 7 };
const mirror = (pins) => pins.map((p) => MIRROR[p]).sort((a, b) => a - b);
const downed = (plan) => roll(plan.leave, plan.x0, plan.slope).map((h) => h.pin);

// Every leave a second ball can face: any 1 to 9 of the ten pins.
const LEAVES = [];
for (let mask = 1; mask < 1023; mask += 1) {
  LEAVES.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((_, i) => mask & (1 << i)));
}

test("corner pins are shot cross-lane: the 10 from the left, the 7 from the right", () => {
  const ten = spareLine([10]);
  expect(ten.make).toBe(true);
  expect(ten.from).toBe("left");
  expect(ten.laydown).toBeGreaterThan(28);
  // Across the lane: it crosses the arrows left of the middle, heading right.
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

test("the bucket is a spare with room to spare", () => {
  const plan = spareLine([2, 4, 5, 8]);
  expect(plan.make).toBe(true);
  expect(plan.key).toBe(2);
  expect(plan.room).toBeGreaterThan(5);
  expect(downed(plan).sort((a, b) => a - b)).toEqual([2, 4, 5, 8]);
});

test("baby splits slide the front pin into the corner", () => {
  const threeTen = spareLine([3, 10]);
  expect(threeTen.make).toBe(true);
  expect(threeTen.key).toBe(3);
  expect(threeTen.hit).toMatch(/left/); // catch the 3's left side, it goes right
  expect(threeTen.hits.find((h) => h.pin === 10).by).toBe(3);

  const twoSeven = spareLine([2, 7]);
  expect(twoSeven.make).toBe(true);
  expect(twoSeven.hit).toMatch(/right/);
  expect(twoSeven.hits.find((h) => h.pin === 7).by).toBe(2);
});

test("the 5-10 is a thin hit on the 5's left side, and tight", () => {
  const plan = spareLine([5, 10]);
  expect(plan.make).toBe(true);
  expect(plan.key).toBe(5);
  expect(plan.hit).toBe("thin-left");
  expect(plan.room).toBeLessThan(2);
});

test("the big splits say pick one off", () => {
  [[7, 10], [4, 6], [4, 6, 7, 10]].forEach((leave) => {
    const plan = spareLine(leave);
    expect(plan.make).toBe(false);
    expect(plan.take.length).toBeLessThan(leave.length);
    expect(plan.room).toBeGreaterThanOrEqual(2);
  });
  // 6-7-10: take the two that go together.
  expect(spareLine([6, 7, 10]).take).toEqual([6, 10]);
});

test("every leave gets a line that knocks down what it goes for, from on the lane", () => {
  LEAVES.forEach((leave) => {
    const plan = spareLine(leave);
    expect(plan).not.toBeNull();
    const down = downed(plan);
    plan.take.forEach((pin) => expect(down).toContain(pin));
    if (plan.make) expect(plan.take).toEqual(leave);
    expect(plan.laydown).toBeGreaterThanOrEqual(5);
    expect(plan.laydown).toBeLessThanOrEqual(35);
    expect(plan.leave).toContain(plan.key);
  });
});

test("a leave and its mirror image get mirror-image lines", () => {
  LEAVES.filter((leave) => leave.length <= 4).forEach((leave) => {
    const plan = spareLine(leave);
    const other = spareLine(mirror(leave));
    expect(other.make).toBe(plan.make);
    if (!plan.make) return; // a pick-off can break a tie either way
    expect(other.laydown).toBeCloseTo(40 - plan.laydown, 0);
    expect(other.target).toBeCloseTo(40 - plan.target, 0);
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
