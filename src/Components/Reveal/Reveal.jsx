import { useEffect, useRef, useState } from "react";
import "./Reveal.css";

/*
 * Scroll-triggered entrance. An IntersectionObserver flips `.is-in` when the
 * element scrolls into view; CSS transitions opacity/translate/blur. One of the
 * two shared motion primitives promoted from the About page (see CLAUDE.md §3).
 *
 *   <Reveal as="section" delay={120}>…</Reveal>
 */
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Reveal = ({
  as: Tag = "div",
  children,
  className = "",
  delay = 0,
  y = 16,
  once = true,
  style,
  ...rest
}) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion()) {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <Tag
      ref={ref}
      className={`reveal ${inView ? "is-in" : ""} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms`, "--reveal-y": `${y}px`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default Reveal;
