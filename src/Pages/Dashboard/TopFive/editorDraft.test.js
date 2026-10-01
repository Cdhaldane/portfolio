import { LIMITS, PACKS } from "./top5.data";
import {
  toDraft,
  sameDraft,
  moveCard,
  setPackField,
  setStatLabel,
  setCardField,
  setCardStat,
  draftErrors,
  toPayload,
} from "./editorDraft";

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v));
  return Object.freeze(o);
};

const movies = PACKS[0];
const fresh = () => deepFreeze(toDraft(movies));

test("a draft copies only the editable fields", () => {
  const d = toDraft(movies);
  expect(Object.keys(d).sort()).toEqual(["cards", "name", "statLabels", "tagline"]);
  expect(d.cards[0]).toEqual({
    id: "lebowski",
    title: "The Big Lebowski",
    meta: movies.cards[0].meta,
    icon: movies.cards[0].icon,
    take: movies.cards[0].take,
    fun: movies.cards[0].fun,
    stats: movies.cards[0].stats,
  });
  expect(d.cards[0].stats).not.toBe(movies.cards[0].stats);
  expect(sameDraft(d, toDraft(movies))).toBe(true);
});

test("edits never mutate the previous draft", () => {
  const d = fresh();
  const a = setPackField(d, "name", "Films");
  const b = setStatLabel(a, 1, "Lines");
  const c = setCardField(b, 2, "title", "Heat");
  const e = setCardStat(c, 2, 0, 3);
  expect(e.name).toBe("Films");
  expect(e.statLabels[1]).toBe("Lines");
  expect(e.cards[2].title).toBe("Heat");
  expect(e.cards[2].stats[0]).toBe(3);
  expect(d.name).toBe(movies.name);
  expect(sameDraft(d, e)).toBe(false);
});

test("moving a card re-ranks it and its id travels with it", () => {
  const d = fresh();
  const up = moveCard(d, 1, 0);
  expect(up.cards[0].id).toBe(d.cards[1].id);
  expect(up.cards[1].id).toBe(d.cards[0].id);
  expect(moveCard(d, 0, -1)).toBe(d);
  expect(moveCard(d, 4, 5)).toBe(d);
});

test("errors name the field and mirror the card limits", () => {
  expect(draftErrors(fresh())).toEqual({});
  let d = setPackField(fresh(), "name", "x".repeat(LIMITS.packName + 1));
  d = setStatLabel(d, 2, "");
  d = setCardField(d, 0, "title", "  ");
  d = setCardField(d, 3, "take", "x".repeat(LIMITS.take + 1));
  d = setCardField(d, 4, "icon", "fa-x nope");
  const errors = draftErrors(d);
  expect(Object.keys(errors).sort()).toEqual(["card-0-title", "card-3-take", "card-4-icon", "label-2", "name"]);
  expect(errors.name).toMatch(/14/);
});

test("stats are clamped to whole numbers from 0 to 10", () => {
  const d = setCardStat(setCardStat(fresh(), 0, 0, 14), 0, 1, -3);
  expect(d.cards[0].stats.slice(0, 2)).toEqual([10, 0]);
  expect(setCardStat(fresh(), 0, 2, "7").cards[0].stats[2]).toBe(7);
});

test("the payload is cleaned text in rank order", () => {
  const d = setCardField(setPackField(fresh(), "name", "  Films  "), 0, "title", "The  Big\nLebowski");
  const payload = toPayload(d);
  expect(payload.name).toBe("Films");
  expect(payload.cards[0].title).toBe("The Big Lebowski");
  expect(payload.cards.map((c) => c.id)).toEqual(movies.cards.map((c) => c.id));
});
