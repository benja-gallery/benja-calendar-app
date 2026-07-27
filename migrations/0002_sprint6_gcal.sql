-- ===========================================================================
-- 0002_sprint6_gcal.sql — Google Calendar two-way sync (Sprint 6)
--
-- Migrations are append-only: 0001 is never edited, so the three new event
-- columns arrive as ALTER TABLE and land *after* every Sprint-5 column. The
-- client (public/app.js SYNC_SCHEMA) and the Worker (functions/api/_shared.js
-- SCHEMA) list them in exactly that trailing position, and healthcheck.js
-- rebuilds the column order out of 0001 + 0002 to prove all three still agree.
--
-- Mapping (PROJECT_PLAN §7.4e)
--   Google primary calendar  ↔  category = 'personal'
--   Google business calendar ↔  category = 'business'
--
-- google_calendar_id records which calendar the event actually lives on, so
-- flipping an event's category can move it (delete there, insert here) instead
-- of silently forking into two Google events.
-- ===========================================================================

ALTER TABLE events ADD COLUMN google_event_id    TEXT;   -- Google's event id, '' = never pushed
ALTER TABLE events ADD COLUMN etag               TEXT;   -- Google's ETag, the If-Match precondition
ALTER TABLE events ADD COLUMN google_calendar_id TEXT;   -- the calendar the event currently lives on

-- One OAuth installation. Single-user by §0.4, so owner_id is the key.
CREATE TABLE IF NOT EXISTS gcal_accounts (
  owner_id      TEXT PRIMARY KEY,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,                      -- ISO-8601 UTC; refreshed before it lapses
  scope         TEXT,
  token_type    TEXT NOT NULL DEFAULT 'Bearer',
  auth_state    TEXT,                      -- CSRF nonce, cleared the moment it is redeemed
  auth_state_at TEXT,
  connected_at  TEXT,
  updated_at    TEXT NOT NULL DEFAULT ''
);

-- One row per mapped calendar. sync_token is Google's incremental cursor: with
-- it a pull returns only what changed, without it the pull is a bounded
-- full-window resync (Google answers 410 GONE when a token expires).
CREATE TABLE IF NOT EXISTS gcal_sync_state (
  calendar_key       TEXT PRIMARY KEY,     -- 'personal' | 'business' (== the category)
  owner_id           TEXT NOT NULL DEFAULT 'ben-perez',
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  sync_token         TEXT,
  last_sync_at       TEXT,                 -- ISO-8601 UTC — drives "סונכרן לאחרונה מול גוגל"
  updated_at         TEXT NOT NULL DEFAULT ''
);

-- Resolving an inbound Google event to its local row is the hot path of a pull.
CREATE INDEX IF NOT EXISTS idx_events_google ON events(google_event_id);
