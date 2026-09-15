import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Spinner from "../../DevComponents/Spinner/Spinner";
import { scrollToTop } from "../SmoothScroll/scrollControl";
import "./PageTransition.css";

/*
 * PageTransition — the crossfade between routes.
 *
 * Exit is deliberately shorter than enter (260ms vs 420ms): leaving should feel
 * decisive, arriving should feel like it lands. `mode="wait"` keeps exactly one
 * page mounted at a time, so the two never overlap or double-scroll.
 *
 * OPACITY ONLY — no transform. A `transform` on this wrapper would make it the
 * containing block for every `position: fixed` descendant, which on this site
 * means the Work cursor-preview (Work.css) and the About/Services aurora
 * fields would detach from the viewport for the duration of the animation.
 * Showcase.css already carries a comment about being bitten by exactly this.
 * `opacity` creates a stacking context but never a containing block, so the
 * lift has to come from each page's own entrance motion — which every page
 * already has.
 *
 * The caller must pass the same `location` object it hands to <Routes>. During
 * an exit, AnimatePresence re-renders the cached outgoing element — if <Routes>
 * read the location from router context instead of a prop, it would swap to the
 * incoming route mid-exit and the old page would appear to morph.
 */

// Surfaces that own their whole viewport and navigate internally. They animate
// once on the way in and out, but not between their own sub-routes — a fade on
// every move inside a game would be noise.
const GROUPED_PREFIXES = ["/dashboard", "/budgetter", "/gallows-hymn"];

const groupKey = (pathname) =>
  GROUPED_PREFIXES.find((p) => pathname.startsWith(p)) || pathname;

const EASE_OUT = [0.16, 1, 0.3, 1]; // CLAUDE.md §1 — expressive but quick
const EASE_IN = [0.4, 0, 0.2, 1];

/*
 * Suspense fallback that stays invisible unless the chunk is genuinely slow.
 * Every route is lazy(), and on a warm connection a chunk resolves in well
 * under 100ms — so an immediate spinner reads as a flicker, which feels worse
 * than the slightly longer wait it was meant to explain.
 */
export const DelayedFallback = ({ delay = 250 }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  return show ? <Spinner /> : null;
};

const PageTransition = ({ location, children }) => {
  const reduce = useReducedMotion();

  // Reduced motion shortens the cross-fade rather than removing it: an instant
  // swap makes it ambiguous whether navigation happened at all (CLAUDE.md §6).
  const duration = reduce
    ? { enter: 0.12, exit: 0.1, delay: 0 }
    : { enter: 0.42, exit: 0.26, delay: 0.04 };

  const variants = {
    initial: { opacity: 0 },
    enter: {
      opacity: 1,
      transition: {
        duration: duration.enter,
        ease: EASE_OUT,
        delay: duration.delay,
      },
    },
    exit: {
      opacity: 0,
      transition: { duration: duration.exit, ease: EASE_IN },
    },
  };

  return (
    <AnimatePresence mode="wait" initial={false} onExitComplete={scrollToTop}>
      <motion.div
        key={groupKey(location.pathname)}
        className="page-transition"
        variants={variants}
        initial="initial"
        animate="enter"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};

export default PageTransition;
