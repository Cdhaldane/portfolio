// Installable-app plumbing for /acta: the service worker (offline lessons,
// push), the install prompt, and daily-reminder subscriptions. Everything
// degrades to "not available" rather than throwing.
import { dropPush, fetchPushKey, savePush } from "./api";

const SW_URL = "/acta-sw.js";
const SCOPE = "/acta";

let registration = null;
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

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

export const isStandalone = () =>
  typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const canPromptInstall = () => Boolean(deferredPrompt);

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  notify();
  return Boolean(choice && choice.outcome === "accepted");
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
