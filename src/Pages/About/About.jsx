import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Lenis from "lenis";
import Seo from "../../Components/Seo/Seo";
import "./About.css";

/**
 * About — a motion-driven introduction page.
 *
 * Design goals: demonstrate CSS animation, layout and interaction craft.
 *  - Aurora gradient field + cursor spotlight in the hero
 *  - Per-letter kinetic reveal of the name
 *  - 3D tilt on the portrait card (pointer-tracked)
 *  - Infinite skill marquee (pure CSS)
 *  - Scroll-triggered reveals via IntersectionObserver
 *  - Count-up stats that animate on entry
 *  - A timeline whose spine "draws" itself into view
 */

const STATS = [
  { value: 5, suffix: "+", label: "Years writing code" },
  { value: 20, suffix: "+", label: "Projects shipped" },
  { value: 3, suffix: "", label: "Languages I reach for daily" },
  { value: 100, suffix: "%", label: "Caffeine powered" },
];

const SKILLS = [
  "React",
  "TypeScript",
  "Node.js",
  "CSS Animation",
  "Framer Motion",
  "Python",
  "C++",
  "UI / UX",
  "Three.js",
  "PostgreSQL",
  "Webflow",
  "VFX Pipelines",
  "Agile",
  "Design Systems",
];

const TIMELINE = [
  {
    period: "2025 — Now",
    title: "Full-Stack Developer · National Shunt Service Ltd.",
    body: "Building and shipping full-stack features end to end — database, API and interface — for a busy logistics operation.",
  },
  {
    period: "2025",
    title: "Nickola Magnolia — Artist Website",
    body: "Designed and built the website for Nickola Magnolia, a musician based in Cobourg, Ontario.",
    link: "https://nickolamagnolia.com/",
    linkLabel: "nickolamagnolia.com",
  },
  {
    period: "2025",
    title: "Software Engineering Graduate",
    body: "Graduated from the University of Ottawa, specialising in software engineering and web development.",
  },
  {
    period: "2020",
    title: "First line of code",
    body: "Wrote my first program and immediately knew I'd tapped into something transformational.",
  },
];

const About = () => {
  const heroRef = useRef(null);
  const portraitRef = useRef(null);

  // Cursor-tracked spotlight in the hero.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const onMove = (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty(
        "--mx",
        `${((e.clientX - r.left) / r.width) * 100}%`,
      );
      hero.style.setProperty(
        "--my",
        `${((e.clientY - r.top) / r.height) * 100}%`,
      );
    };
    hero.addEventListener("pointermove", onMove);
    return () => hero.removeEventListener("pointermove", onMove);
  }, []);

  // 3D tilt on the portrait card.
  useEffect(() => {
    const card = portraitRef.current;
    if (!card) return;
    const onMove = (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty("--rx", `${(-py * 16).toFixed(2)}deg`);
      card.style.setProperty("--ry", `${(px * 16).toFixed(2)}deg`);
    };
    const reset = () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", reset);
    return () => {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", reset);
    };
  }, []);

  // Scroll-triggered reveals.
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Lenis — buttery inertial smooth scrolling that makes every scroll-linked
  // animation on the page feel intentional. Respects reduced-motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf = 0;
    const loop = (time) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  // Count-up stats.
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const nums = document.querySelectorAll("[data-count]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = Number(el.dataset.count);
          io.unobserve(el);
          if (reduce) {
            el.textContent = String(target);
            return;
          }
          const start = performance.now();
          const dur = 1400;
          const tick = (now) => {
            const t = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = String(Math.round(eased * target));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.6 },
    );
    nums.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const name = "CHARLIE";

  return (
    <div className="ab">
      <Seo
        title="About"
        path="/about"
        description="Charlie Haldane — software engineer and designer based in Peterborough, Ontario, building efficient, scalable web solutions."
      />
      {/* ---------------- SCROLL PROGRESS: TOP BAR ---------------- */}
      <div className="ab-topbar" aria-hidden="true">
        <span className="ab-topbar-fill" />
      </div>

      {/* ---------------- HERO ---------------- */}
      <section className="ab-hero" ref={heroRef}>
        <div className="ab-aurora" aria-hidden="true">
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
        </div>
        <div className="ab-spotlight" aria-hidden="true" />
        <div className="ab-grid-lines" aria-hidden="true" />

        <div className="ab-hero-inner">
          <p className="ab-eyebrow" data-reveal>
            <span className="dot" /> Designer · Maker · Problem solver
          </p>

          <h1 className="ab-name" aria-label={name}>
            {name.split("").map((ch, i) => (
              <span
                key={i}
                className="ab-letter"
                style={{ animationDelay: `${0.15 + i * 0.06}s` }}
              >
                {ch}
              </span>
            ))}
          </h1>

          <p className="ab-lead" data-reveal>
            I turn ideas into interfaces that feel <em>alive</em> — sweating the
            motion, the layout and the millisecond details most people never
            notice but everyone feels.
          </p>

          <div className="ab-cta" data-reveal>
            <Link className="ab-btn primary" to="/work">
              <span>View my work</span>
              <i className="fa-solid fa-arrow-right" />
            </Link>
            <Link
              className="ab-btn ghost"
              to="/CHARLIE_RESUME_5.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Résumé</span>
              <i className="fa-solid fa-file-arrow-down" />
            </Link>
          </div>
        </div>

        <div className="ab-portrait-wrap">
          <div className="ab-portrait" ref={portraitRef}>
            <img
              src={process.env.PUBLIC_URL + "/assets/charlie.jpg"}
              alt="Charlie Haldane"
            />
            <div className="ab-portrait-glow" aria-hidden="true" />
            <span className="ab-badge">EST. 2020</span>
          </div>
        </div>

        <div className="ab-scroll" aria-hidden="true">
          <span>SCROLL</span>
          <span className="ab-scroll-line" />
        </div>
      </section>

      {/* ---------------- MARQUEE ---------------- */}
      <div className="ab-marquee" aria-hidden="true">
        <div className="ab-marquee-track">
          {[...SKILLS, ...SKILLS].map((s, i) => (
            <span key={i} className="ab-chip">
              {s} <i className="fa-solid fa-asterisk" />
            </span>
          ))}
        </div>
      </div>

      {/* ---------------- STATS ---------------- */}
      <section className="ab-stats">
        {STATS.map((s, i) => (
          <div
            className="ab-stat"
            key={i}
            data-reveal
            style={{ transitionDelay: `${i * 0.08}s` }}
          >
            <div className="ab-stat-num">
              <span data-count={s.value}>0</span>
              {s.suffix}
            </div>
            <div className="ab-stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* ---------------- BIO ---------------- */}
      <section className="ab-bio">
        <h2 className="ab-section-title" data-reveal>
          <span className="ab-index">01</span> The short version
        </h2>
        <div className="ab-bio-grid">
          <p className="ab-bio-big" data-reveal>
            I build things for the web that are equal parts{" "}
            <span className="hl">engineering</span> and{" "}
            <span className="hl alt">craft</span>.
          </p>
          <div className="ab-bio-col" data-reveal>
            <p>
              I'm a software engineering graduate (University of Ottawa, 2025)
              now working full-stack at National Shunt Service Ltd. — building
              features from the database all the way to the interface. On the
              side I take on freelance builds, like a site for Cobourg musician
              Nickola Magnolia.
            </p>
            <p>
              What gets my gears turning is solving real problems through code:
              not functions for their own sake, but efficient, scalable
              solutions that make a tangible difference for the people using
              them.
            </p>
            <blockquote className="ab-quote">
              “There is nothing so useless as doing efficiently that which
              should not be done at all.”
              <cite>— Peter Drucker</cite>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ---------------- SKILLS ---------------- */}
      <section className="ab-skills">
        <h2 className="ab-section-title" data-reveal>
          <span className="ab-index">02</span> What I bring
        </h2>
        <motion.div
          className="ab-cards"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12 } },
          }}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
        >
          {[
            {
              icon: "fa-solid fa-code",
              title: "Front-end engineering",
              body: "React, TypeScript and a deep love for clean, maintainable component architecture.",
            },
            {
              icon: "fa-solid fa-wand-magic-sparkles",
              title: "Motion & interaction",
              body: "CSS animation, scroll choreography and micro-interactions that make products feel premium.",
            },
            {
              icon: "fa-solid fa-layer-group",
              title: "Layout & design systems",
              body: "Responsive, grid-driven layouts and reusable systems that scale across a product.",
            },
            {
              icon: "fa-solid fa-server",
              title: "Full-stack & tooling",
              body: "Node, Python, C++ and SQL databases — comfortable shipping a feature from schema to screen.",
            },
          ].map((c, i) => (
            <motion.article
              className="ab-card"
              key={i}
              variants={{
                hidden: { opacity: 0, y: 40, filter: "blur(6px)" },
                show: { opacity: 1, y: 0, filter: "blur(0px)" },
              }}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
              whileHover={{
                y: -8,
                transition: { type: "spring", stiffness: 300, damping: 18 },
              }}
            >
              <i className={c.icon} />
              <h3>{c.title}</h3>
              <p>{c.body}</p>
              <span className="ab-card-shine" aria-hidden="true" />
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* ---------------- TIMELINE ---------------- */}
      <section className="ab-timeline">
        <h2 className="ab-section-title" data-reveal>
          <span className="ab-index">03</span> The journey
        </h2>
        <div className="ab-line">
          <span className="ab-line-spine" data-reveal />
          {TIMELINE.map((t, i) => (
            <div className="ab-line-item" key={i} data-reveal>
              <span className="ab-line-dot" />
              <span className="ab-line-period">{t.period}</span>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              {t.link && (
                <a
                  className="ab-line-link"
                  href={t.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.linkLabel || "Visit site"}
                  <i className="fa-solid fa-arrow-up-right-from-square" />
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="ab-end" data-reveal>
        <h2>Let's build something that moves.</h2>
        <p>Got a project, a problem, or just a wild idea? I'm listening.</p>
        <Link className="ab-btn primary big" to="/contact">
          <span>Get in touch</span>
          <i className="fa-solid fa-arrow-right" />
        </Link>
      </section>
    </div>
  );
};

export default About;
