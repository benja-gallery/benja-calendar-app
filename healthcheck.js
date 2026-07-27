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
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function must(hay, needle, label) {
  return hay.indexOf(needle) !== -1 ? true : 'missing ' + (label || needle);
}

/* -------------------------------------------------------------- 1. files */

const REQUIRED = [
  'index.html', 'styles.css', 'app.js', 'PROJECT_PLAN.md',
  'manifest.json', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon-180.png', 'icons/favicon-32.png'
];

check('required files present', () => {
  const missing = REQUIRED.filter(f => !fs.existsSync(path.join(ROOT, f)));
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

check('dates are computed in local time, never via toISOString', () => {
  // scan code only — a comment mentioning the anti-pattern is not the anti-pattern
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  if (/\.toISOString\s*\(/.test(code)) return 'toISOString() leaks UTC into calendar dates';
  if (!/function isoDate/.test(js)) return 'no isoDate() helper';
  return true;
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
  const buf = fs.readFileSync(path.join(ROOT, file));
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error(file + ' is not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

check('manifest.json is valid JSON with the mandated identity', () => {
  const m = JSON.parse(manifestRaw);
  const want = {
    name: 'יומן חכם — Benja',
    short_name: 'יומן',
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
    if (!fs.existsSync(path.join(ROOT, i.src))) throw new Error('missing file ' + i.src);
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
  if (!/d\.prefs\.notify = \{ on: false, lead: 10 \}/.test(js)) return 'legacy stores are not migrated';
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
  const tasksOn = (js.match(/function openTasksOn[\s\S]*?\n  \}/) || [''])[0];
  if (eventsOn.indexOf("pick('events')") === -1) return 'eventsOn() bypasses the filter';
  if (tasksOn.indexOf("pick('tasks')") === -1) return 'openTasksOn() bypasses the filter';
  return true;
});

check('selected calendar view persists to localStorage', () => {
  if (!/calView: 'month'/.test(js)) return 'no calView default in the blank store';
  if (!/CAL_VIEWS\.indexOf\(d\.prefs\.calView\) === -1/.test(js)) return 'calView is not normalised on load';
  if (!/prefs\.calView = v;\s*\n\s*Store\.save\(\);/.test(js)) return 'view choice is never saved';
  return true;
});

/* ---- 15b. date math, executed for real ---- */

/** run app.js in a bare sandbox — init() never fires, only window.APP is set */
function loadApp() {
  const noop = () => {};
  const sandbox = {
    console, Math, JSON, Date, Promise, RegExp, Error, isNaN, parseInt, parseFloat,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    navigator: {},
    location: { protocol: 'file:' },
    document: {
      readyState: 'loading',                 // keeps init() parked on DOMContentLoaded
      addEventListener: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { style: {} }
    }
  };
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
  if (!/TASK_TABS = \['all', 'today', 'late', 'waiting', 'done'\]/.test(js)) return 'TASK_TABS vocabulary changed';
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
    if (branch.indexOf('render()') === -1) throw new Error(k + ' does not repaint');
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

  if (ids('today') !== 'a') return 'היום selected [' + ids('today') + '], expected [a]';
  if (ids('late') !== 'bc') return 'באיחור selected [' + ids('late') + '], expected [bc]';
  if (ids('waiting') !== 'c') return 'ממתין selected [' + ids('waiting') + '], expected [c]';
  if (ids('done') !== 'd') return 'הושלם selected [' + ids('done') + '], expected [d]';
  if (ids('all') !== 'abcdef') return 'הכל dropped rows: [' + ids('all') + ']';
  // a cancelled task is neither open nor complete — it must not surface in a work tab
  if (ids('late').indexOf('e') !== -1) return 'a cancelled task leaked into באיחור';
  return true;
});

check('task ordering puts open work first, then due date, then priority', () => {
  const order = T.sortTasks([
    { id: 'done', status: 'done', due: '2026-01-01', priority: 'high' },
    { id: 'low', status: 'todo', due: '2026-07-27', priority: 'low' },
    { id: 'high', status: 'todo', due: '2026-07-27', priority: 'high' },
    { id: 'soon', status: 'waiting', due: '2026-07-01', priority: 'low' }
  ]).map(t => t.id).join(',');
  return order === 'soon,high,low,done' ? true : 'order is ' + order;
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
  return n >= 4 ? true : 'CACHE_VERSION is ' + m[1] + ', expected v4 or later';
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

/* --------------------------------------------------------------- report */

report();

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
