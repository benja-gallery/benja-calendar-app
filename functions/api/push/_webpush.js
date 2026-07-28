/* ==========================================================================
   functions/api/push/_webpush.js — Web Push, from scratch, on WebCrypto
   (Sprint 11, PROJECT_PLAN §7.4m)

   Two standards, no dependencies:

     * RFC 8292 (VAPID) — the Authorization header that identifies this
       application server to the push service. An ES256 JWT over
       { aud, exp, sub }, signed with the private half of the VAPID key pair.
     * RFC 8291 (Message Encryption) — aes128gcm. The push service is an
       untrusted relay: it forwards bytes it cannot read. The payload is
       encrypted end-to-end against the two keys the browser handed us when it
       subscribed (p256dh + auth), so only that device can open it.

   A Worker has no npm and no Node crypto. Everything below is WebCrypto:
   ECDH P-256 for the shared secret, HMAC-SHA-256 for the HKDF ladder, AES-GCM
   for the record itself, ECDSA P-256 for the JWT.

   No key ever reaches the browser. VAPID_PRIVATE_KEY is read only in here.
   ========================================================================== */

/* ------------------------------------------------------------- base64url --- */

export function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // chunked — String.fromCharCode(...bigArray) blows the argument limit
  for (let i = 0; i < view.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(s) {
  return new TextEncoder().encode(s);
}

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* ------------------------------------------------------------------ VAPID --- */

/**
 * The VAPID public key is the uncompressed P-256 point (0x04 || X || Y), which
 * is exactly the X and Y the JWK wants — so the pair is described once, in the
 * two secrets, and never duplicated in a third format.
 */
async function signingKey(publicKeyB64, privateKeyB64) {
  const pub = b64urlToBytes(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
  }
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(b64urlToBytes(privateKeyB64)),
    ext: true
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/**
 * `vapid t=<jwt>, k=<public key>` — RFC 8292 §3. The audience is the push
 * service's ORIGIN, never the full endpoint: the token is scoped to the
 * service, and a token minted per endpoint would leak which device it is for.
 */
export async function vapidHeader(endpoint, publicKeyB64, privateKeyB64, subject) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const body = {
    aud: aud,
    // 12 hours: comfortably inside the 24-hour ceiling every push service
    // enforces, and long enough that a dispatch run never re-mints mid-batch
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject || 'mailto:admin@benja.app'
  };
  const signed = bytesToB64url(utf8(JSON.stringify(header))) + '.' +
    bytesToB64url(utf8(JSON.stringify(body)));

  const key = await signingKey(publicKeyB64, privateKeyB64);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signed));
  // WebCrypto emits raw r||s, which is exactly the JWS ES256 shape — no DER
  return 'vapid t=' + signed + '.' + bytesToB64url(new Uint8Array(sig)) + ', k=' + publicKeyB64;
}

/* ------------------------------------------------------ payload encryption --- */

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/** HKDF with a one-byte counter — every expansion here is <= 32 bytes */
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const out = await hmac(prk, concat([info, new Uint8Array([1])]));
  return out.slice(0, length);
}

/**
 * RFC 8291 §3.4 — encrypt `plaintext` for one subscription.
 *
 * Returns the complete aes128gcm body:
 *   salt(16) | rs(4) | idlen(1) | as_public(65) | AES-GCM(record)
 * where the record is the plaintext followed by the 0x02 padding delimiter
 * that marks it as the last (and only) record.
 */
export async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);
  if (uaPublic.length !== 65) throw new Error('p256dh is not a P-256 point');
  if (authSecret.length !== 16) throw new Error('auth secret is not 16 bytes');

  // one ephemeral key pair per message — reusing one would let a push service
  // that logs bodies link two messages to the same sender key
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256)
  );

  // the key-derivation ladder, in the order the RFC lays it out
  const keyInfo = concat([utf8('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic]);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concat([utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])]), 16);
  const nonce = await hkdf(salt, ikm, concat([utf8('Content-Encoding: nonce'), new Uint8Array([0])]), 12);

  const record = concat([utf8(plaintext), new Uint8Array([2])]);   // 0x02 = last record
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record)
  );

  const rs = 4096;                                    // one record, comfortably
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(0, rs);
  head[4] = asPublic.length;

  return concat([salt, head, asPublic, cipher]);
}

/* ------------------------------------------------------------------ send --- */

/**
 * Deliver one notification to one subscription.
 *
 * Never throws: a dead endpoint is an outcome, not an exception, and one
 * unreachable phone must not abort the rest of a dispatch run. `gone` is the
 * caller's cue to disable the row — 404/410 is how a push service says the
 * subscription will never work again, and retrying it every minute would burn
 * the whole budget on a device that no longer exists.
 */
export async function sendPush(sub, payload, env) {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { ok: false, gone: false, status: 0, error: 'vapid_not_configured' };

  try {
    const auth = await vapidHeader(sub.endpoint, publicKey, privateKey, env.VAPID_SUBJECT);
    const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '3600',
        // a reminder that arrives after the meeting is noise, so the push
        // service is told to deliver it now rather than batch it for battery
        'Urgency': 'high'
      },
      body: body
    });

    return {
      ok: res.status >= 200 && res.status < 300,
      gone: res.status === 404 || res.status === 410,
      status: res.status,
      error: res.ok ? '' : await res.text().catch(() => '')
    };
  } catch (e) {
    return { ok: false, gone: false, status: 0, error: String(e && e.message || e) };
  }
}
