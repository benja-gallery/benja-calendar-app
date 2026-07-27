# יומן חכם — Benja

Unified personal & business productivity center — calendar, tasks, lists, notes and clients
in one RTL-native, offline-first Progressive Web App.

Full specification: [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

---

## What ships here

| File | Role |
|---|---|
| `index.html` | App shell (RTL, mobile-first) |
| `styles.css` | "Luxury Dark & Champagne Minimalist" design system — every colour literal lives in `:root` |
| `app.js` | Store, views, Master Add, service-worker registration, notifications engine |
| `manifest.json` | PWA install descriptor (`standalone`, RTL Hebrew, relative paths) |
| `sw.js` | Offline cache of the core shell + `push` → `showNotification()` |
| `icons/` | Generated PNGs — **do not hand-edit**, run `node tools/gen-icons.js` |
| `healthcheck.js` | Repo-local verification suite (48 checks) |

---

## Verification

```bash
node healthcheck.js      # exit 0 = green, exit 1 = red
```

The zero-regression rule applies: this must be green before anything is reported complete.

Regenerating icons after a brand-token change:

```bash
node tools/gen-icons.js
```

---

## Running locally

A service worker requires `http(s)` — opening `index.html` straight off the disk (`file://`)
works, but the offline cache and notifications stay off (the app detects this and skips
registration instead of throwing).

```bash
npx serve .          # or:  python -m http.server 8080
```

Then open `http://localhost:8080` — `localhost` counts as a secure origin, so the full PWA
behaviour is testable without HTTPS.

---

## Deploying to GitHub Pages

1. Push this repository to GitHub (`main` branch).
2. Repository → **Settings → Pages**.
3. **Source:** `Deploy from a branch` → **Branch:** `main` → **Folder:** `/ (root)` → **Save**.
4. After ~1 minute the site is live at:

   ```
   https://<username>.github.io/<repository>/
   ```

Everything in `manifest.json` and `sw.js` uses relative paths, so the app installs correctly
from that sub-path with no edits.

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
