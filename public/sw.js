// PokeSwipe & Radar – Service Worker für echte Web-Push-Nachrichten (auch bei geschlossener App)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "PokeSwipe & Radar", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "PokeSwipe & Radar";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
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
