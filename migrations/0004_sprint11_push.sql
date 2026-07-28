-- ===========================================================================
-- 0004_sprint11_push.sql — Web Push delivery (Sprint 11, PROJECT_PLAN §7.4m)
--
-- APPEND-ONLY. 0001, 0002 and 0003 are never edited; this migration adds two
-- new tables and touches no existing column, so healthcheck.js can keep
-- rebuilding the entity column order out of 0001 + 0002 + 0003 unchanged.
--
-- Why these two tables exist at all: every reminder before this sprint was
-- raised by a setInterval inside the page. A page that is not open runs no
-- timers, so a reminder for a moment when the app happened to be closed was
-- never raised by anything. The dispatcher needs somewhere to keep the devices
-- it can reach (push_subscriptions) and a record of what it has already sent
-- (push_dispatch), because a cron that runs every minute must not deliver the
-- same reminder sixty times.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,          -- sha-256 of the endpoint, so a re-POST is an upsert
  owner_id      TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,             -- the device's public key, base64url
  auth          TEXT NOT NULL,             -- the device's auth secret, base64url
  user_agent    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_sent_at  TEXT,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  -- set when the push service answers 404/410: the endpoint is gone for good
  -- and retrying it every minute would burn the whole dispatch budget
  disabled_at   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_live ON push_subscriptions(owner_id, disabled_at);

-- The server-side twin of the client's prefs.fired ledger, keyed the same way:
-- "<record id>@<the record's OWN date>", never by today. A day-before reminder
-- is legitimately raised on the day before the event, and a key stamped with
-- today would be swept overnight and fire a second time in the morning.
CREATE TABLE IF NOT EXISTS push_dispatch (
  key       TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL,
  on_date   TEXT NOT NULL,                 -- the record's own date, for the sweep
  sent_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_dispatch_date ON push_dispatch(on_date);
