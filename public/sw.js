/* ==========================================================================
   sw.js — service worker for "מה הלו"ז — Benja"

   Responsibilities
   1. Pre-cache the core shell so the app opens instantly and works offline.
   2. Serve navigations network-first (fresh code wins) with an offline
      fallback to the cached shell.
   3. Serve same-origin static assets stale-while-revalidate.
   4. Receive background push messages and surface them through
      self.registration.showNotification().
   5. Sprint 19 — carry the ALARM across the gap. A push that arrives with the
      app closed is the only half of a reminder the platform will run, so the
      notification it raises is the alarm's own: the mandated vibration beat,
      requireInteraction so it stays on the lock screen until it is acted on,
      and a payload that survives the tap and becomes the full-screen alarm
      overlay the moment a window exists to paint it.

   Bump CACHE_VERSION on every shipped change to the core shell.
   ========================================================================== */

'use strict';

var CACHE_VERSION = 'v25';  // Sprint 19 — the background alarm clock
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

/* Sprint 19 — the mandated alarm beat, the exact twin of app.js ALARM_VIBE.
   A background reminder is the ONE the user cannot see coming, so the pattern
   the OS plays for it is the alarm's, not the polite three-tick a foreground
   notification used to carry. */
var ALARM_VIBE = [1000, 500, 1000, 500];

/* The hash a COLD launch arrives on. A phone with no window open has nothing
   to postMessage, so the alarm rides the URL the tap opens instead, and app.js
   raises it from there. Kept in step with app.js ALARM_HASH. */
var ALARM_HASH = 'alarm';

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

/**
 * The alarm block a dispatched reminder carries, trusted no further than its
 * own shape. It is JSON off the network, it ends up on a screen, and the one
 * field that actually has to be there is the ledger key — without it the page
 * cannot de-duplicate a push against the same reminder its own scan raised.
 *
 * Everything else is normalised again by app.js normAlarms() before it paints,
 * so this is a courier, never an authority.
 */
function alarmOf(parsed) {
  var a = parsed && typeof parsed === 'object' ? (parsed.alarm || null) : null;
  if (!a || typeof a !== 'object' || !a.key) return null;
  return {
    key: String(a.key),
    id: String(a.id || ''),
    collection: String(a.collection || ''),
    cat: String(a.cat || ''),
    kind: String(a.kind || ''),
    clock: String(a.clock || ''),
    subject: String(a.subject || ''),
    title: String(a.title || parsed.title || ''),
    body: String(a.body || parsed.body || ''),
    alert: {
      sound: String((a.alert && a.alert.sound) || ''),
      vibe: String((a.alert && a.alert.vibe) || '')
    }
  };
}

/** './index.html' + the alarm, for the launch that has no window to talk to */
function alarmURL(url, alarm) {
  var base = String(url || './index.html').split('#')[0];
  if (!alarm) return base;
  try {
    return base + '#' + ALARM_HASH + '=' + encodeURIComponent(JSON.stringify(alarm));
  } catch (e) {
    return base;                       // unserialisable — the app still opens
  }
}

self.addEventListener('push', function (event) {
  var payload = { title: 'יומן חכם — Benja', body: 'יש לך תזכורת חדשה.', url: './index.html' };
  var alarm = null;

  if (event.data) {
    try {
      var parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload.title = parsed.title || payload.title;
        payload.body = parsed.body || parsed.message || payload.body;
        payload.url = parsed.url || payload.url;
        payload.tag = parsed.tag;
        alarm = alarmOf(parsed);
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
      // a second reminder re-alerts rather than silently replacing the first
      renotify: true,
      // the OS tone can be silenced by a profile the app has no say in; the
      // app's own chime (below) is not subject to that
      silent: false,
      vibrate: ALARM_VIBE,
      /* Sprint 19 — this is an alarm, not an FYI. It stays on the lock screen
         until a finger acts on it; an auto-dismissed reminder for a meeting
         the phone was asleep through is exactly the failure being fixed. */
      requireInteraction: true,
      // the payload has to survive the tap: notificationclick is where a cold
      // launch learns which reminder it is opening for
      data: { url: payload.url, alarm: alarm },
      actions: [{ action: 'open', title: '⏰ פתיחת ההתראה' }]
    }).then(function () { return wakeClients(alarm); })
  );
});

/**
 * A worker has no audio of its own — there is no AudioContext in this scope.
 * When a window is open it does have one, so the sound is delegated.
 *
 * With an alarm block the page is asked for the whole alarm (PUSH_ALARM): the
 * full-screen overlay rings on its own loop and would fight a one-shot chime,
 * so the two messages are alternatives rather than a pair. Without one — a
 * plain push from some other sender — the old PUSH_CHIME is still exactly
 * right. With no window open at all, the notification's own tone and the
 * vibration are what the platform intends to carry it.
 */
function wakeClients(alarm) {
  var msg = alarm ? { type: 'PUSH_ALARM', alarm: alarm } : { type: 'PUSH_CHIME' };
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (list) {
      list.forEach(function (c) {
        try { c.postMessage(msg); } catch (e) { /* gone */ }
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

/**
 * Sprint 19 — the tap has to land on the ALARM, not merely on the app.
 *
 * A background notification is a message the OS drew; the alarm screen is the
 * thing that actually keeps ringing until it is dismissed. Tapping the
 * notification therefore has to end at that screen either way:
 *
 *   a window is already open → focus it and hand it the alarm over
 *                              postMessage, which Notify's message listener
 *                              turns straight into Alarm.raise();
 *   nothing is open          → open one on '#alarm=<payload>', which app.js
 *                              reads on boot and raises from there.
 *
 * Both paths converge on the same overlay with the same ביטול התראה button,
 * and the ledger key inside the payload is what stops a reminder the local
 * scan already raised from being raised a second time.
 */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var alarm = data.alarm || null;
  var target = alarmURL(data.url || './index.html', alarm);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(self.location.origin) !== 0 || !('focus' in client)) continue;

        var focused;
        try { focused = client.focus(); } catch (e) { focused = null; }
        // focus() is a promise in a current browser and was a plain return in
        // an older one; the alarm must be handed over either way
        return Promise.resolve(focused)['catch'](function () { return null; })
          .then(function (win) {
            var open = win || client;
            if (alarm) {
              try { open.postMessage({ type: 'PUSH_ALARM', alarm: alarm }); } catch (e2) { /* gone */ }
            }
            return open;
          });
      }
      return self.clients.openWindow(new URL(target, self.location.href).href);
    })
  );
});
