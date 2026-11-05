// "Tell me when we're low" for this phone. The worker is the shared
// home-screen one (public/app-sw.js) that AppIdentity registers for
// /pantry; it shows whatever the server pushes. Everything degrades to
// "not available" rather than throwing.
import { dropPush, savePush } from "./api";
import { isIOS, isStandalone } from "../../Components/AppIdentity/install";

const SCOPE = "/pantry";

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

async function registration() {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration(SCOPE)) || null;
}

export async function currentSubscription() {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Resolves { ok } or { ok: false, error }. */
export async function enableReminders(getToken, publicKey) {
  if (!pushSupported()) return { ok: false, error: "This browser can't show reminders." };
  if (isIOS() && !isStandalone()) {
    return { ok: false, error: "On iPhone, add Pantry to your Home Screen first, then turn reminders on there." };
  }
  if (!publicKey) return { ok: false, error: "Reminders aren't switched on for the site yet." };
  const reg = await registration();
  if (!reg) return { ok: false, error: "Reminders need the installed app (they're off in development)." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, error: "Notifications are blocked for this site. Allow them in your browser settings." };
  }
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    return await savePush(getToken, sub.toJSON());
  } catch {
    return { ok: false, error: "Couldn't set up reminders. Try again." };
  }
}

export async function disableReminders(getToken) {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  await dropPush(getToken, sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}
