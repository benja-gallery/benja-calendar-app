-- ===========================================================================
-- 0001_sprint5_init.sql — Cloudflare D1 schema (Sprint 5)
--
-- One table per pillar, exactly the columns the Sprint-5 mandate names, in the
-- mandated order, followed by the columns the offline-first sync engine needs
-- to round-trip a local record without loss (owner_id / created_at / deleted_at
-- and the few local fields that have no mandated column).
--
-- Conventions
--   * every timestamp is an ISO-8601 UTC string ('2026-07-27T09:00:00.000Z') —
--     last-write-wins compares them as text, so lexical order == chronological.
--   * category is 'personal' | 'business' and is NOT NULL on every table
--     (PROJECT_PLAN §0.2 — there is no third state and no null).
--   * deletions are tombstones (deleted_at), never hard deletes, so a delete
--     propagates to every other device on the next pull (§8.4).
--
-- Migrations are append-only — never edit this file once it has been applied.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'personal',
  start_time    TEXT,                       -- 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
  end_time      TEXT,
  location      TEXT,
  client_id     TEXT,
  category_type TEXT NOT NULL DEFAULT 'event',   -- pillar marker (rec.type)
  updated_at    TEXT NOT NULL,
  owner_id      TEXT NOT NULL DEFAULT 'ben-perez',
  notes         TEXT,
  created_at    TEXT,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'personal',
  status        TEXT NOT NULL DEFAULT 'new',
  priority      TEXT NOT NULL DEFAULT 'medium',
  due_date      TEXT,
  next_action   TEXT,
  subtasks_json TEXT NOT NULL DEFAULT '[]',
  client_id     TEXT,
  updated_at    TEXT NOT NULL,
  owner_id      TEXT NOT NULL DEFAULT 'ben-perez',
  due_time      TEXT,
  notes         TEXT,
  created_at    TEXT,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS lists (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'personal',
  items_json    TEXT NOT NULL DEFAULT '[]',
  client_id     TEXT,
  updated_at    TEXT NOT NULL,
  owner_id      TEXT NOT NULL DEFAULT 'ben-perez',
  list_date     TEXT,                       -- '' = a timeless list
  created_at    TEXT,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'personal',
  is_pinned     INTEGER NOT NULL DEFAULT 0,
  client_id     TEXT,
  updated_at    TEXT NOT NULL,
  owner_id      TEXT NOT NULL DEFAULT 'ben-perez',
  created_at    TEXT,
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL DEFAULT '',
  phone             TEXT,
  email             TEXT,
  status            TEXT NOT NULL DEFAULT 'lead',
  next_action       TEXT,
  initial_interest  TEXT,
  updated_at        TEXT NOT NULL,
  owner_id          TEXT NOT NULL DEFAULT 'ben-perez',
  category          TEXT NOT NULL DEFAULT 'business',
  budget            TEXT,
  next_action_at    TEXT,
  follow_up_at      TEXT,
  last_contact_at   TEXT,
  general_notes     TEXT,
  client_notes_json TEXT NOT NULL DEFAULT '[]',
  history_json      TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT,
  deleted_at        TEXT
);

-- The client timeline, projected out of clients.history_json on every write so
-- the log is queryable on its own (newest first) without unpacking JSON.
CREATE TABLE IF NOT EXISTS history_logs (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  action_text TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'note'
);

-- Idempotency ledger: replaying an outbox entry is a no-op (PROJECT_PLAN §8.2).
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL DEFAULT 'ben-perez',
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- --------------------------------------------------------------- indexes ---
-- Every pull is "give me everything newer than X", so updated_at leads.
CREATE INDEX IF NOT EXISTS idx_events_updated  ON events(updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_updated   ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_lists_updated   ON lists(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_updated   ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_clients_updated ON clients(updated_at);

CREATE INDEX IF NOT EXISTS idx_events_client  ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_client   ON tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_lists_client   ON lists(client_id);
CREATE INDEX IF NOT EXISTS idx_notes_client   ON notes(client_id);
CREATE INDEX IF NOT EXISTS idx_history_client ON history_logs(client_id, created_at);
