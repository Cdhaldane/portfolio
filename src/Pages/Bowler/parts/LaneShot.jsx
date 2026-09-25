import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { animate, createScope, createTimeline, onScroll, spring, stagger, utils } from "animejs";
import { BallBody } from "./BallArt";
import { playSound } from "../eggs";

/*
 * The lane, from above. Scrolling rolls the ball down a real right-hander's
 * line (out to the breakpoint, then the hook back into the 1-3 pocket), and
 * the rack explodes when it gets there. Scroll back up and the pinsetter
 * drops a fresh rack. "Roll it" throws the same shot on its own, with sound.
 *
 * Geometry is to scale across the lane (41.5in over 156 units: 12in pin
 * spacing, 4.77in pins, 8.5in ball) and compressed along it, since a true
 * 60ft lane would be a hairline.
 *
 * Everything runs off one number, p (0 = foul line, 1 = in the pit), so
 * the scroll scrub and the thrown shot share one render().
 */
const LANE = { top: 22, bottom: 178 };
const BALL_R = 16;
const DEG = 180 / Math.PI;

const APPROACH = "M 46 134 C 220 142, 420 164, 540 160 S 728 124, 786 111";
const FULL = `${APPROACH} L 968 126`;
const IMPACT = { x: 786, y: 111 };

// Top-down rack, head pin nearest the bowler.
const PINS = [
  [800, 100],
  [839, 77.5], [839, 122.5],
  [878, 55], [878, 100], [878, 145],
  [917, 32.5], [917, 77.5], [917, 122.5], [917, 167.5],
];

// The seven targeting arrows sit in a chevron, the middle one furthest out.
const ARROWS = [5, 10, 15, 20, 25, 30, 35].map((board, i) => ({
  x: 262 - Math.abs(i - 3) * 13,
  y: LANE.bottom - board * 4,
}));
const DOTS = [3, 5, 8, 11, 14, 25, 28, 31, 34, 36].map((board) => LANE.bottom - board * 4);

const PINSET_MS = 480;
const THROW_MS = 2000;
const HOLD_MS = 1500;
const CRASH_LEAD_MS = 520; // playSound's rumble runs this long before the crash

// Narrow screens see the back half of the lane, where the story is.
const NARROW = "(max-width: 600px)";
const useNarrow = () => {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
};

const LaneShot = forwardRef(function LaneShot({ ball, seed, title, detail, soundOn }, ref) {
  const uid = `bwl${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const narrow = useNarrow();
  const rootRef = useRef(null);
  const trailRef = useRef(null);
  const approachRef = useRef(null);
  const ballPosRef = useRef(null);
  const ballDropRef = useRef(null);
  const spinRef = useRef(null);
  const ringRef = useRef(null);
  const shakeRef = useRef(null);
  const markRef = useRef(null);
  const scopeRef = useRef(null);
  const soundRef = useRef(soundOn);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    const scope = createScope({
      root: rootRef,
      mediaQueries: { reduce: "(prefers-reduced-motion: reduce)" },
    }).add((self) => {
      const trail = trailRef.current;
      const total = trail.getTotalLength();
      const contactAt = approachRef.current.getTotalLength() / total;
      const pins = [...rootRef.current.querySelectorAll(".bw-lpin-fly")];
      const scroll = { p: 0 };
      let mode = "scroll";
      let struck = false;
      let shot = null;

      trail.style.strokeDasharray = `${total}`;
      setReduced(self.matches.reduce);

      const knock = () => {
        struck = true;
        const fly = PINS.map(([px, py]) => {
          const dx = px - IMPACT.x;
          const dy = py - IMPACT.y;
          const d = Math.hypot(dx, dy) || 1;
          const spread = utils.random(-0.45, 0.45, 3);
          const push = utils.random(60, 150) * (1.25 - d / 220);
          const ux = Math.cos(Math.atan2(dy, dx) + spread);
          const uy = Math.sin(Math.atan2(dy, dx) + spread);
          return {
            x: ux * push + utils.random(20, 60),
            y: uy * push * 1.4,
            r: utils.random(-620, 620),
            delay: d * 1.7,
          };
        });
        animate(pins, {
          x: (_, i) => fly[i].x,
          y: (_, i) => fly[i].y,
          rotate: (_, i) => fly[i].r,
          scale: [
            { to: 1.32, duration: 150, ease: "outQuad" },
            { to: 0.82, duration: 720, ease: "inQuad" },
          ],
          opacity: { to: 0, delay: (_, i) => fly[i].delay + 640, duration: 420 },
          delay: (_, i) => fly[i].delay,
          duration: 1000,
          ease: "outExpo",
        });
        animate(ringRef.current, {
          scale: [0.3, 3.4],
          opacity: [0.9, 0],
          duration: 650,
          ease: "outQuad",
        });
        animate(shakeRef.current, {
          x: [0, -5, 4, -2, 0],
          y: [0, 2, -2, 1, 0],
          duration: 360,
          ease: "outSine",
        });
        animate(markRef.current, {
          scale: [0, 1],
          rotate: [-28, -6],
          opacity: [0, 1],
          delay: 160,
          ease: spring({ bounce: 0.55, duration: 600 }),
        });
      };

      const rack = () => {
        struck = false;
        animate(pins, {
          x: 0,
          y: 0,
          rotate: 0,
          scale: [1.4, 1],
          opacity: [0, 1],
          delay: stagger(40),
          duration: 520,
          ease: "outBack(1.6)",
        });
        animate(markRef.current, { scale: 0, opacity: 0, duration: 220, ease: "inQuad" });
      };

      const render = (p) => {
        const len = total * p;
        const pt = trail.getPointAtLength(len);
        // Past the pin deck the ball drops into the pit and shrinks away.
        const drop = p > 0.93 ? 1 - ((p - 0.93) / 0.07) * 0.4 : 1;
        ballPosRef.current.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
        ballDropRef.current.setAttribute("transform", `scale(${drop})`);
        // Style, not the attribute: .bw-orb-spin's CSS origin already
        // centres the turn, and would double-offset rotate(a 50 50).
        spinRef.current.style.transform = `rotate(${(len / BALL_R) * DEG}deg)`;
        trail.style.strokeDashoffset = `${total - len}`;
        if (p >= contactAt && !struck) knock();
        else if (p < contactAt - 0.05 && struck) rack();
      };

      if (self.matches.reduce) {
        // A still frame: the ball at the breakpoint with its line drawn.
        render(0.62);
        self.add("throw", () => {});
        return undefined;
      }

      render(0);
      animate(scroll, {
        p: [0, 1],
        ease: "linear",
        duration: 1000,
        autoplay: onScroll({ target: rootRef.current, enter: "95% top", leave: "45% bottom", sync: true }),
        onUpdate: () => {
          if (mode === "scroll") render(scroll.p);
        },
      });

      self.add("throw", () => {
        if (shot) shot.pause();
        mode = "throw";
        const thrown = { p: 0 };
        render(0);
        shot = createTimeline()
          .add(
            thrown,
            { p: [0, 1], duration: THROW_MS, ease: "linear", onUpdate: () => render(thrown.p) },
            PINSET_MS
          )
          .call(() => {
            if (soundRef.current) playSound("strike");
          }, Math.max(0, PINSET_MS + contactAt * THROW_MS - CRASH_LEAD_MS))
          .call(() => {
            mode = "scroll";
            shot = null;
            render(scroll.p);
          }, PINSET_MS + THROW_MS + HOLD_MS);
      });
      return undefined;
    });
    scopeRef.current = scope;
    return () => scope.revert();
  }, []);

  useImperativeHandle(ref, () => ({
    throwBall: () => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      scopeRef.current?.methods.throw?.();
    },
  }));

  const viewBox = narrow ? "380 0 620 200" : "0 0 1000 200";

  return (
    <figure ref={rootRef} className="bw-laneshot">
      <div className="bw-lane-tilt">
        <div ref={shakeRef} className="bw-lane-shake">
          <svg
            className="bw-lane-svg"
            viewBox={viewBox}
            role="img"
            aria-label={`${title}, hooking into the pocket for a strike`}
          >
            <defs>
              <pattern id={`${uid}-boards`} width="10" height="4" patternUnits="userSpaceOnUse">
                <rect y="3.55" width="10" height="0.45" className="bw-lane-board" />
              </pattern>
              <linearGradient id={`${uid}-oil`} x1="0" x2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
                <stop offset="0.85" stopColor="#fff" stopOpacity="0.06" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${uid}-pit`} x1="0" x2="1">
                <stop offset="0" stopColor="#000" stopOpacity="0.15" />
                <stop offset="1" stopColor="#000" stopOpacity="0.7" />
              </linearGradient>
            </defs>

            {/* gutters, wood, boards, the oil that makes the ball hook late */}
            <rect x="0" y="0" width="1000" height="200" className="bw-lane-gutter" />
            <rect x="0" y={LANE.top} width="950" height={LANE.bottom - LANE.top} className="bw-lane-wood" />
            <rect x="0" y={LANE.top} width="950" height={LANE.bottom - LANE.top} fill={`url(#${uid}-boards)`} />
            <rect x="46" y={LANE.top} width="520" height={LANE.bottom - LANE.top} fill={`url(#${uid}-oil)`} />
            <rect x="770" y={LANE.top} width="180" height={LANE.bottom - LANE.top} className="bw-lane-deck" />
            <rect x="950" y="0" width="50" height="200" fill={`url(#${uid}-pit)`} />
            <line x1="44" y1={LANE.top} x2="44" y2={LANE.bottom} className="bw-lane-foul" />

            {DOTS.map((y) => (
              <circle key={y} cx="118" cy={y} r="1.6" className="bw-lane-mark" />
            ))}
            {ARROWS.map(({ x, y }) => (
              <path key={y} d={`M ${x} ${y - 3.4} L ${x + 15} ${y} L ${x} ${y + 3.4} Z`} className="bw-lane-arrow" />
            ))}
            {PINS.map(([x, y]) => (
              <circle key={`spot-${x}-${y}`} cx={x} cy={y} r="3" className="bw-lane-spot" />
            ))}

            {/* the line: drawn on as the ball rolls it */}
            <path ref={approachRef} d={APPROACH} fill="none" stroke="none" />
            <path
              ref={trailRef}
              d={FULL}
              className="bw-lane-trail"
              style={{ stroke: ball.color }}
              fill="none"
            />

            <circle ref={ringRef} cx={IMPACT.x} cy={IMPACT.y} r="12" className="bw-lane-ring" />

            {PINS.map(([x, y], i) => (
              <g key={i} transform={`translate(${x} ${y})`}>
                <g className="bw-lpin-fly">
                  <circle cx="1.6" cy="2" r="9" className="bw-lpin-shadow" />
                  <circle r="9" className="bw-lpin" />
                  <circle r="5.4" className="bw-lpin-neck" />
                  <circle r="2.4" className="bw-lpin-head" />
                </g>
              </g>
            ))}

            <g ref={ballPosRef}>
              <g ref={ballDropRef}>
                <ellipse cx="3" cy="4" rx="16" ry="15" className="bw-lane-ballshadow" />
                <g transform={`translate(${-BALL_R} ${-BALL_R}) scale(${(BALL_R * 2) / 100})`}>
                  <BallBody ref={spinRef} color={ball.color} seed={seed} />
                </g>
              </g>
            </g>
          </svg>
          <span ref={markRef} className="bw-lane-x" aria-hidden="true">
            X
          </span>
        </div>
      </div>
      <figcaption className="bw-lane-cap">
        <span>
          <strong>{title}</strong>
          {detail && <span className="bw-lane-detail">{detail}</span>}
        </span>
        {!reduced && (
          <button
            type="button"
            className="bw-btn bw-btn--ghost bw-lane-roll"
            onClick={() => scopeRef.current?.methods.throw?.()}
          >
            <i className="fa-solid fa-bowling-ball" aria-hidden="true" /> Roll it
          </button>
        )}
      </figcaption>
    </figure>
  );
});

export default LaneShot;
