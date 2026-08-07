-- ===========================================================================
-- 0007_sprint20_settings.sql — the app-settings row store (Sprint 20)
--
-- APPEND-ONLY, exactly like every migration before it. 0001–0006 are never
-- edited. This one adds a TABLE rather than a column, so it changes the live
-- column order of nothing and healthcheck.js's drift check between the SQL,
-- functions/api/_shared.js SCHEMA and public/app.js SYNC_SCHEMA is untouched.
--
-- WHY A NEW TABLE AND NOT A NEW COLUMN
--   The reserve-duty rotation (מנוע סבבי מילואים) is not a property OF an
--   event, a task or a client — it is a RULE that produces an answer for any
--   date at all. Six fields describe a whole year of it, and nothing is stored
--   per day. There is no entity table it belongs on, and inventing one row per
--   duty day would be exactly the data-entry burden the engine exists to
--   remove.
--
-- WHY IT IS DELIBERATELY NOT PART OF /api/sync
--   /api/sync replays an outbox of ROW ops against the five entity tables and
--   iterates TABLES to build its delta. A settings row is not a record: it has
--   no category, no owner-visible identity, no tombstone and no place in a
--   recycle bin. Folding it into that loop would have meant every one of those
--   concepts growing an exception. So it gets its own two-verb route
--   (/api/settings) and its own last-write-wins guard, and the sync engine is
--   left exactly as it was.
--
-- CONFLICT RESOLUTION
--   Identical to every other write in the app: last-write-wins on updated_at,
--   enforced in the UPSERT rather than in the client, so a stale phone coming
--   back online cannot overwrite a newer rule. The client sends its own
--   `updatedAt` inside value_json as well, which is what it compares on the
--   pull half before deciding whether to accept what came back.
--
-- SHAPE
--   key         a stable string naming WHICH setting ('reserve_shift')
--   value_json  the whole config object, verbatim JSON. The server never
--               parses it: the vocabulary of a rotation is the client's, and a
--               Worker that validated the field names would have to be
--               redeployed before the client could ever learn a new one.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_settings_owner ON app_settings (owner_id, updated_at);
