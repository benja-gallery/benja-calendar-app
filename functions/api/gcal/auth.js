/* ==========================================================================
   /api/gcal/auth — Google OAuth handshake and connection status (Sprint 6)

     GET  /api/gcal/auth                    → { configured, connected, … }
     GET  /api/gcal/auth?action=start       → 302 to Google's consent screen
     GET  /api/gcal/auth?code=…&state=…     → Google's callback; 302 back to the app
     POST /api/gcal/auth  {action:'disconnect'} → forgets every stored token

   The browser never sees a token. It only ever learns three booleans and a
   timestamp, which is all the header button needs to render (§7.4e).

   `state` is a per-attempt nonce parked on the account row and cleared the
   moment it is redeemed, so a replayed or forged callback cannot mint a
   session. It also expires after ten minutes.
   ========================================================================== */

import { ok, fail, preflight, db, nowISO } from '../_shared.js';
import { GOOGLE_AUTH_URL, GOOGLE_SCOPE, CALENDAR_KEYS, calendarIdFor } from './_gcal.js';
import {
  isConfigured, redirectURI, loadAccount, saveAccount, clearAccount,
  isConnected, exchangeCode, lastSyncAt
} from './_token.js';

/** how long a pending consent attempt stays redeemable */
const STATE_TTL_MS = 10 * 60 * 1000;

export const onRequestOptions = () => preflight();

export const onRequestGet = async (ctx) => {
  const url = new URL(ctx.request.url);
  const action = url.searchParams.get('action') || '';
  const code = url.searchParams.get('code') || '';

  let binding;
  try { binding = db(ctx.env); }
  catch (e) { return fail('no_binding', e.message, 500); }

  if (!isConfigured(ctx.env)) {
    // a missing client id is a deployment state, not a client error — the app
    // has to keep working, so this stays a readable payload rather than a throw
    if (action === 'start' || code) {
      return fail('gcal_not_configured',
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on this deployment', 503);
    }
    return ok(await status(binding, ctx.env, false));
  }

  if (code) return await callback(ctx, binding, url, code);
  if (action === 'start') return await start(ctx, binding);

  return ok(await status(binding, ctx.env, true));
};

export const onRequestPost = async (ctx) => {
  let binding;
  try { binding = db(ctx.env); }
  catch (e) { return fail('no_binding', e.message, 500); }

  let body = null;
  try { body = await ctx.request.json(); } catch (e) { body = null; }

  if (!body || body.action !== 'disconnect') {
    return fail('bad_action', "the only POST action is { action: 'disconnect' }");
  }

  await clearAccount(binding);
  return ok(await status(binding, ctx.env, isConfigured(ctx.env)));
};

/* ------------------------------------------------------------------------- */

async function status(binding, env, configured) {
  const account = configured ? await loadAccount(binding) : null;
  const connected = isConnected(account);

  return {
    configured: configured,
    connected: connected,
    // the account e-mail is never stored, so identity is reported as the scope
    // that was actually granted — enough to tell a partial consent apart
    scope: connected ? String(account.scope || '') : '',
    connectedAt: connected ? String(account.connected_at || '') : '',
    lastSyncAt: connected ? await lastSyncAt(binding) : '',
    // the raw calendar id is an address on the owner's Google account, and
    // /api/* carries no session yet (§12.1) — the browser gets a boolean
    calendars: CALENDAR_KEYS.map(k => ({ key: k, mapped: !!calendarIdFor(k, env) }))
  };
}

async function start(ctx, binding) {
  const nonce = crypto.randomUUID();
  await saveAccount(binding, { auth_state: nonce, auth_state_at: nowISO() });

  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set('client_id', ctx.env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectURI(ctx.env, ctx.request));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', GOOGLE_SCOPE);
  // offline + consent is the only combination that reliably yields a refresh
  // token, and without one the connection dies an hour after it is made
  auth.searchParams.set('access_type', 'offline');
  auth.searchParams.set('prompt', 'consent');
  auth.searchParams.set('include_granted_scopes', 'true');
  auth.searchParams.set('state', nonce);

  return Response.redirect(auth.toString(), 302);
}

async function callback(ctx, binding, url, code) {
  const state = url.searchParams.get('state') || '';
  const account = await loadAccount(binding);

  if (!account || !account.auth_state || account.auth_state !== state) {
    return fail('bad_state', 'the OAuth state does not match a pending request', 403);
  }
  const opened = Date.parse(account.auth_state_at || '');
  if (isNaN(opened) || Date.now() - opened > STATE_TTL_MS) {
    await saveAccount(binding, { auth_state: null, auth_state_at: null });
    return fail('state_expired', 'the consent request expired — start again', 403);
  }

  const out = await exchangeCode(ctx.env, ctx.request, code);
  if (!out.ok || !out.body || !out.body.access_token) {
    const why = (out.body && (out.body.error_description || out.body.error)) || ('HTTP ' + out.status);
    return fail('token_exchange_failed', String(why), 502);
  }
  if (!out.body.refresh_token && !account.refresh_token) {
    return fail('no_refresh_token',
      'Google returned no refresh token — revoke the app in the Google account and connect again', 502);
  }

  await saveAccount(binding, {
    access_token: out.body.access_token,
    refresh_token: out.body.refresh_token || account.refresh_token,
    expires_at: new Date(Date.now() + (Number(out.body.expires_in) || 3600) * 1000).toISOString(),
    scope: out.body.scope || '',
    token_type: out.body.token_type || 'Bearer',
    connected_at: account.connected_at || nowISO(),
    auth_state: null,
    auth_state_at: null
  });

  // land the user back on the app, not on a JSON blob
  return Response.redirect(new URL('/?gcal=connected', ctx.request.url).toString(), 302);
}
