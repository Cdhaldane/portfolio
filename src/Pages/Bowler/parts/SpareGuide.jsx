import { useEffect, useMemo, useRef, useState } from "react";
import { HEAD_IN, ROW_IN, pinAt, spareLine } from "../spareLine";
import { BALL_RADIUS, FOUL_Y, HEIGHT, PIN_Y, PIT_Y, ROW, WIDTH, aimName, laneX, laneY } from "../laneLine";
import { leaveName } from "../laneHelp";
import LaneBed, { Pin } from "./LaneBed";
import "./spareGuide.css";

/*
 * "Spare line" on the lane page, for the ball after a leave: how to pick
 * it up (spareLine.js), said the way you'd say it at the lane and shown on
 * the lane. The line draws on from where to lay the ball down, through the
 * board to hit at the arrows, to the first pin; then the ball rolls it and
 * the pins go the way the model sends them.
 *
 * It plays once when it scrolls into view (and again on Replay), driven by
 * one clock: render(t) places everything for a moment t, so a frame never
 * waits on React. With reduced motion it's a still: the line, the target
 * and the pins, no ball.
 */
const LINE_MS = 650; // the line drawing on
const WAIT_MS = 150;
const ROLL_MS = 1150; // foul line to the first pin; the deck then plays in slow motion
const PIN_MS = 760; // a pin's flight
const MARK_MS = 200; // the "Spare" stamp, after the last pin lands
const ACROSS = laneX(0) - laneX(1); // picture units per inch, across
const DECK = ROW / ROW_IN; // and along the pin deck
const PIT_IN = HEAD_IN + 3 * ROW_IN + 30; // far enough back to be in the pit

// Leaves come round again all night; the solver runs once per leave.
const cache = new Map();
const planFor = (key) => {
  if (!cache.has(key)) cache.set(key, spareLine(key.split("-").map(Number)));
  return cache.get(key);
};

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const outCubic = (u) => 1 - (1 - u) ** 3;
const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const r1 = (n) => Math.round(n * 10) / 10;
const spot = (x, y) => ({ x: r1(laneX(x)), y: r1(laneY(y)) });

const and = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const ownBoard = (board, hand) =>
  Math.min(39, Math.max(1, Math.round(hand === "L" ? 40 - board : board)));
const pinsName = (pins) => (pins.length === 1 ? `${pins[0]}` : pins.join("-"));

/**
 * The plan in words: { title, aim, line, hit, carry, room }. Boards are
 * counted from the bowler's own gutter; left and right are as they see
 * the lane.
 */
export function spareWords(plan, hand = "R") {
  const target = ownBoard(plan.target, hand);
  const laydown = ownBoard(plan.laydown, hand);
  const takes = pinsName(plan.take);
  const line =
    plan.from === "middle"
      ? `Straight up the middle: lay it down on board ${laydown} and roll it straight at the ${takes}.`
      : `Cross from the ${plan.from}: lay it down near board ${laydown} and roll it straight at the ${takes}.`;

  const side = plan.hit.replace("thin-", "");
  const hit =
    plan.hit === "flush"
      ? `Hit the ${plan.key} full.`
      : plan.hit.startsWith("thin")
      ? `Just clip the ${side} edge of the ${plan.key}.`
      : `Catch the ${plan.key} on its ${side} side.`;

  // Who takes what after the first pin, in order: "The ball takes the 6, the 6 takes the 10."
  const groups = [];
  plan.hits.slice(1).forEach((h) => {
    const who = h.by ? `the ${h.by}` : "the ball";
    const group = groups.find((g) => g.who === who);
    if (group) group.pins.push(h.pin);
    else groups.push({ who, pins: [h.pin] });
  });
  const said = groups.map((g) => `${g.who} takes the ${and(g.pins.map(String))}`).join(", ");
  const carry = said ? `${said[0].toUpperCase()}${said.slice(1)}.` : "";

  const room = Math.round(plan.room);
  return {
    title: plan.make ? leaveName(plan.leave) : `Pick off the ${takes}`,
    aim: `Board ${target} · ${aimName(target, hand)}`,
    line,
    hit,
    carry,
    room: plan.make
      ? plan.room < 2
        ? "Tight: about a board of window. Hit your mark."
        : `About a ${room}-board window.`
      : `The ${leaveName(plan.leave)} is next to impossible. Take the ${takes} for the count.`,
  };
}

/** Where everything is and when, for one plan, in picture units and ms. */
function choreograph(plan) {
  const first = plan.hits[0]; // pins only move once hit, so the ball touches first
  const contact = spot(first.at.x, first.at.y);
  const target = spot(plan.x0 + plan.slope * plan.targetIn, plan.targetIn);
  // Drawn straight through the target and the first pin, run back to the
  // foul line. The deck is drawn at its own scale, so this is the line
  // that reads right on the picture.
  const back = (FOUL_Y - target.y) / (target.y - contact.y);
  const start = { x: r1(target.x + (target.x - contact.x) * back), y: FOUL_Y };
  const end = spot(plan.x0 + plan.slope * PIT_IN, PIT_IN);
  const toPin = dist(start, contact);
  const speed = toPin / ROLL_MS;
  const rolled = LINE_MS + WAIT_MS;
  const hitAt = rolled + ROLL_MS;
  const pins = plan.hits.map((h, i) => {
    const carry = Math.max(16, Math.min(40, h.carry));
    return {
      pin: h.pin,
      t: hitAt + ((h.t - first.t) * DECK) / speed,
      dx: -h.dir.x * carry * ACROSS,
      dy: -h.dir.y * carry * DECK,
      turn: (h.dir.x > 0 ? -1 : 1) * (150 + ((h.pin * 47) % 140) + i * 10),
    };
  });
  const rollEnd = hitAt + dist(contact, end) / speed;
  const settled = Math.max(rollEnd, ...pins.map((p) => p.t + PIN_MS));
  return { start, contact, target, end, toPin, speed, rolled, pins, mark: settled + MARK_MS };
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SpareGuide = ({ leave, bowler, hand }) => {
  const key = leave.join("-");
  const plan = useMemo(() => planFor(key), [key]);
  const show = useMemo(() => plan && choreograph(plan), [plan]);
  const [run, setRun] = useState(0);
  const figRef = useRef(null);
  const lineRef = useRef(null);
  const ringRef = useRef(null);
  const ballRef = useRef(null);
  const markRef = useRef(null);
  const pinRefs = useRef({});

  useEffect(() => {
    if (!show) return undefined;
    const render = (t) => {
      lineRef.current.style.strokeDashoffset = String(1 - outCubic(clamp01(t / LINE_MS)));
      ringRef.current.style.opacity = String(clamp01((t - LINE_MS * 0.6) / 200));

      const d = (t - show.rolled) * show.speed;
      const where =
        d <= show.toPin
          ? lerp(show.start, show.contact, clamp01(d / show.toPin))
          : lerp(show.contact, show.end, clamp01((d - show.toPin) / dist(show.contact, show.end)));
      const into = clamp01((PIT_Y + BALL_RADIUS - where.y) / BALL_RADIUS); // dropping into the pit
      ballRef.current.setAttribute("transform", `translate(${where.x} ${where.y}) scale(${1 - into * 0.3})`);
      ballRef.current.style.opacity = String(d < 0 ? 0 : Math.min(clamp01(d / 30), 1 - into));

      show.pins.forEach((p) => {
        const el = pinRefs.current[p.pin];
        if (!el) return;
        const u = clamp01((t - p.t) / PIN_MS);
        const e = outCubic(u);
        el.setAttribute("transform", `translate(${p.dx * e} ${p.dy * e}) rotate(${p.turn * e})`);
        el.style.opacity = String(u < 0.4 ? 1 : 1 - (u - 0.4) / 0.6);
      });
      markRef.current.classList.toggle("is-on", t >= show.mark);
    };

    if (reducedMotion()) {
      render(LINE_MS); // the line and the target, pins up, no ball
      return undefined;
    }

    render(0);
    let frame = 0;
    let began = null;
    const tick = (now) => {
      if (began === null) began = now;
      const t = now - began;
      render(t);
      if (t < show.mark) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      frame = requestAnimationFrame(tick);
    };
    // Play once it's on screen: it sits below the pins, often out of view.
    let watch = null;
    if (typeof IntersectionObserver === "function") {
      watch = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          watch.disconnect();
          watch = null;
          play();
        },
        { threshold: 0.5 }
      );
      watch.observe(figRef.current);
    } else {
      play();
    }
    return () => {
      cancelAnimationFrame(frame);
      if (watch) watch.disconnect();
    };
  }, [show, run]);

  if (!plan) return null;
  const words = spareWords(plan, hand);
  const markText = plan.make ? "SPARE" : `${plan.hits.length} PIN${plan.hits.length > 1 ? "S" : ""}`;

  return (
    <div className={`bw-sg bw-sg--${bowler} ${plan.make ? "" : "is-split"}`}>
      <figure ref={figRef} className="bw-sg-fig">
        <svg
          className="bw-sg-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`The line for the ${leaveName(plan.leave)}: ${words.line}`}
        >
          <LaneBed hand={hand} standing={[]} />
          <path
            ref={lineRef}
            d={`M ${show.start.x} ${show.start.y} L ${show.contact.x} ${show.contact.y}`}
            pathLength="1"
            className="bw-sg-line"
          />
          <circle ref={ringRef} cx={show.target.x} cy={show.target.y} r="11" className="bw-sg-ring" />
          {plan.leave.map((pin) => {
            const { x, y } = spot(pinAt(pin).x, pinAt(pin).y);
            return (
              <g key={pin} transform={`translate(${x} ${y})`}>
                <g
                  ref={(el) => {
                    pinRefs.current[pin] = el;
                  }}
                >
                  <Pin />
                </g>
              </g>
            );
          })}
          <g ref={ballRef} className="bw-sg-ball" style={{ opacity: 0 }}>
            <circle r={BALL_RADIUS} />
            <circle cx="-6" cy="-7" r="3.2" className="bw-sg-hole" />
            <circle cx="5" cy="-8" r="3.2" className="bw-sg-hole" />
            <circle cx="0" cy="4" r="3.6" className="bw-sg-hole" />
          </g>
          <text ref={markRef} x={WIDTH / 2} y={PIN_Y - ROW * 1.5} className="bw-sg-mark" aria-hidden="true">
            {markText}
          </text>
        </svg>
      </figure>

      <div className="bw-sg-words">
        <p className="bw-sg-eyebrow">{plan.make ? "Spare line" : "Split"}</p>
        <h3 className="bw-sg-title">{words.title}</h3>
        <p className="bw-sg-aim">{words.aim}</p>
        <p>{words.line}</p>
        <p>
          {words.hit} {words.carry}
        </p>
        <p className="bw-sg-room">{words.room}</p>
        <button type="button" className="bw-link bw-sg-replay" onClick={() => setRun((r) => r + 1)}>
          <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Replay
        </button>
      </div>
    </div>
  );
};

export default SpareGuide;
