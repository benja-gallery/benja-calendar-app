/* ==========================================================================
   functions/api/push/dispatch.js — the reminder dispatcher (Sprint 11)

   This is the route that fixes the field report. Everything the app did before
   this sprint ran inside a page: a 30-second setInterval that only exists
   while the app is on screen. Mobile Chrome freezes a backgrounded tab's
   timers within minutes, iOS suspends the whole process, and a closed PWA runs
   nothing at all — so a task scheduled for a moment when the app happened to be
   shut produced no notification and no sound, because nothing was running to
   produce one.

   The dispatcher is the same scan (`Notify.due()`), moved off the phone:

     GET   → dry run. Reports exactly what a POST would send, sends nothing and
             marks nothing. This is the diagnostic surface.
     POST  → send, and record what was sent.

   Both require PUSH_DISPATCH_SECRET. Until it is set the route answers 503 and
   sends nothing — it is never open, because an open dispatcher is a free
   notification cannon pointed at the owner's phone.

   Cloudflare PAGES FUNCTIONS CANNOT BE CRON-TRIGGERED — Pages compiles no
   scheduled handler. The clock therefore lives in a separate scheduled Worker
   (tools/push-cron-worker/), whose only job is to POST here every minute.
   ========================================================================== */

import { ok, fail, preflight, db, nowISO, OWNER_ID } from '../_shared.js';
import { sendPush } from './_webpush.js';

/* The reminder vocabulary, identical to app.js REMIND_MINUTES. Both ends read
   the same remind_key column, so a lead that means 15 minutes on the phone has
   to mean 15 minutes here — otherwise the two engines announce the same record
   at different times and the user gets it twice. */
const REMIND_MINUTES = { at: 0, '15': 15, '60': 60, '1440': 1440 };
const CLOSED_STATUSES = ['done', 'cancelled'];

const DEFAULT_LEAD_MIN = 10;      // mirrors prefs.notify.lead's default
const MISS_GRACE_MIN = 20;        // mirrors app.js MISS_GRACE_MIN
const MAX_SENDS = 60;             // a single run is a minute of work, not a broadcast

/* ------------------------------------------------------------- time model --- */

/**
 * Wall-clock now in the app's timezone.
 *
 * A local record stores wall clock, never UTC (PROJECT_PLAN §3): an event is
 * '2026-07-28T09:00' in Israel and means 09:00 in Israel. The dispatcher runs
 * in UTC, so it asks Intl for the local face of the same instant rather than
 * doing offset arithmetic — which is also how it stays correct across DST
 * without a table of transition dates.
 */
function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());

  const g = {};
  for (const p of parts) g[p.type] = p.value;
  // some engines render midnight as hour 24 under hour12:false
  const h = parseInt(g.hour, 10) % 24;
  return {
    date: g.year + '-' + g.month + '-' + g.day,
    minutes: h * 60 + parseInt(g.minute, 10)
  };
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/* ---------------------------------------------------------------- selector --- */

/** null = this record is muted; a number = its window in minutes */
function leadOf(key, fallback) {
  if (key === 'none') return null;
  if (Object.prototype.hasOwnProperty.call(REMIND_MINUTES, key)) return REMIND_MINUTES[key];
  return fallback;                       // 'default', '', null, or anything unknown
}

function phrase(gap) {
  if (gap < 0) return 'התחיל לפני ' + (-gap) + ' דק׳';
  if (gap === 0) return 'מתחיל עכשיו';
  if (gap < 60) return 'בעוד ' + gap + ' דק׳';
  if (gap < 1440) return 'בעוד ' + Math.round(gap / 60) + ' שע׳';
  return 'מחר';
}

/**
 * Everything whose own lead window is open right now — the server-side twin of
 * app.js `Notify.due()`, scanning today and tomorrow for the same reason (a
 * "יום לפני" lead is 1440 minutes, so it is raised on the day before).
 *
 * The window is `-MISS_GRACE_MIN <= gap <= lead`. Late but recent still
 * delivers; early never does. A hard `gap < 0` was the bug that swallowed any
 * reminder the scan reached even a minute after its start time.
 */
export function selectDue(rows, now, defaultLead) {
  const horizon = addDaysISO(now.date, 1);
  const out = [];

  function gapTo(date, time) {
    const at = timeToMinutes(time);
    if (at === null) return null;
    const day = date === now.date ? 0 : (date === horizon ? 1 : -1);
    if (day === -1) return null;
    return day * 1440 + at - now.minutes;
  }

  for (const e of rows.events) {
    const window_ = leadOf(e.remind_key, defaultLead);
    if (window_ === null) continue;
    const stamp = String(e.start_time || '');
    const cut = stamp.indexOf('T');
    if (cut === -1) continue;                       // all-day: no clock to lead from
    const gap = gapTo(stamp.slice(0, cut), stamp.slice(cut + 1, cut + 6));
    if (gap === null || gap > window_ || gap < -MISS_GRACE_MIN) continue;
    out.push({
      id: e.id,
      on: stamp.slice(0, cut),
      title: 'פגישה ' + phrase(gap),
      body: (e.title || 'פגישה') + ' · ' + stamp.slice(cut + 1, cut + 6) +
        (e.location ? ' · ' + e.location : '')
    });
  }

  for (const t of rows.tasks) {
    if (CLOSED_STATUSES.indexOf(t.status) !== -1) continue;   // הושלם / בוטל
    const window_ = leadOf(t.remind_key, defaultLead);
    if (window_ === null) continue;
    const gap = gapTo(String(t.due_date || ''), String(t.due_time || ''));
    if (gap === null || gap > window_ || gap < -MISS_GRACE_MIN) continue;
    out.push({
      id: t.id,
      on: String(t.due_date),
      title: 'משימה ' + phrase(gap),
      body: (t.title || 'משימה') + ' · ' + t.due_time
    });
  }

  return out;
}

/* -------------------------------------------------------------------- auth --- */

/** length-independent compare — a secret must not leak through timing */
function secretMatches(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorised(request, env) {
  const secret = env.PUSH_DISPATCH_SECRET;
  if (!secret) return 'unconfigured';
  const header = request.headers.get('Authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  const url = new URL(request.url);
  const given = bearer ? bearer[1] : (url.searchParams.get('key') || '');
  return secretMatches(given, secret) ? 'ok' : 'denied';
}

/* --------------------------------------------------------------------- run --- */

async function scan(env) {
  const binding = db(env);
  const tz = env.APP_TIMEZONE || 'Asia/Jerusalem';
  const now = localNow(tz);
  const defaultLead = parseInt(env.PUSH_DEFAULT_LEAD, 10) >= 0
    ? parseInt(env.PUSH_DEFAULT_LEAD, 10) : DEFAULT_LEAD_MIN;

  const until = addDaysISO(now.date, 2);   // exclusive — covers today + tomorrow

  const events = await binding.prepare(
    'SELECT id, title, start_time, location, remind_key FROM events ' +
    'WHERE deleted_at IS NULL AND owner_id = ? AND start_time >= ? AND start_time < ?'
  ).bind(OWNER_ID, now.date, until).all();

  const tasks = await binding.prepare(
    'SELECT id, title, due_date, due_time, status, remind_key FROM tasks ' +
    'WHERE deleted_at IS NULL AND owner_id = ? AND due_date >= ? AND due_date < ?'
  ).bind(OWNER_ID, now.date, until).all();

  const rows = {
    events: (events && events.results) || [],
    tasks: (tasks && tasks.results) || []
  };

  const due = selectDue(rows, now, defaultLead);

  /* The ledger, keyed by the record's OWN date exactly as the client keys
     prefs.fired. Keyed by today instead, a day-before reminder would be swept
     overnight and fire again in the morning. */
  const fresh = [];
  for (const item of due) {
    const key = item.id + '@' + item.on;
    const seen = await binding.prepare('SELECT key FROM push_dispatch WHERE key = ?').bind(key).first();
    if (!seen) fresh.push(Object.assign({ key: key }, item));
  }

  return { now: now, tz: tz, defaultLead: defaultLead, scanned: rows.events.length + rows.tasks.length, due: due, fresh: fresh };
}

export async function onRequestOptions() {
  return preflight();
}

/** dry run — the diagnostic surface. Sends nothing, marks nothing. */
export async function onRequestGet(context) {
  const { request, env } = context;
  const state = authorised(request, env);
  if (state === 'unconfigured') {
    return fail('push_not_configured', 'PUSH_DISPATCH_SECRET is not set on this deployment', 503);
  }
  if (state !== 'ok') return fail('unauthorised', 'a valid dispatch secret is required', 401);

  let found, devices;
  try {
    found = await scan(env);
    devices = await db(env)
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE disabled_at IS NULL').first();
  } catch (e) {
    return fail('db_error', e.message, 500);
  }

  return ok({
    dryRun: true,
    localTime: found.now.date + ' ' + String(Math.floor(found.now.minutes / 60)).padStart(2, '0') +
      ':' + String(found.now.minutes % 60).padStart(2, '0'),
    timezone: found.tz,
    defaultLead: found.defaultLead,
    vapid: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    devices: (devices && devices.n) || 0,
    scanned: found.scanned,
    due: found.due.length,
    wouldSend: found.fresh.map(f => ({ key: f.key, title: f.title, body: f.body }))
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const state = authorised(request, env);
  if (state === 'unconfigured') {
    return fail('push_not_configured', 'PUSH_DISPATCH_SECRET is not set on this deployment', 503);
  }
  if (state !== 'ok') return fail('unauthorised', 'a valid dispatch secret is required', 401);
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return fail('push_not_configured', 'VAPID keys are not set on this deployment', 503);
  }

  let binding, found, devices;
  try {
    binding = db(env);
    found = await scan(env);

    // yesterday's marks are dead weight; a mark for tomorrow is still working
    await binding.prepare('DELETE FROM push_dispatch WHERE on_date < ?').bind(found.now.date).run();

    const subs = await binding.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE disabled_at IS NULL'
    ).all();
    devices = (subs && subs.results) || [];
  } catch (e) {
    return fail('db_error', e.message, 500);
  }

  const at = nowISO();

  let sent = 0, failed = 0, retired = 0;
  const batch = found.fresh.slice(0, MAX_SENDS);

  for (const item of batch) {
    let delivered = 0;

    for (const sub of devices) {
      const res = await sendPush(sub, {
        title: item.title,
        body: item.body,
        tag: item.key,
        url: './index.html'
      }, env);

      if (res.ok) {
        delivered++;
        await binding.prepare('UPDATE push_subscriptions SET last_sent_at = ?, fail_count = 0 WHERE id = ?')
          .bind(at, sub.id).run();
      } else if (res.gone) {
        // the push service says this endpoint is finished; retrying it every
        // minute would spend the whole run on a device that no longer exists
        retired++;
        await binding.prepare('UPDATE push_subscriptions SET disabled_at = ? WHERE id = ?')
          .bind(at, sub.id).run();
      } else {
        failed++;
        await binding.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?')
          .bind(sub.id).run();
      }
    }

    /* Marked only once something actually landed. Marking on attempt would let
       a push-service outage silently consume the reminder: the ledger would
       say "sent", the phone would have nothing, and the next run would skip
       it. An unsent reminder stays due. */
    if (delivered > 0) {
      sent++;
      await binding.prepare(
        'INSERT INTO push_dispatch (key, owner_id, on_date, sent_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO NOTHING'
      ).bind(item.key, OWNER_ID, item.on, at).run();
    }
  }

  return ok({
    localTime: found.now.date,
    devices: devices.length,
    scanned: found.scanned,
    due: found.due.length,
    fresh: found.fresh.length,
    sent: sent,
    failed: failed,
    retired: retired,
    skipped: Math.max(0, found.fresh.length - batch.length)
  });
}
