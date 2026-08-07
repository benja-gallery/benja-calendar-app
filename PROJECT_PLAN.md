# Calendar App — Project Plan & Full Specification

> **Status:** Sprint 20 shipped (§7.4v) — **מנוע סבבי מילואים ומשמרות**: the calendar now
> *computes* a reserve-duty rotation instead of asking anyone to type it in. One
> `reserveShiftConfig` of six fields — anchor date, which leg it opens, the two leg lengths
> and an end date — and `getShiftForDate()` answers `HOME` / `BASE` / `''` for any date at
> all, with nothing stored per day, so a date three years out costs what tomorrow costs.
> 🏡 בית and 🪖 בסיס are tinted across month, week, day, agenda and a **new year view**
> (twelve mini-months — the only surface a 7/7 stripe fits on), behind one 🛡️ toggle and a
> settings sheet that moves the transition date, flips the phase, changes the leg lengths and
> reads the rule back as real dates. The config syncs to D1 through a new `app_settings`
> table and `/api/settings`. v26.
> Sprint 19 before it (§7.4u) — **שעון מעורר ברקע**: a push now carries the alarm itself, so
> a reminder rings on a locked phone with the app closed. v25.
> Sprint 18 before it (§7.4t) — **מסך שעון מעורר ופתיחת פרטים מהיומן**: a due
> reminder no longer just notifies, it raises a full-screen alarm that rings on a beat,
> buzzes on `[1000,500,1000,500]`, holds a `wakeLock` on the screen and does not stop for
> anything but `ביטול התראה / כבה` — with a persisted queue, so two reminders in one minute
> are two alarms and one the phone was locked on is still owed on the next launch. And
> every event/task title in the month, week and day panes is now a `data-open` control that
> lands in the detail reader, instead of the calendar being the one place a record could be
> seen but not opened. v24.
> Sprint 15 before it (§7.4q) — **קטלוג המצרכים**: the list form now carries the
> whole grocery vocabulary the field mandate handed over — 161 products across ten aisles
> (`PANTRY`) — as a searchable chip grid under the items field. A tap adds a line, a second
> tap removes it, and the textarea stays the single source of truth, so a hand-typed product
> ticks its own chip and `mergeChecklist()` keeps every item's progress on an edit. v21.
> Sprint 14 before it (§7.4p) — the compact task row and the tap-to-expand reader, v20.
> Sprint 13 before it (§7.4o) — **the hamburger settings drawer**: the top bar is
> down to a title, the cloud badge and `☰`; every pill it carried (`#pushBtn`, `#soundBtn`,
> `#gcalBtn`, `#gcalSync`, `#trashBtn`) is the same element moved into `#settingsDrawer`;
> reminders now carry their own `alert_sound` / `alert_vibe` (a short tone or a ~10-second
> `צלצול`, and `רטט קצר / ארוך / חוזר`); `רטט במגע` silences taps and never a reminder; and
> `data-theme` on `<html>` carries a resolved כהה / בהיר / לפי המערכת palette. v19.
> Sprint 12 before it (§7.4n) — multiple reminders per record, the "פתוחות" sheet and the
> detail reader, v18.
> Field wave before that (§7.4l) — **the PWA update path**: `controllerchange` now
> reloads the page onto new code, a waiting worker is adopted, a resumed app re-checks for a
> version, cache reads are scoped to `CACHE_NAME`, and `index.html` busts `app.js`/`styles.css`
> against `CACHE_VERSION`. This is why the phone kept showing v13 with v14 deployed, v0.9.2.
> §7.4k before it — ריקון סל המחזור, one tap that empties the whole bin.
> §7.4j before it — בחירה מרובה inside סל המחזור: long press or the
> bin's own pill, batch שחזור / מחיקה לצמיתות, and a struck-through `בוצע` row, v0.9.1.
> Sprint 9 before it (§7.4i) — in-place strikethrough completion, the manual
> `העבר משימות שבוצעו להיסטוריה` batch archive with a 10-day היסטוריה log, and the end of the
> UI shake (the entrance animation is now opt-in via `.is-entering`), v0.9.0. Sprint 8 before
> it (§7.4h) — the 400ms completion gesture, the 10-day סל מחזור, universal tap-to-edit.
> Waves 1–3 (§7.4g) — breakage fixes, delete confirmation, universal edit, batch actions.
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
| `GET`  | `/api/gcal/auth` | Google connection status (booleans + last sync) — Sprint 6 |
| `GET`  | `/api/gcal/auth?action=start` | 302 → Google consent screen |
| `GET`  | `/api/gcal/auth?code=&state=` | Google's callback; exchanges the code, 302 back to the app |
| `POST` | `/api/gcal/auth` | `{ action: 'disconnect' }` — forgets every stored token |
| `GET`  | `/api/gcal/sync` | Per-calendar sync state, runs nothing |
| `POST` | `/api/gcal/sync` | Runs one two-way Google Calendar cycle (§7.4e) |
| `GET`  | `/api/settings?key=` | One `app_settings` row — the reserve rotation config (§7.4v) |
| `POST` | `/api/settings` | `{ key, value, updated_at }` — last-write-wins upsert |
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

- Every interactive target is **≥ 44×44 px**. Since Sprint 7 this is enforced by a CSS
  parse in `healthcheck.js`, not by inspection: any rule that sizes a control below the
  floor fails the build. A control that must stay visually small clears the floor with a
  transparent centred `::after` hit expander rather than a bigger box (§7.4f).
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

### 7.4b Tasks Engine, Smart Checklist Lists & Quick Notes (shipped — Sprint 3)

The `משימות` section is one screen carrying three stacked modules: tasks, lists, notes.

**Tasks Engine (משימות)**

| Field | Values |
|---|---|
| `title` | free text (required) |
| `category` | `personal` / `business` (§0.2) |
| `due` + `time` | date required, time optional |
| `priority` | `high` גבוהה · `medium` בינונית · `low` נמוכה |
| `status` | `new` חדש · `todo` לביצוע · `progress` בתהליך · `waiting` ממתין ללקוח · `done` הושלם · `cancelled` בוטל |
| `nextAction` | **הפעולה הבאה** — the single next physical move, rendered as a gold callout |
| `subtasks` | `{id,title,done}[]` checklist with its own progress bar |

- **`status` is the source of truth; the Sprint-1 `done` boolean is derived from it** and kept
  in lockstep by `setTaskStatus()`, so every selector written before this sprint keeps working.
  A store written by Sprint 1 migrates on load: `done:true → הושלם`, `done:false → חדש`.
- **ממתין ללקוח** is the one status that shouts — its own `--waiting` token, a bordered badge
  with a halo, an ⏳ glyph, a rail on the row itself and a dedicated attention card on "היום שלי".
- **One-tap operation:** the round check-off completes a task and remembers the status it came
  from, so un-checking restores it (never a blind reset to "new"). The status chip itself is a
  button that walks the working loop חדש → לביצוע → בתהליך → ממתין ללקוח → חדש; closed statuses
  re-enter the loop at לביצוע. Checking the last sub-task closes the whole task.
- **Quick sub-tabs:** `הכל · היום · באיחור · ממתין · הושלם`, each carrying a live count. The
  selection persists in `prefs.taskTab`. `בוטל` counts as closed — it never leaks into a work tab.

**Smart Checklist Lists (רשימות)**
- Shopping, studio equipment and project to-dos: `{id,title,done}[]` items with a real-time
  progress bar showing both the percentage fill and the `3/5 הושלמו` count.
- Lists are **timeless by default** and optionally date-bound (`date: 'YYYY-MM-DD'`, rendered
  through `relDay()`); a timeless list is badged `ללא תאריך`.
- v1 stores kept list items as plain strings — `migrateList()` adopts them into checklist rows
  on load, so no historical list is lost.

**Quick Notes (פתקים)**
- Free-text cards with the same `אישי / עסקי` tag as everything else.
- **הצמד למעלה** pins a note; pinned notes sort first, newest first inside each band.
- Quick action menu converts a note into a **task** (lands as `לביצוע`, due today) or an
  **event** (today, 09:00–10:00). Title, body and category all survive the type change.

**Persistence** — every mutation above (status cycle, check-off, sub-task, list item, pin,
conversion) writes through `Store.save()` to `localStorage` and repaints immediately.
`healthcheck.js` executes the whole engine out of `window.APP.tasks / .lists / .notes`.

### 7.4c Client CRM, Client Drawer & the "Next Action" Engine (shipped — Sprint 4)

The `לקוחות` section is a sales pipeline, not an address book. Every record answers one
question on sight: **what do I owe this person next?**

**Client CRM — the card pipeline (אזור הלקוחות)**

| Field | Values |
|---|---|
| `name` | free text (required) |
| `category` | `personal` / `business` (§0.2) |
| `phone` / `email` | contact channels; both optional, both drive the quick actions |
| `status` | the nine pipeline stages below |
| `interest` | Initial Interest / Artwork — *תחום עניין / יצירה* |
| `budget` | free text, deliberately not a number (ranges and currencies are real) |
| `nextAction` + `nextActionAt` | **הפעולה הבאה** — the single next physical move, and when |
| `followUpAt` / `lastContactAt` | follow-up date, and when you actually last spoke |
| `clientNotes` | `{id,body,at}[]` — the פתקים tab |
| `history` | `{id,at,kind,text}[]` — the היסטוריה timeline, newest first, capped at 200 |

Statuses, in pipeline order: **ליד חדש · נוצר קשר · מתעניין · נשלחה הצעה · ממתין לתשובה ·
פגישה נקבעה · עסקה נסגרה · לא רלוונטי כרגע · לקוח עבר**. `normClientStatus()` folds anything
unknown back to `ליד חדש`, so a legacy or corrupt row can never crash a render.

- **Card list:** name, status badge, category tag, phone + email, initial interest and the
  defined Next Action — or the alert badge when there is none. Colour is never the sole
  carrier: the stage shows as a badge *and* as the card's start rail.
- **Sub-tabs:** `הכל · לידים חדשים · פעילים · ממתינים · סגורים`, each with a live count.
  The five buckets **partition all nine statuses exactly once** — no status is unreachable
  and none is double-counted. The selection persists in `prefs.clientTab`.
- **Quick actions on every card:** `📞 התקשר` (`tel:`) and `💬 וואטסאפ` (`wa.me`). Israeli
  numbers are normalised for WhatsApp (`050-1234567` → `972501234567`); an already
  international number is left alone, and a missing number renders a disabled affordance
  instead of a dead link. Both are real anchors — the OS owns the link, the app only logs
  the touch and stamps `lastContactAt`.
- **Ordering:** open before closed, **holes in the pipeline first**, then by when the next
  action is due. A deep-link from the dashboard therefore always lands on the gaps.

**Client Drawer (תיק לקוח)**

Tapping a card opens a mobile-first slide-over: a bottom sheet under 900px, a right-anchored
side panel above it. Six tabs over one record:

| Tab | Contents |
|---|---|
| סקירה | stage picker, the Next-Action editor, a fact sheet (budget, interest, last contact, follow-up), the general note, and the quick contact buttons |
| פגישות | linked events split into **פגישות קרובות** and **פגישות שהיו** |
| משימות | linked tasks with the full Sprint-3 row — one-tap check-off and the status chip |
| רשימות | linked checklists with their progress bars |
| פתקים | free-text notes tied to this client, newest first, with a composer |
| היסטוריה | chronological log: file opened, status moves, next-action edits, contacts, linked records |

- **Association:** events, tasks and lists carry an optional `clientId`. Every one of those
  create forms exposes a client select, and each drawer tab can create straight into the file
  with the association pre-filled — the form returns to the same tab on save.
- **The drawer reads the full store, not `pick()`.** This is a deliberate carve-out from
  §0.3, the same one the reminder scan takes (§8.1): a client file that silently hides half
  its meetings because the global filter sits on `אישי` is a data trap, not a filter.
- Every drawer tab builder is a pure function of `(client, links)`, so `healthcheck.js`
  renders whole client files head-lessly and asserts what they contain.

**"Next Action" alert engine (מנגנון הפעולה הבאה)**

- Every **active** client must carry a designated Next Action (`"לחזור ביום שלישי"`,
  `"לבדוק הדמיה"`). Whitespace is not an action.
- When one is missing, the client is badged **⚠️ אין פעולה הבאה מוגדרת** — on the card, and
  again at the top of the drawer.
- The dashboard gains a fourth **attention card**, `ללא פעולה הבאה`, counting exactly those
  clients and deep-linking into the clients view, where they already sort to the top.
- **Closed files are exempt.** The mandate names עסקה נסגרה and לא רלוונטי כרגע; **לקוח עבר
  is exempted too**, because a past client is by definition a finished relationship and
  flagging every archived file would flood the attention card and destroy the signal. The
  exempt set is one constant, `CLIENT_CLOSED`, shared by the closed sub-tab and the engine.

**Persistence** — client CRUD, status moves, next-action edits, notes and every logged
contact write through `Store.save()` to `localStorage` and repaint immediately, drawer
included. `healthcheck.js` executes the whole CRM out of `window.APP.clients`.

### 7.4d Cloudflare D1, the Worker sync API & the offline outbox (shipped — Sprint 5)

The store stops being a single-device store. `localStorage` remains the surface the
UI reads and writes; **Cloudflare D1** becomes the durable copy behind it, reached
through a **Cloudflare Worker** at `/api/*`, and reconciled by an outbox that survives
being offline, being closed, and being wrong.

**D1 schema** — `migrations/0001_sprint5_init.sql`, one table per pillar

| Table | Mandated columns (in order) |
|---|---|
| `events` | `id · title · category · start_time · end_time · location · client_id · category_type · updated_at` |
| `tasks` | `id · title · category · status · priority · due_date · next_action · subtasks_json · client_id · updated_at` |
| `lists` | `id · title · category · items_json · client_id · updated_at` |
| `notes` | `id · title · body · category · is_pinned · client_id · updated_at` |
| `clients` | `id · name · phone · email · status · next_action · initial_interest · updated_at` |
| `history_logs` | `id · client_id · action_text · created_at` |

- Each table then carries the columns the sync engine needs to round-trip a local
  record without loss: `owner_id`, `created_at`, `deleted_at` (the tombstone), and the
  few local fields with no mandated column (`notes`, `due_time`, `list_date`, `budget`,
  `general_notes`, `client_notes_json`, `history_json`).
- `category` is `TEXT NOT NULL` on every entity table — §0.2 has no third state and no
  null, and the Worker folds an unknown value back to `personal` before it reaches SQL.
- `history_logs` is projected out of `clients.history_json` on every client write, so
  the timeline is queryable on its own without unpacking JSON.
- `sync_ops(op_id PRIMARY KEY)` is the idempotency ledger: a replayed op is a no-op.
- Every timestamp crossing the wire is an **ISO-8601 UTC instant**, so last-write-wins
  can compare them as text — lexical order equals chronological order.

**Worker API** — `functions/api/`, `{ ok:true, data }` / `{ ok:false, error }` (§6)

| Route | Verbs |
|---|---|
| `/api/sync` | `POST` — batch outbox replay **and** delta pull in one round-trip |
| `/api/events` `/api/tasks` `/api/lists` `/api/notes` `/api/clients` | `GET ?since=` · `POST` upsert · `DELETE ?id=` tombstone |

- The five collection routes are one implementation (`_collection.js`) parameterised by
  table name; the table is resolved through `SCHEMA` in `_shared.js` and is **never**
  taken from the request, so no route can be aimed at an arbitrary table.
- Every statement is parameterised. The upsert carries a
  `WHERE excluded.updated_at >= <table>.updated_at` guard, so a stale replay cannot
  overwrite a newer edit even when ops arrive out of order.
- `sanitize()` drops undeclared keys, coerces each value to its column type, forces the
  category vocabulary and refuses objects, oversized text and non-ISO stamps. A single
  bad row is rejected **by name** and the rest of the batch still lands.

**The offline outbox (client)**

1. Every tap writes `localStorage` first. The network is never between a tap and a repaint.
2. `Store.save()` diffs the whole store against a per-record **shadow** of what the server
   has, and drops the difference into a persisted **outbox**. No mutation path has to
   opt in — a change cannot escape the diff — and the queue is part of the store, so it
   survives a reload.
3. One op per record: a second edit before a push replaces the first rather than appending.
4. A record that vanished locally but is known to the shadow becomes a **tombstone** op.
5. `POST /api/sync` replays the outbox and pulls everything newer than the cursor, on
   launch, on reconnect (`online`), on tab focus, on a 30s heartbeat, and 1.2s after a
   local write. A failed push changes nothing — the queue is untouched.
6. **Conflict resolution is last-write-wins on `updated_at`**, applied on both ends. After
   a merge the shadow is set to the *server's* stamp, never the local one, so a local
   record that is genuinely newer still differs from the shadow and gets re-offered.
7. An op the server *refuses* is dropped and its shadow forgotten — retrying a payload the
   server will never take would wedge the queue and freeze the badge on 🟡 forever.

**Cloud status indicator** — a badge in the app header, three honest states, colour never
the sole carrier (the glyph and the Hebrew label say the same thing the tint does):

| State | Badge | Meaning |
|---|---|---|
| `synced` | 🟢 **מסונכרן לענן** | outbox empty, the last round-trip succeeded |
| `pending` | 🟡 **ממתין לסנכרון** | mutations are queued, or the cloud has not answered yet |
| `offline` | 🔴 **אופליין** | no network, or no cloud configured — the app still works, locally |

Tapping the badge forces a flush. `sw.js` (now `v5`) explicitly **excludes `/api/*`** from
its caches: a cached delta would hand the client stale rows and silently stall the outbox.

**Deployment** — `wrangler.toml` binds D1 as `DB` and points at `migrations/`.
Until `database_id` is filled in, `/api/*` answers `500 no_binding`, the badge sits on
🔴 and the app is entirely usable on its local store.

**Live as of 2026-07-27** — the binding is filled in and the cloud layer is activated:

| | |
|---|---|
| D1 database | `benja-calendar` · `fa6d103d-b10d-4db0-a719-1c8420d2053a` · region `EEUR` |
| Migration state | `0001_sprint5_init.sql` applied `--remote` (18 statements) |
| Pages project | `benja-calendar-app`, production branch `main` |
| Production URL | `https://benja-calendar-app.pages.dev` |

`SYNC_ENDPOINT` stays relative (`'api'`), so the client resolves `/api/sync` against
whatever origin it was served from — Pages root, a Pages preview alias, or a GitHub
Pages sub-path — with no per-environment build step.

**Verification** — `healthcheck.js` §19 executes the engine head-lessly: it cross-checks
the column list across all three artefacts (SQL ↔ Worker ↔ client), round-trips every
pillar through `toRow`/`fromRow`, drives the outbox through edit / re-edit / delete /
apply / reject cycles, and asserts the last-write-wins and tombstone outcomes directly.

### 7.4e Google Calendar two-way sync & the `public/` build directory (shipped — Sprint 6)

**Why the repository split**

Until Sprint 6 the app shipped flat: `pages_build_output_dir = "."` meant Cloudflare Pages
uploaded the *entire* repository, so `PROJECT_PLAN.md`, `healthcheck.js`, `wrangler.toml`
and every migration were fetchable over HTTP by anyone who guessed the filename. Sprint 6
splits the tree in two:

```
public/       ← the only directory Pages uploads: index.html, styles.css, app.js,
                manifest.json, sw.js, icons/. Nothing else is reachable over HTTP.
repo root     ← PROJECT_PLAN.md, README.md, healthcheck.js, wrangler.toml,
                migrations/, tools/. Outside the build output, therefore never served.
functions/    ← stays at the ROOT on purpose: Pages compiles Functions from the project
                root, not from the output directory, and mounts them at /api/*. Moving
                it into public/ would both unmount the API and publish its source.
```

`pages_build_output_dir = "public"` is the single line that enforces it, and
`healthcheck.js` §20 asserts both halves — every published asset is in `public/`, and no
config file has leaked into it. Icon regeneration writes to `public/icons/` so it cannot
resurrect the old root copy.

> **Consequence for GitHub Pages:** the branch-root deploy documented in the README no
> longer serves the app, because the shell now sits one directory down. Cloudflare Pages
> is the deployment target from Sprint 6 onward. GitHub Pages could never satisfy the
> shielding requirement anyway — it publishes every file in the branch, `PROJECT_PLAN.md`
> included.

**The mapping**

| Google calendar | Local category | Resolved id |
|---|---|---|
| Primary | `personal` | `primary` |
| Business | `business` | `GOOGLE_BUSINESS_CALENDAR_ID`, falling back to `primary` |

`category` is the mapping key, which keeps §0.2 intact: there is no third calendar because
there is no third category, and an unknown category is forced to `personal` exactly as it is
everywhere else.

**Schema (migration `0002_sprint6_gcal.sql`, append-only)**

- `events.google_event_id` — Google's event id; `''` means "never pushed".
- `events.etag` — Google's ETag, sent back as the `If-Match` precondition on every push.
- `events.google_calendar_id` — which calendar the event currently lives on, so flipping an
  event's category *moves* it (delete there, insert here) instead of forking it into two.
- `gcal_accounts` — the single OAuth installation: access token, refresh token, expiry, and
  the CSRF `auth_state` nonce, cleared the moment it is redeemed.
- `gcal_sync_state` — one row per calendar holding Google's `sync_token` and `last_sync_at`.

Because the browser knows nothing about the Google link, it echoes `''` for all three
columns. The Worker's UPSERT therefore treats an empty incoming value for them as *"I have
nothing to say"* rather than *"set this to nothing"* — without that guard the very next tap
on a phone would orphan the Google event and the next cycle would duplicate it.

**API surface**

| Route | Method | Purpose |
|---|---|---|
| `/api/gcal/auth` | GET | `{ configured, connected, lastSyncAt, calendars }` |
| `/api/gcal/auth?action=start` | GET | 302 → Google consent (`access_type=offline`, `prompt=consent`) |
| `/api/gcal/auth?code=…&state=…` | GET | Google's callback → token exchange → 302 back to `/?gcal=connected` |
| `/api/gcal/auth` | POST | `{ action: 'disconnect' }` — forgets every stored token |
| `/api/gcal/sync` | GET | per-calendar state without running anything |
| `/api/gcal/sync` | POST | runs one full two-way cycle |

No token ever reaches the browser. The client learns three booleans and a timestamp; the
refresh token lives only in D1 and is read only inside the Worker.

**One cycle, per calendar, in this order and never any other**

1. **Pull** — incremental via Google's `syncToken`, `showDeleted=true` so a deletion made on
   a phone arrives as `status: 'cancelled'` and becomes a local tombstone (§8.4). The first
   run, or a `410 GONE` (how Google retires a stale token), falls back to a bounded 180-day
   window rather than the whole history. Paging is capped.
2. **Push** — every local event that is new, edited or deleted since the last cycle, *minus*
   anything the pull just wrote, so a row can never be pushed straight back at the calendar
   it arrived from. New rows `insert`, known rows `patch` with `If-Match`, tombstones
   `delete`. A `404`/`410` on patch recreates the event; a `412` is a real conflict.
3. **Stamp** — store the new `syncToken` and `last_sync_at`.

**Conflict resolution** is last-write-wins on ISO-8601 instants — the same rule `/api/sync`
already applies between devices (§8.3) — comparing Google's `updated` against the row's
`updated_at` as strings, because ISO sorts lexically. On a `412` the event is re-read and
LWW arbitrates: Google newer ⇒ Google's copy lands locally; local newer ⇒ the patch is
retried without the precondition.

Writing `google_event_id` / `etag` / `google_calendar_id` back onto a row deliberately does
**not** bump `updated_at`. The bookkeeping is not a user edit, and bumping it would re-select
the row on every subsequent cycle, forever.

**Time model** — a local event stores wall-clock (§3): `YYYY-MM-DD` for all-day,
`YYYY-MM-DDTHH:MM` for timed. Google's all-day `end.date` is **exclusive**, so a one-day
event on the 27th is `start 2026-07-27 / end 2026-07-28` there and
`start_time = end_time = '2026-07-27'` here. Every conversion crosses that ±1 day boundary,
and getting it wrong shifts every all-day event by a day — which is exactly what
`healthcheck.js` §21 pins, month, year and leap-day rollovers included.

**UI** — a third pill in the top bar, matching the sync badge and the push toggle:

| State | Button | Meaning |
|---|---|---|
| `off` | 📅 **התחבר ל-Google Calendar** | tapping starts the consent flow |
| `on` | 📅 **מחובר ל-Google Calendar** | tapping runs a cycle now |
| `busy` | 📅 **מסנכרן מול Google…** | a cycle is in flight |
| `na` | 📅 **Google Calendar לא מוגדר** | the deployment carries no credentials |

Under it sits the readout **סונכרן לאחרונה מול גוגל: HH:MM**, cached in the local store so it
still reads correctly with no network, plus a **ניתוק** affordance while connected. A cycle
runs on connect, on a five-minute heartbeat while the tab is visible, and on demand — then
calls `Sync.flush()`, because it is `/api/sync` that carries the changed rows home.

**Deployment** — four secrets on the Pages project: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (pointing at `…/api/gcal/auth`) and
`GOOGLE_BUSINESS_CALENDAR_ID`. Until they are set, `/api/gcal/*` answers
`503 gcal_not_configured`, the button renders `na`, and every Sprint-5 capability is
untouched. `sw.js` is bumped to `v6`.

**Verification** — `healthcheck.js` §20–§21 execute the mapping module for real: calendar
mapping both directions, the exclusive-end math with its rollovers, a local → Google → local
round-trip with no drift, wall-clock slicing of RFC-3339 offsets, LWW ordering including the
equal-instant case, no-op suppression, the Google link round-tripping through the client
serialisers, and that no OAuth secret appears in any source file.

### 7.4f Premium UX — haptics, targeted rendering & the undo safety net (shipped — Sprint 7)

Sprint 7 spends nothing on new features. It closes the gap between "a web app that works"
and "an app that feels native": the four things a finger notices in the first ten seconds.

**1. Haptics & tactile press states**

`navigator.vibrate` exists on Android/Chrome, is permanently absent on iOS Safari, and is
silently ignored in a tab the user has never engaged. Exactly one call site in the whole
codebase is allowed to touch it — `Haptics.fire()` — and it is support-gated and wrapped in
a `try`, because a tap must never fail on a device with no motor. Two pulses only:

| Pulse | Pattern | When |
|---|---|---|
| `light` | `10ms` | every delegated control: button taps, tab switches, status toggles |
| `done` | `[10, 40, 10]` | something finished — a task closed, a checklist filled up |

The pulse is fired once, in the click delegate, immediately **after** a control has been
matched — never on a stray tap on the background.

Visually the same press is answered by `transform: scale(.97)` over `.1s ease` on every
control. `transform` is the only animated property, so a press never triggers layout of
anything around it, and `.fab` composes its own rule so it keeps its positioning transform.
Keyboard focus paints a `2px` gold ring through **`:focus-visible`**, and
`:focus:not(:focus-visible)` clears it so a finger never leaves a ring behind.

**2. Targeted DOM updates**

Until Sprint 7 every tap called `render()`, which rewrote the `innerHTML` of every container
in the app — including the one the finger was still on. The pressed card was destroyed and
rebuilt mid-press: the `:active` state died and the layout flickered.

A simple state change now takes two steps:

1. **`Patch.record(collection, id)`** — every row builder stamps
   **`data-rec="collection:id"`** (plus `data-compact="1"` for the dense calendar variant)
   on its root node, so one record can be repainted *in place*, in every pane it appears in
   — My Day, the tasks list, a calendar pane, an open client file. No container is touched.
2. **`Patch.settle()`** — the derived surfaces refresh (counters, the summary line, the
   attention strip — all cheap text), and a list container is rebuilt **only if its
   membership changed**. Membership is the ordered list of `data-rec` keys the container
   *should* hold, compared against the ones it *does* hold. A task that just left
   `לביצוע היום` still has to disappear; a task that merely changed priority does not cost a
   single container rewrite. Containers belonging to an off-screen view are skipped
   entirely — `setView()` runs a full `render()` on the way in.

Every list renderer takes a `quiet` flag: when set it skips its markup and refreshes only
its meta line. The calendar publishes `Cal.keys()`; month and week draw their records as
dots and chips rather than rows, so they answer `null` — "always rebuild me".

**3. Undo instead of confirm**

Deleting is one tap and asks nothing. `softDelete()` removes the record and hands `Undo` the
exact slot it came from; the toast grows an **`אחזר`** button and stays for **5 seconds**
(`UNDO_MS`). Letting it expire commits the deletion. The confirmation dialogue still exists
— it is just asked afterwards, and only of the people who need it. The same net covers a
note inside a client file (`softDeleteClientNote()`), which is a sub-record.

One deletion is pending at a time; arming a second commits the first. A restore stamps the
record with `touch()` — strictly later than its previous stamp, not merely `Date.now()` —
so the outbox **replaces** the tombstone it just queued with an upsert. Without that, a
delete and an undo landing inside the same millisecond would leave the tombstone standing
and the restored record would sync as deleted.

**4. Mobile ergonomics**

Every control clears the **44x44** floor (§7.2), now enforced by a CSS parser in
`healthcheck.js` rather than by inspection: the header pills, the narrow-phone icon-only
variants of them, the checklist rows, the note quick-actions and the client contact chips
were all resized to `var(--tap)`. The one control that must stay visually small — the
status chip inside a 12px meta line — clears the floor with a transparent centred `::after`
hit expander instead of a bigger box. Its anchor is deliberately physical (`left`/`top`),
because the centring transform is physical too and mixing the two flips the overlay to the
wrong side in RTL.

`touch-action: manipulation` removes the 300ms double-tap-zoom delay app-wide, and
`.cal-stage button` re-asserts `pan-y` so the calendar swipe navigation keeps the horizontal
axis.

**Shipped shell** — `sw.js` is bumped to `v9`.

**Verification** — `healthcheck.js` §22 executes the new layer for real: haptics against a
stubbed device with a motor, without one, and with one that throws; the full
delete → restore → commit cycle including the outbox tombstone replacement; membership
comparison including reorder and removal; the section registry cross-checked against the
document; and a CSS parse that fails the build on any control that drops below 44px.

### 7.4g Field-report waves — breakage fixes, confirm + universal edit, multi-select (shipped)

Three waves ordered by how badly they hurt on a real phone, requested from the field after
Sprint 7 shipped: **גל 1** repairs what was broken, **גל 2** closes the gaps in the editing
model, **גל 3** adds the batch layer on top of both.

**גל 1 — תיקוני שבר**

| # | Symptom on the phone | Cause | Fix |
|---|---|---|---|
| — | a tap near the bottom of a list did nothing for a few seconds after any action | the toast pill is `position:fixed; z-index:80` over the last rows and swallowed the tap | `.toast { pointer-events:none }`, with `pointer-events:auto` restored on `.toast-undo` — the pill is a message, only אחזר is a control |
| — | "＋ הוספה חדשה" sat on top of the content a thumb was scrolling | the CTA is fixed above the bottom bar with nothing to move it | `Fab.decide(prev, now, hidden)` — a pure decision (down ⇒ duck, up ⇒ return, ≤24px ⇒ always shown, ±6px jitter ⇒ no change) driven by a **passive** scroll listener coalesced into one `requestAnimationFrame`. Ducking is `transform` + `opacity` only, and the ducked CTA drops its tap target, its `tabIndex` and its accessibility name |
| B0 | the list under the finger flickered and rebuilt on every tap | `#timeline` paints hour buckets (an untimed event is clamped into 08:00) while its membership was read from `todaysEvents()`, where an untimed event sorts **last**. The two orders could never agree, so `sameKeys()` answered "changed" forever and the container was rewritten mid-press — the exact regression Sprint 7's patch engine exists to prevent | `timelineRows()` is now the single source of paint order; `timelineKeys()` flattens it and the section registry reads that. Renderer and membership can no longer drift |
| B1 | a deletion sometimes could not be undone, and the window never closed | any plain `toast()` replaced the pill and took אחזר off screen while `Undo.pending` stayed armed | `toast()` commits the pending deletion whenever the new toast carries no undo action — an undo the user cannot see has already expired |
| B2 | undo restored a client note into nothing | the restore closure captured the client **object**; `Sync.merge()` replaces a record whose server copy is newer, so a cloud round-trip inside the five-second window left the closure holding a detached copy | the closure re-resolves through `Store.find('clients', id)` and refuses to double-insert |

**גל 2 — אישור מחיקה · עריכה אוניברסלית · עמעום**

- **Confirmation.** Every destructive tap goes through one door: `askDelete()` /
  `askDeleteClientNote()` / the batch bar all call `confirmDelete(what, run)`, which opens a
  real dialog asking **`האם אתה בטוח שברצונך למחוק?`** above the name of the record. Sprint 7's
  net stays behind it — a confirmed deletion is still a `softDelete()` with אחזר armed. The
  question closes on its own (`close-confirm`), so a note deleted from inside a client file
  leaves that file open.
- **Universal edit.** Every card — event, task, list, note, client — carries a `✎` that
  reopens the **same typed form it was created with**, pre-filled by `TO_FORM` and saved by
  `applyEdit()`. Two rules keep an edit from becoming a back door: it is written *through* the
  model's own writers (`setTaskStatus` keeps `done` in lockstep, `setClientStatus` /
  `setClientNextAction` keep writing the client timeline), and `mergeChecklist()` matches an
  edited line back to the row it came from by title, so fixing a typo in a ten-item list does
  not un-tick the nine already done. The record is `touch()`ed, so the outbox pushes the edit.
- **Dimming.** A completed task, a cancelled one, a filled checklist and a closed client file
  all recede to `--dim-done: .55` (still ≥4.5:1 against `--card`), return to full strength on
  hover/focus, and are never dimmed while picked.

**גל 3 — בחירה מרובה · סרגל פעולות · Undo מורחב**

- Selection mode is entered from the header pill (`בחירה מרובה`) or by a **500ms long press**
  on any card; a press that travels more than 12px is a scroll and cancels, and the click that
  follows the press is swallowed so it cannot un-pick the card underneath the finger.
- While it is live, `Select.tap()` claims every tap that lands on a `[data-rec]` card before
  any control branch can act on it, and repaints that one card through `Patch.record()`.
- The batch bar offers **סמן כהושלם · בחר הכל · מחיקה · סיום בחירה**. `בחר הכל` reads the
  section registry, so it can never disagree with what is on screen. `Select.complete()` closes
  open tasks and fills unfinished checklists and reports exactly what it changed.
- **Undo מורחב:** `softDeleteMany()` removes a whole mixed selection (records are spliced back
  to front so every recorded slot stays valid) and arms **one** undo entry that restores every
  record into its own slot, front to back, `touch()`ing each so the queued tombstones are
  replaced by upserts. The window widens to `UNDO_BATCH_MS = 9000` — a batch is a bigger loss
  than a row — while a single deletion stays at `UNDO_MS = 5000`.

**Shipped shell** — `sw.js` is bumped to `v10`.

**Verification** — `healthcheck.js` §23 executes all three waves: the CTA decision table, the
timeline membership (with an untimed event, a pre-08:00 event and a 23:30 event on the board),
B1 driven through the real `toast()`, B2 driven through a real `Sync.merge()` that replaces the
record mid-window, the confirmation's accept/dismiss/no-double-run contract, `TO_FORM`
cross-checked field-by-field against the form builders, an edit round-trip that proves the
record count never moves and the checklist keeps its ticks, and a mixed batch
delete → restore cycle including the outbox tombstone replacement.

### 7.4h Sprint 8 — the completion gesture, סל מחזור & universal tap-to-edit (shipped)

Sprint 7 made the app fast. Sprint 8 makes it *feel* like something happened — and gives every
deletion a second, slower net behind the five-second one.

**1 · The completion gesture (`Complete`)**

Tapping the empty circle used to close the task, save, repaint and toast inside one synchronous
tick: by the time the finger lifted the row had already dimmed, re-sorted and — in "לביצוע
היום" — left the list entirely. The most satisfying moment in the app was invisible.

It is now a **400ms** (`COMPLETE_MS`) gesture with three channels running at once:

| Channel | What happens | How |
|---|---|---|
| see | the ✓ **draws itself** inside the circle, left to right | `CHECK_MARK` is an SVG path that is *always* in the DOM, held invisible by `stroke-dasharray:26; stroke-dashoffset:26` and released to `stroke-dashoffset:0` — with a `.34s` transition — the moment the row carries `.is-completing` or `.is-done`. A glyph swapped in at completion time can only ever *appear*; a dashed path can be *drawn* |
| see | the title strikes through and the card dims | `.row-title::after` is a bar that sweeps `inline-size:0 → 100%`, because `text-decoration:line-through` cannot be animated. The settled `.row.is-done .row-title{ text-decoration:line-through }` takes over at the end, so the sweep hands off without a flicker. The card fades to `--dim-done` — exactly where a finished card lives — so the hand-off is invisible |
| feel | a **dual haptic pulse** `HAPTIC_CHECK = [15, 30, 15]` | fired at the **start** via `Haptics.check()`, so the buzz lands with the drawing rather than after it. The check circle is the one control in the delegate that declines the blanket `Haptics.light()` — a light beat 10ms earlier would clip the first of the two |
| then | the store moves, the card slides into "הושלם", the toast lands | the commit closure passed to `Complete.run()` |

`Complete.plan(task)` is pure and drives all of it: **un-checking a finished task is not an
achievement** and skips the gesture entirely (`closing:false, delay:0, haptic:null`), which is
what stops the animation from ever running backwards. `Complete.run()` degrades to a straight
synchronous commit when the task is not on screen, so the headless path and the finger path
have identical semantics.

**2 · Explicit delete confirmation**

The door built in גל 2 is unchanged in structure and now carries the mandated labels:
**`אישור מחיקה`** (`.btn-danger`) and **`ביטול`** (`.btn-ghost`), under the question
`האם אתה בטוח שברצונך למחוק?` and the name of the record on a `--danger-edge` panel. Nothing
in the app deletes without passing through `confirmDelete(what, run)` — including
`מחק לצמיתות` inside the bin, which is the only deletion with nothing behind it.

**3 · סל מחזור — the 10-day recycle bin**

```
delete   →  the record leaves its collection at once (every view stays honest)
            and lands in Store.data.trash with { collection, id, rec, index, deletedAt }
5 sec    →  אחזר  — Undo.arm() now restores through trashRestore()
10 days  →  שחזר (back into the exact slot) or מחק לצמיתות (trashPurge())
after    →  purgeTrash() drops it on the next app start, for good
```

- Reached from the header pill **`🗑 סל מחזור`** (`#trashBtn`, with a live count badge that
  colours the pill gold while it is holding anything) which opens the `#trashSheet` dialog.
- Every row names the record, says what kind it is, and shows
  **`יימחק לצמיתות בעוד N ימים`** — `trashDaysLeft()` rounds **up**, so the day of deletion
  reads 10 and the final day reads `יום אחד`; the badge turns `pr-high` in its last 48 hours.
- **Auto-purge runs inside `Store.load()`**, before a single row is painted, so an expired
  record is never offered for restore even for one frame. `openTrash()` purges again on the way
  in, for a tab that was left open across the boundary.
- **No migration was needed.** A record leaving its collection is already diffed into the outbox
  as a tombstone and D1 already carries `deleted_at` on every table (migration 0001) — the
  server marks it deleted the moment the bin accepts it. `trashRestore()` calls `touch()`, so
  the queued tombstone is **replaced** by an upsert and the row comes back to life everywhere.
  The bin itself is deliberately local: a client-side grace period over a deletion the cloud
  has already recorded.
- `Sync.merge()` gained a bin guard. A stale server copy of a binned record used to walk
  straight back onto the board while its own bin entry still offered to restore it — two copies
  of one record, one unreachable. The bin now wins while `deletedAt >= stamp`, and **steps
  aside** (dropping its entry) when a genuinely newer server copy proves the record is alive
  again, rather than leaving something purgeable that is still on the board.
- `normTrash()` drops malformed entries on load, and stamps a stamp-less one with `Date.now()`
  — losing a record to a corrupt field is worse than holding it ten days too long.

**4 · Universal tap-to-edit**

`tapEditKey(target)` is asked only when a tap matched **no control at all** — the check circle,
the ✕, the ✎ and every chip inside a row are controls and are matched first — and returns the
record key whose typed form should open, pre-filled by the existing `TO_FORM` / `openEdit()`
path. It yields to selection mode, to an open confirmation, to an open form or bin sheet, and
to a card mid-collapse. `TAP_EDIT` covers **event, task, list and note**; a client card is
excluded on purpose, because tapping one opens the full client file, which is richer.

**5 · Entrance & exit**

`leaveThen(keys, run)` paints `.is-leaving` on every node standing for the record(s), waits
`LEAVE_MS = 240`, and only then lets the store move — so a deleted card **collapses** (`card-out`:
`max-height → 0`, `opacity → 0`, `scale(.96)`) instead of blinking away. Like `Complete.run()`,
it runs synchronously when nothing is on screen. Arriving cards rise through `card-in`, which is
**transform-only on purpose**: an opacity keyframe with a fill would out-rank
`opacity:var(--dim-done)` and silently un-dim every finished card on the board. `.row` and `.ev`
also answer a press with their own `scale(.995)` compression, now that a card body is a tap target.

**Shipped shell** — `sw.js` is bumped to `v11`.

**Verification** — `healthcheck.js` §24 adds 20 checks: the `Complete.plan` decision table in
both directions, `Complete.run()` driven against a stubbed vibration motor (one pattern, one
commit, no buzz on an un-check), the `stroke-dashoffset` draw contract read off the CSS, the
sweeping strikethrough and its hand-off to the real `text-decoration`, the confirmation's
mandated labels and z-order against the bin, the countdown math across seven points of the
ten-day window, a delete → bin → restore cycle that proves the slot *and* the outbox tombstone
replacement, a permanent purge that cannot be undone, the start-up auto-purge (one expired, one
exactly at the boundary, one with a day left), `normTrash()` against five malformed rows, the
batch path through the bin, the `Sync.merge()` bin guard in both directions, the `tapEditKey`
gate and its position in the delegate, and the collapse/entrance animation contracts.

### 7.4i Sprint 9 — in-place completion, היסטוריה & the end of the shake (shipped)

Three field reports, one theme: **the app moved things the finger was still aiming at.**

**1 · The shake was one missing selector**

```css
.row, .ev, .trash-row{ animation:card-in .22s … }   /* before */
.row.is-entering, .ev.is-entering{ animation:card-in .22s … }   /* after */
```

Every repaint in this app is a **DOM insertion** — `Patch.record()` replaces a node's
`outerHTML` — so that ungated rule re-ran the 7px entrance slide on the card *under the
finger*, on every status chip, every checklist tick, every selection tap. A membership change
re-ran it on **every card in the container at once**. That was the shaking, and Sprint 7's
patch engine could not help: the engine was doing exactly what it promised, and the CSS was
undoing it.

`markEntering()` now grants **`.is-entering`** to a `[data-rec]` node only when that record
key was *not* on screen at the end of the previous paint (`SEEN`). A card being rewritten is
by definition already on screen, so it holds perfectly still; a genuinely arriving card still
rises, and its neighbours no longer rise with it. The class exists nowhere in any markup
string — `healthcheck.js` counts its occurrences in comment-stripped source and fails the
build at more than one, because a builder that emitted it would silently restore the bug.

Two smaller sources of movement went with it:

| Source | Why it moved | Fix |
|---|---|---|
| `.att:hover`, `.type-btn:hover`, `.cl-card:hover` each lifted `translateY(-2px)` | `:hover` **latches** on a touch screen: it stays until the finger lands elsewhere, leaving the card 2px out of place long after the tap | the lifts moved into `@media (hover:hover) and (pointer:fine)`, placed *before* the reduced-motion block so that block still wins on a mouse |
| `renderSummary()` / `renderAttention()` / `renderTrash()` rewrote `innerHTML` on **every tap** through `Patch.settle()` | `el.innerHTML = same_string` is not a no-op — it tears down every child and builds a fresh set, restarting animations and dropping focus | **`setHTML()` / `setText()`** write only on a real change, and the recycle-bin **list** is painted only while its sheet is actually open |

**2 · Completion is a state, not a move (`awaitingArchive`)**

Sprint 8 filed a task the instant its 400ms gesture ended: it dimmed, **re-sorted**, and in
"לביצוע היום" left the list altogether. The mandate is explicit — tapping the circle must draw
the line, dim the row *slightly*, and **keep it in place**.

The 400ms gesture (`Complete.run()`, the drawn ✓, the sweeping strikethrough, `HAPTIC_CHECK`)
is unchanged. What changed is everything downstream of it:

- **`awaitingArchive(task)`** — done, and not yet filed. Such a task is still a full member of
  every list it was in. `taskMatchesTab()` no longer gates היום / באיחור on *open*; a ticked
  task stays listed under the tab it was already under. `boardTasksToday()` is the new source
  for "לביצוע היום", and `openTasksOn` became **`boardTasksOn`** so a task ticked from inside
  the day view or the agenda stays in that pane too. `tasksDueToday()` is untouched — the
  summary line still counts only what is genuinely *owed*.
- **`sinksToBottom(task)`** — only a **cancelled** task drops to the end of a sort. A completed
  one keeps the exact rank it held while open (same due date, same priority), so ticking cannot
  re-sort the list under the finger that ticked it.
- The commit is therefore `toggleTaskDone` → `Store.save()` → `Patch.apply()` and nothing else:
  membership is provably unchanged, `sameKeys()` answers "quiet", **no container is rewritten**.
  The toggle branch calls no `render()` and no `leaveThen()`, and the healthcheck fails the
  build if either reappears.

**3 · היסטוריה — the manual batch archive**

```
tick     →  done, struck through, dimmed, IN PLACE. Nothing is filed.
archive  →  "העבר משימות שבוצעו להיסטוריה" — every completed task on screen
            moves at once, with the slot it came from, and arms one אחזר
10 days  →  שחזר (back into that exact slot) or מחק לצמיתות (archivePurge())
after    →  purgeArchive() drops it on the next app start, for good
```

- The button is a full-width gold CTA carrying **its own count**, so the promise ("3 will
  move") and the act are one object. It is **absent, not disabled**, when there is nothing to
  file. It is painted into both places a finger finishes a task — My Day and the tasks view —
  by one `renderArchiveBar()` reading one piece of state, so the two can never disagree.
- `archiveDone()` respects the **global category filter** (§0.3): what the count promises is
  exactly what leaves. Records are spliced back-to-front so every recorded slot stays valid,
  and the whole batch arms **one** undo that restores them front-to-back.
- **Deliberately not סל מחזור.** Restoring work you finished must not read as undoing a
  deletion, and emptying the bin must not throw away a month of finished work. `Store.data.archive`
  is its own persisted array with its own drawer, and the healthcheck asserts a deletion never
  reaches the log and a filing never reaches the bin.
- The two drawers share **one clock** — `retentionLeftMs()` / `retentionDaysLeft()` /
  `retentionCountdown()` — so `יימחק לצמיתות בעוד N ימים` counts down identically in both,
  rounded **up**, turning `pr-high` in the last 48 hours.
- `Sync.merge()` gained the archive twin of the Sprint 8 bin guard, for the identical reason: a
  filed task is gone from its collection but not from the cloud until its tombstone lands, and
  a stale pull would walk it back onto the board while the log still offered to restore it. The
  log wins while `archivedAt >= stamp` and **steps aside** when a genuinely newer server copy
  proves the task is alive again.
- `normArchive()` drops malformed entries on load and stamps a stamp-less one with `Date.now()`.
  Auto-purge runs **inside `Store.load()`**, before a row is painted.

**4 · Delete confirmation & universal edit (verified, not rebuilt)**

Both were already shipped (§7.4g גל 2, §7.4h) and both were re-verified rather than rewritten:
every destructive tap in the app — including `מחק לצמיתות` in the **new** log — goes through
`confirmDelete()` and the mandated `האם אתה בטוח שברצונך למחוק?` / `אישור מחיקה` / `ביטול`, and
`tapEditKey()` still opens the pre-filled typed form for event, task, list and note. A finished
task keeps its full tap target, so a completed row is still editable in place.

**5 · Dead code**

Audited rather than assumed: a pass over every top-level declaration and every CSS class found
**no unreachable function and no unused selector** — the `st-*` / `cst-*` / `tag-*` families are
built by string concatenation and all live. What was actually removed was *redundant work*: the
per-tap `innerHTML` rewrites above, the closed-dialog repaint, and one orphaned doc-comment
that had drifted off `renderTimeline()` onto `timelineHour()`.

**Shipped shell** — `sw.js` is bumped to `v12`.

**Verification** — `healthcheck.js` §25 adds 17 checks: the in-place contract driven against a
real seeded store (the record's slot, the board membership and the tasks-list membership all
unmoved after a tick), the delegate proven free of `render()` / `leaveThen()`, the strikethrough
and `--dim-done` read off the CSS, the archive button's label / count / wiring / absence,
the filtered count adding up across `אישי` + `עסקי`, a full tick → file → count-down → restore →
purge cycle including the outbox tombstone replacement, the batch undo restoring front-to-back
through a live task between two filed ones, the ten-day countdown across seven points,
`normArchive()` against five malformed rows, the start-up auto-purge, the `Sync.merge()` archive
guard in both directions, the two drawers proven separate, `markEntering()` executed against a
stub DOM in four staged paints, `setHTML` / `setText` counted for real writes, and a CSS parse
that fails the build on any ungated hover transform.

### 7.4j Field wave — בחירה מרובה בסל המחזור (shipped)

A field report arrived as a sketch of the bin's row: a long press, a checkbox on every item,
a struck-through title on anything already finished, and `סל המחזור ריק` under an empty one.
The bin had none of it — every binned record could only be restored or destroyed **one at a
time**, so clearing thirty expired rows was thirty presses and thirty confirmations.

**Why the bin gets its OWN selection**

Wave 3's `Select` (§7.4g) cannot reach it, by design: both `Select.tap()` and its long press
decline every touch that lands on `.sheet`, because opening the app-wide batch bar behind a
modal would offer `סמן כהושלם` and `מחיקה` on records that are not on screen — and `#batchBar`
is `z-index:45` under a sheet at `60`, so the bar would not even be visible. `TrashSel` is
therefore a second, scoped selection layer: **the same gesture, the same checkbox, the same
bar**, keyed to trash entry ids and offering only the two things that can still be done to a
binned record.

| | |
|---|---|
| Enter | the `בחירה מרובה` pill in the bin's own sheet head (`data-trashbatch="mode"`), or a **500ms long press** on any row — the same `LONG_PRESS_MS` / `LONG_PRESS_SLOP` the cards use, scoped to `#trashList` and declining a press that started on one of the row buttons |
| Pick | `TrashSel.tap()` claims every tap inside `#trashList` before any control branch runs, and the click that follows the press is swallowed so it cannot un-pick the row under the finger |
| Act | `.trash-batchbar` — **↺ שחזור · בחר הכל · 🗑 מחיקה לצמיתות · סיום בחירה** |
| Leave | the bar's `סיום בחירה`, the pill again, closing the sheet, or the bin going empty |

- **`TrashSel.restore()` order is the whole correctness of the batch.** An entry's `index` was
  recorded against the collection *as it stood when that one record left it*, so the only
  sequence that reproduces the original list is the deletions run **backwards — newest first**.
  Deleting A (slot 0) and then C (slot 1 of what was left) and restoring in that order lands C
  one place too early. The bin is appended to in deletion order, so the bin's own order is the
  clock, and the restore reads it in reverse.
- **`TrashSel.purge()` asks first.** Nothing in the app deletes without `confirmDelete()`
  (§7.4h), and the batch is no exception: it names the count on the same `--danger-edge` panel
  under the same `האם אתה בטוח שברצונך למחוק?` before it destroys the last copy of anything.
- **The row is the control while a selection is live.** In selection mode `trashRow()` grows the
  shared `.sel-box` checkbox and **drops** the per-row `שחזר` / `מחק לצמיתות` buttons — leaving
  them in would let one finger restore a record it meant to tick.
- **A binned task that was already finished still reads as finished** — `trashDone()` marks the
  row `.is-done`, which strikes the title through in CSS, *and* prints the `בוצע` badge beside
  it, because a struck line is a colourless signal and must never be the only carrier. `בוטל` is
  not `בוצע`: the check reads the single `done` status, not the whole closed set.
- **The bar is `position:sticky` inside the scrolling sheet**, never `fixed` to the shell, for
  the z-index reason above. It reuses `.batchbar` / `.batch-btn`, so it inherits the 44px floor
  (§7.2) and the `[hidden]` display reset without a second set of rules.
- Closing the bin (`closeSheets()`) and opening it (`openTrash()`) both call `TrashSel.exit()`:
  a selection belongs to the bin that is open, and a bin that re-opened holding picks on rows
  nobody can see is a data trap.

**Shipped shell** — `sw.js` is bumped to `v13`.

**Verification** — `healthcheck.js` §26 adds 9 checks driven against a real seeded store: the
layer proven distinct from `Select`, pick / un-pick / empty-id state transitions, `בחר הכל`
cross-checked against exactly what `trashList()` renders and in that order, a two-record batch
restore that proves the slots (deleting the 1st and 3rd task and getting the original list back
verbatim), a batch purge that takes exactly the picked rows and leaves the unpicked one, the
confirmation door and all four bar actions read off the module, the long press proven 500ms,
slop-guarded, passive and scoped to `#trashList`, the delegate proven to ask the bin layer
before it acts, the bar proven to live inside the sheet and be sticky, and `trashRow()` executed
in both modes — checkbox and no buttons while picked, buttons and no checkbox while idle, with
`is-done` + `בוצע` + the `line-through` rule on a task that was completed before it was deleted.

### 7.4k Field wave — ריקון סל המחזור (shipped)

§7.4j made clearing thirty rows *one* selection instead of thirty presses, but it is still a
selection: enter the mode, `בחר הכל`, purge. The field asked for the shorter road — **one tap
that empties the bin** — so the bin's own sheet now carries it, under the `10 ימים` hint and
above the list.

| | |
|---|---|
| Control | `#trashEmptyBtn` — **🗑 ריקון סל המחזור**, `data-trash="empty"`, inside `#trashTools` |
| Asks | the one door (§7.4h), reworded: **האם אתה בטוח שברצונך למחוק את סל המחזור?** with **אישור** / **ביטול** |
| Destroys | `emptyTrash()` — `d.trash = []`, one `Store.save()` |
| Hidden when | the bin is empty, or `TrashSel.on` |

- **One door, reworded — never a second one.** `Confirm.ask()` took a fixed question and a fixed
  accept label; it now takes an optional `{ title, yes }`. Emptying a whole *surface* is not the
  same sentence as deleting a row, so it names the surface inside the question — but every field
  is reset on **every** ask (`o.title || CONFIRM_QUESTION`, `o.yes || CONFIRM_YES`), so a
  reworded question can never leak into the next deletion anywhere in the app. `index.html`
  still ships `אישור מחיקה` as the standing label.
- **The control hides while `בחירה מרובה` is live.** That layer already owns a
  `🗑 מחיקה לצמיתות` for exactly the rows the finger picked; two destructive buttons on one
  screen, one scoped and one total, is how the wrong one gets pressed. `renderTrash()` sets
  `tools.hidden = !rows.length || TrashSel.on`, and `.trash-tools[hidden]{display:none}` keeps
  the display rule from defeating the attribute — the same trap `.trash-count` was pinned for.
- **An empty bin never offers to be emptied.** The row ships `hidden` in the markup, and
  `askEmptyTrash()` counts before it asks: nothing in the bin, nothing to confirm, just
  `סל המחזור ריק`.
- **The count is in the question.** `plural(n, 'פריט אחד', 'פריטים') — לצמיתות, ללא שחזור` sits
  under it, so the answer is never given blind. This is the only tap in the app that destroys a
  whole surface, and the only one with nothing behind it: a binned record's tombstone is already
  queued, so dropping the entries **is** the permanent deletion.
- `runTrashAction()` answers `empty` **before** it resolves `id` — the control carries no entry
  id, and the row lookup would have turned it into `הפריט כבר לא בסל המחזור`.

**Shipped shell** — `sw.js` is bumped to `v14`.

**Verification** — `healthcheck.js` §27 adds 6 checks: the control proven to live inside the bin
sheet, labelled, wired and shipping hidden with its `[hidden]` display reset; the hide rule read
off `renderTrash()`; the `empty` action proven to resolve before the row lookup; the question
proven to name the bin, the accept button proven to read `אישור`, both defaults proven to reset
per ask and no second confirmation surface added; and `emptyTrash()` executed against a real
seeded store — three binned tasks destroyed, the live list and every other collection untouched,
the purged records unable to return, and a second call on an empty bin reporting nothing.

### 7.4l Field wave — the update path, or why the phone still showed v13 (shipped)

The field report: *"still not seeing the change — the screen on the phone is unchanged"*, with
`0e7d3b8` pushed and `sw.js` at `v14`. **The deploy was never the problem.** `origin/main` was
level with the commit and the live GitHub Pages copy already served `v14`, `ריקון סל המחזור`,
`#trashEmptyBtn` and `data-trash="empty"`. The break was entirely on the delivery side, and it
was three faults stacked:

| Fault | Why the phone kept old code |
|---|---|
| `clients.claim()` was read as "the app updates" | Claiming a client hands the **worker** the page. It does not reload the document, which is still running the `app.js` it parsed at launch. A home-screen PWA is *resumed*, never re-navigated, so that document can live for days. |
| The toast was the only exit | `גרסה חדשה מוכנה — רענן כדי לעדכן` asks for a refresh a standalone PWA has no button for. And it was attached only to `updatefound`, which can fire before `register()` resolves — so the update sat in `reg.waiting` and the toast never even appeared. |
| Nothing re-checked | Without a navigation the browser never re-fetched `sw.js`, so the new worker was not found in the first place. |

**The fix — the page now lands on the new code by itself.**

- **`controllerchange` → `swReload()`.** One reload, the moment a new worker takes charge.
  `hadController` is captured *before* `register()` so a first install does not reload for
  nothing, and `swReloading` closes the loop. `swReload()` waits while `#backdrop` is visible:
  a sheet or the client drawer is open means a finger is mid-edit, and the update can wait for
  the tap that closes it.
- **`reg.waiting || reg.installing` is adopted up front**, then `updatefound` after it — an
  update found before the listener existed is no longer stranded. `adopt()` posts
  `{ type: 'SKIP_WAITING' }`, which `sw.js` has always answered, and re-arms with a one-shot
  `statechange` listener that removes itself (no leak on repeat).
- **`reg.update()` on `visibilitychange` / `focus`**, throttled by `SW_UPDATE_MS` (60s), so a
  resumed home-screen app performs the check a navigation would have.
- **`caches.match()` → `cacheHit()`, scoped to `CACHE_NAME`.** The bare form searches *every*
  cache in the origin. `install` runs before `activate` evicts the old one, so a stale
  `benja-calendar-v14` entry could out-answer the `app.js` just downloaded — a new worker
  serving old code.
- **`app.js?v=v15` / `styles.css?v=v15` in `index.html`.** GitHub Pages serves both with
  `Cache-Control: max-age=600` and no content hash, so the query is what makes a new build a
  URL no stale entry can answer. `VERSIONED` in `sw.js` pre-caches the same URLs the page
  requests — the `?v=` and `CACHE_VERSION` must be bumped together.

**Deployment note.** The live app is `https://benja-gallery.github.io/benja-calendar-app/public/`
— the repo root is *not* published (`/benja-calendar-app/` returns 404), because the shell moved
into `public/` in Sprint 6 (§7.4e) while Pages still serves from the branch root.

**Shipped shell** — `sw.js` is bumped to `v15`.

**Verification** — `healthcheck.js` §41 adds 6 checks: no bare `caches.match` survives in the
fetch handler and a lookup is scoped to `CACHE_NAME`; `index.html` busts both assets to the
exact `CACHE_VERSION` string and `sw.js` pre-caches the same URLs; `controllerchange` reloads
with both the first-install and the loop guard and cannot land mid-edit; `reg.waiting` is
inspected and `SKIP_WAITING` is both sent and answered; and the resume check exists and is
throttled.

### 7.4m Sprint 10 — the tasks that disappeared, a home for notes, and reminders that make a sound (shipped)

The field report, from a UX pass against TickTick / Todoist / Morgen / Notion: on **היום שלי**
the chip reads *"פתוחות: 3"* while the timeline and the daily list underneath are **empty**.

Both statements were true. `openTasks()` counts every task that is not הושלם or בוטל; the board
under it draws `x.due === today`. A task dated next Tuesday, and a task created with no date at
all, were counted by the first and drawn by neither — and there was no screen anywhere in the app
that would show them. Four gaps, one at a time.

#### §1 The task views — היום · בקרוב · נכנסים · הכל

`TASK_TABS` becomes `['all', 'today', 'upcoming', 'inbox', 'late', 'waiting', 'done']`.

| View | Predicate (`taskMatchesTab`) | Reads as |
|---|---|---|
| **היום** | `due === today` | today's board |
| **בקרוב** | `due > today` | the future, chronologically |
| **נכנסים** | `!due` | captured, not yet scheduled |
| **באיחור** | `due < today` | overdue |
| **הכל** | everything | the union that proves nothing fell out |

The first four are **mutually exclusive and, between them, exhaustive** over every task still on
the board — a task is dated today, or later, or earlier, or not at all. That invariant is the
whole fix, and `healthcheck.js` §42a asserts it by partitioning a synthetic store.

Two supporting changes make **נכנסים** reachable at all:

- **The task form no longer pre-fills a due date**, and `submitForm()` writes `due: v.due || ''`
  instead of `due: v.due || todayISO()`. A dateless task could not previously *exist* — the
  writer invented today for it — so the Inbox would have stayed permanently empty. The toast says
  so: *"המשימה נוספה לנכנסים"*.
- **בקרוב is sorted by `sortByDate()`, not `sortTasks()`.** The board sort floats high priority
  across dates, which is right for a flat list and wrong for a calendar-shaped one: a low-priority
  task tomorrow must outrank a high-priority one next week. Priority only ever breaks a tie inside
  one day. The list is grouped by `upcomingBand()` captions (`.up-band`), which carry **no**
  `data-rec` — the membership engine keeps reading exactly the key list `shownTasks()` promised.

#### §1.2 The משימות קרובות widget on My Day

Under **לביצוע היום**, a collapsible block (`#upcomingBlock`, `data-upcoming`) titled
*"משימות קרובות (7 הימים הבאים) / ללא תאריך"*. It holds `upcomingSoon()` (dated, open, within
`UPCOMING_DAYS = 7`) plus `inboxTasks()`, chronologically, undated last. It is registered in
`SECTIONS` against `#upcomingList`, so it repaints on membership like every other container.

It **starts open** (`prefs.upcomingOpen`, defaulted for stores written before it existed): a
widget that hides the thing it exists to reveal is the bug it was written to fix.

#### §2 פתקים ורשימות — a dedicated area

The משימות screen gains a workspace switcher (`.work-tabs`, `data-work`) over three panes
(`data-workpane`): **✓ משימות** (sub-tabs + list + היסטוריה), **☰ רשימות** (checklists — ציוד,
קניות, תתי־משימות), **✎ פתקים** (quick capture — רעיונות, סיכומי שיחות, טקסט חופשי). The choice
persists in `prefs.workspace`; a `data-tasktab` deep-link from an attention card switches into
משימות on the way, since the sub-tab strip lives there.

**CRM link (§2c).** `notes.client_id` has existed in D1 since Sprint 5 and was carried by
`TO_ROW` / `FROM_ROW` — only the *form* never exposed it, so a note could never be filed under a
client and any edit erased whatever a sync had brought in. The note form now offers
`clientPicker()`, `TO_FORM.notes` round-trips it, `applyEdit` writes it back, creating a linked
note writes a `link` line into that client's timeline, and `clientChip()` puts the client's name
on the note, list and task rows.

#### §3 Reminders — per-record leads and an audio chime

`REMIND_OPTIONS = ['default', 'at', '15', '60', '1440', 'none']`, offered on both the task and the
event form, with the mandated labels: **בזמן האירוע · 15 דקות לפני · שעה לפני · יום לפני**, plus
**ללא התראה** (mutes one record without touching the global toggle) and the system default.

- `remindLead(rec, lead)` returns the window in minutes, `null` for muted, and `prefs.notify.lead`
  for `'default'` — so **every record written before this sprint behaves exactly as it did**.
- `Notify.due()` scans **today and tomorrow**: "יום לפני" is a 1440-minute lead, and a reminder a
  day early is by definition raised on the day before the one it is about.
- The fired-ledger key becomes `id@<the record's own date>`, not `id@today`, and the daily sweep
  drops keys strictly in the past. Keyed by today, a day-before reminder would be swept overnight
  and fire a second time in the morning.
- **The chime is synthesised** (`Chime`, Web Audio, two sine notes A5→D6 with an exponential
  decay). An `.mp3` would be a tenth asset in the service-worker shell, a second thing to
  cache-bust and a 404 away from silence; an oscillator is none of those and works offline by
  construction. Every entry point declines rather than throws where audio is unavailable.
  `Chime.unlock()` runs inside the enabling tap, because the autoplay policy only ever starts a
  context inside a gesture. `#soundBtn` is its own toggle (`prefs.notify.sound`, default on).
- **Server-sent push carries the same sound.** A worker has no `AudioContext`, so `sw.js` posts
  `{ type: 'PUSH_CHIME' }` to every open client after `showNotification()`, and `app.js` answers
  it on the `serviceWorker` `message` channel. Both notifications now set `silent: false`.

#### §4 Time-blocking

`timelineEntries()` merges today's events with `timedTasksToday()` — every open board task that
carries a clock time — into `{collection, rec, at, hour}` slots. A task set for 14:00 is drawn as
a compact `.row.task` inside the 14:00 bucket, beside the meetings it is competing with, so the
day reads as a whole. Untimed tasks are unaffected and still belong to **לביצוע היום**.

The B0 invariant is extended rather than relaxed: entries sort by **bucket first, clock second**.
An untimed record clamps into the 08:00 bucket but sorts last by the clock, so sorting by the
clock alone would report an order the renderer does not paint, `sameKeys()` would answer "changed"
on every tap, and the container under the finger would be rebuilt every time.

#### §5 Schema, shell and verification

**Schema (migration `0003_sprint10_remind.sql`, append-only).** `ALTER TABLE events ADD COLUMN
remind_key TEXT` and the same on `tasks`, backfilled to `'default'` so no existing row changes
behaviour. The column trails every earlier one in the SQL, in `functions/api/_shared.js` `SCHEMA`
and in `app.js` `SYNC_SCHEMA`; `healthcheck.js` rebuilds the order out of 0001 + 0002 + 0003 and
proves all three still agree.

`remind_key` joins `PRESERVE_IF_BLANK` for **both** tables. `/api/gcal/sync` writes whole event
rows built from a Google payload, which knows nothing about this vocabulary and would otherwise
null the column on every inbound edit. That is only safe because the client never emits a blank —
`'default'` is how it says "no opinion", which is why the vocabulary has no `''`.

**Shipped shell** — `sw.js` is bumped to `v16`, with `app.js?v=v16` and `styles.css?v=v16` in
`index.html`.

**Verification** — `healthcheck.js` §42 adds 17 checks, executed rather than pattern-matched: the
four-view partition over a synthetic store; the Inbox writer no longer inventing today; the
chronological sort and its day bands; the 7-day widget window (day 7 in, day 8 out) and its
`SECTIONS` registration; the three workspaces and their panes; a full note↔client link round-trip
through `TO_FORM` and `applyEdit`; every mandated lead resolving to its minute count and `none`
to `null`; a real `Notify.due()` run in which only the 1440 lead reaches tomorrow, a muted record
is never announced and a completed task is skipped; a driven `Notify.tick()` proving the ledger is
keyed by the record's own date and fires exactly once; the chime declining safely with no
`AudioContext` and shipping no audio asset; `PUSH_CHIME` on both sides; a timed task landing in
hour 14 with the painted order still equal to the reported order; migration 0003 being append-only
and agreeing three ways, including a `remind_key` round-trip through `toRow`/`fromRow`; and the
`v16` bump reaching both cache-busted URLs.

### 7.4m Server push, the audio unlock and the late-reminder grace (shipped — Sprint 11)

Field report: *"a task scheduled for now did not raise a notification and made no sound on the
phone."* One symptom, three independent causes. All three are fixed here, and each is pinned
by execution in `healthcheck.js` §43 rather than by inspection.

**Cause 1 — nothing was running.** Every reminder up to Sprint 10 was raised by
`Notify.tick()`, called from a `setInterval(30s)` **inside the page**. Mobile Chrome freezes a
backgrounded tab's timers within minutes, iOS suspends the whole process, and a closed PWA
runs nothing at all. `Notify.subscribe()` existed but had **no caller**, no VAPID key and no
server, so `sw.js`'s `push` handler had never received a single event. The reminder engine
was, in practice, "reminders work if you happen to be looking at the app".

**Cause 2 — the chime was locked.** `Chime.unlock()` was reached from exactly two taps:
enabling notifications and toggling the sound. A phone whose permission was granted on an
earlier visit taps neither again, so the first thing to touch the `AudioContext` was `play()`
— called from inside the scan. A timer callback is not a user gesture: the context is created
`suspended`, `resume()` outside a gesture is refused on iOS and Android, and the reminder
arrives silently.

**Cause 3 — a hard `gap < 0`.** `Notify.due()` required `0 <= gap <= lead`. The moment a start
time went one minute past, the record was skipped — and because the scan only ever looks
forward, skipped *forever*. Anything costing the scan a minute (a sleeping screen, a
backgrounded tab, a task created "for a minute ago") swallowed the reminder whole.

#### §1 Web Push — the delivery path that survives a closed app

| Artefact | Role |
|---|---|
| `functions/api/push/_webpush.js` | VAPID (RFC 8292) + `aes128gcm` payload encryption (RFC 8291), written directly on WebCrypto — no npm in a Worker |
| `functions/api/push/subscribe.js` | `GET` the public key · `POST` a subscription · `DELETE` one |
| `functions/api/push/dispatch.js` | the scan, moved off the phone: `GET` dry-run, `POST` send |
| `tools/push-cron-worker/` | the clock — a standalone scheduled Worker that POSTs the dispatcher once a minute |
| `tools/gen-vapid.js` | prints a P-256 key pair for `wrangler pages secret put` |

**Cloudflare Pages Functions cannot be cron-triggered.** Pages compiles `functions/` into
request handlers only; there is no `scheduled()` to declare and a `[triggers]` block in the
project's `wrangler.toml` would never fire. So the dispatcher is a *route* and the clock is a
*separate Worker* — which also keeps every binding, key and row inside the Pages project. A
`[triggers]` block appearing in the root `wrangler.toml` fails the build.

`/api/push/dispatch` mirrors `Notify.due()` exactly, because both ends read the same
`remind_key` column: the same vocabulary, the same default, the same grace window, the same
today-and-tomorrow horizon and the same ledger key (`id@<the record's own date>`, never
`@today`). Two engines that disagreed by a minute would announce the same record twice.

- **Never open.** Both verbs require `PUSH_DISPATCH_SECRET`, compared in constant time. With
  no secret set the route answers `503` and sends nothing — an open dispatcher is a free
  notification cannon pointed at the owner's phone.
- **Time is wall-clock.** A local record stores `YYYY-MM-DDTHH:MM` in Israel time (§3), so the
  Worker asks `Intl` for the local face of the current instant instead of doing offset
  arithmetic — which is also how it stays right across DST with no transition table.
- **Marked only on delivery.** `push_dispatch` is written only once a device actually
  accepted the message. Marking on *attempt* would let a push-service outage silently consume
  the reminder: the ledger would read "sent", the phone would have nothing, and the next run
  would skip it.
- **A dead endpoint is retired, not retried.** `404`/`410` sets `disabled_at`; a browser that
  rotates its endpoint is caught by `pushsubscriptionchange` in `sw.js`, which re-subscribes
  and hands the new endpoint back — the only place a *closed* app can re-register itself.
- **Schema** (`migrations/0004_sprint11_push.sql`, append-only, adds only new tables):
  `push_subscriptions` (keyed by a hash of the endpoint, so a phone that re-links on every
  launch updates one row forever) and `push_dispatch` (the server-side twin of `prefs.fired`).

**Deployment** — four secrets on the Pages project: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` and `PUSH_DISPATCH_SECRET`, plus the same dispatch secret on the cron Worker.
Until they are set, `/api/push/*` answers `503`, the client's `linkServer()` resolves to
`null`, and the app behaves exactly as it did in Sprint 10 — local reminders, no regression.
No key ever reaches the browser: the client learns only the **public** half.

#### §2 The audio unlock

`Chime.armOnFirstGesture(document)` moves the unlock onto the **first touch anywhere in the
document**, whatever it lands on, and runs at boot. The listeners (`pointerdown`, `touchstart`,
`mousedown`, `keydown`, `click`, all capture-phase) stay attached rather than firing once,
because iOS suspends the context every time the app is backgrounded and the next tap is what
brings it back; `visibilitychange` resumes it too. Nothing is created while the chime is
switched off — `Chime.armed()` is still the only vote — and every path declines rather than
throws where there is no audio at all.

#### §3 The grace window

`MISS_GRACE_MIN = 20`. The condition becomes `-20 <= gap <= lead`: **early is still a miss,
late-but-recent is a delivery.** A reminder that slipped by a minute now fires, says
`התחיל לפני N דק׳` rather than claiming a start time that has passed, and — because the
fired-ledger is unchanged — fires exactly once. An hour-old reminder is still stale and stays
skipped. The same constant governs the Worker, so both engines forgive identically.

#### §4 The permission banner

`#notifyAlert` on "היום שלי" — the first thing under the header. The top-bar pill already
carried the permission state, but it is one of four pills in a crowded bar, and a *blocked*
permission is worse than an unasked one: the app shows an armed bell and delivers nothing, so
a missed meeting gets blamed on the app instead of the setting causing it. Four states, gold
while merely unasked, `--danger` once actually blocked, colour never the sole carrier
(🔔 → 🔕 and the sentence says which it is):

| State | What it says |
|---|---|
| `ask` | התראות עוד לא הופעלו — בלעדיהן שום תזכורת לא תגיע לטלפון |
| `off` | ההתראות כבויות — תזכורות לפגישות ולמשימות לא יגיעו אליך |
| `denied` | ההתראות חסומות בדפדפן… + **איך לבטל את החסימה?** — a blocked permission cannot be re-requested, so the CTA teaches instead of pretending |
| `unsupported` | …באייפון צריך להוסיף את האפליקציה למסך הבית — which is genuinely the iOS answer |

The push pill's `title` now states which delivery path is live: *התראות שרת פעילות — יגיעו גם
כשהאפליקציה סגורה* against *התראות מקומיות בלבד*. `prefs.notify.serverAt` is the stamp behind
it, absent and defaulted in every store written before this sprint.

**Shipped shell** — `sw.js` is bumped to `v17`, with `app.js?v=v17` and `styles.css?v=v17`.

**Verification** — `healthcheck.js` §43 adds 17 checks. The two that matter most are executed
against the real standards rather than pattern-matched: a **VAPID token verified with
WebCrypto** against the key that signed it (RFC 8292 header shape, origin-only `aud`, the
24-hour ceiling, and a raw 64-byte JWS signature rather than DER), and a **full RFC 8291
round-trip** in which a stand-in device redoes the ECDH + HKDF ladder and decrypts the payload
back to its Hebrew original — with a second message proving the ephemeral key is never reused.
Around them: the dispatcher's selector driven over thirteen synthetic records (late, stale,
early, muted, all-day, closed, undated, day-before), its timezone reading, the secret gate on
both verbs, the deliver-then-mark rule, the gesture unlock driven through a document stub
(including that a silenced chime creates no context), the client's grace window and its
fire-once ledger, all four banner states driven through the real `alertState()`, and a scan of
every source file for a committed key.

### 7.4n Multiple reminders, real-time visibility, "פתוחות" and the detail reader (shipped — Sprint 12)

Field report, after UI/UX testing on the phone: *"a task I create for today does not appear until
I refresh; I cannot set more than one reminder on an item; the 'פתוחות: X' number opens nothing;
and tapping an item drops me straight into a form, so there is nowhere to simply read it."* Four
asks, one sprint. Everything below is pinned by execution in `healthcheck.js` §44 rather than by
inspection, and the shell ships as **v18** on both cache-busted URLs.

#### §1 One record, several reminders

The old control was a single `<select>`. A single select can only ever express ONE reminder, so
"יום לפני" **and** "בזמן האירוע" on the same meeting was not a thing the form could say. It is
replaced by a panel that asks the two questions that were actually being asked:

1. **the master toggle** — `עם התראה` / `ללא התראה`. Off means no reminder is scheduled for this
   record at all, and the record says so out loud in the reader rather than saying nothing.
2. **multi-select checkboxes**, any combination at once — `בזמן האירוע`, `15 דקות לפני`,
   `שעה לפני`, `יום לפני`, plus `ברירת מחדל של המערכת`.
3. **absolute reminders**, added one at a time through `＋ הוסף התראת זמן נוספת`. Each is a
   `datetime-local` in its own right: it has nothing to do with the record's start time and can
   name a day the record is not even on.

**The stored shape is a token list.** A token is either a built-in lead
(`default` | `at` | `15` | `60` | `1440`) or an absolute moment, `@YYYY-MM-DDTHH:MM`. The EMPTY
list is the muted state — the list form of the old `none`, and the only way to say it.
`normRemindList()` parses an array, a comma-joined string or a single legacy key into that list;
`remindersOf()` is the ONE reader every engine goes through. Built-ins are stored in
CHRONOLOGICAL order (`1440,60,15,at`), not in the order the checkboxes are drawn, so the reader
lists them in the order they will actually arrive — and two records carrying the same reminders
serialise identically, so the sync outbox sees no phantom change.

**No column was added.** `remind_key` was already `TEXT`; its vocabulary widened, in one place,
for both engines that read it. A second column would have meant two places that can disagree
about the same fact, with `/api/gcal/sync` writing whole event rows through both.
`migrations/0005_sprint12_multi_remind.sql` is therefore append-only and adds no column: it
documents the widened vocabulary and repairs rows that were never given a choice, exactly as 0003
did. Every pre-Sprint-12 row holds one bare token, parses as a one-token list, and keeps the exact
behaviour it already had. An unknown key is still **no opinion** (`default`), never silence — a
forward-compatible vocabulary that muted a record it could not parse would drop reminders
invisibly, which is the one failure the user cannot see happening.

**Delivery is per reminder, not per record.** The ledger key is `<token>#<id>@<date>` on both
ends — `prefs.fired` in the page and `push_dispatch.key` in D1. The token LEADS and the date
still TRAILS, so the overnight sweep's `key.slice(-10)` reads a date exactly as it always did. A
record carrying both `1440` and `at` therefore produces two marks and two deliveries; one
record-wide key would have let whichever fired first swallow the rest. A custom reminder is keyed
and swept by ITS OWN date, so one set for next Tuesday survives tonight. `dispatch.js`
`remindTokens()` is the byte-for-byte twin of the client parser and the healthcheck asserts they
agree on every shape either end can produce.

#### §2 Real-time visibility — what was actually wrong

The store was never the problem: every selector returns a new record the instant it is added, and
a task created with a date and a time reaches `timelineEntries()`, `boardTasksToday()` and
`boardTasksOn()` on the same tick. Two things in the VIEW layer could still hide it, and a reload
cleared both — which is exactly why refreshing "fixed" it.

1. **The global category filter.** `pick()` gates every read path, so a personal record created
   while the filter reads "עסקי" is counted by the summary and drawn by nothing. Same shape as
   the Sprint-10 report: counted somewhere, listed nowhere.
2. **The calendar anchor.** `Cal.anchor` is captured once, when `app.js` is PARSED. A home-screen
   PWA is resumed rather than reloaded, so an app left open overnight is still anchored on
   yesterday and a record created "for today" lands on a day the calendar is not showing.

`reveal(cat, iso)` closes both before the single `render()` that follows a save — widening the
filter and moving the anchor only when they are actually hiding the record, and saying so in the
toast when it had to. `dayGuard()` closes the rollover for an app that is never reloaded: it
rides the scan interval and the `visibilitychange` wake, compares `todayISO()` to the last painted
day, re-anchors a calendar that was sitting on it, and repaints. Two smaller defects went with
them: `Store.shaped()` had branches for clients, tasks, lists and notes and **none for events**,
so a freshly created event was the one record that never met its migrator; and a dated task was
verified never to match the `נכנסים` predicate, which is `onBoard && !task.due`.

#### §3 "פתוחות: X" — the sheet behind the number

The counter has always been honest and has never been reachable. Sprint 10 answered half of it
with the משימות קרובות widget, but that widget is windowed to a week and holds tasks only, so a
meeting next month was counted by both surfaces and listed by neither. The chip is now a real
`<button>`, and so is the widget's count — which left the toggle and became a control of its own,
because collapsing the widget and opening the sheet are two different intentions and a `<button>`
may not nest inside a `<button>`.

`openEntries()` is the selector: every open task (not `הושלם`, not `בוטל`, whatever its date) plus
every event that has not already happened, sorted chronologically with undated last and a meeting
ahead of a self-appointment inside the same minute. Seven quick filters —
`הכל · היום · השבוע · באיחור · משימות · אירועים · ללא תאריך` — each with a real predicate behind
it and a live count on the chip. The rows are the same `taskRow()` / `eventCard()` markup every
other surface uses, carrying `data-rec`, so `Patch.record()` updates them in place and the sheet
is rebuilt only when its MEMBERSHIP moved. It declines to paint while closed, exactly as
`openTrash()` does.

#### §4 The detail reader

Tapping a card used to drop straight into its edit form: every field writable, nothing actually
readable. A note longer than the two lines a card shows could only be read by scrolling a textarea
inside a form, and the reminders a record carried were not stated anywhere in the app at all.

`Detail` is the reading surface. It states the full title, the notes verbatim, the date and time,
the category, the linked client, the status and priority — and **every active reminder by name**,
custom stamps included, with a count. A muted record says it is muted rather than saying nothing.
`TAP_DETAIL` (`tasks`, `events`) is a SUBSET of `TAP_EDIT`, never a replacement: lists and notes
still open their form directly, because their whole content is already on the card, and every card
keeps its own ✎ straight to the form. The three actions a reading view owes — `עריכה`,
`סימון כבוצע`, `מחיקה` — sit at the bottom and go through the same writers everything else does:
`toggleTaskDone()` so `done` never drifts from `status`, and `confirmDelete()` so deletion keeps
its one door and its ten-day bin. `סימון כבוצע` is hidden on an event, which has no status to move.

#### §5 Verification

`healthcheck.js` §44 drives the whole sprint head-lessly: a two-reminder record through the store,
the column, `Notify.due()` and a driven `Notify.tick()` proving two marks and one delivery each; a
custom stamp firing at the minute it names and not two hours early; the panel round-tripping a
real record through `FormRemind` with no DOM at all; a today-dated timed task landing on the
timeline in hour 14, on today's board, in the calendar day and NOT in `נכנסים`; `reveal()` widening
a filter that hides a save and moving an anchor that cannot show it; the open-items sheet over
eight synthetic records with every quick filter partitioning correctly; the reader's own output
asserted for each thing the mandate lists; `Detail.act('done')` driven through the real writer; the
dispatcher's parser proven identical to the client's over twelve inputs and its per-reminder ledger
keys proven distinct; and migration 0005 proven append-only with `remind_key` still trailing all
three schema listings.

### 7.4o The hamburger settings drawer, the header cleanup, dual sounds & custom haptics (shipped — Sprint 13)

Field mandate, after using the app on a phone for a week: *"the top bar is a wall of icons; I
want one menu; and a reminder for a client call should be able to RING for ten seconds, not
tick like a shopping list."* Everything below is pinned by execution in `healthcheck.js` §45
rather than by inspection, and the shell ships as **v19** on both cache-busted URLs.

#### §1 The header is two controls

The top bar had grown to four pills (🔔 / 🔊 / 📅 / ☁), a Google readout line beneath them and
a 🗑 pill in the filter strip — six affordances competing with the one question "היום שלי"
exists to answer. Every one of them was reachable and none of them was findable.

What is left is the **title**, the **cloud badge** (a status light, not a menu) and **☰
הגדרות** (`#menuBtn`). The hamburger is the LAST child of `.topbar-row` on purpose: the
document is `dir="rtl"`, so the last flex item is the one that lands on the visual left edge
the mandate asks for. It carries `aria-haspopup="dialog"` and `aria-controls="settingsDrawer"`,
so the panel behind it is announced rather than merely present.

**Nothing was deleted and nothing was rebuilt.** `#pushBtn`, `#soundBtn`, `#gcalBtn`,
`#gcalSync` and `#trashBtn` are the SAME elements with the same ids inside `#settingsDrawer`,
so `Notify.paint()`, `GCal.paint()` and `renderTrash()` still own exactly the state they owned
before and no fact in the app gained a second owner. §45a asserts both halves at once: the
five ids are absent from `<header class="topbar">` **and** present inside the drawer, with
their handlers still bound by the same selectors in `app.js`.

#### §2 The drawer

`.settings` — a bottom sheet under 900px, a real **left-anchored** side panel above it (the
anchor is written physically, because "slide out from the left" is a direction on the glass,
not a direction in the text). Five sections:

| Section | Holds |
|---|---|
| 🔔 התראות, צלילים ורטט | the push toggle, the chime toggle, **צליל התראה** (short-tone picker), **צלצול ארוך (כ־10 שניות)** (ringtone picker), the vibration-pattern picker, each with ▶ נגן and ↺ ברירת מחדל, and the **רטט במגע** switch |
| ☁ סנכרון וחשבונות | the Google Calendar button and its last-sync readout, the cloud state spelled out, and **סנכרן עכשיו** |
| 🗂 נתונים וארכיון | **סל מחזור (10 ימים)** and **יומן היסטוריה** |
| 🎨 מראה ועיצוב | כהה / בהיר / לפי המערכת, plus what the OS is currently asking for |
| ℹ אודות | the shipped version and a live health readout |

`Settings.paint()` only paints what is genuinely its own. The drawer counts as a layer:
`Select.tap()` and the long-press binder both decline `.settings`, `anySheetOpen()` counts it,
and `closeSheets()` — the one door every layer in the app closes through — shuts it, which is
also what stops a ten-second ringtone auditioned in the panel from outliving the panel.

#### §3 The dual-sound engine

Two families, because they answer two different questions:

- **a short tone** — *something wants you*. Under a second, so it can land mid-sentence.
- **a long ring** — *answer me*. `LONG_MS = 10000`, a motif re-scheduled every `cycle`
  seconds until the ceiling is used up.

Both are **synthesised**, for the same reason the Sprint-10 chime was: an `.mp3` would be a
tenth asset in the service-worker shell, a second thing to cache-bust, and a 404 away from
silence. A voice is a small declarative spec — the frequencies, the spacing, the decay — and
`Chime.voice()` renders any of them through the one oscillator path that already existed.
Four short presets (`bell` · `chime` · `ping` · `soft`) and three ringtones
(`classic` · `pulse` · `rise`).

The whole 10 seconds is scheduled in **one pass** rather than on a timer, so a backgrounded
tab — where timers are throttled to seconds — still rings on the beat, and `Chime.stop()` can
cut every oscillator at once because it holds them all.

#### §4 What the record carries, and what the drawer carries

The split is deliberate:

- **the record** names a **family** — `alert_sound` ∈ `none | short | long`,
  `alert_vibe` ∈ `none | short | long | repeat`.
- **the drawer** names **which preset** each family plays.

So a record can never point at a preset a later build stops shipping, and "the client call
rings, the shopping reminder ticks" is a property of the thing being reminded about rather
than a mode the whole app is in. The task, event and note forms all grow an
**אפשרויות התראה** panel with the two rows the mandate spells out, and choosing an option
**previews** it — the tap is a real gesture, so the autoplay policy allows it, and hearing the
difference is the only way to choose without saving first. The detail reader states the pair
by name, because two records that ring completely differently look identical on a card.

`migrations/0006_sprint13_alerts.sql` is append-only and adds `alert_sound` / `alert_vibe` to
`events`, `tasks` and `notes`, trailing every column the five migrations before it declared.
Both are **preserve-if-blank** on the Worker side and the client never emits `''` — a muted
record says `'none'` — so `/api/gcal/sync`, which writes whole event rows built from a Google
payload that knows nothing about this vocabulary, cannot null the choice on an inbound edit.
An unknown value normalises back to the default on every read path on both ends, because a
forward-compatible vocabulary that muted a record it could not parse would drop reminders
invisibly.

#### §5 Custom haptics

`VIBE_PATTERN` gives each kind a real `navigator.vibrate` pattern — **רטט קצר** `[140]`,
**רטט ארוך** `[650]`, **רטט חוזר** `[180,120,…]` — and `Haptics.pattern()` is the one new
caller of the one guarded call site established in Sprint 7.

**רטט במגע** governs the app's own touch feel and *nothing else*: `Haptics.light()`,
`.done()` and `.check()` consult it, `Haptics.pattern()` deliberately does not. Silencing the
interface must never silence the notification — a user who finds tap feedback annoying has
not asked to stop being told about meetings. It defaults ON, and defaults ON with no store at
all, because a pulse fired before `Store.load()` must not be swallowed.

#### §6 Theme

`data-theme` is written onto `<html>` and only ever holds a **resolved** palette: *לפי המערכת*
is a question the app asks `prefers-color-scheme` and re-asks when the OS flips, never a third
value the stylesheet has to understand. The light palette lives in `:root` as a second
`--l-*` set and the override block is pure `var()`-to-`var()`, so §4's *no colour literal
outside `:root`* keeps holding. The accent is **deepened rather than reused**: `#e4c278` on
paper is roughly 1.8:1, so a light theme that kept the mandated gold would fail the 4.5:1
floor on every gold label in the app.

#### §7 Verification

`healthcheck.js` §45 adds 24 checks and drives the sprint head-lessly. The two that matter
most are executed rather than pattern-matched: a **stub `AudioContext` counts the oscillators
a ten-second ringtone schedules** and asserts the last note starts inside the ceiling and that
`stop()` kills every one of them; and a **stub motor records the exact pattern** each
vibration kind fires, including that the touch-feedback switch silences `light()`/`check()`/
`done()` and leaves `pattern()` alone. Around them: the header asserted empty of all five
moved ids and the drawer asserted full of them, the ☰ proven to be the last item in its row,
the drawer opened and closed through `Settings.toggle()` and `closeSheets()` against a live
DOM stub, the five sections and their controls, the record pair round-tripped through the
store → `toRow` → `validRow` → `fromRow`, migration 0006 proven append-only with the pair
trailing all three schema listings, `PRESERVE_IF_BLANK` proven to cover it on all three
tables, `TO_FORM`/`applyEdit` proven to carry an edit and a picker-less form proven NOT to
reset one, `Notify.due()` proven to hand the record's own pair to `show()`, and the theme
resolved in both directions against a stubbed `matchMedia`.

### 7.4p The compact task row & tap-to-expand details (shipped — Sprint 14)

Field mandate: *"the task list is a wall of chips — I can see four tasks on a screen and I
can't read any of them."* The row had accumulated, one sprint at a time, four badges
(`catTag` · `statusBadge` · `priorityTag` · `remindTag`), a client chip, a meta sentence, a
✎, a ✕, the next-action line and the whole sub-task checklist. Every one of them was added
for a good reason and the sum of them was unreadable. The shell ships as **v20** on both
cache-busted URLs.

#### §1 The row is the scan surface

`taskRow()` now renders exactly three things:

| | |
|---|---|
| the check circle | `.check-tap`, the same 44px target with the same drawn ✓ |
| the title | `.row-title`, one line, ellipsed |
| the when-token | `.row-when` — `באיחור`, or the time, or the day. Nothing when there is nothing to say. |

The when-token is the one piece of metadata that survived, and deliberately: everything else
a task carries is a property of the **task**, and can wait for the reader. This is a property
of **today** — a list that hides it turns an overdue task into an ordinary one. It sits at the
end of the title line, so it costs no height at all.

`.row.is-compact` trims the padding to `9px 14px`. The 44px hit area around the check circle
is the floor and is not negotiable (§10's touch standard asserts it), so the height that was
actually bought back came from deleting the second line and the checklist, not from the
padding.

`compact` no longer changes the shape — a row this small already *is* the calendar variant —
but it still rides on the node as `data-compact`, because `Patch.record()` rebuilds each node
in the variant it was drawn in.

#### §2 Nothing was deleted — it moved into the reader

The reader (§7.4n, Sprint 12) was already the surface with room. It now opens with a
**`.dt-tags` strip** carrying the same four chips the row gave up — including the live
`data-cycle` status chip, which still cycles, and still lands on screen immediately because
`Patch.settle()` repaints an open reader. Below them, unchanged: the notes, `.dt-lines`, and
every active reminder named. Added this sprint: **נוצרה** (`stampDay(rec.createdAt)` — "מתי"
is the *due* date; this is the only line that separates a task filed this morning from one
that has been sitting there three weeks) and the **sub-task checklist**, same `checklist()`
helper and same `data-subtask` handler, so ticking a sub-task still works in place.

The action row reads **[✎ עריכה מלאה]** · **[✓ סימון כבוצע]** · **[🗑 מחיקה]**, and מחיקה
still goes through the one `confirmDelete()` door every other deletion in the app uses.

A task is now the one card type with no ✎ of its own; its edit door is the reader's
**עריכה מלאה**, one tap in. Both doors end in the same `openEdit()`.

#### §3 The check circle was not touched

`data-toggle` is matched by the click delegate *before* the fall-through to `tapEditKey()`, so
a tap on the circle completes the task in place — the ✓ draws, the strikethrough sweeps, the
dual pulse fires, the row stays exactly where it is — and never opens the reader. A tap
anywhere else on the row resolves through `openTapped()` → `Detail.open()`.

#### §4 Verification

`healthcheck.js` §46 adds 6 checks that render real records rather than pattern-matching:
`taskRow()` is called on a fully-loaded task (category, status, priority, reminders,
sub-tasks, linked client) and asserted to contain **none** of `tag-`, `st-`, `pr-`,
`badge remind`, `row-edit`, `data-del`, `checklist` or `next-action`, while still carrying
`data-toggle`, `data-rec` and the title; the reader is asserted to contain every one of them;
`rowWhen()` is driven across late / timed / dated / bare tasks; the check-circle precedence is
asserted against the delegate's own selector list; and the cache floor is raised to v20.

### 7.4q קטלוג המצרכים — the pantry catalog inside the list form (shipped — Sprint 15)

Field mandate: the whole grocery vocabulary, dictated in ten aisles — קטניות · קפואים ·
שימורים · תבלינים · שמנים ורטבים · אפייה · חטיפים ומתוקים · משקאות · ניקיון הבית ·
היגיינה וטיפוח. A shopping list was already a first-class record (§7.4m §2), but building
one meant typing the same hundred-and-sixty products every week into a bare textarea. The
mandate's list *is* the missing keyboard. The shell ships as **v21** on both cache-busted
URLs.

#### §1 The catalog is data, not a second store

`PANTRY` is a flat array of ten aisles, each `{ key, label, items[] }`, exactly as dictated
and in the dictated order. **161 products** (`PANTRY_TOTAL`), Hebrew verbatim — nothing was
renamed, merged or "corrected"; the one normalisation is the repo's own Hebrew geresh in
`צ׳יפס` · `צ׳ילי מתוק` · `ג׳ל כביסה` · `סקוץ׳`, as everywhere else in the app, and
`pantryNorm()` folds it away so either spelling finds them. Two titles appear in two aisles
on purpose, because the
mandate put them there: `חומוס` (קטניות · שימורים) and `סויה` (קטניות · שמנים ורטבים);
membership is by title, so ticking one ticks its twin, and the list still holds one line.

| aisle | key | products |
|---|---|---|
| קטניות | `legumes` | 10 |
| קפואים | `frozen` | 11 |
| שימורים | `canned` | 12 |
| תבלינים | `spices` | 21 |
| שמנים ורטבים | `oils` | 16 |
| אפייה | `baking` | 13 |
| חטיפים ומתוקים | `snacks` | 17 |
| משקאות | `drinks` | 17 |
| ניקיון הבית | `cleaning` | 22 |
| היגיינה וטיפוח | `hygiene` | 22 |

No record, no migration and no D1 column was added: the catalog ships inside `app.js`, and
what a list stores is what it always stored — `items`, through `parseChecklist()`.

#### §2 The textarea is the single source of truth — *superseded by Sprint 16 (§7.4r)*

The chip grid held **no state of its own**: it toggled a LINE of the list form's `items`
textarea and read its own tick straight back off the field, so a product typed by hand
ticked its chip and `mergeChecklist()` kept every item's progress across an edit. The
search box carried no `name`, so `submitForm()`'s `[name]` sweep never saw it.

That was the right answer while the catalog lived inside "רשימה חדשה" and the wrong one
the moment it stopped: a textarea cannot hold a ✓, cannot hold a כמות, and stops existing
when the form closes. **§7.4r replaced the surface and the source of truth together** — the
catalog moved into a module of its own, and the list it writes into is now the `items[]` of
one record. The vocabulary in §1 and the search behaviour in §3 carried over unchanged.

#### §3 An aisle is a filter, never a container

`חיפוש` runs across all ten aisles at once — `סבון` is a word before it is a shelf — and
each hit wears its aisle name (`.pn-aisle`). `pantryNorm()` strips the geresh and folds
whitespace, so `ציפס` finds `צ׳יפס` and `סקוץ` finds `סקוץ׳`, which is the difference
between a search box and a spelling test on a phone keyboard. Tapping an aisle clears the
query; an empty query returns to the aisle. A query with no hits says so, and points at the
manual-add field — the catalog never blocks a product it does not know.

Nothing is ever auto-added: the list opens empty.

#### §4 Layout

`.pn-cats` scrolls sideways (44px pills, hidden scrollbar); `.pn-items` is a bounded
`auto-fill minmax(140px, 1fr)` grid that scrolls inside `max-height:280px`, so 161 products
never turn the sheet into a mile of form. A chosen product is gold-filled (`.pn-chip.is-on`,
`✓`), so "מה כבר ברשימה" is answerable without reading the textarea. Every chip clears the
44px touch floor, and every colour is a `var()` token, so the light theme inherits it.

#### §5 Verification

`healthcheck.js` §47 executes the engine rather than pattern-matching it: the ten aisles and
all 161 titles are asserted against the mandate verbatim (including both deliberate
duplicates), `pantrySearch()` is driven across aisles and through the geresh fold,
`pantryCatOf()` is asserted to file every product under the first shelf that holds it, the
chip grid's styling is held to the 44px floor and to `var()` tokens only, and the cache
floor is held at **v21** or higher. The toggle-engine checks moved to §48 with the engine
itself.

### 7.4r רשימת קניות — a module of its own (shipped — Sprint 16)

Field mandate: *"Move the Shopping List out of the buried 'Add List' form and create a
dedicated, top-level רשימת קניות module accessible directly from the main screen."* Two
tabs — `בחירת מוצרים מתוך הרשימה` and `רשימת הקניות שלי` — a ✓ with a `קו חוצה`, a כמות
per line, and state that persists. The shell ships as **v22** on both cache-busted URLs.

#### §1 Why it left the form

The catalog shipped inside "רשימה חדשה": to reach 161 products you opened ＋, chose רשימה,
scrolled past four fields, and whatever you ticked belonged to that one list and to no
other. The weekly shop is not a document you author once — it is a surface you open on the
way out of the house, tick halfway down an aisle, and come back to next week. Three modals
deep is the wrong place for it.

**Two doors, both one tap:** `.shop-cta` on היום שלי (`#shopCta`, `data-action="shopping"`,
directly under the smart summary and above the attention strip — it is a standing
destination, not an alert) carries a live count, so it reads as a place rather than as a
button. A second `data-action="shopping"` sits in the רשימות workspace, where somebody who
came looking for "the list" will look. The five-item bottom bar and the desktop rail were
left exactly as they are: the raised ＋ is dead-centre of five and cannot stay centred as a
sixth item is added, and the Sprint 13 header is deliberately two controls.

#### §2 One record, not a draft

The source of truth moved down one level, from a textarea to the `items[]` of **one record**
— a `lists` row with the constant id **`shop-main`** and the title `רשימת קניות`, created by
the first product and never merely by opening the module. A constant id is what makes this
the *same* list on the phone and on the laptop: the sync engine matches on id, and a
per-device `uid()` would have produced two lists that both call themselves רשימת קניות and
never merge.

Nothing else changed underneath it. `items_json` already round-trips the whole array through
D1, so **no migration and no new column** was needed; the row shows up in רשימות like any
other list, and `listProgress()` / `toggleItem()` / `mergeChecklist()` keep working on it.
The one shape change is `qty`, carried by `normItems()` **only where one was actually
written** (`normQty()`, trimmed and capped at 12 chars) — so a subtask never grows a field it
has no use for and every pre-Sprint-16 store round-trips byte-identical.

| function | what it is |
|---|---|
| `shopToggle(items, title)` | absent → appended, present → removed; every other row keeps its id, its ✓ and its qty |
| `shopCheck(items, id)` | one row ticks; no neighbour moves |
| `shopSetQty(items, id, qty)` | a cleared box drops the key rather than storing `''` |
| `shopClearDone(items)` | everything already in the cart leaves |
| `shopGroups(items)` | bands in `PANTRY` order, then `מוצרים משלי` |
| `pantryCatOf(title)` | which shelf a product came from; `''` for anything typed by hand |

Every one of them is pure and returns a new array — none mutates what it was handed.

#### §3 The two tabs are one list

**Tab 1 · בחירת מוצרים מתוך הרשימה** — the whole 161-product catalog: `#shopSearch` across
all ten shelves, the aisle strip (`data-pantrycat`) and the chip grid (`data-pantryitem`),
all unchanged from §7.4q. A tap writes the **record**, not a draft, which is the entire
reason tab 2 is already correct before it is ever opened and closing the sheet loses nothing.

**Tab 2 · רשימת הקניות שלי** — the same `items[]`, banded by shelf. Each `.shop-row` carries
its ✓ (`data-shopcheck` → `.shop-row.is-done .shop-name { text-decoration: line-through }`,
the mandate's `קו חוצה`), a free-text amount (`data-shopqty` — "2", "500 גרם", "×3"; not a
number, because the unit is half the information on a shopping line) and a ✕. Above the list:
`#shopNew` + `data-shopadd` for a product the catalog never heard of (↵ works, because a
shopping list is typed in bursts), and the two clears.

**Ownership:** the open aisle and the query are the module's and die with the sheet — next
week's shop does not start where last week's search left off. The open **tab** is
`prefs.shopTab`, remembered and normalised on load exactly like every other sub-tab.
Every item belongs to the record; nothing here holds a copy of one.

**Writes** go through one path — `shopWrite()` → `normItems()` → `Store.save()` →
`Patch.record()` + `Patch.settle()` — local-first, network never between a tap and a repaint.
The one exception is `Shop.qty()`, which deliberately does **not** repaint: the box being
typed into lives inside the container a repaint rebuilds, and rebuilding it mid-keystroke
would take the caret with it.

**Destruction is proportionate.** `ניקוי מה שנאסף` and `ניקוי הרשימה כולה` both go through
`confirmDelete()` — they destroy a list somebody built. Removing one row does not ask: it is
a single tap to put back from either tab, and a question in front of it would make the module
unusable at the pace a shopping list is actually edited at.

#### §4 Layout

`.shop-sheet` is taller than an ordinary sheet (`max-height:92vh` — it is the one surface
here you scroll for a while) and its two `.shop-pane`s are exclusive: `.shop-pane[hidden]`
resets `display`, so an inactive tab leaves the flow instead of stacking. `.shop-qty` is a
narrow `.input`, so it inherits the 16px iOS zoom lock like every other field. `.shop-cta`,
`.shop-check` and `.shop-del` all clear the 44px floor, an amount is echoed inside רשימות as
a `.cl-qty` pill, and every colour is a `var()` token so the light theme inherits the module
for free.

#### §5 Verification

`healthcheck.js` §48 adds 11 checks and drives the module head-lessly over a stubbed
document: both doors are asserted present and wired and the catalog is asserted **gone** from
every form (`FormPantry` must not survive anywhere as dead code); the two mandated tab labels
and every `data-shoptab` / `data-shoppane` / `data-shopqty` hook are asserted in the markup;
a real `open → toggle → tick → amount → group → clear` cycle is executed against the record,
including the proof that typing an amount does not rebuild the list under the caret; the
`shop-main` row is round-tripped through `toRow()` / `fromRow()` with its ✓ and its כמות
intact; the confirmations are driven through `Confirm.dismiss()` and `Confirm.accept()`; and
the cache floor is raised to **v22**, with `APP_VERSION` asserted in step.

### 7.4s עריכת המאגר, ± על הכמות, ואיפוס גלילה (shipped — Sprint 17)

Field mandate, three defects in one module: *"add / edit / delete products directly from
the Master Catalog"*, *"reset the list scroll container to the top on category switch"*, and
*"fix the focus/re-render layout jump when tapping the quantity area — replace/enhance the
quantity input with plus and minus stepper buttons"*. One theme runs through all three: the
module was read-only where the field needed it editable, and it repainted where the field
needed it to hold still. The shell ships as **v23** on both cache-busted URLs.

#### §1 The catalog stopped being read-only vocabulary

`PANTRY` is left **exactly** as §7.4q dictated it — ten shelves, 161 products, byte for
byte. The owner's changes live beside it, in `prefs.pantry`, as three small facts:

| key | shape | what it is |
|---|---|---|
| `add` | `{ aisleKey: [titles] }` | products of the owner's own |
| `hide` | `[ref]` | mandated products that were deleted |
| `edit` | `{ ref: title }` | mandated products that were renamed |

A **ref** is one product *on one shelf* — `pantryRef('canned','חומוס')` → `canned|חומוס` —
never a bare title. חומוס and סויה each sit on two shelves, and renaming the tinned one must
not touch the dry one. Four things fall out of the overlay shape for free: `שחזור המאגר` is
one assignment rather than a re-import; a store written before this sprint needs **no
migration and no new key**, because the overlay rides the same `prefs` payload
`Store.save()` already writes; a product a *future* mandate adds to `PANTRY` appears on the
shelf of somebody who has been editing for months; and every edit is a *layer*, so no code
path can ever corrupt the dictated vocabulary.

| function | what it is |
|---|---|
| `normPantryEdits(raw)` | never trusted, always rebuilt — unknown shelf, blank title, duplicate, and any ref pointing at a product this build no longer ships are all dropped. Idempotent. |
| `pantryApply(edits)` | the catalog actually shown. Each row keeps `orig`, the name the mandate gave it, because that is what a *second* rename files against |
| `pantryAddProduct(edits, cat, title)` | one name, one shelf, once |
| `pantryRenameProduct(edits, cat, orig, title)` | mandated → an override; the owner's own → rewritten in place. A collision on the same shelf is refused, never merged |
| `pantryRemoveProduct(edits, cat, orig)` | mandated → hidden; the owner's own → simply leaves. Drops any live rename with it |
| `pantryEdited(edits)` | the gate on `שחזור המאגר` |
| `pantryTitleOf` / `pantryHolds` | the name a product wears now / does this shelf already show one |

Every one of them is pure: an overlay in, a new overlay out, nothing mutated. Above them sit
the store-backed readers — `pantryEdits()`, `pantryAisles()` (memoised on the overlay's own
JSON, so `pantryCatOf()` stops rebuilding the catalog once per list row), `pantryTotal()`
and the single write path `pantryWrite()`. `pantryAisle` / `pantryLabel` / `pantryAisleRows`
/ `pantrySearch` / `pantryCatOf` all read the **effective** catalog, so an added product is
searchable, bands under its own shelf in tab 2, and is counted on the היום שלי door.

**The surface.** `✎ עריכת המאגר` (`#shopManage`, `data-shopmanage`) is a **mode**, not a
decoration: ✎ and ✕ cannot be nested inside a `.pn-chip` (a button inside a button), and a
delete sitting one tap from a select is a delete somebody makes by accident. Edit mode swaps
the grid (`.pn-items.is-manage`) for full-width `.pn-edit` rows carrying `data-pnedit` and
`data-pndel`, reveals `#shopCatalogAdd` (only onto a **named** shelf — a running search
names none) and reveals `שחזור המאגר` once anything has actually been changed. The rename
field is the *static* `#shopRenameBar`, never an input drawn into a row: a field inside a
container the catalog rebuilds is a field that loses its caret. ↵ adds and saves, Escape
cancels the rename before it closes the module.

**Destruction is proportionate.** Deleting a product and restoring the whole מאגר both go
through `confirmDelete()` — a product removed from the מאגר is gone from every *future* shop,
not from one list. A rename follows the product into the list it is already on
(`shopRename()`), so a ✓ and a כמות earned under the old name are not orphaned into
`מוצרים משלי`; a deletion deliberately leaves the list row alone, because deleting from the
מאגר is not deleting this week's shop.

#### §2 A new shelf starts at the top of itself

`.pn-items` scrolls inside itself (`max-height:280px; overflow-y:auto`, §7.4q), so switching
aisle kept the *previous* aisle's offset and landed the finger halfway down a shelf nobody
had looked at yet. `Shop.scrollTop()` zeroes `#shopItems` and `#shopPaneCatalog` and is
called from `setCat()`, `setQuery()` (a new result set is a new list) and `setManage()` (edit
mode swaps every row). It deliberately does **not** touch `#shopSheet`: that scroll belongs
to the finger, and resetting it would yank the grid off screen the moment somebody scrolled
down to reach it.

#### §3 The כמות, and why it jumped

Sprint 16 knew `Shop.qty()` must not repaint. What it could not know is that the 30-second
sync heartbeat ends in `Sync.flush()` → `render()` → `Patch.settle()` → `Shop.paint()`,
which rebuilt `#shopList` roughly a second after a finger reached the amount field — the
focus loss, the keyboard collapse and the layout jump the mandate reported. Two guards, both
in `paintMine()`:

- **`shopSignature(items)`** — id · title · ✓ · כמות for every row. A repaint that would
  produce byte-identical markup writes nothing at all, so the heartbeat is inert.
- **`shopFieldFocused()`** — `document.activeElement` carrying `data-shopqty` or
  `data-shoprename`. While it is true the container is left exactly as it is, and the pending
  change is drawn the moment the finger leaves. The derived text (`paintMeta`) still runs
  unconditionally, because it is cheap and touches no container.

`Shop.check()` and `Shop.step()` both refresh `mineSig` after swapping in place, so the
container and the record never drift apart.

**The ± pair.** Each `.shop-row` now carries `.shop-qty-box` — `data-shopstep="-:id"`, the
typed box, `data-shopstep="+:id"` — and `qtyStep(qty, delta)` moves the *first integer
anywhere in the value*, keeping whatever surrounds it: `500 גרם` ＋ → `501 גרם`, `×3` − →
`×2`, `''` ＋ → `1`. Two deliberate refusals: counting down past one **clears** the amount
(nothing on a shopping line means "one of it"), and a value with no digits at all is never
destroyed by −. The typed box stays — the mandate said *replace/enhance*, and a free-text
amount is the one thing a pair of counters cannot express. `Shop.step()` writes the record
and the box **in place**; only an off-screen row falls back to painting.

The row became a two-row grid (`grid-template-areas: "check name del" / ". qty ."`): one
flex line had to hold a 44px ✓, an elastic name, a 76px amount and a 44px ✕, which on a
360px phone squeezed the name to nothing and left the amount too narrow to hit. Both
steppers and both `.pn-act` glyphs clear `var(--tap)` in *both* directions, every hidden bar
resets `display`, and every colour is a `var()` token.

#### §4 Verification

`healthcheck.js` §49 adds 14 checks. The overlay layer is driven purely — add / rename /
delete / restore, the two-shelf חומוס case, the refused collision, and a deliberately
malformed overlay proving that an unknown shelf, a blank title, a duplicate, a stale ref and
a rename of something already deleted are all dropped before a render can see them. The
module is then driven head-lessly over the stubbed document through a full
`edit mode → add → rename → deletion → שחזור` cycle, with `Confirm.dismiss()` /
`Confirm.accept()` on both destructive paths and the list row asserted to keep its ✓, its
כמות and its id across a rename. `Shop.scrollTop()` is asserted to zero the grid on an aisle
switch, a search and a mode swap — and asserted **not** to touch the sheet. `qtyStep()` is
table-driven across fourteen cases; the ± pair is driven against the record; and the caret
guard is proven by counting `innerHTML` writes: two idempotent repaints write nothing, a
repaint with the amount box focused writes nothing, and the deferred write lands the moment
focus leaves. The cache floor is raised to **v23** with `APP_VERSION` and both `?v=` URLs
asserted in step.

### 7.4t מסך שעון מעורר ופתיחת פרטים מהיומן (shipped — Sprint 18)

A field mandate in two halves: a reminder that cannot be ignored, and a calendar whose
records can finally be opened.

**§1 — the persistent alarm clock (שעון מעורר משימות/אירועים)**

Until now a due reminder was a *message*: `Notify.show()` raised one notification, played
one sound of at most ten seconds, and was over whether or not anybody was there. That is
right for a heads-up and wrong for the 09:00 you must not miss — a phone face-down on a
desk delivers a ten-second ring to nobody.

`Alarm` is the second contract. When `Notify.tick()` fires a reminder it now *also* raises
`#alarmScreen`: a full-bleed, high-contrast overlay at `z-index:120` — above the sheets
(60) and the confirmation (80), because an alarm a half-open form can hide is an alarm
that was missed — carrying **the record's title, its clock and its category** (colour *and*
label, §0.2). Behind the screen four things run and none of them stop on their own:

1. **A ring that re-arms.** `Chime.loopAlert()` plays the record's own sound family and
   schedules itself again on that family's beat (`LONG_MS` for a צלצול, `ALARM_SHORT_MS`
   for a צליל קצר) — forever. `playLong()` deliberately schedules its ten seconds in one
   pass so a throttled tab still rings on the beat; a loop cannot do that, and the real
   `setInterval` is honest here precisely because the alarm screen is foregrounded.
2. **The mandated pulse.** `navigator.vibrate([1000,500,1000,500])`, re-fired every
   `ALARM_VIBE_MS` = 3000ms — the pattern's own length, so the phone never falls silent
   between bursts nor stacks them. Deliberately **not** gated on `רטט במגע`: silencing the
   interface must never silence an alarm.
3. **A Screen Wake Lock.** `navigator.wakeLock.request('screen')`, held for as long as the
   alarm is up and re-acquired on `visibilitychange` — the platform releases it whenever
   the page hides, and an alarm nobody can see is an alarm nobody dismissed.
4. **A high-priority Web Notification**, unchanged except that it now carries
   `requireInteraction: true` and `renotify: true`, so the background half stays in the
   shade until it is acted on. That is the half that survives a closed app, via the
   Sprint-11 push path.

`ביטול התראה / כבה` is the only thing that stops any of it: it cuts the loop, cancels the
pattern with `vibrate(0)`, releases the sentinel and takes the screen down. `פתיחת פרטי
הפריט` dismisses and lands in the same reader §2 opens. Nothing here schedules its own
silence — there is no `setTimeout` anywhere in the module, and the healthcheck asserts it.

Two reminders in the same minute are two things owed: the second **queues** behind the
first, is counted on the screen ("ועוד תזכורת אחת ממתינה"), and takes over the moment the
first is dismissed. The queue lives in `prefs.alarms` rather than in the module, so an
alarm the phone was locked on is still owed when the app comes back — bounded by
`ALARM_KEEP_MS` (one hour), because an alarm may be late but must never be stale.
`normAlarms()` drops malformed rows, collapses duplicate ledger keys, normalises the alert
pair and strips a `collection` no reader can open, then caps at `ALARM_MAX`.

Every capability is independently guarded. No `wakeLock`, no vibration motor, no
`AudioContext`, no permission — each degrades to the next-loudest thing the device can
actually do, and the screen itself is the floor that is always there.

**§2 — every title in the calendar opens its record (תצוגת אירועים ופתיחת פרטים בלחיצה)**

The month, week and day panes were the one place in the app where a record could be *seen*
and not *opened*: month cells drew anonymous dots, week chips were inert `<span>`s and a
day-timeline block was a plain `<div>`. Tapping any of them opened Master Add for that
slot, which is the right answer for empty space and the wrong one for a meeting.

A cell is two surfaces now. Empty space is still `data-calslot` — "create something here".
The records inside it are real controls carrying `data-open="<collection>:<id>"`, and
`closest()` in the delegate resolves to whichever of the two the finger actually landed on:

| View | Before | Now |
|---|---|---|
| Monthly cell | 4 dots | the dots **and** the first 2 titles as `.cal-chip` buttons, `+N` for the rest |
| Weekly grid | `<span class="wk-chip">` | `<button class="wk-chip" data-open>` |
| Daily timeline | `<div class="dv-block">` | `<button class="dv-block" data-open>` |
| All-day strip | inert chip | `.wk-chip` button |
| Agenda / לביצוע היום / משימות קרובות | already `data-rec` rows | unchanged — they already opened the reader |

A cell can only draw so many titles, so `+N` stops being a dead label and becomes
`calMore()` — a control carrying `data-calday` that opens **that day in the day view**,
where every record it stands for is listed as an openable row. Without it the third meeting
on a busy Tuesday would be counted in the month grid and reachable from nowhere in it.

A `<button>` may not contain a `<button>`, so `.cal-cell` and `.wk-cell` stop being buttons
and become `role="button" tabindex="0"` containers (`cellOpen()`). The keyboard contract
that loses is paid back in `onKeydown()` — Enter *and* Space, with `preventDefault()` so
Space cannot scroll the grid — and `.cal-stage [data-calslot]` restores the `touch-action:
pan-y` the blanket `button` rule no longer reaches, so swipe navigation still owns the
horizontal axis. The month cell grows to 74px (106px on a wide canvas) to hold its titles.

The reader behind the tap is the Sprint-12 `#detailSheet`, which already states every field
the mandate names — כותרת, תאריך ושעה, הערות, לקוח, קטגוריה, סטטוס, הגדרות התראה — and
already carries ערוך / מחק / סמן כבוצע. §50d asserts all eight against a real record rather
than trusting that.

**Verification (§50).** The alarm is *driven*, not pattern-matched: `phoneStub()` supplies
an `AudioContext` that counts oscillators, a vibration motor that records patterns, a wake
lock that hands back a sentinel, and a `setInterval` that returns the callback the app
registered — so `beat()` is one tick of wall-clock time and "keeps ringing until dismissed"
becomes a falsifiable claim. A full raise → ring → beat → beat → queue → dismiss cycle
asserts the screen, the loop, the pattern, the lock and then that all five stop together
and a stale timer cannot resurrect the ring. A second pass runs the same cycle on a device
with no motor, no lock and no audio at all. `normAlarms()` is table-driven; `Notify.due()`
is asserted to hand the alarm the collection, category, clock and subject the screen paints
hours later; and the chip, the delegate, the four render paths and the keyboard fallback
are each asserted in turn. The cache floor is raised to **v24** with `APP_VERSION` and both
`?v=` URLs asserted in step.

### 7.4u שעון מעורר ברקע — the alarm that rings with the app closed (shipped — Sprint 19)

Sprint 18 built an alarm that cannot be ignored. It could only ever ring while the app was
**open**, because the thing that raised it was `Notify.tick()` — a `setInterval` inside the
page. Mobile Chrome freezes a backgrounded tab's timers within minutes, iOS suspends the
whole process, and a closed PWA runs nothing at all.

Sprint 11 had already moved the *delivery* off the phone: a scheduled Worker POSTs
`/api/push/dispatch` once a minute, the dispatcher runs the server-side twin of
`Notify.due()`, and `_webpush.js` encrypts an RFC 8291 payload to each registered device.
But what landed was a **notification** — one line in the shade, a `[110,60,110]` buzz,
auto-dismissable, and ending at a focused window rather than at an alarm. So the 09:00 you
must not miss was a full-screen ringing alarm if the app happened to be open and a
dismissable toast if it was not. This sprint closes that gap in four parts.

**§1 — the notification a closed phone receives is the alarm's own.** `sw.js` now raises it
with `vibrate: ALARM_VIBE` — the same mandated `[1000,500,1000,500]` `app.js` rings on, and
§51a asserts the two constants against each other — plus `requireInteraction: true` so it
sits on the lock screen until a finger acts on it, `renotify: true` so a second reminder
re-alerts rather than silently replacing the first, and `silent: false`. The notification is
tagged with the reminder's **ledger key**.

**§2 — the payload carries what the screen paints.** A phone whose app has been closed for
hours cannot look anything up, so `pushPayload()` in `dispatch.js` puts an `alarm` block on
the wire beside the title and body: the ledger `key`, the `id` + `collection` that let
פתיחת פרטי הפריט work, the `cat`, `kind`, `clock` and `subject` the screen states, and the
record's own `alert` pair. `scan()` therefore selects `category`, `alert_sound` and
`alert_vibe` alongside the columns it already read. Both ends normalise the vocabulary
(`normCat` / `normAlertSound` / `normVibe`, mirrored server-side), so neither has to trust
the other and an unknown value falls back rather than travelling. The GET dry run reports
the whole payload — a diagnostic surface that hid the alarm block could not diagnose a blank
alarm screen.

**§3 — the tap ends at the alarm screen, open app or not.** `notificationclick` has two
paths and both converge on `Alarm.raise()`:

| State of the app | Path | Carrier |
|---|---|---|
| a window is open | `client.focus()` → `postMessage` | `{type:'PUSH_ALARM', alarm}` → `Notify.init()`'s listener → `Alarm.fromPush()` |
| nothing is open | `clients.openWindow()` | `#alarm=<encoded JSON>` → `alarmFromHash()` → `Alarm.fromLaunch()` |

`ALARM_HASH` is declared in both files and asserted to match. The hash is a **one-shot
courier**: `clearAlarmHash()` spends it via `history.replaceState` the moment it is read,
because a hash left in the address bar would re-ring a dismissed reminder on every reload —
the one way an alarm clock becomes something you learn to ignore. `fromLaunch()` runs before
`resume()` in `Alarm.init()` so a queue off disk and an alarm off a tap end in **one** queue,
and `resume()` no longer re-starts a screen that is already up. The ledger key does the rest:
a reminder the local scan already raised is recognised, not queued twice.

A push with no `alarm` block behaves exactly as it did in Sprint 11 — `PUSH_CHIME`, the
one-shot bell — because an alarm screen ringing on its own loop and a one-shot chime would
fight each other. The two messages are alternatives, never a pair.

**§4 — the permission, and the subscription behind it.** The browser's own dialog cannot be
relabelled, so the app says what it is buying a beat before it opens: `NOTIFY_ASK_CTA` =
**"אפשר התראות בשביל שעון מעורר ברקע"**, used as the banner CTA, the pill's title and a
toast immediately before `requestPermission()`. `linkServer()` now writes the subscription to
`prefs.notify.sub` **before** the POST rather than after it: the browser has already
committed the endpoint by then, so recording it only on a 200 would leave a device with a
live subscription the app cannot name. `serverAt` stays the separate fact — whether D1 has
it. `normSub()` is all-three-fields-or-none: an endpoint with no keys cannot be encrypted
to, so a half-row would claim a device is reachable while every dispatch to it failed.

**Verification (§51).** `sw.js` is loaded into a stubbed worker scope and its **real**
listeners are fired, so a `push` or a `notificationclick` in the suite is the function the
browser calls. The full journey is asserted hop by hop — `pushPayload()` builds it,
`alarmFromHash()` parses the worker's own URL back, `normAlarms()` normalises it onto the
screen — because every hop is a place a field can be dropped and a dropped field is a blank
alarm screen at 09:00. A pushed alarm is driven through the same `phoneStub()` raise → ring
→ buzz → wake-lock → dismiss cycle Sprint 18 uses, and asserted *not* to double-raise a
reminder the local scan already holds. `linkServer()` is executed against a stubbed
`pushManager` and `fetch`, proving both halves land; `validSub()` is executed against eight
malformed subscriptions; `normSub()` and `alarmFromHash()` are table-driven against junk.
The cache floor is raised to **v25** with `APP_VERSION` and both `?v=` URLs asserted in step.

### 7.4v מנוע סבבי מילואים ומשמרות — the reserve-duty rotation engine (shipped — Sprint 20)

A reserve rotation is not a set of records. It is a **rule** — "a week at base, a week at
home, from the 10th of August" — and a rule that has to be entered as 150 events is a rule
nobody enters. Every previous sprint added things you *create*; this one adds a thing the
calendar *computes*, and the whole design follows from that distinction.

**§1 — one config, three homes.** `prefs.reserveShiftConfig` carries exactly six fields:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | whether the overlay is painted at all |
| `anchorDate` | `2026-08-10` | the day the rotation is *known* to start |
| `anchorState` | `BASE` | which leg that day opens |
| `homeDays` | `7` | length of the 🏡 בית leg |
| `baseDays` | `7` | length of the 🪖 בסיס leg |
| `endDate` | `2026-12-31` | the last day the rule speaks for |

It lives in state, in `localStorage` under the same versioned key as everything else, and in
D1 — see §4 below. `normShiftConfig()` is the single read path and normalises rather than
trusts: an anchor that is not an ISO date, a leg of zero days, an unknown state or an end
date behind the start are all repaired on load, because a garbage config that reaches the
renderer paints a confident colour on days nobody stated anything about.

**§2 — `getShiftForDate(iso, cfg)` → `'HOME' | 'BASE' | ''`.** Nothing is stored per day.
The anchor opens a leg of `anchorState`, the legs alternate, and the answer is a modulo of
the offset against `homeDays + baseDays`. That is why a date three years out costs exactly
what tomorrow costs, and why "graceful infinite scroll / future navigation" needed no special
case at all — the window is never pre-computed, it is *asked*.

Two decisions are worth naming. **The rotation is defined only on `[anchorDate, endDate]`**
and answers `''` outside it — the cycle is deliberately *not* extrapolated backwards, because
the anchor is where it is known to start and a colour painted on a week nobody stated is how
a schedule stops being believed. And the day arithmetic runs on `daysBetweenISO()`, the one
function in the app that reaches for UTC: subtracting two *local* midnights across Israel's
October DST change gives 25 hours, and a `Math.round()` hiding that would put every day after
the change one leg out. The dates stay local; only the arithmetic between two of them sits on
a fixed grid.

**§3 — the overlay, on all five views.** `shiftClass()` returns the cell modifier and
`shiftTag()` the words, and both are called from `renderMonth`, `renderWeek`, `renderDay`,
`renderYear` and `renderAgenda` — one source of truth, five surfaces. The tints are the values
the field mandate named to the digit (`--shift-home` / `--shift-base` in `:root`), and they
are deliberately weak: an overlay that outshouts the meetings drawn on top of it is an
overlay people switch off. Legibility is therefore carried by **three** things and never by
the colour — the tint, a 2px edge in the same hue, and the printed **🏡 בית** / **🪖 בסיס**
(§0.2: colour is never the sole carrier). `is-today` still outranks the rotation: gold wins
the cell background, the shift keeps the edge and the words. The day view gets a banner
instead of a tinted cell, because it holds one day and can afford the sentence the tint
cannot fit — **"🪖 בסיס · יום 3 מתוך 7"**, from `shiftLegDay()`.

**Sprint 20 adds a fifth calendar view — `year`.** It exists *because* of the rotation: a 7/7
cycle is a stripe running through twelve months, and four weeks of month grid can only ever
show one segment of it. Twelve mini-months, each square a real `data-calday` control that
opens that day, each busy day still carrying its dot. `CAL_VIEWS` is now
`['day','week','month','year','agenda']` and the arrows step a whole year on it.

**§4 — the settings sheet, and why it is a sheet.** `#shiftSheet` ("🛡️ הגדרות סבב מילואים")
exposes exactly the four adjustments the mandate names: move the transition date, flip the
phase (**החלף בית ⇆ בסיס**), change the leg lengths (free numbers plus one-tap presets), and
move the end date. It then reads the rule back as the next four legs with real dates — a
rotation nobody can verify at a glance is a rotation nobody trusts. Every mutator routes
through `Shift.commit()`, which does three things and never two of them: save to
`localStorage`, push to D1, repaint. A setter that saved without pushing is exactly how a
"persisted" setting becomes mysterious on a second device.

**The D1 half.** `migrations/0007_sprint20_settings.sql` adds **`app_settings`**
(`key`, `owner_id`, `value_json`, `updated_at`, `created_at`) and `/api/settings` answers GET
and POST over it, last-write-wins on `updated_at` enforced in the UPSERT. It is deliberately
**not** part of `/api/sync`: that route replays an outbox of row ops against the five entity
tables and iterates `TABLES` to build its delta, and a setting has no category, no tombstone
and no place in a recycle bin — folding it in would have meant every one of those concepts
growing an exception. The migration adds a table and alters none, so the column-drift check
between the SQL, `_shared.js` `SCHEMA` and `app.js` `SYNC_SCHEMA` is untouched. The Worker
never parses the blob for meaning: the vocabulary of a rotation belongs to the client, and a
Worker that validated the field names would need redeploying before the client could learn a
new one. `Shift.pull()` runs once at boot and resolves on `updatedAt` the same way — a device
holding the newer rule keeps it and pushes it back rather than being silently overwritten.

**Verification (§52).** The engine is **executed**, not grepped. Every day of the default
rotation is compared against arithmetic `healthcheck.js` computes independently by walking
one day at a time from the anchor, so a day lost to a DST hour makes the two answers diverge;
the same sweep runs for `14/7`, `7/14`, `3/4`, `1/1` and `30/5`, and for the flipped phase,
which is additionally asserted to be an exact day-for-day mirror. The window boundaries, the
disabled switch and five kinds of garbage date are asserted to answer `''`. `/api/settings`
is loaded with `_shared.js` into a sandbox and driven against an in-memory `app_settings`
that enforces the same last-write-wins guard the SQL does, proving a full write → read →
stale-write → newer-write cycle. The overlay is asserted present in all five renderers, the
tints against the mandated literals in `:root`, and the sheet against all four adjustments.
The cache floor is raised to **v26** with `APP_VERSION` and both `?v=` URLs asserted in step.

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

> **As shipped (Sprint 5, §7.4d):** the durable local store is `localStorage`, not
> IndexedDB — §0.4 fixed that choice for V1 and the outbox lives inside the same
> versioned key, so a queued mutation survives a reload for free. Every other rule
> above holds exactly as written: local write first, outbox enqueue, optimistic
> repaint, then the network; `op_id` idempotency; last-write-wins on `updated_at`;
> tombstones rather than hard deletes. IndexedDB remains the migration target when
> the store outgrows the `localStorage` quota.

### 8.1 PWA Delivery Layer (shipped — Sprint 2)

**Install shell**
- `manifest.json`: `display: standalone`, `start_url: ./index.html`, `scope: ./`, RTL Hebrew,
  background `#12161f`, theme `#e4c278`. Every path is **relative** so the app installs
  correctly from a GitHub Pages sub-path as well as from a domain root.
- Icons are rendered from the photographic brand mark archived at `tools/brand-mark.jpg`
  — 32 / 180 / 192 / 512 `any` plus a 512 `maskable` whose mark sits inside the 80% safe zone.
  The Sprint-2 procedural generator (`tools/gen-icons.js`) was deleted in Sprint 7 so it can
  never overwrite the shipped set.
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

Since Sprint 6 the tree has exactly one published directory. Everything a browser can
fetch is in `public/`; everything else is build and config territory and is never
uploaded (§7.4e).

```
C:\calendar-app\
├── public/                      ← THE PUBLISHED SURFACE (pages_build_output_dir)
│   ├── index.html               ← app shell
│   ├── styles.css
│   ├── app.js
│   ├── manifest.json            ← PWA install descriptor
│   ├── sw.js                    ← service worker: offline cache + push
│   └── icons/                   ← generated PNGs (do not hand-edit)
├── functions/api/               ← Worker routes — ROOT on purpose: Pages compiles
│   ├── sync.js  events.js  …      Functions from the project root and mounts them
│   └── gcal/                      at /api/*. Moving this into public/ would both
│       ├── _gcal.js               unmount the API and publish its source.
│       ├── _token.js
│       ├── auth.js
│       └── sync.js
├── migrations/                  ← D1 SQL migrations, numbered, append-only
├── tools/brand-mark.jpg         ← icon source of truth; public/icons/ is rendered from it
├── PROJECT_PLAN.md              ← this file
├── README.md
├── healthcheck.js               ← repo-local verification suite (§10)
└── wrangler.toml                ← Pages output dir + D1 binding
```

- **Nothing outside `public/` may be reachable over HTTP.** `healthcheck.js` §20 fails the
  build if a config file leaks into `public/`, or if a published asset drifts back out.
- Commit messages: single line, imperative mood (`add week-view drag-create`).
- Migrations are append-only and never edited after being applied. Sprint 6's three new
  `events` columns therefore arrive as `ALTER TABLE ADD COLUMN` and trail every Sprint-5
  column — the Worker's `SCHEMA` and the client's `SYNC_SCHEMA` list them in exactly that
  position, and the healthcheck rebuilds the order from the migrations to prove it.
- A module under `functions/api/` prefixed with `_` is shared code, never a route.
- `_gcal.js` is pure by contract — no `fetch`, no D1, no `env` — so the verification suite
  can execute the mapping math directly instead of grepping it.

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
