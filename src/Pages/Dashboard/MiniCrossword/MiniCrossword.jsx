import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getDailyPuzzle, dayIndexFor } from "./puzzles";
import "./MiniCrossword.css";

/* ============================================================
   MINI // CROSSWORD — a daily 5x5 mini in the spirit of the NYT.
   Self-contained cyberpunk node. A new grid rotates in at local
   midnight (deterministic per calendar date). Namespaced .xw-*.
   ============================================================ */

const SIZE = 5;
const STORE_KEY = "xw-progress-v1";
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Build per-cell metadata: block flag, number, and the across/down word each
// white cell belongs to (word index + position within the word).
function buildMeta(puzzle) {
  const meta = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => null)
  );
  const solution = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const ch = puzzle.grid[r][c];
      if (ch === "#") continue;
      meta[r][c] = { num: null, across: null, down: null };
      solution[r][c] = ch;
    }
  }
  puzzle.across.forEach((w, wi) => {
    for (let i = 0; i < w.len; i++) {
      const cell = meta[w.row][w.col + i];
      cell.across = { wordIdx: wi, pos: i };
    }
    meta[w.row][w.col].num = w.num;
  });
  puzzle.down.forEach((w, wi) => {
    for (let i = 0; i < w.len; i++) {
      const cell = meta[w.row + i][w.col];
      cell.down = { wordIdx: wi, pos: i };
    }
    meta[w.row][w.col].num = w.num;
  });
  return { meta, solution };
}

const emptyEntries = (meta) =>
  meta.map((row) => row.map((cell) => (cell ? "" : null)));

const fmtTime = (s) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const MiniCrossword = () => {
  const { puzzle, index } = useMemo(() => getDailyPuzzle(), []);
  const { meta, solution } = useMemo(() => buildMeta(puzzle), [puzzle]);
  const dayIdx = useMemo(() => dayIndexFor(), []);
  const reduce = useMemo(prefersReducedMotion, []);

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  const firstCell = useMemo(() => {
    const w = puzzle.across[0];
    return { r: w.row, c: w.col };
  }, [puzzle]);

  const [entries, setEntries] = useState(() => emptyEntries(meta));
  const [sel, setSel] = useState(firstCell);
  const [dir, setDir] = useState("across");
  const [elapsed, setElapsed] = useState(0);
  const [solved, setSolved] = useState(false);
  const [checkMode, setCheckMode] = useState(false); // flag wrong cells
  const [showWin, setShowWin] = useState(false);

  const hiddenInput = useRef(null);

  // ---- load saved progress for today ----
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      const saved = raw[dayIdx];
      if (saved && Array.isArray(saved.entries)) {
        const loaded = saved.entries.map((rowStr, r) =>
          rowStr.split("").map((ch, c) => {
            if (!meta[r] || !meta[r][c]) return null;
            return ch === "." ? "" : ch;
          })
        );
        setEntries(loaded);
        setElapsed(saved.elapsed || 0);
        if (saved.solved) {
          setSolved(true);
        }
      }
    } catch (_) {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIdx]);

  // ---- persist progress ----
  const persist = useCallback(
    (nextEntries, nextElapsed, isSolved) => {
      try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        raw[dayIdx] = {
          entries: nextEntries.map((row) =>
            row.map((c) => (c === null ? "#" : c || ".")).join("")
          ),
          elapsed: nextElapsed,
          solved: isSolved,
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(raw));
      } catch (_) {
        /* storage may be full / blocked — non-fatal */
      }
    },
    [dayIdx]
  );

  // ---- timer ----
  useEffect(() => {
    if (solved) return undefined;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [solved]);

  useEffect(() => {
    // keep elapsed persisted roughly each tick (cheap, single key)
    if (!solved) persist(entries, elapsed, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  // ---- completion check ----
  const checkSolved = useCallback(
    (next) => {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (solution[r][c] == null) continue;
          if ((next[r][c] || "") !== solution[r][c]) return false;
        }
      }
      return true;
    },
    [solution]
  );

  // ---- navigation helpers ----
  const wordCells = useCallback(
    (cell, direction) => {
      const m = meta[cell.r] && meta[cell.r][cell.c];
      if (!m || !m[direction]) return [];
      const entry =
        direction === "across"
          ? puzzle.across[m[direction].wordIdx]
          : puzzle.down[m[direction].wordIdx];
      const list = [];
      for (let i = 0; i < entry.len; i++) {
        if (direction === "across") list.push({ r: entry.row, c: entry.col + i });
        else list.push({ r: entry.row + i, c: entry.col });
      }
      return list;
    },
    [meta, puzzle]
  );

  const activeCells = useMemo(() => {
    const set = new Set();
    wordCells(sel, dir).forEach(({ r, c }) => set.add(`${r},${c}`));
    return set;
  }, [sel, dir, wordCells]);

  const currentClue = useMemo(() => {
    const m = meta[sel.r] && meta[sel.r][sel.c];
    if (!m || !m[dir]) return null;
    return dir === "across"
      ? puzzle.across[m[dir].wordIdx]
      : puzzle.down[m[dir].wordIdx];
  }, [meta, sel, dir, puzzle]);

  const isWhite = (r, c) =>
    r >= 0 && r < SIZE && c >= 0 && c < SIZE && meta[r] && meta[r][c];

  const focusHidden = () => {
    if (hiddenInput.current) hiddenInput.current.focus({ preventScroll: true });
  };

  const selectCell = (r, c) => {
    if (!isWhite(r, c)) return;
    if (sel.r === r && sel.c === c) {
      // toggle direction on the same cell
      setDir((d) => (d === "across" ? "down" : "across"));
    } else {
      setSel({ r, c });
    }
    focusHidden();
  };

  // move within the active word to the next cell (optionally skipping filled)
  const advance = useCallback(
    (latest) => {
      const cells = wordCells(sel, dir);
      const i = cells.findIndex((p) => p.r === sel.r && p.c === sel.c);
      // prefer next empty cell in the word, else next cell, else stay
      for (let j = i + 1; j < cells.length; j++) {
        if (!latest[cells[j].r][cells[j].c]) {
          setSel(cells[j]);
          return;
        }
      }
      if (i + 1 < cells.length) setSel(cells[i + 1]);
    },
    [sel, dir, wordCells]
  );

  const goToWord = useCallback(
    (delta) => {
      const ordered = [
        ...puzzle.across.map((w, wi) => ({ ...w, dir: "across", wi })),
        ...puzzle.down.map((w, wi) => ({ ...w, dir: "down", wi })),
      ];
      const m = meta[sel.r][sel.c];
      const curIdx = ordered.findIndex(
        (w) => w.dir === dir && w.wi === m[dir].wordIdx
      );
      let n = (curIdx + delta + ordered.length) % ordered.length;
      const target = ordered[n];
      setDir(target.dir);
      // jump to first empty cell of the target word, else its start
      const cells = [];
      for (let i = 0; i < target.len; i++) {
        if (target.dir === "across")
          cells.push({ r: target.row, c: target.col + i });
        else cells.push({ r: target.row + i, c: target.col });
      }
      const empty = cells.find((p) => !entries[p.r][p.c]);
      setSel(empty || cells[0]);
      focusHidden();
    },
    [puzzle, meta, sel, dir, entries]
  );

  const applyLetter = useCallback(
    (ch) => {
      if (solved) return;
      setCheckMode(false);
      setEntries((prev) => {
        if (!prev[sel.r][sel.c] && prev[sel.r][sel.c] !== "") return prev; // block
        const next = prev.map((row) => row.slice());
        next[sel.r][sel.c] = ch;
        const done = checkSolved(next);
        if (done) {
          setSolved(true);
          setShowWin(true);
          persist(next, elapsed, true);
        } else {
          persist(next, elapsed, false);
          advance(next);
        }
        return next;
      });
    },
    [sel, solved, checkSolved, advance, persist, elapsed]
  );

  const deleteLetter = useCallback(() => {
    if (solved) return;
    setCheckMode(false);
    setEntries((prev) => {
      const next = prev.map((row) => row.slice());
      if (next[sel.r][sel.c]) {
        next[sel.r][sel.c] = "";
        persist(next, elapsed, false);
      } else {
        // jump back and clear
        const cells = wordCells(sel, dir);
        const i = cells.findIndex((p) => p.r === sel.r && p.c === sel.c);
        if (i > 0) {
          const p = cells[i - 1];
          next[p.r][p.c] = "";
          setSel(p);
          persist(next, elapsed, false);
        }
      }
      return next;
    });
  }, [sel, dir, solved, wordCells, persist, elapsed]);

  const moveSel = useCallback(
    (dr, dc) => {
      let r = sel.r;
      let c = sel.c;
      const wantDir = dr !== 0 ? "down" : "across";
      if (dir !== wantDir) {
        setDir(wantDir);
        return;
      }
      for (let k = 0; k < SIZE; k++) {
        r += dr;
        c += dc;
        if (!isWhite(r, c)) break;
        setSel({ r, c });
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, dir]
  );

  // ---- keyboard ----
  const onKeyDown = useCallback(
    (e) => {
      if (showWin) return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) {
        e.preventDefault();
        applyLetter(k.toUpperCase());
      } else if (k === "Backspace" || k === "Delete") {
        e.preventDefault();
        deleteLetter();
      } else if (k === "ArrowUp") {
        e.preventDefault();
        moveSel(-1, 0);
      } else if (k === "ArrowDown") {
        e.preventDefault();
        moveSel(1, 0);
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        moveSel(0, -1);
      } else if (k === "ArrowRight") {
        e.preventDefault();
        moveSel(0, 1);
      } else if (k === " " || k === "Tab") {
        e.preventDefault();
        if (k === "Tab") goToWord(e.shiftKey ? -1 : 1);
        else setDir((d) => (d === "across" ? "down" : "across"));
      } else if (k === "Enter") {
        e.preventDefault();
        goToWord(1);
      }
    },
    [applyLetter, deleteLetter, moveSel, goToWord, showWin]
  );

  useEffect(() => {
    focusHidden();
  }, []);

  // ---- toolbar actions ----
  const handleCheck = () => {
    setCheckMode(true);
    focusHidden();
  };
  const handleReveal = () => {
    const next = solution.map((row) =>
      row.map((ch) => (ch == null ? null : ch))
    );
    setEntries(next);
    setCheckMode(false);
    setSolved(true);
    setShowWin(true);
    persist(next, elapsed, true);
  };
  const handleClear = () => {
    const next = emptyEntries(meta);
    setEntries(next);
    setCheckMode(false);
    setSolved(false);
    setShowWin(false);
    setElapsed(0);
    setSel(firstCell);
    persist(next, 0, false);
    focusHidden();
  };

  // ---- render helpers ----
  const renderClueList = (list, listDir) => (
    <div className="xw-clue-col">
      <h3 className="xw-clue-head">{listDir === "across" ? "Across" : "Down"}</h3>
      <ul className="xw-clue-list">
        {list.map((w, wi) => {
          const active =
            currentClue &&
            currentClue.num === w.num &&
            currentClue.answer === w.answer &&
            dir === listDir;
          return (
            <li key={`${listDir}-${w.num}-${wi}`}>
              <button
                type="button"
                className={`xw-clue-item${active ? " is-active" : ""}`}
                onClick={() => {
                  setDir(listDir);
                  setSel({ r: w.row, c: w.col });
                  focusHidden();
                }}
              >
                <span className="xw-clue-num">{w.num}</span>
                <span className="xw-clue-text">{w.clue}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="xw">
      <div className="xw-shell">
        <span className="xw-corner xw-corner--tl" />
        <span className="xw-corner xw-corner--tr" />
        <span className="xw-corner xw-corner--bl" />
        <span className="xw-corner xw-corner--br" />
        <div className="xw-scan" aria-hidden="true" />

        <header className="xw-titlebar">
          <Link to="/dashboard" className="xw-back" aria-label="Back to console">
            <i className="fa-solid fa-angle-left" />
          </Link>
          <div className="xw-titlebar-text">
            <h1>
              MINI<span>{"//"}</span>CROSSWORD
            </h1>
            <span>
              {dateLabel} · GRID #{String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <span className="xw-timer" aria-label="Elapsed time">
            <i className="fa-regular fa-clock" /> {fmtTime(elapsed)}
          </span>
        </header>

        <div className="xw-body">
          {/* active clue banner */}
          <button
            type="button"
            className="xw-clue-bar"
            onClick={() => setDir((d) => (d === "across" ? "down" : "across"))}
          >
            <span
              className="xw-clue-arrow"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                goToWord(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  goToWord(-1);
                }
              }}
            >
              <i className="fa-solid fa-angle-left" />
            </span>
            <span className="xw-clue-bar-text">
              <em>{dir === "across" ? "ACROSS" : "DOWN"}</em>
              {currentClue ? currentClue.clue : ""}
            </span>
            <span
              className="xw-clue-arrow"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                goToWord(1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  goToWord(1);
                }
              }}
            >
              <i className="fa-solid fa-angle-right" />
            </span>
          </button>

          {/* grid */}
          <div
            className="xw-grid-wrap"
            role="grid"
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            {/* hidden input keeps mobile keyboards up */}
            <input
              ref={hiddenInput}
              className="xw-hidden-input"
              aria-hidden="true"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck="false"
              value=""
              onChange={() => {}}
              onKeyDown={onKeyDown}
            />
            <div className="xw-grid">
              {meta.map((row, r) =>
                row.map((cell, c) => {
                  if (!cell)
                    return (
                      <div
                        key={`${r}-${c}`}
                        className="xw-cell xw-cell--block"
                      />
                    );
                  const isSel = sel.r === r && sel.c === c;
                  const inWord = activeCells.has(`${r},${c}`);
                  const val = entries[r][c] || "";
                  const wrong =
                    checkMode && val && val !== solution[r][c];
                  return (
                    <div
                      key={`${r}-${c}`}
                      className={`xw-cell${isSel ? " is-sel" : ""}${
                        inWord && !isSel ? " is-word" : ""
                      }${wrong ? " is-wrong" : ""}`}
                      onClick={() => selectCell(r, c)}
                    >
                      {cell.num != null && (
                        <span className="xw-cell-num">{cell.num}</span>
                      )}
                      <span className="xw-cell-letter">{val}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* toolbar */}
          <div className="xw-toolbar">
            <button
              type="button"
              className="xw-tool"
              onClick={handleCheck}
              disabled={solved}
            >
              <i className="fa-solid fa-circle-check" /> Check
            </button>
            <button type="button" className="xw-tool" onClick={handleReveal}>
              <i className="fa-solid fa-eye" /> Reveal
            </button>
            <button type="button" className="xw-tool" onClick={handleClear}>
              <i className="fa-solid fa-rotate-left" /> Clear
            </button>
          </div>

          {/* clue lists */}
          <div className="xw-clues">
            {renderClueList(puzzle.across, "across")}
            {renderClueList(puzzle.down, "down")}
          </div>
        </div>
      </div>

      {/* win overlay */}
      {showWin && (
        <div className="xw-win" role="dialog" aria-modal="true">
          <div className={`xw-win-card${reduce ? " is-reduced" : ""}`}>
            <span className="xw-win-tag">PUZZLE SOLVED</span>
            <h2
              className="xw-win-title xw-glitch"
              data-text="NICE SOLVE"
            >
              NICE SOLVE
            </h2>
            <p className="xw-win-time">
              <i className="fa-regular fa-clock" /> {fmtTime(elapsed)}
            </p>
            <p className="xw-win-sub">
              A fresh grid drops at midnight. Come back tomorrow.
            </p>
            <div className="xw-win-actions">
              <button
                type="button"
                className="xw-win-btn"
                onClick={() => setShowWin(false)}
              >
                View grid
              </button>
              <Link to="/dashboard" className="xw-win-btn xw-win-btn--alt">
                Back to console
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MiniCrossword;
