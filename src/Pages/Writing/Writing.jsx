import { Link } from "react-router-dom";
import Reveal from "../../Components/Reveal/Reveal";
import ScrollProgress from "../../Components/ScrollProgress/ScrollProgress";
import Seo from "../../Components/Seo/Seo";
import { POSTS } from "./posts";
import "./Writing.css";

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "";
  }
};

const Writing = () => (
  <main className="wr">
    <Seo
      title="Writing"
      path="/writing"
      description="Notes and build logs on design, React, and the small obsessions behind the work — by Charlie Haldane."
    />
    <ScrollProgress />

    <div className="wr-inner">
      <Reveal as="header" className="wr-head">
        <span className="wr-kicker">/ Writing</span>
        <h1 className="wr-title">Notes &amp; build logs.</h1>
        <p className="wr-sub">
          Occasional writing on design, React, and the small obsessions behind
          the work.
        </p>
      </Reveal>

      <div className="wr-list">
        {POSTS.map((p, i) => (
          <Reveal
            as={Link}
            to={`/writing/${p.slug}`}
            className="wr-card"
            key={p.slug}
            delay={i * 60}
          >
            <div className="wr-card-meta">
              <span className="wr-date">{fmtDate(p.date)}</span>
              <span className="wr-dot" aria-hidden="true">·</span>
              <span className="wr-read">{p.readMinutes} min read</span>
            </div>
            <h2 className="wr-card-title">{p.title}</h2>
            <p className="wr-card-excerpt">{p.excerpt}</p>
            <div className="wr-tags">
              {p.tags.map((t) => (
                <span className="wr-tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </main>
);

export default Writing;
