import { LIMITS, PACKS, SECRET_PACK, cleanText } from "./top5.data";

// The API (CommonJS, outside src/) validates what the back office saves. Its
// rules must match the card layout's, or a save could pass one side and
// break the other.
const server = require("../../../../api/_lib/top5-normalize");

const everyPack = [...PACKS, SECRET_PACK];
const asEdit = (pack) => ({
  packId: pack.id,
  pack: { name: pack.name, tagline: pack.tagline, statLabels: pack.statLabels, cards: pack.cards },
});

test("the server knows exactly the page's packs", () => {
  expect(server.PACK_IDS).toEqual(everyPack.map((p) => p.id));
});

test("client and server share the same text budgets", () => {
  expect(server.LIMITS).toEqual(LIMITS);
});

test.each(everyPack.map((p) => [p.id, p]))("the shipped %s pack is a valid save", (_id, pack) => {
  const result = server.validatePack(asEdit(pack));
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
});

test.each([
  "Chef \u{1F9D1}\u200d\u{1F373} approved",
  "\u{1F468}\u200d\u{1F4BB} Debugging",
  "\u{1F937}\u200d\u2642\ufe0f",
])("client and server clean %s identically, joiners intact", (text) => {
  expect(server.cleanText(text)).toBe(text);
  expect(cleanText(text)).toBe(text);
});

test("both sides strip the same invisible characters", () => {
  const sneaky = "A\u202eB\u200bC\u2066D\ufeffE\u0000F";
  expect(cleanText(sneaky)).toBe(server.cleanText(sneaky));
  expect(cleanText(sneaky)).toBe("ABCDE F");
});
