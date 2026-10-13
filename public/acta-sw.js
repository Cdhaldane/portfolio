/* Acta Diurna service worker, scope /acta.
 *
 * Keeps the app shell, today's lesson and its pictures available offline,
 * and shows the daily reminder. It only ever handles requests from pages
 * under /acta; the rest of the site is untouched.
 *
 *   navigations under /acta   network first, cached shell as fallback
 *   /api/acta/(today|lesson|archive)  network first, cached copy offline
 *   /static/*                 cache first (file names are content-hashed)
 *   Wikimedia images          cache first, fetched with CORS so they cache at
 *                             their real size (opaque responses are padded to
 *                             megabytes each against the storage quota)
 *   Google Fonts              stale while revalidate
 */
const VERSION = "acta-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = "acta-static";
const DATA = "acta-data";
const IMAGES = "acta-images";
const MAX_IMAGES = 160;
const SHELL_URL = "/acta";

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
      const keep = new Set([SHELL, STATIC, DATA, IMAGES]);
      for (const key of await caches.keys()) {
        if (key.startsWith("acta") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

const sameOrigin = (url) => url.origin === self.location.origin;
const isImage = (url) => /(^|\.)wikimedia\.org$/.test(url.hostname);
const isApi = (url) => sameOrigin(url) && /^\/api\/acta\/(today|lesson|archive)/.test(url.pathname);
const isStatic = (url) => sameOrigin(url) && url.pathname.startsWith("/static/");
const isFont = (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate" && sameOrigin(url) && url.pathname.startsWith("/acta")) {
    event.respondWith(networkFirst(req, SHELL, SHELL_URL));
  } else if (isApi(url)) {
    event.respondWith(networkFirst(req, DATA));
  } else if (isStatic(url)) {
    event.respondWith(cacheFirst(req, STATIC));
  } else if (isImage(url)) {
    event.respondWith(cachedImage(req.url));
  } else if (isFont(url)) {
    event.respondWith(staleWhileRevalidate(req, STATIC));
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

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function fetchImage(url) {
  try {
    return await fetch(new Request(url, { mode: "cors", credentials: "omit" }));
  } catch (_) {
    return null;
  }
}

async function cachedImage(url) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(url);
  if (hit) return hit;
  const res = await fetchImage(url);
  if (res && res.ok) {
    await cache.put(url, res.clone());
    trim(cache, MAX_IMAGES);
    return res;
  }
  // CORS refused or offline: let the browser try it plainly, uncached.
  return fetch(url, { mode: "no-cors" });
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(IMAGES);
      for (const url of data.urls.slice(0, 40)) {
        try {
          if (!isImage(new URL(url)) || (await cache.match(url))) continue;
          const res = await fetchImage(url);
          if (res && res.ok) await cache.put(url, res);
        } catch (_) {
          /* skip it */
        }
      }
      await trim(cache, MAX_IMAGES);
    })()
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Acta Diurna", {
      body: data.body || "Today's lesson is out.",
      icon: "/acta-icon-192.png",
      badge: "/acta-badge-96.png",
      tag: "acta-daily",
      data: { url: data.url || "/acta" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/acta";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith("/acta") && "focus" in client) {
          await client.focus();
          return "navigate" in client ? client.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
