const test = require("node:test");
const assert = require("node:assert/strict");

// Set before requiring: keeps the module's .env.local fallback from loading
// real secrets into the test process.
process.env.CLERK_SECRET_KEY = "sk_test_placeholder";
const { requireUser, allowedUserIds, HttpError } = require("./budget-auth");

test("allowlists are read per env var and fail closed", () => {
  delete process.env.TOP5_EDITOR_USER_IDS;
  assert.deepEqual(allowedUserIds("TOP5_EDITOR_USER_IDS"), []);
  process.env.TOP5_EDITOR_USER_IDS = " user_a , ,user_b ";
  assert.deepEqual(allowedUserIds("TOP5_EDITOR_USER_IDS"), ["user_a", "user_b"]);
  process.env.BUDGET_ALLOWED_USER_IDS = "user_c";
  // The default is still Budgetter's list, so existing callers are unchanged.
  assert.deepEqual(allowedUserIds(), ["user_c"]);
});

test("a missing or non-bearer token is a 401", async () => {
  const is401 = (e) => e instanceof HttpError && e.status === 401;
  await assert.rejects(requireUser({ headers: {} }), is401);
  await assert.rejects(
    requireUser({ headers: { authorization: "Basic abc" } }, { allowlistEnv: "TOP5_EDITOR_USER_IDS" }),
    is401
  );
});

test("a garbage token is a 401, never a crash", async () => {
  await assert.rejects(
    requireUser({ headers: { authorization: "Bearer not-a-jwt" } }, { allowlistEnv: "TOP5_EDITOR_USER_IDS" }),
    (e) => e instanceof HttpError && e.status === 401
  );
});

test("a server without CLERK_SECRET_KEY answers 503", async () => {
  const saved = process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_SECRET_KEY;
  try {
    await assert.rejects(
      requireUser({ headers: { authorization: "Bearer x" } }),
      (e) => e instanceof HttpError && e.status === 503
    );
  } finally {
    process.env.CLERK_SECRET_KEY = saved;
  }
});
