// Web Push for the home-screen apps. The worker is the shared one
// (public/app-sw.js) that AppIdentity registers per app scope; it shows
// whatever the server pushes. Everything degrades to "not available" with a
// plain-words reason rather than throwing.
import { isIOS, isStandalone } from "./install";

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration(scope) {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration(scope)) || null;
}

/** This phone's subscription for the app at `scope`, or null. */
export async function currentSubscription(scope) {
  const reg = await registration(scope);
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Ask for permission, subscribe, and hand the subscription to `save`.
 * Resolves { ok } or { ok: false, error }.
 */
export async function enablePush({ scope, appName, publicKey, save }) {
  if (!pushSupported()) return { ok: false, error: "This browser can't show reminders." };
  if (isIOS() && !isStandalone()) {
    return {
      ok: false,
      error: `On iPhone, add ${appName} to your Home Screen first, then turn reminders on there.`,
    };
  }
  if (!publicKey) return { ok: false, error: "Reminders aren't switched on for the site yet." };
  const reg = await registration(scope);
  if (!reg) return { ok: false, error: "Reminders need the installed app (they're off in development)." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notifications are blocked for this site. Allow them in your browser settings." };
  }
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    return await save(sub.toJSON());
  } catch {
    return { ok: false, error: "Couldn't set up reminders. Try again." };
  }
}

/** Unsubscribe this phone and tell the server through `drop(endpoint)`. */
export async function disablePush({ scope, drop }) {
  const sub = await currentSubscription(scope);
  if (!sub) return { ok: true };
  await drop(sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}
