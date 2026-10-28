// The browser's "install this app" prompt, caught once for the whole site.
//
// Chrome fires `beforeinstallprompt` as soon as a page is installable,
// which is often before a lazy route's code has loaded, so src/index.js
// imports this first thing. On a home-screen app surface the event is held
// for that surface's own Install button (tagged with the surface, so the
// prompt caught on /bowler can never install something else after an
// in-app navigation). Everywhere else Chrome's own behaviour is untouched.
//
// iPhone Safari never fires the event; there the button explains the
// Share > Add to Home Screen steps instead (InstallButton.jsx).

// Keep in sync with the app shells in scripts/app-shells.mjs.
export const APP_SCOPES = ["/dashboard", "/budgetter", "/bowler", "/garage", "/acta"];

let held = null; // { event, scope }
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

/** The app surface the page is on right now, or null. */
export function currentScope() {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  return APP_SCOPES.find((s) => path === s || path.startsWith(`${s}/`)) || null;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    const scope = currentScope();
    if (!scope) return;
    e.preventDefault();
    held = { event: e, scope };
    notify();
  });
  window.addEventListener("appinstalled", () => {
    held = null;
    notify();
  });
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when this surface can open the browser's own install dialog. */
export const canPromptInstall = () => Boolean(held) && held.scope === currentScope();

/** Open the install dialog. Resolves true if the person installed. */
export async function promptInstall() {
  if (!canPromptInstall()) return false;
  const { event } = held;
  held = null; // a prompt can only be shown once
  notify();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted";
  } catch {
    return false;
  }
}

/** True when running as an installed home-screen app. */
export const isStandalone = () =>
  typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
