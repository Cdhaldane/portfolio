// Shared Neon client + schema for /api/budget/* — same pattern as
// guestbook.js and reckoning.js, extended with a `budget_` table prefix so
// it can't collide with those. NOT an endpoint itself (the `_lib` prefix
// keeps Vercel from routing to it).
//
// TENANCY: every data table carries `household_id` and every query filters
// by it. A household is one-to-many with people (budget_household_members),
// so a couple shares one ledger. The older `user_id` column survives on
// every table but its meaning is now ATTRIBUTION ONLY — "which member
// created this row". It is never a tenancy filter. (For rows that predate
// households the two are the same value, which is why the backfill below is
// exact rather than a guess.)
//
// Amounts are stored as integer cents, positive = money out (a charge),
// negative = money in (a payment/credit/refund).
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

// Bumped when a migration below needs to run once. Stored in budget_meta so
// warm-instance cold starts pay one cheap SELECT instead of replaying ~25
// idempotent DDL/backfill round trips against Neon every time.
const SCHEMA_VERSION = 2;

// Tables whose rows belong to a household. Order matters only for the FK to
// budget_accounts, which is declared in the CREATE statements themselves.
const TENANT_TABLES = [
  "budget_accounts",
  "budget_upload_batches",
  "budget_transactions",
  "budget_category_rules",
  "budget_budgets",
  "budget_recurring",
  "budget_income",
];

let sqlClient;
function getSql() {
  if (!process.env.POSTGRES_URL) return null;
  if (!sqlClient) sqlClient = neon(process.env.POSTGRES_URL);
  return sqlClient;
}

/**
 * One-time (per database) move from per-user rows to per-household rows.
 * Every statement is independently idempotent, so a concurrent cold start
 * running this at the same time is harmless.
 */
async function migrateToHouseholds(sql) {
  // 1. A household per person who already has data, owned by them. The
  //    UNIQUE on owner_user_id makes this replay-safe.
  await sql`
    INSERT INTO budget_households (owner_user_id, name)
    SELECT DISTINCT user_id, 'My household' FROM (
      SELECT user_id FROM budget_accounts
      UNION SELECT user_id FROM budget_upload_batches
      UNION SELECT user_id FROM budget_transactions
      UNION SELECT user_id FROM budget_category_rules
      UNION SELECT user_id FROM budget_budgets
      UNION SELECT user_id FROM budget_recurring
      UNION SELECT user_id FROM budget_income
    ) existing
    ON CONFLICT (owner_user_id) DO NOTHING
  `;
  await sql`
    INSERT INTO budget_household_members (household_id, user_id, role)
    SELECT id, owner_user_id, 'owner' FROM budget_households
    ON CONFLICT (household_id, user_id) DO NOTHING
  `;

  // 2. household_id on every tenant table, backfilled from the owner map.
  //    (Declared in the CREATE statements too, so a fresh database skips
  //    straight past these as no-ops.)
  // sql.query() (not the tagged template) is the driver's plain-string form —
  // required here because the table name is interpolated. Names come only
  // from the hardcoded TENANT_TABLES list above, never from a request.
  for (const table of TENANT_TABLES) {
    await sql.query(
      `ALTER TABLE ${table}
         ADD COLUMN IF NOT EXISTS household_id INTEGER
         REFERENCES budget_households(id) ON DELETE CASCADE`
    );
    await sql.query(
      `UPDATE ${table} t SET household_id = h.id
         FROM budget_households h
        WHERE h.owner_user_id = t.user_id AND t.household_id IS NULL`
    );
    await sql.query(
      `CREATE INDEX IF NOT EXISTS ${table}_household_idx ON ${table} (household_id)`
    );
  }
  await sql`
    CREATE INDEX IF NOT EXISTS budget_transactions_household_date_idx
      ON budget_transactions (household_id, posted_date DESC)
  `;

  // 3. member_user_id on accounts: WHOSE card this is, which is not the same
  //    question as who uploaded the statement. Spend-per-person reads this;
  //    it defaults to the creator.
  await sql`ALTER TABLE budget_accounts ADD COLUMN IF NOT EXISTS member_user_id TEXT`;
  await sql`
    UPDATE budget_accounts SET member_user_id = user_id WHERE member_user_id IS NULL
  `;

  // 4. Re-key the uniqueness rules from user to household. Create the new
  //    index BEFORE dropping the old constraint so there is never a window
  //    without protection. Postgres can infer ON CONFLICT from a unique
  //    index, so upsert call sites keep working.
  //
  //    NOTE for budget_transactions: household_id maps 1:1 onto the old
  //    user_id for every backfilled row, so this swap cannot surface a new
  //    conflict. dedup_hash values themselves are NOT re-keyed — see the
  //    hash-scope note in budget-household.js.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS budget_transactions_household_dedup_uidx
      ON budget_transactions (household_id, dedup_hash)
  `;
  await sql`
    ALTER TABLE budget_transactions
      DROP CONSTRAINT IF EXISTS budget_transactions_user_id_dedup_hash_key
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS budget_category_rules_household_pattern_uidx
      ON budget_category_rules (household_id, pattern)
  `;
  await sql`
    ALTER TABLE budget_category_rules
      DROP CONSTRAINT IF EXISTS budget_category_rules_user_id_pattern_key
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS budget_budgets_household_category_uidx
      ON budget_budgets (household_id, category)
  `;
  await sql`
    ALTER TABLE budget_budgets
      DROP CONSTRAINT IF EXISTS budget_budgets_user_id_category_key
  `;

  // 5. Lock household_id down — but only once every row actually has one.
  //    A stray NULL would make the row invisible to every query (filters are
  //    `household_id = N`), never visible to the wrong household, so a
  //    logged skip is a safer outcome here than failing every request on
  //    this instance.
  for (const table of TENANT_TABLES) {
    const [{ count }] = await sql.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE household_id IS NULL`
    );
    if (count > 0) {
      console.warn(
        `Budget schema: ${table} still has ${count} row(s) without a household_id — leaving the column nullable.`
      );
      continue;
    }
    await sql.query(`ALTER TABLE ${table} ALTER COLUMN household_id SET NOT NULL`);
  }

  await sql`
    INSERT INTO budget_meta (key, value) VALUES ('schema_version', ${String(SCHEMA_VERSION)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
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
        CREATE TABLE IF NOT EXISTS budget_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `;
      // A household is the tenancy unit. owner_user_id is UNIQUE: you own at
      // most one, which keeps the backfill and "which household am I in?"
      // resolution unambiguous.
      await sql`
        CREATE TABLE IF NOT EXISTS budget_households (
          id SERIAL PRIMARY KEY,
          owner_user_id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL DEFAULT 'My household',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // removed_at instead of DELETE: a departed member's name must still
      // resolve for the rows they created ("Added by Sarah"), and every
      // membership check filters on removed_at IS NULL.
      await sql`
        CREATE TABLE IF NOT EXISTS budget_household_members (
          id SERIAL PRIMARY KEY,
          household_id INTEGER NOT NULL REFERENCES budget_households(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member',
          display_name TEXT,
          joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          removed_at TIMESTAMPTZ,
          UNIQUE (household_id, user_id)
        )
      `;
      // One ACTIVE household per person — the partial index lets an old
      // removed row coexist with a current membership elsewhere.
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS budget_household_members_active_uidx
          ON budget_household_members (user_id) WHERE removed_at IS NULL
      `;
      // Only the sha256 of an invite code is stored — a leaked database row
      // can't be redeemed. The plaintext is shown to the inviter once.
      await sql`
        CREATE TABLE IF NOT EXISTS budget_household_invites (
          id SERIAL PRIMARY KEY,
          household_id INTEGER NOT NULL REFERENCES budget_households(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL UNIQUE,
          label TEXT,
          created_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          redeemed_by TEXT,
          redeemed_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_accounts (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
          member_user_id TEXT,
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
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
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
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES budget_accounts(id) ON DELETE CASCADE,
          batch_id INTEGER REFERENCES budget_upload_batches(id) ON DELETE SET NULL,
          posted_date DATE NOT NULL,
          merchant_raw TEXT NOT NULL,
          merchant_clean TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          category TEXT NOT NULL DEFAULT 'uncategorized',
          dedup_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
          pattern TEXT NOT NULL,
          category TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_budgets (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          monthly_cents INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS budget_recurring (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
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
          household_id INTEGER REFERENCES budget_households(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          cadence TEXT NOT NULL DEFAULT 'monthly',
          start_month TEXT NOT NULL,
          end_month TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      const versionRows = await sql`
        SELECT value FROM budget_meta WHERE key = 'schema_version'
      `;
      const current = versionRows.length ? Number(versionRows[0].value) || 0 : 0;
      if (current < SCHEMA_VERSION) {
        await migrateToHouseholds(sql);
      }
    })().catch((err) => {
      ensured = undefined; // let the next request retry
      throw err;
    });
  }
  return ensured;
}

/** Does this account belong to this household? Every ingest/list call checks. */
async function accountInHousehold(sql, accountId, householdId) {
  const rows = await sql`
    SELECT id FROM budget_accounts
     WHERE id = ${accountId} AND household_id = ${householdId}
  `;
  return rows.length > 0;
}

module.exports = { getSql, ensureTables, accountInHousehold, SCHEMA_VERSION };
