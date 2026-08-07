/* ==========================================================================
   /api/settings — the app-settings row store (Sprint 20)

   One key, one JSON blob, last-write-wins. This is where the reserve-duty
   rotation config (מנוע סבבי מילואים) lives so it follows the owner onto a
   second device instead of living on one phone.

     GET  ?key=<key>   → { ok:true, data: { key, value, updated_at } }
                         value is null when nothing has ever been written
     POST { key, value, updated_at }
                       → { ok:true, data: { key, updated_at, written } }

   Deliberately NOT part of /api/sync: that route replays row ops against the
   five entity tables and iterates TABLES to build its delta. A setting has no
   category, no tombstone and no place in a recycle bin — see the header of
   migrations/0007_sprint20_settings.sql for the full argument.

   The value is stored verbatim and never parsed for meaning: the vocabulary of
   a rotation belongs to the client, and a Worker that validated the field
   names would have to be redeployed before the client could learn a new one.
   It is still bounded (MAX_TEXT) and still has to be an object, so the column
   can never take a 5MB string or a bare scalar.
   ========================================================================== */

import {
  ok, fail, preflight, db, nowISO, isISO, readJSON, MAX_TEXT, OWNER_ID
} from './_shared.js';

/** the keys this route will answer for — never taken from the request freely */
const KEYS = ['reserve_shift'];

export const onRequestOptions = () => preflight();

export const onRequestGet = async (ctx) => {
  const url = new URL(ctx.request.url);
  const key = url.searchParams.get('key');
  if (KEYS.indexOf(key) === -1) return fail('unknown_key', 'unknown settings key: ' + key);

  let row;
  try {
    row = await db(ctx.env)
      .prepare('SELECT key, value_json, updated_at FROM app_settings WHERE key = ? AND owner_id = ?')
      .bind(key, OWNER_ID)
      .first();
  } catch (e) {
    return fail('db_error', e.message, 500);
  }

  // nothing written yet is a legitimate answer, not an error: a first device
  // has to be able to tell "no rule stored" from "the request failed"
  if (!row) return ok({ key: key, value: null, updated_at: '' });

  let value = null;
  try { value = JSON.parse(row.value_json); }
  catch (e) { value = null; }          // a corrupt blob reads as absent, never throws

  return ok({ key: key, value: value, updated_at: row.updated_at, now: nowISO() });
};

export const onRequestPost = async (ctx) => {
  const body = await readJSON(ctx.request);
  if (!body) return fail('bad_json', 'request body is not valid JSON');

  const key = body.key;
  if (KEYS.indexOf(key) === -1) return fail('unknown_key', 'unknown settings key: ' + key);

  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('bad_value', 'value must be an object');
  }

  const at = isISO(body.updated_at) ? body.updated_at : nowISO();

  const json = JSON.stringify(value);
  if (json.length > MAX_TEXT) return fail('too_large', 'value exceeds ' + MAX_TEXT + ' chars');

  try {
    // last-write-wins, enforced here rather than in the client: a stale phone
    // coming back online writes nothing rather than undoing a newer rule
    await db(ctx.env)
      .prepare('INSERT INTO app_settings (key, owner_id, value_json, updated_at, created_at) ' +
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ' +
        'value_json = excluded.value_json, updated_at = excluded.updated_at ' +
        'WHERE excluded.updated_at >= app_settings.updated_at')
      .bind(key, OWNER_ID, json, at, at)
      .run();
  } catch (e) {
    return fail('db_error', e.message, 500);
  }

  return ok({ key: key, updated_at: at, written: true, now: nowISO() });
};
