import { CHAOS_CHANCE, dealRound, maxImposters, pickWord, wordKey } from "./deal";

/* Small seeded PRNG so every run deals the same hands. */
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const fruit = {
  id: "fruit",
  name: "Fruit",
  icon: "fa-solid fa-apple-whole",
  words: [
    ["Apple", "Orchard", "Teacher", "Pie"],
    ["Banana", "Monkey", "Peel", "Yellow"],
    ["Cherry", "Stem", "Sundae", "Pit"],
    ["Mango", "Tropical", "Juicy", "Smoothie"],
  ],
};
const tools = {
  id: "tools",
  name: "Tools",
  icon: "fa-solid fa-wrench",
  words: [
    ["Hammer", "Nail", "Swing", "Garage"],
    ["Saw", "Wood", "Teeth", "Sawdust"],
  ],
};

const roster = (n) => Array.from({ length: n }, (_, i) => `Agent ${i + 1}`);

test("imposters stay a minority", () => {
  expect([3, 4, 5, 6, 7, 12].map(maxImposters)).toEqual([1, 1, 2, 2, 3, 3]);
});

test("deals the requested imposters, clamped to the roster", () => {
  const rng = seeded(1);
  for (const [n, asked, want] of [[3, 1, 1], [3, 3, 1], [5, 2, 2], [8, 3, 3], [6, 3, 2]]) {
    const { round } = dealRound({ roster: roster(n), cats: [fruit], imposterCount: asked, chaos: false }, rng);
    expect(round.imposters).toHaveLength(want);
    expect(new Set(round.imposters).size).toBe(want);
    round.imposters.forEach((seat) => expect(seat).toBeLessThan(n));
  }
});

test("every imposter's hint belongs to the secret word, and they differ", () => {
  const rng = seeded(7);
  for (let i = 0; i < 50; i++) {
    const { round } = dealRound({ roster: roster(9), cats: [fruit, tools], imposterCount: 3, chaos: false }, rng);
    const cat = [fruit, tools].find((c) => c.id === round.category.id);
    const [, ...hints] = cat.words.find(([w]) => w === round.word);
    const given = round.imposters.map((seat) => round.hintFor[seat]);
    given.forEach((h) => expect(hints).toContain(h));
    expect(new Set(given).size).toBe(given.length);
  }
});

test("chaos off never makes everyone the imposter", () => {
  const { round } = dealRound({ roster: roster(4), cats: [fruit], chaos: false }, () => 0);
  expect(round.allImposter).toBe(false);
  expect(round.imposters).toHaveLength(1);
});

test("a chaos round seats everyone, each with a hint for the same word", () => {
  let first = true;
  const rng = () => {
    if (first) {
      first = false;
      return CHAOS_CHANCE / 2;
    }
    return 0.42;
  };
  const { round } = dealRound({ roster: roster(5), cats: [fruit], chaos: true }, rng);
  expect(round.allImposter).toBe(true);
  expect(round.imposters).toEqual([0, 1, 2, 3, 4]);
  const [, ...hints] = fruit.words.find(([w]) => w === round.word);
  Object.values(round.hintFor).forEach((h) => expect(hints).toContain(h));
});

test("no word repeats until the selected deck runs out, then the rotation restarts", () => {
  const rng = seeded(3);
  let recent = [wordKey("tools", "Hammer")]; // another deck's history survives the reset
  const dealt = [];
  for (let i = 0; i < fruit.words.length; i++) {
    const out = dealRound({ roster: roster(3), cats: [fruit], chaos: false, recent }, rng);
    dealt.push(out.round.word);
    recent = out.recent;
  }
  expect(new Set(dealt).size).toBe(fruit.words.length);

  const again = dealRound({ roster: roster(3), cats: [fruit], chaos: false, recent }, rng);
  expect(again.recent.filter((k) => k.startsWith("fruit:"))).toEqual([wordKey("fruit", again.round.word)]);
  expect(again.recent).toContain(wordKey("tools", "Hammer"));
});

test("pickWord skips played words", () => {
  const recent = fruit.words.slice(1).map(([w]) => wordKey("fruit", w));
  const { word, hints, exhausted } = pickWord([fruit], recent, Math.random);
  expect(word).toBe("Apple");
  expect(hints).toEqual(["Orchard", "Teacher", "Pie"]);
  expect(exhausted).toBe(false);
});

test("a word played in one category doesn't come back through another", () => {
  const snacks = { ...fruit, id: "snacks", name: "Snacks" };
  const recent = [wordKey("fruit", "Apple"), wordKey("fruit", "Banana"), wordKey("fruit", "Cherry")];
  const { word } = pickWord([snacks], recent, Math.random);
  expect(word).toBe("Mango");
});

test("the opener rotates and the speaking order covers everyone from them", () => {
  const rng = seeded(11);
  const names = roster(4);
  let last = null;
  for (let i = 0; i < 30; i++) {
    const { round } = dealRound({ roster: names, cats: [fruit], chaos: false, lastStarter: last }, rng);
    expect(names[round.starter]).not.toBe(last);
    expect(round.order[0]).toBe(round.starter);
    expect([...round.order].sort()).toEqual([0, 1, 2, 3]);
    last = names[round.starter];
  }
});
