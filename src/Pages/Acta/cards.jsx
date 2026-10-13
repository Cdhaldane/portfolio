import { useState } from "react";
import { Link } from "react-router-dom";
import { KIND_LABEL, credit, formatYear, layoutPins, paragraphs } from "./lessonUtil";
import { useLinker } from "./mentions";
import { grade, localISO, nextDue, useActa, vote, whenLabel, dueItems } from "./store";

/*
 * One component per card type. Every card is one screen: an optional figure
 * that bleeds to the edges, then a text block. Cards never scroll inside
 * themselves at normal sizes; the text block is a scroll container only as a
 * safety net for the largest text size.
 */

function Figure({ image, eager }) {
  if (!image || !image.url) return null;
  return (
    <figure className="ac-fig">
      <img
        src={image.url}
        alt={image.alt || ""}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={image.focus ? { objectPosition: image.focus } : undefined}
        width={image.width || undefined}
        height={image.height || undefined}
      />
    </figure>
  );
}

function Credit({ image, children }) {
  const line = credit(image);
  if (!line && !children) return null;
  return (
    <p className="ac-credit">
      {children}
      {children && line ? <br /> : null}
      {line ? <span>Image: {line}</span> : null}
    </p>
  );
}

/** A card's paragraphs, with the people and places it names linked once each. */
function Paras({ text, className = "ac-body" }) {
  const link = useLinker();
  const seen = new Set();
  return paragraphs(text).map((p, i) => (
    <p key={i} className={className}>
      {link(p, seen)}
    </p>
  ));
}

function Pins({ pins, year }) {
  const { pins: laid } = layoutPins(pins);
  if (!laid.length) return null;
  return (
    <div className="ac-pins" role="img" aria-label={`Timeline: ${laid.map((p) => `${formatYear(p.year)} ${p.label}`).join(", ")}`}>
      <div className="ac-pins-line" />
      {laid.map((p) => (
        <span key={`${p.year}-${p.label}`} className={`ac-pin${p.year === year ? " is-here" : ""}`} style={{ "--x": `${p.x}%`, "--row": p.row }}>
          <i />
          <b>{formatYear(p.year)}</b>
          <em>{p.label}</em>
        </span>
      ))}
    </div>
  );
}

const Label = ({ children, flagged }) =>
  children || flagged ? (
    <div className="ac-label">
      {children}
      {flagged ? <span className="ac-chip">Under review</span> : null}
    </div>
  ) : null;

export function TextCard({ card, lesson, index, flagged }) {
  return (
    <>
      <Figure image={card.image} eager={index < 2} />
      <div className="ac-text">
        <Label flagged={flagged}>{card.label}</Label>
        <h2 className="ac-title">{card.title}</h2>
        <Paras text={card.text} />
        {card.type === "where" && card.pins ? <Pins pins={card.pins} year={lesson.year} /> : null}
        <Credit image={card.image} />
      </div>
    </>
  );
}

export function OpenCard({ card, lesson, mode, flagged }) {
  return (
    <>
      {card.image && card.image.url ? (
        <div className="ac-bleed">
          <img src={card.image.url} alt={card.image.alt || ""} loading="eager" decoding="async" style={card.image.focus ? { objectPosition: card.image.focus } : undefined} />
        </div>
      ) : null}
      <div className="ac-text ac-text--open">
        {mode === "sample" ? <p className="ac-sample">Sample lesson. Daily lessons appear here once they start.</p> : null}
        <Label flagged={flagged}>
          {lesson.day ? `Day ${lesson.day} · ` : ""}
          {KIND_LABEL[lesson.kind] || card.label}
        </Label>
        <h1 className="ac-title ac-title--open">{lesson.title}</h1>
        {lesson.subtitle ? <p className="ac-date">{lesson.subtitle}</p> : null}
        <Paras text={card.text} />
        <div className="ac-meta">
          <span>{lesson.minutes ? `${lesson.minutes} min` : ""}</span>
          <span>{lesson.cards.length + 1} cards</span>
          <span className="ac-swipe" aria-hidden="true">
            <svg width="10" height="12" viewBox="0 0 10 12">
              <path d="M5 11V1M1 5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            Swipe up
          </span>
        </div>
        <Credit image={card.image} />
      </div>
    </>
  );
}

export function QuoteCard({ card, index, flagged }) {
  const q = card.quote || {};
  const link = useLinker();
  return (
    <>
      <Figure image={card.image} eager={index < 2} />
      <div className="ac-text">
        <Label flagged={flagged}>{card.label || "Primary source"}</Label>
        {card.text && !card.image ? <p className="ac-note">{link(card.text)}</p> : null}
        <blockquote className="ac-quote">
          <p>{q.text}</p>
        </blockquote>
        <p className="ac-cite">
          {q.attribution}
          {q.translator ? <span> · trans. {q.translator}</span> : null}
        </p>
        {card.text && card.image ? <p className="ac-note">{link(card.text)}</p> : null}
        <Credit image={card.image} />
      </div>
    </>
  );
}

export function NumbersCard({ card, flagged }) {
  return (
    <div className="ac-text">
      <Label flagged={flagged}>{card.label || "By the numbers"}</Label>
      <h2 className="ac-title">{card.title}</h2>
      <dl className="ac-nums">
        {(card.rows || []).map((r, i) => (
          <div key={i}>
            <dt>{r.value}</dt>
            <dd>{r.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DisagreeCard({ card, lesson, flagged, preview }) {
  const voted = useActa((s) => s.votes[lesson.slug]);
  const side = voted ? voted.side : null;
  const link = useLinker();
  const seen = new Set();
  return (
    <div className="ac-text">
      <Label flagged={flagged}>{card.label || "Historians disagree"}</Label>
      <h2 className="ac-title">{card.title}</h2>
      <div className="ac-sides">
        {(card.sides || []).map((s, i) => (
          <section key={i} className={`ac-side${side === i ? " is-picked" : ""}`}>
            <h3>{s.label}</h3>
            <p>{link(s.text, seen)}</p>
          </section>
        ))}
      </div>
      <div className="ac-btns" role="group" aria-label="Pick a side">
        {(card.sides || []).map((s, i) => (
          <button key={i} type="button" className={`ac-btn${side === i ? " is-solid" : ""}`} aria-pressed={side === i} disabled={preview} onClick={() => vote(lesson, card, i)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="ac-result" aria-live="polite">
        {side === null ? "Pick a side. Sunday's review asks you to argue it." : `Noted. On Sunday you'll make the case in two sentences.`}
      </p>
    </div>
  );
}

export function RecallCard({ card, lesson, flagged, preview }) {
  const [shown, setShown] = useState(false);
  const item = useActa((s) => (card.id ? s.deck[card.id] : null));
  const [result, setResult] = useState(null);
  const today = localISO();
  const gradeIt = (got) => {
    if (preview) return setResult(got ? "Preview: this would move it along." : "Preview: this would bring it back tomorrow.");
    const g = grade(card, lesson, got, today);
    setResult(got ? `Good. Next time you see it: ${whenLabel(g.due, today)}.` : "No problem. It comes back tomorrow.");
  };
  return (
    <div className="ac-text ac-text--recall">
      <Label flagged={flagged}>{card.label || "Check yourself"}</Label>
      <p className="ac-recall-q">{card.q}</p>
      {!shown ? (
        <>
          <p className="ac-note">Answer it in your head, or out loud, before you look. The effort of remembering is what makes it stick.</p>
          <div className="ac-btns">
            <button type="button" className="ac-btn is-solid" onClick={() => setShown(true)}>
              Show the answer
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ac-recall-a">{card.a}</p>
          <div className="ac-btns" role="group" aria-label="How did you do?">
            <button type="button" className="ac-btn" onClick={() => gradeIt(true)}>
              Got it
            </button>
            <button type="button" className="ac-btn" onClick={() => gradeIt(false)}>
              Missed it
            </button>
          </div>
          <p className="ac-result" aria-live="polite">
            {result || (item && item.reps ? `In your deck · due ${whenLabel(item.due || today, today)}` : "")}
          </p>
        </>
      )}
    </div>
  );
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function CloseCard({ lesson, mode }) {
  const deck = useActa((s) => s.deck);
  const today = localISO();
  const inDeck = (lesson.cards || []).filter((c) => c.type === "recall" && c.id && deck[c.id]).length;
  const due = dueItems(deck, today).length;
  const nextDate = nextDue(deck, today);
  const next = lesson.next;
  const teaser = next && lesson.teaserFor === next.slug ? lesson.teaser : null;
  return (
    <div className="ac-text ac-text--close">
      <svg className="ac-meander" viewBox="0 0 320 14" preserveAspectRatio="xMinYMid slice" aria-hidden="true">
        <defs>
          <pattern id="ac-meander" width="20" height="14" patternUnits="userSpaceOnUse">
            <path d="M0 13H20M3 13V1H15V9H7V5H11" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </pattern>
        </defs>
        <rect width="320" height="14" fill="url(#ac-meander)" />
      </svg>
      <h2 className="ac-title ac-title--close">{mode === "today" ? "That's today." : "That's the lesson."}</h2>
      <ol className="ac-takeaways">
        {(lesson.takeaways || []).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
      {mode !== "preview" ? (
        <p className="ac-deck">
          {inDeck ? `${inDeck} questions from this lesson are in your review deck.` : "Its questions are in your review deck."}
          <br />
          {due ? `${due} due now.` : nextDate ? `Next review: ${whenLabel(nextDate, today)}.` : ""}
        </p>
      ) : null}
      {next ? (
        <div className="ac-tomorrow">
          <span className="ac-label">
            {next.date ? cap(whenLabel(next.date, today)) : "Next"} · {KIND_LABEL[next.kind] || ""}
          </span>
          <b>{next.title}</b>
          {teaser ? <span>{teaser}</span> : null}
        </div>
      ) : null}
      <p className="ac-ends">The feed ends here.</p>
      {mode !== "preview" ? (
        <div className="ac-btns">
          {due ? (
            <Link className="ac-btn is-solid" to="/acta/review">
              Review {due} due
            </Link>
          ) : null}
          {mode === "today" ? (
            <Link className="ac-btn" to="/acta/timeline">
              Your timeline
            </Link>
          ) : (
            <Link className="ac-btn" to="/acta">
              Back to today
            </Link>
          )}
          <Link className="ac-btn" to="/acta/archive">
            Archive
          </Link>
        </div>
      ) : null}
    </div>
  );
}

const VIEWS = {
  open: OpenCard,
  where: TextCard,
  story: TextCard,
  aside: TextCard,
  ripple: TextCard,
  quote: QuoteCard,
  numbers: NumbersCard,
  disagree: DisagreeCard,
  recall: RecallCard,
  close: CloseCard,
};

export function CardView(props) {
  const View = VIEWS[props.card.type] || TextCard;
  return <View {...props} />;
}
