import { useCallback, useEffect, useRef, useState } from "react";
import { uploadLog } from "../api";
import { CARS, CAR_BY_KEY, LEVEL_RANK } from "../cars";
import { fmtDate, fmtDuration, fmtNum } from "../format";
import { MAX_GZ_BYTES, canCompress, fileDay, gzipFile, naturalCompare } from "../upload";
import Level from "./Level";

/*
 * Drop a folder's worth of CSVs (or pick them on a phone). Each file is
 * gzipped in the browser and dry-run through the API, which analyses it
 * without saving, so the preview shows what the save will store, flags a
 * file that's already in, and lets you fix the date. Accessport CSVs hold
 * elapsed seconds only, so the date starts as the file's modified day.
 * One button saves the batch; commit is never implied.
 */
let seq = 0;

const STATUS_TEXT = {
  packing: "Compressing…",
  checking: "Checking…",
  saving: "Saving…",
};

const worstFinding = (findings = []) =>
  [...findings].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0] || null;

const Uploader = ({ getToken, car, onSaved }) => {
  const [items, setItems] = useState([]);
  const [target, setTarget] = useState(car);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const queue = useRef(Promise.resolve());
  const targetRef = useRef(target);
  targetRef.current = target;

  // Follow the car switcher while nothing is staged.
  useEffect(() => {
    if (!items.length) setTarget(car);
  }, [car, items.length]);

  const patch = useCallback(
    (key, changes) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...changes } : it))),
    []
  );

  const check = useCallback(
    async (item) => {
      try {
        const gz = await gzipFile(item.file);
        if (gz.bytes > MAX_GZ_BYTES) {
          patch(item.key, { status: "error", error: "Too big even compressed. Split the session into shorter logs." });
          return;
        }
        patch(item.key, { gz: gz.b64, status: "checking" });
        const r = await uploadLog(getToken, {
          car: targetRef.current,
          filename: item.name,
          recordedOn: item.recordedOn,
          csvGz: gz.b64,
          commit: false,
        });
        if (!r.ok) patch(item.key, { status: "error", error: r.error });
        else
          patch(item.key, {
            status: r.duplicateOf ? "duplicate" : "ready",
            preview: r.preview,
            duplicateOf: r.duplicateOf,
          });
      } catch {
        patch(item.key, { status: "error", error: "Couldn't read that file." });
      }
    },
    [getToken, patch]
  );

  const addFiles = (fileList) => {
    if (!canCompress()) {
      setNotice("This browser can't compress uploads. Try a current Chrome, Edge, Firefox or Safari.");
      return;
    }
    setNotice(null);
    const known = new Set(items.map((it) => `${it.name}|${it.file.size}|${it.file.lastModified}`));
    const files = [...fileList]
      .filter((f) => !known.has(`${f.name}|${f.size}|${f.lastModified}`))
      .sort((a, b) => naturalCompare(a.name, b.name));
    const fresh = files.map((file) => {
      const csv = /\.csv$/i.test(file.name);
      return {
        key: ++seq,
        file,
        name: file.name,
        recordedOn: fileDay(file),
        status: csv ? "packing" : "error",
        error: csv ? null : "Not a CSV file.",
      };
    });
    setItems((list) => [...list, ...fresh]);
    fresh
      .filter((it) => it.status === "packing")
      .forEach((it) => {
        queue.current = queue.current.then(() => check(it));
      });
  };

  const save = async () => {
    setSaving(true);
    let saved = 0;
    for (const it of items.filter((i) => i.status === "ready")) {
      patch(it.key, { status: "saving" });
      const r = await uploadLog(getToken, {
        car: target,
        filename: it.name,
        recordedOn: it.recordedOn,
        csvGz: it.gz,
        commit: true,
      });
      if (r.ok) {
        saved += 1;
        patch(it.key, { status: "saved", gz: null });
      } else if (r.duplicateOf) {
        patch(it.key, { status: "duplicate", duplicateOf: r.duplicateOf });
      } else {
        patch(it.key, { status: "error", error: r.error });
      }
    }
    setSaving(false);
    if (saved) {
      setItems((list) => list.filter((i) => i.status !== "saved"));
      onSaved(saved);
    }
  };

  const ready = items.filter((i) => i.status === "ready").length;
  const busy = items.some((i) => i.status === "packing" || i.status === "checking");
  const cobbOnCayenne = target === "cayenne" && items.some((i) => i.preview && i.preview.source === "cobb");

  // The Cayenne logs through AndrOBD, which can't be read yet (the empty list
  // says so); an Accessport drop zone there only invites the wrong file.
  // Staged files keep it on screen through a car switch.
  if (car === "cayenne" && target === "cayenne" && !items.length) return null;

  return (
    <section className="gr-upload" aria-labelledby="gr-upload-title">
      <div className="gr-section-head">
        <h2 id="gr-upload-title" className="gr-h2">
          Add logs
        </h2>
        <div className="gr-seg" role="group" aria-label="Save these logs to">
          {CARS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`gr-seg-btn ${target === c.key ? "is-on" : ""}`}
              aria-pressed={target === c.key}
              disabled={saving}
              onClick={() => setTarget(c.key)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <label
        className={`gr-drop ${dragging ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
        <span className="gr-drop-title">
          Drop Accessport CSVs here, or <u>choose files</u>
        </span>
        <span className="gr-drop-sub">Compressed in your browser, checked before anything is saved</span>
      </label>

      {notice && (
        <p className="gr-banner" role="alert">
          {notice}
        </p>
      )}

      {cobbOnCayenne && (
        <p className="gr-banner" role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          Accessport logs come from the Golf R, but these are set to save to the Cayenne.
          <button type="button" className="gr-link" onClick={() => setTarget("golf")}>
            Save to the Golf R
          </button>
        </p>
      )}

      {items.length > 0 && (
        <>
          <ul className="gr-staged">
            {items.map((it) => {
              const p = it.preview;
              const top = p ? worstFinding(p.findings) : null;
              return (
                <li key={it.key} className={`gr-staged-item is-${it.status}`}>
                  <div className="gr-staged-main">
                    <p className="gr-staged-name">
                      {it.name}
                      {p && (
                        <small>
                          {fmtDuration(p.durationS)} · {fmtNum(p.samples)} samples
                          {p.source === "mqbtel" ? " · mqbtel" : ""}
                        </small>
                      )}
                    </p>
                    {STATUS_TEXT[it.status] && (
                      <p className="gr-staged-status">
                        <span className="gr-spinner" aria-hidden="true" /> {STATUS_TEXT[it.status]}
                      </p>
                    )}
                    {it.status === "error" && <p className="gr-staged-error">{it.error}</p>}
                    {it.status === "duplicate" && it.duplicateOf && (
                      <p className="gr-staged-dup">
                        Already saved: {it.duplicateOf.filename}, {fmtDate(it.duplicateOf.recordedOn)}
                        {it.duplicateOf.car !== target ? ` (${CAR_BY_KEY[it.duplicateOf.car].name})` : ""}
                      </p>
                    )}
                    {top && (it.status === "ready" || it.status === "saving") && (
                      <p className="gr-staged-finding">
                        <Level level={p.worstLevel} /> {top.message}
                      </p>
                    )}
                  </div>
                  <label className="gr-staged-date">
                    <span className="sr-only">Date {it.name} was recorded</span>
                    <input
                      type="date"
                      value={it.recordedOn}
                      max={new Date().toLocaleDateString("en-CA")}
                      disabled={saving || it.status === "saving"}
                      onChange={(e) => patch(it.key, { recordedOn: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="gr-icon-btn"
                    disabled={saving}
                    onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                  >
                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                    <span className="sr-only">Remove {it.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="gr-upload-actions">
            <button type="button" className="gr-btn gr-btn--primary" disabled={!ready || busy || saving} onClick={save}>
              <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
              {saving ? "Saving…" : `Save ${ready || ""} log${ready === 1 ? "" : "s"} to the ${CAR_BY_KEY[target].name}`}
            </button>
            <button type="button" className="gr-link" disabled={saving} onClick={() => setItems([])}>
              Clear
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default Uploader;
