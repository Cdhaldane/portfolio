import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { KIND_LABEL, credit, mentionMatcher, paragraphs } from "./lessonUtil";
import { MentionSheet, linked } from "./mentions";
import { markDone } from "./store";

/*
 * The same lesson as one scrolling article, for reading at a desk. Chapter
 * labels become headings, questions become fold-outs, and the debate sits
 * side by side. Reaching the end counts as finishing the lesson.
 */

function Figure({ image }) {
  if (!image || !image.url) return null;
  return (
    <figure className="ac-flat-fig">
      <img src={image.url} alt={image.alt || ""} loading="lazy" decoding="async" width={image.width || undefined} height={image.height || undefined} />
      <figcaption>{credit(image)}</figcaption>
    </figure>
  );
}

export default function Flat({ lesson, back }) {
  const [open, setOpen] = useState(null);
  const mentions = useMemo(() => ({ matcher: mentionMatcher(lesson.mentions), open: setOpen }), [lesson.mentions]);
  useEffect(() => {
    const end = document.getElementById("ac-flat-end");
    if (!end || !("IntersectionObserver" in window)) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        markDone(lesson);
        io.disconnect();
      }
    });
    io.observe(end);
    return () => io.disconnect();
  }, [lesson]);

  let chapter = null;
  // Each person or place links the first time a section names it.
  const link = (text, seen) => linked(text, mentions, seen);
  return (
    <article className="ac-flat">
      <Helmet>
        <title>{`Acta Diurna · ${lesson.title}`}</title>
      </Helmet>
      <nav className="ac-flat-nav">
        <Link to={back}>← Back to cards</Link>
        <Link to="/acta/archive">Archive</Link>
      </nav>
      <header className="ac-flat-head">
        <p className="ac-label">
          {lesson.day ? `Day ${lesson.day} · ` : ""}
          {KIND_LABEL[lesson.kind]}
          {lesson.minutes ? ` · ${lesson.minutes} min` : ""}
        </p>
        <h1 className="ac-title ac-title--open">{lesson.title}</h1>
        <p className="ac-date">{lesson.subtitle}</p>
      </header>
      {lesson.cards.map((c, i) => {
        const heading = c.chapter && c.label !== chapter ? c.label : null;
        if (heading) chapter = c.label;
        const key = `${i}-${c.type}`;
        const seen = new Set();
        switch (c.type) {
          case "open":
          case "where":
          case "story":
          case "aside":
          case "ripple":
            return (
              <Fragment key={key}>
                {heading ? <h2 className="ac-flat-ch">{heading}</h2> : null}
                {c.type === "where" ? <h2 className="ac-flat-ch">Where and when</h2> : null}
                {c.type === "ripple" && lesson.cards[i - 1] && lesson.cards[i - 1].type !== "ripple" ? <h2 className="ac-flat-ch">Ripples</h2> : null}
                <section className={`ac-flat-sec${c.type === "aside" ? " is-aside" : ""}`} id={`card-${i}`}>
                  <Figure image={c.image} />
                  {c.type !== "open" && c.title ? <h3>{c.title}</h3> : null}
                  {c.type === "aside" && c.label ? <p className="ac-label">{c.label}</p> : null}
                  {paragraphs(c.text).map((p, k) => (
                    <p key={k} className="ac-body">
                      {link(p, seen)}
                    </p>
                  ))}
                </section>
              </Fragment>
            );
          case "quote":
            return (
              <section className="ac-flat-sec" key={key} id={`card-${i}`}>
                <Figure image={c.image} />
                <blockquote className="ac-quote">
                  <p>{c.quote && c.quote.text}</p>
                </blockquote>
                <p className="ac-cite">
                  {c.quote && c.quote.attribution}
                  {c.quote && c.quote.translator ? ` · trans. ${c.quote.translator}` : ""}
                </p>
                {c.text ? <p className="ac-note">{link(c.text, seen)}</p> : null}
              </section>
            );
          case "numbers":
            return (
              <section className="ac-flat-sec" key={key} id={`card-${i}`}>
                <h3>{c.title}</h3>
                <dl className="ac-nums">
                  {(c.rows || []).map((r, k) => (
                    <div key={k}>
                      <dt>{r.value}</dt>
                      <dd>{r.label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          case "disagree":
            return (
              <section className="ac-flat-sec" key={key} id={`card-${i}`}>
                <h2 className="ac-flat-ch">Historians disagree</h2>
                <h3>{c.title}</h3>
                <div className="ac-sides ac-sides--wide">
                  {(c.sides || []).map((s, k) => (
                    <section key={k} className="ac-side">
                      <h3>{s.label}</h3>
                      <p>{link(s.text, seen)}</p>
                    </section>
                  ))}
                </div>
              </section>
            );
          case "recall":
            return (
              <details className="ac-flat-q" key={key} id={`card-${i}`}>
                <summary>
                  <span className="ac-label">Check yourself</span>
                  {c.q}
                </summary>
                <p className="ac-body">{c.a}</p>
              </details>
            );
          default:
            return null;
        }
      })}
      <section className="ac-flat-sec ac-flat-end" id="ac-flat-end">
        <h2 className="ac-flat-ch">Remember</h2>
        <ol className="ac-takeaways">
          {(lesson.takeaways || []).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
        <h3>Sources</h3>
        <ul className="ac-flat-sources">
          {(lesson.sources || []).map((s) => (
            <li key={s.id}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </li>
          ))}
        </ul>
      </section>
      {open ? <MentionSheet key={open.mention.wiki} mention={open.mention} name={open.name} onClose={() => setOpen(null)} /> : null}
    </article>
  );
}
