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

var CACHE_VERSION = 'v19';  // Sprint 13 — settings drawer, header cleanup, dual sounds, haptics
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

/* The two files index.html loads with a ?v= query. GitHub Pages serves them
   with max-age=600 and no content hash, so an installed phone can keep an old
   copy in the HTTP cache; the query makes the new build a different URL that no
   stale entry can answer. MUST stay in step with the ?v= in index.html. */
var VERSIONED = { './styles.css': 1, './app.js': 1 };

function shellURL(url) {
  return VERSIONED[url] ? url + '?v=' + CACHE_VERSION : url;
}

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
          // cache:'reload' bypasses the HTTP cache, so an install always pulls
          // the build that was just deployed and never a max-age=600 leftover
          return cache.add(new Request(shellURL(url), { cache: 'reload' }))['catch'](function () { /* skip */ });
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

/* Always look inside THIS version's cache. The bare caches.match() searches
   every cache in the origin, so while an old benja-calendar-vNN is still
   around — install runs before activate evicts it — a stale app.js could win
   over the one that was just downloaded, and the phone would keep booting old
   code with a new worker in charge. */
function cacheHit(req) {
  return caches.open(CACHE_NAME).then(function (c) { return c.match(req); });
}

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
          return cacheHit(req).then(function (hit) {
            return hit || cacheHit('./index.html');
          });
        })
    );
    return;
  }

  // static assets: cache-first, refreshed in the background
  event.respondWith(
    cacheHit(req).then(function (hit) {
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
      // the OS tone can be silenced by a profile the app has no say in; the
      // app's own chime (below) is not subject to that
      silent: false,
      vibrate: [110, 60, 110],
      data: { url: payload.url },
      actions: [{ action: 'open', title: 'פתיחת היומן' }]
    }).then(chimeInClients)
  );
});

/**
 * A worker has no audio of its own — there is no AudioContext in this scope.
 * When a window is open it does have one, so the sound is delegated: the page
 * answers PUSH_CHIME by playing the same two-note bell a locally scheduled
 * reminder plays. With no window open the notification's own tone is all
 * there is, which is exactly what the platform intends.
 */
function chimeInClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      list.forEach(function (c) {
        try { c.postMessage({ type: 'PUSH_CHIME' }); } catch (e) { /* gone */ }
      });
    })['catch'](function () { /* no clients — the OS tone stands alone */ });
}

/**
 * Sprint 11 — a push subscription is not permanent.
 *
 * Browsers rotate an endpoint on their own schedule (a push service outage, a
 * profile reset, an app update). The old endpoint then starts answering 410
 * GONE and every reminder for this device silently stops — with no window open
 * to notice. This event is the browser's one warning, and the only place a
 * closed app can re-register itself, so it re-subscribes with the same
 * application key and hands the new endpoint straight back to the Worker.
 */
self.addEventListener('pushsubscriptionchange', function (event) {
  var old = event.oldSubscription || null;
  var key = (old && old.options && old.options.applicationServerKey) || null;

  event.waitUntil(
    Promise.resolve(event.newSubscription || (key
      ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      : null))
      .then(function (sub) {
        if (!sub) return null;
        var json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
        return fetch(new URL('./api/push/subscribe', self.location.href).href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            previous: old ? old.endpoint : ''
          })
        });
      })['catch'](function () { /* the page re-links on its next launch */ })
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
