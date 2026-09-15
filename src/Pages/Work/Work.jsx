import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "framer-motion";
import Seo from "../../Components/Seo/Seo";

import "./Work.css";

/**
 * Work — a portfolio gallery in the site's design language, but with its own
 * signature interaction: each project is a large row that tints to its accent
 * colour on hover while a cover-image preview tracks the cursor. On touch /
 * small screens the preview is replaced by inline thumbnails.
 */
const PROJECTS = [
  {
    slug: "edusim",
    name: "EduSim",
    discipline: "Full-Stack · Custom CMS",
    accent: "#c2334a",
    img: "/assets/edusim/header.png",
  },
  {
    slug: "marz",
    name: "Marz",
    discipline: "VFX Pipeline · Tooling",
    accent: "#e5484d",
    img: "/assets/marz/header.png",
  },
  {
    slug: "timeslot",
    name: "Timeslot",
    discipline: "Full-Stack · Scheduling",
    accent: "#3fa86a",
    img: "/assets/timeslot/header-light.png",
  },
  {
    slug: "vxnessa",
    name: "Vxnessa",
    discipline: "Web Design",
    accent: "#8b5cf6",
    img: "/assets/vxnessa/header.png",
  },
];

const NAME = "WORK";

const Work = () => {
  const [active, setActive] = useState(null);
  const reduce = useReducedMotion();

  // Cursor-following preview (desktop). Springs smooth the motion.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const px = useSpring(mx, { stiffness: 260, damping: 28 });
  const py = useSpring(my, { stiffness: 260, damping: 28 });

  const onMove = (e) => {
    mx.set(e.clientX);
    my.set(e.clientY);
  };

  // Scroll weight. The list lags a few pixels behind the page while the wheel
  // is moving and eases back to rest when it stops, so the column reads as
  // having mass instead of being painted on. One CSS variable, never a
  // per-frame React state write (CLAUDE.md §3); the loop is started by the
  // scroll listener and shuts itself down once the list has settled, so an
  // idle page holds no rAF open.
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el || reduce) return undefined;

    let raf = 0;
    let lastY = window.scrollY;
    let drag = 0;

    const loop = () => {
      const y = window.scrollY;
      const v = y - lastY;
      lastY = y;

      // Negative so the list trails the direction of travel.
      const target = Math.max(-14, Math.min(14, -v * 0.55));
      drag += (target - drag) * 0.12;

      if (Math.abs(drag) < 0.05 && v === 0) {
        el.style.setProperty("--drag", "0px");
        raf = 0;
        return;
      }
      el.style.setProperty("--drag", drag.toFixed(2) + "px");
      raf = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduce]);

  return (
    <div className="wk" onPointerMove={onMove}>
      <Seo
        title="Work"
        path="/work"
        description="Selected web design, full-stack development and VFX pipeline projects by Charlie Haldane."
      />

      <div className="wk-aurora" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
      </div>

      {/* ---------------- HERO ---------------- */}
      <header className="wk-hero">
        <motion.p
          className="wk-eyebrow"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="dot" /> Selected work · 2020 — 2025
        </motion.p>

        <h1 className="wk-title" aria-label={NAME}>
          {NAME.split("").map((ch, i) => (
            <span
              className="wk-letter"
              key={i}
              style={{ animationDelay: `${0.15 + i * 0.07}s` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <motion.p
          className="wk-lead"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          A showcase of my best work across web design, full-stack development
          and VFX pipelines. My role has evolved a lot over the last few years —
          I strive to learn and grow with every project.
        </motion.p>
      </header>

      {/* ---------------- PROJECT LIST ---------------- */}
      <section className="wk-list" aria-label="Projects" ref={listRef}>
        {PROJECTS.map((p, i) => (
          <motion.div
            key={p.slug}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{
              type: "spring",
              stiffness: 90,
              damping: 16,
              delay: i * 0.08,
            }}
          >
            <Link
              className="wk-item"
              to={`/work/${p.slug}`}
              style={{ "--proj": p.accent }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((a) => (a === i ? null : a))}
            >
              <span className="wk-item-index">0{i + 1}</span>
              {/* Split so the row can run the site's signature per-letter
                  lift on hover — the same gesture as the Landing and Work
                  headline type, scaled down to a list row. */}
              <span className="wk-item-name" aria-label={p.name}>
                {p.name.split("").map((ch, j) => (
                  <span
                    className="wk-item-char"
                    key={j}
                    aria-hidden="true"
                    style={{ "--j": j }}
                  >
                    {ch}
                  </span>
                ))}
              </span>
              <span className="wk-item-meta">{p.discipline}</span>
              <img
                className="wk-item-thumb"
                src={p.img}
                alt={`${p.name} project preview`}
                loading="lazy"
              />
              <i className="fa-solid fa-arrow-right wk-item-arrow" aria-hidden="true" />
            </Link>
          </motion.div>
        ))}
      </section>

      {/* ---------------- FLOATING CURSOR PREVIEW (desktop) ---------------- */}
      {!reduce && (
        <motion.div className="wk-preview" style={{ x: px, y: py }} aria-hidden="true">
          <motion.div
            className="wk-preview-inner"
            animate={{
              opacity: active !== null ? 1 : 0,
              scale: active !== null ? 1 : 0.85,
            }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ "--proj": active !== null ? PROJECTS[active].accent : "transparent" }}
          >
            {PROJECTS.map((p, i) => (
              <img
                key={p.slug}
                src={p.img}
                alt=""
                style={{ opacity: active === i ? 1 : 0 }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export default Work;
