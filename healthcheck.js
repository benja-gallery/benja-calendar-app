#!/usr/bin/env node
/* ==========================================================================
   healthcheck.js — repo-local verification suite (PROJECT_PLAN §10)

   Static, dependency-free. Validates that the shipped artefacts actually
   satisfy the injected specification: design tokens, shell structure, touch
   standard, dual-category engine, My Day composition, DOM/JS wiring.

   Usage:  node healthcheck.js        (exit 0 = green, exit 1 = red)
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

/**
 * Sprint 6 split the repo in two (PROJECT_PLAN §11): everything a browser can
 * fetch lives in public/, everything else (this file, PROJECT_PLAN.md,
 * wrangler.toml, migrations/, functions/) stays at the root and is never
 * uploaded. Paths are resolved public-first so every existing check keeps
 * naming its file the way it always did.
 */
const PUBLIC = path.join(ROOT, 'public');

function at(file) {
  const inPublic = path.join(PUBLIC, file);
  return fs.existsSync(inPublic) ? inPublic : path.join(ROOT, file);
}

const pass = [];
const fail = [];

function check(name, fn) {
  try {
    const res = fn();
    if (res === true || res === undefined) pass.push(name);
    else fail.push(name + ' — ' + res);
  } catch (err) {
    fail.push(name + ' — threw: ' + err.message);
  }
}

function read(file) {
  return fs.readFileSync(at(file), 'utf8');
}

function must(hay, needle, label) {
  return hay.indexOf(needle) !== -1 ? true : 'missing ' + (label || needle);
}

/* -------------------------------------------------------------- 1. files */

/** the published surface — every one of these must live in public/ (§11) */
const REQUIRED = [
  'index.html', 'styles.css', 'app.js', 'manifest.json', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon-180.png', 'icons/favicon-32.png'
];

/** the unpublished surface — spec and tooling, at the root and never uploaded */
const REQUIRED_ROOT = ['PROJECT_PLAN.md', 'wrangler.toml'];

check('required files present', () => {
  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(PUBLIC, f)))
    .concat(REQUIRED_ROOT.filter(f => !fs.existsSync(path.join(ROOT, f))));
  return missing.length ? 'missing: ' + missing.join(', ') : true;
});

if (fail.length) { report(); }

const html = read('index.html');
const css = read('styles.css');
const js = read('app.js');
const plan = read('PROJECT_PLAN.md');

/* ------------------------------------------------- 2. app.js parses cleanly */

check('app.js parses (no syntax errors)', () => {
  new vm.Script(js, { filename: 'app.js' });
  return true;
});

check('app.js is IIFE-scoped and strict', () => {
  if (js.indexOf("'use strict'") === -1) return "no 'use strict'";
  if (!/^\s*\(function\s*\(\)\s*\{/m.test(js)) return 'not wrapped in an IIFE';
  return true;
});

/* ------------------------------------------------------ 3. document basics */

check('document is RTL Hebrew', () => {
  if (!/<html[^>]+lang="he"/.test(html)) return 'lang is not he';
  if (!/<html[^>]+dir="rtl"/.test(html)) return 'dir is not rtl';
  return true;
});

check('viewport is mobile-correct (viewport-fit=cover, no user-scalable=no)', () => {
  const m = html.match(/<meta name="viewport"[^>]*content="([^"]+)"/);
  if (!m) return 'no viewport meta';
  if (m[1].indexOf('width=device-width') === -1) return 'no width=device-width';
  if (m[1].indexOf('viewport-fit=cover') === -1) return 'no viewport-fit=cover';
  if (/user-scalable\s*=\s*no|maximum-scale/.test(m[1])) return 'zoom is disabled (a11y violation)';
  return true;
});

check('assets are linked', () => {
  if (html.indexOf('styles.css') === -1) return 'styles.css not linked';
  if (html.indexOf('app.js') === -1) return 'app.js not linked';
  return true;
});

/* -------------------------------------------- 4. design system (mandated) */

const TOKENS = {
  '--surface': '#12161f',
  '--card': '#1a202c',
  '--gold': '#e4c278',
  '--business': '#4a90e2',
  '--personal': '#50c878'
};

check('brand tokens carry the mandated values', () => {
  const bad = [];
  Object.keys(TOKENS).forEach(tok => {
    const re = new RegExp(tok.replace(/-/g, '\\-') + '\\s*:\\s*' + TOKENS[tok], 'i');
    if (!re.test(css)) bad.push(tok + ' != ' + TOKENS[tok]);
  });
  return bad.length ? bad.join('; ') : true;
});

const rootBlock = (css.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0];
const cssOutsideRoot = css.replace(rootBlock, '');

check('no colour literal outside :root', () => {
  const hex = cssOutsideRoot.match(/#[0-9a-f]{3,8}\b/gi) || [];
  const rgba = cssOutsideRoot.match(/rgba?\(/gi) || [];
  if (hex.length) return 'raw hex outside :root: ' + hex.slice(0, 5).join(', ');
  if (rgba.length) return rgba.length + ' raw rgb/rgba outside :root';
  return true;
});

/* ------------------------------------------------- 5. shell / navigation */

const NAV_LABELS = ['היום', 'יומן', 'הוספה', 'משימות', 'לקוחות'];

check('bottom bar carries all 5 navigation items', () => {
  const bar = (html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/) || [''])[0];
  if (!bar) return 'no .tabbar';
  const missing = NAV_LABELS.filter(l => bar.indexOf(l) === -1);
  if (missing.length) return 'missing labels: ' + missing.join(', ');
  const items = (bar.match(/class="tab[ "]/g) || []).length;
  return items === 5 ? true : 'expected 5 tabs, found ' + items;
});

check('desktop rail mirrors the same 5 items', () => {
  const rail = (html.match(/<aside class="rail"[\s\S]*?<\/aside>/) || [''])[0];
  if (!rail) return 'no .rail';
  const missing = NAV_LABELS.filter(l => rail.indexOf(l) === -1);
  if (missing.length) return 'missing labels: ' + missing.join(', ');
  const items = (rail.match(/class="rail-item/g) || []).length;
  return items === 5 ? true : 'expected 5 rail items, found ' + items;
});

check('rail is desktop-only and tabbar is mobile-only', () => {
  if (!/\.rail\s*\{\s*display:\s*none/.test(css)) return 'rail is not hidden by default';
  const dt = (css.match(/@media\s*\(min-width:\s*900px\)\s*\{[\s\S]*$/) || [''])[0];
  if (dt.indexOf('.tabbar{ display:none; }') === -1 && !/\.tabbar\s*\{\s*display:\s*none/.test(dt)) {
    return 'tabbar is not hidden on desktop';
  }
  if (!/\.rail\s*\{\s*display:\s*flex/.test(dt)) return 'rail is not shown on desktop';
  return true;
});

/* --------------------------------------------- 6. touch / input standard */

check('44px tap floor is enforced', () => {
  if (!/--tap:\s*44px/.test(css)) return 'no --tap: 44px token';
  if (!/button[^{]*\{[^}]*min-height:\s*var\(--tap\)/.test(css)) return 'buttons do not inherit the tap floor';
  return true;
});

check('inputs are locked to 16px (iOS auto-zoom guard)', () => {
  const block = (css.match(/\.input,\s*\.textarea,\s*\.select\s*\{[\s\S]*?\}/) || [''])[0];
  if (!block) return 'no shared input rule';
  if (!/font-size:\s*16px/.test(block)) return 'input font-size is not 16px';
  const small = block.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || [];
  const tooSmall = small.filter(s => parseFloat(s.replace(/\D+/g, '')) < 16);
  return tooSmall.length ? 'sub-16px font on an input' : true;
});

check('zero horizontal scroll is guaranteed', () => {
  if (!/html,\s*body\s*\{[\s\S]*?overflow-x:\s*hidden/.test(css)) return 'no overflow-x:hidden on root';
  if (!/\.main\s*\{[\s\S]*?min-width:\s*0/.test(css)) return 'flex child can overflow (min-width:0 missing)';
  return true;
});

check('bottom bar respects the safe area inset', () =>
  must(css, 'env(safe-area-inset-bottom', 'safe-area inset handling'));

/* ------------------------------------------- 7. dual-category engine (§0.2) */

check('category vocabulary is exactly personal|business', () => {
  if (!/var CATS = \['personal', 'business'\]/.test(js)) return 'CATS vocabulary changed';
  if (!/CAT_LABEL = \{ personal: 'אישי', business: 'עסקי' \}/.test(js)) return 'category labels changed';
  return true;
});

check('every writer supplies a category', () => {
  const adds = js.match(/Store\.add\('(\w+)',\s*\{[\s\S]*?\}\);/g) || [];
  if (adds.length < 5) return 'expected 5 Store.add call sites, found ' + adds.length;
  const bad = adds.filter(a => a.indexOf('category:') === -1);
  return bad.length ? bad.length + ' Store.add call(s) without category' : true;
});

check('load path normalises category defensively', () => {
  if (!/function normCat/.test(js)) return 'no normCat()';
  if (!/r\.category = normCat\(r\.category\)/.test(js)) return 'load() does not normalise category';
  return true;
});

check('global category filter is three-way and persisted', () => {
  ['data-filter="all"', 'data-filter="personal"', 'data-filter="business"'].forEach(d => {
    if (html.indexOf(d) === -1) throw new Error('missing ' + d);
  });
  if (!/prefs\.filter = f;\s*\n\s*Store\.save\(\);/.test(js)) return 'filter selection is not persisted';
  if (!/function inFilter/.test(js)) return 'no inFilter() gate';
  return true;
});

check('every collection read passes through the filter gate', () => {
  const reads = js.match(/pick\('(\w+)'\)/g) || [];
  const collections = new Set(reads.map(r => r.match(/'(\w+)'/)[1]));
  const expected = ['events', 'tasks', 'lists', 'notes', 'clients'];
  const missing = expected.filter(c => !collections.has(c));
  return missing.length ? 'unfiltered collections: ' + missing.join(', ') : true;
});

/* ------------------------------------------------ 8. My Day composition */

check('smart summary banner is wired', () => {
  if (html.indexOf('id="summaryGreeting"') === -1) return 'no greeting node';
  if (html.indexOf('id="summaryLine"') === -1) return 'no summary line node';
  if (!/יש לך היום /.test(js)) return 'greeting copy missing';
  if (!/plural\(meetings/.test(js) || !/plural\(tasks/.test(js) || !/plural\(follow/.test(js)) {
    return 'X/Y/Z counters are not all rendered';
  }
  return true;
});

check('timeline spans 08:00 → 22:00', () => {
  if (!/var DAY_START = 8;/.test(js)) return 'DAY_START is not 8';
  if (!/var DAY_END = 22;/.test(js)) return 'DAY_END is not 22';
  if (!/for \(var h = DAY_START; h <= DAY_END; h\+\+\)/.test(js)) return 'hour grid is not inclusive';
  return true;
});

check('unscheduled "לביצוע היום" container exists', () => {
  if (html.indexOf('id="todoToday"') === -1) return 'no todo container';
  if (html.indexOf('לביצוע היום') === -1) return 'section title missing';
  if (!/function unscheduledToday/.test(js)) return 'no unscheduledToday() selector';
  return true;
});

check('attention cards cover overdue tasks and pending follow-ups', () => {
  if (!/function overdueTasks/.test(js)) return 'no overdueTasks()';
  if (!/function pendingFollowUps/.test(js)) return 'no pendingFollowUps()';
  if (js.indexOf('משימות באיחור') === -1) return 'overdue card label missing';
  if (js.indexOf('מעקבי לקוחות') === -1) return 'follow-up card label missing';
  return true;
});

check('Master Add opens a 5-type bottom sheet', () => {
  if (html.indexOf('id="fab"') === -1) return 'no floating CTA';
  if (html.indexOf('הוספה חדשה') === -1) return 'CTA copy missing';
  const types = ['event', 'task', 'list', 'note', 'client'];
  const missing = types.filter(t => html.indexOf('data-type="' + t + '"') === -1);
  if (missing.length) return 'sheet missing types: ' + missing.join(', ');
  const labels = ['אירוע / פגישה', 'משימה', 'רשימה', 'פתק', 'לקוח חדש'];
  const missingLabels = labels.filter(l => html.indexOf(l) === -1);
  return missingLabels.length ? 'missing labels: ' + missingLabels.join(', ') : true;
});

check('every type has a form builder and a save branch', () => {
  ['event', 'task', 'list', 'note', 'client'].forEach(t => {
    if (!new RegExp('FIELDS[\\s\\S]*?\\b' + t + ':\\s*function').test(js)) throw new Error('no FIELDS.' + t);
    if (js.indexOf("type === '" + t + "'") === -1) throw new Error('no save branch for ' + t);
  });
  return true;
});

/* ------------------------------------------- 9. persistence engine (§0.4) */

check('localStorage engine is versioned and crash-safe', () => {
  if (!/STORE_KEY = 'benja\.productivity\.v1'/.test(js)) return 'store key changed';
  if (!/localStorage\.getItem/.test(js) || !/localStorage\.setItem/.test(js)) return 'no localStorage IO';
  const load = (js.match(/load: function[\s\S]*?\n    \},/) || [''])[0];
  if (load.indexOf('try {') === -1 || load.indexOf('catch') === -1) return 'load() is not guarded';
  const save = (js.match(/save: function[\s\S]*?\n    \},/) || [''])[0];
  if (save.indexOf('catch') === -1) return 'save() is not guarded (quota / private mode)';
  return true;
});

check('records are D1-migration shaped (id / ownerId / timestamps)', () => {
  const stamp = (js.match(/stamp: function[\s\S]*?\n    \},/) || [''])[0];
  ['rec.id', 'rec.ownerId', 'rec.createdAt', 'rec.updatedAt', 'rec.category'].forEach(k => {
    if (stamp.indexOf(k) === -1) throw new Error('stamp() does not set ' + k);
  });
  return true;
});

check('no credential check runs in client JS (§0.4)', () => {
  if (/password|passwd|token\s*===|apiKey/i.test(js)) return 'client-side credential logic detected';
  return true;
});

check('calendar dates are computed in local time — UTC only crosses the wire', () => {
  // scan code only — a comment mentioning the anti-pattern is not the anti-pattern
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  if (!/function isoDate/.test(js)) return 'no isoDate() helper';

  // Sprint 5 gives toISOString() exactly one legal home: toISOStamp(), which
  // builds the ISO-8601 UTC instant the sync wire format mandates for
  // updated_at. Anywhere else it would leak UTC into a calendar date.
  const sanctioned = (code.match(/function toISOStamp\s*\([\s\S]*?\n  \}/) || [''])[0];
  if (sanctioned.indexOf('.toISOString(') === -1) return 'toISOStamp() no longer emits an ISO instant';
  const leaks = code.replace(sanctioned, '').match(/\.toISOString\s*\(/g) || [];
  return leaks.length ? leaks.length + ' toISOString() call(s) outside toISOStamp()' : true;
});

/* ----------------------------------------- 10. DOM wiring cross-reference */

check('every element id referenced by app.js exists in index.html', () => {
  const refs = new Set();
  const re = /\$\('#([A-Za-z0-9_-]+)'\)/g;
  let m;
  while ((m = re.exec(js)) !== null) refs.add(m[1]);
  const missing = Array.from(refs).filter(id => html.indexOf('id="' + id + '"') === -1);
  return missing.length ? 'dangling ids: ' + missing.join(', ') : true;
});

check('user input is escaped before injection', () => {
  if (!/function esc\(/.test(js)) return 'no esc() helper';
  const risky = ['esc(e.title)', 'esc(t.title)', 'esc(c.name)', 'esc(l.title)'];
  const missing = risky.filter(r => js.indexOf(r) === -1);
  return missing.length ? 'unescaped render path: ' + missing.join(', ') : true;
});

check('reduced-motion preference is respected', () =>
  must(css, '@media (prefers-reduced-motion:reduce)', 'prefers-reduced-motion block'));

/* ------------------------------------------- 11. specification injection */

check('PROJECT_PLAN carries the injected core specification', () => {
  const required = [
    'Unified Personal & Business Productivity Center',
    'Dual-Category Engine',
    'Global Category Filter',
    'Auth Model (V1)',
    'Luxury Dark & Champagne Minimalist',
    'Ben Perez',
    'localStorage'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

check('PROJECT_PLAN documents all seven pillars', () => {
  const pillars = ['Calendar', 'Tasks', 'Lists', 'Notes', 'Clients', 'Next Actions', 'Reminders'];
  const missing = pillars.filter(p => plan.indexOf(p) === -1);
  return missing.length ? 'missing pillars: ' + missing.join(', ') : true;
});

/* ---------------------------------------------- 12. PWA: install shell */

const manifestRaw = read('manifest.json');
const sw = read('sw.js');

/** real PNG dimensions straight out of the IHDR chunk */
function pngSize(file) {
  const buf = fs.readFileSync(at(file));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error(file + ' is not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

check('manifest.json is valid JSON with the mandated identity', () => {
  const m = JSON.parse(manifestRaw);
  const want = {
    name: 'מה הלו"ז — Benja',
    short_name: 'מה הלו"ז',
    start_url: './index.html',
    display: 'standalone',
    background_color: '#12161f',
    theme_color: '#e4c278'
  };
  const bad = Object.keys(want).filter(k => m[k] !== want[k]);
  if (bad.length) return bad.map(k => k + '=' + JSON.stringify(m[k])).join('; ');
  if (m.dir !== 'rtl' || m.lang !== 'he') return 'manifest is not declared RTL Hebrew';
  return true;
});

check('manifest ships 192 / 512 / maskable icons that really exist', () => {
  const icons = JSON.parse(manifestRaw).icons || [];
  const bySize = {};
  icons.forEach(i => { bySize[i.sizes + '|' + (i.purpose || 'any')] = i.src; });

  ['192x192|any', '512x512|any', '512x512|maskable'].forEach(k => {
    if (!bySize[k]) throw new Error('manifest has no ' + k + ' icon');
  });

  icons.forEach(i => {
    if (!fs.existsSync(at(i.src))) throw new Error('missing file ' + i.src);
    const dim = pngSize(i.src);
    const want = parseInt(i.sizes.split('x')[0], 10);
    if (dim.w !== want || dim.h !== want) {
      throw new Error(i.src + ' is ' + dim.w + 'x' + dim.h + ', declared ' + i.sizes);
    }
    if (dim.bytes < 200) throw new Error(i.src + ' is a stub, not an icon');
  });
  return true;
});

check('index.html links the manifest and the install/apple tags', () => {
  if (!/<link[^>]+rel="manifest"[^>]+href="manifest\.json"/.test(html)) return 'manifest not linked';
  const tags = [
    'name="mobile-web-app-capable"',
    'name="apple-mobile-web-app-capable"',
    'name="apple-mobile-web-app-status-bar-style"',
    'name="apple-mobile-web-app-title"',
    'rel="apple-touch-icon"'
  ];
  const missing = tags.filter(t => html.indexOf(t) === -1);
  return missing.length ? 'missing head tags: ' + missing.join(', ') : true;
});

/* ---------------------------------------------- 13. PWA: service worker */

check('sw.js parses (no syntax errors)', () => {
  new vm.Script(sw, { filename: 'sw.js' });
  return true;
});

check('sw.js pre-caches the whole core shell with relative URLs', () => {
  ['./index.html', './styles.css', './app.js', './manifest.json'].forEach(a => {
    if (sw.indexOf("'" + a + "'") === -1) throw new Error('core asset not cached: ' + a);
  });
  if (/'\/index\.html'|"\/index\.html"/.test(sw)) return 'absolute path breaks GitHub Pages sub-paths';
  if (!/caches\.open\(/.test(sw)) return 'no cache is ever opened';
  return true;
});

check('sw.js implements install / activate / fetch and evicts stale caches', () => {
  ['install', 'activate', 'fetch'].forEach(ev => {
    if (sw.indexOf("addEventListener('" + ev + "'") === -1) throw new Error('no ' + ev + ' listener');
  });
  if (!/caches\.keys\(\)/.test(sw)) return 'old cache versions are never evicted';
  if (!/skipWaiting|clients\.claim/.test(sw)) return 'update takes two reloads (no skipWaiting/claim)';
  return true;
});

check('sw.js answers push events via self.registration.showNotification', () => {
  if (sw.indexOf("addEventListener('push'") === -1) return 'no push listener';
  if (sw.indexOf('self.registration.showNotification(') === -1) return 'push does not raise a notification';
  if (sw.indexOf("addEventListener('notificationclick'") === -1) return 'tapping the notification does nothing';
  return true;
});

check('sw.js never caches cross-origin or non-GET traffic', () => {
  if (!/req\.method !== 'GET'/.test(sw)) return 'non-GET requests are not excluded';
  if (!/url\.origin !== self\.location\.origin/.test(sw)) return 'cross-origin responses are cached';
  return true;
});

/* ------------------------------------------ 14. PWA: notifications engine */

check('app.js registers the service worker (and skips file://)', () => {
  if (!/navigator\.serviceWorker\.register\('sw\.js'\)/.test(js)) return 'sw.js is never registered';
  if (js.indexOf("protocol === 'file:'") === -1) return 'no file:// guard — register() would throw locally';
  return true;
});

check('permission toggle is present, mandated copy, and wired', () => {
  if (html.indexOf('id="pushBtn"') === -1) return 'no toggle button';
  if (html.indexOf('🔔') === -1) return 'bell affordance missing';
  if (html.indexOf('הפעל התראות פוש') === -1) return 'mandated CTA copy missing';
  if (!/Notification\.requestPermission/.test(js)) return 'permission is never requested';
  if (!/\$\('#pushBtn'\)/.test(js)) return 'toggle is not bound in app.js';
  return true;
});

check('reminders fire through the service worker with a legacy fallback', () => {
  if (!/reg\.showNotification\(/.test(js)) return 'no registration.showNotification() path';
  if (!/new window\.Notification\(/.test(js)) return 'no desktop fallback';
  if (!/setInterval\(/.test(js)) return 'nothing schedules the reminder scan';
  if (js.indexOf('visibilitychange') === -1) return 'a woken phone never catches up on missed scans';
  return true;
});

check('reminder scan ignores the category filter (business must not be muted)', () => {
  const due = (js.match(/due: function[\s\S]*?\n    \},/) || [''])[0];
  if (!due) return 'no Notify.due() selector';
  if (/pick\('events'\)|pick\('tasks'\)/.test(due)) return 'reminders are gated by the view filter';
  if (due.indexOf('Store.data.events') === -1 || due.indexOf('Store.data.tasks') === -1) {
    return 'reminders do not scan events and tasks';
  }
  return true;
});

check('notification state is persisted and never double-fires', () => {
  if (!/prefs\.notify/.test(js)) return 'toggle state is not persisted';
  if (!/prefs\.fired/.test(js)) return 'no fired-ledger — a reminder would repeat every scan';
  // Sprint 10 added the chime vote to the same block and Sprint 11 the
  // server-link stamp, so the fallback shape keeps growing keys — the point of
  // the check is that a legacy store gets one, not what it currently holds
  if (!/d\.prefs\.notify = \{ on: false, lead: 10, sound: true[^}]*\}/.test(js)) {
    return 'legacy stores are not migrated';
  }
  if (!/notify\.sound = d\.prefs\.notify\.sound !== false/.test(js)) {
    return 'the chime pref is not defaulted for a store written before it existed';
  }
  return true;
});

/* ============================ 15. calendar engine (Sprint 2) ============== */

/* ---- 15a. structure: four views, navigation, contextual creation ---- */

check('calendar exposes all four views as selectable tabs', () => {
  ['day', 'week', 'month', 'agenda'].forEach(v => {
    if (html.indexOf('data-calview="' + v + '"') === -1) throw new Error('no tab for ' + v);
  });
  const labels = ['יום', 'שבוע', 'חודש', 'סדר יום'];
  const missing = labels.filter(l => html.indexOf('>' + l + '<') === -1);
  if (missing.length) return 'missing tab labels: ' + missing.join(', ');
  if (!/CAL_VIEWS = \['day', 'week', 'month', 'agenda'\]/.test(js)) return 'CAL_VIEWS vocabulary changed';
  return true;
});

check('every calendar pane exists in the DOM and has a renderer', () => {
  ['calMonth', 'calWeek', 'calDay', 'calAgenda'].forEach(id => {
    if (html.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id + ' pane');
    if (js.indexOf("$('#" + id + "')") === -1) throw new Error('#' + id + ' is never painted');
  });
  ['renderMonth', 'renderWeek', 'renderDay', 'renderAgenda'].forEach(fn => {
    if (js.indexOf(fn + ':') === -1) throw new Error('no Cal.' + fn + '()');
  });
  return true;
});

check('navigation engine: prev / next / today / swipe', () => {
  ['prev', 'next', 'today'].forEach(n => {
    if (html.indexOf('data-calnav="' + n + '"') === -1) throw new Error('no ' + n + ' control');
  });
  if (html.indexOf('>היום</button>') === -1) return 'quick-jump "היום" copy missing';
  if (js.indexOf("'touchstart'") === -1 || js.indexOf("'touchend'") === -1) return 'no swipe navigation';
  if (!/touch-action:\s*pan-y/.test(css)) return 'swipe fights native vertical scrolling';
  if (!/step: function \(dir\)/.test(js)) return 'no period stepper';
  return true;
});

check('tapping a day cell or time slot pre-fills Master Add', () => {
  if (!/data-calslot="/.test(js)) return 'cells carry no slot payload';
  if (js.indexOf('[data-calslot]') === -1) return 'slot taps are not delegated';
  if (!/function applyPrefill/.test(js)) return 'no prefill applier';
  if (js.indexOf('openTypeSheet({ date: slot[0], start: slot[1]') === -1) {
    return 'a tapped slot does not open Master Add with its date/time';
  }
  return true;
});

check('category dots carry both category colours from tokens', () => {
  if (!/\.dot-business\{\s*background:var\(--business\)/.test(css)) return 'no business dot colour';
  if (!/\.dot-personal\{\s*background:var\(--personal\)/.test(css)) return 'no personal dot colour';
  if (js.indexOf("'<span class=\"dot dot-' + r.category") === -1) return 'month cells render no category dots';
  if (!/legend: function/.test(js)) return 'dots are unlabelled (colour as sole carrier)';
  return true;
});

check('day view spans the full 24h and draws a current-time line', () => {
  if (!/for \(var h = 0; h < 24; h\+\+\)/.test(js)) return 'day grid is not 00:00–23:59';
  if (js.indexOf('dv-now') === -1) return 'no current-time indicator';
  if (js.indexOf("iso === todayISO()") === -1) return 'now-line is drawn on days that are not today';
  if (!/HOUR_PX = 56/.test(js) || !/--hour-h:\s*56px/.test(css)) return 'row height drifted between JS and CSS';
  return true;
});

check('calendar reads pass through the global category filter', () => {
  const eventsOn = (js.match(/function eventsOn[\s\S]*?\n  \}/) || [''])[0];
  const tasksOn = (js.match(/function boardTasksOn[\s\S]*?\n  \}/) || [''])[0];
  if (eventsOn.indexOf("pick('events')") === -1) return 'eventsOn() bypasses the filter';
  if (tasksOn.indexOf("pick('tasks')") === -1) return 'boardTasksOn() bypasses the filter';
  return true;
});

check('selected calendar view persists to localStorage', () => {
  if (!/calView: 'month'/.test(js)) return 'no calView default in the blank store';
  if (!/CAL_VIEWS\.indexOf\(d\.prefs\.calView\) === -1/.test(js)) return 'calView is not normalised on load';
  if (!/prefs\.calView = v;\s*\n\s*Store\.save\(\);/.test(js)) return 'view choice is never saved';
  return true;
});

/* ---- 15b. date math, executed for real ---- */

/**
 * Run app.js in a bare sandbox — init() never fires, only window.APP is set.
 * `over.navigator` swaps in a device stub, which is how the Sprint 7 haptics
 * checks exercise a phone with a vibration motor and one without; `over.document`
 * swaps in a DOM stub, which is how the Sprint 9 checks drive markEntering()
 * against real nodes and watch which of them are granted the entrance.
 *
 * Sprint 13 adds `over.AudioContext` and `over.matchMedia` for the same
 * reason: the dual-sound engine and the theme switch both read them straight
 * off `window`, and the only honest way to prove a ten-second ringtone
 * schedules ten seconds of oscillators is to hand it one and count.
 */
function loadApp(over) {
  const noop = () => {};
  const sandbox = {
    console, Math, JSON, Date, Promise, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    navigator: (over && over.navigator) || {},
    location: { protocol: 'file:' },
    document: Object.assign({
      readyState: 'loading',                 // keeps init() parked on DOMContentLoaded
      addEventListener: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { style: {} }
    }, (over && over.document) || {})
  };
  if (over && over.AudioContext) sandbox.AudioContext = over.AudioContext;
  if (over && over.matchMedia) sandbox.matchMedia = over.matchMedia;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: 'app.js' });
  return sandbox.APP;
}

let D = null;

check('app.js exports its date engine without touching the DOM', () => {
  const APP = loadApp();
  if (!APP) return 'window.APP was never set';
  if (!APP.Cal) return 'no APP.Cal';
  D = APP.dates;
  if (!D) return 'no APP.dates export';
  ['addMonthsISO', 'startOfWeekISO', 'weekDays', 'monthMatrix',
    'agendaRange', 'minutesOf', 'shiftTime', 'layoutBlocks'].forEach(k => {
      if (typeof D[k] !== 'function') throw new Error('APP.dates.' + k + ' is missing');
    });
  return true;
});

check('date math: month stepping clamps into short months', () => {
  if (D.addMonthsISO('2026-01-31', 1) !== '2026-02-28') return 'Jan 31 +1m = ' + D.addMonthsISO('2026-01-31', 1);
  if (D.addMonthsISO('2024-01-31', 1) !== '2024-02-29') return 'leap February broken';
  if (D.addMonthsISO('2026-03-31', -1) !== '2026-02-28') return 'backward clamp broken';
  if (D.addMonthsISO('2026-12-15', 1) !== '2027-01-15') return 'forward year rollover broken';
  if (D.addMonthsISO('2026-01-15', -1) !== '2025-12-15') return 'backward year rollover broken';
  if (D.addMonthsISO('2026-07-27', 0) !== '2026-07-27') return 'zero step is not identity';
  return true;
});

check('date math: weeks run Sunday → Saturday (he-IL)', () => {
  if (D.startOfWeekISO('2026-07-27') !== '2026-07-26') return 'Monday resolves to the wrong week start';
  if (D.startOfWeekISO('2026-07-26') !== '2026-07-26') return 'a Sunday must be its own week start';
  if (D.startOfWeekISO('2026-08-01') !== '2026-07-26') return 'Saturday leaks into the next week';
  const w = D.weekDays('2026-07-29');
  if (w.length !== 7) return 'week has ' + w.length + ' days';
  if (w[0] !== '2026-07-26' || w[6] !== '2026-08-01') return 'week spans ' + w[0] + '→' + w[6];
  return true;
});

check('date math: month matrix is whole weeks with no phantom row', () => {
  const jul = D.monthMatrix('2026-07-15');
  if (jul.length % 7 !== 0) return 'not whole weeks: ' + jul.length;
  if (jul.indexOf('2026-07-01') === -1 || jul.indexOf('2026-07-31') === -1) return 'month days missing';
  if (D.startOfWeekISO(jul[0]) !== jul[0]) return 'grid does not start on a week boundary';
  // February 2026 starts on a Sunday and has 28 days => exactly 4 rows, no filler week
  const feb = D.monthMatrix('2026-02-10');
  if (feb.length !== 28) return 'Feb 2026 grid is ' + feb.length + ' cells, expected 28';
  if (feb[0] !== '2026-02-01' || feb[27] !== '2026-02-28') return 'Feb grid spans ' + feb[0] + '→' + feb[27];
  // a month starting mid-week still covers its last day
  const may = D.monthMatrix('2026-05-01');
  if (may.indexOf('2026-05-31') === -1) return 'last day of May fell outside the grid';
  return true;
});

check('date math: day stepping crosses months and years', () => {
  if (D.addDaysISO('2026-07-31', 1) !== '2026-08-01') return 'month rollover broken';
  if (D.addDaysISO('2026-01-01', -1) !== '2025-12-31') return 'year rollover broken';
  if (D.addDaysISO('2024-02-28', 1) !== '2024-02-29') return 'leap day skipped';
  const r = D.agendaRange('2026-07-27', 30);
  if (r.from !== '2026-07-27' || r.to !== '2026-08-25') return 'agenda window is ' + r.from + '→' + r.to;
  return true;
});

check('time math: minutes parse safely and shift correctly', () => {
  if (D.minutesOf('09:30') !== 570) return '09:30 => ' + D.minutesOf('09:30');
  if (D.minutesOf('00:00') !== 0) return 'midnight is not 0';
  if (D.minutesOf('23:59') !== 1439) return 'end of day is wrong';
  if (D.minutesOf('') !== null || D.minutesOf('לא') !== null || D.minutesOf(undefined) !== null) {
    return 'garbage time is not rejected';
  }
  if (D.shiftTime('09:00', 60) !== '10:00') return '+1h broken';
  if (D.shiftTime('23:30', 60) !== '00:30') return 'midnight wrap broken';
  if (D.shiftTime('', 60) !== '') return 'shifting a missing time must stay empty';
  return true;
});

check('day view: overlapping events share lanes instead of hiding', () => {
  const out = D.layoutBlocks([
    { s: 540, e: 600 },   // 09:00–10:00
    { s: 570, e: 630 },   // 09:30–10:30  overlaps the first
    { s: 720, e: 780 }    // 12:00–13:00  separate cluster
  ]);
  if (out.length !== 3) return 'lost a block: ' + out.length;
  const overlap = out.filter(b => b.s < 700);
  if (overlap.some(b => b.lanes !== 2)) return 'overlapping pair is not split into 2 lanes';
  if (overlap[0].lane === overlap[1].lane) return 'overlapping events share a lane';
  const alone = out.filter(b => b.s === 720)[0];
  if (alone.lanes !== 1 || alone.lane !== 0) return 'a lone event was needlessly narrowed';
  // back-to-back is not an overlap
  const touching = D.layoutBlocks([{ s: 540, e: 600 }, { s: 600, e: 660 }]);
  if (touching.some(b => b.lanes !== 1)) return 'touching events were treated as overlapping';
  return true;
});

/* ====== 16. tasks engine / smart lists / quick notes (Sprint 3) ========== */

/* ---- 16a. structure ---- */

check('tasks view exposes the four mandated quick sub-tabs', () => {
  const view = (html.match(/<section class="view" id="view-tasks"[\s\S]*?<\/section>/) || [''])[0];
  if (!view) return 'no #view-tasks section';
  ['today', 'late', 'waiting', 'done'].forEach(t => {
    if (view.indexOf('data-tasktab="' + t + '"') === -1) throw new Error('no sub-tab for ' + t);
  });
  ['היום', 'באיחור', 'ממתין', 'הושלם'].forEach(l => {
    if (view.indexOf('>' + l + ' <') === -1) throw new Error('missing sub-tab label ' + l);
  });
  if (view.indexOf('role="tablist"') === -1) return 'sub-tabs are not exposed as a tablist';
  // Sprint 10 appended בקרוב and נכנסים; the original four are still here, in
  // the order they were mandated in, and 'all' still leads the vocabulary
  if (!/TASK_TABS = \['all', 'today', 'upcoming', 'inbox', 'late', 'waiting', 'done'\]/.test(js)) {
    return 'TASK_TABS vocabulary changed';
  }
  return true;
});

check('tasks / lists / notes each own a container and a renderer', () => {
  ['tasksList', 'tasksMeta', 'listsList', 'listsMeta', 'notesList', 'notesMeta'].forEach(id => {
    if (html.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id);
    if (js.indexOf("$('#" + id + "')") === -1) throw new Error('#' + id + ' is never painted');
  });
  ['function renderTasks', 'function renderLists', 'function renderNotes'].forEach(fn => {
    if (js.indexOf(fn) === -1) throw new Error('no ' + fn + '()');
  });
  return true;
});

check('the six task statuses ship with their Hebrew labels', () => {
  if (!/TASK_STATUSES = \['new', 'todo', 'progress', 'waiting', 'done', 'cancelled'\]/.test(js)) {
    return 'status vocabulary changed';
  }
  ['חדש', 'לביצוע', 'בתהליך', 'ממתין ללקוח', 'הושלם', 'בוטל'].forEach(l => {
    if (js.indexOf("'" + l + "'") === -1) throw new Error('missing status label ' + l);
  });
  ['גבוהה', 'בינונית', 'נמוכה'].forEach(l => {
    if (js.indexOf("'" + l + "'") === -1) throw new Error('missing priority label ' + l);
  });
  return true;
});

check('"ממתין ללקוח" carries a visually distinct badge', () => {
  if (!/\.st-waiting\{[\s\S]*?background:var\(--waiting-soft\)/.test(css)) return 'no dedicated waiting badge rule';
  if (!/--waiting:\s*#[0-9a-f]{3,8}/i.test(css)) return 'no --waiting token';
  if (!/\.st-waiting\{[\s\S]*?border-color:var\(--waiting-edge\)/.test(css)) return 'waiting badge has no distinct border';
  if (!/\.row\.is-waiting\{/.test(css)) return 'the waiting row itself is not marked';
  if (js.indexOf("status === 'waiting' ? ' is-waiting' : ''") === -1) return 'is-waiting is never applied';
  return true;
});

check('one-tap completion and one-tap status toggle are both wired', () => {
  if (js.indexOf('data-toggle="') === -1) return 'no check-off control';
  if (js.indexOf('data-cycle="') === -1) return 'no status toggle control';
  if (js.indexOf('[data-cycle]') === -1) return 'status toggle is not delegated';
  if (!/function toggleTaskDone/.test(js)) return 'no toggleTaskDone()';
  if (!/function nextStatus/.test(js)) return 'no nextStatus()';
  return true;
});

check('task form collects status, priority, next action and sub-tasks', () => {
  const form = (js.match(/task: function \(\)[\s\S]*?\n    \},/) || [''])[0];
  if (!form) return 'no FIELDS.task builder';
  ["picker('status'", "picker('priority'", 'name="nextAction"', 'name="subtasks"'].forEach(n => {
    if (form.indexOf(n) === -1) throw new Error('the form does not collect ' + n);
  });
  if (form.indexOf('הפעולה הבאה') === -1) return 'next-action label missing';
  const save = (js.match(/Store\.add\('tasks',\s*\{[\s\S]*?\}\);/) || [''])[0];
  ['status:', 'priority:', 'nextAction:', 'subtasks:'].forEach(k => {
    if (save.indexOf(k) === -1) throw new Error('the save branch drops ' + k);
  });
  return true;
});

check('smart lists render a real progress bar with a count', () => {
  if (!/function progressBar/.test(js)) return 'no progressBar()';
  if (js.indexOf(" הושלמו'") === -1) return 'the "N/M הושלמו" counter copy is missing';
  if (js.indexOf('prog-fill') === -1 || !/\.prog-fill\{/.test(css)) return 'no rendered fill element';
  if (js.indexOf("inline-size:' + p.pct + '%") === -1) return 'the bar is not driven by the real percentage';
  if (js.indexOf("checklist(p, l.items, 'listitem', l.id)") === -1) return 'list items render no checklist';
  if (js.indexOf('[data-listitem]') === -1) return 'list item taps are not delegated';
  if (js.indexOf("checklist(prog, t.subtasks, 'subtask', t.id)") === -1) return 'sub-tasks render no checklist';
  return true;
});

check('lists support both timeless and date-bound forms', () => {
  const save = (js.match(/Store\.add\('lists',\s*\{[\s\S]*?\}\);/) || [''])[0];
  if (save.indexOf('date:') === -1) return 'the list save branch drops the date';
  if (js.indexOf('ללא תאריך') === -1) return 'no timeless affordance in the UI';
  if (!/l\.date = typeof l\.date === 'string' \? l\.date : ''/.test(js)) return 'list date is not normalised on load';
  return true;
});

check('notes support pin-to-top and conversion into a task or an event', () => {
  if (js.indexOf('הצמד למעלה') === -1) return 'mandated pin copy missing';
  if (js.indexOf('data-pin="') === -1 || js.indexOf('[data-pin]') === -1) return 'pin toggle is not wired';
  if (js.indexOf('data-convert="task:') === -1) return 'no note→task action';
  if (js.indexOf('data-convert="event:') === -1) return 'no note→event action';
  if (!/function noteToTask/.test(js) || !/function noteToEvent/.test(js)) return 'no conversion mappers';
  if (js.indexOf("Store.add('tasks', noteToTask(src))") === -1) return 'conversion never writes a task';
  return true;
});

check('every Sprint 3 write path goes through localStorage', () => {
  ['data-cycle', 'data-subtask', 'data-listitem', 'data-pin', 'data-convert'].forEach(k => {
    const branch = (js.match(new RegExp('el\\.dataset\\.' + k.replace('data-', '') + '\\)\\s*\\{[\\s\\S]*?\\n      return;')) || [''])[0];
    if (!branch) throw new Error('no delegated branch for ' + k);
    if (branch.indexOf('Store.save()') === -1 && branch.indexOf('Store.add(') === -1) {
      throw new Error(k + ' mutates memory without persisting');
    }
    // Sprint 7 replaced the blanket render() on these paths with a targeted
    // patch; either one is a repaint, a branch with neither is a stale view
    if (branch.indexOf('render()') === -1 && branch.indexOf('Patch.apply(') === -1) {
      throw new Error(k + ' does not repaint');
    }
  });
  return true;
});

/* ---- 16b. the engine, executed for real ---- */

let T = null, L = null, N = null;

check('app.js exports the tasks / lists / notes engine', () => {
  const APP = loadApp();
  T = APP.tasks; L = APP.lists; N = APP.notes;
  if (!T || !L || !N) return 'APP.tasks / APP.lists / APP.notes are not all exported';
  ['normStatus', 'nextStatus', 'setTaskStatus', 'toggleTaskDone', 'migrateTask',
    'subtaskProgress', 'taskMatchesTab', 'sortTasks', 'isClosed'].forEach(k => {
      if (typeof T[k] !== 'function') throw new Error('APP.tasks.' + k + ' is missing');
    });
  ['migrateList', 'listProgress', 'progressOf', 'toggleItem', 'parseChecklist'].forEach(k => {
    if (typeof L[k] !== 'function') throw new Error('APP.lists.' + k + ' is missing');
  });
  ['migrateNote', 'sortNotes', 'noteToTask', 'noteToEvent'].forEach(k => {
    if (typeof N[k] !== 'function') throw new Error('APP.notes.' + k + ' is missing');
  });
  return true;
});

check('status transitions: the working loop cycles and closed statuses re-enter', () => {
  if (T.nextStatus('new') !== 'todo') return 'חדש → לביצוע broken';
  if (T.nextStatus('todo') !== 'progress') return 'לביצוע → בתהליך broken';
  if (T.nextStatus('progress') !== 'waiting') return 'בתהליך → ממתין ללקוח broken';
  if (T.nextStatus('waiting') !== 'new') return 'the loop does not close';
  if (T.nextStatus('done') !== 'todo') return 'a completed task must re-enter at לביצוע';
  if (T.nextStatus('cancelled') !== 'todo') return 'a cancelled task must re-enter at לביצוע';
  if (T.nextStatus('גיבריש') !== 'todo') return 'an unknown status is not recovered';
  return true;
});

check('status transitions: status and the legacy done flag never drift apart', () => {
  const t = T.migrateTask({ title: 'x' });
  if (t.status !== 'new' || t.done !== false) return 'a fresh task is not (חדש, open)';

  T.setTaskStatus(t, 'waiting');
  if (t.done !== false) return 'ממתין ללקוח must not read as done';
  if (!T.isClosed('done') || !T.isClosed('cancelled')) return 'closed statuses are wrong';
  if (T.isClosed('waiting')) return 'ממתין ללקוח must stay open';

  T.setTaskStatus(t, 'done');
  if (t.done !== true) return 'done flag not raised with the status';

  T.toggleTaskDone(t);                          // un-check
  if (t.status !== 'waiting') return 'un-checking did not restore the previous status, got ' + t.status;
  if (t.done !== false) return 'done flag not lowered';

  T.toggleTaskDone(t);                          // one-tap completion
  if (t.status !== 'done' || t.done !== true) return 'one-tap completion broken';

  // a v1 record carries only `done` — the migration must invent the status
  const legacy = T.migrateTask({ title: 'old', done: true });
  if (legacy.status !== 'done') return 'a legacy completed task did not migrate to הושלם';
  const legacyOpen = T.migrateTask({ title: 'old', done: false });
  if (legacyOpen.status !== 'new') return 'a legacy open task did not migrate to חדש';
  if (T.migrateTask({ title: 'x', status: 'nonsense' }).status !== 'new') return 'garbage status not normalised';
  if (T.migrateTask({ title: 'x', priority: 'nonsense' }).priority !== 'medium') return 'garbage priority not normalised';
  return true;
});

check('sub-task arithmetic is exact, including the empty and full cases', () => {
  const empty = T.subtaskProgress(T.migrateTask({ title: 'x' }));
  if (empty.total !== 0 || empty.done !== 0 || empty.pct !== 0) return 'an empty checklist is not 0/0 · 0%';

  const t = T.migrateTask({
    title: 'x',
    subtasks: [{ title: 'a', done: true }, { title: 'b' }, { title: 'c', done: true }, 'd']
  });
  if (t.subtasks.length !== 4) return 'a plain string item was not adopted, got ' + t.subtasks.length;
  if (t.subtasks.some(s => !s.id)) return 'a sub-task shipped without an id';

  const p = T.subtaskProgress(t);
  if (p.done !== 2 || p.total !== 4) return 'count is ' + p.done + '/' + p.total + ', expected 2/4';
  if (p.pct !== 50) return '2 of 4 is ' + p.pct + '%';

  const full = T.subtaskProgress(T.migrateTask({ title: 'x', subtasks: [{ title: 'a', done: true }] }));
  if (full.pct !== 100) return 'a fully checked list is not 100%';

  const third = L.progressOf([{ done: true }, {}, {}]);
  if (third.pct !== 33) return '1 of 3 rounds to ' + third.pct + '%, expected 33';
  return true;
});

check('list progress state tracks real item toggles', () => {
  const l = L.migrateList({ title: 'קניות', items: ['חלב', 'לחם', { title: 'ביצים', done: true }] });
  if (l.items.length !== 3) return 'v1 string items were not migrated, got ' + l.items.length;
  if (l.date !== '') return 'a timeless list did not normalise to an empty date';

  let p = L.listProgress(l);
  if (p.done !== 1 || p.total !== 3) return 'initial progress is ' + p.done + '/' + p.total;

  p = L.toggleItem(l.items, l.items[0].id);
  if (p.done !== 2) return 'toggling an item did not advance progress';
  if (l.items[0].done !== true) return 'the toggle did not stick on the record';

  p = L.toggleItem(l.items, l.items[0].id);          // toggling back
  if (p.done !== 1) return 'a checklist item does not un-check';

  p = L.toggleItem(l.items, 'no-such-id');
  if (p.done !== 1) return 'an unknown id changed the progress';

  const dated = L.migrateList({ title: 'x', date: '2026-07-27', items: [] });
  if (dated.date !== '2026-07-27') return 'a date-bound list lost its date';
  if (L.listProgress(dated).pct !== 0) return 'an empty list is not 0%';

  const parsed = L.parseChecklist('חלב\n\n  לחם  \n', 'li');
  if (parsed.length !== 2) return 'blank lines were not dropped, got ' + parsed.length;
  if (parsed[1].title !== 'לחם') return 'checklist items are not trimmed';
  return true;
});

check('task sub-tabs select exactly the right rows', () => {
  const today = '2026-07-27';
  const rows = [
    T.migrateTask({ id: 'a', title: 'due today', status: 'todo', due: today }),
    T.migrateTask({ id: 'b', title: 'overdue', status: 'progress', due: '2026-07-20' }),
    T.migrateTask({ id: 'c', title: 'waiting + overdue', status: 'waiting', due: '2026-07-01' }),
    T.migrateTask({ id: 'd', title: 'finished', status: 'done', due: today }),
    T.migrateTask({ id: 'e', title: 'dropped', status: 'cancelled', due: '2026-07-01' }),
    T.migrateTask({ id: 'f', title: 'no due date', status: 'new', due: '' })
  ];
  const ids = tab => rows.filter(r => T.taskMatchesTab(r, tab, today)).map(r => r.id).join('');

  // Sprint 9 — a task ticked a moment ago is STILL due today and still belongs
  // to היום: it stays listed, struck through, until it is filed into היסטוריה.
  // 'd' is that task. This is the contract that keeps the row under the finger.
  if (ids('today') !== 'ad') return 'היום selected [' + ids('today') + '], expected [ad]';
  if (ids('late') !== 'bc') return 'באיחור selected [' + ids('late') + '], expected [bc]';
  if (ids('waiting') !== 'c') return 'ממתין selected [' + ids('waiting') + '], expected [c]';
  if (ids('done') !== 'd') return 'הושלם selected [' + ids('done') + '], expected [d]';
  if (ids('all') !== 'abcdef') return 'הכל dropped rows: [' + ids('all') + ']';
  // ...but a CANCELLED task really is off the board, in every dated tab
  if (ids('late').indexOf('e') !== -1) return 'a cancelled task leaked into באיחור';
  if (ids('today').indexOf('e') !== -1) return 'a cancelled task leaked into היום';
  return true;
});

check('a completed task holds its rank, and only a cancelled one sinks', () => {
  // Sprint 9 — 'done' used to sort to the bottom, which meant ticking a task
  // re-sorted the list under the finger that ticked it. It now keeps the exact
  // rank it had while open (same due date, same priority), and only a cancelled
  // task drops to the end.
  const order = T.sortTasks([
    { id: 'done', status: 'done', due: '2026-07-27', priority: 'high' },
    { id: 'low', status: 'todo', due: '2026-07-27', priority: 'low' },
    { id: 'high', status: 'todo', due: '2026-07-27', priority: 'high' },
    { id: 'dropped', status: 'cancelled', due: '2026-01-01', priority: 'high' },
    { id: 'soon', status: 'waiting', due: '2026-07-01', priority: 'low' }
  ]).map(t => t.id).join(',');
  // done and high share due+priority, so they are peers; cancelled is last
  if (order !== 'soon,done,high,low,dropped') return 'order is ' + order;

  // ...and ticking a task must not change where it sits, which is the whole point
  const open = [
    { id: 'x', status: 'todo', due: '2026-07-27', priority: 'medium' },
    { id: 'y', status: 'todo', due: '2026-07-27', priority: 'medium' },
    { id: 'z', status: 'todo', due: '2026-07-28', priority: 'high' }
  ];
  const before = T.sortTasks(open).map(t => t.id).join(',');
  open[1].status = 'done';
  const after = T.sortTasks(open).map(t => t.id).join(',');
  if (before !== after) return 'ticking a task re-sorted the list: ' + before + ' => ' + after;
  return true;
});

check('notes: pinned float to the top, newest first inside each band', () => {
  const order = N.sortNotes([
    { id: 'old', pinned: false, updatedAt: 1 },
    { id: 'pin-old', pinned: true, updatedAt: 2 },
    { id: 'new', pinned: false, updatedAt: 9 },
    { id: 'pin-new', pinned: true, updatedAt: 5 }
  ]).map(n => n.id).join(',');
  if (order !== 'pin-new,pin-old,new,old') return 'order is ' + order;
  if (N.migrateNote({ body: 'x' }).pinned !== false) return 'pinned is not normalised to a boolean';
  if (N.migrateNote({ pinned: 1 }).pinned !== true) return 'a truthy pin did not become true';
  return true;
});

check('note conversion preserves the text and the category', () => {
  const note = { title: 'רעיון', body: 'לצלם תהליך עבודה', category: 'business' };
  const task = N.noteToTask(note);
  if (task.type !== 'task') return 'conversion did not produce a task';
  if (task.title !== 'רעיון') return 'the task lost the note title';
  if (task.notes !== note.body) return 'the task lost the note body';
  if (task.category !== 'business') return 'the task lost the category';
  if (task.status !== 'todo') return 'a converted note should land as לביצוע';

  const ev = N.noteToEvent(note);
  if (ev.type !== 'event' || ev.category !== 'business') return 'the event conversion is wrong';
  if (!ev.date || !ev.start) return 'the converted event has no slot';

  const bodyOnly = N.noteToTask({ body: 'רק גוף', category: 'personal' });
  if (bodyOnly.title !== 'רק גוף') return 'a title-less note did not fall back to its body';
  return true;
});

/* ====== 18. client CRM · drawer · Next-Action engine (Sprint 4) ========== */

/* ---- 18a. structure ---- */

const CLIENT_STAGES = ['ליד חדש', 'נוצר קשר', 'מתעניין', 'נשלחה הצעה',
  'ממתין לתשובה', 'פגישה נקבעה', 'עסקה נסגרה', 'לא רלוונטי כרגע', 'לקוח עבר'];

check('the nine mandated client statuses ship with their Hebrew labels', () => {
  if (!/CLIENT_STATUSES = \['lead', 'contacted', 'interested', 'quoted',\s*\n?\s*'awaiting', 'meeting', 'won', 'irrelevant', 'past'\]/.test(js)) {
    return 'client status vocabulary changed';
  }
  const missing = CLIENT_STAGES.filter(l => js.indexOf(l) === -1);
  return missing.length ? 'missing status labels: ' + missing.join(', ') : true;
});

check('clients view exposes the five pipeline sub-tabs', () => {
  const view = (html.match(/<section class="view" id="view-clients"[\s\S]*?<\/section>/) || [''])[0];
  if (!view) return 'no #view-clients section';
  ['all', 'new', 'active', 'waiting', 'closed'].forEach(t => {
    if (view.indexOf('data-clientfilter="' + t + '"') === -1) throw new Error('no sub-tab for ' + t);
  });
  ['הכל', 'לידים חדשים', 'פעילים', 'ממתינים', 'סגורים'].forEach(l => {
    if (view.indexOf('>' + l + ' <') === -1) throw new Error('missing sub-tab label ' + l);
  });
  if (view.indexOf('role="tablist"') === -1) return 'sub-tabs are not exposed as a tablist';
  if (!/CLIENT_TABS = \['all', 'new', 'active', 'waiting', 'closed'\]/.test(js)) {
    return 'CLIENT_TABS vocabulary changed';
  }
  return true;
});

check('the client drawer ships all six mandated tabs', () => {
  const drawer = (html.match(/<aside class="drawer"[\s\S]*?<\/aside>/) || [''])[0];
  if (!drawer) return 'no client drawer in index.html';
  if (drawer.indexOf('role="dialog"') === -1 || drawer.indexOf('aria-modal="true"') === -1) {
    return 'the drawer is not an accessible modal dialog';
  }
  const tabs = ['overview', 'meetings', 'tasks', 'lists', 'notes', 'history'];
  tabs.forEach(t => {
    if (drawer.indexOf('data-clienttab="' + t + '"') === -1) throw new Error('no drawer tab ' + t);
  });
  ['סקירה', 'פגישות', 'משימות', 'רשימות', 'פתקים', 'היסטוריה'].forEach(l => {
    if (drawer.indexOf('>' + l + '<') === -1) throw new Error('missing drawer tab label ' + l);
  });
  ['drawerName', 'drawerSub', 'drawerActions', 'drawerBody'].forEach(id => {
    if (drawer.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id);
    if (js.indexOf("$('#" + id + "')") === -1) throw new Error('#' + id + ' is never painted');
  });
  return true;
});

check('every client card carries the two mandated quick actions', () => {
  if (!/function contactButtons/.test(js)) return 'no contactButtons()';
  if (js.indexOf('📞 התקשר') === -1) return 'no direct-call action';
  if (js.indexOf('💬 וואטסאפ') === -1) return 'no WhatsApp action';
  if (js.indexOf('wa.me/') === -1) return 'WhatsApp does not target wa.me';
  if (!/function clientCard/.test(js)) return 'no clientCard() renderer';
  if (js.indexOf('esc(c.name)') === -1) return 'the client name is rendered unescaped';
  return true;
});

check('the Next-Action alert badge reaches the dashboard attention cards', () => {
  if (!/NO_ACTION_BADGE = '⚠️ אין פעולה הבאה מוגדרת'/.test(js)) return 'alert badge copy changed';
  if (!/function clientNeedsAction/.test(js)) return 'no clientNeedsAction() engine';
  if (!/function clientsMissingAction/.test(js)) return 'no dashboard selector';
  const att = (js.match(/function renderAttention[\s\S]*?\n  \}/) || [''])[0];
  if (att.indexOf('clientsMissingAction()') === -1) return 'attention cards ignore the alert engine';
  if (att.indexOf('ללא פעולה הבאה') === -1) return 'no attention card label';
  return true;
});

check('client CRUD and the drawer persist through the store', () => {
  if (!/clientTab: 'all'/.test(js)) return 'no clientTab default in the blank store';
  if (!/CLIENT_TABS\.indexOf\(d\.prefs\.clientTab\) === -1/.test(js)) return 'clientTab is not normalised on load';
  if (!/prefs\.clientTab = tab;\s*\n\s*Store\.save\(\);/.test(js)) return 'the pipeline tab is never saved';
  if (!/d\.clients = d\.clients\.map\(migrateClient\)/.test(js)) return 'clients are not migrated on load';
  // every drawer mutation writes before it repaints
  ['data-clientstatus', 'data-nextaction', 'data-clientnote', 'data-clientnotedel', 'data-contact']
    .forEach(a => { if (js.indexOf(a) === -1) throw new Error('no handler wiring for ' + a); });
  const onChange = (js.match(/function onChange[\s\S]*?\n  \}/) || [''])[0];
  if (onChange.indexOf('Store.save()') === -1) return 'a status change never reaches localStorage';
  return true;
});

check('events / tasks / lists can be associated with a client', () => {
  if (!/function clientPicker/.test(js)) return 'no clientPicker()';
  const builders = ['event', 'task', 'list'];
  builders.forEach(t => {
    const block = (js.match(new RegExp('\\b' + t + ': function \\(\\) \\{[\\s\\S]*?\\n    \\},')) || [''])[0];
    if (block.indexOf('clientPicker()') === -1) throw new Error('the ' + t + ' form has no client select');
  });
  if (!/function clientLinks/.test(js)) return 'no clientLinks() resolver';
  return true;
});

/* ---- 18b. the CRM engine, executed for real ---- */

let C = null;

check('app.js exports the client CRM engine head-lessly', () => {
  const APP = loadApp();
  C = APP && APP.clients;
  if (!C) return 'no APP.clients export';
  ['normClientStatus', 'migrateClient', 'clientClosed', 'clientNeedsAction',
    'clientMatchesTab', 'sortClients', 'setClientStatus', 'setClientNextAction',
    'addClientNote', 'markContact', 'logHistory', 'telHref', 'waHref', 'waNumber',
    'clientCard', 'drawerTabHTML'].forEach(k => {
      if (typeof C[k] !== 'function') throw new Error('APP.clients.' + k + ' is missing');
    });
  if (C.STATUSES.length !== 9) return 'expected 9 statuses, got ' + C.STATUSES.length;
  if (C.DRAWER_TABS.length !== 6) return 'expected 6 drawer tabs, got ' + C.DRAWER_TABS.length;
  const unlabelled = C.STATUSES.filter(s => !C.STATUS_LABEL[s]);
  return unlabelled.length ? 'unlabelled statuses: ' + unlabelled.join(', ') : true;
});

check('client creation lands as a normalised, D1-shaped record', () => {
  const raw = { type: 'client', name: 'דנה כהן', category: 'business', phone: '050-1234567' };
  const c = C.migrateClient(raw);
  if (c.status !== 'lead') return 'a status-less client did not default to ליד חדש';
  ['interest', 'budget', 'nextAction', 'nextActionAt', 'followUpAt', 'lastContactAt', 'notes']
    .forEach(k => { if (typeof c[k] !== 'string') throw new Error(k + ' is not a string'); });
  if (!Array.isArray(c.clientNotes) || !Array.isArray(c.history)) return 'the file arrays are missing';
  // a garbage status can never crash a render
  if (C.migrateClient({ status: 'לא-קיים' }).status !== 'lead') return 'unknown status is not normalised';
  if (C.normClientStatus(undefined) !== 'lead') return 'undefined status is not normalised';
  return true;
});

check('status transitions are recorded in the client timeline', () => {
  const c = C.migrateClient({ name: 'אורן לוי', status: 'lead' });
  C.setClientStatus(c, 'contacted');
  C.setClientStatus(c, 'quoted');
  if (c.status !== 'quoted') return 'the final status is ' + c.status;
  if (c.history.length !== 2) return 'expected 2 history rows, got ' + c.history.length;
  if (c.history[0].kind !== 'status') return 'the newest row is not a status change';
  if (c.history[0].text.indexOf('נשלחה הצעה') === -1) return 'the transition lost its target label';
  // newest first
  if (c.history[0].text.indexOf('נוצר קשר') === -1) return 'the transition lost its source label';
  // a no-op transition writes nothing
  C.setClientStatus(c, 'quoted');
  if (c.history.length !== 2) return 'a no-op transition still wrote history';
  // an unknown status is normalised, never stored raw
  C.setClientStatus(c, 'nonsense');
  if (c.status !== 'lead') return 'an unknown status did not fall back to lead';
  return true;
});

check('Next-Action alert fires for active clients and stays silent for closed ones', () => {
  const open = C.migrateClient({ name: 'א', status: 'interested', nextAction: '' });
  if (!C.clientNeedsAction(open)) return 'an active client with no next action was not flagged';
  open.nextAction = '   ';
  if (!C.clientNeedsAction(open)) return 'whitespace passed as a real next action';
  C.setClientNextAction(open, 'לחזור ביום שלישי', '2026-08-04');
  if (C.clientNeedsAction(open)) return 'a defined next action still raises the alert';
  if (open.nextActionAt !== '2026-08-04') return 'the next-action date was lost';
  if (open.history[0].kind !== 'action') return 'the next action was not logged';

  C.CLOSED.forEach(s => {
    const closed = C.migrateClient({ name: 'ב', status: s, nextAction: '' });
    if (!C.clientClosed(closed)) throw new Error(s + ' is not treated as closed');
    if (C.clientNeedsAction(closed)) throw new Error(s + ' was wrongly flagged');
  });

  // clearing the action puts the hole back in the pipeline
  C.setClientNextAction(open, '', '');
  if (!C.clientNeedsAction(open)) return 'clearing the next action did not re-raise the alert';
  return true;
});

check('pipeline sub-tabs partition every status exactly once', () => {
  const buckets = C.TABS.filter(t => t !== 'all');
  const seen = {};
  buckets.forEach(t => C.TAB_STATUSES[t].forEach(s => {
    if (seen[s]) throw new Error(s + ' appears in two sub-tabs');
    seen[s] = t;
  }));
  const orphan = C.STATUSES.filter(s => !seen[s]);
  if (orphan.length) return 'statuses no sub-tab shows: ' + orphan.join(', ');

  const lead = C.migrateClient({ name: 'ג', status: 'lead' });
  if (!C.clientMatchesTab(lead, 'new')) return 'a lead is not in לידים חדשים';
  if (!C.clientMatchesTab(lead, 'all')) return 'a lead is not in הכל';
  if (C.clientMatchesTab(lead, 'closed')) return 'a lead leaked into סגורים';
  const won = C.migrateClient({ name: 'ד', status: 'won' });
  if (!C.clientMatchesTab(won, 'closed')) return 'a won deal is not in סגורים';
  if (C.clientMatchesTab(won, 'active')) return 'a won deal leaked into פעילים';
  return true;
});

check('client sorting floats the missing next actions to the top', () => {
  const mk = (name, status, action, at) =>
    C.migrateClient({ name, status, nextAction: action, nextActionAt: at || '', updatedAt: 1 });
  const sorted = C.sortClients([
    mk('סגור', 'won', ''),
    mk('פעיל עם פעולה', 'quoted', 'לשלוח חוזה', '2026-08-01'),
    mk('חור בצינור', 'interested', ''),
    mk('דחוף', 'contacted', 'להתקשר', '2026-07-28')
  ]).map(c => c.name);
  if (sorted[0] !== 'חור בצינור') return 'the pipeline hole is not first: ' + sorted.join(' | ');
  if (sorted[1] !== 'דחוף') return 'the earliest next action is not second: ' + sorted.join(' | ');
  if (sorted[3] !== 'סגור') return 'a closed client did not sink: ' + sorted.join(' | ');
  return true;
});

check('call and WhatsApp targets are built from a real Israeli number', () => {
  if (C.telHref('050-123-4567') !== 'tel:0501234567') return 'tel: got ' + C.telHref('050-123-4567');
  if (C.waNumber('050-1234567') !== '972501234567') return 'wa got ' + C.waNumber('050-1234567');
  if (C.waNumber('+972 50 123 4567') !== '972501234567') return 'an international number was mangled';
  if (C.waHref('050-1234567') !== 'https://wa.me/972501234567') return 'wrong wa.me href';
  ['', null, undefined, 'לא ידוע'].forEach(v => {
    if (C.telHref(v) !== '' || C.waHref(v) !== '') throw new Error('a missing number produced a link');
  });
  return true;
});

check('logging a contact stamps the file and its timeline', () => {
  const c = C.migrateClient({ name: 'ה', status: 'contacted', nextAction: 'לחזור' });
  C.markContact(c, 'whatsapp');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.lastContactAt)) return 'lastContactAt is ' + c.lastContactAt;
  if (c.history[0].kind !== 'contact') return 'the contact was not logged';
  if (c.history[0].text.indexOf('וואטסאפ') === -1) return 'the channel was lost';
  C.markContact(c, 'tel');
  if (c.history[0].text.indexOf('טלפון') === -1) return 'a phone call was not logged';
  return true;
});

check('client notes are captured, ordered and never blank', () => {
  const c = C.migrateClient({ name: 'ו' });
  if (C.addClientNote(c, '   ') !== null) return 'a blank note was accepted';
  C.addClientNote(c, 'ביקשה מסגרת כהה');
  C.addClientNote(c, 'התקציב עלה ל-15,000');
  if (c.clientNotes.length !== 2) return 'expected 2 notes, got ' + c.clientNotes.length;
  if (c.clientNotes[0].body !== 'התקציב עלה ל-15,000') return 'notes are not newest-first';
  if (!c.clientNotes[0].id) return 'a note has no id';
  if (c.history.filter(h => h.kind === 'note').length !== 2) return 'notes are not in the timeline';
  // a store that ever held raw strings is adopted, not dropped
  const legacy = C.migrateClient({ name: 'ז', clientNotes: ['פתק ישן', '  ', 7] });
  if (legacy.clientNotes.length !== 1) return 'legacy note adoption is wrong';
  if (legacy.clientNotes[0].body !== 'פתק ישן') return 'a legacy note lost its text';
  return true;
});

check('every drawer tab renders real content for a real client file', () => {
  const c = C.migrateClient({
    id: 'cl_1', name: 'דנה <כהן>', status: 'quoted', category: 'business',
    phone: '050-1234567', email: 'dana@example.com',
    interest: 'פורטרט שמן 70x100', budget: '8,000 ₪',
    nextAction: 'לשלוח הצעה סופית', nextActionAt: '2026-08-04',
    lastContactAt: '2026-07-26', notes: 'הערה כללית'
  });
  C.logHistory(c, 'created', 'התיק נפתח');
  C.addClientNote(c, 'ביקשה מסגרת כהה');

  const links = {
    events: [{ id: 'ev1', title: 'פגישת היכרות', category: 'business', date: '2099-01-01', start: '10:00', end: '11:00', location: 'זום' }],
    tasks: [{ id: 'tk1', title: 'להכין הצעה', category: 'business', status: 'progress', priority: 'high', due: '2099-01-01', subtasks: [] }],
    lists: [{ id: 'ls1', title: 'מידות קיר', category: 'business', date: '', items: [{ id: 'i1', title: 'רוחב', done: true }] }]
  };

  const expected = {
    overview: ['הפעולה הבאה', 'לשלוח הצעה סופית', 'תקציב', '📞 התקשר', 'wa.me'],
    meetings: ['פגישות קרובות', 'פגישות שהיו', 'פגישת היכרות'],
    tasks: ['להכין הצעה', 'data-cycle'],
    lists: ['מידות קיר', 'prog-fill'],
    notes: ['ביקשה מסגרת כהה', 'data-clientnote'],
    history: ['התיק נפתח']
  };

  C.DRAWER_TABS.forEach(tab => {
    const out = C.drawerTabHTML(tab, c, links);
    if (typeof out !== 'string' || out.length < 40) throw new Error(tab + ' rendered nothing');
    (expected[tab] || []).forEach(needle => {
      if (out.indexOf(needle) === -1) throw new Error(tab + ' is missing "' + needle + '"');
    });
    if (out.indexOf('<כהן>') !== -1) throw new Error(tab + ' injects the client name unescaped');
  });

  // an unknown tab falls back to the overview rather than blanking the file
  if (C.drawerTabHTML('nonsense', c, links).indexOf('תקציב') === -1) {
    return 'an unknown tab did not fall back to סקירה';
  }
  // an empty file still renders every tab
  const bare = C.migrateClient({ id: 'cl_2', name: 'ריק', status: 'lead' });
  C.DRAWER_TABS.forEach(tab => {
    const out = C.drawerTabHTML(tab, bare, null);
    if (typeof out !== 'string' || !out.length) throw new Error(tab + ' crashed on an empty file');
  });
  return true;
});

check('the client card shows the alert badge only when it should', () => {
  const hole = C.migrateClient({ id: 'cl_3', name: 'אורן', status: 'lead', nextAction: '' });
  const cardA = C.clientCard(hole);
  if (cardA.indexOf(C.NO_ACTION_BADGE) === -1) return 'the alert badge is missing from the card';
  if (cardA.indexOf('data-clientopen="cl_3"') === -1) return 'the card does not open the file';
  if (cardA.indexOf('is-missing') === -1) return 'the card is not visually flagged';

  const ok = C.migrateClient({ id: 'cl_4', name: 'דנה', status: 'quoted', nextAction: 'לשלוח חוזה' });
  const cardB = C.clientCard(ok);
  if (cardB.indexOf(C.NO_ACTION_BADGE) !== -1) return 'a covered client still shows the alert';
  if (cardB.indexOf('לשלוח חוזה') === -1) return 'the next action is not on the card';

  const done = C.migrateClient({ id: 'cl_5', name: 'סגור', status: 'won', nextAction: '' });
  if (C.clientCard(done).indexOf(C.NO_ACTION_BADGE) !== -1) return 'a closed deal shows the alert';
  return true;
});

/* ------------------------------------------- 19. Sprint 4 spec & delivery */

check('service worker cache version was bumped for this sprint', () => {
  const m = sw.match(/CACHE_VERSION = '(v\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  const n = parseInt(m[1].slice(1), 10);
  return n >= 6 ? true : 'CACHE_VERSION is ' + m[1] + ', expected v6 or later';
});

check('PROJECT_PLAN documents the Sprint 3 engine', () => {
  const required = [
    'Tasks Engine', 'Smart Checklist Lists', 'Quick Notes',
    'ממתין ללקוח', 'הפעולה הבאה', 'הצמד למעלה'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

check('PROJECT_PLAN documents the Sprint 4 client CRM', () => {
  const required = [
    'Client CRM', 'תיק לקוח', 'Next Action',
    'אין פעולה הבאה מוגדרת', 'וואטסאפ'
  ].concat(CLIENT_STAGES);
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ====== 19. D1 schema · Worker sync API · offline queue (Sprint 5) ======= */

/* ---- 19a. artefacts exist and parse ---- */

const WORKER_ROUTES = ['sync', 'events', 'tasks', 'lists', 'notes', 'clients'];
const WORKER_FILES = ['_shared', '_collection'].concat(WORKER_ROUTES)
  .map(n => 'functions/api/' + n + '.js');
const MIGRATION = 'migrations/0001_sprint5_init.sql';
const MIGRATION_GCAL = 'migrations/0002_sprint6_gcal.sql';
const MIGRATION_REMIND = 'migrations/0003_sprint10_remind.sql';
const MIGRATION_ALERTS = 'migrations/0006_sprint13_alerts.sql';

check('Sprint 5 artefacts are present (worker routes, migration, wrangler)', () => {
  const wanted = WORKER_FILES.concat([MIGRATION, MIGRATION_GCAL, MIGRATION_REMIND, 'wrangler.toml']);
  const missing = wanted.filter(f => !fs.existsSync(at(f)));
  return missing.length ? 'missing: ' + missing.join(', ') : true;
});

/**
 * The Worker files are ES modules; vm.Script only compiles scripts. Rewriting
 * import/export into plain statements keeps this a real syntax check without
 * needing --experimental-vm-modules.
 */
function stripModule(src) {
  return src
    .replace(/^\s*import\s[\s\S]*?from\s+'[^']*';?\s*$/gm, '')
    .replace(/^export\s+(async\s+)?function\b/gm, '$1function')
    .replace(/^export\s+(const|let|var)\b/gm, '$1')
    .replace(/^export\s+/gm, '');
}

check('every Worker route parses (no syntax errors)', () => {
  WORKER_FILES.forEach(f => {
    new vm.Script(stripModule(read(f)), { filename: f });
  });
  return true;
});

check('the six mandated /api routes each export the CRUD handlers', () => {
  WORKER_ROUTES.forEach(r => {
    const src = read('functions/api/' + r + '.js');
    if (src.indexOf('export const onRequestPost') === -1) {
      throw new Error('/api/' + r + ' has no POST handler');
    }
    if (src.indexOf('export const onRequestOptions') === -1) {
      throw new Error('/api/' + r + ' answers no CORS preflight');
    }
    if (r !== 'sync' && src.indexOf('export const onRequestGet') === -1) {
      throw new Error('/api/' + r + ' has no GET handler');
    }
  });
  return true;
});

/* ---- 19b. D1 schema ---- */

const sql = read(MIGRATION);
const sqlGcal = read(MIGRATION_GCAL);
const sqlRemind = read(MIGRATION_REMIND);
const sqlAlerts = read(MIGRATION_ALERTS);

/** every append-only migration after 0001, in the order SQLite would apply them */
const LATER_MIGRATIONS = [sqlGcal, sqlRemind, sqlAlerts];

/**
 * Live column order of a table, rebuilt the way SQLite itself builds it:
 * the CREATE TABLE declaration, then every ALTER TABLE ADD COLUMN in migration
 * order. Sprint 6 appends three columns to `events` that way and Sprint 10
 * appends one more to `events` and `tasks`, so the Worker and the client have
 * to list them in exactly that trailing position or the drift check below fires.
 */
function sqlColumns(table) {
  const m = sql.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\s*\\(([\\s\\S]*?)\\n\\);'));
  if (!m) throw new Error('no CREATE TABLE for ' + table);
  const declared = m[1].split('\n')
    .map(l => l.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map(l => l.split(/\s+/)[0].replace(/[(),]/g, ''))
    .filter(c => c && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(c));

  const added = [];
  LATER_MIGRATIONS.forEach(src => {
    const re = new RegExp('ALTER TABLE ' + table + '\\s+ADD COLUMN\\s+(\\w+)', 'g');
    let hit;
    while ((hit = re.exec(src)) !== null) added.push(hit[1]);
  });

  return declared.concat(added);
}

/** exactly the columns the Sprint 5 mandate names, in the order it names them */
const MANDATED = {
  events: ['id', 'title', 'category', 'start_time', 'end_time', 'location',
    'client_id', 'category_type', 'updated_at'],
  tasks: ['id', 'title', 'category', 'status', 'priority', 'due_date',
    'next_action', 'subtasks_json', 'client_id', 'updated_at'],
  lists: ['id', 'title', 'category', 'items_json', 'client_id', 'updated_at'],
  notes: ['id', 'title', 'body', 'category', 'is_pinned', 'client_id', 'updated_at'],
  clients: ['id', 'name', 'phone', 'email', 'status', 'next_action',
    'initial_interest', 'updated_at'],
  history_logs: ['id', 'client_id', 'action_text', 'created_at']
};

check('D1 migration declares all six mandated tables', () => {
  const missing = Object.keys(MANDATED).filter(t =>
    sql.indexOf('CREATE TABLE IF NOT EXISTS ' + t + ' ') === -1 &&
    sql.indexOf('CREATE TABLE IF NOT EXISTS ' + t + '(') === -1);
  return missing.length ? 'missing tables: ' + missing.join(', ') : true;
});

check('every mandated column exists, in the mandated order', () => {
  Object.keys(MANDATED).forEach(t => {
    const actual = sqlColumns(t);
    const want = MANDATED[t];
    const head = actual.slice(0, want.length);
    if (head.join(',') !== want.join(',')) {
      throw new Error(t + ' leads with [' + head.join(', ') + '], expected [' + want.join(', ') + ']');
    }
  });
  return true;
});

check('category is non-nullable on every entity table (§0.2)', () => {
  ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(t => {
    const block = sql.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '[\\s\\S]*?\\n\\);'))[0];
    if (!/category\s+TEXT\s+NOT NULL/.test(block)) {
      throw new Error(t + '.category is nullable');
    }
  });
  return true;
});

check('sync is durable: tombstones, an idempotency ledger and updated_at indexes', () => {
  ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(t => {
    const block = sql.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '[\\s\\S]*?\\n\\);'))[0];
    if (block.indexOf('deleted_at') === -1) throw new Error(t + ' has no tombstone column');
    if (sql.indexOf('idx_' + t + '_updated') === -1) throw new Error(t + ' has no updated_at index');
  });
  if (sql.indexOf('CREATE TABLE IF NOT EXISTS sync_ops') === -1) return 'no sync_ops idempotency ledger';
  if (!/op_id\s+TEXT PRIMARY KEY/.test(sql)) return 'sync_ops.op_id is not the idempotency key';
  return true;
});

check('wrangler.toml binds D1 and points at the migrations directory', () => {
  const toml = read('wrangler.toml');
  if (!/\[\[d1_databases\]\]/.test(toml)) return 'no D1 binding block';
  if (!/binding\s*=\s*"DB"/.test(toml)) return 'binding is not named DB (functions/api expect env.DB)';
  if (!/migrations_dir\s*=\s*"migrations"/.test(toml)) return 'migrations_dir is not wired';
  return true;
});

/* ---- 19c. schema serialisation: SQL ↔ Worker ↔ client all agree ---- */

/** execute _shared.js for real — it has no imports, so stripping is enough */
function loadShared() {
  const src = stripModule(read('functions/api/_shared.js'));
  const sandbox = { console, Response: function () {} };
  vm.createContext(sandbox);
  vm.runInContext(
    src + '\n;globalThis.__api = { SCHEMA, TABLES, CATEGORIES, MAX_TEXT, sanitize, isISO, nowISO, rowsOf };',
    sandbox, { filename: '_shared.js' });
  return sandbox.__api;
}

let W = null, SY = null;

check('the Worker schema module executes and exports its column map', () => {
  W = loadShared();
  if (!W || !W.SCHEMA) return '_shared.js exports no SCHEMA';
  if (typeof W.sanitize !== 'function') return '_shared.js exports no sanitize()';
  if (W.TABLES.join(',') !== 'events,tasks,lists,notes,clients') {
    return 'TABLES is ' + W.TABLES.join(',');
  }
  return true;
});

check('app.js exports its sync engine without touching the DOM', () => {
  const APP = loadApp();
  if (!APP) return 'window.APP was never set';
  SY = APP.sync;
  if (!SY) return 'no APP.sync export';
  ['toRow', 'fromRow', 'validRow', 'validOp', 'normSync', 'blankSync'].forEach(k => {
    if (typeof SY[k] !== 'function') throw new Error('APP.sync.' + k + ' is missing');
  });
  if (!SY.Sync || typeof SY.Sync.capture !== 'function') return 'no APP.sync.Sync engine';
  return true;
});

check('schema serialisation: SQL, Worker and client declare identical columns', () => {
  const drift = [];
  SY.TABLES.forEach(t => {
    const fromSql = sqlColumns(t).join(',');
    const fromWorker = W.SCHEMA[t].columns.join(',');
    const fromClient = SY.SCHEMA[t].join(',');
    if (fromSql !== fromWorker) drift.push(t + ': SQL[' + fromSql + '] != worker[' + fromWorker + ']');
    if (fromSql !== fromClient) drift.push(t + ': SQL[' + fromSql + '] != client[' + fromClient + ']');
  });
  return drift.length ? drift.join(' | ') : true;
});

/* ---- 19d. serialisation round-trip, executed for real ---- */

const SAMPLES = {
  events: {
    type: 'event', id: 'ev_1', title: 'פגישת היכרות', category: 'business',
    date: '2026-07-27', start: '10:00', end: '11:30', location: 'זום',
    notes: 'להביא תיק עבודות', clientId: 'cl_1',
    ownerId: 'ben-perez', createdAt: 1750000000000, updatedAt: 1760000000000
  },
  tasks: {
    type: 'task', id: 'ta_1', title: 'להכין הצעת מחיר', category: 'business',
    due: '2026-07-29', time: '09:15', status: 'waiting', priority: 'high',
    nextAction: 'לאסוף מידות', subtasks: [{ id: 'st_1', title: 'למדוד', done: true }],
    notes: '', clientId: 'cl_1',
    ownerId: 'ben-perez', createdAt: 1750000000000, updatedAt: 1760000000000
  },
  lists: {
    type: 'list', id: 'li_1', title: 'ציוד לסטודיו', category: 'business',
    items: [{ id: 'li_a', title: 'מדללים', done: false }], date: '2026-08-01',
    clientId: '', ownerId: 'ben-perez', createdAt: 1750000000000, updatedAt: 1760000000000
  },
  notes: {
    type: 'note', id: 'no_1', title: 'רעיון לקמפיין', body: 'סדרת פורטרטים',
    category: 'personal', pinned: true, clientId: '',
    ownerId: 'ben-perez', createdAt: 1750000000000, updatedAt: 1760000000000
  },
  clients: {
    type: 'client', id: 'cl_1', name: 'דנה כהן', category: 'business',
    phone: '050-1234567', email: 'dana@example.com', status: 'quoted',
    interest: 'פורטרט שמן', budget: '8,000 ₪', nextAction: 'לחזור ביום שלישי',
    nextActionAt: '2026-07-29', followUpAt: '2026-07-28', lastContactAt: '2026-07-26',
    notes: 'ראתה את הסדרה', clientNotes: [{ id: 'cn_1', body: 'מעדיפה גדול', at: 1755000000000 }],
    history: [{ id: 'hs_1', at: 1755000000000, kind: 'status', text: 'התיק נפתח' }],
    ownerId: 'ben-perez', createdAt: 1750000000000, updatedAt: 1760000000000
  }
};

check('toRow() emits exactly the columns its table declares', () => {
  SY.TABLES.forEach(t => {
    const row = SY.toRow(t, SAMPLES[t]);
    if (!row) throw new Error('toRow(' + t + ') returned nothing');
    const emitted = Object.keys(row).sort().join(',');
    const declared = SY.SCHEMA[t].slice().sort().join(',');
    if (emitted !== declared) {
      throw new Error(t + ' emits [' + emitted + '] but declares [' + declared + ']');
    }
  });
  return true;
});

check('serialisation round-trips every pillar without losing a field', () => {
  const drift = [];
  SY.TABLES.forEach(t => {
    const before = SAMPLES[t];
    const after = SY.fromRow(t, SY.toRow(t, before));
    if (!after) throw new Error('fromRow(' + t + ') returned nothing');
    Object.keys(before).forEach(k => {
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(after[k]);
      if (a !== b) drift.push(t + '.' + k + ': ' + a + ' -> ' + b);
    });
  });
  return drift.length ? drift.join(' | ') : true;
});

check('timestamps cross the wire as ISO-8601 and come back as epoch ms', () => {
  const iso = SY.toISOStamp(1760000000000);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) return 'not an ISO instant: ' + iso;
  if (SY.fromISOStamp(iso) !== 1760000000000) return 'ISO round-trip lost precision';
  if (SY.fromISOStamp('not a date') !== 0) return 'garbage timestamp is not rejected';
  // lexical order must equal chronological order — last-write-wins compares text
  if (!(SY.toISOStamp(1750000000000) < SY.toISOStamp(1760000000000))) {
    return 'ISO strings do not sort chronologically';
  }
  // an untimed event keeps a bare date; a timed one carries the minute
  if (SY.joinStamp('2026-07-27', '') !== '2026-07-27') return 'all-day event gained a time';
  if (SY.joinStamp('2026-07-27', '10:00') !== '2026-07-27T10:00') return 'timed event lost its time';
  if (SY.splitStamp('2026-07-27T10:00').time !== '10:00') return 'time did not survive the split';
  if (SY.splitStamp('2026-07-27').time !== '') return 'a bare date grew a phantom time';
  return true;
});

/* ---- 19e. payload validation, both ends ---- */

check('client refuses to queue a malformed row', () => {
  const good = SY.toRow('tasks', SAMPLES.tasks);
  if (!SY.validRow('tasks', good)) return 'a well-formed row was rejected';

  const unknown = Object.assign({}, good, { drop_table: 'x' });
  if (SY.validRow('tasks', unknown)) return 'an undeclared column was accepted';

  const noId = Object.assign({}, good); delete noId.id;
  if (SY.validRow('tasks', noId)) return 'a row without an id was accepted';

  const badStamp = Object.assign({}, good, { updated_at: '27/07/2026' });
  if (SY.validRow('tasks', badStamp)) return 'a non-ISO updated_at was accepted';

  if (SY.validRow('nope', good)) return 'an unknown table was accepted';
  return true;
});

check('client refuses to queue a malformed op', () => {
  const row = SY.toRow('notes', SAMPLES.notes);
  const ok = { opId: 'op_1', table: 'notes', id: 'no_1', action: 'upsert', row: row };
  if (!SY.validOp(ok)) return 'a well-formed op was rejected';

  if (SY.validOp(Object.assign({}, ok, { table: 'secrets' }))) return 'unknown table accepted';
  if (SY.validOp(Object.assign({}, ok, { action: 'truncate' }))) return 'unknown action accepted';
  if (SY.validOp(Object.assign({}, ok, { opId: '' }))) return 'op without an opId accepted';
  if (SY.validOp(Object.assign({}, ok, { row: null }))) return 'upsert without a row accepted';
  if (SY.validOp(null)) return 'null accepted as an op';

  // a delete carries no row, and that is legal
  if (!SY.validOp({ opId: 'op_2', table: 'notes', id: 'no_1', action: 'delete', row: null })) {
    return 'a well-formed delete was rejected';
  }
  return true;
});

check('a corrupt outbox on disk is dropped, never replayed', () => {
  const row = SY.toRow('lists', SAMPLES.lists);
  const restored = SY.normSync({
    endpoint: 'api',
    cursor: 'garbage',
    queue: [
      { opId: 'op_ok', table: 'lists', id: 'li_1', action: 'upsert', row: row },
      { opId: 'op_bad', table: 'lists', id: 'li_1', action: 'nuke', row: row },
      'not-an-op',
      { opId: 'op_bad2', table: 'ghosts', id: 'x', action: 'upsert', row: row }
    ],
    shadow: { lists: { li_1: 17, li_2: 'not a number' } }
  });
  if (restored.queue.length !== 1) return 'kept ' + restored.queue.length + ' ops, expected 1';
  if (restored.queue[0].opId !== 'op_ok') return 'the wrong op survived';
  if (restored.cursor !== '') return 'a non-ISO cursor survived';
  if (restored.shadow.lists.li_1 !== 17) return 'a valid shadow stamp was lost';
  if ('li_2' in restored.shadow.lists) return 'a non-numeric shadow stamp survived';
  return true;
});

check('Worker sanitize() drops unknown keys and forces the category vocabulary', () => {
  const clean = W.sanitize('notes', {
    id: 'no_1', title: 'x', body: 'y', category: 'צהוב', is_pinned: 'yes',
    client_id: null, updated_at: '2026-07-27T09:00:00.000Z',
    drop_table: 'students', __proto__unused: 1
  });
  if (!clean.ok) return 'a valid row was rejected: ' + clean.error;
  if ('drop_table' in clean.row) return 'an undeclared column reached SQL';
  if (clean.row.category !== 'personal') return 'an illegal category was not folded back';
  if (clean.row.is_pinned !== 1) return 'is_pinned was not coerced to an integer';
  if (clean.row.owner_id !== 'ben-perez') return 'owner_id was not defaulted';
  if (clean.row.created_at !== clean.row.updated_at) return 'created_at was not defaulted';

  const cols = Object.keys(clean.row).sort().join(',');
  if (cols !== W.SCHEMA.notes.columns.slice().sort().join(',')) {
    return 'sanitised row is not the declared column set';
  }
  return true;
});

check('Worker sanitize() rejects payloads it cannot store', () => {
  const base = { id: 'ta_1', updated_at: '2026-07-27T09:00:00.000Z' };
  const cases = [
    ['unknown table', () => W.sanitize('ghosts', base)],
    ['missing id', () => W.sanitize('tasks', { updated_at: base.updated_at })],
    ['non-ISO updated_at', () => W.sanitize('tasks', { id: 'ta_1', updated_at: '27/07/2026' })],
    ['nested object', () => W.sanitize('tasks', Object.assign({}, base, { title: { $ne: 1 } }))],
    ['oversized text', () => W.sanitize('tasks', Object.assign({}, base, { notes: 'x'.repeat(W.MAX_TEXT + 1) }))],
    ['array instead of row', () => W.sanitize('tasks', [base])]
  ];
  const leaked = cases.filter(([, fn]) => fn().ok).map(([name]) => name);
  return leaked.length ? 'accepted: ' + leaked.join(', ') : true;
});

check('Worker builds no SQL from client input', () => {
  ['functions/api/_shared.js', 'functions/api/_collection.js', 'functions/api/sync.js'].forEach(f => {
    const src = read(f);
    const statements = src.match(/prepare\(([\s\S]*?)\)\s*\n?\s*\./g) || [];
    statements.forEach(s => {
      if (s.indexOf('${') !== -1) throw new Error(f + ' interpolates into SQL');
    });
    if (/prepare\(\s*`/.test(src)) throw new Error(f + ' builds SQL from a template literal');
  });
  const shared = read('functions/api/_shared.js');
  if (shared.indexOf('.bind(') === -1) return 'no parameterised binding anywhere';
  // the only names spliced into SQL are table names resolved through SCHEMA
  if (!/SCHEMA\[table\]/.test(shared)) return 'table names are not validated against SCHEMA';
  return true;
});

/* ---- 19f. offline sync queue operations, executed ---- */

check('every local mutation lands in the outbox without a call site opting in', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync, Sync = S.Sync;
  Store.load();                                    // seeds, then saves -> captures

  const c = Store.data.sync;
  const records = S.TABLES.reduce((n, t) => n + Store.data[t].length, 0);
  if (!records) return 'the seeded store is empty — nothing to diff';
  if (c.queue.length !== records) {
    return 'queued ' + c.queue.length + ' ops for ' + records + ' records';
  }
  if (c.queue.some(op => !S.validOp(op))) return 'the outbox holds a malformed op';
  if (c.queue.some(op => op.action !== 'upsert')) return 'a fresh store queued a non-upsert';
  return true;
});

check('the outbox holds one op per record — a re-edit replaces, never appends', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync, Sync = S.Sync;
  Store.load();
  const c = Store.data.sync;

  // drain: pretend the server applied everything
  const batch = c.queue.slice();
  Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });
  if (c.queue.length) return 'settle() left ' + c.queue.length + ' applied ops behind';

  Store.save();
  if (c.queue.length) return 'an unchanged store re-queued ' + c.queue.length + ' ops';

  // The edit must stamp strictly newer than what settle() just shadowed. Store.load()
  // and this line can share a millisecond, and Date.now() would then reproduce the
  // shadowed stamp exactly — capture() would rightly see no change and enqueue nothing.
  // In the app a network round-trip always separates a settle from the next edit.
  const task = Store.data.tasks[0];
  const shadowed = c.shadow.tasks[task.id] || Date.now();
  task.title = 'שינוי ראשון'; task.updatedAt = shadowed + 1000;
  Store.save();
  if (c.queue.length !== 1) return 'one edit produced ' + c.queue.length + ' ops';

  task.title = 'שינוי שני'; task.updatedAt = shadowed + 1001;
  Store.save();
  if (c.queue.length !== 1) return 'a second edit appended instead of replacing';
  if (c.queue[0].row.title !== 'שינוי שני') return 'the outbox carries a stale payload';
  return true;
});

check('a delete becomes a tombstone op, and a rejected op cannot wedge the queue', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync, Sync = S.Sync;
  Store.load();
  const c = Store.data.sync;
  let batch = c.queue.slice();
  Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  const gone = Store.data.notes[0].id;
  Store.remove('notes', gone);
  if (c.queue.length !== 1) return 'a delete produced ' + c.queue.length + ' ops';
  if (c.queue[0].action !== 'delete') return 'a delete queued a ' + c.queue[0].action;
  if (c.queue[0].id !== gone) return 'the tombstone names the wrong record';

  // the server refuses it — the op is dropped and does not come straight back
  batch = c.queue.slice();
  Sync.settle(batch, {
    applied: [], rejected: [{ opId: batch[0].opId, error: 'nope' }],
    changes: {}, cursor: ''
  });
  if (c.queue.length) return 'a rejected op stayed in the queue';
  Store.save();
  if (c.queue.length) return 'a rejected op was immediately re-queued (wedged loop)';
  return true;
});

check('a failed push loses nothing — the queue survives a reload', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync;
  Store.load();
  const before = Store.data.sync.queue.length;

  // simulate the reload: normalise the persisted block exactly as load() does
  const revived = S.normSync(JSON.parse(JSON.stringify(Store.data.sync)));
  if (revived.queue.length !== before) {
    return 'reload kept ' + revived.queue.length + ' of ' + before + ' queued ops';
  }
  if (revived.queue.some(op => !S.validOp(op))) return 'a revived op is malformed';
  return true;
});

check('conflicts resolve last-write-wins on updated_at', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync, Sync = S.Sync;
  Store.load();
  const c = Store.data.sync;
  const batch = c.queue.slice();
  Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  const local = Store.data.tasks[0];
  local.title = 'הגרסה המקומית';
  local.updatedAt = Date.parse('2026-07-27T12:00:00.000Z');

  // (a) an older remote edit must not win
  const stale = S.toRow('tasks', local);
  stale.title = 'הגרסה הישנה';
  stale.updated_at = '2026-07-27T09:00:00.000Z';
  Sync.merge({ tasks: [stale] });
  if (Store.find('tasks', local.id).title !== 'הגרסה המקומית') return 'an older remote edit overwrote a newer local one';

  // (b) a newer remote edit must win
  const fresh = S.toRow('tasks', local);
  fresh.title = 'הגרסה מהענן';
  fresh.updated_at = '2026-07-27T15:00:00.000Z';
  Sync.merge({ tasks: [fresh] });
  const merged = Store.find('tasks', local.id);
  if (merged.title !== 'הגרסה מהענן') return 'a newer remote edit did not win';
  if (merged.updatedAt !== Date.parse('2026-07-27T15:00:00.000Z')) return 'the merged record kept the local stamp';

  // (c) a merged remote row is not echoed straight back into the outbox
  const queued = c.queue.length;
  Store.save();
  if (c.queue.length !== queued) return 'a merged remote row was re-queued as a local change';
  return true;
});

check('a remote tombstone deletes locally, and a newer local edit survives it', () => {
  const APP = loadApp();
  const Store = APP.Store, S = APP.sync, Sync = S.Sync;
  Store.load();
  const c = Store.data.sync;
  const batch = c.queue.slice();
  Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  const doomed = Store.data.lists[0];
  doomed.updatedAt = Date.parse('2026-07-27T09:00:00.000Z');
  const tomb = S.toRow('lists', doomed);
  tomb.deleted_at = '2026-07-27T12:00:00.000Z';
  tomb.updated_at = '2026-07-27T12:00:00.000Z';
  Sync.merge({ lists: [tomb] });
  if (Store.find('lists', doomed.id)) return 'a remote tombstone did not delete locally';

  // a local edit newer than the tombstone wins and is re-offered to the server
  const kept = Store.data.lists[0];
  if (!kept) return 'no second list to test the reverse case';
  kept.updatedAt = Date.parse('2026-07-27T18:00:00.000Z');
  const lateTomb = S.toRow('lists', kept);
  lateTomb.deleted_at = '2026-07-27T12:00:00.000Z';
  lateTomb.updated_at = '2026-07-27T12:00:00.000Z';
  Sync.merge({ lists: [lateTomb] });
  if (!Store.find('lists', kept.id)) return 'a newer local edit lost to an older tombstone';
  Store.save();
  if (!c.queue.some(op => op.id === kept.id && op.action === 'upsert')) {
    return 'the surviving record was never re-offered to the server';
  }
  return true;
});

/* ---- 19g. local-first ordering and the status indicator ---- */

check('a mutation writes localStorage before it ever touches the network', () => {
  const save = (js.match(/save: function \(\) \{[\s\S]*?\n    \},/) || [''])[0];
  if (!save) return 'no Store.save()';
  const capture = save.indexOf('Sync.capture()');
  const write = save.indexOf('localStorage.setItem');
  const push = save.indexOf('Sync.schedule()');
  if (capture === -1 || write === -1 || push === -1) return 'save() no longer does all three steps';
  if (!(capture < write && write < push)) return 'save() order is capture/write/push no longer';
  if (/Sync\.flush\(\)/.test(save)) return 'save() pushes synchronously — the network is on the tap path';
  return true;
});

check('the sync engine never blocks a render (no await on the mutation path)', () => {
  const engine = (js.match(/var Sync = \{[\s\S]*?\n  \};/) || [''])[0];
  if (!engine) return 'no Sync engine';
  if (/\bawait\b/.test(engine)) return 'the engine awaits — a slow network would freeze the UI';
  if (engine.indexOf('window.fetch') === -1) return 'the engine never calls the API';
  if (engine.indexOf("'online'") === -1) return 'no reconnect listener — a pull never happens on reconnect';
  if (engine.indexOf('setInterval') === -1) return 'nothing schedules the background flush';
  return true;
});

check('cloud status indicator ships the three mandated states', () => {
  ['id="syncBtn"', 'id="syncIco"', 'id="syncLabel"'].forEach(n => {
    if (html.indexOf(n) === -1) throw new Error('missing ' + n);
  });
  const topbar = (html.match(/<header class="topbar"[\s\S]*?<\/header>/) || [''])[0];
  if (topbar.indexOf('id="syncBtn"') === -1) return 'the badge is not in the app header';

  [['🟢', 'מסונכרן לענן'], ['🟡', 'ממתין לסנכרון'], ['🔴', 'אופליין']].forEach(([ico, text]) => {
    if (js.indexOf(ico) === -1) throw new Error('missing glyph ' + ico);
    if (js.indexOf(text) === -1) throw new Error('missing label ' + text);
  });
  ['.sync-btn.is-synced', '.sync-btn.is-pending', '.sync-btn.is-offline'].forEach(sel => {
    if (css.indexOf(sel) === -1) throw new Error('no style for ' + sel);
  });
  return true;
});

check('sync state is computed from real conditions, not guessed', () => {
  const APP = loadApp();
  const Sync = APP.sync.Sync, Store = APP.Store;
  Store.load();
  // the sandbox runs on file:// with no reachable origin => local-only
  if (Sync.enabled()) return 'the cloud reported itself reachable over file://';
  if (Sync.state() !== 'offline') return 'state is ' + Sync.state() + ' with no reachable cloud';
  if (APP.sync.STATES.join(',') !== 'synced,pending,offline') {
    return 'state vocabulary is ' + APP.sync.STATES.join(',');
  }
  // flush() must be a no-op, not a throw, when there is nothing to talk to
  if (Sync.flush() !== null) return 'flush() attempted a call with no endpoint';
  return true;
});

check('the service worker never caches the sync API', () => {
  if (sw.indexOf("'/api/'") === -1) return '/api/ responses fall into the static cache';
  return true;
});

check('PROJECT_PLAN documents the Sprint 5 cloud layer', () => {
  const required = [
    'D1', 'Cloudflare Worker', '/api/sync',
    'מסונכרן לענן', 'ממתין לסנכרון', 'אופליין',
    'last-write-wins', 'outbox'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ========== 20. public/ build directory & config shielding (Sprint 6) ===== */

check('every browser-reachable asset lives under public/', () => {
  const stray = REQUIRED.filter(f => fs.existsSync(path.join(ROOT, f)));
  if (stray.length) return 'still served from the repo root: ' + stray.join(', ');
  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(PUBLIC, f)));
  return missing.length ? 'missing from public/: ' + missing.join(', ') : true;
});

check('config and build files are outside the published directory', () => {
  // the whole point of the refactor: none of these may be fetchable over HTTP
  const secret = ['PROJECT_PLAN.md', 'healthcheck.js', 'wrangler.toml',
    'README.md', 'migrations', 'functions', 'tools'];

  const leaked = secret.filter(f => fs.existsSync(path.join(PUBLIC, f)));
  if (leaked.length) return 'reachable over HTTP: public/' + leaked.join(', public/');

  const orphaned = secret.filter(f => !fs.existsSync(path.join(ROOT, f)));
  return orphaned.length ? 'vanished from the repo root: ' + orphaned.join(', ') : true;
});

check('wrangler publishes public/ and nothing above it', () => {
  const toml = read('wrangler.toml');
  const m = toml.match(/pages_build_output_dir\s*=\s*"([^"]*)"/);
  if (!m) return 'no pages_build_output_dir';
  if (m[1] !== 'public') return 'pages_build_output_dir is "' + m[1] + '", expected "public"';
  return true;
});

check('functions/ stays at the project root, where Pages compiles it', () => {
  // Pages resolves functions/ from the project root, NOT from the output dir —
  // moving it into public/ would both unmount /api/* and publish its source
  if (fs.existsSync(path.join(PUBLIC, 'functions'))) return 'functions/ was moved into public/';
  if (!fs.existsSync(path.join(ROOT, 'functions', 'api', 'sync.js'))) return 'functions/api is gone';
  return true;
});

check('no procedural icon generator can overwrite the shipped brand mark', () => {
  // Sprint 7: public/icons/ is rendered from tools/brand-mark.jpg. The old
  // shape-based generator was removed so it can never be run by mistake.
  if (fs.existsSync(path.join(ROOT, 'tools', 'gen-icons.js'))) {
    return 'tools/gen-icons.js is back — running it would overwrite the brand-mark icons';
  }
  if (fs.existsSync(path.join(ROOT, 'icons'))) {
    return 'the old root-level /icons directory was resurrected';
  }
  if (!fs.existsSync(path.join(ROOT, 'tools', 'brand-mark.jpg'))) {
    return 'tools/brand-mark.jpg is gone — the icon source of truth';
  }
  return true;
});

/* ============ 21. Google Calendar two-way sync (Sprint 6) ================= */

/* ---- 21a. artefacts ---- */

const GCAL_FILES = ['_gcal', '_token', 'auth', 'sync'].map(n => 'functions/api/gcal/' + n + '.js');

check('Sprint 6 artefacts are present (gcal routes + migration)', () => {
  const missing = GCAL_FILES.concat([MIGRATION_GCAL])
    .filter(f => !fs.existsSync(path.join(ROOT, f)));
  return missing.length ? 'missing: ' + missing.join(', ') : true;
});

check('every Google Calendar module parses (no syntax errors)', () => {
  GCAL_FILES.forEach(f => { new vm.Script(stripModule(read(f)), { filename: f }); });
  return true;
});

check('/api/gcal/auth and /api/gcal/sync export the mandated handlers', () => {
  ['auth', 'sync'].forEach(r => {
    const src = read('functions/api/gcal/' + r + '.js');
    ['onRequestGet', 'onRequestPost', 'onRequestOptions'].forEach(h => {
      if (src.indexOf('export const ' + h) === -1) {
        throw new Error('/api/gcal/' + r + ' has no ' + h + ' handler');
      }
    });
  });
  return true;
});

check('no OAuth secret is hard-coded — credentials come from the environment', () => {
  const creds = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  GCAL_FILES.forEach(f => {
    const src = read(f);
    creds.forEach(c => {
      // env.GOOGLE_CLIENT_ID is the only legal shape; a literal is a leak
      const literal = new RegExp(c + "\\s*[:=]\\s*['\"]");
      if (literal.test(src)) throw new Error(f + ' hard-codes ' + c);
    });
  });
  // and the client half must never even name them
  if (/GOOGLE_CLIENT_SECRET|refresh_token/.test(js)) {
    return 'app.js references an OAuth secret — tokens must never reach the browser';
  }
  return true;
});

/* ---- 21b. D1: the Google link columns and the sync state ---- */

check('migration 0002 appends the Google link to events without editing 0001', () => {
  ['google_event_id', 'etag', 'google_calendar_id'].forEach(c => {
    if (!new RegExp('ALTER TABLE events\\s+ADD COLUMN\\s+' + c + '\\b').test(sqlGcal)) {
      throw new Error('events.' + c + ' is never added');
    }
    if (sql.indexOf(c) !== -1) throw new Error('0001 was edited to carry ' + c + ' — migrations are append-only');
  });
  if (sqlGcal.indexOf('idx_events_google') === -1) return 'no index on events(google_event_id)';
  return true;
});

check('migration 0002 declares the OAuth account and per-calendar sync state', () => {
  if (sqlGcal.indexOf('CREATE TABLE IF NOT EXISTS gcal_accounts') === -1) return 'no gcal_accounts table';
  if (sqlGcal.indexOf('CREATE TABLE IF NOT EXISTS gcal_sync_state') === -1) return 'no gcal_sync_state table';
  ['refresh_token', 'access_token', 'expires_at', 'auth_state'].forEach(c => {
    if (sqlGcal.indexOf(c) === -1) throw new Error('gcal_accounts has no ' + c);
  });
  ['calendar_key', 'sync_token', 'last_sync_at'].forEach(c => {
    if (sqlGcal.indexOf(c) === -1) throw new Error('gcal_sync_state has no ' + c);
  });
  return true;
});

check('a blank client payload can never erase the Google link', () => {
  // app.js sends '' for google_event_id until a cycle has run; a plain
  // `col = excluded.col` would orphan the Google event on the very next tap
  const shared = read('functions/api/_shared.js');
  ['google_event_id', 'etag', 'google_calendar_id'].forEach(c => {
    if (shared.indexOf(c) === -1) throw new Error('_shared.js does not declare ' + c);
  });
  if (!/COALESCE\(NULLIF\(excluded\./.test(shared)) {
    return 'the UPSERT overwrites the Google link with whatever the browser sends';
  }
  return true;
});

/* ---- 21c. the mapping module, executed for real ---- */

/** _gcal.js is deliberately import-free, so stripping exports is enough to run it */
function loadGcal() {
  const src = stripModule(read('functions/api/gcal/_gcal.js'));
  const sandbox = { console, Date, Math, JSON, RegExp, URLSearchParams, isNaN };
  vm.createContext(sandbox);
  vm.runInContext(
    src + '\n;globalThis.__gcal = { CALENDAR_KEYS, DEFAULT_TZ, GOOGLE_SCOPE, OWNER_PROP, ' +
    'calendarKeyFor, categoryFor, calendarIdFor, isAllDay, addDays, minutesOf, shiftStamp, ' +
    'isNewer, googleUpdated, toGoogleEvent, fromGoogleEvent, differs };',
    sandbox, { filename: '_gcal.js' });
  return sandbox.__gcal;
}

let G = null;

check('the Google mapping module executes without a network or a binding', () => {
  G = loadGcal();
  if (!G) return '_gcal.js exported nothing';
  ['toGoogleEvent', 'fromGoogleEvent', 'calendarKeyFor', 'categoryFor',
    'calendarIdFor', 'addDays', 'isNewer', 'differs'].forEach(k => {
      if (typeof G[k] !== 'function') throw new Error('_gcal.' + k + ' is missing');
    });
  if (G.CALENDAR_KEYS.join(',') !== 'personal,business') {
    return 'CALENDAR_KEYS is ' + G.CALENDAR_KEYS.join(',');
  }
  return true;
});

check('calendar mapping: primary ↔ personal, business calendar ↔ business', () => {
  if (G.calendarKeyFor('business') !== 'business') return 'business category maps elsewhere';
  if (G.calendarKeyFor('personal') !== 'personal') return 'personal category maps elsewhere';
  // §0.2 — there is no third category, so anything unknown must land on personal
  if (G.calendarKeyFor('') !== 'personal' || G.calendarKeyFor('nonsense') !== 'personal') {
    return 'an unknown category is not forced to personal';
  }
  if (G.categoryFor('business') !== 'business' || G.categoryFor('personal') !== 'personal') {
    return 'the calendar → category inverse is broken';
  }

  if (G.calendarIdFor('personal', { GOOGLE_BUSINESS_CALENDAR_ID: 'biz@group' }) !== 'primary') {
    return 'personal must always resolve to the primary calendar';
  }
  if (G.calendarIdFor('business', { GOOGLE_BUSINESS_CALENDAR_ID: 'biz@group' }) !== 'biz@group') {
    return 'business does not resolve to GOOGLE_BUSINESS_CALENDAR_ID';
  }
  // a half-configured install must degrade to one calendar, not throw per request
  if (G.calendarIdFor('business', {}) !== 'primary') return 'unconfigured business calendar does not fall back';
  return true;
});

check('mapping math: all-day events cross Google\'s exclusive end correctly', () => {
  const one = G.toGoogleEvent({ id: 'ev_1', title: 'יום כיף', start_time: '2026-07-27', end_time: '2026-07-27' });
  if (!one.start.date || one.start.date !== '2026-07-27') return 'all-day start is ' + JSON.stringify(one.start);
  if (one.end.date !== '2026-07-28') return 'a one-day event must end (exclusively) on the 28th, got ' + one.end.date;
  if (one.start.dateTime || one.end.dateTime) return 'an all-day event was pushed with a clock';

  const span = G.toGoogleEvent({ id: 'ev_2', start_time: '2026-07-27', end_time: '2026-07-29' });
  if (span.end.date !== '2026-07-30') return 'multi-day exclusive end is ' + span.end.date;

  // month, year and leap-day rollovers of the +1
  if (G.toGoogleEvent({ id: 'a', start_time: '2026-07-31', end_time: '2026-07-31' }).end.date !== '2026-08-01') {
    return 'month rollover of the exclusive end is broken';
  }
  if (G.toGoogleEvent({ id: 'b', start_time: '2026-12-31', end_time: '2026-12-31' }).end.date !== '2027-01-01') {
    return 'year rollover of the exclusive end is broken';
  }
  if (G.toGoogleEvent({ id: 'c', start_time: '2024-02-28', end_time: '2024-02-28' }).end.date !== '2024-02-29') {
    return 'leap day is skipped by the exclusive end';
  }

  // an end that predates the start is nonsense — it must not produce end < start
  const bad = G.toGoogleEvent({ id: 'd', start_time: '2026-07-27', end_time: '2026-07-20' });
  if (bad.end.date !== '2026-07-28') return 'a backwards all-day range was pushed as ' + bad.end.date;
  return true;
});

check('mapping math: timed events carry a wall clock and a real duration', () => {
  const g = G.toGoogleEvent({ id: 'ev_3', title: 'פגישה', start_time: '2026-07-27T10:00', end_time: '2026-07-27T11:30' });
  if (g.start.dateTime !== '2026-07-27T10:00:00') return 'start is ' + g.start.dateTime;
  if (g.end.dateTime !== '2026-07-27T11:30:00') return 'end is ' + g.end.dateTime;
  if (g.start.timeZone !== 'Asia/Jerusalem') return 'timeZone is ' + g.start.timeZone;

  // Google rejects an event whose end is not after its start, so a missing or
  // inverted end has to become a real one rather than a 400 on every push
  const open = G.toGoogleEvent({ id: 'ev_4', start_time: '2026-07-27T10:00', end_time: '' });
  if (open.end.dateTime !== '2026-07-27T11:00:00') return 'an endless event became ' + open.end.dateTime;

  const wrap = G.toGoogleEvent({ id: 'ev_5', start_time: '2026-07-27T23:30', end_time: '' });
  if (wrap.end.dateTime !== '2026-07-28T00:30:00') return 'midnight wrap became ' + wrap.end.dateTime;

  const inverted = G.toGoogleEvent({ id: 'ev_6', start_time: '2026-07-27T10:00', end_time: '2026-07-27T09:00' });
  if (inverted.end.dateTime <= inverted.start.dateTime) return 'an inverted range was pushed as-is';

  if (G.toGoogleEvent({ id: 'ev_7', start_time: '' }) !== null) return 'a dateless row was pushed anyway';
  return true;
});

check('mapping math: local → Google → local round-trips without drift', () => {
  const cases = [
    { start_time: '2026-07-27', end_time: '2026-07-27' },        // one all-day
    { start_time: '2026-07-27', end_time: '2026-07-29' },        // multi-day
    { start_time: '2026-12-31', end_time: '2026-12-31' },        // year boundary
    { start_time: '2026-07-27T10:00', end_time: '2026-07-27T11:30' },
    { start_time: '2026-07-27T23:30', end_time: '2026-07-28T00:30' }
  ];

  cases.forEach((c, i) => {
    const row = Object.assign({
      id: 'ev_rt' + i, title: 'סבב ' + i, category: 'business',
      location: 'סטודיו', notes: 'הערה'
    }, c);

    const g = G.toGoogleEvent(row);
    // echo back what Google would return for that body
    const back = G.fromGoogleEvent({
      id: 'g_' + i, etag: '"abc"', status: 'confirmed',
      updated: '2026-07-27T09:00:00.000Z',
      summary: g.summary, description: g.description, location: g.location,
      start: g.start, end: g.end, extendedProperties: g.extendedProperties
    }, 'business');

    if (!back) throw new Error('case ' + i + ' failed to map back');
    if (back.row.start_time !== c.start_time) {
      throw new Error('case ' + i + ' start drifted: ' + c.start_time + ' → ' + back.row.start_time);
    }
    if (back.row.end_time !== c.end_time) {
      throw new Error('case ' + i + ' end drifted: ' + c.end_time + ' → ' + back.row.end_time);
    }
    if (back.row.title !== row.title || back.row.notes !== row.notes || back.row.location !== row.location) {
      throw new Error('case ' + i + ' lost a text field');
    }
    if (back.row.category !== 'business') throw new Error('case ' + i + ' lost its category');
    if (back.local_id !== row.id) throw new Error('case ' + i + ' lost the local id back-link');
  });
  return true;
});

check('serialisation: a Google event becomes a legal events row', () => {
  const mapped = G.fromGoogleEvent({
    id: 'gid_1', etag: '"e1"', status: 'confirmed', updated: '2026-07-27T09:00:00.000Z',
    summary: 'סקיצה עם דנה', location: 'הסטודיו', description: 'להביא תיק עבודות',
    start: { dateTime: '2026-07-27T10:00:00+03:00', timeZone: 'Asia/Jerusalem' },
    end: { dateTime: '2026-07-27T11:00:00+03:00', timeZone: 'Asia/Jerusalem' }
  }, 'personal');

  if (!mapped) return 'a well-formed Google event mapped to null';
  // the RFC-3339 offset is sliced off: this app stores wall clock, never UTC (§3)
  if (mapped.row.start_time !== '2026-07-27T10:00') return 'start_time is ' + mapped.row.start_time;
  if (mapped.row.end_time !== '2026-07-27T11:00') return 'end_time is ' + mapped.row.end_time;
  if (mapped.row.category !== 'personal') return 'category is ' + mapped.row.category;
  if (mapped.row.category_type !== 'event') return 'category_type is ' + mapped.row.category_type;
  if (mapped.etag !== '"e1"') return 'the ETag was dropped — If-Match would be impossible';
  if (mapped.updated !== '2026-07-27T09:00:00.000Z') return 'updated is ' + mapped.updated;
  if (mapped.cancelled) return 'a confirmed event was read as cancelled';

  // every column it emits must be a real events column, or the UPSERT throws
  const cols = W.SCHEMA.events.columns;
  const stray = Object.keys(mapped.row).filter(k => cols.indexOf(k) === -1);
  if (stray.length) return 'maps unknown columns: ' + stray.join(', ');

  // a delete made on the phone arrives as status:cancelled and must tombstone
  const dead = G.fromGoogleEvent({ id: 'gid_2', status: 'cancelled', updated: '2026-07-27T09:00:00.000Z' }, 'personal');
  if (!dead || !dead.cancelled) return 'a cancelled Google event is not read as a tombstone';

  if (G.fromGoogleEvent({}, 'personal') !== null) return 'an id-less event was accepted';
  if (G.fromGoogleEvent(null, 'personal') !== null) return 'null was accepted';
  return true;
});

check('conflict resolution: last-write-wins compares ISO instants', () => {
  if (!G.isNewer('2026-07-27T10:00:00.000Z', '2026-07-27T09:00:00.000Z')) return 'a later instant did not win';
  if (G.isNewer('2026-07-27T09:00:00.000Z', '2026-07-27T10:00:00.000Z')) return 'an earlier instant won';
  // equal stamps are not "newer" — the incoming write must not churn the row
  if (G.isNewer('2026-07-27T09:00:00.000Z', '2026-07-27T09:00:00.000Z')) return 'an identical instant counted as newer';
  if (!G.isNewer('2026-07-27T09:00:00.000Z', '')) return 'anything must beat an unknown stamp';
  if (G.isNewer('', '2026-07-27T09:00:00.000Z')) return 'an unknown stamp beat a real one';

  // Google renders `updated` with an offset sometimes — normalise before comparing
  if (G.googleUpdated({ updated: '2026-07-27T12:00:00+03:00' }) !== '2026-07-27T09:00:00.000Z') {
    return 'googleUpdated does not normalise to UTC: ' + G.googleUpdated({ updated: '2026-07-27T12:00:00+03:00' });
  }
  if (G.googleUpdated({}) !== '') return 'a missing updated is not empty';
  return true;
});

check('a no-op push is suppressed, so the two sides cannot ping-pong', () => {
  const row = {
    id: 'ev_9', title: 'זהה', location: 'סטודיו', notes: 'הערה',
    start_time: '2026-07-27T10:00', end_time: '2026-07-27T11:00'
  };
  const same = { row: { title: 'זהה', location: 'סטודיו', notes: 'הערה',
    start_time: '2026-07-27T10:00', end_time: '2026-07-27T11:00' } };
  if (G.differs(row, same)) return 'an identical pair was reported as changed';

  if (!G.differs(row, { row: Object.assign({}, same.row, { title: 'אחר' }) })) return 'a title change went unnoticed';
  if (!G.differs(row, { row: Object.assign({}, same.row, { start_time: '2026-07-27T12:00' }) })) {
    return 'a time change went unnoticed';
  }
  return true;
});

/* ---- 21d. the sync engine's own guarantees, read off the source ---- */

check('the pull is incremental and survives an expired sync token', () => {
  const src = read('functions/api/gcal/sync.js');
  if (src.indexOf('syncToken') === -1) return 'the pull never uses a syncToken';
  if (src.indexOf('nextSyncToken') === -1) return 'the new syncToken is never stored';
  if (src.indexOf('410') === -1) return 'an expired syncToken (410 GONE) is never handled';
  if (src.indexOf('nextPageToken') === -1) return 'a paged result set is truncated';
  if (src.indexOf('showDeleted') === -1) return "deletions made on Google never arrive (showDeleted)";
  return true;
});

check('the push covers new, modified and deleted events', () => {
  const src = read('functions/api/gcal/sync.js');
  ['events.insert', 'events.patch', 'events.delete'].forEach(op => {
    if (src.indexOf(op) === -1) throw new Error('no ' + op + ' path');
  });
  if (src.indexOf("'If-Match'") === -1) return 'a push never sends the ETag precondition';
  if (src.indexOf('412') === -1) return 'a failed precondition is not resolved';
  if (!/skip\.has\(row\.id\)/.test(src)) {
    return 'a row the pull just wrote is pushed straight back at Google';
  }
  return true;
});

check('google bookkeeping never masquerades as a user edit', () => {
  const src = read('functions/api/gcal/sync.js');
  const m = src.match(/async function setGoogleRef[\s\S]*?\n\}/);
  if (!m) return 'no setGoogleRef()';
  if (/updated_at/.test(m[0])) {
    return 'writing the Google link bumps updated_at — the row would re-push every cycle, forever';
  }
  return true;
});

/* ---- 21e. the client half ---- */

check('app.js exports its Google Calendar bridge', () => {
  const APP = loadApp();
  const GC = APP && APP.gcal;
  if (!GC) return 'no APP.gcal export';
  ['blankGCal', 'normGCal'].forEach(k => {
    if (typeof GC[k] !== 'function') throw new Error('APP.gcal.' + k + ' is missing');
  });
  if (!GC.GCal || typeof GC.GCal.sync !== 'function') return 'no APP.gcal.GCal engine';
  if (GC.ENDPOINT !== 'api/gcal') return 'endpoint is ' + GC.ENDPOINT + ', expected the relative api/gcal';
  if (/^https?:|^\//.test(GC.ENDPOINT)) return 'an absolute endpoint breaks a sub-path deploy';

  // an unknown or hostile stored block must normalise, never crash the boot
  const blank = GC.blankGCal();
  if (blank.connected !== false || blank.lastSyncAt !== '') return 'blankGCal() is not blank';
  if (GC.normGCal(null).connected !== false) return 'normGCal(null) did not fall back';
  if (GC.normGCal({ lastSyncAt: 'לא תאריך' }).lastSyncAt !== '') return 'a junk stamp survived normalisation';
  if (GC.normGCal({ lastSyncAt: '2026-07-27T09:00:00.000Z', connected: 1 }).lastSyncAt !== '2026-07-27T09:00:00.000Z') {
    return 'a valid stamp was discarded';
  }
  return true;
});

check('the store persists the Google block across a reload', () => {
  const APP = loadApp();
  const blank = APP.Store.blank();
  if (!blank.gcal || typeof blank.gcal !== 'object') return 'a new store carries no gcal block';
  if (blank.gcal.lastSyncAt !== '') return 'a new store claims a sync that never happened';
  // Sprint 5 stores have no gcal key at all — hydration must not throw on them
  if (!/d\.gcal = normGCal\(d\.gcal\)/.test(js)) return 'a pre-Sprint-6 store is never migrated';
  return true;
});

check('the connect CTA is present, in the mandated copy, and wired', () => {
  if (html.indexOf('id="gcalBtn"') === -1) return 'no connection button';
  if (html.indexOf('📅') === -1) return 'calendar affordance missing';
  if (html.indexOf('התחבר ל-Google Calendar') === -1) return 'mandated CTA copy missing';
  if (html.indexOf('id="gcalSync"') === -1) return 'no last-sync readout';
  if (!/\$\('#gcalBtn'\)/.test(js)) return 'the button is not bound in app.js';
  if (js.indexOf('auth?action=start') === -1) return 'the button never starts the OAuth flow';
  return true;
});

check('the last-sync readout uses the mandated Hebrew line', () => {
  if (js.indexOf('סונכרן לאחרונה מול גוגל: ') === -1) return 'mandated readout copy missing';
  const APP = loadApp();
  const GC = APP.gcal;

  // drive the real painter's text source rather than trusting the literal
  APP.Store.load();
  APP.Store.data.gcal = { configured: true, connected: true, lastSyncAt: '2026-07-27T09:05:00.000Z' };
  const line = GC.GCal.stampText();
  if (line.indexOf('סונכרן לאחרונה מול גוגל: ') !== 0) return 'stampText() reads "' + line + '"';
  if (!/\d{2}:\d{2}$/.test(line)) return 'the readout carries no HH:MM: "' + line + '"';

  // connected but never synced must say so instead of showing a fake time
  APP.Store.data.gcal.lastSyncAt = '';
  if (/\d{2}:\d{2}/.test(GC.GCal.stampText())) return 'a never-synced connection shows a time anyway';
  // disconnected shows nothing at all
  APP.Store.data.gcal.connected = false;
  if (GC.GCal.stampText() !== '') return 'a disconnected account still claims a sync';
  return true;
});

check('the Google link round-trips through the client serialisers', () => {
  const APP = loadApp();
  const SYC = APP.sync;
  const rec = {
    type: 'event', id: 'ev_g1', title: 'פגישה', category: 'business',
    date: '2026-07-27', start: '10:00', end: '11:00',
    updatedAt: Date.parse('2026-07-27T09:00:00.000Z'),
    createdAt: Date.parse('2026-07-27T08:00:00.000Z'),
    googleEventId: 'gid_1', googleEtag: '"e1"', googleCalendarId: 'primary'
  };

  const row = SYC.toRow('events', rec);
  if (row.google_event_id !== 'gid_1') return 'google_event_id was dropped on the way out';
  if (row.etag !== '"e1"') return 'etag was dropped on the way out';
  if (!SYC.validRow('events', row)) return 'the row no longer validates against SYNC_SCHEMA';

  const back = SYC.fromRow('events', row);
  if (back.googleEventId !== 'gid_1' || back.googleEtag !== '"e1"') return 'the link was lost coming back';
  if (back.googleCalendarId !== 'primary') return 'the calendar id was lost coming back';

  // a record this device created has no link yet, and that must still be legal
  const fresh = SYC.toRow('events', Object.assign({}, rec, {
    googleEventId: undefined, googleEtag: undefined, googleCalendarId: undefined
  }));
  if (fresh.google_event_id !== '') return 'an unlinked event emits ' + JSON.stringify(fresh.google_event_id);
  if (!SYC.validRow('events', fresh)) return 'an unlinked event no longer validates';
  return true;
});

check('the Worker still accepts a client row now that events grew', () => {
  const row = {
    id: 'ev_g2', title: 'פגישה', category: 'business',
    start_time: '2026-07-27T10:00', end_time: '2026-07-27T11:00',
    location: '', client_id: '', category_type: 'event',
    updated_at: '2026-07-27T09:00:00.000Z', owner_id: 'ben-perez', notes: '',
    created_at: '2026-07-27T08:00:00.000Z', deleted_at: null,
    google_event_id: '', etag: '', google_calendar_id: ''
  };
  const out = W.sanitize('events', row);
  if (!out.ok) return 'sanitize refused a legal Sprint 6 row: ' + out.error;
  ['google_event_id', 'etag', 'google_calendar_id'].forEach(c => {
    if (!(c in out.row)) throw new Error('sanitize dropped ' + c);
  });
  return true;
});

/* ---- 21f. the specification records the sprint ---- */

check('PROJECT_PLAN documents the Sprint 6 Google Calendar layer', () => {
  const required = [
    'Google Calendar', '/api/gcal/auth', '/api/gcal/sync',
    'syncToken', 'google_event_id', 'etag',
    'התחבר ל-Google Calendar', 'סונכרן לאחרונה מול גוגל',
    'public/', 'pages_build_output_dir'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   22. Sprint 7 — premium UX: haptics, targeted DOM updates, undo, touch floor
   ========================================================================== */

/* ---- 22a. haptic feedback, executed on a stubbed device ---- */

check('haptics are guarded — a device with no motor never throws', () => {
  const APP = loadApp();                       // the bare sandbox navigator has no vibrate
  const H = APP.ui && APP.ui.Haptics;
  if (!H) return 'no APP.ui.Haptics export';
  if (H.supported()) return 'a bare navigator reported vibration support';
  if (H.light() !== false) return 'light() claimed to fire on a device with no motor';
  if (H.done() !== false) return 'done() claimed to fire on a device with no motor';
  return true;
});

check('haptics fire the mandated 10ms pulse where a motor exists', () => {
  const calls = [];
  const APP = loadApp({ navigator: { vibrate: p => { calls.push(p); return true; } } });
  const H = APP.ui.Haptics;
  if (!H.supported()) return 'a navigator WITH vibrate was reported unsupported';
  if (H.light() !== true) return 'light() did not fire';
  if (calls[0] !== 10) return 'the light pulse is ' + calls[0] + 'ms, not the mandated 10ms';
  if (APP.ui.HAPTIC_LIGHT !== 10) return 'HAPTIC_LIGHT is ' + APP.ui.HAPTIC_LIGHT;
  H.done();
  if (!Array.isArray(calls[1]) || calls[1].length < 2) return 'the completion beat is not a pattern';
  return true;
});

check('a vibrate implementation that throws cannot break the tap', () => {
  const APP = loadApp({ navigator: { vibrate: () => { throw new Error('permission denied'); } } });
  if (APP.ui.Haptics.light() !== false) return 'a throwing motor was reported as a success';
  // a browser that refuses the pattern answers false rather than throwing
  const soft = loadApp({ navigator: { vibrate: () => false } });
  if (soft.ui.Haptics.light() !== false) return 'a refused pulse was reported as a success';
  return true;
});

check('navigator.vibrate is called from exactly one guarded place', () => {
  const hits = js.match(/navigator\.vibrate\s*\(/g) || [];
  if (hits.length !== 1) return 'navigator.vibrate is called ' + hits.length + ' times';
  const mod = (js.match(/var Haptics = \{[\s\S]*?\n  \};/) || [''])[0];
  if (!mod) return 'no Haptics module';
  if (mod.indexOf('navigator.vibrate(') === -1) return 'the one call site sits outside Haptics';
  if (mod.indexOf('try {') === -1) return 'the call is not wrapped in a try';
  if (mod.indexOf('Haptics.supported()') === -1) return 'the call is not support-gated';
  return true;
});

check('every delegated tap gets a pulse, and only after a control matched', () => {
  const onClick = (js.match(/function onClick\(e\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (!onClick) return 'no onClick delegate';
  // Sprint 8 turned the unmatched-tap guard into a block: a tap that hit no
  // control but landed on a card now opens that card for editing, so the gate
  // is `if (!el) {` rather than a bare return. The rule it protects is
  // unchanged — nothing buzzes until the tap has been resolved to something.
  const guard = onClick.indexOf('if (!el) {');
  const pulse = onClick.indexOf('Haptics.light()');
  if (pulse === -1) return 'no haptic on the delegated tap path';
  if (guard === -1) return 'the delegate no longer gates on an unmatched tap';
  if (pulse < guard) return 'the pulse fires before a control was even matched';
  // ...and the check circle is the ONE control that declines the light pulse:
  // it fires its own dual pattern, which a light beat 10ms earlier would clip
  if (onClick.indexOf('if (!el.dataset.toggle) Haptics.light();') === -1) {
    return 'the control path lost its pulse, or the check circle no longer owns its own';
  }
  if (js.indexOf('Haptics.done()') === -1) return 'nothing marks a completion with the second beat';
  // the one control that mutates outside onClick is the client status <select>
  const onChange = (js.match(/function onChange\(e\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (!onChange || onChange.indexOf('Haptics.light()') === -1) {
    return 'changing a client status is silent to the finger';
  }
  return true;
});

/* ---- 22b. targeted DOM updates ---- */

check('every record row carries the id that lets it be patched in place', () => {
  ['tasks:', 'lists:', 'notes:', 'clients:', 'events:'].forEach(k => {
    if (js.indexOf('data-rec="' + k) === -1) throw new Error('no data-rec for ' + k);
  });
  if (js.indexOf('data-compact="1"') === -1) return 'the compact row variant is indistinguishable';
  if (js.indexOf("node.dataset.compact === '1'") === -1) return 'the patch ignores the compact variant';
  return true;
});

check('a simple state change patches one node instead of redrawing the app', () => {
  ['data-toggle', 'data-cycle', 'data-subtask', 'data-listitem', 'data-pin'].forEach(k => {
    const branch = (js.match(new RegExp('el\\.dataset\\.' + k.slice(5) + '\\)\\s*\\{[\\s\\S]*?\\n      return;')) || [''])[0];
    if (!branch) throw new Error('no delegated branch for ' + k);
    if (branch.indexOf('Patch.apply(') === -1) throw new Error(k + ' does not patch its record');
    if (/\brender\(\)/.test(branch)) throw new Error(k + ' still triggers a full app render');
  });
  return true;
});

check('the patch engine executes and knows every list container', () => {
  const U = loadApp().ui;
  ['record', 'settle', 'apply', 'html'].forEach(k => {
    if (typeof U.Patch[k] !== 'function') throw new Error('Patch.' + k + ' is missing');
  });
  const sels = U.SECTIONS.map(s => s.sel);
  ['#timeline', '#todoToday', '#calStage', '#tasksList', '#listsList', '#notesList', '#clientsList']
    .forEach(s => { if (sels.indexOf(s) === -1) throw new Error('no registered section for ' + s); });

  U.SECTIONS.forEach(s => {
    if (typeof s.draw !== 'function') throw new Error(s.sel + ' has no draw()');
    if (typeof s.keys !== 'function') throw new Error(s.sel + ' has no keys()');
    if (['today', 'calendar', 'tasks', 'clients'].indexOf(s.view) === -1) {
      throw new Error(s.sel + ' belongs to no view');
    }
    if (html.indexOf('id="' + s.sel.slice(1) + '"') === -1) {
      throw new Error(s.sel + ' is registered but not in the document');
    }
  });
  return true;
});

check('membership decides a rebuild, and it is compared in order', () => {
  const APP = loadApp(), U = APP.ui;
  APP.Store.load();

  const keys = U.recKeys('tasks', U.shownTasks());
  if (keys.length < 2) return 'the seeded store shows too few tasks to compare';
  if (keys.some(k => k.indexOf('tasks:') !== 0)) return 'a key is not namespaced by collection';
  if (!U.sameKeys(keys, keys.slice())) return 'an identical list was reported as changed';
  if (U.sameKeys(keys, keys.slice().reverse())) return 'a reorder was reported as unchanged';
  if (U.sameKeys(keys, keys.slice(1))) return 'a removal was reported as unchanged';
  if (U.sameKeys(keys, null)) return 'an unprovable membership was treated as unchanged';

  // every collection publishes the same shape, so no section can drift
  ['shownLists', 'shownNotes', 'shownClients'].forEach(fn => {
    if (typeof U[fn] !== 'function') throw new Error('no ' + fn + '() selector');
    if (!Array.isArray(U[fn]())) throw new Error(fn + '() does not return a list');
  });
  return true;
});

check('every list renderer can be told to skip its markup', () => {
  ['renderTimeline', 'renderTodo', 'renderTasks', 'renderLists', 'renderNotes', 'renderClients']
    .forEach(fn => {
      if (!new RegExp('function ' + fn + '\\(quiet\\)').test(js)) throw new Error(fn + ' takes no quiet flag');
    });
  if (!/if \(!quiet\)/.test(js)) return 'the quiet flag is never honoured';
  if (!/render: function \(quiet\)/.test(js)) return 'the calendar pane cannot be quieted';
  if (!/keys: function \(\)/.test(js)) return 'nothing publishes a container membership';
  return true;
});

/* ---- 22c. the undo safety net, executed ---- */

check('the undo window holds one deletion and restores it into its old slot', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const before = Store.data.tasks.map(t => t.id);
  if (before.length < 3) return 'the seeded store has too few tasks to test a middle slot';

  const victim = before[1];
  const entry = U.softDelete('tasks', victim);
  if (!entry) return 'softDelete refused a live record';
  if (entry.index !== 1) return 'the slot was recorded as ' + entry.index + ', not 1';
  if (!entry.label) return 'the entry carries no Hebrew label for the toast';
  if (Store.find('tasks', victim)) return 'the record never left the store';
  if (!U.Undo.has()) return 'no undo was armed';

  U.Undo.fire();
  const after = Store.data.tasks.map(t => t.id);
  if (after.join(',') !== before.join(',')) return 'restored to slot ' + after.indexOf(victim) + ', not 1';
  if (U.Undo.has()) return 'the window stayed open after a restore';
  if (U.softDelete('tasks', 'no_such_id')) return 'softDelete armed an undo for a record that never existed';
  return true;
});

check('a committed deletion is permanent, and a second delete never stacks', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  U.softDelete('tasks', ids[0]);
  const first = U.Undo.peek();
  U.softDelete('tasks', ids[1]);               // arms a second — the first must close
  if (!first || U.Undo.peek().id === first.id) return 'the older window survived';

  U.Undo.commit();
  if (U.Undo.has()) return 'commit left the window open';
  if (U.Undo.fire() !== null) return 'a committed deletion could still be undone';
  if (Store.find('tasks', ids[0]) || Store.find('tasks', ids[1])) return 'a committed deletion came back';
  return true;
});

check('a restore replaces the queued tombstone instead of racing it', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = APP.sync;
  Store.load();
  const c = Store.data.sync;

  // drain: pretend the server applied everything, so the shadow is authoritative
  const batch = c.queue.slice();
  S.Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  const victim = Store.data.notes[0];
  if (!victim) return 'no seeded note to delete';

  U.softDelete('notes', victim.id);
  if (!c.queue.some(op => op.id === victim.id && op.action === 'delete')) {
    return 'the deletion never reached the outbox';
  }

  U.Undo.fire();
  const ops = c.queue.filter(op => op.id === victim.id);
  if (ops.length !== 1) return 'the outbox holds ' + ops.length + ' ops for one record';
  if (ops[0].action !== 'upsert') return 'the restore left a ' + ops[0].action + ' queued — it would sync as a deletion';
  return true;
});

check('a note inside a client file is deleted with the same safety net', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const c = Store.data.clients[0];
  if (!c) return 'no seeded client';
  APP.clients.addClientNote(c, 'פתק ראשון');
  APP.clients.addClientNote(c, 'פתק שני');
  const before = c.clientNotes.map(n => n.id);
  if (before.length < 2) return 'the composer did not write two notes';

  const entry = U.softDeleteClientNote(c.id, before[1]);
  if (!entry) return 'softDeleteClientNote refused a live note';
  if (c.clientNotes.some(n => n.id === before[1])) return 'the note never left the file';

  U.Undo.fire();
  if (c.clientNotes.map(n => n.id).join(',') !== before.join(',')) return 'the note came back in the wrong slot';
  return true;
});

check('the undo toast is in the document, labelled and wired to five seconds', () => {
  ['id="toast"', 'id="toastText"', 'id="toastUndo"', 'data-undo="1"'].forEach(n => {
    if (html.indexOf(n) === -1) throw new Error('missing ' + n);
  });
  if (html.indexOf('>אחזר<') === -1) return 'the undo button is not labelled אחזר';
  if (!/var UNDO_MS = 5000/.test(js)) return 'the undo window is not 5 seconds';
  if (js.indexOf('Undo.commit()') === -1) return 'an expiring toast never commits the deletion';
  if (js.indexOf('Undo.fire()') === -1) return 'nothing restores when אחזר is tapped';
  if (js.indexOf('[data-undo]') === -1) return 'the undo button is not in the click delegate';
  ['.toast-undo', '.toast.has-action'].forEach(s => {
    if (css.indexOf(s) === -1) throw new Error('no style for ' + s);
  });
  return true;
});

/**
 * The body of a top-level function declaration, brace-matched rather than
 * regex-terminated: a delete path now nests a confirmation closure inside
 * itself, and any `[\s\S]*?` pattern would stop at the first inner return.
 */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return '';
  let i = src.indexOf('{', start);
  if (i === -1) return '';
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}

check('no deletion path bypasses the undo window', () => {
  // Wave 2 — the delegate hands off to a named door instead of deleting inline
  const del = (js.match(/if \(el\.dataset\.del\) \{[^}]*\}/) || [''])[0];
  if (!del) return 'no delete branch in the delegate';
  if (del.indexOf('askDelete(') === -1) return 'the delete branch does not go through the confirmation door';
  if (del.indexOf('Store.remove(') !== -1) return 'the delete branch still removes permanently';

  const door = bodyOf(js, 'function askDelete(');
  if (!door) return 'no askDelete()';
  if (door.indexOf('confirmDelete(') === -1) return 'a row is deleted without asking first';
  if (door.indexOf('softDelete(') === -1) return 'the confirmed deletion removes without arming an undo';
  if (door.indexOf('UNDO_LABEL') === -1) return 'the confirmed deletion never offers אחזר';
  if (door.indexOf('Store.remove(') !== -1) return 'the confirmed deletion removes permanently';

  const noteDel = (js.match(/if \(el\.dataset\.clientnotedel\) \{[^}]*\}/) || [''])[0];
  if (!noteDel) return 'no client-note delete branch';
  if (noteDel.indexOf('askDeleteClientNote(') === -1) return 'a client note skips the confirmation door';

  const noteDoor = bodyOf(js, 'function askDeleteClientNote(');
  if (!noteDoor) return 'no askDeleteClientNote()';
  ['confirmDelete(', 'softDeleteClientNote(', 'UNDO_LABEL'].forEach(n => {
    if (noteDoor.indexOf(n) === -1) throw new Error('the client-note path is missing ' + n);
  });
  return true;
});

/* ---- 22d. mobile ergonomics: the 44x44 floor, enforced by parsing the CSS ---- */

/**
 * Flat { sel, body } for every declaration block, media-nested ones included.
 * Comments are stripped first — a rule preceded by one would otherwise carry
 * the whole comment inside its selector.
 */
function cssRules(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) out.push({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  return out;
}

/** every class that is, or wraps, a control a finger has to hit */
const CONTROLS = [
  'push-btn', 'sync-btn', 'gcal-btn', 'gcal-unlink', 'seg', 'tab', 'rail-item',
  'att', 'type-btn', 'btn', 'fab', 'sheet-x', 'check-tap', 'cl-item', 'mini',
  'qa', 'qa-mini', 'cal-arrow', 'cal-today', 'cal-cell', 'wk-cell', 'dv-slot',
  'cl-open', 'badge-btn', 'toast-undo',
  // Waves 2–3: universal editing, the multi-select gate and the batch bar
  'row-edit', 'select-btn', 'batch-btn',
  // Sprint 8: the recycle bin pill
  'trash-btn',
  // Sprint 9: the batch-archive button
  'archive-btn',
  // Sprint 11: the notification-permission banner's CTA
  'nfy-cta'
];

/** chips that stay visually small and clear the floor with a hit expander */
const EXPANDED = ['badge-btn'];

/**
 * True when the rule actually sizes the control, rather than something nested
 * inside it: `.rail-item .ico { width:22px }` sizes a glyph, not the button.
 * Only the last compound of each comma-separated part is the rule's subject.
 */
function targets(sel, cls) {
  const re = new RegExp('\\.' + cls + '(?![\\w-])');
  return sel.split(',').some(part => {
    const last = part.trim().split(/[\s>+~]+/).filter(Boolean).pop() || '';
    return re.test(last);
  });
}

check('no control anywhere in the CSS drops below the 44x44 floor', () => {
  if (!/--tap:\s*44px/.test(css)) return 'no --tap: 44px token';
  const bad = [];

  cssRules(css).forEach(r => {
    const hit = CONTROLS.filter(c => targets(r.sel, c));
    if (!hit.length) return;

    ['min-height', 'height', 'min-width', 'width'].forEach(prop => {
      const m = r.body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'));
      if (!m) return;
      const px = m[1].trim().match(/^(\d+(?:\.\d+)?)px$/);
      if (!px || parseFloat(px[1]) >= 44) return;
      if (hit.every(c => EXPANDED.indexOf(c) !== -1)) return;   // covered by a hit expander
      bad.push(r.sel + ' { ' + prop + ':' + m[1].trim() + ' }');
    });
  });

  return bad.length ? 'sub-44px control: ' + bad.join(' · ') : true;
});

check('the small chips that stay small carry a real 44x44 hit expander', () => {
  EXPANDED.forEach(c => {
    const rule = (css.match(new RegExp('\\.' + c + '::after\\s*\\{[\\s\\S]*?\\}')) || [''])[0];
    if (!rule) throw new Error('.' + c + ' has no ::after hit expander');
    if (!/min-width:\s*var\(--tap\)/.test(rule)) throw new Error('.' + c + ' expander is under 44px wide');
    if (!/min-height:\s*var\(--tap\)/.test(rule)) throw new Error('.' + c + ' expander is under 44px tall');
    if (!/position:\s*absolute/.test(rule)) throw new Error('.' + c + ' expander is in flow — it would move the layout');
    // the centring transform is physical, so the anchor must be physical too,
    // or the overlay lands on the wrong side of an RTL row
    if (!/left:\s*50%/.test(rule) || !/translate\(-50%,\s*-50%\)/.test(rule)) {
      throw new Error('.' + c + ' expander is not centred on the chip');
    }
    if (!new RegExp('\\.' + c + '\\{[^}]*position:\\s*relative').test(css.replace(/\s*\{/g, '{'))) {
      throw new Error('.' + c + ' is not a positioning context for its expander');
    }
  });
  return true;
});

/**
 * Regression guard for a whole class of bug rather than one instance of it:
 * the moment a rule gives an element a `display`, the UA rule behind the
 * `hidden` attribute stops applying and the element is on screen forever. Any
 * element the markup ships hidden must therefore carry its own reset.
 */
check('a CSS display rule can never defeat the hidden attribute', () => {
  const rules = cssRules(css);
  const bad = [];

  (html.match(/<[a-z][^>]*\shidden(?:\s|>)[^>]*>?/gi) || []).forEach(tag => {
    const id = (tag.match(/id="([\w-]+)"/) || [])[1];
    const cls = (tag.match(/class="([^"]+)"/) || [])[1] || '';
    const keys = (id ? ['#' + id] : []).concat(
      cls.split(/\s+/).filter(Boolean).map(c => '.' + c));
    if (!keys.length) return;

    const given = rules.some(r =>
      r.sel.indexOf('[hidden]') === -1 &&
      /(?:^|;)\s*display\s*:/.test(r.body) &&
      r.sel.split(',').some(p => keys.indexOf(p.trim()) !== -1));
    if (!given) return;

    const reset = keys.some(k => rules.some(r =>
      r.sel.split(',').some(p => p.trim() === k + '[hidden]') &&
      /display:\s*none/.test(r.body)));
    if (!reset) bad.push(keys.join('/'));
  });

  return bad.length ? 'shipped hidden but permanently visible: ' + bad.join(', ') : true;
});

check('the header pills are square-safe on the narrowest phone', () => {
  const narrow = (css.match(/@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  if (!narrow) return 'no narrow-phone breakpoint';
  ['.push-btn', '.sync-btn', '.gcal-btn'].forEach(s => {
    const rule = (narrow.match(new RegExp('\\' + s + '\\{[^}]*\\}')) || [''])[0];
    if (!rule) throw new Error(s + ' is not compacted on a narrow phone');
    if (!/width:\s*var\(--tap\)/.test(rule) || !/min-width:\s*var\(--tap\)/.test(rule)) {
      throw new Error(s + ' shrinks below the tap floor when its label is dropped');
    }
  });
  return true;
});

/* ---- 22e. tactile press states and focus rings ---- */

check('every control answers a press with a tactile dip', () => {
  const press = (css.match(/button:active[\s\S]*?\}/) || [''])[0];
  if (!press) return 'no :active rule on button';
  if (!/transform:\s*scale\(0?\.97\)/.test(press)) return 'the press does not scale to .97';
  if (!/transition:\s*transform 0?\.1s ease/.test(css)) return 'no .1s transform transition';
  ['.seg:active', '.cl-item:active', '.qa:active', '.att:active', '.type-btn:active'].forEach(s => {
    if (css.indexOf(s) === -1) throw new Error('no press state for ' + s);
  });
  // the FAB already carries a positioning transform and must compose, not lose it
  if (!/\.fab:active\{\s*transform:translateX\(50%\)\s*scale\(\.97\)/.test(css)) {
    return 'the FAB press state lost its own positioning transform';
  }
  return true;
});

check('keyboard focus is visible and a finger press paints no ring', () => {
  if (!/button:focus-visible/.test(css)) return 'no focus-visible ring on buttons';
  if (!/outline:\s*2px solid/.test(css)) return 'the focus ring has no outline';
  if (!/outline-offset/.test(css)) return 'the ring sits on the border and shifts the layout';
  if (!/:focus:not\(:focus-visible\)[^{]*\{\s*outline:\s*none/.test(css)) {
    return 'a touch press still paints a focus ring';
  }
  if (!/-webkit-tap-highlight-color:\s*transparent/.test(css)) return 'the grey mobile tap flash is still on';
  return true;
});

check('the swipe navigation still owns the calendar horizontal axis', () => {
  if (!/touch-action:\s*manipulation/.test(css)) return 'the 300ms double-tap delay was never removed';
  if (!/\.cal-stage\s*\{[^}]*touch-action:\s*pan-y/.test(css)) return '.cal-stage no longer reserves pan-y';
  if (!/\.cal-stage button\{\s*touch-action:\s*pan-y/.test(css)) {
    return 'the blanket touch-action hands calendar swipes back to the browser';
  }
  return true;
});

/* ---- 22f. shipped shell and specification ---- */

check('the service worker cache version was bumped for this sprint', () => {
  const sw = read('sw.js');
  const m = sw.match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[1], 10) < 9) return 'the cache is still v' + m[1] + ' — returning phones keep the old shell';
  return true;
});

check('PROJECT_PLAN documents the Sprint 7 premium UX layer', () => {
  const required = [
    'Sprint 7', 'navigator.vibrate', 'data-rec', 'Patch.record', 'Patch.settle',
    'softDelete', 'אחזר', '44x44', ':focus-visible', 'v9'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   23. Waves 1–3 — breakage fixes, confirm + universal edit, multi-select

   Wave 1  pointer-events on the toast · the scroll-aware CTA · the timeline
           membership drift (B0) · a stranded undo window (B1) · a restore that
           held a detached record (B2)
   Wave 2  the mandated delete confirmation · editing every card in the form it
           was created with · finished work recedes
   Wave 3  multi-select, the batch action bar and one undo over a whole batch
   ========================================================================== */

/* ---- 23a. Wave 1: the breakage fixes ---- */

check('the toast can never swallow a tap meant for the card underneath', () => {
  const rules = cssRules(css);
  const pill = rules.filter(r => r.sel === '.toast')[0];
  if (!pill) return 'no .toast rule';
  if (!/pointer-events:\s*none/.test(pill.body)) {
    return 'the pill still intercepts every tap in the strip it floats over';
  }
  const undo = rules.filter(r => r.sel === '.toast-undo')[0];
  if (!undo || !/pointer-events:\s*auto/.test(undo.body)) {
    return 'אחזר inherited pointer-events:none — the undo button is unreachable';
  }
  return true;
});

check('the floating CTA ducks on the way down and returns on the way up', () => {
  const F = loadApp().ui.Fab;
  if (!F || typeof F.decide !== 'function') return 'no APP.ui.Fab.decide()';

  const cases = [
    [0, 0, false, false, 'at the top with no travel'],
    [0, 10, false, false, 'inside the top zone'],
    [300, 400, false, true, 'travelling down'],
    [400, 300, true, false, 'travelling up'],
    [400, 402, true, true, 'a jitter while ducked'],
    [400, 402, false, false, 'a jitter while shown'],
    [900, 5, true, false, 'scrolled back to the top']
  ];
  for (const [prev, now, hidden, want, why] of cases) {
    const got = F.decide(prev, now, hidden);
    if (got !== want) return why + ': decide(' + prev + ',' + now + ',' + hidden + ') = ' + got;
  }
  return true;
});

check('a ducked CTA keeps neither a tap target nor a keyboard stop', () => {
  const set = bodyOf(js, 'set: function (hide)');
  if (!set) return 'no Fab.set()';
  if (set.indexOf("classList.toggle('is-hidden'") === -1) return 'nothing paints the ducked state';
  if (set.indexOf('aria-hidden') === -1) return 'a screen reader still announces the hidden CTA';
  if (!/tabIndex\s*=\s*Fab\.hidden \? -1 : 0/.test(set)) return 'the ducked CTA is still a keyboard stop';

  const rule = (css.match(/\.fab\.is-hidden\{[^}]*\}/) || [''])[0];
  if (!rule) return 'no .fab.is-hidden rule';
  if (!/pointer-events:\s*none/.test(rule)) return 'the invisible CTA still eats taps';
  if (!/opacity:\s*0/.test(rule)) return 'the ducked CTA is still painted';
  if (!/transform:/.test(rule)) return 'the CTA is hidden without moving out of the way';
  // the desktop CTA carries no centring transform and must compose its own duck
  const desktop = (css.match(/@media\s*\(min-width:900px\)\{[\s\S]*?\n\}/) || [''])[0];
  if (desktop.indexOf('.fab.is-hidden') === -1) return 'the desktop CTA ducks sideways instead of down';
  return true;
});

check('the scroll listener is passive and coalesced into one frame', () => {
  if (!/addEventListener\('scroll', Fab\.onScroll, \{ passive: true \}\)/.test(js)) {
    return 'the scroll listener is missing or not passive — it would block the scroll';
  }
  const onScroll = bodyOf(js, 'onScroll: function ()');
  if (!onScroll) return 'no Fab.onScroll()';
  if (onScroll.indexOf('requestAnimationFrame') === -1) return 'every scroll event repaints synchronously';
  if (onScroll.indexOf('if (Fab.frame) return;') === -1) return 'the frame is not coalesced';
  return true;
});

check('the timeline reports the rows it PAINTS, not the rows it sorted (B0)', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const t = APP.isoDate(new Date());

  Store.data.events.length = 0;
  const untimed = Store.add('events', {
    type: 'event', title: 'ללא שעה', category: 'business',
    date: t, start: '', end: '', location: '', notes: '', clientId: ''
  });
  const nine = Store.add('events', {
    type: 'event', title: 'תשע בבוקר', category: 'personal',
    date: t, start: '09:00', end: '10:00', location: '', notes: '', clientId: ''
  });
  const late = Store.add('events', {
    type: 'event', title: 'אחרי החלון', category: 'personal',
    date: t, start: '23:30', end: '', location: '', notes: '', clientId: ''
  });

  const keys = U.timelineKeys();
  // an untimed event paints in the first bucket but sorts LAST (no time = 24:01):
  // the two orders disagreed, so the container was rebuilt under the finger
  if (keys[0] !== 'events:' + untimed.id) return 'the untimed event is not reported first';
  if (keys[1] !== 'events:' + nine.id) return '09:00 is not reported second';
  if (keys[2] !== 'events:' + late.id) return 'the out-of-window event was dropped from the membership';

  // Sprint 10 — a timeline row now holds {collection, rec} entries, because a
  // timed TASK is blocked into its hour beside the meetings (§4). The invariant
  // is unchanged: what is painted and what is reported must be one list.
  const flat = [];
  U.timelineRows().forEach(r => r.list.forEach(e => flat.push(e.collection + ':' + e.rec.id)));
  if (flat.join(',') !== keys.join(',')) return 'the painted rows and the reported keys disagree';

  const section = U.SECTIONS.filter(s => s.sel === '#timeline')[0];
  if (!section) return 'no registered section for #timeline';
  if (section.keys().join(',') !== keys.join(',')) return 'the section registry uses a different order';
  if (!U.sameKeys(section.keys(), U.timelineKeys())) return 'the membership is not stable across two reads';
  return true;
});

check('the timeline clamps every hour into its window and hides nothing', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const t = APP.isoDate(new Date());
  Store.data.events.length = 0;
  Store.add('events', {
    type: 'event', title: 'לפני הזריחה', category: 'personal',
    date: t, start: '05:00', end: '', location: '', notes: '', clientId: ''
  });

  const rows = U.timelineRows();
  if (rows.length !== 15) return 'the timeline paints ' + rows.length + ' hour rows, not 08:00–22:00';
  if (rows[0].hour !== 8 || rows[14].hour !== 22) return 'the window is not 08:00 → 22:00';
  if (rows[0].list.length !== 1) return 'an event before 08:00 was dropped instead of clamped';
  if (U.timelineKeys().length !== 1) return 'the clamped event is missing from the membership';
  return true;
});

check('a plain toast closes the undo window instead of stranding it (B1)', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  if (typeof U.toast !== 'function') return 'no APP.ui.toast export';

  const victim = Store.data.tasks[0];
  U.softDelete('tasks', victim.id);
  if (!U.Undo.has()) return 'the deletion armed no undo';

  // any other tap shows a plain acknowledgement, which replaces the pill and
  // takes אחזר off screen with it — an undo the user cannot see has expired
  U.toast('המשימה הושלמה ✓');
  if (U.Undo.has()) return 'the window stayed armed with no button left to reach it';
  if (Store.find('tasks', victim.id)) return 'the deletion was rolled back instead of committed';

  // ...and a toast that DOES carry אחזר must leave the window open
  const second = Store.data.tasks[0];
  U.softDelete('tasks', second.id);
  U.toast('המשימה נמחקה', U.UNDO_LABEL);
  if (!U.Undo.has()) return 'an undo toast closed its own window';
  return true;
});

check('an undo restore re-resolves its record instead of trusting a captured one (B2)', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = APP.sync;
  Store.load();

  const before = Store.data.clients[0];
  if (!before) return 'no seeded client';
  APP.clients.addClientNote(before, 'פתק שנמחק תוך כדי סנכרון');
  Store.save();
  const noteId = before.clientNotes[0].id;

  if (!U.softDeleteClientNote(before.id, noteId)) return 'softDeleteClientNote refused a live note';

  // a cloud round-trip lands inside the five-second window: merge() REPLACES
  // the record object, and the restore used to write into the detached copy
  const row = S.toRow('clients', before);
  row.updated_at = S.toISOStamp(Date.now() + 60000);
  S.Sync.merge({ clients: [row] });

  const live = Store.find('clients', before.id);
  if (!live) return 'the merge dropped the client';
  if (live === before) return 'the merge did not replace the record — this test proves nothing';

  U.Undo.fire();
  const back = Store.find('clients', before.id).clientNotes.some(n => n.id === noteId);
  if (!back) return 'the restore wrote into a detached copy and the note was lost';
  return true;
});

/* ---- 23b. Wave 2: confirmation, universal editing, dimming ---- */

const CONFIRM_Q = 'האם אתה בטוח שברצונך למחוק?';

check('every destructive tap asks the mandated question first', () => {
  if (html.indexOf(CONFIRM_Q) === -1) return 'the confirmation sheet does not carry the mandated question';
  if (js.indexOf(CONFIRM_Q) === -1) return 'the question is not the one the code paints';
  // Sprint 8 renamed the accept button to the label the mandate names verbatim
  ['id="confirmSheet"', 'id="confirmWhat"', 'data-confirmdel', '>אישור מחיקה<', '>ביטול<'].forEach(n => {
    if (html.indexOf(n) === -1) throw new Error('missing ' + n);
  });
  if (html.indexOf('role="dialog"') === -1) return 'the confirmation is not a dialog';
  if (js.indexOf('[data-confirmdel]') === -1) return 'כן, מחק is not wired into the delegate';
  if (js.indexOf('data-action="close-confirm"') === -1 && html.indexOf('close-confirm') === -1) {
    return 'the confirmation cannot be dismissed on its own';
  }
  return true;
});

check('the confirmation runs the deletion only once, and only when accepted', () => {
  const C = loadApp().ui.Confirm;
  if (!C) return 'no APP.ui.Confirm export';

  let ran = 0;
  C.ask('המשימה · לבדיקה', () => { ran++; });
  if (!C.isOpen()) return 'ask() did not open a question';
  C.dismiss();
  if (ran !== 0) return 'ביטול still deleted the record';
  if (C.isOpen()) return 'the question stayed open after ביטול';

  C.ask('המשימה · לבדיקה', () => { ran++; });
  if (C.accept() !== true) return 'accept() refused an open question';
  if (ran !== 1) return 'כן, מחק ran the deletion ' + ran + ' times';
  if (C.accept() !== false || ran !== 1) return 'a second accept re-ran the deletion';
  if (C.ask('x', null)) return 'a question was armed with nothing to run';
  return true;
});

check('the confirmation closes without taking the client file underneath it', () => {
  const close = bodyOf(js, 'function closeConfirmUI(');
  if (!close) return 'no closeConfirmUI()';
  if (close.indexOf('Drawer.close(') !== -1) return 'dismissing the question closes the client file too';
  if (close.indexOf('anySheetOpen()') === -1) return 'the backdrop is dropped while a sheet is still open';
  const any = bodyOf(js, 'function anySheetOpen(');
  if (!any || any.indexOf('Drawer.isOpen()') === -1) return 'anySheetOpen() ignores the client drawer';
  return true;
});

check('every card type carries an edit affordance wired to the delegate', () => {
  ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(c => {
    if (js.indexOf("editBtn('" + c + "'") === -1) throw new Error(c + ' cards cannot be edited');
  });
  if (js.indexOf('data-edit="') === -1) return 'the edit button carries no record key';
  if (js.indexOf('[data-edit]') === -1) return 'the edit button is not in the click delegate';
  if (js.indexOf('function openEdit(') === -1) return 'no openEdit()';
  if (!/openForm\(type, null, rec\)/.test(js)) return 'editing does not reuse the typed form';
  return true;
});

check('the edit form exposes every field the mapper writes back', () => {
  const U = loadApp().ui;
  // the form-building region: the FIELDS builders plus the shared control
  // helpers they delegate to (clientPicker() owns name="clientId")
  const from = js.indexOf('var FIELDS = {');
  const to = js.indexOf('function parseChecklist(');
  const fields = from !== -1 && to > from ? js.slice(from, to) : '';
  if (!fields) return 'no FIELDS block';

  const dummy = {};
  Object.keys(U.TO_FORM).forEach(collection => {
    const values = U.TO_FORM[collection](dummy);
    const type = U.EDIT_TYPE[collection];
    if (!type) throw new Error(collection + ' has no editable type');
    if (U.COLLECTION_OF[type] !== collection) throw new Error(type + ' maps back to the wrong collection');
    Object.keys(values).forEach(name => {
      // a field is either written out literally, or declared through the
      // f(name, …) / picker(name, …) helpers that name the control for it
      const declared = fields.indexOf('name="' + name + '"') !== -1 ||
        fields.indexOf("f('" + name + "'") !== -1;
      if (!declared) throw new Error(collection + ': the form has no field named ' + name);
    });
  });
  if (!/querySelector\('\[name="' \+ name \+ '"\]'\)/.test(js)) return 'fillForm() does not address fields by name';
  return true;
});

check('an edit saves back into the same record instead of creating a second one', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const before = Store.data.tasks.map(t => t.id);
  const victim = Store.find('tasks', before[0]);
  const stamp = victim.updatedAt;

  const label = U.applyEdit('tasks', victim.id, {
    title: 'כותרת מעודכנת', due: APP.isoDate(new Date()), time: '11:30',
    status: 'done', priority: 'low', nextAction: '', clientId: '',
    subtasks: '', notes: 'הערה חדשה'
  }, 'business');

  if (!label) return 'the edit reported no result';
  if (Store.data.tasks.map(t => t.id).join(',') !== before.join(',')) {
    return 'the edit added or moved a record instead of updating one';
  }
  const after = Store.find('tasks', victim.id);
  if (after.title !== 'כותרת מעודכנת') return 'the title was not written back';
  if (after.priority !== 'low' || after.category !== 'business') return 'a field was dropped on save';
  // the status writer is what keeps the legacy done flag in lockstep
  if (after.status !== 'done' || after.done !== true) return 'the edit bypassed setTaskStatus()';
  if (!(after.updatedAt > stamp)) return 'the edit was not stamped, so the outbox would never push it';
  if (U.applyEdit('tasks', victim.id, { title: '' }, 'personal') !== '') {
    return 'an empty title was accepted';
  }
  if (U.applyEdit('tasks', 'no_such_id', { title: 'x' }, 'personal') !== '') {
    return 'an edit of a deleted record was accepted';
  }
  return true;
});

check('editing a checklist keeps the progress it already had', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const rows = U.mergeChecklist(
    [{ id: 'a', title: 'ראשון', done: true }, { id: 'b', title: 'שני', done: false }],
    'ראשון\nשלישי', 'li');
  if (rows.length !== 2) return 'the edited list holds ' + rows.length + ' rows';
  if (rows[0].id !== 'a' || rows[0].done !== true) return 'a surviving row lost its identity or its tick';
  if (rows[1].title !== 'שלישי' || rows[1].done !== false) return 'a new row did not arrive clean';

  // and through the real save path: a seeded list keeps its ticked items
  const list = Store.data.lists.filter(l => l.items.some(i => i.done))[0];
  if (!list) return 'no seeded list with a ticked item';
  const donePre = list.items.filter(i => i.done).length;
  U.applyEdit('lists', list.id, {
    title: list.title, date: '', clientId: '',
    items: U.itemLines(list.items) + '\nפריט חדש'
  }, list.category);
  const after = Store.find('lists', list.id);
  if (after.items.length !== list.items.length) return 'the round-trip changed the item count';
  if (after.items.filter(i => i.done).length !== donePre) return 'the round-trip un-ticked completed items';
  if (after.items[after.items.length - 1].title !== 'פריט חדש') return 'the appended item was lost';
  return true;
});

check('a client edit still writes the pipeline timeline', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const c = Store.data.clients.filter(x => !APP.clients.clientClosed(x))[0];
  if (!c) return 'no open client file';
  const logs = c.history.length;

  U.applyEdit('clients', c.id, {
    name: c.name, phone: c.phone, email: c.email, status: 'won',
    interest: c.interest, budget: c.budget,
    nextAction: 'לשלוח חשבונית', nextActionAt: APP.isoDate(new Date()), notes: ''
  }, 'business');

  const after = Store.find('clients', c.id);
  if (after.status !== 'won') return 'the status move was not saved';
  if (!APP.clients.clientClosed(after)) return 'a won deal is not treated as closed';
  if (after.history.length <= logs) return 'the edit changed the pipeline without logging it';
  if (!after.history.some(h => h.kind === 'status')) return 'the status move is missing from the timeline';
  if (!after.history.some(h => h.kind === 'action')) return 'the next action is missing from the timeline';
  if (after.nextAction !== 'לשלוח חשבונית') return 'the next action was not written back';
  return true;
});

check('finished work recedes without dropping below the contrast floor', () => {
  const token = (css.match(/--dim-done:\s*([0-9.]+)/) || [])[1];
  if (!token) return 'no --dim-done token';
  const dim = parseFloat(token);
  if (!(dim >= 0.45 && dim <= 0.7)) return '--dim-done is ' + dim + ' — either invisible or pointless';

  const dimmed = cssRules(css).filter(r => /opacity:\s*var\(--dim-done\)/.test(r.body));
  if (!dimmed.length) return 'nothing is dimmed by the token';
  const sel = dimmed.map(r => r.sel).join(' ');
  ['.row.is-done', '.row.is-cancelled', '.row.list.is-complete', '.cl-card.is-closed'].forEach(s => {
    if (sel.indexOf(s) === -1) throw new Error(s + ' is not dimmed when it is finished');
  });
  // a picked card must never be dimmed — the finger has to see what it chose
  if (!/\.row\.is-picked[\s\S]{0,80}opacity:\s*1/.test(css)) return 'a picked card can still be dimmed';
  if (js.indexOf("' is-closed'") === -1) return 'a closed client file never gets the dimmed class';
  return true;
});

/* ---- 23c. Wave 3: multi-select, batch actions, the wider undo ---- */

check('selection mode is reachable from the header and by a long press', () => {
  ['id="selectBtn"', 'data-action="select-mode"', 'id="batchBar"', 'id="batchCount"'].forEach(n => {
    if (html.indexOf(n) === -1) throw new Error('missing ' + n);
  });
  ['done', 'all', 'delete', 'exit'].forEach(a => {
    if (html.indexOf('data-batch="' + a + '"') === -1) throw new Error('no batch action: ' + a);
  });
  if (html.indexOf('בחירה מרובה') === -1) return 'the gate is not labelled in Hebrew';
  if (js.indexOf('[data-batch]') === -1) return 'the batch bar is not in the click delegate';

  const press = bodyOf(js, 'bindLongPress: function ()');
  if (!press) return 'no long-press binding';
  if (!/var LONG_PRESS_MS = 500/.test(js)) return 'the long press is not 500ms';
  if (press.indexOf('LONG_PRESS_SLOP') === -1) return 'a scroll would be mistaken for a long press';
  if (press.indexOf('{ passive: true }') === -1) return 'the touch listeners are not passive';
  if (press.indexOf('Select.swallow = true') === -1) {
    return 'the click after the press would immediately un-pick the card';
  }
  return true;
});

check('picking cards is pure state, and every card type can be picked', () => {
  const U = loadApp().ui;
  const S = U.Select;
  if (!S) return 'no APP.ui.Select export';
  ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(c => {
    if (U.SELECTABLE.indexOf(c) === -1) throw new Error(c + ' cannot be selected');
  });
  if (S.on !== false || S.count() !== 0) return 'selection mode does not start closed and empty';

  S.enter('tasks:one');
  if (!S.on || !S.has('tasks:one')) return 'entering selection mode did not pick the card it was given';
  if (S.toggle('tasks:two') !== true || S.count() !== 2) return 'a second card could not be picked';
  if (S.toggle('tasks:two') !== false || S.count() !== 1) return 'a picked card could not be un-picked';
  S.exit();
  if (S.on || S.count()) return 'leaving selection mode left state behind';
  return true;
});

check('"בחר הכל" picks exactly what the active view is showing', () => {
  const APP = loadApp(), U = APP.ui, S = U.Select;
  APP.Store.load();

  S.enter();
  const visible = S.visibleKeys();
  if (!visible.length) return 'the seeded store shows nothing selectable on "היום שלי"';
  if (visible.some(k => U.SELECTABLE.indexOf(k.split(':')[0]) === -1)) {
    return 'a key outside the selectable collections was offered';
  }
  if (S.all() !== visible.length) return 'בחר הכל picked a different number of cards';
  if (S.keys().sort().join(',') !== visible.slice().sort().join(',')) {
    return 'בחר הכל picked cards that are not on screen';
  }
  S.exit();
  return true;
});

check('a batch deletion removes every picked card and restores all of them at once', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const tasks = Store.data.tasks.map(t => t.id);
  const notes = Store.data.notes.map(n => n.id);
  if (tasks.length < 3 || !notes.length) return 'the seeded store is too small for a mixed batch';

  const keys = ['tasks:' + tasks[0], 'tasks:' + tasks[2], 'notes:' + notes[0]];
  const entry = U.softDeleteMany(keys);
  if (!entry) return 'softDeleteMany refused a live selection';
  if (entry.count !== 3) return 'the batch reported ' + entry.count + ' records, not 3';
  if (!entry.label || entry.label.indexOf('3') === -1) return 'the toast label does not name the batch';
  keys.forEach(k => {
    const p = k.split(':');
    if (Store.find(p[0], p[1])) throw new Error(k + ' never left the store');
  });
  if (!U.Undo.has()) return 'a batch deletion armed no undo';

  U.Undo.fire();
  if (Store.data.tasks.map(t => t.id).join(',') !== tasks.join(',')) {
    return 'the restored tasks came back in the wrong slots';
  }
  if (Store.data.notes.map(n => n.id).join(',') !== notes.join(',')) {
    return 'the restored note came back in the wrong slot';
  }
  if (U.Undo.has()) return 'the window stayed open after the batch was restored';
  if (U.softDeleteMany(['tasks:no_such_id'])) return 'a batch of nothing armed an undo';
  return true;
});

check('a restored batch replaces every queued tombstone', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = APP.sync;
  Store.load();
  const c = Store.data.sync;

  // drain: pretend the server applied everything, so the shadow is authoritative
  const batch = c.queue.slice();
  S.Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  const keys = [Store.data.tasks[0], Store.data.tasks[1]].map(t => 'tasks:' + t.id);
  U.softDeleteMany(keys);
  keys.forEach(k => {
    const id = k.split(':')[1];
    if (!c.queue.some(op => op.id === id && op.action === 'delete')) {
      throw new Error(k + ' never reached the outbox as a tombstone');
    }
  });

  U.Undo.fire();
  keys.forEach(k => {
    const id = k.split(':')[1];
    const ops = c.queue.filter(op => op.id === id);
    if (ops.length !== 1) throw new Error(k + ' holds ' + ops.length + ' ops');
    if (ops[0].action !== 'upsert') throw new Error(k + ' would still sync as a deletion');
  });
  return true;
});

check('the batch undo window is wider than a single deletion, and honoured', () => {
  const U = loadApp().ui;
  if (!(U.UNDO_BATCH_MS > U.UNDO_MS)) {
    return 'a whole batch gets no more time than one row (' + U.UNDO_BATCH_MS + 'ms)';
  }
  if (!/var UNDO_MS = 5000/.test(js)) return 'the single-row window is no longer 5 seconds';
  if (!/function toast\(msg, action, ms\)/.test(js)) return 'toast() cannot take a custom window';
  if (!/action \? \(ms \|\| UNDO_MS\) : TOAST_MS/.test(js)) return 'the custom window is ignored';

  const run = bodyOf(js, 'run: function (action)');
  if (!run) return 'no Select.run()';
  if (run.indexOf('confirmDelete(') === -1) return 'a batch is deleted without asking first';
  if (run.indexOf('softDeleteMany(') === -1) return 'the batch deletion bypasses the undo layer';
  if (run.indexOf('UNDO_BATCH_MS') === -1) return 'the batch toast uses the short window';
  return true;
});

check('batch completion closes tasks, fills checklists and reports what it changed', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = U.Select;
  Store.load();

  const open = Store.data.tasks.filter(t => !APP.tasks.isClosed(t.status))[0];
  const list = Store.data.lists.filter(l => l.items.some(i => !i.done))[0];
  if (!open || !list) return 'the seeded store has no open task and unfinished list to close';

  const keys = ['tasks:' + open.id, 'lists:' + list.id];
  const did = S.complete(keys);
  if (did.tasks !== 1 || did.lists !== 1) {
    return 'the batch reported {tasks:' + did.tasks + ', lists:' + did.lists + '}';
  }
  if (Store.find('tasks', open.id).status !== 'done') return 'the task was not closed';
  if (Store.find('tasks', open.id).done !== true) return 'the legacy done flag drifted from the status';
  if (Store.find('lists', list.id).items.some(i => !i.done)) return 'the checklist was not filled';

  const again = S.complete(keys);
  if (again.tasks || again.lists) return 'a finished batch was counted a second time';
  if (S.complete(['clients:' + Store.data.clients[0].id]).tasks) return 'a client was closed as a task';
  return true;
});

check('selection mode owns every tap that lands on a card', () => {
  const tap = bodyOf(js, 'tap: function (target)');
  if (!tap) return 'no Select.tap()';
  if (tap.indexOf("closest('[data-rec]')") === -1) return 'the tap is not resolved to a record';
  if (tap.indexOf('#batchBar,.sheet,.drawer,.topbar,.tabbar,.rail,.toast') === -1) {
    return 'a tap on the chrome would be swallowed as a selection';
  }
  if (tap.indexOf('Patch.record(') === -1) return 'picking a card repaints the whole app';

  const onClick = (js.match(/function onClick\(e\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (onClick.indexOf('if (Select.tap(e.target)) return;') === -1) {
    return 'the delegate acts on a card before asking the selection layer';
  }
  const guard = onClick.indexOf('Select.tap(e.target)');
  const first = onClick.indexOf('el.dataset.');
  if (guard === -1 || (first !== -1 && guard > first)) {
    return 'a control branch runs before the selection layer sees the tap';
  }
  return true;
});

/* ---- 23d. shipped shell and specification ---- */

check('the service worker cache version was bumped for waves 1–3', () => {
  const m = read('sw.js').match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[1], 10) < 10) return 'the cache is still v' + m[1] + ' — returning phones keep the old shell';
  return true;
});

check('PROJECT_PLAN documents waves 1–3', () => {
  const required = [
    'גל 1', 'גל 2', 'גל 3', 'pointer-events', 'Fab.decide', 'timelineKeys',
    CONFIRM_Q, 'mergeChecklist', 'softDeleteMany', '--dim-done', 'v10'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   24. Sprint 8 — the completion gesture, סל מחזור, universal tap-to-edit

   §1  a task is completed by a 400ms gesture: the ✓ draws itself, the title
       strikes through, the card dims, a dual pulse fires — THEN it files
   §2  the mandated confirmation carries the mandated button labels, and the
       one deletion with no net behind it asks like every other
   §3  a deleted record waits ten days in סל מחזור, counting down, restorable
       into the exact slot it left, and auto-purged on the next app start
   §4  a tap on a card body opens that card's own form, pre-filled
   §5  cards arrive and leave with a collapse, never a blink
   ========================================================================== */

/* ---- 24a. the completion gesture, executed ---- */

check('completing a task is a gesture, not an instant state change', () => {
  const U = loadApp().ui;
  const C = U.Complete;
  if (!C || typeof C.plan !== 'function') return 'no APP.ui.Complete.plan()';

  if (U.COMPLETE_MS !== 400) return 'the celebration window is ' + U.COMPLETE_MS + 'ms, not 400ms';
  if (U.HAPTIC_CHECK.join(',') !== '15,30,15') {
    return 'the dual pulse is [' + U.HAPTIC_CHECK.join(',') + '], not [15,30,15]';
  }

  const open = C.plan({ id: 't1', status: 'todo' });
  if (!open.closing) return 'closing an open task is not treated as a completion';
  if (open.delay !== 400) return 'the gesture waits ' + open.delay + 'ms before the record moves';
  if (!open.haptic || open.haptic.join(',') !== '15,30,15') return 'the completion fires no dual pulse';

  // re-opening a finished task is a correction, not an achievement: running
  // the celebration backwards would read as the app undoing the user
  const shut = C.plan({ id: 't1', status: 'done' });
  if (shut.closing) return 'un-checking a done task still celebrates';
  if (shut.delay !== 0) return 'un-checking is delayed by ' + shut.delay + 'ms for no reason';
  if (shut.haptic) return 'un-checking fires the completion pulse';

  if (C.plan(null) !== null) return 'plan() invented a gesture for no task';
  return true;
});

check('the gesture buzzes once, commits once, and never runs backwards', () => {
  const APP = loadApp({ navigator: { vibrate: p => { APP.__buzz.push(p); return true; } } });
  APP.__buzz = [];
  const U = APP.ui, C = U.Complete;

  // nothing is on screen in a headless run, so run() degrades to a straight
  // synchronous commit — the deletion/completion semantics must be identical
  let ran = 0;
  const plan = C.run({ id: 'x1', status: 'todo' }, () => { ran++; });
  if (!plan || !plan.closing) return 'run() did not plan a completion';
  if (ran !== 1) return 'the commit ran ' + ran + ' times off screen';
  if (APP.__buzz.length !== 1) return 'the completion fired ' + APP.__buzz.length + ' haptic patterns';
  if (APP.__buzz[0].join(',') !== '15,30,15') return 'the pulse was not the mandated dual beat';

  APP.__buzz.length = 0;
  let back = 0;
  C.run({ id: 'x1', status: 'done' }, () => { back++; });
  if (back !== 1) return 'un-checking did not commit';
  if (APP.__buzz.length) return 'un-checking buzzed like a completion';

  if (C.run({ id: 'x1', status: 'todo' }, null)) return 'a gesture was armed with nothing to commit';
  return true;
});

check('the ✓ is always in the DOM, and CSS is what draws it', () => {
  // a glyph swapped in at completion time can only appear; a stroke-dashed
  // path can be drawn, which is what the mandate asks for
  if (js.indexOf("var CHECK_MARK =") === -1) return 'no CHECK_MARK fragment';
  if (js.indexOf('<span class="check">' + "' + CHECK_MARK + '") === -1) {
    return 'the check circle does not always carry the mark';
  }
  if (/\(t\.done \? '✓' : ''\)/.test(js)) return 'the circle still swaps a glyph in and out';
  if (!/stroke="currentColor"/.test(js)) return 'the mark cannot inherit the circle colour';

  const mark = (css.match(/\.check-mark path\{[^}]*\}/) || [''])[0];
  if (!mark) return 'no .check-mark path rule';
  if (!/stroke-dasharray:\s*\d+/.test(mark)) return 'the path is not dashed, so it cannot be drawn';
  if (!/stroke-dashoffset:\s*\d+/.test(mark)) return 'the path is not held back at rest';
  if (!/transition:\s*stroke-dashoffset/.test(mark)) return 'the offset snaps instead of drawing';

  const drawn = (css.match(/\.row\.is-done \.check-mark path,\s*\n\.row\.is-completing \.check-mark path\{[^}]*\}/) || [''])[0];
  if (!drawn) return 'nothing releases the path';
  if (!/stroke-dashoffset:\s*0/.test(drawn)) return 'the released path is still held back';
  return true;
});

check('the gesture strikes the title through and dims the card while it runs', () => {
  const rules = cssRules(css);

  const sweep = rules.filter(r => r.sel === '.row-title::after')[0];
  if (!sweep) return 'no sweeping strikethrough element';
  if (!/inline-size:\s*0/.test(sweep.body)) return 'the strikethrough starts drawn';
  if (!/transition:\s*inline-size/.test(sweep.body)) return 'the strikethrough snaps instead of sweeping';
  const run = rules.filter(r => r.sel === '.row.is-completing .row-title::after')[0];
  if (!run || !/inline-size:\s*100%/.test(run.body)) return 'the strikethrough never crosses the title';

  // ...and the settled state is the real text-decoration the mandate names,
  // so the sweep hands off to it instead of competing with it
  if (!/\.row\.is-done \.row-title\{[^}]*text-decoration:\s*line-through/.test(css)) {
    return 'a finished title carries no text-decoration:line-through';
  }

  const dim = rules.filter(r => r.sel === '.row.is-completing')[0];
  if (!dim || !/opacity:\s*var\(--dim-done\)/.test(dim.body)) {
    return 'the card does not recede to where a finished card lives';
  }
  const circle = rules.filter(r => r.sel === '.row.is-completing .check')[0];
  if (!circle || !/background:\s*var\(--personal\)/.test(circle.body)) {
    return 'the circle does not fill while the mark is drawn';
  }
  return true;
});

check('the check circle hands the record over only after the gesture', () => {
  const branch = (js.match(/if \(el\.dataset\.toggle\) \{[\s\S]*?\n    \}/) || [''])[0];
  if (!branch) return 'no toggle branch in the delegate';
  if (branch.indexOf('Complete.run(') === -1) return 'the tap still mutates the store immediately';
  if (branch.indexOf('toggleTaskDone(') === -1) return 'the commit no longer closes the task';
  const paint = bodyOf(js, 'paint: function (id)');
  if (!paint || paint.indexOf("classList.add('is-completing')") === -1) {
    return 'the gesture is never painted onto the live node';
  }
  return true;
});

/* ---- 24b. the confirmation modal, with the mandated labels ---- */

check('the confirmation carries the two mandated buttons, and only one destroys', () => {
  const sheet = (html.match(/<div class="sheet confirm"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
  if (!sheet) return 'no confirmation sheet';
  if (sheet.indexOf('>אישור מחיקה<') === -1) return 'the accept button is not labelled אישור מחיקה';
  if (sheet.indexOf('>ביטול<') === -1) return 'the cancel button is not labelled ביטול';
  if (!/class="btn btn-danger"[^>]*data-confirmdel/.test(sheet)) {
    return 'the destructive button does not read as destructive';
  }
  if (!/class="btn btn-ghost"[^>]*close-confirm/.test(sheet)) return 'ביטול is not the neutral button';
  if (!/\.btn-danger\{\s*background:var\(--danger\)/.test(css)) return 'the danger button has no danger colour';
  if (!/\.confirm-what\{[^}]*border:1px solid var\(--danger-edge\)/.test(css)) {
    return 'the confirmation panel is not the dark-gold/danger surface it was specified as';
  }
  return true;
});

check('a permanent deletion asks before it destroys the last copy', () => {
  const door = bodyOf(js, 'function runTrashAction(');
  if (!door) return 'no runTrashAction()';
  if (door.indexOf('confirmDelete(') === -1) return 'מחק לצמיתות destroys without asking';
  if (door.indexOf('trashPurge(') === -1) return 'the confirmed purge does not reach the bin';
  // the confirmation must sit ABOVE the bin it was asked from — same z-index,
  // so document order is the only thing deciding it
  if (html.indexOf('id="trashSheet"') > html.indexOf('id="confirmSheet"')) {
    return 'the confirmation would open behind the recycle bin';
  }
  if (js.indexOf("if (el.dataset.trash) {") === -1) return 'the bin actions are not in the click delegate';
  return true;
});

/* ---- 24c. the 10-day recycle bin, executed ---- */

check('the bin holds every deletable type for exactly ten days', () => {
  const U = loadApp().ui;
  if (U.TRASH_DAYS !== 10) return 'the retention window is ' + U.TRASH_DAYS + ' days, not 10';
  if (U.DAY_MS !== 86400000) return 'a day is not a day';
  ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(c => {
    if (!U.TRASH_LABEL[c]) throw new Error(c + ' has no label in the bin');
  });
  if (html.indexOf('id="trashSheet"') === -1) return 'no סל מחזור surface';
  if (html.indexOf('id="trashBtn"') === -1) return 'the bin is not reachable from the header';
  if (html.indexOf('data-action="trash"') === -1) return 'the bin pill is not wired';
  if (html.indexOf('סל מחזור') === -1) return 'the bin is not named in Hebrew';
  if (js.indexOf('data-trash="restore:') === -1) return 'no שחזר action';
  if (js.indexOf('data-trash="purge:') === -1) return 'no מחק לצמיתות action';
  return true;
});

check('the countdown never claims more time than an entry actually has', () => {
  const U = loadApp().ui;
  const DAY = U.DAY_MS;
  const now = 1800000000000;               // a fixed clock — no wall time in a test
  const at = d => ({ collection: 'tasks', id: 't', rec: {}, index: 0, deletedAt: now - d });

  const cases = [
    [0, 10, 'the moment it was deleted'],
    [DAY * 0.5, 10, 'half a day in'],
    [DAY * 1, 9, 'one full day in'],
    [DAY * 9, 1, 'the last day'],
    [DAY * 9.99, 1, 'the last hour'],
    [DAY * 10, 0, 'exactly ten days'],
    [DAY * 12, 0, 'long past due']
  ];
  for (const [age, want, why] of cases) {
    const got = U.trashDaysLeft(at(age), now);
    if (got !== want) return why + ': ' + got + ' days left, expected ' + want;
  }

  if (U.trashExpired(at(DAY * 9.99), now)) return 'an entry with hours left was called expired';
  if (!U.trashExpired(at(DAY * 10), now)) return 'an entry at exactly ten days was not expired';

  // and the sentence the mandate asks for, in all three of its shapes
  if (U.retentionCountdown(10).indexOf('יימחק לצמיתות בעוד 10 ימים') === -1) {
    return 'the countdown does not read "יימחק לצמיתות בעוד 10 ימים"';
  }
  if (U.retentionCountdown(1).indexOf('יום אחד') === -1) return 'the last day is not declined in Hebrew';
  if (U.retentionCountdown(0).indexOf('היום') === -1) return 'the final day says nothing';
  return true;
});

check('a deletion moves the record into the bin with the slot it left', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  if (ids.length < 3) return 'the seeded store is too small';
  const victim = ids[1];
  const before = Date.now();

  U.softDelete('tasks', victim);
  U.Undo.commit();                          // the five seconds ran out

  if (Store.find('tasks', victim)) return 'the record never left its collection';
  const entry = U.trashFind(victim);
  if (!entry) return 'the deleted record is not in the bin';
  if (entry.collection !== 'tasks') return 'the bin forgot which collection it came from';
  if (entry.index !== 1) return 'the bin recorded slot ' + entry.index + ', not 1';
  if (!(entry.deletedAt >= before)) return 'the entry carries no deletion stamp';
  if (U.trashDaysLeft(entry) !== 10) return 'a fresh entry does not start at ten days';

  // ...and the cloud already knows: the record leaving its collection is what
  // queues the tombstone D1 writes into deleted_at
  const op = Store.data.sync.queue.filter(o => o.id === victim && o.action === 'delete')[0];
  if (!op) return 'the deletion never reached the outbox as a tombstone';
  return true;
});

check('שחזר puts the record back in the exact slot it came from', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = APP.sync;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  const victim = ids[1];

  // drain the outbox first, so the ops this test reads are its own
  const batch = Store.data.sync.queue.slice();
  S.Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  U.softDelete('tasks', victim);
  U.Undo.commit();

  const back = U.trashRestore(victim);
  if (!back) return 'the bin refused to restore a live entry';
  if (Store.data.tasks.map(t => t.id).join(',') !== ids.join(',')) {
    return 'the restored record came back in the wrong slot';
  }
  if (U.trashFind(victim)) return 'the entry stayed in the bin after being restored';

  // the restore must REPLACE the queued tombstone, or it would sync as a delete
  const ops = Store.data.sync.queue.filter(o => o.id === victim);
  if (ops.length !== 1) return 'the outbox holds ' + ops.length + ' ops for one record';
  if (ops[0].action !== 'upsert') return 'the restored record would still sync as a deletion';

  if (U.trashRestore(victim)) return 'a second restore invented an entry';
  return true;
});

check('מחק לצמיתות is the one deletion with nothing behind it', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const victim = Store.data.notes[0];
  if (!victim) return 'no seeded note';

  U.softDelete('notes', victim.id);
  U.Undo.commit();
  if (!U.trashFind(victim.id)) return 'the note never reached the bin';

  const gone = U.trashPurge(victim.id);
  if (!gone) return 'the purge refused a live entry';
  if (U.trashFind(victim.id)) return 'the entry survived its own permanent deletion';
  if (Store.find('notes', victim.id)) return 'the record came back from a permanent deletion';
  if (U.trashRestore(victim.id)) return 'a purged record is still restorable';
  if (U.trashPurge(victim.id)) return 'a second purge invented an entry';
  return true;
});

check('the bin empties itself on the way in, before a single row is painted', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const DAY = U.DAY_MS;

  // the auto-purge must run inside load(), not on some later timer: an expired
  // record may never be offered for restore, not even for one frame
  const load = bodyOf(js, 'load: function ()');
  if (!load || load.indexOf('purgeTrash()') === -1) return 'nothing purges the bin at start-up';
  if (load.indexOf('normTrash(') === -1) return 'a corrupt bin would reach a render';

  Store.data.trash = U.normTrash([
    { collection: 'tasks', id: 'old', rec: { id: 'old', title: 'ישן' }, index: 0, deletedAt: Date.now() - DAY * 11 },
    { collection: 'notes', id: 'edge', rec: { id: 'edge', title: 'בדיוק' }, index: 0, deletedAt: Date.now() - DAY * 10 },
    { collection: 'tasks', id: 'fresh', rec: { id: 'fresh', title: 'טרי' }, index: 0, deletedAt: Date.now() - DAY * 9 }
  ]);
  if (Store.data.trash.length !== 3) return 'normTrash dropped a valid entry';

  const went = U.purgeTrash();
  if (went !== 2) return 'the purge took ' + went + ' entries, not the 2 that were due';
  if (U.trashCount() !== 1) return 'the bin holds ' + U.trashCount() + ' entries after the purge';
  if (!U.trashFind('fresh')) return 'the purge took an entry that still had a day left';

  // and a bin full of garbage is dropped rather than rendered
  const clean = U.normTrash([
    null, 'nope', { collection: 'tasks' }, { id: 'x', collection: 'nothing', rec: {} },
    { id: 'y', collection: 'tasks', rec: { id: 'y' } }                     // no stamp
  ]);
  if (clean.length !== 1) return 'normTrash kept ' + clean.length + ' of 5 malformed rows';
  if (!(clean[0].deletedAt > 0)) return 'a stamp-less entry was not given one';
  return true;
});

check('the bin lists newest first and counts down on every row', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const DAY = U.DAY_MS, now = Date.now();

  Store.data.trash = U.normTrash([
    { collection: 'tasks', id: 'a', rec: { id: 'a', title: 'ישן יותר' }, index: 0, deletedAt: now - DAY * 4 },
    { collection: 'notes', id: 'b', rec: { id: 'b', title: 'נמחק עכשיו' }, index: 0, deletedAt: now }
  ]);

  const list = U.trashList();
  if (list[0].id !== 'b') return 'the bin does not put the newest deletion on top';

  const row = U.trashRow(list[0], now);
  if (row.indexOf('נמחק עכשיו') === -1) return 'the row does not name the record';
  if (row.indexOf('יימחק לצמיתות בעוד 10 ימים') === -1) return 'the row shows no countdown';
  if (row.indexOf('data-trash="restore:b"') === -1) return 'the row offers no שחזר';
  if (row.indexOf('data-trash="purge:b"') === -1) return 'the row offers no מחק לצמיתות';
  if (row.indexOf('פתק') === -1) return 'the row does not say what kind of record it holds';

  // an entry in its last 48 hours reads as urgent, not as one more grey chip
  const urgent = U.trashRow(U.normTrash([
    { collection: 'tasks', id: 'c', rec: { id: 'c', title: 'כמעט' }, index: 0, deletedAt: now - DAY * 9 }
  ])[0], now);
  if (urgent.indexOf('pr-high') === -1) return 'an entry about to be purged looks like any other';
  return true;
});

check('אחזר and the bin are one move seen at two timescales', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  U.softDelete('tasks', ids[0]);
  if (!U.trashFind(ids[0])) return 'the five-second window bypassed the bin';
  if (!U.Undo.has()) return 'the deletion armed no undo';

  U.Undo.fire();
  if (!Store.find('tasks', ids[0])) return 'אחזר did not bring the record back';
  if (U.trashFind(ids[0])) return 'אחזר left a duplicate entry in the bin';
  if (Store.data.tasks.map(t => t.id).join(',') !== ids.join(',')) return 'אחזר restored to the wrong slot';

  // ...and the same holds for a whole batch
  const keys = [ids[0], ids[2]].map(i => 'tasks:' + i);
  U.softDeleteMany(keys);
  if (U.trashCount() !== 2) return 'a batch deletion put ' + U.trashCount() + ' of 2 records in the bin';
  U.Undo.fire();
  if (U.trashCount()) return 'the batch undo left entries behind in the bin';
  if (Store.data.tasks.map(t => t.id).join(',') !== ids.join(',')) return 'the batch came back out of order';
  return true;
});

check('a stale cloud row cannot resurrect a record that is sitting in the bin', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, S = APP.sync;
  Store.load();

  const victim = Store.data.tasks[0];
  const row = S.toRow('tasks', victim);

  U.softDelete('tasks', victim.id);
  U.Undo.commit();

  // the server has not seen the tombstone yet and pushes the record back
  row.updated_at = S.toISOStamp(Date.now() - 60000);
  S.Sync.merge({ tasks: [row] });
  if (Store.find('tasks', victim.id)) return 'a stale server copy walked back onto the board';
  if (!U.trashFind(victim.id)) return 'the bin lost the entry it was holding';

  // ...but a genuinely newer server copy means the record is alive again, and
  // the bin must step aside rather than keep offering to destroy it
  row.updated_at = S.toISOStamp(Date.now() + 60000);
  S.Sync.merge({ tasks: [row] });
  if (!Store.find('tasks', victim.id)) return 'a newer server copy was blocked by the bin';
  if (U.trashFind(victim.id)) return 'the record is live AND still purgeable from the bin';
  return true;
});

/* ---- 24d. universal tap-to-edit ---- */

check('a tap on a card body opens that card for editing', () => {
  const U = loadApp().ui;
  ['events', 'tasks', 'lists', 'notes'].forEach(c => {
    if (U.TAP_EDIT.indexOf(c) === -1) throw new Error(c + ' cards cannot be opened by tapping them');
  });
  // a client card opens the full client file — a richer surface than the form
  if (U.TAP_EDIT.indexOf('clients') !== -1) return 'tapping a client card no longer opens its file';

  const gate = bodyOf(js, 'function tapEditKey(');
  if (!gate) return 'no tapEditKey()';
  if (gate.indexOf("closest('[data-rec]')") === -1) return 'the tap is not resolved to a record';
  if (gate.indexOf('Select.on') === -1) return 'a tap in selection mode would open a form';
  if (gate.indexOf('Confirm.isOpen()') === -1) return 'a tap behind the confirmation would open a form';
  if (gate.indexOf("$('#formSheet').hidden") === -1) return 'a tap inside an open form would open a second one';
  if (gate.indexOf('is-leaving') === -1) return 'a card mid-collapse is still editable';

  const onClick = (js.match(/function onClick\(e\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (onClick.indexOf('tapEditKey(e.target)') === -1) return 'the delegate never asks the edit gate';
  if (onClick.indexOf('openEdit(') === -1) return 'the tap does not reach the typed form';
  // the controls INSIDE a card must keep winning: the gate only ever sees a
  // tap that matched no control at all
  const gateAt = onClick.indexOf('if (!el) {');
  if (gateAt === -1 || onClick.indexOf('tapEditKey(e.target)') < gateAt) {
    return 'the edit gate runs before the control branches it is supposed to yield to';
  }
  return true;
});

/* ---- 24e. cards arrive and leave, and the shipped shell ---- */

check('a card collapses and fades out instead of blinking away', () => {
  const out = (css.match(/@keyframes card-out\{[\s\S]*?\n\}/) || [''])[0];
  if (!out) return 'no exit animation';
  if (!/opacity:\s*0/.test(out)) return 'the card does not fade out';
  if (!/max-height:\s*0/.test(out)) return 'the card does not collapse its height';
  const leaving = cssRules(css).filter(r => r.sel.indexOf('.row.is-leaving') !== -1)[0];
  if (!leaving) return 'nothing wears the leaving state';
  if (!/animation:\s*card-out/.test(leaving.body)) return 'the leaving card is not animated out';
  if (!/pointer-events:\s*none/.test(leaving.body)) return 'a card on its way out still takes taps';

  if (!/@keyframes card-in\{/.test(css)) return 'no entrance animation';
  // an opacity keyframe with a fill would out-rank opacity:var(--dim-done)
  // and silently un-dim every finished card on the board
  const inKf = (css.match(/@keyframes card-in\{[\s\S]*?\n\}/) || [''])[0];
  if (/opacity:/.test(inKf)) return 'the entrance animates opacity and would defeat --dim-done';

  const door = bodyOf(js, 'function leaveThen(');
  if (!door) return 'no leaveThen()';
  if (door.indexOf("classList.add('is-leaving')") === -1) return 'the collapse is never painted';
  if (door.indexOf('if (!nodes.length) { run(); return false; }') === -1) {
    return 'a headless deletion would wait on a timer that never fires';
  }
  if (bodyOf(js, 'function askDelete(').indexOf('leaveThen(') === -1) {
    return 'a deleted row still blinks out of its list';
  }
  return true;
});

/* ========================================================================== */
/* ====== 25. Sprint 9 — in-place completion, היסטוריה & the shake ========== */
/* ========================================================================== */

/* ---- 25a. the tick keeps the task exactly where it is ---- */

check('ticking a task does not move it, hide it, or re-sort its list', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();

  // an untimed task due today: it lives in "לביצוע היום" AND in the tasks list
  const victim = Store.data.tasks.filter(t => t.due === APP.isoDate(new Date()) && !t.time)[0];
  if (!victim) return 'the seeded store has no untimed task due today';

  const boardBefore = U.recKeys('tasks', U.boardTasksToday());
  const shownBefore = U.recKeys('tasks', U.shownTasks());
  const slotBefore = Store.data.tasks.indexOf(victim);
  if (boardBefore.indexOf('tasks:' + victim.id) === -1) return 'the task was not on the board to begin with';

  T.toggleTaskDone(victim);
  if (T.normStatus(victim.status) !== 'done') return 'the tick did not complete the task';

  const boardAfter = U.recKeys('tasks', U.boardTasksToday());
  const shownAfter = U.recKeys('tasks', U.shownTasks());

  // the three things the mandate forbids: leaving the list, moving inside it,
  // and forcing the container that holds it to be rebuilt
  if (boardAfter.indexOf('tasks:' + victim.id) === -1) return 'the completed task left today\'s board';
  if (!U.sameKeys(boardBefore, boardAfter)) {
    return 'the board membership moved: ' + boardBefore.join(',') + ' => ' + boardAfter.join(',');
  }
  if (!U.sameKeys(shownBefore, shownAfter)) {
    return 'the tasks list membership moved: ' + shownBefore.join(',') + ' => ' + shownAfter.join(',');
  }
  if (Store.data.tasks.indexOf(victim) !== slotBefore) return 'the record moved inside the store';

  // sameKeys(before, after) === true is exactly what makes Patch.settle() pass
  // `quiet` to the renderer, so no innerHTML is written and nothing flickers
  return true;
});

check('the check circle commits in place — no render(), no leaveThen()', () => {
  const branch = (js.match(/if \(el\.dataset\.toggle\) \{[\s\S]*?\n    \}/) || [''])[0];
  if (!branch) return 'no toggle branch in the delegate';
  if (branch.indexOf('Complete.run(') === -1) return 'the 400ms gesture was dropped';
  if (branch.indexOf('Patch.apply(') === -1) return 'the tick no longer patches the row in place';
  // a full render() or a collapse would be exactly the "moves / hides" the
  // mandate forbids
  if (/\brender\(\)/.test(branch)) return 'the tick still triggers a full repaint';
  if (branch.indexOf('leaveThen(') !== -1) return 'the tick still collapses the card out of its list';
  // filing is a separate, deliberate act — the tick must never reach the log
  if (/archive(Done|Put)\(/.test(branch)) return 'the tick files the task instead of leaving it in place';
  return true;
});

check('a completed task is drawn struck through and dimmed, in place', () => {
  const rules = cssRules(css);
  // the sweep (animated) hands off to the real text-decoration (settled)
  const done = rules.filter(r => r.sel === '.row.is-done .row-title')[0];
  if (!done || !/text-decoration:\s*line-through/.test(done.body)) {
    return 'a finished title carries no line-through';
  }
  const dim = rules.filter(r => r.sel.indexOf('.row.is-done') !== -1 && /opacity:\s*var\(--dim-done\)/.test(r.body))[0];
  if (!dim) return 'a finished card is not dimmed';
  // "dim it SLIGHTLY" — a card the user can still read and still tap
  const val = (css.match(/--dim-done:\s*\.?(\d*\.?\d+)/) || [])[1];
  if (!val || parseFloat('0' + (val.startsWith('.') ? val : '.' + val)) < 0.4) {
    return '--dim-done is ' + val + ' — a finished card is faded past legibility';
  }
  // and the row must still be a live target: universal edit reaches it
  const leaving = rules.filter(r => r.sel.indexOf('.row.is-leaving') !== -1)[0];
  if (leaving && /pointer-events:\s*none/.test(done.body)) return 'a finished card stops taking taps';
  return true;
});

/* ---- 25b. the manual archive button ---- */

check('the archive button is present, mandated-labelled and carries its count', () => {
  const U = loadApp().ui;
  if (U.ARCHIVE_LABEL !== 'העבר משימות שבוצעו להיסטוריה') {
    return 'the button is labelled "' + U.ARCHIVE_LABEL + '", not the mandated sentence';
  }
  if (U.ARCHIVE_DAYS !== 10) return 'the log holds work for ' + U.ARCHIVE_DAYS + ' days, not 10';

  const bar = U.archiveBarHTML(3);
  if (bar.indexOf(U.ARCHIVE_LABEL) === -1) return 'the button does not carry its label';
  if (bar.indexOf('>3<') === -1) return 'the button does not carry the count it promises to move';
  if (bar.indexOf('data-action="archive-done"') === -1) return 'the button is not wired to the action';
  if (bar.indexOf('btn-gold') === -1) return 'the primary action does not read as primary';

  // it is painted everywhere a finger finishes a task, off one piece of state
  ['id="archiveBarToday"', 'id="archiveBarTasks"'].forEach(id => {
    if (html.indexOf(id) === -1) throw new Error('no archive bar at ' + id);
  });
  const paint = bodyOf(js, 'function renderArchiveBar(');
  if (!paint) return 'no renderArchiveBar()';
  if (paint.indexOf('#archiveBarToday') === -1 || paint.indexOf('#archiveBarTasks') === -1) {
    return 'the two bars are not painted from the same state';
  }
  if (paint.indexOf('doneUnfiled()') === -1) return 'the count is not derived from the completed tasks';
  if (paint.indexOf('box.hidden = !n') === -1) return 'the button stays on screen with nothing to do';
  if (js.indexOf("if (el.dataset.action === 'archive-done')") === -1) {
    return 'the archive action is not in the click delegate';
  }
  return true;
});

check('the pending count respects the global category filter', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();
  Store.data.tasks.forEach(t => T.setTaskStatus(t, 'done'));

  const all = U.doneUnfiled().length;
  if (!all) return 'nothing was completed';

  Store.data.prefs.filter = 'business';
  const business = U.doneUnfiled().length;
  Store.data.prefs.filter = 'personal';
  const personal = U.doneUnfiled().length;
  Store.data.prefs.filter = 'all';

  if (business + personal !== all) {
    return 'the filtered counts (' + business + '+' + personal + ') do not add up to ' + all;
  }
  if (business === all) return 'the count ignores the filter — it would move rows off screen';
  return true;
});

/* ---- 25c. the archive move, executed ---- */

check('the archive button files every completed task, with the slot it left', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  if (ids.length < 3) return 'the seeded store is too small';

  // tick the middle one only — the log must take exactly that, and nothing else
  const victim = Store.data.tasks[1];
  T.toggleTaskDone(victim);
  Store.save();

  const filed = U.archiveDone();
  if (!filed) return 'the archive refused a completed task';
  if (filed.count !== 1) return 'the archive moved ' + filed.count + ' tasks, not the 1 that was ticked';

  if (Store.find('tasks', victim.id)) return 'the filed task never left its collection';
  if (Store.data.tasks.length !== ids.length - 1) return 'the archive took a task it was not given';

  const entry = U.archiveFind(victim.id);
  if (!entry) return 'the filed task is not in the log';
  if (entry.collection !== 'tasks') return 'the log forgot what it is holding';
  if (entry.index !== 1) return 'the log recorded slot ' + entry.index + ', not 1';
  if (U.archiveDaysLeft(entry) !== 10) return 'a fresh entry does not start at ten days';

  // it is a distinct drawer: the bin must not have been touched
  if (U.trashCount()) return 'archiving put ' + U.trashCount() + ' rows in the recycle bin';

  // ...and the cloud already knows — the task leaving its collection is what
  // queues the tombstone D1 writes into deleted_at
  const op = Store.data.sync.queue.filter(o => o.id === victim.id && o.action === 'delete')[0];
  if (!op) return 'the filing never reached the outbox as a tombstone';

  // nothing left to file, and the button says so rather than acting
  if (U.archiveDone()) return 'a second press filed something that was not there';
  return true;
});

check('the archive log counts down over exactly ten days', () => {
  const U = loadApp().ui;
  const DAY = U.DAY_MS;
  const now = 1800000000000;                 // a fixed clock — no wall time in a test
  const at = d => ({ collection: 'tasks', id: 't', rec: {}, index: 0, archivedAt: now - d });

  const cases = [
    [0, 10, 'the moment it was filed'],
    [DAY * 0.5, 10, 'half a day in'],
    [DAY * 1, 9, 'one full day in'],
    [DAY * 9, 1, 'the last day'],
    [DAY * 9.99, 1, 'the last hour'],
    [DAY * 10, 0, 'exactly ten days'],
    [DAY * 12, 0, 'long past due']
  ];
  for (const [age, want, why] of cases) {
    const got = U.archiveDaysLeft(at(age), now);
    if (got !== want) return why + ': ' + got + ' days left, expected ' + want;
  }
  if (U.archiveExpired(at(DAY * 9.99), now)) return 'an entry with hours left was called expired';
  if (!U.archiveExpired(at(DAY * 10), now)) return 'an entry at exactly ten days was not expired';

  // both drawers read the same clock, so one sentence can serve both
  if (U.retentionDaysLeft(now - DAY * 3, 10, now) !== 7) return 'the shared retention clock is wrong';
  if (U.retentionCountdown(10).indexOf('יימחק לצמיתות בעוד 10 ימים') === -1) {
    return 'the countdown sentence changed';
  }
  return true;
});

check('שחזר brings a filed task back into the exact slot it left', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store, S = APP.sync;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  const victim = Store.data.tasks[1];

  // drain the outbox first, so the ops this test reads are its own
  const batch = Store.data.sync.queue.slice();
  S.Sync.settle(batch, { applied: batch.map(o => o.opId), rejected: [], changes: {}, cursor: '' });

  T.toggleTaskDone(victim);
  U.archiveDone();
  U.Undo.commit();

  const back = U.archiveRestore(victim.id);
  if (!back) return 'the log refused to restore a live entry';
  if (Store.data.tasks.map(t => t.id).join(',') !== ids.join(',')) {
    return 'the restored task came back in the wrong slot';
  }
  if (U.archiveFind(victim.id)) return 'the entry stayed in the log after being restored';

  // the restore must REPLACE the queued tombstone, or it would sync as a delete
  const ops = Store.data.sync.queue.filter(o => o.id === victim.id);
  if (ops.length !== 1) return 'the outbox holds ' + ops.length + ' ops for one task';
  if (ops[0].action !== 'upsert') return 'the restored task would still sync as a deletion';

  if (U.archiveRestore(victim.id)) return 'a second restore invented an entry';
  return true;
});

check('one אחזר puts a whole archived batch back, front to back', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.map(t => t.id);
  if (ids.length < 3) return 'the seeded store is too small';

  // tick the first and the last, leaving a live task between them: restoring
  // ascending is what puts each one back in its own slot instead of shifting
  // the ones that follow it
  T.toggleTaskDone(Store.data.tasks[0]);
  T.toggleTaskDone(Store.data.tasks[ids.length - 1]);
  const filed = U.archiveDone();
  if (!filed || filed.count !== 2) return 'the batch filed ' + (filed && filed.count) + ' of 2';
  if (U.archiveCount() !== 2) return 'the log holds ' + U.archiveCount() + ' of 2 tasks';
  if (!U.Undo.has()) return 'the batch armed no undo';

  U.Undo.fire();
  if (U.archiveCount()) return 'the undo left entries behind in the log';
  if (Store.data.tasks.map(t => t.id).join(',') !== ids.join(',')) {
    return 'the batch came back out of order: ' + Store.data.tasks.map(t => t.id).join(',');
  }
  return true;
});

check('מחק לצמיתות in the log is final, and asks before it destroys', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();

  const victim = Store.data.tasks[0];
  T.toggleTaskDone(victim);
  U.archiveDone();
  if (!U.archiveFind(victim.id)) return 'the task never reached the log';

  const gone = U.archivePurge(victim.id);
  if (!gone) return 'the purge refused a live entry';
  if (U.archiveFind(victim.id)) return 'the entry survived its own permanent deletion';
  if (Store.find('tasks', victim.id)) return 'the task came back from a permanent deletion';
  if (U.archiveRestore(victim.id)) return 'a purged task is still restorable';
  if (U.archivePurge(victim.id)) return 'a second purge invented an entry';

  // ...and it goes through the one door every destructive tap goes through
  const door = bodyOf(js, 'function runArchiveAction(');
  if (!door) return 'no runArchiveAction()';
  if (door.indexOf('confirmDelete(') === -1) return 'מחק לצמיתות destroys without asking';
  if (door.indexOf('archivePurge(') === -1) return 'the confirmed purge does not reach the log';
  if (door.indexOf('archiveRestore(') === -1) return 'the log offers no way back';
  if (js.indexOf('if (el.dataset.arch) {') === -1) return 'the log actions are not in the click delegate';
  return true;
});

check('the log empties itself at start-up, before a single row is painted', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const DAY = U.DAY_MS;

  const load = bodyOf(js, 'load: function ()');
  if (!load || load.indexOf('purgeArchive()') === -1) return 'nothing purges the log at start-up';
  if (load.indexOf('normArchive(') === -1) return 'a corrupt log would reach a render';

  Store.data.archive = U.normArchive([
    { collection: 'tasks', id: 'old', rec: { id: 'old', title: 'ישן' }, index: 0, archivedAt: Date.now() - DAY * 11 },
    { collection: 'tasks', id: 'edge', rec: { id: 'edge', title: 'בדיוק' }, index: 0, archivedAt: Date.now() - DAY * 10 },
    { collection: 'tasks', id: 'fresh', rec: { id: 'fresh', title: 'טרי' }, index: 0, archivedAt: Date.now() - DAY * 9 }
  ]);
  if (Store.data.archive.length !== 3) return 'normArchive dropped a valid entry';

  const went = U.purgeArchive();
  if (went !== 2) return 'the purge took ' + went + ' entries, not the 2 that were due';
  if (U.archiveCount() !== 1) return 'the log holds ' + U.archiveCount() + ' entries after the purge';
  if (!U.archiveFind('fresh')) return 'the purge took an entry that still had a day left';

  // a log full of garbage is dropped rather than rendered
  const clean = U.normArchive([
    null, 'nope', { collection: 'tasks' }, { id: 'x', collection: 'notes', rec: {} },
    { id: 'y', collection: 'tasks', rec: { id: 'y' } }                    // no stamp
  ]);
  if (clean.length !== 1) return 'normArchive kept ' + clean.length + ' of 5 malformed rows';
  if (!(clean[0].archivedAt > 0)) return 'a stamp-less entry was not given one';
  return true;
});

check('a stale cloud row cannot resurrect a task sitting in the log', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store, S = APP.sync;
  Store.load();

  const victim = Store.data.tasks[0];
  const row = S.toRow('tasks', victim);

  T.toggleTaskDone(victim);
  U.archiveDone();
  U.Undo.commit();

  // the server has not seen the tombstone yet and pushes the task back
  row.updated_at = S.toISOStamp(Date.now() - 60000);
  S.Sync.merge({ tasks: [row] });
  if (Store.find('tasks', victim.id)) return 'a stale server copy walked back onto the board';
  if (!U.archiveFind(victim.id)) return 'the log lost the entry it was holding';

  // ...but a genuinely newer server copy means the task is alive again, and the
  // log must step aside rather than keep offering to destroy it
  row.updated_at = S.toISOStamp(Date.now() + 60000);
  S.Sync.merge({ tasks: [row] });
  if (!Store.find('tasks', victim.id)) return 'a newer server copy was blocked by the log';
  if (U.archiveFind(victim.id)) return 'the task is live AND still purgeable from the log';
  return true;
});

check('the log renders a countdown, a way back and a way out on every row', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();
  const DAY = U.DAY_MS, now = Date.now();

  Store.data.archive = U.normArchive([
    { collection: 'tasks', id: 'a', rec: { id: 'a', title: 'ישן יותר', category: 'business' }, index: 0, archivedAt: now - DAY * 4 },
    { collection: 'tasks', id: 'b', rec: { id: 'b', title: 'בוצע עכשיו', category: 'personal' }, index: 0, archivedAt: now }
  ]);

  const list = U.archiveList();
  if (list[0].id !== 'b') return 'the log does not put the newest filing on top';

  const row = U.archiveRow(list[0], now);
  if (row.indexOf('בוצע עכשיו') === -1) return 'the row does not name the task';
  if (row.indexOf('יימחק לצמיתות בעוד 10 ימים') === -1) return 'the row shows no countdown';
  if (row.indexOf('data-arch="restore:b"') === -1) return 'the row offers no שחזר';
  if (row.indexOf('data-arch="purge:b"') === -1) return 'the row offers no מחק לצמיתות';
  if (row.indexOf('אישי') === -1) return 'the row drops the category (§0.2)';

  // an entry in its last 48 hours reads as urgent, not as one more grey chip
  const urgent = U.archiveRow(U.normArchive([
    { collection: 'tasks', id: 'c', rec: { id: 'c', title: 'כמעט' }, index: 0, archivedAt: now - DAY * 9 }
  ])[0], now);
  if (urgent.indexOf('pr-high') === -1) return 'an entry about to be purged looks like any other';

  if (html.indexOf('id="archiveList"') === -1) return 'no היסטוריה surface in the document';
  if (html.indexOf('id="archiveMeta"') === -1) return 'the log carries no meta line';
  if (js.indexOf("$('#archiveList')") === -1) return 'the log container is never painted';
  return true;
});

check('היסטוריה and סל מחזור are two drawers, never one list', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();

  // deleting reaches the bin only; archiving reaches the log only
  U.softDelete('tasks', Store.data.tasks[0].id);
  U.Undo.commit();
  if (U.archiveCount()) return 'a deletion landed in the completed-tasks log';

  const next = Store.data.tasks[0];
  T.toggleTaskDone(next);
  U.archiveDone();
  U.Undo.commit();
  if (U.trashCount() !== 1) return 'archiving changed what the recycle bin holds';
  if (U.archiveCount() !== 1) return 'the filing did not reach the log';

  // and they are separate persisted arrays, so emptying one cannot empty the other
  if (Store.blank().archive === undefined) return 'the blank store has no archive';
  if (!Array.isArray(Store.data.archive) || !Array.isArray(Store.data.trash)) {
    return 'the two drawers are not two arrays';
  }
  if (js.indexOf('if (Array.isArray(parsed.archive)) d.archive = parsed.archive;') === -1) {
    return 'the log is not hydrated from localStorage — it would not survive a reload';
  }
  return true;
});

/* ---- 25d. the shake: the entrance is opt-in, and repaints are quiet ---- */

check('the entrance animation is gated, so a repaint cannot re-run it', () => {
  const rules = cssRules(css);
  const entering = rules.filter(r => /animation:\s*card-in/.test(r.body));
  if (!entering.length) return 'nothing runs the entrance animation any more';
  const ungated = entering.filter(r => r.sel.indexOf('.is-entering') === -1);
  if (ungated.length) {
    return 'card-in still runs unconditionally on: ' + ungated.map(r => r.sel).join(' | ');
  }
  // The class must be unreachable from markup, or the gate is decoration. Only
  // markEntering() may grant it, so with comments stripped there must be
  // exactly one mention of it in the whole file — that one classList.add.
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const grants = (code.match(/is-entering/g) || []).length;
  if (!grants) return 'nothing ever grants the entrance';
  if (grants > 1) return 'is-entering is written in ' + grants + ' places — a markup builder emits it too';
  if (code.indexOf("classList.add('is-entering')") === -1) {
    return 'the entrance is not granted by markEntering()';
  }
  return true;
});

check('markEntering only animates a record that was not already on screen', () => {
  // a stub DOM: three cards, and a querySelectorAll that reports whichever set
  // the test has staged. This executes the real gate, classList and all.
  const node = key => ({
    dataset: { rec: key },
    cls: [],
    classList: { add(c) { this.owner.cls.push(c); } }
  });
  const make = key => { const n = node(key); n.classList.owner = n; return n; };

  let staged = [];
  const APP = loadApp({ document: { querySelectorAll: () => staged } });
  const U = APP.ui;

  // first paint: everything on screen is new and every card rises
  staged = ['tasks:1', 'tasks:2'].map(make);
  U.markEntering();
  if (staged.some(n => n.cls.indexOf('is-entering') === -1)) return 'a first paint did not animate';

  // second paint: the SAME records, rebuilt in place — this is the repaint that
  // used to shake, and not one of them may move
  staged = ['tasks:1', 'tasks:2'].map(make);
  U.markEntering();
  if (staged.some(n => n.cls.length)) return 'a repaint of the same records re-ran the entrance';

  // a genuinely new record arriving beside them animates, the neighbours do not
  staged = ['tasks:1', 'tasks:2', 'tasks:3'].map(make);
  U.markEntering();
  if (staged[2].cls.indexOf('is-entering') === -1) return 'a genuinely new card did not animate';
  if (staged[0].cls.length || staged[1].cls.length) return 'an arriving card dragged its neighbours with it';

  // a record that left and came back is new again
  staged = ['tasks:3'].map(make);
  U.markEntering();
  staged = ['tasks:1', 'tasks:3'].map(make);
  U.markEntering();
  if (staged[0].cls.indexOf('is-entering') === -1) return 'a returning card did not animate';
  return true;
});

check('the derived surfaces are only rewritten when they actually changed', () => {
  const U = loadApp().ui;

  // setHTML / setText are the guard: an identical assignment tears down and
  // rebuilds every child node, restarting animations and dropping focus
  let writes = 0;
  const el = { _h: '', get innerHTML() { return this._h; }, set innerHTML(v) { writes++; this._h = v; } };
  U.setHTML(el, '<b>1</b>');
  U.setHTML(el, '<b>1</b>');
  U.setHTML(el, '<b>2</b>');
  if (writes !== 2) return 'setHTML wrote ' + writes + ' times for 2 distinct values';

  let texts = 0;
  const tx = { _t: '', get textContent() { return this._t; }, set textContent(v) { texts++; this._t = v; } };
  U.setText(tx, 'a'); U.setText(tx, 'a'); U.setText(tx, 'b');
  if (texts !== 2) return 'setText wrote ' + texts + ' times for 2 distinct values';

  // ...and the surfaces Patch.settle() touches on EVERY tap actually use them
  const settle = bodyOf(js, 'settle: function ()');
  if (!settle) return 'no Patch.settle()';
  ['renderSummary()', 'renderAttention()', 'renderArchiveBar()', 'markEntering()'].forEach(fn => {
    if (settle.indexOf(fn) === -1) throw new Error('settle() no longer calls ' + fn);
  });
  const att = bodyOf(js, 'function renderAttention(');
  if (att.indexOf('setHTML(') === -1) return 'the attention strip is rebuilt on every tap';
  const sum = bodyOf(js, 'function renderSummary(');
  if (sum.indexOf('setHTML(') === -1 || sum.indexOf('setText(') === -1) {
    return 'the summary is rebuilt on every tap';
  }
  const bar = bodyOf(js, 'function renderArchiveBar(');
  if (bar.indexOf('box.innerHTML !== next') === -1) return 'the archive bar is rebuilt on every tap';
  return true;
});

check('a closed dialog is not repainted behind the user\'s back', () => {
  const door = bodyOf(js, 'function renderTrash(');
  if (!door) return 'no renderTrash()';
  // the badge is cheap and must stay current; the LIST is a dialog nobody can
  // see, and rebuilding it cost a full innerHTML on every tap in the app
  if (door.indexOf("$('#trashCount')") === -1) return 'the bin badge is no longer refreshed';
  if (door.indexOf("$('#trashSheet')") === -1) return 'the bin list is rebuilt while the sheet is closed';
  if (!/sheet\.hidden/.test(door)) return 'the paint is not gated on the sheet being open';
  return true;
});

check('every element app.js paints actually exists in the document', () => {
  // a renderer that dereferences $('#typo') throws on the spot and takes the
  // whole paint with it — and no static check above would have noticed
  const ids = new Set();
  const re = /\$\('#([A-Za-z][\w-]*)'\)/g;
  let m;
  while ((m = re.exec(js))) ids.add(m[1]);
  if (ids.size < 40) return 'only ' + ids.size + ' ids found — the scan is not seeing app.js';

  const missing = [...ids].filter(id => html.indexOf('id="' + id + '"') === -1);
  if (missing.length) return 'app.js paints ids the document does not ship: ' + missing.join(', ');

  // and the Sprint 9 surfaces specifically. The two bars are selected through a
  // variable — one renderer, two targets — so look for the selector literal
  // rather than the $('#id') form.
  ['archiveBarToday', 'archiveBarTasks', 'archiveList', 'archiveMeta'].forEach(id => {
    if (html.indexOf('id="' + id + '"') === -1) throw new Error('the document ships no #' + id);
    if (js.indexOf("'#" + id + "'") === -1) throw new Error('nothing paints #' + id);
  });
  return true;
});

check('no hover lift survives outside a fine pointer', () => {
  const gate = '@media (hover:hover) and (pointer:fine)';
  if (css.indexOf(gate) === -1) return 'no hover-capable media query';

  // strip the gated block, then no :hover rule left may move anything: on a
  // touch screen :hover latches after a tap and leaves the card out of place
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(gate);
  const before = clean.slice(0, at);
  const after = clean.slice(clean.indexOf('}', clean.indexOf('}', at) + 1) + 1);
  const offenders = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(before + after))) {
    if (m[1].indexOf(':hover') !== -1 && /transform:\s*(?!none)/.test(m[2])) {
      offenders.push(m[1].trim().replace(/\s+/g, ' '));
    }
  }
  if (offenders.length) return 'ungated hover transform on: ' + offenders.join(' | ');
  return true;
});

/* ---- 25e. the shipped shell ---- */

check('the service worker cache version was bumped for Sprint 9', () => {
  const m = read('sw.js').match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[1], 10) < 12) return 'the cache is still v' + m[1] + ' — returning phones keep the old shell';
  return true;
});

check('PROJECT_PLAN documents Sprint 8', () => {
  const required = [
    'Sprint 8', 'סל מחזור', 'Complete.plan', 'stroke-dashoffset', 'HAPTIC_CHECK',
    'trashRestore', 'purgeTrash', 'tapEditKey', 'אישור מחיקה', 'v11'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

check('PROJECT_PLAN documents Sprint 9', () => {
  const required = [
    'Sprint 9', 'היסטוריה', 'is-entering', 'markEntering', 'archiveDone',
    'awaitingArchive', 'purgeArchive', 'boardTasksOn', 'setHTML', 'v12',
    'העבר משימות שבוצעו להיסטוריה'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ========================================================================== */
/* ====== 26. Field wave — בחירה מרובה inside סל המחזור ==================== */
/* ========================================================================== */

/**
 * TrashSel and Select deliberately carry the same method names — one gesture,
 * two lists — so a bare bodyOf() would read whichever is declared first.
 * Every check below slices the bin's module out before it looks inside it.
 */
function trashSelSrc() {
  const start = js.indexOf('var TrashSel = {');
  if (start === -1) return '';
  return bodyOf(js.slice(start), 'var TrashSel = {');
}

check('the bin carries its own selection layer, separate from the cards', () => {
  const U = loadApp().ui;
  const T = U.TrashSel;
  if (!T) return 'no APP.ui.TrashSel export';
  if (T === U.Select) return 'the bin reuses the card selection, which cannot reach a sheet';
  if (T.on !== false || T.count() !== 0) return 'bin selection does not start closed and empty';

  T.enter('e1');
  if (!T.on || !T.has('e1')) return 'entering did not pick the row it was given';
  if (T.toggle('e2') !== true || T.count() !== 2) return 'a second row could not be picked';
  if (T.toggle('e2') !== false || T.count() !== 1) return 'a picked row could not be un-picked';
  if (T.toggle('') !== false || T.count() !== 1) return 'an empty id was accepted as a row';
  T.exit();
  if (T.on || T.count()) return 'leaving bin selection left state behind';
  return true;
});

check('"בחר הכל" inside the bin picks exactly what the bin is showing', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, T = U.TrashSel;
  Store.load();

  const ids = Store.data.tasks.slice(0, 2).map(t => t.id);
  if (ids.length < 2) return 'the seeded store is too small';
  ids.forEach(id => U.softDelete('tasks', id));

  T.enter();
  const visible = T.visibleKeys();
  if (visible.length !== U.trashCount()) return 'the bin offers a different set than it renders';
  if (visible.join(',') !== U.trashList().map(e => e.id).join(',')) {
    return 'בחר הכל would pick in an order the bin does not show';
  }
  if (T.all() !== visible.length) return 'בחר הכל picked a different number of rows';
  T.exit();
  return true;
});

check('a batch restore puts every picked record back in the slot it left', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, T = U.TrashSel;
  Store.load();

  const before = Store.data.tasks.map(t => t.id);
  if (before.length < 3) return 'the seeded store is too small for a batch';
  // the first and the third: restoring them together is what proves the order,
  // because filling slot 2 before slot 0 would land the second one too early
  const picked = [before[0], before[2]];
  picked.forEach(id => U.softDelete('tasks', id));
  if (Store.data.tasks.length !== before.length - 2) return 'the two records never left';

  T.enter();
  picked.forEach(id => T.toggle(id));
  const back = T.restore(T.keys());
  if (back !== 2) return 'the batch restored ' + back + ' records, not 2';
  if (Store.data.tasks.map(t => t.id).join(',') !== before.join(',')) {
    return 'the restored records came back in the wrong slots';
  }
  if (U.trashCount() !== 0) return 'the restored records are still in the bin';
  if (T.restore(['no_such_entry']) !== 0) return 'a batch of nothing reported a restore';
  T.exit();
  return true;
});

check('a batch purge destroys exactly the picked rows and nothing else', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, T = U.TrashSel;
  Store.load();

  const ids = Store.data.tasks.slice(0, 3).map(t => t.id);
  if (ids.length < 3) return 'the seeded store is too small for a batch';
  ids.forEach(id => U.softDelete('tasks', id));
  if (U.trashCount() !== 3) return 'the bin holds ' + U.trashCount() + ' entries, not 3';

  const gone = T.purge([ids[0], ids[2]]);
  if (gone !== 2) return 'the purge destroyed ' + gone + ' entries, not 2';
  if (U.trashCount() !== 1) return 'the purge took rows that were never picked';
  if (!U.trashFind(ids[1])) return 'the surviving row is not the one that was left alone';
  // and a purged record must not come back through the other door
  if (Store.data.tasks.some(t => t.id === ids[0])) return 'a purged record is still in the store';
  if (T.purge(['no_such_entry']) !== 0) return 'a batch of nothing reported a deletion';
  return true;
});

check('the bin is emptied through the one confirmation door, like every deletion', () => {
  const src = trashSelSrc();
  if (!src) return 'no TrashSel module';
  if (src.indexOf('confirmDelete(') === -1) return 'a batch purge destroys without asking';
  if (!/action === 'restore'/.test(src)) return 'no batch restore action';
  if (!/action === 'purge'/.test(src)) return 'no batch purge action';
  if (!/action === 'all'/.test(src)) return 'no בחר הכל action';
  if (!/action === 'exit'/.test(src)) return 'no way out of selection mode';
  return true;
});

check('the bin selection is opened by the same 500ms press, scoped to the bin', () => {
  const src = trashSelSrc();
  const press = bodyOf(src, 'bindLongPress: function ()');
  if (!press) return 'the bin has no long-press binding';
  if (press.indexOf('LONG_PRESS_MS') === -1) return 'the bin press is not the app-wide 500ms';
  if (press.indexOf('LONG_PRESS_SLOP') === -1) return 'a scroll inside the bin would open a selection';
  if (press.indexOf('{ passive: true }') === -1) return 'the bin touch listeners are not passive';
  if (press.indexOf("closest('#trashList')") === -1) return 'the press is not scoped to the bin list';
  if (press.indexOf('TrashSel.swallow = true') === -1) {
    return 'the click after the press would immediately un-pick the row';
  }

  const tap = bodyOf(src, 'tap: function (target)');
  if (!tap) return 'no TrashSel.tap()';
  if (tap.indexOf("closest('#trashList')") === -1) return 'the bin would claim taps outside itself';
  if (tap.indexOf("closest('[data-trashid]')") === -1) return 'the tap is not resolved to an entry';

  const onClick = (js.match(/function onClick\(e\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (onClick.indexOf('if (TrashSel.tap(e.target)) return;') === -1) {
    return 'the delegate acts on a binned row before asking the bin selection';
  }
  if (onClick.indexOf('TrashSel.run(el.dataset.trashbatch)') === -1) {
    return 'the bin batch bar is not in the click delegate';
  }
  if (js.indexOf('[data-trashbatch]') === -1) return 'the bar is not matched by the delegate';
  return true;
});

check('the bin batch bar exists, is labelled, and can never outlive the sheet', () => {
  ['id="trashBatchBar"', 'id="trashBatchCount"', 'id="trashSelectBtn"',
    'id="trashSelectLabel"'].forEach(n => {
      if (html.indexOf(n) === -1) throw new Error('missing ' + n);
    });
  ['mode', 'restore', 'all', 'purge', 'exit'].forEach(a => {
    if (html.indexOf('data-trashbatch="' + a + '"') === -1) {
      throw new Error('no bin batch action: ' + a);
    }
  });
  // the bar has to live INSIDE the sheet: fixed to the shell it would sit under
  // it, offering actions on a list the finger cannot see
  const sheet = (html.match(/<div class="sheet trash"[\s\S]*?\n<\/div>/) || [''])[0];
  if (!sheet) return 'no bin sheet';
  if (sheet.indexOf('id="trashBatchBar"') === -1) return 'the bin bar is not inside the bin';
  if (sheet.indexOf('id="trashSelectBtn"') === -1) return 'the bin pill is not inside the bin';

  const bar = cssRules(css).filter(r => r.sel === '.trash-batchbar')[0];
  if (!bar) return 'no .trash-batchbar rule';
  if (!/position:\s*sticky/.test(bar.body)) return 'the bin bar is not sticky inside the sheet';

  // closing the bin ends the mode, or the next visit opens holding picks on
  // rows nobody can see
  const close = bodyOf(js, 'function closeSheets(');
  if (close.indexOf('TrashSel.exit()') === -1) return 'closing the bin leaves a selection armed';
  const open = bodyOf(js, 'function openTrash(');
  if (open.indexOf('TrashSel.exit()') === -1) return 'the bin re-opens in selection mode';
  return true;
});

check('a binned row is pickable, and a finished one still reads as finished', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store, T = U.TrashSel;
  Store.load();

  const task = Store.data.tasks[0];
  APP.tasks.setTaskStatus(task, 'done');
  U.softDelete('tasks', task.id);
  const entry = U.trashFind(task.id);
  if (!entry) return 'the completed task never reached the bin';
  if (!U.trashDone(entry)) return 'a finished task is not recognised as finished in the bin';

  const now = entry.deletedAt;
  const idle = U.trashRow(entry, now);
  if (idle.indexOf('data-trash="restore:') === -1) return 'the idle row lost its שחזר button';
  if (idle.indexOf('sel-box') !== -1) return 'a checkbox is drawn with no selection live';
  if (idle.indexOf('is-done') === -1) return 'the finished row carries no is-done state';
  if (idle.indexOf('>בוצע<') === -1) return 'the strikethrough is the only carrier of "done"';

  T.enter(entry.id);
  const picked = U.trashRow(entry, now);
  if (picked.indexOf('sel-box is-picked') === -1) return 'a picked row grows no ticked checkbox';
  if (picked.indexOf('is-pickable') === -1) return 'the row is not marked as pickable';
  if (picked.indexOf('data-trash="purge:') !== -1) {
    return 'the per-row buttons still compete with the checkbox for the same finger';
  }
  T.exit();

  // ...and the line itself is CSS, on the title only
  const rules = cssRules(css);
  const strike = rules.filter(r => r.sel === '.trash-row.is-done .trash-title')[0];
  if (!strike || !/text-decoration:\s*line-through/.test(strike.body)) {
    return 'a finished binned title is not struck through';
  }
  if (!rules.some(r => r.sel === '.trash-row.is-picked')) return 'a picked row is not painted';
  return true;
});

check('PROJECT_PLAN documents the bin selection wave', () => {
  const required = [
    'TrashSel', 'בחירה מרובה בסל', 'data-trashbatch', 'trash-batchbar', 'v13'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ========================================================================== */
/* ====== 27. ריקון סל המחזור — the whole bin, in one tap ================== */
/* ========================================================================== */

check('ריקון סל המחזור is offered inside the bin, and starts hidden', () => {
  const sheet = (html.match(/<div class="sheet trash"[\s\S]*?\n<\/div>/) || [''])[0];
  if (!sheet) return 'no bin sheet';
  if (sheet.indexOf('id="trashEmptyBtn"') === -1) return 'the empty-bin button is not inside the bin';
  if (sheet.indexOf('data-trash="empty"') === -1) return 'the empty-bin button is not wired';
  if (sheet.indexOf('🗑 ריקון סל המחזור') === -1) return 'the button is not labelled 🗑 ריקון סל המחזור';
  // an empty bin must never offer to be emptied, so the row ships hidden and
  // renderTrash() is what decides it can be seen
  if (!/<div class="trash-tools" id="trashTools" hidden>/.test(html)) {
    return 'the control row does not ship hidden';
  }
  const rules = cssRules(css);
  if (!rules.some(r => r.sel === '.trash-tools')) return 'no .trash-tools rule';
  const hid = rules.filter(r => r.sel === '.trash-tools[hidden]')[0];
  if (!hid || !/display:\s*none/.test(hid.body)) {
    return 'a display rule would defeat the hidden attribute the row ships with';
  }
  return true;
});

check('the bin control is hidden on an empty bin and while a selection is live', () => {
  const rt = bodyOf(js, 'function renderTrash(');
  if (!rt) return 'no renderTrash()';
  if (rt.indexOf("$('#trashTools')") === -1) return 'renderTrash() never touches the control row';
  if (!/hidden\s*=\s*!rows\.length\s*\|\|\s*TrashSel\.on/.test(rt)) {
    return 'the control is shown over an empty bin, or next to the batch bar it duplicates';
  }
  return true;
});

check('the empty action is resolved before the bin looks for a row id', () => {
  const run = bodyOf(js, 'function runTrashAction(');
  if (!run) return 'no runTrashAction()';
  const at = run.indexOf("action === 'empty'");
  if (at === -1) return "the bin control's action is not handled";
  const lookup = run.indexOf('trashFind(id)');
  if (lookup !== -1 && at > lookup) {
    return 'the empty action is looked up as a row id first and dies in that lookup';
  }
  if (js.indexOf('[data-trash]') === -1) return 'the delegate does not match the control';
  return true;
});

check('emptying the bin asks first, and names the bin inside the question', () => {
  const U = loadApp().ui;
  if (U.CONFIRM_EMPTY_TRASH !== 'האם אתה בטוח שברצונך למחוק את סל המחזור?') {
    return 'the question does not name what it destroys: ' + U.CONFIRM_EMPTY_TRASH;
  }

  const ask = bodyOf(js, 'function askEmptyTrash(');
  if (!ask) return 'no askEmptyTrash()';
  if (ask.indexOf('confirmDelete(') === -1) return 'the bin is emptied without asking';
  if (ask.indexOf('CONFIRM_EMPTY_TRASH') === -1) return 'the door opens with the generic question';
  if (!/yes:\s*'אישור'/.test(ask)) return 'the accept button is not labelled אישור';
  if (ask.indexOf('trashCount()') === -1) return 'an empty bin is asked about anyway';

  // one door, reworded — never a second one. And the wording is reset on every
  // ask, or the next row deleted anywhere in the app inherits this question.
  if ((js.match(/id="confirmSheet"|id='confirmSheet'/g) || []).length > 1) {
    return 'a second confirmation surface was added';
  }
  const door = bodyOf(js, 'ask: function (what, run, opts)');
  if (!door) return 'Confirm.ask() does not take a wording override';
  if (door.indexOf('o.title || CONFIRM_QUESTION') === -1) return 'the question is not reset per ask';
  if (door.indexOf('o.yes || CONFIRM_YES') === -1) return 'the accept label is not reset per ask';

  // ...and both answers are on screen, which is what makes it a question
  const confirm = (html.match(/<div class="sheet confirm"[\s\S]*?\n<\/div>/) || [''])[0];
  if (confirm.indexOf('data-action="close-confirm"') === -1) return 'no ביטול';
  if (confirm.indexOf('>ביטול<') === -1) return 'the cancel button is not labelled ביטול';
  if (confirm.indexOf('data-confirmdel') === -1) return 'no accept button';
  return true;
});

check('ריקון הסל destroys every entry in the bin and nothing outside it', () => {
  const APP = loadApp(), U = APP.ui, Store = APP.Store;
  Store.load();

  const ids = Store.data.tasks.slice(0, 3).map(t => t.id);
  if (ids.length < 3) return 'the seeded store is too small';
  const notes = Store.data.notes.length;
  const tasksLeft = Store.data.tasks.length - 3;
  ids.forEach(id => U.softDelete('tasks', id));
  if (U.trashCount() !== 3) return 'the bin holds ' + U.trashCount() + ' entries, not 3';

  const gone = U.emptyTrash();
  if (gone !== 3) return 'ריקון הסל reported ' + gone + ' deletions, not 3';
  if (U.trashCount() !== 0) return 'the bin still holds ' + U.trashCount() + ' entries';
  if (Store.data.tasks.length !== tasksLeft) return 'emptying the bin reached the live list';
  if (Store.data.notes.length !== notes) return 'emptying the bin reached a collection it was never given';
  // and a purged record must not come back through the other door
  if (Store.data.tasks.some(t => ids.indexOf(t.id) !== -1)) return 'a purged record is still in the store';
  if (U.emptyTrash() !== 0) return 'an empty bin reported a deletion';
  return true;
});

check('PROJECT_PLAN documents ריקון סל המחזור', () => {
  const required = [
    'ריקון סל המחזור', 'trashEmptyBtn', 'data-trash="empty"', 'emptyTrash', 'v14'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ------------------------------- 41. the PWA update path (field report) ----
   "the screen on the phone never changed" — the deploy was live and the worker
   was new, but claiming a client does not reload it, so the document kept
   running the app.js it parsed at launch. These pin the whole path shut. */

check('sw.js reads only its own version of the cache', () => {
  const body = sw.slice(sw.indexOf("addEventListener('fetch'"));
  if (/caches\.match\(/.test(body)) {
    return 'bare caches.match() searches every cache — a stale version can win';
  }
  if (!/caches\.open\(CACHE_NAME\)[\s\S]{0,120}\.match\(/.test(sw)) {
    return 'no lookup is scoped to CACHE_NAME';
  }
  return true;
});

check('index.html cache-busts app.js and styles.css against the sw version', () => {
  const m = sw.match(/CACHE_VERSION\s*=\s*'(v\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  const v = m[1];
  if (html.indexOf('app.js?v=' + v) === -1) return 'app.js is not busted to ' + v;
  if (html.indexOf('styles.css?v=' + v) === -1) return 'styles.css is not busted to ' + v;
  // and the worker must pre-cache the same URLs the page actually asks for
  if (!/VERSIONED\s*=/.test(sw) || sw.indexOf("'./app.js'") === -1) {
    return 'sw.js pre-caches a different URL than index.html requests';
  }
  return true;
});

check('a new worker taking control reloads the page onto the new code', () => {
  if (js.indexOf("'controllerchange'") === -1) return 'controllerchange is never handled';
  if (!/hadController/.test(js)) return 'a first install would reload for nothing';
  if (!/swReloading/.test(js)) return 'nothing guards against a reload loop';
  if (!/location\.reload\(\)/.test(js)) return 'the page is never reloaded';
  if (js.indexOf('backdrop') === -1) return 'the reload can land mid-edit';
  return true;
});

check('an update found before the listener attached is still adopted', () => {
  if (!/reg\.waiting/.test(js)) return 'reg.waiting is never inspected';
  if (js.indexOf("type: 'SKIP_WAITING'") === -1) return 'the waiting worker is never told to take over';
  if (sw.indexOf("=== 'SKIP_WAITING'") === -1) return 'sw.js does not answer SKIP_WAITING';
  return true;
});

check('a resumed home-screen app re-checks for a new version', () => {
  if (!/reg\.update\(\)/.test(js)) return 'update() is never called';
  if (js.indexOf("'visibilitychange'") === -1) return 'resume does not trigger a check';
  if (!/SW_UPDATE_MS/.test(js)) return 'the check is unthrottled';
  return true;
});

check('PROJECT_PLAN documents the update path', () => {
  const required = ['controllerchange', 'SKIP_WAITING', 'app.js?v=', 'v15'];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ================= 42. Sprint 10 — Inbox, notes area, reminders ============
   The field report: "פתוחות: 3" on My Day with an empty board underneath.
   Both statements were true and neither was useful, because a task dated next
   week or dated not at all had nowhere on screen it could be found. Everything
   below pins the four surfaces that answer it — the task views, the משימות
   קרובות widget, the notes & lists workspace and the reminder engine — and
   every one of them is executed for real, not pattern-matched. */

/** minutes since midnight, on the clock these checks are actually running on */
function clockNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** minutes-since-midnight → 'HH:MM', wrapping into the next day */
function hhmm(m) {
  const x = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(x / 60)).padStart(2, '0') + ':' +
    String(x % 60).padStart(2, '0');
}

/* ---- 42a. the four task views ---- */

check('the tasks view ships בקרוב and נכנסים as real sub-tabs', () => {
  const view = (html.match(/<section class="view" id="view-tasks"[\s\S]*?<\/section>/) || [''])[0];
  if (!view) return 'no #view-tasks section';
  ['upcoming', 'inbox'].forEach(t => {
    if (view.indexOf('data-tasktab="' + t + '"') === -1) throw new Error('no sub-tab for ' + t);
    if (view.indexOf('data-taskcount="' + t + '"') === -1) throw new Error('no live counter for ' + t);
  });
  ['בקרוב', 'נכנסים'].forEach(l => {
    if (view.indexOf('>' + l + ' <') === -1) throw new Error('missing sub-tab label ' + l);
  });
  return true;
});

check('היום / בקרוב / נכנסים / באיחור partition the whole board', () => {
  const APP = loadApp(), T = APP.tasks, Store = APP.Store, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.tasks.length = 0;
  const rows = [
    { title: 'היום', due: today },
    { title: 'מחר', due: D.addDaysISO(today, 1) },
    { title: 'בעוד שבועיים', due: D.addDaysISO(today, 14) },
    { title: 'ללא תאריך', due: '' },
    { title: 'אתמול', due: D.addDaysISO(today, -2) }
  ].map(r => Store.add('tasks', {
    type: 'task', title: r.title, category: 'personal', due: r.due, time: '',
    status: 'todo', priority: 'medium', nextAction: '', subtasks: [],
    done: false, notes: '', clientId: ''
  }));

  const VIEWS = ['today', 'upcoming', 'inbox', 'late'];
  rows.forEach(t => {
    const hits = VIEWS.filter(v => T.taskMatchesTab(t, v, today));
    if (hits.length !== 1) {
      throw new Error('"' + t.title + '" matches ' + hits.length + ' views [' + hits.join(', ') + ']');
    }
  });

  // and הכל really is the union — nothing may be reachable only through it
  const inAll = rows.filter(t => T.taskMatchesTab(t, 'all', today)).length;
  if (inAll !== rows.length) return 'הכל does not hold every task';
  return true;
});

check('a task saved with no date lands in נכנסים instead of claiming today', () => {
  // the bug that made the Inbox unreachable: the writer defaulted an empty
  // date to todayISO(), so a dateless task could not exist in the first place
  if (/due: v\.due \|\| todayISO\(\)/.test(js)) {
    return 'submitForm still back-fills an empty due date with today';
  }
  if (js.indexOf("due: v.due || ''") === -1) return 'an empty date is not preserved on create';
  // ...and the form must not pre-fill one either, or the field is never empty
  const taskForm = (js.match(/task: function \(\) \{[\s\S]*?\n {4}\},/) || [''])[0];
  if (/name="due" value="/.test(taskForm)) return 'the task form still pre-fills a due date';
  return true;
});

check('בקרוב is read forwards through time, not by priority', () => {
  const APP = loadApp(), T = APP.tasks, D = APP.dates;
  const today = APP.isoDate(new Date());
  const mk = (title, due, priority, time) => ({
    title, due, priority, time, status: 'todo', done: false, subtasks: []
  });

  // a low-priority task tomorrow must outrank a high-priority one next week
  const sorted = T.sortByDate([
    mk('רחוק', D.addDaysISO(today, 9), 'high', ''),
    mk('ללא תאריך', '', 'high', ''),
    mk('מחר מאוחר', D.addDaysISO(today, 1), 'high', '18:00'),
    mk('מחר מוקדם', D.addDaysISO(today, 1), 'low', '08:00')
  ]).map(t => t.title);

  if (sorted.join(' | ') !== 'מחר מוקדם | מחר מאוחר | רחוק | ללא תאריך') {
    return 'chronological order is ' + sorted.join(' | ');
  }

  // the day-band captions the list is grouped by
  if (T.upcomingBand('', today) !== 'ללא תאריך יעד') return 'an undated task has no band';
  if (T.upcomingBand(D.addDaysISO(today, 1), today).indexOf('מחר') === -1) return 'tomorrow has no band';
  if (T.upcomingBand(D.addDaysISO(today, 10), today).indexOf('בשבוע הבא') === -1) {
    return 'the second week has no band';
  }
  return true;
});

/* ---- 42b. the משימות קרובות widget on My Day ---- */

check('the My Day widget holds the next 7 days AND everything undated', () => {
  const APP = loadApp(), T = APP.tasks, Store = APP.Store, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.tasks.length = 0;
  const add = (title, due) => Store.add('tasks', {
    type: 'task', title, category: 'personal', due, time: '',
    status: 'todo', priority: 'medium', nextAction: '', subtasks: [],
    done: false, notes: '', clientId: ''
  });

  const now = add('היום', today);
  const soon = add('בעוד 3', D.addDaysISO(today, 3));
  const edge = add('בעוד 7', D.addDaysISO(today, 7));
  const far = add('בעוד 8', D.addDaysISO(today, 8));
  const none = add('ללא תאריך', '');

  const week = T.upcomingSoon().map(t => t.id);
  if (week.indexOf(now.id) !== -1) return "today's task belongs to the board, not to בקרוב";
  if (week.indexOf(soon.id) === -1 || week.indexOf(edge.id) === -1) return 'the 7-day window is too narrow';
  if (week.indexOf(far.id) !== -1) return 'the window leaks past ' + T.UPCOMING_DAYS + ' days';

  const inbox = T.inboxTasks().map(t => t.id);
  if (inbox.join() !== none.id) return 'נכנסים is ' + inbox.length + ' rows, expected exactly the undated one';

  // the widget is the two together, chronologically, undated last
  const widget = T.upcomingWidget().map(t => t.id);
  if (widget.join(',') !== [soon.id, edge.id, none.id].join(',')) {
    return 'widget order is ' + widget.length + ' rows in an unexpected sequence';
  }
  return true;
});

check('the widget is a registered container, so membership drives its repaints', () => {
  ['upcomingBlock', 'upcomingToggle', 'upcomingList', 'upcomingCount', 'upcomingMeta']
    .forEach(id => {
      if (html.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id);
    });
  if (html.indexOf('data-upcoming=') === -1) return 'the widget cannot be collapsed';
  if (html.indexOf('aria-controls="upcomingList"') === -1) return 'the toggle is not wired to its region';
  if (js.indexOf('function renderUpcoming') === -1) return 'no renderUpcoming()';

  const APP = loadApp();
  const section = APP.ui.SECTIONS.filter(s => s.sel === '#upcomingList')[0];
  if (!section) return 'the widget is not a registered SECTION — it would never rebuild';
  if (section.view !== 'today') return 'the widget is registered against the wrong view';

  const Store = APP.Store;
  Store.load();
  Store.data.tasks.length = 0;
  const t = Store.add('tasks', {
    type: 'task', title: 'ללא תאריך', category: 'personal', due: '', time: '',
    status: 'todo', priority: 'medium', nextAction: '', subtasks: [],
    done: false, notes: '', clientId: ''
  });
  if (section.keys().join() !== 'tasks:' + t.id) return 'the section reports a different key list';
  return true;
});

check('the widget opens by default and its state survives a reload', () => {
  if (!/upcomingOpen: true/.test(js)) return 'the widget does not start open';
  if (!/prefs\.upcomingOpen = d\.prefs\.upcomingOpen !== false/.test(js)) {
    return 'a store written before the widget existed does not get a default';
  }
  return true;
});

/* ---- 42c. §2 — the dedicated פתקים ורשימות area ---- */

check('משימות / רשימות / פתקים are three switchable workspaces', () => {
  const APP = loadApp();
  if (APP.tasks.WORK_TABS.join() !== 'tasks,lists,notes') {
    return 'WORK_TABS is ' + APP.tasks.WORK_TABS.join();
  }
  ['tasks', 'lists', 'notes'].forEach(w => {
    if (html.indexOf('data-work="' + w + '"') === -1) throw new Error('no switch for ' + w);
    if (html.indexOf('data-workpane="' + w + '"') === -1) throw new Error('no pane for ' + w);
  });
  if (html.indexOf('class="segmented work-tabs"') === -1) return 'the switcher is not a segmented control';
  if (js.indexOf('function renderWorkspace') === -1) return 'no renderWorkspace()';
  if (!/\[data-workpane\]\[hidden\]\{\s*display:none/.test(css)) {
    return 'an inactive workspace is not actually hidden';
  }
  if (!/WORK_TABS\.indexOf\(d\.prefs\.workspace\) === -1/.test(js)) {
    return 'the chosen workspace does not survive a reload';
  }
  return true;
});

check('a note can be filed under a client, exactly like a task or a list', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();

  Store.data.clients.length = 0;
  Store.data.notes.length = 0;
  const client = Store.add('clients', {
    type: 'client', name: 'דנה כהן', category: 'business', phone: '', email: '',
    status: 'lead', interest: '', budget: '', nextAction: '', nextActionAt: '',
    followUpAt: '', notes: ''
  });
  const note = Store.add('notes', {
    type: 'note', title: 'סיכום שיחה', category: 'business',
    body: 'רוצה פורטרט 70x100', pinned: false, clientId: client.id
  });

  // the form must be able to SHOW the link, or it is erased by the first edit
  const form = APP.ui.TO_FORM.notes(note);
  if (form.clientId !== client.id) return 'TO_FORM drops the client link';
  if (js.indexOf("f('clientId', 'שיוך ללקוח', clientPicker())") === -1) {
    return 'no client picker is offered anywhere';
  }
  const noteForm = (js.match(/note: function \(\) \{[\s\S]*?\n {4}\},/) || [''])[0];
  if (noteForm.indexOf('clientPicker()') === -1) return 'the note form has no client picker';

  // ...and an edit must write it back
  const label = APP.ui.applyEdit('notes', note.id, {
    title: 'סיכום שיחה', body: 'רוצה פורטרט 70x100', clientId: ''
  }, 'business');
  if (!label) return 'the note edit was rejected';
  if (Store.find('notes', note.id).clientId !== '') return 'the link cannot be cleared';

  // the row wears the link so it reads at a glance
  if (APP.tasks.clientChip(client.id).indexOf('דנה כהן') === -1) return 'the row shows no client chip';
  if (APP.tasks.clientChip('') !== '') return 'an unlinked record still renders a chip';
  return true;
});

check('the notes and lists panes carry their own copy, not a bare list', () => {
  ['פתקים מהירים', 'רשימות וצ׳ק־ליסטים'].forEach(h => {
    if (html.indexOf(h) === -1) throw new Error('missing heading ' + h);
  });
  ['סיכומי שיחות', 'רשימות קניות'].forEach(s => {
    if (html.indexOf(s) === -1) throw new Error('missing explanatory copy: ' + s);
  });
  return true;
});

/* ---- 42d. §3 — reminders with flexible leads and a chime ---- */

check('every mandated reminder option ships with its lead and its Hebrew label', () => {
  const R = loadApp().reminders;
  if (R.OPTIONS.join() !== 'default,at,15,60,1440,none') return 'REMIND_OPTIONS is ' + R.OPTIONS.join();
  ['בזמן האירוע', '15 דקות לפני', 'שעה לפני', 'יום לפני'].forEach(l => {
    if (Object.keys(R.LABEL).filter(k => R.LABEL[k] === l).length !== 1) {
      throw new Error('no option labelled ' + l);
    }
  });
  const lead = 10;
  if (R.remindLead({ remind: 'at' }, lead) !== 0) return 'בזמן האירוע is not a zero lead';
  if (R.remindLead({ remind: '15' }, lead) !== 15) return '15 דקות is wrong';
  if (R.remindLead({ remind: '60' }, lead) !== 60) return 'שעה is not 60 minutes';
  if (R.remindLead({ remind: '1440' }, lead) !== 1440) return 'יום is not 1440 minutes';
  if (R.remindLead({ remind: 'none' }, lead) !== null) return 'ללא התראה does not mute the record';
  // a record written before this sprint has no key at all and must not change
  if (R.remindLead({}, lead) !== lead) return 'a legacy record no longer uses the system default';
  if (R.normRemind('') !== 'default') return 'a blank key is not normalised';
  if (R.normRemind('nonsense') !== 'default') return 'an unknown key is not normalised';
  return true;
});

check('the reminder panel is offered on both a task and an event', () => {
  // Sprint 12 replaced the single <select> with a panel: one <select> could
  // only ever express ONE reminder, and the mandate asks for several at once
  ['task', 'event'].forEach(t => {
    const form = (js.match(new RegExp(t + ': function \\(\\) \\{[\\s\\S]*?\\n {4}\\},')) || [''])[0];
    if (form.indexOf('remindField()') === -1) throw new Error('the ' + t + ' form offers no reminder panel');
  });
  if (js.indexOf('setReminders(rec, v.reminders)') === -1) return 'an edit never writes the reminders back';
  return true;
});

check('a per-record lead really decides who is announced, and when', () => {
  const APP = loadApp(), Store = APP.Store, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());
  const tomorrow = D.addDaysISO(today, 1);
  const now = clockNow();

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.notify.lead = 10;

  const ev = (title, date, time, remind) => Store.add('events', {
    type: 'event', title, category: 'personal', date, start: time, end: '',
    location: '', notes: '', clientId: '', remind
  });

  // exactly 1440 minutes out: only the "יום לפני" lead can reach it
  const dayBefore = ev('מחר · יום לפני', tomorrow, hhmm(now), '1440');
  const hourOnly = ev('מחר · שעה לפני', tomorrow, hhmm(now), '60');
  const muted = ev('היום · מושתק', today, hhmm(now), 'none');
  const soon = ev('היום · עוד 3 דק׳', now + 3 >= 1440 ? tomorrow : today, hhmm(now + 3), '15');

  const ids = APP.Notify.due().map(x => x.id);
  if (ids.indexOf(dayBefore.id) === -1) return 'a "יום לפני" reminder never reaches tomorrow';
  if (ids.indexOf(hourOnly.id) !== -1) return 'a 60-minute lead fired a day early';
  if (ids.indexOf(muted.id) !== -1) return 'ללא התראה was announced anyway';
  if (ids.indexOf(soon.id) === -1) return 'a 15-minute lead missed something 3 minutes away';

  // a closed task is never announced, whatever its reminder says
  const done = Store.add('tasks', {
    type: 'task', title: 'הושלמה', category: 'personal', due: today,
    time: hhmm(now), status: 'done', priority: 'medium', nextAction: '',
    subtasks: [], done: true, notes: '', clientId: '', remind: 'at'
  });
  if (APP.Notify.due().map(x => x.id).indexOf(done.id) !== -1) {
    return 'a completed task was still announced';
  }
  return true;
});

check('a day-before reminder is marked by its own date, so it fires once', () => {
  const APP = loadApp(), Store = APP.Store, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());
  const tomorrow = D.addDaysISO(today, 1);

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.fired = {};
  const meeting = Store.add('events', {
    type: 'event', title: 'פגישה מחר', category: 'business', date: tomorrow,
    start: hhmm(clockNow()), end: '', location: '', notes: '', clientId: '',
    remind: '1440'
  });

  // the sandbox has no Notification constructor and no speaker; the ledger and
  // the de-duplication are what this check is about, so both are stubbed out
  const shown = [];
  APP.Notify.armed = () => true;
  APP.Notify.show = (tag) => { shown.push(tag); };

  APP.Notify.tick();
  if (shown.length !== 1) return 'the reminder fired ' + shown.length + ' times on the first scan';

  /* Sprint 12 — the mark is now per REMINDER, not per record: a record can
     carry several at once and one record-wide key would let whichever fired
     first swallow the rest. The token LEADS and the date still TRAILS, which
     is what keeps the overnight sweep's key.slice(-10) reading a date. */
  const mark = '1440#' + meeting.id + '@' + tomorrow;
  if (shown[0] !== mark) {
    return 'the mark is keyed ' + shown[0] + ", expected the event's OWN date";
  }
  if (shown[0].slice(-10) !== tomorrow) return 'the sweep can no longer read a date off the key';
  if (Store.data.prefs.fired['1440#' + meeting.id + '@' + today]) {
    return "the mark was keyed by today — it would be swept and fire again tomorrow";
  }

  APP.Notify.tick();
  if (shown.length !== 1) return 'the same reminder fired again on the next scan';

  // a mark for a date still ahead must survive the daily sweep
  APP.Notify.tick();
  if (!Store.data.prefs.fired[mark]) return 'the mark was swept while still needed';
  return true;
});

check('the reminder chime is synthesised, guarded, and never throws', () => {
  const APP = loadApp(), C = APP.reminders.Chime;
  // the sandbox window has no AudioContext, which is the browser this has to
  // survive: every entry point must decline rather than throw
  if (C.supported() !== false) return 'supported() lies about a browser with no AudioContext';
  if (C.play() !== false) return 'play() claims to have made a sound';
  if (C.unlock() !== false) return 'unlock() claims to have started a context';
  if (C.context() !== null) return 'context() invented an AudioContext';

  if (APP.reminders.TONES.length !== 2) return 'the chime is not the mandated two-note bell';
  if (js.indexOf('createOscillator') === -1) return 'no oscillator — the chime needs a binary asset';
  if (js.indexOf('exponentialRampToValueAtTime') === -1) return 'the chime has no decay envelope';
  // an .mp3 would have to be in the service-worker shell; it deliberately is not
  if (/CORE_ASSETS[\s\S]*?\.(mp3|wav|ogg)/.test(sw)) return 'the chime ships as a cached audio file';
  return true;
});

check('the chime has its own toggle and its own default', () => {
  ['soundBtn', 'soundIco', 'soundLabel'].forEach(id => {
    if (html.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id);
  });
  if (js.indexOf('onSoundToggle') === -1) return 'the toggle is never wired';
  if (js.indexOf('Chime.unlock()') === -1) return 'the AudioContext is never unlocked inside a gesture';
  if (!/\.sound-btn\.is-on\{/.test(css)) return 'the toggle has no on state';

  const APP = loadApp(), Store = APP.Store;
  Store.load();
  if (Store.data.prefs.notify.sound !== true) return 'the chime does not default on';
  return true;
});

check('a server-sent push asks an open window to make the sound', () => {
  if (sw.indexOf('PUSH_CHIME') === -1) return 'sw.js never asks for the chime';
  if (sw.indexOf('postMessage') === -1) return 'sw.js cannot reach a client';
  if (js.indexOf("event.data.type === 'PUSH_CHIME'") === -1) return 'app.js never answers PUSH_CHIME';
  if (!/silent: false/.test(sw)) return 'sw.js lets the platform silence the notification';
  return true;
});

/* ---- 42e. §4 — time-blocking ---- */

check('a timed task is blocked into its own hour on the timeline', () => {
  const APP = loadApp(), U = APP.ui, T = APP.tasks, Store = APP.Store;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;

  const meeting = Store.add('events', {
    type: 'event', title: 'פגישה', category: 'business', date: today,
    start: '09:00', end: '10:00', location: '', notes: '', clientId: ''
  });
  const block = Store.add('tasks', {
    type: 'task', title: 'לצבוע רקע', category: 'personal', due: today,
    time: '14:00', status: 'todo', priority: 'high', nextAction: '',
    subtasks: [], done: false, notes: '', clientId: ''
  });
  const loose = Store.add('tasks', {
    type: 'task', title: 'ללא שעה', category: 'personal', due: today,
    time: '', status: 'todo', priority: 'high', nextAction: '',
    subtasks: [], done: false, notes: '', clientId: ''
  });

  const keys = U.timelineKeys();
  if (keys.join(',') !== 'events:' + meeting.id + ',tasks:' + block.id) {
    return 'the timeline holds [' + keys.join(', ') + ']';
  }

  // the untimed one still belongs to לביצוע היום, and to nothing else
  if (keys.indexOf('tasks:' + loose.id) !== -1) return 'an untimed task was forced into an hour';
  if (T.timedTasksToday().map(x => x.id).join() !== block.id) return 'the time-blocking selector is wrong';

  // the two hours the two records were painted into
  const rows = U.timelineRows().filter(r => r.list.length).map(r => r.hour);
  if (rows.join() !== '9,14') return 'records were painted into hours [' + rows.join(', ') + ']';

  // and the painted order is still the reported order (B0, across two tables)
  const flat = [];
  U.timelineRows().forEach(r => r.list.forEach(e => flat.push(e.collection + ':' + e.rec.id)));
  if (flat.join(',') !== keys.join(',')) return 'the painted rows and the reported keys disagree';

  // a task block is drawn compact, so the checklist does not drown the grid
  if (U.timelineCard({ collection: 'tasks', rec: block }).indexOf('data-compact="1"') === -1) {
    return 'a timeline task block is not drawn compact';
  }
  return true;
});

/* ---- 42f. §5 — the shipped shell, the schema and the specification ---- */

check('migration 0003 appends the reminder column without editing 0001 or 0002', () => {
  ['events', 'tasks'].forEach(t => {
    if (!new RegExp('ALTER TABLE ' + t + '\\s+ADD COLUMN\\s+remind_key\\b').test(sqlRemind)) {
      throw new Error(t + '.remind_key is never added');
    }
  });
  if (sql.indexOf('remind_key') !== -1) return '0001 was edited — migrations are append-only';
  if (sqlGcal.indexOf('remind_key') !== -1) return '0002 was edited — migrations are append-only';
  // every existing row has to keep the behaviour it already had
  if (!/UPDATE events SET remind_key = 'default'/.test(sqlRemind)) return 'existing events are not backfilled';
  if (!/UPDATE tasks\s+SET remind_key = 'default'/.test(sqlRemind)) return 'existing tasks are not backfilled';
  return true;
});

/**
 * Columns appended by a migration LATER than 0003. Sprint 10's check used to
 * assert remind_key was the last column of its table, which was only true
 * while 0003 was the last migration; Sprint 13's 0006 appends two more behind
 * it. What the check actually protects is the POSITION — remind_key trails
 * every 0001/0002 column and leads every column added after it — so that is
 * what it asserts now.
 */
const AFTER_REMIND = ['alert_sound', 'alert_vibe'];

check('remind_key agrees across the SQL, the Worker and the client', () => {
  ['events', 'tasks'].forEach(t => {
    const cols = sqlColumns(t);
    const at = cols.indexOf('remind_key');
    if (at === -1) throw new Error(t + ' declares no remind_key');
    const after = cols.slice(at + 1);
    const stray = after.filter(c => AFTER_REMIND.indexOf(c) === -1);
    if (stray.length) {
      throw new Error(t + ' puts [' + stray.join(', ') + '] after remind_key — migration order drifted');
    }
    if (W.SCHEMA[t].columns.join() !== cols.join()) throw new Error(t + ': the Worker drifted from the SQL');
    if (SY.SCHEMA[t].join() !== cols.join()) throw new Error(t + ': the client drifted from the SQL');
  });

  // and a round-trip must carry the value both ways
  const row = SY.toRow('tasks', { id: 't1', title: 'x', remind: '60', updatedAt: 1, createdAt: 1 });
  if (row.remind_key !== '60') return 'the reminder is dropped on the way out';
  if (!SY.validRow('tasks', row)) return 'the emitted row is rejected by the payload guard';
  if (SY.fromRow('tasks', row).remind !== '60') return 'the reminder is dropped on the way back in';
  // an unknown key from a future build must normalise rather than corrupt
  const odd = SY.fromRow('tasks', Object.assign({}, row, { remind_key: 'someday' }));
  if (odd.remind !== 'default') return 'an unknown key survives a pull as ' + odd.remind;
  return true;
});

check('a blank reminder can never erase a stored choice', () => {
  // /api/gcal/sync writes whole event rows built from a Google payload, which
  // knows nothing about this vocabulary — an unguarded column would be nulled
  // on every inbound edit
  const shared = read('functions/api/_shared.js');
  const block = (shared.match(/const PRESERVE_IF_BLANK = \{[\s\S]*?\n\};/) || [''])[0];
  if (!block) return 'no PRESERVE_IF_BLANK map';
  if (!/events:[^\]]*'remind_key'/.test(block)) return 'events.remind_key is not preserved';
  if (!/tasks:[^\]]*'remind_key'/.test(block)) return 'tasks.remind_key is not preserved';
  // ...which is only safe because the client never sends a blank. Sprint 12
  // widened the column to a comma-joined token list, so the guarantee moved
  // from normRemind() to remindKey(), which answers 'none' for an empty list
  // and therefore still cannot emit ''.
  if ((js.match(/remind_key: remindColumn\(r\)/g) || []).length !== 2) {
    return 'the client no longer serialises remind_key through remindColumn()';
  }
  const R = loadApp().reminders;
  [[], '', 'none', 'nonsense', null, ['none']].forEach(v => {
    if (R.remindKey(v) === '') throw new Error('remindKey(' + JSON.stringify(v) + ') emitted a blank');
  });
  if (R.remindColumn({ reminders: [] }) !== 'none') return 'a muted record does not serialise as none';
  if (R.remindColumn({}) !== 'default') return 'a record with no opinion does not serialise as default';
  return true;
});

check('the shell has never regressed below the Sprint 10 cache version', () => {
  const m = sw.match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[1], 10) < 16) return 'the cache is still v' + m[1] + ' — returning phones keep the old shell';
  // the two busted URLs are checked against whatever the worker actually says,
  // rather than against a literal that has to be edited every sprint
  const v = 'v' + m[1];
  if (html.indexOf('app.js?v=' + v) === -1) return 'app.js is not busted to ' + v;
  if (html.indexOf('styles.css?v=' + v) === -1) return 'styles.css is not busted to ' + v;
  return true;
});

check('PROJECT_PLAN documents Sprint 10', () => {
  const required = [
    'Sprint 10', 'נכנסים', 'בקרוב', 'משימות קרובות', 'remind_key',
    'REMIND_OPTIONS', 'PUSH_CHIME', 'data-workpane', 'Time-blocking', 'v16'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   43. Sprint 11 — server push, the audio unlock and the late-reminder grace

   The field report was one symptom with three separate causes, and each one is
   pinned here by execution rather than by pattern-match:

     1. Nothing ran when the app was closed — the whole reminder engine was a
        setInterval inside the page. §43a–c cover the Worker that replaced it.
     2. The AudioContext was first touched inside a timer callback, so the
        autoplay policy left it suspended and the chime was silent. §43d.
     3. `gap < 0` skipped anything whose start time had already passed, and the
        scan only looks forward — so a reminder missed by one minute was missed
        forever. §43e.
   ========================================================================== */

const MIGRATION_PUSH = 'migrations/0004_sprint11_push.sql';
const PUSH_FILES = ['_webpush', 'subscribe', 'dispatch'].map(n => 'functions/api/push/' + n + '.js');

/* ---- 43a. artefacts and the append-only migration rule ---- */

check('Sprint 11 artefacts are present (push routes, migration, cron worker)', () => {
  const wanted = PUSH_FILES.concat([
    MIGRATION_PUSH,
    'tools/push-cron-worker/worker.js',
    'tools/push-cron-worker/wrangler.toml',
    'tools/gen-vapid.js'
  ]);
  const missing = wanted.filter(f => !fs.existsSync(path.join(ROOT, f)));
  return missing.length ? 'missing: ' + missing.join(', ') : true;
});

const sqlPush = fs.readFileSync(path.join(ROOT, MIGRATION_PUSH), 'utf8');

check('migration 0004 is append-only and adds only new tables', () => {
  // the entity column order is rebuilt out of 0001 + 0002 + 0003 elsewhere in
  // this file; 0004 touching any of those five tables would break that rebuild
  if (/ALTER\s+TABLE\s+(events|tasks|lists|notes|clients)\b/i.test(sqlPush)) {
    return '0004 alters an entity table — the column cross-check reads 0001–0003 only';
  }
  ['push_subscriptions', 'push_dispatch'].forEach(t => {
    if (sqlPush.indexOf('CREATE TABLE IF NOT EXISTS ' + t) === -1) {
      throw new Error('0004 does not create ' + t);
    }
  });
  if (sqlPush.indexOf('push_subscriptions') !== -1 && sql.indexOf('push_subscriptions') !== -1) {
    return '0001 was edited to carry the push tables — migrations are append-only';
  }
  return true;
});

check('every push route parses and declares the handlers it needs', () => {
  PUSH_FILES.forEach(f => {
    new vm.Script(stripModule(fs.readFileSync(path.join(ROOT, f), 'utf8')), { filename: f });
  });
  const sub = fs.readFileSync(path.join(ROOT, 'functions/api/push/subscribe.js'), 'utf8');
  ['onRequestGet', 'onRequestPost', 'onRequestDelete', 'onRequestOptions'].forEach(h => {
    if (sub.indexOf('function ' + h) === -1) throw new Error('subscribe.js has no ' + h);
  });
  const disp = fs.readFileSync(path.join(ROOT, 'functions/api/push/dispatch.js'), 'utf8');
  ['onRequestGet', 'onRequestPost', 'onRequestOptions'].forEach(h => {
    if (disp.indexOf('function ' + h) === -1) throw new Error('dispatch.js has no ' + h);
  });
  return true;
});

/* ---- 43b. the dispatcher is never an open cannon ---- */

const dispatchSrc = fs.readFileSync(path.join(ROOT, 'functions/api/push/dispatch.js'), 'utf8');
const webpushSrc = fs.readFileSync(path.join(ROOT, 'functions/api/push/_webpush.js'), 'utf8');

check('the dispatcher refuses to run without its secret', () => {
  if (dispatchSrc.indexOf('PUSH_DISPATCH_SECRET') === -1) return 'no dispatch secret at all';
  if (!/if \(!secret\) return 'unconfigured'/.test(dispatchSrc)) {
    return 'a missing secret does not disable the route — it would be open to anyone';
  }
  // both verbs must be gated: a GET dry run still discloses the whole calendar
  const gated = (dispatchSrc.match(/authorised\(request, env\)/g) || []).length;
  if (gated < 2) return 'only ' + gated + ' handler checks the secret';
  if (dispatchSrc.indexOf('diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)') === -1) {
    return 'the secret is compared with ===, which leaks its length and prefix through timing';
  }
  return true;
});

check('no VAPID key or dispatch secret is hardcoded anywhere', () => {
  const sources = [js, sw, html, dispatchSrc, webpushSrc,
    fs.readFileSync(path.join(ROOT, 'functions/api/push/subscribe.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'tools/push-cron-worker/worker.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'tools/push-cron-worker/wrangler.toml'), 'utf8')];

  for (const src of sources) {
    // a real VAPID public key is 87 base64url chars and starts with the
    // uncompressed-point marker; a private key is 43
    if (/['"]B[A-Za-z0-9_-]{85,86}['"]/.test(src)) return 'a VAPID public key is committed in source';
    if (/VAPID_PRIVATE_KEY\s*[:=]\s*['"][A-Za-z0-9_-]{20,}/.test(src)) {
      return 'a VAPID private key is committed in source';
    }
    if (/PUSH_DISPATCH_SECRET\s*=\s*['"][^'"]{8,}/.test(src)) {
      return 'the dispatch secret is committed in source';
    }
  }
  // the private key must never be readable outside the crypto module
  if (js.indexOf('VAPID_PRIVATE_KEY') !== -1) return 'the browser bundle names the private key';
  return true;
});

check('Pages cannot cron itself, and the repo says so out loud', () => {
  // comments stripped first: the Pages toml explains WHY it carries no
  // trigger, and the word appearing inside that explanation is not a trigger
  const decls = src => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

  const toml = decls(read('wrangler.toml'));
  if (/^\s*\[triggers\]/m.test(toml)) {
    return 'wrangler.toml declares a cron trigger — Pages compiles no scheduled handler, so it would never fire';
  }
  if (read('wrangler.toml').indexOf('tools/push-cron-worker') === -1) {
    return 'nothing in the Pages config points at where the clock actually lives';
  }
  const cronToml = decls(fs.readFileSync(path.join(ROOT, 'tools/push-cron-worker/wrangler.toml'), 'utf8'));
  if (!/^\s*\[triggers\]/m.test(cronToml)) return 'the cron Worker declares no trigger';
  if (!/crons\s*=\s*\["\* \* \* \* \*"\]/.test(cronToml)) return 'the cron is not once a minute';
  const cronJs = fs.readFileSync(path.join(ROOT, 'tools/push-cron-worker/worker.js'), 'utf8');
  if (cronJs.indexOf('async scheduled(') === -1) return 'the cron Worker has no scheduled handler';
  if (cronJs.indexOf('Bearer') === -1) return 'the cron Worker calls the dispatcher without the secret';
  return true;
});

/* ---- 43c. the server-side selector, executed for real ---- */

/** dispatch.js imports two modules; stripping them leaves selectDue standalone */
function loadDispatch() {
  const sandbox = { console, Date, Math, JSON, RegExp, Intl, parseInt, Object, String };
  vm.createContext(sandbox);
  vm.runInContext(
    stripModule(dispatchSrc) +
    '\n;globalThis.__d = { selectDue, localNow, addDaysISO, timeToMinutes, leadOf, phrase, remindTokens };',
    sandbox, { filename: 'dispatch.js' });
  return sandbox.__d;
}

check('the dispatcher selects exactly what the client would, late ones included', () => {
  const DS = loadDispatch();
  const now = { date: '2026-07-28', minutes: 10 * 60 };          // 10:00 local
  const tomorrow = '2026-07-29';

  const rows = {
    events: [
      // 10 minutes out, on the system default lead of 10 — the ordinary case
      { id: 'e-soon', title: 'פגישה', start_time: '2026-07-28T10:10', remind_key: 'default', location: 'זום' },
      // ONE MINUTE PAST. The bug the field report is about: before the grace
      // window this was skipped here and skipped forever after.
      { id: 'e-late', title: 'התחילה', start_time: '2026-07-28T09:59', remind_key: 'at' },
      // half an hour past — stale, and staying skipped is the correct answer
      { id: 'e-stale', title: 'עברה', start_time: '2026-07-28T09:30', remind_key: 'at' },
      // an hour out on a 15-minute lead: too early, must not fire yet
      { id: 'e-early', title: 'מאוחר יותר', start_time: '2026-07-28T11:00', remind_key: '15' },
      // muted at the record level, whatever the global toggle says
      { id: 'e-mute', title: 'מושתקת', start_time: '2026-07-28T10:05', remind_key: 'none' },
      // tomorrow, and only a "יום לפני" lead reaches it
      { id: 'e-day', title: 'מחר', start_time: tomorrow + 'T09:00', remind_key: '1440' },
      { id: 'e-day-no', title: 'מחר · שעה', start_time: tomorrow + 'T09:00', remind_key: '60' },
      // all-day: no clock to lead from
      { id: 'e-allday', title: 'יום שלם', start_time: '2026-07-28', remind_key: 'at' }
    ],
    tasks: [
      { id: 't-soon', title: 'משימה', due_date: '2026-07-28', due_time: '10:05', status: 'todo', remind_key: 'default' },
      { id: 't-late', title: 'איחרה', due_date: '2026-07-28', due_time: '09:55', status: 'todo', remind_key: 'at' },
      { id: 't-done', title: 'הושלמה', due_date: '2026-07-28', due_time: '10:00', status: 'done', remind_key: 'at' },
      { id: 't-cancel', title: 'בוטלה', due_date: '2026-07-28', due_time: '10:00', status: 'cancelled', remind_key: 'at' },
      { id: 't-undated', title: 'ללא שעה', due_date: '2026-07-28', due_time: '', status: 'todo', remind_key: 'at' }
    ]
  };

  const ids = DS.selectDue(rows, now, 10).map(x => x.id);
  const want = ['e-soon', 'e-late', 'e-day', 't-soon', 't-late'];
  const never = ['e-stale', 'e-early', 'e-mute', 'e-day-no', 'e-allday', 't-done', 't-cancel', 't-undated'];

  const absent = want.filter(id => ids.indexOf(id) === -1);
  if (absent.length) return 'the dispatcher would never send: ' + absent.join(', ');
  const leaked = never.filter(id => ids.indexOf(id) !== -1);
  if (leaked.length) return 'the dispatcher would wrongly send: ' + leaked.join(', ');

  // a late reminder must say it is late rather than claim a future start
  const late = DS.selectDue(rows, now, 10).filter(x => x.id === 'e-late')[0];
  if (late.title.indexOf('התחיל') === -1) return 'a late reminder still reads as upcoming: ' + late.title;

  // and it is keyed by the record's OWN date, never by today
  const day = DS.selectDue(rows, now, 10).filter(x => x.id === 'e-day')[0];
  if (day.on !== tomorrow) return 'a day-before reminder is keyed ' + day.on + ', expected ' + tomorrow;
  return true;
});

check('the dispatcher reads wall-clock time in the app timezone', () => {
  const DS = loadDispatch();
  const now = DS.localNow('Asia/Jerusalem');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(now.date)) return 'localNow returned ' + now.date;
  if (!(now.minutes >= 0 && now.minutes < 1440)) return 'minutes out of range: ' + now.minutes;

  // midnight must be 0, never 1440 — some engines render hour 24 under hour12:false
  if (DS.localNow('UTC').minutes >= 1440) return 'midnight resolves to minute 1440';

  // a stored record is wall clock, so UTC and Jerusalem must disagree by the
  // real offset rather than by a hardcoded one
  const utc = DS.localNow('UTC').minutes;
  const il = DS.localNow('Asia/Jerusalem').minutes;
  const delta = ((il - utc) % 1440 + 1440) % 1440;
  if (delta !== 120 && delta !== 180) return 'Israel is ' + delta + ' minutes off UTC, expected 120 or 180';

  if (DS.addDaysISO('2026-02-28', 1) !== '2026-03-01') return 'the scan window breaks on a month rollover';
  if (DS.addDaysISO('2026-12-31', 1) !== '2027-01-01') return 'the scan window breaks on a year rollover';
  if (DS.leadOf('none', 10) !== null) return 'ללא התראה is not muted server-side';
  if (DS.leadOf('default', 10) !== 10) return 'the system default is not honoured server-side';
  if (DS.leadOf('junk', 10) !== 10) return 'an unknown key does not fall back to the default';
  if (DS.leadOf('1440', 10) !== 1440) return 'יום לפני is not 1440 minutes server-side';
  return true;
});

check('a reminder is only ever marked sent once something actually landed', () => {
  // marking on attempt would let a push-service outage silently eat the
  // reminder: the ledger would say sent, the phone would have nothing
  if (!/if \(delivered > 0\) \{/.test(dispatchSrc)) return 'the ledger is written regardless of delivery';
  if (dispatchSrc.indexOf('INSERT INTO push_dispatch') === -1) return 'nothing is ever recorded as sent';
  if (dispatchSrc.indexOf("DELETE FROM push_dispatch WHERE on_date < ?") === -1) {
    return 'the ledger is never swept — it grows forever';
  }
  // a dead endpoint is retired rather than retried every minute
  if (dispatchSrc.indexOf('res.gone') === -1) return 'a 410 GONE endpoint is never retired';
  if (sqlPush.indexOf('disabled_at') === -1) return 'the subscription table cannot retire an endpoint';
  return true;
});

/* ---- 43d. the AudioContext unlock ---- */

check('the AudioContext is unlocked by the first gesture anywhere, not just the toggles', () => {
  const R = loadApp().reminders;
  if (!R.GESTURES || R.GESTURES.indexOf('touchstart') === -1) return 'touchstart is not a gesture';
  if (R.GESTURES.indexOf('pointerdown') === -1) return 'pointerdown is not a gesture';

  // a document stub that records what is bound and can replay a gesture
  const bound = {};
  const doc = {
    addEventListener: (type, fn) => { bound[type] = fn; },
    removeEventListener: () => {}
  };

  const APP = loadApp({ document: doc });
  const C = APP.reminders.Chime;
  APP.Store.load();

  if (C.armOnFirstGesture(doc) !== true) return 'the gesture unlock never armed';
  const missing = APP.reminders.GESTURES.filter(t => typeof bound[t] !== 'function');
  if (missing.length) return 'no listener for: ' + missing.join(', ');

  // arming twice must not double-bind
  let calls = 0;
  doc.addEventListener = () => { calls++; };
  C.armOnFirstGesture(doc);
  if (calls !== 0) return 'a second arm bound ' + calls + ' more listeners';

  // this sandbox has no AudioContext at all, so the gesture must decline
  // rather than throw — a tap can never fail on a device with no speaker
  bound.pointerdown();

  // and nothing is created while the chime is switched off
  APP.Store.data.prefs.notify.sound = false;
  if (C.armed() !== false) return 'a silenced chime still reports itself armed';
  bound.touchstart();
  if (C.ctx !== null) return 'a context was created while the chime was off';
  return true;
});

check('the unlock is reached from a gesture, never only from a timer', () => {
  // the original bug: play() was the first thing to touch the context, and it
  // is called from inside setInterval — no gesture, so no sound, ever
  if (js.indexOf('Chime.armOnFirstGesture(document)') === -1) {
    return 'nothing arms the unlock at boot — the context is first touched by the scan';
  }
  if (!/if \(Chime\.armed\(\)\) Chime\.unlock\(\);/.test(js)) {
    return 'a returning app never resumes a context iOS suspended in the background';
  }
  return true;
});

/* ---- 43e. the client's own grace window, executed for real ---- */

check('a reminder one minute late still fires; a stale one never does', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();
  const today = APP.isoDate(new Date());
  const now = clockNow();

  // parked well inside the day so "a minute ago" cannot cross midnight
  if (now < 120 || now > 1380) return true;                     // skipped near the boundaries

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.notify.lead = 10;

  const ev = (title, mins, remind) => Store.add('events', {
    type: 'event', title, category: 'personal', date: today,
    start: hhmm(now + mins), end: '', location: '', notes: '', clientId: '', remind
  });

  const late = ev('התחילה לפני דקה', -1, 'at');
  const grace = ev('לפני רבע שעה', -15, 'at');
  const stale = ev('לפני שעה', -60, 'at');

  const ids = APP.Notify.due().map(x => x.id);
  if (ids.indexOf(late.id) === -1) return 'a reminder one minute past its start was swallowed';
  if (ids.indexOf(grace.id) === -1) return 'a reminder inside the grace window was swallowed';
  if (ids.indexOf(stale.id) !== -1) return 'an hour-old reminder was raised as if it were news';

  if (APP.reminders.GRACE !== 20) return 'the grace window is ' + APP.reminders.GRACE + ', expected 20';

  // the wording has to be honest about being late
  const said = APP.Notify.due().filter(x => x.id === late.id)[0];
  if (said.title.indexOf('התחיל') === -1) return 'a late reminder claims it is still upcoming: ' + said.title;
  return true;
});

check('a late reminder still fires exactly once', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();
  const today = APP.isoDate(new Date());
  const now = clockNow();
  if (now < 120 || now > 1380) return true;

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.fired = {};
  const rec = Store.add('events', {
    type: 'event', title: 'איחרה', category: 'personal', date: today,
    start: hhmm(now - 2), end: '', location: '', notes: '', clientId: '', remind: 'at'
  });

  const shown = [];
  APP.Notify.armed = () => true;
  APP.Notify.show = (tag) => { shown.push(tag); };

  APP.Notify.tick();
  APP.Notify.tick();
  if (shown.length !== 1) return 'the late reminder fired ' + shown.length + ' times';
  // Sprint 12 — '<token>#<id>@<date>', the date still trailing for the sweep
  if (shown[0] !== 'at#' + rec.id + '@' + today) return 'the mark is keyed ' + shown[0];
  return true;
});

/* ---- 43f. the client half of server push ---- */

check('the client actually registers for server push', () => {
  if (js.indexOf("var PUSH_ENDPOINT = 'api/push'") === -1) return 'no push endpoint';
  if (js.indexOf('linkServer:') === -1) return 'nothing hands the subscription to the Worker';
  // the Sprint-10 subscribe() was a hook with no caller; that is the bug
  if ((js.match(/self\.linkServer\(\)|this\.linkServer\(\)/g) || []).length < 3) {
    return 'linkServer is defined but barely called — boot, grant and toggle must all link';
  }
  if (js.indexOf('pushManager.getSubscription()') === -1) {
    return 'a reload churns a new endpoint instead of reusing the existing subscription';
  }
  if (js.indexOf("PUSH_ENDPOINT + '/subscribe'") === -1) return 'the subscription is never POSTed';
  // and a deployment with no VAPID key must degrade, not break
  if (js.indexOf('if (!data || !data.configured || !data.publicKey) return null;') === -1) {
    return 'an unconfigured deployment is not handled — the client would throw on every launch';
  }
  return true;
});

check('a rotated push subscription re-registers itself', () => {
  // a browser rotates an endpoint on its own schedule; without this handler
  // the old one starts answering 410 and every reminder silently stops
  if (sw.indexOf('pushsubscriptionchange') === -1) return 'sw.js ignores a rotated subscription';
  if (sw.indexOf('api/push/subscribe') === -1) return 'the new endpoint is never sent anywhere';
  const subSrc = fs.readFileSync(path.join(ROOT, 'functions/api/push/subscribe.js'), 'utf8');
  if (subSrc.indexOf('body.previous') === -1) return 'the replaced endpoint is never cleaned up';
  if (subSrc.indexOf('fail_count = 0, disabled_at = NULL') === -1) {
    return 'a device that just proved it is alive stays disabled';
  }
  return true;
});

check('the permission banner tells the user when reminders cannot arrive', () => {
  ['notifyAlert', 'notifyAlertText', 'notifyAlertCta', 'notifyAlertIco'].forEach(id => {
    if (html.indexOf('id="' + id + '"') === -1) throw new Error('no #' + id);
  });
  if (!/\.nfy-alert\.is-blocked\{/.test(css)) return 'a blocked permission looks the same as an unasked one';
  if (!/\.nfy-cta\{[^}]*min-height:var\(--tap\)/.test(css.replace(/\s+/g, ' ').replace(/ \{/g, '{'))) {
    return 'the banner CTA is under the 44px tap floor';
  }

  const APP = loadApp();                       // this sandbox has no Notification at all
  APP.Store.load();
  if (APP.Notify.alertState() !== 'unsupported') {
    return 'a browser with no Notification API reports ' + APP.Notify.alertState();
  }

  // every state the banner has to speak for, driven through the real object
  APP.Notify.supported = () => true;
  APP.Notify.permission = () => 'denied';
  if (APP.Notify.alertState() !== 'denied') return 'a blocked permission is not reported as blocked';
  APP.Notify.permission = () => 'default';
  if (APP.Notify.alertState() !== 'ask') return 'an unasked permission is not reported';
  APP.Notify.permission = () => 'granted';
  APP.Store.data.prefs.notify.on = false;
  if (APP.Notify.alertState() !== 'off') return 'notifications switched off in-app are not reported';
  APP.Store.data.prefs.notify.on = true;
  if (APP.Notify.alertState() !== 'ok') return 'a working setup still nags';

  // a blocked permission cannot be re-requested, so the CTA has to teach
  // instead of pretending — requestPermission() there is a silent no-op
  if (js.indexOf('לביטול החסימה') === -1) return 'a blocked user is never told how to unblock';
  return true;
});

check('the server-link state is normalised on load and never crashes a legacy store', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();
  if (Store.data.prefs.notify.serverAt !== '') return 'serverAt does not default to local-only';
  // a store written before this sprint carries no serverAt at all
  Store.data.prefs.notify = { on: true, lead: 10, sound: true };
  Store.load();
  if (typeof Store.data.prefs.notify.serverAt !== 'string') return 'a legacy store leaves serverAt undefined';
  return true;
});

check('the shell has never regressed below the Sprint 11 cache version', () => {
  const m = sw.match(/CACHE_VERSION\s*=\s*'v(\d+)'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[1], 10) < 17) return 'the cache is still v' + m[1] + ' — returning phones keep the old shell';
  return true;
});

check('PROJECT_PLAN documents Sprint 11', () => {
  const required = [
    'Sprint 11', 'VAPID', 'RFC 8291', 'push_subscriptions', 'push_dispatch',
    '/api/push/dispatch', 'MISS_GRACE_MIN', 'armOnFirstGesture', 'v17'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   §44 — SPRINT 12
   multiple reminders per record, real-time visibility, the open-items sheet
   and the task detail reader
   ========================================================================== */

/* ---- 44a. the reminder vocabulary, widened ---- */

check('a record can carry several reminders at once', () => {
  const R = loadApp().reminders;

  // the mandate's own example: יום לפני AND בזמן האירוע, together
  const both = R.normRemindList('1440,at');
  if (both.length !== 2) return 'a two-reminder list collapsed to ' + JSON.stringify(both);

  // order is canonical, so two records with the same reminders serialise the
  // same way and the sync outbox sees no phantom change
  if (R.remindKey(['at', '1440']) !== R.remindKey(['1440', 'at'])) {
    return 'the same two reminders serialise two different ways';
  }
  if (R.remindKey(['at', 'at', '15']) !== '15,at') {
    return 'duplicates survive normalisation: ' + R.remindKey(['at', 'at', '15']);
  }
  /* the stored order is CHRONOLOGICAL, not the order the checkboxes are drawn
     in: "יום לפני · שעה לפני · בזמן האירוע" is the order those three actually
     arrive, and the detail reader lists them exactly as they are stored */
  if (R.remindKey(['at', '15', '1440', '60']) !== '1440,60,15,at') {
    return 'a list is not stored chronologically: ' + R.remindKey(['at', '15', '1440', '60']);
  }

  // the four mandated built-ins are all multi-selectable
  ['at', '15', '60', '1440'].forEach(k => {
    if (R.BUILTIN.indexOf(k) === -1) throw new Error(k + ' is not offered as a checkbox');
    if (R.MULTI.indexOf(k) === -1) throw new Error(k + ' cannot be combined with another');
  });

  // and a ceiling exists, so a stuck "+ הוסף" cannot grow a record without bound
  if (!(R.MAX > 4)) return 'REMIND_MAX is ' + R.MAX + ' — too small to hold the built-ins';
  const flood = R.normRemindList(Array.from({ length: 40 }, (_, i) =>
    '@2026-08-' + String((i % 28) + 1).padStart(2, '0') + 'T09:00'));
  if (flood.length > R.MAX) return 'the list grew to ' + flood.length + ', past the ceiling';
  return true;
});

check('a custom timestamp reminder is a first-class member of the list', () => {
  const R = loadApp().reminders;

  if (!R.isCustomRemind('@2026-08-02T07:30')) return 'a well-formed stamp is not recognised';
  ['@2026-08-02', '@2026-08-02T07', '2026-08-02T07:30', '@bogus', ''].forEach(bad => {
    if (R.isCustomRemind(bad)) throw new Error('"' + bad + '" was accepted as a custom reminder');
  });

  const mixed = R.normRemindList('at,@2026-08-02T07:30,@2026-08-01T06:00');
  // built-ins first, customs after — and the customs in chronological order
  if (mixed.join('|') !== 'at|@2026-08-01T06:00|@2026-08-02T07:30') {
    return 'a mixed list came back as ' + mixed.join('|');
  }
  if (R.customRemindDate('@2026-08-02T07:30') !== '2026-08-02') return 'the date is misread';
  if (R.customRemindTime('@2026-08-02T07:30') !== '07:30') return 'the time is misread';
  // it must READ as something, or the detail sheet lists a raw token
  if (!R.customRemindText('@2026-08-02T07:30')) return 'a custom reminder has no human label';
  return true;
});

check('the muted state is the empty list, and nothing else can mean it', () => {
  const R = loadApp().reminders;

  if (R.normRemindList('none').length !== 0) return "'none' does not mute";
  if (R.remindersOf({ remind: 'none' }).length !== 0) return 'a legacy muted record is no longer muted';
  if (R.remindersOf({ reminders: [] }).length !== 0) return 'an empty list is not treated as muted';
  if (R.remindOn({ reminders: [] })) return 'remindOn() says a muted record wants reminders';
  if (!R.remindOn({ reminders: ['at'] })) return 'remindOn() says a record with a reminder wants none';

  /* An unknown key is NO OPINION, never silence. A forward-compatible
     vocabulary that muted a record it could not parse would drop reminders
     invisibly — the one failure the user cannot see happening. */
  if (R.remindersOf({ remind: 'someday' }).join() !== 'default') {
    return 'an unknown key was read as ' + JSON.stringify(R.remindersOf({ remind: 'someday' }));
  }
  if (R.remindersOf({}).join() !== 'default') return 'a record with no reminder field is not default';
  return true;
});

check('a pre-Sprint-12 record keeps exactly the behaviour it had', () => {
  const R = loadApp().reminders;
  // every single-key store and every single-key D1 row parses as a one-token
  // list, so nothing written before this sprint changes when it is announced
  ['default', 'at', '15', '60', '1440'].forEach(k => {
    const back = R.remindersOf({ remind: k });
    if (back.length !== 1 || back[0] !== k) {
      throw new Error("legacy '" + k + "' became " + JSON.stringify(back));
    }
    if (R.remindColumn({ remind: k }) !== k) throw new Error("legacy '" + k + "' no longer round-trips");
  });
  if (R.remindColumn({ remind: 'none' }) !== 'none') return 'a legacy mute does not round-trip';
  return true;
});

check('several reminders on one record are several deliveries, not one', () => {
  const APP = loadApp(), Store = APP.Store, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());
  const tomorrow = D.addDaysISO(today, 1);
  const now = clockNow();

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.fired = {};
  Store.data.prefs.notify.lead = 10;

  // tomorrow at this same minute: 1440 minutes out, so "יום לפני" is open and
  // "בזמן האירוע" is not — and both are carried by the SAME record
  const meeting = Store.add('events', {
    type: 'event', title: 'פגישה עם שתי התראות', category: 'business',
    date: tomorrow, start: hhmm(now), end: '', location: '', notes: '', clientId: '',
    reminders: ['1440', 'at']
  });

  const due = APP.Notify.due().filter(x => x.id === meeting.id);
  if (due.length !== 1) return 'expected only the day-before reminder now, got ' + due.length;
  if (due[0].tok !== '1440') return 'the wrong reminder is open: ' + due[0].tok;

  // and the two are marked separately, so neither can swallow the other
  const shown = [];
  APP.Notify.armed = () => true;
  APP.Notify.show = (tag) => { shown.push(tag); };
  APP.Notify.tick();
  APP.Notify.tick();
  if (shown.length !== 1) return 'the day-before reminder fired ' + shown.length + ' times';

  const marks = Object.keys(Store.data.prefs.fired);
  if (marks.length !== 1) return 'the ledger holds ' + marks.length + ' marks, expected 1';
  if (marks[0] !== '1440#' + meeting.id + '@' + tomorrow) return 'the mark is ' + marks[0];
  // the sweep reads the date off the END of the key — that invariant survived
  if (marks[0].slice(-10) !== tomorrow) return 'the sweep can no longer read a date off the mark';

  // the "בזמן האירוע" mark is a DIFFERENT key, so tomorrow it still fires
  if (Store.data.prefs.fired['at#' + meeting.id + '@' + tomorrow]) {
    return 'the day-before delivery consumed the at-the-time reminder too';
  }
  return true;
});

check('a custom timestamp reminder fires at the minute it names, once', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();
  const today = APP.isoDate(new Date());
  const now = clockNow();
  if (now < 180 || now > 1260) return true;        // needs room either side of midnight

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.fired = {};

  /* The point of a custom reminder: it has NOTHING to do with the record's own
     clock. This task is due in two hours; the reminder is for right now. */
  const task = Store.add('tasks', {
    type: 'task', title: 'משימה עם תזכורת מוחלטת', category: 'personal',
    due: today, time: hhmm(now + 120), status: 'todo', priority: 'medium',
    nextAction: '', subtasks: [], done: false, notes: '', clientId: '',
    reminders: ['@' + today + 'T' + hhmm(now)]
  });
  // ...and one for two hours from now, which must NOT fire early: a custom
  // stamp has no lead window at all
  const later = Store.add('tasks', {
    type: 'task', title: 'מאוחר יותר', category: 'personal',
    due: today, time: hhmm(now), status: 'todo', priority: 'medium',
    nextAction: '', subtasks: [], done: false, notes: '', clientId: '',
    reminders: ['@' + today + 'T' + hhmm(now + 120)]
  });

  const ids = APP.Notify.due().map(x => x.id);
  if (ids.indexOf(task.id) === -1) return 'a custom reminder for right now never fired';
  if (ids.indexOf(later.id) !== -1) return 'a custom reminder fired two hours early';

  const shown = [];
  APP.Notify.armed = () => true;
  APP.Notify.show = (tag) => { shown.push(tag); };
  APP.Notify.tick();
  APP.Notify.tick();
  if (shown.length !== 1) return 'the custom reminder fired ' + shown.length + ' times';
  if (shown[0] !== '@' + today + 'T' + hhmm(now) + '#' + task.id + '@' + today) {
    return 'the mark is ' + shown[0];
  }
  if (shown[0].slice(-10) !== today) return 'the sweep can no longer read a date off a custom mark';
  return true;
});

check('the form asks the two questions the mandate asks', () => {
  const APP = loadApp();
  const panel = APP.reminders.remindField();

  // 1. the master toggle, in the mandate's own words
  if (panel.indexOf('data-remindmode="on"') === -1) return 'no "עם התראה" switch';
  if (panel.indexOf('data-remindmode="off"') === -1) return 'no "ללא התראה" switch';
  if (APP.reminders.ON_LABEL.indexOf('עם התראה') === -1) return 'the on label is not "עם התראה"';
  if (APP.reminders.OFF_LABEL.indexOf('ללא התראה') === -1) return 'the off label is not "ללא התראה"';

  // 2. multi-select checkboxes — NOT a <select>, which could only say one thing
  const boxes = (panel.match(/type="checkbox"/g) || []).length;
  if (boxes < 5) return 'only ' + boxes + ' reminder checkboxes; expected default + the four leads';
  ['בזמן האירוע', '15 דקות לפני', 'שעה לפני', 'יום לפני'].forEach(t => {
    if (panel.indexOf(t) === -1) throw new Error('the panel never offers "' + t + '"');
  });

  // 3. any number of absolute reminders, added one at a time
  if (panel.indexOf('data-remindadd') === -1) return 'no "+ הוסף התראת זמן נוספת" button';
  if (panel.indexOf('הוסף התראת זמן נוספת') === -1) return 'the add button is not the mandated copy';
  if (js.indexOf("type=\"datetime-local\" data-remindwhen=") === -1) {
    return 'a custom reminder has no date-and-time picker';
  }

  // and one hidden field is what submitForm()'s generic sweep collects
  if (panel.indexOf('name="reminders"') === -1) return 'the panel submits nothing';
  return true;
});

check('the reminder panel round-trips a real record through the form', () => {
  const APP = loadApp(), F = APP.reminders.FormRemind;
  // no DOM: load()/paint() must survive a document with no form in it, which
  // is also the browser state between two openForm() calls
  const held = '1440,at,@2026-08-02T07:30';
  F.load(held);
  if (!F.on) return 'a record with reminders opened muted';
  if (F.customs.length !== 1) return 'the custom reminder was not unpacked';
  if (F.value() !== held) return 'the panel re-serialised as ' + F.value();

  F.setMode('off');
  if (F.value() !== 'none') return 'the off switch does not mute; it emits ' + F.value();
  F.setMode('on');
  if (F.value() !== held) return 'switching back lost the list';

  F.toggle('at', false);
  if (F.value().indexOf('at') !== -1) return 'unticking a box left it in the list';
  F.toggle('at', true);
  if (F.value() !== held) return 'ticking the box back did not restore the list';

  // "עם התראה" with nothing ticked is not silence — silence is the other switch
  F.load('');
  F.setMode('on');
  ['default', 'at', '15', '60', '1440'].forEach(k => F.toggle(k, false));
  if (F.value() !== 'default') return 'an armed panel with nothing ticked emits ' + F.value();

  // a muted record opens muted, so the toggle tells the truth on open
  F.load('none');
  if (F.on) return 'a muted record opened with reminders armed';
  return true;
});

/* ---- 44b. §2 — real-time visibility ---- */

check('a record created for today is on all three surfaces at once', () => {
  const APP = loadApp(), Store = APP.Store, U = APP.ui, T = APP.tasks;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.filter = 'all';

  const task = Store.add('tasks', {
    type: 'task', title: 'משימה מתוזמנת להיום', category: 'personal',
    due: today, time: '14:00', status: 'new', priority: 'medium',
    nextAction: '', subtasks: [], done: false, notes: '', clientId: '',
    reminders: ['at']
  });

  // 1. the timeline, in its own hour bucket
  const slot = U.timelineEntries().filter(e => e.rec.id === task.id)[0];
  if (!slot) return 'the task never reached the timeline';
  if (slot.hour !== 14) return 'the task landed in the ' + slot.hour + ':00 bucket, expected 14:00';
  if (U.timelineKeys().indexOf('tasks:' + task.id) === -1) return 'the paint order does not hold it';

  // 2. today's board
  if (U.boardTasksToday().map(x => x.id).indexOf(task.id) === -1) return "it is not on today's board";

  // 3. the calendar's own day list
  if (U.boardTasksOn(today).map(x => x.id).indexOf(task.id) === -1) return 'the calendar day does not hold it';

  // ...and it is NOT in the inbox: נכנסים is "no date", and this one has one
  if (T.inboxTasks().map(x => x.id).indexOf(task.id) !== -1) {
    return 'a dated task was filed into נכנסים';
  }
  if (APP.tasks.taskMatchesTab(task, 'inbox', today)) return 'taskMatchesTab() sends a dated task to נכנסים';
  if (!APP.tasks.taskMatchesTab(task, 'today', today)) return 'a task due today does not match היום';

  // an event created for today reaches the timeline the same way
  const ev = Store.add('events', {
    type: 'event', title: 'פגישה היום', category: 'business', date: today,
    start: '15:00', end: '', location: '', notes: '', clientId: '', reminders: ['at']
  });
  if (U.timelineKeys().indexOf('events:' + ev.id) === -1) return 'a new event never reached the timeline';
  return true;
});

check('a new event finally meets its migrator, exactly like every other type', () => {
  const APP = loadApp(), Store = APP.Store;
  Store.load();
  /* Store.shaped() had branches for clients, tasks, lists and notes — and none
     for events. A freshly created event was the ONE record that never met its
     migrator and entered the store unnormalised, while every event arriving
     from D1 or from localStorage was normalised twice. */
  const shaped = bodyOf(js, 'shaped: function (collection, rec)');
  if (shaped.indexOf('migrateEvent') === -1) return 'Store.shaped() still skips events';

  const ev = Store.add('events', {
    type: 'event', title: 'לא מנורמל', category: 'personal',
    date: APP.isoDate(new Date()), start: '09:00', end: '', location: '',
    notes: '', clientId: '', remind: 'nonsense-from-a-future-build'
  });
  if (!Array.isArray(ev.reminders)) return 'a new event carries no reminder list';
  if (ev.remind !== 'default') return 'an unknown key survived into the store as ' + ev.remind;
  return true;
});

check('a saved record cannot be hidden by the filter it was saved outside of', () => {
  const APP = loadApp(), Store = APP.Store, U = APP.ui;
  Store.load();
  Store.data.prefs.filter = 'business';

  /* pick() gates every read path, so a personal task created while the filter
     reads "עסקי" is counted by the summary and drawn by nothing — the exact
     shape of the field report, and a reload "fixed" it only because the user
     changed the filter on the way back in. */
  const note = U.reveal('personal', '');
  if (Store.data.prefs.filter !== 'all') return 'the filter still hides the record that was just saved';
  if (!note) return 'the widening happened silently — the user is never told why the view moved';

  // a record INSIDE the active filter moves nothing: silence is the common case
  Store.data.prefs.filter = 'business';
  if (U.reveal('business', '')) return 'a record already in view widened the filter anyway';
  if (Store.data.prefs.filter !== 'business') return 'the filter was widened for no reason';
  return true;
});

check('the calendar follows a record saved outside the period it is showing', () => {
  const APP = loadApp(), Store = APP.Store, U = APP.ui, Cal = APP.Cal, D = APP.dates;
  Store.load();
  Store.data.prefs.filter = 'all';

  /* Cal.anchor is captured once, when app.js is PARSED. A home-screen PWA is
     resumed rather than reloaded, so an app left open overnight is anchored on
     yesterday and a record created "for today" lands on a day the calendar is
     not showing. Only a reload re-anchored it — which is why refreshing
     "fixed" the bug. */
  Cal.view = 'day';
  Cal.anchor = '2026-01-01';
  const far = '2026-09-15';
  if (U.calShows(far)) return 'the day view claims to show a day nine months away';

  U.reveal('personal', far);
  if (Cal.anchor !== far) return 'the calendar stayed on ' + Cal.anchor;
  if (!U.calShows(far)) return 'the calendar moved but still does not show the day';

  // a day the period already covers moves nothing
  Cal.view = 'month';
  Cal.anchor = '2026-09-01';
  const inMonth = '2026-09-20';
  U.reveal('personal', inMonth);
  if (Cal.anchor !== '2026-09-01') return 'the anchor jumped for a day the month already showed';

  // and the day-rollover guard re-anchors an app that was never reloaded
  const today = APP.isoDate(new Date());
  const yesterday = D.addDaysISO(today, -1);
  Cal.anchor = yesterday;
  if (js.indexOf('function dayGuard') === -1) return 'no dayGuard()';
  if (!/setInterval\(function \(\) \{ dayGuard\(\);/.test(js)) return 'the day guard is never run on a clock';
  if (js.indexOf('dayGuard();\n        self.paint();') === -1) {
    return 'a phone waking from sleep never re-checks the date';
  }
  return true;
});

/* ---- 44c. §3 — every open item, in one chronology ---- */

check('the "פתוחות" counter is a door, and so is the widget count', () => {
  if (js.indexOf('data-openall="1"') === -1) return 'the summary chip opens nothing';
  if (!/class="chip chip-btn" data-openall/.test(js)) return 'the chip is not a real button';
  if (html.indexOf('id="upcomingCount"') === -1) return 'the widget count is gone';
  if (!/id="upcomingCount"[^>]*data-openall="1"/.test(html)) return 'the widget count opens nothing';
  // a <button> may never nest inside a <button>
  if (/<button[^>]*id="upcomingToggle"[\s\S]{0,400}?<button[^>]*id="upcomingCount"[\s\S]{0,80}?<\/button>[\s\S]{0,80}?<\/button>/.test(html)) {
    return 'the count button is nested inside the toggle button';
  }
  ['id="openSheet"', 'id="openList"', 'id="openFilters"', 'id="openMeta"'].forEach(id => {
    if (html.indexOf(id) === -1) throw new Error('the document ships no ' + id);
  });
  return true;
});

check('the open-items sheet holds everything open, chronologically', () => {
  const APP = loadApp(), Store = APP.Store, U = APP.ui, D = APP.dates;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.filter = 'all';

  const task = (title, due, time, status) => Store.add('tasks', {
    type: 'task', title, category: 'personal', due, time, status,
    priority: 'medium', nextAction: '', subtasks: [], done: status === 'done',
    notes: '', clientId: '', reminders: ['default']
  });
  const ev = (title, date, start) => Store.add('events', {
    type: 'event', title, category: 'business', date, start, end: '',
    location: '', notes: '', clientId: '', reminders: ['default']
  });

  const late = task('באיחור', D.addDaysISO(today, -3), '09:00', 'todo');
  const soonTask = task('היום', today, '15:00', 'todo');
  const farTask = task('בעוד חודשיים', D.addDaysISO(today, 60), '09:00', 'todo');
  const inbox = task('ללא תאריך', '', '', 'todo');
  const closed = task('הושלמה', today, '10:00', 'done');
  const meeting = ev('פגישה היום', today, '11:00');
  const farMeeting = ev('פגישה בעוד חודש', D.addDaysISO(today, 30), '09:00');
  const past = ev('פגישה שהייתה', D.addDaysISO(today, -2), '09:00');

  const ids = U.openRows('all').map(r => r.rec.id);

  /* This is the whole point: the counter has always counted these and no
     surface has ever listed them. A task two months out and a meeting next
     month were counted by "פתוחות" and drawn by nothing. */
  [late, soonTask, farTask, inbox, meeting, farMeeting].forEach(r => {
    if (ids.indexOf(r.id) === -1) throw new Error('"' + r.title + '" is counted but not listed');
  });
  if (ids.indexOf(closed.id) !== -1) return 'a completed task is listed as open';
  if (ids.indexOf(past.id) !== -1) return 'a meeting that already happened is listed as outstanding';

  // chronological, undated last, a meeting ahead of a self-appointment
  const rows = U.openRows('all');
  let prev = '';
  for (const r of rows) {
    const key = r.on || '9999-99-99';
    if (key < prev) return 'the list is out of order at ' + r.rec.title;
    prev = key;
  }
  if (rows[rows.length - 1].rec.id !== inbox.id) return 'the undated row is not last';
  const dayRows = rows.filter(r => r.on === today);
  if (dayRows[0].collection !== 'events') return 'a task outranks a meeting inside the same day';

  // the quick filters, each of which must actually partition
  const of = f => U.openRows(f).map(r => r.rec.id);
  if (of('tasks').indexOf(meeting.id) !== -1) return 'the tasks filter leaks an event';
  if (of('events').indexOf(soonTask.id) !== -1) return 'the events filter leaks a task';
  if (of('today').some(id => [farTask.id, inbox.id, late.id].indexOf(id) !== -1)) {
    return 'the היום filter is not scoped to today';
  }
  if (of('late').join() !== late.id) return 'the באיחור filter is wrong';
  if (of('undated').join() !== inbox.id) return 'the ללא תאריך filter is wrong';
  if (of('week').indexOf(farTask.id) !== -1) return 'the השבוע filter reaches two months out';
  if (of('week').indexOf(soonTask.id) === -1) return 'the השבוע filter misses today';

  // every filter the document offers has a predicate behind it
  APP.ui.OPEN_FILTERS.forEach(f => {
    if (html.indexOf('data-openfilter="' + f + '"') === -1) throw new Error('no chip for the ' + f + ' filter');
  });
  (html.match(/data-openfilter="(\w+)"/g) || []).forEach(m => {
    const f = m.match(/"(\w+)"/)[1];
    if (APP.ui.OPEN_FILTERS.indexOf(f) === -1) throw new Error('the chip "' + f + '" filters nothing');
  });

  // the rows carry data-rec, so a tap reaches the record and Patch can update it
  if (U.openRowHTML(rows[0]).indexOf('data-rec="') === -1) return 'an open-sheet row is not a real card';
  if (U.openKeys().length !== U.openRows().length) return 'the membership keys do not match the rows';
  return true;
});

check('the open-items sheet declines to paint while it is closed', () => {
  // the same rule openTrash() keeps: painting a closed sheet burns a rebuild
  // on a container nobody can see, and the sheet would open empty
  const body = bodyOf(js, 'function renderOpenSheet(quiet)');
  if (!body) return 'no renderOpenSheet()';
  if (body.indexOf('openSheetOpen()') === -1) return 'the paint is not gated on the sheet being open';
  // comments are stripped first: the reason the order matters is written right
  // above the two calls, and it names both of them
  const door = bodyOf(js, 'function openOpenSheet()')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (door.indexOf("openSheet('openSheet')") === -1) return 'the sheet is never unhidden';
  if (door.indexOf("openSheet('openSheet')") > door.indexOf('renderOpenSheet()')) {
    return 'the sheet is painted before it is unhidden — it would open empty';
  }
  // and it is a list container like any other: rebuilt only when membership moved
  const settle = bodyOf(js, 'settle: function ()');
  if (settle.indexOf("sameKeys(domKeys('#openList'), openKeys())") === -1) {
    return 'the sheet is rebuilt on every patch, not only when its membership moved';
  }
  return true;
});

/* ---- 44d. §4 — the task detail reader ---- */

check('tapping a task or an event opens the reader, not a form', () => {
  const APP = loadApp(), U = APP.ui;
  ['tasks', 'events'].forEach(c => {
    if (U.TAP_DETAIL.indexOf(c) === -1) throw new Error(c + ' cards do not open a reading view');
    if (U.TAP_EDIT.indexOf(c) === -1) throw new Error(c + ' cards no longer answer a tap at all');
  });
  // a list or a note has no reading surface of its own — its whole content is
  // already on the card — so those still open their form directly
  ['lists', 'notes'].forEach(c => {
    if (U.TAP_DETAIL.indexOf(c) !== -1) throw new Error(c + ' gained a reader it does not need');
  });
  const gate = bodyOf(js, 'function openTapped(collection, id)');
  if (!gate) return 'no openTapped()';
  if (gate.indexOf('Detail.open') === -1) return 'the reader is never opened';
  if (gate.indexOf('openEdit') === -1) return 'lists and notes lost their tap-to-edit';
  // a tap inside the reader must not resolve to the card underneath it
  if (bodyOf(js, 'function tapEditKey(target)').indexOf('Detail.isOpen()') === -1) {
    return 'a tap inside the reader would open a second layer';
  }
  return true;
});

check('the reader states everything the mandate lists, reminders included', () => {
  const APP = loadApp(), Store = APP.Store, D = APP.reminders;
  Store.load();
  const today = APP.isoDate(new Date());

  Store.data.clients.length = 0;
  Store.data.tasks.length = 0;
  const client = Store.add('clients', {
    type: 'client', name: 'דנה כהן', category: 'business', phone: '', email: '',
    status: 'quoted', interest: '', budget: '', nextAction: '', nextActionAt: '',
    followUpAt: '', notes: ''
  });
  const task = Store.add('tasks', {
    type: 'task', title: 'לשלוח הצעת מחיר', category: 'business',
    due: today, time: '14:00', status: 'progress', priority: 'high',
    nextAction: 'לאסוף מידות', subtasks: [], done: false,
    notes: 'הפירוט המלא של המשימה, שאף כרטיס לא היה מציג עד הסוף.',
    clientId: client.id, reminders: ['1440', 'at', '@' + today + 'T07:30']
  });

  const Reader = APP.ui.Detail;
  Reader.collection = 'tasks';
  Reader.id = task.id;
  const out = Reader.body(Store.find('tasks', task.id));

  // כותרת מלאה והערות/פירוט
  if (out.indexOf('לשלוח הצעת מחיר') === -1) return 'the reader omits the title';
  if (out.indexOf('שאף כרטיס לא היה מציג עד הסוף') === -1) return 'the reader omits the notes';
  // תאריך ושעה
  if (out.indexOf('14:00') === -1) return 'the reader omits the time';
  // קטגוריה ושם לקוח מקושר
  if (out.indexOf('עסקי') === -1) return 'the reader omits the category';
  if (out.indexOf('דנה כהן') === -1) return 'the reader omits the linked client';
  // רשימת כל ההתראות הפעילות — INCLUDING the custom one
  ['יום לפני', 'בזמן האירוע'].forEach(t => {
    if (out.indexOf(t) === -1) throw new Error('the reader never lists "' + t + '"');
  });
  if (out.indexOf(D.customRemindText('@' + today + 'T07:30')) === -1) {
    return 'the reader never lists the custom reminder';
  }
  if (out.indexOf('התראות (3)') === -1) return 'the reader does not say how many reminders there are';

  // a muted record says so, rather than saying nothing at all
  const quiet = Store.add('tasks', {
    type: 'task', title: 'מושתקת', category: 'personal', due: today, time: '',
    status: 'todo', priority: 'low', nextAction: '', subtasks: [], done: false,
    notes: '', clientId: '', reminders: []
  });
  Reader.id = quiet.id;
  const muted = Reader.body(Store.find('tasks', quiet.id));
  if (muted.indexOf('ללא התראה') === -1) return 'a muted record does not say it is muted';

  // an inbox task reads as an inbox task, not as a blank date
  if (Store.add('tasks', { type: 'task', title: 'נכנסים', category: 'personal', due: '', time: '', status: 'todo', priority: 'low', nextAction: '', subtasks: [], done: false, notes: '', clientId: '' }) &&
      Reader.body({ title: 'x', due: '', time: '', status: 'todo', priority: 'low', category: 'personal' }).indexOf('נכנסים') === -1) {
    return 'an undated task does not read as נכנסים';
  }
  return true;
});

check('the reader offers עריכה, סימון כבוצע and מחיקה', () => {
  ['id="detailSheet"', 'id="detailBody"', 'id="detailSheetTitle"', 'id="detailDone"'].forEach(id => {
    if (html.indexOf(id) === -1) throw new Error('the document ships no ' + id);
  });
  ['edit', 'done', 'delete'].forEach(a => {
    if (html.indexOf('data-detailact="' + a + '"') === -1) throw new Error('the reader offers no ' + a);
  });
  if (html.indexOf('עריכה') === -1 || html.indexOf('סימון כבוצע') === -1 || html.indexOf('מחיקה') === -1) {
    return 'the action copy is not the mandated Hebrew';
  }

  const APP = loadApp(), Store = APP.Store, Reader = APP.ui.Detail;
  Store.load();
  Store.data.tasks.length = 0;
  const today = APP.isoDate(new Date());
  const task = Store.add('tasks', {
    type: 'task', title: 'לסמן', category: 'personal', due: today, time: '',
    status: 'todo', priority: 'medium', nextAction: '', subtasks: [], done: false,
    notes: '', clientId: '', reminders: ['default']
  });

  // the reader drives the SAME writer every other surface does, so `done` can
  // never drift out of lockstep with status
  const act = bodyOf(js, 'act: function (what)');
  if (act.indexOf('toggleTaskDone(rec)') === -1) return 'the reader writes status by hand';
  if (act.indexOf('confirmDelete(') === -1) return 'the reader deletes without the one confirmation door';
  if (act.indexOf('openEdit(collection, id)') === -1) return 'עריכה does not open the record it is reading';

  // the sandbox has no document: the targeted-patch engine and the reader's own
  // paint both want one, and neither is what this check is about
  APP.ui.Patch.apply = () => true;
  Reader.collection = 'tasks';
  Reader.id = task.id;
  Reader.act('done');
  if (Store.find('tasks', task.id).status !== 'done') return 'סימון כבוצע did not mark the task';
  if (!Store.find('tasks', task.id).done) return 'status and done drifted apart';
  Reader.act('done');
  if (Store.find('tasks', task.id).status === 'done') return 'the second tap did not un-mark it';

  // an event has no status to move, so the button is not offered on one
  // (several objects in app.js carry a paint(); this one is addressed by its
  // own line rather than by whichever paint: bodyOf() happens to find first)
  if (js.indexOf("done.hidden = this.collection !== 'tasks'") === -1) {
    return 'an event is offered a "סימון כבוצע" it cannot honour';
  }
  return true;
});

/* ---- 44e. §5 — the server half of a multi-reminder record ---- */

check('the dispatcher speaks the same reminder vocabulary as the client', () => {
  const DS = loadDispatch(), R = loadApp().reminders;

  // the two parsers must agree on every shape either end can produce
  ['default', 'at', '15', '60', '1440', 'none', '', '1440,at',
    'at,@2026-08-02T07:30', '@2026-08-01T06:00,@2026-08-02T07:30,60',
    'nonsense', 'at,at,15'].forEach(v => {
      const client = R.normRemindList(v).length ? R.normRemindList(v) : R.remindersOf({ remind: v });
      const server = DS.remindTokens(v);
      if (client.join('|') !== server.join('|')) {
        throw new Error('"' + v + '" → client ' + client.join('|') + ' vs server ' + server.join('|'));
      }
    });
  return true;
});

check('the dispatcher sends each reminder of a record separately', () => {
  const DS = loadDispatch();
  const now = { date: '2026-07-28', minutes: 10 * 60 };          // 10:00 local
  const tomorrow = '2026-07-29';

  const rows = {
    events: [
      // ONE record, two built-in reminders. At 10:00 today only the day-before
      // lead reaches tomorrow's 10:00 meeting; "בזמן האירוע" is 1440 out.
      { id: 'e-two', title: 'שתי התראות', start_time: tomorrow + 'T10:00', remind_key: '1440,at' },
      // a custom stamp fires at the minute it names and has no lead at all
      { id: 'e-cust', title: 'מוחלטת', start_time: tomorrow + 'T18:00', remind_key: '@2026-07-28T10:00' },
      { id: 'e-cust-early', title: 'מאוחר יותר', start_time: tomorrow + 'T18:00', remind_key: '@2026-07-28T12:00' },
      // muted stays muted, however the list is written
      { id: 'e-mute', title: 'מושתקת', start_time: '2026-07-28T10:05', remind_key: 'none' }
    ],
    tasks: []
  };

  const due = DS.selectDue(rows, now, 10);
  const keys = due.map(x => x.key);

  const two = due.filter(x => x.id === 'e-two');
  if (two.length !== 1) return 'expected only the day-before reminder now, got ' + two.length;
  if (two[0].tok !== '1440') return 'the wrong reminder opened: ' + two[0].tok;
  if (two[0].key !== '1440#e-two@' + tomorrow) return 'the mark is ' + two[0].key;
  // the ledger sweep is `on_date < today`, so the reminder's OWN date is what
  // must be recorded — a custom reminder next week must survive tonight
  if (two[0].on !== tomorrow) return 'the ledger would sweep the mark early';

  const cust = due.filter(x => x.id === 'e-cust')[0];
  if (!cust) return 'a custom reminder due right now never fired';
  if (cust.key !== '@2026-07-28T10:00#e-cust@2026-07-28') return 'the custom mark is ' + cust.key;
  if (cust.key.slice(-10) !== '2026-07-28') return 'the custom mark does not end in its own date';
  if (keys.some(k => k.indexOf('e-cust-early') !== -1)) return 'a custom reminder fired two hours early';
  if (keys.some(k => k.indexOf('e-mute') !== -1)) return 'a muted record was announced anyway';

  // every mark is distinct, or one delivery would consume another
  if (new Set(keys).size !== keys.length) return 'two reminders share one ledger key';

  // and scan() must mark by that key, not by the record
  const src = read('functions/api/push/dispatch.js');
  if (src.indexOf("item.id + '@' + item.on") !== -1) {
    return 'the dispatcher still keys the ledger per record, not per reminder';
  }
  if (src.indexOf('.bind(item.key).first()') === -1) return 'the ledger is not read by the reminder key';
  return true;
});

check('migration 0005 widens the vocabulary without touching a column', () => {
  const p = path.join(ROOT, 'migrations', '0005_sprint12_multi_remind.sql');
  if (!fs.existsSync(p)) return 'migration 0005 is missing';
  const sql = fs.readFileSync(p, 'utf8');

  // APPEND-ONLY: the earlier migrations are never edited, and this one must
  // not add a column either — healthcheck rebuilds the entity column order out
  // of 0001 + 0002 + 0003 and the client and Worker both list remind_key last
  if (/ALTER\s+TABLE/i.test(sql)) return 'migration 0005 alters a table — the column order would drift';
  if (/DROP|DELETE\s+FROM/i.test(sql)) return 'migration 0005 destroys data';

  // it repairs rows that were never given a choice, exactly as 0003 did
  if (!/UPDATE events SET remind_key = 'default'/.test(sql)) return 'events rows are not repaired';
  if (!/UPDATE tasks\s+SET remind_key = 'default'/.test(sql)) return 'tasks rows are not repaired';

  // and it documents the widened vocabulary, because the column itself cannot
  ['@YYYY-MM-DDTHH:MM', 'none', 'default', 'preserve-if-blank'].forEach(s => {
    if (sql.indexOf(s) === -1) throw new Error('0005 does not document ' + s);
  });

  // the three schema listings still agree, and remind_key still sits exactly
  // where migration order puts it — nothing but a LATER migration's columns may
  // follow it (Sprint 13's 0006 appends two)
  const APP = loadApp();
  ['events', 'tasks'].forEach(t => {
    const cols = APP.sync.SCHEMA[t];
    const at = cols.indexOf('remind_key');
    if (at === -1) throw new Error(t + ' no longer declares remind_key');
    const stray = cols.slice(at + 1).filter(c => AFTER_REMIND.indexOf(c) === -1);
    if (stray.length) throw new Error(t + ' puts [' + stray.join(', ') + '] after remind_key');
  });
  return true;
});

/* ---- 44f. shipped shell and specification ---- */

/**
 * The shell version, and the ONE rule that matters about it: whatever
 * CACHE_VERSION says, both cache-busted URLs in index.html must say the same
 * thing, or a phone downloads a new worker and keeps booting the old app.js.
 * Sprint 12 pinned the literal 'v18', which was true for exactly one sprint —
 * the floor is kept (never go backwards) and the agreement is now derived.
 */
check('the shell was bumped for this sprint, and the ?v= is in step', () => {
  const m = sw.match(/CACHE_VERSION\s*=\s*'(v(\d+))'/);
  if (!m) return 'no CACHE_VERSION';
  if (parseInt(m[2], 10) < 18) return 'the cache is still ' + m[1] + ' — returning phones keep the old shell';
  if (html.indexOf('app.js?v=' + m[1]) === -1) return 'app.js is not busted to ' + m[1];
  if (html.indexOf('styles.css?v=' + m[1]) === -1) return 'styles.css is not busted to ' + m[1];
  return true;
});

check('PROJECT_PLAN documents Sprint 12', () => {
  const required = [
    'Sprint 12', 'normRemindList', 'remindersOf', 'עם התראה', 'ללא התראה',
    'הוסף התראת זמן נוספת', 'openEntries', 'Detail', 'dayGuard', 'reveal',
    '0005_sprint12_multi_remind.sql', 'v18'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   §45 — SPRINT 13
   the hamburger settings drawer, the header cleanup, the dual-sound engine
   and the per-record haptics
   ========================================================================== */

/**
 * A DOM stub that answers EVERY selector with a live node rather than null.
 * The Sprint-13 paint paths touch five modules at once (Settings, Notify,
 * Sync, GCal, the bin), and a stub that answered null would prove only that
 * they all decline — which is not what the drawer has to do.
 */
function domStub() {
  const nodes = {};
  const noop = () => {};
  function node(key) {
    if (nodes[key]) return nodes[key];
    const n = {
      key, hidden: true, disabled: false,
      textContent: '', innerHTML: '', value: '', className: '', title: '',
      dataset: {}, style: {}, attrs: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop, appendChild: noop, scrollIntoView: noop,
      closest: () => null
    };
    nodes[key] = n;
    return n;
  }
  return {
    node,
    doc: {
      readyState: 'loading',
      addEventListener: noop,
      documentElement: node('html'),
      body: { style: {} },
      querySelector: sel => node(sel),
      querySelectorAll: () => []
    }
  };
}

/** an AudioContext that schedules nothing and remembers everything */
function audioStub() {
  const scheduled = [];
  function Ctx() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  Ctx.prototype.resume = function () {};
  Ctx.prototype.createGain = function () {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}
    };
  };
  Ctx.prototype.createOscillator = function () {
    const osc = {
      type: '', frequency: {}, startedAt: null, stoppedAt: null, killed: false,
      connect() {},
      start(t) { osc.startedAt = t; scheduled.push(osc); },
      stop(t) { if (t === undefined) osc.killed = true; else osc.stoppedAt = t; }
    };
    return osc;
  };
  Ctx.scheduled = scheduled;
  return Ctx;
}

/* ---- 45a. header cleanup: what is left, and where the rest went ---- */

const topbarBlock = (html.match(/<header class="topbar"[\s\S]*?<\/header>/) || [''])[0];
const settingsBlock = (html.match(/<aside class="settings"[\s\S]*?<\/aside>/) || [''])[0];

check('the top bar is down to the title, the cloud badge and ☰', () => {
  if (!topbarBlock) return 'no <header class="topbar">';

  /* The mandate names them one by one: the bell, the speaker, the calendar,
     the Google readout and the floating bin. None of them may still be IN the
     header — and 45b proves each is still in the document, so this can only
     ever fail as "it was left behind", never as "it was deleted". */
  const gone = ['id="pushBtn"', 'id="soundBtn"', 'id="gcalBtn"', 'id="gcalSync"', 'id="trashBtn"'];
  const left = gone.filter(s => topbarBlock.indexOf(s) !== -1);
  if (left.length) return 'still cluttering the header: ' + left.join(', ');

  // the cloud badge stays — it is a status light, not a menu
  if (topbarBlock.indexOf('id="syncBtn"') === -1) return 'the cloud badge left the header too';
  if (topbarBlock.indexOf('id="menuBtn"') === -1) return 'no ☰ in the header';
  if (topbarBlock.indexOf('☰') === -1) return 'the hamburger has no glyph';
  return true;
});

check('☰ is the last item of the header row, so RTL puts it on the left', () => {
  const row = (topbarBlock.match(/<div class="topbar-row">[\s\S]*?<\/div>\s*<\/div>|<div class="topbar-row">[\s\S]*?\n      <\/div>/) || [''])[0];
  if (!row) return 'no .topbar-row';
  const menu = row.indexOf('id="menuBtn"');
  if (menu === -1) return 'the hamburger is not in the row';
  // nothing may follow it: the document is dir="rtl", so the LAST flex item is
  // the one that lands on the visual left edge the mandate asks for
  const after = row.slice(menu);
  if (/id="(syncBtn|pushBtn|gcalBtn|soundBtn)"/.test(after)) {
    return 'another control sits after ☰ — it would no longer be the left-most';
  }
  if (!/aria-haspopup="dialog"/.test(row)) return 'the hamburger does not announce it opens a dialog';
  if (!/aria-controls="settingsDrawer"/.test(row)) return 'the hamburger names no panel';
  return true;
});

check('every control the header lost is the SAME element, moved into the drawer', () => {
  if (!settingsBlock) return 'no settings drawer in the document';
  ['id="pushBtn"', 'id="pushIco"', 'id="pushLabel"',
    'id="soundBtn"', 'id="soundIco"', 'id="soundLabel"',
    'id="gcalBtn"', 'id="gcalIco"', 'id="gcalLabel"',
    'id="gcalSync"', 'id="gcalSyncText"', 'id="gcalUnlink"',
    'id="trashBtn"', 'id="trashCount"'].forEach(s => {
      if (settingsBlock.indexOf(s) === -1) throw new Error(s + ' is not inside the drawer');
    });

  // ...and every one of them is still bound by the same id in app.js, so the
  // move rebuilt no wiring and created no second owner of any fact
  ["$('#pushBtn')", "$('#soundBtn')", "$('#gcalBtn')", "$('#gcalUnlink')", "$('#trashBtn')"]
    .forEach(sel => {
      if (js.indexOf(sel) === -1) throw new Error(sel + ' lost its handler in the move');
    });
  return true;
});

check('the drawer carries the five sections the mandate names', () => {
  ['התראות, צלילים ורטט', 'סנכרון וחשבונות', 'נתונים וארכיון', 'מראה ועיצוב', 'אודות']
    .forEach(h => {
      if (settingsBlock.indexOf(h) === -1) throw new Error('no section: ' + h);
    });
  // ...and the controls each one is required to hold
  ['id="setShortSound"', 'id="setLongSound"', 'id="setVibe"', 'id="hapticsBtn"',
    'data-setsync="now"', 'data-action="archive-log"', 'data-settheme="dark"',
    'data-settheme="light"', 'data-settheme="system"', 'id="setVersion"', 'id="setHealth"']
    .forEach(s => {
      if (settingsBlock.indexOf(s) === -1) throw new Error('the drawer is missing ' + s);
    });
  if (settingsBlock.indexOf('סנכרן עכשיו') === -1) return 'no "סנכרן עכשיו" trigger';
  if (settingsBlock.indexOf('סל מחזור (10 ימים)') === -1) return 'the bin link lost its 10-day promise';
  if (settingsBlock.indexOf('יומן היסטוריה') === -1) return 'no link to the history log';
  return true;
});

/* ---- 45b. the drawer toggle, driven for real ---- */

check('☰ opens the drawer, and every close path shuts it', () => {
  const dom = domStub();
  const APP = loadApp({ document: dom.doc });
  APP.Store.load();
  const S = APP.settings.Settings;
  const el = dom.node('#settingsDrawer');

  if (S.isOpen()) return 'the drawer starts open';
  S.open();
  if (el.hidden) return 'open() left the panel hidden';
  if (!S.isOpen()) return 'isOpen() disagrees with the DOM';
  if (dom.node('#backdrop').hidden) return 'the drawer opened with no scrim behind it';
  if (dom.node('#menuBtn').getAttribute('aria-expanded') !== 'true') {
    return 'the hamburger does not report that it is expanded';
  }

  // toggle() closes through closeSheets(), which owns the scrim for every layer
  S.toggle();
  if (!el.hidden) return 'toggling an open drawer did not close it';
  if (dom.node('#menuBtn').getAttribute('aria-expanded') !== 'false') {
    return 'the hamburger still reports expanded after closing';
  }

  // ...and so does Escape / the ✕ / a tap on the scrim, all one function
  S.open();
  APP.settings.closeSheets();
  if (!el.hidden) return 'closeSheets() leaves the drawer open behind the app';
  return true;
});

check('the drawer counts as a layer, so a long press cannot select through it', () => {
  const tap = bodyOf(js, 'tap: function (target)');
  if (!tap) return 'no Select.tap()';
  if (tap.indexOf('.settings') === -1) return 'a tap inside the drawer is read as a card selection';
  const press = (js.match(/bindLongPress: function[\s\S]*?\n    \}/) || [''])[0];
  if (press.indexOf('.settings') === -1) return 'a long press inside the drawer enters selection mode';
  // anySheetOpen() is what the rest of the app asks before layering anything
  const any = (js.match(/function anySheetOpen\(\)[\s\S]*?\n  \}/) || [''])[0];
  if (any.indexOf('Settings.isOpen()') === -1) return 'anySheetOpen() does not count the drawer';
  return true;
});

/* ---- 45c. the dual-sound engine ---- */

check('two sound families ship, both synthesised, neither a binary asset', () => {
  const S = loadApp().settings;

  const shortNames = Object.keys(S.SHORT_SOUNDS);
  const longNames = Object.keys(S.LONG_RINGS);
  if (shortNames.length < 2) return 'only ' + shortNames.length + ' short preset(s) — nothing to choose between';
  if (longNames.length < 2) return 'only ' + longNames.length + ' long preset(s)';
  if (!S.SHORT_SOUNDS[S.SHORT_DEFAULT]) return 'the default short preset does not exist';
  if (!S.LONG_RINGS[S.LONG_DEFAULT]) return 'the default long ringtone does not exist';

  // every voice must be renderable: real tones, a real spacing, a real decay
  shortNames.concat(longNames).forEach(k => {
    const spec = S.SHORT_SOUNDS[k] || S.LONG_RINGS[k];
    if (!Array.isArray(spec.tones) || !spec.tones.length) throw new Error(k + ' has no tones');
    if (spec.tones.some(f => !(f > 0))) throw new Error(k + ' carries a non-positive frequency');
    if (!(spec.step > 0) || !(spec.tail > 0)) throw new Error(k + ' has no envelope');
    if (!spec.label) throw new Error(k + ' has no Hebrew label — the picker would show a key');
  });
  longNames.forEach(k => {
    if (!(S.LONG_RINGS[k].cycle > 0)) throw new Error(k + ' never repeats — it is not a ringtone');
  });

  // an .mp3 would be a tenth asset in the shell and a 404 away from silence
  if (/CORE_ASSETS[\s\S]*?\.(mp3|wav|ogg|m4a)/.test(sw)) return 'a sound ships as a cached audio file';
  if (/new Audio\(/.test(js)) return 'the engine falls back to an <audio> element';
  return true;
});

check('the long ringtone really rings for about ten seconds', () => {
  const Ctx = audioStub();
  const APP = loadApp({ AudioContext: Ctx });
  APP.Store.load();
  const S = APP.settings, Chime = S.Chime;

  if (!Chime.supported()) return 'the stubbed AudioContext was not detected';
  if (S.LONG_MS < 8000 || S.LONG_MS > 12000) return 'LONG_MS is ' + S.LONG_MS + 'ms, not the mandated ~10s';

  if (Chime.playLong(S.LONG_DEFAULT) !== true) return 'the ringtone declined to play';
  const spec = S.LONG_RINGS[S.LONG_DEFAULT];
  const seconds = S.LONG_MS / 1000;
  const cycles = Math.max(1, Math.floor(seconds / spec.cycle));

  if (Ctx.scheduled.length !== cycles * spec.tones.length) {
    return 'scheduled ' + Ctx.scheduled.length + ' notes, expected ' + cycles * spec.tones.length;
  }
  const last = Ctx.scheduled[Ctx.scheduled.length - 1];
  if (!(last.startedAt > seconds * 0.6)) {
    return 'the last note starts at ' + last.startedAt + 's — the ring dies out early';
  }
  if (last.startedAt > seconds) return 'the ring overruns its own ceiling';

  // ...and it can be cut short, or auditioning one in the drawer would outlive
  // the drawer by ten seconds
  const before = Ctx.scheduled.length;
  if (Chime.stop() !== true) return 'stop() reported nothing to stop';
  if (Ctx.scheduled.slice(0, before).filter(o => o.killed).length !== before) {
    return 'stop() left oscillators running';
  }
  if (Chime.stop() !== false) return 'a second stop() claimed to stop something';
  return true;
});

check('a short tone is short, and the record chooses the family', () => {
  const Ctx = audioStub();
  const APP = loadApp({ AudioContext: Ctx });
  APP.Store.load();
  const S = APP.settings, Chime = S.Chime;

  if (Chime.playShort(S.SHORT_DEFAULT) !== true) return 'the short tone declined to play';
  const spec = S.SHORT_SOUNDS[S.SHORT_DEFAULT];
  if (Ctx.scheduled.length !== spec.tones.length) return 'a short tone scheduled a ringtone';
  const last = Ctx.scheduled[Ctx.scheduled.length - 1];
  if (!(last.startedAt < 1)) return 'the "short" tone starts a note after a full second';

  // an unknown preset falls back rather than going silent — a store written by
  // a build that shipped a preset this one does not must still make a sound
  Chime.stop();
  Ctx.scheduled.length = 0;
  if (Chime.playShort('a-preset-that-never-existed') !== true) return 'an unknown preset is silence';
  if (!Ctx.scheduled.length) return 'the fallback preset scheduled nothing';

  // playAlert() reads the RECORD's family and the STORE's preset
  Chime.stop();
  Ctx.scheduled.length = 0;
  if (Chime.playAlert('none') !== false) return "'ללא' still made a sound";
  if (Ctx.scheduled.length) return "'ללא' scheduled " + Ctx.scheduled.length + ' notes';

  Ctx.scheduled.length = 0;
  Chime.playAlert('short');
  const shortCount = Ctx.scheduled.length;
  Chime.stop();
  Ctx.scheduled.length = 0;
  Chime.playAlert('long');
  if (!(Ctx.scheduled.length > shortCount)) {
    return 'the long family scheduled ' + Ctx.scheduled.length + ' notes, no more than the short one';
  }
  return true;
});

check('the chime toggle still outranks everything — silence means silence', () => {
  const Ctx = audioStub();
  const APP = loadApp({ AudioContext: Ctx });
  APP.Store.load();
  APP.Store.data.prefs.notify.sound = false;
  const Chime = APP.settings.Chime;

  if (Chime.playShort('bell') !== false) return 'a muted chime still played a short tone';
  if (Chime.playLong('classic') !== false) return 'a muted chime still rang for ten seconds';
  if (Chime.playAlert('long') !== false) return 'a record overrode the global mute';
  if (Ctx.scheduled.length) return 'a muted chime scheduled ' + Ctx.scheduled.length + ' notes';
  return true;
});

/* ---- 45d. the vibration patterns and the touch-feedback toggle ---- */

check('the four mandated vibration kinds exist and are really distinct', () => {
  const S = loadApp().settings;
  if (S.VIBE_KINDS.join(',') !== 'none,short,long,repeat') {
    return 'the vocabulary is ' + S.VIBE_KINDS.join(',');
  }
  if (S.VIBE_PATTERN.none !== null) return "'ללא' carries a pattern";
  ['short', 'long', 'repeat'].forEach(k => {
    const p = S.VIBE_PATTERN[k];
    if (!Array.isArray(p) || !p.length) throw new Error(k + ' has no pattern');
    if (p.some(ms => !(ms > 0))) throw new Error(k + ' carries a non-positive interval');
    if (!S.VIBE_LABEL[k]) throw new Error(k + ' has no Hebrew label');
  });
  const sum = a => a.reduce((n, x) => n + x, 0);
  if (!(sum(S.VIBE_PATTERN.long) > sum(S.VIBE_PATTERN.short))) {
    return 'the "long" pulse is not longer than the "short" one';
  }
  if (!(S.VIBE_PATTERN.repeat.length > S.VIBE_PATTERN.long.length)) {
    return 'the "repeating" pulse does not repeat';
  }
  return true;
});

check('a reminder vibrates with the pattern its record asked for', () => {
  const calls = [];
  const APP = loadApp({ navigator: { vibrate: p => { calls.push(p); return true; } } });
  APP.Store.load();
  const H = APP.settings.Haptics, S = APP.settings;

  if (H.pattern('none') !== false) return "'ללא' still buzzed";
  if (calls.length) return "'ללא' reached the motor";

  ['short', 'long', 'repeat'].forEach(k => {
    calls.length = 0;
    if (H.pattern(k) !== true) throw new Error(k + ' did not fire');
    if (String(calls[0]) !== String(S.VIBE_PATTERN[k])) {
      throw new Error(k + ' fired [' + calls[0] + '] instead of [' + S.VIBE_PATTERN[k] + ']');
    }
  });

  // an unknown kind from a future build falls back rather than going silent
  calls.length = 0;
  H.pattern('someday');
  if (String(calls[0]) !== String(S.VIBE_PATTERN[S.VIBE_DEFAULT])) {
    return 'an unknown vibration kind was read as silence';
  }
  return true;
});

check('“רטט במגע” silences taps and NEVER silences a reminder', () => {
  const calls = [];
  const APP = loadApp({ navigator: { vibrate: p => { calls.push(p); return true; } } });
  APP.Store.load();
  const H = APP.settings.Haptics;

  if (APP.Store.data.prefs.haptics !== true) return 'touch feedback does not default on';
  if (H.light() !== true) return 'a tap does not buzz with the default settings';

  APP.Store.data.prefs.haptics = false;
  calls.length = 0;
  if (H.light() !== false) return 'a tap still buzzed with touch feedback off';
  if (H.check() !== false) return 'the ✓ still buzzed with touch feedback off';
  if (H.done() !== false) return 'a completion still buzzed with touch feedback off';
  if (calls.length) return 'the motor was reached ' + calls.length + ' times with the switch off';

  /* The whole point of the separation: turning off the INTERFACE's buzz must
     not turn off the NOTIFICATION's. A user who finds tap feedback annoying
     has not asked to stop being told about meetings. */
  if (H.pattern('long') !== true) return 'a reminder was silenced by the touch-feedback switch';

  // ...and with no motor at all, every path answers false rather than throwing
  const bare = loadApp();
  bare.Store.load();
  if (bare.settings.Haptics.pattern('repeat') !== false) return 'a device with no motor claimed to buzz';
  return true;
});

/* ---- 45e. the per-record schema, end to end ---- */

check('sound and vibration are stored ON THE RECORD, with honest defaults', () => {
  const S = loadApp().settings;

  if (S.ALERT_SOUNDS.join(',') !== 'none,short,long') {
    return 'the sound vocabulary is ' + S.ALERT_SOUNDS.join(',');
  }
  ['none', 'short', 'long'].forEach(k => {
    if (!S.ALERT_SOUND_LABEL[k]) throw new Error(k + ' has no Hebrew label');
  });
  // the mandate's own wording, so the form says what the mandate asked for
  if (S.ALERT_SOUND_LABEL.long.indexOf('10') === -1) {
    return 'the long option does not say how long it is';
  }

  // every unknown, absent or malformed value normalises to the default
  [undefined, null, '', 'loud', 42, {}].forEach(bad => {
    if (S.normAlertSound(bad) !== S.ALERT_SOUND_DEFAULT) {
      throw new Error(JSON.stringify(bad) + ' did not normalise to the default sound');
    }
    if (S.normVibe(bad) !== S.VIBE_DEFAULT) {
      throw new Error(JSON.stringify(bad) + ' did not normalise to the default vibration');
    }
  });
  // 'none' is a real choice and must survive normalisation
  if (S.normAlertSound('none') !== 'none') return "'ללא' is normalised away";
  if (S.normVibe('none') !== 'none') return "'ללא רטט' is normalised away";

  // a record written before this sprint carries neither key and still reads
  const legacy = S.alertOf({ id: 'x', title: 'ישן' });
  if (legacy.sound !== 'short' || legacy.vibe !== 'short') {
    return 'a pre-Sprint-13 record reads as ' + JSON.stringify(legacy);
  }
  if (!S.alertSentence({ alertSound: 'long', alertVibe: 'repeat' })) {
    return 'the pair has no human sentence — the reader would print a token';
  }
  return true;
});

check('the pair survives the store, the D1 row and the trip back', () => {
  const APP = loadApp();
  const Store = APP.Store, SY = APP.sync, S = APP.settings;
  Store.load();
  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.notes.length = 0;

  const meeting = Store.add('events', {
    type: 'event', title: 'שיחת לקוח', category: 'business',
    date: '2026-08-02', start: '10:00', end: '', location: '', notes: '', clientId: '',
    alertSound: 'long', alertVibe: 'repeat'
  });
  if (meeting.alertSound !== 'long' || meeting.alertVibe !== 'repeat') {
    return 'the store dropped the choice on the way in';
  }

  ['events', 'tasks', 'notes'].forEach(t => {
    const cols = SY.SCHEMA[t];
    ['alert_sound', 'alert_vibe'].forEach(c => {
      if (cols.indexOf(c) === -1) throw new Error(t + ' declares no ' + c);
    });
  });

  const row = SY.toRow('events', meeting);
  if (row.alert_sound !== 'long' || row.alert_vibe !== 'repeat') return 'the row lost the pair';
  if (!SY.validRow('events', row)) return 'the emitted row is rejected by the payload guard';
  const back = SY.fromRow('events', row);
  if (back.alertSound !== 'long' || back.alertVibe !== 'repeat') return 'the pull lost the pair';

  // the column is NEVER '' — it is preserve-if-blank on the Worker side, so a
  // blank could never clear a choice, and a silent record says 'none' instead
  const muted = SY.toRow('tasks', Store.add('tasks', {
    type: 'task', title: 'בשקט', category: 'personal', due: '', time: '',
    status: 'new', priority: 'medium', nextAction: '', subtasks: [], done: false,
    notes: '', clientId: '', alertSound: 'none', alertVibe: 'none'
  }));
  if (muted.alert_sound !== 'none' || muted.alert_vibe !== 'none') return 'a muted record does not round-trip';
  ['events', 'tasks', 'notes'].forEach(t => {
    const r = SY.toRow(t, { id: 'x', title: 'y', body: 'y', updatedAt: 1, createdAt: 1 });
    if (r.alert_sound === '' || r.alert_vibe === '') throw new Error(t + ' emits a blank alert column');
  });

  // an unknown value from a future build normalises rather than corrupts
  const odd = SY.fromRow('events', Object.assign({}, row, { alert_sound: 'siren', alert_vibe: '' }));
  if (odd.alertSound !== S.ALERT_SOUND_DEFAULT || odd.alertVibe !== S.VIBE_DEFAULT) {
    return 'an unknown value survived a pull as ' + odd.alertSound + '/' + odd.alertVibe;
  }
  return true;
});

check('migration 0006 appends the two columns without editing 0001–0005', () => {
  const alerts = read(MIGRATION_ALERTS);
  ['events', 'tasks', 'notes'].forEach(t => {
    ['alert_sound', 'alert_vibe'].forEach(c => {
      if (!new RegExp('ALTER TABLE ' + t + '\\s+ADD COLUMN\\s+' + c + '\\b').test(alerts)) {
        throw new Error(t + '.' + c + ' is never added');
      }
      if (!new RegExp('UPDATE\\s+' + t + '\\s+SET\\s+' + c + "\\s*=\\s*'short'").test(alerts)) {
        throw new Error(t + '.' + c + ' rows are not backfilled');
      }
    });
  });
  // append-only: no earlier migration may mention the new columns
  [sql, sqlGcal, sqlRemind, read('migrations/0005_sprint12_multi_remind.sql')].forEach((src, i) => {
    if (src.indexOf('alert_sound') !== -1) throw new Error('migration ' + (i + 1) + ' was edited');
  });
  if (/DROP|DELETE\s+FROM/i.test(alerts)) return 'migration 0006 destroys data';

  // ...and SQL, Worker and client still agree, with the pair trailing everything
  ['events', 'tasks', 'notes'].forEach(t => {
    const cols = sqlColumns(t);
    if (cols.slice(-2).join(',') !== 'alert_sound,alert_vibe') {
      return void (() => { throw new Error(t + ' ends with [' + cols.slice(-2).join(', ') + ']'); })();
    }
    if (W.SCHEMA[t].columns.join() !== cols.join()) throw new Error(t + ': the Worker drifted from the SQL');
    if (SY.SCHEMA[t].join() !== cols.join()) throw new Error(t + ': the client drifted from the SQL');
  });
  return true;
});

check('a blank alert column can never erase a stored choice', () => {
  const shared = read('functions/api/_shared.js');
  const block = (shared.match(/const PRESERVE_IF_BLANK = \{[\s\S]*?\n\};/) || [''])[0];
  if (!block) return 'no PRESERVE_IF_BLANK map';
  ['events', 'tasks', 'notes'].forEach(t => {
    const line = (block.match(new RegExp(t + ':[\\s\\S]*?\\]')) || [''])[0];
    if (line.indexOf('alert_sound') === -1) throw new Error(t + '.alert_sound is not preserved');
    if (line.indexOf('alert_vibe') === -1) throw new Error(t + '.alert_vibe is not preserved');
  });
  // /api/gcal/sync writes whole event rows built from a Google payload, which
  // knows nothing about this vocabulary — the guard is what stops every
  // inbound Google edit from nulling the choice
  const gsync = read('functions/api/gcal/sync.js');
  if (/alert_sound\s*=\s*(NULL|'')/.test(gsync)) return 'the Google cycle clears the column directly';
  return true;
});

/* ---- 45f. the picker in the form ---- */

check('task, event and note forms all carry the alert picker', () => {
  const APP = loadApp();
  APP.Store.load();
  const S = APP.settings;

  const markup = S.alertField();
  S.ALERT_SOUNDS.forEach(k => {
    if (markup.indexOf('data-alertsound="' + k + '"') === -1) throw new Error('no sound option ' + k);
  });
  S.VIBE_KINDS.forEach(k => {
    if (markup.indexOf('data-alertvibe="' + k + '"') === -1) throw new Error('no vibration option ' + k);
  });
  if (markup.indexOf('name="alertSound"') === -1 || markup.indexOf('name="alertVibe"') === -1) {
    return 'the picker does not serialise into the form';
  }

  // the three types the mandate names build it; the two it does not, do not
  const fields = (js.match(/var FIELDS = \{[\s\S]*?\n  \};/) || [''])[0];
  if (!fields) return 'no FIELDS map';
  ['event', 'task', 'note'].forEach(t => {
    const block = (fields.match(new RegExp(t + ': function \\(\\) \\{[\\s\\S]*?\\n    \\},?')) || [''])[0];
    if (block.indexOf('alertField()') === -1) throw new Error('the ' + t + ' form has no alert picker');
  });

  // the delegate has to reach both rows, or the buttons are decoration
  if (js.indexOf('[data-alertsound]') === -1 || js.indexOf('[data-alertvibe]') === -1) {
    return 'the picker rows are not delegated';
  }
  if (js.indexOf("FormAlert.set('sound'") === -1 || js.indexOf("FormAlert.set('vibe'") === -1) {
    return 'a tap on the picker changes nothing';
  }
  return true;
});

check('the picker round-trips a real record through the form', () => {
  const APP = loadApp();
  const Store = APP.Store, U = APP.ui, S = APP.settings;
  Store.load();
  Store.data.tasks.length = 0;

  const task = Store.add('tasks', {
    type: 'task', title: 'להתקשר', category: 'business', due: '2026-08-03', time: '09:00',
    status: 'todo', priority: 'high', nextAction: '', subtasks: [], done: false,
    notes: '', clientId: '', alertSound: 'long', alertVibe: 'repeat'
  });

  // TO_FORM is what pre-fills an edit; it must carry the pair or every edit
  // silently resets the record to the defaults
  const form = U.TO_FORM.tasks(task);
  if (form.alertSound !== 'long' || form.alertVibe !== 'repeat') {
    return 'the edit form opens on ' + form.alertSound + '/' + form.alertVibe;
  }

  // ...and applyEdit writes an actual change back
  const label = U.applyEdit('tasks', task.id,
    { title: 'להתקשר', due: '2026-08-03', time: '09:00', status: 'todo', priority: 'high',
      nextAction: '', notes: '', clientId: '', subtasks: '',
      alertSound: 'none', alertVibe: 'long' }, 'business');
  if (!label) return 'the edit was refused';
  const after = Store.find('tasks', task.id);
  if (after.alertSound !== 'none' || after.alertVibe !== 'long') {
    return 'the edit did not land: ' + after.alertSound + '/' + after.alertVibe;
  }

  // a form with NO picker (a list, a client) must leave the record's own pair
  // alone rather than resetting it
  const kept = S.setAlertFrom({ alertSound: 'long', alertVibe: 'repeat' }, { title: 'x' });
  if (kept.alertSound !== 'long' || kept.alertVibe !== 'repeat') {
    return 'a form with no picker reset the record to the defaults';
  }
  return true;
});

check('the reminder that fires carries the record’s own sound and vibration', () => {
  const APP = loadApp();
  const Store = APP.Store, D = APP.dates;
  Store.load();
  Store.data.events.length = 0;
  Store.data.tasks.length = 0;
  Store.data.prefs.fired = {};
  Store.data.prefs.notify.lead = 10;

  const now = clockNow();
  const today = APP.isoDate(new Date());

  // starting this very minute, with "בזמן האירוע" — a zero-lead reminder whose
  // window is open right now, so the scan has to hand it over
  const loud = Store.add('events', {
    type: 'event', title: 'פגישה רועשת', category: 'business',
    date: today, start: hhmm(now), end: '', location: '', notes: '', clientId: '',
    reminders: ['at'], alertSound: 'long', alertVibe: 'repeat'
  });

  const due = APP.Notify.due().filter(d => d.id === loud.id);
  if (!due.length) return 'a reminder due at this very minute was not raised';
  if (!due[0].alert) return 'the due entry carries no alert options';
  if (due[0].alert.sound !== 'long' || due[0].alert.vibe !== 'repeat') {
    return 'the entry carries ' + JSON.stringify(due[0].alert);
  }

  // and show() is what turns them into a real notification
  const show = bodyOf(js, 'show: function (tag, title, body, alert)');
  if (!show) return 'Notify.show() no longer takes the record’s alert options';
  if (show.indexOf('Chime.playAlert(') === -1) return 'the sound is not chosen per record';
  if (show.indexOf('VIBE_PATTERN[a.vibe]') === -1) return 'the notification carries a fixed vibration';
  if (js.indexOf('self.show(key, item.title, item.body, item.alert)') === -1) {
    return 'the scan drops the alert options before delivery';
  }
  return true;
});

/* ---- 45g. theme, system preferences and אודות ---- */

check('the theme switch resolves “לפי המערכת” instead of storing it on the DOM', () => {
  const S0 = loadApp().settings;
  if (S0.THEMES.join(',') !== 'dark,light,system') return 'the vocabulary is ' + S0.THEMES.join(',');
  if (S0.THEME_DEFAULT !== 'dark') return 'the mandated dark palette is no longer the default';

  function drive(systemIsLight) {
    const dom = domStub();
    const APP = loadApp({
      document: dom.doc,
      matchMedia: q => ({ matches: q.indexOf('light') !== -1 ? systemIsLight : false, addEventListener() {} })
    });
    APP.Store.load();
    return { APP, dom };
  }

  const lightOS = drive(true);
  lightOS.APP.settings.Settings.setTheme('system');
  if (lightOS.APP.settings.Settings.resolvedTheme() !== 'light') {
    return '"לפי המערכת" ignored an OS asking for light';
  }
  if (lightOS.dom.node('html').getAttribute('data-theme') !== 'light') {
    return 'the resolved palette never reached <html>';
  }

  const darkOS = drive(false);
  darkOS.APP.settings.Settings.setTheme('system');
  if (darkOS.dom.node('html').getAttribute('data-theme') !== 'dark') {
    return 'an OS asking for dark resolved to ' + darkOS.dom.node('html').getAttribute('data-theme');
  }

  // an explicit choice overrides the OS in both directions
  darkOS.APP.settings.Settings.setTheme('light');
  if (darkOS.dom.node('html').getAttribute('data-theme') !== 'light') {
    return 'an explicit light choice was overridden by the OS';
  }
  // 'system' is a question, never a value the stylesheet has to understand
  if (['dark', 'light'].indexOf(darkOS.APP.settings.Settings.resolvedTheme()) === -1) {
    return 'an unresolved theme reached the DOM';
  }
  return true;
});

check('the light palette is a real palette, and still declares no literal outside :root', () => {
  const block = (css.match(/html\[data-theme="light"\]\s*\{[\s\S]*?\n\}/) || [''])[0];
  if (!block) return 'no [data-theme="light"] override block';

  // the whole point of the --l-* indirection: the override is var()-to-var(),
  // so check 4's "no colour literal outside :root" keeps holding
  if (/#[0-9a-f]{3,8}\b/i.test(block)) return 'the light theme declares a raw hex outside :root';
  if (/rgba?\(/i.test(block)) return 'the light theme declares a raw rgb/rgba outside :root';

  // it has to re-tint the surfaces, or "בהיר" is dark with lighter text
  ['--surface', '--card', '--ink', '--muted', '--line', '--gold', '--scrim', '--shadow']
    .forEach(t => {
      if (block.indexOf(t + ':') === -1) throw new Error('the light theme never overrides ' + t);
    });

  // the dark palette is still the mandated one (PROJECT_PLAN §7.0)
  if (!/--gold:\s*#e4c278/.test(rootBlock)) return 'the mandated gold was overwritten in :root';
  // ...and the light accent is NOT the same gold, because #e4c278 on paper is
  // roughly 1.8:1 and would fail the 4.5:1 floor on every gold label
  if (/--l-gold:\s*#e4c278/i.test(rootBlock)) return 'the light theme reuses an unreadable gold';
  return true;
});

check('אודות states the shipped version and a live health readout', () => {
  const m = sw.match(/CACHE_VERSION\s*=\s*'(v\d+)'/);
  const S = loadApp().settings;
  if (S.APP_VERSION !== m[1]) {
    return 'app.js says ' + S.APP_VERSION + ' and sw.js says ' + m[1];
  }

  const dom = domStub();
  const APP = loadApp({ document: dom.doc });
  APP.Store.load();
  const line = APP.settings.Settings.health();
  if (!line) return 'the health readout is empty';
  // it reports on the INSTALL, which is the half a repo-local suite cannot see
  ['אחסון מקומי', 'התראות', 'צליל', 'רטט', 'פריטים'].forEach(w => {
    if (line.indexOf(w) === -1) throw new Error('the readout never mentions ' + w);
  });
  return true;
});

check('PROJECT_PLAN documents Sprint 13', () => {
  const required = [
    'Sprint 13', 'settingsDrawer', 'menuBtn', 'הגדרות', 'צלצול',
    'רטט חוזר', 'alert_sound', 'alert_vibe', 'data-theme',
    '0006_sprint13_alerts.sql', 'v19'
  ];
  const missing = required.filter(s => plan.indexOf(s) === -1);
  return missing.length ? 'missing spec sections: ' + missing.join(' | ') : true;
});

/* ==========================================================================
   43g. Web Push crypto, executed against the real standards

   Everything above this point is synchronous. WebCrypto is not, and the two
   things most worth proving here — that a push service would accept the VAPID
   token, and that the target device could actually decrypt the payload — are
   pure promises. Getting either wrong produces a notification that is accepted
   by nobody and read by nothing, which looks exactly like "push does not work".

   So these run last, and report() waits for them.
   ========================================================================== */

const asyncChecks = [];

function checkAsync(name, fn) {
  asyncChecks.push(() => Promise.resolve()
    .then(fn)
    .then(res => {
      if (res === true || res === undefined) pass.push(name);
      else fail.push(name + ' — ' + res);
    })
    ['catch'](err => { fail.push(name + ' — threw: ' + err.message); }));
}

/** _webpush.js is import-free, so stripping its exports is enough to run it */
function loadWebPush() {
  const sandbox = {
    console, Date, Math, JSON, RegExp, Error, URL, crypto,
    atob, btoa, TextEncoder, TextDecoder, Uint8Array, DataView, ArrayBuffer,
    String, Array, Object, parseInt, fetch: () => Promise.reject(new Error('no network in a healthcheck'))
  };
  vm.createContext(sandbox);
  vm.runInContext(
    stripModule(webpushSrc) +
    '\n;globalThis.__wp = { b64urlToBytes, bytesToB64url, vapidHeader, encryptPayload, sendPush };',
    sandbox, { filename: '_webpush.js' });
  return sandbox.__wp;
}

checkAsync('the VAPID token is a real ES256 JWT a push service would accept', async () => {
  const WP = loadWebPush();
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

  const header = await WP.vapidHeader(
    'https://fcm.googleapis.com/fcm/send/abc123',
    WP.bytesToB64url(rawPub), jwk.d, 'mailto:ben@example.com'
  );

  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
  if (!m) return 'the Authorization header is not RFC 8292 shaped: ' + header.slice(0, 60);
  if (m[2] !== WP.bytesToB64url(rawPub)) return 'the header advertises a different key than it signed with';

  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  // the audience is the push service ORIGIN — a full endpoint there would leak
  // which device the token was minted for
  if (claims.aud !== 'https://fcm.googleapis.com') return 'aud is ' + claims.aud + ', expected the origin alone';
  if (claims.sub !== 'mailto:ben@example.com') return 'sub was dropped';
  const life = claims.exp - Math.floor(Date.now() / 1000);
  if (life <= 0 || life > 24 * 3600) return 'exp is ' + life + 's away, outside the 24-hour ceiling';
  if (JSON.parse(Buffer.from(h, 'base64url').toString('utf8')).alg !== 'ES256') return 'alg is not ES256';

  // the signature is raw r||s, and it must verify against the public half
  const sig = Buffer.from(s, 'base64url');
  if (sig.length !== 64) return 'the signature is ' + sig.length + ' bytes — DER, not the raw JWS pair';
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(h + '.' + p)
  );
  return valid ? true : 'the JWT signature does not verify against its own key';
});

checkAsync('an encrypted payload decrypts back on the receiving device (RFC 8291)', async () => {
  const WP = loadWebPush();

  // stand in for the phone: the key pair and auth secret a browser hands over
  // in the subscription
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));

  const message = JSON.stringify({ title: 'פגישה בעוד 10 דק׳', body: 'סטודיו · 14:00' });
  const body = await WP.encryptPayload(
    message, WP.bytesToB64url(uaPublic), WP.bytesToB64url(authSecret)
  );

  // parse the aes128gcm header the way a push client does
  const salt = body.slice(0, 16);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const rs = view.getUint32(16);
  const idlen = body[20];
  if (idlen !== 65) return 'the key id is ' + idlen + ' bytes, expected an uncompressed P-256 point';
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  if (rs < cipher.length) return 'the declared record size is smaller than the record';

  // redo the derivation from the device's side
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256)
  );

  const enc = new TextEncoder();
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const hmac = async (keyBytes, data) => {
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
  };
  const hkdf = async (s, ikm, info, len) =>
    (await hmac(await hmac(s, ikm), cat(info, new Uint8Array([1])))).slice(0, len);

  const keyInfo = cat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, cat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, cat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, cipher)
    );
  } catch (e) {
    return 'the device cannot decrypt the payload — the key ladder is wrong';
  }

  if (plain[plain.length - 1] !== 2) return 'the record is not terminated with the 0x02 delimiter';
  const back = new TextDecoder().decode(plain.slice(0, -1));
  if (back !== message) return 'the payload came back as ' + back.slice(0, 60);

  // Hebrew has to survive the round trip intact — every notification is Hebrew
  if (JSON.parse(back).title.indexOf('פגישה') !== 0) return 'the Hebrew title did not survive encryption';

  // and a fresh ephemeral key per message: reusing one would let a relay that
  // logs bodies link two messages to the same sender key
  const again = await WP.encryptPayload(message, WP.bytesToB64url(uaPublic), WP.bytesToB64url(authSecret));
  if (WP.bytesToB64url(again.slice(21, 86)) === WP.bytesToB64url(asPublic)) {
    return 'the same ephemeral key was reused for a second message';
  }
  return true;
});

checkAsync('a dead endpoint is an outcome, never an exception', async () => {
  const WP = loadWebPush();
  // no keys configured at all
  const none = await WP.sendPush({ endpoint: 'https://x/y', p256dh: '', auth: '' }, { title: 'x' }, {});
  if (none.ok !== false || none.error !== 'vapid_not_configured') {
    return 'an unconfigured deployment does not decline cleanly';
  }
  // a malformed subscription must not throw out of the dispatch loop, or one
  // bad row would abort every remaining device in the run
  const bad = await WP.sendPush(
    { endpoint: 'https://push.example/1', p256dh: 'not-a-key', auth: 'nope' },
    { title: 'x' },
    { VAPID_PUBLIC_KEY: 'B' + 'a'.repeat(85), VAPID_PRIVATE_KEY: 'a'.repeat(43) }
  );
  if (bad.ok !== false) return 'a malformed subscription reported success';
  if (bad.gone !== false) return 'a malformed subscription was mistaken for a retired one';
  return true;
});

/* --------------------------------------------------------------- report */

/* The synchronous checks have all run by now; §43g is promise-based, so the
   report waits for it rather than printing a green board mid-flight. */
asyncChecks
  .reduce((chain, run) => chain.then(run), Promise.resolve())
  ['catch'](err => { fail.push('async checks threw — ' + err.message); })
  .then(report);

function report() {
  const total = pass.length + fail.length;
  console.log('');
  console.log('  calendar-app healthcheck');
  console.log('  ' + '-'.repeat(52));
  pass.forEach(p => console.log('  PASS  ' + p));
  fail.forEach(f => console.log('  FAIL  ' + f));
  console.log('  ' + '-'.repeat(52));
  console.log('  ' + pass.length + '/' + total + ' checks passed');
  console.log('');
  process.exit(fail.length ? 1 : 0);
}
