// Vercel serverless function — POST /api/budget/upload
//
// Body: { accountId, filename?, commit,
//          rows: [{ postedDate, merchantRaw, amountCents, countPct? }] }
//
// Two-phase by design (matches the "review before commit" step in the ingest
// plan): commit defaults to false (a strict `=== true` check, not just
// truthy) so a client bug can never silently write data. The dry-run and
// commit passes share every validation/normalization step; only the commit
// pass touches the database for writes.
//
// Trust boundary: the client sends only postedDate/merchantRaw/amountCents
// plus an optional countPct. merchant_clean, category, and dedup_hash are
// always derived server-side — a client can't forge a hash to bypass dedup,
// or a category to bypass the rules table. accountId is re-checked against
// the caller's own HOUSEHOLD on every request; there is no path from one
// household's upload into another household's data.
//
// countPct is the one client *decision* accepted here (how much of a row
// counts toward totals), and only within the validated 0-100 range. It
// exists for chequing statements, where most rows are money moving rather
// than money spent: the dry-run returns a suggested treatment per row, the
// user confirms or flips each one, and the commit sends the result back. A
// row that arrives WITHOUT a countPct falls back to the server's own
// suggestion, never to a bare 100 — so a client bug cannot silently
// resurrect the double-counting the suggestions exist to prevent.
//
// Dedup is household-wide and salted with household.hashScope (the owner's
// user id), NOT the uploader's — so either member can upload the same
// statement and the second one dedupes instead of double-importing.
const { requireUser, sendAuthError } = require("../budget-auth");
const { getSql, ensureTables, accountForHousehold } = require("../budget-db");
const { resolveHousehold } = require("../budget-household");
const {
  MAX_ROWS_PER_UPLOAD,
  FILENAME_MAX,
  normalizeRow,
  cleanMerchant,
  dedupHash,
  categoryFor,
} = require("../budget-normalize");
const { CHEQUING_MATCHERS, chequingTreatments } = require("../budget-chequing");

// The dry-run echoes a per-row treatment so the user can review it. Capped
// so a pathological upload cannot return a megabyte of JSON; a real
// statement is a few dozen rows.
const MAX_PREVIEW_ROWS = 500;

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
    const household = await resolveHousehold(sql, userId);

    const accountId = parseInt(req.body?.accountId, 10);
    if (!Number.isInteger(accountId)) {
      return res.status(400).json({ error: "A valid accountId is required." });
    }
    const account = await accountForHousehold(sql, accountId, household.id);
    if (!account) {
      return res.status(404).json({ error: "No such account." });
    }
    const isChequing = account.kind === "chequing";

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
    for (let index = 0; index < rawRows.length; index += 1) {
      const raw = rawRows[index];
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
        household.hashScope,
        accountId,
        result.postedDate,
        result.amountCents,
        merchantClean,
        occurrence
      );
      // `index` is the row's position in the submitted array — the key the
      // client uses to attach its per-row keep/exclude choices on commit.
      candidates.push({ ...result, index, merchantClean, hash });
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
       WHERE household_id = ${household.id}
       ORDER BY length(pattern) DESC, pattern ASC
    `;
    // For a chequing account the household's declared bills are needed, to
    // spot debits the dashboard already counts from the Income & bills tab.
    // Card uploads skip the query entirely.
    const bills = isChequing
      ? await sql`
          SELECT id, label, category, amount_cents, due_day, start_month, end_month, on_card
            FROM budget_recurring
           WHERE household_id = ${household.id}
        `
      : [];

    const deduped = Array.from(seen.values());
    // Pattern rules (card payments, transfers, savings) plus declared-bill
    // matching. A card upload gets no treatments at all, so its import path
    // behaves exactly as it did before chequing existed.
    const treatments = isChequing ? chequingTreatments(deduped, bills) : null;
    const extraRules = isChequing ? CHEQUING_MATCHERS : [];

    const uniqueRows = deduped.map((row, i) => {
      const treatment = treatments ? treatments[i] : null;
      return {
        ...row,
        // A matched bill names the category (the row inherits the bill's
        // own); otherwise the usual chain decides — the user's rules first,
        // then the chequing rules, then the built-in merchant defaults.
        category: treatment?.billMatch
          ? treatment.category
          : categoryFor(row.merchantClean, rules, extraRules),
        // The client's confirmed choice wins inside its validated range;
        // with none sent, the server's own suggestion applies.
        countPct: row.countPct != null ? row.countPct : treatment ? treatment.countPct : 100,
        treatment,
      };
    });

    // 4. Split against what's already stored for this account.
    const existing = await sql`
      SELECT dedup_hash FROM budget_transactions
       WHERE household_id = ${household.id} AND account_id = ${accountId}
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
        accountKind: account.kind,
        totalRows: rawRows.length,
        newCount: toInsert.length,
        duplicateCount,
        rejectedCount,
        rejectedSamples,
        categorizedCount: toInsert.length - uncategorizedCount,
        uncategorizedCount,
        excludedCount: toInsert.filter((r) => r.countPct === 0).length,
        // Chequing only: what the server proposes to do with each row, so
        // the review step can show it and let the user overrule it. Keyed
        // by the row's index in the submitted array.
        rows: isChequing
          ? toInsert.slice(0, MAX_PREVIEW_ROWS).map((r) => ({
              index: r.index,
              postedDate: r.postedDate,
              merchantClean: r.merchantClean,
              amountCents: r.amountCents,
              category: r.category,
              countPct: r.countPct,
              reason: r.treatment ? r.treatment.reason : null,
              billMatch: r.treatment ? r.treatment.billMatch : null,
            }))
          : undefined,
      });
    }

    // Commit: record the batch, then bulk-insert via one transaction() call
    // (a single HTTP round trip) rather than one request per row. The DB's
    // own UNIQUE(household_id, dedup_hash) + ON CONFLICT DO NOTHING is the
    // actual source of truth for what gets inserted — safe even if the other
    // member raced this upload with the same statement; the pre-check above
    // is only an optimization, not what's trusted.
    //
    // user_id on both tables records WHO uploaded (attribution); household_id
    // is what every read filters on.
    const [batch] = await sql`
      INSERT INTO budget_upload_batches
        (user_id, household_id, account_id, filename, row_count, inserted_count, duplicate_count, rejected_count)
      VALUES
        (${userId}, ${household.id}, ${accountId}, ${filename || null}, ${rawRows.length}, ${toInsert.length}, ${duplicateCount}, ${rejectedCount})
      RETURNING id
    `;

    let insertedCount = 0;
    if (toInsert.length > 0) {
      const results = await sql.transaction(
        toInsert.map(
          (row) => sql`
            INSERT INTO budget_transactions
              (user_id, household_id, account_id, batch_id, posted_date, merchant_raw, merchant_clean, amount_cents, category, count_pct, dedup_hash)
            VALUES
              (${userId}, ${household.id}, ${accountId}, ${batch.id}, ${row.postedDate}, ${row.merchantRaw}, ${row.merchantClean}, ${row.amountCents}, ${row.category}, ${row.countPct}, ${row.hash})
            ON CONFLICT (household_id, dedup_hash) DO NOTHING
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
         WHERE id = ${batch.id} AND household_id = ${household.id}
      `;
    }

    return res.status(200).json({
      ok: true,
      commit: true,
      batchId: batch.id,
      insertedCount,
      duplicateCount: Math.max(0, rawRows.length - insertedCount - rejectedCount),
      rejectedCount,
      excludedCount: toInsert.filter((r) => r.countPct === 0).length,
    });
  } catch (err) {
    console.error("Budget upload error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
