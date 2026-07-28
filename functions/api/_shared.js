/* ==========================================================================
   functions/api/_shared.js — Cloudflare Worker shared layer (Sprint 5)

   One module owns everything the six route files disagree about otherwise:

     * SCHEMA      — the authoritative column list per table. The D1 migration,
                     this module and app.js SYNC_SCHEMA are cross-checked
                     against each other by healthcheck.js, so a column can
                     never be added in one place and forgotten in another.
     * sanitize()  — payload validation. A row that reaches SQL has already had
                     unknown keys dropped, its category forced into the
                     personal|business vocabulary and every value coerced to the
                     column's real type.
     * upsertRow() — last-write-wins by updated_at, expressed as a single
                     parameterised UPSERT. No statement is ever string-built
                     from client input.

   Response envelope (PROJECT_PLAN §6): { ok:true, data } | { ok:false, error }.
   ========================================================================== */

export const OWNER_ID = 'ben-perez';

export const CATEGORIES = ['personal', 'business'];

/** hard ceiling on a single text value — a sync payload is not a file upload */
export const MAX_TEXT = 20000;

/** most rows a single pull returns per table before the client asks again */
export const PULL_LIMIT = 500;

/* --------------------------------------------------------------- schema --- */

/**
 * columns[] is ordered exactly as the table is declared in
 * migrations/0001_sprint5_init.sql — mandated columns first, then the columns
 * the sync engine needs to round-trip a local record.
 */
export const SCHEMA = {
  events: {
    columns: ['id', 'title', 'category', 'start_time', 'end_time', 'location',
      'client_id', 'category_type', 'updated_at', 'owner_id', 'notes',
      'created_at', 'deleted_at',
      // Sprint 6 — appended by migration 0002, so they trail every Sprint-5 column
      'google_event_id', 'etag', 'google_calendar_id',
      // Sprint 10 — appended by migration 0003, so it trails those in turn
      'remind_key'],
    ints: []
  },
  tasks: {
    columns: ['id', 'title', 'category', 'status', 'priority', 'due_date',
      'next_action', 'subtasks_json', 'client_id', 'updated_at', 'owner_id',
      'due_time', 'notes', 'created_at', 'deleted_at',
      // Sprint 10 — appended by migration 0003
      'remind_key'],
    ints: []
  },
  lists: {
    columns: ['id', 'title', 'category', 'items_json', 'client_id',
      'updated_at', 'owner_id', 'list_date', 'created_at', 'deleted_at'],
    ints: []
  },
  notes: {
    columns: ['id', 'title', 'body', 'category', 'is_pinned', 'client_id',
      'updated_at', 'owner_id', 'created_at', 'deleted_at'],
    ints: ['is_pinned']
  },
  clients: {
    columns: ['id', 'name', 'phone', 'email', 'status', 'next_action',
      'initial_interest', 'updated_at', 'owner_id', 'category', 'budget',
      'next_action_at', 'follow_up_at', 'last_contact_at', 'general_notes',
      'client_notes_json', 'history_json', 'created_at', 'deleted_at'],
    ints: []
  }
};

export const TABLES = Object.keys(SCHEMA);

/* ------------------------------------------------------------ envelopes --- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, CORS)
  });
}

export function ok(data) {
  return json({ ok: true, data: data });
}

export function fail(code, message, status) {
  return json({ ok: false, error: { code: code, message: message } }, status || 400);
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/* ------------------------------------------------------------- helpers --- */

export function nowISO() {
  return new Date().toISOString();
}

/** an ISO-8601 instant — the only timestamp shape last-write-wins can compare */
export function isISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v);
}

export function db(env) {
  if (!env || !env.DB) throw new Error('D1 binding "DB" is not configured');
  return env.DB;
}

/* ---------------------------------------------------- payload validation --- */

/**
 * Drops unknown keys, forces the category vocabulary, coerces every value to
 * its column type and rejects anything that cannot be stored safely.
 * Returns { ok:true, row } or { ok:false, error }.
 */
export function sanitize(table, input) {
  const def = SCHEMA[table];
  if (!def) return { ok: false, error: 'unknown table: ' + table };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'row must be an object' };
  }

  const id = input.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 128) {
    return { ok: false, error: 'row.id must be a non-empty string under 128 chars' };
  }

  if (!isISO(input.updated_at)) {
    return { ok: false, error: 'row.updated_at must be an ISO-8601 UTC instant' };
  }

  const row = {};
  for (const col of def.columns) {
    const raw = input[col];

    if (def.ints.indexOf(col) !== -1) {
      row[col] = raw ? 1 : 0;
      continue;
    }

    if (raw === null || raw === undefined) {
      row[col] = null;
      continue;
    }

    if (typeof raw === 'object') {
      return { ok: false, error: col + ' must be a scalar, not an object' };
    }

    const s = String(raw);
    if (s.length > MAX_TEXT) {
      return { ok: false, error: col + ' exceeds ' + MAX_TEXT + ' chars' };
    }
    row[col] = s;
  }

  // §0.2 — category is non-nullable and has exactly two legal values
  if (def.columns.indexOf('category') !== -1) {
    if (CATEGORIES.indexOf(row.category) === -1) row.category = 'personal';
  }

  row.id = id.trim();
  row.owner_id = row.owner_id || OWNER_ID;
  row.created_at = row.created_at || row.updated_at;
  return { ok: true, row: row };
}

/* ------------------------------------------------------------ statements --- */

/**
 * Columns a blank payload must never erase (Sprint 6).
 *
 * The Google link (google_event_id / etag / google_calendar_id) is learned by
 * /api/gcal/sync, not by the browser. A client that has never synced with
 * Google sends '' for all three, and a plain `col = excluded.col` would wipe
 * the link on the very next tap — orphaning the Google event and re-creating
 * it as a duplicate on the next cycle. So for these columns an empty incoming
 * value means "I have nothing to say", not "set this to nothing".
 *
 * Sprint 10 adds remind_key for the same reason from the other direction:
 * /api/gcal/sync writes whole event rows built from a Google payload, which
 * knows nothing about this app's reminder vocabulary and would otherwise null
 * the column on every inbound edit. The client never sends a blank — 'default'
 * is how it says "no opinion" — so a blank here can only ever be a writer that
 * has no opinion to express.
 */
const PRESERVE_IF_BLANK = {
  events: ['google_event_id', 'etag', 'google_calendar_id', 'remind_key'],
  tasks: ['remind_key']
};

/**
 * Parameterised UPSERT with a last-write-wins guard: an older payload updates
 * nothing, so replaying a stale outbox entry can never overwrite a newer edit.
 */
function upsertSQL(table) {
  const cols = SCHEMA[table].columns;
  const keep = PRESERVE_IF_BLANK[table] || [];
  const holes = cols.map(() => '?').join(', ');
  const sets = cols
    .filter(c => c !== 'id' && c !== 'created_at')
    .map(c => keep.indexOf(c) === -1
      ? c + ' = excluded.' + c
      : c + ' = COALESCE(NULLIF(excluded.' + c + ", ''), " + table + '.' + c + ')')
    .join(', ');

  return 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + holes + ') ' +
    'ON CONFLICT(id) DO UPDATE SET ' + sets + ' ' +
    'WHERE excluded.updated_at >= ' + table + '.updated_at';
}

/** table name is never client-supplied here — it is resolved through SCHEMA */
export async function upsertRow(binding, table, row) {
  const cols = SCHEMA[table].columns;
  const values = cols.map(c => (row[c] === undefined ? null : row[c]));
  await binding.prepare(upsertSQL(table)).bind(...values).run();

  // the client timeline is projected out of the client row on every write
  if (table === 'clients') await projectHistory(binding, row);
  return row;
}

/** tombstone, never a hard delete — a delete has to survive a pull (§8.4) */
export async function tombstone(binding, table, id, at) {
  if (!SCHEMA[table]) throw new Error('unknown table: ' + table);
  const stamp = isISO(at) ? at : nowISO();
  await binding
    .prepare('UPDATE ' + table + ' SET deleted_at = ?, updated_at = ? ' +
      'WHERE id = ? AND updated_at <= ?')
    .bind(stamp, stamp, id, stamp)
    .run();
  return { id: id, deleted_at: stamp };
}

export async function changedSince(binding, table, since, limit) {
  if (!SCHEMA[table]) throw new Error('unknown table: ' + table);
  const cap = Math.min(Math.max(parseInt(limit, 10) || PULL_LIMIT, 1), PULL_LIMIT);
  const mark = isISO(since) ? since : '';
  const res = await binding
    .prepare('SELECT * FROM ' + table + ' WHERE updated_at > ? ' +
      'ORDER BY updated_at ASC LIMIT ?')
    .bind(mark, cap)
    .all();
  return (res && res.results) || [];
}

/** history_logs mirrors clients.history_json so the log is queryable alone */
async function projectHistory(binding, row) {
  let entries = [];
  try {
    const parsed = JSON.parse(row.history_json || '[]');
    if (Array.isArray(parsed)) entries = parsed;
  } catch (e) { return; }              // a corrupt log never fails the write

  const stmts = [];
  for (const h of entries.slice(0, 200)) {
    if (!h || typeof h !== 'object') continue;
    const id = typeof h.id === 'string' && h.id ? h.id : null;
    const text = String(h.text == null ? '' : h.text).slice(0, MAX_TEXT);
    if (!id || !text) continue;
    const at = typeof h.at === 'number' ? new Date(h.at).toISOString() : nowISO();
    stmts.push(binding
      .prepare('INSERT INTO history_logs (id, client_id, action_text, created_at, kind) ' +
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ' +
        'action_text = excluded.action_text, kind = excluded.kind')
      .bind(id, row.id, text, at, String(h.kind || 'note')));
  }
  if (stmts.length) await binding.batch(stmts);
}

/* -------------------------------------------------------- request bodies --- */

export async function readJSON(request) {
  try {
    const body = await request.json();
    return (body && typeof body === 'object') ? body : null;
  } catch (e) {
    return null;
  }
}

/**
 * The shared body shape of every collection route: a single row, or { rows: [] }.
 * Returns an array — an empty one when the payload carries nothing usable.
 */
export function rowsOf(body) {
  if (!body) return [];
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body)) return body;
  return [body];
}
