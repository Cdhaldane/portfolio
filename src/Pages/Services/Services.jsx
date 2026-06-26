import { Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import Seo from "../../Components/Seo/Seo";

import "./Services.css";

/**
 * Services — shares the site's design language (tokens, Space Grotesk, glass
 * surfaces, scroll reveals, pill buttons) but has its own structure so it
 * doesn't read like a clone of About:
 *  - single-column hero with a horizontal trust strip
 *  - "Who it's for" audience band
 *  - services as alternating numbered rows (not a card grid)
 *  - a horizontal numbered process (not a vertical spine)
 *  - an FAQ accordion
 *  - a full-width CTA band
 *
 * Scroll work is driven by framer-motion's useScroll bound to the page's own
 * scroll container (.sv scrolls internally, not the window).
 */

const TRUST = [
  { icon: "fa-solid fa-location-dot", label: "Peterborough-based" },
  { icon: "fa-solid fa-tag", label: "Free, no-pressure quotes" },
  { icon: "fa-solid fa-bolt", label: "Fast turnaround" },
  { icon: "fa-solid fa-headset", label: "Ongoing support" },
];

const AUDIENCES = [
  {
    icon: "fa-solid fa-store",
    title: "Local shops & trades",
    body: "Get found by nearby customers with a site that loads fast and looks the part on every phone.",
  },
  {
    icon: "fa-solid fa-rocket",
    title: "Startups & founders",
    body: "Launch quickly with a polished landing page or MVP — and iterate as you grow.",
  },
  {
    icon: "fa-solid fa-chart-line",
    title: "Growing businesses",
    body: "Modernise a dated site or add the custom features off-the-shelf tools can't handle.",
  },
];

const SERVICES = [
  {
    icon: "fa-solid fa-pen-ruler",
    title: "Website Design & Build",
    body: "A fast, modern, mobile-friendly website tailored to your business — built to turn visitors into customers.",
    points: ["Custom design", "Mobile-first", "SEO-ready", "Easy to update"],
  },
  {
    icon: "fa-solid fa-arrows-rotate",
    title: "Redesign & Refresh",
    body: "Have an old, slow or dated site? I'll modernise the look, speed it up and make it work beautifully on every device.",
    points: ["Performance", "Visual refresh", "Accessibility", "Migration"],
  },
  {
    icon: "fa-solid fa-code",
    title: "Web Apps & Custom Features",
    body: "Booking systems, dashboards, custom forms and full-stack applications built with React and Node.",
    points: ["Booking", "Dashboards", "Integrations", "Databases"],
  },
  {
    icon: "fa-solid fa-life-ring",
    title: "Care & Maintenance",
    body: "Keep your site fast, secure and up to date so you can focus on running your business.",
    points: ["Updates", "Backups", "Monitoring", "Support"],
  },
];

const PROCESS = [
  { title: "Chat", body: "We talk through your goals and what success looks like — no jargon, no pressure." },
  { title: "Design", body: "I map out the structure and design, sharing previews early so you're never surprised." },
  { title: "Build", body: "I build it properly — fast, responsive and accessible — keeping you in the loop." },
  { title: "Launch", body: "We go live, and I make sure you can manage it. Support continues after launch." },
];

const FAQ = [
  {
    q: "How much does a website cost?",
    a: "It depends on scope — a simple brochure site is very different from a custom web app. Tell me what you have in mind and I'll send a clear, itemised quote for free.",
  },
  {
    q: "How long does it take?",
    a: "Most small business sites take 2–4 weeks from kickoff to launch, depending on how quickly content and feedback come together. Larger builds take longer; I'll give you a realistic timeline up front.",
  },
  {
    q: "Do you only work with Peterborough businesses?",
    a: "I'm based in Peterborough and love working with local businesses, but I work with clients across Ontario and remotely too.",
  },
  {
    q: "Can I update the site myself afterwards?",
    a: "Yes. I build with easy editing in mind and walk you through managing your content. Prefer to hand it off entirely? My care plan covers ongoing updates.",
  },
  {
    q: "What do you need from me to start?",
    a: "Just an idea of your goals, any branding or content you already have, and examples of sites you like. We figure out the rest together in the first chat.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "Charlie took our vague idea and turned it into a site that actually brings in customers. Fast, communicative, and genuinely cared about getting it right.",
    name: "Client Name",
    role: "Owner, Local Business",
  },
  {
    quote:
      "The whole process was painless. He handled the design, the build and the launch, and explained everything in plain language.",
    name: "Client Name",
    role: "Founder, Startup",
  },
  {
    quote:
      "Our old website was slow and dated. The redesign loads instantly and looks fantastic on phones.",
    name: "Client Name",
    role: "Manager, Service Co.",
  },
];

// Shared entrance variants for scroll-into-view sections.
const fadeUp = {
  hidden: { opacity: 0, y: 36, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

const Services = () => {
  const rootRef = useRef(null);
  const heroRef = useRef(null);
  const processRef = useRef(null);
  const ctaRef = useRef(null);
  const reduce = useReducedMotion();

  // Page scroll progress (window scroll — matches the global rail).
  const { scrollYProgress } = useScroll();

  // Hero parallax + fade as it scrolls away.
  const { scrollYProgress: heroP } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(heroP, [0, 1], [0, -90]);
  const heroOpacity = useTransform(heroP, [0, 0.85], [1, 0]);
  const heroScale = useTransform(heroP, [0, 1], [1, 0.96]);
  const auroraY = useTransform(heroP, [0, 1], [0, 160]);

  // Process connector line fills as the section scrolls through.
  const { scrollYProgress: procP } = useScroll({
    target: processRef,
    offset: ["start 80%", "end 55%"],
  });

  // CTA aurora drifts on scroll.
  const { scrollYProgress: ctaP } = useScroll({
    target: ctaRef,
    offset: ["start end", "end start"],
  });
  const ctaAuroraY = useTransform(ctaP, [0, 1], [-50, 50]);

  // Fallback CSS reveal for anything not wired to framer-motion.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll("[data-reveal]") || [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const viewport = { once: true, amount: 0.25 };

  return (
    <div className="sv" ref={rootRef}>
      <Seo
        title="Web Design & Development Services in Peterborough"
        path="/services"
        description="Web design, redesigns and custom web apps for businesses in Peterborough, Ontario. Fast, modern, mobile-friendly websites. Get a free quote."
      />

      {/* scroll progress bar */}
      <motion.div
        className="sv-progress"
        style={{ scaleX: reduce ? 1 : scrollYProgress }}
        aria-hidden="true"
      />

      {/* ---------------- HERO ---------------- */}
      <section className="sv-hero" ref={heroRef}>
        <motion.div
          className="sv-aurora"
          aria-hidden="true"
          style={reduce ? undefined : { y: auroraY }}
        >
          <span className="blob b1" />
          <span className="blob b2" />
        </motion.div>

        <motion.div
          className="sv-hero-inner"
          style={reduce ? undefined : { y: heroY, opacity: heroOpacity, scale: heroScale }}
        >
          <motion.p
            className="sv-eyebrow"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="dot" /> Web design & development · Peterborough, ON
          </motion.p>

          <motion.h1
            className="sv-headline"
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Websites that work as hard as <span className="hl">you do.</span>
          </motion.h1>

          <motion.p
            className="sv-lead"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
          >
            I help businesses in Peterborough and across Ontario get online with
            fast, well-designed websites and web apps — <em>built properly</em>,
            and built to bring in customers.
          </motion.p>

          <motion.div
            className="sv-cta"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
          >
            <Link className="sv-btn primary" to="/contact">
              <span>Get a free quote</span>
              <i className="fa-solid fa-arrow-right" />
            </Link>
            <Link className="sv-btn ghost" to="/work">
              <span>See my work</span>
              <i className="fa-solid fa-arrow-up-right-from-square" />
            </Link>
          </motion.div>

          <motion.ul
            className="sv-trust"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.7 } } }}
          >
            {TRUST.map((t) => (
              <motion.li
                key={t.label}
                variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
              >
                <i className={t.icon} /> {t.label}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <div className="sv-scrollcue" aria-hidden="true">
          <span>SCROLL</span>
          <span className="sv-scrollcue-line" />
        </div>
      </section>

      {/* ---------------- WHO IT'S FOR ---------------- */}
      <section className="sv-who">
        <motion.p
          className="sv-kicker"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5 }}
        >
          Who it's for
        </motion.p>
        <motion.div
          className="sv-who-grid"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          {AUDIENCES.map((a) => (
            <motion.div
              className="sv-who-card"
              key={a.title}
              variants={fadeUp}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
              whileHover={{ y: -6, transition: { type: "spring", stiffness: 300, damping: 18 } }}
            >
              <i className={a.icon} />
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ---------------- SERVICES (numbered rows) ---------------- */}
      <section className="sv-services">
        <h2 className="sv-section-title" data-reveal>
          <span className="sv-index">01</span> What I do
        </h2>
        <div className="sv-rows">
          {SERVICES.map((s, i) => (
            <motion.article
              className="sv-row"
              key={s.title}
              initial={{ opacity: 0, y: 44 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewport}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
            >
              <span className="sv-row-num">0{i + 1}</span>
              <div className="sv-row-main">
                <div className="sv-row-head">
                  <i className={s.icon} />
                  <h3>{s.title}</h3>
                </div>
                <p>{s.body}</p>
                <ul className="sv-row-chips">
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <Link className="sv-row-cta" to="/contact" aria-label={`Get a quote for ${s.title}`}>
                Get a quote <i className="fa-solid fa-arrow-right" />
              </Link>
            </motion.article>
          ))}
        </div>
      </section>

      {/* ---------------- PROCESS (horizontal steps) ---------------- */}
      <section className="sv-process" ref={processRef}>
        <h2 className="sv-section-title" data-reveal>
          <span className="sv-index">02</span> How it works
        </h2>
        <div className="sv-steps-bar" aria-hidden="true">
          <motion.span
            className="sv-steps-fill"
            style={{ scaleX: reduce ? 1 : procP }}
          />
        </div>
        <motion.div
          className="sv-steps"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          {PROCESS.map((p, i) => (
            <motion.div className="sv-step" key={p.title} variants={fadeUp}>
              <span className="sv-step-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section className="sv-faq">
        <h2 className="sv-section-title" data-reveal>
          <span className="sv-index">03</span> Common questions
        </h2>
        <motion.div
          className="sv-faq-list"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          {FAQ.map((f, i) => (
            <motion.details
              className="sv-faq-item"
              key={i}
              variants={fadeUp}
            >
              <summary>
                <span>{f.q}</span>
                <i className="fa-solid fa-plus" aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </motion.details>
          ))}
        </motion.div>
      </section>

      {/* ---------------- TESTIMONIALS ---------------- */}
      <section className="sv-testimonials">
        <motion.p
          className="sv-kicker"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewport}
          transition={{ duration: 0.5 }}
        >
          What clients say
        </motion.p>
        <motion.div
          className="sv-quotes"
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={viewport}
        >
          {TESTIMONIALS.map((t, i) => (
            <motion.figure
              className={`sv-quote${i === 0 ? " featured" : ""}`}
              key={i}
              variants={fadeUp}
              transition={{ type: "spring", stiffness: 90, damping: 16 }}
              whileHover={{ y: -6, transition: { type: "spring", stiffness: 300, damping: 18 } }}
            >
              <i className="fa-solid fa-quote-left" aria-hidden="true" />
              <blockquote>{t.quote}</blockquote>
              <figcaption>
                <span className="sv-quote-name">{t.name}</span>
                <span className="sv-quote-role">{t.role}</span>
              </figcaption>
            </motion.figure>
          ))}
        </motion.div>
      </section>

      {/* ---------------- CTA BAND ---------------- */}
      <section className="sv-cta-band" ref={ctaRef} data-reveal>
        <motion.div
          className="sv-cta-aurora"
          aria-hidden="true"
          style={reduce ? undefined : { y: ctaAuroraY }}
        >
          <span className="blob b1" />
          <span className="blob b2" />
        </motion.div>
        <div className="sv-cta-inner">
          <h2>Let's build something that works.</h2>
          <p>
            Tell me about your project and I'll get back to you with a free,
            no-obligation quote.
          </p>
          <Link className="sv-btn light big" to="/contact">
            <span>Get in touch</span>
            <i className="fa-solid fa-arrow-right" />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Services;
