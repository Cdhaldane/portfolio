import { useCallback, useEffect, useMemo, useRef } from "react";
import { animate, useMotionValue, useSpring, useTransform } from "framer-motion";
import { SPRING, TILT_MAX } from "./poses";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/*
 * Pointer -> holographic tilt.
 *
 * Returns a `style` object for the tilt wrapper (rotateX/rotateY plus the
 * --px/--py/--hyp/--glare variables the foil and glare leaves read) and
 * pointer handlers meant for a FLAT hit area: a cell or grip that never
 * rotates, so the cached rect can't feed back into the tilt. Every write
 * goes through a motion value, so there's no React state per frame.
 */
export function useHoloTilt({ enabled = true, maxX = 14, maxY = TILT_MAX, shimmer = false } = {}) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const glareTarget = useMotionValue(0);
  const spx = useSpring(px, SPRING.tilt);
  const spy = useSpring(py, SPRING.tilt);
  const glare = useSpring(glareTarget, { stiffness: 160, damping: 22 });
  const rotateY = useTransform(spx, [0, 1], [-maxY, maxY]);
  const rotateX = useTransform(spy, [0, 1], [maxX, -maxX]);
  const hyp = useTransform([spx, spy], ([x, y]) => Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2));
  const rect = useRef(null);

  const rest = useCallback(() => {
    rect.current = null;
    px.set(0.5);
    py.set(0.5);
    glareTarget.set(0);
  }, [px, py, glareTarget]);

  const onPointerEnter = useCallback(
    (e) => {
      if (!enabled || e.pointerType === "touch") return;
      rect.current = e.currentTarget.getBoundingClientRect();
      glareTarget.set(1);
    },
    [enabled, glareTarget]
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!enabled || e.pointerType === "touch") return;
      if (!rect.current) {
        rect.current = e.currentTarget.getBoundingClientRect();
        glareTarget.set(1);
      }
      const r = rect.current;
      if (!r.width || !r.height) return;
      px.set(clamp01((e.clientX - r.left) / r.width));
      py.set(clamp01((e.clientY - r.top) / r.height));
    },
    [enabled, px, py, glareTarget]
  );

  /** Drive the tilt from outside (a flat grip that already knows px/py). */
  const setPoint = useCallback(
    (x, y) => {
      if (!enabled) return;
      glareTarget.set(1);
      px.set(clamp01(x));
      py.set(clamp01(y));
    },
    [enabled, px, py, glareTarget]
  );

  useEffect(() => {
    if (!enabled) rest();
  }, [enabled, rest]);

  // Touch has no hover: the one held card gets a slow Lissajous shimmer.
  useEffect(() => {
    if (!enabled || !shimmer) return undefined;
    glareTarget.set(0.7);
    const a = animate(px, [0.3, 0.7, 0.3], { duration: 6, ease: "easeInOut", repeat: Infinity });
    const b = animate(py, [0.35, 0.65, 0.35], { duration: 7.3, ease: "easeInOut", repeat: Infinity });
    return () => {
      a.stop();
      b.stop();
      rest();
    };
  }, [enabled, shimmer, px, py, glareTarget, rest]);

  const style = useMemo(
    () => ({ rotateX, rotateY, "--px": spx, "--py": spy, "--hyp": hyp, "--glare": glare }),
    [rotateX, rotateY, spx, spy, hyp, glare]
  );
  const handlers = useMemo(
    () => ({ onPointerEnter, onPointerMove, onPointerLeave: rest }),
    [onPointerEnter, onPointerMove, rest]
  );
  return { style, handlers, setPoint, rest };
}
