/* ==========================================================================
   Unified Personal & Business Productivity Center
   Sprint 1 — shell, "My Day" dashboard, Master Add, localStorage engine.
   Sprint 2 — PWA install shell, service worker, notifications engine.
   Sprint 3 — tasks engine (status / priority / next action / sub-tasks),
              smart checklist lists, quick notes.
   Sprint 7 — premium UX: haptic feedback, targeted DOM updates instead of
              full re-renders, and an undo window on every deletion.

   Architecture notes
   - Every entity carries category: 'personal' | 'business'  (PROJECT_PLAN §0.2)
   - Every entity carries id / ownerId / createdAt / updatedAt so the whole store
     can be lifted into D1 tables later without a data rewrite  (§0.4)
   - No credential check runs here. V1 session is local-only.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- const */

  var STORE_KEY = 'benja.productivity.v1';
  var OWNER = { id: 'ben-perez', name: 'בן פרץ', short: 'בן', timezone: 'Asia/Jerusalem' };

  var DAY_START = 8;   // timeline first hour
  var DAY_END = 22;    // timeline last hour

  var CATS = ['personal', 'business'];
  var CAT_LABEL = { personal: 'אישי', business: 'עסקי' };

  var TYPE_LABEL = {
    event: 'אירוע / פגישה',
    task: 'משימה',
    list: 'רשימה',
    note: 'פתק',
    client: 'לקוח חדש'
  };

  /* --- tasks engine (Sprint 3) --- */
  var TASK_STATUSES = ['new', 'todo', 'progress', 'waiting', 'done', 'cancelled'];
  var STATUS_LABEL = {
    'new': 'חדש', 'todo': 'לביצוע', 'progress': 'בתהליך',
    'waiting': 'ממתין ללקוח', 'done': 'הושלם', 'cancelled': 'בוטל'
  };
  /* the working loop a one-tap status chip walks; done/cancelled re-enter at לביצוע */
  var STATUS_CYCLE = ['new', 'todo', 'progress', 'waiting'];
  var CLOSED_STATUSES = ['done', 'cancelled'];

  var PRIORITIES = ['high', 'medium', 'low'];
  var PRIORITY_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  var TASK_TABS = ['all', 'today', 'late', 'waiting', 'done'];
  var TASK_TAB_EMPTY = {
    all: 'כל משימה שתוסיף תופיע כאן, מסודרת לפי תאריך יעד ועדיפות.',
    today: 'אין משימה פתוחה שתאריך היעד שלה הוא היום.',
    late: 'שום דבר לא נשאר מאחור — אין משימות באיחור.',
    waiting: 'אין משימה שממתינה כרגע לחזרה של לקוח.',
    done: 'עוד לא סומנה כאן משימה כהושלמה.'
  };

  /* --- client CRM (Sprint 4) --- */
  var CLIENT_STATUSES = ['lead', 'contacted', 'interested', 'quoted',
    'awaiting', 'meeting', 'won', 'irrelevant', 'past'];
  var CLIENT_STATUS_LABEL = {
    lead: 'ליד חדש', contacted: 'נוצר קשר', interested: 'מתעניין',
    quoted: 'נשלחה הצעה', awaiting: 'ממתין לתשובה', meeting: 'פגישה נקבעה',
    won: 'עסקה נסגרה', irrelevant: 'לא רלוונטי כרגע', past: 'לקוח עבר'
  };
  /* a closed relationship owes nobody a next action — see clientNeedsAction() */
  var CLIENT_CLOSED = ['won', 'irrelevant', 'past'];

  var CLIENT_TABS = ['all', 'new', 'active', 'waiting', 'closed'];
  var CLIENT_TAB_STATUSES = {
    'new': ['lead'],
    active: ['contacted', 'interested', 'quoted', 'meeting'],
    waiting: ['awaiting'],
    closed: CLIENT_CLOSED
  };
  var CLIENT_TAB_EMPTY = {
    all: 'כל לקוח שתוסיף יופיע כאן עם הסטטוס והפעולה הבאה שלו.',
    'new': 'אין לידים חדשים שממתינים לפנייה ראשונה.',
    active: 'אין כרגע לקוח פעיל בצינור המכירות.',
    waiting: 'אין לקוח שממתין לתשובה.',
    closed: 'עוד לא נסגרה כאן עסקה ולא הועבר תיק לארכיון.'
  };

  /* the one string the whole Next-Action alert engine hangs on */
  var NO_ACTION_BADGE = '⚠️ אין פעולה הבאה מוגדרת';

  var DRAWER_TABS = ['overview', 'meetings', 'tasks', 'lists', 'notes', 'history'];
  var DRAWER_TAB_LABEL = {
    overview: 'סקירה', meetings: 'פגישות', tasks: 'משימות',
    lists: 'רשימות', notes: 'פתקים', history: 'היסטוריה'
  };

  var HISTORY_KINDS = ['created', 'status', 'action', 'contact', 'note', 'link'];
  var HISTORY_ICON = {
    created: '✦', status: '⇄', action: '➜', contact: '📞', note: '✎', link: '🔗'
  };

  var HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var DOW_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  /* --- calendar engine (Sprint 2) --- */
  var CAL_VIEWS = ['day', 'week', 'month', 'agenda'];
  var CAL_LABEL = { day: 'תצוגת יום', week: 'תצוגת שבוע', month: 'תצוגת חודש', agenda: 'סדר יום' };
  var HOUR_PX = 56;      // day-view hour row height — mirrors --hour-h in styles.css
  var AGENDA_DAYS = 30;  // rolling agenda window
  var SWIPE_MIN = 55;    // px before a horizontal drag counts as navigation

  /* --- cloud sync engine (Sprint 5) --- */

  var SYNC_TABLES = ['events', 'tasks', 'lists', 'notes', 'clients'];

  /**
   * The column list of every D1 table, in the exact order
   * migrations/0001_sprint5_init.sql declares it. healthcheck.js cross-checks
   * this object against the SQL *and* against functions/api/_shared.js, so a
   * column can never be added in one place and forgotten in the other two.
   */
  var SYNC_SCHEMA = {
    events: ['id', 'title', 'category', 'start_time', 'end_time', 'location',
      'client_id', 'category_type', 'updated_at', 'owner_id', 'notes',
      'created_at', 'deleted_at',
      // Sprint 6 — the Google Calendar link, appended by migration 0002. The
      // browser only ever echoes these back; /api/gcal/sync is what fills them,
      // and the Worker refuses to let a blank echo erase them.
      'google_event_id', 'etag', 'google_calendar_id'],
    tasks: ['id', 'title', 'category', 'status', 'priority', 'due_date',
      'next_action', 'subtasks_json', 'client_id', 'updated_at', 'owner_id',
      'due_time', 'notes', 'created_at', 'deleted_at'],
    lists: ['id', 'title', 'category', 'items_json', 'client_id',
      'updated_at', 'owner_id', 'list_date', 'created_at', 'deleted_at'],
    notes: ['id', 'title', 'body', 'category', 'is_pinned', 'client_id',
      'updated_at', 'owner_id', 'created_at', 'deleted_at'],
    clients: ['id', 'name', 'phone', 'email', 'status', 'next_action',
      'initial_interest', 'updated_at', 'owner_id', 'category', 'budget',
      'next_action_at', 'follow_up_at', 'last_contact_at', 'general_notes',
      'client_notes_json', 'history_json', 'created_at', 'deleted_at']
  };

  /* relative — stays correct under a GitHub Pages sub-path, exactly like sw.js */
  var SYNC_ENDPOINT = 'api';
  var SYNC_STATES = ['synced', 'pending', 'offline'];
  var SYNC_LABEL = {
    synced: { ico: '🟢', text: 'מסונכרן לענן' },
    pending: { ico: '🟡', text: 'ממתין לסנכרון' },
    offline: { ico: '🔴', text: 'אופליין' }
  };
  var SYNC_MS = 30000;         // background flush cadence
  var SYNC_DEBOUNCE = 1200;    // quiet window after a local write before pushing
  var SYNC_BATCH = 100;        // ops per /api/sync round-trip (server caps at 200)
  var SYNC_QUEUE_MAX = 1000;   // outbox ceiling — one op per record, deduped
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

  /* --- premium touch feel (Sprint 7) --- */

  /** one short pulse under a finger — long enough to feel, short enough to
   *  never read as a buzz. Android/Chrome only; iOS has no web API at all. */
  var HAPTIC_LIGHT = 10;
  /** a two-beat confirmation, reserved for "this thing is now finished" */
  var HAPTIC_DONE = [10, 40, 10];

  var TOAST_MS = 2600;         // plain acknowledgement
  var UNDO_MS = 5000;          // the safety net stays open exactly five seconds
  var UNDO_LABEL = 'אחזר';

  /** what the undo toast calls the thing that just disappeared */
  var DELETED_LABEL = {
    events: 'האירוע', tasks: 'המשימה', lists: 'הרשימה',
    notes: 'הפתק', clients: 'הלקוח', clientNotes: 'הפתק'
  };

  /* ------------------------------------------------------------- utilities */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ==========================================================================
     Haptics (Sprint 7)

     navigator.vibrate exists on Android/Chrome, is permanently absent on iOS
     Safari, and is silently ignored by a browser whose tab has never been
     engaged. Every path through here is guarded and swallows its own errors:
     a tap must never fail because the device has no vibration motor.
     ========================================================================== */

  var Haptics = {
    supported: function () {
      return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    },

    /** the ONLY place in the app that is allowed to call navigator.vibrate */
    fire: function (pattern) {
      if (!Haptics.supported()) return false;
      try { return navigator.vibrate(pattern) !== false; } catch (e) { return false; }
    },

    /** every button tap, tab switch and status toggle */
    light: function () { return Haptics.fire(HAPTIC_LIGHT); },

    /** something completed — a task closed, a checklist filled up */
    done: function () { return Haptics.fire(HAPTIC_DONE); }
  };

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Local calendar date as YYYY-MM-DD — never via toISOString (that is UTC). */
  function isoDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayISO() { return isoDate(new Date()); }

  function parseISO(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDaysISO(s, n) {
    var d = parseISO(s) || new Date();
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  /* --- calendar date math — all local, never UTC (PROJECT_PLAN §3) --- */

  function startOfMonthISO(iso) {
    var d = parseISO(iso) || new Date();
    return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();     // day 0 of next month
  }

  /** Month stepping clamps into short months: 31/01 +1m => 28/02 (29 on a leap year). */
  function addMonthsISO(iso, n) {
    var d = parseISO(iso) || new Date();
    var y = d.getFullYear(), m = d.getMonth() + n;
    var target = new Date(y, m, 1);
    var day = Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth()));
    return isoDate(new Date(target.getFullYear(), target.getMonth(), day));
  }

  /** he-IL weeks start on Sunday (PROJECT_PLAN §3.5). */
  function startOfWeekISO(iso) {
    var d = parseISO(iso) || new Date();
    return addDaysISO(isoDate(d), -d.getDay());
  }

  function weekDays(iso) {
    var start = startOfWeekISO(iso), out = [];
    for (var i = 0; i < 7; i++) out.push(addDaysISO(start, i));
    return out;
  }

  /** Whole Sunday→Saturday weeks covering the anchor's month, and nothing more. */
  function monthMatrix(iso) {
    var first = startOfMonthISO(iso);
    var d = parseISO(first);
    var last = isoDate(new Date(d.getFullYear(), d.getMonth(), daysInMonth(d.getFullYear(), d.getMonth())));
    var cursor = startOfWeekISO(first);
    var out = [];
    while (cursor <= last || out.length % 7 !== 0) {
      out.push(cursor);
      cursor = addDaysISO(cursor, 1);
    }
    return out;
  }

  function agendaRange(iso, days) {
    return { from: iso, to: addDaysISO(iso, (days || AGENDA_DAYS) - 1) };
  }

  /** minutes since midnight, or null when there is no usable time */
  function minutesOf(time) {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    var p = time.split(':');
    var m = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    return (m >= 0 && m <= 1440) ? m : null;
  }

  function shiftTime(time, mins) {
    var m = minutesOf(time);
    if (m === null) return '';
    m = (m + mins) % 1440;
    if (m < 0) m += 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /**
   * Side-by-side placement for overlapping day-view blocks.
   * Items overlapping in time form a cluster; each gets the first free lane and
   * every member of the cluster is widened to 1/lanes so nothing is hidden.
   */
  function layoutBlocks(items) {
    var sorted = items.slice().sort(function (a, b) { return (a.s - b.s) || (a.e - b.e); });
    var out = [], cluster = [], clusterEnd = -1;

    function flush() {
      if (!cluster.length) return;
      var lanes = [];
      cluster.forEach(function (item) {
        var i = 0;
        for (; i < lanes.length; i++) { if (lanes[i] <= item.s) break; }
        lanes[i] = item.e;
        item.lane = i;
      });
      cluster.forEach(function (item) { item.lanes = lanes.length; out.push(item); });
      cluster = [];
    }

    sorted.forEach(function (item) {
      if (cluster.length && item.s >= clusterEnd) flush();
      cluster.push(item);
      clusterEnd = cluster.length === 1 ? item.e : Math.max(clusterEnd, item.e);
    });
    flush();
    return out;
  }

  function hebDate(iso) {
    var d = parseISO(iso);
    if (!d) return '';
    return 'יום ' + HE_DAYS[d.getDay()] + ', ' + d.getDate() + ' ב' + HE_MONTHS[d.getMonth()];
  }

  function fmtDayMon(iso) {
    var d = parseISO(iso);
    return d ? d.getDate() + ' ב' + HE_MONTHS[d.getMonth()] : '';
  }

  function relDay(iso) {
    var t = todayISO();
    if (iso === t) return 'היום';
    if (iso === addDaysISO(t, 1)) return 'מחר';
    if (iso === addDaysISO(t, -1)) return 'אתמול';
    return hebDate(iso);
  }

  /** "פגישה אחת" / "3 פגישות" */
  function plural(n, one, many) {
    return n === 1 ? one : n + ' ' + many;
  }

  function hourOf(time) {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    return parseInt(time.split(':')[0], 10);
  }

  function timeToMinutes(time) {
    var h = hourOf(time);
    if (h === null) return 24 * 60 + 1;                 // untimed sorts last
    return h * 60 + parseInt(time.split(':')[1], 10);
  }

  function normCat(c) { return CATS.indexOf(c) === -1 ? 'personal' : c; }

  /* ==========================================================================
     Tasks / lists / notes model  (Sprint 3)

     Everything below is pure: it takes a record (or a plain array) and returns
     a value, or mutates only that record. No DOM, no store lookups — that is
     what lets healthcheck.js execute the whole engine straight out of
     window.APP and assert real status transitions and progress arithmetic.
     ========================================================================== */

  function normStatus(s) { return TASK_STATUSES.indexOf(s) === -1 ? 'new' : s; }
  function normPriority(p) { return PRIORITIES.indexOf(p) === -1 ? 'medium' : p; }
  function isClosed(status) { return CLOSED_STATUSES.indexOf(normStatus(status)) !== -1; }

  /** {id,title,done} rows out of whatever a store ever held (v1 kept raw strings) */
  function normItems(items, prefix) {
    return (Array.isArray(items) ? items : [])
      .map(function (it) {
        if (typeof it === 'string') return { id: uid(prefix), title: it.trim(), done: false };
        if (!it || typeof it !== 'object') return null;
        return {
          id: it.id || uid(prefix),
          title: String(it.title == null ? '' : it.title).trim(),
          done: !!it.done
        };
      })
      .filter(function (it) { return it && it.title; });
  }

  /**
   * A Sprint-1 task carries only `done`. Status is the new source of truth and
   * `done` is kept in lockstep with it, so every selector written before this
   * sprint keeps returning the right rows.
   */
  function migrateTask(t) {
    if (!t || typeof t !== 'object') return t;
    if (t.status === undefined || t.status === null || t.status === '') {
      t.status = t.done ? 'done' : 'new';
    }
    t.status = normStatus(t.status);
    t.priority = normPriority(t.priority);
    t.nextAction = typeof t.nextAction === 'string' ? t.nextAction : '';
    t.subtasks = normItems(t.subtasks, 'st');
    t.done = t.status === 'done';
    return t;
  }

  function migrateList(l) {
    if (!l || typeof l !== 'object') return l;
    l.items = normItems(l.items, 'li');
    l.date = typeof l.date === 'string' ? l.date : '';       // '' = a timeless list
    return l;
  }

  function migrateNote(n) {
    if (!n || typeof n !== 'object') return n;
    n.pinned = !!n.pinned;
    n.body = typeof n.body === 'string' ? n.body : '';
    return n;
  }

  /** the single writer of task state — status and `done` never drift apart */
  function setTaskStatus(task, status) {
    if (!task) return task;
    var next = normStatus(status);
    if (next === 'done' && task.status !== 'done') task.prevStatus = normStatus(task.status);
    task.status = next;
    task.done = next === 'done';
    task.updatedAt = Date.now();
    return task;
  }

  /** one-tap check-off; un-checking returns the task to where it came from */
  function toggleTaskDone(task) {
    if (!task) return task;
    if (task.status === 'done') {
      var back = STATUS_CYCLE.indexOf(task.prevStatus) === -1 ? 'todo' : task.prevStatus;
      return setTaskStatus(task, back);
    }
    return setTaskStatus(task, 'done');
  }

  /** one-tap status chip: walk the working loop, closed statuses re-enter at לביצוע */
  function nextStatus(status) {
    var i = STATUS_CYCLE.indexOf(normStatus(status));
    return i === -1 ? 'todo' : STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
  }

  /** {done,total,pct} — sub-tasks and list items share one checklist shape */
  function progressOf(items) {
    var list = Array.isArray(items) ? items.filter(Boolean) : [];
    var done = list.filter(function (i) { return !!i.done; }).length;
    return {
      done: done,
      total: list.length,
      pct: list.length ? Math.round(done / list.length * 100) : 0
    };
  }

  function subtaskProgress(task) { return progressOf(task && task.subtasks); }
  function listProgress(list) { return progressOf(list && list.items); }

  /** toggles one checklist row in place and reports the new progress */
  function toggleItem(items, id) {
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (it && it.id === id) it.done = !it.done;
    });
    return progressOf(items);
  }

  /** the quick sub-tabs of the tasks view: היום · באיחור · ממתין · הושלם */
  function taskMatchesTab(task, tab, today) {
    if (!task) return false;
    var status = normStatus(task.status);
    var open = !isClosed(status);
    var t = today || todayISO();
    if (tab === 'today') return open && task.due === t;
    if (tab === 'late') return open && !!task.due && task.due < t;
    if (tab === 'waiting') return status === 'waiting';
    if (tab === 'done') return status === 'done';
    return true;                                              // 'all'
  }

  /** open first, then by due date, then by priority, then by time of day */
  function sortTasks(tasks) {
    return (Array.isArray(tasks) ? tasks.slice() : []).sort(function (a, b) {
      var ca = isClosed(a.status) ? 1 : 0, cb = isClosed(b.status) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      var da = a.due || '9999-99-99', db = b.due || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      var pa = PRIORITY_RANK[normPriority(a.priority)], pb = PRIORITY_RANK[normPriority(b.priority)];
      if (pa !== pb) return pa - pb;
      return timeToMinutes(a.time) - timeToMinutes(b.time);
    });
  }

  /** pinned notes float to the top, newest first inside each band */
  function sortNotes(notes) {
    return (Array.isArray(notes) ? notes.slice() : []).sort(function (a, b) {
      var pa = a.pinned ? 0 : 1, pb = b.pinned ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  /** a note becomes a task / an event — the text survives the type change */
  function noteToTask(note) {
    return {
      type: 'task', title: (note.title || note.body || 'פתק').slice(0, 80),
      category: normCat(note.category),
      due: todayISO(), time: '', status: 'todo', priority: 'medium',
      nextAction: '', subtasks: [], done: false, notes: note.body || ''
    };
  }

  function noteToEvent(note) {
    return {
      type: 'event', title: (note.title || note.body || 'פתק').slice(0, 80),
      category: normCat(note.category),
      date: todayISO(), start: '09:00', end: '10:00',
      location: '', notes: note.body || ''
    };
  }

  /* ==========================================================================
     Client CRM model  (Sprint 4)

     Same discipline as the tasks engine: every function below is pure — it
     takes a client record (or a plain array) and returns a value, or mutates
     only that record. No DOM, no store lookups. That is what lets
     healthcheck.js drive the whole CRM — the drawer tab builders included —
     straight out of window.APP.clients.
     ========================================================================== */

  function normClientStatus(s) {
    return CLIENT_STATUSES.indexOf(s) === -1 ? 'lead' : s;
  }

  /** עסקה נסגרה · לא רלוונטי כרגע · לקוח עבר — the pipeline is done with them */
  function clientClosed(c) {
    return CLIENT_CLOSED.indexOf(normClientStatus(c && c.status)) !== -1;
  }

  /**
   * The Next-Action alert engine (mandate §3): an ACTIVE client with no
   * designated next action is a hole in the pipeline, and the UI shouts about
   * it — on the card, in the drawer and on "היום שלי".
   */
  function clientNeedsAction(c) {
    if (!c || clientClosed(c)) return false;
    return !String(c.nextAction == null ? '' : c.nextAction).trim();
  }

  /** {id,body,at} rows; a store that ever held raw strings is adopted, not lost */
  function normClientNotes(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(function (n) {
        if (typeof n === 'string') return { id: uid('cn'), body: n.trim(), at: Date.now() };
        if (!n || typeof n !== 'object') return null;
        return {
          id: n.id || uid('cn'),
          body: String(n.body == null ? '' : n.body).trim(),
          at: typeof n.at === 'number' ? n.at : Date.now()
        };
      })
      .filter(function (n) { return n && n.body; });
  }

  function normHistory(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(function (h) {
        if (!h || typeof h !== 'object') return null;
        return {
          id: h.id || uid('hs'),
          at: typeof h.at === 'number' ? h.at : Date.now(),
          kind: HISTORY_KINDS.indexOf(h.kind) === -1 ? 'note' : h.kind,
          text: String(h.text == null ? '' : h.text).trim()
        };
      })
      .filter(function (h) { return h && h.text; });
  }

  /** a Sprint-1 client carries only name/phone/email/followUpAt/nextAction */
  function migrateClient(c) {
    if (!c || typeof c !== 'object') return c;
    c.status = normClientStatus(c.status);
    ['name', 'phone', 'email', 'interest', 'budget',
      'nextAction', 'nextActionAt', 'followUpAt', 'lastContactAt', 'notes'].forEach(function (k) {
        c[k] = typeof c[k] === 'string' ? c[k] : '';
      });
    c.clientNotes = normClientNotes(c.clientNotes);
    c.history = normHistory(c.history);
    return c;
  }

  /** the single writer of the timeline — newest first, capped so it cannot bloat */
  function logHistory(client, kind, text) {
    var body = String(text == null ? '' : text).trim();
    if (!client || !body) return null;
    if (!Array.isArray(client.history)) client.history = [];
    var entry = {
      id: uid('hs'),
      at: Date.now(),
      kind: HISTORY_KINDS.indexOf(kind) === -1 ? 'note' : kind,
      text: body
    };
    client.history.unshift(entry);
    if (client.history.length > 200) client.history.length = 200;
    client.updatedAt = entry.at;
    return entry;
  }

  /** every status move is written into the file — a pipeline you can audit */
  function setClientStatus(client, status) {
    if (!client) return client;
    var prev = normClientStatus(client.status);
    var next = normClientStatus(status);
    if (next === prev) return client;
    client.status = next;
    client.updatedAt = Date.now();
    logHistory(client, 'status',
      'סטטוס: ' + CLIENT_STATUS_LABEL[prev] + ' ➜ ' + CLIENT_STATUS_LABEL[next]);
    return client;
  }

  function setClientNextAction(client, text, when) {
    if (!client) return client;
    var next = String(text == null ? '' : text).trim();
    var prev = String(client.nextAction == null ? '' : client.nextAction).trim();
    client.nextAction = next;
    client.nextActionAt = typeof when === 'string' ? when : '';
    client.updatedAt = Date.now();
    if (next !== prev) {
      logHistory(client, 'action', next
        ? 'הפעולה הבאה: ' + next + (client.nextActionAt ? ' · ' + relDay(client.nextActionAt) : '')
        : 'הפעולה הבאה נמחקה');
    }
    return client;
  }

  function addClientNote(client, body) {
    var text = String(body == null ? '' : body).trim();
    if (!client || !text) return null;
    if (!Array.isArray(client.clientNotes)) client.clientNotes = [];
    var note = { id: uid('cn'), body: text, at: Date.now() };
    client.clientNotes.unshift(note);
    logHistory(client, 'note', 'נוסף פתק לתיק');
    return note;
  }

  /** a real-world touch: the file remembers when you last actually spoke */
  function markContact(client, channel) {
    if (!client) return client;
    client.lastContactAt = todayISO();
    logHistory(client, 'contact',
      channel === 'whatsapp' ? 'נשלחה הודעת וואטסאפ' : 'יצאה שיחת טלפון');
    return client;
  }

  /** the pipeline sub-tabs: הכל · לידים חדשים · פעילים · ממתינים · סגורים */
  function clientMatchesTab(c, tab) {
    if (!c) return false;
    if (tab === 'all' || CLIENT_TABS.indexOf(tab) === -1) return true;
    return CLIENT_TAB_STATUSES[tab].indexOf(normClientStatus(c.status)) !== -1;
  }

  /** open first, holes in the pipeline at the very top, then by when it is due */
  function sortClients(clients) {
    return (Array.isArray(clients) ? clients.slice() : []).sort(function (a, b) {
      var ca = clientClosed(a) ? 1 : 0, cb = clientClosed(b) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      var na = clientNeedsAction(a) ? 0 : 1, nb = clientNeedsAction(b) ? 0 : 1;
      if (na !== nb) return na - nb;
      var da = a.nextActionAt || a.followUpAt || '9999-99-99';
      var db = b.nextActionAt || b.followUpAt || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  /* --- direct call / WhatsApp targets --- */

  function telHref(phone) {
    var d = String(phone == null ? '' : phone).replace(/[^\d+]/g, '');
    return d ? 'tel:' + d : '';
  }

  /** 050-1234567 → 972501234567; an already-international number is left alone */
  function waNumber(phone) {
    var d = String(phone == null ? '' : phone).replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('972') === 0) return d;
    if (d.charAt(0) === '0') return '972' + d.slice(1);
    return d;
  }

  function waHref(phone) {
    var n = waNumber(phone);
    return n ? 'https://wa.me/' + n : '';
  }

  /* ------------------------------------------------------------------ store */

  var Store = {
    data: null,

    blank: function () {
      return {
        version: 1,
        owner: OWNER,
        prefs: {
          filter: 'all', calView: 'month', taskTab: 'all', clientTab: 'all',
          notify: { on: false, lead: 10 }, fired: {}
        },
        events: [], tasks: [], lists: [], notes: [], clients: [],
        sync: blankSync(),
        gcal: blankGCal(),
        seeded: false
      };
    },

    load: function () {
      var raw = null;
      try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }

      var d = this.blank();
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(function (k) {
              if (Array.isArray(parsed[k])) d[k] = parsed[k];
            });
            if (parsed.prefs && typeof parsed.prefs === 'object') d.prefs = parsed.prefs;
            if (parsed.sync && typeof parsed.sync === 'object') d.sync = parsed.sync;
            if (parsed.gcal && typeof parsed.gcal === 'object') d.gcal = parsed.gcal;
            d.seeded = !!parsed.seeded;
          }
        } catch (e) { /* corrupt payload — fall back to a blank store, never crash */ }
      }

      // category is non-nullable by spec; normalise defensively on every read path
      ['events', 'tasks', 'lists', 'notes', 'clients'].forEach(function (k) {
        d[k] = d[k].filter(Boolean).map(function (r) {
          r.category = normCat(r.category);
          if (!r.id) r.id = uid(k.slice(0, 2));
          if (!r.ownerId) r.ownerId = OWNER.id;
          // Sprint 4: the client association is a plain id, never null
          if (k !== 'clients') r.clientId = typeof r.clientId === 'string' ? r.clientId : '';
          return r;
        });
      });
      // Sprint 3 shapes: a v1 store holds status-less tasks and string list items
      d.tasks = d.tasks.map(migrateTask);
      d.lists = d.lists.map(migrateList);
      d.notes = d.notes.map(migrateNote);
      // Sprint 4 shapes: a pre-CRM client holds no status, no file, no timeline
      d.clients = d.clients.map(migrateClient);

      if (['all', 'personal', 'business'].indexOf(d.prefs.filter) === -1) d.prefs.filter = 'all';

      // the selected tasks sub-tab survives a reload exactly like the calendar view
      if (TASK_TABS.indexOf(d.prefs.taskTab) === -1) d.prefs.taskTab = 'all';

      // and so does the selected pipeline sub-tab of the clients view
      if (CLIENT_TABS.indexOf(d.prefs.clientTab) === -1) d.prefs.clientTab = 'all';

      // the selected calendar view survives a reload; anything unknown falls back
      if (CAL_VIEWS.indexOf(d.prefs.calView) === -1) d.prefs.calView = 'month';

      // reminder prefs may be absent in a store written before the PWA upgrade
      if (!d.prefs.notify || typeof d.prefs.notify !== 'object') d.prefs.notify = { on: false, lead: 10 };
      d.prefs.notify.on = !!d.prefs.notify.on;
      if (typeof d.prefs.notify.lead !== 'number' || d.prefs.notify.lead < 0) d.prefs.notify.lead = 10;
      if (!d.prefs.fired || typeof d.prefs.fired !== 'object') d.prefs.fired = {};

      // Sprint 5: the cloud block is absent in every pre-D1 store, and its
      // outbox is replayed from disk — a queued mutation survives a reload
      d.sync = normSync(d.sync);

      // Sprint 6: the Google block is absent in every pre-gcal store, and the
      // cached "last synced" stamp is what the header renders while offline
      d.gcal = normGCal(d.gcal);

      this.data = d;
      if (!d.seeded) { this.seed(); }
      return d;
    },

    /**
     * Local-first, in this order and never any other: diff the change into the
     * outbox, write localStorage, and only then ask the cloud to catch up.
     * The network is never on the path between a tap and a repaint.
     */
    save: function () {
      Sync.capture();
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
      } catch (e) { /* quota or private mode — the in-memory session still works */ }
      Sync.schedule();
    },

    /** first-run sample content so the dashboard is not born empty */
    seed: function () {
      var t = todayISO();
      var d = this.data;

      // the client files come first — every other record links back to them
      var dana = this.shaped('clients', {
        type: 'client', name: 'דנה כהן', category: 'business',
        phone: '050-1234567', email: 'dana@example.com',
        status: 'quoted', interest: 'פורטרט שמן 70x100, אימפסטו',
        budget: '8,000–12,000 ₪',
        nextAction: 'לחזור אליה ביום שלישי עם הצעת מחיר סופית',
        nextActionAt: addDaysISO(t, 2),
        followUpAt: t, lastContactAt: addDaysISO(t, -1),
        notes: 'ראתה את הסדרה בתערוכה, מחפשת יצירה מרכזית לסלון.'
      });
      var oren = this.shaped('clients', {
        type: 'client', name: 'אורן לוי', category: 'business',
        phone: '052-7654321', email: '',
        status: 'lead', interest: 'הדמיה לקיר במשרד',
        nextAction: '',                       // deliberately empty — shows the alert badge
        notes: 'הגיע דרך אינסטגרם.'
      });
      logHistory(dana, 'created', 'התיק נפתח · ' + CLIENT_STATUS_LABEL[dana.status]);
      logHistory(oren, 'created', 'ליד חדש נכנס דרך אינסטגרם');
      d.clients.push(dana, oren);

      d.events.push(
        this.stamp({ type: 'event', title: 'פגישת היכרות — דנה כהן', category: 'business', date: t, start: '10:00', end: '11:00', location: 'זום', notes: '', clientId: dana.id }),
        this.stamp({ type: 'event', title: 'אימון כושר', category: 'personal', date: t, start: '18:30', end: '19:30', location: '', notes: '', clientId: '' })
      );

      d.tasks.push(
        this.shaped('tasks', {
          type: 'task', title: 'להכין הצעת מחיר', category: 'business', due: t, time: '',
          status: 'progress', priority: 'high', nextAction: 'לאסוף מידות ולשלוח טיוטה',
          subtasks: [{ title: 'לאסוף מידות מהלקוח', done: true }, { title: 'לחשב תמחור והדפסה', done: false }],
          notes: '', clientId: dana.id
        }),
        this.shaped('tasks', {
          type: 'task', title: 'לקנות מתנה ליום הולדת', category: 'personal', due: t, time: '',
          status: 'todo', priority: 'medium', nextAction: '', subtasks: [], notes: '', clientId: ''
        }),
        this.shaped('tasks', {
          type: 'task', title: 'לשלוח חוזה חתום', category: 'business', due: addDaysISO(t, -2), time: '',
          status: 'waiting', priority: 'high', nextAction: 'לוודא שהלקוח קיבל את המסמך',
          subtasks: [], notes: '', clientId: dana.id
        })
      );

      d.lists.push(
        this.shaped('lists', {
          type: 'list', title: 'ציוד לסטודיו', category: 'business', date: '', clientId: '',
          items: [
            { title: 'צבעי שמן — לבן טיטניום', done: true },
            { title: 'מדללים', done: false },
            { title: 'בדים מתוחים 70x100', done: false }
          ]
        }),
        this.shaped('lists', {
          type: 'list', title: 'מידות ותנאי קיר — דנה כהן', category: 'business', date: '', clientId: dana.id,
          items: [
            { title: 'למדוד רוחב קיר בסלון', done: true },
            { title: 'לצלם את התאורה בשעות היום', done: false },
            { title: 'לאשר סוג מסגרת', done: false }
          ]
        })
      );

      d.notes.push(
        this.shaped('notes', {
          type: 'note', title: 'רעיון לקמפיין', category: 'business', pinned: true,
          body: 'סדרת פורטרטים באימפסטו — לצלם תהליך עבודה קצר לכל יצירה ולפרסם כסטורי.'
        })
      );

      d.seeded = true;
      this.save();
    },

    stamp: function (rec) {
      var now = Date.now();
      rec.id = rec.id || uid(rec.type || 'rec');
      rec.ownerId = OWNER.id;
      rec.category = normCat(rec.category);
      rec.createdAt = rec.createdAt || now;
      rec.updatedAt = now;
      return rec;
    },

    /** stamped AND type-normalised — the only shape a collection ever receives */
    shaped: function (collection, rec) {
      if (collection === 'clients') return this.stamp(migrateClient(rec));
      if (collection === 'tasks') rec = migrateTask(rec);
      else if (collection === 'lists') rec = migrateList(rec);
      else if (collection === 'notes') rec = migrateNote(rec);
      if (rec && typeof rec === 'object') {
        rec.clientId = typeof rec.clientId === 'string' ? rec.clientId : '';
      }
      return this.stamp(rec);
    },

    /** returns the stored record so a caller can log history against it */
    add: function (collection, rec) {
      var stored = this.shaped(collection, rec);
      this.data[collection].push(stored);
      this.save();
      return stored;
    },

    remove: function (collection, id) {
      var list = this.data[collection];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list.splice(i, 1); break; }
      }
      this.save();
    },

    find: function (collection, id) {
      return this.data[collection].filter(function (r) { return r.id === id; })[0] || null;
    }
  };

  /* ==========================================================================
     Cloud sync engine (Sprint 5) — offline-first, last-write-wins

     Shape of the contract
       * localStorage is the source of truth the UI reads. Every tap writes it
         first; the cloud is a follower, never a gate (PROJECT_PLAN §8.1).
       * Store.save() diffs the store against a per-record shadow of "what the
         server has" and drops the difference into a persisted outbox. Nothing
         in the app has to remember to enqueue — a mutation cannot escape the
         diff, and the queue survives a reload because it lives in the store.
       * One POST /api/sync does both halves: replay the outbox, then pull
         everything the server has seen since our cursor.
       * Conflicts resolve last-write-wins on the ISO updated_at, on both ends.
     ========================================================================== */

  /* ---------------------------------------------------- serialisation ----- */

  function toISOStamp(ms) {
    var n = typeof ms === 'number' && ms > 0 && ms < 8.64e15 ? ms : Date.now();
    return new Date(n).toISOString();
  }

  function fromISOStamp(s) {
    var n = typeof s === 'string' ? Date.parse(s) : NaN;
    return isNaN(n) ? 0 : n;
  }

  function str(v) { return v == null ? '' : String(v); }

  function jsonOut(v) {
    try { return JSON.stringify(Array.isArray(v) ? v : []); } catch (e) { return '[]'; }
  }

  function jsonIn(s) {
    try {
      var v = JSON.parse(typeof s === 'string' && s ? s : '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  /** 'YYYY-MM-DD' + 'HH:MM' → 'YYYY-MM-DDTHH:MM'; an untimed record keeps the bare date */
  function joinStamp(date, time) {
    var d = str(date);
    if (!d) return '';
    var t = str(time);
    return t ? d + 'T' + t : d;
  }

  function splitStamp(v) {
    var s = str(v);
    var i = s.indexOf('T');
    return i === -1 ? { date: s, time: '' } : { date: s.slice(0, i), time: s.slice(i + 1, i + 6) };
  }

  /** local record → D1 row. Emits exactly the columns of SYNC_SCHEMA, no more. */
  var TO_ROW = {
    events: function (r) {
      return {
        id: r.id, title: str(r.title), category: normCat(r.category),
        start_time: joinStamp(r.date, r.start),
        end_time: joinStamp(r.date, r.end),
        location: str(r.location), client_id: str(r.clientId),
        category_type: str(r.type) || 'event',
        updated_at: toISOStamp(r.updatedAt), owner_id: str(r.ownerId) || OWNER.id,
        notes: str(r.notes), created_at: toISOStamp(r.createdAt), deleted_at: null,
        // echoed back untouched — '' simply means "this device knows no link yet"
        google_event_id: str(r.googleEventId), etag: str(r.googleEtag),
        google_calendar_id: str(r.googleCalendarId)
      };
    },
    tasks: function (r) {
      return {
        id: r.id, title: str(r.title), category: normCat(r.category),
        status: normStatus(r.status), priority: normPriority(r.priority),
        due_date: str(r.due), next_action: str(r.nextAction),
        subtasks_json: jsonOut(r.subtasks), client_id: str(r.clientId),
        updated_at: toISOStamp(r.updatedAt), owner_id: str(r.ownerId) || OWNER.id,
        due_time: str(r.time), notes: str(r.notes),
        created_at: toISOStamp(r.createdAt), deleted_at: null
      };
    },
    lists: function (r) {
      return {
        id: r.id, title: str(r.title), category: normCat(r.category),
        items_json: jsonOut(r.items), client_id: str(r.clientId),
        updated_at: toISOStamp(r.updatedAt), owner_id: str(r.ownerId) || OWNER.id,
        list_date: str(r.date), created_at: toISOStamp(r.createdAt), deleted_at: null
      };
    },
    notes: function (r) {
      return {
        id: r.id, title: str(r.title), body: str(r.body), category: normCat(r.category),
        is_pinned: r.pinned ? 1 : 0, client_id: str(r.clientId),
        updated_at: toISOStamp(r.updatedAt), owner_id: str(r.ownerId) || OWNER.id,
        created_at: toISOStamp(r.createdAt), deleted_at: null
      };
    },
    clients: function (r) {
      return {
        id: r.id, name: str(r.name), phone: str(r.phone), email: str(r.email),
        status: normClientStatus(r.status), next_action: str(r.nextAction),
        initial_interest: str(r.interest),
        updated_at: toISOStamp(r.updatedAt), owner_id: str(r.ownerId) || OWNER.id,
        category: normCat(r.category), budget: str(r.budget),
        next_action_at: str(r.nextActionAt), follow_up_at: str(r.followUpAt),
        last_contact_at: str(r.lastContactAt), general_notes: str(r.notes),
        client_notes_json: jsonOut(r.clientNotes), history_json: jsonOut(r.history),
        created_at: toISOStamp(r.createdAt), deleted_at: null
      };
    }
  };

  /** D1 row → local record, re-normalised through the same migrators as a load */
  var FROM_ROW = {
    events: function (row) {
      var s = splitStamp(row.start_time), e = splitStamp(row.end_time);
      return {
        type: str(row.category_type) || 'event', id: row.id,
        title: str(row.title), category: normCat(row.category),
        date: s.date, start: s.time, end: e.time,
        location: str(row.location), notes: str(row.notes),
        clientId: str(row.client_id),
        googleEventId: str(row.google_event_id), googleEtag: str(row.etag),
        googleCalendarId: str(row.google_calendar_id)
      };
    },
    tasks: function (row) {
      return migrateTask({
        type: 'task', id: row.id, title: str(row.title), category: normCat(row.category),
        status: normStatus(row.status), priority: normPriority(row.priority),
        due: str(row.due_date), time: str(row.due_time),
        nextAction: str(row.next_action), subtasks: jsonIn(row.subtasks_json),
        notes: str(row.notes), clientId: str(row.client_id)
      });
    },
    lists: function (row) {
      return migrateList({
        type: 'list', id: row.id, title: str(row.title), category: normCat(row.category),
        items: jsonIn(row.items_json), date: str(row.list_date),
        clientId: str(row.client_id)
      });
    },
    notes: function (row) {
      return migrateNote({
        type: 'note', id: row.id, title: str(row.title), body: str(row.body),
        category: normCat(row.category), pinned: !!Number(row.is_pinned),
        clientId: str(row.client_id)
      });
    },
    clients: function (row) {
      return migrateClient({
        type: 'client', id: row.id, name: str(row.name), category: normCat(row.category),
        phone: str(row.phone), email: str(row.email),
        status: normClientStatus(row.status), interest: str(row.initial_interest),
        budget: str(row.budget), nextAction: str(row.next_action),
        nextActionAt: str(row.next_action_at), followUpAt: str(row.follow_up_at),
        lastContactAt: str(row.last_contact_at), notes: str(row.general_notes),
        clientNotes: jsonIn(row.client_notes_json), history: jsonIn(row.history_json)
      });
    }
  };

  function toRow(table, rec) {
    var fn = TO_ROW[table];
    return fn && rec && rec.id ? fn(rec) : null;
  }

  /** the returned record carries the server's stamps, so LWW stays comparable */
  function fromRow(table, row) {
    var fn = FROM_ROW[table];
    if (!fn || !row || typeof row.id !== 'string') return null;
    var rec = fn(row);
    rec.ownerId = str(row.owner_id) || OWNER.id;
    rec.createdAt = fromISOStamp(row.created_at) || fromISOStamp(row.updated_at);
    rec.updatedAt = fromISOStamp(row.updated_at);
    return rec;
  }

  /* ------------------------------------------------------ payload guards --- */

  /** a row may only ever carry the columns its table declares */
  function validRow(table, row) {
    var cols = SYNC_SCHEMA[table];
    if (!cols || !row || typeof row !== 'object') return false;
    if (typeof row.id !== 'string' || !row.id) return false;
    if (typeof row.updated_at !== 'string' || !ISO_RE.test(row.updated_at)) return false;
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      if (cols.indexOf(keys[i]) === -1) return false;
    }
    return true;
  }

  /** nothing malformed ever leaves the queue — or survives a reload inside it */
  function validOp(op) {
    if (!op || typeof op !== 'object') return false;
    if (typeof op.opId !== 'string' || !op.opId) return false;
    if (SYNC_TABLES.indexOf(op.table) === -1) return false;
    if (typeof op.id !== 'string' || !op.id) return false;
    if (op.action !== 'upsert' && op.action !== 'delete') return false;
    if (op.action === 'upsert' && !validRow(op.table, op.row)) return false;
    return true;
  }

  function blankSync() {
    var s = { endpoint: SYNC_ENDPOINT, queue: [], shadow: {}, cursor: '', lastSyncAt: '' };
    SYNC_TABLES.forEach(function (t) { s.shadow[t] = {}; });
    return s;
  }

  function normSync(raw) {
    var s = blankSync();
    if (!raw || typeof raw !== 'object') return s;

    if (typeof raw.endpoint === 'string') s.endpoint = raw.endpoint;
    if (typeof raw.cursor === 'string' && ISO_RE.test(raw.cursor)) s.cursor = raw.cursor;
    if (typeof raw.lastSyncAt === 'string') s.lastSyncAt = raw.lastSyncAt;

    s.queue = (Array.isArray(raw.queue) ? raw.queue : [])
      .filter(validOp)
      .slice(0, SYNC_QUEUE_MAX);

    var shadow = raw.shadow && typeof raw.shadow === 'object' ? raw.shadow : {};
    SYNC_TABLES.forEach(function (t) {
      var src = shadow[t] && typeof shadow[t] === 'object' ? shadow[t] : {};
      Object.keys(src).forEach(function (id) {
        if (typeof src[id] === 'number') s.shadow[t][id] = src[id];
      });
    });
    return s;
  }

  /* --------------------------------------------------------- the engine --- */

  var Sync = {
    busy: false,
    lastError: '',
    timer: null,
    debounce: null,

    cfg: function () {
      var d = Store.data;
      if (!d) return null;
      if (!d.sync || typeof d.sync !== 'object') d.sync = blankSync();
      SYNC_TABLES.forEach(function (t) {
        if (!d.sync.shadow[t]) d.sync.shadow[t] = {};
      });
      return d.sync;
    },

    /** the cloud needs an origin to call — file:// and a blank endpoint mean local-only */
    enabled: function () {
      var c = Sync.cfg();
      if (!c || !c.endpoint) return false;
      var p = (window.location && window.location.protocol) || '';
      return p === 'http:' || p === 'https:';
    },

    online: function () {
      var n = window.navigator;
      return !n || typeof n.onLine !== 'boolean' ? true : n.onLine;
    },

    /** 🟢 מסונכרן לענן · 🟡 ממתין לסנכרון · 🔴 אופליין */
    state: function () {
      if (!Sync.online() || !Sync.enabled()) return 'offline';
      var c = Sync.cfg();
      if (!c) return 'offline';
      if (c.queue.length || Sync.busy) return 'pending';
      return c.lastSyncAt ? 'synced' : 'pending';
    },

    /* ---- outbox ---- */

    /**
     * Diff the whole store against the shadow and enqueue what differs. Called
     * from Store.save(), so every mutation path in the app is covered without
     * a single call site having to opt in.
     */
    capture: function () {
      var d = Store.data;
      var c = Sync.cfg();
      if (!d || !c) return;

      SYNC_TABLES.forEach(function (t) {
        var shadow = c.shadow[t];
        var live = {};
        var known = {};

        Object.keys(shadow).forEach(function (id) { known[id] = 1; });
        c.queue.forEach(function (op) { if (op.table === t) known[op.id] = 1; });

        (d[t] || []).forEach(function (rec) {
          if (!rec || !rec.id) return;
          live[rec.id] = 1;
          var stamp = rec.updatedAt || 0;
          if (shadow[rec.id] !== stamp) Sync.enqueue(t, rec.id, 'upsert', toRow(t, rec), stamp);
        });

        // gone locally but known to the server (or to a pending op) => tombstone
        Object.keys(known).forEach(function (id) {
          if (!live[id]) Sync.enqueue(t, id, 'delete', null, Date.now());
        });
      });
    },

    /** one op per record: a second edit before a push replaces the first */
    enqueue: function (table, id, action, row, stamp) {
      var c = Sync.cfg();
      if (!c) return null;
      var at = stamp || Date.now();
      var op = {
        opId: uid('op'), table: table, id: id, action: action,
        row: action === 'upsert' ? row : null, stamp: at, at: toISOStamp(at)
      };
      if (action === 'upsert' && !validRow(table, op.row)) return null;

      for (var i = 0; i < c.queue.length; i++) {
        if (c.queue[i].table === table && c.queue[i].id === id) { c.queue[i] = op; return op; }
      }
      if (c.queue.length >= SYNC_QUEUE_MAX) return null;
      c.queue.push(op);
      return op;
    },

    /* ---- network ---- */

    /** debounced push — a burst of taps costs one round-trip, not one each */
    schedule: function () {
      if (!Sync.enabled()) { Sync.paint(); return; }
      if (Sync.debounce) clearTimeout(Sync.debounce);
      Sync.debounce = setTimeout(function () {
        Sync.debounce = null;
        Sync.flush();
      }, SYNC_DEBOUNCE);
      Sync.paint();
    },

    /**
     * One round-trip does both halves of a sync: replay the outbox, then pull
     * everything newer than our cursor. Called on launch, on reconnect, on a
     * 30s heartbeat and after a debounced local write.
     */
    flush: function () {
      var c = Sync.cfg();
      if (!c || Sync.busy) return null;
      if (!Sync.enabled() || !Sync.online() || typeof window.fetch !== 'function') {
        Sync.paint();
        return null;
      }

      var batch = c.queue.slice(0, SYNC_BATCH);
      Sync.busy = true;
      Sync.paint();

      return window.fetch(c.endpoint + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          since: c.cursor || '',
          ops: batch.map(function (op) {
            return {
              opId: op.opId, table: op.table, id: op.id,
              action: op.action, at: op.at, row: op.row
            };
          })
        })
      })
        .then(function (res) {
          if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '?'));
          return res.json();
        })
        .then(function (out) {
          if (!out || out.ok !== true || !out.data) {
            throw new Error((out && out.error && out.error.message) || 'bad envelope');
          }
          Sync.settle(batch, out.data);
          c.lastSyncAt = out.data.now || toISOStamp(Date.now());
          Sync.lastError = '';
          Store.save();
          render();
          return true;
        })
        ['catch'](function (e) {
          // the queue is untouched — a failed push never loses a mutation
          Sync.lastError = (e && e.message) ? e.message : 'sync failed';
          return false;
        })
        .then(function (res) {
          Sync.busy = false;
          Sync.paint();
          return res;
        });
    },

    /** advance the shadow for what landed, then merge what came back */
    settle: function (batch, data) {
      var c = Sync.cfg();
      if (!c) return;

      var applied = {}, rejected = {};
      (data.applied || []).forEach(function (id) { applied[id] = 1; });
      (data.rejected || []).forEach(function (r) { if (r && r.opId) rejected[r.opId] = 1; });

      batch.forEach(function (op) {
        if (!applied[op.opId] && !rejected[op.opId]) return;

        // Applied or refused, the server has spoken about this exact version:
        // forget it, so the diff stops re-offering it and the queue cannot
        // wedge on a payload the server will never take. A later local edit
        // bumps updatedAt and the record is picked up again on the next diff.
        if (op.action === 'delete') delete c.shadow[op.table][op.id];
        else c.shadow[op.table][op.id] = op.stamp;
      });

      c.queue = c.queue.filter(function (op) {
        return !applied[op.opId] && !rejected[op.opId];
      });

      if (data.rejected && data.rejected.length) {
        Sync.lastError = data.rejected.length + ' ops rejected';
      }

      Sync.merge(data.changes || {});
      if (typeof data.cursor === 'string' && ISO_RE.test(data.cursor)) c.cursor = data.cursor;
    },

    /**
     * Last-write-wins on updated_at. The shadow is always set to the *server's*
     * stamp, never the local one — so a local record that is genuinely newer
     * still differs from the shadow and gets pushed on the next capture.
     */
    merge: function (changes) {
      var d = Store.data, c = Sync.cfg();
      if (!d || !c || !changes || typeof changes !== 'object') return 0;
      var touched = 0;

      SYNC_TABLES.forEach(function (t) {
        var rows = changes[t];
        if (!Array.isArray(rows)) return;

        rows.forEach(function (row) {
          if (!row || typeof row.id !== 'string' || !row.id) return;
          var stamp = fromISOStamp(row.updated_at);
          var local = Store.find(t, row.id);
          var arr = d[t];

          if (row.deleted_at) {                       // tombstone
            if (local && (local.updatedAt || 0) <= stamp) {
              arr.splice(arr.indexOf(local), 1);
              touched++;
            }
            delete c.shadow[t][row.id];
            return;
          }

          var incoming = fromRow(t, row);
          if (!incoming) return;

          if (!local) { arr.push(incoming); touched++; }
          else if ((local.updatedAt || 0) < stamp) { arr[arr.indexOf(local)] = incoming; touched++; }

          c.shadow[t][row.id] = stamp;
        });
      });

      return touched;
    },

    /* ---- status indicator ---- */

    paint: function () {
      var btn = $('#syncBtn');
      if (!btn) return;
      var st = Sync.state();
      var meta = SYNC_LABEL[st];
      var c = Sync.cfg();
      var q = c ? c.queue.length : 0;

      btn.className = 'sync-btn is-' + st;
      btn.setAttribute('data-syncstate', st);
      $('#syncIco').textContent = meta.ico;
      $('#syncLabel').textContent = meta.text;

      var detail = meta.text;
      if (q) detail += ' · ' + q + ' שינויים ממתינים';
      else if (st === 'synced' && c && c.lastSyncAt) detail += ' · ' + hhmm(c.lastSyncAt);
      if (Sync.lastError && st !== 'offline') detail += ' · ' + Sync.lastError;
      btn.title = detail;
      btn.setAttribute('aria-label', detail);
    },

    init: function () {
      var btn = $('#syncBtn');
      if (btn) btn.addEventListener('click', function () { Sync.flush(); });

      window.addEventListener('online', function () { Sync.paint(); Sync.flush(); });
      window.addEventListener('offline', function () { Sync.paint(); });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) Sync.flush();
      });

      if (Sync.timer) clearInterval(Sync.timer);
      Sync.timer = setInterval(function () { Sync.flush(); }, SYNC_MS);

      Sync.paint();
      Sync.flush();                       // pull remote updates on app launch
    }
  };

  /** 'HH:MM' out of an ISO instant, for the "last synced" tooltip */
  function hhmm(iso) {
    var ms = fromISOStamp(iso);
    if (!ms) return '';
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ==========================================================================
     Google Calendar two-way sync (Sprint 6) — the client half

     The browser deliberately does almost nothing here. The whole OAuth
     handshake, the syncToken bookkeeping and every call to Google live in the
     Worker (functions/api/gcal/*), because a refresh token must never reach a
     page. What the client owns is exactly three things:

       1. a button that starts the consent flow, and once connected runs a cycle
       2. the "סונכרן לאחרונה מול גוגל: HH:MM" readout, cached locally so it
          survives a reload and still reads correctly offline
       3. a Sync.flush() after every cycle — the Google sync writes D1, and it
          is /api/sync that carries those rows down into the local store.

     Nothing here is on the path between a tap and a repaint: a dead or
     unconfigured endpoint leaves the app exactly as capable as it was in
     Sprint 5 (§7.4e).
     ========================================================================== */

  var GCAL_ENDPOINT = 'api/gcal';        // relative, exactly like SYNC_ENDPOINT
  var GCAL_STATES = ['on', 'off', 'busy', 'na'];
  var GCAL_LABEL = {
    off:  { ico: '📅', text: 'התחבר ל-Google Calendar' },
    on:   { ico: '📅', text: 'מחובר ל-Google Calendar' },
    busy: { ico: '📅', text: 'מסנכרן מול Google…' },
    na:   { ico: '📅', text: 'Google Calendar לא מוגדר' }
  };
  var GCAL_SYNC_PREFIX = 'סונכרן לאחרונה מול גוגל: ';
  var GCAL_NEVER = 'טרם סונכרן מול Google Calendar';
  var GCAL_MS = 300000;                  // background cycle — Google quota is not free

  function blankGCal() {
    return { configured: false, connected: false, lastSyncAt: '' };
  }

  function normGCal(raw) {
    var g = blankGCal();
    if (!raw || typeof raw !== 'object') return g;
    g.configured = !!raw.configured;
    g.connected = !!raw.connected;
    if (typeof raw.lastSyncAt === 'string' && ISO_RE.test(raw.lastSyncAt)) {
      g.lastSyncAt = raw.lastSyncAt;
    }
    return g;
  }

  var GCal = {
    busy: false,
    lastError: '',
    timer: null,

    cfg: function () {
      var d = Store.data;
      if (!d) return null;
      if (!d.gcal || typeof d.gcal !== 'object') d.gcal = blankGCal();
      return d.gcal;
    },

    /** same rule as the cloud sync: file:// has no origin to call */
    enabled: function () {
      var p = (window.location && window.location.protocol) || '';
      if (p !== 'http:' && p !== 'https:') return false;
      return typeof window.fetch === 'function';
    },

    /** 'on' מחובר · 'off' מנותק · 'busy' מסנכרן · 'na' לא הוגדר בשרת */
    state: function () {
      if (GCal.busy) return 'busy';
      var c = GCal.cfg();
      if (!c || !GCal.enabled()) return 'off';
      if (!c.configured) return 'na';
      return c.connected ? 'on' : 'off';
    },

    /** shared envelope unwrap — every /api/gcal route answers { ok, data } */
    call: function (path, init) {
      return window.fetch(GCAL_ENDPOINT + path, init)
        .then(function (res) { return res.json(); })
        .then(function (out) {
          if (!out || out.ok !== true || !out.data) {
            throw new Error((out && out.error && out.error.message) || 'bad envelope');
          }
          return out.data;
        });
    },

    /** read the connection state; a failure is silent and simply reads as 'off' */
    refresh: function () {
      if (!GCal.enabled()) { GCal.paint(); return null; }

      return GCal.call('/auth')
        .then(function (data) {
          var c = GCal.cfg();
          if (!c) return false;
          c.configured = !!data.configured;
          c.connected = !!data.connected;
          if (typeof data.lastSyncAt === 'string' && ISO_RE.test(data.lastSyncAt)) {
            c.lastSyncAt = data.lastSyncAt;
          }
          GCal.lastError = '';
          Store.save();
          return true;
        })
        ['catch'](function (e) {
          GCal.lastError = (e && e.message) ? e.message : 'gcal status failed';
          return false;
        })
        .then(function (res) { GCal.paint(); return res; });
    },

    /** leaves the app for Google's consent screen and comes back to /?gcal=connected */
    connect: function () {
      if (!GCal.enabled()) { toast('חיבור ל-Google דורש חיבור לאינטרנט'); return; }
      window.location.href = GCAL_ENDPOINT + '/auth?action=start';
    },

    disconnect: function () {
      if (!GCal.enabled()) return null;

      return GCal.call('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' })
      })
        .then(function () {
          var c = GCal.cfg();
          if (c) { c.connected = false; c.lastSyncAt = ''; }
          Store.save();
          toast('החיבור ל-Google Calendar נותק');
          return true;
        })
        ['catch'](function (e) {
          GCal.lastError = (e && e.message) ? e.message : 'disconnect failed';
          return false;
        })
        .then(function (res) { GCal.paint(); return res; });
    },

    /**
     * One two-way cycle. The Worker does the pulling and pushing against
     * Google; the Sync.flush() afterwards is what actually brings the changed
     * rows down into localStorage so the calendar repaints with them.
     */
    sync: function () {
      var c = GCal.cfg();
      if (!c || GCal.busy || !GCal.enabled() || !c.connected) { GCal.paint(); return null; }

      GCal.busy = true;
      GCal.paint();

      return GCal.call('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
        .then(function (data) {
          if (typeof data.lastSyncAt === 'string' && ISO_RE.test(data.lastSyncAt)) {
            c.lastSyncAt = data.lastSyncAt;
          }
          GCal.lastError = (data.errors && data.errors.length)
            ? String(data.errors[0].error || '') : '';
          Store.save();
          return data;
        })
        ['catch'](function (e) {
          GCal.lastError = (e && e.message) ? e.message : 'gcal sync failed';
          return null;
        })
        .then(function (data) {
          GCal.busy = false;
          GCal.paint();
          // the cycle wrote D1 — /api/sync is the road those rows travel home
          if (data) { Sync.flush(); }
          return data;
        });
    },

    /** the exact readout the mandate names: "סונכרן לאחרונה מול גוגל: HH:MM" */
    stampText: function () {
      var c = GCal.cfg();
      if (!c || !c.connected) return '';
      return c.lastSyncAt ? GCAL_SYNC_PREFIX + hhmm(c.lastSyncAt) : GCAL_NEVER;
    },

    paint: function () {
      var btn = $('#gcalBtn');
      if (!btn) return;

      var st = GCal.state();
      var meta = GCAL_LABEL[st];
      var c = GCal.cfg();

      btn.className = 'gcal-btn is-' + st;
      btn.setAttribute('data-gcalstate', st);
      btn.setAttribute('aria-pressed', st === 'on' ? 'true' : 'false');
      btn.disabled = st === 'na';
      $('#gcalIco').textContent = meta.ico;
      $('#gcalLabel').textContent = meta.text;

      var detail = meta.text;
      if (GCal.lastError && st !== 'na') detail += ' · ' + GCal.lastError;
      btn.title = detail;
      btn.setAttribute('aria-label', detail);

      var line = $('#gcalSync');
      var text = $('#gcalSyncText');
      var unlink = $('#gcalUnlink');
      if (!line || !text) return;

      var stamp = GCal.stampText();
      if (st === 'na') stamp = 'חיבור Google Calendar לא הוגדר בשרת';
      text.textContent = stamp;
      line.hidden = !stamp;
      if (unlink) unlink.hidden = !(c && c.connected);
    },

    init: function () {
      var btn = $('#gcalBtn');
      if (btn) {
        btn.addEventListener('click', function () {
          var c = GCal.cfg();
          if (c && c.connected) GCal.sync();
          else GCal.connect();
        });
      }

      var unlink = $('#gcalUnlink');
      if (unlink) unlink.addEventListener('click', function () { GCal.disconnect(); });

      GCal.paint();
      if (!GCal.enabled()) return;

      // Google bounced the user back here after consent — say so, sync, and
      // scrub the marker so a reload does not replay the toast
      var search = (window.location && window.location.search) || '';
      var justConnected = search.indexOf('gcal=connected') !== -1;
      if (justConnected && window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }

      GCal.refresh().then(function () {
        if (justConnected) toast('Google Calendar מחובר');
        var c = GCal.cfg();
        if (c && c.connected) GCal.sync();
      });

      if (GCal.timer) clearInterval(GCal.timer);
      GCal.timer = setInterval(function () {
        var c = GCal.cfg();
        if (c && c.connected && !document.hidden) GCal.sync();
      }, GCAL_MS);
    }
  };

  /* ------------------------------------------------------------------ state */

  var UI = { view: 'today', formType: 'event', formCat: 'personal' };

  function filterCat() { return Store.data.prefs.filter; }

  /** the single gate every read path passes through */
  function inFilter(rec) {
    var f = filterCat();
    return f === 'all' || rec.category === f;
  }

  function pick(collection) { return Store.data[collection].filter(inFilter); }

  /* ------------------------------------------------------------- selectors */

  function todaysEvents() {
    var t = todayISO();
    return pick('events')
      .filter(function (e) { return e.date === t; })
      .sort(function (a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); });
  }

  /** "open" now means: not הושלם and not בוטל */
  function openTasks() {
    return pick('tasks').filter(function (x) { return !isClosed(x.status); });
  }

  function tasksDueToday() {
    var t = todayISO();
    return openTasks().filter(function (x) { return x.due === t; });
  }

  function unscheduledToday() {
    return tasksDueToday().filter(function (x) { return !hourOf(x.time) && hourOf(x.time) !== 0; });
  }

  function overdueTasks() {
    var t = todayISO();
    return openTasks().filter(function (x) { return x.due && x.due < t; });
  }

  function waitingTasks() {
    return pick('tasks').filter(function (x) { return normStatus(x.status) === 'waiting'; });
  }

  function pendingFollowUps() {
    var t = todayISO();
    return pick('clients').filter(function (c) { return c.followUpAt && c.followUpAt <= t; });
  }

  /** the Next-Action alert engine feeding the dashboard attention card */
  function clientsMissingAction() {
    return pick('clients').filter(clientNeedsAction);
  }

  /* ----------------------------------------------------------- render: shell */

  function setView(view) {
    UI.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + view); });
    $$('[data-nav]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.nav === view); });
    $('#viewTitle').textContent =
      ({ today: 'היום שלי', calendar: 'יומן', tasks: 'משימות, רשימות ופתקים', clients: 'לקוחות' })[view] || '';
    window.scrollTo(0, 0);
    render();
  }

  function setFilter(f) {
    Store.data.prefs.filter = f;
    Store.save();
    $$('.topbar .seg').forEach(function (b) {
      var on = b.dataset.filter === f;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    render();
  }

  /* -------------------------------------------------- render: 1. summary box */

  function greetingWord() {
    var h = new Date().getHours();
    if (h < 5) return 'לילה טוב';
    if (h < 12) return 'בוקר טוב';
    if (h < 17) return 'צהריים טובים';
    if (h < 22) return 'ערב טוב';
    return 'לילה טוב';
  }

  function renderSummary() {
    var meetings = todaysEvents().length;
    var tasks = tasksDueToday().length;
    var follow = pendingFollowUps().length;

    $('#summaryGreeting').textContent = greetingWord() + ' ' + OWNER.short;

    var line;
    if (!meetings && !tasks && !follow) {
      line = 'היום נקי לגמרי — אין פגישות, משימות או מעקבים ממתינים.';
    } else {
      line = 'יש לך היום ' +
        plural(meetings, 'פגישה אחת', 'פגישות') + ', ' +
        plural(tasks, 'משימה אחת', 'משימות') + ' ו־' +
        plural(follow, 'מעקב אחד', 'מעקבים') + '.';
    }
    $('#summaryLine').textContent = line;

    var f = filterCat();
    $('#summaryChips').innerHTML = [
      '<span class="chip">' + esc(relDay(todayISO())) + '</span>',
      '<span class="chip">תצוגה: <b>' + (f === 'all' ? 'הכל' : CAT_LABEL[f]) + '</b></span>',
      '<span class="chip">פתוחות: <b>' + openTasks().length + '</b></span>',
      '<span class="chip">ממתין ללקוח: <b>' + waitingTasks().length + '</b></span>'
    ].join('');
  }

  /* --------------------------------------------- render: 4. attention cards */

  function renderAttention() {
    var late = overdueTasks().length;
    var waiting = waitingTasks().length;
    var follow = pendingFollowUps().length;
    var noAction = clientsMissingAction().length;

    $('#attentionCards').innerHTML =
      attCard(late, 'משימות באיחור', late ? 'דורש טיפול מיידי' : 'הכול בזמן',
        late ? 'is-hot' : 'is-calm', 'data-tasktab="late"') +
      attCard(waiting, 'ממתין ללקוח', waiting ? 'הכדור אצל הלקוח' : 'אין המתנות פתוחות',
        waiting ? 'is-wait' : 'is-calm', 'data-tasktab="waiting"') +
      attCard(follow, 'מעקבי לקוחות', follow ? 'ממתין לחזרה שלך' : 'אין מעקבים פתוחים',
        follow ? 'is-warn' : 'is-calm', 'data-nav="clients"') +
      // the Next-Action alert engine, surfaced on the dashboard (mandate §3)
      attCard(noAction, 'ללא פעולה הבאה',
        noAction ? 'לקוחות פעילים בלי צעד הבא' : 'לכל לקוח פעיל יש צעד הבא',
        noAction ? 'is-hot' : 'is-calm', 'data-clientfilter="all"');
  }

  function attCard(num, label, hint, cls, attrs) {
    return '<button type="button" class="att ' + cls + '" ' + attrs + '>' +
      '<span class="att-num">' + num + '</span>' +
      '<span class="att-label">' + esc(label) + '</span>' +
      '<span class="att-hint">' + esc(hint) + '</span>' +
      '</button>';
  }

  /* ------------------------------------------------- render: 2. day timeline */

  /**
   * `quiet` is set by Patch.settle() when the container's membership has not
   * changed: the record that changed was already repainted in place, so the
   * markup is skipped and only the derived meta line is refreshed. Nothing the
   * finger is touching gets destroyed.
   */
  function renderTimeline(quiet) {
    var events = todaysEvents();
    var byHour = {};

    events.forEach(function (e) {
      var h = hourOf(e.start);
      if (h === null) h = DAY_START;
      if (h < DAY_START) h = DAY_START;
      if (h > DAY_END) h = DAY_END;
      (byHour[h] = byHour[h] || []).push(e);
    });

    var nowH = new Date().getHours();
    var rows = [];

    for (var h = DAY_START; h <= DAY_END; h++) {
      var list = byHour[h] || [];
      rows.push(
        '<div class="tl-row' + (h === nowH ? ' is-now' : '') + '">' +
        '<div class="tl-hour">' + pad2(h) + ':00</div>' +
        '<div class="tl-slot' + (list.length ? '' : ' tl-empty') + '">' +
        list.map(eventCard).join('') +
        '</div></div>'
      );
    }

    if (!quiet) $('#timeline').innerHTML = rows.join('');
    $('#timelineMeta').textContent = events.length
      ? plural(events.length, 'אירוע אחד', 'אירועים') + ' · ' + pad2(DAY_START) + ':00–' + pad2(DAY_END) + ':00'
      : 'אין אירועים מתוזמנים';
  }

  function eventCard(e) {
    var when = e.start ? (e.start + (e.end ? '–' + e.end : '')) : 'ללא שעה';
    var meta = [when, e.location].filter(Boolean).join(' · ');
    return '<div class="ev ev-' + e.category + '" data-rec="events:' + e.id + '">' +
      '<div class="ev-body">' +
      '<div class="ev-title">' + esc(e.title) + '</div>' +
      '<div class="ev-meta">' + esc(meta) + '</div>' +
      '</div>' +
      catTag(e.category) +
      delBtn('events', e.id) +
      '</div>';
  }

  /* ------------------------------------------- render: 3. unscheduled to-do */

  function renderTodo(quiet) {
    var list = unscheduledToday();
    if (!quiet) {
      $('#todoToday').innerHTML = list.length
        ? list.map(function (t) { return taskRow(t); }).join('')
        : emptyState('אין משימות פתוחות להיום', 'כל מה שתייעד להיום ללא שעה מסוימת יופיע כאן.');
    }
    $('#todoMeta').textContent = list.length ? plural(list.length, 'משימה אחת', 'משימות') : '';
  }

  /**
   * One task row. `compact` is used inside the calendar panes, where the
   * next-action line and the sub-task checklist would drown the day grid.
   */
  function taskRow(t, compact) {
    var status = normStatus(t.status);
    var late = !isClosed(status) && t.due && t.due < todayISO();
    var prog = subtaskProgress(t);

    var meta = [];
    if (t.due) meta.push((late ? 'באיחור · ' : '') + relDay(t.due));
    if (t.time) meta.push(t.time);
    if (!compact && t.notes) meta.push(t.notes);

    var cls = 'row task st-row-' + status +
      (t.done ? ' is-done' : '') +
      (status === 'cancelled' ? ' is-cancelled' : '') +
      (status === 'waiting' ? ' is-waiting' : '') +
      (late ? ' is-late' : '');

    // data-rec is what lets Patch.record() repaint this one row in place, in
    // every pane it happens to appear in, without rebuilding any container
    return '<div class="' + cls + '" data-rec="tasks:' + t.id + '"' +
      (compact ? ' data-compact="1"' : '') + '>' +
      '<button type="button" class="check-tap" data-toggle="' + t.id + '" aria-label="סימון כבוצע">' +
      '<span class="check">' + (t.done ? '✓' : '') + '</span></button>' +
      '<div class="row-body">' +
      '<div class="row-title">' + esc(t.title) + '</div>' +
      '<div class="row-meta">' +
      catTag(t.category) +
      statusBadge(t) +
      priorityTag(t.priority) +
      esc(meta.join(' · ')) +
      '</div>' +
      (!compact && t.nextAction
        ? '<div class="next-action"><span>הפעולה הבאה</span>' + esc(t.nextAction) + '</div>' : '') +
      (!compact && prog.total ? checklist(prog, t.subtasks, 'subtask', t.id) : '') +
      '</div>' +
      delBtn('tasks', t.id) +
      '</div>';
  }

  /** tap to walk חדש → לביצוע → בתהליך → ממתין ללקוח → חדש */
  function statusBadge(t) {
    var status = normStatus(t.status);
    return '<button type="button" class="badge badge-btn st-' + status + '" data-cycle="' + t.id + '"' +
      ' aria-label="' + esc('סטטוס: ' + STATUS_LABEL[status] + ' — לחיצה מעבירה לסטטוס הבא') + '">' +
      esc(STATUS_LABEL[status]) + '</button>';
  }

  function priorityTag(p) {
    var pr = normPriority(p);
    return '<span class="badge pr-' + pr + '">עדיפות ' + PRIORITY_LABEL[pr] + '</span>';
  }

  function progressBar(p) {
    return '<div class="prog">' +
      '<span class="prog-track"><span class="prog-fill" style="inline-size:' + p.pct + '%"></span></span>' +
      '<span class="prog-num">' + p.done + '/' + p.total + ' הושלמו</span>' +
      '</div>';
  }

  /** shared by task sub-tasks and by smart lists — same shape, same markup */
  function checklist(prog, items, kind, ownerId) {
    return '<div class="checklist">' +
      progressBar(prog) +
      items.map(function (it) {
        return '<button type="button" class="cl-item' + (it.done ? ' is-done' : '') + '"' +
          ' data-' + kind + '="' + ownerId + ':' + it.id + '"' +
          ' aria-pressed="' + (it.done ? 'true' : 'false') + '">' +
          '<span class="cl-box">' + (it.done ? '✓' : '') + '</span>' +
          '<span class="cl-title">' + esc(it.title) + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
  }

  /* ==========================================================================
     render: calendar engine — day / week / month / agenda

     One anchor date drives all four views. Every read still goes through
     pick(), so the global category filter (§0.3) holds inside the calendar
     exactly as it does everywhere else.
     ========================================================================== */

  function eventsOn(iso) {
    return pick('events')
      .filter(function (e) { return e.date === iso; })
      .sort(function (a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); });
  }

  function openTasksOn(iso) {
    return pick('tasks')
      .filter(function (x) { return !x.done && x.due === iso; })
      .sort(function (a, b) { return timeToMinutes(a.time) - timeToMinutes(b.time); });
  }

  /** "2026-07-27|09:00" — the payload a tapped cell hands to Master Add */
  function slotAttr(iso, time) {
    return ' data-calslot="' + iso + '|' + (time || '') + '"';
  }

  var Cal = {
    view: 'month',
    anchor: todayISO(),
    tickTimer: null,

    /* ---------------------------------------------------------- navigation */

    setView: function (v) {
      if (CAL_VIEWS.indexOf(v) === -1) return;
      this.view = v;
      Store.data.prefs.calView = v;
      Store.save();
      this.render();
    },

    step: function (dir) {
      if (this.view === 'month') this.anchor = addMonthsISO(this.anchor, dir);
      else if (this.view === 'week') this.anchor = addDaysISO(this.anchor, 7 * dir);
      else if (this.view === 'agenda') this.anchor = addDaysISO(this.anchor, AGENDA_DAYS * dir);
      else this.anchor = addDaysISO(this.anchor, dir);
      this.render();
    },

    nav: function (what) {
      if (what === 'today') {
        this.anchor = todayISO();
        this.render();
        return;
      }
      this.step(what === 'next' ? 1 : -1);
    },

    /* ------------------------------------------------------------- labels */

    label: function () {
      var d = parseISO(this.anchor) || new Date();
      if (this.view === 'day') return relDay(this.anchor);
      if (this.view === 'month') return HE_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
      if (this.view === 'week') {
        var w = weekDays(this.anchor);
        return fmtDayMon(w[0]) + ' – ' + fmtDayMon(w[6]) + ' ' + (parseISO(w[6]) || d).getFullYear();
      }
      var r = agendaRange(this.anchor, AGENDA_DAYS);
      return fmtDayMon(r.from) + ' – ' + fmtDayMon(r.to);
    },

    /** the days the active view actually shows — drives the counters */
    rangeDays: function () {
      if (this.view === 'day') return [this.anchor];
      if (this.view === 'week') return weekDays(this.anchor);
      if (this.view === 'month') {
        var m = (parseISO(this.anchor) || new Date()).getMonth();
        return monthMatrix(this.anchor).filter(function (iso) {
          return parseISO(iso).getMonth() === m;
        });
      }
      var out = [], iso = this.anchor;
      for (var i = 0; i < AGENDA_DAYS; i++) { out.push(iso); iso = addDaysISO(iso, 1); }
      return out;
    },

    meta: function () {
      var ev = 0, tk = 0;
      this.rangeDays().forEach(function (iso) {
        ev += eventsOn(iso).length;
        tk += openTasksOn(iso).length;
      });
      if (!ev && !tk) return 'אין מה שמתוכנן בטווח הזה';
      return plural(ev, 'אירוע אחד', 'אירועים') + ' · ' + plural(tk, 'משימה אחת', 'משימות');
    },

    /** colour is never the sole carrier — the dots always ship a text key */
    legend: function () {
      return '<div class="cal-legend">' + catTag('business') + catTag('personal') + '</div>';
    },

    /* -------------------------------------------------------- month view */

    renderMonth: function () {
      var cells = monthMatrix(this.anchor);
      var month = (parseISO(this.anchor) || new Date()).getMonth();
      var t = todayISO();

      var head = DOW_SHORT.map(function (d) { return '<span>' + d + '</span>'; }).join('');

      var grid = cells.map(function (iso) {
        var d = parseISO(iso);
        var marks = eventsOn(iso).concat(openTasksOn(iso));
        var shown = marks.slice(0, 4);
        var extra = marks.length - shown.length;

        return '<button type="button" class="cal-cell' +
          (d.getMonth() !== month ? ' is-out' : '') +
          (iso === t ? ' is-today' : '') + '"' + slotAttr(iso) +
          ' aria-label="' + esc(hebDate(iso) + ' · ' + marks.length + ' פריטים') + '">' +
          '<span class="cal-num">' + d.getDate() + '</span>' +
          '<span class="cal-dots">' + shown.map(function (r) {
            return '<span class="dot dot-' + r.category + '"></span>';
          }).join('') + '</span>' +
          (extra > 0 ? '<span class="cal-more">+' + extra + '</span>' : '') +
          '</button>';
      }).join('');

      $('#calMonth').innerHTML =
        '<div class="cal-month">' +
        '<div class="cal-dow">' + head + '</div>' +
        '<div class="cal-grid">' + grid + '</div>' +
        '</div>' + this.legend();
    },

    /* --------------------------------------------------------- week view */

    renderWeek: function () {
      var days = weekDays(this.anchor);
      var t = todayISO();
      var byDay = days.map(function (iso) { return eventsOn(iso); });

      // widen the hour window rather than hide an event outside 08:00–22:00
      var lo = DAY_START, hi = DAY_END;
      byDay.forEach(function (list) {
        list.forEach(function (e) {
          var m = minutesOf(e.start);
          if (m === null) return;
          var h = Math.floor(m / 60);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        });
      });

      var head = '<span></span>' + days.map(function (iso) {
        var d = parseISO(iso);
        return '<span class="' + (iso === t ? 'is-today' : '') + '">' +
          DOW_SHORT[d.getDay()] + '<br>' + d.getDate() + '</span>';
      }).join('');

      function cell(iso, time, list) {
        return '<button type="button" class="wk-cell' + (iso === t ? ' is-today' : '') + '"' +
          slotAttr(iso, time) +
          ' aria-label="' + esc(hebDate(iso) + (time ? ' ' + time : '')) + '">' +
          list.slice(0, 2).map(function (e) {
            return '<span class="wk-chip wk-' + e.category + '">' + esc(e.title) + '</span>';
          }).join('') +
          (list.length > 2 ? '<span class="cal-more">+' + (list.length - 2) + '</span>' : '') +
          '</button>';
      }

      // all-day strip: events carrying a date but no time still need a home
      var allday = '<span class="wk-hour">כל היום</span>' + days.map(function (iso, i) {
        return cell(iso, '', byDay[i].filter(function (e) { return minutesOf(e.start) === null; }));
      }).join('');

      var rows = [];
      for (var h = lo; h <= hi; h++) {
        var hour = h;
        rows.push('<span class="wk-hour">' + pad2(hour) + '</span>');
        days.forEach(function (iso, i) {
          rows.push(cell(iso, pad2(hour) + ':00', byDay[i].filter(function (e) {
            var m = minutesOf(e.start);
            return m !== null && Math.floor(m / 60) === hour;
          })));
        });
      }

      $('#calWeek').innerHTML =
        '<div class="cal-week">' +
        '<div class="wk-head">' + head + '</div>' +
        '<div class="wk-body wk-allday">' + allday + '</div>' +
        '<div class="wk-body">' + rows.join('') + '</div>' +
        '</div>' + this.legend();
    },

    /* ------------------------------- day view — full 00:00–23:59 timeline */

    renderDay: function () {
      var iso = this.anchor;
      var timed = [], untimed = [];

      eventsOn(iso).forEach(function (e) {
        var s = minutesOf(e.start);
        if (s === null) { untimed.push(e); return; }
        var en = minutesOf(e.end);
        if (en === null || en <= s) en = Math.min(s + 60, 1440);   // default 1h block
        timed.push({ s: s, e: en, ev: e });
      });

      var blocks = layoutBlocks(timed).map(function (b) {
        var w = 100 / b.lanes;
        return '<div class="dv-block dv-' + b.ev.category + '" style="' +
          'top:' + Math.round(b.s / 60 * HOUR_PX) + 'px;' +
          'height:' + Math.max(26, Math.round((b.e - b.s) / 60 * HOUR_PX) - 3) + 'px;' +
          'inset-inline-start:' + (b.lane * w) + '%;' +
          'inline-size:calc(' + w + '% - 5px)">' +
          '<b>' + esc(b.ev.title) + '</b>' +
          '<span>' + esc(b.ev.start + (b.ev.end ? '–' + b.ev.end : '') +
            (b.ev.location ? ' · ' + b.ev.location : '')) + '</span>' +
          '</div>';
      }).join('');

      var hours = [], slots = [];
      for (var h = 0; h < 24; h++) {
        hours.push('<span class="dv-hour">' + pad2(h) + ':00</span>');
        slots.push('<button type="button" class="dv-slot"' + slotAttr(iso, pad2(h) + ':00') +
          ' aria-label="' + esc('הוספה ב־' + pad2(h) + ':00') + '"></button>');
      }

      var now = '';
      if (iso === todayISO()) {
        var d = new Date();
        now = '<div class="dv-now" role="presentation" style="top:' +
          Math.round((d.getHours() * 60 + d.getMinutes()) / 60 * HOUR_PX) + 'px"></div>';
      }

      var tasks = openTasksOn(iso);

      $('#calDay').innerHTML =
        '<div class="cal-day">' +
        (untimed.length
          ? '<div class="dv-untimed">' + untimed.map(function (e) {
            return '<span class="wk-chip wk-' + e.category + '">' + esc(e.title) + '</span>';
          }).join('') + '</div>'
          : '') +
        '<div class="dv-grid">' +
        '<div class="dv-hours">' + hours.join('') + '</div>' +
        '<div class="dv-canvas">' + slots.join('') + blocks + now + '</div>' +
        '</div></div>' +
        (tasks.length
          ? '<div class="day-group" style="margin-top:14px">' +
          '<div class="day-head"><span>משימות ליום הזה</span>' +
          '<span class="day-count">' + plural(tasks.length, 'משימה אחת', 'משימות') + '</span></div>' +
          '<div class="card">' + tasks.map(function (x) { return taskRow(x, true); }).join('') + '</div></div>'
          : '');
    },

    /* ------------------------------------------------------- agenda view */

    renderAgenda: function () {
      var iso = this.anchor, groups = [];

      for (var i = 0; i < AGENDA_DAYS; i++) {
        var evs = eventsOn(iso), tks = openTasksOn(iso);
        if (evs.length || tks.length) groups.push({ date: iso, events: evs, tasks: tks });
        iso = addDaysISO(iso, 1);
      }

      if (!groups.length) {
        $('#calAgenda').innerHTML = '<div class="card">' +
          emptyState('אין מה שמתוכנן בטווח הזה',
            'הכול פנוי מ־' + fmtDayMon(this.anchor) + ' ל־' + AGENDA_DAYS + ' הימים הבאים.') +
          '</div>';
        return;
      }

      $('#calAgenda').innerHTML = groups.map(function (g) {
        var count = g.events.length + g.tasks.length;
        return '<div class="day-group">' +
          '<div class="day-head"><span>' + esc(relDay(g.date)) + '</span>' +
          '<span class="day-count">' + plural(count, 'פריט אחד', 'פריטים') + '</span></div>' +
          '<div class="card" style="padding:6px 8px">' +
          g.events.map(eventCard).join('') +
          g.tasks.map(function (x) { return taskRow(x, true); }).join('') +
          '</div></div>';
      }).join('');
    },

    /* ------------------------------------------------------------- paint */

    /**
     * The record rows the active pane holds, in the order it holds them —
     * Patch.settle() compares this against the DOM to decide whether the pane
     * has to be rebuilt at all. Month and week draw their records as dots and
     * chips rather than rows, so there is nothing to patch in place and they
     * answer null: "always rebuild me".
     */
    keys: function () {
      if (this.view === 'day') return recKeys('tasks', openTasksOn(this.anchor));
      if (this.view !== 'agenda') return null;

      var iso = this.anchor, out = [];
      for (var i = 0; i < AGENDA_DAYS; i++) {
        out = out.concat(recKeys('events', eventsOn(iso)), recKeys('tasks', openTasksOn(iso)));
        iso = addDaysISO(iso, 1);
      }
      return out;
    },

    render: function (quiet) {
      var self = this;

      $$('[data-calview]').forEach(function (b) {
        var on = b.dataset.calview === self.view;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      $('#calMonth').hidden = this.view !== 'month';
      $('#calWeek').hidden = this.view !== 'week';
      $('#calDay').hidden = this.view !== 'day';
      $('#calAgenda').hidden = this.view !== 'agenda';

      if (quiet) { /* the pane was patched in place — only the labels move */ }
      else if (this.view === 'month') this.renderMonth();
      else if (this.view === 'week') this.renderWeek();
      else if (this.view === 'day') this.renderDay();
      else this.renderAgenda();

      $('#calRange').textContent = this.label();
      $('#calendarMeta').textContent = this.meta();
      $('#view-calendar').setAttribute('aria-label', 'יומן — ' + CAL_LABEL[this.view]);
    },

    /* --------------------------------------------------- touch navigation */

    bindSwipe: function () {
      var stage = $('#calStage');
      if (!stage) return;
      var self = this, x0 = 0, y0 = 0, live = false;

      stage.addEventListener('touchstart', function (e) {
        live = e.touches.length === 1;
        if (!live) return;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
      }, { passive: true });

      stage.addEventListener('touchend', function (e) {
        if (!live) return;
        live = false;
        var dx = e.changedTouches[0].clientX - x0;
        var dy = e.changedTouches[0].clientY - y0;
        if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        // RTL: "הבא" sits on the left, so dragging leftwards moves forward in time
        self.step(dx < 0 ? 1 : -1);
      }, { passive: true });
    },

    init: function () {
      this.view = Store.data.prefs.calView;
      this.anchor = todayISO();
      this.bindSwipe();

      // the now-line has to keep moving while the day view is on screen
      var self = this;
      clearInterval(this.tickTimer);
      this.tickTimer = setInterval(function () {
        if (UI.view === 'calendar' && self.view === 'day') self.render();
      }, 60000);
    }
  };

  function renderCalendar(quiet) { Cal.render(quiet); }

  /* ---------------------------------------------- render: tasks / lists / notes */

  function taskTab() { return Store.data.prefs.taskTab; }

  function setTaskTab(tab) {
    if (TASK_TABS.indexOf(tab) === -1) tab = 'all';
    Store.data.prefs.taskTab = tab;
    Store.save();
    if (UI.view !== 'tasks') { setView('tasks'); return; }   // setView() repaints
    render();
  }

  /** the tasks the list is currently showing, in the order it shows them */
  function shownTasks() {
    var tab = taskTab(), today = todayISO();
    return sortTasks(pick('tasks').filter(function (x) { return taskMatchesTab(x, tab, today); }));
  }

  function renderTasks(quiet) {
    var tab = taskTab();
    var today = todayISO();
    var all = pick('tasks');
    var shown = shownTasks();

    // scoped to the sub-tab strip — the attention cards deep-link with the same
    // attribute but must never pick up the active-tab styling
    $$('.task-tabs [data-tasktab]').forEach(function (b) {
      var on = b.dataset.tasktab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    $$('[data-taskcount]').forEach(function (el) {
      var key = el.dataset.taskcount;
      el.textContent = all.filter(function (x) { return taskMatchesTab(x, key, today); }).length;
    });

    if (!quiet) {
      $('#tasksList').innerHTML = shown.length
        ? shown.map(function (t) { return taskRow(t); }).join('')
        : emptyState('אין משימות בתצוגה הזו', TASK_TAB_EMPTY[tab] || TASK_TAB_EMPTY.all);
    }

    $('#tasksMeta').textContent = all.length
      ? all.filter(function (t) { return !isClosed(t.status); }).length + ' פתוחות מתוך ' + all.length
      : '';
  }

  /* ------------------------------------------------- smart checklist lists */

  /** dated lists first, then the timeless ones, freshest edit on top */
  function shownLists() {
    return pick('lists').slice().sort(function (a, b) {
      var da = a.date || '9999-99-99', db = b.date || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function renderLists(quiet) {
    var lists = shownLists();

    if (!quiet) {
      $('#listsList').innerHTML = lists.length
        ? lists.map(listRow).join('')
        : emptyState('אין רשימות', 'רשימות קניות, ציוד לסטודיו וצ׳ק־ליסטים לפרויקט — הכול כאן.');
    }

    var items = 0, done = 0;
    lists.forEach(function (l) {
      var p = listProgress(l);
      items += p.total; done += p.done;
    });
    $('#listsMeta').textContent = lists.length
      ? plural(lists.length, 'רשימה אחת', 'רשימות') + ' · ' + done + '/' + items + ' הושלמו'
      : '';
  }

  function listRow(l) {
    var p = listProgress(l);
    var complete = p.total > 0 && p.done === p.total;

    return '<div class="row list' + (complete ? ' is-complete' : '') +
      '" data-rec="lists:' + l.id + '">' +
      '<div class="row-body">' +
      '<div class="row-title">☰ ' + esc(l.title) + '</div>' +
      '<div class="row-meta">' + catTag(l.category) +
      (l.date
        ? '<span class="badge dated">' + esc(relDay(l.date)) + '</span>'
        : '<span class="badge timeless">ללא תאריך</span>') +
      (complete ? '<span class="badge st-done">הרשימה הושלמה</span>' : '') +
      '</div>' +
      (p.total
        ? checklist(p, l.items, 'listitem', l.id)
        : '<div class="row-meta">רשימה ריקה</div>') +
      '</div>' +
      delBtn('lists', l.id) +
      '</div>';
  }

  /* -------------------------------------------------------- quick notes */

  function shownNotes() { return sortNotes(pick('notes')); }

  function renderNotes(quiet) {
    var notes = shownNotes();

    if (!quiet) {
      $('#notesList').innerHTML = notes.length
        ? notes.map(noteRow).join('')
        : emptyState('אין פתקים', 'רעיון, מספר טלפון או משפט מהלקוח — כתוב עכשיו, תסדר אחר כך.');
    }

    var pinned = notes.filter(function (n) { return n.pinned; }).length;
    $('#notesMeta').textContent = notes.length
      ? plural(notes.length, 'פתק אחד', 'פתקים') + (pinned ? ' · ' + pinned + ' מוצמדים' : '')
      : '';
  }

  function noteRow(n) {
    return '<div class="row note' + (n.pinned ? ' is-pinned' : '') +
      '" data-rec="notes:' + n.id + '">' +
      '<div class="row-body">' +
      '<div class="row-title">' + (n.pinned ? '📌 ' : '✎ ') + esc(n.title || 'פתק') + '</div>' +
      '<div class="row-meta">' + catTag(n.category) +
      (n.pinned ? '<span class="badge pinned">מוצמד</span>' : '') + '</div>' +
      '<p class="note-body">' + esc(n.body || '') + '</p>' +
      '<div class="quick-acts">' +
      '<button type="button" class="mini" data-pin="' + n.id + '">' +
      (n.pinned ? '📌 בטל הצמדה' : '📌 הצמד למעלה') + '</button>' +
      '<button type="button" class="mini" data-convert="task:' + n.id + '">➜ הפוך למשימה</button>' +
      '<button type="button" class="mini" data-convert="event:' + n.id + '">➜ הפוך לאירוע</button>' +
      '</div>' +
      '</div>' +
      delBtn('notes', n.id) +
      '</div>';
  }

  /* ==========================================================================
     render: client CRM  (Sprint 4)

     The list is a card pipeline; tapping a card opens the client file (drawer).
     Every card carries the two quick actions the mandate requires — a direct
     call and a WhatsApp thread — and its designated Next Action, or the alert
     badge when that action is missing.
     ========================================================================== */

  function clientTab() { return Store.data.prefs.clientTab; }

  function setClientTab(tab) {
    if (CLIENT_TABS.indexOf(tab) === -1) tab = 'all';
    Store.data.prefs.clientTab = tab;
    Store.save();
    if (UI.view !== 'clients') { setView('clients'); return; }   // setView() repaints
    render();
  }

  /** 'היום · 14:32' — one stamp shape for notes and for the history timeline */
  function stampLabel(ms) {
    var d = new Date(typeof ms === 'number' ? ms : Date.now());
    return relDay(isoDate(d)) + ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /**
   * Quick actions. tel: and wa.me are handed to the OS through real anchors —
   * the click is logged into the client file, never intercepted.
   */
  function contactButtons(c, size) {
    var cls = 'qa' + (size === 'mini' ? ' qa-mini' : '');
    var tel = telHref(c.phone);
    var wa = waHref(c.phone);
    return (tel
      ? '<a class="' + cls + ' qa-call" href="' + esc(tel) + '" data-contact="tel:' + c.id + '">📞 התקשר</a>'
      : '<span class="' + cls + ' is-off">📞 אין טלפון</span>') +
      (wa
        ? '<a class="' + cls + ' qa-wa" href="' + esc(wa) + '" target="_blank" rel="noopener" data-contact="whatsapp:' + c.id + '">💬 וואטסאפ</a>'
        : '<span class="' + cls + ' is-off">💬 אין וואטסאפ</span>');
  }

  function clientStatusBadge(c) {
    var s = normClientStatus(c.status);
    return '<span class="badge cst-' + s + '">' + esc(CLIENT_STATUS_LABEL[s]) + '</span>';
  }

  function noActionBadge() {
    return '<span class="badge no-action">' + esc(NO_ACTION_BADGE) + '</span>';
  }

  function nextActionLine(c) {
    if (clientNeedsAction(c)) return noActionBadge();
    var text = String(c.nextAction || '').trim();
    if (!text) return '<span class="cl-quiet">התיק סגור — לא נדרשת פעולה</span>';
    return '<span class="next-action"><span>הפעולה הבאה</span>' +
      esc(text) + (c.nextActionAt ? ' · ' + esc(relDay(c.nextActionAt)) : '') + '</span>';
  }

  function clientCard(c) {
    var status = normClientStatus(c.status);
    var safeName = esc(c.name) || 'לקוח';
    var contact = [c.phone, c.email].filter(Boolean).join(' · ');

    return '<article class="cl-card cst-row-' + status +
      (clientNeedsAction(c) ? ' is-missing' : '') + '" data-rec="clients:' + c.id + '">' +
      '<button type="button" class="cl-open" data-clientopen="' + c.id + '"' +
      ' aria-label="' + esc('פתיחת תיק הלקוח ' + (c.name || '')) + '">' +
      '<span class="cl-name">' + safeName + '</span>' +
      '<span class="cl-badges">' + clientStatusBadge(c) + catTag(normCat(c.category)) + '</span>' +
      '<span class="cl-contact">' + (contact ? esc(contact) : 'אין פרטי קשר') + '</span>' +
      '<span class="cl-interest">' +
      esc(c.interest ? 'מתעניין ב־' + c.interest : 'טרם הוגדר תחום עניין') + '</span>' +
      nextActionLine(c) +
      '</button>' +
      '<div class="cl-acts">' + contactButtons(c, 'mini') + delBtn('clients', c.id) + '</div>' +
      '</article>';
  }

  /** the client cards the pipeline is currently showing, in pipeline order */
  function shownClients() {
    var tab = clientTab();
    return sortClients(pick('clients').filter(function (c) { return clientMatchesTab(c, tab); }));
  }

  function renderClients(quiet) {
    var tab = clientTab();
    var all = pick('clients');
    var shown = shownClients();

    // scoped to the sub-tab strip — the attention card deep-links with the same
    // attribute but must never pick up the active-tab styling
    $$('.client-tabs [data-clientfilter]').forEach(function (b) {
      var on = b.dataset.clientfilter === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    $$('[data-clientcount]').forEach(function (el) {
      var key = el.dataset.clientcount;
      el.textContent = all.filter(function (c) { return clientMatchesTab(c, key); }).length;
    });

    if (!quiet) {
      $('#clientsList').innerHTML = shown.length
        ? shown.map(clientCard).join('')
        : emptyState('אין לקוחות בתצוגה הזו', CLIENT_TAB_EMPTY[tab] || CLIENT_TAB_EMPTY.all);
    }

    var missing = all.filter(clientNeedsAction).length;
    $('#clientsMeta').textContent = all.length
      ? all.length + ' לקוחות · ' + pendingFollowUps().length + ' במעקב' +
      (missing ? ' · ' + missing + ' ללא פעולה הבאה' : '')
      : '';
  }

  /* ==========================================================================
     Client drawer — תיק לקוח

     Six tabs over one record. Every builder below is a pure function of
     (client, linked records) so healthcheck.js can render a whole file
     head-lessly and assert what it contains.
     ========================================================================== */

  function drawerGroup(title, html, emptyHint) {
    return '<div class="dr-group">' +
      '<div class="day-head"><span>' + esc(title) + '</span></div>' +
      '<div class="dr-card">' + (html || emptyState('אין רשומות', emptyHint)) + '</div>' +
      '</div>';
  }

  /** every tab can create straight into this file — the association is pre-set */
  function drawerAdd(type, clientId, label) {
    return '<div class="quick-acts dr-add">' +
      '<button type="button" class="mini" data-clientadd="' + type + ':' + clientId + '">' +
      esc(label) + '</button></div>';
  }

  function drawerEventRow(e) {
    var when = [relDay(e.date), e.start ? e.start + (e.end ? '–' + e.end : '') : '', e.location]
      .filter(Boolean).join(' · ');
    return '<div class="ev ev-' + normCat(e.category) + '">' +
      '<div class="ev-body">' +
      '<div class="ev-title">' + esc(e.title) + '</div>' +
      '<div class="ev-meta">' + esc(when) + '</div>' +
      '</div></div>';
  }

  /* ---- 1. סקירה ---- */

  function drawerOverview(c) {
    var status = normClientStatus(c.status);
    var facts = [
      ['סטטוס', CLIENT_STATUS_LABEL[status]],
      ['קטגוריה', CAT_LABEL[normCat(c.category)]],
      ['טלפון', c.phone || '—'],
      ['אימייל', c.email || '—'],
      ['תחום עניין / יצירה', c.interest || '—'],
      ['תקציב', c.budget || '—'],
      ['קשר אחרון', c.lastContactAt ? relDay(c.lastContactAt) : 'טרם נוצר קשר'],
      ['תאריך מעקב', c.followUpAt ? relDay(c.followUpAt) : '—']
    ];

    return '<div class="dr-card">' +
      '<div class="dr-status">' +
      '<label class="field-label" for="drawerStatusSel">שלב בצינור המכירות</label>' +
      '<select class="select" id="drawerStatusSel" data-clientstatus="' + c.id + '">' +
      CLIENT_STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (s === status ? ' selected' : '') + '>' +
          esc(CLIENT_STATUS_LABEL[s]) + '</option>';
      }).join('') +
      '</select></div>' +

      '<div class="dr-next' + (clientNeedsAction(c) ? ' is-missing' : '') + '">' +
      '<label class="field-label" for="drawerNextInput">הפעולה הבאה</label>' +
      (clientNeedsAction(c) ? noActionBadge() : '') +
      '<input class="input" id="drawerNextInput" name="nextAction" value="' +
      esc(c.nextAction || '') + '" placeholder="לחזור ביום שלישי / לבדוק הדמיה">' +
      '<div class="dr-next-row">' +
      '<input class="input" type="date" name="nextActionAt" value="' + esc(c.nextActionAt || '') + '">' +
      '<button type="button" class="btn btn-gold" data-nextaction="' + c.id + '">שמירה</button>' +
      '</div></div>' +

      '<dl class="dr-facts">' + facts.map(function (r) {
        return '<div class="dr-fact"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</dl>' +

      (c.notes ? '<p class="note-body">' + esc(c.notes) + '</p>' : '') +
      '<div class="quick-acts">' + contactButtons(c) + '</div>' +
      '</div>';
  }

  /* ---- 2. פגישות ---- */

  function drawerMeetings(c, events) {
    var t = todayISO();
    var list = (Array.isArray(events) ? events.slice() : []).sort(function (a, b) {
      if (a.date !== b.date) return (a.date || '') < (b.date || '') ? -1 : 1;
      return timeToMinutes(a.start) - timeToMinutes(b.start);
    });
    var next = list.filter(function (e) { return (e.date || '') >= t; });
    var past = list.filter(function (e) { return (e.date || '') < t; }).reverse();

    return drawerAdd('event', c.id, '＋ פגישה חדשה ללקוח') +
      drawerGroup('פגישות קרובות', next.map(drawerEventRow).join(''),
        'אין פגישה עתידית המשויכת ללקוח הזה.') +
      drawerGroup('פגישות שהיו', past.map(drawerEventRow).join(''),
        'עוד לא התקיימה פגישה מתועדת.');
  }

  /* ---- 3. משימות ---- */

  function drawerTasks(c, tasks) {
    var list = sortTasks(Array.isArray(tasks) ? tasks : []);
    return drawerAdd('task', c.id, '＋ משימה חדשה ללקוח') +
      '<div class="dr-card">' +
      (list.length
        ? list.map(function (x) { return taskRow(x); }).join('')
        : emptyState('אין משימות משויכות',
          'כל משימה שתשייך ללקוח תופיע כאן עם מתג הסטטוס המהיר שלה.')) +
      '</div>';
  }

  /* ---- 4. רשימות ---- */

  function drawerLists(c, lists) {
    var list = Array.isArray(lists) ? lists : [];
    return drawerAdd('list', c.id, '＋ רשימה חדשה ללקוח') +
      '<div class="dr-card">' +
      (list.length
        ? list.map(listRow).join('')
        : emptyState('אין רשימות משויכות',
          'מידות קיר, העדפות סגנון או צ׳ק־ליסט התקנה — הכול נשמר בתיק.')) +
      '</div>';
  }

  /* ---- 5. פתקים ---- */

  function drawerNotes(c) {
    var rows = Array.isArray(c.clientNotes) ? c.clientNotes : [];
    return '<div class="dr-card dr-compose">' +
      '<label class="field-label" for="drawerNoteBox">פתק חדש לתיק</label>' +
      '<textarea class="textarea" id="drawerNoteBox" placeholder="מה נאמר בשיחה, מה הלקוח ביקש…"></textarea>' +
      '<button type="button" class="btn btn-gold" data-clientnote="' + c.id + '">הוספת פתק</button>' +
      '</div>' +
      '<div class="dr-card">' +
      (rows.length
        ? rows.map(function (n) {
          return '<div class="dr-log">' +
            '<div class="dr-log-body">' +
            '<div class="dr-log-when">' + esc(stampLabel(n.at)) + '</div>' +
            '<p class="note-body">' + esc(n.body) + '</p>' +
            '</div>' +
            '<button type="button" class="sheet-x" data-clientnotedel="' + c.id + ':' + n.id +
            '" aria-label="מחיקת הפתק">✕</button>' +
            '</div>';
        }).join('')
        : emptyState('אין פתקים בתיק',
          'כל מה שנאמר בשיחה — כתוב כאן, ותמצא אותו בפעם הבאה.')) +
      '</div>';
  }

  /* ---- 6. היסטוריה ---- */

  function drawerHistory(c) {
    var rows = Array.isArray(c.history) ? c.history : [];
    return '<div class="dr-card">' +
      (rows.length
        ? rows.map(function (h) {
          return '<div class="dr-log dr-' + h.kind + '">' +
            '<span class="dr-log-ico" aria-hidden="true">' + (HISTORY_ICON[h.kind] || '•') + '</span>' +
            '<div class="dr-log-body">' +
            '<div class="dr-log-when">' + esc(stampLabel(h.at)) + '</div>' +
            '<div class="dr-log-text">' + esc(h.text) + '</div>' +
            '</div></div>';
        }).join('')
        : emptyState('אין היסטוריה עדיין',
          'שינויי סטטוס, עדכוני פעולה הבאה ויצירות קשר נרשמים כאן אוטומטית.')) +
      '</div>';
  }

  function drawerTabHTML(tab, c, links) {
    var l = links || { events: [], tasks: [], lists: [] };
    if (tab === 'meetings') return drawerMeetings(c, l.events);
    if (tab === 'tasks') return drawerTasks(c, l.tasks);
    if (tab === 'lists') return drawerLists(c, l.lists);
    if (tab === 'notes') return drawerNotes(c);
    if (tab === 'history') return drawerHistory(c);
    return drawerOverview(c);
  }

  /**
   * The drawer reads the FULL store, not pick(): a client file that silently
   * hides half its meetings because the global filter sits on "אישי" is a data
   * trap, not a filter. Same deliberate carve-out the reminder scan takes.
   */
  function clientLinks(id) {
    function of(collection) {
      return Store.data[collection].filter(function (r) { return r.clientId === id; });
    }
    return { events: of('events'), tasks: of('tasks'), lists: of('lists') };
  }

  function clientSubtitle(c) {
    var bits = [CLIENT_STATUS_LABEL[normClientStatus(c.status)]];
    if (c.interest) bits.push(c.interest);
    bits.push(c.lastContactAt ? 'קשר אחרון: ' + relDay(c.lastContactAt) : 'טרם נוצר קשר');
    return bits.join(' · ');
  }

  var Drawer = {
    clientId: null,
    tab: 'overview',

    isOpen: function () { return !!this.clientId; },

    client: function () {
      return this.clientId ? Store.find('clients', this.clientId) : null;
    },

    open: function (id, tab) {
      if (!Store.find('clients', id)) return;
      this.clientId = id;
      this.tab = DRAWER_TABS.indexOf(tab) === -1 ? 'overview' : tab;
      $('#backdrop').hidden = false;
      $('#clientDrawer').hidden = false;
      document.body.style.overflow = 'hidden';
      this.render();
    },

    close: function () {
      this.clientId = null;
      var el = $('#clientDrawer');
      if (el) el.hidden = true;
    },

    setTab: function (tab) {
      if (DRAWER_TABS.indexOf(tab) === -1) return;
      this.tab = tab;
      this.render();
    },

    /**
     * Only the two tabs built out of patchable record rows can be reconciled
     * in place; every other tab (overview, meetings, notes, history) answers
     * null and is rebuilt, because nothing inside it carries data-rec.
     */
    keys: function () {
      var c = this.client();
      if (!c) return null;
      var l = clientLinks(c.id);
      if (this.tab === 'tasks') return recKeys('tasks', sortTasks(l.tasks));
      if (this.tab === 'lists') return recKeys('lists', l.lists);
      return null;
    },

    render: function (quiet) {
      var el = $('#clientDrawer');
      if (!el) return;
      var c = this.client();
      if (!c) { closeSheets(); return; }     // the record was deleted underneath us

      var self = this;
      $$('[data-clienttab]').forEach(function (b) {
        var on = b.dataset.clienttab === self.tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      $('#drawerName').textContent = c.name || 'לקוח';
      $('#drawerSub').textContent = clientSubtitle(c);
      $('#drawerActions').innerHTML =
        clientStatusBadge(c) + catTag(normCat(c.category)) +
        (clientNeedsAction(c) ? noActionBadge() : '') +
        contactButtons(c, 'mini');
      if (!quiet) $('#drawerBody').innerHTML = drawerTabHTML(this.tab, c, clientLinks(c.id));
      // the dialog is named by #drawerName; the body just says which tab is live
      $('#drawerBody').setAttribute('aria-label', DRAWER_TAB_LABEL[this.tab]);
    }
  };

  function renderDrawer(quiet) { if (Drawer.isOpen()) Drawer.render(quiet); }

  /* ------------------------------------------------------- render: fragments */

  function catTag(cat) {
    return '<span class="tag tag-' + cat + '">' + CAT_LABEL[cat] + '</span>';
  }

  function delBtn(collection, id) {
    return '<button type="button" class="sheet-x" data-del="' + collection + ':' + id + '" aria-label="מחיקה">✕</button>';
  }

  function emptyState(title, hint) {
    return '<div class="empty"><b>' + esc(title) + '</b>' + esc(hint) + '</div>';
  }

  /* ------------------------------------------------------------ render: all */

  /** the full repaint — view switches, filter changes, boot, a cloud merge */
  function render() {
    renderSummary();
    renderAttention();
    renderTimeline();
    renderTodo();
    renderCalendar();
    renderTasks();
    renderLists();
    renderNotes();
    renderClients();
    renderDrawer();
    Sync.paint();
    $('#todayLabel').textContent = hebDate(todayISO());
    $('#railUserName').textContent = OWNER.name;
  }

  /* ==========================================================================
     Targeted DOM updates (Sprint 7)

     A tap used to call render(), which rewrote the innerHTML of every container
     in the app — including the one the finger was still on. The pressed card
     was destroyed and rebuilt mid-press: the :active state died, the ripple
     never finished, and the whole layout flickered.

     A simple state change now takes two steps instead:

       1. Patch.record()  rewrites ONLY the node(s) that stand for that one
          record, wherever they appear — My Day, the tasks list, a calendar
          pane, an open client file. No container is touched.

       2. Patch.settle()  refreshes the derived surfaces (counters, the summary
          line, the attention strip — all cheap text) and rebuilds a list
          container only when its MEMBERSHIP changed. A task that just left
          "לביצוע היום" still has to disappear; a task that merely changed
          priority does not cost a single container rewrite.

     Containers belonging to a view that is not on screen are skipped entirely
     — setView() runs a full render() on the way in.
     ========================================================================== */

  function recKeys(collection, rows) {
    return (rows || []).map(function (r) { return collection + ':' + r.id; });
  }

  /** the record keys a container currently holds, in DOM order */
  function domKeys(sel) {
    var el = $(sel);
    if (!el) return null;
    return $$('[data-rec]', el).map(function (n) { return n.dataset.rec; });
  }

  /** null on either side means "cannot prove it is unchanged" — rebuild */
  function sameKeys(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
    return true;
  }

  /** every list container, the ids it should hold, and how to redraw it */
  var SECTIONS = [
    { view: 'today', sel: '#timeline', draw: renderTimeline,
      keys: function () { return recKeys('events', todaysEvents()); } },
    { view: 'today', sel: '#todoToday', draw: renderTodo,
      keys: function () { return recKeys('tasks', unscheduledToday()); } },
    // scope: the stage keeps the markup of every pane it has ever drawn, and
    // only hides the inactive ones — membership must be read off the live pane
    { view: 'calendar', sel: '#calStage', scope: '#calStage .cal-pane:not([hidden])',
      draw: renderCalendar, keys: function () { return Cal.keys(); } },
    { view: 'tasks', sel: '#tasksList', draw: renderTasks,
      keys: function () { return recKeys('tasks', shownTasks()); } },
    { view: 'tasks', sel: '#listsList', draw: renderLists,
      keys: function () { return recKeys('lists', shownLists()); } },
    { view: 'tasks', sel: '#notesList', draw: renderNotes,
      keys: function () { return recKeys('notes', shownNotes()); } },
    { view: 'clients', sel: '#clientsList', draw: renderClients,
      keys: function () { return recKeys('clients', shownClients()); } }
  ];

  var Patch = {
    /** the markup for one record, in the variant the node asked for */
    html: function (collection, rec, compact) {
      if (collection === 'tasks') return taskRow(rec, compact);
      if (collection === 'lists') return listRow(rec);
      if (collection === 'notes') return noteRow(rec);
      if (collection === 'clients') return clientCard(rec);
      if (collection === 'events') return eventCard(rec);
      return '';
    },

    /** step 1 — swap this record's node(s) in place. Returns false if it is
     *  not on screen at all, which is the caller's cue to repaint properly. */
    record: function (collection, id) {
      var rec = Store.find(collection, id);
      if (!rec) return false;
      var hit = false;
      $$('[data-rec="' + collection + ':' + id + '"]').forEach(function (node) {
        var html = Patch.html(collection, rec, node.dataset.compact === '1');
        if (!html) return;
        hit = true;
        node.outerHTML = html;
      });
      return hit;
    },

    /** step 2 — derived text always, containers only where membership moved */
    settle: function () {
      renderSummary();
      renderAttention();

      SECTIONS.forEach(function (s) {
        if (UI.view !== s.view) return;          // off-screen: setView() will redraw it
        s.draw(sameKeys(domKeys(s.scope || s.sel), s.keys()));
      });

      renderDrawer(sameKeys(domKeys('#drawerBody'), Drawer.keys()));
      Sync.paint();
    },

    /** the whole cycle for one changed record */
    apply: function (collection, id) {
      if (!Patch.record(collection, id)) { render(); return false; }
      Patch.settle();
      return true;
    }
  };

  /* ==========================================================================
     Undo — the safety net behind every deletion (Sprint 7)

     Deleting is one tap and asks nothing. The record leaves the store at once,
     so the view never lies, and Undo holds the exact slot it came from until
     the toast expires. The confirmation dialogue still exists — it is just
     asked afterwards, and only by the people who need it.
     ========================================================================== */

  var Undo = {
    pending: null,        // { entry, restore } — at most one, always the newest

    arm: function (entry, restore) {
      this.commit();                            // an older window closes, never stacks
      this.pending = { entry: entry, restore: restore };
      return this.pending;
    },

    has: function () { return this.pending !== null; },
    peek: function () { return this.pending ? this.pending.entry : null; },

    /** אחזר was tapped — put the record back and close the window */
    fire: function () {
      var p = this.pending;
      this.pending = null;
      if (!p) return null;
      p.restore();
      return p.entry;
    },

    /** the five seconds ran out — the deletion is now permanent */
    commit: function () {
      var p = this.pending;
      this.pending = null;
      return p ? p.entry : null;
    }
  };

  /**
   * Stamp a record as changed, strictly later than its previous stamp.
   * Date.now() on its own is not enough here: the outbox diffs on updatedAt, so
   * a delete and an undo landing inside the same millisecond would leave the
   * queued tombstone standing and the restored record would sync as deleted.
   */
  function touch(rec) {
    rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
    return rec.updatedAt;
  }

  /**
   * Remove a record and arm its undo. Pure store work — no DOM, no toast — so
   * the healthcheck can drive the whole delete/restore cycle head-lessly.
   */
  function softDelete(collection, id) {
    var list = Store.data && Store.data[collection];
    if (!list) return null;

    var index = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { index = i; break; } }
    if (index === -1) return null;

    var rec = list[index];
    list.splice(index, 1);
    Store.save();

    var entry = { collection: collection, id: id, index: index, label: DELETED_LABEL[collection] || 'הפריט' };

    Undo.arm(entry, function () {
      var live = Store.data[collection];
      // the newer stamp is what makes the outbox REPLACE the tombstone it just
      // queued with an upsert — without it the restore would sync as a delete
      touch(rec);
      live.splice(Math.min(index, live.length), 0, rec);
      Store.save();
    });

    return entry;
  }

  /** the same safety net for a note inside a client file, which is a sub-record */
  function softDeleteClientNote(clientId, noteId) {
    var c = Store.find('clients', clientId);
    if (!c) return null;
    var rows = Array.isArray(c.clientNotes) ? c.clientNotes : [];

    var index = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === noteId) { index = i; break; } }
    if (index === -1) return null;

    var note = rows[index];
    rows.splice(index, 1);
    c.clientNotes = rows;
    touch(c);
    Store.save();

    var entry = { collection: 'clientNotes', id: noteId, index: index, label: DELETED_LABEL.clientNotes };

    Undo.arm(entry, function () {
      var live = Array.isArray(c.clientNotes) ? c.clientNotes : [];
      live.splice(Math.min(index, live.length), 0, note);
      c.clientNotes = live;
      touch(c);
      Store.save();
    });

    return entry;
  }

  /* ------------------------------------------------------------ master add */

  function openSheet(id) {
    $('#backdrop').hidden = false;
    $('#' + id).hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheets() {
    $('#backdrop').hidden = true;
    $('#typeSheet').hidden = true;
    $('#formSheet').hidden = true;
    Drawer.close();
    document.body.style.overflow = '';
    PREFILL = null;
  }

  /** date/time handed over by a tapped calendar cell, consumed by the next form */
  var PREFILL = null;

  function openTypeSheet(prefill) {
    PREFILL = prefill || null;
    $('#formSheet').hidden = true;
    openSheet('typeSheet');
  }

  /** contextual creation: the tapped slot decides the date and the start time */
  function applyPrefill() {
    if (!PREFILL) return;
    var fields = $('#formFields');
    if (!fields) return;

    function set(name, value) {
      var el = fields.querySelector('[name="' + name + '"]');
      if (el && value) el.value = value;
    }

    ['date', 'due', 'followUpAt'].forEach(function (n) { set(n, PREFILL.date); });
    ['start', 'time'].forEach(function (n) { set(n, PREFILL.start); });
    if (PREFILL.start) set('end', shiftTime(PREFILL.start, 60));
    set('clientId', PREFILL.clientId);          // created from inside a client file
  }

  var FIELDS = {
    event: function () {
      return f('title', 'כותרת האירוע', '<input class="input" name="title" placeholder="פגישה עם…" required>') +
        '<div class="field-row">' +
        f('date', 'תאריך', '<input class="input" type="date" name="date" value="' + todayISO() + '">') +
        f('start', 'שעת התחלה', '<input class="input" type="time" name="start" value="09:00">') +
        '</div>' +
        '<div class="field-row">' +
        f('end', 'שעת סיום', '<input class="input" type="time" name="end">') +
        f('location', 'מיקום', '<input class="input" name="location" placeholder="זום / כתובת">') +
        '</div>' +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        f('notes', 'הערות', '<textarea class="textarea" name="notes" placeholder="פרטים נוספים…"></textarea>');
    },
    task: function () {
      return f('title', 'מה צריך לעשות?', '<input class="input" name="title" placeholder="לשלוח הצעת מחיר…" required>') +
        '<div class="field-row">' +
        f('due', 'תאריך יעד', '<input class="input" type="date" name="due" value="' + todayISO() + '">') +
        f('time', 'שעה (לא חובה)', '<input class="input" type="time" name="time">') +
        '</div>' +
        '<div class="field-row">' +
        f('status', 'סטטוס', picker('status', TASK_STATUSES, STATUS_LABEL, 'new')) +
        f('priority', 'עדיפות', picker('priority', PRIORITIES, PRIORITY_LABEL, 'medium')) +
        '</div>' +
        f('nextAction', 'הפעולה הבאה', '<input class="input" name="nextAction" placeholder="להתקשר ללקוח ולאשר מידות">') +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        f('subtasks', 'תת־משימות (שורה לכל אחת)', '<textarea class="textarea" name="subtasks" placeholder="לאסוף מידות&#10;לחשב תמחור"></textarea>') +
        f('notes', 'הערות', '<textarea class="textarea" name="notes"></textarea>');
    },
    list: function () {
      return f('title', 'שם הרשימה', '<input class="input" name="title" placeholder="קניות לשבת…" required>') +
        f('date', 'תאריך (לא חובה — רשימה יכולה להיות ללא תאריך)', '<input class="input" type="date" name="date">') +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        f('items', 'פריטים (שורה לכל פריט)', '<textarea class="textarea" name="items" placeholder="חלב&#10;לחם&#10;ביצים"></textarea>');
    },
    note: function () {
      return f('title', 'כותרת', '<input class="input" name="title" placeholder="רעיון / תזכורת">') +
        f('body', 'תוכן הפתק', '<textarea class="textarea" name="body" placeholder="כתוב כאן…" required></textarea>');
    },
    client: function () {
      return f('name', 'שם הלקוח', '<input class="input" name="name" placeholder="שם מלא / שם העסק" required>') +
        '<div class="field-row">' +
        f('phone', 'טלפון', '<input class="input" type="tel" name="phone" placeholder="050-0000000">') +
        f('email', 'אימייל', '<input class="input" type="email" name="email" placeholder="name@mail.com">') +
        '</div>' +
        f('status', 'שלב בצינור המכירות', picker('status', CLIENT_STATUSES, CLIENT_STATUS_LABEL, 'lead')) +
        f('interest', 'תחום עניין / יצירה', '<input class="input" name="interest" placeholder="פורטרט שמן 70x100, אימפסטו">') +
        f('budget', 'תקציב', '<input class="input" name="budget" placeholder="8,000–12,000 ₪">') +
        f('nextAction', 'הפעולה הבאה', '<input class="input" name="nextAction" placeholder="לחזור ביום שלישי עם הצעת מחיר">') +
        '<div class="field-row">' +
        f('nextActionAt', 'מתי', '<input class="input" type="date" name="nextActionAt" value="' + addDaysISO(todayISO(), 2) + '">') +
        f('followUpAt', 'תאריך מעקב', '<input class="input" type="date" name="followUpAt" value="' + addDaysISO(todayISO(), 3) + '">') +
        '</div>' +
        f('notes', 'הערה כללית', '<textarea class="textarea" name="notes"></textarea>');
    }
  };

  /**
   * Optional association. The client drawer's פגישות / משימות / רשימות tabs are
   * only as good as this select, so every creatable type that can belong to a
   * client exposes it.
   */
  function clientPicker(current) {
    var opts = ['<option value="">ללא שיוך</option>'];
    sortClients(Store.data.clients).forEach(function (c) {
      opts.push('<option value="' + esc(c.id) + '"' + (c.id === current ? ' selected' : '') + '>' +
        esc(c.name) + ' · ' + esc(CLIENT_STATUS_LABEL[normClientStatus(c.status)]) + '</option>');
    });
    return '<select class="select" name="clientId">' + opts.join('') + '</select>';
  }

  function f(name, label, control) {
    return '<div class="field"><label class="field-label" for="fld_' + name + '">' + label + '</label>' +
      control
        .replace('<input', '<input id="fld_' + name + '"')
        .replace('<textarea', '<textarea id="fld_' + name + '"')
        .replace('<select', '<select id="fld_' + name + '"') +
      '</div>';
  }

  /** a labelled <select> built straight off a vocabulary + its Hebrew labels */
  function picker(name, values, labels, current) {
    return '<select class="select" name="' + name + '">' +
      values.map(function (v) {
        return '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>' +
          esc(labels[v]) + '</option>';
      }).join('') +
      '</select>';
  }

  /** free text → checklist rows; blank lines are dropped, order is preserved */
  function parseChecklist(text, prefix) {
    return normItems(String(text == null ? '' : text).split('\n'), prefix);
  }

  function openForm(type, prefill) {
    if (prefill) PREFILL = prefill;             // opened straight from a client file
    UI.formType = type;
    UI.formCat = (type === 'client') ? 'business' : 'personal';

    $('#formSheetTitle').textContent = TYPE_LABEL[type];
    $('#formFields').innerHTML = FIELDS[type]();
    setFormCat(UI.formCat);
    applyPrefill();

    $('#typeSheet').hidden = true;
    openSheet('formSheet');

    var first = $('#formFields input, #formFields textarea');
    if (first) { setTimeout(function () { first.focus(); }, 60); }
  }

  function setFormCat(cat) {
    UI.formCat = normCat(cat);
    $$('#catPicker .seg').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.cat === UI.formCat);
    });
  }

  function submitForm(e) {
    e.preventDefault();
    var form = $('#entityForm');
    var v = {};
    $$('#formFields [name]', form).forEach(function (el) { v[el.name] = (el.value || '').trim(); });

    var type = UI.formType, cat = UI.formCat, label;

    if (type === 'event') {
      if (!v.title) return warn('צריך כותרת לאירוע');
      Store.add('events', {
        type: 'event', title: v.title, category: cat,
        date: v.date || todayISO(), start: v.start || '', end: v.end || '',
        location: v.location || '', notes: v.notes || '', clientId: v.clientId || ''
      });
      linkLog(v.clientId, 'נקבעה פגישה: ' + v.title);
      label = 'האירוע נוסף';
    } else if (type === 'task') {
      if (!v.title) return warn('צריך שם למשימה');
      Store.add('tasks', {
        type: 'task', title: v.title, category: cat,
        due: v.due || todayISO(), time: v.time || '',
        status: v.status || 'new', priority: v.priority || 'medium',
        nextAction: v.nextAction || '', subtasks: parseChecklist(v.subtasks, 'st'),
        done: false, notes: v.notes || '', clientId: v.clientId || ''
      });
      linkLog(v.clientId, 'נוספה משימה: ' + v.title);
      label = 'המשימה נוספה';
    } else if (type === 'list') {
      if (!v.title) return warn('צריך שם לרשימה');
      Store.add('lists', {
        type: 'list', title: v.title, category: cat,
        date: v.date || '', items: parseChecklist(v.items, 'li'), clientId: v.clientId || ''
      });
      linkLog(v.clientId, 'נוספה רשימה: ' + v.title);
      label = 'הרשימה נוספה';
    } else if (type === 'note') {
      if (!v.body) return warn('הפתק ריק');
      Store.add('notes', {
        type: 'note', title: v.title || 'פתק', category: cat, body: v.body, pinned: false
      });
      label = 'הפתק נשמר';
    } else if (type === 'client') {
      if (!v.name) return warn('צריך שם ללקוח');
      var created = Store.add('clients', {
        type: 'client', name: v.name, category: cat,
        phone: v.phone || '', email: v.email || '', status: v.status || 'lead',
        interest: v.interest || '', budget: v.budget || '',
        nextAction: v.nextAction || '', nextActionAt: v.nextActionAt || '',
        followUpAt: v.followUpAt || '', notes: v.notes || ''
      });
      logHistory(created, 'created',
        'התיק נפתח · ' + CLIENT_STATUS_LABEL[normClientStatus(created.status)]);
      Store.save();
      label = 'הלקוח נוסף';
    }

    // a form opened from inside a client file returns to that file, same tab
    var backTo = (PREFILL && PREFILL.clientId) ? PREFILL.clientId : null;
    var backTab = Drawer.tab;

    closeSheets();
    render();
    if (backTo) Drawer.open(backTo, backTab);
    toast(label + ' · ' + CAT_LABEL[cat]);
  }

  /** creating a linked record writes a line into that client's timeline */
  function linkLog(clientId, text) {
    var c = clientId ? Store.find('clients', clientId) : null;
    if (!c) return;
    logHistory(c, 'link', text);
    Store.save();
  }

  /* ----------------------------------------------------------------- toast */

  var toastTimer = null;

  /**
   * Pass `action` and the toast becomes a safety net rather than a receipt:
   * the אחזר button appears and the dismiss timer stretches to UNDO_MS. When
   * that timer runs out the pending deletion is committed — the toast IS the
   * confirmation dialogue, asked after the fact so the common case is free.
   */
  function toast(msg, action) {
    var el = $('#toast');
    if (!el) return;
    var txt = $('#toastText'), btn = $('#toastUndo');

    if (txt) txt.textContent = msg; else el.textContent = msg;
    if (btn) btn.hidden = !action;
    el.classList.toggle('has-action', !!action);
    el.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
      el.classList.remove('has-action');
      if (btn) btn.hidden = true;
      if (action) Undo.commit();            // the window closed — the deletion stands
    }, action ? UNDO_MS : TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    var el = $('#toast'), btn = $('#toastUndo');
    if (el) { el.hidden = true; el.classList.remove('has-action'); }
    if (btn) btn.hidden = true;
  }

  function warn(msg) { toast(msg); return false; }

  /* ==========================================================================
     PWA — service worker registration
     ========================================================================== */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;   // a worker needs http(s)

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          // a previous version was already controlling the page => real update
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('גרסה חדשה מוכנה — רענן כדי לעדכן');
          }
        });
      });
    })['catch'](function () { /* offline install is a bonus, never a blocker */ });
  }

  /* ==========================================================================
     Notifications engine
     - permission toggle lives in the top bar
     - reminders fire through the service worker registration so they survive
       a backgrounded tab; a plain Notification is the desktop fallback
     - the category filter is a VIEW filter: reminders always scan the full
       store, otherwise hiding "עסקי" would silently mute business meetings
     ========================================================================== */

  var NOTIFY_ICON = 'icons/icon-192.png';
  var NOTIFY_BADGE = 'icons/favicon-32.png';
  var SCAN_MS = 30000;

  var Notify = {
    timer: null,

    supported: function () {
      return typeof window.Notification !== 'undefined';
    },

    permission: function () {
      return this.supported() ? window.Notification.permission : 'unsupported';
    },

    armed: function () {
      return this.supported() &&
        this.permission() === 'granted' &&
        Store.data.prefs.notify.on === true;
    },

    /** paint the top-bar toggle to match the real browser permission state */
    paint: function () {
      var btn = $('#pushBtn'), label = $('#pushLabel'), ico = $('#pushIco');
      if (!btn) return;

      if (!this.supported()) { btn.hidden = true; return; }
      btn.hidden = false;
      btn.classList.remove('is-on', 'is-blocked');

      var p = this.permission();
      if (p === 'denied') {
        btn.classList.add('is-blocked');
        ico.textContent = '🔕';
        label.textContent = 'התראות חסומות';
        btn.setAttribute('aria-pressed', 'false');
      } else if (p === 'granted' && Store.data.prefs.notify.on) {
        btn.classList.add('is-on');
        ico.textContent = '🔔';
        label.textContent = 'התראות פעילות';
        btn.setAttribute('aria-pressed', 'true');
      } else {
        ico.textContent = '🔔';
        label.textContent = 'הפעל התראות פוש';
        btn.setAttribute('aria-pressed', 'false');
      }
    },

    onToggle: function () {
      var self = this;

      if (!this.supported()) { toast('הדפדפן הזה לא תומך בהתראות'); return; }

      var p = this.permission();

      if (p === 'denied') {
        toast('ההתראות חסומות — יש לאשר אותן בהגדרות האתר בדפדפן');
        return;
      }

      if (p === 'granted') {                                  // simple on/off
        Store.data.prefs.notify.on = !Store.data.prefs.notify.on;
        Store.save();
        self.paint();
        toast(Store.data.prefs.notify.on ? 'התראות פוש הופעלו' : 'התראות פוש כובו');
        if (Store.data.prefs.notify.on) self.tick();
        return;
      }

      var req;
      try { req = window.Notification.requestPermission(); } catch (e) { req = null; }

      // Safari < 16 hands back a callback API instead of a promise
      if (!req || typeof req.then !== 'function') {
        try {
          window.Notification.requestPermission(function (res) { self.afterRequest(res); });
        } catch (e2) { toast('לא ניתן לבקש הרשאת התראות בדפדפן הזה'); }
        return;
      }
      req.then(function (res) { self.afterRequest(res); })['catch'](function () { self.paint(); });
    },

    afterRequest: function (result) {
      if (result === 'granted') {
        Store.data.prefs.notify.on = true;
        Store.save();
        this.paint();
        this.show('benja-welcome', 'ההתראות הופעלו 🔔',
          'נשלח לך תזכורת ' + Store.data.prefs.notify.lead + ' דקות לפני כל פגישה ומשימה מתוזמנת.');
        toast('התראות פוש הופעלו');
        this.tick();
      } else {
        Store.data.prefs.notify.on = false;
        Store.save();
        this.paint();
        toast(result === 'denied' ? 'ההתראות נחסמו בדפדפן' : 'לא אושרה הרשאת התראות');
      }
    },

    /** one notification, service-worker first so it shows with the tab hidden */
    show: function (tag, title, body) {
      var opts = {
        body: body,
        icon: NOTIFY_ICON,
        badge: NOTIFY_BADGE,
        dir: 'rtl',
        lang: 'he',
        tag: tag,
        vibrate: [110, 60, 110],
        data: { url: './index.html' }
      };

      function fallback() {
        try { new window.Notification(title, opts); } catch (e) { /* mobile blocks this ctor */ }
      }

      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then(function (reg) { return reg.showNotification(title, opts); })
          ['catch'](fallback);
      } else {
        fallback();
      }
    },

    /** everything starting inside the lead window that has not fired today */
    due: function () {
      var t = todayISO();
      var now = new Date();
      var mins = now.getHours() * 60 + now.getMinutes();
      var lead = Store.data.prefs.notify.lead;
      var out = [];

      function when(gap) {
        return gap <= 0 ? 'מתחיל עכשיו' : 'בעוד ' + gap + ' דק׳';
      }

      Store.data.events.forEach(function (e) {
        if (e.date !== t || !e.start) return;
        var gap = timeToMinutes(e.start) - mins;
        if (gap < 0 || gap > lead) return;
        out.push({
          id: e.id,
          title: 'פגישה ' + when(gap),
          body: e.title + ' · ' + e.start + (e.location ? ' · ' + e.location : '')
        });
      });

      Store.data.tasks.forEach(function (x) {
        // הושלם and בוטל are both closed — neither deserves a reminder
        if (isClosed(x.status) || x.due !== t || !x.time) return;
        var gap = timeToMinutes(x.time) - mins;
        if (gap < 0 || gap > lead) return;
        out.push({
          id: x.id,
          title: 'משימה ' + when(gap),
          body: x.title + ' · ' + x.time
        });
      });

      return out;
    },

    tick: function () {
      if (!this.armed()) return;

      var t = todayISO();
      var fired = Store.data.prefs.fired;
      var dirty = false;

      // yesterday's marks are dead weight — a record may legitimately repeat
      Object.keys(fired).forEach(function (k) {
        if (k.slice(-10) !== t) { delete fired[k]; dirty = true; }
      });

      var self = this;
      this.due().forEach(function (item) {
        var key = item.id + '@' + t;
        if (fired[key]) return;
        fired[key] = 1;
        dirty = true;
        self.show(key, item.title, item.body);
      });

      if (dirty) Store.save();
    },

    /**
     * Web-push subscription hook. Wire a VAPID public key here once a push
     * server exists; the service worker already handles the delivered event.
     */
    subscribe: function (publicKey) {
      if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return Promise.resolve(null);
      }
      var raw = window.atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      });
    },

    init: function () {
      this.paint();
      var self = this;

      var btn = $('#pushBtn');
      if (btn) btn.addEventListener('click', function () { self.onToggle(); });

      clearInterval(this.timer);
      this.timer = setInterval(function () { self.tick(); }, SCAN_MS);

      // a phone that wakes from sleep skipped every interval in between
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { self.paint(); self.tick(); }
      });

      this.tick();
    }
  };

  /* ------------------------------------------------------------- delegation */

  function onClick(e) {
    var el = e.target.closest ? e.target.closest(
      '[data-nav],[data-action],[data-type],[data-filter],[data-cat],[data-toggle],[data-del],' +
      '[data-calview],[data-calnav],[data-calslot],' +
      '[data-tasktab],[data-cycle],[data-subtask],[data-listitem],[data-pin],[data-convert],' +
      '[data-clientfilter],[data-clientopen],[data-clienttab],[data-contact],[data-clientadd],' +
      '[data-nextaction],[data-clientnote],[data-clientnotedel],[data-undo]') : null;
    if (!el) return;

    // one light pulse for every control in the app — button taps, tab switches
    // and status toggles all come through this one delegate
    Haptics.light();

    if (el.dataset.undo) {
      var back = Undo.fire();
      hideToast();
      if (back) { render(); toast(back.label + ' שוחזר'); }
      return;
    }

    if (el.dataset.action === 'master-add') { openTypeSheet(); return; }
    if (el.dataset.action === 'close-sheet') { closeSheets(); return; }
    if (el.dataset.action === 'close-drawer') { closeSheets(); return; }
    if (el.dataset.type) { openForm(el.dataset.type); return; }
    if (el.dataset.filter) { setFilter(el.dataset.filter); return; }
    if (el.dataset.cat) { setFormCat(el.dataset.cat); return; }

    if (el.dataset.calview) { Cal.setView(el.dataset.calview); return; }
    if (el.dataset.calnav) { Cal.nav(el.dataset.calnav); return; }

    if (el.dataset.calslot) {
      var slot = el.dataset.calslot.split('|');
      openTypeSheet({ date: slot[0], start: slot[1] || '' });
      return;
    }

    if (el.dataset.tasktab) { setTaskTab(el.dataset.tasktab); return; }

    /* ---------- client CRM ---------- */

    if (el.dataset.clientfilter) { setClientTab(el.dataset.clientfilter); return; }
    if (el.dataset.clientopen) { Drawer.open(el.dataset.clientopen); return; }
    if (el.dataset.clienttab) { Drawer.setTab(el.dataset.clienttab); return; }

    if (el.dataset.clientadd) {
      var ap = el.dataset.clientadd.split(':');
      openForm(ap[0], { clientId: ap[1] });
      return;
    }

    if (el.dataset.contact) {
      var chp = el.dataset.contact.split(':');
      var chc = Store.find('clients', chp[1]);
      if (chc) {
        markContact(chc, chp[0]);
        Store.save();
        // repaint only AFTER the browser has followed tel:/wa.me — pulling the
        // anchor out mid-dispatch cancels the navigation on some mobile browsers
        setTimeout(function () { Patch.apply('clients', chp[1]); }, 0);
      }
      return;                                   // never preventDefault: the OS owns the link
    }

    if (el.dataset.nextaction) {
      var nac = Store.find('clients', el.dataset.nextaction);
      var panel = el.closest('.dr-next');
      if (nac && panel) {
        var txt = panel.querySelector('[name="nextAction"]');
        var when = panel.querySelector('[name="nextActionAt"]');
        setClientNextAction(nac, txt ? txt.value : '', when ? when.value : '');
        Store.save();
        Patch.apply('clients', nac.id);
        toast(clientNeedsAction(nac) ? 'הפעולה הבאה נמחקה' : 'הפעולה הבאה עודכנה');
      }
      return;
    }

    if (el.dataset.clientnote) {
      var cnc = Store.find('clients', el.dataset.clientnote);
      var box = el.closest('.dr-compose');
      var area = box ? box.querySelector('textarea') : null;
      if (cnc && area) {
        if (!addClientNote(cnc, area.value)) { warn('הפתק ריק'); return; }
        area.value = '';
        Store.save();
        Patch.apply('clients', cnc.id);
        toast('הפתק נוסף לתיק');
      }
      return;
    }

    if (el.dataset.clientnotedel) {
      var dnp = el.dataset.clientnotedel.split(':');
      var goneNote = softDeleteClientNote(dnp[0], dnp[1]);
      if (goneNote) {
        render();
        toast(goneNote.label + ' נמחק', UNDO_LABEL);
      }
      return;
    }

    if (el.dataset.nav) { setView(el.dataset.nav); return; }

    if (el.dataset.toggle) {
      var t = Store.find('tasks', el.dataset.toggle);
      if (t) {
        toggleTaskDone(t);
        Store.save();
        if (t.done) Haptics.done();           // a second beat: this one is finished
        Patch.apply('tasks', t.id);
        toast(t.done ? 'המשימה הושלמה ✓' : 'המשימה חזרה ל' + STATUS_LABEL[t.status]);
      }
      return;
    }

    if (el.dataset.cycle) {
      var ct = Store.find('tasks', el.dataset.cycle);
      if (ct) {
        setTaskStatus(ct, nextStatus(ct.status));
        Store.save();
        Patch.apply('tasks', ct.id);
        toast('סטטוס: ' + STATUS_LABEL[ct.status]);
      }
      return;
    }

    if (el.dataset.subtask) {
      var sp = el.dataset.subtask.split(':');
      var st = Store.find('tasks', sp[0]);
      if (st) {
        var sprog = toggleItem(st.subtasks, sp[1]);
        // a checklist that just filled up completes its task in one move
        if (sprog.total && sprog.done === sprog.total && !isClosed(st.status)) {
          setTaskStatus(st, 'done');
          Haptics.done();
          toast('כל תת־המשימות הושלמו — המשימה נסגרה');
        } else {
          st.updatedAt = Date.now();
        }
        Store.save();
        Patch.apply('tasks', st.id);
      }
      return;
    }

    if (el.dataset.listitem) {
      var lp = el.dataset.listitem.split(':');
      var lst = Store.find('lists', lp[0]);
      if (lst) {
        var lprog = toggleItem(lst.items, lp[1]);
        lst.updatedAt = Date.now();
        Store.save();
        Patch.apply('lists', lst.id);
        if (lprog.total && lprog.done === lprog.total) {
          Haptics.done();
          toast('הרשימה הושלמה 🎉');
        }
      }
      return;
    }

    if (el.dataset.pin) {
      var note = Store.find('notes', el.dataset.pin);
      if (note) {
        note.pinned = !note.pinned;
        note.updatedAt = Date.now();
        Store.save();
        Patch.apply('notes', note.id);
        toast(note.pinned ? 'הפתק הוצמד למעלה' : 'ההצמדה בוטלה');
      }
      return;
    }

    if (el.dataset.convert) {
      var cp = el.dataset.convert.split(':');
      var src = Store.find('notes', cp[1]);
      if (src) {
        if (cp[0] === 'task') Store.add('tasks', noteToTask(src));
        else Store.add('events', noteToEvent(src));
        Store.remove('notes', src.id);
        render();
        toast(cp[0] === 'task' ? 'הפתק הפך למשימה' : 'הפתק הפך לאירוע');
      }
      return;
    }

    if (el.dataset.del) {
      var parts = el.dataset.del.split(':');
      var gone = softDelete(parts[0], parts[1]);
      if (gone) {
        render();                              // the row is leaving — membership moved
        toast(gone.label + ' נמחק', UNDO_LABEL);
      }
      return;
    }
  }

  /** the only <select> that mutates the store outside a form submit */
  function onChange(e) {
    var el = e.target;
    if (!el || !el.dataset || !el.dataset.clientstatus) return;
    var c = Store.find('clients', el.dataset.clientstatus);
    if (!c) return;
    Haptics.light();
    setClientStatus(c, el.value);
    Store.save();
    Patch.apply('clients', c.id);
    toast('סטטוס: ' + CLIENT_STATUS_LABEL[normClientStatus(c.status)]);
  }

  /* -------------------------------------------------------------- bootstrap */

  function init() {
    Store.load();
    Cal.init();
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    $('#entityForm').addEventListener('submit', submitForm);
    $('#backdrop').addEventListener('click', closeSheets);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheets();
    });
    setFilter(Store.data.prefs.filter);
    setView('today');
    registerServiceWorker();
    Notify.init();
    Sync.init();
    GCal.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // exposed for healthcheck.js / future D1 migration tooling
  window.APP = {
    Store: Store, isoDate: isoDate, plural: plural, normCat: normCat,
    STORE_KEY: STORE_KEY, Notify: Notify, Cal: Cal,

    // premium UX layer (Sprint 7) — haptics, the undo safety net and the
    // targeted-patch engine. All three are pure enough for healthcheck.js to
    // drive with no DOM, no vibration motor and no network.
    ui: {
      HAPTIC_LIGHT: HAPTIC_LIGHT,
      HAPTIC_DONE: HAPTIC_DONE,
      TOAST_MS: TOAST_MS,
      UNDO_MS: UNDO_MS,
      UNDO_LABEL: UNDO_LABEL,
      DELETED_LABEL: DELETED_LABEL,
      Haptics: Haptics,
      Undo: Undo,
      Patch: Patch,
      SECTIONS: SECTIONS,
      softDelete: softDelete,
      softDeleteClientNote: softDeleteClientNote,
      recKeys: recKeys,
      sameKeys: sameKeys,
      shownTasks: shownTasks,
      shownLists: shownLists,
      shownNotes: shownNotes,
      shownClients: shownClients
    },

    // cloud sync engine — schema, serialisers, outbox and merge, all pure
    // enough for healthcheck.js to drive without a network or a DOM
    sync: {
      TABLES: SYNC_TABLES,
      SCHEMA: SYNC_SCHEMA,
      STATES: SYNC_STATES,
      LABEL: SYNC_LABEL,
      ENDPOINT: SYNC_ENDPOINT,
      Sync: Sync,
      blankSync: blankSync,
      normSync: normSync,
      toRow: toRow,
      fromRow: fromRow,
      toISOStamp: toISOStamp,
      fromISOStamp: fromISOStamp,
      joinStamp: joinStamp,
      splitStamp: splitStamp,
      validRow: validRow,
      validOp: validOp
    },

    // Google Calendar bridge (Sprint 6) — the client half is pure enough for
    // healthcheck.js to drive without a network, a DOM or an OAuth token
    gcal: {
      ENDPOINT: GCAL_ENDPOINT,
      STATES: GCAL_STATES,
      LABEL: GCAL_LABEL,
      SYNC_PREFIX: GCAL_SYNC_PREFIX,
      GCal: GCal,
      blankGCal: blankGCal,
      normGCal: normGCal
    },

    // pure tasks / lists / notes engine — the healthcheck drives it directly
    tasks: {
      STATUSES: TASK_STATUSES,
      STATUS_LABEL: STATUS_LABEL,
      STATUS_CYCLE: STATUS_CYCLE,
      PRIORITIES: PRIORITIES,
      PRIORITY_LABEL: PRIORITY_LABEL,
      TABS: TASK_TABS,
      normStatus: normStatus,
      normPriority: normPriority,
      isClosed: isClosed,
      migrateTask: migrateTask,
      setTaskStatus: setTaskStatus,
      toggleTaskDone: toggleTaskDone,
      nextStatus: nextStatus,
      subtaskProgress: subtaskProgress,
      taskMatchesTab: taskMatchesTab,
      sortTasks: sortTasks
    },

    lists: {
      migrateList: migrateList,
      normItems: normItems,
      parseChecklist: parseChecklist,
      listProgress: listProgress,
      progressOf: progressOf,
      toggleItem: toggleItem
    },

    notes: {
      migrateNote: migrateNote,
      sortNotes: sortNotes,
      noteToTask: noteToTask,
      noteToEvent: noteToEvent
    },

    // pure client CRM — statuses, the Next-Action alert engine and every
    // drawer tab builder, all executable head-lessly by the healthcheck
    clients: {
      STATUSES: CLIENT_STATUSES,
      STATUS_LABEL: CLIENT_STATUS_LABEL,
      CLOSED: CLIENT_CLOSED,
      TABS: CLIENT_TABS,
      TAB_STATUSES: CLIENT_TAB_STATUSES,
      DRAWER_TABS: DRAWER_TABS,
      DRAWER_TAB_LABEL: DRAWER_TAB_LABEL,
      NO_ACTION_BADGE: NO_ACTION_BADGE,
      normClientStatus: normClientStatus,
      migrateClient: migrateClient,
      clientClosed: clientClosed,
      clientNeedsAction: clientNeedsAction,
      clientMatchesTab: clientMatchesTab,
      sortClients: sortClients,
      setClientStatus: setClientStatus,
      setClientNextAction: setClientNextAction,
      addClientNote: addClientNote,
      markContact: markContact,
      logHistory: logHistory,
      telHref: telHref,
      waHref: waHref,
      waNumber: waNumber,
      clientCard: clientCard,
      drawerTabHTML: drawerTabHTML
    },

    // pure date math — no DOM, no store; the healthcheck exercises it directly
    dates: {
      isoDate: isoDate,
      parseISO: parseISO,
      addDaysISO: addDaysISO,
      addMonthsISO: addMonthsISO,
      startOfMonthISO: startOfMonthISO,
      startOfWeekISO: startOfWeekISO,
      weekDays: weekDays,
      monthMatrix: monthMatrix,
      agendaRange: agendaRange,
      daysInMonth: daysInMonth,
      minutesOf: minutesOf,
      shiftTime: shiftTime,
      layoutBlocks: layoutBlocks
    }
  };

})();
