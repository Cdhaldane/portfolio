import { useEffect, useMemo, useRef } from "react";
import { animate, motion, useAnimate, useTransform } from "framer-motion";
import PackArt, { STRIP } from "./PackArt";
import { PHASE } from "../deckReducer";
import { EASE_IN, EASE_OUT, prand } from "../poses";

export const SLICES = 8;
const JITTER = Array.from({ length: SLICES }, (_, k) => (prand(k + 70) - 0.5) * 8);
const TEAR_EASE = [0.65, 0, 0.35, 1];

/** One strip slice, hinged on the tear line, peeling on its share of `tear`. */
const Slice = ({ k, tear, dir }) => {
  const lift = useTransform([tear, dir], ([t, d]) => {
    const idx = d > 0 ? k : SLICES - 1 - k;
    return Math.min(1, Math.max(0, t * SLICES - idx));
  });
  const rotateX = useTransform(lift, (l) => l * -42);
  const y = useTransform(lift, (l) => l * -10);
  const rotate = useTransform(lift, (l) => l * JITTER[k]);
  // The span is a transform-only wrapper; the leaf face carries the paint
  // (and the fade), so the two never fight over one element.
  return (
    <motion.span className="td-slice" style={{ rotateX, y, rotate, "--k": k }}>
      <i className="td-slice-face" />
    </motion.span>
  );
};

/*
 * The booster on the table. Its outer element owns the flight in from the
 * shelf; the strip, body and wobble are plain elements driven by useAnimate,
 * so each transform has exactly one writer. The card stack sits behind the
 * body in true 3D (CardHand's in-pack poses), so dropping the body is what
 * reveals the cards rising out of the torn top.
 */
export default function RipPack({
  pack,
  R,
  stageW,
  initial,
  tear,
  dir,
  phase,
  reduced,
  holoStyle,
  wobble,
  onTorn,
  onOpened,
}) {
  const [scope, animateScope] = useAnimate();
  const cb = useRef({});
  cb.current = { onTorn, onOpened };
  const w = R.w;
  const h = R.h;

  const target = useMemo(
    () => ({ x: 0, y: 0, z: reduced ? 0 : [0, 120, 0], rotate: 0, scale: R.scale }),
    [R.scale, reduced]
  );
  const variants = useMemo(
    () => ({
      exit: (d) => ({
        x: -(d || 1) * stageW * 0.62,
        rotate: -(d || 1) * 12,
        transition: { duration: 0.3, ease: EASE_IN },
      }),
    }),
    [stageW]
  );
  const flight = useMemo(
    () => ({
      default: { duration: 0.65, ease: EASE_OUT },
      z: { duration: 0.65, ease: "easeInOut", times: [0, 0.4, 1] },
    }),
    []
  );

  const sparkX = useTransform([tear, dir], ([t, d]) => ((d > 0 ? t : 1 - t) - 0.5) * w);
  const sparkOn = useTransform(tear, (t) => (t > 0.01 && t < 0.99 ? 1 : 0));

  // A failed tear: the pack shrugs it off.
  useEffect(() => {
    if (!wobble || reduced) return;
    animateScope(".td-rip-wobble", { rotate: [0, -2.5, 2.5, -1, 0] }, { duration: 0.35 });
  }, [wobble, reduced, animateScope]);

  // The rip itself: finish the tear, fling the strip, drop the body.
  useEffect(() => {
    if (phase !== PHASE.RIPPING) return undefined;
    let live = true;
    const quick = { duration: 0 };
    const run = async () => {
      const t0 = tear.get();
      await animate(
        tear,
        1,
        reduced ? quick : { duration: t0 > 0.55 ? 0.18 : 0.42, ease: t0 > 0.55 ? EASE_OUT : TEAR_EASE }
      );
      if (!live) return;
      cb.current.onTorn?.();
      await Promise.all([
        animateScope(".td-rip-strip", { x: 60, y: -200, rotate: 18 }, reduced ? quick : { duration: 0.6, ease: [0.2, 0.7, 0.3, 1] }),
        animateScope(".td-slice-face", { opacity: 0 }, reduced ? quick : { duration: 0.25, delay: 0.35 }),
        animateScope(".td-rip-body", { y: h * 1.2, rotate: 6 }, reduced ? quick : { duration: 0.5, ease: EASE_IN, delay: 0.1 }),
      ]);
      if (live) cb.current.onOpened?.();
    };
    run();
    return () => {
      live = false;
    };
  }, [phase, reduced, tear, h, animateScope]);

  return (
    <motion.div
      ref={scope}
      className="td-rip-pack td-3d"
      style={{ "--pw": `${w}px`, "--ph": `${h}px`, "--h": pack.hue, width: w, height: h, left: -w / 2, top: -h / 2 }}
      initial={initial}
      animate={target}
      exit="exit"
      variants={variants}
      transition={flight}
    >
      <div className="td-rip-wobble td-3d">
        <motion.div className="td-rip-tilt td-3d" style={holoStyle}>
          <div className={`td-rip-body ${pack.secret ? "is-secret" : ""}`}>
            <PackArt pack={pack} secret={pack.secret} />
            <span className="td-glare" aria-hidden="true" />
          </div>
          <div className="td-rip-strip td-3d" style={{ height: `${(STRIP + 0.025) * 100}%` }}>
            {Array.from({ length: SLICES }, (_, k) => (
              <Slice key={k} k={k} tear={tear} dir={dir} />
            ))}
          </div>
          <motion.span className="td-rip-spark" style={{ x: sparkX, opacity: sparkOn }} aria-hidden="true" />
        </motion.div>
      </div>
    </motion.div>
  );
}
