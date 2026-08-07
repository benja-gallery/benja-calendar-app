# יומן חכם — Benja

Unified personal & business productivity center — calendar, tasks, lists, notes and clients
in one RTL-native, offline-first Progressive Web App.

Full specification: [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

---

## What ships here

Since Sprint 6 the tree has exactly one published directory. **Everything a browser can
fetch lives in `public/`.** Everything else is build and config territory and is never
uploaded — that is what keeps `PROJECT_PLAN.md`, `healthcheck.js` and `wrangler.toml` off
the public internet.

| Path | Role | Served? |
|---|---|---|
| `public/index.html` | App shell (RTL, mobile-first) | ✅ |
| `public/styles.css` | "Luxury Dark & Champagne Minimalist" design system — every colour literal lives in `:root` | ✅ |
| `public/app.js` | Store, views, Master Add, service-worker registration, notifications, cloud sync, Google Calendar bridge | ✅ |
| `public/manifest.json` | PWA install descriptor (`standalone`, RTL Hebrew, relative paths) | ✅ |
| `public/sw.js` | Offline cache of the core shell + `push` → `showNotification()` | ✅ |
| `public/icons/` | Generated PNGs — **do not hand-edit**, regenerate from `tools/brand-mark.jpg` | ✅ |
| `functions/api/` | Worker routes, mounted at `/api/*`. Stays at the **root**: Pages compiles Functions from the project root, not from the output directory. | source ❌ |
| `migrations/` | D1 SQL migrations, numbered and append-only | ❌ |
| `wrangler.toml` | `pages_build_output_dir = "public"` + the D1 binding | ❌ |
| `PROJECT_PLAN.md` | Full specification | ❌ |
| `healthcheck.js` | Repo-local verification suite (467 checks) | ❌ |

---

## Verification

```bash
node healthcheck.js      # exit 0 = green, exit 1 = red
```

The zero-regression rule applies: this must be green before anything is reported complete.
Among other things it fails the build if a config file ever leaks into `public/`, or if a
published asset drifts back out of it.

Regenerating icons after a brand-mark change (writes into `public/icons/`):

```bash
node ../benja-gallery/generate-icons.js tools/brand-mark.jpg --out public/icons
# then rename apple-touch-icon.png -> apple-touch-icon-180.png and add
# maskable-512.png (mark inside the 80% safe zone)
```

The source of truth is the photographic brand mark at `tools/brand-mark.jpg`. The old
shape-based `tools/gen-icons.js` was deleted in Sprint 7 — it rendered the superseded
procedural glyph and would silently overwrite the shipped icons.

---

## Running locally

A service worker requires `http(s)` — opening `index.html` straight off the disk (`file://`)
works, but the offline cache and notifications stay off (the app detects this and skips
registration instead of throwing).

```bash
npx wrangler pages dev     # serves public/ AND functions/api/* — use this one
npx serve public           # static only: /api/* 404s and the app stays local-first
```

Then open the printed `http://localhost:…` — `localhost` counts as a secure origin, so the
full PWA behaviour is testable without HTTPS.

---

## Deploying

**Cloudflare Pages** is the deployment target.

```bash
wrangler d1 migrations apply benja-calendar --remote
wrangler pages deploy
```

`wrangler.toml` sets `pages_build_output_dir = "public"`, so only `public/` is uploaded and
`functions/api/*` is compiled from the root and mounted at `/api/*`.

Sprint 20 adds `migrations/0007_sprint20_settings.sql` (the `app_settings` table behind
`/api/settings`), so `wrangler d1 migrations apply` must run before the reserve rotation can
follow the owner onto a second device. Until it does, the app is unaffected: the rotation is
local-first like everything else, and a failed push is a no-op rather than an error.

Google Calendar (Sprint 6) needs four secrets on the Pages project:

```bash
wrangler pages secret put GOOGLE_CLIENT_ID
wrangler pages secret put GOOGLE_CLIENT_SECRET
wrangler pages secret put GOOGLE_REDIRECT_URI          # https://<host>/api/gcal/auth
wrangler pages secret put GOOGLE_BUSINESS_CALENDAR_ID  # the business calendar's id
```

Until they are set, `/api/gcal/*` answers `503 gcal_not_configured`, the header button reads
"Google Calendar לא מוגדר", and every other capability is untouched.

> **GitHub Pages no longer works for this repo.** The shell moved into `public/`, and
> GitHub Pages can only publish from the branch root or `/docs`. It could never satisfy the
> Sprint-6 shielding requirement in any case — it publishes *every* file in the branch,
> `PROJECT_PLAN.md` included.

---

## Installing on a phone

**Android / Chrome**
1. Open the live URL.
2. Menu (⋮) → **Add to Home screen** / **Install app** (Chrome usually offers this by itself).
3. Launch from the home-screen icon — it opens standalone, with no browser chrome.

**iPhone / Safari** (must be Safari — Chrome on iOS cannot install PWAs)
1. Open the live URL.
2. Share (□↑) → **Add to Home Screen** → **Add**.

> iOS only allows web notifications for an app that was *added to the home screen*, and only on
> iOS 16.4+. Install first, then enable notifications from inside the installed app.

---

## Notifications

Tap **🔔 הפעל התראות פוש** in the top bar and approve the browser prompt. The app then raises a
native notification ~10 minutes before every meeting and every timed task, and each reminder
fires once per day per record.

Reminders intentionally ignore the personal/business filter — the filter hides rows on screen,
it must never mute a real meeting.

### Server-sent push — the background alarm clock (Sprint 11 + Sprint 19)

Local timers cannot survive a closed app, so the reminder clock lives off the phone:
`tools/push-cron-worker/` fires once a minute and POSTs `/api/push/dispatch`, which runs the
server-side twin of `Notify.due()` and encrypts an RFC 8291 payload to every registered
device. Setup is four secrets on the Pages project plus the cron Worker:

```bash
node tools/gen-vapid.js                       # prints the P-256 key pair
wrangler pages secret put VAPID_PUBLIC_KEY
wrangler pages secret put VAPID_PRIVATE_KEY
wrangler pages secret put VAPID_SUBJECT       # mailto:you@example.com
wrangler pages secret put PUSH_DISPATCH_SECRET
wrangler d1 migrations apply benja-calendar --remote
cd tools/push-cron-worker && wrangler deploy  # the clock Pages cannot run itself
```

Until they are set `/api/push/*` answers `503`, the client stays on its local 30-second scan,
and nothing else changes.

Since Sprint 19 the payload is not just a notification — it is the **alarm**:

```json
{
  "title": "משימה מתחילה עכשיו",
  "body": "לשלוח הצעת מחיר · 09:00",
  "tag": "at#t1@2026-08-07",
  "url": "./index.html",
  "alarm": {
    "key": "at#t1@2026-08-07", "id": "t1", "collection": "tasks",
    "cat": "business", "kind": "משימה", "clock": "09:00",
    "subject": "לשלוח הצעת מחיר",
    "alert": { "sound": "long", "vibe": "repeat" }
  }
}
```

`sw.js` draws it with the mandated `[1000,500,1000,500]` vibration and
`requireInteraction: true`, so it stays on the lock screen until it is acted on. Tapping it
raises the same full-screen alarm screen a foreground reminder does — over `postMessage`
into a window that is already open, or on the `#alarm=` hash of one that is not. `alarm.key`
is the ledger key, which is what stops a reminder the local scan already raised from ringing
twice.

`GET /api/push/dispatch?key=<PUSH_DISPATCH_SECRET>` is a dry run: it reports exactly what a
POST would send — payloads included — and sends nothing.

---

## 🛡️ סבב מילואים — the reserve-duty rotation (Sprint 20)

The calendar computes the rotation instead of asking you to enter it. Open **יומן**, and the
bar above the grid carries the toggle, today's position in the cycle, and a ⚙ that opens
**הגדרות סבב מילואים**.

| Field | Default | |
|---|---|---|
| תאריך תחילת הסבב | `2026-08-10` | the day the rotation is known to start |
| which leg it opens | 🪖 בסיס | flipped in one tap with **החלף בית ⇆ בסיס** |
| ימי בית / ימי בסיס | 7 / 7 | any lengths, or one of the ready-made presets |
| תאריך סיום הסבב | `2026-12-31` | the last day the rule speaks for |

🏡 בית tints green and 🪖 בסיס tints red across **all five** calendar views — including the
new **שנה** view, which is twelve mini-months and the only surface a 7/7 stripe fits on. The
tints are soft on purpose and never carry the meaning alone: every tinted day also prints its
name. Changes stick as the new default and sync to D1 through `/api/settings`.

Days before the start date and after the end date are deliberately left uncoloured — the
anchor is where the cycle is *known* to begin, and the app does not extrapolate backwards.

## Google Calendar (Sprint 6)

Tap **📅 התחבר ל-Google Calendar** in the top bar, approve Google's consent screen, and the
app comes back to itself already syncing. Once connected the same button runs a cycle on
demand, and the line underneath reads **סונכרן לאחרונה מול גוגל: HH:MM**.

| Google calendar | App category |
|---|---|
| Primary | אישי (`personal`) |
| The calendar in `GOOGLE_BUSINESS_CALENDAR_ID` | עסקי (`business`) |

Sync is genuinely two-way: events created, edited or deleted on a phone arrive here, and
events created, edited or deleted here reach Google. Conflicts resolve last-write-wins on
the ISO timestamps, the same rule the device-to-device sync already uses.

No token ever reaches the browser — the OAuth handshake and the refresh token live entirely
inside the Worker and D1. **ניתוק** forgets them.

See [`PROJECT_PLAN.md` §7.4e](PROJECT_PLAN.md) for the full contract.
