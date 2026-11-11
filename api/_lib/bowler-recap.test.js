const test = require("node:test");
const assert = require("node:assert/strict");
const { gameFacts, nightFacts, recapBasis, writeRecap } = require("./bowler-recap");

const count = (rolls) => ({ rolls, standing: null });
const s = (rolls, standing) => ({ rolls, standing });

// 9/ X X X 72 9/ 9- X 8- (7-10 split) X9/
const GAME = [
  s([9, 1], [[10], []]),
  s([10], [[]]),
  s([10], [[]]),
  s([10], [[]]),
  s([7, 2], [[1, 2, 4], [4]]),
  s([9, 1], [[10], []]),
  s([9, 0], [[10], [10]]),
  s([10], [[]]),
  s([8, 0], [[7, 10], [7, 10]]),
  s([10, 9, 1], [[], [10], []]),
];

const row = (bowler, bowledOn, games, extra = {}) => ({
  bowler,
  bowledOn,
  games,
  frames: [null, null, null],
  lanes: [null, null, null],
  balls: [null, null, null],
  note: null,
  ...extra,
});

test("gameFacts counts the night's frames", () => {
  const g = gameFacts(GAME);
  assert.equal(g.strikes, "5 of 11");
  assert.equal(g.spares, "3 of 6");
  assert.equal(g.openFrames, 3);
  assert.equal(g.splits, 1);
  assert.equal(g.longestStrikeRun, 3);
  assert.deepEqual(g.sparesMissed, ["1-2-4", "10", "7-10"]);
  assert.equal(g.marks.split(" ")[0], "9/");
  assert.equal(gameFacts(null), null);
});

test("count-only frames still count strikes and spares, without leaves", () => {
  const g = gameFacts([
    count([10]),
    count([7, 2]),
    count([6, 4]),
    ...Array.from({ length: 6 }, () => count([10])),
    count([10, 10, 10]),
  ]);
  assert.equal(g.strikes, "10 of 12");
  assert.equal(g.spares, "1 of 2");
  assert.deepEqual(g.sparesMissed, []);
});

test("nightFacts compares the night to what came before", () => {
  const all = [
    row("cha", "2026-10-06", [150, 160, 170]),
    row("van", "2026-10-06", [140, 150, 160]),
    row("cha", "2026-10-13", [180, 190, 200], { lanes: [13, 13, 15], balls: [4, 4, null], note: "Oily" }),
    row("van", "2026-10-13", [200, 150, 210]),
    row("cha", "2026-10-20", [100, 100, 100]),
  ];
  const facts = nightFacts("2026-10-13", all, new Map([[4, "Phaze II"]]));
  assert.equal(facts.bowlers.length, 2);
  const cha = facts.bowlers.find((b) => b.key === "cha");
  assert.equal(cha.averageBefore, 160);
  assert.equal(cha.highGameBefore, 170);
  assert.equal(cha.series, 570);
  assert.deepEqual(cha.lanes, ["13-14", "13-14", "15-16"]);
  assert.deepEqual(cha.balls, ["Phaze II", "Phaze II", null]);
  assert.deepEqual(facts.headToHead.games, ["Vanessa", "Charlie", "Vanessa"]);
  assert.equal(facts.headToHead.series, "Charlie"); // 570 to 560
  assert.equal(facts.theirNote, "Oily");

  const first = nightFacts("2026-10-06", all);
  assert.equal(first.bowlers[0].averageBefore, null);
  assert.equal(first.bowlers[0].nightsBefore, 0);
});

test("recapBasis changes when the night does, not when rows reorder", () => {
  const a = row("cha", "2026-10-13", [180, 190, 200]);
  const b = row("van", "2026-10-13", [200, 150, 210]);
  assert.equal(recapBasis([a, b]), recapBasis([b, a]));
  assert.notEqual(recapBasis([a, b]), recapBasis([{ ...a, games: [181, 190, 200] }, b]));
  assert.notEqual(recapBasis([a, b]), recapBasis([{ ...a, note: "Oily" }, b]));
});

function fakeClient(json, stop = "end_turn") {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return { stop_reason: stop, content: [{ type: "text", text: JSON.stringify(json) }] };
      },
    },
  };
}

test("writeRecap tidies the model's two lines", async () => {
  const client = fakeClient({ headline: "  Charlie finds the pocket. ", story: "Three   strikes in a row." });
  const out = await writeRecap({ date: "2026-10-13", bowlers: [] }, { client });
  assert.equal(out.headline, "Charlie finds the pocket");
  assert.equal(out.story, "Three strikes in a row.");
  assert.equal(client.calls[0].model, "claude-haiku-5-5");
  assert.equal(client.calls[0].output_config.effort, "low");
  assert.match(client.calls[0].messages[0].content, /"date": "2026-10-13"/);
});

test("writeRecap turns a refusal or an empty answer into a 422", async () => {
  await assert.rejects(
    writeRecap({}, { client: fakeClient({ headline: "x", story: "y" }, "refusal") }),
    (e) => e.status === 422
  );
  await assert.rejects(
    writeRecap({}, { client: fakeClient({ headline: "", story: "y" }) }),
    (e) => e.status === 422
  );
});
