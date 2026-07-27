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
| `public/icons/` | Generated PNGs — **do not hand-edit**, run `node tools/gen-icons.js` | ✅ |
| `functions/api/` | Worker routes, mounted at `/api/*`. Stays at the **root**: Pages compiles Functions from the project root, not from the output directory. | source ❌ |
| `migrations/` | D1 SQL migrations, numbered and append-only | ❌ |
| `wrangler.toml` | `pages_build_output_dir = "public"` + the D1 binding | ❌ |
| `PROJECT_PLAN.md` | Full specification | ❌ |
| `healthcheck.js` | Repo-local verification suite (165 checks) | ❌ |

---

## Verification

```bash
node healthcheck.js      # exit 0 = green, exit 1 = red
```

The zero-regression rule applies: this must be green before anything is reported complete.
Among other things it fails the build if a config file ever leaks into `public/`, or if a
published asset drifts back out of it.

Regenerating icons after a brand-token change (writes into `public/icons/`):

```bash
node tools/gen-icons.js
```

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

### Server-sent push (remaining work)

`sw.js` already handles the `push` event and renders it through
`self.registration.showNotification()`. To send from a server:

1. Generate a VAPID key pair.
2. Subscribe the device: `APP.Notify.subscribe('<VAPID_PUBLIC_KEY>')` → returns a
   `PushSubscription`; store it server-side.
3. Send a Web Push message with a JSON body of `{ "title": "...", "body": "...", "url": "...",
   "tag": "..." }`.

---

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
