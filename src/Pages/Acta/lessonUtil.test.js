import { credit, feedCards, formatYear, layoutPins, linkMentions, mentionMatcher, paragraphs, sections, speechParts } from "./lessonUtil";
import SAMPLE from "./lessons/salamis.json";

describe("people and places", () => {
  const xerxes = { title: "Xerxes I", names: ["Xerxes", "Xerxes I"] };
  const athens = { title: "Athens", names: ["Athens"] };
  const draft = { wiki: "Aegina", names: ["Aegina"] };
  const matcher = mentionMatcher([xerxes, athens, draft, { names: ["Orphan"] }]);
  const names = (parts) => parts.filter((p) => typeof p !== "string").map((p) => p.text);

  test("the longest name wins, and each one links once", () => {
    const parts = linkMentions("Xerxes I marched on Athens. Xerxes burned Athens.", matcher);
    expect(parts).toEqual(["", { text: "Xerxes I", mention: xerxes }, " marched on ", { text: "Athens", mention: athens }, ". Xerxes burned Athens."].filter(Boolean));
  });

  test("whole words only, possessives included", () => {
    expect(names(linkMentions("The Athenians left Athens' walls.", matcher))).toEqual(["Athens"]);
    expect(names(linkMentions("Aeginetans sailed from Aegina.", matcher))).toEqual(["Aegina"]);
  });

  test("seen carries across a card's paragraphs", () => {
    const seen = new Set();
    expect(names(linkMentions("Athens burned.", matcher, seen))).toEqual(["Athens"]);
    expect(names(linkMentions("Athens again.", matcher, seen))).toEqual([]);
  });

  test("no mentions, plain text", () => {
    expect(mentionMatcher(undefined)).toBe(null);
    expect(linkMentions("Athens", null)).toEqual(["Athens"]);
  });

  test("every Salamis mention links somewhere in its cards", () => {
    const m = mentionMatcher(SAMPLE.mentions);
    const linkedTitles = new Set();
    for (const c of SAMPLE.cards) {
      const seen = new Set();
      for (const t of [c.text, ...(c.sides || []).map((s) => s.text)]) {
        if (c.type === "recall" || !t) continue;
        for (const p of linkMentions(t, m, seen)) if (typeof p !== "string") linkedTitles.add(p.mention.title);
      }
    }
    expect([...linkedTitles].sort()).toEqual(SAMPLE.mentions.map((x) => x.title).sort());
  });
});

test("formatYear", () => {
  expect(formatYear(-480)).toBe("480 BC");
  expect(formatYear(30)).toBe("AD 30");
  expect(formatYear(1453)).toBe("1453");
  expect(formatYear(undefined)).toBe("");
});

test("paragraphs split on blank lines", () => {
  expect(paragraphs("One.\n\nTwo.\n\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  expect(paragraphs(null)).toEqual([]);
});

test("the Salamis lesson's contents read like its chapters", () => {
  const cards = feedCards(SAMPLE);
  expect(cards[cards.length - 1].type).toBe("close");
  const labels = sections(cards).map((s) => s.label);
  expect(labels).toEqual([
    "Cold open",
    "Where & when",
    "I · The silver",
    "II · The wooden wall",
    "III · The trick",
    "IV · The battle",
    "Historians disagree",
    "Ripples",
    "Check yourself",
    "Close",
  ]);
  // Every card belongs to exactly one section, in order.
  const s = sections(cards);
  expect(s[0].start).toBe(0);
  expect(s[s.length - 1].end).toBe(cards.length - 1);
  for (let i = 1; i < s.length; i++) expect(s[i].start).toBe(s[i - 1].end + 1);
});

test("timeline pins stay in order and close ones drop a row", () => {
  const { pins } = layoutPins(SAMPLE.cards[1].pins);
  expect(pins.map((p) => p.year)).toEqual([-776, -490, -480, -431, -399, -323]);
  expect(pins.every((p) => p.x >= 0 && p.x <= 100)).toBe(true);
  const marathon = pins.find((p) => p.year === -490);
  const salamis = pins.find((p) => p.year === -480);
  expect(salamis.row).not.toBe(marathon.row);
  expect(layoutPins([{ year: 1, label: "x" }]).pins).toEqual([]);
});

test("narration reads a card as sentences, and only the question for recall cards", () => {
  const open = speechParts(SAMPLE.cards[0], SAMPLE);
  expect(open[0]).toBe("Salamis");
  expect(open).toContain("Athens is empty.");
  const recall = SAMPLE.cards.find((c) => c.type === "recall");
  expect(speechParts(recall, SAMPLE)).toEqual([recall.q]);
  const close = speechParts({ type: "close" }, SAMPLE);
  expect(close.slice(1)).toEqual(SAMPLE.takeaways);
  // Quotes keep their own sentences intact.
  const quote = SAMPLE.cards.find((c) => c.type === "quote");
  expect(speechParts(quote, SAMPLE).join(" ")).toMatch(/radiant Day with her white horses/);
});

test("image credits name the artist and licence", () => {
  expect(credit(SAMPLE.cards[0].image)).toBe("Wilhelm von Kaulbach · Public domain");
  expect(credit(null)).toBe("");
});
