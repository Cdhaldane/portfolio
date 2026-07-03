import { Link, useParams } from "react-router-dom";
import Reveal from "../../Components/Reveal/Reveal";
import ScrollProgress from "../../Components/ScrollProgress/ScrollProgress";
import Seo from "../../Components/Seo/Seo";
import { getPost } from "./posts";
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

const Post = () => {
  const { slug } = useParams();
  const post = getPost(slug);

  if (!post) {
    return (
      <main className="wr">
        <div className="wr-inner">
          <p className="wr-missing">
            That note doesn't exist. <Link to="/writing">Back to writing →</Link>
          </p>
        </div>
      </main>
    );
  }

  const { Body } = post;

  return (
    <main className="wr wr--post">
      <Seo title={post.title} path={`/writing/${post.slug}`} description={post.excerpt} />
      <ScrollProgress />

      <article className="wr-inner wr-article">
        <Reveal>
          <Link to="/writing" className="wr-back">
            ← Writing
          </Link>
          <div className="wr-card-meta">
            <span className="wr-date">{fmtDate(post.date)}</span>
            <span className="wr-dot" aria-hidden="true">·</span>
            <span className="wr-read">{post.readMinutes} min read</span>
          </div>
          <h1 className="wr-post-title">{post.title}</h1>
          <div className="wr-tags">
            {post.tags.map((t) => (
              <span className="wr-tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </Reveal>

        <Reveal className="wr-prose" delay={100}>
          <Body />
        </Reveal>

        <Reveal className="wr-post-foot" delay={160}>
          <Link to="/writing" className="wr-back">
            ← All writing
          </Link>
        </Reveal>
      </article>
    </main>
  );
};

export default Post;
