import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./CommandPalette.css";

/*
 * ⌘K / Ctrl+K command palette — keyboard-first navigation for the whole site,
 * plus quick actions (theme, résumé, GitHub) and a nod to the hidden ops
 * console. Mounted once globally in App.js. Renders nothing until invoked.
 *
 * Open it from anywhere by dispatching: window.dispatchEvent(new Event("open-command-palette"))
 */

const isMac = () =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || "");

// Theme is owned by <ThemeSwitch>; we flip the same source of truth and fire a
// "themechange" event so the switch's UI stays in sync (it listens for it).
const currentDark = () => {
  try {
    const stored = localStorage.getItem("isDarkMode");
    if (stored !== null) return JSON.parse(stored);
  } catch (_) {
    /* localStorage unavailable — fall back to the DOM attribute */
  }
  return document.documentElement.getAttribute("data-theme") === "dark";
};

const toggleTheme = () => {
  const dark = !currentDark();
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.body.classList.toggle("light-mode", !dark);
  try {
    localStorage.setItem("isDarkMode", JSON.stringify(dark));
  } catch (_) {
    /* ignore persistence failure */
  }
  window.dispatchEvent(new CustomEvent("themechange", { detail: { dark } }));
};

const CommandPalette = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const restoreRef = useRef(null);

  const commands = useMemo(
    () => [
      { id: "home", section: "Navigate", icon: "fa-house", title: "Home", keywords: "landing start", run: () => navigate("/") },
      { id: "work", section: "Navigate", icon: "fa-layer-group", title: "Work", keywords: "projects portfolio case studies", run: () => navigate("/work") },
      { id: "about", section: "Navigate", icon: "fa-user", title: "About", keywords: "bio story me", run: () => navigate("/about") },
      { id: "services", section: "Navigate", icon: "fa-briefcase", title: "Services", keywords: "hire freelance offerings", run: () => navigate("/services") },
      { id: "showcase", section: "Navigate", icon: "fa-shapes", title: "Showcase", keywords: "components demos", run: () => navigate("/showcase") },
      { id: "contact", section: "Navigate", icon: "fa-paper-plane", title: "Contact", keywords: "email get in touch hire message", run: () => navigate("/contact") },
      { id: "guestbook", section: "Navigate", icon: "fa-pen-nib", title: "Guestbook", keywords: "sign wall note leave message visitors", run: () => navigate("/guestbook") },

      { id: "theme", section: "Actions", icon: "fa-circle-half-stroke", title: "Toggle light / dark", keywords: "theme dark light mode appearance", keepOpen: true, run: toggleTheme },
      { id: "resume", section: "Actions", icon: "fa-file-lines", title: "View résumé (PDF)", keywords: "cv download hire", run: () => window.open("/CHARLIE_RESUME_5.pdf", "_blank", "noopener,noreferrer") },
      { id: "github", section: "Actions", icon: "fa-code", title: "GitHub", keywords: "code repos source open", run: () => window.open("https://github.com/Cdhaldane", "_blank", "noopener,noreferrer") },
      { id: "ops", section: "Actions", icon: "fa-terminal", title: "Open the ops console", hint: "hidden", keywords: "dashboard games secret imposter crossword wavelength fishbowl", run: () => navigate("/dashboard") },
    ],
    [navigate]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.title} ${c.keywords || ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset the highlight whenever the result set or open-state changes.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  // Global open/close shortcut + programmatic open event.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Focus management + scroll lock while open; restore focus on close.
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement;
      document.body.style.overflow = "hidden";
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        cancelAnimationFrame(raf);
        document.body.style.overflow = "";
      };
    }
    setQuery("");
    restoreRef.current?.focus?.();
    return undefined;
  }, [open]);

  // Keep the active item scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const run = useCallback((cmd) => {
    if (!cmd) return;
    if (!cmd.keepOpen) setOpen(false);
    cmd.run();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    }
  };

  if (!open) return null;

  // Group the filtered results by section while preserving flat indices.
  const groups = [];
  filtered.forEach((c, i) => {
    let g = groups.find((x) => x.name === c.section);
    if (!g) {
      g = { name: c.section, items: [] };
      groups.push(g);
    }
    g.items.push({ ...c, idx: i });
  });

  return (
    <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
      <div className="cmdk-backdrop" onClick={() => setOpen(false)} />
      <div className="cmdk-panel">
        <span className="cmdk-accent" aria-hidden="true" />

        <div className="cmdk-input-row">
          <i className="fa-solid fa-magnifying-glass cmdk-search" aria-hidden="true" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search pages and actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={filtered[active] ? `cmdk-opt-${active}` : undefined}
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="cmdk-kbd">esc</kbd>
        </div>

        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmdk-empty">No matches for “{query.trim()}”.</div>
          )}
          {groups.map((g) => (
            <div className="cmdk-group" key={g.name}>
              <div className="cmdk-group-label">{g.name}</div>
              {g.items.map((c) => (
                <button
                  key={c.id}
                  id={`cmdk-opt-${c.idx}`}
                  data-idx={c.idx}
                  role="option"
                  aria-selected={c.idx === active}
                  className={`cmdk-item ${c.idx === active ? "is-active" : ""}`}
                  onMouseMove={() => setActive(c.idx)}
                  onClick={() => run(c)}
                >
                  <i className={`fa-solid ${c.icon} cmdk-item-icon`} aria-hidden="true" />
                  <span className="cmdk-item-title">{c.title}</span>
                  {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
                  <i className="fa-solid fa-turn-down cmdk-item-enter" aria-hidden="true" />
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="cmdk-foot">
          <span><kbd className="cmdk-kbd">↑</kbd><kbd className="cmdk-kbd">↓</kbd> navigate</span>
          <span><kbd className="cmdk-kbd">↵</kbd> select</span>
          <span className="cmdk-foot-brand">{isMac() ? "⌘" : "Ctrl"}&nbsp;K</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
