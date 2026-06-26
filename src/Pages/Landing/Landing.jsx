import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Seo from "../../Components/Seo/Seo";

import "./Landing.css";

const NAV = [
  { label: "SERVICES", to: "/services" },
  { label: "WORK", to: "/work" },
  { label: "ABOUT", to: "/about" },
  { label: "CONTACT", to: "/contact" },
];

const NAME = ["CHARLIE", "HALDANE"];

const Landing = () => {
  const rootRef = useRef(null);

  // Cursor-tracked spotlight — pure CSS variables driven from JS.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onMove = (e) => {
      const r = root.getBoundingClientRect();
      root.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      root.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    };
    root.addEventListener("pointermove", onMove);
    return () => root.removeEventListener("pointermove", onMove);
  }, []);

  let letterIndex = 0;

  return (
    <div className="lp" ref={rootRef}>
      <Seo path="/" />

      <div className="lp-aurora" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="lp-spotlight" aria-hidden="true" />
      <div className="lp-grid" aria-hidden="true" />

      <main className="lp-hero">
        <motion.p
          className="lp-eyebrow"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="lp-dot" /> Currently full-stack @ National Shunt
          Service Ltd.
        </motion.p>

        <h1 className="lp-name" aria-label={NAME.join(" ")}>
          {NAME.map((word) => (
            <span className="lp-word" key={word}>
              {word.split("").map((ch) => {
                const delay = 0.2 + letterIndex * 0.05;
                letterIndex += 1;
                return (
                  <span
                    className="lp-letter"
                    key={`${word}-${ch}-${letterIndex}`}
                    style={{ animationDelay: `${delay}s` }}
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          ))}
        </h1>

        <motion.p
          className="lp-tagline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
        >
          Software engineer & designer crafting fast, expressive web
          experiences — obsessing over the motion, layout and the details most
          people never notice but everyone feels.
        </motion.p>

        <motion.nav
          className="lp-nav"
          aria-label="Primary"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.7 } },
          }}
        >
          {NAV.map((item, i) => (
            <motion.div
              key={item.to}
              variants={{
                hidden: { opacity: 0, x: -24 },
                show: { opacity: 1, x: 0 },
              }}
              transition={{ type: "spring", stiffness: 120, damping: 18 }}
            >
              <Link className="lp-nav-item" to={item.to}>
                <span className="lp-nav-fill" aria-hidden="true" />
                <span className="lp-nav-index">0{i + 1}</span>
                <span className="lp-nav-label">{item.label}</span>
                <i className="fa-solid fa-arrow-right lp-nav-arrow" />
              </Link>
            </motion.div>
          ))}
        </motion.nav>
      </main>
    </div>
  );
};

export default Landing;
