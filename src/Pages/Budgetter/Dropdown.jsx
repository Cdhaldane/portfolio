import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Dropdown.css";

/*
 * Custom dropdown — replaces every native <select> in Budgetter. The OS
 * paints native option popups, so they ignore the app's theme entirely
 * (dark mode was serving grey-on-white options); this one is ordinary DOM
 * that wears the page's tokens in both themes.
 *
 * A11y: the ARIA 1.2 select-only combobox pattern. Focus never leaves the
 * trigger button — the highlighted option is conveyed via
 * aria-activedescendant. Enter/Space/arrows open; arrows/Home/End move;
 * typing jumps (type-ahead); Enter/Space picks; Esc/Tab/outside-click/scroll
 * close (scroll-close matches native selects).
 *
 * The popup is PORTALED into the nearest `.bud` wrapper, not rendered in
 * place: in place it would be clipped by overflow-hidden ancestors
 * (`.rec-list`) and mispositioned by backdrop-filter cards, and portaling
 * to <body> would lose the `--ink`/`--line` tokens that live on `.bud`.
 * `.bud` itself has no transform/filter, so position:fixed coordinates are
 * true viewport coordinates there.
 *
 * Options: [{ value, label, disabled? }] and/or groups:
 * [{ label, options: [...] }] (group labels are presentational).
 */

const MAX_STAGGER = 8; // options beyond this share the last animation delay
const POP_MAX_H = 288; // must match .bdd-pop max-height
const TYPEAHEAD_MS = 500;

const Dropdown = ({
  value,
  onChange,
  options,
  groups,
  ariaLabel,
  title,
  variant = "field",
  className = "",
  disabled = false,
}) => {
  const id = useId();
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const portalRef = useRef(null);
  const typeRef = useRef({ buffer: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(0);

  // Render rows (group headers interleaved) + the flat keyboard-navigable
  // list. selIdx links a row to its position in that flat list.
  const rows = useMemo(() => {
    const out = [];
    let selIdx = 0;
    const push = (opt) =>
      out.push({ kind: "option", ...opt, selIdx: opt.disabled ? null : selIdx++ });
    if (groups) {
      for (const g of groups) {
        if (g.label) out.push({ kind: "group", label: g.label });
        for (const opt of g.options) push(opt);
      }
    }
    if (options) for (const opt of options) push(opt);
    return out;
  }, [options, groups]);
  const selectable = useMemo(
    () => rows.filter((r) => r.kind === "option" && !r.disabled),
    [rows]
  );
  const current = rows.find((r) => r.kind === "option" && r.value === value);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  const openList = () => {
    if (disabled || !selectable.length || !wrapRef.current) return;
    portalRef.current = wrapRef.current.closest(".bud") || document.body;
    const rect = wrapRef.current.getBoundingClientRect();
    const estimate = Math.min(rows.length * 38 + 12, POP_MAX_H);
    const up =
      window.innerHeight - rect.bottom < estimate + 12 && rect.top > estimate + 12;
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      top: up ? null : rect.bottom + 6,
      bottom: up ? window.innerHeight - rect.top + 6 : null,
      width: rect.width,
      up,
    });
    const sel = selectable.findIndex((r) => r.value === value);
    setActive(sel >= 0 ? sel : 0);
    setOpen(true);
  };

  const choose = (opt) => {
    if (opt.value !== value) onChange(opt.value);
    close();
  };

  const typeahead = (ch) => {
    const now = Date.now();
    const t = typeRef.current;
    t.buffer = (now - t.at < TYPEAHEAD_MS ? t.buffer : "") + ch.toLowerCase();
    t.at = now;
    const idx = selectable.findIndex((r) =>
      String(r.label).toLowerCase().startsWith(t.buffer)
    );
    if (idx >= 0) setActive(idx);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, selectable.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(selectable.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (selectable[active]) choose(selectable[active]);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(); // let focus move on
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) typeahead(e.key);
    }
  };

  // Outside interaction closes. Scroll closes too (like a native select) —
  // except scrolling inside the option list itself.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) {
        close();
      }
    };
    const onScroll = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onDoc, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDoc, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  // Keep the keyboard-highlighted option in view inside the scrollable list.
  useEffect(() => {
    if (!open) return;
    popRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <span
      ref={wrapRef}
      className={`bdd bdd--${variant} ${className}`}
      title={title}
    >
      <button
        type="button"
        className={`bdd-btn ${open ? "is-open" : ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={
          open && selectable[active] ? `${id}-opt-${active}` : undefined
        }
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="bdd-value">{current ? current.label : "—"}</span>
        <svg className="bdd-chev" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        pos &&
        portalRef.current &&
        createPortal(
          <div
            ref={popRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            className={`bdd-pop bdd-pop--${variant} ${pos.up ? "is-up" : ""}`}
            style={{
              left: pos.left,
              top: pos.top ?? "auto",
              bottom: pos.bottom ?? "auto",
              minWidth: pos.width,
              maxWidth: Math.max(
                pos.width,
                Math.min(window.innerWidth - pos.left - 12, 420)
              ),
            }}
          >
            {rows.map((r, i) => {
              if (r.kind === "group") {
                return (
                  <div key={`g-${i}`} className="bdd-group" role="presentation">
                    {r.label}
                  </div>
                );
              }
              const isSelected = r.value === value;
              const isActive = r.selIdx === active;
              return (
                <div
                  key={`${r.value}-${i}`}
                  id={r.selIdx != null ? `${id}-opt-${r.selIdx}` : undefined}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={r.disabled || undefined}
                  data-active={isActive || undefined}
                  className={`bdd-opt ${isSelected ? "is-selected" : ""} ${
                    isActive ? "is-active" : ""
                  } ${r.disabled ? "is-off" : ""}`}
                  style={{ "--i": Math.min(i, MAX_STAGGER) }}
                  // preventDefault keeps focus on the trigger, so blur/focus
                  // handling never fights the click
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerEnter={() => {
                    if (r.selIdx != null) setActive(r.selIdx);
                  }}
                  onClick={() => {
                    if (!r.disabled) choose(r);
                  }}
                >
                  <span className="bdd-opt-label">{r.label}</span>
                  {isSelected && (
                    <svg className="bdd-check" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M3 8.5l3.2 3.2L13 5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>,
          portalRef.current
        )}
    </span>
  );
};

export default Dropdown;
