import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { askQuestion, sendFlag } from "./api";
import { dueItems, localISO, setPref, useActa } from "./store";
import {
  canPromptInstall,
  currentSubscription,
  disableReminder,
  enableReminder,
  isIOS,
  isStandalone,
  onPwaChange,
  promptInstall,
  pushSupported,
} from "./pwa";
import { credit } from "./lessonUtil";

/** A bottom sheet: Escape or the scrim closes it, focus goes in and comes back. */
export function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement;
    const first = ref.current && ref.current.querySelector("button, a[href], input, textarea, select");
    if (first) first.focus();
    const onKey = (e) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before && before.focus) before.focus();
    };
  }, []);
  return (
    <div className="ac-sheet-wrap">
      <div className="ac-scrim" onClick={() => close.current()} />
      <div className="ac-sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="ac-sheet-top">
          <span className="ac-label">{title}</span>
          <button type="button" className="ac-x" onClick={() => close.current()} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const SIZES = [
  ["s", "Small"],
  ["m", "Medium"],
  ["l", "Large"],
];

function usePwa() {
  return useSyncExternalStore(onPwaChange, canPromptInstall, () => false);
}

function Reminder() {
  const [state, setState] = useState({ on: null, busy: false, msg: "" });
  useEffect(() => {
    let live = true;
    currentSubscription().then((s) => live && setState((x) => ({ ...x, on: Boolean(s) })));
    return () => {
      live = false;
    };
  }, []);
  if (!pushSupported() && !isIOS()) return null;
  const toggle = async () => {
    setState((x) => ({ ...x, busy: true, msg: "" }));
    const r = state.on ? await disableReminder() : await enableReminder();
    setState({ on: r.ok ? !state.on : state.on, busy: false, msg: r.ok ? (state.on ? "Reminder off." : "You'll get a nudge each morning a lesson goes live.") : r.error });
  };
  return (
    <div className="ac-menu-row">
      <div>
        <b>Daily reminder</b>
        <span>{state.msg || "A notification each morning when the new lesson is out."}</span>
      </div>
      <button type="button" className={`ac-btn${state.on ? " is-solid" : ""}`} aria-pressed={Boolean(state.on)} disabled={state.busy || state.on === null} onClick={toggle}>
        {state.busy ? "…" : state.on ? "On" : "Off"}
      </button>
    </div>
  );
}

function Install() {
  const can = usePwa();
  if (isStandalone()) return null;
  if (can) {
    return (
      <div className="ac-menu-row">
        <div>
          <b>Install Acta</b>
          <span>Opens full screen, works offline with today's lesson.</span>
        </div>
        <button type="button" className="ac-btn" onClick={() => promptInstall()}>
          Install
        </button>
      </div>
    );
  }
  if (isIOS()) {
    return (
      <div className="ac-menu-row">
        <div>
          <b>Add to Home Screen</b>
          <span>In Safari, tap Share, then Add to Home Screen. It opens full screen and works offline.</span>
        </div>
      </div>
    );
  }
  return null;
}

export function MenuSheet({ onClose, lesson, owner }) {
  const size = useActa((s) => s.prefs.size);
  const deck = useActa((s) => s.deck);
  const due = dueItems(deck, localISO()).length;
  const location = useLocation();
  const article = lesson ? `${lesson.slug && location.pathname !== "/acta" ? `/acta/${lesson.slug}` : "/acta"}?view=article` : null;
  return (
    <Sheet title="Acta Diurna" onClose={onClose}>
      <nav className="ac-menu-nav" aria-label="Acta">
        <Link to="/acta" onClick={onClose}>
          Today
        </Link>
        <Link to="/acta/review" onClick={onClose}>
          Review{due ? <span className="ac-count">{due}</span> : null}
        </Link>
        <Link to="/acta/archive" onClick={onClose}>
          Archive
        </Link>
        <Link to="/acta/timeline" onClick={onClose}>
          Timeline
        </Link>
        <Link to="/acta/saved" onClick={onClose}>
          Saved cards
        </Link>
        {owner ? (
          <Link to="/acta/desk" onClick={onClose}>
            Desk
          </Link>
        ) : null}
      </nav>
      {article ? (
        <div className="ac-menu-row">
          <div>
            <b>Read as an article</b>
            <span>The whole lesson on one scrolling page, for a desk.</span>
          </div>
          <Link className="ac-btn" to={article} onClick={onClose}>
            Open
          </Link>
        </div>
      ) : null}
      <div className="ac-menu-row">
        <div>
          <b>Text size</b>
        </div>
        <div className="ac-seg" role="group" aria-label="Text size">
          {SIZES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={size === k} onClick={() => setPref("size", k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <Reminder />
      <Install />
      <p className="ac-about">
        One history lesson a day, about fifteen minutes, written by Claude from Wikipedia and primary sources and fact-checked against them before it goes out. Images come from Wikimedia
        Commons. Spot a mistake? Tap Sources on any card to flag it.
      </p>
    </Sheet>
  );
}

const REASONS = [
  ["fact", "A fact is wrong"],
  ["quote", "The quote looks wrong"],
  ["image", "Wrong or misleading picture"],
  ["typo", "Typo"],
  ["other", "Something else"],
];

function FlagForm({ lesson, index, canSend }) {
  const [reason, setReason] = useState("fact");
  const [note, setNote] = useState("");
  const [state, setState] = useState({ busy: false, done: false, error: "" });
  if (state.done) return <p className="ac-result">Thanks. Charlie will look at it, and the card sits out of review decks until it's checked.</p>;
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, done: false, error: "" });
    const r = await sendFlag({ slug: lesson.slug, card: index, reason, note: note.trim() });
    setState({ busy: false, done: r.ok, error: r.ok ? "" : r.error });
  };
  return (
    <form className="ac-flag" onSubmit={submit}>
      <fieldset>
        <legend>What's wrong?</legend>
        <div className="ac-chips">
          {REASONS.map(([k, label]) => (
            <label key={k} className={reason === k ? "is-on" : ""}>
              <input type="radio" name="ac-reason" value={k} checked={reason === k} onChange={() => setReason(k)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="ac-field">
        <span>Details (optional{reason === "other" ? ", but needed here" : ""})</span>
        <textarea id="ac-flag-note" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should it say? A source helps." />
      </label>
      {state.error ? <p className="ac-error">{state.error}</p> : null}
      <button type="submit" className="ac-btn is-solid" disabled={!canSend || state.busy || (reason === "other" && !note.trim())}>
        {state.busy ? "Sending…" : "Send"}
      </button>
      {!canSend ? <p className="ac-note">Flags work on published lessons.</p> : null}
    </form>
  );
}

function Ask({ lesson, index, owner }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState({ busy: false, answer: "", error: "" });
  const submit = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setState({ busy: true, answer: "", error: "" });
    const r = await askQuestion(owner.getToken, { slug: lesson.slug, card: index, question: q.trim() });
    setState({ busy: false, answer: r.ok ? r.answer : "", error: r.ok ? "" : r.error });
  };
  return (
    <form className="ac-ask" onSubmit={submit}>
      <label className="ac-field">
        <span>Ask the historian</span>
        <input id="ac-ask-q" type="text" maxLength={400} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why didn't they just…?" />
      </label>
      <button type="submit" className="ac-btn is-solid" disabled={state.busy || !q.trim()}>
        {state.busy ? "Thinking…" : "Ask"}
      </button>
      {state.answer ? <p className="ac-answer">{state.answer}</p> : null}
      {state.error ? <p className="ac-error">{state.error}</p> : null}
    </form>
  );
}

export function SourcesSheet({ onClose, lesson, card, index, owner, mode }) {
  const [flagOpen, setFlagOpen] = useState(false);
  const ids = card.src || [];
  const all = lesson.sources || [];
  const own = all.filter((s) => ids.includes(s.id));
  const list = own.length ? own : all;
  const image = card.image && card.image.url ? card.image : null;
  const canFlag = mode === "today" || mode === "archive";
  return (
    <Sheet title={card.type === "close" ? "Lesson sources" : `Sources · card ${index + 1}`} onClose={onClose}>
      <div className="ac-sources">
        {!own.length && card.type !== "close" ? <p className="ac-note">This card draws on the lesson's sources:</p> : null}
        <ul>
          {list.map((s) => (
            <li key={s.id}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </li>
          ))}
        </ul>
        {image ? (
          <p className="ac-note">
            Image: <a href={image.descUrl} target="_blank" rel="noreferrer">{credit(image)}</a>, via Wikimedia Commons
            {image.licenseUrl ? (
              <>
                {" "}
                (<a href={image.licenseUrl} target="_blank" rel="noreferrer">licence</a>)
              </>
            ) : null}
            .
          </p>
        ) : null}
      </div>
      {owner && owner.signedIn && card.type !== "close" ? <Ask lesson={lesson} index={index} owner={owner} /> : null}
      {card.type !== "close" ? (
        flagOpen ? (
          <FlagForm lesson={lesson} index={index} canSend={canFlag} />
        ) : (
          <button type="button" className="ac-btn ac-btn--quiet" onClick={() => setFlagOpen(true)}>
            Something wrong on this card?
          </button>
        )
      ) : null}
    </Sheet>
  );
}
