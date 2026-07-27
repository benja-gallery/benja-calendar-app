# Calendar App — Project Plan & Full Specification

> **Status:** Core product specification injected, v0.2
> **Repository:** `C:\calendar-app` (fresh, independent git repo — no relationship to `benja-gallery`)
> **Created:** 2026-07-27 · **Spec injected:** 2026-07-27 (Sprint 1)

---

## 0. Core Product Specification (authoritative)

This section is the **authoritative product definition**. Where any later section conflicts
with it, this section wins.

### 0.1 Core Vision

A **Unified Personal & Business Productivity Center** — a single app that replaces the
scattered set of tools currently used for the same day. It combines, in one shell:

| Pillar | Hebrew | Role |
|---|---|---|
| Calendar | יומן | Scheduled events and meetings on a timeline |
| Tasks | משימות | Actionable to-dos, dated or undated |
| Lists | רשימות | Checklists (shopping, packing, project steps) |
| Notes | פתקים | Free-form captured text |
| Clients (CRM) | לקוחות | People and businesses, with follow-up state |
| Next Actions | צעדים הבאים | The single next action owed on any client or project |
| Reminders | תזכורות | Time-anchored nudges attached to any entity |

The product is not a calendar with extras bolted on — it is one **day-centric** surface where
personal life and business pipeline coexist without collapsing into each other.

### 0.2 Dual-Category Engine (non-negotiable)

**Every entity — Event, Task, List, Note, Client — MUST carry a `category` field with the
value `'personal'` or `'business'`.** There is no third state and no null. Category is:

- Assigned at creation time (the create form always exposes it, defaulted, never hidden).
- Persisted with the record.
- Carried through every read path, every render, and every export.
- Represented visually by a colour tag *and* a text label — colour is never the sole carrier.

Any entity created without a valid category is a bug, not a variant. The persistence layer
normalises unknown/missing values to `'personal'` on load so legacy rows can never crash a
render, but writers must always supply it explicitly.

### 0.3 Global Category Filter

A persistent, always-reachable three-way filter in the app shell:

```
[ הכל ]   [ אישי ]   [ עסקי ]
```

- Applies globally across every view simultaneously (My Day, Calendar, Tasks, Clients).
- Selection persists across sessions (stored with the local state).
- `הכל` is the default.
- Counters, summaries and empty states all respect the active filter — a filtered view never
  reports numbers from outside the filter.

### 0.4 Auth Model (V1)

- **V1 is a local single-user session:** user **Ben Perez** (בן פרץ), established locally with
  no network round-trip and no credential prompt.
- All application state persists to **`localStorage`** under a single versioned key, and the
  app is fully usable with no network at all.
- The session object and the store are shaped deliberately for a later migration to
  **Cloudflare D1 + Worker** with server-side auth and site-admin integration: every record
  carries a stable string `id`, a `createdAt`/`updatedAt` pair, and an `ownerId`, so rows can
  be lifted into D1 tables without a data rewrite.
- **No credential check ever runs in client JS.** V1 has no credential check at all; when
  auth arrives it arrives server-side (§4).

---

## 1. Vision & Goals

**Product:** A unified personal & business productivity center (§0.1), day-centric and RTL-native.

**Primary goals**
1. **Speed of capture** — creating *any* entity must take under 3 seconds from any screen,
   via a single always-visible Master Add control.
2. **One honest day view** — "My Day" answers *what do I owe today* across all seven pillars.
3. **Clean separation without silos** — personal and business live together, separable by one tap.
4. **Offline-first** — the app is fully usable with no network; sync reconciles on reconnect.
5. **RTL-native** — Hebrew is a first-class layout direction, not a retrofit.
6. **Trustworthy time** — correct timezone, DST, and recurrence handling with zero drift.

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

### 7.0 Design System — "Luxury Dark & Champagne Minimalist"

| Token | Value | Use |
|---|---|---|
| `--surface` | `#12161f` | App background |
| `--card` | `#1a202c` | Card / panel background |
| `--gold` | `#e4c278` | Champagne gold — primary accent, CTAs, active nav |
| `--business` | `#4a90e2` | Soft muted blue — business category tag |
| `--personal` | `#50c878` | Warm emerald — personal category tag |

Supporting tokens (`--ink`, `--muted`, `--line`, radii, shadows, spacing) derive from these
five and live in `styles.css` under `:root`. **No colour literal is written outside `:root`.**

### 7.1 Shell Architecture

- **Mobile (< 900px):** fixed **bottom navigation bar**, 5 items —
  `[היום] [יומן] [＋ הוספה] [משימות] [לקוחות]`, the centre item being the raised Master Add CTA.
- **Desktop (≥ 900px):** fixed **side rail** (visually right in RTL) carrying the same five
  items, same order, same labels. Bottom bar is hidden; rail is hidden on mobile.
- The global category filter (§0.3) sits in the top bar and is visible in every view.

### 7.2 Touch & Input Standard

- Every interactive target is **≥ 44×44 px**.
- Every `input`, `select` and `textarea` is locked to **16px** font-size to prevent iOS
  auto-zoom on focus.
- **Zero horizontal scroll** at any viewport ≥ 320px (`overflow-x: hidden` on the root plus
  no fixed-width children).
- Safe-area insets respected on the bottom bar (`env(safe-area-inset-bottom)`).

### 7.3 "My Day" (היום שלי) — the core screen

1. **Smart summary box** — greeting banner, time-of-day aware:
   `"בוקר טוב בן, יש לך היום X פגישות, Y משימות ו-Z מעקבים."`
   X/Y/Z are live counts under the active category filter.
2. **Today's timeline** — chronological hourly grid **08:00 → 22:00**, today's scheduled
   events and meetings placed in their hour row, current hour highlighted.
3. **Unscheduled "לביצוע היום"** — dedicated container for tasks dated today with no time.
4. **Attention cards** — highlighted counters for **overdue tasks** and **pending client
   follow-ups**, each tapping through to the relevant view.
5. **Master Add** — prominent centre-floating `[＋ הוספה חדשה]` CTA opening a bottom-sheet
   type chooser: `אירוע / פגישה · משימה · רשימה · פתק · לקוח חדש`, then a typed form sheet.
   The form always exposes the category selector (§0.2).

### 7.4a Calendar Engine (shipped — Sprint 2)

Four selectable views over a **single anchor date**, inside the `יומן` section. The view
switcher, the period navigation (`‹ › היום`) and the range label sit above the stage; the
active pane is the only one rendered.

| View | Hebrew | What it draws |
|---|---|---|
| Day | תצוגת יום | Full **00:00–23:59** hourly canvas, events positioned by real minute offsets, overlapping events split into lanes, live current-time line, untimed strip on top, that day's open tasks below |
| Week | תצוגת שבוע | Sunday→Saturday grid, 34px hour gutter + 7 fluid columns so it holds at 320px; the hour window widens past 08:00–22:00 rather than hide an event; all-day strip on top |
| Month | תצוגת חודש | Whole-week grid (no phantom filler row), category colour dots per day (≤4, then `+N`), today highlighted, out-of-month days dimmed |
| Agenda | סדר יום | Rolling 30-day chronological list, grouped by date, events and open tasks together |

- **Navigation:** prev/next step by the active period (day / 7 days / calendar month / 30 days),
  `היום` re-anchors to today, and a horizontal swipe on the stage steps the period.
  RTL: `הבא` sits on the left, so a leftward drag moves forward in time. `touch-action: pan-y`
  keeps vertical scrolling native.
- **Contextual creation:** every day cell and time slot carries `data-calslot="YYYY-MM-DD|HH:MM"`;
  tapping it opens the Master Add bottom-sheet with the date pre-filled, the start time pre-filled
  and the end time defaulted to +1h.
- **Category filter:** the calendar reads through the same `pick()` gate as every other view, so
  `הכל / אישי / עסקי` applies inside all four panes and to their counters (§0.3).
- **Persistence:** the selected view is stored in `prefs.calView` and normalised on load; every
  pane reads live from the `localStorage` store, so a create/complete/delete repaints immediately.
- **Date math:** month stepping clamps into short months (31/01 → 28/02, 29/02 on a leap year),
  weeks start Sunday for `he-IL`, and all dates are computed in local time — never `toISOString()`.
  `healthcheck.js` executes these helpers directly out of `window.APP.dates`.

### 7.4 General layout

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

### 8.1 PWA Delivery Layer (shipped — Sprint 2)

**Install shell**
- `manifest.json`: `display: standalone`, `start_url: ./index.html`, `scope: ./`, RTL Hebrew,
  background `#12161f`, theme `#e4c278`. Every path is **relative** so the app installs
  correctly from a GitHub Pages sub-path as well as from a domain root.
- Icons are generated deterministically by `tools/gen-icons.js` (dependency-free PNG encoder)
  — 32 / 180 / 192 / 512 `any` plus a 512 `maskable` whose mark sits inside the 80% safe zone.
- iOS install tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
  `apple-mobile-web-app-title`, `apple-touch-icon`.

**Service worker (`sw.js`)**
- Pre-caches the core shell (`index.html`, `styles.css`, `app.js`, `manifest.json`, icons) per
  asset, so a single 404 can never abort the install and leave the app uncached.
- Navigations: network-first with a cached-shell fallback → fresh code wins, offline still opens.
- Same-origin static assets: cache-first, refreshed in the background. Cross-origin and non-GET
  traffic is never touched.
- `CACHE_VERSION` is bumped on every shell change; `activate` evicts every other cache.

**Notifications**
- Top-bar toggle (`🔔 הפעל התראות פוש`) drives `Notification.requestPermission()` and reflects
  the three real browser states: default / granted / denied.
- Reminders are raised via `registration.showNotification()` (survives a backgrounded tab), with
  the plain `Notification` constructor as the desktop fallback.
- A 30s scan fires once per record per day for events and timed tasks entering the lead window
  (default 10 min). The fired-ledger lives in `prefs.fired` and is pruned daily.
- **The reminder scan deliberately bypasses the global category filter** (§0.3): the filter is a
  *view* concern, and hiding "עסקי" must never silently mute business meetings.
- `sw.js` implements the `push` event against `self.registration.showNotification()`, so
  server-sent push works the moment a VAPID key is wired into `Notify.subscribe()` (§12.5).

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
├── index.html           ← app shell (V1 ships flat, at the repo root)
├── styles.css
├── app.js
├── manifest.json        ← PWA install descriptor
├── sw.js                ← service worker: offline cache + push
├── icons/               ← generated PNGs (do not hand-edit)
├── tools/gen-icons.js   ← regenerates icons/ from the brand tokens
├── healthcheck.js       ← repo-local verification suite (§10)
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

0. ~~Authentication model for V1~~ — **resolved (§0.4):** local single-user session (Ben Perez)
   on `localStorage`, shaped for a later server-side D1/Worker migration.
1. Authentication model *post-V1* — shared-password (workspace precedent) or per-user accounts?
2. Is multi-user attendee invitation in v1 scope, or single-user-first?
3. Email reminder delivery — which provider binding?
4. Should subscribed ICS calendars land in v1 rather than v1.1?
5. Server-sent push: where do the VAPID keys live and which Worker route stores the
   subscription? The client hook (`APP.Notify.subscribe(publicKey)`) and the `sw.js` `push`
   handler are already in place — only the key and the send endpoint are missing.
