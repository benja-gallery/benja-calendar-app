/* ==========================================================================
   functions/api/_collection.js — one CRUD shape, five collections

   /api/events · /api/tasks · /api/lists · /api/notes · /api/clients all answer
   the same three verbs, so they are one implementation parameterised by table
   name. The table is resolved through SCHEMA in _shared.js — it is never taken
   from the request, so no route can be pointed at an arbitrary table.

     GET    ?since=<ISO>&limit=<n>   rows changed after `since` (tombstones included)
     POST   { row } | { rows:[…] }   last-write-wins upsert
     DELETE ?id=<id>                 tombstone (soft delete, propagates on pull)
   ========================================================================== */

import {
  ok, fail, preflight, db, nowISO,
  SCHEMA, sanitize, upsertRow, tombstone, changedSince,
  readJSON, rowsOf
} from './_shared.js';

/** most rows a single POST may carry — a sync batch, not a bulk import */
const MAX_ROWS = 200;

export function collection(table) {
  if (!SCHEMA[table]) throw new Error('unknown table: ' + table);

  return {
    options: () => preflight(),

    get: async (ctx) => {
      try {
        const url = new URL(ctx.request.url);
        const rows = await changedSince(
          db(ctx.env), table,
          url.searchParams.get('since'),
          url.searchParams.get('limit')
        );
        return ok({ table: table, rows: rows, count: rows.length, now: nowISO() });
      } catch (e) {
        return fail('db_error', e.message, 500);
      }
    },

    post: async (ctx) => {
      const body = await readJSON(ctx.request);
      if (!body) return fail('bad_json', 'request body is not valid JSON');

      const incoming = rowsOf(body);
      if (!incoming.length) return fail('empty_payload', 'no rows to write');
      if (incoming.length > MAX_ROWS) {
        return fail('too_many_rows', 'at most ' + MAX_ROWS + ' rows per request', 413);
      }

      const written = [];
      const rejected = [];

      try {
        const binding = db(ctx.env);
        for (const raw of incoming) {
          const clean = sanitize(table, raw);
          if (!clean.ok) {
            rejected.push({ id: raw && raw.id, error: clean.error });
            continue;
          }
          await upsertRow(binding, table, clean.row);
          written.push(clean.row.id);
        }
      } catch (e) {
        return fail('db_error', e.message, 500);
      }

      return ok({ table: table, written: written, rejected: rejected, now: nowISO() });
    },

    del: async (ctx) => {
      const url = new URL(ctx.request.url);
      const id = url.searchParams.get('id');
      if (!id) return fail('missing_id', 'delete requires ?id=');

      try {
        const res = await tombstone(db(ctx.env), table, id, nowISO());
        return ok({ table: table, deleted: res, now: nowISO() });
      } catch (e) {
        return fail('db_error', e.message, 500);
      }
    }
  };
}
