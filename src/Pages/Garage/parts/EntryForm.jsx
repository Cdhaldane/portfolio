import { useState } from "react";
import { saveEvent } from "../api";
import { KINDS } from "../cars";

/*
 * Add or edit one work-log entry. The service-item chips are what feed the
 * Service tab: tick "Engine oil + filter" on an oil change and the next one
 * is scheduled from this entry's date and km.
 */
const PLACEHOLDER = {
  service: "Oil change",
  repair: "Replaced water pump",
  mod: "Intercooler installed",
  inspection: "Pre-winter inspection",
  other: "Winter tires on",
};

const blank = (today) => ({
  kind: "service",
  happenedOn: today,
  label: "",
  odometerKm: "",
  cost: "",
  doneBy: "",
  parts: "",
  services: [],
  note: "",
});

/** API entry → form strings. */
export const toForm = (e) => ({
  id: e.id,
  kind: e.kind,
  happenedOn: e.happenedOn,
  label: e.kind === "reading" ? "" : e.label,
  odometerKm: e.odometerKm ?? "",
  cost: e.costCents === null || e.costCents === undefined ? "" : (e.costCents / 100).toFixed(2),
  doneBy: e.doneBy || "",
  parts: e.parts || "",
  services: e.services || [],
  note: e.note || "",
});

const EntryForm = ({ getToken, car, initial, today, shops, onSaved, onCancel }) => {
  const [form, setForm] = useState(() => ({ ...blank(today), ...initial }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const reading = form.kind === "reading";

  const toggleService = (key) =>
    setForm((f) => ({
      ...f,
      services: f.services.includes(key) ? f.services.filter((s) => s !== key) : [...f.services, key],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const km = String(form.odometerKm).replace(/[,\s]/g, "");
    const r = await saveEvent(getToken, {
      id: form.id,
      car: car.key,
      kind: form.kind,
      happenedOn: form.happenedOn,
      label: reading ? "Odometer reading" : form.label,
      odometerKm: km === "" ? null : Number(km),
      cost: reading || form.cost === "" ? null : form.cost,
      doneBy: reading ? null : form.doneBy,
      parts: reading ? null : form.parts,
      services: reading ? [] : form.services,
      note: form.note,
    });
    setSaving(false);
    if (r.ok) onSaved(r.event);
    else setError(r.error);
  };

  return (
    <form className="gr-card gr-form" onSubmit={submit} aria-label={form.id ? "Edit entry" : "New entry"}>
      <fieldset className="gr-kinds">
        <legend className="sr-only">Kind of entry</legend>
        {KINDS.map((k) => (
          <label key={k.key} className={`gr-kind ${form.kind === k.key ? "is-on" : ""}`}>
            <input
              type="radio"
              name="kind"
              value={k.key}
              checked={form.kind === k.key}
              onChange={set("kind")}
              className="sr-only"
            />
            <i className={`fa-solid ${k.icon}`} aria-hidden="true" /> {k.label}
          </label>
        ))}
      </fieldset>

      <div className="gr-form-grid">
        <label className="gr-field">
          <span>Date</span>
          <input type="date" required max={today} value={form.happenedOn} onChange={set("happenedOn")} />
        </label>
        {!reading && (
          <label className="gr-field gr-field--wide">
            <span>What was done</span>
            <input
              type="text"
              required
              maxLength={80}
              placeholder={PLACEHOLDER[form.kind]}
              value={form.label}
              onChange={set("label")}
            />
          </label>
        )}
        <label className="gr-field">
          <span>Odometer{reading ? "" : " (optional)"}</span>
          <span className="gr-input-unit">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9 ,]*"
              required={reading}
              placeholder="232450"
              value={form.odometerKm}
              onChange={set("odometerKm")}
            />
            <em>km</em>
          </span>
        </label>
        {!reading && (
          <>
            <label className="gr-field">
              <span>Cost (optional)</span>
              <span className="gr-input-unit gr-input-unit--pre">
                <em>$</em>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.,$ ]*"
                  placeholder="0.00"
                  value={form.cost}
                  onChange={set("cost")}
                />
              </span>
            </label>
            <label className="gr-field">
              <span>Done by</span>
              <input
                type="text"
                maxLength={60}
                list="gr-shops"
                placeholder="DIY, or the shop"
                value={form.doneBy}
                onChange={set("doneBy")}
              />
              <datalist id="gr-shops">
                {shops.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label className="gr-field gr-field--wide">
              <span>Parts</span>
              <input
                type="text"
                maxLength={300}
                placeholder="Brands, part numbers, fluids and specs"
                value={form.parts}
                onChange={set("parts")}
              />
            </label>
          </>
        )}
      </div>

      {!reading && (
        <fieldset className="gr-services">
          <legend>Counts as</legend>
          <div className="gr-service-chips">
            {car.service.map((item) => {
              const on = form.services.includes(item.key);
              return (
                <label key={item.key} className={`gr-chip gr-chip--toggle ${on ? "is-on" : ""}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleService(item.key)} />
                  {on && <i className="fa-solid fa-check" aria-hidden="true" />} {item.label}
                </label>
              );
            })}
          </div>
          <p className="gr-hint">Ticked items restart their countdown on the Service tab.</p>
        </fieldset>
      )}

      <label className="gr-field gr-field--wide">
        <span>Notes</span>
        <textarea rows={2} maxLength={1000} value={form.note} onChange={set("note")} />
      </label>

      {error && (
        <p className="gr-banner" role="alert">
          {error}
        </p>
      )}

      <div className="gr-form-actions">
        <button type="submit" className="gr-btn gr-btn--primary" disabled={saving}>
          <i className="fa-solid fa-floppy-disk" aria-hidden="true" /> {saving ? "Saving…" : form.id ? "Save changes" : "Add to the log"}
        </button>
        <button type="button" className="gr-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

export default EntryForm;
