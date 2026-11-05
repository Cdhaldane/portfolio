const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("./pantry-push");

const subs = [
  { endpoint: "https://push.example/a", keys: { p256dh: "k", auth: "a" } },
  { endpoint: "https://push.example/gone", keys: { p256dh: "k", auth: "a" } },
];

test("sendAll sends each phone the payload with Pantry's icon, and drops gone ones", async () => {
  const sent = [];
  const dropped = [];
  const result = await P.sendAll(subs, { title: "Milk 2% is out", url: "/pantry?tab=list" }, {
    sender: async (sub, body) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push(JSON.parse(body));
    },
    drop: async (endpoint) => dropped.push(endpoint),
  });
  assert.deepEqual(result, { sent: 1, removed: 1 });
  assert.deepEqual(dropped, ["https://push.example/gone"]);
  assert.equal(sent[0].icon, "/pantry-icon-192.png");
  assert.equal(sent[0].badge, "/pantry-badge-96.png");
  assert.equal(sent[0].url, "/pantry?tab=list");
});

test("a failure that isn't 'gone' keeps the subscription", async () => {
  const dropped = [];
  const result = await P.sendAll([subs[0]], { title: "x" }, {
    sender: async () => {
      throw Object.assign(new Error("flaky"), { statusCode: 500 });
    },
    drop: async (endpoint) => dropped.push(endpoint),
  });
  assert.deepEqual(result, { sent: 0, removed: 0 });
  assert.deepEqual(dropped, []);
});

test("nobody to tell, or no keys and no test sender: nothing happens", async () => {
  assert.deepEqual(await P.sendAll([], { title: "x" }, { sender: async () => {} }), { sent: 0, removed: 0 });
  const saved = [process.env.PANTRY_VAPID_PUBLIC_KEY, process.env.ACTA_VAPID_PUBLIC_KEY];
  delete process.env.PANTRY_VAPID_PUBLIC_KEY;
  delete process.env.ACTA_VAPID_PUBLIC_KEY;
  try {
    assert.equal(P.configured(), false);
    assert.deepEqual(await P.sendAll(subs, { title: "x" }), { sent: 0, removed: 0 });
  } finally {
    if (saved[0] !== undefined) process.env.PANTRY_VAPID_PUBLIC_KEY = saved[0];
    if (saved[1] !== undefined) process.env.ACTA_VAPID_PUBLIC_KEY = saved[1];
  }
});

test("Acta's keys stand in when Pantry has none of its own", () => {
  const saved = { ...process.env };
  try {
    delete process.env.PANTRY_VAPID_PUBLIC_KEY;
    delete process.env.PANTRY_VAPID_PRIVATE_KEY;
    process.env.ACTA_VAPID_PUBLIC_KEY = "acta-pub";
    process.env.ACTA_VAPID_PRIVATE_KEY = "acta-priv";
    assert.equal(P.configured(), true);
    assert.equal(P.publicKey(), "acta-pub");
    process.env.PANTRY_VAPID_PUBLIC_KEY = "pantry-pub";
    process.env.PANTRY_VAPID_PRIVATE_KEY = "pantry-priv";
    assert.equal(P.publicKey(), "pantry-pub");
  } finally {
    for (const k of ["PANTRY_VAPID_PUBLIC_KEY", "PANTRY_VAPID_PRIVATE_KEY", "ACTA_VAPID_PUBLIC_KEY", "ACTA_VAPID_PRIVATE_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("the heads-up says what happened and opens the list", () => {
  assert.deepEqual(P.markedPayload({ id: 3, name: "Eggs" }, "out"), {
    title: "Eggs is out",
    body: "It's on the shopping list.",
    url: "/pantry?tab=list",
    tag: "pantry-item-3",
  });
  assert.equal(P.markedPayload({ id: 3, name: "Eggs" }, "low").title, "Eggs is running low");
});
