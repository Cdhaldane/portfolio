import { useEffect } from "react";
import { Helmet } from "react-helmet-async";

/*
 * Gives a self-contained surface its own home-screen identity while it's
 * mounted: swaps the document's manifest, touch icon and theme colour for the
 * surface's own, so "Add to Home Screen" / "Install app" installs that surface
 * (opening straight to it) rather than the portfolio. Everything is restored on
 * the way out. Acta does the same inline; this is the reusable version.
 *
 * It also registers the shared home-screen service worker (public/app-sw.js)
 * for the surface's scope. Android Chrome needs one controlling the page to
 * install a real app; without it "Add to Home screen" makes a shortcut that
 * opens in a browser tab.
 *
 * Mount it in a route's gate, not the page, so the sign-in screen installs the
 * right app too and the swap holds steady across the surface's sub-routes.
 */

/** True when running as an installed home-screen app. */
export const isStandalone = () =>
  typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true);

const SW_URL = "/app-sw.js";

const swap = (selector, attr, value) => {
  const el = document.querySelector(selector);
  const prev = el ? el.getAttribute(attr) : null;
  if (el) el.setAttribute(attr, value);
  return () => el && prev != null && el.setAttribute(attr, prev);
};

const AppIdentity = ({ title, scope, manifest, icon, themeColor, statusBar = "black" }) => {
  useEffect(() => {
    const undo = [
      swap('link[rel="manifest"]', "href", manifest),
      swap('link[rel="apple-touch-icon"]', "href", icon),
    ];
    return () => undo.forEach((u) => u());
  }, [manifest, icon]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(SW_URL, { scope }).catch(() => {
      /* no worker: the page still works, it just installs as a shortcut */
    });
  }, [scope]);

  useEffect(() => {
    if (!themeColor) return undefined;
    return swap('meta[name="theme-color"]', "content", themeColor);
  }, [themeColor]);

  return (
    <Helmet>
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content={statusBar} />
      <meta name="apple-mobile-web-app-title" content={title} />
    </Helmet>
  );
};

export default AppIdentity;
