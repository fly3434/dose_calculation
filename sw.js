'use strict';
// Bump the version whenever any cached application asset changes.
const CACHE = 'nsflow-app-v5';
// The host redirects index.html to ./; cache only the canonical, direct page.
const ASSETS = ['./', './styles.css', './calculator.js', './app.js', './manifest.webmanifest', './icon.svg', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
const urls = ASSETS.map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const legacyInstalled = (await caches.keys()).includes('nsflow-app-v1');
    const cache = await caches.open(CACHE);
    await cache.addAll(urls);
    // Repair v1 even when its navigation error prevents opening the update UI.
    // Later releases retain the explicit-update flow for working clients.
    if (legacyInstalled) await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('nsflow-app-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const ready = (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
      event.source?.postMessage({ type: ready ? 'OFFLINE_READY' : 'OFFLINE_UNAVAILABLE' });
    })());
  }
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isHome = url.pathname === new URL('./', self.registration.scope).pathname || url.pathname === new URL('./index.html', self.registration.scope).pathname;
  if (event.request.mode === 'navigate' && isHome) {
    // Serve HTML and JS from the same version. New versions wait for user update.
    event.respondWith((async () => {
      try {
        const cache = await caches.open(CACHE);
        const response = await cache.match(new URL('./', self.registration.scope).href);
        if (response) {
          // Navigation requests may have redirect:manual. Such requests reject
          // a cached response whose URL list records a followed redirect.
          return response.redirected
            ? new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers })
            : response;
        }
      } catch { /* A cache/storage failure must not block online navigation. */ }
      return fetch(event.request);
    })());
  } else if (urls.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
