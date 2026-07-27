/* ==========================================================================
   functions/api/gcal/_token.js — the OAuth credential store (Sprint 6)

   The one place that knows how to end up holding a live Google access token:

     * gcal_accounts holds a single row (§0.4 is single-user), so the refresh
       token survives a redeploy and the user consents exactly once.
     * accessToken() refreshes on its own a minute before expiry, so no caller
       has to reason about token lifetime.
     * gfetch() retries once on a 401 with a forced refresh — Google can
       invalidate a token early, and a whole sync should not fail for that.

   Nothing here is exported to the browser: the tokens never leave the Worker,
   and /api/gcal/auth?action=status reports connectivity as booleans only.
   ========================================================================== */

import { nowISO, OWNER_ID } from '../_shared.js';
import { GOOGLE_TOKEN_URL, GOOGLE_API, CALENDAR_KEYS, calendarIdFor } from './_gcal.js';

/** refresh this far before the token actually lapses, so a sync never races it */
const REFRESH_SKEW_MS = 60000;

/* --------------------------------------------------------- configuration --- */

/** without a client id/secret pair there is nothing to talk to */
export function isConfigured(env) {
  return !!(env && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * Where Google sends the user back. An explicit GOOGLE_REDIRECT_URI wins;
 * otherwise it is this very route on this very origin, which is correct for
 * both the production domain and a `wrangler pages dev` preview.
 */
export function redirectURI(env, request) {
  if (env && typeof env.GOOGLE_REDIRECT_URI === 'string' && env.GOOGLE_REDIRECT_URI) {
    return env.GOOGLE_REDIRECT_URI;
  }
  return new URL(request.url).origin + '/api/gcal/auth';
}

/* ------------------------------------------------------------- account --- */

export async function loadAccount(binding) {
  return await binding
    .prepare('SELECT * FROM gcal_accounts WHERE owner_id = ?')
    .bind(OWNER_ID)
    .first();
}

/** upsert of exactly the named fields — an absent key is never overwritten */
export async function saveAccount(binding, patch) {
  const cols = ['access_token', 'refresh_token', 'expires_at', 'scope',
    'token_type', 'auth_state', 'auth_state_at', 'connected_at'];
  const keys = cols.filter(c => Object.prototype.hasOwnProperty.call(patch, c));
  if (!keys.length) return;

  const all = ['owner_id'].concat(keys).concat(['updated_at']);
  const values = [OWNER_ID].concat(keys.map(k => patch[k])).concat([nowISO()]);
  const sets = keys.concat(['updated_at']).map(k => k + ' = excluded.' + k).join(', ');

  await binding
    .prepare('INSERT INTO gcal_accounts (' + all.join(', ') + ') VALUES (' +
      all.map(() => '?').join(', ') + ') ON CONFLICT(owner_id) DO UPDATE SET ' + sets)
    .bind(...values)
    .run();
}

export async function clearAccount(binding) {
  await binding.prepare('DELETE FROM gcal_accounts WHERE owner_id = ?').bind(OWNER_ID).run();
  await binding.prepare('DELETE FROM gcal_sync_state WHERE owner_id = ?').bind(OWNER_ID).run();
}

export function isConnected(account) {
  return !!(account && account.refresh_token);
}

/* --------------------------------------------------------- sync state --- */

export async function loadState(binding, key) {
  return await binding
    .prepare('SELECT * FROM gcal_sync_state WHERE calendar_key = ?')
    .bind(key)
    .first();
}

export async function saveState(binding, key, googleCalendarId, syncToken, lastSyncAt) {
  await binding
    .prepare('INSERT INTO gcal_sync_state ' +
      '(calendar_key, owner_id, google_calendar_id, sync_token, last_sync_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(calendar_key) DO UPDATE SET ' +
      'google_calendar_id = excluded.google_calendar_id, ' +
      'sync_token = excluded.sync_token, ' +
      'last_sync_at = excluded.last_sync_at, ' +
      'updated_at = excluded.updated_at')
    .bind(key, OWNER_ID, googleCalendarId, syncToken || null, lastSyncAt || null, nowISO())
    .run();
}

/** the newest last_sync_at across both calendars — what the header renders */
export async function lastSyncAt(binding) {
  let newest = '';
  for (const key of CALENDAR_KEYS) {
    const row = await loadState(binding, key);
    const at = row && typeof row.last_sync_at === 'string' ? row.last_sync_at : '';
    if (at > newest) newest = at;
  }
  return newest;
}

/* ----------------------------------------------------------- the token --- */

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { ok: res.ok, status: res.status, body: body };
}

/** authorisation_code → the first token pair. Google only hands out a refresh
 *  token when the consent screen was forced, which is why the auth URL asks
 *  for access_type=offline and prompt=consent. */
export async function exchangeCode(env, request, code) {
  return await postForm(GOOGLE_TOKEN_URL, {
    code: code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectURI(env, request),
    grant_type: 'authorization_code'
  });
}

async function refresh(binding, env, account) {
  const out = await postForm(GOOGLE_TOKEN_URL, {
    refresh_token: account.refresh_token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  if (!out.ok || !out.body || !out.body.access_token) {
    const why = (out.body && (out.body.error_description || out.body.error)) || ('HTTP ' + out.status);
    throw new Error('google token refresh failed: ' + why);
  }

  const expires = new Date(Date.now() + (Number(out.body.expires_in) || 3600) * 1000).toISOString();
  await saveAccount(binding, {
    access_token: out.body.access_token,
    expires_at: expires,
    // a refresh response only re-issues the refresh token when Google rotates it
    refresh_token: out.body.refresh_token || account.refresh_token,
    token_type: out.body.token_type || 'Bearer'
  });
  return out.body.access_token;
}

/** a live access token, refreshed transparently when it is about to lapse */
export async function accessToken(binding, env, account, force) {
  if (!isConnected(account)) throw new Error('google calendar is not connected');

  const expiry = Date.parse(account.expires_at || '');
  const fresh = account.access_token && !isNaN(expiry) && expiry - Date.now() > REFRESH_SKEW_MS;
  if (fresh && !force) return account.access_token;

  return await refresh(binding, env, account);
}

/**
 * An authorised call to the Calendar API. `path` is appended to GOOGLE_API.
 * A 401 buys exactly one forced refresh and one retry — after that the caller
 * sees the real failure rather than an infinite loop.
 */
export async function gfetch(binding, env, account, path, init) {
  let token = await accessToken(binding, env, account);

  const call = (t) => fetch(GOOGLE_API + path, Object.assign({}, init, {
    headers: Object.assign({
      Authorization: 'Bearer ' + t,
      'Content-Type': 'application/json'
    }, (init && init.headers) || {})
  }));

  let res = await call(token);
  if (res.status === 401) {
    token = await accessToken(binding, env, account, true);
    account.access_token = token;
    res = await call(token);
  }
  return res;
}

/** the calendar id every route resolves the same way */
export function calendarId(key, env) {
  return calendarIdFor(key, env);
}
