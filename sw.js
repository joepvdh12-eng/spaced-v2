// SPACED Service Worker — PWA offline support
// CACHE version bumped on every deploy that changes app pages/scripts. Bumping it forces
// old cached HTML/JS to be dropped (see 'activate' below) so a new deploy is never masked
// by a stale cache — this was the reason updates didn't seem to show up after deploying.
const CACHE = 'spaced-v4';
const STATIC = [
  '/',
  '/index.html',
  '/app/auth.html',
  '/app/dashboard.html',
  '/app/coach.html',
  '/app/onboarding.html',
  '/app/progress.html',
  '/app/settings.html',
  '/app/config.js',
  '/i18n.js',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Exo+2:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // API/data calls: always go to the network, cache is only an offline fallback.
  if (e.request.url.includes('supabase') || e.request.url.includes('.netlify/functions')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // App pages and scripts: network-first, so a new deploy is visible on the very next
  // load instead of being masked by whatever was cached before it. Falls back to the
  // cache only when actually offline.
  const isAppFile = e.request.mode === 'navigate' || /\.(html|js)$/.test(new URL(e.request.url).pathname);
  if (isAppFile) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else (fonts, CDN libs, images): cache-first, refreshed in the background.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || net;
    })
  );
});

// Push notifications for workout reminders
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'SPACED', body: "Time to train! 💪" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'workout-reminder',
      data: { url: '/app/dashboard.html' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/app/dashboard.html'));
});
