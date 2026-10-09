import { useRef } from "react";
import { fanPose, nearestFanIndex } from "../poses";

/*
 * Flat input layers laid over the 3D table. Every pointer gesture lands on one
 * of these, never on a tilting or edge-on plane, so hit areas stay reliable
 * mid-flip, and framer's tap gestures (which fire after pans and inject
 * tabIndex) stay out of the picture. Keyboard paths live on real buttons.
 */

/** Grab zone at the top of the wrapper (fraction of its height). */
const GRAB = 0.34;

const boxStyle = (b) => ({
  width: b.w,
  height: b.h,
  transform: `translate(calc(-50% + ${b.x}px), calc(-50% + ${b.y}px))`,
});

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const capture = (e) => {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  } catch {
    /* capture unsupported (jsdom, old engines): the gesture still works */
  }
};

export function RipGrip({ box, tear, dir, disabled, holo, onCommit, onFail }) {
  const drag = useRef(null);

  const down = (e) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || (e.clientY - r.top) / r.height > GRAB) return;
    capture(e);
    dir.set((e.clientX - r.left) / r.width < 0.5 ? 1 : -1);
    drag.current = { r, t0: now() };
    holo?.rest();
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) {
      holo?.handlers.onPointerMove(e);
      return;
    }
    const fx = (e.clientX - d.r.left) / d.r.width;
    const p = Math.min(1, Math.max(0, dir.get() > 0 ? fx : 1 - fx));
    if (p > tear.get()) tear.set(p);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (tear.get() >= 0.6) onCommit({ slow: now() - d.t0 > 2500 });
    else onFail();
  };

  return (
    <div
      className="td-grip td-grip--rip"
      style={boxStyle(box)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerEnter={holo?.handlers.onPointerEnter}
      onPointerLeave={(e) => {
        if (!drag.current) holo?.handlers.onPointerLeave(e);
      }}
      aria-hidden="true"
    >
      <span className="td-grip-zone" style={{ height: `${GRAB * 100}%` }} />
    </div>
  );
}

/**
 * Hover (or scrub, on touch) along the fan to lift a card; click, or tap an
 * already-lifted card, to inspect it.
 */
export function FanGrip({ box, L, lifted, holo, onLift, onPick }) {
  const press = useRef(null);

  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2) + box.x;
    const y = e.clientY - (r.top + r.height / 2) + box.y;
    return { i: nearestFanIndex(x, L), x, y };
  };
  const shine = ({ i, x, y }) => {
    const p = fanPose(i, L);
    const w = L.cw * L.handScale * 1.1;
    const h = L.ch * L.handScale * 1.1;
    const cy = p.y - L.lift;
    holo?.setPoint((x - (p.x - w / 2)) / w, (y - (cy - h / 2)) / h);
  };

  const down = (e) => {
    if (e.pointerType !== "touch") return;
    capture(e);
    const hit = at(e);
    press.current = { x: e.clientX, i: hit.i, wasLifted: lifted === hit.i, moved: false };
    if (lifted !== hit.i) onLift(hit.i);
  };
  const move = (e) => {
    const hit = at(e);
    if (e.pointerType === "touch") {
      const p = press.current;
      if (!p) return;
      if (Math.abs(e.clientX - p.x) > 8) p.moved = true;
      if (hit.i !== lifted) onLift(hit.i);
      return;
    }
    if (hit.i !== lifted) onLift(hit.i);
    shine(hit);
  };
  const up = (e) => {
    if (e.pointerType === "touch") {
      const p = press.current;
      press.current = null;
      if (p && !p.moved && p.wasLifted) onPick(p.i);
      return;
    }
    onPick(at(e).i);
  };

  return (
    <div
      className="td-grip td-grip--fan"
      style={boxStyle(box)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        press.current = null;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "touch") return;
        onLift(null);
        holo?.rest();
      }}
      aria-hidden="true"
    />
  );
}

/** Drag sideways to spin the inspected card like a coin; tap to flip it. */
export function SpinGrip({ box, index, spinRef, holo }) {
  const drag = useRef(null);

  const down = (e) => {
    capture(e);
    const t = now();
    drag.current = { x0: e.clientX, t0: t, moved: false, samples: [{ x: e.clientX, t }] };
    holo?.rest();
    spinRef.current?.begin(index);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) {
      holo?.handlers.onPointerMove(e);
      return;
    }
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 6) d.moved = true;
    d.samples = [...d.samples.slice(-5), { x: e.clientX, t: now() }];
    if (d.moved) spinRef.current?.move(index, dx);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved && now() - d.t0 < 400) {
      spinRef.current?.tap(index);
      return;
    }
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const vx = ((b.x - a.x) / Math.max(1, b.t - a.t)) * 1000;
    spinRef.current?.release(index, vx);
  };

  return (
    <div
      className="td-grip td-grip--spin"
      style={boxStyle(box)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerEnter={holo?.handlers.onPointerEnter}
      onPointerLeave={(e) => {
        if (!drag.current) holo?.handlers.onPointerLeave(e);
      }}
      aria-hidden="true"
    />
  );
}

/** Press and hold the face-down legendary to charge the reveal. */
export function LegendGrip({ box, onHold, onRelease }) {
  const held = useRef(false);
  const release = () => {
    if (!held.current) return;
    held.current = false;
    onRelease();
  };
  return (
    <div
      className="td-grip td-grip--legend"
      style={boxStyle(box)}
      onPointerDown={(e) => {
        capture(e);
        held.current = true;
        onHold();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      aria-hidden="true"
    />
  );
}
