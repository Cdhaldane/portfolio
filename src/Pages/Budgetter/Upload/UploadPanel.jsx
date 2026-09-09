import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import { parseCsvFile, applyMapping, MAPPING_FIELDS } from "../parsers";
import { parseStatementPdf } from "../pdf-parsers";
import { fmtMoneyExact } from "../format";
import Dropdown from "../Dropdown";
import "./UploadPanel.css";

const BANKS = [
  { value: "amex", label: "Amex" },
  { value: "td", label: "TD" },
  { value: "triangle", label: "Canadian Tire / Triangle" },
  { value: "kawartha", label: "Kawartha / Libro" },
  { value: "other", label: "Other" },
];

// A chequing account is imported differently from a card: most of its rows
// are money moving (transfers, card payments, bills already declared in the
// Income & bills tab) rather than money spent, so the review step asks about
// each one. The kind is fixed at creation — see api/_lib/handlers/accounts.js.
const KINDS = [
  { value: "card", label: "Credit card" },
  { value: "chequing", label: "Chequing / debit" },
];
// Kawartha statements are always bank accounts, so picking that bank
// pre-selects the right kind rather than making the user think about it.
const KIND_FOR_BANK = { kawartha: "chequing" };

// A real statement CSV is a few hundred KB at most — this is a sanity cap,
// not a real limit (the server's own MAX_ROWS_PER_UPLOAD is the hard one).
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// PDFs carry fonts and page furniture, so they run bigger than CSVs.
const MAX_PDF_BYTES = 10 * 1024 * 1024;

const stripPreview = (rows) =>
  rows.map(({ postedDate, merchantRaw, amountCents }) => ({ postedDate, merchantRaw, amountCents }));

/*
 * Upload flow: pick/create an account -> pick a CSV -> confirm (or correct)
 * the column mapping -> dry-run review -> commit. Only postedDate/
 * merchantRaw/amountCents ever leave the browser; the raw file itself never
 * does — it's parsed locally and discarded once mapped.
 */
const UploadPanel = ({ onImported }) => {
  const { getToken } = useAuth();

  const [accounts, setAccounts] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    bank: "amex",
    label: "",
    last4: "",
    kind: "card",
  });
  const [accountError, setAccountError] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);

  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [flipSign, setFlipSign] = useState(false);
  const [pdfInfo, setPdfInfo] = useState(null); // Triangle PDF parse result

  // setup -> (mapping | pdf-review) -> review -> done
  const [step, setStep] = useState("setup");
  const [mappedRows, setMappedRows] = useState([]);
  const [mapErrors, setMapErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  // index-in-submitted-rows -> countPct the user chose, overriding the
  // server's suggestion for that row.
  const [overrides, setOverrides] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");

  const fileInputRef = useRef(null);

  const loadAccounts = useCallback(async () => {
    const { res, data } = await budgetFetch(getToken, "/api/budget/accounts");
    if (res.ok && data) {
      setAccounts(data.accounts || []);
      if (data.accounts?.length) {
        setAccountId((prev) => prev || String(data.accounts[0].id));
      }
    }
    setAccountsLoaded(true);
  }, [getToken]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const createAccount = async (e) => {
    e.preventDefault();
    setAccountError("");
    if (!newAccount.label.trim()) {
      setAccountError('Give it a label, e.g. "Amex Cobalt".');
      return;
    }
    setCreatingAccount(true);
    const { res, data } = await budgetFetch(getToken, "/api/budget/accounts", {
      method: "POST",
      body: JSON.stringify(newAccount),
    });
    setCreatingAccount(false);
    if (res.ok && data?.account) {
      setAccounts((prev) => [...prev, data.account]);
      setAccountId(String(data.account.id));
      setShowNewAccount(false);
      setNewAccount({ bank: "amex", label: "", last4: "", kind: "card" });
    } else {
      setAccountError(data?.error || "Couldn't create that account.");
    }
  };

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    setParsed(null);
    setPdfInfo(null);

    // Statement PDFs (Amex, Canadian Tire / Triangle, TD) are parsed
    // client-side (pdf.js, lazily loaded) into the same rows the CSV path
    // produces. The raw file still never leaves the browser.
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      if (file.size > MAX_PDF_BYTES) {
        setFileError("That PDF is bigger than a statement should be — double check it.");
        return;
      }
      try {
        const { extractPdfLines } = await import("../pdf-extract");
        const lines = await extractPdfLines(new Uint8Array(await file.arrayBuffer()));
        const result = parseStatementPdf(lines);
        if (!result.ok) {
          setFileError(`${result.error} For unsupported banks, export a CSV instead.`);
          return;
        }
        setFileName(file.name);
        setPdfInfo(result);
        setMappedRows(result.rows);
        setMapErrors([]);
        setApiError("");
        setStep("pdf-review");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Budgetter PDF import failed:", err);
        setFileError(
          `Couldn't read that PDF — ${err?.message || "unknown error"}. ` +
            "If this keeps happening after re-downloading the statement, the error above is in the browser console."
        );
      }
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setFileError("That file is bigger than a statement should be — double check it.");
      return;
    }
    const text = await file.text();
    const result = parseCsvFile(text);
    if (!result.rows.length) {
      setFileError("Couldn't find any rows in that file.");
      return;
    }
    setFileName(file.name);
    setParsed(result);
    setMapping(result.guess);
    setFlipSign(false);
    setApiError("");
    setStep("mapping");
  };

  const mappingReady =
    mapping.date != null &&
    mapping.description != null &&
    (mapping.amount != null || (mapping.debit != null && mapping.credit != null));

  const submitDryRun = async (rows) => {
    setBusy(true);
    setApiError("");
    const { res, data } = await budgetFetch(getToken, "/api/budget/upload", {
      method: "POST",
      body: JSON.stringify({
        accountId: Number(accountId),
        filename: fileName,
        rows: stripPreview(rows),
        commit: false,
      }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      setPreview(data);
      setOverrides({});
      setStep("review");
    } else {
      setApiError(data?.error || "Couldn't reach the server — try again.");
    }
  };

  const runDryRun = async () => {
    if (!parsed) return;
    const { rows, errors } = applyMapping(parsed.rows, mapping, { flipSign });
    setMappedRows(rows);
    setMapErrors(errors);
    if (!rows.length) {
      setApiError("None of the rows could be read with this column mapping — check it and try again.");
      return;
    }
    await submitDryRun(rows);
  };

  /*
   * Rows for the commit call. For a card upload this is just the parsed
   * rows. For a chequing one, each row the dry-run previewed also carries
   * the countPct that was settled on — the server's suggestion, or the
   * user's override. Rows the preview didn't mention (duplicates, rejects)
   * are sent bare and the server re-derives everything, so a mismatch here
   * can only ever be more conservative, never a silent double-count.
   */
  const rowsForCommit = () => {
    const bare = stripPreview(mappedRows);
    if (!preview?.rows?.length) return bare;
    const chosen = new Map(
      preview.rows.map((r) => [r.index, overrides[r.index] ?? r.countPct])
    );
    return bare.map((row, i) =>
      chosen.has(i) ? { ...row, countPct: chosen.get(i) } : row
    );
  };

  const confirmImport = async () => {
    setBusy(true);
    setApiError("");
    const { res, data } = await budgetFetch(getToken, "/api/budget/upload", {
      method: "POST",
      body: JSON.stringify({
        accountId: Number(accountId),
        filename: fileName,
        rows: rowsForCommit(),
        commit: true,
      }),
    });
    setBusy(false);
    if (res.ok && data?.ok) {
      setResult(data);
      setStep("done");
      onImported?.();
    } else {
      setApiError(data?.error || "Couldn't reach the server — try again.");
    }
  };

  const reset = () => {
    setStep("setup");
    setFileName("");
    setParsed(null);
    setPdfInfo(null);
    setMapping({});
    setMappedRows([]);
    setMapErrors([]);
    setPreview(null);
    setOverrides({});
    setResult(null);
    setApiError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sampleRow = parsed?.rows?.[0];
  const selectedAccount = accounts.find((a) => String(a.id) === String(accountId));

  // Chequing review: what each row is currently set to, and what that adds
  // up to. Deposits are excluded from the total because a credit never
  // counts as spending whatever its count_pct says.
  const treatmentRows = preview?.rows || [];
  const pctFor = (row) => overrides[row.index] ?? row.countPct;
  const countedCents = treatmentRows.reduce(
    (sum, r) => (r.amountCents > 0 && pctFor(r) > 0 ? sum + r.amountCents : sum),
    0
  );
  const skippedCount = treatmentRows.filter((r) => r.amountCents > 0 && pctFor(r) === 0).length;
  const setPct = (index, countPct) =>
    setOverrides((prev) => ({ ...prev, [index]: countPct }));

  return (
    <div className="upl">
      <section className="upl-step">
        <p className="upl-num">01</p>
        <h2 className="upl-h">Which account?</h2>

        {!accountsLoaded ? (
          <p className="upl-hint">Loading accounts…</p>
        ) : accounts.length === 0 && !showNewAccount ? (
          <p className="upl-hint">No accounts yet — add the first one below.</p>
        ) : accounts.length > 0 ? (
          <Dropdown
            className="upl-account-dd"
            ariaLabel="Which account the statement belongs to"
            value={String(accountId)}
            onChange={(v) => setAccountId(v)}
            disabled={step !== "setup"}
            options={accounts.map((a) => ({
              value: String(a.id),
              label: `${a.label}${a.last4 ? ` ····${a.last4}` : ""}${
                a.kind === "chequing" ? " · chequing" : ""
              }`,
            }))}
          />
        ) : null}

        {step === "setup" && (
          <button
            type="button"
            className="upl-link"
            onClick={() => setShowNewAccount((v) => !v)}
          >
            {showNewAccount ? "Cancel" : "+ Add a new account"}
          </button>
        )}

        {showNewAccount && step === "setup" && (
          <form className="upl-newaccount" onSubmit={createAccount}>
            <Dropdown
              ariaLabel="Bank"
              value={newAccount.bank}
              onChange={(v) =>
                setNewAccount((a) => ({ ...a, bank: v, kind: KIND_FOR_BANK[v] || a.kind }))
              }
              options={BANKS.map((b) => ({ value: b.value, label: b.label }))}
            />
            <Dropdown
              ariaLabel="Is this a credit card or a bank account?"
              value={newAccount.kind}
              onChange={(v) => setNewAccount((a) => ({ ...a, kind: v }))}
              options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
            />
            <input
              type="text"
              placeholder='Label, e.g. "Amex Cobalt"'
              value={newAccount.label}
              maxLength={60}
              onChange={(e) => setNewAccount((v) => ({ ...v, label: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Last 4 (optional)"
              value={newAccount.last4}
              maxLength={4}
              inputMode="numeric"
              onChange={(e) =>
                setNewAccount((v) => ({ ...v, last4: e.target.value.replace(/\D/g, "") }))
              }
            />
            <p className="upl-hint upl-kindnote">
              {newAccount.kind === "chequing"
                ? "Chequing statements get an extra review step: transfers, credit-card payments and bills you already track are held back so they don't count twice."
                : "Every row on a card statement is treated as spending (payments and refunds excepted)."}
            </p>
            <button type="submit" disabled={creatingAccount}>
              {creatingAccount ? "Adding…" : "Add account"}
            </button>
            {accountError && <p className="upl-error">{accountError}</p>}
          </form>
        )}
      </section>

      <section className="upl-step">
        <p className="upl-num">02</p>
        <h2 className="upl-h">Upload a statement</h2>
        <p className="upl-hint">
          CSV exported from your bank's statement page — or, for Amex,
          Canadian Tire / Triangle, TD and Kawartha / Libro, the PDF
          statement itself. Either way the file is parsed right here in your
          browser and never sent to the server; only the rows you confirm are.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          onChange={onFileChange}
          disabled={!accountId || step !== "setup"}
        />
        {selectedAccount?.kind === "chequing" && (
          <p className="upl-hint upl-kindnote">
            {selectedAccount.label} is a chequing account, so you'll get a
            row-by-row review before anything is imported.
          </p>
        )}
        {fileError && <p className="upl-error">{fileError}</p>}
      </section>

      {step === "mapping" && parsed && (
        <section className="upl-step">
          <p className="upl-num">03</p>
          <h2 className="upl-h">Confirm the columns</h2>
          <p className="upl-hint">
            {parsed.hasHeader
              ? "Detected from the file's header row — "
              : "This file has no header row — "}
            double check before continuing.
          </p>

          <div className="upl-mapping-grid">
            {MAPPING_FIELDS.map((f) => (
              <div key={f.key} className="upl-mapping-row">
                <span>
                  {f.label}
                  {f.required && " *"}
                </span>
                <Dropdown
                  ariaLabel={`Which column holds the ${f.label.toLowerCase()}`}
                  value={mapping[f.key] == null ? "" : String(mapping[f.key])}
                  onChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      [f.key]: v === "" ? undefined : Number(v),
                    }))
                  }
                  options={[
                    { value: "", label: "—" },
                    ...(parsed.headerRow || sampleRow || []).map((_, i) => ({
                      value: String(i),
                      label: parsed.headerRow
                        ? parsed.headerRow[i]
                        : `Column ${i + 1}${
                            sampleRow?.[i] ? ` (e.g. "${String(sampleRow[i]).slice(0, 24)}")` : ""
                          }`,
                    })),
                  ]}
                />
              </div>
            ))}
          </div>

          <label className="upl-flip">
            <input
              type="checkbox"
              checked={flipSign}
              onChange={(e) => setFlipSign(e.target.checked)}
            />
            This bank shows charges as negative amounts
          </label>

          {apiError && <p className="upl-error">{apiError}</p>}

          {mapErrors.length > 0 && mappedRows.length === 0 && (
            <div className="upl-diagnostic">
              <p className="upl-hint">
                What the selected columns actually contained, so you can spot the mismatch:
              </p>
              {mapErrors.slice(0, 3).map((e, i) => (
                <div key={i} className="upl-diagnostic-row">
                  <span>
                    Date: <code>{JSON.stringify(e.raw.date) ?? "—"}</code>{" "}
                    {e.parsedOk.date ? "✓" : "✗ unreadable"}
                  </span>
                  <span>
                    Description: <code>{JSON.stringify(e.raw.description) ?? "—"}</code>{" "}
                    {e.parsedOk.description ? "✓" : "✗ empty"}
                  </span>
                  <span>
                    Amount:{" "}
                    {e.raw.amount !== undefined ? (
                      <code>{JSON.stringify(e.raw.amount)}</code>
                    ) : (
                      <>
                        debit <code>{JSON.stringify(e.raw.debit)}</code>, credit{" "}
                        <code>{JSON.stringify(e.raw.credit)}</code>
                      </>
                    )}{" "}
                    {e.parsedOk.amount ? "✓" : "✗ unreadable"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="upl-actions">
            <button type="button" className="upl-secondary" onClick={reset}>
              Start over
            </button>
            <button
              type="button"
              className="upl-primary"
              onClick={runDryRun}
              disabled={!mappingReady || busy}
            >
              {busy ? "Checking…" : "Preview import"}
            </button>
          </div>
        </section>
      )}

      {step === "pdf-review" && pdfInfo && (
        <section className="upl-step">
          <p className="upl-num">03</p>
          <h2 className="upl-h">Check what was found</h2>
          <p className="upl-hint">
            Read from the PDF's {pdfInfo.period.label} statement tables. The
            totals below are cross-checked against the totals printed on the
            statement itself.
          </p>

          <ul className="upl-checks">
            {pdfInfo.checks.map((c) => (
              <li key={c.key} className={c.ok ? "upl-check--ok" : "upl-check--bad"}>
                {c.ok ? "✓" : "✗"} {c.label}: {fmtMoneyExact(c.parsedCents)}
                {c.ok
                  ? " — matches the statement"
                  : ` parsed, but the statement says ${fmtMoneyExact(c.statedCents)}`}
              </li>
            ))}
          </ul>
          {pdfInfo.checks.some((c) => !c.ok) && (
            <p className="upl-error">
              A section total doesn't match, so some rows were likely misread —
              scan the list below before importing.
            </p>
          )}

          {/* Bank statements print a running balance, which proves each row
              individually: previous balance + this row = the balance printed
              beside it. A mismatch names the exact row that went wrong. */}
          {pdfInfo.chainMismatches?.length > 0 ? (
            <div className="upl-chain upl-chain--bad">
              <p>
                {pdfInfo.chainMismatches.length} row
                {pdfInfo.chainMismatches.length === 1 ? "" : "s"} disagree with the
                statement's own running balance — the amount or its sign was misread:
              </p>
              <ul>
                {pdfInfo.chainMismatches.slice(0, 5).map((m, i) => (
                  <li key={i}>
                    {m.postedDate} {m.merchantRaw} — balance should be{" "}
                    {fmtMoneyExact(m.expectedCents)}, statement says{" "}
                    {fmtMoneyExact(m.statedCents)}
                  </li>
                ))}
              </ul>
            </div>
          ) : pdfInfo.kind === "chequing" ? (
            <p className="upl-chain upl-chain--ok">
              ✓ Every row agrees with the running balance printed beside it.
            </p>
          ) : null}

          <div className="upl-pdftable-wrap">
            <table className="upl-pdftable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.postedDate}</td>
                    <td>{r.merchantRaw}</td>
                    <td className={r.amountCents < 0 ? "upl-amount--credit" : ""}>
                      {fmtMoneyExact(r.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {apiError && <p className="upl-error">{apiError}</p>}

          <div className="upl-actions">
            <button type="button" className="upl-secondary" onClick={reset}>
              Start over
            </button>
            <button
              type="button"
              className="upl-primary"
              onClick={() => submitDryRun(mappedRows)}
              disabled={busy}
            >
              {busy ? "Checking…" : "Preview import"}
            </button>
          </div>
        </section>
      )}

      {step === "review" && preview && (
        <section className="upl-step">
          <p className="upl-num">04</p>
          <h2 className="upl-h">Review before importing</h2>

          <div className="upl-summary">
            <div className="upl-summary-item upl-summary-item--new">
              <strong>{preview.newCount}</strong>
              <span>new</span>
            </div>
            <div className="upl-summary-item">
              <strong>{preview.duplicateCount}</strong>
              <span>duplicates skipped</span>
            </div>
            <div className="upl-summary-item">
              <strong>{preview.rejectedCount}</strong>
              <span>unreadable rows</span>
            </div>
            <div className="upl-summary-item">
              <strong>{preview.uncategorizedCount}</strong>
              <span>uncategorized</span>
            </div>
          </div>

          {treatmentRows.length > 0 && (
            <div className="upl-treat">
              <p className="upl-hint">
                A chequing statement is mostly money <em>moving</em>, not money
                spent. These rows are all imported either way — the ones set to
                skip are stored at 0% so they stay on the record without
                counting. Flip anything Budgetter read wrong.
              </p>
              <p className="upl-treat-total">
                <strong>{fmtMoneyExact(countedCents)}</strong> will count as
                spending
                {skippedCount > 0 && `, ${skippedCount} debit${
                  skippedCount === 1 ? "" : "s"
                } held back`}
                .
              </p>

              <div className="upl-pdftable-wrap">
                <table className="upl-pdftable">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Counts?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {treatmentRows.map((r) => {
                      const counted = pctFor(r) > 0;
                      const isDeposit = r.amountCents < 0;
                      return (
                        <tr
                          key={r.index}
                          className={!isDeposit && !counted ? "upl-tr--skipped" : ""}
                        >
                          <td>{r.postedDate}</td>
                          <td>
                            <span className="upl-treat-name">{r.merchantClean}</span>
                            <span className="upl-treat-meta">
                              {r.category}
                              {r.reason ? ` — ${r.reason}` : ""}
                              {r.billMatch?.confidence === "likely" ? " (a guess)" : ""}
                            </span>
                          </td>
                          <td className={isDeposit ? "upl-amount--credit" : ""}>
                            {fmtMoneyExact(r.amountCents)}
                          </td>
                          <td>
                            {isDeposit ? (
                              <span className="upl-treat-na">money in</span>
                            ) : (
                              <span className="upl-seg">
                                <button
                                  type="button"
                                  aria-pressed={counted}
                                  className={counted ? "is-on" : ""}
                                  onClick={() => setPct(r.index, 100)}
                                >
                                  Count
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={!counted}
                                  className={!counted ? "is-on" : ""}
                                  onClick={() => setPct(r.index, 0)}
                                >
                                  Skip
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mapErrors.length > 0 && (
            <p className="upl-hint">
              {mapErrors.length} row(s) were unreadable with this mapping and were dropped
              before this preview.
            </p>
          )}
          {preview.rejectedSamples?.length > 0 && (
            <ul className="upl-rejected">
              {preview.rejectedSamples.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          {apiError && <p className="upl-error">{apiError}</p>}

          <div className="upl-actions">
            <button
              type="button"
              className="upl-secondary"
              onClick={() => setStep(pdfInfo ? "pdf-review" : "mapping")}
            >
              Back
            </button>
            <button
              type="button"
              className="upl-primary"
              onClick={confirmImport}
              disabled={busy || preview.newCount === 0}
            >
              {busy
                ? "Importing…"
                : `Import ${preview.newCount} transaction${preview.newCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}

      {step === "done" && result && (
        <section className="upl-step upl-step--done">
          <p className="upl-num">✓</p>
          <h2 className="upl-h">Imported</h2>
          <p className="upl-hint">
            {result.insertedCount} new transaction{result.insertedCount === 1 ? "" : "s"} added
            {result.duplicateCount ? `, ${result.duplicateCount} duplicate(s) skipped` : ""}
            {result.excludedCount
              ? `. ${result.excludedCount} imported at 0% — on the record, out of the totals`
              : ""}
            .
          </p>
          <div className="upl-actions">
            <button type="button" className="upl-primary" onClick={reset}>
              Upload another statement
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default UploadPanel;
