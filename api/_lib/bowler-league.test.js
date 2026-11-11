const test = require("node:test");
const assert = require("node:assert/strict");
const { leagueNight, nextPin, reminderFor, todayIn, weekdayOf } = require("./bowler-league");
const push = require("./bowler-push");

const row = (bowler, bowledOn, games) => ({ bowler, bowledOn, games });
// Tuesdays in fall 2026, plus one makeup Thursday.
const SEASON = [
  row("cha", "2026-10-06", [180, 180, 180]),
  row("van", "2026-10-06", [150, 150, 150]),
  row("cha", "2026-10-13", [180, 180, 180]),
  row("cha", "2026-10-22", [180, 180, 180]),
  row("cha", "2026-10-27", [180, 180, 180]),
];

test("the fixtures fall on the days they say", () => {
  assert.equal(weekdayOf("2026-10-06"), 2);
  assert.equal(weekdayOf("2026-10-22"), 4);
  assert.equal(todayIn("America/Toronto", new Date("2026-11-11T03:00:00Z")), "2026-11-10");
});

test("league night is the weekday most recent nights fell on", () => {
  const league = leagueNight(SEASON, "2026-11-03");
  assert.equal(league.label, "Tuesday");
  assert.equal(league.nights, 3);
  assert.equal(league.last, "2026-10-27");
});

test("no pattern yet, or a season that's gone quiet, means no league night", () => {
  assert.equal(leagueNight([], "2026-11-03"), null);
  assert.equal(leagueNight(SEASON.slice(0, 2), "2026-10-08"), null); // one night
  assert.equal(leagueNight(SEASON, "2026-12-01"), null); // five weeks quiet
});

test("nextPin is the series that lifts the average to the next whole pin", () => {
  // Charlie: 12 games of 180. 181 over 15 games needs 2715 - 2160 = 555.
  assert.deepEqual(nextPin(SEASON, "cha"), { name: "Charlie", target: 181, series: 555 });
  assert.equal(nextPin(SEASON, "nobody"), null);
  const ace = [row("cha", "2026-10-06", [299, 299, 299])];
  assert.equal(nextPin(ace, "cha"), null); // 300 x 6 - 897 = 903: past perfect
});

test("the reminder goes out on league night only, until the night is in", () => {
  const tonight = reminderFor(SEASON, "2026-11-03");
  assert.equal(tonight.title, "League night");
  assert.match(tonight.body, /Charlie: a 555 series lifts you to 181\./);
  assert.match(tonight.body, /Vanessa: a 456 series lifts you to 151\./); // 151 x 6 - 450
  assert.equal(tonight.url, "/bowler/lane");
  assert.equal(reminderFor(SEASON, "2026-11-04"), null); // Wednesday
  assert.equal(reminderFor([...SEASON, row("van", "2026-11-03", [1, 2, 3])], "2026-11-03"), null);
});

test("sendAll sends to every phone and forgets the ones that are gone", async () => {
  const sent = [];
  const dropped = [];
  const subs = [
    { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } },
    { endpoint: "https://push.example/b", keys: { p256dh: "p", auth: "a" } },
  ];
  const sender = async (sub, body) => {
    if (sub.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push(JSON.parse(body));
  };
  const result = await push.sendAll(subs, { title: "League night" }, { sender, drop: async (e) => dropped.push(e) });
  assert.deepEqual(result, { sent: 1, removed: 1 });
  assert.deepEqual(dropped, ["https://push.example/b"]);
  assert.equal(sent[0].icon, "/bowler-icon-192.png");
});
