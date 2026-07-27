/* ==========================================================================
   functions/api/gcal/_gcal.js — Google Calendar mapping layer (Sprint 6)

   Everything in this module is pure: no fetch, no D1, no env. That is the
   point — the mapping math (all-day boundaries, wall-clock slicing,
   last-write-wins) is the part that silently corrupts a calendar when it is
   wrong, so healthcheck.js executes this file for real and asserts the
   round-trip instead of grepping it.

   The two mappings the mandate fixes (PROJECT_PLAN §7.4e):

     Google primary calendar   ↔  category 'personal'
     Google business calendar  ↔  category 'business'

   Time model
     A local event stores wall-clock, never UTC (§3): 'YYYY-MM-DD' for an
     all-day record and 'YYYY-MM-DDTHH:MM' for a timed one. Google stores
     { date } for all-day and { dateTime, timeZone } for timed.

     * All-day: Google's `end.date` is EXCLUSIVE. A one-day event on the 27th
       is start 2026-07-27 / end 2026-07-28. Locally the same event is
       start_time = end_time = '2026-07-27'. Every conversion crosses that
       ±1 day boundary, and getting it wrong shifts every all-day event by a
       day — which is exactly what the healthcheck pins.
     * Timed: we slice the first 16 chars of the RFC-3339 instant, i.e. the
       wall-clock as Google already rendered it in the calendar's own zone.
       That is deterministic and needs no timezone database inside the Worker,
       and it is correct for a single-zone user (§0.4, Asia/Jerusalem).
   ========================================================================== */

/** the calendar keys, which are literally the two categories (§0.2) */
export const CALENDAR_KEYS = ['personal', 'business'];

/** the app is single-zone by §0.4; every pushed timed event carries it */
export const DEFAULT_TZ = 'Asia/Jerusalem';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';

/** the narrowest scope that still allows a two-way sync */
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** marks an event this app owns, so a pull can re-link one whose id was lost */
export const OWNER_PROP = 'benjaId';

/* ------------------------------------------------------- category mapping --- */

/** category → calendar key. Anything unknown is personal, exactly like §0.2. */
export function calendarKeyFor(category) {
  return category === 'business' ? 'business' : 'personal';
}

/** calendar key → category. The inverse of calendarKeyFor, and total. */
export function categoryFor(calendarKey) {
  return calendarKey === 'business' ? 'business' : 'personal';
}

/**
 * key → the Google calendar id to call.
 *   personal → 'primary'  (the account's own calendar, always present)
 *   business → GOOGLE_BUSINESS_CALENDAR_ID, falling back to 'primary' so a
 *              half-configured install syncs into one calendar rather than
 *              throwing on every request.
 */
export function calendarIdFor(calendarKey, env) {
  if (calendarKey !== 'business') return 'primary';
  const id = env && env.GOOGLE_BUSINESS_CALENDAR_ID;
  return (typeof id === 'string' && id.trim()) ? id.trim() : 'primary';
}

/* ------------------------------------------------------------- date math --- */

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 'YYYY-MM-DD' → the date part only; a timed stamp keeps its date half */
export function datePart(stamp) {
  const s = typeof stamp === 'string' ? stamp : '';
  const i = s.indexOf('T');
  return i === -1 ? s.slice(0, 10) : s.slice(0, i);
}

/** 'YYYY-MM-DDTHH:MM' → 'HH:MM'; an all-day stamp has no time half */
export function timePart(stamp) {
  const s = typeof stamp === 'string' ? stamp : '';
  const i = s.indexOf('T');
  return i === -1 ? '' : s.slice(i + 1, i + 6);
}

/** an all-day record is a bare date — no 'T', so no clock */
export function isAllDay(stamp) {
  return /^\d{4}-\d{2}-\d{2}$/.test(typeof stamp === 'string' ? stamp : '');
}

/** calendar-correct day stepping: rolls months, years and leap days */
export function addDays(dateISO, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dateISO === 'string' ? dateISO : '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + (typeof n === 'number' ? n : 0));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/** 'HH:MM' → minutes past midnight, or null when there is no clock */
export function minutesOf(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof hhmm === 'string' ? hhmm : '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * Add minutes to a wall-clock stamp, carrying into the next day when it wraps.
 * Used only to invent an end for a timed event that never got one — Google
 * rejects an event whose end is not after its start.
 */
export function shiftStamp(stamp, mins) {
  const date = datePart(stamp);
  const base = minutesOf(timePart(stamp));
  if (!date || base === null) return stamp;
  const total = base + (typeof mins === 'number' ? mins : 0);
  const dayShift = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  return addDays(date, dayShift) + 'T' + pad2(Math.floor(rest / 60)) + ':' + pad2(rest % 60);
}

/* ------------------------------------------------------- last-write-wins --- */

/** ISO-8601 instants sort lexically, so LWW is a string compare (§8.3) */
export function isNewer(a, b) {
  const x = typeof a === 'string' ? a : '';
  const y = typeof b === 'string' ? b : '';
  if (!x) return false;
  if (!y) return true;
  return x > y;
}

/** Google's own mtime for the event, normalised to the shape LWW compares */
export function googleUpdated(gev) {
  const raw = gev && typeof gev.updated === 'string' ? gev.updated : '';
  const ms = raw ? Date.parse(raw) : NaN;
  return isNaN(ms) ? '' : new Date(ms).toISOString();
}

/* ----------------------------------------------------- local → Google --- */

/**
 * A local events row → the Google Calendar resource body.
 *
 * All-day  start_time '2026-07-27', end_time '2026-07-27'
 *          → start { date: '2026-07-27' }, end { date: '2026-07-28' }  (exclusive)
 * Timed    start_time '2026-07-27T10:00', end_time '2026-07-27T11:30'
 *          → start { dateTime: '2026-07-27T10:00:00', timeZone: 'Asia/Jerusalem' }
 */
export function toGoogleEvent(row, tz) {
  if (!row || typeof row !== 'object') return null;
  const zone = tz || DEFAULT_TZ;

  const start = typeof row.start_time === 'string' ? row.start_time : '';
  if (!start) return null;
  const rawEnd = typeof row.end_time === 'string' ? row.end_time : '';

  const body = {
    summary: String(row.title == null ? '' : row.title),
    description: String(row.notes == null ? '' : row.notes),
    location: String(row.location == null ? '' : row.location),
    extendedProperties: { private: {} }
  };
  body.extendedProperties.private[OWNER_PROP] = String(row.id == null ? '' : row.id);

  if (isAllDay(start)) {
    // an all-day end is inclusive locally and exclusive on Google — always +1
    const lastDay = isAllDay(rawEnd) && rawEnd >= start ? rawEnd : start;
    body.start = { date: start };
    body.end = { date: addDays(lastDay, 1) };
    return body;
  }

  // a timed event needs an end strictly after its start, or Google 400s
  let end = rawEnd && !isAllDay(rawEnd) ? rawEnd : '';
  if (!end || end <= start) end = shiftStamp(start, 60);

  body.start = { dateTime: start + ':00', timeZone: zone };
  body.end = { dateTime: end + ':00', timeZone: zone };
  return body;
}

/* ----------------------------------------------------- Google → local --- */

/** { date } | { dateTime } → the local wall-clock stamp this app stores */
function stampOf(edge) {
  if (!edge || typeof edge !== 'object') return '';
  if (typeof edge.date === 'string' && edge.date) return edge.date.slice(0, 10);
  if (typeof edge.dateTime === 'string' && edge.dateTime) return edge.dateTime.slice(0, 16);
  return '';
}

/**
 * A Google Calendar resource → the columns of a local events row.
 *
 * Returns null for anything unusable. A cancelled Google event still maps —
 * `cancelled: true` tells the caller to tombstone the local row rather than
 * upsert it, which is how a delete made on a phone reaches this app (§8.4).
 */
export function fromGoogleEvent(gev, calendarKey) {
  if (!gev || typeof gev !== 'object' || typeof gev.id !== 'string' || !gev.id) return null;

  const cancelled = gev.status === 'cancelled';
  const start = stampOf(gev.start);
  const endRaw = stampOf(gev.end);

  let end = endRaw;
  if (isAllDay(start)) {
    // Google's exclusive end comes back to the inclusive last day we store
    end = isAllDay(endRaw) ? addDays(endRaw, -1) : start;
    if (!end || end < start) end = start;
  } else if (!end) {
    end = start;
  }

  const props = (gev.extendedProperties && gev.extendedProperties.private) || {};

  return {
    google_event_id: gev.id,
    etag: typeof gev.etag === 'string' ? gev.etag : '',
    local_id: typeof props[OWNER_PROP] === 'string' ? props[OWNER_PROP] : '',
    cancelled: cancelled,
    updated: googleUpdated(gev),
    row: {
      title: String(gev.summary == null ? '' : gev.summary),
      category: categoryFor(calendarKey),
      start_time: start,
      end_time: end,
      location: String(gev.location == null ? '' : gev.location),
      notes: String(gev.description == null ? '' : gev.description),
      category_type: 'event'
    }
  };
}

/**
 * Does the Google copy differ from the local row in any field we own?
 * A push that changes nothing still costs a quota unit and bumps Google's
 * `updated`, which would ping-pong the two sides forever under LWW.
 */
export function differs(row, mapped) {
  if (!row || !mapped || !mapped.row) return true;
  const g = mapped.row;
  return String(row.title || '') !== g.title ||
    String(row.location || '') !== g.location ||
    String(row.notes || '') !== g.notes ||
    String(row.start_time || '') !== g.start_time ||
    String(row.end_time || '') !== g.end_time;
}
