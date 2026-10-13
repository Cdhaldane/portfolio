const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./acta-claude");

const topic = { title: "Salamis, 480 BC", kind: "moment", era: "greece", year: -480, yearLabel: "480 BC", focus: "The trick" };
const sources = {
  articles: [{ title: "Battle of Salamis", url: "https://en.wikipedia.org/wiki/Battle_of_Salamis", text: "Article text." }],
  media: [{ file: "File:A.jpg", caption: "A painting" }],
  passages: [{ id: "p1", citation: "Herodotus 8.90", translator: "Godley", url: "https://www.perseus.tufts.edu/x", excerpt: "Whenever Xerxes…" }],
};

test("every request uses Opus 5.5 and a schema-constrained answer", () => {
  for (const p of [
    C.researchParams(topic, sources),
    C.writeParams(topic, sources, {}),
    C.checkParams({ title: "T", cards: [] }, sources),
    C.proposeParams({ number: 2 }),
    C.swapParams({ season: { title: "S", span: "x" }, topic, others: [] }),
  ]) {
    assert.equal(p.model, "claude-opus-5-5");
    assert.equal(p.output_config.format.type, "json_schema");
    assert.equal("thinking" in p, false, "adaptive thinking is Opus 5.5's default; never disable it");
    assert.equal("temperature" in p, false);
  }
});

test("batch requests carry no fallbacks (the Batches API rejects them)", () => {
  for (const p of [C.researchParams(topic, sources), C.writeParams(topic, sources, {}), C.checkParams({ cards: [] }, sources)]) {
    assert.equal("fallbacks" in p, false);
    assert.equal("betas" in p, false);
  }
});

test("research is limited to the primary-source sites", () => {
  const p = C.researchParams(topic, sources);
  const [search, fetchTool] = p.tools;
  assert.equal(search.type, "web_search_20260209");
  assert.equal(fetchTool.type, "web_fetch_20260209");
  assert.ok(search.allowed_domains.includes("perseus.tufts.edu"));
  assert.deepEqual(search.allowed_domains, fetchTool.allowed_domains);
});

test("the writer gets sources, images, passages, previous lessons and tomorrow", () => {
  const p = C.writeParams(topic, sources, { previous: [{ slug: "themistocles", title: "Themistocles", kind: "person", yearLabel: "c. 524–459 BC" }], tomorrow: { title: "Ostracism", kind: "idea" } });
  const text = p.messages[0].content.map((b) => b.text).join("\n");
  assert.match(text, /<article id="wiki-1" title="Battle of Salamis"/);
  assert.match(text, /File:A\.jpg \| A painting/);
  assert.match(text, /<passage id="p1" citation="Herodotus 8.90"/);
  assert.match(text, /themistocles \| Themistocles/);
  assert.match(text, /Ostracism \(idea\)/);
  // The long, stable system prompt is cached across lessons.
  assert.equal(p.system[0].cache_control.type, "ephemeral");
});

test("a revision includes the draft and every problem", () => {
  const p = C.reviseParams(topic, sources, {}, { title: "T", cards: [{ type: "story", text: "x", image: { file: "File:A.jpg" } }] }, [
    { card: 3, claim: "1,000 ships", problem: "Herodotus says 1,207", fix: "Use 1,207" },
  ]);
  const text = p.messages[0].content.map((b) => b.text).join("\n");
  assert.match(text, /Card 3: "1,000 ships". Herodotus says 1,207 Fix: Use 1,207/);
  assert.match(text, /<draft>/);
  assert.match(text, /"image": "File:A.jpg"/);
});

test("jsonFrom reads the last text block and refuses bad endings", () => {
  assert.deepEqual(C.jsonFrom({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"a":1}' }] }), { a: 1 });
  assert.throws(() => C.jsonFrom({ stop_reason: "refusal", content: [] }), /declined/);
  assert.throws(() => C.jsonFrom({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }), /out of room/);
  assert.throws(() => C.jsonFrom({ stop_reason: "end_turn", content: [{ type: "text", text: "nope" }] }), C.ModelOutputError);
});

test("schemas are structured-output safe", () => {
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const v of Object.values(node)) walk(v);
  };
  [C.SEASON_SCHEMA, C.PASSAGES_SCHEMA, C.ISSUES_SCHEMA, C.TOPIC_SCHEMA].forEach(walk);
});
