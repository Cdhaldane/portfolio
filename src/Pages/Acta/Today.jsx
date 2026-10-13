import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import Feed from "./Feed";
import Flat from "./Flat";
import { fetchLesson, fetchToday, ownerLesson } from "./api";
import { SAMPLE_LESSON, useOwnerSettled, useShell } from "./shell";
import { dueItems, localISO, nextDue, useActa, whenLabel } from "./store";

export function Loading() {
  return (
    <div className="ac-solo" aria-busy="true" aria-label="Loading the lesson">
      <div className="ac-solo-inner ac-loading">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function recentVotes(votes) {
  const since = Date.now() - 7 * 86400000;
  return Object.values(votes || {}).filter((v) => v && v.at >= since && v.sides);
}

/** Sundays: no new lesson, a review instead. */
function Sunday({ lesson, onRead }) {
  const deck = useActa((s) => s.deck);
  const votes = useActa((s) => s.votes);
  const today = localISO();
  const due = dueItems(deck, today).length;
  const debates = recentVotes(votes).length;
  const next = nextDue(deck, today);
  return (
    <div className="ac-solo">
      <div className="ac-solo-inner">
        <p className="ac-label">Sunday · Review day</p>
        <h1 className="ac-title ac-title--open">No new lesson today.</h1>
        <p className="ac-body">
          Ten minutes on this week's questions instead. Pulling something back out of your memory is what makes it stay there, far more than reading it again.
        </p>
        <div className="ac-btns">
          {due || debates ? (
            <Link className="ac-btn is-solid" to="/acta/review">
              Start review: {due} {due === 1 ? "question" : "questions"}
              {debates ? `, ${debates} ${debates === 1 ? "debate" : "debates"}` : ""}
            </Link>
          ) : (
            <p className="ac-note">Nothing due. {next ? `Your next review is ${whenLabel(next, today)}.` : "Finish a lesson and its questions start coming back."}</p>
          )}
          <button type="button" className="ac-btn" onClick={onRead}>
            Read {lesson.title} again
          </button>
        </div>
      </div>
    </div>
  );
}

function useView() {
  const location = useLocation();
  return new URLSearchParams(location.search).get("view");
}

export default function Today() {
  const { setEra, owner } = useShell();
  const view = useView();
  const [state, setState] = useState({ status: "loading" });
  const [readAnyway, setReadAnyway] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchToday(ac.signal).then((r) => {
      if (r.aborted) return;
      setState(r.ok ? { status: "ok", data: r.data } : { status: "offline" });
    });
    return () => ac.abort();
  }, []);

  const live = state.data && state.data.lesson;
  const lesson = live || SAMPLE_LESSON;
  const mode = live ? "today" : "sample";

  useEffect(() => {
    if (state.status !== "loading") setEra(lesson.era);
  }, [state.status, lesson.era, setEra]);

  if (state.status === "loading") return <Loading />;
  if (view === "article") return <Flat lesson={lesson} back="/acta" />;
  const reviewDay = state.data ? state.data.reviewDay : new Date().getDay() === 0;
  if (reviewDay && !readAnyway) return <Sunday lesson={lesson} onRead={() => setReadAnyway(true)} />;
  const stale = live && !state.data.isNew;
  return (
    <>
      <Helmet>
        <title>{`Acta Diurna · ${lesson.title}`}</title>
      </Helmet>
      <Feed key={lesson.slug} lesson={lesson} mode={mode} owner={owner} banner={stale ? <p className="ac-banner">No new lesson today. This is the latest.</p> : null} />
    </>
  );
}

/** Toronto date → "Tue, Oct 20" (for the early-access banner). */
const fmtDay = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";

function earlyBanner(lesson, today) {
  if (lesson.held) return "Held back. Only you can see this one.";
  if (!today || lesson.publishOn > today) return `Early access. This goes live ${fmtDay(lesson.publishOn)}; only you can see it before then.`;
  return "Not out yet: it's waiting on the desk. Only you can see it.";
}

/**
 * /acta/:slug — one lesson from the archive. Visitors get live lessons only;
 * when Charlie is signed in, a lesson that isn't out yet (or is held back)
 * opens anyway through the owner route, with a banner saying so.
 */
export function LessonRoute() {
  const { slug } = useParams();
  const { setEra, owner } = useShell();
  const view = useView();
  const [state, setState] = useState({ status: "loading" });
  const [early, setEarly] = useState(null);
  const ownerSettled = useOwnerSettled(owner);
  const getToken = owner && owner.signedIn ? owner.getToken : null;

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchLesson(slug, ac.signal).then((r) => {
      if (r.aborted) return;
      if (r.ok) setState({ status: "ok", lesson: r.data.lesson });
      else if (slug === SAMPLE_LESSON.slug) setState({ status: "ok", lesson: SAMPLE_LESSON, sample: true });
      else setState({ status: r.status === 404 ? "missing" : "offline" });
    });
    return () => ac.abort();
  }, [slug]);

  // Not out for visitors: Charlie may still open it.
  useEffect(() => {
    setEarly(null);
    if (state.status !== "missing" || !getToken) return undefined;
    let gone = false;
    ownerLesson(getToken, slug).then((o) => {
      if (!gone) setEarly({ ...o, slug });
    });
    return () => {
      gone = true;
    };
  }, [state.status, getToken, slug]);

  const earlyHere = early && early.slug === slug ? early : null;
  const lesson = state.status === "ok" ? state.lesson : earlyHere && earlyHere.ok ? earlyHere.lesson : null;

  useEffect(() => {
    if (lesson) setEra(lesson.era);
  }, [lesson, setEra]);

  const waitingOnOwner = state.status === "missing" && (!ownerSettled || (getToken && !earlyHere));
  if (state.status === "loading" || waitingOnOwner) return <Loading />;
  if (!lesson) {
    // Signed in, but the owner route has nothing to show either (not written yet).
    const ownerSays = earlyHere && !earlyHere.ok && earlyHere.status === 404 ? earlyHere.error : null;
    const missing = state.status === "missing";
    return (
      <div className="ac-solo">
        <div className="ac-solo-inner">
          <p className="ac-label">{missing ? "Not found" : "Offline"}</p>
          <h1 className="ac-title">{ownerSays || (missing ? "That lesson isn't out yet." : "Couldn't load that lesson.")}</h1>
          <p className="ac-body">
            {ownerSays ? "It's on the calendar; check the desk for where it's stuck." : missing ? "It may be scheduled for a later day, or the link is wrong." : "Check your connection and try again."}
          </p>
          <div className="ac-btns">
            <Link className="ac-btn is-solid" to="/acta">
              Today's lesson
            </Link>
            <Link className="ac-btn" to="/acta/archive">
              Archive
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (view === "article") return <Flat lesson={lesson} back={`/acta/${lesson.slug}`} />;
  return (
    <>
      <Helmet>
        <title>{`Acta Diurna · ${lesson.title}`}</title>
      </Helmet>
      <Feed
        key={lesson.slug}
        lesson={lesson}
        mode={state.sample ? "sample" : "archive"}
        owner={owner}
        banner={state.status === "ok" ? null : <p className="ac-banner">{earlyBanner(lesson, earlyHere && earlyHere.date)}</p>}
      />
    </>
  );
}
