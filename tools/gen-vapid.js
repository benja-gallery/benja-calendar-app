#!/usr/bin/env node
/* ==========================================================================
   tools/gen-vapid.js — generate the VAPID key pair (Sprint 11)

   Web Push identifies the application server with a P-256 key pair. The public
   half is published (the browser needs it to subscribe); the private half is a
   secret and is read only inside functions/api/push/_webpush.js.

   Usage:
     node tools/gen-vapid.js

   Then, on the Pages project:
     wrangler pages secret put VAPID_PUBLIC_KEY
     wrangler pages secret put VAPID_PRIVATE_KEY
     wrangler pages secret put VAPID_SUBJECT          # mailto:you@example.com
     wrangler pages secret put PUSH_DISPATCH_SECRET   # any long random string

   Nothing is written to disk on purpose: a key pair printed once and pasted
   into `wrangler secret put` never becomes a file somebody commits.
   ========================================================================== */

'use strict';

const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pub = publicKey.export({ format: 'jwk' });
const prv = privateKey.export({ format: 'jwk' });

/** the uncompressed point 0x04 || X || Y — the shape pushManager.subscribe() wants */
function uncompressed(jwk) {
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
}

console.log('');
console.log('  VAPID key pair (P-256) — paste into wrangler, do not commit');
console.log('  ' + '-'.repeat(58));
console.log('  VAPID_PUBLIC_KEY   ' + uncompressed(pub));
console.log('  VAPID_PRIVATE_KEY  ' + prv.d);
console.log('  ' + '-'.repeat(58));
console.log('');
console.log('  wrangler pages secret put VAPID_PUBLIC_KEY');
console.log('  wrangler pages secret put VAPID_PRIVATE_KEY');
console.log('  wrangler pages secret put VAPID_SUBJECT          # mailto:you@example.com');
console.log('  wrangler pages secret put PUSH_DISPATCH_SECRET   # any long random string');
console.log('');
