import { useRef, useState } from "react";
import {
  ARROW_Y,
  GUTTER,
  HEIGHT,
  HOOK_Y,
  PIN_Y,
  POCKET,
  WIDTH,
  aimName,
  arrowY,
  boardAt,
  boardX,
  linePath,
  markAt,
  stepBoard,
} from "../laneLine";
import LaneBed from "./LaneBed";
import "./laneAim.css";

/*
 * "Aim & hook" on the lane page: the lane from the approach. Tap down by
 * the arrows where you aimed and further up the lane where the ball hooked;
 * the ball's line draws itself between them into the pocket. A sideways
 * drag slides a mark board by board, and the arrows under the picture move
 * it one board at a time for a finger too big for a one-inch board.
 *
 * Taps land on release, so a swipe that scrolls the page past the picture
 * never moves a mark (the lane only claims sideways drags: touch-action
 * pan-y). Boards count from your own gutter, so a left-hander flips the
 * picture and the numbers still mean the same thing.
 */
const AIM_START = 10; // the 2nd arrow
const hookStart = (aim) => (aim === "" ? 6 : Math.max(1, aim - 4));
const DRAG_PX = 6;

const tick = () => {
  try {
    if (navigator.vibrate) navigator.vibrate(4);
  } catch {
    /* no haptics here */
  }
};

const Mark = ({ x, y, kind, label }) => {
  const side = x > WIDTH / 2 ? -1 : 1;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`bw-la-mark bw-la-mark--${kind}`}>
        <circle r="9" className="bw-la-halo" />
        <circle r="4.2" className="bw-la-dot" />
        <text x={side * 13} y="3.4" textAnchor={side > 0 ? "start" : "end"} className="bw-la-tag">
          {label}
        </text>
      </g>
    </g>
  );
};

const Reading = ({ kind, label, value, text, start, hand, onChange }) => {
  const what = kind === "aim" ? "where you aimed" : "where it hooked";
  const move = (dir) => onChange(value === "" ? start : stepBoard(value, dir, hand));
  return (
    <div className={`bw-la-read bw-la-read--${kind} ${value === "" ? "is-empty" : ""}`}>
      <span className="bw-la-read-key" aria-hidden="true" />
      <p>
        <b>{label}</b> <span>{text}</span>
      </p>
      <div className="bw-la-nudge">
        <button type="button" aria-label={`Move ${what} one board left`} onClick={() => move("left")}>
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Move ${what} one board right`} onClick={() => move("right")}>
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
        {value !== "" && (
          <button type="button" aria-label={`Clear ${what}`} onClick={() => onChange("")}>
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

const LaneAim = ({ bowler, aim, hook, pocket, hand, onAim, onHook, onFlip }) => {
  const svgRef = useRef(null);
  const gesture = useRef(null);
  const [dragging, setDragging] = useState(false);

  const lanePoint = (e) => {
    const box = svgRef.current && svgRef.current.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: ((e.clientX - box.left) / box.width) * WIDTH,
      y: ((e.clientY - box.top) / box.height) * HEIGHT,
    };
  };

  function place(mark, x) {
    const board = boardAt(x, hand);
    if (board === (mark === "aim" ? aim : hook)) return;
    tick();
    (mark === "aim" ? onAim : onHook)(board);
  }

  function down(e) {
    if (e.button > 0) return;
    const p = lanePoint(e);
    if (!p) return;
    gesture.current = { id: e.pointerId, mark: markAt(p.y), x0: e.clientX, moved: false };
    try {
      svgRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* the drag just ends at the edge */
    }
  }

  function move(e) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.moved && Math.abs(e.clientX - g.x0) < DRAG_PX) return;
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
    }
    const p = lanePoint(e);
    if (p) place(g.mark, p.x);
  }

  function up(e) {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g || g.id !== e.pointerId) return;
    const p = lanePoint(e);
    if (p) place(g.mark, p.x);
  }

  function cancel() {
    // The page took the swipe to scroll: a drag already under way keeps
    // where it got to, a would-be tap places nothing.
    gesture.current = null;
    setDragging(false);
  }

  const hasAim = aim !== "";
  const hasHook = hook !== "";
  const summary =
    hasAim || hasHook
      ? [hasAim && `aimed at board ${aim}, ${aimName(aim, hand)}`, hasHook && `hooked at board ${hook}`]
          .filter(Boolean)
          .join("; ")
      : "nothing marked yet";
  const pocketX = boardX(POCKET, hand);

  return (
    <div className={`bw-la bw-la--${bowler}`}>
      <figure className="bw-la-fig">
        <svg
          ref={svgRef}
          className={`bw-la-svg ${dragging ? "is-dragging" : ""}`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Your line on the lane: ${summary}.`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        >
          <LaneBed hand={hand} />

          {/* where each tap lands: the arrows row and the breakpoint row */}
          <rect
            x={GUTTER}
            y={ARROW_Y - 26}
            width={WIDTH - GUTTER * 2}
            height={36}
            className={`bw-la-band ${hasAim ? "" : "is-open"}`}
          />
          <rect
            x={GUTTER}
            y={HOOK_Y - 18}
            width={WIDTH - GUTTER * 2}
            height={36}
            className={`bw-la-band ${hasHook ? "" : "is-open"}`}
          />
          {!hasAim && (
            <text x={WIDTH / 2} y={ARROW_Y + 18} className="bw-la-hint">
              tap where you aimed
            </text>
          )}
          {!hasHook && (
            <text x={WIDTH / 2} y={HOOK_Y + 3.5} className="bw-la-hint">
              tap where it hooked
            </text>
          )}

          {hasAim && hasHook && (
            <path key={`${aim}-${hook}-${hand}`} d={linePath(aim, hook, hand)} pathLength="1" className="bw-la-line" />
          )}
          {hasAim && hasHook && pocket !== null && (
            // The CSS pop is a transform, so it sits inside the placed group.
            <g key={`pocket-${pocket}`} transform={`translate(${pocketX} ${PIN_Y + 7})`}>
              <g className={`bw-la-pocket ${pocket ? "is-hit" : "is-miss"}`}>
                <circle r="8" />
              </g>
            </g>
          )}
          {hasHook && <Mark x={boardX(hook, hand)} y={HOOK_Y} kind="hook" label="HOOK" />}
          {hasAim && <Mark x={boardX(aim, hand)} y={arrowY(aim)} kind="aim" label="AIM" />}
        </svg>
        <figcaption className="bw-la-cap">
          <span>Tap by the arrows for your aim, up the lane for the hook. Drag to fine-tune.</span>
          <button type="button" className="bw-link bw-la-flip" aria-pressed={hand === "L"} onClick={onFlip}>
            <i className="fa-solid fa-arrows-left-right" aria-hidden="true" /> Lefty
          </button>
        </figcaption>
      </figure>

      <div className="bw-la-reads">
        <Reading
          kind="aim"
          label="Aimed"
          value={aim}
          text={hasAim ? `board ${aim} · ${aimName(aim, hand)}` : "tap the lane by the arrows"}
          start={AIM_START}
          hand={hand}
          onChange={onAim}
        />
        <Reading
          kind="hook"
          label="Hooked"
          value={hook}
          text={hasHook ? `board ${hook}` : "tap the lane where it turned"}
          start={hookStart(aim)}
          hand={hand}
          onChange={onHook}
        />
      </div>
    </div>
  );
};

export default LaneAim;
