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

const TICKER = [
  "REACT",
  "TYPESCRIPT",
  "NODE",
  "DESIGN SYSTEMS",
  "MOTION",
  "UI ENGINEERING",
  "OPEN TO FREELANCE",
];

const Landing = () => {
  const rootRef = useRef(null);
  const nameRef = useRef(null);

  // Pointer → CSS variables, rAF-throttled. --mx/--my drive the spotlight
  // (% of the page); --nx/--ny drive the name x-ray mask (px within the
  // name's own box, since mask gradient positions resolve against the element).
  useEffect(() => {
    const root = rootRef.current;
    const nameEl = nameRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let ev = null;
    const apply = () => {
      raf = 0;
      const r = root.getBoundingClientRect();
      root.style.setProperty("--mx", `${((ev.clientX - r.left) / r.width) * 100}%`);
      root.style.setProperty("--my", `${((ev.clientY - r.top) / r.height) * 100}%`);
      if (nameEl) {
        const n = nameEl.getBoundingClientRect();
        root.style.setProperty("--nx", `${ev.clientX - n.left}px`);
        root.style.setProperty("--ny", `${ev.clientY - n.top}px`);
      }
    };
    const onMove = (e) => {
      ev = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      root.style.setProperty("--nx", "-999px");
      root.style.setProperty("--ny", "-999px");
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  let letterIndex = 0;

  const renderLetters = (word, animated) =>
    word.split("").map((ch, i) => {
      if (!animated) {
        return (
          <span className="lp-letter" key={`${word}-${i}`}>
            <span className="lp-letter-in">{ch}</span>
          </span>
        );
      }
      const delay = 0.2 + letterIndex * 0.05;
      letterIndex += 1;
      return (
        <span
          className="lp-letter"
          key={`${word}-${ch}-${letterIndex}`}
          style={{ animationDelay: `${delay}s` }}
        >
          <span className="lp-letter-in">{ch}</span>
        </span>
      );
    });

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
      <div className="lp-grain" aria-hidden="true" />

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

        <div className="lp-name-wrap" ref={nameRef}>
          <h1 className="lp-name" aria-label={NAME.join(" ")}>
            {NAME.map((word) => (
              <span className="lp-word" key={word}>
                {renderLetters(word, true)}
              </span>
            ))}
          </h1>
          {/* Wireframe twin revealed through the cursor mask. Split into the
              same per-letter spans so its kerning matches the solid layer. */}
          <div className="lp-name-ghost" aria-hidden="true">
            {NAME.map((word) => (
              <span className="lp-word" key={word}>
                {renderLetters(word, false)}
              </span>
            ))}
          </div>
        </div>

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
                {/* White twin of the row, clip-path'd in lockstep with the
                    fill so text recolors exactly at the wipe edge. */}
                <span className="lp-nav-ghost" aria-hidden="true">
                  <span className="lp-nav-index">0{i + 1}</span>
                  <span className="lp-nav-label">{item.label}</span>
                  <i className="fa-solid fa-arrow-right lp-nav-arrow" />
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.nav>
      </main>

      <div className="lp-meta" aria-hidden="true">
        <span className="lp-meta-rule" />
        <span className="lp-meta-txt">CRAFT / CODE / MOTION</span>
        <span className="lp-meta-rule" />
        <span className="lp-meta-txt">© MMXXVI</span>
      </div>

      <div className="lp-ticker" aria-hidden="true">
        <div className="lp-ticker-track">
          {[0, 1].map((dup) => (
            <div className="lp-ticker-group" key={dup}>
              {TICKER.map((t) => (
                <span className="lp-ticker-item" key={t}>
                  {t}
                  <em>✦</em>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Landing;
