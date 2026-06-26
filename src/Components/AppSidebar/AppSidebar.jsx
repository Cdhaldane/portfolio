import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";

import "./AppSidebar.css";

const SOCIAL_LINKS = [
  { label: "GH", href: "https://github.com/Cdhaldane" },
  { label: "LI", href: "https://www.linkedin.com/in/charliehaldaneuottawa/" },
  { label: "IG", href: "https://www.instagram.com/charliedhaldane/" },
];

// Routes that render their own navigation instead of the shared rail.
// The dashboard ("/dashboard*") is a self-contained cyberpunk surface.
const HIDE_SIDEBAR_PREFIXES = ["/dashboard"];

/**
 * AppSidebar — the reusable left rail shared across the site.
 *
 * Mirrors the About page rail: a HOME link, a scroll-progress spine with a
 * travelling thumb, a circular progress ring, social links and the copyright.
 * Scroll progress is written once to `--progress` on <html> so the spine, ring
 * and any page-level progress bars all read the same value.
 */
const AppSidebar = () => {
  const location = useLocation();

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max =
        (doc.scrollHeight || document.body.scrollHeight) - window.innerHeight;
      const p = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
      doc.style.setProperty("--progress", p.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [location.pathname]);

  if (HIDE_SIDEBAR_PREFIXES.some((p) => location.pathname.startsWith(p)))
    return null;

  const isHome = location.pathname === "/";

  return (
    <aside className="ab-rail" aria-label="Navigation and scroll progress">
      {isHome ? (
        <span className="ab-rail-mark" aria-hidden="true">
          CH
        </span>
      ) : (
        <Link className="ab-rail-home" to="/">
          <i className="fa-solid fa-arrow-left" />
          <span>HOME</span>
        </Link>
      )}

      <div className="ab-rail-progress" aria-hidden="true">
        <span className="ab-rail-track" />
        <span className="ab-rail-fill" />
        <span className="ab-rail-thumb" />
      </div>

      <div className="ab-rail-foot">
        <div className="ab-ring" aria-hidden="true">
          <span className="ab-ring-hole" />
        </div>

        <nav className="ab-rail-social">
          {SOCIAL_LINKS.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.label}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <span className="ab-rail-copy">©/2026</span>
      </div>
    </aside>
  );
};

export default AppSidebar;
