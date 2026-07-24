// Shared Neon client + schema for /api/budget/* — same pattern as
// guestbook.js and reckoning.js, extended with a `budget_` table prefix so
// it can't collide with those. NOT an endpoint itself (the `_lib` prefix
// keeps Vercel from routing to it).
//
// Every table carries user_id — there is no cross-user query anywhere in
// this module or its callers. Amounts are stored as integer cents, positive
// = money out (a charge), negative = money in (a payment/credit/refund).
const { neon } = require("@neondatabase/serverless");

if (!process.env.POSTGRES_URL) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — getSql() below degrades gracefully */
  }
}

let sqlClient;
function getSql() {
  if (!process.env.POSTGRES_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.POSTGRES_URL);
  return sqlClient;
}

// Created once per warm instance, same lazy-singleton pattern as the other
// api/*.js functions in this repo — but with a failure reset: if the DDL
// pass rejects (Neon cold-start timeout, network blip), the cached promise
// is cleared so the NEXT request retries instead of replaying the same
// stale rejection for the life of the warm instance.
let ensured;
function ensureTables(sql) {
  if (!ensured) {
    ensured = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS budget_accounts (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          bank TEXT NOT NULL,
          label TEXT NOT NULL,
          last4 TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_upload_batches (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id INTEGER NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
          filename TEXT,
          row_count INTEGER NOT NULL DEFAULT 0,
          inserted_count INTEGER NOT NULL DEFAULT 0,
          duplicate_count INTEGER NOT NULL DEFAULT 0,
          rejected_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_transactions (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id INTEGER NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
          batch_id INTEGER REFERENCES budget_upload_batches(id) ON DELETE SET NULL,
          posted_date DATE NOT NULL,
          merchant_raw TEXT NOT NULL,
          merchant_clean TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'uncategorized',
          dedup_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (user_id, dedup_hash)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS budget_transactions_user_date_idx
          ON budget_transactions (user_id, posted_date DESC)
      `;
      // count_pct: how much of this charge counts toward totals. 100 =
      // normal, 50 = split ("half was my roommate's"), 0 = excluded
      // ("work reimbursed this"). Every aggregate multiplies by it;
      // amount_cents itself is never rewritten, so the original charge
      // stays auditable.
      await sql`
        ALTER TABLE budget_transactions
          ADD COLUMN IF NOT EXISTS count_pct INTEGER NOT NULL DEFAULT 100
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_category_rules (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          pattern TEXT NOT NULL,
          category TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (user_id, pattern)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_budgets (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          category TEXT NOT NULL,
          monthly_cents INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (user_id, category)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_recurring (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          label TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Bills',
          amount_cents INTEGER NOT NULL,
          due_day INTEGER,
          start_month TEXT NOT NULL,
          end_month TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // on_card: this bill is charged to a tracked credit card, so its
      // real charges arrive via statement upload — the dashboard must NOT
      // also count the recurring amount (that would double-count). Additive
      // migration for tables created before the column existed.
      await sql`
        ALTER TABLE budget_recurring
          ADD COLUMN IF NOT EXISTS on_card BOOLEAN NOT NULL DEFAULT FALSE
      `;
      // paid_from: which account the bill comes out of ("Chequing",
      // "Joint chequing", "Amex"…). Free-text label for display and
      // reconciling against that account's statement — no dashboard math
      // reads it.
      await sql`
        ALTER TABLE budget_recurring
          ADD COLUMN IF NOT EXISTS paid_from TEXT
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_income (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          label TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          cadence TEXT NOT NULL DEFAULT 'monthly',
          start_month TEXT NOT NULL,
          end_month TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((err) => {
      ensured = undefined; // let the next request retry
      throw err;
    });
  }
  return ensured;
}

/** Does this account belong to this user? Every ingest/list call checks this. */
async function accountBelongsToUser(sql, accountId, userId) {
  const rows = await sql`
    SELECT id FROM budget_accounts WHERE id = ${accountId} AND user_id = ${userId}
  `;
  return rows.length > 0;
}

module.exports = { getSql, ensureTables, accountBelongsToUser };
