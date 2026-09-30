import { useCallback, useEffect, useState } from "react";

/*
 * Small environment hooks for TOP DECK. Everything here is written to survive
 * jsdom and locked-down browsers: missing APIs fall back to safe defaults and
 * storage failures just mean "not remembered".
 */

export const readJSON = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const writeJSON = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: keep working, just don't persist */
  }
};

/** useState that mirrors itself into localStorage (per-viewer niceties only). */
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => readJSON(key, fallback));
  useEffect(() => writeJSON(key, value), [key, value]);
  return [value, setValue];
}

const media = (query) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;

/**
 * Lite tier: weak CPUs, narrow screens and touch get the cheaper holo (no
 * blend modes) and fewer particles. Decided once; it never flips mid-visit.
 */
export function useLiteTier() {
  const [lite] = useState(() => {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 8;
    return (cores && cores <= 4) || media("(max-width: 560px)") || media("(pointer: coarse)");
  });
  return lite;
}

export const hasFinePointer = () => media("(hover: hover) and (pointer: fine)");

/**
 * Resolves once the display faces are loaded (or after `timeout` ms), so the
 * extruded wordmark never builds on a fallback font. index.html loads the
 * families with display=swap, and a face only downloads once it's used.
 */
export function useFontsReady(faces, timeout = 700) {
  const [ready, setReady] = useState(
    () => typeof document === "undefined" || !document.fonts || !document.fonts.load
  );
  useEffect(() => {
    if (ready) return undefined;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };
    const timer = setTimeout(finish, timeout);
    Promise.all(faces.map((f) => document.fonts.load(f)))
      .catch(() => undefined)
      .then(finish);
    return () => {
      done = true;
      clearTimeout(timer);
    };
    // `faces` is a module constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
}

const measure = () => ({
  vw: typeof window !== "undefined" ? window.innerWidth || 1280 : 1280,
  vh: typeof window !== "undefined" ? window.innerHeight || 800 : 800,
});

/** Viewport size, rAF-throttled. */
export function useViewport() {
  const [size, setSize] = useState(measure);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setSize((prev) => {
          const next = measure();
          return next.vw === prev.vw && next.vh === prev.vh ? prev : next;
        });
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return size;
}

/** A short-lived message queue for toasts (one visible at a time). */
export function useToast(duration = 2600) {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), duration);
    return () => clearTimeout(t);
  }, [toast, duration]);
  const show = useCallback((text) => setToast({ text, id: Date.now() }), []);
  return [toast, show];
}

/** Local calendar date as YYYY-MM-DD (the pull stamp on card backs). */
export const today = () => new Date().toLocaleDateString("en-CA");
