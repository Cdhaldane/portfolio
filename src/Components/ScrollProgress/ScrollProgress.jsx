import { useEffect, useRef } from "react";
import "./ScrollProgress.css";

/*
 * A fixed top progress bar driven by a single `--progress` CSS variable
 * (0 → 1), updated in a rAF-throttled scroll listener — never per-frame React
 * state (CLAUDE.md §3, §5). The second shared motion primitive.
 *
 *   <ScrollProgress />                  // tracks window scroll
 *   <ScrollProgress target={someRef} /> // tracks a scroll container
 */
const ScrollProgress = ({ className = "", target }) => {
  const barRef = useRef(null);

  useEffect(() => {
    const scroller = target?.current || null;
    let raf = 0;

    const compute = () => {
      raf = 0;
      let p = 0;
      if (scroller) {
        const max = scroller.scrollHeight - scroller.clientHeight;
        p = max > 0 ? scroller.scrollTop / max : 0;
      } else {
        const doc = document.documentElement;
        const max = doc.scrollHeight - doc.clientHeight;
        p = max > 0 ? (window.scrollY || doc.scrollTop) / max : 0;
      }
      p = Math.min(1, Math.max(0, p));
      if (barRef.current) barRef.current.style.setProperty("--progress", String(p));
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    const node = scroller || window;
    node.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target]);

  return <div ref={barRef} className={`scroll-progress ${className}`.trim()} aria-hidden="true" />;
};

export default ScrollProgress;
