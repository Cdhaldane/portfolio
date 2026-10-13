// Listen mode: the browser's own speech synthesis reads the lesson card by
// card, moving the feed along as it goes, so a lesson works on a walk.
//
// Speech is queued a sentence at a time (Chrome drops long utterances after
// ~15 s). Recall cards read the question, pause so you can answer, then read
// the answer. Scrolling by hand while listening restarts at the new card.
// The narrator is a plain object in a ref: its callbacks outlive renders, so
// a token per run stops a cancelled run from advancing the feed.
import { useEffect, useRef, useState } from "react";
import { speechParts } from "./lessonUtil";

export const speechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

const ANSWER_PAUSE_MS = 3500;

function createNarrator() {
  const n = { token: 0, on: false, auto: false, timer: 0, cards: [], lesson: null, goTo: null, setOn: null };
  const synth = () => window.speechSynthesis;

  n.stop = () => {
    n.on = false;
    n.token += 1;
    clearTimeout(n.timer);
    try {
      synth().cancel();
    } catch {
      /* nothing to cancel */
    }
    if (n.setOn) n.setOn(false);
  };

  n.queue = (parts, done, token) => {
    if (!parts.length) return done();
    parts.forEach((text, k) => {
      const u = new window.SpeechSynthesisUtterance(text);
      u.rate = 1;
      if (k === parts.length - 1) u.onend = () => token === n.token && done();
      u.onerror = (e) => {
        if (token === n.token && e.error !== "interrupted" && e.error !== "canceled") n.stop();
      };
      synth().speak(u);
    });
    return undefined;
  };

  n.speak = (i) => {
    const token = ++n.token;
    clearTimeout(n.timer);
    synth().cancel();
    const card = n.cards[i];
    if (!card) return n.stop();
    const next = () => {
      if (token !== n.token || !n.on) return;
      if (card.type === "close" || i + 1 >= n.cards.length) return n.stop();
      n.auto = true;
      n.goTo(i + 1);
      n.speak(i + 1);
    };
    const afterCard = () => {
      if (token !== n.token || !n.on) return;
      if (card.type !== "recall") return next();
      n.timer = setTimeout(() => {
        if (token === n.token && n.on) n.queue(["Answer.", card.a], next, token);
      }, ANSWER_PAUSE_MS);
    };
    return n.queue(speechParts(card, n.lesson), afterCard, token);
  };

  n.start = (i) => {
    n.on = true;
    if (n.setOn) n.setOn(true);
    n.speak(i);
  };

  /** The feed moved. If the reader moved it, start reading there. */
  n.onActive = (i) => {
    if (!n.on) return;
    if (n.auto) {
      n.auto = false;
      return;
    }
    n.speak(i);
  };

  return n;
}

export function useNarrator({ cards, lesson, goTo }) {
  const [on, setOn] = useState(false);
  const ref = useRef(null);
  if (!ref.current) ref.current = createNarrator();
  const n = ref.current;
  n.cards = cards;
  n.lesson = lesson;
  n.goTo = goTo;
  n.setOn = setOn;
  useEffect(() => () => n.stop(), [n]);
  return { supported: speechSupported(), on, start: n.start, stop: n.stop, onActive: n.onActive };
}
