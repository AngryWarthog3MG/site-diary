/*
 * Service worker for the site diary.
 *
 * Sites have bad signal (brief §2.6), so the app shell has to open without a
 * network. Two rules:
 *
 *   * Static build assets are cache-first — they are content-hashed, so a hit
 *     is always correct.
 *   * Pages are network-first with a cache fallback, because they carry the
 *     supervisor's own data and a stale one is only ever a last resort.
 *
 * Nothing under /api or /auth is ever cached: those are session-bearing, and a
 * cached response would be both wrong and a disclosure risk. The page cache is
 * cleared on sign-out by the client (see sign-out-button.tsx).
 */

// v3: purge every cache from the pilot week. The page cache repeatedly served
// stale app shells to the one real phone in the field — three separate
// debugging sessions traced back to it. Offline still works (network-first
// with fallback), but a version bump now nukes old caches on activate.
const VERSION = 'v4';
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGES).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') ||
      url.pathname.endsWith('.png') ||
      url.pathname === '/pcm-worklet.js' ||
      url.pathname.endsWith('.webmanifest'))
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGES).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(OFFLINE_URL)),
    );
  }
});

/**
 * The knock-off reminder arrives here. The payload is JSON from our own
 * sender; anything malformed falls back to a plain nudge.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Site Diary', {
      body: data.body || 'No diary entry for today yet.',
      tag: data.tag || 'knock-off',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) {
          win.navigate(url);
          return win.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
