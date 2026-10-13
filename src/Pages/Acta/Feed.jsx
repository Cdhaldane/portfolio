import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CardView } from "./cards";
import { MenuSheet, SourcesSheet } from "./sheets";
import { MentionContext, MentionSheet } from "./mentions";
import { useNarrator } from "./narrator";
import { feedCards, mentionMatcher, sections } from "./lessonUtil";
import { getState, markDone, savedKey, setPref, setProgress, syncFlags, toggleSaved, useActa } from "./store";
import { precacheImages } from "./pwa";

/*
 * The lesson feed: one card per screen, snapping, read top to bottom like a
 * story feed that ends. Scroll position is read in a rAF-throttled passive
 * listener (one setState per card change, never per frame). Progress is
 * saved as you go, so leaving mid-lesson resumes where you stopped.
 */

const SIZE_ORDER = ["s", "m", "l"];
const DOUBLE_TAP_MS = 320;

const Icon = {
  save: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
    </svg>
  ),
  sources: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h9.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
      <path d="M16.5 8H19v12h-2.5M8 9h5.5M8 12.5h5.5" />
    </svg>
  ),
  listen: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.5a8 8 0 0 1 0 11" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  ),
};

export default function Feed({ lesson, mode = "today", owner = null, onExit = null, banner = null }) {
  const cards = useMemo(() => feedCards(lesson), [lesson]);
  const parts = useMemo(() => sections(cards), [cards]);
  const feedRef = useRef(null);
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const size = useActa((s) => s.prefs.size);
  const saved = useActa((s) => s.saved);
  const location = useLocation();
  const flagged = useMemo(() => new Set(lesson.flagged || []), [lesson.flagged]);
  const track = mode === "today" || mode === "archive" || mode === "sample";
  // Tapping a person or place opens Wikipedia's summary in a sheet.
  const mentions = useMemo(() => ({ matcher: mentionMatcher(lesson.mentions), open: (m) => setSheet(m) }), [lesson.mentions]);

  const showToast = useCallback((text) => {
    setToast({ text, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const goTo = useCallback((i, smooth = true) => {
    const el = feedRef.current;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: i * el.clientHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, []);

  const narrator = useNarrator({ cards, lesson, goTo });

  // Which card is on screen.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const i = Math.max(0, Math.min(cards.length - 1, Math.round(el.scrollTop / Math.max(1, el.clientHeight))));
        setActive((prev) => (prev === i ? prev : i));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [cards.length]);

  // Start where the reader left off (or at ?card=N), once per lesson.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const fromUrl = Number(q.get("card"));
    const p = getState().progress[lesson.slug];
    let start = 0;
    if (Number.isInteger(fromUrl) && fromUrl > 0) start = Math.min(fromUrl, cards.length - 1);
    else if (track && p && !p.done && p.at > 0 && p.at < cards.length - 1) start = p.at;
    if (start > 0) {
      requestAnimationFrame(() => goTo(start, false));
      if (!fromUrl) showToast(`Picked up at card ${start + 1}`);
    }
    if (track) syncFlags(lesson);
    // Keep today's pictures for the subway.
    precacheImages(cards.filter((c) => c.image && c.image.url).map((c) => c.image.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.slug]);

  // Save progress; finishing the lesson files its questions in the deck.
  useEffect(() => {
    if (!track) return undefined;
    const t = setTimeout(() => setProgress(lesson, active, cards.length), 500);
    if (active === cards.length - 1) markDone(lesson);
    return () => clearTimeout(t);
  }, [active, lesson, cards.length, track]);

  useEffect(() => {
    narrator.onActive(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Keyboard: arrows, j/k, space, page keys, Home/End.
  useEffect(() => {
    const onKey = (e) => {
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const step = { ArrowDown: 1, PageDown: 1, j: 1, " ": e.shiftKey ? -1 : 1, ArrowUp: -1, PageUp: -1, k: -1 }[e.key];
      if (e.key === "Home") return goTo(0);
      if (e.key === "End") return goTo(cards.length - 1);
      if (!step) return;
      if (e.key === " " && tag === "BUTTON") return;
      e.preventDefault();
      goTo(Math.max(0, Math.min(cards.length - 1, active + step)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cards.length, goTo, sheet]);

  const card = cards[active];
  const isSaved = Boolean(saved[savedKey(lesson.slug, active)] && !saved[savedKey(lesson.slug, active)].removed);
  const [stamp, setStamp] = useState(0);

  const save = useCallback(
    (fromTap) => {
      if (card.type === "close") return;
      const now = toggleSaved(lesson, card, active);
      showToast(now ? "Saved to your commonplace book" : "Removed from saved cards");
      if (now && fromTap) setStamp(Date.now());
    },
    [card, lesson, active, showToast]
  );

  // Double-tap anywhere that isn't a control saves the card.
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const onPointerUp = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("button, a, input, textarea, label")) return;
    const now = performance.now();
    const p = lastTap.current;
    if (now - p.t < DOUBLE_TAP_MS && Math.abs(e.clientX - p.x) < 30 && Math.abs(e.clientY - p.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      save(true);
    } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };

  const cycleSize = () => {
    const next = SIZE_ORDER[(SIZE_ORDER.indexOf(size) + 1) % SIZE_ORDER.length];
    setPref("size", next);
    showToast(`Text size: ${{ s: "small", m: "medium", l: "large" }[next]}`);
  };

  const toggleListen = () => {
    if (!narrator.supported) return showToast("Listening isn't available in this browser");
    if (narrator.on) narrator.stop();
    else narrator.start(active);
    return undefined;
  };

  const section = parts.find((p) => active >= p.start && active <= p.end);
  const headLeft = mode === "sample" ? "Sample" : mode === "preview" ? "Preview" : lesson.day ? `Day ${lesson.day}` : "";

  return (
    <div className={`ac-feedwrap size-${size}`}>
      <aside className="ac-rail" aria-label="Contents">
        <p className="ac-label">{lesson.subtitle}</p>
        <p className="ac-rail-title">{lesson.title}</p>
        <ol>
          {parts.map((p) => (
            <li key={p.start}>
              <button type="button" className={section === p ? "is-on" : ""} aria-current={section === p ? "step" : undefined} onClick={() => goTo(p.start)}>
                {p.label}
              </button>
            </li>
          ))}
        </ol>
        <p className="ac-rail-keys">↑ ↓ or j k to move · double-click to save</p>
      </aside>

      <div className="ac-column">
        <header className="ac-top">
          <div className="ac-segs" aria-hidden="true">
            {cards.map((_, i) => (
              <i key={i} className={i < active ? "is-done" : i === active ? "is-cur" : ""} />
            ))}
          </div>
          <div className="ac-head">
            <button type="button" className="ac-menu-btn" onClick={() => setSheet("menu")} aria-label="Menu">
              {Icon.menu}
              <span>Acta Diurna</span>
            </button>
            <span className="ac-pos" aria-live="off">
              {headLeft ? `${headLeft} · ` : ""}
              {active + 1} / {cards.length}
            </span>
          </div>
          {banner}
        </header>

        <div
          className="ac-feed"
          ref={feedRef}
          tabIndex={-1}
          onPointerUp={onPointerUp}
          role="feed"
          aria-label={`${lesson.title}: ${cards.length} cards`}
          aria-busy="false"
        >
          <MentionContext.Provider value={mentions}>
            {cards.map((c, i) => (
              <article
                key={i}
                className={`ac-card ac-card--${c.type}${i === active ? " is-active" : ""}${c.image && c.image.url && c.type !== "open" ? " has-fig" : ""}`}
                aria-posinset={i + 1}
                aria-setsize={cards.length}
                aria-label={c.title || c.label || (c.type === "close" ? "Close" : `Card ${i + 1}`)}
              >
                <CardView card={c} lesson={lesson} index={i} mode={mode} flagged={flagged.has(i)} preview={mode === "preview"} />
              </article>
            ))}
          </MentionContext.Provider>
        </div>

        <nav className="ac-bar" aria-label="Card actions">
          <button type="button" className="ac-act" aria-pressed={isSaved} disabled={card.type === "close"} onClick={() => save(false)}>
            {Icon.save}
            <span>{isSaved ? "Saved" : "Save"}</span>
          </button>
          <button type="button" className="ac-act" onClick={() => setSheet("sources")}>
            {Icon.sources}
            <span>Sources</span>
          </button>
          <button type="button" className="ac-act" aria-pressed={narrator.on} onClick={toggleListen}>
            {Icon.listen}
            <span>{narrator.on ? "Stop" : "Listen"}</span>
          </button>
          {onExit ? (
            <button type="button" className="ac-act" onClick={onExit}>
              <span className="ac-aa" aria-hidden="true">
                ×
              </span>
              <span>Close</span>
            </button>
          ) : (
            <button type="button" className="ac-act" onClick={cycleSize} aria-label={`Text size: ${{ s: "small", m: "medium", l: "large" }[size]}`}>
              <span className="ac-aa" aria-hidden="true">
                Aa
              </span>
              <span>Size</span>
            </button>
          )}
        </nav>

        {stamp ? (
          <svg key={stamp} className="ac-stamp" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
          </svg>
        ) : null}
        <div className={`ac-toast${toast ? " is-on" : ""}`} role="status" aria-live="polite">
          {toast ? toast.text : ""}
        </div>
      </div>

      {sheet === "menu" ? <MenuSheet onClose={() => setSheet(null)} lesson={lesson} owner={owner} /> : null}
      {sheet === "sources" ? <SourcesSheet onClose={() => setSheet(null)} lesson={lesson} card={card} index={active} owner={owner} mode={mode} /> : null}
      {sheet && sheet.mention ? <MentionSheet key={sheet.mention.wiki} mention={sheet.mention} name={sheet.name} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
