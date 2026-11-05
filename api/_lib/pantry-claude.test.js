const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./pantry-claude");

/** A stand-in client that records the request and answers with `reply`. */
function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return typeof reply === "function" ? reply(params) : reply;
        },
      },
    },
  };
}

const answer = (json, stop = "end_turn") => ({
  stop_reason: stop,
  content: [{ type: "text", text: JSON.stringify(json) }],
});

test("a receipt read sends every photo first, then the known items", async () => {
  const client = fakeClient(answer({ store: "No Frills", purchasedOn: null, totalCents: null, lines: [] }));
  const photos = [
    { image: "AAAA", mediaType: "image/jpeg" },
    { image: "BBBB", mediaType: "image/png" },
  ];
  const out = await C.readReceipt(photos, [{ id: 7, name: "Milk 2%" }], { client });
  assert.equal(out.store, "No Frills");

  const [params] = client.calls;
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.output_config.effort, "medium");
  assert.equal(params.output_config.format.type, "json_schema");
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.fallbacks, "default");
  assert.equal("thinking" in params, false, "Opus 5.5 thinks adaptively; never disable it");
  assert.equal("temperature" in params, false);

  const content = params.messages[0].content;
  assert.deepEqual(
    content.slice(0, 2).map((b) => [b.type, b.source.media_type, b.source.data]),
    [
      ["image", "image/jpeg", "AAAA"],
      ["image", "image/png", "BBBB"],
    ]
  );
  const prompt = content[2].text;
  assert.match(prompt, /These 2 phone photos are one grocery receipt/);
  assert.match(prompt, /never count a line twice/);
  assert.match(prompt, /^7 \| Milk 2%$/m);
});

test("the receipt schema is strict enough for structured outputs", () => {
  const client = fakeClient(answer({ store: null, purchasedOn: null, totalCents: null, lines: [] }));
  return C.readReceipt([{ image: "AAAA", mediaType: "image/jpeg" }], [], { client }).then(() => {
    const schema = client.calls[0].output_config.format.schema;
    const line = schema.properties.lines.items;
    assert.equal(schema.additionalProperties, false);
    assert.equal(line.additionalProperties, false);
    assert.deepEqual([...line.required].sort(), Object.keys(line.properties).sort());
    assert.ok(line.properties.location.enum.includes("home"));
    assert.match(client.calls[0].messages[0].content[1].text, /first receipt/);
  });
});

test("recipes are asked for from stock, with the household's request quoted", async () => {
  const client = fakeClient(answer({ recipes: [] }));
  const stock = [
    { id: 4, name: "Spinach", qty: 1, status: { useSoon: true, expired: false, state: "ok" } },
    { id: 5, name: "Eggs", qty: 0.25, status: { useSoon: false, expired: false, state: "low" } },
  ];
  await C.suggestRecipes(stock, "something quick", "2026-11-04", { client });
  const prompt = client.calls[0].messages[0].content[0].text;
  assert.match(prompt, /Today is 2026-11-04/);
  assert.match(prompt, /^4 \| Spinach \| 1 \| use soon$/m);
  assert.match(prompt, /^5 \| Eggs \| a little \| running low$/m);
  assert.match(prompt, /They asked for: "something quick"/);
});

test("refusals, truncation and junk become a 422 the page can show", async () => {
  for (const reply of [
    answer({}, "refusal"),
    answer({}, "max_tokens"),
    { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] },
  ]) {
    await assert.rejects(
      C.readReceipt([{ image: "AAAA", mediaType: "image/jpeg" }], [], { client: fakeClient(reply) }),
      (err) => err.status === 422 && /receipt/.test(err.payload.error)
    );
  }
});

test("no API key means a 503 with a code, before any call", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      C.readReceipt([{ image: "AAAA", mediaType: "image/jpeg" }], []),
      (err) => err.status === 503 && err.payload.code === "claude_unconfigured"
    );
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
