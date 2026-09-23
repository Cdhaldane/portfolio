const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidDate,
  validateSave,
  validateImage,
  matchBowler,
  sanitizeParse,
} = require("./bowler-normalize");

const NOW = new Date("2026-09-23T20:00:00Z");

test("isValidDate accepts real past dates and rejects fakes/future", () => {
  assert.equal(isValidDate("2026-09-22", NOW), true);
  assert.equal(isValidDate("2026-09-24", NOW), true); // one day of tz slack
  assert.equal(isValidDate("2026-09-26", NOW), false);
  assert.equal(isValidDate("2026-02-31", NOW), false);
  assert.equal(isValidDate("22/09/2026", NOW), false);
  assert.equal(isValidDate("1999-01-01", NOW), false);
  assert.equal(isValidDate(20260922, NOW), false);
});

test("validateSave accepts both bowlers for one night", () => {
  const r = validateSave(
    {
      bowledOn: "2026-09-22",
      source: "photo",
      note: "  league week 3  ",
      entries: [
        { bowler: "cha", games: [191, 122, 120] },
        { bowler: "van", games: ["93", 93, 119] },
      ],
    },
    NOW
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.entries[1].games, [93, 93, 119]);
  assert.equal(r.value.note, "league week 3");
  assert.equal(r.value.source, "photo");
});

test("validateSave rejects bad games, duplicates, unknown bowlers", () => {
  const base = { bowledOn: "2026-09-22" };
  assert.equal(validateSave({ ...base, entries: [] }, NOW).ok, false);
  assert.equal(
    validateSave({ ...base, entries: [{ bowler: "cha", games: [301, 100, 100] }] }, NOW).ok,
    false
  );
  assert.equal(
    validateSave({ ...base, entries: [{ bowler: "cha", games: [100, 100] }] }, NOW).ok,
    false
  );
  assert.equal(
    validateSave({ ...base, entries: [{ bowler: "cha", games: [100.5, 100, 100] }] }, NOW).ok,
    false
  );
  assert.equal(
    validateSave({ ...base, entries: [{ bowler: "brad", games: [100, 100, 100] }] }, NOW).ok,
    false
  );
  assert.equal(
    validateSave(
      {
        ...base,
        entries: [
          { bowler: "cha", games: [100, 100, 100] },
          { bowler: "cha", games: [100, 100, 100] },
        ],
      },
      NOW
    ).ok,
    false
  );
});

test("validateSave defaults unknown source to manual and caps notes", () => {
  const r = validateSave(
    {
      bowledOn: "2026-09-22",
      source: "evil",
      note: "x".repeat(500),
      entries: [{ bowler: "van", games: [0, 300, 150] }],
    },
    NOW
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.source, "manual");
  assert.equal(r.value.note.length, 200);
});

test("validateImage checks type, encoding and size", () => {
  const good = "A".repeat(400);
  assert.equal(validateImage({ mediaType: "image/jpeg", image: good }).ok, true);
  assert.equal(validateImage({ mediaType: "image/gif", image: good }).ok, false);
  assert.equal(validateImage({ mediaType: "image/jpeg", image: "not base64!!" }).ok, false);
  assert.equal(
    validateImage({ mediaType: "image/jpeg", image: "A".repeat(5 * 1024 * 1024) }).ok,
    false
  );
});

test("matchBowler maps scoreboard names", () => {
  assert.equal(matchBowler("Charlie"), "cha");
  assert.equal(matchBowler(" CHARLIE "), "cha");
  assert.equal(matchBowler("Vanessa"), "van");
  assert.equal(matchBowler("Charmaine"), null);
  assert.equal(matchBowler("Brad G"), null);
  assert.equal(matchBowler(undefined), null);
});

test("sanitizeParse normalizes the recap from the example photo", () => {
  const out = sanitizeParse({
    team: "TEAM 12",
    bowlers: [
      { name: "Vanessa", games: [93, 93, 119], total: 305 },
      { name: "Charlie", games: [191, 122, 120], total: 433 },
      { name: "Charmaine", games: [111, 134, 153], total: 398 },
      { name: "Brad G", games: [114, 164, 144], total: 400 }, // misread total
    ],
  });
  assert.equal(out.team, "TEAM 12");
  assert.equal(out.readable, true);
  assert.equal(out.bowlers[0].key, "van");
  assert.equal(out.bowlers[1].key, "cha");
  assert.equal(out.bowlers[1].mismatch, false);
  assert.equal(out.bowlers[3].mismatch, true);
});

test("sanitizeParse nulls impossible games and survives garbage", () => {
  const out = sanitizeParse({
    bowlers: [{ name: "Charlie", games: [999, "150", -1], total: null }],
  });
  assert.deepEqual(out.bowlers[0].games, [null, 150, null]);
  assert.equal(out.bowlers[0].mismatch, false);
  assert.deepEqual(sanitizeParse(null), { team: null, bowlers: [], readable: false });
  assert.deepEqual(sanitizeParse({ bowlers: "nope" }).bowlers, []);
});
