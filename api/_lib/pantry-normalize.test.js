const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("./pantry-normalize");

const photo = (size = 200) => ({ mediaType: "image/jpeg", image: "A".repeat(size) });

test("names fold case, accents and punctuation for matching", () => {
  assert.equal(N.nameKey("  Crème  Fraîche "), "creme fraiche");
  assert.equal(N.nameKey("Milk 2%"), "milk 2%");
  assert.equal(N.nameKey("Black beans (canned)"), "black beans canned");
  assert.equal(N.aliasKey("NN 2% MLK 4L   "), "NN 2% MLK 4L");
  assert.equal(N.aliasKey("pc blk-beans, 540ml"), "PC BLK BEANS 540ML");
});

test("quantities are packs in quarter steps", () => {
  assert.equal(N.cleanQty(1.3), 1.25);
  assert.equal(N.cleanQty("2"), 2);
  assert.equal(N.cleanQty(-1), null);
  assert.equal(N.cleanQty(1000), null);
  assert.equal(N.cleanQty("lots", { fallback: 1 }), 1);
});

test("receipt photos: up to four, real base64, under the body limit", () => {
  assert.equal(N.validateImages({}).ok, false);
  assert.equal(N.validateImages({ images: [photo()] }).ok, true);
  assert.equal(N.validateImages({ images: [photo(), photo(), photo(), photo(), photo()] }).ok, false);
  assert.equal(N.validateImages({ images: [{ mediaType: "image/gif", image: "A".repeat(200) }] }).ok, false);
  assert.equal(N.validateImages({ images: [{ mediaType: "image/jpeg", image: "not base64!" }] }).ok, false);
  const big = photo(1.5 * 1024 * 1024);
  assert.equal(N.validateImages({ images: [big, big, big] }).ok, false);
});

test("Claude's read is cleaned before anyone sees it", () => {
  const items = [{ id: 7, name: "Milk 2%" }];
  const read = N.sanitizeRead(
    {
      store: "  No Frills ",
      purchasedOn: "2026-11-03",
      totalCents: 4512,
      lines: [
        { raw: "NN 2% MLK 4L", name: "milk 2%", matchId: 7, category: "dairy", location: "fridge", qty: 1, size: "4 L", priceCents: 649, shelfDays: 10, keep: true },
        { raw: "BAG FEE", name: "Bag", matchId: 99, category: "nonsense", location: "attic", qty: "x", size: null, priceCents: 10, shelfDays: null, keep: false },
        { raw: "", name: "", matchId: null },
        "junk",
      ],
    },
    items,
    "2026-11-04"
  );
  assert.equal(read.store, "No Frills");
  assert.equal(read.lines.length, 2);
  assert.equal(read.lines[0].name, "Milk 2%");
  assert.equal(read.lines[0].matchId, 7);
  const bag = read.lines[1];
  assert.equal(bag.matchId, null, "an id that doesn't exist is dropped");
  assert.equal(bag.category, "other");
  assert.equal(bag.location, "pantry");
  assert.equal(bag.qty, 1);
  assert.equal(bag.keep, false);
  // A date in the future isn't trusted.
  assert.equal(N.sanitizeRead({ purchasedOn: "2026-12-25", lines: [] }, [], "2026-11-04").purchasedOn, null);
  // "11/03/26" read day-first is March 11; the receipt was November 3.
  const dayOf = (purchasedOn) => N.sanitizeRead({ purchasedOn, lines: [] }, [], "2026-11-05").purchasedOn;
  assert.equal(dayOf("2026-03-11"), "2026-11-03");
  assert.equal(dayOf("2026-11-03"), "2026-11-03", "the right reading stays");
  assert.equal(dayOf("2026-12-04"), "2026-04-12", "a future reading swaps when the other isn't");
  assert.equal(dayOf("2026-10-25"), "2026-10-25", "a day past 12 can't be a month");
  assert.equal(dayOf("2026-06-06"), "2026-06-06");
  assert.deepEqual(N.sanitizeRead(null, [], "2026-11-04").lines, []);
});

test("a reviewed receipt needs a real day and at least one line", () => {
  const line = { name: "Bananas", qty: 1, category: "produce", location: "counter" };
  assert.equal(N.validateReceipt({ purchasedOn: "2026-11-03", lines: [line] }, "2026-11-04").ok, true);
  assert.equal(N.validateReceipt({ purchasedOn: "2026-02-30", lines: [line] }, "2026-11-04").ok, false);
  assert.equal(N.validateReceipt({ purchasedOn: "2026-11-05", lines: [line] }, "2026-11-04").ok, false);
  assert.equal(N.validateReceipt({ purchasedOn: "2026-11-03", lines: [] }, "2026-11-04").ok, false);
  assert.equal(N.validateReceipt({ purchasedOn: "2026-11-03", lines: [{ qty: 1 }] }, "2026-11-04").ok, false);
  assert.equal(N.validateReceipt({ purchasedOn: "2026-11-03", lines: [{ ...line, qty: 0 }] }, "2026-11-04").ok, false);
});

test("planReceipt restocks known items, folds duplicates and learns aliases", () => {
  const items = [
    { id: 1, name: "Milk 2%" },
    { id: 2, name: "Bananas" },
  ];
  const { value } = N.validateReceipt(
    {
      purchasedOn: "2026-11-03",
      lines: [
        { raw: "NN 2% MLK 4L", itemId: 1, name: "Milk 2%", qty: 1, priceCents: 649 },
        { raw: "BANANAS", itemId: null, name: "bananas", qty: 1, priceCents: 150 },
        { raw: "AVOCADO", itemId: null, name: "Avocados", qty: 2, priceCents: 300, shelfDays: 4, location: "counter" },
        { raw: "AVOCADO BAG", itemId: null, name: "avocados", qty: 1, priceCents: 400 },
        { raw: "GHOST", itemId: 404, name: "Ghost pepper", qty: 1 },
      ],
    },
    "2026-11-04"
  );
  const plan = N.planReceipt(value.lines, items);
  assert.deepEqual(
    plan.existing.map((e) => [e.item_id, e.qty, e.price_cents]),
    [
      [1, 1, 649],
      [2, 1, 150], // typed "bananas" lands on the existing Bananas
    ]
  );
  assert.deepEqual(
    plan.fresh.map((f) => [f.name, f.qty, f.price_cents, f.shelf_days, f.location]),
    [
      ["Avocados", 3, 700, 4, "counter"],
      ["Ghost pepper", 1, null, null, "pantry"], // a stale id becomes a new item by name
    ]
  );
  assert.deepEqual(plan.aliases.find((a) => a.raw_key === "NN 2% MLK 4L"), { raw_key: "NN 2% MLK 4L", name_key: "milk 2%" });
  assert.deepEqual(plan.keys.sort(), ["avocados", "bananas", "ghost pepper", "milk 2%"]);
});

test("the same store, day and total is the same receipt", () => {
  const a = N.receiptFingerprint({ store: "No Frills", purchasedOn: "2026-11-03", totalCents: 4512 });
  const b = N.receiptFingerprint({ store: "NO FRILLS ", purchasedOn: "2026-11-03", totalCents: 4512 });
  assert.equal(a, b);
  assert.equal(N.receiptFingerprint({ store: "x", purchasedOn: "2026-11-03", totalCents: null }), null);
});

test("quick changes and item edits", () => {
  assert.deepEqual(N.validateAdjust({ id: 3, op: "use" }).value, { id: 3, op: "use", n: 1, kind: "used" });
  assert.deepEqual(N.validateAdjust({ id: 3, op: "add" }).value.kind, "bought");
  assert.equal(N.validateAdjust({ id: 3, op: "set", qty: 2.6 }).value.n, 2.5);
  assert.equal(N.validateAdjust({ id: 3, op: "set" }).ok, false);
  assert.equal(N.validateAdjust({ id: 3, op: "explode" }).ok, false);
  assert.equal(N.validateAdjust({ id: 0, op: "out" }).ok, false);

  const ok = N.validateItem({ item: { name: "oat milk", location: "fridge", shelfDays: "10", staple: true } });
  assert.equal(ok.value.name, "Oat milk");
  assert.equal(ok.value.shelfDays, 10);
  assert.equal(ok.value.lowAt, 0.25);
  assert.equal(ok.value.staple, true);
  assert.equal(N.validateItem({ item: { name: "x", staple: "maybe" } }).value.staple, null);
  assert.equal(N.validateItem({ item: { name: "!!!" } }).ok, false);
  assert.equal(N.validateItem({ item: { name: "Rice", shelfDays: 0 } }).ok, false);
});

test("after cooking only low and out are written", () => {
  const { value } = N.validateCooked({
    uses: [
      { id: 1, op: "out" },
      { id: 2, op: "plenty" },
      { id: 1, op: "low" },
      { id: 3, op: "low" },
    ],
  });
  assert.deepEqual(value.map((u) => [u.id, u.op, u.kind]), [
    [1, "out", "cooked"],
    [3, "low", "cooked"],
  ]);
});

test("recipes may only use items that exist", () => {
  const recipes = N.sanitizeRecipes(
    {
      recipes: [
        {
          title: "Spinach frittata",
          blurb: "Uses the spinach before it turns.",
          minutes: 25,
          servings: 2,
          uses: [{ itemId: 4, amount: "1 bag" }, { itemId: 99, amount: "x" }, { itemId: 4, amount: "dup" }],
          missing: ["feta", ""],
          steps: ["Whisk the eggs.", "Bake."],
          tags: ["vegetarian"],
        },
        { title: "No steps", steps: [] },
      ],
    },
    [{ id: 4, name: "Spinach" }]
  );
  assert.equal(recipes.length, 1);
  assert.deepEqual(recipes[0].uses, [{ itemId: 4, amount: "1 bag" }]);
  assert.deepEqual(recipes[0].missing, ["Feta"]);
});
