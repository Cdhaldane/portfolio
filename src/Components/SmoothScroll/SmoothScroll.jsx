import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import Lenis from "lenis";
import { setLenis } from "./scrollControl";

/*
 * SmoothScroll — Lenis inertial scrolling, promoted from the About page to the
 * app root (CLAUDE.md §6). Mounting it once means every scroll-linked effect on
 * the site reads the same easing, instead of /about feeling different from
 * everywhere else.
 *
 * Skipped on the self-contained surfaces: they own their viewport and are built
 * from nested scroll containers, which Lenis would fight. Those routes keep
 * native scrolling.
 */
const SKIP_PREFIXES = ["/dashboard", "/budgetter", "/gallows-hymn"];

const SmoothScroll = () => {
  const { pathname } = useLocation();
  const skip = SKIP_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (skip) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return undefined;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    setLenis(lenis);

    let raf = 0;
    const loop = (time) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      setLenis(null);
      lenis.destroy();
    };
    // Depends on `skip`, not `pathname` — navigating between public routes
    // must not tear down and rebuild the scroller mid-transition.
  }, [skip]);

  return null;
};

export default SmoothScroll;
