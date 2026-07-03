import { Link } from "react-router-dom";
import Reveal from "../../Components/Reveal/Reveal";
import Seo from "../../Components/Seo/Seo";
import "./NotFound.css";

/*
 * 404 — a full-page, on-brand dead end. Editorial paper/ink treatment with the
 * signature gradient standing in for the "0". Uses the shared <Reveal> for a
 * staggered entrance.
 */
const NotFound = () => (
  <main className="nf">
    <Seo title="404 — Page not found" path="/404" />
    <div className="nf-aurora" aria-hidden="true" />

    <div className="nf-inner">
      <Reveal className="nf-code">
        <span className="nf-digit">4</span>
        <span className="nf-orb" aria-hidden="true">
          <span className="nf-orb-ring" />
        </span>
        <span className="nf-digit">4</span>
      </Reveal>

      <Reveal as="p" className="nf-kicker" delay={80}>
        ERR · ROUTE_NOT_FOUND
      </Reveal>
      <Reveal as="h1" className="nf-title" delay={140}>
        This page took a wrong turn.
      </Reveal>
      <Reveal as="p" className="nf-sub" delay={200}>
        The link is broken, moved, or never existed. No hard feelings — let's get
        you back on the map.
      </Reveal>

      <Reveal as="nav" className="nf-actions" delay={280} aria-label="Recovery links">
        <Link to="/" className="nf-btn nf-btn--primary">
          Back home
        </Link>
        <Link to="/work" className="nf-btn">
          See the work
        </Link>
        <Link to="/contact" className="nf-btn nf-btn--ghost">
          Get in touch
        </Link>
      </Reveal>
    </div>

    <span className="nf-foot">charliehaldane.ca · 404</span>
  </main>
);

export default NotFound;
