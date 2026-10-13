import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import Today, { LessonRoute, Loading } from "./Today";
import { Archive, Review, Saved, Timeline } from "./pages";
import { ShellContext, isOwnerDevice } from "./shell";
import { DEFAULT_ERA, ERAS, eraOf, skinVars, useEraFonts } from "./eras";
import { registerServiceWorker } from "./pwa";
import "./Acta.css";

/*
 * Acta Diurna (/acta): one history lesson a day, read as a feed that ends.
 *
 * A self-contained surface: the site sidebar, theme switch and Lenis are off
 * here (their prefix lists include /acta), and the lesson's era skins the
 * whole thing. While mounted it swaps the page's manifest, touch icon and
 * theme colour for Acta's own, so "Add to Home Screen" installs Acta rather
 * than the portfolio, and restores them on the way out.
 *
 * Clerk loads only on Charlie's devices (once signed in there) and on the desk
 * and sign-in pages. Everyone else gets a fully working page without it.
 */

const Desk = lazy(() => import("./Desk"));
const SignInPage = lazy(() => import("./Desk").then((m) => ({ default: m.SignInPage })));
const OWNER_PATHS = ["/acta/desk", "/acta/sign-in"];
const OwnerRoot = lazy(() => import("./owner"));

const ERA_KEY = "acta:era";
const readEra = () => {
  try {
    const e = window.localStorage.getItem(ERA_KEY);
    return ERAS[e] ? e : DEFAULT_ERA;
  } catch {
    return DEFAULT_ERA;
  }
};

/** Swap the document's app identity for Acta's while it's mounted. */
function useDocumentChrome(era) {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("acta-on");
    const swaps = [
      ['link[rel="manifest"]', "href", "/acta.webmanifest"],
      ['link[rel="apple-touch-icon"]', "href", "/acta-icon-180.png"],
    ].map(([sel, attr, value]) => {
      const el = document.querySelector(sel);
      const prev = el ? el.getAttribute(attr) : null;
      if (el) el.setAttribute(attr, value);
      return () => el && prev != null && el.setAttribute(attr, prev);
    });
    registerServiceWorker();
    return () => {
      html.classList.remove("acta-on");
      html.style.removeProperty("--acta-bg");
      swaps.forEach((undo) => undo());
    };
  }, []);

  useEffect(() => {
    const bg = eraOf(era).bg;
    document.documentElement.style.setProperty("--acta-bg", bg);
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta ? meta.getAttribute("content") : null;
    if (meta) meta.setAttribute("content", bg);
    return () => {
      if (meta && prev) meta.setAttribute("content", prev);
    };
  }, [era]);
}

function ActaInner({ owner }) {
  const [era, setEraState] = useState(readEra);
  useEraFonts(era);
  useDocumentChrome(era);

  const setEra = useCallback((next) => {
    if (!next || !ERAS[next]) return;
    setEraState(next);
    try {
      window.localStorage.setItem(ERA_KEY, next);
    } catch {
      /* storage blocked: the skin just won't be remembered */
    }
  }, []);

  const ctx = useMemo(() => ({ era, setEra, owner }), [era, setEra, owner]);
  const e = eraOf(era);

  return (
    <ShellContext.Provider value={ctx}>
      <div className={`acta${e.light ? " is-light" : ""}`} data-era={era} style={skinVars(era)}>
        <Helmet>
          <title>Acta Diurna · A history lesson a day</title>
          <meta name="description" content="One history lesson a day, about fifteen minutes, read on your phone like a feed that ends. Ancient Greece and Rome, and everywhere else." />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content={e.light ? "default" : "black-translucent"} />
          <meta name="apple-mobile-web-app-title" content="Acta" />
        </Helmet>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<Today />} />
            <Route path="archive" element={<Archive />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="review" element={<Review />} />
            <Route path="saved" element={<Saved />} />
            <Route path="desk/*" element={<Desk />} />
            <Route path="sign-in" element={<SignInPage />} />
            <Route path=":slug" element={<LessonRoute />} />
          </Routes>
        </Suspense>
      </div>
    </ShellContext.Provider>
  );
}

export default function Acta() {
  const { pathname } = useLocation();
  const wantsOwner = Boolean(process.env.REACT_APP_CLERK_PUBLISHABLE_KEY) && (isOwnerDevice() || OWNER_PATHS.some((p) => pathname.startsWith(p)));
  if (!wantsOwner) return <ActaInner owner={null} />;
  return (
    <Suspense fallback={<ActaInner owner={null} />}>
      <OwnerRoot>{(owner) => <ActaInner owner={owner} />}</OwnerRoot>
    </Suspense>
  );
}
