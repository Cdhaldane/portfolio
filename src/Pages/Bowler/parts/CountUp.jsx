import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "framer-motion";

/*
 * Counts a number up once when it scrolls into view. Writes textContent
 * directly from framer-motion's animation callback, so there is no React
 * re-render per frame.
 */
const CountUp = ({ value, decimals = 0, className }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const text = value === null || value === undefined ? "-" : value.toFixed(decimals);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === null || value === undefined) return undefined;
    if (reduce || !inView) {
      el.textContent = text;
      return undefined;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = v.toFixed(decimals);
      },
    });
    return () => controls.stop();
  }, [value, decimals, inView, reduce, text]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
};

export default CountUp;
