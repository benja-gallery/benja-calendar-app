/* ==========================================================================
   /api/sync — batch outbox replay + delta pull (PROJECT_PLAN §8)

   One round-trip does both halves of a sync:

     POST { since: '<ISO>|""', ops: [ { opId, table, id, action, row } ] }

       → { ok:true, data: {
             applied:  [opId…],              // written, or already written
             rejected: [{ opId, error }…],   // payload the server refused
             changes:  { events:[…], tasks:[…], … },
             cursor:   '<ISO>',              // resume mark for the next pull
             now:      '<ISO>'
           } }

   Guarantees
     * Idempotent — every op carries a client-generated opId recorded in
       sync_ops; replaying it is a no-op, so a retry after a dropped response
       can never double-apply (§4 "idempotent writes").
     * Last-write-wins — the UPSERT refuses to overwrite a newer updated_at, so
       ops arriving out of order still converge (§8.3).
     * Partial success — one bad row is rejected by name and the rest of the
       batch still lands. The client only drops the ops the server answered for.
   ========================================================================== */

import {
  ok, fail, preflight, db, nowISO, isISO,
  TABLES, SCHEMA, sanitize, upsertRow, tombstone, changedSince,
  readJSON, OWNER_ID
} from './_shared.js';

/** most ops one batch may carry — the client slices its queue to match */
const MAX_OPS = 200;

export const onRequestOptions = () => preflight();

export const onRequestPost = async (ctx) => {
  const body = await readJSON(ctx.request);
  if (!body) return fail('bad_json', 'request body is not valid JSON');

  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length > MAX_OPS) {
    return fail('too_many_ops', 'at most ' + MAX_OPS + ' ops per batch', 413);
  }

  const since = isISO(body.since) ? body.since : '';

  let binding;
  try { binding = db(ctx.env); }
  catch (e) { return fail('no_binding', e.message, 500); }

  const applied = [];
  const rejected = [];

  for (const op of ops) {
    const verdict = await applyOp(binding, op);
    if (verdict.ok) applied.push(verdict.opId);
    else rejected.push({ opId: op && op.opId, error: verdict.error });
  }

  /* ------- pull half: everything the server has seen since the last mark ---- */

  const changes = {};
  let cursor = since;
  try {
    for (const table of TABLES) {
      const rows = await changedSince(binding, table, since);
      changes[table] = rows;
      for (const r of rows) {
        if (typeof r.updated_at === 'string' && r.updated_at > cursor) cursor = r.updated_at;
      }
    }
  } catch (e) {
    return fail('db_error', e.message, 500);
  }

  return ok({
    applied: applied,
    rejected: rejected,
    changes: changes,
    cursor: cursor,
    now: nowISO()
  });
};

/* ------------------------------------------------------------------------- */

async function applyOp(binding, op) {
  if (!op || typeof op !== 'object') return { ok: false, error: 'op must be an object' };

  const opId = op.opId;
  if (typeof opId !== 'string' || !opId.trim() || opId.length > 128) {
    return { ok: false, error: 'opId must be a non-empty string under 128 chars' };
  }
  if (!SCHEMA[op.table]) return { ok: false, error: 'unknown table: ' + op.table };
  if (typeof op.id !== 'string' || !op.id.trim()) {
    return { ok: false, error: 'op.id must be a non-empty string' };
  }
  if (op.action !== 'upsert' && op.action !== 'delete') {
    return { ok: false, error: 'unknown action: ' + op.action };
  }

  try {
    // idempotency ledger first — a replayed opId is answered as applied and
    // never touches a table again (§4)
    const seen = await binding
      .prepare('SELECT op_id FROM sync_ops WHERE op_id = ?')
      .bind(opId)
      .first();
    if (seen) return { ok: true, opId: opId };

    if (op.action === 'delete') {
      await tombstone(binding, op.table, op.id, isISO(op.at) ? op.at : nowISO());
    } else {
      const clean = sanitize(op.table, op.row);
      if (!clean.ok) return { ok: false, error: clean.error };
      if (clean.row.id !== op.id) return { ok: false, error: 'op.id does not match row.id' };
      await upsertRow(binding, op.table, clean.row);
    }

    await binding
      .prepare('INSERT INTO sync_ops (op_id, owner_id, table_name, row_id, applied_at) ' +
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT(op_id) DO NOTHING')
      .bind(opId, OWNER_ID, op.table, op.id, nowISO())
      .run();

    return { ok: true, opId: opId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
