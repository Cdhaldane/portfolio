import { Fragment, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Sheet } from "./sheets";
import { credit, linkMentions, paragraphs } from "./lessonUtil";

/*
 * People and places in a lesson's prose, linked to Wikipedia's own summary of
 * them. The summaries are fetched once when a lesson goes live (the pipeline's
 * resolveMentions) and travel with the lesson, so a tap opens instantly and
 * works offline. Only a draft previewed on the desk asks Wikipedia live.
 *
 * Each name is a real link to its article: a plain tap opens the sheet, a
 * modified click (new tab, etc.) still goes to Wikipedia.
 */

/** { matcher, open } for the lesson on screen; null outside a lesson. */
export const MentionContext = createContext(null);

const KIND = { person: "Person", place: "Place" };
const TEXT_LICENCE = "https://creativecommons.org/licenses/by-sa/4.0/";

const articleUrl = (m) => m.url || `https://en.wikipedia.org/wiki/${encodeURIComponent((m.title || m.wiki).replace(/ /g, "_"))}`;

/** Text with its first mention of each person or place turned into a link. */
export function linked(text, ctx, seen = new Set()) {
  if (!ctx || !ctx.matcher) return text;
  return linkMentions(text, ctx.matcher, seen).map((part, i) => {
    if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>;
    const { mention } = part;
    return (
      <a
        key={i}
        className="ac-ment"
        href={articleUrl(mention)}
        target="_blank"
        rel="noreferrer"
        aria-haspopup="dialog"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          ctx.open({ mention, name: part.text });
        }}
      >
        {part.text}
      </a>
    );
  });
}

/** `linked` bound to the lesson in context. */
export function useLinker() {
  const ctx = useContext(MentionContext);
  return useCallback((text, seen) => linked(text, ctx, seen), [ctx]);
}

/** A draft's mentions aren't resolved yet: ask Wikipedia for the summary. */
function useLiveSummary(mention) {
  const [state, setState] = useState({ status: mention.extract ? "done" : "loading", data: mention.extract ? mention : null });
  useEffect(() => {
    if (mention.extract) return undefined;
    const ctrl = new AbortController();
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(mention.wiki.replace(/ /g, "_"))}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (d.type !== "standard") throw new Error(d.type);
        const url = d.content_urls && d.content_urls.desktop ? d.content_urls.desktop.page : null;
        setState({ status: "done", data: { ...mention, title: d.title, description: d.description, extract: d.extract, url } });
      })
      .catch((e) => {
        if (e.name !== "AbortError") setState({ status: e.message === "disambiguation" ? "ambiguous" : "error", data: null });
      });
    return () => ctrl.abort();
  }, [mention]);
  return state;
}

function Portrait({ image, alt }) {
  const [state, setState] = useState("loading");
  if (!image || !image.url || state === "error") return null;
  return (
    <figure className={`ac-ment-fig${state === "loaded" ? " is-loaded" : ""}`}>
      <img src={image.url} alt={alt} decoding="async" width={image.width || undefined} height={image.height || undefined} onLoad={() => setState("loaded")} onError={() => setState("error")} />
    </figure>
  );
}

export function MentionSheet({ mention, name, onClose }) {
  const { status, data } = useLiveSummary(mention);
  const m = data || mention;
  const title = m.title || mention.wiki;
  // "Hellespont" opens Dardanelles: say how the lesson knew it.
  const aka = name && !title.toLowerCase().includes(name.toLowerCase()) ? name : null;
  return (
    <Sheet title={KIND[mention.kind] ? `${KIND[mention.kind]} · Wikipedia` : "Wikipedia"} onClose={onClose}>
      <div className="ac-ment-card">
        <div className="ac-ment-head">
          <Portrait image={m.image} alt={title} />
          <div>
            <h2 className="ac-title ac-ment-title">{title}</h2>
            {m.description ? <p className="ac-ment-desc">{m.description}</p> : null}
            {aka ? <p className="ac-ment-aka">“{aka}” in the lesson</p> : null}
          </div>
        </div>
        {status === "loading" ? <p className="ac-ment-desc">Asking Wikipedia…</p> : null}
        {status === "ambiguous" ? <p className="ac-error">“{mention.wiki}” is a disambiguation page. Pick the specific article.</p> : null}
        {status === "error" ? <p className="ac-error">Couldn't reach Wikipedia for “{mention.wiki}”.</p> : null}
        {data
          ? paragraphs(data.extract).map((p, i) => (
              <p key={i} className="ac-body">
                {p}
              </p>
            ))
          : null}
        <div className="ac-btns">
          <a className="ac-btn" href={articleUrl(m)} target="_blank" rel="noreferrer">
            Read on Wikipedia ↗
          </a>
        </div>
        <p className="ac-credit">
          Text: Wikipedia,{" "}
          <a href={TEXT_LICENCE} target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
          {m.image && m.image.url ? (
            <>
              <br />
              Image:{" "}
              <a href={m.image.descUrl} target="_blank" rel="noreferrer">
                {credit(m.image)}
              </a>
              , via Wikimedia Commons
            </>
          ) : null}
        </p>
      </div>
    </Sheet>
  );
}
