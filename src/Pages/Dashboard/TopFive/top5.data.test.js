import {
  PACKS,
  SECRET_PACK,
  SECRETS,
  RARITY,
  LIMITS,
  CARDS_PER_PACK,
  TOTAL_CARDS,
  rarityOf,
  fanIndex,
  rankAt,
  collectorNo,
  packById,
  visiblePacks,
  allBaseOpened,
  sanitizeOpened,
  sanitizeSecrets,
  sanitizePackEdit,
  buildCatalog,
} from "./top5.data";

/*
 * Schema guard for the one file Charlie edits. The card layout budgets for
 * these lengths, so a swap that would overflow a card fails here instead of
 * silently clipping on the page.
 */

const ICON = /^fa-[a-z0-9-]+$/;
const everyPack = [...PACKS, SECRET_PACK];

describe("packs", () => {
  test("eight base packs with unique ids", () => {
    expect(PACKS).toHaveLength(8);
    const ids = everyPack.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(everyPack.map((p) => [p.id, p]))("%s has a complete wrapper", (_id, pack) => {
    expect(pack.name.length).toBeGreaterThan(0);
    expect(pack.name.length).toBeLessThanOrEqual(LIMITS.packName);
    expect(pack.tagline.length).toBeGreaterThan(0);
    expect(pack.kind.length).toBeGreaterThan(0);
    expect(pack.icon).toMatch(ICON);
    expect(pack.hue).toBeGreaterThanOrEqual(0);
    expect(pack.hue).toBeLessThanOrEqual(360);
    expect(pack.statLabels).toHaveLength(3);
    pack.statLabels.forEach((l) => expect(l.length).toBeLessThanOrEqual(LIMITS.statLabel));
    expect(pack.cards).toHaveLength(CARDS_PER_PACK);
  });

  test("only the bonus pack is secret", () => {
    expect(PACKS.every((p) => !p.secret)).toBe(true);
    expect(SECRET_PACK.secret).toBe(true);
  });
});

describe("cards", () => {
  const cards = everyPack.flatMap((p) => p.cards.map((c) => [`${p.id}/${c.id}`, c]));

  test("card ids are unique across the whole set", () => {
    const ids = cards.map(([key]) => key.split("/")[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(cards)("%s fits the card layout", (_key, card) => {
    expect(card.title.length).toBeGreaterThan(0);
    expect(card.title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(card.meta.length).toBeLessThanOrEqual(LIMITS.meta);
    expect(card.take.length).toBeGreaterThan(0);
    expect(card.take.length).toBeLessThanOrEqual(LIMITS.take);
    expect(card.fun.length).toBeLessThanOrEqual(LIMITS.fun);
    expect(card.icon).toMatch(ICON);
    expect(card.stats).toHaveLength(3);
    card.stats.forEach((s) => {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(10);
    });
  });
});

describe("rarity ladder", () => {
  test("#1 is legendary and #5 is common", () => {
    expect(rarityOf(1).tier).toBe("legendary");
    expect(rarityOf(2).tier).toBe("ultra");
    expect(rarityOf(3).tier).toBe("rare");
    expect(rarityOf(4).tier).toBe("uncommon");
    expect(rarityOf(5).tier).toBe("common");
    Object.values(RARITY).forEach((r) => {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.code.length).toBeGreaterThan(0);
      expect(r.symbol).toMatch(ICON);
    });
  });

  test("fan runs #5 on the left to #1 on the right and round-trips", () => {
    expect(fanIndex(5)).toBe(0);
    expect(fanIndex(1)).toBe(4);
    for (let rank = 1; rank <= 5; rank += 1) expect(rankAt(fanIndex(rank))).toBe(rank);
  });
});

describe("helpers", () => {
  test("totals and collector numbers", () => {
    expect(TOTAL_CARDS).toBe(40);
    expect(collectorNo(PACKS[0], 1)).toBe("TD1-001/040");
    expect(collectorNo(PACKS[7], 5)).toBe("TD1-040/040");
    expect(collectorNo(SECRET_PACK, 1)).toBe("TD1-S01");
  });

  test("packById finds base and secret packs", () => {
    expect(packById("movies").name).toBe(PACKS[0].name);
    expect(packById(SECRET_PACK.id)).toBe(SECRET_PACK);
    expect(packById("nope")).toBeUndefined();
  });

  test("the bonus pack only shows once the set is complete or unlocked", () => {
    const some = { movies: { pulledAt: "2026-09-30" } };
    const all = Object.fromEntries(PACKS.map((p) => [p.id, { pulledAt: "2026-09-30" }]));
    expect(allBaseOpened(some)).toBe(false);
    expect(allBaseOpened(all)).toBe(true);
    expect(visiblePacks(some, false)).toHaveLength(8);
    expect(visiblePacks(all, false)).toHaveLength(9);
    expect(visiblePacks({}, true)).toHaveLength(9);
    expect(visiblePacks(all, false)[8]).toBe(SECRET_PACK);
  });

  test("sanitizers only keep known packs and secrets from storage", () => {
    expect(sanitizeOpened(null)).toEqual({});
    expect(sanitizeOpened("junk")).toEqual({});
    expect(sanitizeOpened([1, 2])).toEqual({});
    expect(
      sanitizeOpened({
        movies: { pulledAt: "2026-09-30" },
        food: { pulledAt: 42 },
        nope: { pulledAt: "2026-09-30" },
        bugs: { pulledAt: "2026-09-29" },
      })
    ).toEqual({ movies: { pulledAt: "2026-09-30" }, bugs: { pulledAt: "2026-09-29" } });
    expect(sanitizeSecrets(["shiny", "nope", 7, "shiny", "yard"])).toEqual(["shiny", "yard"]);
    expect(sanitizeSecrets({ shiny: true })).toEqual([]);
  });

  test("every secret has a hint and an icon", () => {
    const ids = SECRETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    SECRETS.forEach((s) => {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
      expect(s.icon).toMatch(ICON);
    });
  });
});

describe("owner edits", () => {
  const editOf = (pack, changes = {}) => ({
    name: pack.name,
    tagline: pack.tagline,
    statLabels: [...pack.statLabels],
    cards: pack.cards.map((c) => ({ ...c, stats: [...c.stats] })),
    ...changes,
  });

  test("with no edits the catalog is exactly the shipped set", () => {
    const catalog = buildCatalog();
    expect(catalog.packs).toEqual(PACKS);
    expect(catalog.secret).toBe(SECRET_PACK);
    expect(catalog.byId.get("movies")).toBe(PACKS[0]);
    expect(catalog.byId.size).toBe(9);
  });

  test("a valid edit replaces that pack's contents and keeps its identity", () => {
    const movies = PACKS[0];
    const cards = editOf(movies).cards;
    const swapped = [{ ...cards[1], title: "Spirited Away" }, cards[0], ...cards.slice(2)];
    const catalog = buildCatalog({ movies: editOf(movies, { name: "Films", cards: swapped }) });
    const edited = catalog.byId.get("movies");
    expect(edited.name).toBe("Films");
    expect(edited.cards[0].title).toBe("Spirited Away");
    expect(edited.cards[1].title).toBe(movies.cards[0].title);
    expect(edited.edited).toBe(true);
    // identity and look stay with the pack
    expect(edited.id).toBe("movies");
    expect(edited.hue).toBe(movies.hue);
    expect(edited.icon).toBe(movies.icon);
    expect(catalog.packs[1]).toBe(PACKS[1]);
  });

  test("bad or unknown edits are ignored, never half-applied", () => {
    const movies = PACKS[0];
    const tooLong = editOf(movies);
    tooLong.cards[2].title = "x".repeat(LIMITS.title + 1);
    const badIcon = editOf(movies);
    badIcon.cards[0].icon = "fa-x evil";
    const fourCards = editOf(movies, { cards: movies.cards.slice(0, 4) });
    const badStat = editOf(movies);
    badStat.cards[0].stats = [11, 1, 1];
    [tooLong, badIcon, fourCards, badStat, "junk", null].forEach((edit) => {
      expect(buildCatalog({ movies: edit }).byId.get("movies")).toBe(movies);
    });
    expect(buildCatalog({ nope: editOf(movies) }).byId.has("nope")).toBe(false);
  });

  test("edit text is cleaned like the server cleans it", () => {
    const edit = sanitizePackEdit(editOf(PACKS[1], { name: "  Food \n ", tagline: "Chef\u200b's  pick" }));
    expect(edit.name).toBe("Food");
    expect(edit.tagline).toBe("Chef's pick");
  });

  test("the shelf shows edited packs", () => {
    const catalog = buildCatalog({ food: editOf(PACKS[1], { name: "Eats" }) });
    expect(visiblePacks({}, false, catalog)[1].name).toBe("Eats");
    expect(visiblePacks({}, true, catalog)).toHaveLength(9);
  });
});
