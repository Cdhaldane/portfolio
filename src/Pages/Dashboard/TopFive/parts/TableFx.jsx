import { motion } from "framer-motion";
import { SPRING } from "../poses";

/*
 * Flat effect layers for the table. They live OUTSIDE the 3D sorting context
 * (above or below the lens), so a card tilting or flipping through them can
 * never be sliced, darkened or z-fought.
 */

const at = (x, y) => ({ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` });

export const Rays = ({ x, y, size, charging }) => (
  <span
    className={`td-rays ${charging ? "is-charging" : ""}`}
    style={{ ...at(x, y), "--size": `${size}px` }}
    aria-hidden="true"
  />
);

export const Flash = () => <span className="td-flash" aria-hidden="true" />;

export const Shockwave = ({ x, y, size }) => (
  <span className="td-shock" style={{ ...at(x, y), "--size": `${size}px` }} aria-hidden="true" />
);

export const Flare = ({ x, y, size }) => (
  <span className="td-flare" style={{ ...at(x, y), "--size": `${size}px` }} aria-hidden="true" />
);

export const Banner = ({ text, y }) => (
  <motion.div
    className="td-banner"
    style={{ top: `calc(50% + ${y}px)` }}
    initial={{ scale: 1.5, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    exit={{ opacity: 0, transition: { duration: 0.3 } }}
    transition={{ ...SPRING.slam, opacity: { duration: 0.12 } }}
    aria-hidden="true"
  >
    {text}
  </motion.div>
);
