// Vercel serverless function — POST /api/budget/upload
//
// Body: { accountId, filename?, rows: [{ postedDate, merchantRaw, amountCents }], commit }
//
// Two-phase by design (matches the "review before commit" step in the ingest
// plan): commit defaults to false (a strict `=== true` check, not just
// truthy) so a client bug can never silently write data. The dry-run and
// commit passes share every validation/normalization step; only the commit
// pass touches the database for writes.
//
// Trust boundary: the client sends only postedDate/merchantRaw/amountCents.
// merchant_clean, category, and dedup_hash are always derived server-side —
// a client can't forge a hash to bypass dedup, or a category to bypass the
// rules table. accountId is re-checked against the caller's own accounts on
// every request; there is no path from one user's upload into another
// user's data.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables, accountBelongsToUser } = require("../budget-db");
const {
  MAX_ROWS_PER_UPLOAD,
  FILENAME_MAX,
  normalizeRow,
  cleanMerchant,
  dedupHash,
  categoryFor,
} = require("../budget-normalize");

module.exports = async (req, res) => {
  let userId;
  try {
    ({ userId } = await requireUser(req));
  } catch (err) {
    return sendAuthError(res, err);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) {
    return res.status(503).json({ error: "The database isn't configured yet." });
  }

  try {
    await ensureTables(sql);

    const accountId = parseInt(req.body?.accountId, 10);
    if (!Number.isInteger(accountId)) {
      return res.status(400).json({ error: "A valid accountId is required." });
    }
    if (!(await accountBelongsToUser(sql, accountId, userId))) {
      return res.status(404).json({ error: "No such account." });
    }

    const filename = String(req.body?.filename || "").trim().slice(0, FILENAME_MAX);
    const commit = req.body?.commit === true;

    const rawRows = req.body?.rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: "No rows to import." });
    }
    if (rawRows.length > MAX_ROWS_PER_UPLOAD) {
      return res.status(400).json({
        error: `A single upload is capped at ${MAX_ROWS_PER_UPLOAD} rows — split the file and try again.`,
      });
    }

    // 1. Validate every row. Bad rows are dropped with a reason, not fatal.
    // Identical (date, amount, merchant) tuples within the file get an
    // occurrence index folded into their hash — the Nth identical row is a
    // REAL repeat purchase (two same-priced coffees), not a duplicate; only
    // re-uploading the same file reproduces the same (tuple, N) pairs.
    const rejectedSamples = [];
    const candidates = [];
    const occurrenceCounter = new Map();
    for (const raw of rawRows) {
      const result = normalizeRow(raw);
      if (!result.valid) {
        if (rejectedSamples.length < 5) rejectedSamples.push(result.reason);
        continue;
      }
      const merchantClean = cleanMerchant(result.merchantRaw);
      const tupleKey = `${result.postedDate}|${result.amountCents}|${merchantClean}`;
      const occurrence = occurrenceCounter.get(tupleKey) || 0;
      occurrenceCounter.set(tupleKey, occurrence + 1);
      const hash = dedupHash(
        userId,
        accountId,
        result.postedDate,
        result.amountCents,
        merchantClean,
        occurrence
      );
      candidates.push({ ...result, merchantClean, hash });
    }
    const rejectedCount = rawRows.length - candidates.length;

    // 2. Dedupe *within this upload* — now only true duplicates (the same
    // hash including occurrence index) collapse, e.g. the same file
    // concatenated twice.
    const seen = new Map();
    for (const row of candidates) {
      if (!seen.has(row.hash)) seen.set(row.hash, row);
    }
    const withinBatchDuplicates = candidates.length - seen.size;

    // 3. Apply the user's category rules. Longest pattern first so the most
    // specific rule wins deterministically ("UBER EATS" beats "UBER")
    // regardless of Postgres row order; categorize.js uses the same order.
    const rules = await sql`
      SELECT pattern, category FROM budget_category_rules
       WHERE user_id = ${userId}
       ORDER BY length(pattern) DESC, pattern ASC
    `;
    const uniqueRows = Array.from(seen.values()).map((row) => ({
      ...row,
      category: categoryFor(row.merchantClean, rules),
    }));

    // 4. Split against what's already stored for this account.
    const existing = await sql`
      SELECT dedup_hash FROM budget_transactions
       WHERE user_id = ${userId} AND account_id = ${accountId}
    `;
    const existingHashes = new Set(existing.map((r) => r.dedup_hash));
    const toInsert = uniqueRows.filter((r) => !existingHashes.has(r.hash));
    const alreadyStored = uniqueRows.length - toInsert.length;
    const duplicateCount = withinBatchDuplicates + alreadyStored;
    const uncategorizedCount = toInsert.filter((r) => r.category === "uncategorized").length;

    if (!commit) {
      return res.status(200).json({
        ok: true,
        commit: false,
        totalRows: rawRows.length,
        newCount: toInsert.length,
        duplicateCount,
        rejectedCount,
        rejectedSamples,
        categorizedCount: toInsert.length - uncategorizedCount,
        uncategorizedCount,
      });
    }

    // Commit: record the batch, then bulk-insert via one transaction() call
    // (a single HTTP round trip) rather than one request per row. The DB's
    // own UNIQUE(user_id, dedup_hash) + ON CONFLICT DO NOTHING is the actual
    // source of truth for what gets inserted — safe even if a concurrent
    // upload raced this one for the same rows; the pre-check above is only
    // an optimization, not what's trusted.
    const [batch] = await sql`
      INSERT INTO budget_upload_batches
        (user_id, account_id, filename, row_count, inserted_count, duplicate_count, rejected_count)
      VALUES
        (${userId}, ${accountId}, ${filename || null}, ${rawRows.length}, ${toInsert.length}, ${duplicateCount}, ${rejectedCount})
      RETURNING id
    `;

    let insertedCount = 0;
    if (toInsert.length > 0) {
      const results = await sql.transaction(
        toInsert.map(
          (row) => sql`
            INSERT INTO budget_transactions
              (user_id, account_id, batch_id, posted_date, merchant_raw, merchant_clean, amount_cents, category, dedup_hash)
            VALUES
              (${userId}, ${accountId}, ${batch.id}, ${row.postedDate}, ${row.merchantRaw}, ${row.merchantClean}, ${row.amountCents}, ${row.category}, ${row.hash})
            ON CONFLICT (user_id, dedup_hash) DO NOTHING
            RETURNING id
          `
        )
      );
      insertedCount = results.reduce((sum, r) => sum + r.length, 0);
    }

    // The batch row was written with the *predicted* insert count; correct
    // it with what the transaction actually inserted (a concurrent upload
    // racing the pre-check can make them differ).
    if (insertedCount !== toInsert.length) {
      await sql`
        UPDATE budget_upload_batches
           SET inserted_count = ${insertedCount},
               duplicate_count = ${duplicateCount + (toInsert.length - insertedCount)}
         WHERE id = ${batch.id} AND user_id = ${userId}
      `;
    }

    return res.status(200).json({
      ok: true,
      commit: true,
      batchId: batch.id,
      insertedCount,
      duplicateCount: Math.max(0, rawRows.length - insertedCount - rejectedCount),
      rejectedCount,
    });
  } catch (err) {
    console.error("Budget upload error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
