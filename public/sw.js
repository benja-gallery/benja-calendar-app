/* ==========================================================================
   sw.js — service worker for "מה הלו"ז — Benja"

   Responsibilities
   1. Pre-cache the core shell so the app opens instantly and works offline.
   2. Serve navigations network-first (fresh code wins) with an offline
      fallback to the cached shell.
   3. Serve same-origin static assets stale-while-revalidate.
   4. Receive background push messages and surface them through
      self.registration.showNotification().

   Bump CACHE_VERSION on every shipped change to the core shell.
   ========================================================================== */

'use strict';

var CACHE_VERSION = 'v12';  // Sprint 9 — in-place strikethrough, היסטוריה, no shake
var CACHE_NAME = 'benja-calendar-' + CACHE_VERSION;

/* relative URLs — keeps the worker correct under a GitHub Pages sub-path */
var CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png'
];

var NOTIFY_ICON = './icons/icon-192.png';
var NOTIFY_BADGE = './icons/favicon-32.png';

/* ------------------------------------------------------------- lifecycle */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        // addAll is all-or-nothing; cache each asset so one 404 cannot
        // abort the whole install and leave the app uncached.
        return Promise.all(CORE_ASSETS.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' }))['catch'](function () { /* skip */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE_NAME ? null : caches['delete'](k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* page asks the waiting worker to take over immediately after an update */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ----------------------------------------------------------------- fetch */

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;          // never cache 3rd party

  // the sync API is live data — a cached /api/* response would hand the client
  // a stale delta and silently stall the outbox (Sprint 5)
  if (url.pathname.indexOf('/api/') !== -1) return;

  // navigations: network-first, fall back to the cached shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
          return res;
        })
        ['catch'](function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // static assets: cache-first, refreshed in the background
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return hit; });
      return hit || network;
    })
  );
});

/* ------------------------------------------------------------------ push */

self.addEventListener('push', function (event) {
  var payload = { title: 'יומן חכם — Benja', body: 'יש לך תזכורת חדשה.', url: './index.html' };

  if (event.data) {
    try {
      var parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload.title = parsed.title || payload.title;
        payload.body = parsed.body || parsed.message || payload.body;
        payload.url = parsed.url || payload.url;
        payload.tag = parsed.tag;
      }
    } catch (e) {
      payload.body = event.data.text() || payload.body;      // plain-text push
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: NOTIFY_ICON,
      badge: NOTIFY_BADGE,
      dir: 'rtl',
      lang: 'he',
      tag: payload.tag || 'benja-push',
      renotify: !!payload.tag,
      vibrate: [110, 60, 110],
      data: { url: payload.url },
      actions: [{ action: 'open', title: 'פתיחת היומן' }]
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      return self.clients.openWindow(new URL(target, self.location.href).href);
    })
  );
});
