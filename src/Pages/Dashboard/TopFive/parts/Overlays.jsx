import { useEffect } from "react";
import { motion } from "framer-motion";
import { SPRING } from "../poses";

/** Visual-only toast (narration goes through the page's live region). */
export const Toast = ({ text }) => (
  <motion.p
    className="td-toast"
    aria-hidden="true"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 8, transition: { duration: 0.2 } }}
    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
  >
    {text}
  </motion.p>
);

/** A Monoton slam reserved for hits: GOD PACK, MASTER SET. */
export const PageBanner = ({ text, onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 1900);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div
      className="td-pagebanner"
      aria-hidden="true"
      initial={{ scale: 1.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ ...SPRING.slam, opacity: { duration: 0.12 } }}
    >
      {text}
    </motion.div>
  );
};

/** The day-job wink: a generic yard truck shunts across and tidies the packs. */
export const YardTruck = ({ onDone }) => (
  <div
    className="td-truck"
    aria-hidden="true"
    onAnimationEnd={(e) => {
      // Child animations (the puff) bubble up too; only the drive ends it.
      if (e.target === e.currentTarget) onDone();
    }}
  >
    <span className="td-truck-beacon" />
    <i className="fa-solid fa-truck" />
    <span className="td-truck-puff" />
  </div>
);
