import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import * as api from "../api";
import { CATEGORIES, LOCATIONS, agoText, badgeFor, dayText, money, qtyText, rhythmText, stepQty } from "../format";

/*
 * One item, up close: the quick taps (used one, running low, out, bought
 * one) apply straight away; the details below save with the button. With no
 * item it's the "add something by hand" form.
 */
const blank = (preset = {}) => ({
  name: "",
  location: "pantry",
  category: "other",
  qty: 1,
  lowAt: 0.25,
  staple: null,
  shelfDays: "",
  ...preset,
});

const fromItem = (item) => ({
  name: item.name,
  location: item.location,
  category: item.category,
  qty: item.qty,
  lowAt: item.lowAt,
  staple: item.staple,
  shelfDays: item.shelfDays == null ? "" : String(item.shelfDays),
});

const ItemSheet = ({ open, item, preset, today, pending, getToken, onClose, onChange, onSaved, onDeleted, say }) => {
  const isNew = !item;
  const [form, setForm] = useState(() => (item ? fromItem(item) : blank(preset)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-seed when a different item opens, or when this one changes underneath
  // (a quick tap, the other person's edit after a refresh).
  const seed = item ? `${item.id}:${item.qty}:${item.name}` : `new:${open}`;
  useEffect(() => {
    setForm(item ? fromItem(item) : blank(preset));
    setError(null);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e && e.target ? e.target.value : e }));

  const quick = async (op) => {
    const updated = await onChange(item.id, op, op === "add" ? 1 : undefined);
    if (!updated) return;
    if (op === "out") say(`${updated.name} is out. It's on the list.`);
    else if (op === "low") say(`${updated.name} is running low. It's on the list.`);
    else if (op === "add") say(`Got another ${updated.name}.`);
    onClose();
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      id: item ? item.id : undefined,
      name: form.name,
      location: form.location,
      category: form.category,
      lowAt: form.lowAt,
      staple: form.staple,
      shelfDays: form.shelfDays === "" ? null : Number(form.shelfDays),
      qty: isNew ? form.qty : undefined,
    };
    const result = await api.saveItem(getToken, payload);
    if (!result.ok) {
      setBusy(false);
      return setError(result.error);
    }
    let saved = result.item;
    if (!isNew && form.qty !== item.qty) {
      const counted = await onChange(item.id, "set", form.qty);
      if (counted) saved = counted;
    }
    setBusy(false);
    onSaved(saved);
  };

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    const result = await api.deleteItem(getToken, item.id);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDeleted(result.data, item.name);
  };

  const badge = item && badgeFor(item.status);
  const rhythm = item && rhythmText(item);
  const staple = form.staple == null ? "auto" : form.staple ? "yes" : "no";

  return (
    <Sheet open={open} onClose={onClose} label={isNew ? "Add to the pantry" : item.name}>
      <form className="pt-item" onSubmit={save}>
        <header className="pt-item-head">
          <p className="pt-eyebrow">{isNew ? "Add by hand" : badge ? badge.label : "In stock"}</p>
          <input
            className="pt-item-name"
            value={form.name}
            onChange={set("name")}
            placeholder="What is it?"
            aria-label="Name"
            maxLength={60}
            required
          />
        </header>

        {!isNew && (
          <div className="pt-quick" role="group" aria-label="Quick changes">
            <QuickButton icon="fa-minus" label="Used one" disabled={pending || item.qty <= 0} onClick={() => quick("use")} />
            <QuickButton icon="fa-battery-quarter" label="Running low" disabled={pending || item.qty <= 0} onClick={() => quick("low")} />
            <QuickButton icon="fa-circle-xmark" label="All gone" tone="out" disabled={pending || item.qty <= 0} onClick={() => quick("out")} />
            <QuickButton icon="fa-cart-shopping" label="Bought one" tone="good" disabled={pending} onClick={() => quick("add")} />
          </div>
        )}

        {item && (
          <dl className="pt-facts">
            {item.lastBoughtOn && (
              <div>
                <dt>Last bought</dt>
                <dd>{agoText(item.lastBoughtOn, today)}</dd>
              </div>
            )}
            {rhythm && (
              <div>
                <dt>Rhythm</dt>
                <dd>{rhythm}</dd>
              </div>
            )}
            {item.status.useBy && (
              <div>
                <dt>Best by</dt>
                <dd>about {dayText(item.status.useBy)}</dd>
              </div>
            )}
            {item.unitCents != null && (
              <div>
                <dt>Last paid</dt>
                <dd>{money(item.unitCents)} each</dd>
              </div>
            )}
          </dl>
        )}

        <div className="pt-field">
          <span className="pt-field-label">On hand</span>
          <div className="pt-stepper">
            <button type="button" aria-label="Less" onClick={() => setForm((f) => ({ ...f, qty: stepQty(f.qty, -1) }))} disabled={form.qty <= 0}>
              <i className="fa-solid fa-minus" aria-hidden="true" />
            </button>
            <output aria-live="polite">{qtyText(form.qty)}</output>
            <button type="button" aria-label="More" onClick={() => setForm((f) => ({ ...f, qty: stepQty(f.qty, 1) }))}>
              <i className="fa-solid fa-plus" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="pt-field-row">
          <label className="pt-field">
            <span className="pt-field-label">Kept in</span>
            <select value={form.location} onChange={set("location")}>
              {LOCATIONS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pt-field">
            <span className="pt-field-label">Kind</span>
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="pt-field-row">
          <div className="pt-field">
            <span className="pt-field-label">Low when down to</span>
            <div className="pt-stepper is-small">
              <button type="button" aria-label="Lower" onClick={() => setForm((f) => ({ ...f, lowAt: stepQty(f.lowAt, -1) }))} disabled={form.lowAt <= 0}>
                <i className="fa-solid fa-minus" aria-hidden="true" />
              </button>
              <output>{form.lowAt <= 0 ? "out" : qtyText(form.lowAt)}</output>
              <button type="button" aria-label="Higher" onClick={() => setForm((f) => ({ ...f, lowAt: stepQty(f.lowAt, 1) }))}>
                <i className="fa-solid fa-plus" aria-hidden="true" />
              </button>
            </div>
          </div>
          <label className="pt-field">
            <span className="pt-field-label">Keeps for (days)</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="3650"
              value={form.shelfDays}
              onChange={set("shelfDays")}
              placeholder="doesn't spoil"
            />
          </label>
        </div>

        <fieldset className="pt-field">
          <legend className="pt-field-label">Keep it stocked</legend>
          <div className="pt-seg" role="radiogroup">
            {[
              { key: "auto", label: item && item.status.staple && form.staple == null ? "Auto (yes)" : "Auto", value: null },
              { key: "yes", label: "Always", value: true },
              { key: "no", label: "No", value: false },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={staple === o.key}
                className={staple === o.key ? "is-active" : ""}
                onClick={() => setForm((f) => ({ ...f, staple: o.value }))}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="pt-hint">Auto keeps anything you've bought twice. Kept items are flagged when they're usually due again.</p>
        </fieldset>

        {error && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}

        <div className="pt-item-actions">
          {!isNew && (
            <button type="button" className={`pt-btn is-danger${confirmDelete ? " is-armed" : ""}`} onClick={remove} disabled={busy}>
              {confirmDelete ? "Tap again to delete" : "Delete"}
            </button>
          )}
          <button type="submit" className="pt-btn is-primary" disabled={busy || !form.name.trim()}>
            {busy ? "Saving…" : isNew ? "Add it" : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
};

const QuickButton = ({ icon, label, onClick, disabled, tone = "" }) => (
  <button type="button" className={`pt-quick-btn${tone ? ` is-${tone}` : ""}`} onClick={onClick} disabled={disabled}>
    <i className={`fa-solid ${icon}`} aria-hidden="true" />
    <span>{label}</span>
  </button>
);

export default ItemSheet;
