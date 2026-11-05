// Schema + queries for /api/pantry. Same Neon database as Budgetter and
// Bowler, `pantry_` table prefix so nothing can collide. NOT an endpoint.
//
// One shared pantry: everyone on the allowlist sees and edits the same
// stock, and `created_by` is attribution only.
//
//   pantry_items     the stock. qty is packs on hand, in quarter steps so
//                    "a little left" is 0.25. `staple` is null for "decide
//                    for me" (bought twice → keep it stocked).
//   pantry_events    its history. Every receipt line is a 'bought' event and
//                    the purchase days drive the "usually every N days"
//                    guess in pantry-stock.js.
//   pantry_receipts  header only (store, day, total). Photos are never kept.
//   pantry_aliases   which item a receipt's printed text meant, learned from
//                    every saved review, so "NN 2% MLK 4L" matches next time
//                    without a guess.
//   pantry_list      free-text extras ("birthday candles"). Out and low
//                    items join the shopping list on their own.
//   pantry_push      phones that get the reminders.
//   pantry_meta      small JSON state: last recipes, the digest's memory.
//
// Days go out as "YYYY-MM-DD" text (::text / to_char), never JS Dates, so
// there's no timezone to get wrong between Neon, Node and the phone.
const { getSql } = require("./budget-db");
const { TZ } = require("./pantry-stock");

let ensured = false;

async function ensurePantryTables(sql) {
  if (ensured) return;
  // One round trip on a cold start. Every statement is idempotent.
  await sql.transaction([
    sql`
      CREATE TABLE IF NOT EXISTS pantry_items (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        name_key        TEXT NOT NULL UNIQUE,
        category        TEXT NOT NULL DEFAULT 'other',
        location        TEXT NOT NULL DEFAULT 'pantry',
        qty             NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (qty >= 0),
        low_at          NUMERIC(7,2) NOT NULL DEFAULT 0.25 CHECK (low_at >= 0),
        staple          BOOLEAN,
        shelf_days      SMALLINT CHECK (shelf_days BETWEEN 1 AND 3650),
        last_bought_on  DATE,
        counted_at      TIMESTAMPTZ,
        snooze_until    DATE,
        archived        BOOLEAN NOT NULL DEFAULT FALSE,
        created_by      TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_receipts (
        id            SERIAL PRIMARY KEY,
        store         TEXT,
        purchased_on  DATE NOT NULL,
        total_cents   INTEGER,
        fingerprint   TEXT,
        line_count    SMALLINT NOT NULL,
        created_by    TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_events (
        id           SERIAL PRIMARY KEY,
        item_id      INTEGER NOT NULL REFERENCES pantry_items(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK (kind IN ('bought', 'used', 'set', 'low', 'out', 'cooked')),
        qty_delta    NUMERIC(7,2) NOT NULL DEFAULT 0,
        receipt_id   INTEGER REFERENCES pantry_receipts(id) ON DELETE CASCADE,
        price_cents  INTEGER,
        on_day       DATE NOT NULL,
        created_by   TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS pantry_events_item_day ON pantry_events (item_id, kind, on_day)`,
    sql`CREATE INDEX IF NOT EXISTS pantry_events_receipt ON pantry_events (receipt_id)`,
    sql`CREATE INDEX IF NOT EXISTS pantry_receipts_fp ON pantry_receipts (fingerprint)`,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_aliases (
        raw_key  TEXT PRIMARY KEY,
        item_id  INTEGER NOT NULL REFERENCES pantry_items(id) ON DELETE CASCADE
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_list (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        name_key    TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_push (
        endpoint    TEXT PRIMARY KEY,
        keys        JSONB NOT NULL,
        user_id     TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS pantry_meta (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,
  ]);
  ensured = true;
}

const num = (v) => (v == null ? null : Number(v));

function toApi(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    qty: num(row.qty),
    lowAt: num(row.low_at),
    staple: row.staple,
    shelfDays: row.shelf_days,
    lastBoughtOn: row.last_bought_on,
    countedOn: row.counted_on,
    snoozeUntil: row.snooze_until,
    archived: row.archived,
    purchases: row.purchases || [],
    unitCents: num(row.unit_cents),
  };
}

// The last dozen purchase days and the latest per-pack price ride along with
// each item; both are small lateral lookups on the (item_id, kind, on_day)
// index.
async function selectItems(sql, { id = null, includeArchived = false } = {}) {
  const rows = await sql`
    SELECT i.id, i.name, i.category, i.location, i.qty, i.low_at, i.staple, i.shelf_days,
           i.last_bought_on::text AS last_bought_on,
           to_char(i.counted_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS counted_on,
           i.snooze_until::text AS snooze_until,
           i.archived,
           COALESCE(p.days, '{}') AS purchases,
           lp.unit_cents
      FROM pantry_items i
      LEFT JOIN LATERAL (
        SELECT array_agg(d::text ORDER BY d) AS days FROM (
          SELECT DISTINCT on_day AS d FROM pantry_events
           WHERE item_id = i.id AND kind = 'bought'
           ORDER BY d DESC LIMIT 12
        ) recent
      ) p ON TRUE
      LEFT JOIN LATERAL (
        SELECT round(price_cents / qty_delta) AS unit_cents FROM pantry_events
         WHERE item_id = i.id AND kind = 'bought' AND price_cents > 0 AND qty_delta > 0
         ORDER BY on_day DESC, id DESC LIMIT 1
      ) lp ON TRUE
     WHERE (${id}::int IS NULL OR i.id = ${id}::int)
       AND (${includeArchived}::boolean OR NOT i.archived)
     ORDER BY i.name_key
  `;
  return rows.map(toApi);
}

const listItems = (sql, opts) => selectItems(sql, opts);

async function getItem(sql, id) {
  const [item] = await selectItems(sql, { id, includeArchived: true });
  return item || null;
}

async function listAliases(sql) {
  const rows = await sql`SELECT raw_key, item_id FROM pantry_aliases`;
  return new Map(rows.map((r) => [r.raw_key, r.item_id]));
}

async function listReceipts(sql) {
  return sql`
    SELECT id, store, purchased_on::text AS "purchasedOn", total_cents AS "totalCents",
           line_count AS "lineCount"
      FROM pantry_receipts
     ORDER BY purchased_on DESC, id DESC
     LIMIT 20
  `;
}

async function findReceipt(sql, fingerprint) {
  if (!fingerprint) return null;
  const [row] = await sql`
    SELECT id, purchased_on::text AS "purchasedOn" FROM pantry_receipts
     WHERE fingerprint = ${fingerprint} LIMIT 1
  `;
  return row || null;
}

/**
 * Save a reviewed receipt atomically: the header, new items, a 'bought'
 * event per item, restocks, learned aliases, and list extras it satisfies.
 * `plan` comes from planReceipt(), so no two rows target the same item.
 */
async function saveReceipt(sql, userId, receipt, plan, fingerprint) {
  const day = receipt.purchasedOn;
  const fresh = JSON.stringify(plan.fresh);
  const existing = JSON.stringify(plan.existing);
  const results = await sql.transaction([
    sql`
      WITH r AS (
        INSERT INTO pantry_receipts (store, purchased_on, total_cents, fingerprint, line_count, created_by)
        VALUES (${receipt.store}, ${day}::date, ${receipt.totalCents}, ${fingerprint},
                ${receipt.lines.length}, ${userId})
        RETURNING id
      ), f AS (
        INSERT INTO pantry_items (name, name_key, category, location, qty, shelf_days,
                                  last_bought_on, created_by)
        SELECT l.name, l.name_key, l.category, l.location, l.qty, l.shelf_days, ${day}::date, ${userId}
          FROM jsonb_to_recordset(${fresh}::jsonb)
            AS l(name text, name_key text, category text, location text, qty numeric, shelf_days int)
        RETURNING id, name_key
      ), lines AS (
        SELECT f.id AS item_id, l.qty, l.price_cents
          FROM jsonb_to_recordset(${fresh}::jsonb) AS l(name_key text, qty numeric, price_cents int)
          JOIN f USING (name_key)
        UNION ALL
        SELECT l.item_id, l.qty, l.price_cents
          FROM jsonb_to_recordset(${existing}::jsonb) AS l(item_id int, qty numeric, price_cents int)
      )
      INSERT INTO pantry_events (item_id, kind, qty_delta, receipt_id, price_cents, on_day, created_by)
      SELECT lines.item_id, 'bought', lines.qty, r.id, lines.price_cents, ${day}::date, ${userId}
        FROM lines CROSS JOIN r
      RETURNING receipt_id
    `,
    // An older receipt never moves last_bought_on backwards (GREATEST skips NULL).
    sql`
      UPDATE pantry_items i
         SET qty = LEAST(999, i.qty + l.qty),
             last_bought_on = GREATEST(i.last_bought_on, ${day}::date),
             shelf_days = COALESCE(i.shelf_days, l.shelf_days),
             archived = FALSE,
             snooze_until = NULL,
             updated_at = now()
        FROM jsonb_to_recordset(${existing}::jsonb) AS l(item_id int, qty numeric, shelf_days int)
       WHERE i.id = l.item_id
    `,
    sql`
      INSERT INTO pantry_aliases (raw_key, item_id)
      SELECT a.raw_key, i.id
        FROM jsonb_to_recordset(${JSON.stringify(plan.aliases)}::jsonb) AS a(raw_key text, name_key text)
        JOIN pantry_items i ON i.name_key = a.name_key
      ON CONFLICT (raw_key) DO UPDATE SET item_id = EXCLUDED.item_id
    `,
    sql`DELETE FROM pantry_list WHERE name_key = ANY(${plan.keys}::text[]) RETURNING id`,
  ]);
  const receiptId = results[0][0] ? results[0][0].receipt_id : null;
  return { receiptId, listCleared: results[3].length };
}

/** Undo a receipt: take its purchases back off the shelf, then forget it. */
async function deleteReceipt(sql, id) {
  const results = await sql.transaction([
    sql`
      UPDATE pantry_items i
         SET qty = GREATEST(0, i.qty - e.total), updated_at = now()
        FROM (SELECT item_id, SUM(qty_delta) AS total FROM pantry_events
               WHERE receipt_id = ${id} GROUP BY item_id) e
       WHERE i.id = e.item_id
       RETURNING i.id
    `,
    sql`DELETE FROM pantry_receipts WHERE id = ${id} RETURNING id`,
  ]);
  const touched = results[0].map((r) => r.id);
  if (touched.length) {
    await sql`
      UPDATE pantry_items i
         SET last_bought_on = (SELECT max(on_day) FROM pantry_events
                                WHERE item_id = i.id AND kind = 'bought')
       WHERE i.id = ANY(${touched}::int[])
    `;
  }
  return results[1].length > 0;
}

/**
 * One quick change to one item, logged as an event with the real delta.
 *   use / add  ± n packs ("add" is "bought one", so it counts as a purchase)
 *   set        the count is n
 *   low        down to the low mark ("a little left") if it was above it
 *   out        0
 * Everything but "add" stamps counted_at: someone looked, which beats the
 * cadence guess.
 */
async function adjustItem(sql, userId, { id, op, n, kind }, today) {
  const rows = await sql`
    WITH old AS (SELECT id, qty FROM pantry_items WHERE id = ${id}),
    upd AS (
      UPDATE pantry_items i SET
        qty = CASE ${op}::text
                WHEN 'use' THEN GREATEST(0, i.qty - ${n}::numeric)
                WHEN 'add' THEN LEAST(999, i.qty + ${n}::numeric)
                WHEN 'set' THEN ${n}::numeric
                WHEN 'out' THEN 0
                WHEN 'low' THEN LEAST(i.qty, GREATEST(i.low_at, 0.25))
              END,
        counted_at = CASE WHEN ${op}::text = 'add' THEN i.counted_at ELSE now() END,
        last_bought_on = CASE WHEN ${op}::text = 'add'
                              THEN GREATEST(i.last_bought_on, ${today}::date)
                              ELSE i.last_bought_on END,
        snooze_until = CASE WHEN ${op}::text = 'add' THEN NULL ELSE i.snooze_until END,
        archived = FALSE,
        updated_at = now()
      FROM old WHERE i.id = old.id
      RETURNING i.id, i.qty, old.qty AS old_qty
    )
    INSERT INTO pantry_events (item_id, kind, qty_delta, on_day, created_by)
    SELECT id, ${kind}, qty - old_qty, ${today}::date, ${userId} FROM upd
    RETURNING item_id, qty_delta
  `;
  return rows[0] || null;
}

async function dismissItem(sql, { id, mode }, today) {
  const rows =
    mode === "archive"
      ? await sql`UPDATE pantry_items SET archived = TRUE, updated_at = now() WHERE id = ${id} RETURNING id`
      : await sql`
          UPDATE pantry_items SET snooze_until = ${today}::date + 7, updated_at = now()
           WHERE id = ${id} RETURNING id
        `;
  return rows.length > 0;
}

/** Create (no id) or edit an item. Returns null on a name clash. */
async function saveItem(sql, userId, item) {
  if (item.id == null) {
    const rows = await sql`
      INSERT INTO pantry_items (name, name_key, category, location, qty, low_at, staple,
                                shelf_days, counted_at, created_by)
      VALUES (${item.name}, ${item.key}, ${item.category}, ${item.location}, ${item.qty},
              ${item.lowAt}, ${item.staple}, ${item.shelfDays}, now(), ${userId})
      ON CONFLICT (name_key) DO NOTHING
      RETURNING id
    `;
    return rows[0] ? rows[0].id : null;
  }
  try {
    const rows = await sql`
      UPDATE pantry_items
         SET name = ${item.name}, name_key = ${item.key}, category = ${item.category},
             location = ${item.location}, low_at = ${item.lowAt}, staple = ${item.staple},
             shelf_days = ${item.shelfDays}, updated_at = now()
       WHERE id = ${item.id}
       RETURNING id
    `;
    return rows[0] ? rows[0].id : undefined;
  } catch (err) {
    if (err && err.code === "23505") return null; // another item has that name
    throw err;
  }
}

async function deleteItem(sql, id) {
  const rows = await sql`DELETE FROM pantry_items WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function listExtras(sql) {
  return sql`SELECT id, name FROM pantry_list ORDER BY created_at, id`;
}

async function addExtra(sql, userId, { name, key }) {
  const [row] = await sql`
    INSERT INTO pantry_list (name, name_key, created_by)
    SELECT ${name}, ${key}, ${userId}
     WHERE NOT EXISTS (SELECT 1 FROM pantry_list WHERE name_key = ${key})
    RETURNING id, name
  `;
  return row || null;
}

async function deleteExtra(sql, id) {
  const rows = await sql`DELETE FROM pantry_list WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

async function getMeta(sql, key) {
  const [row] = await sql`SELECT value FROM pantry_meta WHERE key = ${key}`;
  return row ? row.value : null;
}

async function setMeta(sql, key, value) {
  await sql`
    INSERT INTO pantry_meta (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

async function savePush(sql, userId, sub) {
  await sql`
    INSERT INTO pantry_push (endpoint, keys, user_id)
    VALUES (${sub.endpoint}, ${JSON.stringify(sub.keys)}::jsonb, ${userId})
    ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys, user_id = EXCLUDED.user_id
  `;
}

async function deletePush(sql, endpoint) {
  await sql`DELETE FROM pantry_push WHERE endpoint = ${endpoint}`;
}

async function listPush(sql) {
  return sql`SELECT endpoint, keys, user_id AS "userId" FROM pantry_push`;
}

module.exports = {
  getSql,
  ensurePantryTables,
  listItems,
  getItem,
  listAliases,
  listReceipts,
  findReceipt,
  saveReceipt,
  deleteReceipt,
  adjustItem,
  dismissItem,
  saveItem,
  deleteItem,
  listExtras,
  addExtra,
  deleteExtra,
  getMeta,
  setMeta,
  savePush,
  deletePush,
  listPush,
};
