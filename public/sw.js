/*
 * GetHomeApps service worker: phone notifications (Web Push).
 *
 * The server sends {id, title, body, url, unread}. This shows it on the
 * phone, keeps the app icon's badge in step with the Alerts screen, and tells
 * any open app window to refresh its alerts. Tapping it opens the alert's
 * item (and marks the alert read, through /alerts?open=<id>).
 *
 * Deliberately no caching or offline handling: it only does notifications.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GetHomeApps", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "GetHomeApps";
  const url = data.url || "/alerts";
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.id ? `alert-${data.id}` : undefined,
        data: { id: data.id, url },
      });
      if (typeof data.unread === "number" && self.navigator.setAppBadge) {
        try {
          if (data.unread > 0) await self.navigator.setAppBadge(data.unread);
          else await self.navigator.clearAppBadge();
        } catch {
          /* badges not supported here */
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: "alert", id: data.id, unread: data.unread });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { id, url } = event.notification.data || {};
  // Through the Alerts screen, which marks it read and then goes to the item.
  const target = id ? `/alerts?open=${encodeURIComponent(id)}&to=${encodeURIComponent(url || "/alerts")}` : url || "/alerts";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.focus();
          if ("navigate" in w) return w.navigate(target);
          w.postMessage({ type: "open", url: target });
          return;
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});
