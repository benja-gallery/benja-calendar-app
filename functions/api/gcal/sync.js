/* ==========================================================================
   /api/gcal/sync — Google Calendar two-way synchronisation (Sprint 6)

     GET  /api/gcal/sync   → { connected, calendars:[{key, lastSyncAt, …}] }
     POST /api/gcal/sync   → runs one full cycle and reports what moved

   One cycle, per mapped calendar, in this order and never any other:

     1. PULL   incremental, using Google's syncToken. The first run (or a 410
               GONE, which is how Google retires a stale token) falls back to a
               bounded window instead of the whole history.
     2. PUSH   every local event that is new, edited or deleted since the last
               cycle — minus anything the pull just touched, so a row can never
               be pushed straight back at the calendar it arrived from.
     3. STAMP  store the new syncToken and last_sync_at.

   Conflict resolution is last-write-wins on ISO-8601 instants (§8.3), the same
   rule /api/sync already applies between devices: Google's `updated` against
   the row's `updated_at`, compared as strings because ISO sorts lexically.
   A push carries the stored ETag as an If-Match precondition, so the 412 case
   is detected rather than silently overwritten.

   Writing google_event_id / etag / google_calendar_id back onto a row
   deliberately does NOT bump updated_at: the bookkeeping is not a user edit,
   and bumping it would re-select the row on the next cycle forever.
   ========================================================================== */

import { ok, fail, preflight, db, nowISO, isISO, upsertRow, SCHEMA, OWNER_ID } from '../_shared.js';
import {
  CALENDAR_KEYS, calendarIdFor, calendarKeyFor, fromGoogleEvent, toGoogleEvent,
  isNewer, differs, DEFAULT_TZ
} from './_gcal.js';
import { isConfigured, loadAccount, isConnected, loadState, saveState, gfetch } from './_token.js';

/** most events one pull page returns */
const PAGE_SIZE = 250;
/** hard stop on pagination — a runaway pull must not burn the whole CPU budget */
const MAX_PAGES = 6;
/** most local events one cycle pushes per calendar; the rest ride the next run */
const MAX_PUSH = 100;
/** how far back a first-ever (or post-410) full resync reaches */
const BOOTSTRAP_DAYS = 180;

export const onRequestOptions = () => preflight();

export const onRequestGet = async (ctx) => {
  let binding;
  try { binding = db(ctx.env); }
  catch (e) { return fail('no_binding', e.message, 500); }

  const account = isConfigured(ctx.env) ? await loadAccount(binding) : null;
  const calendars = [];
  for (const key of CALENDAR_KEYS) {
    const st = await loadState(binding, key);
    calendars.push({
      key: key,
      lastSyncAt: (st && st.last_sync_at) || '',
      incremental: !!(st && st.sync_token)
    });
  }

  return ok({
    configured: isConfigured(ctx.env),
    connected: isConnected(account),
    calendars: calendars
  });
};

export const onRequestPost = async (ctx) => {
  let binding;
  try { binding = db(ctx.env); }
  catch (e) { return fail('no_binding', e.message, 500); }

  if (!isConfigured(ctx.env)) {
    return fail('gcal_not_configured',
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on this deployment', 503);
  }

  const account = await loadAccount(binding);
  if (!isConnected(account)) {
    return fail('not_connected', 'connect Google Calendar first (/api/gcal/auth?action=start)', 409);
  }

  const at = nowISO();
  const totals = { pulled: 0, pushed: 0, deleted: 0, conflicts: 0 };
  const calendars = [];
  const errors = [];

  for (const key of CALENDAR_KEYS) {
    try {
      const report = await syncCalendar(ctx, binding, account, key, at);
      totals.pulled += report.pulled;
      totals.pushed += report.pushed;
      totals.deleted += report.deleted;
      totals.conflicts += report.conflicts;
      calendars.push(report);
    } catch (e) {
      // one broken calendar must not cost the other one its cycle
      errors.push({ calendar: key, error: (e && e.message) || 'sync failed' });
    }
  }

  return ok({
    pulled: totals.pulled,
    pushed: totals.pushed,
    deleted: totals.deleted,
    conflicts: totals.conflicts,
    calendars: calendars,
    errors: errors,
    lastSyncAt: calendars.length ? at : '',
    now: nowISO()
  });
};

/* ========================================================== one calendar === */

async function syncCalendar(ctx, binding, account, key, at) {
  const calId = calendarIdFor(key, ctx.env);
  const state = await loadState(binding, key);
  const since = (state && isISO(state.last_sync_at)) ? state.last_sync_at : '';

  const pull = await pullCalendar(ctx, binding, account, key, calId, state);
  const push = await pushCalendar(ctx, binding, account, key, calId, since, pull.touched);

  await saveState(binding, key, calId, pull.syncToken, at);

  return {
    key: key,
    pulled: pull.applied,
    pushed: push.pushed,
    deleted: push.deleted,
    conflicts: pull.conflicts + push.conflicts,
    incremental: pull.incremental,
    lastSyncAt: at
  };
}

/* ------------------------------------------------------------------ pull --- */

async function pullCalendar(ctx, binding, account, key, calId, state) {
  const touched = new Set();
  let applied = 0, conflicts = 0;
  let syncToken = (state && state.sync_token) || '';
  let incremental = !!syncToken;
  let pageToken = '';
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;

    const qs = new URLSearchParams({
      maxResults: String(PAGE_SIZE),
      showDeleted: 'true',
      singleEvents: 'true'
    });
    if (pageToken) qs.set('pageToken', pageToken);
    else if (syncToken) qs.set('syncToken', syncToken);
    else qs.set('timeMin', new Date(Date.now() - BOOTSTRAP_DAYS * 86400000).toISOString());

    const res = await gfetch(binding, ctx.env, account,
      '/calendars/' + encodeURIComponent(calId) + '/events?' + qs.toString());

    if (res.status === 410) {
      // the sync token expired — start the window over, exactly once
      if (!syncToken) throw new Error('google returned 410 without a sync token');
      syncToken = '';
      incremental = false;
      pageToken = '';
      continue;
    }
    if (!res.ok) throw new Error('google events.list ' + res.status + ': ' + (await safeText(res)));

    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];

    for (const gev of items) {
      const verdict = await applyIncoming(binding, key, calId, gev);
      if (verdict.conflict) conflicts++;
      // `touched` suppresses the push half, so only a row this pull actually
      // WROTE belongs in it. A row we declined to overwrite because the local
      // copy was newer is exactly the row the push half has to send.
      if (verdict.applied) { applied++; touched.add(verdict.id); }
    }

    pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
    if (typeof body.nextSyncToken === 'string' && body.nextSyncToken) syncToken = body.nextSyncToken;
    if (!pageToken) break;
  }

  return { applied, conflicts, touched, syncToken, incremental };
}

/** one inbound Google event → the local row, last-write-wins */
async function applyIncoming(binding, key, calId, gev) {
  const mapped = fromGoogleEvent(gev, key);
  if (!mapped) return { applied: false, conflict: false, id: '' };

  const local = await findLocal(binding, mapped.google_event_id, mapped.local_id);

  if (mapped.cancelled) {
    if (!local) return { applied: false, conflict: false, id: '' };
    const stamp = mapped.updated || nowISO();
    await binding
      .prepare('UPDATE events SET deleted_at = ?, updated_at = ?, google_event_id = NULL, ' +
        'etag = NULL WHERE id = ? AND updated_at <= ?')
      .bind(stamp, stamp, local.id, stamp)
      .run();
    return { applied: true, conflict: false, id: local.id };
  }

  // §8.3 — the newer instant wins. A local row Google has not caught up with
  // is left alone here and goes out in the push half of this same cycle.
  if (local && !isNewer(mapped.updated, local.updated_at)) {
    return { applied: false, conflict: true, id: local.id };
  }

  const id = local ? local.id : (mapped.local_id || newId());
  const stamp = mapped.updated || nowISO();
  const row = blankEventRow();

  Object.assign(row, mapped.row, {
    id: id,
    client_id: local ? (local.client_id || '') : '',
    updated_at: stamp,
    owner_id: (local && local.owner_id) || OWNER_ID,
    created_at: (local && local.created_at) || stamp,
    deleted_at: null,
    google_event_id: mapped.google_event_id,
    etag: mapped.etag,
    google_calendar_id: calId
  });

  await upsertRow(binding, 'events', row);
  return { applied: true, conflict: false, id: id };
}

/* ------------------------------------------------------------------ push --- */

async function pushCalendar(ctx, binding, account, key, calId, since, skip) {
  let pushed = 0, deleted = 0, conflicts = 0;

  /* ---- deletions first: a tombstone must reach Google before anything else
          re-creates the slot it occupied ---- */
  const gone = await binding
    .prepare("SELECT * FROM events WHERE deleted_at IS NOT NULL AND deleted_at != '' " +
      "AND google_event_id IS NOT NULL AND google_event_id != '' LIMIT ?")
    .bind(MAX_PUSH)
    .all();

  for (const row of (gone.results || [])) {
    const on = row.google_calendar_id || calendarIdFor(calendarKeyFor(row.category), ctx.env);
    if (on !== calId) continue;                       // the other calendar owns it

    const res = await gfetch(binding, ctx.env, account,
      '/calendars/' + encodeURIComponent(on) + '/events/' + encodeURIComponent(row.google_event_id),
      { method: 'DELETE' });

    // 404/410 means it is already gone — the outcome we wanted either way
    if (res.ok || res.status === 404 || res.status === 410) {
      await clearGoogleRef(binding, row.id);
      deleted++;
    } else {
      throw new Error('google events.delete ' + res.status + ': ' + (await safeText(res)));
    }
  }

  /* ---- new and edited rows ---- */
  const live = await binding
    .prepare("SELECT * FROM events WHERE (deleted_at IS NULL OR deleted_at = '') AND category = ? " +
      "AND (google_event_id IS NULL OR google_event_id = '' OR updated_at > ?) " +
      'ORDER BY updated_at ASC LIMIT ?')
    .bind(key, since || '', MAX_PUSH)
    .all();

  for (const row of (live.results || [])) {
    if (skip.has(row.id)) continue;                   // this cycle's pull wrote it
    const body = toGoogleEvent(row, DEFAULT_TZ);
    if (!body) continue;                              // a dateless row has nothing to place

    const on = row.google_calendar_id || '';
    const gid = row.google_event_id || '';

    // the category flipped — the event has to move calendars, not fork into two
    if (gid && on && on !== calId) {
      await gfetch(binding, ctx.env, account,
        '/calendars/' + encodeURIComponent(on) + '/events/' + encodeURIComponent(gid),
        { method: 'DELETE' });
      await insertEvent(ctx, binding, account, row, calId, body);
      pushed++;
      continue;
    }

    if (!gid) {
      await insertEvent(ctx, binding, account, row, calId, body);
      pushed++;
      continue;
    }

    const verdict = await patchEvent(ctx, binding, account, row, calId, body, key);
    if (verdict.pushed) pushed++;
    if (verdict.conflict) conflicts++;
  }

  return { pushed, deleted, conflicts };
}

async function insertEvent(ctx, binding, account, row, calId, body) {
  const res = await gfetch(binding, ctx.env, account,
    '/calendars/' + encodeURIComponent(calId) + '/events',
    { method: 'POST', body: JSON.stringify(body) });

  if (!res.ok) throw new Error('google events.insert ' + res.status + ': ' + (await safeText(res)));
  const created = await res.json();
  await setGoogleRef(binding, row.id, created.id, created.etag || '', calId);
}

async function patchEvent(ctx, binding, account, row, calId, body, key) {
  const path = '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(row.google_event_id);
  const headers = row.etag ? { 'If-Match': row.etag } : {};

  let res = await gfetch(binding, ctx.env, account, path,
    { method: 'PATCH', body: JSON.stringify(body), headers: headers });

  if (res.status === 412) {
    // the ETag no longer matches: Google changed underneath us. Re-read and let
    // last-write-wins arbitrate instead of blindly clobbering either side.
    const cur = await gfetch(binding, ctx.env, account, path);
    if (!cur.ok) throw new Error('google events.get ' + cur.status + ': ' + (await safeText(cur)));

    const gev = await cur.json();
    const mapped = fromGoogleEvent(gev, key);

    if (mapped && isNewer(mapped.updated, row.updated_at)) {
      if (differs(row, mapped)) {
        const merged = blankEventRow();
        Object.assign(merged, mapped.row, {
          id: row.id,
          client_id: row.client_id || '',
          updated_at: mapped.updated,
          owner_id: row.owner_id || OWNER_ID,
          created_at: row.created_at || mapped.updated,
          deleted_at: null,
          google_event_id: mapped.google_event_id,
          etag: mapped.etag,
          google_calendar_id: calId
        });
        await upsertRow(binding, 'events', merged);
      } else {
        await setGoogleRef(binding, row.id, mapped.google_event_id, mapped.etag, calId);
      }
      return { pushed: false, conflict: true };
    }

    // we are the newer writer — retry without the precondition
    res = await gfetch(binding, ctx.env, account, path,
      { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('google events.patch ' + res.status + ': ' + (await safeText(res)));
    const forced = await res.json();
    await setGoogleRef(binding, row.id, forced.id, forced.etag || '', calId);
    return { pushed: true, conflict: true };
  }

  if (res.status === 404 || res.status === 410) {
    // deleted on Google while we still hold its id — recreate it here
    await insertEvent(ctx, binding, account, row, calId, body);
    return { pushed: true, conflict: false };
  }
  if (!res.ok) throw new Error('google events.patch ' + res.status + ': ' + (await safeText(res)));

  const saved = await res.json();
  await setGoogleRef(binding, row.id, saved.id, saved.etag || '', calId);
  return { pushed: true, conflict: false };
}

/* --------------------------------------------------------------- helpers --- */

/** google bookkeeping only — updated_at stays untouched on purpose (see header) */
async function setGoogleRef(binding, id, gid, etag, calId) {
  await binding
    .prepare('UPDATE events SET google_event_id = ?, etag = ?, google_calendar_id = ? WHERE id = ?')
    .bind(gid || null, etag || null, calId || null, id)
    .run();
}

async function clearGoogleRef(binding, id) {
  await binding
    .prepare('UPDATE events SET google_event_id = NULL, etag = NULL WHERE id = ?')
    .bind(id)
    .run();
}

/** the google id is authoritative; the extendedProperty is the fallback link */
async function findLocal(binding, gid, localId) {
  if (gid) {
    const hit = await binding
      .prepare('SELECT * FROM events WHERE google_event_id = ? LIMIT 1')
      .bind(gid)
      .first();
    if (hit) return hit;
  }
  if (localId) {
    return await binding.prepare('SELECT * FROM events WHERE id = ?').bind(localId).first();
  }
  return null;
}

function blankEventRow() {
  const row = {};
  SCHEMA.events.columns.forEach(c => { row[c] = null; });
  return row;
}

function newId() {
  return 'ev_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch (e) { return ''; }
}
