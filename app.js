/* ==========================================================================
   Unified Personal & Business Productivity Center
   Sprint 1 — shell, "My Day" dashboard, Master Add, localStorage engine.
   Sprint 2 — PWA install shell, service worker, notifications engine.

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

  var HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  /* ------------------------------------------------------------- utilities */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

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

  function hebDate(iso) {
    var d = parseISO(iso);
    if (!d) return '';
    return 'יום ' + HE_DAYS[d.getDay()] + ', ' + d.getDate() + ' ב' + HE_MONTHS[d.getMonth()];
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

  /* ------------------------------------------------------------------ store */

  var Store = {
    data: null,

    blank: function () {
      return {
        version: 1,
        owner: OWNER,
        prefs: { filter: 'all', notify: { on: false, lead: 10 }, fired: {} },
        events: [], tasks: [], lists: [], notes: [], clients: [],
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
          return r;
        });
      });
      if (['all', 'personal', 'business'].indexOf(d.prefs.filter) === -1) d.prefs.filter = 'all';

      // reminder prefs may be absent in a store written before the PWA upgrade
      if (!d.prefs.notify || typeof d.prefs.notify !== 'object') d.prefs.notify = { on: false, lead: 10 };
      d.prefs.notify.on = !!d.prefs.notify.on;
      if (typeof d.prefs.notify.lead !== 'number' || d.prefs.notify.lead < 0) d.prefs.notify.lead = 10;
      if (!d.prefs.fired || typeof d.prefs.fired !== 'object') d.prefs.fired = {};

      this.data = d;
      if (!d.seeded) { this.seed(); }
      return d;
    },

    save: function () {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
      } catch (e) { /* quota or private mode — the in-memory session still works */ }
    },

    /** first-run sample content so the dashboard is not born empty */
    seed: function () {
      var t = todayISO();
      var d = this.data;
      d.events.push(
        this.stamp({ type: 'event', title: 'פגישת היכרות — לקוח חדש', category: 'business', date: t, start: '10:00', end: '11:00', location: 'זום', notes: '' }),
        this.stamp({ type: 'event', title: 'אימון כושר', category: 'personal', date: t, start: '18:30', end: '19:30', location: '', notes: '' })
      );
      d.tasks.push(
        this.stamp({ type: 'task', title: 'להכין הצעת מחיר', category: 'business', due: t, time: '', done: false, notes: '' }),
        this.stamp({ type: 'task', title: 'לקנות מתנה ליום הולדת', category: 'personal', due: t, time: '', done: false, notes: '' }),
        this.stamp({ type: 'task', title: 'לשלוח חוזה חתום', category: 'business', due: addDaysISO(t, -2), time: '', done: false, notes: '' })
      );
      d.clients.push(
        this.stamp({ type: 'client', name: 'דנה כהן', category: 'business', phone: '', email: '', followUpAt: t, nextAction: 'לחזור אליה עם הצעת מחיר', notes: '' })
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

    add: function (collection, rec) {
      this.data[collection].push(this.stamp(rec));
      this.save();
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

  function tasksDueToday() {
    var t = todayISO();
    return pick('tasks').filter(function (x) { return !x.done && x.due === t; });
  }

  function unscheduledToday() {
    return tasksDueToday().filter(function (x) { return !hourOf(x.time) && hourOf(x.time) !== 0; });
  }

  function overdueTasks() {
    var t = todayISO();
    return pick('tasks').filter(function (x) { return !x.done && x.due && x.due < t; });
  }

  function pendingFollowUps() {
    var t = todayISO();
    return pick('clients').filter(function (c) { return c.followUpAt && c.followUpAt <= t; });
  }

  /* ----------------------------------------------------------- render: shell */

  function setView(view) {
    UI.view = view;
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + view); });
    $$('[data-nav]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.nav === view); });
    $('#viewTitle').textContent =
      ({ today: 'היום שלי', calendar: 'יומן', tasks: 'משימות ורשימות', clients: 'לקוחות' })[view] || '';
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
      '<span class="chip">פתוחות: <b>' + pick('tasks').filter(function (x) { return !x.done; }).length + '</b></span>'
    ].join('');
  }

  /* --------------------------------------------- render: 4. attention cards */

  function renderAttention() {
    var late = overdueTasks().length;
    var follow = pendingFollowUps().length;

    $('#attentionCards').innerHTML =
      attCard(late, 'משימות באיחור', late ? 'דורש טיפול מיידי' : 'הכול בזמן', late ? 'is-hot' : 'is-calm', 'tasks') +
      attCard(follow, 'מעקבי לקוחות', follow ? 'ממתין לחזרה שלך' : 'אין מעקבים פתוחים', follow ? 'is-warn' : 'is-calm', 'clients');
  }

  function attCard(num, label, hint, cls, nav) {
    return '<button type="button" class="att ' + cls + '" data-nav="' + nav + '">' +
      '<span class="att-num">' + num + '</span>' +
      '<span class="att-label">' + esc(label) + '</span>' +
      '<span class="att-hint">' + esc(hint) + '</span>' +
      '</button>';
  }

  /* ------------------------------------------------- render: 2. day timeline */

  function renderTimeline() {
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

    $('#timeline').innerHTML = rows.join('');
    $('#timelineMeta').textContent = events.length
      ? plural(events.length, 'אירוע אחד', 'אירועים') + ' · ' + pad2(DAY_START) + ':00–' + pad2(DAY_END) + ':00'
      : 'אין אירועים מתוזמנים';
  }

  function eventCard(e) {
    var when = e.start ? (e.start + (e.end ? '–' + e.end : '')) : 'ללא שעה';
    var meta = [when, e.location].filter(Boolean).join(' · ');
    return '<div class="ev ev-' + e.category + '">' +
      '<div class="ev-body">' +
      '<div class="ev-title">' + esc(e.title) + '</div>' +
      '<div class="ev-meta">' + esc(meta) + '</div>' +
      '</div>' +
      catTag(e.category) +
      delBtn('events', e.id) +
      '</div>';
  }

  /* ------------------------------------------- render: 3. unscheduled to-do */

  function renderTodo() {
    var list = unscheduledToday();
    $('#todoToday').innerHTML = list.length
      ? list.map(function (t) { return taskRow(t); }).join('')
      : emptyState('אין משימות פתוחות להיום', 'כל מה שתייעד להיום ללא שעה מסוימת יופיע כאן.');
    $('#todoMeta').textContent = list.length ? plural(list.length, 'משימה אחת', 'משימות') : '';
  }

  function taskRow(t) {
    var late = !t.done && t.due && t.due < todayISO();
    var meta = [];
    if (t.due) meta.push((late ? 'באיחור · ' : '') + relDay(t.due));
    if (t.time) meta.push(t.time);
    if (t.notes) meta.push(t.notes);

    return '<div class="row' + (t.done ? ' is-done' : '') + (late ? ' is-late' : '') + '">' +
      '<button type="button" class="check-tap" data-toggle="' + t.id + '" aria-label="סימון כבוצע">' +
      '<span class="check">' + (t.done ? '✓' : '') + '</span></button>' +
      '<div class="row-body">' +
      '<div class="row-title">' + esc(t.title) + '</div>' +
      '<div class="row-meta">' + catTag(t.category) + esc(meta.join(' · ')) + '</div>' +
      '</div>' +
      delBtn('tasks', t.id) +
      '</div>';
  }

  /* ------------------------------------------------------- render: calendar */

  function renderCalendar() {
    var t = todayISO();
    var upcoming = pick('events')
      .filter(function (e) { return e.date >= t; })
      .sort(function (a, b) {
        return a.date === b.date
          ? timeToMinutes(a.start) - timeToMinutes(b.start)
          : (a.date < b.date ? -1 : 1);
      });

    if (!upcoming.length) {
      $('#calendarList').innerHTML =
        '<div class="card">' + emptyState('היומן פנוי', 'הוסף אירוע או פגישה בעזרת כפתור ההוספה.') + '</div>';
      $('#calendarMeta').textContent = '';
      return;
    }

    var groups = {}, order = [];
    upcoming.forEach(function (e) {
      if (!groups[e.date]) { groups[e.date] = []; order.push(e.date); }
      groups[e.date].push(e);
    });

    $('#calendarList').innerHTML = order.map(function (date) {
      return '<div class="day-group">' +
        '<div class="day-head"><span>' + esc(relDay(date)) + '</span>' +
        '<span class="day-count">' + plural(groups[date].length, 'אירוע אחד', 'אירועים') + '</span></div>' +
        '<div class="card" style="padding:8px 10px">' + groups[date].map(eventCard).join('') + '</div>' +
        '</div>';
    }).join('');

    $('#calendarMeta').textContent = plural(upcoming.length, 'אירוע אחד', 'אירועים');
  }

  /* ---------------------------------------------- render: tasks / lists / notes */

  function renderTasks() {
    var all = pick('tasks').slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
    });

    $('#tasksList').innerHTML = all.length
      ? all.map(function (t) { return taskRow(t); }).join('')
      : emptyState('אין משימות', 'כל משימה שתוסיף תופיע כאן, מסודרת לפי תאריך יעד.');
    $('#tasksMeta').textContent = all.length
      ? all.filter(function (t) { return !t.done; }).length + ' פתוחות מתוך ' + all.length
      : '';

    var lists = pick('lists'), notes = pick('notes');
    var html = lists.map(listRow).join('') + notes.map(noteRow).join('');
    $('#notesList').innerHTML = html || emptyState('אין רשימות או פתקים', 'רשימות קניות, צ׳ק־ליסטים ופתקים מהירים — הכול כאן.');
  }

  function listRow(l) {
    var items = Array.isArray(l.items) ? l.items : [];
    return '<div class="row">' +
      '<div class="row-body">' +
      '<div class="row-title">☰ ' + esc(l.title) + '</div>' +
      '<div class="row-meta">' + catTag(l.category) +
      (items.length ? esc(items.length + ' פריטים · ' + items.slice(0, 3).join(', ')) : 'רשימה ריקה') +
      '</div></div>' +
      delBtn('lists', l.id) +
      '</div>';
  }

  function noteRow(n) {
    return '<div class="row">' +
      '<div class="row-body">' +
      '<div class="row-title">✎ ' + esc(n.title || 'פתק') + '</div>' +
      '<div class="row-meta">' + catTag(n.category) + esc((n.body || '').slice(0, 90)) + '</div>' +
      '</div>' +
      delBtn('notes', n.id) +
      '</div>';
  }

  /* -------------------------------------------------------- render: clients */

  function renderClients() {
    var t = todayISO();
    var all = pick('clients').slice().sort(function (a, b) {
      return (a.followUpAt || '9999') < (b.followUpAt || '9999') ? -1 : 1;
    });

    $('#clientsList').innerHTML = all.length
      ? all.map(function (c) {
        var due = c.followUpAt && c.followUpAt <= t;
        var meta = [];
        if (c.followUpAt) meta.push('מעקב: ' + relDay(c.followUpAt));
        if (c.nextAction) meta.push('הצעד הבא: ' + c.nextAction);
        if (c.phone) meta.push(c.phone);
        return '<div class="row' + (due ? ' is-late' : '') + '">' +
          '<div class="row-body">' +
          '<div class="row-title">' + esc(c.name) + '</div>' +
          '<div class="row-meta">' + catTag(c.category) + esc(meta.join(' · ')) + '</div>' +
          '</div>' +
          delBtn('clients', c.id) +
          '</div>';
      }).join('')
      : emptyState('אין לקוחות עדיין', 'הוסף לקוח כדי לנהל מעקבים וצעדים הבאים.');

    $('#clientsMeta').textContent = all.length
      ? all.length + ' לקוחות · ' + pendingFollowUps().length + ' במעקב'
      : '';
  }

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

  function render() {
    renderSummary();
    renderAttention();
    renderTimeline();
    renderTodo();
    renderCalendar();
    renderTasks();
    renderClients();
    $('#todayLabel').textContent = hebDate(todayISO());
    $('#railUserName').textContent = OWNER.name;
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
    document.body.style.overflow = '';
  }

  function openTypeSheet() {
    $('#formSheet').hidden = true;
    openSheet('typeSheet');
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
        f('notes', 'הערות', '<textarea class="textarea" name="notes" placeholder="פרטים נוספים…"></textarea>');
    },
    task: function () {
      return f('title', 'מה צריך לעשות?', '<input class="input" name="title" placeholder="לשלוח הצעת מחיר…" required>') +
        '<div class="field-row">' +
        f('due', 'תאריך יעד', '<input class="input" type="date" name="due" value="' + todayISO() + '">') +
        f('time', 'שעה (לא חובה)', '<input class="input" type="time" name="time">') +
        '</div>' +
        f('notes', 'הערות', '<textarea class="textarea" name="notes"></textarea>');
    },
    list: function () {
      return f('title', 'שם הרשימה', '<input class="input" name="title" placeholder="קניות לשבת…" required>') +
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
        f('nextAction', 'הצעד הבא', '<input class="input" name="nextAction" placeholder="לחזור עם הצעת מחיר">') +
        f('followUpAt', 'תאריך מעקב', '<input class="input" type="date" name="followUpAt" value="' + addDaysISO(todayISO(), 3) + '">') +
        f('notes', 'הערות', '<textarea class="textarea" name="notes"></textarea>');
    }
  };

  function f(name, label, control) {
    return '<div class="field"><label class="field-label" for="fld_' + name + '">' + label + '</label>' +
      control.replace('<input', '<input id="fld_' + name + '"').replace('<textarea', '<textarea id="fld_' + name + '"') +
      '</div>';
  }

  function openForm(type) {
    UI.formType = type;
    UI.formCat = (type === 'client') ? 'business' : 'personal';

    $('#formSheetTitle').textContent = TYPE_LABEL[type];
    $('#formFields').innerHTML = FIELDS[type]();
    setFormCat(UI.formCat);

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
        location: v.location || '', notes: v.notes || ''
      });
      label = 'האירוע נוסף';
    } else if (type === 'task') {
      if (!v.title) return warn('צריך שם למשימה');
      Store.add('tasks', {
        type: 'task', title: v.title, category: cat,
        due: v.due || todayISO(), time: v.time || '', done: false, notes: v.notes || ''
      });
      label = 'המשימה נוספה';
    } else if (type === 'list') {
      if (!v.title) return warn('צריך שם לרשימה');
      Store.add('lists', {
        type: 'list', title: v.title, category: cat,
        items: (v.items || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean)
      });
      label = 'הרשימה נוספה';
    } else if (type === 'note') {
      if (!v.body) return warn('הפתק ריק');
      Store.add('notes', {
        type: 'note', title: v.title || 'פתק', category: cat, body: v.body
      });
      label = 'הפתק נשמר';
    } else if (type === 'client') {
      if (!v.name) return warn('צריך שם ללקוח');
      Store.add('clients', {
        type: 'client', name: v.name, category: cat,
        phone: v.phone || '', email: v.email || '',
        nextAction: v.nextAction || '', followUpAt: v.followUpAt || '', notes: v.notes || ''
      });
      label = 'הלקוח נוסף';
    }

    closeSheets();
    render();
    toast(label + ' · ' + CAT_LABEL[cat]);
  }

  /* ----------------------------------------------------------------- toast */

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
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
        if (x.done || x.due !== t || !x.time) return;
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
    var el = e.target.closest ? e.target.closest('[data-nav],[data-action],[data-type],[data-filter],[data-cat],[data-toggle],[data-del]') : null;
    if (!el) return;

    if (el.dataset.action === 'master-add') { openTypeSheet(); return; }
    if (el.dataset.action === 'close-sheet') { closeSheets(); return; }
    if (el.dataset.type) { openForm(el.dataset.type); return; }
    if (el.dataset.filter) { setFilter(el.dataset.filter); return; }
    if (el.dataset.cat) { setFormCat(el.dataset.cat); return; }
    if (el.dataset.nav) { setView(el.dataset.nav); return; }

    if (el.dataset.toggle) {
      var t = Store.find('tasks', el.dataset.toggle);
      if (t) { t.done = !t.done; t.updatedAt = Date.now(); Store.save(); render(); }
      return;
    }

    if (el.dataset.del) {
      var parts = el.dataset.del.split(':');
      Store.remove(parts[0], parts[1]);
      render();
      toast('נמחק');
      return;
    }
  }

  /* -------------------------------------------------------------- bootstrap */

  function init() {
    Store.load();
    document.addEventListener('click', onClick);
    $('#entityForm').addEventListener('submit', submitForm);
    $('#backdrop').addEventListener('click', closeSheets);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheets();
    });
    setFilter(Store.data.prefs.filter);
    setView('today');
    registerServiceWorker();
    Notify.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // exposed for healthcheck.js / future D1 migration tooling
  window.APP = {
    Store: Store, isoDate: isoDate, plural: plural, normCat: normCat,
    STORE_KEY: STORE_KEY, Notify: Notify
  };

})();
