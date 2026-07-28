-- ===========================================================================
-- 0003_sprint10_remind.sql — per-record reminder leads (Sprint 10)
--
-- Migrations are append-only: 0001 and 0002 are never edited, so the reminder
-- column arrives as ALTER TABLE and lands *after* every earlier column. The
-- client (public/app.js SYNC_SCHEMA) and the Worker (functions/api/_shared.js
-- SCHEMA) list it in exactly that trailing position, and healthcheck.js rebuilds
-- the column order out of 0001 + 0002 + 0003 to prove all three still agree.
--
-- Vocabulary (public/app.js REMIND_OPTIONS)
--   'default' — use prefs.notify.lead, the system-wide default
--   'at'      — בזמן האירוע          (0 minutes)
--   '15'      — 15 דקות לפני
--   '60'      — שעה לפני
--   '1440'    — יום לפני
--   'none'    — muted, this record only
--
-- The value is NEVER '': remind_key is preserve-if-blank on the Worker side
-- (a blank incoming value means "I have nothing to say", so a blank could
-- never clear a choice), and 'default' is the explicit way to say "no opinion".
-- Existing rows are backfilled to it, so every pre-Sprint-10 record keeps the
-- exact ten-minute behaviour it already had.
-- ===========================================================================

ALTER TABLE events ADD COLUMN remind_key TEXT;   -- '' never; 'default' = system lead
ALTER TABLE tasks  ADD COLUMN remind_key TEXT;   -- same vocabulary, same default

UPDATE events SET remind_key = 'default' WHERE remind_key IS NULL OR remind_key = '';
UPDATE tasks  SET remind_key = 'default' WHERE remind_key IS NULL OR remind_key = '';
