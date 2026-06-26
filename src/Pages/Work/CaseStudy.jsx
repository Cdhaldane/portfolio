import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Seo from "../../Components/Seo/Seo";

import "./CaseStudy.css";

/**
 * CaseStudy — one reusable project detail template shared by every Work page.
 * Each project passes a data object; per-project accent theming is driven by
 * the `--proj` custom property. Image sources may contain a `{theme}` token
 * (e.g. "/assets/timeslot/header-{theme}.png") which resolves to the active
 * light/dark theme.
 */

// Canonical project order — drives the "next project" link at the foot.
const ORDER = [
  { slug: "edusim", name: "EduSim" },
  { slug: "marz", name: "Marz" },
  { slug: "timeslot", name: "Timeslot" },
  { slug: "vxnessa", name: "Vxnessa" },
];

// Track the global light/dark theme so themed image variants stay in sync.
const useTheme = () => {
  const read = () =>
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
};

const reveal = {
  initial: { opacity: 0, y: 40 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { type: "spring", stiffness: 80, damping: 18 },
};

const CaseStudy = ({
  slug,
  name,
  client,
  accent,
  summary,
  role,
  focus,
  year,
  url,
  cover,
  coverAlt,
  sections = [],
}) => {
  const theme = useTheme();
  const resolve = (src) => src.replace("{theme}", theme);

  const idx = ORDER.findIndex((p) => p.slug === slug);
  const next = ORDER[(idx + 1) % ORDER.length];

  return (
    <div className="cs" style={{ "--proj": accent }}>
      <Seo
        title={name}
        path={`/work/${slug}`}
        description={summary}
      />

      <Link className="cs-back" to="/work">
        <i className="fa-solid fa-arrow-left" /> All work
      </Link>

      {/* ---------------- HERO ---------------- */}
      <header className="cs-hero">
        <div className="cs-hero-glow" aria-hidden="true" />
        <motion.p
          className="cs-eyebrow"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="dot" /> {client}
        </motion.p>

        <h1 className="cs-title" aria-label={name}>
          {name.split("").map((ch, i) => (
            <span
              className="cs-letter"
              key={i}
              style={{ animationDelay: `${0.12 + i * 0.06}s` }}
            >
              {ch}
            </span>
          ))}
        </h1>

        <motion.p
          className="cs-summary"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          {summary}
        </motion.p>

        <motion.dl
          className="cs-meta"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.45 } } }}
        >
          {[
            { k: "Role", v: role },
            { k: "Focus", v: focus },
            { k: "Year", v: year },
          ].map((m) => (
            <motion.div
              key={m.k}
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
            >
              <dt>{m.k}</dt>
              <dd>{m.v}</dd>
            </motion.div>
          ))}
        </motion.dl>

        {url && (
          <motion.a
            className="cs-visit"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
          >
            <span>Visit live site</span>
            <i className="fa-solid fa-arrow-up-right-from-square" />
          </motion.a>
        )}
      </header>

      {/* ---------------- COVER ---------------- */}
      {cover && (
        <motion.figure className="cs-cover" {...reveal}>
          <img src={resolve(cover)} alt={coverAlt || `${name} cover`} loading="lazy" />
        </motion.figure>
      )}

      {/* ---------------- BODY ---------------- */}
      <div className="cs-body">
        {sections.map((s, i) => {
          if (s.type === "text") {
            const paras = Array.isArray(s.body) ? s.body : [s.body];
            return (
              <motion.div className="cs-text" key={i} {...reveal}>
                {paras.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </motion.div>
            );
          }
          if (s.type === "image") {
            return (
              <motion.figure className="cs-shot" key={i} {...reveal}>
                <img src={resolve(s.src)} alt={s.alt} loading="lazy" />
              </motion.figure>
            );
          }
          if (s.type === "gallery") {
            return (
              <motion.div className="cs-gallery" key={i} {...reveal}>
                {s.images.map((img, j) => (
                  <img key={j} src={resolve(img.src)} alt={img.alt} loading="lazy" />
                ))}
              </motion.div>
            );
          }
          return null;
        })}
      </div>

      {/* ---------------- NEXT PROJECT ---------------- */}
      <Link className="cs-next" to={`/work/${next.slug}`}>
        <span className="cs-next-label">Next project</span>
        <span className="cs-next-name">{next.name}</span>
        <i className="fa-solid fa-arrow-right" />
      </Link>
    </div>
  );
};

export default CaseStudy;
