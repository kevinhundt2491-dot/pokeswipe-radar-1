// PokeSwipe & Radar – Service Worker: echte Web-Push-Nachrichten (auch bei geschlossener App)
// und Offline-Modus (App, Sammlung und Bilder bleiben auf Messen & Börsen ohne Netz verfügbar).
const VERSION = "v7";
const STATIC = `ps-static-${VERSION}`;
const API = "ps-api";
const IMG = "ps-img";
const PAGES = "ps-pages";
const SHELL = ["/", "/assets/app.js", "/assets/scan-worker.js", "/assets/tailwind.css", "/theme.css", "/fonts/fonts.css", "/icon.svg", "/manifest.json", "/icons/icon-192.png", "/icons/badge-96.png", "/card-fallback.svg"];
// Nur diese Daten werden für den Offline-Modus zwischengespeichert (beim Abmelden gelöscht)
// Phase 4: zusätzlich Offline-Katalog (Sets, Swipe-Stapel), Community-Feed, Bestellungen und öffentliche Profile
const OFFLINE_API = /^\/api\/(me|portfolio|wishlist|alerts|calendar|badges|listings|sets\/tracked|sealed|scan\/index|catalog\/(meta|sets)|swipe\/(sets|deck)|community\/(feed|me)|orders|market\/meta|me\/public-profile|u\/[^/?]+)(\?|$)/;
const CDN_HOSTS = ["www.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("ps-static-") && key !== STATIC) await caches.delete(key);
  await self.clients.claim();
})()));

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    const html = (res.headers.get("content-type") || "").includes("text/html");
    if (res.ok && (!fallbackUrl || html)) cache.put(fallbackUrl || req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(fallbackUrl || req);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => hit);
  if (hit) { event.waitUntil(update); return hit; }
  return update;
}

async function cacheFirstImage(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone()).then(async () => {
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - 400))) await cache.delete(k);
    }).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Nur die App selbst (/, /index.html, /shop/…) als Offline-Startseite – Server-Seiten wie /karte, /u, /p, /pokemon
    // dürfen nicht als Startseite zwischengespeichert werden
    if (req.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.startsWith("/shop/"))) {
      event.respondWith(networkFirst(req, STATIC, "/"));
    } else if (req.mode === "navigate" && /^\/(karte|u|p|set|sets|pokemon|sealed|trends)(\/|$)/.test(url.pathname)) {
      // Öffentliche Seiten: frisch laden, offline die zuletzt gesehene Version
      event.respondWith(networkFirst(req, PAGES).catch(async () => (await caches.match("/")) || Response.error()));
    } else if (url.pathname.startsWith("/.netlify/images") || url.pathname.startsWith("/api/images/")) {
      event.respondWith(cacheFirstImage(req));
    } else if (OFFLINE_API.test(url.pathname + url.search)) {
      event.respondWith(networkFirst(req, API));
    } else if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/vendor/")) {
      // Lokal gehostete Schriften & Leaflet: ändern sich praktisch nie
      event.respondWith(staleWhileRevalidate(event, req, STATIC));
    } else if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
      // Immer zuerst frisch laden (passt nach einem Update sofort zur Seite), offline aus dem Speicher
      event.respondWith(networkFirst(req, STATIC));
    }
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req, STATIC));
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "logout") event.waitUntil(caches.delete(API));
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "PokeSwipe & Radar", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "PokeSwipe & Radar";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    data: { url: typeof data.url === "string" && (data.url.startsWith("/") || data.url.startsWith("https://")) ? data.url : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin && url.startsWith("/")) {
        await client.focus();
        client.navigate(url).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
