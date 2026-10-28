// Installable-app plumbing for /acta: the service worker (offline lessons,
// push) and daily-reminder subscriptions. The install prompt itself is the
// site-wide one in Components/AppIdentity/install.js, re-exported here.
// Everything degrades to "not available" rather than throwing.
import { dropPush, fetchPushKey, savePush } from "./api";
import { isIOS, isStandalone } from "../../Components/AppIdentity/install";

export {
  canPromptInstall,
  isIOS,
  isStandalone,
  onInstallChange as onPwaChange,
  promptInstall,
} from "../../Components/AppIdentity/install";

const SW_URL = "/acta-sw.js";
const SCOPE = "/acta";

let registration = null;

/** Register the Acta service worker (production builds only). */
export async function registerServiceWorker() {
  if (registration) return registration;
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return null;
  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
    return registration;
  } catch {
    return null;
  }
}

/** Ask the service worker to keep a lesson's images for offline reading. */
export function precacheImages(urls) {
  const sw = typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller;
  if (sw && urls.length) sw.postMessage({ type: "precache", urls });
}

// ---------------------------------------------------------------------------
// Push

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = registration || (await navigator.serviceWorker.getRegistration(SCOPE));
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Turn the daily reminder on. Resolves { ok } or { ok: false, error }. */
export async function enableReminder() {
  if (!pushSupported()) return { ok: false, error: "This browser can't show reminders." };
  if (isIOS() && !isStandalone()) return { ok: false, error: "On iPhone, add Acta to your Home Screen first, then turn reminders on from there." };
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, error: "Reminders need the installed app (they aren't available in development)." };
  const key = await fetchPushKey();
  if (!key.ok || !key.data.enabled || !key.data.publicKey) return { ok: false, error: "Reminders aren't switched on yet." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Notifications are blocked for this site. Allow them in your browser settings." };
  try {
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.data.publicKey) }));
    const saved = await savePush(sub.toJSON());
    return saved.ok ? { ok: true } : { ok: false, error: saved.error };
  } catch {
    return { ok: false, error: "Couldn't set up the reminder. Try again." };
  }
}

export async function disableReminder() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  await dropPush(sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}
