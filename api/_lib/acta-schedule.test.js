const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("./acta-schedule");

test("todayISO anchors to Toronto, not UTC", () => {
  // 02:30 UTC on Oct 14 is still the evening of Oct 13 in Toronto (EDT, UTC-4).
  assert.equal(s.todayISO(new Date("2026-10-14T02:30:00Z")), "2026-10-13");
  assert.equal(s.todayISO(new Date("2026-10-14T05:00:00Z")), "2026-10-14");
  // Winter (EST, UTC-5).
  assert.equal(s.todayISO(new Date("2026-01-15T04:59:00Z")), "2026-01-14");
});

test("date arithmetic crosses months, years and DST without drifting", () => {
  assert.equal(s.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(s.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(s.addDays("2026-03-07", 2), "2026-03-09"); // DST starts Mar 8
  assert.equal(s.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(s.daysBetween("2026-10-13", "2026-10-20"), 7);
});

test("weekdays and review days", () => {
  assert.equal(s.weekday("2026-10-13"), 2); // Tuesday
  assert.equal(s.isReviewDay("2026-10-18"), true); // Sunday
  assert.equal(s.isReviewDay("2026-10-19"), false);
  assert.equal(s.mondayOnOrAfter("2026-10-13"), "2026-10-19");
  assert.equal(s.mondayOnOrAfter("2026-10-19"), "2026-10-19");
});

test("a season starts on a Monday with at least two days of runway", () => {
  assert.equal(s.seasonStart("2026-10-13"), "2026-10-19"); // Tue → next Mon
  assert.equal(s.seasonStart("2026-10-17"), "2026-10-19"); // Sat → Mon, two days out
  assert.equal(s.seasonStart("2026-10-18"), "2026-10-26"); // Sun → too close, the Monday after
  assert.equal(s.seasonStart("2026-10-19"), "2026-10-26"); // Mon itself is too close
});

test("a new season queues after the last scheduled lesson", () => {
  // Last lesson is Saturday Nov 21, so the next season starts Monday Nov 23.
  assert.equal(s.seasonStart("2026-10-13", "2026-11-21"), "2026-11-23");
  // A last lesson in the past doesn't hold anything up.
  assert.equal(s.seasonStart("2026-10-13", "2026-09-01"), "2026-10-19");
});

test("slots map to Monday–Saturday across five weeks", () => {
  const start = "2026-10-19";
  assert.equal(s.slotDate(start, 0), "2026-10-19"); // Mon week 1
  assert.equal(s.slotDate(start, 5), "2026-10-24"); // Sat week 1
  assert.equal(s.slotDate(start, 6), "2026-10-26"); // Mon week 2
  assert.equal(s.slotDate(start, 29), "2026-11-21"); // Sat week 5
  for (let i = 0; i < 30; i++) assert.notEqual(s.weekday(s.slotDate(start, i)), 0, "never on a Sunday");
  assert.equal(s.slotKind(2), "moment");
  assert.equal(s.slotKind(11), "meanwhile");
});

test("isIsoDate rejects impossible dates", () => {
  assert.equal(s.isIsoDate("2026-02-29"), false);
  assert.equal(s.isIsoDate("2028-02-29"), true);
  assert.equal(s.isIsoDate("2026-1-1"), false);
});

test("lessonDaysBetween skips Sundays", () => {
  assert.equal(s.lessonDaysBetween("2026-10-18", "2026-10-25"), 6);
});
