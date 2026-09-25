import { useEffect, useRef } from "react";
import { animate, createScope, onScroll, spring, utils } from "animejs";
import BallArt from "./BallArt";

/*
 * Scroll progress, alley style: a ball rolls down the page's left gutter
 * (the .bw-lane background already draws one) and takes out the lone pin
 * waiting at the bottom when you reach the end. Scroll back up and the pin
 * stands itself back up.
 */
const DEG = 180 / Math.PI;
const TOP = 76; // clear of the top bar
const BOTTOM = 32; // the pin's height + inset, so the ball lands on it

const GutterBall = ({ ball, seed }) => {
  const rootRef = useRef(null);
  const ballRef = useRef(null);
  const spinRef = useRef(null);
  const pinRef = useRef(null);

  useEffect(() => {
    const scope = createScope({
      root: rootRef,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
    }).add((self) => {
      if (self.matches.reduce) return undefined;

      const page = rootRef.current.closest(".bw") || document.body;
      const size = ballRef.current.offsetWidth || 10;
      const state = { p: 0 };
      let down = false;

      const render = () => {
        const y = state.p * Math.max(0, window.innerHeight - TOP - BOTTOM - size);
        utils.set(ballRef.current, { y });
        utils.set(spinRef.current, { rotate: (y / (size / 2)) * DEG });
        if (state.p > 0.985 && !down) {
          down = true;
          animate(pinRef.current, {
            rotate: 82,
            x: 4,
            y: 6,
            ease: spring({ bounce: 0.35, duration: 700 }),
          });
        } else if (state.p < 0.95 && down) {
          down = false;
          animate(pinRef.current, { rotate: 0, x: 0, y: 0, duration: 520, ease: "outBack(2)" });
        }
      };

      animate(state, {
        p: [0, 1],
        ease: "linear",
        duration: 1000,
        autoplay: onScroll({ target: page, enter: "top top", leave: "bottom bottom", sync: true }),
        onUpdate: render,
      });

      window.addEventListener("resize", render, { passive: true });
      return () => window.removeEventListener("resize", render);
    });
    return () => scope.revert();
  }, []);

  return (
    <div ref={rootRef} className="bw-gutter" aria-hidden="true">
      <span ref={ballRef} className="bw-gutter-ball">
        <BallArt ref={spinRef} color={ball.color} seed={seed} size={10} />
      </span>
      <span ref={pinRef} className="bw-gutter-pin" />
    </div>
  );
};

export default GutterBall;
