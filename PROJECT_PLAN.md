# Calendar App — Project Plan & Full Specification

> **Status:** Sprint 5 shipped — Cloudflare D1, Worker sync API, offline outbox, v0.5
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
├── wrangler.toml        ← Pages + D1 binding (Sprint 5)
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
