import { useEffect, useRef } from "react";
import { animate, createDraggable, createScope, onScroll, spring, utils } from "animejs";
import BallArt from "./BallArt";

/*
 * The ball return, along the bottom of the hero. Once the bag has loaded
 * (`ready`) the ball rolls out from under the hood; scrolling the hero away
 * rolls it down the rail; grab it and fling it and it springs back. Tap it
 * for a show-off spin.
 *
 * Several inputs move one ball, so they all write to one `state` and a
 * single render() turns the sum into position + roll. The roll is honest:
 * degrees = distance / radius, so the finger holes turn exactly as far as
 * the ball travelled.
 */
const DEG = 180 / Math.PI;
const TAP_PX = 4;

const BallReturn = ({ ball, seed, title, ready }) => {
  const railRef = useRef(null);
  const carRef = useRef(null);
  const dragRef = useRef(null);
  const spinRef = useRef(null);
  const scopeRef = useRef(null);

  useEffect(() => {
    const scope = createScope({
      root: railRef,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
    }).add((self) => {
      if (self.matches.reduce) {
        self.add("intro", () => {});
        return undefined;
      }

      const rail = railRef.current;
      const hero = rail.closest(".bw-hero") || rail;
      const metrics = { size: 0, room: 0 };
      // The car rests just right of the hood; `room` is how far it can roll.
      const measure = () => {
        metrics.size = dragRef.current.offsetWidth;
        metrics.room = Math.max(0, rail.clientWidth - carRef.current.offsetLeft - metrics.size - 16);
      };
      measure();

      // Parked behind the hood until intro() rolls it out.
      const state = { intro: -(metrics.size + 90), scroll: 0, drag: 0, spin: 0 };
      const base = () => state.intro + state.scroll;
      const render = () => {
        utils.set(carRef.current, { x: base() });
        utils.set(spinRef.current, {
          rotate: ((base() + state.drag) / (metrics.size / 2)) * DEG + state.spin,
        });
      };
      render();

      let rolledOut = false;
      self.add("intro", () => {
        if (rolledOut) return;
        rolledOut = true;
        // A touch of overshoot, like it bumped the stop.
        animate(state, { intro: 0, duration: 1500, ease: "outBack(1.1)", onUpdate: render });
      });

      const rollAway = animate(state, {
        scroll: [0, () => metrics.room],
        ease: "inOutSine",
        duration: 1000,
        autoplay: onScroll({ target: hero, enter: "top top", leave: "top bottom", sync: true }),
        onUpdate: render,
      });

      const within = (v) => utils.clamp(v, -base(), metrics.room - base());
      createDraggable(dragRef.current, {
        y: false,
        x: { snap: [0], modifier: within },
        releaseStiffness: 70,
        releaseDamping: 7,
        cursor: { onHover: "grab", onGrab: "grabbing" },
        onUpdate: (d) => {
          state.drag = within(d.x);
          render();
        },
        onRelease: (d) => {
          if (Math.abs(d.x) > TAP_PX) return;
          animate(state, {
            spin: `+=${utils.random(540, 900)}`,
            ease: spring({ bounce: 0.25, duration: 1300 }),
            onUpdate: render,
          });
        },
      });

      const onResize = () => {
        measure();
        rollAway.refresh();
        render();
      };
      window.addEventListener("resize", onResize, { passive: true });
      return () => window.removeEventListener("resize", onResize);
    });
    scopeRef.current = scope;
    return () => scope.revert();
  }, []);

  useEffect(() => {
    if (ready) scopeRef.current?.methods.intro?.();
  }, [ready]);

  return (
    <div ref={railRef} className="bw-return">
      <span className="bw-return-rail" aria-hidden="true" />
      <div ref={carRef} className="bw-return-car">
        <div ref={dragRef} className="bw-return-grab" aria-hidden="true">
          <span className="bw-return-shadow" />
          <BallArt ref={spinRef} color={ball.color} seed={seed} />
        </div>
      </div>
      <span className="bw-return-hood" aria-hidden="true" />
      <p className={`bw-return-cap ${ready ? "is-in" : ""}`}>
        <span>On the return</span> {title}
      </p>
    </div>
  );
};

export default BallReturn;
