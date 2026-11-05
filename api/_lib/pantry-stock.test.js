const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./pantry-stock");

const item = (over = {}) => ({
  id: 1,
  name: "Milk 2%",
  location: "fridge",
  qty: 2,
  lowAt: 0.25,
  staple: null,
  shelfDays: null,
  lastBoughtOn: null,
  countedOn: null,
  snoozeUntil: null,
  archived: false,
  purchases: [],
  ...over,
});

test("todayIn is the household's day, not UTC's", () => {
  // 02:30 UTC on 5 Nov is still the evening of 4 Nov in Toronto.
  assert.equal(S.todayIn("America/Toronto", new Date("2026-11-05T02:30:00Z")), "2026-11-04");
  assert.equal(S.addDays("2026-02-27", 2), "2026-03-01");
  assert.equal(S.daysBetween("2026-12-30", "2027-01-02"), 3);
});

test("cadence is the median gap and needs three purchase days", () => {
  assert.equal(S.cadenceDays(["2026-10-01", "2026-10-07"]), null);
  assert.equal(S.cadenceDays(["2026-10-01", "2026-10-07", "2026-10-14"]), 7); // median of 6, 7 rounds up
  // Two receipts the same day count once.
  assert.equal(S.cadenceDays(["2026-10-01", "2026-10-01", "2026-10-07"]), null);
  // One long gap (a holiday) doesn't move the median.
  assert.equal(S.cadenceDays(["2026-09-01", "2026-09-06", "2026-09-11", "2026-10-11", "2026-10-16"]), 5);
});

test("out, low and ok come from the count", () => {
  const today = "2026-11-04";
  assert.equal(S.statusOf(item({ qty: 0 }), today).state, "out");
  assert.equal(S.statusOf(item({ qty: 0.25 }), today).state, "low");
  assert.equal(S.statusOf(item({ qty: 3, lowAt: 3 }), today).state, "low");
  assert.equal(S.statusOf(item({ qty: 1 }), today).state, "ok");
});

test("due: the usual gap has passed and nobody has counted since", () => {
  const bought = { purchases: ["2026-10-14", "2026-10-21", "2026-10-28"], lastBoughtOn: "2026-10-28" };
  assert.equal(S.statusOf(item({ ...bought, qty: 1 }), "2026-11-03").state, "ok");
  const due = S.statusOf(item({ ...bought, qty: 1 }), "2026-11-04");
  assert.equal(due.state, "due");
  assert.equal(due.dueOn, "2026-11-04");
  assert.equal(due.onList, true);
  // Someone checked it on the due day: their count wins over the guess.
  assert.equal(S.statusOf(item({ ...bought, qty: 1, countedOn: "2026-11-04" }), "2026-11-06").state, "ok");
  // A count from before the due day doesn't.
  assert.equal(S.statusOf(item({ ...bought, qty: 1, countedOn: "2026-11-01" }), "2026-11-06").state, "due");
});

test("use soon counts from the purchase day and only while there's some left", () => {
  const spinach = item({ name: "Spinach", qty: 1, shelfDays: 5, lastBoughtOn: "2026-11-01" });
  assert.equal(S.statusOf(spinach, "2026-11-03").useSoon, false);
  const soon = S.statusOf(spinach, "2026-11-04");
  assert.equal(soon.useSoon, true);
  assert.equal(soon.useBy, "2026-11-06");
  const past = S.statusOf(spinach, "2026-11-07");
  assert.equal(past.expired, true);
  assert.equal(past.useSoon, true, "a day past: check it");
  assert.equal(past.stale, false);
  // Weeks past: it was eaten and nobody logged it. Stop nagging, ask instead.
  const gone = S.statusOf(spinach, "2026-11-25");
  assert.equal(gone.useSoon, false);
  assert.equal(gone.stale, true);
  assert.equal(S.statusOf({ ...spinach, qty: 0 }, "2026-11-04").useSoon, false);
});

test("the sentence asks to check things just past their shelf life", () => {
  const today = "2026-11-04";
  const items = S.withStatus(
    [
      item({ id: 1, name: "Spinach", qty: 1, shelfDays: 5, lastBoughtOn: "2026-11-01" }),
      item({ id: 2, name: "Bananas", qty: 1, shelfDays: 5, lastBoughtOn: "2026-10-29" }),
      item({ id: 3, name: "Sourdough bread", qty: 1, shelfDays: 5, lastBoughtOn: "2026-10-14" }),
    ],
    today
  );
  assert.equal(S.kitchenSummary(items, [], today).say, "Use the spinach soon. Check the bananas, it may have turned.");
});

test("snoozed and archived items stay off the list", () => {
  const today = "2026-11-04";
  assert.equal(S.statusOf(item({ qty: 0, snoozeUntil: "2026-11-10" }), today).onList, false);
  assert.equal(S.statusOf(item({ qty: 0, snoozeUntil: "2026-11-04" }), today).onList, true);
  assert.equal(S.statusOf(item({ qty: 0, archived: true }), today).onList, false);
});

test("bought twice makes a staple unless the household says otherwise", () => {
  assert.equal(S.isStaple(item({ purchases: ["2026-10-01"] })), false);
  assert.equal(S.isStaple(item({ purchases: ["2026-10-01", "2026-10-08"] })), true);
  assert.equal(S.isStaple(item({ purchases: ["2026-10-01", "2026-10-08"], staple: false })), false);
  assert.equal(S.isStaple(item({ staple: true })), true);
});

test("the kitchen sentence reads naturally", () => {
  assert.equal(S.joinNames(["a"]), "a");
  assert.equal(S.joinNames(["a", "b"]), "a and b");
  assert.equal(S.joinNames(["a", "b", "c"]), "a, b and c");
  assert.equal(S.joinNames(["a", "b", "c", "d"], 2), "a, b and 2 more");
  assert.equal(S.spoken("Milk 2%"), "milk 2%");
  assert.equal(S.spoken("PC chips"), "PC chips");

  const today = "2026-11-04";
  const items = S.withStatus(
    [
      item({ id: 1, name: "Milk 2%", qty: 0 }),
      item({ id: 2, name: "Eggs", qty: 0 }),
      item({ id: 3, name: "Bread", qty: 0.25 }),
      item({ id: 4, name: "Spinach", qty: 1, shelfDays: 5, lastBoughtOn: "2026-11-01" }),
      item({ id: 5, name: "Rice", qty: 4 }),
    ],
    today
  );
  const k = S.kitchenSummary(items, [{ id: 9, name: "Birthday candles" }], today);
  assert.equal(
    k.say,
    "You're out of eggs and milk 2%. Running low on bread. Also on the list: birthday candles. Use the spinach soon."
  );
  assert.deepEqual(k.out.map((i) => i.name), ["Eggs", "Milk 2%"]);
  assert.equal(S.kitchenSummary([], [], today).say, "The pantry's in good shape. Nothing's running low.");
});

test("a busy day still fits the speaker's 200 characters, most urgent first", () => {
  const today = "2026-11-04";
  const named = (prefix, n, over) =>
    Array.from({ length: n }, (_, k) => item({ id: `${prefix}${k}`, name: `${prefix} item number ${k + 1}`, ...over }));
  const items = S.withStatus(
    [
      ...named("Out", 8, { qty: 0 }),
      ...named("Low", 8, { qty: 0.25 }),
      ...named("Fresh", 4, { qty: 1, shelfDays: 5, lastBoughtOn: "2026-11-01" }),
    ],
    today
  );
  const extras = Array.from({ length: 6 }, (_, k) => ({ id: k, name: `Extra thing ${k + 1}` }));
  const { say } = S.kitchenSummary(items, extras, today);
  assert.ok(say.length <= 200, `${say.length} characters`);
  assert.match(say, /^You're out of out item number 1 and 7 more\. Running low on low item number 1 and 7 more\./);

  // Even one name each is too long here, so the least urgent sentences go.
  const long = "Extra-virgin cold-pressed Tuscan olive oil, the big tin";
  const crowded = S.withStatus(
    [item({ id: 1, name: long, qty: 0 }), item({ id: 2, name: `${long} too`, qty: 0.25 })],
    today
  );
  const tight = S.kitchenSummary(crowded, [{ id: 1, name: long }, { id: 2, name: "x" }], today).say;
  assert.ok(tight.length <= 200, `${tight.length} characters`);
  assert.match(tight, /^You're out of extra-virgin.*Running low on extra-virgin/);
  assert.doesNotMatch(tight, /Also on the list/);
});

test("the digest only speaks up about what's new", () => {
  const today = "2026-11-04";
  const items = S.withStatus([item({ id: 1, name: "Milk 2%", qty: 0 }), item({ id: 2, name: "Eggs", qty: 0.25 })], today);
  const first = S.digestFor(items, [], today, []);
  assert.equal(first.payload.title, "Pantry · 2 on the list");
  assert.equal(first.payload.body, "Out: Milk 2% · Low: Eggs");
  assert.equal(first.payload.url, "/pantry?tab=list");

  // Same state tomorrow: nothing to say.
  const again = S.digestFor(items, [], "2026-11-05", first.keys);
  assert.equal(again.payload, null);

  // Eggs run out: that's new, milk isn't.
  const later = S.withStatus([item({ id: 1, name: "Milk 2%", qty: 0 }), item({ id: 2, name: "Eggs", qty: 0 })], today);
  assert.equal(S.digestFor(later, [], today, first.keys).payload.body, "Out: Eggs");
});
