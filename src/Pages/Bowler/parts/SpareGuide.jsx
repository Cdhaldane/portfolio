import { useEffect, useMemo, useRef, useState } from "react";
import {
  BREAK_IN,
  HEAD_IN,
  IN_PER_BOARD,
  PIN_SPEED,
  ROW_IN,
  pathSlope,
  pathX,
  pinAt,
  pinFlight,
  spareLine,
} from "../spareLine";
import { BALL_RADIUS, FOUL_Y, HEIGHT, PIN_Y, PIT_Y, ROW, WIDTH, aimName, laneX, laneY } from "../laneLine";
import { leaveName } from "../laneHelp";
import { isSplit } from "../scoring";
import LaneBed, { Pin } from "./LaneBed";
import "./spareGuide.css";

/*
 * "Spare line" on the lane page, for the ball after a leave: how to make
 * it (spareLine.js), bent to the bowler's own curve, said the way you'd say
 * it at the lane and shown on the lane. The line draws on from where to lay
 * the ball down, through the board to hit at the arrows and out to the
 * breakpoint, then hooks (or not) into the first pin; the ball rolls it and
 * the pins go the way the model sends them, off the kickbacks and all.
 *
 * It plays once when it scrolls into view (and again on Replay), driven by
 * one clock: render(t) places everything for a moment t, so a frame never
 * waits on React. With reduced motion it's a still: the line, the target
 * and the pins, no ball.
 */
const LINE_MS = 650; // the line drawing on
const WAIT_MS = 150;
const ROLL_MS = 1150; // foul line to the first pin; the deck then plays in slow motion
const MARK_MS = 200; // the "Spare" stamp, after the last pin lands
const DECK = ROW / ROW_IN; // picture units per inch along the pin deck
const PIT_IN = HEAD_IN + 3 * ROW_IN + 30; // far enough back to be in the pit
const SHOWN_CARRY = 40; // how far a pin is shown flying, unless it has further to go
const SOLVE_DELAY_MS = 30; // long enough for the leave to paint first

// Leaves come round again all night; the solver runs once per leave and
// curve. The key is "pins|hook inches|both ways", e.g. "3-6-10|13.8|1".
const cache = new Map();
const planKey = (leave, hook, bothWays) => `${leave.join("-")}|${hook.toFixed(1)}|${bothWays ? 1 : 0}`;
function planFor(key) {
  if (!cache.has(key)) {
    const [pins, hook, both] = key.split("|");
    cache.set(key, spareLine(pins.split("-").map(Number), { hook: Number(hook), bothWays: both === "1" }));
  }
  return cache.get(key);
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const outCubic = (u) => 1 - (1 - u) ** 3;
const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (x, y) => {
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: y / n };
};
const r1 = (n) => Math.round(n * 10) / 10;
const spot = (x, y) => ({ x: r1(laneX(x)), y: r1(laneY(y)) });

/** The point `s` along a polyline, and its total length. */
function along(points, s) {
  let left = s;
  for (let i = 1; i < points.length; i += 1) {
    const seg = dist(points[i - 1], points[i]);
    if (left <= seg) return lerp(points[i - 1], points[i], seg ? left / seg : 0);
    left -= seg;
  }
  return points[points.length - 1];
}
const lengthOf = (points) => points.slice(1).reduce((sum, p, i) => sum + dist(points[i], p), 0);

const and = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const ownBoard = (board, hand) =>
  Math.min(39, Math.max(1, Math.round(hand === "L" ? 40 - board : board)));

/**
 * The plan in words: { eyebrow, title, aim, line, hit, carry, room }.
 * Boards are counted from the bowler's own gutter; left and right are as
 * they see the lane. `curved` says whether the bowler has a hook at all,
 * so a straight ball reads as a choice rather than a default.
 */
export function spareWords(plan, hand = "R", curved = false) {
  const target = ownBoard(plan.target, hand);
  const laydown = ownBoard(plan.laydown, hand);
  const brk = ownBoard(plan.breakpoint, hand);
  const pins = plan.leave.join("-");
  const share = plan.hookShare;
  let line;
  if (!plan.hook && !curved) {
    line =
      plan.from === "middle"
        ? `Straight up the middle: lay it down on board ${laydown} and roll it straight at the ${pins}.`
        : `Cross from the ${plan.from}: lay it down near board ${laydown} and roll it straight at the ${pins}.`;
  } else if (!plan.hook) {
    line = `Throw this one straight: lay it down near board ${laydown} and roll it at the ${pins}.`;
  } else if (share < 0) {
    line = `Curve it the other way: lay it down near board ${laydown}, out to board ${brk}, and bend it back into the ${pins}.`;
  } else if (share < 1) {
    line = `Less hook than usual: lay it down near board ${laydown}, out to board ${brk}, and let it ease into the ${pins}.`;
  } else {
    line = `Your hook: lay it down near board ${laydown}, out to board ${brk} at the breakpoint, and let it come back into the ${pins}.`;
  }

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

  let room;
  if (plan.lively > 1) room = "A tough one: hit it exactly, and throw it with speed so the pins fly.";
  else if (plan.room < 1) room = "Tight: next to no window. Hit your mark exactly.";
  else if (plan.room < 2) room = "Tight: about a board of window. Hit your mark.";
  else room = `About a ${Math.round(plan.room)}-board window.`;

  return {
    eyebrow: isSplit(plan.leave) ? "Split" : "Spare line",
    title: leaveName(plan.leave),
    aim: `Board ${target} · ${aimName(target, hand)}`,
    line,
    hit,
    carry,
    room,
  };
}

/** Where everything is and when, for one plan, in picture units and ms. */
function choreograph(plan) {
  const first = plan.hits[0]; // pins only move once hit, so the ball touches first
  const contact = spot(first.at.x, first.at.y);
  const target = spot(pathX(plan, plan.targetIn), plan.targetIn);
  let path;
  let d;
  if (!plan.hook) {
    // Straight through the target and the first pin, run back to the foul
    // line: the deck is drawn at its own scale, so this is the line that
    // reads right on the picture.
    const back = (FOUL_Y - target.y) / (target.y - contact.y);
    const start = { x: r1(target.x + (target.x - contact.x) * back), y: FOUL_Y };
    path = [start, contact];
    d = `M ${start.x} ${start.y} L ${contact.x} ${contact.y}`;
  } else {
    // Straight out to the breakpoint, then the hook as one curve: leaving
    // along the skid line, arriving on the ball's heading at the pins.
    const start = spot(plan.x0, 0);
    const brk = spot(pathX(plan, BREAK_IN), BREAK_IN);
    const len = dist(brk, contact);
    const skid = unit(brk.x - start.x, brk.y - start.y);
    const heading = unit(-pathSlope(plan, first.at.y) * (laneX(0) - laneX(1)), -DECK);
    const chord = unit(contact.x - brk.x, contact.y - brk.y);
    const arrive = unit(heading.x + chord.x, heading.y + chord.y);
    const c1 = { x: r1(brk.x + skid.x * len * 0.4), y: r1(brk.y + skid.y * len * 0.4) };
    const c2 = { x: r1(contact.x - arrive.x * len * 0.35), y: r1(contact.y - arrive.y * len * 0.35) };
    const bend = Array.from({ length: 16 }, (_, i) => {
      const u = (i + 1) / 16;
      const v = 1 - u;
      return {
        x: v * v * v * brk.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * contact.x,
        y: v * v * v * brk.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * contact.y,
      };
    });
    path = [start, brk, ...bend];
    d = `M ${start.x} ${start.y} L ${brk.x} ${brk.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${contact.x} ${contact.y}`;
  }

  const toPin = lengthOf(path);
  const speed = toPin / ROLL_MS; // picture units per ms
  const pace = (PIN_SPEED * speed) / DECK; // a pin's real inches per ms, in the deck's slow motion
  const heading = unit(pathSlope(plan, first.at.y), 1);
  const end = spot(first.at.x + heading.x * (PIT_IN - first.at.y), PIT_IN);
  const rolled = LINE_MS + WAIT_MS;
  const hitAt = rolled + ROLL_MS;
  const pins = plan.hits.map((h, i) => {
    // Far enough to reach every pin it knocks, and a little past.
    const needs = Math.max(0, ...plan.hits.filter((o) => o.by === h.pin).map((o) => o.gone + 8));
    const distance = Math.max(16, Math.min(SHOWN_CARRY, h.carry), needs);
    const from = pinAt(h.pin);
    return {
      pin: h.pin,
      t: hitAt + ((h.t - first.t) * DECK) / speed,
      home: spot(from.x, from.y),
      flight: pinFlight(from, h.dir, distance),
      distance,
      turn: (h.dir.x > 0 ? -1 : 1) * (150 + ((h.pin * 47) % 140) + i * 10),
    };
  });
  const rollEnd = hitAt + dist(contact, end) / speed;
  const settled = Math.max(rollEnd, ...pins.map((p) => p.t + p.distance / pace));
  return { d, path, toPin, contact, target, end, speed, pace, rolled, pins, mark: settled + MARK_MS };
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SpareGuide = ({ leave, bowler, hand, curve = null, bothWays = false }) => {
  // The curve is in the bowler's own boards; on the lane a lefty's hook goes right.
  const hook = curve === null ? 0 : (hand === "L" ? -1 : 1) * curve * IN_PER_BOARD;
  const key = planKey(leave, hook, bothWays);
  // Solved just after the leave paints (a hard split can take a moment on
  // a phone), unless this leave and curve were solved before.
  const [solved, setSolved] = useState(() => (cache.has(key) ? { key, plan: cache.get(key) } : null));
  useEffect(() => {
    if (cache.has(key)) {
      setSolved((now) => (now && now.key === key ? now : { key, plan: cache.get(key) }));
      return undefined;
    }
    const id = setTimeout(() => setSolved({ key, plan: planFor(key) }), SOLVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [key]);
  const plan = solved && solved.key === key ? solved.plan : null;
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
    const afterPin = dist(show.contact, show.end);
    const render = (t) => {
      lineRef.current.style.strokeDashoffset = String(1 - outCubic(clamp01(t / LINE_MS)));
      ringRef.current.style.opacity = String(clamp01((t - LINE_MS * 0.6) / 200));

      const s = (t - show.rolled) * show.speed;
      const where =
        s <= show.toPin
          ? along(show.path, Math.max(0, s))
          : lerp(show.contact, show.end, clamp01((s - show.toPin) / afterPin));
      const into = clamp01((PIT_Y + BALL_RADIUS - where.y) / BALL_RADIUS); // dropping into the pit
      ballRef.current.setAttribute("transform", `translate(${where.x} ${where.y}) scale(${1 - into * 0.3})`);
      ballRef.current.style.opacity = String(s < 0 ? 0 : Math.min(clamp01(s / 30), 1 - into));

      show.pins.forEach((p) => {
        const el = pinRefs.current[p.pin];
        if (!el) return;
        const flown = Math.min(p.distance, Math.max(0, t - p.t) * show.pace);
        const at = along(p.flight, flown);
        const pos = spot(at.x, at.y);
        const u = flown / p.distance;
        el.setAttribute(
          "transform",
          `translate(${r1(pos.x - p.home.x)} ${r1(pos.y - p.home.y)}) rotate(${r1(p.turn * outCubic(u))})`
        );
        el.style.opacity = String(u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
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

  if (!plan) {
    return (
      <p className="bw-sg-wait" aria-live="polite">
        <i className="fa-solid fa-route" aria-hidden="true" /> Working out the line…
      </p>
    );
  }
  const words = spareWords(plan, hand, curve !== null);

  return (
    <div className={`bw-sg bw-sg--${bowler} ${words.eyebrow === "Split" ? "is-split" : ""}`}>
      <figure ref={figRef} className="bw-sg-fig">
        <svg
          className="bw-sg-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`The line for the ${leaveName(plan.leave)}: ${words.line}`}
        >
          <LaneBed hand={hand} standing={[]} />
          <path ref={lineRef} d={show.d} pathLength="1" className="bw-sg-line" />
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
            SPARE
          </text>
        </svg>
      </figure>

      <div className="bw-sg-words">
        <p className="bw-sg-eyebrow">{words.eyebrow}</p>
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
