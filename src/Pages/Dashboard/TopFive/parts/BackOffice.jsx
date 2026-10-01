import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import TradingCard from "./TradingCard";
import { resetPack, savePack } from "../api";
import { CARD_RATIO } from "../poses";
import { ICON_RE, LIMITS, cleanText, collectorNo, rarityOf } from "../top5.data";
import {
  draftErrors,
  moveCard,
  sameDraft,
  setCardField,
  setCardStat,
  setPackField,
  setStatLabel,
  toDraft,
  toPayload,
} from "../editorDraft";
import "./BackOffice.css";

const PREVIEW_W = 220;
// Suggestions for the icon field (any free Font Awesome solid name works).
const ICON_IDEAS = [
  "fa-film", "fa-ticket", "fa-video", "fa-pizza-slice", "fa-burger", "fa-ice-cream",
  "fa-bowl-food", "fa-mug-hot", "fa-cookie", "fa-lemon", "fa-guitar", "fa-headphones",
  "fa-compact-disc", "fa-microphone", "fa-gamepad", "fa-dice", "fa-chess-knight", "fa-tv",
  "fa-mountain", "fa-tree", "fa-city", "fa-plane", "fa-earth-americas", "fa-book",
  "fa-star", "fa-heart", "fa-bolt", "fa-fire", "fa-rocket", "fa-robot", "fa-ghost",
  "fa-fish", "fa-dog", "fa-cat", "fa-car-side", "fa-bicycle", "fa-futbol",
  "fa-hockey-puck", "fa-bowling-ball", "fa-wand-magic-sparkles", "fa-crown", "fa-code",
];

const Field = ({ id, label, value, max, error, onChange, optional = false, multiline = false }) => {
  const Tag = multiline ? "textarea" : "input";
  const length = (cleanText(value) || "").length;
  return (
    <div className={`td-bo-field ${error ? "is-bad" : ""}`}>
      <label className="td-bo-label" htmlFor={id}>
        {label}
        {optional ? <em> optional</em> : null}
      </label>
      <Tag
        id={id}
        value={value}
        maxLength={max}
        rows={multiline ? 2 : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="td-bo-hint" id={`${id}-hint`}>
        {error || `${length}/${max}`}
      </span>
    </div>
  );
};

const cardHasError = (errors, i) => Object.keys(errors).some((k) => k.startsWith(`card-${i}-`));

/** A flat (non-3D) render of the real card front, for the live preview. */
const Preview = ({ pack, draft, index }) => {
  const rank = index + 1;
  // Show exactly what will be stored (the same cleaning the API applies).
  const card = toPayload(draft).cards[index];
  const safeCard = { ...card, icon: ICON_RE.test(card.icon) ? card.icon : "fa-question" };
  return (
    <div
      className="td-bo-preview"
      style={{ "--cw": `${PREVIEW_W}px`, "--ch": `${PREVIEW_W * CARD_RATIO}px`, "--h": pack.hue }}
      aria-hidden="true"
    >
      <div className="td-bo-preview-card">
        <TradingCard
          pack={{ ...pack, kind: pack.kind }}
          card={safeCard}
          rank={rank}
          tier={rarityOf(rank).tier}
          collector={collectorNo(pack, rank)}
          concealed={false}
          detailed={false}
          backShown={false}
          live={false}
          lite
          shiny={false}
          pulledAt={null}
          flourish={pack.flourish}
          frontVis="visible"
          backVis="hidden"
        />
      </div>
    </div>
  );
};

/*
 * The Top 5 back office: edit any pack's name, tagline, stat labels and its
 * five picks (re-rank, retitle, re-take, re-icon, re-score), with a live card
 * preview. Drafts are kept per pack, so hopping between packs never loses
 * work. Saving goes through /api/top5, which re-validates and re-checks that
 * the caller is the owner; this UI is only the front counter.
 */
export default function BackOffice({ catalog, getToken, onSaved, onDirty }) {
  const all = useMemo(() => [...catalog.packs, catalog.secret], [catalog]);
  const [packId, setPackId] = useState(all[0].id);
  const [drafts, setDrafts] = useState({});
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);
  const [armReset, setArmReset] = useState(false);

  const base = catalog.byId.get(packId);
  const baseDraft = useMemo(() => toDraft(base), [base]);
  const draft = drafts[packId] || baseDraft;
  const dirty = !sameDraft(draft, baseDraft);
  const errors = useMemo(() => draftErrors(draft), [draft]);
  const valid = Object.keys(errors).length === 0;
  // One write in flight at a time, so responses can never land out of order.
  const busy = pending;
  const card = draft.cards[sel];

  const dirtyIds = useMemo(
    () =>
      new Set(
        Object.keys(drafts).filter((id) => !sameDraft(drafts[id], toDraft(catalog.byId.get(id))))
      ),
    [drafts, catalog]
  );
  // Layout effect: the parent's close guard must see the latest answer even
  // if a click lands in the same frame as a save.
  useLayoutEffect(() => {
    if (onDirty) onDirty(dirtyIds.size > 0);
  }, [dirtyIds, onDirty]);

  // Reloading or closing the tab with unsaved drafts asks first.
  const hasDirty = dirtyIds.size > 0;
  useEffect(() => {
    if (!hasDirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDirty]);

  // An armed reset disarms itself if you don't confirm.
  useEffect(() => {
    if (!armReset) return undefined;
    const t = setTimeout(() => setArmReset(false), 4000);
    return () => clearTimeout(t);
  }, [armReset]);

  const update = (fn) => {
    // Editing clears old results, but not the "saving…" note of a write in flight.
    setStatus((st) => (st && st.kind === "busy" ? st : null));
    setDrafts((prev) => ({ ...prev, [packId]: fn(prev[packId] || baseDraft) }));
  };
  const dropDraft = () =>
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== packId)));
  // After a write: drop the pack's draft only if nothing was typed meanwhile.
  const settleDraft = (id, sent) =>
    setDrafts((prev) => {
      const typedSince = prev[id] && !(sent && sameDraft(prev[id], sent));
      return typedSince ? prev : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id));
    });

  const pickPack = (id) => {
    setPackId(id);
    setSel(0);
    setArmReset(false);
    setStatus(null);
  };
  const move = (from, to) => {
    update((d) => moveCard(d, from, to));
    if (sel === from) setSel(to);
    else if (sel === to) setSel(from);
  };

  const save = async () => {
    if (!dirty || !valid || busy) return;
    const id = packId;
    const sent = draft;
    setPending(true);
    setStatus({ kind: "busy", text: "Restocking the shelf…" });
    const result = await savePack(getToken, id, toPayload(sent));
    setPending(false);
    if (!result.ok) {
      setStatus({ kind: "bad", text: result.error });
      return;
    }
    onSaved(id, result.pack);
    settleDraft(id, sent);
    setStatus({ kind: "good", text: `${result.pack.name} saved. Everyone sees it on their next visit.` });
  };
  const reset = async (e) => {
    // The second click of a double-click must not confirm the first.
    if (busy || (e && e.detail > 1)) return;
    if (!armReset) {
      setArmReset(true);
      return;
    }
    const id = packId;
    const sent = drafts[id];
    setArmReset(false);
    setPending(true);
    setStatus({ kind: "busy", text: "Putting the original cards back…" });
    const result = await resetPack(getToken, id);
    setPending(false);
    if (!result.ok) {
      setStatus({ kind: "bad", text: result.error });
      return;
    }
    onSaved(id, null);
    settleDraft(id, sent);
    setStatus({ kind: "good", text: "Back to the shipped picks." });
  };

  const id = (field) => `td-bo-${packId}-${field}`;

  return (
    <div className="td-bo">
      <div className="td-bo-packs" role="group" aria-label="Pick a pack to edit">
        {all.map((p) => (
          <button
            key={p.id}
            type="button"
            className="td-bo-chip"
            style={{ "--h": p.hue }}
            aria-pressed={p.id === packId}
            onClick={() => pickPack(p.id)}
          >
            <i className={`fa-solid ${p.icon}`} aria-hidden="true" />
            {p.name}
            {dirtyIds.has(p.id) ? <span className="td-bo-dot" title="Unsaved changes" aria-label="unsaved" /> : null}
            {p.edited && !dirtyIds.has(p.id) ? <span className="td-bo-tag">edited</span> : null}
          </button>
        ))}
      </div>

      <div className="td-bo-grid">
        <div className="td-bo-form">
          <fieldset className="td-bo-set">
            <legend>Pack</legend>
            <div className="td-bo-row">
              <Field id={id("name")} label="Name" value={draft.name} max={LIMITS.packName} error={errors.name} onChange={(v) => update((d) => setPackField(d, "name", v))} />
              <Field id={id("tagline")} label="Tagline" value={draft.tagline} max={LIMITS.tagline} error={errors.tagline} onChange={(v) => update((d) => setPackField(d, "tagline", v))} />
            </div>
            <div className="td-bo-row td-bo-row--3">
              {draft.statLabels.map((label, k) => (
                <Field key={k} id={id(`label-${k}`)} label={`Stat ${k + 1}`} value={label} max={LIMITS.statLabel} error={errors[`label-${k}`]} onChange={(v) => update((d) => setStatLabel(d, k, v))} />
              ))}
            </div>
          </fieldset>

          <fieldset className="td-bo-set">
            <legend>The countdown</legend>
            <ol className="td-bo-picks">
              {draft.cards.map((c, i) => (
                <li key={c.id} className={`td-bo-pick ${i === sel ? "is-sel" : ""} ${cardHasError(errors, i) ? "is-bad" : ""}`}>
                  <button type="button" className="td-bo-pick-main" aria-pressed={i === sel} onClick={() => setSel(i)}>
                    <span className="td-bo-rank">#{i + 1}</span>
                    <i className={`fa-solid ${ICON_RE.test(c.icon) ? c.icon : "fa-question"}`} aria-hidden="true" />
                    <span className="td-bo-pick-title">{cleanText(c.title) || "Untitled"}</span>
                    <span className="td-mono">{rarityOf(i + 1).label}</span>
                  </button>
                  <button type="button" className="td-bo-move" aria-label={`Move #${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    <i className="fa-solid fa-arrow-up" aria-hidden="true" />
                  </button>
                  <button type="button" className="td-bo-move" aria-label={`Move #${i + 1} down`} disabled={i === draft.cards.length - 1} onClick={() => move(i, i + 1)}>
                    <i className="fa-solid fa-arrow-down" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          </fieldset>

          <fieldset className="td-bo-set" key={`${packId}-${card.id}`}>
            <legend>
              #{sel + 1} · {rarityOf(sel + 1).label}
            </legend>
            <Field id={id("title")} label="Title" value={card.title} max={LIMITS.title} error={errors[`card-${sel}-title`]} onChange={(v) => update((d) => setCardField(d, sel, "title", v))} />
            <Field id={id("meta")} label="Meta line" optional value={card.meta} max={LIMITS.meta} error={errors[`card-${sel}-meta`]} onChange={(v) => update((d) => setCardField(d, sel, "meta", v))} />
            <Field id={id("take")} label="Hot take" multiline value={card.take} max={LIMITS.take} error={errors[`card-${sel}-take`]} onChange={(v) => update((d) => setCardField(d, sel, "take", v))} />
            <Field id={id("fun")} label="Fun fact (card back)" optional value={card.fun} max={LIMITS.fun} error={errors[`card-${sel}-fun`]} onChange={(v) => update((d) => setCardField(d, sel, "fun", v))} />
            <div className={`td-bo-field td-bo-icon ${errors[`card-${sel}-icon`] ? "is-bad" : ""}`}>
              <label className="td-bo-label" htmlFor={id("icon")}>
                Icon
              </label>
              <div className="td-bo-icon-row">
                <span className="td-bo-icon-preview" aria-hidden="true">
                  <i className={`fa-solid ${ICON_RE.test(card.icon) ? card.icon : "fa-question"}`} />
                </span>
                <input
                  id={id("icon")}
                  list="td-bo-icons"
                  value={card.icon}
                  maxLength={43}
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={Boolean(errors[`card-${sel}-icon`])}
                  aria-describedby={`${id("icon")}-hint`}
                  onChange={(e) => update((d) => setCardField(d, sel, "icon", e.target.value.trim().toLowerCase()))}
                />
              </div>
              <span className="td-bo-hint" id={`${id("icon")}-hint`}>
                {errors[`card-${sel}-icon`] || "Any free Font Awesome solid icon, like fa-film."}
              </span>
            </div>
            <div className="td-bo-stats">
              {card.stats.map((value, k) => (
                <label key={k} className="td-bo-stat">
                  <span>{cleanText(draft.statLabels[k]) || `Stat ${k + 1}`}</span>
                  <input type="range" min={0} max={10} step={1} value={value} onChange={(e) => update((d) => setCardStat(d, sel, k, e.target.value))} />
                  <b>{value}</b>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <aside className="td-bo-side">
          <Preview pack={{ ...base, name: cleanText(draft.name) || base.name }} draft={draft} index={sel} />
          <p className="td-bo-note">Live preview. Visitors who already opened this pack see the new cards straight away.</p>
        </aside>
      </div>

      <datalist id="td-bo-icons">
        {ICON_IDEAS.map((icon) => (
          <option key={icon} value={icon} />
        ))}
      </datalist>

      <footer className="td-bo-actions">
        <p className={`td-bo-status ${status ? `is-${status.kind}` : ""}`} role="status">
          {status ? status.text : valid ? (dirty ? "Unsaved changes." : "All saved.") : "Fix the highlighted fields to save."}
        </p>
        <div className="td-bo-buttons">
          {base.edited ? (
            <button type="button" className="td-tbtn td-tbtn--ghost" onClick={reset} disabled={busy}>
              <i className="fa-solid fa-rotate-left" aria-hidden="true" />
              <span>{armReset ? "Click again to reset" : "Reset to default"}</span>
            </button>
          ) : null}
          <button type="button" className="td-tbtn" onClick={dropDraft} disabled={!dirty || busy}>
            <span>Discard</span>
          </button>
          <button type="button" className="td-cta" onClick={save} disabled={!dirty || !valid || busy}>
            <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
            Save pack
          </button>
        </div>
      </footer>
    </div>
  );
}
