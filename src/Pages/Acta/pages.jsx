import { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { fetchArchive } from "./api";
import { SAMPLE_LESSON, useShell } from "./shell";
import { KIND_LABEL, formatYear } from "./lessonUtil";
import { addDays, dueItems, gradeItem, localISO, nextDue, update, useActa, whenLabel } from "./store";
import { Loading } from "./Today";

// ---------------------------------------------------------------------------
// Shell for the scrolling pages

function PageNav() {
  const deck = useActa((s) => s.deck);
  const due = dueItems(deck, localISO()).length;
  const link = ({ isActive }) => (isActive ? "is-on" : undefined);
  return (
    <nav className="ac-pnav" aria-label="Acta">
      <NavLink to="/acta" end className={link}>
        Today
      </NavLink>
      <NavLink to="/acta/review" className={link}>
        Review{due ? <span className="ac-count">{due}</span> : null}
      </NavLink>
      <NavLink to="/acta/archive" className={link}>
        Archive
      </NavLink>
      <NavLink to="/acta/timeline" className={link}>
        Timeline
      </NavLink>
      <NavLink to="/acta/saved" className={link}>
        Saved
      </NavLink>
    </nav>
  );
}

export function Page({ kicker, title, intro, children }) {
  return (
    <div className="ac-page">
      <Helmet>
        <title>{`Acta Diurna · ${title}`}</title>
      </Helmet>
      <PageNav />
      <header className="ac-page-head">
        {kicker ? <p className="ac-label">{kicker}</p> : null}
        <h1 className="ac-page-title">{title}</h1>
        {intro ? <p className="ac-page-intro">{intro}</p> : null}
      </header>
      {children}
    </div>
  );
}

/** Live lessons from the API, or just the sample when there's no API. */
function useArchive() {
  const [state, setState] = useState({ status: "loading", lessons: [] });
  useEffect(() => {
    const ac = new AbortController();
    fetchArchive(ac.signal).then((r) => {
      if (r.aborted) return;
      const lessons = r.ok ? r.data.lessons : [];
      if (!lessons.length) {
        const s = SAMPLE_LESSON;
        lessons.push({ slug: s.slug, day: null, publishOn: null, title: s.title, subtitle: s.subtitle, summary: s.summary, kind: s.kind, era: s.era, year: s.year, yearLabel: s.yearLabel, minutes: s.minutes, takeaways: s.takeaways, sample: true });
      }
      setState({ status: r.ok ? "ok" : "offline", lessons });
    });
    return () => ac.abort();
  }, []);
  return state;
}

const fmtDate = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";

const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};

// ---------------------------------------------------------------------------
// Archive

export function Archive() {
  const { lessons, status } = useArchive();
  const progress = useActa((s) => s.progress);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? lessons.filter((l) => [l.title, l.summary, l.subtitle, l.yearLabel, ...(l.takeaways || [])].join(" ").toLowerCase().includes(needle))
      : lessons;
  }, [lessons, q]);
  const weeks = useMemo(() => {
    const out = [];
    for (const l of shown) {
      const key = l.publishOn ? mondayOf(l.publishOn) : "sample";
      let w = out.find((x) => x.key === key);
      if (!w) out.push((w = { key, items: [] }));
      w.items.push(l);
    }
    return out;
  }, [shown]);
  const done = lessons.filter((l) => progress[l.slug] && progress[l.slug].done).length;

  if (status === "loading") return <Loading />;
  return (
    <Page kicker="Archive" title="Every lesson so far" intro={`${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"} · ${done} read`}>
      <label className="ac-field ac-search">
        <span className="ac-sr">Search the archive</span>
        <input id="ac-archive-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: Themistocles, 480, democracy…" />
      </label>
      {weeks.map((w) => (
        <section key={w.key} className="ac-arch-week">
          <h2 className="ac-label">{w.key === "sample" ? "Sample" : `Week of ${fmtDate(w.key)}`}</h2>
          <ol>
            {w.items.map((l) => {
              const p = progress[l.slug];
              return (
                <li key={l.slug}>
                  <Link to={`/acta/${l.slug}`} className="ac-arch-item">
                    <span className="ac-arch-day">{l.day ? l.day : "·"}</span>
                    <span className="ac-arch-main">
                      <span className="ac-arch-kind">
                        {KIND_LABEL[l.kind] || ""} · {l.yearLabel}
                      </span>
                      <b>{l.title}</b>
                      {l.summary ? <span className="ac-arch-sum">{l.summary}</span> : null}
                    </span>
                    <span className={`ac-arch-state${p && p.done ? " is-done" : p ? " is-started" : ""}`}>
                      {p && p.done ? "Read" : p ? `${Math.round(((p.max || 0) / Math.max(1, p.total || 1)) * 100)}%` : `${l.minutes || 15} min`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {!shown.length ? <p className="ac-note">Nothing matches “{q}”.</p> : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Timeline

const SPANS = [
  { to: -800, label: "Before 800 BC" },
  { to: 0, label: "800 BC to the birth of Christ" },
  { to: 500, label: "AD 1 to 500" },
  { to: 1500, label: "500 to 1500" },
  { to: 1800, label: "1500 to 1800" },
  { to: 1914, label: "1800 to 1914" },
  { to: Infinity, label: "1914 to now" },
];

export function Timeline() {
  const { lessons, status } = useArchive();
  const progress = useActa((s) => s.progress);
  const [open, setOpen] = useState(null);
  const sorted = useMemo(() => [...lessons].filter((l) => Number.isFinite(l.year)).sort((a, b) => a.year - b.year), [lessons]);
  const read = sorted.filter((l) => progress[l.slug] && progress[l.slug].done);
  const groups = useMemo(() => {
    const out = SPANS.map((s) => ({ ...s, items: [] }));
    for (const l of sorted) out.find((s) => l.year < s.to).items.push(l);
    return out.filter((g) => g.items.length);
  }, [sorted]);

  if (status === "loading") return <Loading />;
  const span = read.length > 1 ? `${formatYear(read[0].year)} to ${formatYear(read[read.length - 1].year)}` : null;
  return (
    <Page
      kicker="Timeline"
      title="What you know, in order"
      intro={read.length ? `${read.length} ${read.length === 1 ? "lesson" : "lessons"} read${span ? `, from ${span}` : ""}. Filled pins are lessons you've finished.` : "Finish a lesson and its pin fills in. Over a year the gaps start closing."}
    >
      <ol className="ac-tl">
        {groups.map((g) => (
          <li key={g.label} className="ac-tl-group">
            <h2 className="ac-label">{g.label}</h2>
            <ol>
              {g.items.map((l) => {
                const isRead = progress[l.slug] && progress[l.slug].done;
                const isOpen = open === l.slug;
                return (
                  <li key={l.slug} className={`ac-tl-item${isRead ? " is-read" : ""}`}>
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.slug)}>
                      <i aria-hidden="true" />
                      <span className="ac-tl-year">{l.yearLabel || formatYear(l.year)}</span>
                      <b>{l.title}</b>
                    </button>
                    {isOpen ? (
                      <div className="ac-tl-more">
                        <ul>
                          {(l.takeaways || []).map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                        <Link className="ac-btn" to={`/acta/${l.slug}`}>
                          {isRead ? "Read it again" : "Read it"}
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Review

function Debate({ v, onDone }) {
  const [shown, setShown] = useState(false);
  const mine = v.sides[v.side] || {};
  const other = v.sides[1 - v.side] || {};
  return (
    <div className="ac-solo-inner">
      <p className="ac-label">Debate · {v.lessonTitle}</p>
      <h1 className="ac-title">{v.title}</h1>
      <p className="ac-body">
        You sided with <b>{(mine.label || "").toLowerCase()}</b>. Make the case in two sentences, in your head or out loud, before you look at the other side again.
      </p>
      {!shown ? (
        <div className="ac-btns">
          <button type="button" className="ac-btn is-solid" onClick={() => setShown(true)}>
            I've made it. Show the other side
          </button>
        </div>
      ) : (
        <>
          <section className="ac-side">
            <h3>{other.label}</h3>
            <p>{other.text}</p>
          </section>
          <div className="ac-btns">
            <button type="button" className="ac-btn is-solid" onClick={onDone}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Question({ item, onGrade }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="ac-solo-inner">
      <p className="ac-label">
        {item.lessonTitle} · {item.box <= 0 ? "first review" : `review ${item.reps + 1}`}
      </p>
      <p className="ac-recall-q">{item.q}</p>
      {!shown ? (
        <div className="ac-btns">
          <button type="button" className="ac-btn is-solid" onClick={() => setShown(true)}>
            Show the answer
          </button>
        </div>
      ) : (
        <>
          <p className="ac-recall-a">{item.a}</p>
          <div className="ac-btns" role="group" aria-label="How did you do?">
            <button type="button" className="ac-btn" onClick={() => onGrade(true)}>
              Got it
            </button>
            <button type="button" className="ac-btn" onClick={() => onGrade(false)}>
              Missed it
            </button>
          </div>
        </>
      )}
      <Link className="ac-link" to={`/acta/${item.slug}`}>
        Open the lesson
      </Link>
    </div>
  );
}

export function Review() {
  const deck = useActa((s) => s.deck);
  const votes = useActa((s) => s.votes);
  const today = localISO();
  // Fix the session's queue when it starts, so grading doesn't reshuffle it.
  const [queue] = useState(() => {
    const items = dueItems(deck, today).map((i) => ({ kind: "q", id: i.id }));
    const sunday = new Date().getDay() === 0;
    const since = Date.now() - 7 * 86400000;
    const debates = sunday ? Object.entries(votes).filter(([, v]) => v && v.at >= since && v.sides).map(([slug]) => ({ kind: "d", slug })) : [];
    return [...items, ...debates];
  });
  const [at, setAt] = useState(0);
  const [score, setScore] = useState({ got: 0, missed: 0 });
  const step = queue[at];

  const gradeIt = (got) => {
    update((s) => ({ ...s, deck: { ...s.deck, [step.id]: gradeItem(s.deck[step.id], got, today) } }));
    setScore((x) => ({ got: x.got + (got ? 1 : 0), missed: x.missed + (got ? 0 : 1) }));
    setAt((n) => n + 1);
  };

  if (!step) {
    const next = nextDue(deck, today);
    return (
      <Page kicker="Review" title={queue.length ? "Done for today." : "Nothing due."}>
        <div className="ac-solo-inner ac-solo-inner--page">
          {queue.length ? (
            <p className="ac-body">
              {score.got} right, {score.missed} to see again tomorrow. The ones you got move further out; the ones you missed come back sooner.
            </p>
          ) : (
            <p className="ac-body">Your deck is clear. Questions from each lesson come back 1, 3, 7 and 21 days after you first answer them.</p>
          )}
          {next ? <p className="ac-note">Next review: {whenLabel(next, today)}.</p> : null}
          <div className="ac-btns">
            <Link className="ac-btn is-solid" to="/acta">
              Today's lesson
            </Link>
            <Link className="ac-btn" to="/acta/timeline">
              Your timeline
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <div className="ac-solo ac-solo--review">
      <Helmet>
        <title>Acta Diurna · Review</title>
      </Helmet>
      <header className="ac-review-top">
        <Link to="/acta" className="ac-link">
          ← Today
        </Link>
        <span className="ac-pos">
          {at + 1} / {queue.length}
        </span>
      </header>
      <div className="ac-review-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${at / queue.length})` }} />
      </div>
      {step.kind === "q" && deck[step.id] ? (
        <Question key={step.id} item={deck[step.id]} onGrade={gradeIt} />
      ) : step.kind === "d" && votes[step.slug] ? (
        <Debate key={step.slug} v={votes[step.slug]} onDone={() => setAt((n) => n + 1)} />
      ) : (
        <SkipMissing onSkip={() => setAt((n) => n + 1)} />
      )}
    </div>
  );
}

function SkipMissing({ onSkip }) {
  useEffect(() => {
    onSkip();
  }, [onSkip]);
  return null;
}

// ---------------------------------------------------------------------------
// Saved cards (the commonplace book)

export function Saved() {
  const saved = useActa((s) => s.saved);
  const { setEra } = useShell();
  const items = Object.values(saved)
    .filter((s) => s && !s.removed)
    .sort((a, b) => b.at - a.at);
  useEffect(() => {
    if (items[0] && items[0].era) setEra(items[0].era);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = (key) => update((s) => ({ ...s, saved: { ...s.saved, [key]: { key, removed: true, at: Date.now() } } }));
  return (
    <Page
      kicker="Commonplace book"
      title="Saved cards"
      intro="Renaissance readers copied the best passages they read into a commonplace book. Double-tap any card, or tap Save, and it lands here."
    >
      {!items.length ? <p className="ac-note">Nothing saved yet.</p> : null}
      <ol className="ac-saved">
        {items.map((s) => (
          <li key={s.key} className="ac-saved-item">
            {s.image ? <img src={s.image.url} alt={s.image.alt} loading="lazy" decoding="async" /> : null}
            <div>
              <p className="ac-label">
                {s.lessonTitle}
                {s.label && s.label !== s.title ? ` · ${s.label}` : ""}
              </p>
              {s.title ? <h2>{s.title}</h2> : null}
              <p className="ac-saved-text">{s.text}</p>
              <div className="ac-btns">
                <Link className="ac-btn" to={`/acta/${s.slug}?card=${s.index}`}>
                  Open
                </Link>
                <button type="button" className="ac-btn ac-btn--quiet" onClick={() => remove(s.key)}>
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Page>
  );
}
