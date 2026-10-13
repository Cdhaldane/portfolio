const test = require("node:test");
const assert = require("node:assert/strict");
const push = require("./acta-push");
const { createFakeStore } = require("./__fixtures__/acta-fakes");

const row = (publish_on) => ({ publish_on, day: 12, data: { title: "Salamis", summary: "How the narrows won it." } });

test("validSubscription accepts a browser subscription and nothing else", () => {
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BN...", auth: "xyz" }, expirationTime: null };
  assert.deepEqual(push.validSubscription(good), { endpoint: good.endpoint, keys: { p256dh: "BN...", auth: "xyz" } });
  assert.equal(push.validSubscription({ endpoint: "http://x.y/z", keys: good.keys }), null);
  assert.equal(push.validSubscription({ endpoint: good.endpoint, keys: {} }), null);
  assert.equal(push.validSubscription(null), null);
});

test("the notification announces a new lesson, nudges on Sundays, and stays quiet otherwise", () => {
  assert.equal(push.payloadFor("2026-10-21", row("2026-10-21")).title, "Acta Diurna · Day 12");
  assert.match(push.payloadFor("2026-10-21", row("2026-10-21")).body, /Salamis\. How the narrows/);
  assert.equal(push.payloadFor("2026-10-25", null).url, "/acta/review"); // Sunday
  assert.equal(push.payloadFor("2026-10-22", row("2026-10-21")), null); // nothing new
});

test("sendDaily sends once a day and forgets dead subscriptions", async () => {
  const store = createFakeStore();
  await store.savePush({ endpoint: "https://push.example/live", keys: { p256dh: "a", auth: "b" } });
  await store.savePush({ endpoint: "https://push.example/gone", keys: { p256dh: "a", auth: "b" } });
  const sent = [];
  const sender = async (sub, body) => {
    if (sub.endpoint.endsWith("gone")) {
      const e = new Error("Gone");
      e.statusCode = 410;
      throw e;
    }
    sent.push(JSON.parse(body));
  };
  const first = await push.sendDaily(store, { today: "2026-10-21", row: row("2026-10-21"), sender });
  assert.deepEqual(first, { sent: 1, removed: 1 });
  assert.equal(sent[0].url, "/acta");
  assert.equal(store.db.push.size, 1);
  const second = await push.sendDaily(store, { today: "2026-10-21", row: row("2026-10-21"), sender });
  assert.equal(second.skipped, "already sent today");
});

test("sendDaily is a no-op when push isn't configured", async () => {
  const store = createFakeStore();
  const r = await push.sendDaily(store, { today: "2026-10-21", row: row("2026-10-21") });
  assert.equal(r.skipped, "push is not configured");
});
