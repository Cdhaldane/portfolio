import { useEffect, useRef } from "react";

/*
 * Self-scheduling poll: one request at a time, never overlapping. `tick`
 * receives an AbortSignal and may return a number of ms to override the next
 * wait (backoff after an error). Lowering `delay` reschedules right away, so
 * "buzzers are open" switches to the fast cadence without waiting out the
 * slow one. Hidden tabs idle and catch up the moment they're visible again.
 */
const HIDDEN_WAIT = 1500;

export function usePolling(tick, { delay, enabled }) {
  const tickRef = useRef(tick);
  const delayRef = useRef(delay);
  const kickRef = useRef(null);

  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    const lowered = delay < delayRef.current;
    delayRef.current = delay;
    if (lowered && kickRef.current) kickRef.current();
  }, [delay]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let timer = null;
    let running = false;
    let controller = null;

    const loop = async () => {
      timer = null;
      if (stopped || running) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(loop, HIDDEN_WAIT);
        return;
      }
      running = true;
      controller = new AbortController();
      let wait;
      try {
        wait = await tickRef.current(controller.signal);
      } finally {
        running = false;
      }
      if (stopped) return;
      timer = setTimeout(loop, typeof wait === "number" ? wait : delayRef.current);
    };

    const kick = () => {
      if (stopped || running) return;
      clearTimeout(timer);
      loop();
    };
    kickRef.current = kick;
    const onVisible = () => {
      if (!document.hidden) kick();
    };

    document.addEventListener("visibilitychange", onVisible);
    loop();
    return () => {
      stopped = true;
      kickRef.current = null;
      clearTimeout(timer);
      if (controller) controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
