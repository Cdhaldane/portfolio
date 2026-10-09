import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, motionValue, useMotionValueEvent, useTransform } from "framer-motion";
import TradingCard from "./TradingCard";
import { PHASE } from "../deckReducer";
import { collectorNo, rankAt, rarityOf } from "../top5.data";
import { EASE_IN, EASE_OUT, LEGEND_HOLD, SPRING, poseFor, sidePose } from "../poses";

// Inactive cards share one static light: a flattering fixed foil angle.
const ZERO = motionValue(0);
const STATIC_TILT = {
  rotateX: ZERO,
  rotateY: ZERO,
  "--px": motionValue(0.35),
  "--py": motionValue(0.3),
  "--hyp": ZERO,
  "--glare": ZERO,
};

// Tilt-wrapper beats for the legendary (hoisted so identities are stable).
const TREMBLE = {
  rotate: [0, -1.2, 1.2, -1.2, 1.2, 0],
  scale: 1,
  transition: { rotate: { duration: 0.6, repeat: Infinity, repeatDelay: 0.9 }, scale: { duration: 0.3 } },
};
const CHARGE = {
  rotate: [0, -2.6, 2.6, -2.6, 2.6, 0],
  scale: 1.04,
  transition: { rotate: { duration: 0.3, repeat: Infinity }, scale: { duration: 1.2, ease: EASE_OUT } },
};
const PULSE = {
  rotate: 0,
  scale: [1, 1.12, 1],
  transition: { rotate: { duration: 0.15 }, scale: { duration: 0.5, ease: EASE_OUT } },
};
const STILL = { rotate: 0, scale: 1, transition: { duration: 0.2 } };

/** Which face a card should show for the current beat. */
export const faceFor = (i, { phase, revealed, inspected, backShown }) => {
  if (phase === PHASE.INSPECT && inspected === i && backShown) return "back";
  if (i === 4) return revealed ? "front" : "back";
  return phase === PHASE.SEALED || phase === PHASE.RIPPING ? "back" : "front";
};

/** The nearest flip angle (deg) that shows `face`, starting from `current`. */
export const angleFor = (face, current) =>
  face === "front"
    ? Math.round(current / 360) * 360
    : Math.round((current - 180) / 360) * 360 + 180;

const isBackAngle = (v) => {
  const a = ((v % 360) + 360) % 360;
  return a > 90 && a < 270;
};

/** True on the frame a flip brings the front into view (either direction, or an instant jump). */
export const revealsFace = (prev, next) => isBackAngle(prev) && !isBackAngle(next);

const transitionFor = (kind, i, { phase, cadence, arrived, entry }) => {
  if (!arrived && entry !== "ritual") return { ...SPRING.travel, delay: i * 0.04 };
  switch (kind) {
    case "risen":
      return { duration: 0.45, ease: EASE_OUT, delay: i * 0.02 };
    case "fan":
      return phase === PHASE.DEALING ? { ...SPRING.travel, delay: i * cadence } : SPRING.hover;
    case "lifted":
      return SPRING.hover;
    case "spread":
      return SPRING.nudge;
    case "legend":
      return { duration: 0.45, ease: EASE_OUT };
    case "inspect":
    case "dimmed":
      return SPRING.travel;
    default:
      return { duration: 0 };
  }
};

const CardSlot = memo(function CardSlot({
  index,
  pose,
  transition,
  initial,
  variants,
  dim,
  hue,
  live,
  tiltStyle,
  tiltAnim,
  flip,
  onSettled,
  card,
}) {
  const frontVis = useTransform(flip, (v) => (isBackAngle(v) ? "hidden" : "visible"));
  const backVis = useTransform(flip, (v) => (isBackAngle(v) ? "visible" : "hidden"));
  return (
    <motion.div
      className={`td-slot td-3d ${live ? "is-live" : ""}`}
      style={{ "--dim": dim, "--h": hue }}
      initial={initial}
      animate={pose}
      exit="exit"
      variants={variants}
      transition={transition}
      onAnimationComplete={() => onSettled(index)}
    >
      <motion.div className="td-tilt td-3d" style={tiltStyle} animate={tiltAnim}>
        <motion.div className="td-flip td-3d" style={{ rotateY: flip }}>
          <TradingCard {...card} frontVis={frontVis} backVis={backVis} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
});

/*
 * The five cards on the table. Poses are declarative (a pure function of the
 * deck phase), so skipping, resizing and interrupting all retarget smoothly.
 * The flip angles are motion values this component owns; the flat grips drive
 * pan-to-spin through `spinRef`, never through framer's tap gestures.
 */
function CardHand({
  pack,
  phase,
  entry,
  switchDir,
  revealed,
  inspected,
  backShown,
  torn,
  lifted,
  focusIndex,
  L,
  R,
  stageW,
  origin,
  cadence,
  reduced,
  lite,
  liveIndex,
  holoStyle,
  charging,
  godMode,
  shiny,
  pulledAt,
  sheen,
  cardRefs,
  spinRef,
  onLanded,
  onCrossing,
  onRevealDone,
  onFace,
  onShark,
  onCardClick,
  onCardFocus,
}) {
  const beat = { phase, revealed, inspected, backShown };
  const [flips] = useState(() =>
    Array.from({ length: 5 }, (_, i) => motionValue(angleFor(faceFor(i, beat), 0)))
  );
  const faces = useRef(null);
  if (faces.current === null) faces.current = flips.map((_, i) => faceFor(i, beat));
  const controls = useRef([]);
  const kinds = useRef([]);
  const arrived = useRef([false, false, false, false, false]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cb = useRef({});
  cb.current = { onLanded, onCrossing, onRevealDone, onFace, onShark };

  // Animate each card to the face its beat calls for, once per change.
  useEffect(() => {
    for (let i = 0; i < 5; i += 1) {
      const face = faceFor(i, { phase, revealed, inspected, backShown });
      if (faces.current[i] === face) continue;
      faces.current[i] = face;
      const to = angleFor(face, flips[i].get());
      const legend = i === 4 && phase === PHASE.REVEAL;
      const delay = phase === PHASE.DEALING && i < 4 ? i * cadence + 0.1 : 0;
      const opts = reduced ? { duration: 0 } : legend ? SPRING.legend : { ...SPRING.flip, delay };
      controls.current[i]?.stop();
      controls.current[i] = animate(flips[i], to, opts);
    }
  }, [phase, revealed, inspected, backShown, cadence, reduced, flips]);

  // The reveal: let the flip land, hold the card flat to be read, move on.
  useEffect(() => {
    if (phase !== PHASE.REVEAL) return undefined;
    let live = true;
    let hold = null;
    Promise.resolve(controls.current[4])
      .then(() => {
        if (!live) return undefined;
        hold = animate(0, 1, { duration: reduced ? 0 : LEGEND_HOLD });
        return hold;
      })
      .then(() => {
        if (live) cb.current.onRevealDone?.();
      });
    return () => {
      live = false;
      hold?.stop();
    };
  }, [phase, reduced]);

  // Fire the payoff on the exact frame the legendary passes edge-on (its
  // face changes back -> front). The flip runs 180 -> 360, so test the face,
  // not a fixed angle; comparing prev/next also catches an instant jump.
  const prevAngle = useRef(flips[4].get());
  const crossed = useRef(false);
  useMotionValueEvent(flips[4], "change", (v) => {
    const prev = prevAngle.current;
    prevAngle.current = v;
    if (phaseRef.current !== PHASE.REVEAL || crossed.current) return;
    if (revealsFace(prev, v)) {
      crossed.current = true;
      cb.current.onCrossing?.();
    }
  });

  // God pack: every card in the hand spins once, one after another.
  const godSeen = useRef(godMode);
  useEffect(() => {
    if (godSeen.current === godMode) return;
    godSeen.current = godMode;
    if (!godMode || reduced || (phase !== PHASE.HAND && phase !== PHASE.INSPECT)) return;
    flips.forEach((f, i) => {
      controls.current[i]?.stop();
      controls.current[i] = animate(f, f.get() + 360, { duration: 0.4, delay: i * 0.08, ease: EASE_OUT });
    });
  }, [godMode, phase, reduced, flips]);

  // Pan-to-spin, driven by the flat SpinGrip.
  useEffect(() => {
    if (!spinRef) return undefined;
    let drag = null;
    const settle = (i, target) => {
      const face = isBackAngle(target) ? "back" : "front";
      faces.current[i] = face;
      cb.current.onFace?.(i, face);
    };
    const api = {
      begin(i) {
        controls.current[i]?.stop();
        drag = { i, start: flips[i].get() };
      },
      move(i, dx) {
        if (drag && drag.i === i) flips[i].set(drag.start + dx * 0.6);
      },
      release(i, vx) {
        if (!drag || drag.i !== i) return;
        drag = null;
        let target = Math.round((flips[i].get() + vx * 0.12) / 180) * 180;
        if (Math.abs(vx) > 2400) {
          target += Math.sign(vx) * 1080;
          cb.current.onShark?.();
        }
        const opts = reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 200, damping: 20, velocity: vx * 0.6 };
        controls.current[i] = animate(flips[i], target, opts);
        settle(i, target);
      },
      tap(i) {
        const face = faces.current[i] === "front" ? "back" : "front";
        const target = angleFor(face, flips[i].get());
        controls.current[i]?.stop();
        controls.current[i] = animate(flips[i], target, reduced ? { duration: 0 } : SPRING.flip);
        settle(i, target);
      },
    };
    spinRef.current = api;
    // During a pack switch the outgoing hand unmounts after the new one has
    // claimed spinRef; only clear it if it's still ours.
    return () => {
      if (spinRef.current === api) spinRef.current = null;
    };
  }, [spinRef, flips, reduced]);

  useEffect(
    () => () => controls.current.forEach((c) => c?.stop()),
    []
  );

  const onSettled = useCallback((i) => {
    arrived.current[i] = true;
    if (phaseRef.current === PHASE.DEALING && i < 4 && kinds.current[i] === "fan") {
      cb.current.onLanded?.(i);
    }
  }, []);

  const exitVariants = useMemo(
    () =>
      [0, 1, 2, 3, 4].map((i) => ({
        exit: (dir) => ({
          ...sidePose(i, -(dir || 1), L, stageW),
          transition: { duration: 0.3, ease: EASE_IN, delay: i * 0.03 },
        }),
      })),
    [L, stageW]
  );

  const handlers = useMemo(() => {
    // The outgoing hand of a pack switch unmounts after the incoming one has
    // filled cardRefs; only clear slots this hand still owns.
    const mine = [];
    return [0, 1, 2, 3, 4].map((i) => ({
      ref: (el) => {
        if (el) {
          mine[i] = el;
          cardRefs.current[i] = el;
        } else {
          if (cardRefs.current[i] === mine[i]) cardRefs.current[i] = null;
          mine[i] = null;
        }
      },
      onClick: () => onCardClick(i),
      onFocus: () => onCardFocus(i),
    }));
  }, [cardRefs, onCardClick, onCardFocus]);

  const initialFor = (i) => {
    if (entry === "switch") return sidePose(i, switchDir || 1, L, stageW);
    if (entry === "reopen" && origin) {
      return { x: origin.x, y: origin.y, z: 0, rotate: origin.rotate + (i - 2) * 3, scale: origin.cardScale };
    }
    if (reduced) return false;
    return poseFor({ i, phase: PHASE.SEALED, L, R }).pose;
  };

  return flips.map((flip, i) => {
    const rank = rankAt(i);
    const card = pack.cards[rank - 1];
    const rarity = rarityOf(rank);
    const tier = godMode ? "legendary" : rarity.tier;
    const { kind, pose } = poseFor({
      i,
      phase,
      tearDone: torn,
      lifted: phase === PHASE.HAND ? lifted : null,
      inspected,
      L,
      R,
    });
    kinds.current[i] = kind;
    const concealed = i === 4 ? !revealed : phase === PHASE.SEALED || phase === PHASE.RIPPING;
    const focused = phase === PHASE.INSPECT && inspected === i;
    const dim =
      phase === PHASE.INSPECT
        ? focused
          ? 1
          : 0.35
        : (phase === PHASE.LEGEND || phase === PHASE.REVEAL) && i < 4
          ? 0.5
          : 1;
    let tiltAnim = STILL;
    if (i === 4 && phase === PHASE.LEGEND) tiltAnim = charging ? CHARGE : TREMBLE;
    if (i === 4 && phase === PHASE.REVEAL) tiltAnim = PULSE;
    const live = liveIndex === i;
    const hit =
      phase === PHASE.HAND && !concealed
        ? {
            ...handlers[i],
            tabIndex: i === focusIndex ? 0 : -1,
            "aria-label": `Number ${rank}, ${rarity.label}: ${card.title}`,
            "aria-describedby": `td-desc-${pack.id}-${i}`,
          }
        : undefined;

    return (
      <CardSlot
        key={card.id}
        index={i}
        pose={pose}
        transition={transitionFor(kind, i, { phase, cadence, arrived: arrived.current[i], entry })}
        initial={initialFor(i)}
        variants={exitVariants[i]}
        dim={dim}
        hue={pack.hue}
        live={live || kind === "risen" || phase === PHASE.DEALING}
        tiltStyle={live && holoStyle ? holoStyle : STATIC_TILT}
        tiltAnim={tiltAnim}
        flip={flip}
        onSettled={onSettled}
        card={{
          pack,
          card,
          rank,
          tier,
          collector: collectorNo(pack, rank),
          concealed,
          detailed: focused,
          backShown: focused && backShown,
          live,
          lite,
          shiny,
          pulledAt,
          flourish: pack.flourish,
          sheenKey: sheen[i],
          hit,
        }}
      />
    );
  });
}

export default CardHand;
