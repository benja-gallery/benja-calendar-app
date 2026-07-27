# Calendar App — Project Plan & Full Specification

> **Status:** Initial specification, v0.1
> **Repository:** `C:\calendar-app` (fresh, independent git repo — no relationship to `benja-gallery`)
> **Created:** 2026-07-27

---

## 0. Note on the source specification

The initializing directive instructed to "paste the full app specifications into it", but no
specification document was transmitted with the directive. This file therefore contains a
**complete, self-contained specification authored from the stated scope ("calendar app")**,
written to the same engineering standards used across this workspace (RTL-first Hebrew UI,
Cloudflare Workers/Pages + D1 backend, offline-first persistence, zero-bug policy).

If an authoritative spec document exists elsewhere, it should replace sections 2–8 verbatim.
Sections 1 and 9–11 are process scaffolding and remain valid either way.

---

## 1. Vision & Goals

**Product:** A fast, keyboard-driven calendar and scheduling application.

**Primary goals**
1. **Speed of capture** — creating an event must take under 3 seconds from any screen.
2. **Trustworthy time** — correct timezone, DST, and recurrence handling with zero drift.
3. **Offline-first** — the app is fully usable with no network; sync reconciles on reconnect.
4. **RTL-native** — Hebrew is a first-class layout direction, not a retrofit.

**Non-goals (v1)**
- Video-conferencing hosting (only join-link storage).
- Email client functionality.
- Multi-tenant org administration / SSO.

---

## 2. Core Feature Set

### 2.1 Views
| View | Description | Priority |
|---|---|---|
| Month | Standard grid, overflow "+N more" chips | P0 |
| Week | 7-column time grid, 15-min snap | P0 |
| Day | Single-column agenda + time grid | P0 |
| Agenda / List | Chronological upcoming list, infinite scroll | P1 |
| Year | Heatmap-style density overview | P2 |

### 2.2 Events
- Title, description, location, all-day flag, start/end (with timezone).
- Color labels + calendar assignment.
- Attendees (name + email), RSVP status (`accepted` / `declined` / `tentative` / `pending`).
- Attachments as external URLs (no blob storage in v1).
- Conferencing join link field.

### 2.3 Recurrence
- RFC 5545 `RRULE` subset: `DAILY`, `WEEKLY` (with `BYDAY`), `MONTHLY` (`BYMONTHDAY` / `BYDAY`), `YEARLY`.
- `UNTIL` and `COUNT` termination.
- Exceptions: `EXDATE` (deleted occurrence) and per-occurrence overrides (`RECURRENCE-ID`).
- Edit scopes: **this occurrence** / **this and following** / **all events**.

### 2.4 Reminders
- Per-event offsets (minutes/hours/days before).
- Delivery channels: in-app toast, Web Push, email (v1.1).
- Default reminder policy per calendar.

### 2.5 Calendars
- Multiple named calendars per user, each with a color and visibility toggle.
- Read-only subscribed calendars via ICS URL (v1.1).

### 2.6 Search & Navigation
- Full-text search across title / description / location / attendees.
- Quick-jump date picker (`g` then a date string).
- Command palette (`Ctrl/⌘ + K`).

### 2.7 Import / Export
- `.ics` import (single event and full calendar).
- `.ics` export per calendar and per event.

---

## 3. Time, Timezone & Recurrence Rules

These are the highest-risk correctness areas. Explicit rules:

1. **Storage:** all timed events stored as UTC epoch milliseconds **plus** the originating
   IANA timezone id (e.g. `Asia/Jerusalem`). Never store a bare local timestamp.
2. **All-day events:** stored as a floating `YYYY-MM-DD` date, never as UTC midnight.
3. **Recurrence expansion:** always computed in the event's originating timezone, then
   converted for display. This is what makes a 09:00 weekly meeting stay at 09:00 across DST.
4. **DST edge cases:** an event landing on a non-existent local time shifts forward to the
   next valid instant; an ambiguous time resolves to the **first** occurrence.
5. **Week start:** configurable, defaults to Sunday for `he-IL`, Monday for ISO locales.
6. **No expansion beyond a bounded window** — the server expands at most 24 months forward
   from the requested range to avoid unbounded series.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────┐
│  Client (Cloudflare Pages)                      │
│  ├── UI layer      — views, command palette     │
│  ├── Store         — in-memory + IndexedDB      │
│  ├── Recurrence    — RRULE expander (shared)    │
│  └── Sync engine   — outbox queue, reconcile    │
└───────────────┬─────────────────────────────────┘
                │  JSON over HTTPS
┌───────────────▼─────────────────────────────────┐
│  API (Cloudflare Worker)  /api/*                │
│  ├── auth       — session cookie, server-side   │
│  ├── events     — CRUD + range query            │
│  ├── calendars  — CRUD                          │
│  ├── reminders  — scheduling                    │
│  └── ics        — import / export               │
└───────────────┬─────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────┐
│  D1 (SQLite)  — durable store                   │
│  Durable Object / Cron — reminder dispatch      │
└─────────────────────────────────────────────────┘
```

**Key architectural constraints**
- **Single source of truth for time math:** one shared recurrence module, used by both client
  and Worker. No second expander is ever written.
- **Offline-first is non-negotiable:** every mutation is written to IndexedDB and an outbox
  queue *before* any network call. A failed request never loses user data.
- **Auth is server-side only.** No password or token check runs in client JS.
- **Idempotent writes:** every mutation carries a client-generated `op_id`; replaying an
  outbox entry is safe.

---

## 5. Data Model (D1)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  week_start    INTEGER NOT NULL DEFAULT 0,   -- 0=Sunday
  locale        TEXT NOT NULL DEFAULT 'he-IL',
  created_at    INTEGER NOT NULL
);

CREATE TABLE calendars (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  is_visible  INTEGER NOT NULL DEFAULT 1,
  ics_url     TEXT,                            -- non-null => read-only subscription
  created_at  INTEGER NOT NULL
);

CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  calendar_id    TEXT NOT NULL REFERENCES calendars(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  description    TEXT,
  location       TEXT,
  conference_url TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0,
  start_utc      INTEGER,                      -- epoch ms, NULL when all_day
  end_utc        INTEGER,
  start_date     TEXT,                         -- 'YYYY-MM-DD', used when all_day
  end_date       TEXT,
  timezone       TEXT NOT NULL,
  rrule          TEXT,                         -- RFC 5545 string, NULL = single event
  recurrence_id  TEXT,                         -- set on override instances
  parent_id      TEXT REFERENCES events(id),   -- series root for overrides
  status         TEXT NOT NULL DEFAULT 'confirmed',
  color          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER                       -- soft delete for sync tombstones
);
CREATE INDEX idx_events_range ON events(user_id, start_utc, end_utc);
CREATE INDEX idx_events_series ON events(parent_id);

CREATE TABLE event_exdates (
  event_id  TEXT NOT NULL REFERENCES events(id),
  exdate    INTEGER NOT NULL,
  PRIMARY KEY (event_id, exdate)
);

CREATE TABLE attendees (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES events(id),
  email     TEXT NOT NULL,
  name      TEXT,
  rsvp      TEXT NOT NULL DEFAULT 'pending',
  is_organizer INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reminders (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id),
  offset_minutes INTEGER NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'inapp',
  sent_at        INTEGER
);

CREATE TABLE sync_ops (
  op_id       TEXT PRIMARY KEY,               -- client-generated, idempotency key
  user_id     TEXT NOT NULL,
  applied_at  INTEGER NOT NULL
);
```

---

## 6. API Surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Server-side credential check, sets session cookie |
| `POST` | `/api/auth/logout` | Clears session |
| `GET`  | `/api/me` | Current user + preferences |
| `GET`  | `/api/calendars` | List calendars |
| `POST` | `/api/calendars` | Create |
| `PATCH`| `/api/calendars/:id` | Update |
| `DELETE`| `/api/calendars/:id` | Delete (cascades to events) |
| `GET`  | `/api/events?from=&to=&tz=` | **Expanded** occurrences in range |
| `POST` | `/api/events` | Create (requires `op_id`) |
| `PATCH`| `/api/events/:id?scope=` | Update; `scope` = `single`\|`following`\|`all` |
| `DELETE`| `/api/events/:id?scope=` | Delete with same scope semantics |
| `POST` | `/api/sync` | Batch outbox replay, returns server deltas |
| `POST` | `/api/ics/import` | Parse and ingest `.ics` |
| `GET`  | `/api/ics/export?calendar_id=` | Emit `.ics` |

**Conventions**
- All responses `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
- All mutating routes require the session cookie and a valid `op_id`.
- Range queries return **occurrences**, not raw rows — the client never expands `RRULE` for
  server-sourced data, only for optimistic local writes.

---

## 7. UI / UX Specification

**Layout direction:** RTL by default (`dir="rtl"`), with LTR fallback driven by locale.
Time grids mirror correctly — "later in the day" flows downward in both directions;
only the day-column order mirrors.

**Structure**
- **Top bar:** today button, prev/next, current range label, view switcher, search, avatar.
- **Left rail (visually right in RTL):** mini month picker, calendar list with visibility toggles.
- **Main canvas:** the active view.
- **Event composer:** inline popover for quick-create; full drawer for detailed editing.

**Interaction rules**
- Click-drag on a time grid creates an event with that duration.
- Drag an existing event to move; drag its bottom edge to resize.
- Recurring-event edits always prompt for scope before saving — never silently apply to all.
- Destructive actions (delete series, delete calendar) require explicit confirmation.

**Keyboard map**
| Key | Action |
|---|---|
| `d` / `w` / `m` / `a` | Day / Week / Month / Agenda view |
| `t` | Jump to today |
| `n` | New event |
| `j` / `k` or arrows | Previous / next period |
| `/` | Focus search |
| `Ctrl/⌘ + K` | Command palette |
| `Esc` | Close popover / drawer |

**Accessibility**
- Full keyboard reachability; visible focus rings.
- Time grid exposed as an ARIA grid with labelled cells.
- Contrast ratio ≥ 4.5:1 for all text; color is never the sole carrier of meaning
  (calendar identity also shown by label text).
- Respects `prefers-reduced-motion`.

---

## 8. Offline & Sync Semantics

1. Every mutation → IndexedDB write → outbox enqueue → optimistic UI update → network attempt.
2. On reconnect the outbox replays in order; `op_id` makes replays idempotent.
3. **Conflict resolution:** last-write-wins per field, using `updated_at`. When a local and
   remote edit touch the same event, the user is shown a non-blocking "this event changed
   elsewhere" notice with an undo affordance.
4. Deletions are tombstones (`deleted_at`), never hard deletes, so sync can propagate them.
5. Hydration from IndexedDB must render a usable calendar before any network call resolves.

---

## 9. Milestones

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M0 | Scaffold | Repo, tooling, CI, empty Worker + Pages deploy | Deployed hello-world |
| M1 | Data layer | D1 schema + migrations, `/api/calendars`, `/api/events` CRUD | CRUD passes integration tests |
| M2 | Time core | Shared recurrence expander + timezone/DST suite | Recurrence test suite green |
| M3 | Views | Month / Week / Day rendering, navigation | Manual RTL + LTR pass |
| M4 | Editing | Composer, drag-create, drag-move, scope prompts | Edit-scope matrix verified |
| M5 | Offline | IndexedDB store, outbox, sync reconcile | Airplane-mode session survives reload |
| M6 | Reminders | Scheduling + in-app and push delivery | Reminder fires within ±30s |
| M7 | ICS | Import / export round-trip | Round-trip preserves recurrence |
| M8 | Polish | A11y audit, perf budget, empty states | Budgets met (§10) |

---

## 10. Quality Bar & Verification

**Performance budgets**
- First contentful render of the current month: < 1.0s on a warm cache.
- View switch: < 100ms.
- Range query for a month with 500 events: < 150ms server-side.

**Test layers**
- Unit: recurrence expansion, timezone conversion, DST boundaries, ICS parse/serialize.
- Integration: API routes against a local D1.
- Health: a repo-local `healthcheck.js` that validates schema/migration consistency,
  route registration, and static asset integrity.

**Zero-regression rule (inherited workspace standard)**
Before any task is reported complete, the verification suite must run and pass. If it fails,
the change is fixed or reverted — the repository is never left broken.

---

## 11. Repository Conventions

```
C:\calendar-app\
├── PROJECT_PLAN.md      ← this file
├── public/              ← static client assets (Pages)
├── src/
│   ├── ui/              ← views and components
│   ├── core/            ← recurrence, timezone, ICS  (shared client+worker)
│   └── store/           ← IndexedDB + outbox
├── functions/api/       ← Worker routes
├── migrations/          ← D1 SQL migrations, numbered
└── test/                ← unit + integration suites
```

- Commit messages: single line, imperative mood (`add week-view drag-create`).
- Migrations are append-only and never edited after being applied.
- `src/core/` has no DOM and no Worker-runtime dependencies — it must run in both.

---

## 12. Open Questions

1. Authentication model — shared-password (workspace precedent) or per-user accounts?
2. Is multi-user attendee invitation in v1 scope, or single-user-first?
3. Email reminder delivery — which provider binding?
4. Should subscribed ICS calendars land in v1 rather than v1.1?
