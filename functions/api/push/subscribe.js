/* ==========================================================================
   functions/api/push/subscribe.js — the device register (Sprint 11)

     GET     → { configured, publicKey, devices }  — what the client needs to
               decide whether server push is even available here. The PUBLIC
               half of the VAPID pair is meant to be published; the private
               half is never read outside _webpush.js.
     POST    → store (or refresh) one subscription
     DELETE  → forget one, by endpoint

   The row is keyed by a hash of the endpoint rather than by a generated id, so
   a phone that re-registers on every launch — which it does — updates one row
   forever instead of growing a new one each time.
   ========================================================================== */

import { ok, fail, preflight, db, nowISO, readJSON, OWNER_ID } from '../_shared.js';

/** stable, collision-free row id for an endpoint of any length */
async function endpointId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

function configured(env) {
  return !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** a subscription is three fields, and all three have to be real to be usable */
function validSub(body) {
  if (!body || typeof body.endpoint !== 'string') return 'endpoint is required';
  if (!/^https:\/\//.test(body.endpoint)) return 'endpoint must be an https URL';
  if (body.endpoint.length > 1000) return 'endpoint is implausibly long';
  const keys = body.keys || {};
  if (typeof keys.p256dh !== 'string' || keys.p256dh.length < 16) return 'keys.p256dh is required';
  if (typeof keys.auth !== 'string' || keys.auth.length < 8) return 'keys.auth is required';
  return '';
}

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestGet(context) {
  const env = context.env;
  let devices = 0;

  // the count is a convenience, not a contract — a missing binding must not
  // stop the client learning whether push is configured at all
  try {
    const row = await db(env)
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE disabled_at IS NULL')
      .first();
    devices = (row && row.n) || 0;
  } catch (e) { devices = 0; }

  return ok({
    configured: configured(env),
    publicKey: configured(env) ? env.VAPID_PUBLIC_KEY : '',
    devices: devices
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!configured(env)) {
    return fail('push_not_configured', 'VAPID keys are not set on this deployment', 503);
  }

  const body = await readJSON(request);
  const bad = validSub(body);
  if (bad) return fail('bad_subscription', bad, 400);

  let binding;
  try { binding = db(env); } catch (e) { return fail('db_error', e.message, 500); }
  const id = await endpointId(body.endpoint);
  const at = nowISO();

  /* A re-POST is an upsert on purpose: the client links on every launch, and a
     new row per launch would multiply one phone into hundreds of dead
     endpoints. Re-registering also CLEARS disabled_at and the failure count —
     a device that just proved it is alive is not disabled. */
  await binding.prepare(
    'INSERT INTO push_subscriptions ' +
    '(id, owner_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, last_sent_at, fail_count, disabled_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL) " +
    'ON CONFLICT(id) DO UPDATE SET ' +
    'p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, ' +
    'updated_at = excluded.updated_at, fail_count = 0, disabled_at = NULL'
  ).bind(
    id, OWNER_ID, body.endpoint, body.keys.p256dh, body.keys.auth,
    String(body.ua || body.user_agent || '').slice(0, 300), at, at
  ).run();

  // sw.js sends the endpoint it is replacing on a pushsubscriptionchange; the
  // old one is already dead, and leaving it behind would fail on every run
  if (typeof body.previous === 'string' && body.previous && body.previous !== body.endpoint) {
    await binding.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(body.previous).run();
  }

  return ok({ id: id, registered_at: at });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint') || '';
  if (!endpoint) return fail('bad_request', 'endpoint is required', 400);

  await db(env).prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
  return ok({ endpoint: endpoint, removed: true });
}
