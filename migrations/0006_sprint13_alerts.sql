-- ===========================================================================
-- 0006_sprint13_alerts.sql — per-record sound & vibration (Sprint 13)
--
-- APPEND-ONLY, exactly like every migration before it. 0001–0005 are never
-- edited, so these two columns TRAIL every column those five declared, and
-- healthcheck.js rebuilds the live column order the way SQLite does — the
-- CREATE TABLE declaration, then every ALTER TABLE ADD COLUMN in migration
-- order — and cross-checks it against functions/api/_shared.js SCHEMA and
-- public/app.js SYNC_SCHEMA. A column added in one place and forgotten in
-- another fails the build.
--
-- WHY A COLUMN THIS TIME
--   Sprint 12 deliberately added none: it WIDENED remind_key's vocabulary,
--   because "which reminders" was already a fact that column carried. This is
--   a genuinely new fact. remind_key answers WHEN a record announces itself;
--   these answer HOW. Folding "ring for ten seconds" into the reminder token
--   list would have meant a record could not change one without restating the
--   other, and /api/gcal/sync writes whole event rows through the same path.
--
-- THE VOCABULARY (public/app.js normAlertSound / normVibe — one place each)
--
--   alert_sound   'none'  — silent, this record only
--                 'short' — a short tone (the default, and what every
--                           pre-Sprint-13 row behaved as)
--                 'long'  — a ~10 second ringtone
--
--   alert_vibe    'none' | 'short' | 'long' | 'repeat'
--
--   WHICH short tone and WHICH long ringtone are a GLOBAL preference living in
--   localStorage (the settings drawer), not a per-record one. A record names a
--   FAMILY, so it can never point at a preset a later build stops shipping.
--
-- BACKWARD COMPATIBILITY
--   Both values are NEVER '': like remind_key, they are preserve-if-blank on
--   the Worker side (a blank incoming value means "I have nothing to say", so
--   a blank could never clear a choice). Existing rows are backfilled to the
--   defaults, which are exactly the behaviour they already had — every
--   pre-Sprint-13 reminder played the short chime and vibrated once.
--
--   An unknown value is normalised back to the default on every read path, on
--   both ends, so a row written by a future vocabulary can never mute a
--   reminder invisibly.
-- ===========================================================================

ALTER TABLE events ADD COLUMN alert_sound TEXT;   -- '' never; 'short' = the default
ALTER TABLE events ADD COLUMN alert_vibe  TEXT;   -- '' never; 'short' = the default
ALTER TABLE tasks  ADD COLUMN alert_sound TEXT;
ALTER TABLE tasks  ADD COLUMN alert_vibe  TEXT;
ALTER TABLE notes  ADD COLUMN alert_sound TEXT;
ALTER TABLE notes  ADD COLUMN alert_vibe  TEXT;

UPDATE events SET alert_sound = 'short' WHERE alert_sound IS NULL OR TRIM(alert_sound) = '';
UPDATE events SET alert_vibe  = 'short' WHERE alert_vibe  IS NULL OR TRIM(alert_vibe)  = '';
UPDATE tasks  SET alert_sound = 'short' WHERE alert_sound IS NULL OR TRIM(alert_sound) = '';
UPDATE tasks  SET alert_vibe  = 'short' WHERE alert_vibe  IS NULL OR TRIM(alert_vibe)  = '';
UPDATE notes  SET alert_sound = 'short' WHERE alert_sound IS NULL OR TRIM(alert_sound) = '';
UPDATE notes  SET alert_vibe  = 'short' WHERE alert_vibe  IS NULL OR TRIM(alert_vibe)  = '';
