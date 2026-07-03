/* sw.js — service worker for HR-Interview PWA (Web Push).
 * Single SW at scope "/" covers every /t/<tid>/... page. It does NOT cache app
 * assets (server already sends no-cache; offline caching is out of scope here) —
 * it exists purely to receive push events and route notification clicks.
 * The push payload carries the destination URL (/t/<tid>/worklog) so one SW can
 * serve all tenants without any per-tenant state living in the worker.
 */

// Activate a new SW immediately (don't wait for old tabs to close), then take
// control of all open clients — so updated SW logic applies right after deploy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Incoming push → show a notification. Payload is JSON:
//   { title, body, data: { url } }
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = payload.title || '⏰ อย่าลืมบันทึกงาน';
  const options = {
    body: payload.body || 'มีชั่วโมงที่ยังไม่ได้กรอกงาน',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'worklog-reminder',   // same tag → replaces, avoids stacking
    renotify: true,
    data: payload.data || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click a notification → focus an existing tab on that URL if open, else open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // Match by path so a tab already on the worklog page is reused.
      if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
