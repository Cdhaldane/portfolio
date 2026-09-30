import { PACKS, SECRET_PACK } from "./top5.data";
import {
  PHASE,
  initDeck,
  deckReducer,
  isTableOpen,
  isRitual,
  visibleOrder,
} from "./deckReducer";

const TODAY = "2026-09-30";

/** Deep-freeze so any in-place mutation inside the reducer throws. */
const freeze = (obj) => {
  Object.values(obj).forEach((v) => {
    if (v && typeof v === "object") freeze(v);
  });
  return Object.freeze(obj);
};

const run = (state, ...actions) =>
  actions.reduce((s, a) => deckReducer(freeze(s), a), state);

const allOpened = () =>
  Object.fromEntries(PACKS.map((p) => [p.id, { pulledAt: TODAY }]));

/** Walk a fresh pack through the whole ritual. */
const ritual = (packId, start = initDeck()) =>
  run(
    start,
    { type: "pick", packId },
    { type: "rip" },
    { type: "ripped" },
    { type: "landed", index: 0 },
    { type: "landed", index: 1 },
    { type: "landed", index: 2 },
    { type: "landed", index: 3 },
    { type: "reveal", today: TODAY },
    { type: "revealed" }
  );

describe("initial state", () => {
  test("starts on the shelf with nothing open", () => {
    const s = initDeck();
    expect(s.phase).toBe(PHASE.SHELF);
    expect(s.packId).toBeNull();
    expect(s.opened).toEqual({});
    expect(isTableOpen(s)).toBe(false);
  });

  test("hydrates opened packs and the bonus flag", () => {
    const s = initDeck({ opened: { food: { pulledAt: TODAY } }, bonus: true });
    expect(s.opened.food.pulledAt).toBe(TODAY);
    expect(s.bonus).toBe(true);
  });
});

describe("the ritual", () => {
  test("picking a sealed pack puts it on the table", () => {
    const s = run(initDeck(), { type: "pick", packId: "movies" });
    expect(s.phase).toBe(PHASE.SEALED);
    expect(s.packId).toBe("movies");
    expect(s.entry).toBe("ritual");
    expect(s.dealt).toBe(0);
    expect(s.revealed).toBe(false);
    expect(isTableOpen(s)).toBe(true);
  });

  test("rip -> ripped -> four landings reaches the legend beat", () => {
    let s = run(initDeck(), { type: "pick", packId: "movies" }, { type: "rip" });
    expect(s.phase).toBe(PHASE.RIPPING);
    s = run(s, { type: "ripped" });
    expect(s.phase).toBe(PHASE.DEALING);
    s = run(s, { type: "landed", index: 0 }, { type: "landed", index: 1 });
    expect(s.dealt).toBe(2);
    expect(s.phase).toBe(PHASE.DEALING);
    s = run(s, { type: "landed", index: 2 }, { type: "landed", index: 3 });
    expect(s.dealt).toBe(4);
    expect(s.phase).toBe(PHASE.LEGEND);
  });

  test("landings are idempotent and out-of-range indices are ignored", () => {
    const dealing = run(
      initDeck(),
      { type: "pick", packId: "movies" },
      { type: "rip" },
      { type: "ripped" }
    );
    const s = run(dealing, { type: "landed", index: 1 }, { type: "landed", index: 1 });
    expect(s.dealt).toBe(2);
    expect(run(dealing, { type: "landed", index: 4 })).toBe(dealing);
    expect(run(dealing, { type: "landed", index: -1 })).toBe(dealing);
  });

  test("revealing marks the pack opened, then settles into the hand", () => {
    const s = ritual("movies");
    expect(s.phase).toBe(PHASE.HAND);
    expect(s.revealed).toBe(true);
    expect(s.dealt).toBe(5);
    expect(s.opened.movies).toEqual({ pulledAt: TODAY });
  });

  test("the reveal beat already counts as opened", () => {
    const legend = run(
      initDeck(),
      { type: "pick", packId: "food" },
      { type: "rip" },
      { type: "ripped" },
      ...[0, 1, 2, 3].map((index) => ({ type: "landed", index }))
    );
    const s = run(legend, { type: "reveal", today: TODAY });
    expect(s.phase).toBe(PHASE.REVEAL);
    expect(s.opened.food).toEqual({ pulledAt: TODAY });
    expect(isRitual(s)).toBe(true);
  });

  test("actions from the wrong phase are no-ops", () => {
    const shelf = initDeck();
    expect(run(shelf, { type: "rip" })).toBe(shelf);
    expect(run(shelf, { type: "reveal", today: TODAY })).toBe(shelf);
    const sealed = run(shelf, { type: "pick", packId: "movies" });
    expect(run(sealed, { type: "ripped" })).toBe(sealed);
    expect(run(sealed, { type: "inspect", index: 2 })).toBe(sealed);
    expect(run(sealed, { type: "pick", packId: "food" })).toBe(sealed);
  });

  test("unknown packs and unknown actions are ignored", () => {
    const shelf = initDeck();
    expect(run(shelf, { type: "pick", packId: "nope" })).toBe(shelf);
    expect(run(shelf, { type: "bogus" })).toBe(shelf);
  });

  test("the bonus pack cannot be picked until it is earned", () => {
    const shelf = initDeck();
    expect(run(shelf, { type: "pick", packId: SECRET_PACK.id })).toBe(shelf);
    const earned = initDeck({ bonus: true });
    expect(run(earned, { type: "pick", packId: SECRET_PACK.id }).packId).toBe(SECRET_PACK.id);
  });
});

describe("finish and skip", () => {
  test.each([PHASE.SEALED, PHASE.RIPPING, PHASE.DEALING, PHASE.LEGEND, PHASE.REVEAL])(
    "finish from %s lands in a complete hand",
    (phase) => {
      const steps = {
        [PHASE.SEALED]: [],
        [PHASE.RIPPING]: [{ type: "rip" }],
        [PHASE.DEALING]: [{ type: "rip" }, { type: "ripped" }],
        [PHASE.LEGEND]: [
          { type: "rip" },
          { type: "ripped" },
          ...[0, 1, 2, 3].map((index) => ({ type: "landed", index })),
        ],
        [PHASE.REVEAL]: [
          { type: "rip" },
          { type: "ripped" },
          ...[0, 1, 2, 3].map((index) => ({ type: "landed", index })),
          { type: "reveal", today: TODAY },
        ],
      };
      const before = run(initDeck(), { type: "pick", packId: "games" }, ...steps[phase]);
      expect(before.phase).toBe(phase);
      const s = run(before, { type: "finish", today: TODAY });
      expect(s.phase).toBe(PHASE.HAND);
      expect(s.dealt).toBe(5);
      expect(s.revealed).toBe(true);
      expect(s.skipped).toBe(phase !== PHASE.SEALED);
      expect(s.opened.games).toEqual({ pulledAt: TODAY });
    }
  );

  test("a resealed pack is re-stamped on its next pull", () => {
    const s = run(
      initDeck({ opened: { games: { pulledAt: "2026-01-01" } } }),
      { type: "pick", packId: "games" },
      { type: "reseal" }
    );
    expect(s.opened.games).toBeUndefined();
    const again = run(s, { type: "finish", today: TODAY });
    expect(again.opened.games).toEqual({ pulledAt: TODAY });
  });
});

describe("the hand and inspect", () => {
  test("inspect, step with wraparound, and close", () => {
    let s = run(ritual("movies"), { type: "inspect", index: 4 });
    expect(s.phase).toBe(PHASE.INSPECT);
    expect(s.inspected).toBe(4);
    s = run(s, { type: "step", delta: 1 });
    expect(s.inspected).toBe(0);
    s = run(s, { type: "step", delta: -1 });
    expect(s.inspected).toBe(4);
    s = run(s, { type: "inspect", index: 2 });
    expect(s.inspected).toBe(2);
    s = run(s, { type: "close" });
    expect(s.phase).toBe(PHASE.HAND);
    expect(s.inspected).toBeNull();
    expect(s.lastInspected).toBe(2);
  });

  test("inspect rejects bad indices", () => {
    const hand = ritual("movies");
    expect(run(hand, { type: "inspect", index: 5 })).toBe(hand);
    expect(run(hand, { type: "inspect", index: 1.5 })).toBe(hand);
  });

  test("re-opening an opened pack skips straight to the hand", () => {
    const opened = run(ritual("movies"), { type: "shelf", today: TODAY });
    const s = run(opened, { type: "pick", packId: "movies" });
    expect(s.phase).toBe(PHASE.HAND);
    expect(s.entry).toBe("reopen");
    expect(s.revealed).toBe(true);
  });

  test("reseal puts the pack back on the table sealed", () => {
    const s = run(ritual("movies"), { type: "reseal" });
    expect(s.phase).toBe(PHASE.SEALED);
    expect(s.entry).toBe("ritual");
    expect(s.opened.movies).toBeUndefined();
  });

  test("every fresh deal gets a new run id", () => {
    const picked = run(initDeck(), { type: "pick", packId: "movies" });
    expect(picked.run).toBe(1);
    const hand = ritual("movies");
    expect(hand.run).toBe(1);
    expect(run(hand, { type: "inspect", index: 0 }).run).toBe(1);
    expect(run(hand, { type: "switch", delta: 1 }).run).toBe(2);
    expect(run(hand, { type: "reseal" }).run).toBe(2);
  });
});

describe("switching packs", () => {
  test("next and previous wrap around the shelf order", () => {
    const hand = ritual("movies");
    const next = run(hand, { type: "switch", delta: 1 });
    expect(next.packId).toBe(PACKS[1].id);
    expect(next.phase).toBe(PHASE.SEALED);
    expect(next.entry).toBe("switch");
    expect(next.switchDir).toBe(1);
    const prev = run(hand, { type: "switch", delta: -1 });
    expect(prev.packId).toBe(PACKS[PACKS.length - 1].id);
    expect(prev.switchDir).toBe(-1);
  });

  test("switching to an opened pack lands in its hand", () => {
    const start = initDeck({ opened: { food: { pulledAt: TODAY } } });
    const s = run(ritual("movies", start), { type: "switch", delta: 1 });
    expect(s.packId).toBe("food");
    expect(s.phase).toBe(PHASE.HAND);
    expect(s.dealt).toBe(5);
  });

  test("switching is blocked mid-ritual", () => {
    const dealing = run(
      initDeck(),
      { type: "pick", packId: "movies" },
      { type: "rip" },
      { type: "ripped" }
    );
    expect(run(dealing, { type: "switch", delta: 1 })).toBe(dealing);
  });

  test("the order includes the bonus pack once the set is complete", () => {
    expect(visibleOrder(initDeck())).toHaveLength(8);
    expect(visibleOrder(initDeck({ opened: allOpened() }))).toHaveLength(9);
  });
});

describe("escape ladder and leaving the table", () => {
  test("inspect -> hand -> shelf", () => {
    let s = run(ritual("movies"), { type: "inspect", index: 1 });
    s = run(s, { type: "escape", today: TODAY });
    expect(s.phase).toBe(PHASE.HAND);
    s = run(s, { type: "escape", today: TODAY });
    expect(s.phase).toBe(PHASE.SHELF);
    expect(s.packId).toBeNull();
    expect(s.lastPackId).toBe("movies");
  });

  test("escape mid-ritual skips to the hand first", () => {
    const dealing = run(
      initDeck(),
      { type: "pick", packId: "movies" },
      { type: "rip" },
      { type: "ripped" }
    );
    const s = run(dealing, { type: "escape", today: TODAY });
    expect(s.phase).toBe(PHASE.HAND);
    expect(s.skipped).toBe(true);
    expect(s.opened.movies).toEqual({ pulledAt: TODAY });
  });

  test("escape from a sealed pack returns to the shelf without opening it", () => {
    const s = run(
      initDeck(),
      { type: "pick", packId: "movies" },
      { type: "escape", today: TODAY }
    );
    expect(s.phase).toBe(PHASE.SHELF);
    expect(s.opened.movies).toBeUndefined();
  });

  test("escape on the shelf is a no-op", () => {
    const shelf = initDeck();
    expect(run(shelf, { type: "escape", today: TODAY })).toBe(shelf);
  });

  test("leaving mid-ritual still counts the pack as opened", () => {
    const legend = run(
      initDeck(),
      { type: "pick", packId: "movies" },
      { type: "rip" },
      { type: "ripped" },
      ...[0, 1, 2, 3].map((index) => ({ type: "landed", index }))
    );
    const s = run(legend, { type: "shelf", today: TODAY });
    expect(s.phase).toBe(PHASE.SHELF);
    expect(s.opened.movies).toEqual({ pulledAt: TODAY });
  });

  test("completing the base set earns the bonus pack", () => {
    const opened = allOpened();
    delete opened.party;
    const s = ritual("party", initDeck({ opened }));
    expect(s.bonus).toBe(true);
    expect(visibleOrder(s)).toHaveLength(9);
  });
});
