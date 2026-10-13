import { INTERVALS, addDays, addLessonToDeck, dueItems, empty, gradeItem, mergeState, nextDue, normalize, whenLabel } from "./store";
import SAMPLE from "./lessons/salamis.json";

const TODAY = "2026-10-21"; // a Wednesday

test("a right answer moves a card along the 1-3-7-21-60 ladder, a wrong one sends it back", () => {
  let item = gradeItem(null, true, TODAY);
  expect(item.box).toBe(1);
  expect(item.due).toBe(addDays(TODAY, 3));
  item = gradeItem(item, true, item.due);
  expect(item.box).toBe(2);
  expect(item.due).toBe(addDays("2026-10-24", 7));
  item = gradeItem(item, false, item.due);
  expect(item.box).toBe(0);
  expect(item.due).toBe(addDays("2026-10-31", 1));
  expect(item.lapses).toBe(1);
  expect(item.reps).toBe(3);
});

test("a missed first answer comes back tomorrow", () => {
  const item = gradeItem(null, false, TODAY);
  expect(item.box).toBe(0);
  expect(item.due).toBe("2026-10-22");
});

test("past the last box a card is mastered and never due", () => {
  let item = null;
  let day = TODAY;
  for (let i = 0; i <= INTERVALS.length; i++) {
    item = gradeItem(item, true, day);
    day = item.due || day;
  }
  expect(item.mastered).toBe(true);
  expect(item.due).toBe(null);
  expect(dueItems({ a: item }, "2030-01-01")).toEqual([]);
});

test("the lesson's current wording replaces an old snapshot when graded", () => {
  const old = { id: "x", q: "Old?", a: "Old.", box: 1, reps: 1, lapses: 0, due: TODAY };
  const g = gradeItem(old, true, TODAY, { q: "New?", a: "New." });
  expect(g.q).toBe("New?");
});

test("dueItems: due on or before today, oldest first, flagged and removed sit out", () => {
  const deck = {
    a: { id: "a", due: "2026-10-20", box: 1 },
    b: { id: "b", due: "2026-10-18", box: 0 },
    c: { id: "c", due: "2026-10-25", box: 2 },
    d: { id: "d", due: "2026-10-19", box: 1, held: true },
    e: { id: "e", due: "2026-10-19", box: 1, removed: true },
  };
  expect(dueItems(deck, TODAY).map((i) => i.id)).toEqual(["b", "a"]);
  expect(nextDue(deck, TODAY)).toBe("2026-10-25");
});

test("finishing a lesson adds its ungraded questions for tomorrow, keeping graded ones", () => {
  const graded = gradeItem(null, true, TODAY, { id: "salamis-r1" });
  const deck = addLessonToDeck({ "salamis-r1": graded }, SAMPLE, TODAY);
  expect(Object.keys(deck).sort()).toEqual(["salamis-r1", "salamis-r2", "salamis-r3", "salamis-r4", "salamis-r5"]);
  expect(deck["salamis-r1"].box).toBe(1);
  expect(deck["salamis-r2"].due).toBe("2026-10-22");
  expect(deck["salamis-r2"].q).toMatch(/message to Xerxes/);
});

test("merging two devices keeps the newest change of each thing", () => {
  const phone = {
    ...empty(),
    progress: { salamis: { at: 20, max: 26, total: 28, done: true, finishedAt: "2026-10-21", t: 200 } },
    deck: { q1: { id: "q1", box: 2, at: 300 }, q2: { id: "q2", box: 0, at: 100 } },
    saved: { "salamis:3": { key: "salamis:3", removed: true, at: 500 } },
    votes: { salamis: { side: 0, at: 100 } },
    updatedAt: 500,
  };
  const laptop = {
    ...empty(),
    progress: { salamis: { at: 4, max: 4, total: 28, done: false, t: 100 }, delphi: { at: 2, max: 2, total: 27, t: 50 } },
    deck: { q1: { id: "q1", box: 1, at: 200 }, q2: { id: "q2", box: 1, at: 400 } },
    saved: { "salamis:3": { key: "salamis:3", text: "x", at: 400 }, "delphi:1": { key: "delphi:1", text: "y", at: 10 } },
    votes: { salamis: { side: 1, at: 200 } },
    updatedAt: 400,
  };
  const m = mergeState(phone, laptop);
  expect(m.progress.salamis).toMatchObject({ at: 20, max: 26, done: true, finishedAt: "2026-10-21" });
  expect(m.progress.delphi.at).toBe(2);
  expect(m.deck.q1.box).toBe(2);
  expect(m.deck.q2.box).toBe(1);
  expect(m.saved["salamis:3"].removed).toBe(true);
  expect(m.saved["delphi:1"].text).toBe("y");
  expect(m.votes.salamis.side).toBe(1);
  // Merging is symmetric for everything that has a timestamp.
  const back = mergeState(laptop, phone);
  expect(back.deck).toEqual(m.deck);
  expect(back.saved).toEqual(m.saved);
});

test("normalize survives garbage from storage", () => {
  expect(normalize(null)).toEqual(empty());
  expect(normalize({ deck: [], progress: "x", prefs: { size: "l" } }).prefs.size).toBe("l");
  expect(normalize({ deck: [] }).deck).toEqual({});
});

test("whenLabel speaks like a person", () => {
  expect(whenLabel("2026-10-21", TODAY)).toBe("today");
  expect(whenLabel("2026-10-22", TODAY)).toBe("tomorrow");
  expect(whenLabel("2026-10-24", TODAY)).toBe("Saturday");
  expect(whenLabel("2026-11-11", TODAY)).toMatch(/Nov/);
});
