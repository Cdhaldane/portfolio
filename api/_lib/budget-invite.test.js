// Run with `npm run test:api` (node's built-in runner). CRA's jest only
// collects tests under src/, so server-side helpers are tested here instead.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALPHABET,
  CODE_LENGTH,
  newInviteCode,
  normalizeInviteCode,
  hashInviteCode,
  inviteExpiry,
} = require("./budget-invite");

test("newInviteCode mints a hyphenated code from the safe alphabet", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newInviteCode();
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    for (const ch of code.replace("-", "")) {
      assert.ok(ALPHABET.includes(ch), `${ch} is not in the safe alphabet`);
    }
  }
});

test("newInviteCode avoids look-alike characters entirely", () => {
  const codes = Array.from({ length: 500 }, newInviteCode).join("");
  for (const banned of ["I", "L", "O", "U", "0", "1"]) {
    assert.ok(!codes.includes(banned), `minted a code containing ${banned}`);
  }
});

test("newInviteCode does not repeat itself", () => {
  const seen = new Set(Array.from({ length: 500 }, newInviteCode));
  assert.equal(seen.size, 500);
});

test("normalizeInviteCode accepts every readable spelling of one code", () => {
  const expected = "K7QP3MTZ";
  for (const variant of ["K7QP-3MTZ", "k7qp-3mtz", "K7QP 3MTZ", "k7qp3mtz", " K7QP--3MTZ "]) {
    assert.equal(normalizeInviteCode(variant), expected, `failed on ${variant}`);
  }
});

test("normalizeInviteCode rejects malformed input instead of coercing it", () => {
  for (const bad of ["", null, undefined, "SHORT", "TOOLONGCODE", "K7QP-3MT!", 12345678, {}]) {
    assert.equal(normalizeInviteCode(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("normalizeInviteCode rejects right-length codes using banned letters", () => {
  // 8 chars, but O/I/L/U are not in the alphabet — a typo, not a real code.
  for (const bad of ["OOOOOOOO", "K7QP3MTI", "LLLLLLLL", "K7QP3MT0"]) {
    assert.equal(normalizeInviteCode(bad), null, `should reject ${bad}`);
  }
});

test("hashInviteCode is stable across formatting and never reversible-looking", () => {
  const a = hashInviteCode("K7QP-3MTZ");
  const b = hashInviteCode("k7qp3mtz");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.ok(!a.includes("K7QP"));
});

test("hashInviteCode separates distinct codes", () => {
  assert.notEqual(hashInviteCode("K7QP-3MTZ"), hashInviteCode("K7QP-3MTY"));
});

test("hashInviteCode returns null for malformed codes (never hashes '')", () => {
  assert.equal(hashInviteCode(""), null);
  assert.equal(hashInviteCode("nope"), null);
  assert.equal(hashInviteCode(null), null);
});

test("codes are CODE_LENGTH characters before formatting", () => {
  assert.equal(normalizeInviteCode(newInviteCode()).length, CODE_LENGTH);
});

test("inviteExpiry is seven days out from the given instant", () => {
  const from = new Date("2026-07-29T12:00:00Z");
  assert.equal(inviteExpiry(from).toISOString(), "2026-08-05T12:00:00.000Z");
});
