import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as api from "../api";
import { prepareReceiptPhoto } from "../image";
import { LOCATIONS, dayText, money, qtyText, stepQty } from "../format";

/*
 * Receipt → pantry, in four steps:
 *   pick     photos of the receipt, top to bottom (a long one takes several)
 *   reading  Claude reads it (about half a minute); the paper "prints"
 *   review   every line, editable: name, which item it restocks, how many,
 *            where it lives. Bag fees and deposits start switched off.
 *   done     what changed
 * Nothing is saved until the review is confirmed. Without Claude (no API
 * key yet) the same review screen takes the receipt typed in by hand.
 */
const MAX_PHOTOS = 4;
const READING_LINES = [
  "Reading the small print",
  "Expanding the abbreviations",
  "Matching what's already on the shelf",
  "Working out what goes in the fridge",
  "Folding in the discounts",
];

let lineSeq = 0;
const blankLine = () => ({
  key: `l${(lineSeq += 1)}`,
  raw: "",
  name: "",
  matchId: null,
  matchName: null,
  category: "other",
  location: "pantry",
  qty: 1,
  size: null,
  priceCents: null,
  shelfDays: null,
  keep: true,
});

const ReceiptFlow = ({ open, items, today, getToken, onClose, onSaved }) => {
  const reduce = useReducedMotion();
  const [step, setStep] = useState("pick");
  const [photos, setPhotos] = useState([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(null);
  const [offerManual, setOfferManual] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dupe, setDupe] = useState(null);
  const [result, setResult] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const fileRef = useRef(null);
  const panel = useRef(null);
  const previews = useRef(new Set());

  const forget = (url) => {
    URL.revokeObjectURL(url);
    previews.current.delete(url);
  };

  // Free every preview image when the flow goes away.
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    previews.current.forEach((url) => URL.revokeObjectURL(url));
    previews.current.clear();
    setStep("pick");
    setPhotos([]);
    setError(null);
    setOfferManual(false);
    setDraft(null);
    setDupe(null);
    setResult(null);
    setShowSkipped(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panel.current && panel.current.focus({ preventScroll: true }), 50);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && step !== "reading" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  const addFiles = async (fileList) => {
    const files = [...fileList].slice(0, MAX_PHOTOS - photos.length);
    if (!files.length) return;
    setPreparing(true);
    setError(null);
    const ready = [];
    for (const f of files) {
      try {
        const photo = await prepareReceiptPhoto(f);
        previews.current.add(photo.previewUrl);
        ready.push(photo);
      } catch (e) {
        setError(e.message);
      }
    }
    setPhotos((p) => [...p, ...ready]);
    setPreparing(false);
  };

  const removePhoto = (i) => {
    forget(photos[i].previewUrl);
    setPhotos((p) => p.filter((_, j) => j !== i));
  };

  const read = async () => {
    setStep("reading");
    setError(null);
    const res = await api.readReceipt(
      getToken,
      photos.map(({ image, mediaType }) => ({ image, mediaType }))
    );
    if (!res.ok) {
      setStep("pick");
      setError(res.error);
      setOfferManual(true);
      return;
    }
    const lines = res.read.lines.map((l) => ({ ...blankLine(), ...l }));
    if (!lines.length) {
      setStep("pick");
      setError("Couldn't find any items on that. Try a flatter, sharper photo, or type it in.");
      setOfferManual(true);
      return;
    }
    setDraft({
      store: res.read.store || "",
      purchasedOn: res.read.purchasedOn || today,
      totalCents: res.read.totalCents,
      lines,
      manual: false,
    });
    setStep("review");
  };

  const manual = () => {
    setDraft({ store: "", purchasedOn: today, totalCents: null, lines: [blankLine()], manual: true });
    setStep("review");
    setError(null);
  };

  const updateLine = (key, patch) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const kept = draft ? draft.lines.filter((l) => l.keep) : [];
  const skipped = draft ? draft.lines.filter((l) => !l.keep) : [];
  const restocks = kept.filter((l) => l.matchId).length;
  const fresh = kept.length - restocks;
  const ready = kept.length > 0 && kept.every((l) => l.matchId || l.name.trim());

  const save = async (force = false) => {
    setSaving(true);
    setError(null);
    const res = await api.saveReceipt(getToken, {
      store: draft.store,
      purchasedOn: draft.purchasedOn,
      totalCents: draft.totalCents,
      force,
      lines: kept.map((l) => ({
        raw: l.raw,
        itemId: l.matchId,
        name: l.name,
        category: l.category,
        location: l.location,
        qty: l.qty,
        priceCents: l.priceCents,
        shelfDays: l.shelfDays,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      if (res.code === "duplicate") return setDupe(res.data.purchasedOn);
      return setError(res.error);
    }
    setDupe(null);
    onSaved(res.data);
    setResult(res.data.saved);
    setStep("done");
  };

  const title =
    step === "review" ? (draft && draft.manual ? "Type in a receipt" : "Check what Claude read") : step === "done" ? "Done" : "Scan a receipt";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          className="pt-flow"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: reduce ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <header className="pt-flow-head">
            <button type="button" className="pt-icon-btn" onClick={onClose} aria-label="Close" disabled={step === "reading"}>
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
            <h2>{title}</h2>
            <span className="pt-flow-steps" aria-hidden="true">
              {["pick", "review", "done"].map((s) => (
                <i key={s} className={s === step || (s === "pick" && step === "reading") ? "is-on" : ""} />
              ))}
            </span>
          </header>

          <div className="pt-flow-body">
            {step === "pick" && (
              <div className="pt-pick">
                <p className="pt-pick-lede">
                  Lay it flat in good light. A long receipt can take up to {MAX_PHOTOS} photos, top to
                  bottom; overlap is fine.
                </p>
                <div className="pt-photos">
                  {photos.map((p, i) => (
                    <figure key={p.previewUrl} className="pt-photo">
                      <img src={p.previewUrl} alt={`Receipt, part ${i + 1}`} />
                      <figcaption>{i + 1}</figcaption>
                      <button type="button" className="pt-photo-x" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
                        <i className="fa-solid fa-xmark" aria-hidden="true" />
                      </button>
                    </figure>
                  ))}
                  {photos.length < MAX_PHOTOS && (
                    <button type="button" className="pt-photo-add" onClick={() => fileRef.current && fileRef.current.click()} disabled={preparing}>
                      <i className="fa-solid fa-camera" aria-hidden="true" />
                      <span>{preparing ? "Preparing…" : photos.length ? "Add the next part" : "Take a photo"}</span>
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {error && (
                  <p className="pt-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="pt-flow-foot">
                  <button type="button" className="pt-btn is-primary is-wide" onClick={read} disabled={!photos.length || preparing}>
                    Read {photos.length > 1 ? `${photos.length} photos` : "the receipt"}
                  </button>
                  <button type="button" className={`pt-link${offerManual ? " is-loud" : ""}`} onClick={manual}>
                    or type it in yourself
                  </button>
                </div>
              </div>
            )}

            {step === "reading" && <Reading reduce={reduce} />}

            {step === "review" && draft && (
              <div className="pt-review">
                <div className="pt-review-meta">
                  <label className="pt-field">
                    <span className="pt-field-label">Store</span>
                    <input value={draft.store} onChange={(e) => setDraft((d) => ({ ...d, store: e.target.value }))} placeholder="Where from?" maxLength={60} />
                  </label>
                  <label className="pt-field">
                    <span className="pt-field-label">Shopped on</span>
                    <input
                      type="date"
                      value={draft.purchasedOn}
                      max={today}
                      onChange={(e) => setDraft((d) => ({ ...d, purchasedOn: e.target.value }))}
                    />
                  </label>
                  {draft.totalCents != null && (
                    <p className="pt-review-total">
                      <span>Total</span>
                      <strong>{money(draft.totalCents)}</strong>
                    </p>
                  )}
                </div>

                <ul className="pt-lines">
                  {kept.map((l) => (
                    <ReviewLine key={l.key} line={l} items={items} onChange={(patch) => updateLine(l.key, patch)} />
                  ))}
                </ul>

                <button type="button" className="pt-add" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, blankLine()] }))}>
                  <i className="fa-solid fa-plus" aria-hidden="true" /> Add a line it missed
                </button>

                {skipped.length > 0 && (
                  <div className="pt-skipped">
                    <button type="button" className="pt-link" aria-expanded={showSkipped} onClick={() => setShowSkipped((s) => !s)}>
                      {skipped.length} line{skipped.length === 1 ? "" : "s"} left out (fees, deposits)
                      <i className={`fa-solid fa-chevron-${showSkipped ? "up" : "down"}`} aria-hidden="true" />
                    </button>
                    {showSkipped && (
                      <ul className="pt-lines is-skipped">
                        {skipped.map((l) => (
                          <ReviewLine key={l.key} line={l} items={items} onChange={(patch) => updateLine(l.key, patch)} />
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {dupe && (
                  <div className="pt-dupe" role="alert">
                    <p>This looks like the receipt you added for {dayText(dupe)}. Add it again anyway?</p>
                    <div className="pt-row-actions">
                      <button type="button" className="pt-btn" onClick={() => setDupe(null)}>
                        No
                      </button>
                      <button type="button" className="pt-btn is-primary" onClick={() => save(true)} disabled={saving}>
                        Add it again
                      </button>
                    </div>
                  </div>
                )}
                {error && (
                  <p className="pt-error" role="alert">
                    {error}
                  </p>
                )}

                <div className="pt-flow-foot is-sticky">
                  <p className="pt-flow-sum">
                    {restocks > 0 && `${restocks} restock${restocks === 1 ? "" : "s"}`}
                    {restocks > 0 && fresh > 0 && " · "}
                    {fresh > 0 && `${fresh} new`}
                  </p>
                  <button type="button" className="pt-btn is-primary is-wide" onClick={() => save(false)} disabled={!ready || saving || Boolean(dupe)}>
                    {saving ? "Adding…" : `Add ${kept.length} to the pantry`}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && result && (
              <div className="pt-done">
                <motion.div
                  className="pt-done-mark"
                  initial={reduce ? false : { scale: 0.4, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", damping: 14, stiffness: 260 }}
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />
                </motion.div>
                <h3>Pantry updated</h3>
                <p>
                  {[
                    result.restocked && `${result.restocked} restocked`,
                    result.added && `${result.added} new on the shelf`,
                    result.listCleared && `${result.listCleared} off the list`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <button type="button" className="pt-btn is-primary is-wide" onClick={onClose}>
                  Done
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Reading = ({ reduce }) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % READING_LINES.length), 2400);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <div className="pt-reading" aria-live="polite">
      <div className="pt-printer" aria-hidden="true">
        <div className="pt-printer-mouth" />
        <div className="pt-paper">
          {Array.from({ length: 9 }, (_, n) => (
            <span key={n} style={{ "--n": n, "--w": `${45 + ((n * 37) % 45)}%` }} />
          ))}
        </div>
      </div>
      <p className="pt-reading-title">Claude is reading the receipt…</p>
      <p className="pt-reading-sub" key={i}>
        {reduce ? "This takes about half a minute." : READING_LINES[i]}
      </p>
    </div>
  );
};

const ReviewLine = ({ line, items, onChange }) => {
  const options = useMemo(() => {
    const list = items.map((i) => ({ id: i.id, name: i.name }));
    if (line.matchId && !list.some((o) => o.id === line.matchId)) {
      list.push({ id: line.matchId, name: line.matchName || "That item" });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [items, line.matchId, line.matchName]);
  const match = line.matchId ? items.find((i) => i.id === line.matchId) : null;

  const pickMatch = (value) => {
    if (!value) return onChange({ matchId: null });
    const id = Number(value);
    const opt = options.find((o) => o.id === id);
    onChange({ matchId: id, matchName: opt ? opt.name : null, name: opt ? opt.name : line.name });
  };

  return (
    <li className={`pt-line${line.keep ? "" : " is-off"}`}>
      <div className="pt-line-top">
        <label className="pt-keep">
          <input type="checkbox" checked={line.keep} onChange={(e) => onChange({ keep: e.target.checked })} />
          <span className="sr-only">Add this line</span>
        </label>
        <code className="pt-line-raw">{line.raw || "typed in"}</code>
        {line.priceCents != null && <span className="pt-line-price">{money(line.priceCents)}</span>}
      </div>
      {line.keep && (
        <div className="pt-line-body">
          <input
            className="pt-line-name"
            value={line.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="What is it?"
            aria-label="Name"
            maxLength={60}
            disabled={Boolean(line.matchId)}
          />
          <div className="pt-line-controls">
            <select
              className={`pt-line-match${line.matchId ? " is-restock" : " is-new"}`}
              value={line.matchId || ""}
              onChange={(e) => pickMatch(e.target.value)}
              aria-label="Restocks"
            >
              <option value="">New item</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  Restock: {o.name}
                </option>
              ))}
            </select>
            <div className="pt-stepper is-small">
              <button type="button" aria-label="Fewer" onClick={() => onChange({ qty: Math.max(0.25, stepQty(line.qty, -1)) })} disabled={line.qty <= 0.25}>
                <i className="fa-solid fa-minus" aria-hidden="true" />
              </button>
              <output>{qtyText(line.qty)}</output>
              <button type="button" aria-label="More" onClick={() => onChange({ qty: stepQty(line.qty, 1) })}>
                <i className="fa-solid fa-plus" aria-hidden="true" />
              </button>
            </div>
            {!line.matchId && (
              <select value={line.location} onChange={(e) => onChange({ location: e.target.value })} aria-label="Kept in">
                {LOCATIONS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {match && (
            <p className="pt-line-note">
              Have {qtyText(match.qty)} now → {qtyText(match.qty + line.qty)}
            </p>
          )}
        </div>
      )}
    </li>
  );
};

export default ReceiptFlow;
