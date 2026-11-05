/* Home-screen app service worker, shared by the app surfaces (/dashboard,
 * /bowler, /garage, /budgetter, /pantry).
 *
 * Registered once per surface with that surface's scope (AppIdentity does it),
 * so each installed app gets its own worker and its own caches. Android Chrome
 * only installs a real app (rather than a shortcut that opens a browser tab)
 * when a worker like this one controls the page.
 *
 *   navigations in scope   network first, cached shell as fallback
 *   /static/*              cache first (file names are content-hashed)
 *   push                   shows { title, body, url, tag } from the server;
 *                          a tap opens url in the app (Pantry's reminders)
 *
 * API calls are left alone: they're signed in and must always be live.
 */
const APP = new URL(self.registration.scope).pathname.replace(/\//g, "") || "app";
const VERSION = `${APP}-v1`;
const SHELL = `${VERSION}-shell`;
const STATIC = `${APP}-static`;
const SHELL_URL = new URL(self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch("/asset-manifest.json", { cache: "no-store" });
        const manifest = await res.json();
        const files = (manifest.entrypoints || []).map((f) => `/${String(f).replace(/^\//, "")}`);
        await cache.addAll([SHELL_URL, ...files]);
      } catch (_) {
        /* installing offline: runtime caching fills the gaps */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC]);
      for (const key of await caches.keys()) {
        if (key.startsWith(`${APP}-`) && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

const sameOrigin = (url) => url.origin === self.location.origin;
const inScope = (url) => sameOrigin(url) && url.pathname.startsWith(SHELL_URL);
const isStatic = (url) => sameOrigin(url) && url.pathname.startsWith("/static/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && inScope(url)) {
    event.respondWith(networkFirst(req, SHELL, SHELL_URL));
  } else if (isStatic(url)) {
    event.respondWith(cacheFirst(req, STATIC));
  }
});

async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) await cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) await cache.put(req, res.clone());
  return res;
}

// ---------------------------------------------------------------------------
// Push. The payload names its own icon and badge; a tap focuses the app's
// open window (navigating it to the payload's url) or opens one.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || APP.charAt(0).toUpperCase() + APP.slice(1);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      icon: data.icon || `/${APP}-icon-192.png`,
      badge: data.badge,
      data: { url: data.url || SHELL_URL },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || SHELL_URL;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith(SHELL_URL) && "focus" in client) {
          await client.focus();
          return "navigate" in client ? client.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
