import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import Feed from "./Feed";
import Flat from "./Flat";
import { fetchLesson, fetchToday } from "./api";
import { SAMPLE_LESSON, useShell } from "./shell";
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

/** /acta/:slug — one lesson from the archive. */
export function LessonRoute() {
  const { slug } = useParams();
  const { setEra, owner } = useShell();
  const view = useView();
  const [state, setState] = useState({ status: "loading" });

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

  useEffect(() => {
    if (state.lesson) setEra(state.lesson.era);
  }, [state.lesson, setEra]);

  if (state.status === "loading") return <Loading />;
  if (state.status !== "ok") {
    return (
      <div className="ac-solo">
        <div className="ac-solo-inner">
          <p className="ac-label">{state.status === "missing" ? "Not found" : "Offline"}</p>
          <h1 className="ac-title">{state.status === "missing" ? "That lesson isn't out yet." : "Couldn't load that lesson."}</h1>
          <p className="ac-body">{state.status === "missing" ? "It may be scheduled for a later day, or the link is wrong." : "Check your connection and try again."}</p>
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
  if (view === "article") return <Flat lesson={state.lesson} back={`/acta/${state.lesson.slug}`} />;
  return (
    <>
      <Helmet>
        <title>{`Acta Diurna · ${state.lesson.title}`}</title>
      </Helmet>
      <Feed key={state.lesson.slug} lesson={state.lesson} mode={state.sample ? "sample" : "archive"} owner={owner} />
    </>
  );
}
