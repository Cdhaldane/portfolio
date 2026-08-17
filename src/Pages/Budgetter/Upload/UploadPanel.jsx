import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { budgetFetch } from "../api";
import { parseCsvFile, applyMapping, MAPPING_FIELDS } from "../parsers";
import { parseStatementPdf } from "../pdf-parsers";
import { fmtMoneyExact } from "../format";
import "./UploadPanel.css";

const BANKS = [
  { value: "amex", label: "Amex" },
  { value: "td", label: "TD" },
  { value: "triangle", label: "Canadian Tire / Triangle" },
  { value: "other", label: "Other" },
];

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
  const [newAccount, setNewAccount] = useState({ bank: "amex", label: "", last4: "" });
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
      setNewAccount({ bank: "amex", label: "", last4: "" });
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

  const confirmImport = async () => {
    setBusy(true);
    setApiError("");
    const { res, data } = await budgetFetch(getToken, "/api/budget/upload", {
      method: "POST",
      body: JSON.stringify({
        accountId: Number(accountId),
        filename: fileName,
        rows: stripPreview(mappedRows),
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
    setResult(null);
    setApiError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const sampleRow = parsed?.rows?.[0];

  return (
    <div className="upl">
      <section className="upl-step">
        <p className="upl-num">01</p>
        <h2 className="upl-h">Which card?</h2>

        {!accountsLoaded ? (
          <p className="upl-hint">Loading accounts…</p>
        ) : accounts.length === 0 && !showNewAccount ? (
          <p className="upl-hint">No accounts yet — add the first one below.</p>
        ) : accounts.length > 0 ? (
          <select
            className="upl-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={step !== "setup"}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.last4 ? ` ····${a.last4}` : ""}
              </option>
            ))}
          </select>
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
            <select
              value={newAccount.bank}
              onChange={(e) => setNewAccount((v) => ({ ...v, bank: e.target.value }))}
            >
              {BANKS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
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
          Canadian Tire / Triangle and TD, the PDF statement itself. Either
          way the file is parsed right here in your browser and never sent to
          the server; only the rows you confirm are.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
          onChange={onFileChange}
          disabled={!accountId || step !== "setup"}
        />
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
              <label key={f.key} className="upl-mapping-row">
                <span>
                  {f.label}
                  {f.required && " *"}
                </span>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [f.key]: e.target.value === "" ? undefined : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">—</option>
                  {(parsed.headerRow || sampleRow || []).map((_, i) => (
                    <option key={i} value={i}>
                      {parsed.headerRow
                        ? parsed.headerRow[i]
                        : `Column ${i + 1}${
                            sampleRow?.[i] ? ` (e.g. "${String(sampleRow[i]).slice(0, 24)}")` : ""
                          }`}
                    </option>
                  ))}
                </select>
              </label>
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
            {result.duplicateCount ? `, ${result.duplicateCount} duplicate(s) skipped` : ""}.
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
