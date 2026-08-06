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

  /**
   * The task views (Sprint 10).
   *
   * Field report: "פתוחות: 3" on My Day while the board underneath was empty.
   * Both statements were true — the counter counts every open task, the board
   * only ever showed today's — and a task with a future date or no date at all
   * had nowhere on screen it could be found. היום / בקרוב / נכנסים / הכל is
   * that place: every open task in the store belongs to exactly one of the
   * first three, and הכל is the union that proves it.
   */
  var TASK_TABS = ['all', 'today', 'upcoming', 'inbox', 'late', 'waiting', 'done'];
  var TASK_TAB_EMPTY = {
    all: 'כל משימה שתוסיף תופיע כאן, מסודרת לפי תאריך יעד ועדיפות.',
    today: 'אין משימה פתוחה שתאריך היעד שלה הוא היום.',
    upcoming: 'אין משימות עתידיות — כל מה שמתוזמן כבר על הלוח של היום.',
    inbox: 'תיבת הנכנסים ריקה. כל משימה שתיצור בלי תאריך יעד תחכה כאן.',
    late: 'שום דבר לא נשאר מאחור — אין משימות באיחור.',
    waiting: 'אין משימה שממתינה כרגע לחזרה של לקוח.',
    done: 'עוד לא סומנה כאן משימה כהושלמה.'
  };
  var TASK_TAB_LABEL = {
    all: 'הכל', today: 'היום', upcoming: 'בקרוב', inbox: 'נכנסים',
    late: 'באיחור', waiting: 'ממתין', done: 'הושלם'
  };

  /** the horizon of "משימות קרובות" on My Day — seven days, inclusive of today+1 */
  var UPCOMING_DAYS = 7;

  /**
   * The three workspaces of the משימות screen (Sprint 10). פתקים ורשימות is a
   * destination of its own now, not two blocks stacked below the task list.
   */
  var WORK_TABS = ['tasks', 'lists', 'notes'];
  var WORK_LABEL = { tasks: '✓ משימות', lists: '☰ רשימות', notes: '✎ פתקים' };
  var WORK_TITLE = {
    tasks: 'משימות', lists: 'רשימות וצ׳ק־ליסטים', notes: 'פתקים ורשימות'
  };

  /* --- reminders (Sprint 10) ---
     Per-record lead time. 'default' defers to prefs.notify.lead, which is what
     every record written before this sprint carries; 'none' mutes that one
     record without touching the global toggle. Never '' — the column is
     preserve-if-blank on the Worker side, so a blank would read as "no opinion"
     and could never clear a choice. */
  var REMIND_OPTIONS = ['default', 'at', '15', '60', '1440', 'none'];
  var REMIND_DEFAULT = 'default';
  var REMIND_MINUTES = { at: 0, '15': 15, '60': 60, '1440': 1440 };
  var REMIND_LABEL = {
    'default': 'ברירת מחדל של המערכת',
    at: 'בזמן האירוע',
    '15': '15 דקות לפני',
    '60': 'שעה לפני',
    '1440': 'יום לפני',
    none: 'ללא התראה'
  };
  var REMIND_SHORT = {
    'default': '', at: '🔔 בזמן', '15': '🔔 15 דק׳ לפני',
    '60': '🔔 שעה לפני', '1440': '🔔 יום לפני', none: '🔕 ללא התראה'
  };

  /* --- multiple reminders per record (Sprint 12 · mandate §1) ---------------
     One record may now carry SEVERAL reminders at once — "יום לפני" *and*
     "בזמן האירוע", plus any number of absolute wall-clock reminders that have
     nothing to do with the record's own start time.

     The stored shape is a TOKEN LIST. A token is either

       a built-in lead     'default' | 'at' | '15' | '60' | '1440'
       an absolute moment  '@YYYY-MM-DDTHH:MM'

     An EMPTY list is the muted state — the array form of the old 'none'.

     The list serialises to the SAME remind_key column, comma-joined, so no
     column was added and the Worker's preserve-if-blank rule still holds: the
     client never sends '', it sends 'none' or 'default' or a real list. A
     store or a row written before this sprint holds a single bare key, which
     normRemindList() reads as a one-token list — every pre-Sprint-12 record
     keeps the exact behaviour it already had. */
  var REMIND_BUILTIN = ['at', '15', '60', '1440'];      // the multi-select boxes, in mandate order
  var REMIND_MULTI = ['default'].concat(REMIND_BUILTIN);
  /* The order a LIST is stored and read in — chronological, not the order the
     checkboxes are drawn in. "יום לפני · שעה לפני · בזמן האירוע" is the order
     those three reminders actually arrive, which is the only order the detail
     reader can list them in without lying about what happens when. */
  var REMIND_ORDER = ['default', '1440', '60', '15', 'at'];
  var REMIND_CUSTOM_PREFIX = '@';
  var REMIND_CUSTOM_RE = /^@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  /** a ceiling, so a stuck "+ הוסף" cannot grow a record without bound */
  var REMIND_MAX = 12;
  var REMIND_ON_LABEL = '🔔 עם התראה';
  var REMIND_OFF_LABEL = '🔕 ללא התראה';

  /* the reminder chime — synthesised, so it needs no binary asset in the cache */
  var CHIME_TONES = [880, 1174.66];   // A5 → D6, a two-note bell
  var CHIME_STEP = 0.16;              // seconds between the two notes
  var CHIME_TAIL = 0.55;              // seconds each note takes to die away
  /* every gesture type that counts as "the user touched the page" for the
     autoplay policy — the AudioContext is unlocked from the first of them */
  var CHIME_GESTURES = ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'];

  /* ==========================================================================
     The dual-sound engine (Sprint 13 · mandate §3–§4)

     Two families, because they answer two different questions:

       a SHORT tone   — "something wants you" (a task, a heads-up). Under a
                        second, so it can fire while you are mid-sentence.
       a LONG ring    — "answer me" (~10 seconds, a phone ringing on a desk).
                        It repeats a motif until the ceiling and can be stopped.

     Both are SYNTHESISED, for the same reason the Sprint-10 chime was: an .mp3
     would be a binary in the service-worker shell, a second thing to
     cache-bust, and a 404 away from silence. A voice is a small declarative
     spec — the frequencies, the spacing, the decay — and Chime.voice() renders
     any of them through the one oscillator path that already exists.
     ========================================================================== */

  /** the SHORT presets. `bell` is the Sprint-10 two-note chime, unchanged. */
  var SHORT_SOUNDS = {
    bell:  { label: 'פעמון (ברירת מחדל)', tones: CHIME_TONES,                     step: CHIME_STEP, tail: CHIME_TAIL, peak: 0.22 },
    chime: { label: 'ג׳ינגל עולה',        tones: [659.25, 783.99, 987.77],        step: 0.12,       tail: 0.42,       peak: 0.20 },
    ping:  { label: 'נקישה קצרה',          tones: [1318.51],                       step: 0.10,       tail: 0.22,       peak: 0.18 },
    soft:  { label: 'רך ונמוך',            tones: [392, 523.25],                   step: 0.20,       tail: 0.70,       peak: 0.24 }
  };
  var SHORT_DEFAULT = 'bell';

  /** the LONG presets — one motif, repeated on `cycle` seconds until LONG_MS */
  var LONG_RINGS = {
    classic: { label: 'צלצול קלאסי (ברירת מחדל)', tones: [880, 1174.66],                  step: 0.16, tail: 0.50, cycle: 1.25, peak: 0.26 },
    pulse:   { label: 'פעימות',                     tones: [740],                           step: 0.18, tail: 0.30, cycle: 0.75, peak: 0.24 },
    rise:    { label: 'סולם עולה',                   tones: [523.25, 659.25, 783.99, 1046.5], step: 0.13, tail: 0.40, cycle: 1.60, peak: 0.22 }
  };
  var LONG_DEFAULT = 'classic';
  /** "~10 שניות" from the mandate, as a number both the engine and the copy use */
  var LONG_MS = 10000;
  /** ceiling on the live-oscillator list — well past one full long ring (≤24) */
  var CHIME_LIVE_MAX = 64;

  /* --- haptic patterns the user can choose between (mandate §2, §3) ---
     Distinct from the Sprint-7 HAPTIC_* constants: those are the app's own
     touch feel and are not configurable per record. These are what a REMINDER
     does to the phone, and every one of them is a real navigator.vibrate
     pattern — a single buzz, one long buzz, or a repeating burst. */
  var VIBE_KINDS = ['none', 'short', 'long', 'repeat'];
  var VIBE_LABEL = {
    none: 'ללא רטט', short: 'רטט קצר', long: 'רטט ארוך', repeat: 'רטט חוזר'
  };
  var VIBE_PATTERN = {
    none: null,
    short: [140],
    long: [650],
    repeat: [180, 120, 180, 120, 180, 120, 180]
  };
  var VIBE_DEFAULT = 'short';

  /* --- the per-record sound choice (mandate §3) ---
     [ללא] | [צליל קצר] | [צלצול ארוך (~10 שניות)] — which FAMILY this record
     announces itself with. WHICH tone inside the family is a global preference
     (the settings drawer), so a record never has to name a preset that a later
     version might not ship. */
  var ALERT_SOUNDS = ['none', 'short', 'long'];
  var ALERT_SOUND_LABEL = {
    none: 'ללא', short: 'צליל קצר', long: 'צלצול ארוך (כ־10 שניות)'
  };
  var ALERT_SOUND_DEFAULT = 'short';

  /* --- מראה ועיצוב (mandate §2d) ---
     'system' is not a third palette: it is "ask the OS", resolved through
     prefers-color-scheme at paint time and re-resolved when the OS flips. */
  var THEMES = ['dark', 'light', 'system'];
  var THEME_LABEL = { dark: '🌙 כהה', light: '☀ בהיר', system: '⚙ לפי המערכת' };
  var THEME_DEFAULT = 'dark';

  /** the shell version — MUST match CACHE_VERSION in sw.js and the ?v= in index.html */
  var APP_VERSION = 'v23';

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
      'google_event_id', 'etag', 'google_calendar_id',
      // Sprint 10 — the per-record reminder lead, appended by migration 0003
      'remind_key',
      // Sprint 13 — how this record announces itself, appended by migration 0006
      'alert_sound', 'alert_vibe'],
    tasks: ['id', 'title', 'category', 'status', 'priority', 'due_date',
      'next_action', 'subtasks_json', 'client_id', 'updated_at', 'owner_id',
      'due_time', 'notes', 'created_at', 'deleted_at',
      // Sprint 10 — appended by migration 0003, so it trails every older column
      'remind_key',
      // Sprint 13 — appended by migration 0006, trailing that in turn
      'alert_sound', 'alert_vibe'],
    lists: ['id', 'title', 'category', 'items_json', 'client_id',
      'updated_at', 'owner_id', 'list_date', 'created_at', 'deleted_at'],
    notes: ['id', 'title', 'body', 'category', 'is_pinned', 'client_id',
      'updated_at', 'owner_id', 'created_at', 'deleted_at',
      // Sprint 13 — a note carries the pair too (mandate §3 names all three types)
      'alert_sound', 'alert_vibe'],
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
    notes: 'הפתק', clients: 'הלקוח', clientNotes: 'הפתק',
    batch: 'הפריטים'
  };

  /* --- Wave 1: the floating CTA yields the screen while a finger scrolls --- */

  /** above this offset the page is "at the top" and the CTA is always offered */
  var FAB_TOP = 24;
  /** travel a single scroll event must carry before it counts as a direction */
  var FAB_DELTA = 6;

  /* --- Wave 2: confirmation before a destructive tap --- */

  var CONFIRM_QUESTION = 'האם אתה בטוח שברצונך למחוק?';
  /** the accept button's standing label — index.html ships with exactly this */
  var CONFIRM_YES = 'אישור מחיקה';
  /** ריקון הסל names the thing it destroys inside the question itself */
  var CONFIRM_EMPTY_TRASH = 'האם אתה בטוח שברצונך למחוק את סל המחזור?';

  /* --- Wave 3: multi-select, batch actions and the wider undo window --- */

  /** the collections a card can be picked from; every row carries data-rec */
  var SELECTABLE = ['events', 'tasks', 'lists', 'notes', 'clients'];
  /** losing a whole batch is a bigger loss than losing one row — hold it longer */
  var UNDO_BATCH_MS = 9000;
  var SELECT_LABEL = { off: 'בחירה מרובה', on: 'סיום בחירה' };
  /** how long a finger has to rest on a card before selection mode opens */
  var LONG_PRESS_MS = 500;
  /** a press that travels further than this is a scroll, not a long press */
  var LONG_PRESS_SLOP = 12;

  /* --- Sprint 8: the completion gesture, the recycle bin, tap-to-edit --- */

  /**
   * The dual pulse the mandate specifies for a completed task: a short beat,
   * a gap you can feel, then a second beat. Deliberately distinct from
   * HAPTIC_DONE — that one acknowledges, this one congratulates.
   */
  var HAPTIC_CHECK = [15, 30, 15];

  /**
   * How long the ✓ draws itself, the title strikes through and the card dims
   * BEFORE the record moves. Tapping the circle must not make the row vanish
   * from under the finger: the accomplishment is seen and felt, then filed.
   */
  var COMPLETE_MS = 400;

  /** and how long a card takes to collapse out of its list on the way out */
  var LEAVE_MS = 240;

  /* --- סל מחזור: the 10-day recycle bin --- */

  var DAY_MS = 86400000;
  /** a deleted record waits exactly this long before it is gone for good */
  var TRASH_DAYS = 10;
  /** what the bin calls each kind of record it is holding */
  var TRASH_LABEL = {
    events: 'אירוע', tasks: 'משימה', lists: 'רשימה', notes: 'פתק', clients: 'לקוח'
  };

  /**
   * The card types a tap on the BODY itself opens for editing. A client card is
   * deliberately absent: tapping one opens the full client file, which is a
   * richer surface than the create form and already the established gesture.
   */
  var TAP_EDIT = ['events', 'tasks', 'lists', 'notes'];

  /**
   * Sprint 12 — the two collections whose tap opens the READING view first.
   * A subset of TAP_EDIT, never a replacement for it: every card in TAP_EDIT
   * still opens on a tap, and every card still carries its own ✎ straight to
   * the form. This only decides which of the two surfaces comes up first.
   */
  var TAP_DETAIL = ['tasks', 'events'];

  /* --- Sprint 9: in-place completion and the היסטוריה archive log --- */

  /**
   * Sprint 8 filed a task the instant its 400ms gesture ended: it dimmed,
   * re-sorted, and in "לביצוע היום" left the list altogether. The finger that
   * aimed at the circle was then hovering over a different row.
   *
   * Completion is now purely a STATE, drawn where the task already stands. The
   * task leaves its list only when the user presses the archive button below —
   * one deliberate move, in batch, at a moment of their choosing.
   */
  var ARCHIVE_LABEL = 'העבר משימות שבוצעו להיסטוריה';

  /** the completed-tasks log holds a filed task exactly as long as the bin does */
  var ARCHIVE_DAYS = 10;

  /* ------------------------------------------------------------- utilities */

  /**
   * Write only when the value actually changed (Sprint 9).
   *
   * `el.innerHTML = same_string` is not a no-op: it tears down every child node
   * and builds a fresh set, which restarts their animations, drops focus and
   * costs a layout. Patch.settle() refreshes the derived surfaces on EVERY tap,
   * and most taps do not move a single one of those numbers — so the comparison
   * is what keeps the counters, the summary line and the attention strip still.
   */
  function setHTML(el, html) {
    if (el && el.innerHTML !== html) el.innerHTML = html;
    return el;
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
    return el;
  }

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

    /**
     * Sprint 13 — "רטט במגע" from the settings drawer.
     *
     * This governs the app's own TOUCH feel (every tap, every ✓) and nothing
     * else: a reminder still buzzes with whatever the record asked for, because
     * silencing the interface must never silence the notification. Defaults ON,
     * and defaults ON with no store at all — the store is loaded by init(), and
     * a pulse fired before that must not be swallowed.
     */
    touchOn: function () {
      var d = Store.data;
      return !d || !d.prefs || d.prefs.haptics !== false;
    },

    /** every button tap, tab switch and status toggle */
    light: function () {
      return Haptics.touchOn() ? Haptics.fire(HAPTIC_LIGHT) : false;
    },

    /** something completed — a task closed, a checklist filled up */
    done: function () {
      return Haptics.touchOn() ? Haptics.fire(HAPTIC_DONE) : false;
    },

    /**
     * The check circle specifically (Sprint 8): a dual pulse fired at the
     * START of the gesture, so the buzz lands with the ✓ being drawn rather
     * than after the card has already moved.
     */
    check: function () {
      return Haptics.touchOn() ? Haptics.fire(HAPTIC_CHECK) : false;
    },

    /**
     * A REMINDER's pulse (mandate §2, §3): קצר / ארוך / חוזר, or nothing.
     * Deliberately NOT gated on touchOn() — see above.
     */
    pattern: function (kind) {
      var p = VIBE_PATTERN[normVibe(kind)];
      return p ? Haptics.fire(p) : false;
    }
  };

  /* ==========================================================================
     The reminder chime (Sprint 10)

     A notification that only vibrates is a notification a phone on a desk never
     delivers. The mandate asks for a sound, and the cheapest honest way to ship
     one is to synthesise it: an .mp3 would be a tenth asset in the service-worker
     shell, a second thing to cache-bust, and a 404 away from silence. Two sine
     notes through the Web Audio API are none of those things and work offline by
     construction.

     Everything is guarded. A browser with no AudioContext, a context the
     autoplay policy has suspended, a sandbox with no window at all — each one
     returns false rather than throwing, because a reminder that cannot make a
     sound must still be a reminder.
     ========================================================================== */

  var Chime = {
    ctx: null,

    supported: function () {
      if (typeof window === 'undefined') return false;
      return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
    },

    /** on = the user has not turned the chime off; the store is the only vote */
    armed: function () {
      return Chime.supported() && !!(Store.data && Store.data.prefs.notify.sound);
    },

    context: function () {
      if (Chime.ctx) return Chime.ctx;
      if (!Chime.supported()) return null;
      var Ctor = window.AudioContext || window.webkitAudioContext;
      try { Chime.ctx = new Ctor(); } catch (e) { Chime.ctx = null; }
      return Chime.ctx;
    },

    /**
     * Browsers only let audio start inside a gesture. Every tap that could ever
     * lead to a reminder — enabling notifications, toggling the chime — calls
     * this, so the context is already running when a timer fires hours later.
     */
    unlock: function () {
      var ctx = Chime.context();
      if (!ctx) return false;
      try {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      } catch (e) { return false; }
      return true;
    },

    /**
     * Sprint 11 — the two toggles are not the only session that has a gesture.
     *
     * Until now `unlock()` was reached from exactly two taps: enabling
     * notifications and toggling the chime. A phone whose permission was
     * granted on a previous visit never taps either one again, so the first
     * thing that ever touched the AudioContext was `play()` — called from
     * inside the 30-second scan. A timer callback is not a gesture: the context
     * is created `suspended`, `resume()` outside a gesture is refused on both
     * iOS and Android, and the reminder arrives silently. That is the "no sound"
     * half of the field report.
     *
     * So the unlock is moved onto the FIRST touch anywhere in the document,
     * whatever it lands on. The listeners stay attached on purpose rather than
     * firing once: iOS suspends the context every time the app is backgrounded,
     * and the next tap is what brings it back. Nothing is created while the
     * chime is switched off — `armed()` is still the only vote that matters.
     */
    armOnFirstGesture: function (doc) {
      var d = doc || (typeof document !== 'undefined' ? document : null);
      if (!d || typeof d.addEventListener !== 'function') return false;
      if (Chime.gestureArmed) return true;
      Chime.gestureArmed = true;

      function onGesture() {
        if (Chime.armed()) Chime.unlock();
      }
      CHIME_GESTURES.forEach(function (type) {
        try { d.addEventListener(type, onGesture, true); } catch (e) { /* older engine */ }
      });
      return true;
    },

    /** the two-note bell itself — returns false when it could not be played */
    play: function () {
      if (!Chime.armed()) return false;
      var ctx = Chime.context();
      if (!ctx) return false;
      try {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
        var t0 = ctx.currentTime;
        CHIME_TONES.forEach(function (freq, i) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          var at = t0 + i * CHIME_STEP;
          osc.type = 'sine';
          osc.frequency.value = freq;
          // a struck bell, not a beep: instant attack, exponential decay
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + CHIME_TAIL);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(at);
          osc.stop(at + CHIME_TAIL + 0.02);
        });
      } catch (e) { return false; }
      return true;
    },

    /* ======================================================================
       Sprint 13 — the dual-sound engine (mandate §3–§4)
       ====================================================================== */

    /**
     * Every oscillator currently scheduled, so a 10-second ring can be cut
     * short. Bounded: an oscillator that has already finished is garbage the
     * browser has collected, and a session that plays a hundred short tones
     * must not hold a hundred dead handles. The cap comfortably exceeds one
     * full long ring, which is the only thing stop() ever has to reach.
     */
    live: [],

    /**
     * Render ONE voice spec at `offset` seconds from now. Pure scheduling — it
     * touches no preference and asks no permission, so both play paths and the
     * settings preview go through exactly the same code.
     */
    voice: function (spec, offset) {
      var ctx = Chime.context();
      if (!ctx || !spec || !spec.tones || !spec.tones.length) return false;
      var t0 = ctx.currentTime + (offset || 0);
      var peak = spec.peak || 0.22;
      spec.tones.forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var at = t0 + i * spec.step;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.tail);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + spec.tail + 0.02);
        Chime.live.push(osc);
      });
      if (Chime.live.length > CHIME_LIVE_MAX) {
        Chime.live.splice(0, Chime.live.length - CHIME_LIVE_MAX);
      }
      return true;
    },

    /** stop everything already scheduled — the ■ next to the long ringtone */
    stop: function () {
      var list = Chime.live;
      Chime.live = [];
      list.forEach(function (osc) {
        try { osc.stop(); } catch (e) { /* already finished */ }
      });
      return list.length > 0;
    },

    /** one short tone, by preset name; falls back to the default preset */
    playShort: function (name) {
      if (!Chime.armed()) return false;
      var ctx = Chime.context();
      if (!ctx) return false;
      try {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
        return Chime.voice(SHORT_SOUNDS[normShortSound(name)], 0);
      } catch (e) { return false; }
    },

    /**
     * The ~10-second ringtone: the preset's motif, scheduled again every
     * `cycle` seconds until LONG_MS is used up. Everything is scheduled in ONE
     * pass rather than on a timer, so a backgrounded tab (where timers are
     * throttled to seconds) still rings on the beat — and stop() can cut every
     * oscillator at once because it holds them all.
     */
    playLong: function (name) {
      if (!Chime.armed()) return false;
      var ctx = Chime.context();
      if (!ctx) return false;
      try {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
        Chime.stop();
        var spec = LONG_RINGS[normLongSound(name)];
        var seconds = LONG_MS / 1000;
        var n = Math.max(1, Math.floor(seconds / spec.cycle));
        for (var i = 0; i < n; i++) Chime.voice(spec, i * spec.cycle);
      } catch (e) { return false; }
      return true;
    },

    /**
     * What a RECORD asked for. 'none' is a real answer and makes no sound at
     * all — which is not the same as the global chime being off, and is why
     * both votes are read here rather than merged somewhere upstream.
     */
    playAlert: function (kind) {
      var want = normAlertSound(kind);
      if (want === 'none') return false;
      var prefs = (Store.data && Store.data.prefs) || null;
      var chosen = prefs && prefs.sound ? prefs.sound : null;
      return want === 'long'
        ? Chime.playLong(chosen ? chosen.long : LONG_DEFAULT)
        : Chime.playShort(chosen ? chosen.short : SHORT_DEFAULT);
    }
  };

  /* ==========================================================================
     The floating CTA (Wave 1)

     "＋ הוספה חדשה" is fixed above the bottom bar, so on a phone it sits on top
     of the last rows of every list — exactly where a thumb scrolls. It now
     ducks out of the way the moment the page starts moving downward and comes
     straight back on the way up, or at the top of the page.

     decide() is pure and takes both offsets, so the whole behaviour is
     executable head-lessly; nothing here reads the DOM.
     ========================================================================== */

  var Fab = {
    last: 0,
    hidden: false,
    frame: null,

    /**
     * Should the CTA be out of the way?
     * @param prev   the offset the last decision was taken at
     * @param now    the current offset
     * @param hidden where the CTA is right now
     */
    decide: function (prev, now, hidden) {
      if (now <= FAB_TOP) return false;                  // at the top: always offered
      if (now - prev > FAB_DELTA) return true;           // travelling down
      if (prev - now > FAB_DELTA) return false;          // travelling up
      return !!hidden;                                   // jitter changes nothing
    },

    /** paint it — a CTA that is out of the way must not keep its tap target */
    set: function (hide) {
      var el = $('#fab');
      Fab.hidden = !!hide;
      if (!el) return Fab.hidden;
      el.classList.toggle('is-hidden', Fab.hidden);
      el.setAttribute('aria-hidden', Fab.hidden ? 'true' : 'false');
      el.tabIndex = Fab.hidden ? -1 : 0;
      return Fab.hidden;
    },

    /** one scroll sample — coalesced into a frame so it never fights the compositor */
    sample: function (y) {
      var now = typeof y === 'number' ? y : 0;
      var next = Fab.decide(Fab.last, now, Fab.hidden);
      Fab.last = now;
      if (next !== Fab.hidden) Fab.set(next);
      return next;
    },

    offset: function () {
      var y = window.pageYOffset;
      if (typeof y !== 'number') {
        var doc = document.documentElement || document.body || {};
        y = doc.scrollTop || 0;
      }
      return y;
    },

    onScroll: function () {
      if (Fab.frame) return;                     // one decision per painted frame
      Fab.frame = true;
      var run = function () { Fab.frame = null; Fab.sample(Fab.offset()); };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
      else setTimeout(run, 60);
    },

    init: function () {
      Fab.last = Fab.offset();
      Fab.set(false);
      window.addEventListener('scroll', Fab.onScroll, { passive: true });
    }
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

  /** a createdAt/updatedAt millisecond stamp as "היום · 14:03" (Sprint 14 §2) */
  function stampDay(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    var hh = d.getHours(), mm = d.getMinutes();
    return relDay(isoDate(d)) + ' · ' +
      (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
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
  /** how long a written amount may get before it stops being an amount */
  var QTY_MAX = 12;

  /**
   * A free-text amount — "2", "500 גרם", "×3". Deliberately not a number: the
   * unit is half the information on a shopping line, and a stepper that can only
   * count whole units would force "חלב" and "קמח" into the same shape.
   */
  function normQty(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, QTY_MAX);
  }

  function normItems(items, prefix) {
    return (Array.isArray(items) ? items : [])
      .map(function (it) {
        if (typeof it === 'string') return { id: uid(prefix), title: it.trim(), done: false };
        if (!it || typeof it !== 'object') return null;
        var row = {
          id: it.id || uid(prefix),
          title: String(it.title == null ? '' : it.title).trim(),
          done: !!it.done
        };
        // Sprint 16 — a quantity belongs to the shopping module and to nothing
        // else, so it is carried only where one was actually written: a subtask
        // never grows a field it has no use for, and every store written before
        // this sprint round-trips byte-identical.
        var qty = normQty(it.qty);
        if (qty) row.qty = qty;
        return row;
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
    setReminders(t, remindersOf(t));                         // Sprint 10 → 12
    setAlert(t);                                             // Sprint 13
    return t;
  }

  /**
   * Events had no migrator: every field they carry has existed since Sprint 1.
   * Sprint 10 adds the reminder key, so they need one now — and it stays as
   * narrow as it needs to be, exactly like the other three.
   */
  function migrateEvent(e) {
    if (!e || typeof e !== 'object') return e;
    setReminders(e, remindersOf(e));
    setAlert(e);                                             // Sprint 13
    return e;
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
    setAlert(n);
    return n;
  }

  /* ------------------------------------ per-record alert options (Sprint 13) */

  /**
   * Sound and vibration are stored ON THE RECORD (mandate §3), so "the client
   * call rings for ten seconds, the shopping reminder just ticks" is a property
   * of the thing being reminded about rather than a mode the whole app is in.
   *
   * Every value is normalised on every read path, exactly like `category`: a
   * store written before this sprint carries neither key, an unknown value can
   * never crash a render, and the D1 column is preserve-if-blank so the
   * serialiser never emits ''.
   */
  function normAlertSound(v) {
    return ALERT_SOUNDS.indexOf(v) === -1 ? ALERT_SOUND_DEFAULT : v;
  }

  function normVibe(v) {
    return VIBE_KINDS.indexOf(v) === -1 ? VIBE_DEFAULT : v;
  }

  /** which short preset the app plays — a global choice, not a per-record one */
  function normShortSound(v) {
    return SHORT_SOUNDS[v] ? v : SHORT_DEFAULT;
  }

  function normLongSound(v) {
    return LONG_RINGS[v] ? v : LONG_DEFAULT;
  }

  /** the migrator every event / task / note goes through on load and on sync */
  function setAlert(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    rec.alertSound = normAlertSound(rec.alertSound);
    rec.alertVibe = normVibe(rec.alertVibe);
    return rec;
  }

  /**
   * Write an edited form's pair back onto a record. A form that carries no
   * alert picker (a list, a client) leaves the record's own pair alone rather
   * than resetting it to the default — the same rule the reminder panel follows.
   */
  function setAlertFrom(rec, v) {
    if (!rec || !v) return rec;
    if (v.alertSound !== undefined) rec.alertSound = normAlertSound(v.alertSound);
    if (v.alertVibe !== undefined) rec.alertVibe = normVibe(v.alertVibe);
    return rec;
  }

  /** the pair, as the delivery path wants to read it */
  function alertOf(rec) {
    return { sound: normAlertSound(rec && rec.alertSound), vibe: normVibe(rec && rec.alertVibe) };
  }

  /** "צליל קצר · רטט חוזר" — one line for the detail reader and the form summary */
  function alertSentence(rec) {
    var a = alertOf(rec);
    return ALERT_SOUND_LABEL[a.sound] + ' · ' + VIBE_LABEL[a.vibe];
  }

  /* ------------------------------------------------- reminders (Sprint 10) */

  /** never '' and never unknown — the sync column is preserve-if-blank */
  function normRemind(v) {
    return REMIND_OPTIONS.indexOf(v) === -1 ? REMIND_DEFAULT : v;
  }

  /**
   * How many minutes before its own start this record wants to be announced.
   * `null` means "never" — the one answer that mutes a single record without
   * touching the global toggle. `lead` is the system default, so a store
   * written before this sprint behaves exactly as it always did.
   */
  function remindLead(rec, lead) {
    var key = normRemind(rec && rec.remind);
    if (key === 'none') return null;
    if (key === REMIND_DEFAULT) {
      return typeof lead === 'number' && lead >= 0 ? lead : 10;
    }
    return REMIND_MINUTES[key];
  }

  /** the chip a card wears when it carries a non-default reminder */
  function remindTag(rec) {
    var list = remindersOf(rec);

    // muted is worth saying out loud — it is a choice, not an absence
    if (!list.length) {
      return '<span class="badge remind rm-none">' + esc(REMIND_SHORT.none) + '</span>';
    }

    // 'default' alone is the system lead: no opinion, so no chip (unchanged)
    if (list.length === 1) {
      var text = REMIND_SHORT[list[0]] || (isCustomRemind(list[0]) ? '🔔 ' + customRemindText(list[0]) : '');
      if (!text) return '';
      return '<span class="badge remind rm-' + esc(remindClass(list[0])) + '">' + esc(text) + '</span>';
    }

    // several at once: the count is the honest summary — the full list lives in
    // the detail reader, and a row of five chips would drown the card
    return '<span class="badge remind rm-multi">🔔 ' + list.length + ' התראות</span>';
  }

  /* ------------------------------------ multiple reminders (Sprint 12 · §1) */

  /** '@YYYY-MM-DDTHH:MM' — an absolute moment, not a lead off the record */
  function isCustomRemind(tok) {
    return typeof tok === 'string' && REMIND_CUSTOM_RE.test(tok);
  }

  /** the 'YYYY-MM-DDTHH:MM' inside a custom token, or '' */
  function customRemindStamp(tok) {
    return isCustomRemind(tok) ? tok.slice(1) : '';
  }

  function customRemindDate(tok) { return customRemindStamp(tok).slice(0, 10); }
  function customRemindTime(tok) { return customRemindStamp(tok).slice(11, 16); }

  /** "מחר · 09:00" — how a custom reminder reads to a human */
  function customRemindText(tok) {
    var d = customRemindDate(tok);
    if (!d) return '';
    return relDay(d) + ' · ' + customRemindTime(tok);
  }

  function remindLabelOf(tok) {
    return isCustomRemind(tok) ? customRemindText(tok) : (REMIND_LABEL[tok] || tok);
  }

  /** a class name a stamp can never break — '@' and ':' are not CSS-safe */
  function remindClass(tok) {
    return isCustomRemind(tok) ? 'custom' : String(tok);
  }

  /**
   * Whatever a store, a D1 row or a form ever held → a clean token list.
   *
   * Accepts an array, a comma-joined string, or a single legacy key. 'none'
   * contributes nothing, which is what makes the EMPTY list the one and only
   * muted state — there is no second way to say it. Built-ins come first in
   * vocabulary order and customs after, sorted by the moment they name, so two
   * records with the same reminders serialise to the same string and the sync
   * outbox sees no phantom change.
   */
  function normRemindList(v) {
    var raw;
    if (Array.isArray(v)) raw = v;
    else if (typeof v === 'string') raw = v.split(',');
    else raw = [];

    var seen = {}, builtin = [], custom = [];
    raw.forEach(function (item) {
      var tok = String(item == null ? '' : item).trim();
      if (!tok || tok === 'none' || seen[tok]) return;
      if (REMIND_MULTI.indexOf(tok) !== -1) { seen[tok] = 1; builtin.push(tok); return; }
      if (isCustomRemind(tok)) { seen[tok] = 1; custom.push(tok); }
      // anything else is a vocabulary we do not speak — dropped, never guessed
    });

    builtin.sort(function (a, b) { return REMIND_ORDER.indexOf(a) - REMIND_ORDER.indexOf(b); });
    custom.sort();                                  // ISO stamps sort chronologically as text
    return builtin.concat(custom).slice(0, REMIND_MAX);
  }

  /**
   * The ONE reader every engine goes through.
   *
   * `reminders` is authoritative the moment it is an array — including an empty
   * one, which is a deliberate mute and must not fall back to the legacy key.
   * Only a record that has never met migrateTask/migrateEvent (a bare literal
   * in a test, a row mid-merge) is read off the legacy `remind` string.
   *
   * A legacy string that says nothing this app understands is "no opinion",
   * NOT silence: an unknown key has meant REMIND_DEFAULT since Sprint 10, and
   * a forward-compatible vocabulary must never mute a record by accident —
   * dropping a reminder is the one failure the user cannot see happening.
   */
  function remindersOf(rec) {
    if (rec && Array.isArray(rec.reminders)) return normRemindList(rec.reminders);
    if (!rec || rec.remind == null || rec.remind === '') return [REMIND_DEFAULT];

    var raw = String(rec.remind);
    var list = normRemindList(raw);
    if (list.length) return list;
    // nothing recognised: an explicit 'none' is a mute, anything else is default
    return raw.split(',').map(function (s) { return s.trim(); }).indexOf('none') !== -1
      ? [] : [REMIND_DEFAULT];
  }

  /** token list → the remind_key column. Never '' — the column is preserve-if-blank. */
  function remindKey(list) {
    var clean = normRemindList(list);
    return clean.length ? clean.join(',') : 'none';
  }

  function remindColumn(rec) { return remindKey(remindersOf(rec)); }

  /** the single writer — `reminders` is the state, `remind` its serialised twin */
  function setReminders(rec, list) {
    if (!rec) return rec;
    rec.reminders = normRemindList(list);
    rec.remind = remindKey(rec.reminders);
    return rec;
  }

  /** the master toggle: "עם התראה" is simply "this record has reminders" */
  function remindOn(rec) { return remindersOf(rec).length > 0; }

  /**
   * Every reminder this record wants, resolved against the system default.
   *
   * A built-in becomes {tok, minutes} — how many minutes before its own start
   * it wants to be announced. A custom becomes {tok, at} — an absolute moment
   * that ignores the record entirely, which is exactly why it can be set for a
   * day the record is not even on.
   */
  function remindPlan(rec, lead) {
    var fallback = typeof lead === 'number' && lead >= 0 ? lead : 10;
    return remindersOf(rec).map(function (tok) {
      if (isCustomRemind(tok)) return { tok: tok, at: customRemindStamp(tok) };
      if (tok === REMIND_DEFAULT) return { tok: tok, minutes: fallback };
      return { tok: tok, minutes: REMIND_MINUTES[tok] };
    });
  }

  /**
   * The ledger key for one reminder of one record.
   *
   * The token leads and the date TRAILS, so `key.slice(-10)` is still the date
   * the overnight sweep reads — the invariant Sprint 10 established, kept intact
   * now that a single record can hold several keys at once.
   */
  function remindMark(tok, id, on) {
    return tok + '#' + id + '@' + on;
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

  /**
   * A completed task that has not been filed into היסטוריה yet (Sprint 9).
   *
   * It is finished — it carries the strikethrough and the dim — but it is still
   * a full member of every list it was in, in the slot it was in. This is the
   * predicate that keeps it there: nothing in the app treats it as gone until
   * archiveDone() moves it into the log.
   */
  function awaitingArchive(task) {
    return !!task && normStatus(task.status) === 'done';
  }

  /**
   * Only a CANCELLED task sinks to the bottom of a list. A completed one holds
   * the rank it had while it was open, so ticking it cannot re-sort the list
   * under the finger that ticked it.
   */
  function sinksToBottom(task) {
    return isClosed(task && task.status) && !awaitingArchive(task);
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

  /**
   * The quick sub-tabs of the tasks view: היום · באיחור · ממתין · הושלם.
   *
   * Sprint 9 — "open" is no longer the gate on היום / באיחור. A task ticked a
   * moment ago is still due today and must still be listed under היום, struck
   * through, in its own slot; only a cancelled task drops out of a dated tab.
   * הושלם is where the ones waiting to be filed collect.
   */
  function taskMatchesTab(task, tab, today) {
    if (!task) return false;
    var status = normStatus(task.status);
    var onBoard = !isClosed(status) || awaitingArchive(task);
    var t = today || todayISO();
    if (tab === 'today') return onBoard && task.due === t;
    // Sprint 10 — everything the "today" board legitimately cannot show.
    // היום / בקרוב / נכנסים / באיחור are mutually exclusive and, between them,
    // exhaustive over every task still on the board: a task is dated today, or
    // later, or earlier, or not at all. That is what closes the field report —
    // an open task can never again be counted somewhere and listed nowhere.
    if (tab === 'upcoming') return onBoard && !!task.due && task.due > t;
    if (tab === 'inbox') return onBoard && !task.due;
    if (tab === 'late') return onBoard && !!task.due && task.due < t;
    if (tab === 'waiting') return status === 'waiting';
    if (tab === 'done') return status === 'done';
    return true;                                              // 'all'
  }

  /**
   * The chronological order בקרוב is read in: soonest first, undated last, and
   * priority only ever breaks a tie inside one day. sortTasks() cannot be used
   * here — it floats by priority across dates, which is right for a flat board
   * and wrong for a calendar-shaped one.
   */
  function sortByDate(tasks) {
    return (Array.isArray(tasks) ? tasks.slice() : []).sort(function (a, b) {
      var da = a.due || '9999-99-99', db = b.due || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      var ta = timeToMinutes(a.time), tb = timeToMinutes(b.time);
      if (ta !== tb) return ta - tb;
      var pa = PRIORITY_RANK[normPriority(a.priority)], pb = PRIORITY_RANK[normPriority(b.priority)];
      if (pa !== pb) return pa - pb;
      return 0;
    });
  }

  /** the day-band a בקרוב row is filed under — "מחר", "בעוד 3 ימים", "ללא תאריך" */
  function upcomingBand(due, today) {
    if (!due) return 'ללא תאריך יעד';
    var t = today || todayISO();
    var gap = Math.round((parseISO(due) - parseISO(t)) / DAY_MS);
    if (gap <= 7) return relDay(due) + ' · ' + fmtDayMon(due);
    if (gap <= 14) return 'בשבוע הבא · ' + fmtDayMon(due);
    if (gap <= 30) return 'בהמשך החודש · ' + fmtDayMon(due);
    return 'בהמשך · ' + fmtDayMon(due);
  }

  /** open first, then by due date, then by priority, then by time of day */
  function sortTasks(tasks) {
    return (Array.isArray(tasks) ? tasks.slice() : []).sort(function (a, b) {
      var ca = sinksToBottom(a) ? 1 : 0, cb = sinksToBottom(b) ? 1 : 0;
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
          workspace: 'tasks',
          // Sprint 12 — the quick filter of the "פתוחות" sheet, remembered
          // exactly like every other sub-tab in the app
          openFilter: 'all',
          // Sprint 16 — which tab רשימת קניות opens on. Someone mid-shop wants
          // "רשימת הקניות שלי"; someone planning wants the catalog. The app is
          // not entitled to guess, so it remembers.
          shopTab: 'catalog',
          // Sprint 17 — the owner's own edits to the master catalog, as an
          // OVERLAY: PANTRY itself is never rewritten, so "שחזור המאגר" is one
          // assignment and a future sprint can still add mandated products.
          pantry: { add: {}, hide: [], edit: {} },
          // serverAt — when the Worker last accepted this device's push
          // subscription. '' means local-only delivery (Sprint 11).
          notify: { on: false, lead: 10, sound: true, serverAt: '' }, fired: {},
          // Sprint 10 — "משימות קרובות" on My Day starts open: the whole point
          // of the widget is that nothing can hide inside it
          upcomingOpen: true,
          // Sprint 13 — the settings drawer. `sound` names WHICH preset each
          // family plays; the record names WHICH FAMILY (mandate §3).
          sound: { short: SHORT_DEFAULT, long: LONG_DEFAULT },
          vibe: VIBE_DEFAULT,
          haptics: true,
          theme: THEME_DEFAULT
        },
        events: [], tasks: [], lists: [], notes: [], clients: [],
        // סל מחזור (Sprint 8) — deleted records wait here for ten days
        trash: [],
        // היסטוריה (Sprint 9) — completed tasks wait here for ten days
        archive: [],
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
            if (Array.isArray(parsed.trash)) d.trash = parsed.trash;
            if (Array.isArray(parsed.archive)) d.archive = parsed.archive;
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
      // Sprint 10 shape: every pre-reminder event and task carries no lead key
      d.events = d.events.map(migrateEvent);
      // Sprint 4 shapes: a pre-CRM client holds no status, no file, no timeline
      d.clients = d.clients.map(migrateClient);

      if (['all', 'personal', 'business'].indexOf(d.prefs.filter) === -1) d.prefs.filter = 'all';

      // the selected tasks sub-tab survives a reload exactly like the calendar view
      if (TASK_TABS.indexOf(d.prefs.taskTab) === -1) d.prefs.taskTab = 'all';

      // and so does the selected pipeline sub-tab of the clients view
      if (CLIENT_TABS.indexOf(d.prefs.clientTab) === -1) d.prefs.clientTab = 'all';

      // the selected calendar view survives a reload; anything unknown falls back
      if (CAL_VIEWS.indexOf(d.prefs.calView) === -1) d.prefs.calView = 'month';

      // and so does the selected workspace of the משימות screen (Sprint 10)
      if (WORK_TABS.indexOf(d.prefs.workspace) === -1) d.prefs.workspace = 'tasks';

      // Sprint 12 — the "פתוחות" sheet's quick filter, absent in every store
      // written before the sheet existed
      if (OPEN_FILTERS.indexOf(d.prefs.openFilter) === -1) d.prefs.openFilter = 'all';

      // Sprint 16 — the shopping module's tab, absent in every store written
      // before the module existed
      if (SHOP_TABS.indexOf(d.prefs.shopTab) === -1) d.prefs.shopTab = SHOP_TABS[0];

      // Sprint 17 — the catalog overlay, absent in every store written before
      // the מאגר became editable. It is normalised rather than trusted, and a
      // ref pointing at a product this build no longer ships is dropped, so an
      // old overlay can never hide or rename something that is not there.
      d.prefs.pantry = normPantryEdits(d.prefs.pantry);

      // reminder prefs may be absent in a store written before the PWA upgrade
      if (!d.prefs.notify || typeof d.prefs.notify !== 'object') {
        d.prefs.notify = { on: false, lead: 10, sound: true, serverAt: '' };
      }
      d.prefs.notify.on = !!d.prefs.notify.on;
      if (typeof d.prefs.notify.lead !== 'number' || d.prefs.notify.lead < 0) d.prefs.notify.lead = 10;
      // Sprint 10 — the chime defaults ON, and only an explicit false turns it off
      d.prefs.notify.sound = d.prefs.notify.sound !== false;
      // Sprint 11 — absent in every store written before server push existed
      if (typeof d.prefs.notify.serverAt !== 'string') d.prefs.notify.serverAt = '';
      if (!d.prefs.fired || typeof d.prefs.fired !== 'object') d.prefs.fired = {};
      d.prefs.upcomingOpen = d.prefs.upcomingOpen !== false;

      // Sprint 13 — the settings drawer's block, absent in every store written
      // before it existed. Every value is normalised rather than trusted, so a
      // preset this build no longer ships falls back instead of going silent.
      if (!d.prefs.sound || typeof d.prefs.sound !== 'object') d.prefs.sound = {};
      d.prefs.sound.short = normShortSound(d.prefs.sound.short);
      d.prefs.sound.long = normLongSound(d.prefs.sound.long);
      d.prefs.vibe = normVibe(d.prefs.vibe);
      d.prefs.haptics = d.prefs.haptics !== false;      // touch feedback defaults ON
      if (THEMES.indexOf(d.prefs.theme) === -1) d.prefs.theme = THEME_DEFAULT;

      // Sprint 5: the cloud block is absent in every pre-D1 store, and its
      // outbox is replayed from disk — a queued mutation survives a reload
      d.sync = normSync(d.sync);

      // Sprint 6: the Google block is absent in every pre-gcal store, and the
      // cached "last synced" stamp is what the header renders while offline
      d.gcal = normGCal(d.gcal);

      // Sprint 8: the bin is absent in every pre-recycle store, and a malformed
      // entry is dropped rather than allowed to crash a render
      d.trash = normTrash(d.trash);

      // Sprint 9: and so is the completed-tasks log, in every pre-archive store
      d.archive = normArchive(d.archive);

      this.data = d;

      // "Auto-purge items older than 10 days during app initialization" — this
      // is that initialization, and it runs before a single row is painted, so
      // an expired record is never offered for restore even for one frame.
      // Both drawers are swept, and one save covers both.
      if (purgeTrash() + purgeArchive()) { this.save(); }

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
      // Sprint 12 — events had no branch here at all, so a freshly created
      // event was the ONE record that never met its migrator: it entered the
      // store with whatever `remind` the form handed it, unnormalised, while
      // every event arriving from D1 or from localStorage was normalised twice
      else if (collection === 'events') rec = migrateEvent(rec);
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
        google_calendar_id: str(r.googleCalendarId),
        // Sprint 12 — a comma-joined token list, not a single key. 'none' when
        // muted, so the column is never '' and preserve-if-blank still holds.
        remind_key: remindColumn(r),
        // Sprint 13 — never '', for the same preserve-if-blank reason
        alert_sound: normAlertSound(r.alertSound), alert_vibe: normVibe(r.alertVibe)
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
        created_at: toISOStamp(r.createdAt), deleted_at: null,
        remind_key: remindColumn(r),
        alert_sound: normAlertSound(r.alertSound), alert_vibe: normVibe(r.alertVibe)
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
        created_at: toISOStamp(r.createdAt), deleted_at: null,
        alert_sound: normAlertSound(r.alertSound), alert_vibe: normVibe(r.alertVibe)
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
      return migrateEvent({
        type: str(row.category_type) || 'event', id: row.id,
        title: str(row.title), category: normCat(row.category),
        date: s.date, start: s.time, end: e.time,
        location: str(row.location), notes: str(row.notes),
        clientId: str(row.client_id),
        googleEventId: str(row.google_event_id), googleEtag: str(row.etag),
        googleCalendarId: str(row.google_calendar_id),
        remind: str(row.remind_key),
        alertSound: str(row.alert_sound), alertVibe: str(row.alert_vibe)
      });
    },
    tasks: function (row) {
      return migrateTask({
        type: 'task', id: row.id, title: str(row.title), category: normCat(row.category),
        status: normStatus(row.status), priority: normPriority(row.priority),
        due: str(row.due_date), time: str(row.due_time),
        nextAction: str(row.next_action), subtasks: jsonIn(row.subtasks_json),
        notes: str(row.notes), clientId: str(row.client_id),
        remind: str(row.remind_key),
        alertSound: str(row.alert_sound), alertVibe: str(row.alert_vibe)
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
        clientId: str(row.client_id),
        alertSound: str(row.alert_sound), alertVibe: str(row.alert_vibe)
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

          // Sprint 8 — a record sitting in סל מחזור is gone from its collection
          // but NOT gone from the cloud until its tombstone lands. Without this
          // guard the very next pull would push it straight back onto the board
          // while its own bin entry still offered to restore it: two copies of
          // one record, one of them unreachable.
          var held = trashFind(row.id);
          if (held && held.collection === t) {
            // the bin is the newer fact — the server has not seen the deletion yet
            if (held.deletedAt >= stamp) return;
            // ...and it steps aside when the cloud proves the record is alive
            // again, rather than leaving a bin entry that could "permanently
            // delete" something still sitting on the board
            d.trash.splice(d.trash.indexOf(held), 1);
          }

          // Sprint 9 — היסטוריה needs the identical guard for the identical
          // reason: a task filed into the log is gone from its collection but
          // not gone from the cloud until its tombstone lands, and a stale pull
          // would put it back on the board while the log still held it.
          var filed = t === 'tasks' ? archiveFind(row.id) : null;
          if (filed) {
            if (filed.archivedAt >= stamp) return;
            d.archive.splice(d.archive.indexOf(filed), 1);
          }

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

  var UI = { view: 'today', formType: 'event', formCat: 'personal', editId: null };

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

  /** what the summary line counts as owed today — genuinely open work only */
  function tasksDueToday() {
    var t = todayISO();
    return openTasks().filter(function (x) { return x.due === t; });
  }

  /**
   * What today's board SHOWS, which is not the same thing (Sprint 9): a task
   * ticked a minute ago is no longer owed, but it is still on the board, struck
   * through and in place, until it is filed into היסטוריה.
   */
  function boardTasksToday() {
    var t = todayISO();
    return pick('tasks').filter(function (x) {
      return x.due === t && (!isClosed(x.status) || awaitingArchive(x));
    });
  }

  function unscheduledToday() {
    return boardTasksToday().filter(function (x) { return !hourOf(x.time) && hourOf(x.time) !== 0; });
  }

  /* ---- Sprint 10 · the two populations My Day used to lose ---------------
     A task dated next Tuesday and a task with no date at all were both counted
     by "פתוחות: N" and shown by nothing. These are the selectors the widget at
     the bottom of My Day is built from — the same predicates the בקרוב and
     נכנסים tabs use, windowed to a week so the widget stays a glance. */

  /** open, dated, and inside the next UPCOMING_DAYS days — never today */
  function upcomingSoon() {
    var t = todayISO();
    var horizon = addDaysISO(t, UPCOMING_DAYS);
    return pick('tasks').filter(function (x) {
      return taskMatchesTab(x, 'upcoming', t) && x.due <= horizon;
    });
  }

  /** נכנסים — created without a date, and therefore homeless until now */
  function inboxTasks() {
    return pick('tasks').filter(function (x) { return taskMatchesTab(x, 'inbox', todayISO()); });
  }

  /** what the My Day widget lists, in the order it lists it */
  function upcomingWidget() {
    return sortByDate(upcomingSoon().concat(inboxTasks()));
  }

  /** every task still awaiting a place in the log, in the order it is shown */
  function doneUnfiled() {
    return sortTasks(pick('tasks').filter(awaitingArchive));
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

    setText($('#summaryGreeting'), greetingWord() + ' ' + OWNER.short);

    var line;
    if (!meetings && !tasks && !follow) {
      line = 'היום נקי לגמרי — אין פגישות, משימות או מעקבים ממתינים.';
    } else {
      line = 'יש לך היום ' +
        plural(meetings, 'פגישה אחת', 'פגישות') + ', ' +
        plural(tasks, 'משימה אחת', 'משימות') + ' ו־' +
        plural(follow, 'מעקב אחד', 'מעקבים') + '.';
    }
    setText($('#summaryLine'), line);

    var f = filterCat();
    setHTML($('#summaryChips'), [
      '<span class="chip">' + esc(relDay(todayISO())) + '</span>',
      '<span class="chip">תצוגה: <b>' + (f === 'all' ? 'הכל' : CAT_LABEL[f]) + '</b></span>',
      // §3 — the number that started the whole field report is now the door to
      // the list behind it, not a read-only fact about a screen that shows less
      '<button type="button" class="chip chip-btn" data-openall="1" ' +
      'aria-haspopup="dialog">פתוחות: <b>' + openTasks().length + '</b> ›</button>',
      '<span class="chip">ממתין ללקוח: <b>' + waitingTasks().length + '</b></span>',
      '<span class="chip">בוצעו וממתינות לתיוק: <b>' + doneUnfiled().length + '</b></span>'
    ].join(''));
  }

  /* --------------------------------------------- render: 4. attention cards */

  function renderAttention() {
    var late = overdueTasks().length;
    var waiting = waitingTasks().length;
    var follow = pendingFollowUps().length;
    var noAction = clientsMissingAction().length;

    setHTML($('#attentionCards'),
      attCard(late, 'משימות באיחור', late ? 'דורש טיפול מיידי' : 'הכול בזמן',
        late ? 'is-hot' : 'is-calm', 'data-tasktab="late"') +
      attCard(waiting, 'ממתין ללקוח', waiting ? 'הכדור אצל הלקוח' : 'אין המתנות פתוחות',
        waiting ? 'is-wait' : 'is-calm', 'data-tasktab="waiting"') +
      attCard(follow, 'מעקבי לקוחות', follow ? 'ממתין לחזרה שלך' : 'אין מעקבים פתוחים',
        follow ? 'is-warn' : 'is-calm', 'data-nav="clients"') +
      // the Next-Action alert engine, surfaced on the dashboard (mandate §3)
      attCard(noAction, 'ללא פעולה הבאה',
        noAction ? 'לקוחות פעילים בלי צעד הבא' : 'לכל לקוח פעיל יש צעד הבא',
        noAction ? 'is-hot' : 'is-calm', 'data-clientfilter="all"'));
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
   * The hour the timeline actually paints an event in: everything outside
   * 08:00–22:00 — an untimed event included — is clamped into the window
   * rather than dropped.
   */
  function timelineHour(time) {
    var h = hourOf(time);
    if (h === null) h = DAY_START;
    if (h < DAY_START) h = DAY_START;
    if (h > DAY_END) h = DAY_END;
    return h;
  }

  /**
   * Time-blocking (Sprint 10 · mandate §4).
   *
   * A task with a clock time is an appointment with yourself, and it used to be
   * invisible on My Day: the timeline drew events only, and "לביצוע היום" draws
   * the UNTIMED tasks by definition. So a task set for 14:00 appeared nowhere on
   * the one screen that claims to be the day. It is now blocked into its own
   * hour, beside the meetings it is competing with, which is the only way the
   * day reads as a whole.
   */
  function timedTasksToday() {
    return boardTasksToday().filter(function (x) { return hourOf(x.time) !== null; });
  }

  /**
   * One slot of the timeline, as {collection, rec}. Both the renderer and the
   * membership check read this, so the paint order and the expected order are
   * the same list — the invariant B0 established, extended to two collections.
   */
  function timelineEntries() {
    var out = [];
    todaysEvents().forEach(function (e) {
      out.push({ collection: 'events', rec: e, at: timeToMinutes(e.start), hour: timelineHour(e.start) });
    });
    timedTasksToday().forEach(function (x) {
      out.push({ collection: 'tasks', rec: x, at: timeToMinutes(x.time), hour: timelineHour(x.time) });
    });
    /* Bucket first, clock second — B0 again, and for the same reason. An
       untimed record clamps into the 08:00 bucket but sorts LAST by the clock
       (no time = 24:01), so sorting by the clock alone would report an order
       the renderer does not paint, sameKeys() would answer "changed" on every
       tap, and the container under the finger would be rebuilt every time.
       Inside one hour: earliest first, and a meeting outranks a self-appointment. */
    return out.sort(function (a, b) {
      if (a.hour !== b.hour) return a.hour - b.hour;
      if (a.at !== b.at) return a.at - b.at;
      if (a.collection !== b.collection) return a.collection === 'events' ? -1 : 1;
      return a.rec.id < b.rec.id ? -1 : (a.rec.id > b.rec.id ? 1 : 0);
    });
  }

  /**
   * The hour buckets of the timeline, in the order they are painted.
   *
   * Wave 1 · B0 — renderTimeline() and the membership check used to derive
   * their order separately: the renderer clamps an untimed event into the
   * 08:00 bucket, while todaysEvents() sorts it LAST (no time = 24:01). With
   * one untimed event on the board the DOM order and the expected order could
   * never agree, sameKeys() answered "changed" on every single tap, and the
   * container the finger was on was rebuilt every time — the exact regression
   * the targeted-patch engine exists to prevent. Both sides now read this one
   * function, so they cannot drift again.
   */
  function timelineRows() {
    var byHour = {};
    timelineEntries().forEach(function (entry) {
      (byHour[entry.hour] = byHour[entry.hour] || []).push(entry);
    });

    var out = [];
    for (var h = DAY_START; h <= DAY_END; h++) out.push({ hour: h, list: byHour[h] || [] });
    return out;
  }

  /** the ordered record keys #timeline holds once painted */
  function timelineKeys() {
    return timelineEntries().map(function (entry) {
      return entry.collection + ':' + entry.rec.id;
    });
  }

  /** an event card, or a compact task block — the timeline draws both (§4) */
  function timelineCard(entry) {
    return entry.collection === 'events'
      ? eventCard(entry.rec)
      : taskRow(entry.rec, true);
  }

  function renderTimeline(quiet) {
    var buckets = timelineRows();
    var events = todaysEvents().length;
    var blocks = timedTasksToday().length;

    var nowH = new Date().getHours();
    var rows = [];

    for (var i = 0; i < buckets.length; i++) {
      var h = buckets[i].hour;
      var list = buckets[i].list;
      rows.push(
        '<div class="tl-row' + (h === nowH ? ' is-now' : '') + '">' +
        '<div class="tl-hour">' + pad2(h) + ':00</div>' +
        '<div class="tl-slot' + (list.length ? '' : ' tl-empty') + '">' +
        list.map(timelineCard).join('') +
        '</div></div>'
      );
    }

    if (!quiet) $('#timeline').innerHTML = rows.join('');

    var parts = [];
    if (events) parts.push(plural(events, 'אירוע אחד', 'אירועים'));
    if (blocks) parts.push(plural(blocks, 'משימה מתוזמנת אחת', 'משימות מתוזמנות'));
    setText($('#timelineMeta'), parts.length
      ? parts.join(' · ') + ' · ' + pad2(DAY_START) + ':00–' + pad2(DAY_END) + ':00'
      : 'אין אירועים מתוזמנים');
  }

  function eventCard(e) {
    var when = e.start ? (e.start + (e.end ? '–' + e.end : '')) : 'ללא שעה';
    var meta = [when, e.location].filter(Boolean).join(' · ');
    return '<div class="ev ev-' + e.category + pickCls('events', e.id) +
      '" data-rec="events:' + e.id + '">' +
      selBox('events', e.id) +
      '<div class="ev-body">' +
      '<div class="ev-title">' + esc(e.title) + '</div>' +
      '<div class="ev-meta">' + esc(meta) + remindTag(e) + '</div>' +
      '</div>' +
      catTag(e.category) +
      editBtn('events', e.id) +
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
    setText($('#todoMeta'), list.length ? plural(list.length, 'משימה אחת', 'משימות') : '');
  }

  /* ------------------------- render: 3b. "משימות קרובות" (Sprint 10 · §1.2) */

  function upcomingOpen() { return Store.data.prefs.upcomingOpen !== false; }

  function toggleUpcoming() {
    Store.data.prefs.upcomingOpen = !upcomingOpen();
    Store.save();
    renderUpcoming();
  }

  /**
   * The answer to "where did my משימות go". It sits under the daily board, it
   * is collapsible but starts open, and it holds precisely the two populations
   * the board cannot: the next seven days, and everything with no date at all.
   * A day-band caption separates them, so the list reads chronologically rather
   * than as an undifferentiated pile.
   */
  function renderUpcoming(quiet) {
    var rows = upcomingWidget();
    var box = $('#upcomingBlock');
    var open = upcomingOpen();

    var soon = upcomingSoon().length;
    var inbox = inboxTasks().length;

    var btn = $('#upcomingToggle');
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      setText($('#upcomingCaret'), open ? '⌃' : '⌄');
    }
    setText($('#upcomingCount'), String(rows.length));

    var parts = [];
    if (soon) parts.push(plural(soon, 'משימה אחת בשבוע הקרוב', 'משימות בשבוע הקרוב'));
    if (inbox) parts.push(plural(inbox, 'משימה אחת ללא תאריך', 'משימות ללא תאריך'));
    setText($('#upcomingMeta'), parts.join(' · '));

    var body = $('#upcomingList');
    if (body) body.hidden = !open;
    if (box) box.classList.toggle('is-open', open);

    if (quiet || !body) return;

    if (!rows.length) {
      body.innerHTML = emptyState('אין משימות קרובות',
        'כל משימה שתייעד לשבוע הקרוב — או שתיצור בלי תאריך יעד — תופיע כאן, כדי ששום דבר לא ייעלם.');
      return;
    }

    var today = todayISO();
    var band = null;
    var html = [];
    rows.forEach(function (t) {
      var next = upcomingBand(t.due, today);
      if (next !== band) {
        band = next;
        html.push('<div class="up-band">' + esc(band) + '</div>');
      }
      html.push(taskRow(t, true));
    });
    body.innerHTML = html.join('');
  }

  /** "מחר" / "12 באוגוסט" — relDay() without the weekday, so it fits one line */
  function shortDay(iso) {
    var t = todayISO();
    if (iso === t) return 'היום';
    if (iso === addDaysISO(t, 1)) return 'מחר';
    if (iso === addDaysISO(t, -1)) return 'אתמול';
    return fmtDayMon(iso);
  }

  /**
   * The ONE token a compact row keeps (Sprint 14 · mandate §1): WHEN.
   *
   * Everything else a task carries is a property of the task; this is the only
   * thing that is a property of TODAY, and a list that hides it turns an
   * overdue task into an ordinary one. It rides at the end of the title line,
   * so it costs no height at all — and a task with nothing to say about time
   * draws nothing, which is the whole point of the redesign.
   */
  function rowWhen(t, late) {
    if (late) return '<span class="row-when is-late">באיחור</span>';
    if (t.time) return '<span class="row-when">' + esc(t.time) + '</span>';
    if (t.due && t.due !== todayISO()) return '<span class="row-when">' + esc(shortDay(t.due)) + '</span>';
    return '';
  }

  /**
   * One task row (Sprint 14 · mandate §1) — the SCAN surface.
   *
   * It used to carry four badges, a client chip, a meta sentence, two icon
   * buttons, the next-action line and the whole sub-task checklist. Six tasks
   * filled a screen. Now it is the check circle, the title and the when-token:
   * one line, scannable at a glance.
   *
   * Nothing was deleted — the category, the status, the priority, the alerts,
   * the next action, the sub-tasks, עריכה and מחיקה all moved into the reader
   * a tap on the row opens (§2), which is a surface with room to hold them.
   *
   * `compact` no longer changes the shape — a row this small already IS the
   * calendar variant — but it still rides on the node as data-compact, because
   * Patch.record() rebuilds each node in the variant it was drawn in.
   */
  function taskRow(t, compact) {
    var status = normStatus(t.status);
    var late = !isClosed(status) && t.due && t.due < todayISO();

    var cls = 'row task is-compact st-row-' + status +
      (t.done ? ' is-done' : '') +
      (status === 'cancelled' ? ' is-cancelled' : '') +
      (status === 'waiting' ? ' is-waiting' : '') +
      (late ? ' is-late' : '') +
      pickCls('tasks', t.id);

    // data-rec is what lets Patch.record() repaint this one row in place, in
    // every pane it happens to appear in, without rebuilding any container
    return '<div class="' + cls + '" data-rec="tasks:' + t.id + '"' +
      (compact ? ' data-compact="1"' : '') + '>' +
      selBox('tasks', t.id) +
      '<button type="button" class="check-tap" data-toggle="' + t.id + '"' +
      ' aria-pressed="' + (t.done ? 'true' : 'false') + '"' +
      ' aria-label="' + (t.done ? 'ביטול סימון הביצוע' : 'סימון כבוצע') + '">' +
      '<span class="check">' + CHECK_MARK + '</span></button>' +
      '<div class="row-body">' +
      '<div class="row-title">' + esc(t.title) + '</div>' +
      '</div>' +
      rowWhen(t, late) +
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
          // Sprint 16 — only the shopping module writes amounts, but the row it
          // writes them onto is an ordinary checklist row, so רשימות shows them
          // rather than hiding half the line behind a module
          (it.qty ? '<span class="cl-qty">' + esc(it.qty) + '</span>' : '') +
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

  /**
   * The tasks a calendar pane draws for one day. Sprint 9 — a task ticked from
   * inside the day view or the agenda must stay in that pane too, so the board
   * predicate is the same one "לביצוע היום" uses: on the day, not cancelled.
   */
  function boardTasksOn(iso) {
    return pick('tasks')
      .filter(function (x) { return x.due === iso && (!isClosed(x.status) || awaitingArchive(x)); })
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
        tk += boardTasksOn(iso).length;
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
        var marks = eventsOn(iso).concat(boardTasksOn(iso));
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

      var tasks = boardTasksOn(iso);

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
        var evs = eventsOn(iso), tks = boardTasksOn(iso);
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
      if (this.view === 'day') return recKeys('tasks', boardTasksOn(this.anchor));
      if (this.view !== 'agenda') return null;

      var iso = this.anchor, out = [];
      for (var i = 0; i < AGENDA_DAYS; i++) {
        out = out.concat(recKeys('events', eventsOn(iso)), recKeys('tasks', boardTasksOn(iso)));
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
      setText($('#calendarMeta'), this.meta());
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

  /**
   * The tasks the list is currently showing, in the order it shows them.
   *
   * בקרוב is the one tab that is not sorted like a board: it is read forwards
   * through time, so priority may only break a tie inside a single day. Every
   * other tab keeps the ranking it has always had.
   */
  function shownTasks() {
    var tab = taskTab(), today = todayISO();
    var rows = pick('tasks').filter(function (x) { return taskMatchesTab(x, tab, today); });
    return tab === 'upcoming' ? sortByDate(rows) : sortTasks(rows);
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

    setText($('#tasksTitle'), 'משימות · ' + (TASK_TAB_LABEL[tab] || TASK_TAB_LABEL.all));

    if (!quiet) {
      $('#tasksList').innerHTML = shown.length
        ? tasksHTML(shown, tab, today)
        : emptyState('אין משימות בתצוגה הזו', TASK_TAB_EMPTY[tab] || TASK_TAB_EMPTY.all);
    }

    setText($('#tasksMeta'), all.length
      ? all.filter(function (t) { return !isClosed(t.status); }).length + ' פתוחות מתוך ' + all.length
      : '');
  }

  /**
   * בקרוב is drawn as a chronology — a caption per day-band, then that day's
   * rows. The captions carry no data-rec, so the membership engine still reads
   * exactly the same key list shownTasks() promised it.
   */
  function tasksHTML(rows, tab, today) {
    if (tab !== 'upcoming') {
      return rows.map(function (t) { return taskRow(t); }).join('');
    }
    var band = null;
    return rows.map(function (t) {
      var next = upcomingBand(t.due, today);
      var head = next === band ? '' : '<div class="up-band">' + esc(next) + '</div>';
      band = next;
      return head + taskRow(t);
    }).join('');
  }

  /* ------------------------ the three workspaces of the משימות screen (§2) */

  function workspace() { return Store.data.prefs.workspace; }

  function setWorkspace(w) {
    if (WORK_TABS.indexOf(w) === -1) w = 'tasks';
    Store.data.prefs.workspace = w;
    Store.save();
    if (UI.view !== 'tasks') { setView('tasks'); return; }   // setView() repaints
    render();
    window.scrollTo(0, 0);
  }

  /**
   * פתקים ורשימות is an area of its own now (mandate §2), not two blocks
   * stacked under a task list that already fills the screen. The switch is a
   * segmented control at the top of the משימות screen; only the chosen
   * workspace's blocks are on screen, and the quick sub-tabs belong to
   * משימות alone.
   */
  function renderWorkspace() {
    var w = workspace();

    $$('.work-tabs [data-work]').forEach(function (b) {
      var on = b.dataset.work === w;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    setText($('#workCount_tasks'), String(openTasks().length));
    setText($('#workCount_lists'), String(pick('lists').length));
    setText($('#workCount_notes'), String(pick('notes').length));

    $$('#view-tasks [data-workpane]').forEach(function (pane) {
      pane.hidden = pane.dataset.workpane !== w;
    });

    var title = $('#viewTitle');
    if (title && UI.view === 'tasks') title.textContent = WORK_TITLE[w] || WORK_TITLE.tasks;
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
    setText($('#listsMeta'), lists.length
      ? plural(lists.length, 'רשימה אחת', 'רשימות') + ' · ' + done + '/' + items + ' הושלמו'
      : '');
  }

  function listRow(l) {
    var p = listProgress(l);
    var complete = p.total > 0 && p.done === p.total;

    return '<div class="row list' + (complete ? ' is-complete' : '') +
      pickCls('lists', l.id) + '" data-rec="lists:' + l.id + '">' +
      selBox('lists', l.id) +
      '<div class="row-body">' +
      '<div class="row-title">☰ ' + esc(l.title) + '</div>' +
      '<div class="row-meta">' + catTag(l.category) +
      (l.date
        ? '<span class="badge dated">' + esc(relDay(l.date)) + '</span>'
        : '<span class="badge timeless">ללא תאריך</span>') +
      (complete ? '<span class="badge st-done">הרשימה הושלמה</span>' : '') +
      clientChip(l.clientId) +
      '</div>' +
      (p.total
        ? checklist(p, l.items, 'listitem', l.id)
        : '<div class="row-meta">רשימה ריקה</div>') +
      '</div>' +
      editBtn('lists', l.id) +
      delBtn('lists', l.id) +
      '</div>';
  }

  /**
   * The CRM link, worn by the record that carries it (mandate §2c). It is a
   * label, not a control: the client file is one tap away through לקוחות, and
   * a second way in from inside a note row would compete with tap-to-edit.
   */
  function clientChip(clientId) {
    var c = clientId ? Store.find('clients', clientId) : null;
    if (!c) return '';
    return '<span class="badge linked">☺ ' + esc(c.name || 'לקוח') + '</span>';
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
    setText($('#notesMeta'), notes.length
      ? plural(notes.length, 'פתק אחד', 'פתקים') + (pinned ? ' · ' + pinned + ' מוצמדים' : '')
      : '');
  }

  function noteRow(n) {
    return '<div class="row note' + (n.pinned ? ' is-pinned' : '') +
      pickCls('notes', n.id) + '" data-rec="notes:' + n.id + '">' +
      selBox('notes', n.id) +
      '<div class="row-body">' +
      '<div class="row-title">' + (n.pinned ? '📌 ' : '✎ ') + esc(n.title || 'פתק') + '</div>' +
      '<div class="row-meta">' + catTag(n.category) +
      (n.pinned ? '<span class="badge pinned">מוצמד</span>' : '') +
      clientChip(n.clientId) + '</div>' +
      '<p class="note-body">' + esc(n.body || '') + '</p>' +
      '<div class="quick-acts">' +
      '<button type="button" class="mini" data-pin="' + n.id + '">' +
      (n.pinned ? '📌 בטל הצמדה' : '📌 הצמד למעלה') + '</button>' +
      '<button type="button" class="mini" data-convert="task:' + n.id + '">➜ הפוך למשימה</button>' +
      '<button type="button" class="mini" data-convert="event:' + n.id + '">➜ הפוך לאירוע</button>' +
      '</div>' +
      '</div>' +
      editBtn('notes', n.id) +
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
      (clientNeedsAction(c) ? ' is-missing' : '') +
      // a closed file is finished work and recedes exactly like a done task
      (clientClosed(c) ? ' is-closed' : '') +
      pickCls('clients', c.id) + '" data-rec="clients:' + c.id + '">' +
      selBox('clients', c.id) +
      '<button type="button" class="cl-open" data-clientopen="' + c.id + '"' +
      ' aria-label="' + esc('פתיחת תיק הלקוח ' + (c.name || '')) + '">' +
      '<span class="cl-name">' + safeName + '</span>' +
      '<span class="cl-badges">' + clientStatusBadge(c) + catTag(normCat(c.category)) + '</span>' +
      '<span class="cl-contact">' + (contact ? esc(contact) : 'אין פרטי קשר') + '</span>' +
      '<span class="cl-interest">' +
      esc(c.interest ? 'מתעניין ב־' + c.interest : 'טרם הוגדר תחום עניין') + '</span>' +
      nextActionLine(c) +
      '</button>' +
      '<div class="cl-acts">' + contactButtons(c, 'mini') +
      editBtn('clients', c.id) + delBtn('clients', c.id) + '</div>' +
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
    setText($('#clientsMeta'), all.length
      ? all.length + ' לקוחות · ' + pendingFollowUps().length + ' במעקב' +
      (missing ? ' · ' + missing + ' ללא פעולה הבאה' : '')
      : '');
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

  /**
   * The ✓ that draws itself (Sprint 8). It is always in the DOM — a glyph
   * swapped in at completion time can only ever appear, never draw. CSS holds
   * the path hidden behind its own stroke-dash and releases it the moment the
   * row carries .is-completing or .is-done, so the same markup covers the
   * gesture, the finished state and a page reloaded on an already-done task.
   */
  var CHECK_MARK =
    '<svg class="check-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M5 12.5 10.5 18 19 6.5" fill="none" stroke="currentColor" stroke-width="3.2"' +
    ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function delBtn(collection, id) {
    return '<button type="button" class="sheet-x" data-del="' + collection + ':' + id + '" aria-label="מחיקה">✕</button>';
  }

  /**
   * Universal edit affordance (Wave 2). Every card in the app — event, task,
   * list, note, client — opens the SAME typed form it was created with,
   * pre-filled, and saves back into the same record.
   */
  function editBtn(collection, id) {
    return '<button type="button" class="row-edit" data-edit="' + collection + ':' + id +
      '" aria-label="עריכה">✎</button>';
  }

  /** the checkbox itself — one shape, wherever a selection is live */
  function selBoxHTML(picked) {
    return '<span class="sel-box' + (picked ? ' is-picked' : '') + '" aria-hidden="true">' +
      (picked ? '✓' : '') + '</span>';
  }

  /** the checkbox a card grows while selection mode is live (Wave 3) */
  function selBox(collection, id) {
    if (!Select.on) return '';
    return selBoxHTML(Select.has(collection + ':' + id));
  }

  /** ...and the classes that go with it, so the whole card reads as picked */
  function pickCls(collection, id) {
    if (!Select.on) return '';
    return ' is-pickable' + (Select.has(collection + ':' + id) ? ' is-picked' : '');
  }

  function emptyState(title, hint) {
    return '<div class="empty"><b>' + esc(title) + '</b>' + esc(hint) + '</div>';
  }

  /* --------------------------------------------------- render: סל מחזור */

  /**
   * One binned record: what it was, what it was called, how long it has left
   * and the two things that can still be done to it. The countdown badge turns
   * urgent in its last 48 hours — a bin you never look at is a bin that
   * silently loses things.
   */
  function trashRow(entry, now) {
    var days = trashDaysLeft(entry, now);
    var title = recTitle(entry.collection, entry.rec) || 'ללא כותרת';
    var done = trashDone(entry);
    var picked = TrashSel.on && TrashSel.has(entry.id);

    return '<div class="trash-row' + (done ? ' is-done' : '') +
      (TrashSel.on ? ' is-pickable' : '') + (picked ? ' is-picked' : '') +
      '" data-trashid="' + entry.id + '">' +
      (TrashSel.on ? selBoxHTML(picked) : '') +
      '<div class="trash-body">' +
      '<div class="trash-title">' + esc(title) + '</div>' +
      '<div class="trash-meta">' +
      '<span class="badge">' + esc(TRASH_LABEL[entry.collection] || 'פריט') + '</span>' +
      // a task that was already finished when it was deleted still reads as
      // finished — the struck title is never the only carrier of that
      (done ? '<span class="badge st-done">בוצע</span>' : '') +
      '<span class="badge ' + (days <= 2 ? 'pr-high' : 'timeless') + '">' +
      esc(retentionCountdown(days)) + '</span>' +
      '</div></div>' +
      // while a selection is live the ROW is the control: leaving the two
      // per-row buttons in would let one finger restore a record it meant
      // to tick, in a list where every tap is supposed to be a pick
      (TrashSel.on ? '' :
        '<div class="trash-acts">' +
        '<button type="button" class="mini" data-trash="restore:' + entry.id + '">↺ שחזר</button>' +
        '<button type="button" class="mini is-danger" data-trash="purge:' + entry.id +
        '">🗑 מחק לצמיתות</button>' +
        '</div>') +
      '</div>';
  }

  /**
   * The pill badge is cheap and always current. The LIST is only rewritten
   * while the sheet is actually open (Sprint 9): rebuilding a dialog nobody can
   * see cost a full innerHTML — and a re-run of every row's entrance animation
   * — on every single tap in the app.
   */
  function renderTrash() {
    var rows = trashList();
    var now = Date.now();

    var badge = $('#trashCount');
    if (badge) {
      badge.textContent = rows.length;
      badge.hidden = !rows.length;
    }
    var btn = $('#trashBtn');
    if (btn) btn.classList.toggle('is-full', !!rows.length);

    var box = $('#trashList');
    var sheet = $('#trashSheet');
    if (box && (!sheet || !sheet.hidden)) {
      box.innerHTML = rows.length
        ? rows.map(function (e) { return trashRow(e, now); }).join('')
        : emptyState('סל המחזור ריק',
          'כל פריט שתמחק ימתין כאן ' + TRASH_DAYS + ' ימים לפני שיימחק לצמיתות.');
    }
    // an empty bin has nothing to select: the mode closes with the last row
    if (TrashSel.on && !rows.length) TrashSel.exit();

    // ריקון הסל is offered only when there is a bin to empty and no selection
    // narrowing the target — while בחירה מרובה is live the batch bar's
    // מחיקה לצמיתות is the one destructive button on screen
    var tools = $('#trashTools');
    if (tools) tools.hidden = !rows.length || TrashSel.on;

    TrashSel.paint();
    return rows.length;
  }

  /* ------------------------------------------- render: היסטוריה (Sprint 9) */

  /**
   * The prominent batch-archive control. It carries the count in its own label,
   * so the promise ("3 will move") and the act are the same object, and it is
   * absent — not merely disabled — when there is nothing finished to file.
   */
  function archiveBarHTML(n) {
    return '<button type="button" class="btn btn-gold archive-btn" data-action="archive-done">' +
      '<span class="archive-ico" aria-hidden="true">📥</span>' +
      '<span class="archive-text">' + ARCHIVE_LABEL + '</span>' +
      '<b class="archive-n">' + n + '</b></button>';
  }

  /**
   * Painted into every place a finger finishes a task — My Day and the tasks
   * view — off the same state, so the two can never disagree.
   */
  function renderArchiveBar() {
    var n = doneUnfiled().length;
    ['#archiveBarToday', '#archiveBarTasks'].forEach(function (sel) {
      var box = $(sel);
      if (!box) return;
      box.hidden = !n;
      // the markup only changes when the count does — a rewrite on every tap
      // would restart the button's transition mid-press
      var next = n ? archiveBarHTML(n) : '';
      if (box.innerHTML !== next) box.innerHTML = next;
    });
    return n;
  }

  /** one filed task: what it was called, how long it has left, and the way back */
  function archiveRow(entry, now) {
    var days = archiveDaysLeft(entry, now);
    var title = recTitle('tasks', entry.rec) || 'ללא כותרת';

    return '<div class="trash-row arch-row" data-archid="' + entry.id + '">' +
      '<div class="trash-body">' +
      '<div class="trash-title">✓ ' + esc(title) + '</div>' +
      '<div class="trash-meta">' +
      '<span class="badge st-done">בוצע</span>' +
      (entry.rec && entry.rec.category ? catTag(normCat(entry.rec.category)) : '') +
      '<span class="badge ' + (days <= 2 ? 'pr-high' : 'timeless') + '">' +
      esc(retentionCountdown(days)) + '</span>' +
      '</div></div>' +
      '<div class="trash-acts">' +
      '<button type="button" class="mini" data-arch="restore:' + entry.id + '">↺ שחזר</button>' +
      '<button type="button" class="mini is-danger" data-arch="purge:' + entry.id +
      '">🗑 מחק לצמיתות</button>' +
      '</div></div>';
  }

  function renderArchive() {
    var rows = archiveList();
    var now = Date.now();

    var box = $('#archiveList');
    if (box) {
      box.innerHTML = rows.length
        ? rows.map(function (e) { return archiveRow(e, now); }).join('')
        : emptyState('ההיסטוריה ריקה',
          'משימות שתסמן כבוצעו ותעביר לכאן ימתינו ' + ARCHIVE_DAYS +
          ' ימים לפני שיימחקו לצמיתות.');
    }
    var meta = $('#archiveMeta');
    if (meta) {
      meta.textContent = rows.length
        ? plural(rows.length, 'משימה אחת', 'משימות') + ' בהיסטוריה'
        : '';
    }
    return rows.length;
  }

  /* ------------------------------------------------------------ render: all */

  /** the full repaint — view switches, filter changes, boot, a cloud merge */
  function render() {
    renderSummary();
    renderAttention();
    renderTimeline();
    renderTodo();
    renderUpcoming();
    renderCalendar();
    renderWorkspace();
    renderTasks();
    renderLists();
    renderNotes();
    renderClients();
    renderDrawer();
    renderTrash();
    renderArchive();
    renderArchiveBar();
    renderOpenSheet();
    Shop.paint();
    if (Detail.isOpen()) Detail.paint();
    if (Settings.isOpen()) Settings.paint();
    Sync.paint();
    $('#todayLabel').textContent = hebDate(todayISO());
    $('#railUserName').textContent = OWNER.name;
    markEntering();
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

  /* --------------------------------------------------------------------------
     Sprint 9 · the shake

     `.row, .ev { animation: card-in }` used to be unconditional, and every
     repaint is a DOM INSERTION: Patch.record() swaps a node's outerHTML, so a
     status chip, a checklist tick, a selection tap — anything at all — re-ran
     the 7px entrance slide on the card under the finger. A membership change
     re-ran it on every card in the container at once. That was the shaking.

     The animation now belongs to `.is-entering`, which is never in any markup
     string and can therefore only be granted here, to a record key that was not
     on screen the last time we looked. A card being *rewritten* is by definition
     already on screen, so it holds perfectly still.

     Cheap on purpose: one querySelectorAll over the cards already in the
     document, no layout read, and it runs after the paint work, not during it.
     -------------------------------------------------------------------------- */

  /** the record keys that were on screen at the end of the last paint */
  var SEEN = {};

  function markEntering() {
    var next = {};
    $$('[data-rec]').forEach(function (node) {
      var key = node.dataset ? node.dataset.rec : '';
      if (!key) return;
      next[key] = 1;
      if (!SEEN[key] && node.classList) node.classList.add('is-entering');
    });
    SEEN = next;
    return next;
  }

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
      keys: timelineKeys },                      // paint order, not sort order (B0)
    { view: 'today', sel: '#todoToday', draw: renderTodo,
      keys: function () { return recKeys('tasks', unscheduledToday()); } },
    // Sprint 10 — the widget is a list container like any other, so a task that
    // leaves the week (or gains a date) makes it rebuild, and nothing else does
    { view: 'today', sel: '#upcomingList', draw: renderUpcoming,
      keys: function () { return recKeys('tasks', upcomingWidget()); } },
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
      // cheap, idempotent, and the count it carries is derived state like any
      // other counter — a task ticked anywhere must offer to be filed
      renderArchiveBar();
      // the workspace counters are derived state too, and setting `hidden` on a
      // pane that is already hidden costs nothing and touches no list container
      renderWorkspace();

      SECTIONS.forEach(function (s) {
        if (UI.view !== s.view) return;          // off-screen: setView() will redraw it
        s.draw(sameKeys(domKeys(s.scope || s.sel), s.keys()));
      });

      renderDrawer(sameKeys(domKeys('#drawerBody'), Drawer.keys()));
      /* Sprint 12 — the two new sheets are list surfaces like any other, and
         they obey the same rule: derived text always, a container rebuild only
         where MEMBERSHIP moved. Both decline to paint while they are closed. */
      renderOpenSheet(sameKeys(domKeys('#openList'), openKeys()));
      // Sprint 16 — the shopping module is a list surface too, and it obeys the
      // same rule: while it is closed this collapses to one line of counter text
      // on the היום שלי door, and touches nothing else
      Shop.paint();
      if (Detail.isOpen()) Detail.paint();
      Sync.paint();
      markEntering();
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

  /* ==========================================================================
     סל מחזור — the 10-day recycle bin (Sprint 8)

     Sprint 7 gave a deletion five seconds of regret. Five seconds only covers
     the tap you knew was wrong the instant you made it; it does nothing for
     the one you notice on Thursday. The bin is the second, slower net:

       delete  →  the record leaves its collection at once (every view is
                  honest immediately) and lands in Store.data.trash with the
                  slot it came from and the moment it left
       10 days →  it can be restored into that exact slot, or destroyed early
       after   →  purgeTrash() drops it on the next app start, for good

     The cloud half needs no new schema. A record that leaves its collection is
     already diffed into the outbox as a tombstone, and D1 already carries a
     deleted_at column on every table (migration 0001) — the server marks it
     deleted the moment the bin accepts it. A restore calls touch(), so the
     queued tombstone is REPLACED by an upsert and the row comes back to life
     on every device. The bin itself is deliberately local: it is a client-side
     grace period over a deletion the cloud has already recorded.

     Every function here is pure store work — no DOM, no toast, no timer — so
     healthcheck.js can drive a whole delete → count-down → restore → purge
     cycle head-lessly.
     ========================================================================== */

  /** whatever localStorage handed back, made safe to render */
  function normTrash(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (e) {
      return e && typeof e === 'object' &&
        e.rec && typeof e.rec === 'object' &&
        typeof e.id === 'string' && e.id &&
        SELECTABLE.indexOf(e.collection) !== -1;
    }).map(function (e) {
      return {
        collection: e.collection,
        id: e.id,
        rec: e.rec,
        index: typeof e.index === 'number' && e.index >= 0 ? e.index : 0,
        // an entry with no stamp is treated as deleted right now rather than
        // as infinitely old: losing a record to a corrupt field is worse than
        // holding it ten days too long
        deletedAt: typeof e.deletedAt === 'number' && e.deletedAt > 0 ? e.deletedAt : Date.now()
      };
    });
  }

  /* ---- the retention clock, shared by סל מחזור and היסטוריה (Sprint 9) ---- */

  /** milliseconds left before an auto-purge takes an entry stamped at `stamp` */
  function retentionLeftMs(stamp, days, now) {
    if (typeof stamp !== 'number' || !(stamp > 0)) return 0;
    return (stamp + days * DAY_MS) - (typeof now === 'number' ? now : Date.now());
  }

  /**
   * The number a countdown badge shows. Rounded UP, so the day the entry
   * arrived reads "בעוד 10 ימים" and the final day reads "בעוד יום אחד" — the
   * count never claims more time than the entry actually has.
   */
  function retentionDaysLeft(stamp, days, now) {
    var left = retentionLeftMs(stamp, days, now);
    return left <= 0 ? 0 : Math.ceil(left / DAY_MS);
  }

  /** milliseconds left before the auto-purge takes this entry */
  function trashLeftMs(entry, now) {
    return entry ? retentionLeftMs(entry.deletedAt, TRASH_DAYS, now) : 0;
  }

  function trashDaysLeft(entry, now) {
    return entry ? retentionDaysLeft(entry.deletedAt, TRASH_DAYS, now) : 0;
  }

  function trashExpired(entry, now) { return trashLeftMs(entry, now) <= 0; }

  /** "יימחק לצמיתות בעוד 10 ימים" — one sentence, both drawers (Sprint 9) */
  function retentionCountdown(days) {
    if (days <= 0) return 'יימחק לצמיתות היום';
    if (days === 1) return 'יימחק לצמיתות בעוד יום אחד';
    return 'יימחק לצמיתות בעוד ' + days + ' ימים';
  }

  function trashRows() {
    var d = Store.data;
    return d && Array.isArray(d.trash) ? d.trash : [];
  }

  /** newest deletion first — what was just lost is what is looked for */
  function trashList() {
    return trashRows().slice().sort(function (a, b) { return b.deletedAt - a.deletedAt; });
  }

  function trashFind(id) {
    return trashRows().filter(function (e) { return e.id === id; })[0] || null;
  }

  function trashCount() { return trashRows().length; }

  /** everything past its ten days leaves — returns how many went */
  function purgeTrash(now) {
    var d = Store.data;
    if (!d || !Array.isArray(d.trash)) return 0;
    var before = d.trash.length;
    d.trash = d.trash.filter(function (e) { return !trashExpired(e, now); });
    return before - d.trash.length;
  }

  /**
   * The record moved out of its collection and into the bin. Caller owns the
   * splice out of the live list and the Store.save() — this is the bookkeeping
   * only, so one save covers the whole move.
   */
  function trashPut(collection, rec, index, now) {
    var d = Store.data;
    if (!d || !rec || SELECTABLE.indexOf(collection) === -1) return null;
    if (!Array.isArray(d.trash)) d.trash = [];

    var entry = {
      collection: collection,
      id: rec.id,
      rec: rec,
      index: typeof index === 'number' && index >= 0 ? index : 0,
      deletedAt: typeof now === 'number' ? now : Date.now()
    };
    // one entry per record: deleting, restoring and deleting again must not
    // leave two rows in the bin racing each other to purge
    for (var i = 0; i < d.trash.length; i++) {
      if (d.trash[i].id === entry.id) { d.trash[i] = entry; return entry; }
    }
    d.trash.push(entry);
    return entry;
  }

  /** [שחזר] — back into its own collection, in the slot it left */
  function trashRestore(id) {
    var d = Store.data;
    var entry = trashFind(id);
    if (!entry) return null;

    d.trash.splice(d.trash.indexOf(entry), 1);

    var live = d[entry.collection];
    // a record the cloud already pushed back is not restored twice
    if (live && !Store.find(entry.collection, entry.id)) {
      // the newer stamp is what makes the outbox REPLACE the tombstone it
      // queued with an upsert — without it the restore would sync as a delete
      touch(entry.rec);
      live.splice(Math.min(entry.index, live.length), 0, entry.rec);
    }
    Store.save();
    return entry;
  }

  /**
   * [מחק לצמיתות] — the record left its collection when it was binned and its
   * tombstone is already queued, so dropping the entry IS the permanent
   * deletion. Nothing else in the app can reach it afterwards.
   */
  function trashPurge(id) {
    var d = Store.data;
    var entry = trashFind(id);
    if (!entry) return null;
    d.trash.splice(d.trash.indexOf(entry), 1);
    Store.save();
    return entry;
  }

  /**
   * ריקון סל המחזור — every entry at once. Each record left its collection
   * when it was binned and its tombstone is already queued, so emptying the
   * bin is exactly trashPurge() over the whole list: dropping the entries IS
   * the permanent deletion. Returns how many went, so the caller can say it.
   */
  function emptyTrash() {
    var d = Store.data;
    if (!d || !Array.isArray(d.trash) || !d.trash.length) return 0;
    var gone = d.trash.length;
    d.trash = [];
    Store.save();
    return gone;
  }

  /**
   * A binned task that was already finished when it was deleted. `בוטל` is not
   * `בוצע` — a cancelled task was abandoned, not completed — so this reads the
   * one status rather than the whole closed set.
   */
  function trashDone(entry) {
    if (!entry || entry.collection !== 'tasks' || !entry.rec) return false;
    return normStatus(entry.rec.status) === 'done' || entry.rec.done === true;
  }


  /* ==========================================================================
     היסטוריה — the completed-tasks log (Sprint 9)

     The bin is where a MISTAKE waits. This is where FINISHED WORK waits, and it
     is a different thing, so it is a different log:

       tick     →  the task is done and stays exactly where it is, struck
                   through and dimmed. Nothing moves. Nothing is filed.
       archive  →  the user presses "העבר משימות שבוצעו להיסטוריה" and every
                   completed task on screen moves into the log at once, with
                   the slot it came from
       10 days  →  it can be restored into that exact slot, or destroyed early
       after    →  purgeArchive() drops it on the next app start, for good

     Deliberately the same shape and the same clock as the bin — one mental
     model, two drawers — but never the same list: restoring from היסטוריה must
     not read as undoing a deletion, and emptying the bin must not throw away a
     month of finished work.

     Every function here is pure store work, so healthcheck.js can drive a whole
     tick → archive → count-down → restore → purge cycle head-lessly.
     ========================================================================== */

  /** whatever localStorage handed back, made safe to render */
  function normArchive(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (e) {
      return e && typeof e === 'object' &&
        e.rec && typeof e.rec === 'object' &&
        typeof e.id === 'string' && e.id &&
        e.collection === 'tasks';
    }).map(function (e) {
      return {
        collection: 'tasks',
        id: e.id,
        rec: e.rec,
        index: typeof e.index === 'number' && e.index >= 0 ? e.index : 0,
        // a stamp-less entry is treated as filed right now rather than as
        // infinitely old: losing finished work to a corrupt field is worse
        // than holding it ten days too long
        archivedAt: typeof e.archivedAt === 'number' && e.archivedAt > 0 ? e.archivedAt : Date.now()
      };
    });
  }

  function archiveLeftMs(entry, now) {
    return entry ? retentionLeftMs(entry.archivedAt, ARCHIVE_DAYS, now) : 0;
  }

  function archiveDaysLeft(entry, now) {
    return entry ? retentionDaysLeft(entry.archivedAt, ARCHIVE_DAYS, now) : 0;
  }

  function archiveExpired(entry, now) { return archiveLeftMs(entry, now) <= 0; }

  function archiveRows() {
    var d = Store.data;
    return d && Array.isArray(d.archive) ? d.archive : [];
  }

  /** newest first — what was just filed is what is looked for */
  function archiveList() {
    return archiveRows().slice().sort(function (a, b) { return b.archivedAt - a.archivedAt; });
  }

  function archiveFind(id) {
    return archiveRows().filter(function (e) { return e.id === id; })[0] || null;
  }

  function archiveCount() { return archiveRows().length; }

  /** everything past its ten days leaves — returns how many went */
  function purgeArchive(now) {
    var d = Store.data;
    if (!d || !Array.isArray(d.archive)) return 0;
    var before = d.archive.length;
    d.archive = d.archive.filter(function (e) { return !archiveExpired(e, now); });
    return before - d.archive.length;
  }

  /**
   * File ONE task. Caller owns the splice out of the live list and the save —
   * this is the bookkeeping only, so archiving a whole batch costs one save.
   */
  function archivePut(rec, index, now) {
    var d = Store.data;
    if (!d || !rec) return null;
    if (!Array.isArray(d.archive)) d.archive = [];

    var entry = {
      collection: 'tasks',
      id: rec.id,
      rec: rec,
      index: typeof index === 'number' && index >= 0 ? index : 0,
      archivedAt: typeof now === 'number' ? now : Date.now()
    };
    // one entry per record: filing, restoring and filing again must not leave
    // two rows in the log racing each other to purge
    for (var i = 0; i < d.archive.length; i++) {
      if (d.archive[i].id === entry.id) { d.archive[i] = entry; return entry; }
    }
    d.archive.push(entry);
    return entry;
  }

  /**
   * The button. Every completed task the CURRENT VIEW is showing moves into the
   * log in one move — the global category filter is respected, so what the
   * count promises is exactly what leaves (§0.3).
   *
   * Records are spliced back to front so every recorded slot is still the slot
   * the record actually came from by the time the next splice runs, and the
   * whole batch arms ONE undo entry that puts all of them back.
   */
  function archiveDone(now) {
    var rows = doneUnfiled();
    if (!rows.length) return null;

    var live = Store.data.tasks;
    var slots = [];
    rows.forEach(function (rec) {
      var at = live.indexOf(rec);
      if (at !== -1) slots.push({ id: rec.id, rec: rec, index: at });
    });
    if (!slots.length) return null;

    slots.slice().sort(function (a, b) { return b.index - a.index; })
      .forEach(function (s) { live.splice(s.index, 1); });
    slots.forEach(function (s) { archivePut(s.rec, s.index, now); });
    Store.save();

    var entry = { count: slots.length, ids: slots.map(function (s) { return s.id; }) };

    Undo.arm(
      {
        collection: 'archive', id: '', index: -1, count: slots.length,
        label: slots.length === 1 ? 'המשימה' : slots.length + ' משימות'
      },
      function () {
        // ascending, so each task lands back in its own slot rather than
        // shifting the ones that follow it
        slots.slice().sort(function (a, b) { return a.index - b.index; })
          .forEach(function (s) { archiveRestore(s.id); });
        Store.save();
      }
    );

    return entry;
  }

  /** [שחזר] — back into the task list, in the slot it left, open for work again */
  function archiveRestore(id) {
    var d = Store.data;
    var entry = archiveFind(id);
    if (!entry) return null;

    d.archive.splice(d.archive.indexOf(entry), 1);

    var live = d.tasks;
    // a record the cloud already pushed back is not restored twice
    if (live && !Store.find('tasks', entry.id)) {
      // the newer stamp is what makes the outbox REPLACE the tombstone it
      // queued with an upsert — without it the restore would sync as a delete
      touch(entry.rec);
      live.splice(Math.min(entry.index, live.length), 0, entry.rec);
    }
    Store.save();
    return entry;
  }

  /**
   * [מחק לצמיתות] — the task left its collection when it was filed and its
   * tombstone is already queued, so dropping the entry IS the permanent
   * deletion. Nothing else in the app can reach it afterwards.
   */
  function archivePurge(id) {
    var d = Store.data;
    var entry = archiveFind(id);
    if (!entry) return null;
    d.archive.splice(d.archive.indexOf(entry), 1);
    Store.save();
    return entry;
  }

  /**
   * Remove a record and arm its undo. Pure store work — no DOM, no toast — so
   * the healthcheck can drive the whole delete/restore cycle head-lessly.
   *
   * Sprint 8 — the record now lands in סל מחזור on the way out, so the five
   * second אחזר window and the ten day bin are the same single move seen at
   * two timescales. Undo simply restores from the bin.
   */
  function softDelete(collection, id) {
    var list = Store.data && Store.data[collection];
    if (!list) return null;

    var index = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { index = i; break; } }
    if (index === -1) return null;

    var rec = list[index];
    list.splice(index, 1);
    trashPut(collection, rec, index);
    Store.save();

    var entry = { collection: collection, id: id, index: index, label: DELETED_LABEL[collection] || 'הפריט' };

    Undo.arm(entry, function () { trashRestore(id); });

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
      // Wave 1 · B2 — re-resolve the client instead of closing over the object.
      // Sync.merge() REPLACES a record whose server copy is newer
      // (arr[arr.indexOf(local)] = incoming), so a cloud round-trip landing
      // inside the five-second window left this closure holding a detached
      // copy: the note was pushed back into an object nothing renders and the
      // restore silently did nothing.
      var live = Store.find('clients', clientId);
      if (!live) return;
      var rows = Array.isArray(live.clientNotes) ? live.clientNotes : [];
      if (rows.some(function (n) { return n.id === noteId; })) return;   // already back
      rows.splice(Math.min(index, rows.length), 0, note);
      live.clientNotes = rows;
      touch(live);
      Store.save();
    });

    return entry;
  }

  /**
   * The same safety net over a whole selection (Wave 3). One Undo entry holds
   * every record with the slot it left, so אחזר puts the entire batch back
   * where it was — in one tap, in the original order.
   */
  function softDeleteMany(keys) {
    var slots = [];

    (Array.isArray(keys) ? keys : []).forEach(function (key) {
      var parts = String(key).split(':');
      var list = Store.data && Store.data[parts[0]];
      if (!list || SELECTABLE.indexOf(parts[0]) === -1) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === parts[1]) {
          slots.push({ collection: parts[0], id: parts[1], index: i, rec: list[i] });
          return;
        }
      }
    });

    if (!slots.length) return null;

    // remove from the back forwards, so every recorded slot is still the slot
    // the record actually came from by the time the next splice runs
    slots.slice().sort(function (a, b) { return b.index - a.index; })
      .forEach(function (s) { Store.data[s.collection].splice(s.index, 1); });
    // ...and every one of them lands in סל מחזור, exactly like a single row
    slots.forEach(function (s) { trashPut(s.collection, s.rec, s.index); });
    Store.save();

    var entry = {
      collection: 'batch', id: '', index: -1, count: slots.length,
      keys: slots.map(function (s) { return s.collection + ':' + s.id; }),
      label: slots.length + ' פריטים'
    };

    Undo.arm(entry, function () {
      // ascending, so each record lands back in its own slot rather than
      // shifting the ones that follow it
      slots.slice().sort(function (a, b) { return a.index - b.index; })
        .forEach(function (s) { trashRestore(s.id); });
      Store.save();
    });

    return entry;
  }

  /* ==========================================================================
     The completion gesture (Sprint 8)

     Tapping the empty circle used to close the task, save, repaint and toast
     inside one synchronous tick: by the time the finger lifted, the row had
     already dimmed, re-sorted and — in "לביצוע היום" — left the list entirely.
     The most satisfying moment in the app was invisible.

     It is now a 400ms gesture with three simultaneous channels:

       see    the ✓ draws itself inside the circle (an SVG path released from
              its stroke-dash) and a line sweeps across the title while the
              card dims — .is-completing, painted on the live node
       feel   a dual haptic pulse [15,30,15], fired at the START so the buzz
              lands with the drawing, not after it
       then   the store moves, the card slides into "הושלם", the toast lands

     plan() is pure and takes only the task: un-checking a finished task is NOT
     a celebration and skips the whole gesture, which is what stops the animation
     from running backwards. run() is the only part that touches a timer, and it
     degrades to a straight synchronous commit when nothing is on screen — so
     the headless path and the finger path delete and complete identically.
     ========================================================================== */

  var Complete = {
    /** id → timer, so a double tap cannot schedule two commits */
    pending: {},

    /**
     * What this tap should do. Pure: no DOM, no timer, no store.
     * @returns {{closing:boolean, delay:number, haptic:(number[]|null)}}
     */
    plan: function (task) {
      if (!task) return null;
      var closing = normStatus(task.status) !== 'done';
      return {
        closing: closing,
        delay: closing ? COMPLETE_MS : 0,
        haptic: closing ? HAPTIC_CHECK : null
      };
    },

    /** paint the gesture onto every node standing for this task, in place */
    paint: function (id) {
      var nodes = $$('[data-rec="tasks:' + id + '"]');
      nodes.forEach(function (n) {
        if (n.classList) n.classList.add('is-completing');
      });
      return nodes.length;
    },

    /** the whole gesture: draw, buzz, wait, then hand over to `commit` */
    run: function (task, commit) {
      var plan = Complete.plan(task);
      if (!plan || typeof commit !== 'function') return null;

      // re-opening a closed task is a correction, not an achievement: no
      // celebration, no delay, no second pulse
      if (!plan.closing) { commit(); return plan; }

      Haptics.check();
      var painted = Complete.paint(task.id);
      if (!painted) { commit(); return plan; }   // off screen — nothing to watch

      var id = task.id;
      if (Complete.pending[id]) clearTimeout(Complete.pending[id]);
      Complete.pending[id] = setTimeout(function () {
        delete Complete.pending[id];
        commit();
      }, plan.delay);
      return plan;
    }
  };

  /**
   * Collapse a card out of its list before the store moves under it (Sprint 8).
   *
   * Same contract as Complete.run(): with no matching node on screen the work
   * runs immediately and synchronously, so a headless caller — and every
   * healthcheck — sees the identical deletion semantics with no timer at all.
   */
  function leaveThen(keys, run) {
    var nodes = [];
    (Array.isArray(keys) ? keys : [keys]).forEach(function (key) {
      nodes = nodes.concat($$('[data-rec="' + key + '"]'));
    });

    if (!nodes.length) { run(); return false; }
    nodes.forEach(function (n) { if (n.classList) n.classList.add('is-leaving'); });
    setTimeout(run, LEAVE_MS);
    return true;
  }

  /* ==========================================================================
     Delete confirmation (Wave 2)

     Sprint 7's doctrine was "delete first, ask afterwards". The mandate asks
     explicitly — so the question is put BEFORE the record leaves, and the
     five-second אחזר window still arms behind it. A destructive tap now costs
     one deliberate confirmation, and even that stays recoverable.

     The module owns no markup decisions: ask() takes the sentence and the
     closure to run, which is what lets the same door serve one row, a client
     note and a whole batch.
     ========================================================================== */

  var Confirm = {
    pending: null,                        // { what, run } — one question at a time

    isOpen: function () { return Confirm.pending !== null; },

    /**
     * `opts` lets one caller reword the door without opening a second one:
     * ריקון הסל destroys a whole surface rather than a row, so it names that
     * surface in the question itself. Every field is reset on every ask, so a
     * reworded question can never leak into the next one.
     */
    ask: function (what, run, opts) {
      if (typeof run !== 'function') return null;
      var o = opts || {};
      Confirm.pending = { what: String(what == null ? '' : what), run: run };

      var title = $('#confirmTitle');
      var line = $('#confirmWhat');
      var yes = $('#confirmYes');
      if (title) title.textContent = o.title || CONFIRM_QUESTION;
      if (line) line.textContent = Confirm.pending.what;
      if (yes) yes.textContent = o.yes || CONFIRM_YES;
      openSheet('confirmSheet');
      return Confirm.pending;
    },

    /** כן, מחק */
    accept: function () {
      var p = Confirm.pending;
      Confirm.pending = null;
      if (!p) return false;
      p.run();
      return true;
    },

    /** ביטול · Esc · a tap on the backdrop — nothing is deleted */
    dismiss: function () {
      var had = Confirm.pending !== null;
      Confirm.pending = null;
      return had;
    }
  };

  function recTitle(collection, rec) {
    if (!rec) return '';
    if (collection === 'clients') return String(rec.name || '');
    return String(rec.title || rec.body || '');
  }

  /** the sentence under the question: "המשימה · לשלוח חוזה חתום" */
  function recSummary(collection, rec) {
    var label = DELETED_LABEL[collection] || 'הפריט';
    var title = recTitle(collection, rec).replace(/\s+/g, ' ').slice(0, 70);
    return title ? label + ' · ' + title : label;
  }

  /** the ONE door every destructive tap in the app goes through */
  function confirmDelete(what, run, opts) { return Confirm.ask(what, run, opts); }

  /* ==========================================================================
     Multi-select & batch actions (Wave 3)

     Selection mode is entered from the header pill or by long-pressing any
     card. While it is live every tap that lands on a card picks it instead of
     acting on it, the batch bar takes over the bottom of the screen, and a
     batch deletion arms ONE undo entry that puts every record back in the slot
     it came from.

     The state transitions below are pure (no DOM, no toast): the delegate is
     what repaints. That is what lets healthcheck.js drive a whole
     select → batch → undo cycle head-lessly.
     ========================================================================== */

  var Select = {
    on: false,
    picked: {},                  // { 'tasks:id': 1 } — namespaced, so types can mix
    swallow: false,              // the click that follows a long press is not a tap

    /* ---- pure state ---- */

    has: function (key) { return !!Select.picked[key]; },
    keys: function () { return Object.keys(Select.picked); },
    count: function () { return Select.keys().length; },

    toggle: function (key) {
      if (!key) return false;
      if (Select.picked[key]) delete Select.picked[key];
      else Select.picked[key] = 1;
      return Select.has(key);
    },

    enter: function (key) {
      Select.on = true;
      Select.picked = {};
      if (key) Select.picked[key] = 1;
      return Select.on;
    },

    exit: function () {
      Select.on = false;
      Select.picked = {};
      return Select.on;
    },

    /**
     * Every record key the ACTIVE view is showing, in the order it shows them —
     * read straight off the section registry, so "בחר הכל" can never disagree
     * with what is on screen. A pane that publishes null (the month and week
     * grids draw dots, not cards) simply offers nothing to select.
     */
    visibleKeys: function () {
      var out = [];
      SECTIONS.forEach(function (s) {
        if (s.view !== UI.view) return;
        var keys = s.keys();
        if (Array.isArray(keys)) out = out.concat(keys);
      });
      return out.filter(function (k) {
        return SELECTABLE.indexOf(String(k).split(':')[0]) !== -1;
      });
    },

    all: function () {
      Select.visibleKeys().forEach(function (k) { Select.picked[k] = 1; });
      return Select.count();
    },

    /**
     * Pure batch completion: closes every open task and fills every unfinished
     * checklist in the selection, and reports what it actually changed.
     */
    complete: function (keys) {
      var out = { tasks: 0, lists: 0 };

      (Array.isArray(keys) ? keys : []).forEach(function (key) {
        var p = String(key).split(':');
        var rec = Store.find(p[0], p[1]);
        if (!rec) return;

        if (p[0] === 'tasks') {
          if (isClosed(rec.status)) return;
          setTaskStatus(rec, 'done');
          touch(rec);
          out.tasks++;
          return;
        }
        if (p[0] === 'lists') {
          var items = Array.isArray(rec.items) ? rec.items : [];
          if (!items.length || !items.some(function (it) { return !it.done; })) return;
          items.forEach(function (it) { it.done = true; });
          touch(rec);
          out.lists++;
        }
      });

      if (out.tasks || out.lists) Store.save();
      return out;
    },

    /* ---- painting ---- */

    paint: function () {
      var n = Select.count();
      var bar = $('#batchBar');
      var count = $('#batchCount');
      var btn = $('#selectBtn');
      var label = $('#selectLabel');

      if (bar) bar.hidden = !Select.on;
      if (count) count.textContent = n ? n + ' נבחרו' : 'בחר פריטים';
      if (btn) {
        btn.classList.toggle('is-on', Select.on);
        btn.setAttribute('aria-pressed', Select.on ? 'true' : 'false');
      }
      if (label) label.textContent = Select.on ? SELECT_LABEL.on : SELECT_LABEL.off;
      if (document.body && document.body.classList) {
        document.body.classList.toggle('is-selecting', Select.on);
      }
      return n;
    },

    /** state + a full repaint: every card grows or loses its checkbox */
    setMode: function (on, key) {
      if (on) Select.enter(key); else Select.exit();
      Select.paint();
      render();
      return Select.on;
    },

    toggleMode: function () { return Select.setMode(!Select.on); },

    /* ---- input ---- */

    /** selection mode owns every tap that lands on a card */
    tap: function (target) {
      if (!Select.on || !target || !target.closest) return false;
      if (Select.swallow) { Select.swallow = false; return true; }   // the long press itself
      if (target.closest('#batchBar,.sheet,.drawer,.topbar,.tabbar,.rail,.toast,.settings')) return false;

      var node = target.closest('[data-rec]');
      var key = node && node.dataset ? node.dataset.rec : '';
      if (!key || SELECTABLE.indexOf(String(key).split(':')[0]) === -1) return false;

      Haptics.light();
      Select.toggle(key);
      var p = String(key).split(':');
      if (!Patch.record(p[0], p[1])) render();       // repaint that one card
      Select.paint();
      return true;
    },

    /** the batch bar: done · all · delete · exit */
    run: function (action) {
      if (action === 'exit') {
        Select.setMode(false);
        toast('הבחירה בוטלה');
        return;
      }

      if (action === 'all') {
        var n = Select.all();
        Select.paint();
        render();
        toast(n ? n + ' פריטים נבחרו' : 'אין פריטים לבחירה בתצוגה הזו');
        return;
      }

      var keys = Select.keys();
      if (!keys.length) { toast('לא נבחר אף פריט'); return; }

      if (action === 'done') {
        var did = Select.complete(keys);
        if (!did.tasks && !did.lists) { toast('אין מה לסמן כהושלם בבחירה הזו'); return; }
        Haptics.done();
        Select.setMode(false);
        toast([
          did.tasks ? plural(did.tasks, 'משימה אחת', 'משימות') : '',
          did.lists ? plural(did.lists, 'רשימה אחת', 'רשימות') : ''
        ].filter(Boolean).join(' ו־') + ' סומנו כהושלמו ✓');
        return;
      }

      if (action === 'delete') {
        confirmDelete(plural(keys.length, 'פריט אחד', 'פריטים') + ' יעברו לסל המחזור', function () {
          // every picked card collapses together, then the whole batch moves
          leaveThen(keys, function () {
            var gone = softDeleteMany(keys);
            Select.setMode(false);
            if (!gone) { toast('לא נמחק דבר'); return; }
            // a whole batch is a bigger loss — the net stays open longer
            toast(gone.count + ' פריטים הועברו לסל המחזור', UNDO_LABEL, UNDO_BATCH_MS);
          });
        });
      }
    },

    /**
     * A long press on any card opens selection mode with that card picked —
     * the gesture a phone user reaches for first. A press that travels is a
     * scroll and cancels; the click that follows the press is swallowed, or it
     * would immediately un-pick the card the finger was resting on.
     */
    bindLongPress: function () {
      var timer = null, x0 = 0, y0 = 0, key = null;

      function cancel() {
        if (timer) { clearTimeout(timer); timer = null; }
        key = null;
      }

      document.addEventListener('touchstart', function (e) {
        cancel();
        // a new gesture starts clean: the click that belonged to the previous
        // long press has either already been swallowed or will never arrive
        Select.swallow = false;
        if (Select.on || !e.touches || e.touches.length !== 1) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#batchBar,.sheet,.drawer,.topbar,.tabbar,.rail,.toast,.settings')) return;

        var node = t.closest('[data-rec]');
        var k = node && node.dataset ? node.dataset.rec : '';
        if (!k || SELECTABLE.indexOf(String(k).split(':')[0]) === -1) return;

        key = k;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        timer = setTimeout(function () {
          timer = null;
          if (!key) return;
          Haptics.done();
          Select.swallow = true;
          Select.setMode(true, key);
          toast('מצב בחירה — סמן פריטים ובחר פעולה בסרגל שלמטה');
          key = null;
        }, LONG_PRESS_MS);
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!timer || !e.touches || !e.touches.length) return;
        var t = e.touches[0];
        if (Math.abs(t.clientX - x0) > LONG_PRESS_SLOP ||
          Math.abs(t.clientY - y0) > LONG_PRESS_SLOP) cancel();
      }, { passive: true });

      document.addEventListener('touchend', cancel, { passive: true });
      document.addEventListener('touchcancel', cancel, { passive: true });
    }
  };

  /* ==========================================================================
     בחירה מרובה בסל המחזור — the bin's own selection layer

     The bin is the one list in the app Wave 3's Select cannot reach: it lives
     inside a modal sheet, and both the long press and Select.tap() decline
     every touch that lands on `.sheet` on purpose — opening the app-wide batch
     bar behind an open dialog would offer סמן כהושלם and מחיקה on records that
     are not on screen. A bin holding thirty expired rows still has to be
     emptied in one pass, so it carries its OWN selection: the same 500ms long
     press, the same checkbox, the same bar — scoped to trash entry ids, and to
     the only two things that can still be done to a binned record.

     Every state transition here is pure (no DOM, no toast), exactly like
     Select: the delegate is what repaints, which is what lets healthcheck.js
     drive a whole enter → pick → בחר הכל → restore/purge cycle head-lessly.
     ========================================================================== */

  var TrashSel = {
    on: false,
    picked: {},                  // { '<trash entry id>': 1 }
    swallow: false,              // the click that follows a long press is not a tap

    /* ---- pure state ---- */

    has: function (id) { return !!TrashSel.picked[id]; },
    keys: function () { return Object.keys(TrashSel.picked); },
    count: function () { return TrashSel.keys().length; },

    toggle: function (id) {
      if (!id) return false;
      if (TrashSel.picked[id]) delete TrashSel.picked[id];
      else TrashSel.picked[id] = 1;
      return TrashSel.has(id);
    },

    enter: function (id) {
      TrashSel.on = true;
      TrashSel.picked = {};
      if (id) TrashSel.picked[id] = 1;
      return TrashSel.on;
    },

    exit: function () {
      TrashSel.on = false;
      TrashSel.picked = {};
      return TrashSel.on;
    },

    /** every entry the bin is showing, in the order it shows them */
    visibleKeys: function () {
      return trashList().map(function (e) { return e.id; });
    },

    all: function () {
      TrashSel.visibleKeys().forEach(function (id) { TrashSel.picked[id] = 1; });
      return TrashSel.count();
    },

    /**
     * Pure batch restore: every picked entry goes back into the collection and
     * the slot it left.
     *
     * The order is the whole correctness of this function. An entry's `index`
     * was recorded against the list AS IT STOOD when that one record left it,
     * so the only sequence that reproduces the original list is the deletions
     * run backwards — newest first. Deleting A (slot 0) then C (slot 1 of what
     * was left) and restoring in that same order lands C one place too early;
     * restoring C first puts every earlier slot back under it. The bin is
     * appended to in deletion order, so its own order is the clock.
     */
    restore: function (ids) {
      var binned = trashRows();
      var order = (Array.isArray(ids) ? ids : [])
        .map(function (id) { return trashFind(id); })
        .filter(Boolean)
        .map(function (e) { return { entry: e, at: binned.indexOf(e) }; })
        .sort(function (a, b) { return b.at - a.at; });

      var n = 0;
      order.forEach(function (o) { if (trashRestore(o.entry.id)) n++; });
      return n;
    },

    /** ...and the batch with nothing behind it. The caller asks first. */
    purge: function (ids) {
      var n = 0;
      (Array.isArray(ids) ? ids : []).forEach(function (id) {
        if (trashPurge(id)) n++;
      });
      return n;
    },

    /* ---- painting ---- */

    paint: function () {
      var n = TrashSel.count();
      var bar = $('#trashBatchBar');
      var count = $('#trashBatchCount');
      var btn = $('#trashSelectBtn');
      var label = $('#trashSelectLabel');

      if (bar) bar.hidden = !TrashSel.on;
      if (count) count.textContent = n ? n + ' נבחרו' : 'בחר פריטים';
      if (btn) {
        btn.classList.toggle('is-on', TrashSel.on);
        btn.setAttribute('aria-pressed', TrashSel.on ? 'true' : 'false');
      }
      if (label) label.textContent = TrashSel.on ? SELECT_LABEL.on : SELECT_LABEL.off;
      return n;
    },

    /** state + a repaint of the bin only: nothing outside the sheet moved */
    setMode: function (on, id) {
      if (on) TrashSel.enter(id); else TrashSel.exit();
      renderTrash();
      return TrashSel.on;
    },

    toggleMode: function () { return TrashSel.setMode(!TrashSel.on); },

    /* ---- input ---- */

    /** selection mode owns every tap that lands on a row inside the bin */
    tap: function (target) {
      if (!TrashSel.on || !target || !target.closest) return false;
      if (TrashSel.swallow) { TrashSel.swallow = false; return true; }   // the press itself
      if (!target.closest('#trashList')) return false;

      var node = target.closest('[data-trashid]');
      var id = node && node.dataset ? node.dataset.trashid : '';
      if (!id) return false;

      Haptics.light();
      TrashSel.toggle(id);
      renderTrash();
      return true;
    },

    /** the bin's bar: שחזור · בחר הכל · מחיקה לצמיתות · סיום בחירה */
    run: function (action) {
      if (action === 'mode') { TrashSel.toggleMode(); return; }

      if (action === 'exit') {
        TrashSel.setMode(false);
        toast('הבחירה בוטלה');
        return;
      }

      if (action === 'all') {
        var picked = TrashSel.all();
        renderTrash();
        toast(picked ? picked + ' פריטים נבחרו' : 'סל המחזור ריק');
        return;
      }

      var ids = TrashSel.keys();
      if (!ids.length) { toast('לא נבחר אף פריט'); return; }

      if (action === 'restore') {
        var back = TrashSel.restore(ids);
        TrashSel.setMode(false);
        if (!back) { toast('לא שוחזר דבר'); return; }
        Haptics.done();
        render();                  // the records re-enter lists they had left
        toast(plural(back, 'פריט אחד שוחזר', 'פריטים שוחזרו'));
        return;
      }

      if (action === 'purge') {
        // the only deletion in the app with no net behind it — a batch of them
        // asks exactly like a single one does
        confirmDelete(plural(ids.length, 'פריט אחד', 'פריטים') +
          ' — לצמיתות, ללא שחזור', function () {
            var gone = TrashSel.purge(ids);
            TrashSel.setMode(false);
            toast(gone
              ? plural(gone, 'פריט אחד נמחק לצמיתות', 'פריטים נמחקו לצמיתות')
              : 'לא נמחק דבר');
          });
      }
    },

    /**
     * The same gesture the cards answer to, bound to the bin. It declines a
     * press that started on one of the row buttons — those are controls, not a
     * surface — and swallows the click the press leaves behind, or the row
     * under the finger would be un-picked the instant it was picked.
     */
    bindLongPress: function () {
      var timer = null, x0 = 0, y0 = 0, id = null;

      function cancel() {
        if (timer) { clearTimeout(timer); timer = null; }
        id = null;
      }

      document.addEventListener('touchstart', function (e) {
        cancel();
        TrashSel.swallow = false;
        if (TrashSel.on || !e.touches || e.touches.length !== 1) return;
        var t = e.target;
        if (!t || !t.closest || !t.closest('#trashList')) return;
        if (t.closest('.mini')) return;

        var node = t.closest('[data-trashid]');
        var k = node && node.dataset ? node.dataset.trashid : '';
        if (!k) return;

        id = k;
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
        timer = setTimeout(function () {
          timer = null;
          if (!id) return;
          Haptics.done();
          TrashSel.swallow = true;
          TrashSel.setMode(true, id);
          toast('מצב בחירה בסל — סמן פריטים ובחר פעולה בסרגל שלמטה');
          id = null;
        }, LONG_PRESS_MS);
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!timer || !e.touches || !e.touches.length) return;
        var t = e.touches[0];
        if (Math.abs(t.clientX - x0) > LONG_PRESS_SLOP ||
          Math.abs(t.clientY - y0) > LONG_PRESS_SLOP) cancel();
      }, { passive: true });

      document.addEventListener('touchend', cancel, { passive: true });
      document.addEventListener('touchcancel', cancel, { passive: true });
    }
  };

  /* ------------------------------------------------------------ master add */

  function openSheet(id) {
    var backdrop = $('#backdrop');
    var el = $('#' + id);
    if (backdrop) backdrop.hidden = false;
    if (el) el.hidden = false;
    if (document.body && document.body.style) document.body.style.overflow = 'hidden';
  }

  function closeSheets() {
    Confirm.dismiss();
    $('#backdrop').hidden = true;
    $('#typeSheet').hidden = true;
    $('#formSheet').hidden = true;
    $('#confirmSheet').hidden = true;
    $('#trashSheet').hidden = true;
    if ($('#openSheet')) $('#openSheet').hidden = true;
    if ($('#shopSheet')) $('#shopSheet').hidden = true;
    Detail.close();
    Settings.close();
    // a selection belongs to the bin that is open — closing it ends the mode,
    // or the next visit would open holding picks on rows nobody can see
    TrashSel.exit();
    TrashSel.paint();
    Drawer.close();
    document.body.style.overflow = '';
    PREFILL = null;
    UI.editId = null;
  }

  /** is anything else still layered over the app? */
  function anySheetOpen() {
    return !$('#typeSheet').hidden || !$('#formSheet').hidden ||
      !$('#trashSheet').hidden || openSheetOpen() || Detail.isOpen() ||
      Drawer.isOpen() || Settings.isOpen() || Shop.isOpen();
  }

  /** סל מחזור — opened from the header pill, painted fresh every time */
  function openTrash() {
    // an entry that expired while the app was left open must not be offered
    // for restore just because the tab never reloaded
    if (purgeTrash()) Store.save();
    TrashSel.exit();                   // every visit starts out of selection mode
    $('#typeSheet').hidden = true;
    $('#formSheet').hidden = true;
    // the sheet is unhidden FIRST: renderTrash() paints the list only while it
    // is open (Sprint 9), so painting before this would open an empty bin
    openSheet('trashSheet');
    renderTrash();
  }

  /**
   * "יומן היסטוריה" from נתונים וארכיון (Sprint 13 · mandate §2c).
   *
   * The completed-tasks log has lived at the bottom of the משימות workspace
   * since Sprint 9 and could only be reached by scrolling past the whole task
   * list to find it. It is not a sheet and deliberately does not become one —
   * it belongs to that screen. So the link is a real navigation: close the
   * drawer, land on the workspace it lives in, and scroll it into view.
   */
  function openArchiveLog() {
    closeSheets();
    setWorkspace('tasks');
    if (UI.view !== 'tasks') setView('tasks');
    var box = $('#archiveList');
    if (box && box.scrollIntoView) {
      // after the repaint setWorkspace() just queued, or the node is still hidden
      setTimeout(function () {
        try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch (e) { box.scrollIntoView(); }
      }, 60);
    }
    return true;
  }

  /* ==========================================================================
     "פתוחות: N" — the sheet behind the number (Sprint 12 · mandate §3)

     The counter has always been honest and has never been reachable. Sprint 10
     answered half of it with the משימות קרובות widget on My Day, but that
     widget is windowed to a week and holds tasks only, so a meeting next month
     and a task next quarter were still counted by nothing you could tap.

     This is the other half: ONE chronological list of everything open and
     still ahead — tasks and meetings together, in the order they will actually
     happen — opened straight from the number that counts it.
     ========================================================================== */

  var OPEN_FILTERS = ['all', 'tasks', 'events', 'today', 'week', 'late', 'undated'];
  var OPEN_FILTER_LABEL = {
    all: 'הכל', tasks: '✓ משימות', events: '▦ אירועים', today: 'היום',
    week: 'השבוע', late: 'באיחור', undated: 'ללא תאריך'
  };
  var OPEN_EMPTY = {
    all: 'אין כרגע שום משימה פתוחה או אירוע עתידי — הכול סגור.',
    tasks: 'אין משימות פתוחות.',
    events: 'אין אירועים עתידיים ביומן.',
    today: 'אין משימה או פגישה שנותרו פתוחות להיום.',
    late: 'שום דבר לא נשאר מאחור.',
    week: 'השבוע הקרוב פנוי.',
    undated: 'כל פריט פתוח כבר משויך לתאריך.'
  };

  function openFilter() {
    var f = Store.data.prefs.openFilter;
    return OPEN_FILTERS.indexOf(f) === -1 ? 'all' : f;
  }

  function setOpenFilter(f) {
    Store.data.prefs.openFilter = OPEN_FILTERS.indexOf(f) === -1 ? 'all' : f;
    Store.save();
    renderOpenSheet();
  }

  /**
   * One entry per open record, as {collection, rec, on, at}. A task is open
   * while it is neither הושלם nor בוטל, whatever its date; an event is open
   * while it has not already happened — a meeting last Tuesday is history, not
   * an outstanding item, and listing it here would bury the ones that matter.
   */
  function openEntries() {
    var t = todayISO();
    var out = [];

    pick('tasks').forEach(function (x) {
      if (isClosed(x.status)) return;
      out.push({ collection: 'tasks', rec: x, on: x.due || '', at: x.time || '' });
    });

    pick('events').forEach(function (e) {
      if (e.date && e.date < t) return;
      out.push({ collection: 'events', rec: e, on: e.date || '', at: e.start || '' });
    });

    /* Chronological, undated last — the same ordering rule sortByDate() uses,
       applied across two collections instead of one. Inside a minute a meeting
       outranks a self-appointment, exactly as it does on the timeline. */
    return out.sort(function (a, b) {
      var da = a.on || '9999-99-99', db = b.on || '9999-99-99';
      if (da !== db) return da < db ? -1 : 1;
      var ta = timeToMinutes(a.at), tb = timeToMinutes(b.at);
      if (ta !== tb) return ta - tb;
      if (a.collection !== b.collection) return a.collection === 'events' ? -1 : 1;
      return a.rec.id < b.rec.id ? -1 : (a.rec.id > b.rec.id ? 1 : 0);
    });
  }

  function openMatches(entry, filter, today) {
    if (filter === 'tasks') return entry.collection === 'tasks';
    if (filter === 'events') return entry.collection === 'events';
    if (filter === 'today') return entry.on === today;
    if (filter === 'late') return !!entry.on && entry.on < today;
    if (filter === 'week') return !!entry.on && entry.on >= today && entry.on <= addDaysISO(today, UPCOMING_DAYS);
    if (filter === 'undated') return !entry.on;
    return true;                                   // 'all'
  }

  /** what the sheet lists under the active filter, in the order it lists it */
  function openRows(filter) {
    var t = todayISO();
    var f = filter || openFilter();
    return openEntries().filter(function (e) { return openMatches(e, f, t); });
  }

  function openKeys() {
    return openRows().map(function (e) { return e.collection + ':' + e.rec.id; });
  }

  function openRowHTML(entry) {
    return entry.collection === 'events' ? eventCard(entry.rec) : taskRow(entry.rec, true);
  }

  function openSheetOpen() {
    var el = $('#openSheet');
    return !!el && !el.hidden;
  }

  function renderOpenSheet(quiet) {
    if (!openSheetOpen()) return;

    var t = todayISO();
    var f = openFilter();
    var all = openEntries();
    var rows = all.filter(function (e) { return openMatches(e, f, t); });

    $$('#openFilters [data-openfilter]').forEach(function (b) {
      var key = b.dataset.openfilter;
      var on = key === f;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      var count = b.querySelector('.seg-count');
      if (count) {
        count.textContent = all.filter(function (e) { return openMatches(e, key, t); }).length;
      }
    });

    var tasks = rows.filter(function (e) { return e.collection === 'tasks'; }).length;
    setText($('#openMeta'), rows.length
      ? plural(tasks, 'משימה אחת', 'משימות') + ' · ' +
        plural(rows.length - tasks, 'אירוע אחד', 'אירועים')
      : 'אין מה להציג בסינון הזה');

    var body = $('#openList');
    if (quiet || !body) return;

    if (!rows.length) {
      body.innerHTML = emptyState('אין פריטים פתוחים', OPEN_EMPTY[f] || OPEN_EMPTY.all);
      return;
    }

    var band = null;
    var html = [];
    rows.forEach(function (entry) {
      var next = entry.on ? upcomingBand(entry.on, t) : 'ללא תאריך יעד';
      if (next !== band) {
        band = next;
        html.push('<div class="up-band">' + esc(band) + '</div>');
      }
      html.push(openRowHTML(entry));
    });
    body.innerHTML = html.join('');
  }

  function openOpenSheet() {
    $('#typeSheet').hidden = true;
    $('#formSheet').hidden = true;
    // unhidden FIRST — renderOpenSheet() declines to paint a closed sheet, so
    // painting before this would open it empty (the same rule openTrash() keeps)
    openSheet('openSheet');
    renderOpenSheet();
  }

  /* ==========================================================================
     Task / event detail reader (Sprint 12 · mandate §4)

     Tapping a card used to drop straight into its edit form — every field
     writable, nothing actually READABLE. A note longer than the two lines a
     card shows could only be read by opening a form and scrolling a textarea,
     and the reminders a record carried were not stated anywhere at all.

     This is the reading surface: the whole record laid out, every active
     reminder listed by name, and the three actions worth having from a reading
     view — עריכה, סימון כבוצע, מחיקה — at the bottom.
     ========================================================================== */

  var Detail = {
    collection: '',
    id: '',

    rec: function () {
      return this.collection && this.id ? Store.find(this.collection, this.id) : null;
    },

    isOpen: function () {
      var el = $('#detailSheet');
      return !!el && !el.hidden;
    },

    open: function (collection, id) {
      if (TAP_DETAIL.indexOf(collection) === -1) return false;
      // the caller reports a missing record — saying it twice is not clearer
      if (!Store.find(collection, id)) return false;
      this.collection = collection;
      this.id = id;
      $('#typeSheet').hidden = true;
      $('#formSheet').hidden = true;
      openSheet('detailSheet');
      this.paint();
      return true;
    },

    close: function () {
      var el = $('#detailSheet');
      if (el) el.hidden = true;
      this.collection = '';
      this.id = '';
    },

    /** one labelled line of the reader; a blank value draws nothing at all */
    line: function (label, value) {
      if (!value) return '';
      return '<div class="dt-line"><span class="dt-key">' + esc(label) + '</span>' +
        '<span class="dt-val">' + esc(value) + '</span></div>';
    },

    /** every reminder this record carries, named — including the custom ones */
    reminders: function (rec) {
      var list = remindersOf(rec);
      if (!list.length) {
        return '<div class="dt-remind is-muted"><span class="dt-key">התראות</span>' +
          '<span class="dt-val">' + esc(REMIND_OFF_LABEL) + ' — לא תישלח תזכורת</span></div>';
      }
      var lead = Store.data.prefs.notify.lead;
      var rows = list.map(function (tok) {
        var text = tok === REMIND_DEFAULT
          ? REMIND_LABEL[tok] + ' (' + lead + ' דק׳ לפני)'
          : remindLabelOf(tok);
        return '<li class="dt-rm rm-' + esc(remindClass(tok)) + '">🔔 ' + esc(text) + '</li>';
      }).join('');
      return '<div class="dt-remind"><span class="dt-key">התראות (' + list.length + ')</span>' +
        '<ul class="dt-rms">' + rows + '</ul></div>';
    },

    body: function (rec) {
      var isTask = this.collection === 'tasks';
      var when = isTask
        ? (rec.due ? relDay(rec.due) + ' · ' + fmtDayMon(rec.due) + (rec.time ? ' · ' + rec.time : ' · ללא שעה') : 'ללא תאריך יעד (נכנסים)')
        : (rec.date ? relDay(rec.date) + ' · ' + fmtDayMon(rec.date) +
          (rec.start ? ' · ' + rec.start + (rec.end ? '–' + rec.end : '') : ' · ללא שעה') : 'ללא תאריך');

      var client = rec.clientId ? Store.find('clients', rec.clientId) : null;
      var prog = isTask ? subtaskProgress(rec) : null;

      return '<div class="dt-head"><h3 class="dt-title">' + esc(rec.title || (isTask ? 'משימה' : 'אירוע')) + '</h3></div>' +
        /* Sprint 14 §2 — the badges the row stopped carrying land HERE, as the
           same chips they always were. The status chip is still the live
           data-cycle control it is on a card, and Patch.settle() repaints this
           reader, so cycling from inside it lands on screen immediately. */
        '<div class="dt-tags">' +
        catTag(rec.category) +
        (isTask ? statusBadge(rec) + priorityTag(rec.priority) : '') +
        remindTag(rec) +
        '</div>' +
        (rec.notes ? '<p class="dt-notes">' + esc(rec.notes) + '</p>' : '') +
        '<div class="dt-lines">' +
        this.line('מתי', when) +
        // Sprint 14 §2 — קטגוריה / סטטוס / עדיפות used to be spelled out here
        // AND drawn as chips two lines above. The chips say the same words, in
        // the same order, in colour; the duplicate lines were pure noise.
        (isTask ? this.line('הפעולה הבאה', rec.nextAction) : this.line('מיקום', rec.location)) +
        this.line('לקוח מקושר', client ? client.name : '') +
        // Sprint 13 — the reader states HOW as well as WHEN: a record that
        // rings for ten seconds and one that only ticks look identical on a
        // card, and this is the only surface that says which is which
        this.line('צליל ורטט', alertSentence(rec)) +
        // Sprint 14 §2 — "מתי" is the DUE date; this is when the record was
        // opened, which is the only way to tell a task that has been sitting
        // there for three weeks from one filed this morning
        this.line('נוצרה', stampDay(rec.createdAt)) +
        '</div>' +
        // the checklist came off the card with the badges — same markup, same
        // data-subtask handler, so ticking a sub-task still works in place
        (isTask && prog.total ? checklist(prog, rec.subtasks, 'subtask', rec.id) : '') +
        this.reminders(rec);
    },

    paint: function () {
      var rec = this.rec();
      if (!rec) { this.close(); return; }
      var box = $('#detailBody');
      if (!box) return;              // nothing to paint into — never throw a render
      setText($('#detailSheetTitle'), this.collection === 'tasks' ? 'פרטי משימה' : 'פרטי אירוע');
      setHTML(box, this.body(rec));
      // only a task can be ticked; an event has no status to move
      var done = $('#detailDone');
      if (done) {
        done.hidden = this.collection !== 'tasks';
        if (this.collection === 'tasks') {
          done.textContent = normStatus(rec.status) === 'done' ? '↺ בטל סימון' : '✓ סימון כבוצע';
        }
      }
    },

    /** עריכה / סימון כבוצע / מחיקה — the three actions a reading view owes */
    act: function (what) {
      var rec = this.rec();
      if (!rec) { this.close(); toast('הפריט לא נמצא'); return; }
      var collection = this.collection, id = this.id;

      if (what === 'edit') {
        this.close();
        if (!openEdit(collection, id)) toast('הפריט לא נמצא');
        return;
      }

      if (what === 'done' && collection === 'tasks') {
        toggleTaskDone(rec);
        Store.save();
        Haptics.done();
        Patch.apply('tasks', id);
        this.paint();
        toast(normStatus(rec.status) === 'done' ? 'המשימה סומנה כבוצעה' : 'הסימון בוטל');
        return;
      }

      if (what === 'delete') {
        this.close();
        confirmDelete(recSummary(collection, rec), function () {
          var gone = softDelete(collection, id);
          if (!gone) return;
          render();
          toast(gone.label + ' נמחק', UNDO_LABEL);
        });
      }
    }
  };

  /**
   * The confirmation closes on its own, without taking the sheet or the client
   * file underneath it with it — a note deleted from inside a client file must
   * leave the file open.
   */
  function closeConfirmUI() {
    $('#confirmSheet').hidden = true;
    if (anySheetOpen()) return;
    $('#backdrop').hidden = true;
    document.body.style.overflow = '';
  }

  function closeConfirm() { closeConfirmUI(); Confirm.dismiss(); }

  /** כן, מחק — the sheet closes first, so the toast lands on a clear screen */
  function acceptConfirm() { closeConfirmUI(); return Confirm.accept(); }

  /** ✕ on a card: ask, then soft-delete with the undo window behind it */
  function askDelete(key) {
    var parts = String(key).split(':');
    var rec = Store.find(parts[0], parts[1]);
    if (!rec) { toast('הפריט לא נמצא'); return false; }

    return !!confirmDelete(recSummary(parts[0], rec), function () {
      // Sprint 8 — the card collapses and fades out first, THEN the store moves
      leaveThen(parts[0] + ':' + parts[1], function () {
        var gone = softDelete(parts[0], parts[1]);
        if (!gone) return;
        render();                            // the row is leaving — membership moved
        toast(gone.label + ' הועבר לסל המחזור', UNDO_LABEL);
      });
    });
  }

  /** the same door for a note inside a client file, which is a sub-record */
  function askDeleteClientNote(key) {
    var parts = String(key).split(':');
    var c = Store.find('clients', parts[0]);
    var rows = c && Array.isArray(c.clientNotes) ? c.clientNotes : [];
    var note = rows.filter(function (n) { return n.id === parts[1]; })[0];
    if (!note) { toast('הפתק לא נמצא'); return false; }

    return !!confirmDelete(recSummary('clientNotes', { title: note.body }), function () {
      var goneNote = softDeleteClientNote(parts[0], parts[1]);
      if (!goneNote) return;
      render();
      toast(goneNote.label + ' נמחק', UNDO_LABEL);
    });
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
        remindField() +
        alertField() +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        f('notes', 'הערות', '<textarea class="textarea" name="notes" placeholder="פרטים נוספים…"></textarea>');
    },
    task: function () {
      return f('title', 'מה צריך לעשות?', '<input class="input" name="title" placeholder="לשלוח הצעת מחיר…" required>') +
        '<div class="field-row">' +
        // blank on purpose (Sprint 10): a task saved with no date lands in
        // נכנסים instead of silently claiming today, which is what made the
        // Inbox impossible to fill in the first place
        f('due', 'תאריך יעד (ריק = נכנסים)', '<input class="input" type="date" name="due">') +
        f('time', 'שעה (לא חובה)', '<input class="input" type="time" name="time">') +
        '</div>' +
        '<div class="field-row">' +
        f('status', 'סטטוס', picker('status', TASK_STATUSES, STATUS_LABEL, 'new')) +
        f('priority', 'עדיפות', picker('priority', PRIORITIES, PRIORITY_LABEL, 'medium')) +
        '</div>' +
        remindField() +
        alertField() +
        f('nextAction', 'הפעולה הבאה', '<input class="input" name="nextAction" placeholder="להתקשר ללקוח ולאשר מידות">') +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        f('subtasks', 'תת־משימות (שורה לכל אחת)', '<textarea class="textarea" name="subtasks" placeholder="לאסוף מידות&#10;לחשב תמחור"></textarea>') +
        f('notes', 'הערות', '<textarea class="textarea" name="notes"></textarea>');
    },
    list: function () {
      return f('title', 'שם הרשימה', '<input class="input" name="title" placeholder="קניות לשבת…" required>') +
        f('date', 'תאריך (לא חובה — רשימה יכולה להיות ללא תאריך)', '<input class="input" type="date" name="date">') +
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        // Sprint 16 — the 161-product catalog used to hang off the bottom of
        // this form. It is a module of its own now (רשימת קניות, one tap from
        // היום שלי), so what is left here is what a generic checklist actually
        // needs: a title, a date, a client and its lines.
        f('items', 'פריטים (שורה לכל פריט)', '<textarea class="textarea" name="items" placeholder="חלב&#10;לחם&#10;ביצים"></textarea>');
    },
    note: function () {
      return f('title', 'כותרת', '<input class="input" name="title" placeholder="רעיון / תזכורת">') +
        f('body', 'תוכן הפתק', '<textarea class="textarea" name="body" placeholder="כתוב כאן…" required></textarea>') +
        // mandate §2c — a note is the one thing that could not be filed under a
        // client, even though the column has existed in D1 since Sprint 5
        f('clientId', 'שיוך ללקוח', clientPicker()) +
        // Sprint 13 §3 names all three types; a note carries the pair so that
        // converting it into a task or an event keeps the choice
        alertField();
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

  /* ==========================================================================
     The reminder panel (Sprint 12 · mandate §1)

     One <select> could only ever express one reminder, so "יום לפני" and
     "בזמן האירוע" on the same meeting was not a thing the form could say. The
     panel replaces it with the two questions that were actually being asked:

       1. does this record want reminders at all?  — a plain two-state toggle
       2. if so, which ones?                       — as many as you like

     Built-in leads are checkboxes, so any combination is one tap away, and any
     number of absolute wall-clock reminders can be added underneath — those
     are moments in their own right and need not sit anywhere near the record's
     own start time.

     The whole thing serialises into one hidden field, `reminders`, so
     submitForm()'s generic [name] sweep collects it exactly like every other
     control and the save path needed no special case.
     ========================================================================== */

  function remindField() {
    var lead = (Store.data && Store.data.prefs && Store.data.prefs.notify)
      ? Store.data.prefs.notify.lead : 10;

    var boxes = REMIND_MULTI.map(function (tok) {
      var text = tok === REMIND_DEFAULT
        ? REMIND_LABEL[tok] + ' (' + lead + ' דק׳ לפני)'
        : REMIND_LABEL[tok];
      return '<label class="rm-opt">' +
        '<input type="checkbox" class="rm-box" data-remindopt="' + esc(tok) + '">' +
        '<span>' + esc(text) + '</span></label>';
    }).join('');

    /* Every node here is addressed by CLASS, never by id. The panel is built
       fresh into #formFields on every openForm(), so an id would be a promise
       index.html cannot keep — and the healthcheck rightly refuses to let
       app.js paint an id the document does not ship. */
    return '<div class="field rm-field">' +
      '<label class="field-label">התראות</label>' +
      '<div class="segmented rm-mode" role="group" aria-label="מצב התראה">' +
      '<button class="seg is-active" data-remindmode="on" type="button" aria-pressed="true">' +
      esc(REMIND_ON_LABEL) + '</button>' +
      '<button class="seg" data-remindmode="off" type="button" aria-pressed="false">' +
      esc(REMIND_OFF_LABEL) + '</button>' +
      '</div>' +
      '<div class="rm-panel">' +
      '<p class="rm-hint">אפשר לסמן כמה התראות במקביל — למשל גם "יום לפני" וגם "בזמן האירוע".</p>' +
      '<div class="rm-opts">' + boxes + '</div>' +
      '<div class="rm-customs"></div>' +
      '<button class="mini rm-add" data-remindadd="1" type="button">＋ הוסף התראת זמן נוספת</button>' +
      '</div>' +
      '<p class="rm-summary block-meta"></p>' +
      // the one value submitForm()'s generic [name] sweep collects
      '<input type="hidden" name="reminders" value="' + REMIND_DEFAULT + '">' +
      '</div>';
  }

  /** one node of the live reminder panel, or null when no form is open */
  function rmEl(sel) {
    var box = $('#formFields');
    return box ? box.querySelector(sel) : null;
  }

  function rmAll(sel) {
    var box = $('#formFields');
    return box ? Array.prototype.slice.call(box.querySelectorAll(sel)) : [];
  }

  /**
   * The panel's state while a form is open. Deliberately a small object rather
   * than "read it back off the DOM": a half-typed datetime-local is '' for a
   * while, and re-deriving the list from the inputs on every keystroke would
   * drop a reminder the user is in the middle of writing.
   */
  var FormRemind = {
    on: true,
    set: {},          // built-in token → 1
    customs: [],      // 'YYYY-MM-DDTHH:MM', possibly '' while it is being typed

    /** open the panel on whatever the record (or a blank form) already says */
    load: function (value) {
      var list = normRemindList(value);
      var self = this;
      this.set = {};
      this.customs = [];
      list.forEach(function (tok) {
        if (isCustomRemind(tok)) self.customs.push(customRemindStamp(tok));
        else self.set[tok] = 1;
      });
      // an EMPTY list is the muted state — the array form of the old 'none'
      this.on = list.length > 0;
      this.renderCustoms();
      this.paint();
      return this;
    },

    /** the token list this panel currently stands for */
    tokens: function () {
      if (!this.on) return [];
      var out = Object.keys(this.set);
      this.customs.forEach(function (stamp) {
        if (isCustomRemind(REMIND_CUSTOM_PREFIX + stamp)) out.push(REMIND_CUSTOM_PREFIX + stamp);
      });
      var clean = normRemindList(out);
      /* "עם התראה" with nothing ticked is not silence — silence is the other
         toggle. It is the system default, which is what the app did before a
         record could hold an opinion at all. */
      return clean.length ? clean : [REMIND_DEFAULT];
    },

    /** the value the form submits */
    value: function () { return remindKey(this.tokens()); },

    setMode: function (mode) {
      this.on = mode !== 'off';
      this.paint();
    },

    toggle: function (tok, wanted) {
      if (REMIND_MULTI.indexOf(tok) === -1) return;
      if (wanted) this.set[tok] = 1; else delete this.set[tok];
      // ticking a reminder is itself the answer to "do you want reminders"
      if (wanted) this.on = true;
      this.paint();
    },

    /** a new custom row starts on the record's own day, one hour from now */
    addCustom: function () {
      if (this.customs.length + Object.keys(this.set).length >= REMIND_MAX) {
        toast('הגעת למספר ההתראות המרבי לפריט אחד');
        return;
      }
      this.on = true;
      this.customs.push(this.suggest());
      this.renderCustoms();
      this.paint();
    },

    dropCustom: function (index) {
      if (index < 0 || index >= this.customs.length) return;
      this.customs.splice(index, 1);
      this.renderCustoms();
      this.paint();
    },

    setCustom: function (index, stamp) {
      if (index < 0 || index >= this.customs.length) return;
      this.customs[index] = String(stamp || '').slice(0, 16);
      this.paint();                      // NOT renderCustoms(): the field is focused
    },

    /**
     * A sensible opening value for a fresh custom row: the date and time the
     * form is already holding, less an hour, so the common case ("also remind
     * me an hour before, on the day itself") is one tap and no typing.
     */
    suggest: function () {
      var fields = $('#formFields');
      var pickField = function (name) {
        var el = fields && fields.querySelector('[name="' + name + '"]');
        return el && el.value ? el.value : '';
      };
      var date = pickField('date') || pickField('due') || todayISO();
      var time = pickField('start') || pickField('time') || '09:00';
      // shiftTime() answers '' on anything it cannot read; a blank stamp would
      // be silently dropped by normRemindList() and the row would look broken
      return date + 'T' + (shiftTime(time, -60) || '09:00');
    },

    renderCustoms: function () {
      var box = rmEl('.rm-customs');
      if (!box) return;
      box.innerHTML = this.customs.map(function (stamp, i) {
        return '<div class="rm-custom">' +
          '<input class="input rm-when" type="datetime-local" data-remindwhen="' + i + '"' +
          ' aria-label="מועד התראה מותאם אישית" value="' + esc(stamp) + '">' +
          '<button class="mini is-danger" data-reminddrop="' + i + '" type="button" ' +
          'aria-label="הסרת ההתראה">✕</button>' +
          '</div>';
      }).join('');
    },

    paint: function () {
      var field = rmEl('.rm-field');
      if (!field) return;
      var on = this.on;
      var self = this;

      rmAll('.rm-mode [data-remindmode]').forEach(function (b) {
        var active = (b.dataset.remindmode === 'on') === on;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      var panel = rmEl('.rm-panel');
      if (panel) panel.hidden = !on;
      field.classList.toggle('is-muted', !on);

      rmAll('[data-remindopt]').forEach(function (box) {
        box.checked = !!self.set[box.dataset.remindopt];
      });

      var held = rmEl('[name="reminders"]');
      if (held) held.value = this.value();
      setText(rmEl('.rm-summary'), remindSentence(this.tokens()));
    }
  };

  /** "3 התראות: יום לפני · בזמן האירוע · 30 ביולי 09:00" — one honest line */
  function remindSentence(list) {
    var clean = normRemindList(list);
    if (!clean.length) return 'לא תישלח שום תזכורת לפריט הזה.';
    var names = clean.map(function (tok) { return remindLabelOf(tok); }).join(' · ');
    return clean.length === 1 ? 'תזכורת אחת: ' + names : clean.length + ' התראות: ' + names;
  }

  /* ==========================================================================
     Alert options — the dual-sound & vibration picker (Sprint 13 · mandate §3)

     The reminder panel above answers WHEN. This answers HOW, and it is a
     separate question: "remind me an hour before" and "ring for ten seconds
     when you do" are two independent choices, and folding them into one
     control would mean a record could not say the second without restating
     the first.

     Two rows, both plain segmented pickers, both stored on the record:

       צליל   [ללא] [צליל קצר] [צלצול ארוך (~10 שניות)]
       רטט    [ללא] [רטט קצר] [רטט ארוך] [רטט חוזר]

     Each row serialises into its own hidden field, so submitForm()'s generic
     [name] sweep collects them exactly like every other control.
     ========================================================================== */

  function alertField() {
    function row(attr, kinds, labels, current) {
      return kinds.map(function (k) {
        var on = k === current;
        return '<button class="seg' + (on ? ' is-active' : '') + '" type="button" ' +
          'data-' + attr + '="' + esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          esc(labels[k]) + '</button>';
      }).join('');
    }

    return '<div class="field al-field">' +
      '<label class="field-label">אפשרויות התראה</label>' +
      '<p class="al-hint">איך הפריט הזה יישמע וירטוט כשהתזכורת שלו תגיע.</p>' +
      '<div class="al-row">' +
      '<span class="al-cap">צליל</span>' +
      '<div class="segmented al-sound" role="group" aria-label="סוג צליל">' +
      row('alertsound', ALERT_SOUNDS, ALERT_SOUND_LABEL, ALERT_SOUND_DEFAULT) +
      '</div></div>' +
      '<div class="al-row">' +
      '<span class="al-cap">רטט</span>' +
      '<div class="segmented al-vibe" role="group" aria-label="סוג רטט">' +
      row('alertvibe', VIBE_KINDS, VIBE_LABEL, VIBE_DEFAULT) +
      '</div></div>' +
      '<p class="al-summary block-meta"></p>' +
      '<input type="hidden" name="alertSound" value="' + esc(ALERT_SOUND_DEFAULT) + '">' +
      '<input type="hidden" name="alertVibe" value="' + esc(VIBE_DEFAULT) + '">' +
      '</div>';
  }

  /** the picker's state while a form is open — same shape as FormRemind */
  var FormAlert = {
    sound: ALERT_SOUND_DEFAULT,
    vibe: VIBE_DEFAULT,

    load: function (sound, vibe) {
      this.sound = normAlertSound(sound);
      this.vibe = normVibe(vibe);
      this.paint();
      return this;
    },

    /**
     * A tap on either row. Choosing a sound PREVIEWS it — the tap is a real
     * gesture, so the autoplay policy allows it, and hearing the difference is
     * the only way to choose between "קצר" and "ארוך" without saving first.
     */
    set: function (kind, value) {
      if (kind === 'sound') {
        this.sound = normAlertSound(value);
        Chime.stop();
        Chime.playAlert(this.sound);
      } else {
        this.vibe = normVibe(value);
        Haptics.pattern(this.vibe);
      }
      this.paint();
    },

    paint: function () {
      var box = $('#formFields');
      if (!box || !box.querySelector('.al-field')) return;
      var self = this;

      $$('[data-alertsound]', box).forEach(function (b) {
        var on = b.dataset.alertsound === self.sound;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      $$('[data-alertvibe]', box).forEach(function (b) {
        var on = b.dataset.alertvibe === self.vibe;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var s = box.querySelector('[name="alertSound"]');
      var v = box.querySelector('[name="alertVibe"]');
      if (s) s.value = this.sound;
      if (v) v.value = this.vibe;
      setText(box.querySelector('.al-summary'),
        alertSentence({ alertSound: this.sound, alertVibe: this.vibe }));
    }
  };

  /* ==========================================================================
     קטלוג המצרכים — the pantry catalog (Sprint 15 · mandate)

     A shopping list is not free text that happens to have a title: it is the
     same hundred-and-sixty products, typed again every single week. The mandate
     hands that vocabulary over in ten aisles, and this is the whole of it.

     Two rules keep it from becoming a second store:

       * an aisle is a filter, never a container. חיפוש runs across all ten at
         once, because "סבון" is a word before it is a shelf.
       * nothing is ever auto-added. The list opens empty — the catalog is a
         keyboard, not a template.

     Sprint 16 moved the SURFACE this vocabulary is tapped on (out of the list
     form and into the רשימת קניות module below), but not one product of the
     vocabulary itself: everything from here to pantrySearch() is the Sprint 15
     data, unchanged and still pure.
     ========================================================================== */

  var PANTRY = [
    {
      key: 'legumes', label: 'קטניות',
      items: ['עדשים ירוקות', 'עדשים כתומות', 'עדשים שחורות', 'חומוס', 'שעועית לבנה',
        'שעועית אדומה', 'שעועית שחורה', 'אפונה יבשה', 'פול', 'סויה']
    },
    {
      key: 'frozen', label: 'קפואים',
      items: ['ירקות קפואים', 'אפונה קפואה', 'תירס קפוא', 'ברוקולי קפוא', 'כרובית קפואה',
        'פיצה קפואה', 'בורקס קפוא', 'שניצל קפוא', 'צ׳יפס קפוא', 'גלידה', 'קוביות קרח']
    },
    {
      key: 'canned', label: 'שימורים',
      items: ['טונה', 'תירס', 'אפונה', 'פטריות', 'זיתים', 'מלפפון חמוץ', 'חמוצים',
        'עגבניות מרוסקות', 'רסק עגבניות', 'שעועית', 'חומוס', 'עלי גפן']
    },
    {
      key: 'spices', label: 'תבלינים',
      items: ['מלח', 'פלפל שחור', 'פלפל לבן', 'פפריקה מתוקה', 'פפריקה חריפה', 'כורכום',
        'כמון', 'קינמון', 'זעתר', 'אורגנו', 'בזיליקום', 'טימין', 'רוזמרין', 'אבקת שום',
        'אבקת בצל', 'קארי', 'גראם מסאלה', 'מוסקט', 'הל', 'ציפורן', 'סומאק']
    },
    {
      key: 'oils', label: 'שמנים ורטבים',
      items: ['שמן זית', 'שמן קנולה', 'שמן חמניות', 'שמן קוקוס', 'חומץ', 'חומץ בלסמי',
        'סויה', 'טריאקי', 'קטשופ', 'חרדל', 'מיונז', 'צ׳ילי מתוק', 'ברביקיו', 'טחינה',
        'סילאן', 'דבש']
    },
    {
      key: 'baking', label: 'אפייה',
      items: ['קמח לבן', 'קמח מלא', 'קמח תופח', 'סוכר', 'סוכר חום', 'אבקת אפייה',
        'סודה לשתייה', 'שמרים', 'קקאו', 'שוקולד לאפייה', 'תמצית וניל', 'סוכר וניל',
        'קוקוס טחון']
    },
    {
      key: 'snacks', label: 'חטיפים ומתוקים',
      items: ['שוקולד', 'חטיפי שוקולד', 'וופלים', 'ביסקוויטים', 'במבה', 'ביסלי', 'צ׳יפס',
        'פופקורן', 'בוטנים', 'פיסטוקים', 'קשיו', 'אגוזי מלך', 'אגוזי לוז', 'שקדים',
        'גרעינים', 'סוכריות', 'מסטיקים']
    },
    {
      key: 'drinks', label: 'משקאות',
      items: ['מים מינרליים', 'מים מוגזים', 'קולה', 'דיאט קולה', 'זירו', 'ספרייט', 'פאנטה',
        'אייס טי', 'מיץ תפוזים', 'מיץ ענבים', 'לימונדה', 'קפה', 'קפה נמס', 'קפה שחור',
        'קפסולות קפה', 'תה', 'חליטות']
    },
    {
      key: 'cleaning', label: 'ניקיון הבית',
      items: ['נוזל כלים', 'טבליות למדיח', 'אבקת כביסה', 'ג׳ל כביסה', 'מרכך כביסה',
        'מסיר כתמים', 'אקונומיקה', 'חומר לניקוי רצפות', 'חומר לניקוי אסלות',
        'חומר לניקוי אמבטיה', 'חומר לניקוי חלונות', 'ספריי רב שימושי', 'סנט מוריץ',
        'מטליות', 'ספוגים', 'סקוץ׳', 'כפפות', 'שקיות אשפה', 'נייר סופג', 'נייר אלומיניום',
        'ניילון נצמד', 'נייר אפייה']
    },
    {
      key: 'hygiene', label: 'היגיינה וטיפוח',
      items: ['נייר טואלט', 'מגבונים לחים', 'שמפו', 'מרכך', 'מסכת שיער', 'סבון גוף',
        'סבון ידיים', 'סבון פנים', 'משחת שיניים', 'מברשת שיניים', 'חוט דנטלי', 'מי פה',
        'דאודורנט', 'קרם פנים', 'קרם גוף', 'קרם ידיים', 'קרם גילוח', 'קצף גילוח',
        'סכיני גילוח', 'מקלות אוזניים', 'מגבונים להסרת איפור', 'צמר גפן']
    }
  ];

  /** the vocabulary AS DICTATED — the floor every overlay below is laid over */
  var PANTRY_TOTAL = PANTRY.reduce(function (n, a) { return n + a.items.length; }, 0);

  /**
   * Search is spelling-forgiving on purpose: the geresh in צ׳יפס / סקוץ׳ is a
   * character nobody reaches for on a phone keyboard, so "ציפס" has to find it.
   */
  function pantryNorm(s) {
    return String(s == null ? '' : s)
      .replace(/[׳'’"״“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /* ==========================================================================
     המאגר, בעריכת הבעלים — the catalog overlay (Sprint 17 · field mandate)

     "Add a new custom product under a chosen category. Edit or delete existing
     products directly from the Master Catalog."

     PANTRY above is left EXACTLY as the Sprint 15 mandate dictated it, and the
     owner's changes live beside it as three small facts:

       * add   — { aisleKey: [titles] }, products of the owner's own
       * hide  — [ref], mandated products that were deleted
       * edit  — { ref: title }, mandated products that were renamed

     A `ref` is one product ON one shelf ("canned|חומוס"), never a bare title:
     חומוס sits on two shelves and renaming the tinned one must not touch the
     dry one. Three consequences fall out of the overlay shape for free —
     שחזור המאגר is one assignment, a store written before this sprint needs no
     migration, and a product a future mandate ADDS to PANTRY appears on the
     shelf of somebody who has already been editing for months.
     ========================================================================== */

  /** how long a product name may get before it stops fitting a chip */
  var PRODUCT_MAX = 24;

  /** a product name as the catalog stores it: one line, trimmed, capped */
  function normProduct(s) {
    return String(s == null ? '' : s)
      .replace(/[|\u0000-\u001f]/g, ' ')          // '|' is the ref separator
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PRODUCT_MAX);
  }

  /** the stable handle for one product on one shelf */
  function pantryRef(cat, title) {
    return String(cat == null ? '' : cat) + '|' + pantryNorm(title);
  }

  /* the UI carries `cat|origTitle` on one attribute; these take it apart. The
     title half keeps its original casing, so it is NOT a pantryRef(). */
  function pantryRefCat(ref) { return String(ref == null ? '' : ref).split('|')[0]; }
  function pantryRefOrig(ref) {
    return String(ref == null ? '' : ref).split('|').slice(1).join('|');
  }

  /** the untouched shelf, straight off the mandate */
  function pantryBase(key) {
    for (var i = 0; i < PANTRY.length; i++) {
      if (PANTRY[i].key === key) return PANTRY[i];
    }
    return null;
  }

  function pantryBaseHas(cat, title) {
    var a = pantryBase(cat);
    if (!a) return false;
    var t = pantryNorm(title);
    for (var i = 0; i < a.items.length; i++) {
      if (pantryNorm(a.items[i]) === t) return true;
    }
    return false;
  }

  /** every ref the dictated catalog actually owns — the whitelist for hide/edit */
  function pantryBaseRefs() {
    var refs = {};
    PANTRY.forEach(function (a) {
      a.items.forEach(function (t) { refs[pantryRef(a.key, t)] = true; });
    });
    return refs;
  }

  /**
   * Never trusted, always rebuilt: an unknown shelf, a blank title, a duplicate
   * and a ref that points at a product this build no longer ships are all
   * dropped here rather than allowed to reach a render.
   */
  function normPantryEdits(raw) {
    var out = { add: {}, hide: [], edit: {} };
    if (!raw || typeof raw !== 'object') return out;
    var refs = pantryBaseRefs();

    if (raw.add && typeof raw.add === 'object') {
      PANTRY.forEach(function (a) {
        var list = raw.add[a.key];
        if (!Array.isArray(list)) return;
        var seen = {}, keep = [];
        list.forEach(function (t) {
          var s = normProduct(t);
          var k = pantryNorm(s);
          if (!s || seen[k]) return;
          seen[k] = true;
          keep.push(s);
        });
        if (keep.length) out.add[a.key] = keep;
      });
    }

    if (Array.isArray(raw.hide)) {
      raw.hide.forEach(function (r) {
        var s = String(r == null ? '' : r);
        if (refs[s] && out.hide.indexOf(s) === -1) out.hide.push(s);
      });
    }

    if (raw.edit && typeof raw.edit === 'object') {
      Object.keys(raw.edit).forEach(function (k) {
        var v = normProduct(raw.edit[k]);
        // a rename that hides nothing and a rename of something already deleted
        // are both noise; only a live mandated product carries an override
        if (v && refs[k] && out.hide.indexOf(k) === -1) out.edit[k] = v;
      });
    }
    return out;
  }

  function pantryClone(e) {
    var out = { add: {}, hide: e.hide.slice(), edit: {} };
    Object.keys(e.add).forEach(function (k) { out.add[k] = e.add[k].slice(); });
    Object.keys(e.edit).forEach(function (k) { out.edit[k] = e.edit[k]; });
    return out;
  }

  /**
   * The catalog the app actually shows. Each row keeps `orig` — the name the
   * mandate gave it — because that, not the name on screen, is what a second
   * rename has to be filed against.
   */
  function pantryApply(edits) {
    var e = normPantryEdits(edits);
    return PANTRY.map(function (a) {
      var rows = [];
      a.items.forEach(function (t) {
        var ref = pantryRef(a.key, t);
        if (e.hide.indexOf(ref) !== -1) return;
        rows.push({ title: e.edit[ref] || t, orig: t, custom: false });
      });
      (e.add[a.key] || []).forEach(function (t) {
        rows.push({ title: t, orig: t, custom: true });
      });
      return {
        key: a.key, label: a.label, rows: rows,
        // `.items` stays the plain title list every caller since Sprint 15 reads
        items: rows.map(function (r) { return r.title; })
      };
    });
  }

  /** true once the owner has changed anything at all — the gate on שחזור המאגר */
  function pantryEdited(edits) {
    var e = normPantryEdits(edits);
    return e.hide.length > 0 || Object.keys(e.edit).length > 0 ||
      Object.keys(e.add).length > 0;
  }

  /** the name a product wears right now, given the shelf and its original name */
  function pantryTitleOf(edits, cat, orig) {
    var list = pantryApply(edits);
    var t = pantryNorm(orig);
    for (var i = 0; i < list.length; i++) {
      if (list[i].key !== cat) continue;
      for (var j = 0; j < list[i].rows.length; j++) {
        if (pantryNorm(list[i].rows[j].orig) === t) return list[i].rows[j].title;
      }
    }
    return '';
  }

  /** does this shelf already show a product under that name? */
  function pantryHolds(edits, cat, title) {
    var list = pantryApply(edits);
    var t = pantryNorm(title);
    for (var i = 0; i < list.length; i++) {
      if (list[i].key !== cat) continue;
      for (var j = 0; j < list[i].rows.length; j++) {
        if (pantryNorm(list[i].rows[j].title) === t) return true;
      }
    }
    return false;
  }

  /** הוספה — a product of the owner's own, filed under a shelf they chose */
  function pantryAddProduct(edits, cat, title) {
    var e = normPantryEdits(edits);
    var t = normProduct(title);
    if (!t || !pantryBase(cat)) return e;
    if (pantryHolds(e, cat, t)) return e;              // one name, one shelf, once
    var out = pantryClone(e);
    if (!out.add[cat]) out.add[cat] = [];
    out.add[cat].push(t);
    return normPantryEdits(out);
  }

  /** עריכה — a mandated product gets an override, an owner's product is rewritten */
  function pantryRenameProduct(edits, cat, orig, title) {
    var e = normPantryEdits(edits);
    var t = normProduct(title);
    if (!t || !pantryBase(cat)) return e;
    var was = pantryTitleOf(e, cat, orig);
    if (!was) return e;                                // nothing there to rename
    if (pantryNorm(t) !== pantryNorm(was) && pantryHolds(e, cat, t)) return e;

    var out = pantryClone(e);
    var ref = pantryRef(cat, orig);
    if (pantryBaseHas(cat, orig)) {
      out.edit[ref] = t;
    } else {
      out.add[cat] = (out.add[cat] || []).map(function (x) {
        return pantryNorm(x) === pantryNorm(orig) ? t : x;
      });
    }
    return normPantryEdits(out);
  }

  /** מחיקה — a mandated product is hidden, an owner's product simply leaves */
  function pantryRemoveProduct(edits, cat, orig) {
    var e = normPantryEdits(edits);
    if (!pantryBase(cat) || !pantryTitleOf(e, cat, orig)) return e;

    var out = pantryClone(e);
    var ref = pantryRef(cat, orig);
    delete out.edit[ref];                              // a hidden row needs no name
    if (pantryBaseHas(cat, orig)) {
      if (out.hide.indexOf(ref) === -1) out.hide.push(ref);
    } else {
      out.add[cat] = (out.add[cat] || []).filter(function (x) {
        return pantryNorm(x) !== pantryNorm(orig);
      });
    }
    return normPantryEdits(out);
  }

  /* ---- the store-backed readers every surface goes through ---- */

  /**
   * Memoised on the overlay itself rather than on a dirty flag: every write path
   * assigns a NEW prefs.pantry, so a stale signature is impossible, and
   * pantryCatOf() — called once per row of a shopping list — stops rebuilding
   * the whole catalog each time.
   */
  var pantryMemo = { sig: '\u0000', aisles: null };

  function pantryRaw() {
    return Store.data && Store.data.prefs ? Store.data.prefs.pantry : null;
  }

  function pantryEdits() { return normPantryEdits(pantryRaw()); }

  function pantryAisles() {
    var raw = pantryRaw();
    var sig = raw ? JSON.stringify(raw) : '';
    if (pantryMemo.sig !== sig) {
      pantryMemo.sig = sig;
      pantryMemo.aisles = pantryApply(raw);
    }
    return pantryMemo.aisles;
  }

  /** how many products the catalog shows RIGHT NOW — additions and deletions in */
  function pantryTotal() {
    return pantryAisles().reduce(function (n, a) { return n + a.items.length; }, 0);
  }

  /** the one write path for the overlay: normalise, store, persist */
  function pantryWrite(edits) {
    if (!Store.data || !Store.data.prefs) return null;
    Store.data.prefs.pantry = normPantryEdits(edits);
    Store.save();
    return Store.data.prefs.pantry;
  }

  function pantryAisle(key) {
    var list = pantryAisles();
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i];
    }
    return null;
  }

  function pantryLabel(key) {
    var a = pantryAisle(key);
    return a ? a.label : '';
  }

  /** one aisle, in the row shape the chip grid renders */
  function pantryAisleRows(key) {
    var a = pantryAisle(key) || pantryAisles()[0];
    return a.rows.map(function (r) {
      return { cat: a.key, label: a.label, title: r.title, orig: r.orig, custom: r.custom };
    });
  }

  /** every product whose name contains the query, across all ten aisles */
  function pantrySearch(query) {
    var q = pantryNorm(query);
    if (!q) return [];
    var out = [];
    pantryAisles().forEach(function (a) {
      a.rows.forEach(function (r) {
        if (pantryNorm(r.title).indexOf(q) !== -1) {
          out.push({ cat: a.key, label: a.label, title: r.title, orig: r.orig, custom: r.custom });
        }
      });
    });
    return out;
  }

  /** which shelf a product came from — '' for anything typed by hand */
  function pantryCatOf(title) {
    var t = pantryNorm(title);
    if (!t) return '';
    var list = pantryAisles();
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].rows.length; j++) {
        if (pantryNorm(list[i].rows[j].title) === t) return list[i].key;
      }
    }
    return '';
  }

  /* ==========================================================================
     רשימת קניות — the list itself, as rows rather than as text (Sprint 16)

     Sprint 15 kept the catalog honest by making a TEXTAREA the single source of
     truth: a chip toggled a line and read its own tick back off the field. That
     was the right answer while the catalog lived inside "רשימה חדשה", and it is
     the wrong answer now that it does not. A textarea cannot hold a tick, cannot
     hold an amount, and stops existing the moment the form closes.

     So the source of truth moved down one level, to the items[] of ONE record —
     which is what buys the three things the field mandate asks for: a ✓ that
     survives a reload, a כמות per line, and the same list on every device the
     account is open on, because items_json already round-trips through D1.

     Everything in this block is pure: no DOM, no store, no clock beyond uid().
     ========================================================================== */

  /** the row index of a product, matched on its exact title. -1 when absent. */
  function shopIndex(items, title) {
    var t = String(title == null ? '' : title).trim();
    var rows = Array.isArray(items) ? items : [];
    if (!t) return -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i].title).trim() === t) return i;
    }
    return -1;
  }

  function shopHas(items, title) { return shopIndex(items, title) !== -1; }

  /**
   * The whole of tab 1, as one pure function: a product the list does not hold
   * is appended, a product it holds is removed — and every OTHER row comes back
   * carrying its own id, its own tick and its own amount, because those are the
   * three things a repaint must never be allowed to reset.
   */
  function shopToggle(items, title) {
    var rows = (Array.isArray(items) ? items : []).filter(Boolean);
    var t = String(title == null ? '' : title).trim();
    if (!t) return rows.slice();
    var at = shopIndex(rows, t);
    if (at !== -1) {
      return rows.filter(function (r, i) { return i !== at; });
    }
    return rows.concat([{ id: uid('li'), title: t, done: false }]);
  }

  function shopDrop(items, id) {
    return (Array.isArray(items) ? items : [])
      .filter(function (r) { return r && r.id !== id; });
  }

  /** ticking one row without disturbing the identity or the amount of any row */
  function shopCheck(items, id) {
    return (Array.isArray(items) ? items : []).map(function (r) {
      if (!r || r.id !== id) return r;
      var out = { id: r.id, title: r.title, done: !r.done };
      if (r.qty) out.qty = r.qty;
      return out;
    });
  }

  /** the amount field. A cleared box drops the key rather than storing '' */
  function shopSetQty(items, id, qty) {
    var q = normQty(qty);
    return (Array.isArray(items) ? items : []).map(function (r) {
      if (!r || r.id !== id) return r;
      var out = { id: r.id, title: r.title, done: !!r.done };
      if (q) out.qty = q;
      return out;
    });
  }

  /** the ceiling a ± pair may count to — past this it is a typo, not a shop */
  var QTY_STEP_MAX = 999;

  /**
   * ＋ / − over a FREE-TEXT amount (Sprint 17 · field mandate).
   *
   * The amount was never a number and must not become one: "500 גרם" and "×3"
   * are both real shopping lines. So the stepper finds the first integer
   * anywhere in the value and moves that, keeping whatever surrounds it —
   * "500 גרם" ＋ → "501 גרם", "×3" − → "×2", "" ＋ → "1".
   *
   * Two deliberate refusals: counting down past one CLEARS the amount (nothing
   * on a shopping line means "one of it"), and a value with no digits at all is
   * never destroyed by −, because the text somebody typed is worth more than
   * the stepper's opinion of it.
   */
  function qtyStep(qty, delta) {
    var v = normQty(qty);
    var d = delta < 0 ? -1 : 1;
    var m = v.match(/^(\D*?)(\d+)([\s\S]*)$/);
    if (!m) {
      if (d < 0) return v ? v : '';
      return v ? normQty('2 ' + v) : '1';
    }
    var n = parseInt(m[2], 10) + d;
    if (n <= 0) return '';
    if (n > QTY_STEP_MAX) n = QTY_STEP_MAX;
    return normQty(m[1] + n + m[3]);
  }

  /**
   * Everything a painted list row actually shows, in one string. A repaint that
   * would redraw the identical markup is a repaint that only costs a caret, so
   * paintMine() compares this first and declines.
   */
  function shopSignature(items) {
    return (Array.isArray(items) ? items : []).filter(Boolean).map(function (r) {
      return r.id + '\u0001' + r.title + '\u0001' + (r.done ? '1' : '0') +
        '\u0001' + (r.qty || '');
    }).join('\u0002');
  }

  /** "ניקוי הפריטים שנאספו" — everything already in the cart leaves the list */
  function shopClearDone(items) {
    return (Array.isArray(items) ? items : [])
      .filter(function (r) { return r && !r.done; });
  }

  /** anything typed by hand collects here rather than under a shelf it never came from */
  var SHOP_OTHER = 'מוצרים משלי';

  /**
   * Tab 2, grouped. A product keeps the shelf it was picked from, and the
   * groups come back in PANTRY order — which is the order the aisles are
   * actually walked, not the order the products happened to be tapped in.
   */
  function shopGroups(items) {
    var bag = {}, other = [];
    (Array.isArray(items) ? items : []).filter(Boolean).forEach(function (r) {
      var key = pantryCatOf(r.title);
      if (!key) { other.push(r); return; }
      if (!bag[key]) bag[key] = [];
      bag[key].push(r);
    });

    var out = [];
    PANTRY.forEach(function (a) {
      if (bag[a.key]) out.push({ key: a.key, label: a.label, rows: bag[a.key] });
    });
    if (other.length) out.push({ key: 'other', label: SHOP_OTHER, rows: other });
    return out;
  }

  /* ==========================================================================
     רשימת קניות — the module (Sprint 16 · field mandate)

     WHY IT LEFT THE FORM

     The catalog shipped inside "רשימה חדשה": to reach 161 products you opened
     ＋, chose רשימה, scrolled past four fields, and whatever you ticked belonged
     to that one list and to no other. But the weekly shop is not a document you
     author once — it is a surface you open on the way out of the house, tick
     halfway down an aisle, and come back to next week. Three modals deep is the
     wrong place for it.

     So it is a module: ONE door on היום שלי, two tabs, one record behind both.

       * בחירת מוצרים מתוך הרשימה — the ten aisles and the search across them.
         A tap writes the RECORD, not a draft, which is the whole reason tab 2
         is already correct before it is ever opened.
       * רשימת הקניות שלי — the same items[], grouped by the shelf each product
         came from, every row carrying its own ✓ and its own כמות.

     WHAT OWNS WHAT

       * the open aisle and the query are the module's, and die with the sheet —
         next week's shop does not start where last week's search left off.
       * the open TAB is a pref, like every other sub-tab in the app.
       * every item is the record's. Nothing here holds a copy of one.
     ========================================================================== */

  var SHOP_TABS = ['catalog', 'mine'];

  /**
   * A constant id, not a generated one. It is what makes this the SAME list on
   * the phone and on the laptop the moment the outbox replays: the sync engine
   * matches on id, and a per-device uid() would have produced two lists that
   * both call themselves רשימת קניות and never merge.
   */
  var SHOP_LIST_ID = 'shop-main';
  var SHOP_TITLE = 'רשימת קניות';

  function shopList() { return Store.find('lists', SHOP_LIST_ID); }
  function shopItems() {
    var l = shopList();
    return l && Array.isArray(l.items) ? l.items : [];
  }

  /**
   * Created by the first product, never by the way in: someone who opened the
   * module only to look must not find an empty רשימת קניות waiting for them in
   * רשימות afterwards.
   */
  function shopEnsure() {
    var l = shopList();
    if (l) return l;
    return Store.add('lists', {
      type: 'list', id: SHOP_LIST_ID, title: SHOP_TITLE,
      category: 'personal', items: [], date: '', clientId: ''
    });
  }

  /**
   * The one write path. Local-first like every other mutation in the app: the
   * record, then localStorage + the outbox, then the surfaces.
   *
   * Patch.record() is called rather than Patch.apply() on purpose — the list's
   * row lives in the רשימות workspace, which is behind the sheet and usually
   * off-screen, and apply() answers "not on screen" with a full render() the
   * module does not need.
   */
  function shopWrite(items) {
    var l = shopEnsure();
    l.items = normItems(items, 'li');
    l.updatedAt = Date.now();
    Store.save();
    Patch.record('lists', l.id);
    Patch.settle();                 // ...which is what repaints the module itself
    return l;
  }

  /**
   * A catalog rename follows the product into the list it is already on, so a
   * ✓ and a כמות earned under the old name are not orphaned into מוצרים משלי.
   * Declines when the new name is already a row of its own — merging two lines
   * would silently pick one of their two amounts.
   */
  function shopRename(from, to) {
    var l = shopList();
    if (!l) return false;
    var at = shopIndex(l.items, from);
    if (at === -1 || shopIndex(l.items, to) !== -1) return false;
    l.items = l.items.map(function (r, i) {
      if (i !== at || !r) return r;
      var out = { id: r.id, title: to, done: !!r.done };
      if (r.qty) out.qty = r.qty;
      return out;
    });
    l.updatedAt = Date.now();
    Store.save();
    Patch.record('lists', l.id);
    return true;
  }

  /**
   * True while a finger is inside a field the list owns. Sprint 16 knew that
   * Shop.qty() must not repaint; what it could not know is that the 30-second
   * sync heartbeat ends in render() → Patch.settle() → Shop.paint(), which
   * rebuilt #shopList out from under the caret a second after it was placed —
   * the focus loss, the keyboard collapse and the layout jump the field mandate
   * reported. Nothing rebuilds the container while this is true.
   */
  function shopFieldFocused() {
    var a = document && document.activeElement;
    if (!a || !a.dataset) return false;
    return !!(a.dataset.shopqty || a.dataset.shoprename);
  }

  function shopRow(it) {
    var name = esc(it.title);
    var id = esc(it.id);
    return '<div class="shop-row' + (it.done ? ' is-done' : '') + '" data-shoprow="' + id + '">' +
      '<button class="shop-check" type="button" data-shopcheck="' + id + '" ' +
      'aria-pressed="' + (it.done ? 'true' : 'false') + '" ' +
      'aria-label="' + name + ' — כבר בעגלה">' +
      '<span class="cl-box">' + (it.done ? '✓' : '') + '</span>' +
      '</button>' +
      '<span class="shop-name">' + name + '</span>' +
      // Sprint 17 — the ± pair. A כמות is changed far more often than it is
      // typed, and every tap that used to mean "open the keyboard on a 76px
      // box" is now a 44px button that never moves the row.
      '<div class="shop-qty-box">' +
      '<button class="shop-step" type="button" data-shopstep="-:' + id + '" ' +
      'aria-label="הפחתת הכמות של ' + name + '">−</button>' +
      '<input class="input shop-qty" type="text" autocomplete="off" maxlength="' + QTY_MAX + '" ' +
      'data-shopqty="' + id + '" value="' + esc(it.qty || '') + '" ' +
      'placeholder="כמות" aria-label="כמות עבור ' + name + '">' +
      '<button class="shop-step" type="button" data-shopstep="+:' + id + '" ' +
      'aria-label="הגדלת הכמות של ' + name + '">+</button>' +
      '</div>' +
      '<button class="shop-del" type="button" data-shopdel="' + id + '" ' +
      'aria-label="הסרת ' + name + ' מהרשימה">✕</button>' +
      '</div>';
  }

  /** one product of the master catalog, as a chip that picks it */
  function pantryChip(r, on, searching) {
    return '<button class="pn-chip' + (on ? ' is-on' : '') + '" type="button" ' +
      'data-pantryitem="' + esc(r.title) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="pn-tick">' + (on ? '✓' : '+') + '</span>' +
      '<span class="pn-name">' + esc(r.title) + '</span>' +
      (searching ? '<span class="pn-aisle">' + esc(r.label) + '</span>' : '') +
      '</button>';
  }

  /**
   * The same product while the מאגר is being edited. A chip cannot carry ✎ and
   * ✕ — they would be buttons inside a button — so edit mode swaps the whole
   * grid rather than decorating it, which also makes an accidental "I meant to
   * pick it" impossible while a deletion is one tap away.
   *
   * The row marks WHICH product is being renamed and nothing else: the name
   * field itself is the static #shopRenameBar, because an input drawn into a
   * container the catalog rebuilds is an input that loses its caret.
   */
  function pantryEditRow(r, editing) {
    var ref = r.cat + '|' + r.orig;
    var name = esc(r.title);
    return '<div class="pn-edit' + (editing === ref ? ' is-editing' : '') +
      '" data-pnrow="' + esc(ref) + '">' +
      '<span class="pn-name">' + name + '</span>' +
      (r.custom ? '<span class="pn-own">משלי</span>' : '') +
      '<button class="pn-act" type="button" data-pnedit="' + esc(ref) + '" ' +
      'aria-label="עריכת ' + name + '">✎</button>' +
      '<button class="pn-act pn-act-del" type="button" data-pndel="' + esc(ref) + '" ' +
      'aria-label="מחיקת ' + name + ' מהמאגר">✕</button>' +
      '</div>';
  }

  /** the front door on היום שלי — a live count, so the card is never just a link */
  function renderShopCta() {
    var el = $('#shopCtaMeta');
    if (!el) return;
    var p = progressOf(shopItems());
    setText(el, p.total
      ? plural(p.total, 'פריט אחד', 'פריטים') + ' · ' + p.done + ' כבר בעגלה'
      : 'קטלוג של ' + pantryTotal() + ' מוצרים — בוחרים בהקשה');
  }

  var Shop = {
    cat: PANTRY[0].key,
    query: '',
    // Sprint 17 — the catalog is a keyboard by default and a workbench on
    // request. `manage` is the toggle; `editing` is the one ref being renamed.
    manage: false,
    editing: '',
    // what the aisle strip and the list container were last painted FROM: both
    // are rebuilt only when their own content actually changed
    catsSig: '',
    mineSig: '\u0000',

    isOpen: function () {
      var el = $('#shopSheet');
      return !!el && !el.hidden;
    },

    tab: function () {
      var t = Store.data && Store.data.prefs ? Store.data.prefs.shopTab : '';
      return SHOP_TABS.indexOf(t) === -1 ? SHOP_TABS[0] : t;
    },

    open: function () {
      if (!$('#shopSheet')) return false;
      // every visit starts on the first aisle with no query: the module is a
      // shelf you walk, not a search you left running last Tuesday
      this.cat = PANTRY[0].key;
      this.query = '';
      // ...and never mid-edit: עריכת המאגר is something you go IN to, not a
      // mode a previous visit can leave armed under a deletion button
      this.manage = false;
      this.editing = '';
      this.catsSig = '';
      this.mineSig = '\u0000';
      var box = $('#shopSearch');
      if (box) box.value = '';
      var add = $('#shopNew');
      if (add) add.value = '';
      var np = $('#shopNewProduct');
      if (np) np.value = '';

      $('#typeSheet').hidden = true;
      $('#formSheet').hidden = true;
      if ($('#openSheet')) $('#openSheet').hidden = true;
      Detail.close();
      openSheet('shopSheet');
      this.paint();
      return true;
    },

    setTab: function (key) {
      if (SHOP_TABS.indexOf(key) === -1) return;
      Store.data.prefs.shopTab = key;
      Store.save();
      this.paint();
    },

    setCat: function (key) {
      if (!pantryAisle(key)) return;
      this.cat = key;
      // an aisle tap answers a different question than a search, so it clears
      // the query rather than filtering the results of it
      this.query = '';
      this.editing = '';
      var box = $('#shopSearch');
      if (box) box.value = '';
      // Sprint 17 · field mandate — and it starts at the TOP of the new shelf.
      // The grid scrolls inside itself, so without this the offset from the
      // previous aisle survives and lands the finger halfway down a shelf
      // nobody has looked at yet.
      this.scrollTop();
      this.paint();
    },

    setQuery: function (q) {
      this.query = String(q == null ? '' : q);
      this.editing = '';
      // a new result set is a new list: same rule as an aisle switch
      this.scrollTop();
      this.paintCatalog(shopItems());
    },

    /** the catalog grid, back at its first row. Never touches the sheet's own
     *  scroll — that one belongs to the finger, not to the tab strip. */
    scrollTop: function () {
      var grid = $('#shopItems');
      if (grid) grid.scrollTop = 0;
      var pane = $('#shopPaneCatalog');
      if (pane) pane.scrollTop = 0;
    },

    /* ---- the writes. Every one of them ends in the record, never in a draft ---- */

    toggle: function (title) { shopWrite(shopToggle(shopItems(), title)); },

    /**
     * Ticking is the one write here that does not change MEMBERSHIP, so it gets
     * the same treatment every other state change in the app gets (Sprint 7):
     * the row under the finger is swapped in place, and the container around it
     * is left alone. Rebuilding it would destroy the button mid-press.
     */
    check: function (id) {
      var l = shopList();
      if (!l) return;
      l.items = shopCheck(l.items, id);
      l.updatedAt = Date.now();
      Store.save();
      Patch.record('lists', l.id);

      var node = $('[data-shoprow="' + id + '"]');
      var row = shopItems().filter(function (r) { return r.id === id; })[0];
      if (node && row) {
        node.outerHTML = shopRow(row);
        // the container now matches the record again, so the next repaint has
        // nothing to do — which is what keeps the sync heartbeat off the caret
        this.mineSig = shopSignature(shopItems());
      } else this.paint();                  // not on screen — repaint properly

      var p = progressOf(shopItems());
      this.paintMeta(p);
      renderShopCta();
      if (p.total && p.done === p.total) {
        Haptics.done();
        toast('הכול בעגלה 🎉');
      }
    },

    drop: function (id) { shopWrite(shopDrop(shopItems(), id)); },

    /**
     * The one write that deliberately does NOT repaint: the box being typed
     * into lives inside the container a repaint rebuilds, and rebuilding it
     * mid-keystroke would take the caret with it.
     */
    qty: function (id, v) {
      var l = shopList();
      if (!l) return;
      l.items = shopSetQty(l.items, id, v);
      l.updatedAt = Date.now();
      Store.save();
      Patch.record('lists', l.id);
    },

    /**
     * ＋ / − (Sprint 17 · field mandate). The record is written and the box is
     * updated IN PLACE — not through a repaint, because a repaint is exactly
     * the jitter the pair was added to remove. Only a row that is not on screen
     * falls back to painting, which is the same rule check() has followed since
     * Sprint 16.
     */
    step: function (id, delta) {
      var l = shopList();
      if (!l) return;
      var row = shopItems().filter(function (r) { return r.id === id; })[0];
      if (!row) return;

      var next = qtyStep(row.qty, delta);
      if (next === normQty(row.qty)) return;      // − on free text: nothing to do

      l.items = shopSetQty(l.items, id, next);
      l.updatedAt = Date.now();
      Store.save();
      Patch.record('lists', l.id);

      var box = $('[data-shopqty="' + id + '"]');
      if (box) {
        box.value = next;
        this.mineSig = shopSignature(shopItems());
      } else this.paint();
    },

    /**
     * A product the catalog has never heard of, typed straight into tab 2. It
     * goes through shopToggle() rather than around it, so a manual product and a
     * tapped chip produce the identical row — and the duplicate is caught first,
     * because here a second "חומוס" is a typo rather than an un-tick.
     */
    add: function () {
      var box = $('#shopNew');
      var title = box ? String(box.value || '').trim() : '';
      if (!title) { warn('צריך שם מוצר'); return; }
      if (shopHas(shopItems(), title)) {
        if (box) box.value = '';
        toast('המוצר כבר ברשימה');
        return;
      }
      shopWrite(shopToggle(shopItems(), title));
      if (box) { box.value = ''; box.focus(); }
    },

    /**
     * The two bulk clears ask first, because they destroy a list somebody
     * built. Removing ONE row does not: it is a single tap to put back, from
     * either tab, and a question in front of it would make the module unusable
     * at the pace a shopping list is actually edited at.
     */
    clear: function (what) {
      var items = shopItems();
      if (!items.length) { toast('הרשימה כבר ריקה'); return; }

      if (what === 'done') {
        var left = shopClearDone(items);
        var gone = items.length - left.length;
        if (!gone) { toast('אין פריטים מסומנים לניקוי'); return; }
        confirmDelete(SHOP_TITLE + ' · ' + gone + ' פריטים שכבר נאספו', function () {
          shopWrite(shopClearDone(shopItems()));
          toast('הפריטים שנאספו נוקו');
        });
        return;
      }

      confirmDelete(SHOP_TITLE + ' · כל ' + items.length + ' הפריטים', function () {
        shopWrite([]);
        toast('הרשימה רוקנה');
      });
    },

    /* ---- עריכת המאגר (Sprint 17 · field mandate) ---------------------------
       The catalog stopped being read-only vocabulary. Everything here writes
       prefs.pantry — never PANTRY — through the one pantryWrite() path, and
       every destructive one goes through confirmDelete(): a product removed
       from the מאגר is gone from every future shop, not from one list.       */

    setManage: function (on) {
      this.manage = !!on;
      this.editing = '';
      this.scrollTop();
      this.paintCatalog(shopItems());
    },

    /** הוספה — a product of the owner's own, on the shelf that is open */
    catalogAdd: function () {
      var box = $('#shopNewProduct');
      var title = normProduct(box ? box.value : '');
      var aisle = pantryAisle(this.cat);
      if (!aisle) return;
      if (!title) { warn('צריך שם מוצר'); return; }

      var edits = pantryEdits();
      if (pantryHolds(edits, this.cat, title)) {
        toast('"' + title + '" כבר במדף ' + aisle.label);
        return;
      }
      pantryWrite(pantryAddProduct(edits, this.cat, title));
      if (box) { box.value = ''; box.focus(); }

      // a search would hide the shelf the product just landed on
      this.query = '';
      var s = $('#shopSearch');
      if (s) s.value = '';
      this.paint();
      toast('"' + title + '" נוסף ל' + aisle.label);
    },

    /** ✎ — the rename bar opens over the product it names, pre-filled */
    catalogEdit: function (ref) {
      var r = String(ref == null ? '' : ref);
      var was = pantryTitleOf(pantryEdits(), pantryRefCat(r), pantryRefOrig(r));
      if (!was) return;
      this.editing = r;
      this.paintCatalog(shopItems());
      // the value is written HERE and never in paintCatalog(): a repaint that
      // re-filled the box would undo whatever is half-typed in it
      var box = $('#shopRename');
      if (box) {
        box.value = was;
        if (box.focus) box.focus();
      }
    },

    catalogCancel: function () {
      this.editing = '';
      var box = $('#shopRename');
      if (box) box.value = '';
      this.paintCatalog(shopItems());
    },

    /** עריכה — the new name, and the row in the list that is already wearing the old one */
    catalogSave: function (ref) {
      var r = String(ref == null ? '' : ref) || this.editing;
      var cat = pantryRefCat(r), orig = pantryRefOrig(r);
      var box = $('#shopRename');
      var next = normProduct(box ? box.value : '');
      if (!next) { warn('צריך שם מוצר'); return; }

      var edits = pantryEdits();
      var was = pantryTitleOf(edits, cat, orig);
      if (!was) { this.catalogCancel(); return; }

      if (pantryNorm(next) !== pantryNorm(was) && pantryHolds(edits, cat, next)) {
        warn('כבר יש מוצר בשם הזה במדף');
        return;
      }
      pantryWrite(pantryRenameProduct(edits, cat, orig, next));
      if (was !== next) shopRename(was, next);
      this.editing = '';
      if (box) box.value = '';
      this.paint();
      toast('השם עודכן');
    },

    /** מחיקה — out of the מאגר, which is every future shop, so it asks first */
    catalogRemove: function (ref) {
      var r = String(ref == null ? '' : ref);
      var cat = pantryRefCat(r), orig = pantryRefOrig(r);
      var was = pantryTitleOf(pantryEdits(), cat, orig);
      if (!was) return;

      confirmDelete('"' + was + '" מתוך מאגר המוצרים', function () {
        pantryWrite(pantryRemoveProduct(pantryEdits(), cat, orig));
        Shop.editing = '';
        Shop.paint();
        // the row it may already own in the list is deliberately left alone:
        // deleting a product from the מאגר is not deleting this week's shop
        toast('המוצר הוסר מהמאגר');
      });
    },

    /** שחזור המאגר — the whole overlay, in one assignment. Never a re-import. */
    catalogReset: function () {
      if (!pantryEdited(pantryEdits())) { toast('המאגר כבר במצבו המקורי'); return; }
      confirmDelete('כל השינויים שנעשו במאגר המוצרים', function () {
        pantryWrite(null);
        Shop.editing = '';
        Shop.paint();
        toast('המאגר שוחזר למקור');
      });
    },

    /* ---- paint ---- */

    paint: function () {
      renderShopCta();
      if (!this.isOpen()) return;

      var tab = this.tab();
      var items = shopItems();
      var prog = progressOf(items);

      $$('#shopSheet [data-shoptab]').forEach(function (b) {
        var on = b.dataset.shoptab === tab;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $$('#shopSheet [data-shoppane]').forEach(function (p) {
        p.hidden = p.dataset.shoppane !== tab;
      });

      // the catalog's count is vocabulary the owner now owns, so it is read
      // live; the list's is derived state and belongs to paintMeta(), which is
      // the one place that owns it
      setText($('#shopCountCatalog'), String(pantryTotal()));

      this.paintCatalog(items);
      this.paintMine(items, prog);
    },

    paintCatalog: function (items) {
      var self = this;
      var searching = pantryNorm(this.query) !== '';
      var aisles = pantryAisles();

      // the aisle strip is vocabulary rather than state — but since Sprint 17
      // the vocabulary itself can change, so it is rebuilt when its own counts
      // move and only re-marked otherwise
      var cats = $('#shopCats');
      var sig = aisles.map(function (a) { return a.key + ':' + a.items.length; }).join('|');
      if (cats && sig !== this.catsSig) {
        this.catsSig = sig;
        cats.innerHTML = aisles.map(function (a) {
          return '<button class="pn-cat" type="button" data-pantrycat="' + esc(a.key) + '" ' +
            'aria-pressed="false">' + esc(a.label) +
            '<span class="pn-n">' + a.items.length + '</span></button>';
        }).join('');
      }
      $$('#shopCats [data-pantrycat]').forEach(function (b) {
        var on = !searching && b.dataset.pantrycat === self.cat;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      /* ---- the עריכת המאגר toolbar ---- */
      var mBtn = $('#shopManage');
      if (mBtn) {
        mBtn.classList.toggle('is-on', this.manage);
        mBtn.setAttribute('aria-pressed', this.manage ? 'true' : 'false');
        setText(mBtn, this.manage ? '✓ סיום עריכה' : '✎ עריכת המאגר');
      }
      var rBtn = $('#shopCatReset');
      if (rBtn) rBtn.hidden = !(this.manage && pantryEdited(pantryEdits()));

      // adding is offered only while editing, and only onto a NAMED shelf: a
      // product has to land somewhere, and a running search names none
      var addBox = $('#shopCatalogAdd');
      if (addBox) addBox.hidden = !this.manage || searching;
      var addField = $('#shopNewProduct');
      if (addField) addField.placeholder = 'מוצר חדש במדף ' + pantryLabel(this.cat) + '…';

      var rBar = $('#shopRenameBar');
      if (rBar) rBar.hidden = !this.editing;
      var who = $('#shopRenameWho');
      if (who) {
        setText(who, this.editing
          ? 'שם חדש עבור "' + pantryTitleOf(pantryEdits(),
            pantryRefCat(this.editing), pantryRefOrig(this.editing)) + '"'
          : '');
      }

      var rows = searching ? pantrySearch(this.query) : pantryAisleRows(this.cat);
      var box = $('#shopItems');
      if (box) {
        box.classList.toggle('is-manage', this.manage);
        box.innerHTML = rows.length
          ? rows.map(function (r) {
            return self.manage
              ? pantryEditRow(r, self.editing)
              : pantryChip(r, shopHas(items, r.title), searching);
          }).join('')
          : '<p class="pn-empty">אין מוצר כזה בקטלוג — אפשר להוסיף אותו למאגר ' +
            'דרך "✎ עריכת המאגר", או ידנית בלשונית "רשימת הקניות שלי".</p>';
      }

      var picked = progressOf(items).total;
      setText($('#shopSummary'), searching
        ? plural(rows.length, 'תוצאה אחת', 'תוצאות') + ' · ' + picked + ' פריטים ברשימה'
        : pantryLabel(this.cat) + ' · ' + rows.length + ' מוצרים · ' + picked + ' פריטים ברשימה');
    },

    /**
     * Sprint 17 — the rebuild is now conditional, on two counts.
     *
     * A repaint that would produce byte-identical markup is a repaint that only
     * costs a caret, and one that lands while a כמות box has the focus costs
     * the keyboard with it: the sync heartbeat ends in render() → settle() →
     * paint(), roughly a second after a finger reaches the amount field, which
     * is precisely the "focus / re-render layout jump" the mandate reported.
     * So the container is rebuilt only when the record it draws actually
     * changed, and never while the finger is inside one of its own fields.
     */
    paintMine: function (items, prog) {
      var box = $('#shopList');
      if (box) {
        var sig = shopSignature(items);
        if (sig !== this.mineSig && !shopFieldFocused()) {
          this.mineSig = sig;
          var groups = shopGroups(items);
          box.innerHTML = groups.length
            ? groups.map(function (g) {
              return '<div class="shop-band">' + esc(g.label) +
                '<span class="shop-band-n">' + g.rows.length + '</span></div>' +
                g.rows.map(shopRow).join('');
            }).join('')
            : emptyState('הרשימה ריקה',
              'אפשר לבחור מוצרים מהקטלוג בלשונית "בחירת מוצרים מתוך הרשימה", או להקליד כאן מוצר משלך.');
        }
      }
      this.paintMeta(prog || progressOf(items));
    },

    /** the derived text: cheap, idempotent, and safe to run without a rebuild */
    paintMeta: function (prog) {
      var p = prog || progressOf(shopItems());
      setText($('#shopCountMine'), String(p.total));
      setText($('#shopMineSummary'), p.total
        ? plural(p.total, 'פריט אחד', 'פריטים') + ' · ' + p.done + ' בעגלה · ' +
          (p.total - p.done) + ' נותרו'
        : 'אין עדיין פריטים ברשימה');
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

  /* ==========================================================================
     Universal edit (Wave 2)

     Every card in the app opens the SAME typed form it was created with,
     pre-filled, and saves back into the same record. Two rules make that safe:

       * a collection with a dedicated writer is edited THROUGH it —
         setTaskStatus() keeps `done` in lockstep with status, setClientStatus()
         and setClientNextAction() keep writing the client timeline. An edit is
         not a back door around the model.
       * a checklist keeps its progress. mergeChecklist() matches an edited line
         back to the row it came from by title, so fixing a typo in a ten-item
         list does not un-tick the nine that were already done.
     ========================================================================== */

  var EDIT_TYPE = {
    events: 'event', tasks: 'task', lists: 'list', notes: 'note', clients: 'client'
  };
  var COLLECTION_OF = {
    event: 'events', task: 'tasks', list: 'lists', note: 'notes', client: 'clients'
  };

  /** checklist rows → the textarea shape the form edits them in */
  function itemLines(items) {
    return (Array.isArray(items) ? items : [])
      .map(function (it) { return it && it.title ? it.title : ''; })
      .filter(Boolean).join('\n');
  }

  /** record → form values, keyed by input name. The inverse of submitForm(). */
  var TO_FORM = {
    events: function (r) {
      return {
        title: r.title, date: r.date, start: r.start, end: r.end,
        location: r.location, notes: r.notes, clientId: r.clientId,
        reminders: remindColumn(r),
        alertSound: normAlertSound(r.alertSound), alertVibe: normVibe(r.alertVibe)
      };
    },
    tasks: function (r) {
      return {
        title: r.title, due: r.due, time: r.time,
        status: normStatus(r.status), priority: normPriority(r.priority),
        nextAction: r.nextAction, clientId: r.clientId,
        subtasks: itemLines(r.subtasks), notes: r.notes,
        reminders: remindColumn(r),
        alertSound: normAlertSound(r.alertSound), alertVibe: normVibe(r.alertVibe)
      };
    },
    lists: function (r) {
      return { title: r.title, date: r.date, clientId: r.clientId, items: itemLines(r.items) };
    },
    notes: function (r) {
      return {
        title: r.title, body: r.body, clientId: r.clientId,
        alertSound: normAlertSound(r.alertSound), alertVibe: normVibe(r.alertVibe)
      };
    },
    clients: function (r) {
      return {
        name: r.name, phone: r.phone, email: r.email,
        status: normClientStatus(r.status), interest: r.interest, budget: r.budget,
        nextAction: r.nextAction, nextActionAt: r.nextActionAt,
        followUpAt: r.followUpAt, notes: r.notes
      };
    }
  };

  /** an edited line keeps the id and the done state of the row it came from */
  function mergeChecklist(existing, text, prefix) {
    var pool = (Array.isArray(existing) ? existing : []).filter(Boolean).slice();
    return parseChecklist(text, prefix).map(function (row) {
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].title === row.title) {
          var keep = pool.splice(i, 1)[0];
          var back = { id: keep.id, title: row.title, done: !!keep.done };
          // an amount is progress too: editing the שם of a list must not quietly
          // wipe "2 ק״ג" off every line that survived the edit
          if (keep.qty) back.qty = keep.qty;
          return back;
        }
      }
      return row;
    });
  }

  /**
   * Write an edited form back into its record. Returns the Hebrew toast label,
   * or '' when validation stopped the save (the warning has already fired).
   */
  function applyEdit(collection, id, v, cat) {
    var rec = Store.find(collection, id);
    if (!rec) { warn('הפריט לא נמצא — ייתכן שנמחק'); return ''; }

    var label = '';
    rec.category = normCat(cat);

    if (collection === 'events') {
      if (!v.title) { warn('צריך כותרת לאירוע'); return ''; }
      rec.title = v.title;
      rec.date = v.date || todayISO();
      rec.start = v.start || '';
      rec.end = v.end || '';
      rec.location = v.location || '';
      rec.notes = v.notes || '';
      rec.clientId = v.clientId || '';
      setReminders(rec, v.reminders);
      setAlertFrom(rec, v);
      label = 'האירוע עודכן';
    } else if (collection === 'tasks') {
      if (!v.title) { warn('צריך שם למשימה'); return ''; }
      rec.title = v.title;
      rec.due = v.due || '';
      rec.time = v.time || '';
      rec.priority = normPriority(v.priority);
      rec.nextAction = v.nextAction || '';
      rec.notes = v.notes || '';
      rec.clientId = v.clientId || '';
      setReminders(rec, v.reminders);
      setAlertFrom(rec, v);
      rec.subtasks = mergeChecklist(rec.subtasks, v.subtasks, 'st');
      setTaskStatus(rec, v.status || rec.status);        // keeps `done` in lockstep
      label = 'המשימה עודכנה';
    } else if (collection === 'lists') {
      if (!v.title) { warn('צריך שם לרשימה'); return ''; }
      rec.title = v.title;
      rec.date = v.date || '';
      rec.clientId = v.clientId || '';
      rec.items = mergeChecklist(rec.items, v.items, 'li');
      label = 'הרשימה עודכנה';
    } else if (collection === 'notes') {
      if (!v.body) { warn('הפתק ריק'); return ''; }
      rec.title = v.title || 'פתק';
      rec.body = v.body;
      rec.clientId = v.clientId || '';
      setAlertFrom(rec, v);
      label = 'הפתק עודכן';
    } else if (collection === 'clients') {
      if (!v.name) { warn('צריך שם ללקוח'); return ''; }
      rec.name = v.name;
      rec.phone = v.phone || '';
      rec.email = v.email || '';
      rec.interest = v.interest || '';
      rec.budget = v.budget || '';
      rec.followUpAt = v.followUpAt || '';
      rec.notes = v.notes || '';
      setClientStatus(rec, v.status || rec.status);                        // logs the move
      setClientNextAction(rec, v.nextAction || '', v.nextActionAt || '');  // logs it too
      label = 'תיק הלקוח עודכן';
    } else {
      return '';
    }

    touch(rec);                 // strictly newer, so the outbox pushes the edit
    Store.save();
    return label;
  }

  /** fill the freshly built form with the record it is editing */
  function fillForm(type, rec) {
    var fields = $('#formFields');
    var map = TO_FORM[COLLECTION_OF[type]];
    if (!fields || !map || !rec) return false;

    var values = map(rec);
    Object.keys(values).forEach(function (name) {
      var el = fields.querySelector('[name="' + name + '"]');
      if (!el) return;
      el.value = values[name] == null ? '' : values[name];
    });
    return true;
  }

  function openEdit(collection, id) {
    var type = EDIT_TYPE[collection];
    var rec = type ? Store.find(collection, id) : null;
    if (!rec) return false;
    openForm(type, null, rec);
    return true;
  }

  function openForm(type, prefill, edit) {
    if (prefill) PREFILL = prefill;             // opened straight from a client file
    UI.formType = type;
    UI.editId = edit ? edit.id : null;
    UI.formCat = edit ? normCat(edit.category) : ((type === 'client') ? 'business' : 'personal');

    $('#formSheetTitle').textContent = (edit ? 'עריכה · ' : '') + TYPE_LABEL[type];
    $('#formFields').innerHTML = FIELDS[type]();
    setFormCat(UI.formCat);
    if (edit) fillForm(type, edit); else applyPrefill();
    // after the values are in: the panel's opening state is the record's own
    // reminder list, and a blank form opens on the system default
    var held = rmEl('[name="reminders"]');
    if (held) FormRemind.load(held.value || REMIND_DEFAULT);

    // ...and the same for the alert picker: fillForm() has already written the
    // record's own pair into the two hidden fields, so the panel opens on them
    var heldSound = rmEl('[name="alertSound"]');
    var heldVibe = rmEl('[name="alertVibe"]');
    if (heldSound || heldVibe) {
      FormAlert.load(heldSound ? heldSound.value : ALERT_SOUND_DEFAULT,
        heldVibe ? heldVibe.value : VIBE_DEFAULT);
    }

    $('#typeSheet').hidden = true;
    // the reader is what "עריכה" was tapped from; it must not stay layered
    // behind the form it just opened
    Detail.close();
    if ($('#openSheet')) $('#openSheet').hidden = true;
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

    /* The panel is the authority on its own list, not the hidden mirror of it:
       a datetime-local that was still focused when שמירה was tapped may not
       have fired `change` yet, and the reminder the user just typed must not
       be the one thing the save drops. */
    if (rmEl('.rm-field')) v.reminders = FormRemind.value();

    // same rule for the alert picker — the module is the authority, the two
    // hidden fields are only its mirror
    if (rmEl('.al-field')) {
      v.alertSound = FormAlert.sound;
      v.alertVibe = FormAlert.vibe;
    }

    var type = UI.formType, cat = UI.formCat, label;

    // the same sheet edits what it created (Wave 2) — no second form, no drift
    if (UI.editId) {
      label = applyEdit(COLLECTION_OF[type], UI.editId, v, cat);
      if (!label) return false;                 // validation already warned
    } else if (type === 'event') {
      if (!v.title) return warn('צריך כותרת לאירוע');
      Store.add('events', {
        type: 'event', title: v.title, category: cat,
        date: v.date || todayISO(), start: v.start || '', end: v.end || '',
        location: v.location || '', notes: v.notes || '', clientId: v.clientId || '',
        // Sprint 12 — a token list, normalised again by migrateEvent() on the
        // way in, so `remind` (the column's value) can only ever be derived
        reminders: normRemindList(v.reminders),
        // Sprint 13 — how it announces itself, normalised again by the migrator
        alertSound: normAlertSound(v.alertSound), alertVibe: normVibe(v.alertVibe)
      });
      linkLog(v.clientId, 'נקבעה פגישה: ' + v.title);
      label = 'האירוע נוסף';
    } else if (type === 'task') {
      if (!v.title) return warn('צריך שם למשימה');
      Store.add('tasks', {
        type: 'task', title: v.title, category: cat,
        // Sprint 10 — an empty date is now a real answer, not a missing one:
        // it files the task into נכנסים instead of pretending it is due today
        due: v.due || '', time: v.time || '',
        status: v.status || 'new', priority: v.priority || 'medium',
        nextAction: v.nextAction || '', subtasks: parseChecklist(v.subtasks, 'st'),
        done: false, notes: v.notes || '', clientId: v.clientId || '',
        reminders: normRemindList(v.reminders),
        alertSound: normAlertSound(v.alertSound), alertVibe: normVibe(v.alertVibe)
      });
      linkLog(v.clientId, 'נוספה משימה: ' + v.title);
      label = v.due ? 'המשימה נוספה' : 'המשימה נוספה לנכנסים';
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
        type: 'note', title: v.title || 'פתק', category: cat, body: v.body,
        pinned: false, clientId: v.clientId || '',
        alertSound: normAlertSound(v.alertSound), alertVibe: normVibe(v.alertVibe)
      });
      linkLog(v.clientId, 'נוסף פתק: ' + (v.title || 'פתק'));
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

    // §2 — saved is not the same as visible. Widen whatever is hiding it first,
    // and only then paint, so ONE render() shows the finished state.
    var widened = reveal(cat, v.date || v.due || '');

    closeSheets();
    render();
    if (backTo) Drawer.open(backTo, backTab);
    toast(label + ' · ' + CAT_LABEL[cat] + (widened ? ' · ' + widened : ''));
  }

  /* ==========================================================================
     Real-time visibility (Sprint 12 · mandate §2)

     The field report was "I create it and it is not there until I refresh".
     The store was never the problem — every selector returns the new record
     the instant it is added. Two things in the VIEW layer could still hide it,
     and a reload cleared both, which is exactly why a refresh "fixed" it:

       1. the global category filter. pick() gates every read path, so a
          personal task created while the filter reads "עסקי" is counted by the
          summary and drawn by nothing. That is the same shape as the Sprint 10
          field report — counted somewhere, listed nowhere.

       2. the calendar anchor. `Cal.anchor` is initialised once, when app.js is
          parsed. A home-screen PWA is RESUMED rather than reloaded (see the
          service-worker notes above), so an app left open overnight is still
          anchored on yesterday: a record created "for today" lands on a day the
          calendar is not showing, and only a reload re-anchors it.

     reveal() closes both, and says out loud in the toast when it had to.
     ========================================================================== */

  /** does the active calendar period actually contain this day? */
  function calShows(iso) {
    return Cal.rangeDays().indexOf(iso) !== -1;
  }

  /**
   * Make a just-saved record reachable. Returns a short Hebrew note about what
   * had to move, or '' when nothing did — silence is the common case.
   */
  function reveal(cat, iso) {
    var moved = [];

    var filter = filterCat();
    if (filter !== 'all' && normCat(cat) !== filter) {
      Store.data.prefs.filter = 'all';
      Store.save();
      $$('.topbar .seg').forEach(function (b) {
        var on = b.dataset.filter === 'all';
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      moved.push('התצוגה נפתחה להכל');
    }

    if (iso && !calShows(iso)) {
      Cal.anchor = iso;
      moved.push('היומן עבר ל' + relDay(iso));
    }

    return moved.join(' · ');
  }

  /**
   * The day rolled over under an app that was never reloaded.
   *
   * Everything on My Day is derived from todayISO(), which is read fresh on
   * every paint — but `Cal.anchor` was captured once at parse time, and the
   * fired-ledger sweep, the is-now timeline row and the "היום" board all read
   * as yesterday's until something forces a repaint. The scan already runs
   * every SCAN_MS; this rides along with it and costs one string compare.
   */
  var PAINTED_DAY = todayISO();

  function dayGuard() {
    var t = todayISO();
    if (t === PAINTED_DAY) return false;
    if (Cal.anchor === PAINTED_DAY) Cal.anchor = t;   // follow the day, if it was on it
    PAINTED_DAY = t;
    render();
    return true;
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
  function toast(msg, action, ms) {
    // Wave 1 · B1 — a plain toast REPLACES the pill, hiding אחזר while the
    // pending deletion stayed armed with no way to reach it. The window closes
    // with the button that carried it: whatever this toast is about, an undo
    // the user can no longer see is an undo that has already expired. Decided
    // before the pill is even looked up — this is state, not paint.
    if (!action) Undo.commit();

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
    }, action ? (ms || UNDO_MS) : TOAST_MS);
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

  /* How an installed phone actually lands on new code.

     sw.js calls skipWaiting() and clients.claim(), so a new worker takes charge
     by itself — but claiming a client does NOT reload it. The open document
     keeps running the app.js it parsed at launch, and a home-screen PWA is
     resumed rather than reloaded, so a phone could sit on last week's screen
     indefinitely with a brand-new worker in charge. That is exactly the "the
     screen never changed" report. Three things close it:

       1. controllerchange => reload once, so the new code is the code running.
       2. reg.waiting / reg.installing are read up front — updatefound can fire
          before this listener is ever attached, and that update would then sit
          waiting forever with nobody to hand it the page.
       3. reg.update() on resume — a home-screen app can go days without the
          navigation that would otherwise trigger the browser's own check. */

  var SW_UPDATE_MS = 60 * 1000;   // one check per minute of foreground, at most
  var swReloading = false;
  var swCheckedAt = 0;

  /** Reload, but never out from under a half-filled form. */
  function swReload() {
    if (swReloading) return;
    swReloading = true;
    (function whenIdle() {
      var backdrop = $('#backdrop');
      // a visible backdrop means a sheet or the client drawer is open, and the
      // finger is mid-edit: the update can wait for the tap that closes it
      if (backdrop && !backdrop.hidden) { setTimeout(whenIdle, 800); return; }
      window.location.reload();
    })();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;   // a worker needs http(s)

    // read BEFORE registering: with no previous controller the first install
    // also fires controllerchange, and reloading there is a pointless flash
    var hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) swReload();
    });

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      /** Push a worker that finished installing into control of this page. */
      function adopt(sw) {
        if (!sw) return;
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('גרסה חדשה — מעדכן…');
          sw.postMessage({ type: 'SKIP_WAITING' });      // sw.js answers this
          return;
        }
        if (sw.state === 'installing') {
          sw.addEventListener('statechange', function once() {
            sw.removeEventListener('statechange', once);  // one hop, no leak
            adopt(sw);
          });
        }
      }

      adopt(reg.waiting || reg.installing);              // an update we missed
      reg.addEventListener('updatefound', function () { adopt(reg.installing); });

      function checkForUpdate() {
        if (document.visibilityState === 'hidden') return;
        var now = Date.now();
        if (now - swCheckedAt < SW_UPDATE_MS) return;
        swCheckedAt = now;
        reg.update()['catch'](function () { /* offline — retry on next resume */ });
      }
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('focus', checkForUpdate);
      checkForUpdate();
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

  /* relative, exactly like SYNC_ENDPOINT and GCAL_ENDPOINT */
  var PUSH_ENDPOINT = 'api/push';

  /**
   * Sprint 11 — how late a reminder may still be raised, in minutes.
   *
   * Until now the window was `0 <= gap <= lead`: the moment a start time went
   * one minute past, the record was skipped and, because the scan only ever
   * looks forward, skipped forever. Anything that cost the scan a minute — a
   * screen that slept, a tab in the background, a task created "for a minute
   * ago" — silently swallowed the reminder. That is the "nothing fired" half of
   * the field report, and a hard `gap < 0` is the whole of it.
   *
   * A late reminder is still worth having; a stale one is not. Twenty minutes
   * is the line, and the fired-ledger still guarantees exactly one delivery.
   */
  var MISS_GRACE_MIN = 20;

  var Notify = {
    timer: null,
    // the in-flight server registration, so a focus + a launch cannot race
    linking: null,

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
      this.paintSound();
      this.paintAlert();

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
        btn.title = 'ההתראות חסומות בהגדרות האתר בדפדפן';
      } else if (p === 'granted' && Store.data.prefs.notify.on) {
        btn.classList.add('is-on');
        ico.textContent = '🔔';
        label.textContent = 'התראות פעילות';
        btn.setAttribute('aria-pressed', 'true');
        // the honest difference between the two delivery paths, on the control
        // itself: a locally-scheduled reminder cannot outlive a closed app
        btn.title = Store.data.prefs.notify.serverAt
          ? 'התראות שרת פעילות — יגיעו גם כשהאפליקציה סגורה'
          : 'התראות מקומיות בלבד — יגיעו רק כשהאפליקציה פתוחה';
      } else {
        ico.textContent = '🔔';
        label.textContent = 'הפעל התראות פוש';
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'הפעלת התראות פוש ותזכורות';
      }
    },

    /**
     * The permission state, reduced to the four answers a banner has to give.
     * 'off' is a granted permission the user has switched off inside the app —
     * a deliberate choice, so it is stated but not shouted about.
     */
    alertState: function () {
      if (!this.supported()) return 'unsupported';
      var p = this.permission();
      if (p === 'denied') return 'denied';
      if (p !== 'granted') return 'ask';
      return Store.data.prefs.notify.on ? 'ok' : 'off';
    },

    /**
     * Sprint 11 — the permission, said out loud on the screen the app opens on.
     *
     * The top-bar pill already carries the state, but it is one of four pills in
     * a crowded bar. A user who never notices it has no reminders and no idea
     * why, and a *blocked* permission is worse than an unasked one: the app
     * looks armed and delivers nothing, which is exactly how a missed meeting
     * gets blamed on the app rather than on the browser setting causing it.
     * This banner is the only surface in the app that says so out loud.
     */
    paintAlert: function () {
      var box = $('#notifyAlert');
      if (!box) return;

      var state = this.alertState();
      if (state === 'ok') { box.hidden = true; return; }

      var text = $('#notifyAlertText'), cta = $('#notifyAlertCta'), ico = $('#notifyAlertIco');
      box.hidden = false;
      box.classList.toggle('is-blocked', state === 'denied' || state === 'unsupported');

      if (state === 'denied') {
        if (ico) ico.textContent = '🔕';
        if (text) {
          text.textContent = 'ההתראות חסומות בדפדפן — תזכורות לא יגיעו אליך כלל, ' +
            'גם לא כשהאפליקציה פתוחה.';
        }
        if (cta) { cta.hidden = false; cta.textContent = 'איך לבטל את החסימה?'; }
      } else if (state === 'unsupported') {
        if (ico) ico.textContent = '🔕';
        if (text) {
          text.textContent = 'הדפדפן הזה לא תומך בהתראות. באייפון צריך להוסיף את ' +
            'האפליקציה למסך הבית ולפתוח אותה משם.';
        }
        if (cta) cta.hidden = true;
      } else {
        if (ico) ico.textContent = '🔔';
        if (text) {
          text.textContent = state === 'off'
            ? 'ההתראות כבויות — תזכורות לפגישות ולמשימות לא יגיעו אליך.'
            : 'התראות עוד לא הופעלו — בלעדיהן שום תזכורת לא תגיע לטלפון.';
        }
        if (cta) { cta.hidden = false; cta.textContent = 'הפעל התראות'; }
      }
    },

    /** the banner's CTA — the same gesture as the pill, plus the blocked recipe */
    onAlertTap: function () {
      if (this.alertState() === 'denied') {
        toast('לביטול החסימה: תפריט הדפדפן ← הגדרות אתר ← התראות ← אפשר');
        return;
      }
      this.onToggle();
    },

    onToggle: function () {
      var self = this;

      if (!this.supported()) { toast('הדפדפן הזה לא תומך בהתראות'); return; }

      // the only reliable moment to start an AudioContext is inside a gesture
      Chime.unlock();

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
        if (Store.data.prefs.notify.on) { self.tick(); self.linkServer(); }
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
          'ברירת המחדל היא ' + Store.data.prefs.notify.lead +
          ' דקות לפני כל פגישה ומשימה מתוזמנת — ולכל פריט אפשר לבחור תזכורת משלו.');
        toast('התראות פוש הופעלו');
        this.tick();
        this.linkServer();
      } else {
        Store.data.prefs.notify.on = false;
        Store.save();
        this.paint();
        toast(result === 'denied' ? 'ההתראות נחסמו בדפדפן' : 'לא אושרה הרשאת התראות');
      }
    },

    /**
     * One notification, service-worker first so it shows with the tab hidden.
     *
     * Sprint 13 — `alert` is the RECORD's own pair (mandate §3). The vibration
     * pattern rides on the notification itself so it still fires when the OS
     * raises it, and the sound is played by the app, because a platform-level
     * profile can silence the notification's tone and the whole point of the
     * chime is that it is not subject to that.
     */
    show: function (tag, title, body, alert) {
      var a = alertOf(alert || {});
      var opts = {
        body: body,
        icon: NOTIFY_ICON,
        badge: NOTIFY_BADGE,
        dir: 'rtl',
        lang: 'he',
        tag: tag,
        // the OS may silence its own tone; the chime below is ours and is not
        // subject to that, which is the whole reason it exists
        silent: false,
        vibrate: VIBE_PATTERN[a.vibe] || [],
        data: { url: './index.html' }
      };

      function fallback() {
        try { new window.Notification(title, opts); } catch (e) { /* mobile blocks this ctor */ }
      }

      // guarded to a no-op wherever audio is not available, and to silence
      // where the record itself asked for [ללא]
      Chime.playAlert(a.sound);
      // ...and the pulse, in case the notification is raised by a path that
      // drops the vibrate hint (the desktop fallback constructor does)
      Haptics.pattern(a.vibe);

      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then(function (reg) { return reg.showNotification(title, opts); })
          ['catch'](fallback);
      } else {
        fallback();
      }
    },

    /** 🔊 / 🔈 — the chime is a separate vote from the notifications themselves */
    paintSound: function () {
      var btn = $('#soundBtn'), ico = $('#soundIco'), label = $('#soundLabel');
      if (!btn) return;
      if (!Chime.supported()) { btn.hidden = true; return; }
      btn.hidden = false;

      var on = !!Store.data.prefs.notify.sound;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (ico) ico.textContent = on ? '🔊' : '🔈';
      if (label) label.textContent = on ? 'צליל תזכורת פעיל' : 'צליל תזכורת כבוי';
    },

    onSoundToggle: function () {
      if (!Chime.supported()) { toast('הדפדפן הזה לא תומך בצליל התראה'); return; }
      var on = !Store.data.prefs.notify.sound;
      Store.data.prefs.notify.sound = on;
      Store.save();
      // this tap IS the gesture the autoplay policy wants; unlocking here is
      // what lets a reminder hours from now make a sound at all
      if (on) { Chime.unlock(); Chime.play(); }
      this.paintSound();
      toast(on ? 'צליל התזכורת הופעל' : 'צליל התזכורת כובה');
    },

    /**
     * Everything whose own lead window is open right now (Sprint 10).
     *
     * The window is per record, not global: `remind` decides it, and the
     * system default is only what a record with no opinion falls back to. That
     * is also why the scan reaches into TOMORROW — "יום לפני" is a 1440-minute
     * lead, and a reminder a day early is by definition raised on the day
     * before the one it is about.
     */
    due: function () {
      var t = todayISO();
      var horizon = addDaysISO(t, 1);
      var now = new Date();
      var mins = now.getHours() * 60 + now.getMinutes();
      var lead = Store.data.prefs.notify.lead;
      var out = [];

      function when(gap) {
        // a reminder inside the grace window is late, and says so rather than
        // claiming a start time that has already passed
        if (gap < 0) return 'התחיל לפני ' + (-gap) + ' דק׳';
        if (gap === 0) return 'מתחיל עכשיו';
        if (gap < 60) return 'בעוד ' + gap + ' דק׳';
        if (gap < 1440) return 'בעוד ' + Math.round(gap / 60) + ' שע׳';
        return 'מחר';
      }

      /** minutes from now until a record on `date` at `time` starts, or null */
      function gapTo(date, time) {
        if (!time) return null;
        var day = date === t ? 0 : (date === horizon ? 1 : -1);
        if (day === -1) return null;
        return day * 1440 + timeToMinutes(time) - mins;
      }

      /**
       * Sprint 12 — one record, several reminders, one entry each.
       *
       * A built-in keeps the Sprint-10/11 window exactly: open from `lead`
       * minutes before the start until MISS_GRACE_MIN minutes after it. A
       * custom stamp is an absolute moment and has no lead at all, so its
       * window is only the grace tail — it fires at the minute it names.
       *
       * Every entry carries its OWN ledger key, so "יום לפני" and "בזמן
       * האירוע" on the same meeting are two deliveries, not one that swallows
       * the other. The key ends in the date the sweep reads, and for a custom
       * reminder that date is the reminder's own — a reminder set for next
       * Tuesday must not be swept tonight.
       */
      function collect(rec, kind, clockDate, clockTime, body) {
        remindPlan(rec, lead).forEach(function (plan) {
          if (plan.at) {
            var day = plan.at.slice(0, 10);
            var gapAbs = gapTo(day, plan.at.slice(11, 16));
            if (gapAbs === null || gapAbs > 0 || gapAbs < -MISS_GRACE_MIN) return;
            out.push({
              id: rec.id, on: day, tok: plan.tok,
              key: remindMark(plan.tok, rec.id, day),
              // Sprint 13 — the record's own sound & vibration ride with it
              alert: alertOf(rec),
              title: 'תזכורת · ' + kind, body: body
            });
            return;
          }
          var gap = gapTo(clockDate, clockTime);
          // early is a miss, late-but-inside-the-grace-window is a delivery
          if (gap === null || gap > plan.minutes || gap < -MISS_GRACE_MIN) return;
          out.push({
            id: rec.id, on: clockDate, tok: plan.tok,
            key: remindMark(plan.tok, rec.id, clockDate),
            alert: alertOf(rec),
            title: kind + ' ' + when(gap), body: body
          });
        });
      }

      Store.data.events.forEach(function (e) {
        collect(e, 'פגישה', e.date, e.start,
          e.title + ' · ' + e.start + (e.location ? ' · ' + e.location : ''));
      });

      Store.data.tasks.forEach(function (x) {
        // הושלם and בוטל are both closed — neither deserves a reminder
        if (isClosed(x.status)) return;
        collect(x, 'משימה', x.due, x.time, x.title + ' · ' + x.time);
      });

      return out;
    },

    tick: function () {
      if (!this.armed()) return;

      var t = todayISO();
      var fired = Store.data.prefs.fired;
      var dirty = false;

      /* The mark is keyed by the record's OWN date, not by today. With a
         day-before lead the same reminder is legitimately raised on the day
         before the event, and keying by today would let it fire a second time
         the next morning. Marks strictly in the past are dead weight; a mark
         for tomorrow is the one still doing its job. */
      Object.keys(fired).forEach(function (k) {
        if (k.slice(-10) < t) { delete fired[k]; dirty = true; }
      });

      var self = this;
      this.due().forEach(function (item) {
        /* Sprint 12 — the mark is per REMINDER, not per record. "יום לפני" and
           "בזמן האירוע" on the same meeting are two separate deliveries, and a
           single record-wide key would let whichever fired first swallow every
           other reminder that record carries. */
        var key = item.key || remindMark(item.tok || REMIND_DEFAULT, item.id, item.on || t);
        if (fired[key]) return;
        fired[key] = 1;
        dirty = true;
        self.show(key, item.title, item.body, item.alert);
      });

      if (dirty) Store.save();
    },

    /** base64url VAPID key → the Uint8Array pushManager.subscribe() demands */
    keyBytes: function (publicKey) {
      var pad = '='.repeat((4 - publicKey.length % 4) % 4);
      var raw = window.atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes;
    },

    /**
     * Web-push subscription. Given a VAPID public key, returns the browser's
     * PushSubscription — the existing one when there is one, so a reload does
     * not churn a new endpoint on every launch.
     */
    subscribe: function (publicKey) {
      if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        return Promise.resolve(null);
      }
      var bytes = this.keyBytes(publicKey);

      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return reg.pushManager.subscribe({
            userVisibleOnly: true, applicationServerKey: bytes
          });
        });
      });
    },

    /**
     * Sprint 11 — hand the subscription to the Worker, which is the only thing
     * in this system that can raise a reminder while the app is closed.
     *
     * Everything below `tick()` runs in a page. A page that is not open runs
     * nothing: mobile Chrome freezes a backgrounded tab's timers within
     * minutes, iOS suspends the whole process, and a closed PWA has no timers
     * at all. Before this the entire reminder engine was that page timer, and
     * `subscribe()` was a hook with no caller — which is why a task scheduled
     * for a moment when the app happened to be closed produced nothing.
     *
     * The registration is best-effort by design: no key configured, no network,
     * no PushManager — each one resolves to null and leaves the local scan
     * exactly as capable as it was, which is the same contract /api/sync and
     * /api/gcal/* already keep.
     */
    linkServer: function () {
      var self = this;
      if (!this.armed()) return Promise.resolve(null);
      if (!window.fetch || !navigator.serviceWorker || !('PushManager' in window)) {
        return Promise.resolve(null);
      }
      var proto = (window.location && window.location.protocol) || '';
      if (proto !== 'http:' && proto !== 'https:') return Promise.resolve(null);
      if (this.linking) return this.linking;

      this.linking = window.fetch(PUSH_ENDPOINT + '/subscribe', { method: 'GET' })
        .then(function (res) { return res.json(); })
        .then(function (body) {
          var data = body && body.ok && body.data;
          if (!data || !data.configured || !data.publicKey) return null;   // no VAPID yet
          return self.subscribe(data.publicKey);
        })
        .then(function (sub) {
          if (!sub) return null;
          var json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
          return window.fetch(PUSH_ENDPOINT + '/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: json.endpoint,
              keys: json.keys,
              ua: (navigator.userAgent || '').slice(0, 300)
            })
          }).then(function (res) { return res.json(); }).then(function (out) {
            if (!out || !out.ok) return null;
            Store.data.prefs.notify.serverAt = toISOStamp(Date.now());
            Store.save();
            self.paint();
            return json.endpoint;
          });
        })
        ['catch'](function () { return null; })
        .then(function (result) { self.linking = null; return result; });

      return this.linking;
    },

    init: function () {
      this.paint();
      var self = this;

      var btn = $('#pushBtn');
      if (btn) btn.addEventListener('click', function () { self.onToggle(); });

      var sound = $('#soundBtn');
      if (sound) sound.addEventListener('click', function () { self.onSoundToggle(); });

      var cta = $('#notifyAlertCta');
      if (cta) cta.addEventListener('click', function () { self.onAlertTap(); });

      /* The autoplay policy only starts an AudioContext inside a gesture, and
         the two toggles above are not the only session that has one. This puts
         the unlock on the first touch anywhere on the page. */
      Chime.armOnFirstGesture(document);

      /* A server-sent push is rendered by sw.js, which has no audio at all.
         When a window IS open the worker asks it to make the sound, so a real
         Web Push carries the same chime a locally-scheduled reminder does. */
      if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', function (event) {
          if (event && event.data && event.data.type === 'PUSH_CHIME') Chime.play();
        });
      }

      clearInterval(this.timer);
      // dayGuard() rides along: the scan is already the one thing in the app
      // that runs on a clock, and a day that rolled over under a resumed PWA
      // has to repaint before the next reminder is judged against it
      this.timer = setInterval(function () { dayGuard(); self.tick(); }, SCAN_MS);

      // a phone that wakes from sleep skipped every interval in between
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        dayGuard();
        self.paint();
        self.tick();
        // iOS suspends the AudioContext with the app; a resume costs nothing
        // when it is already running and is the difference between a chime and
        // silence when it is not
        if (Chime.armed()) Chime.unlock();
      });

      this.tick();
      // the subscription is what lets a reminder arrive with the app closed
      this.linkServer();
    }
  };

  /* ------------------------------------------------------------- delegation */

  /**
   * Universal tap-to-edit (Sprint 8). Given the element a tap landed on,
   * returns the record key whose form should open, or '' for "not an edit".
   *
   * A tap qualifies only when it landed inside a card, that card is one of the
   * four types the mandate names, and no form is already layered over the app —
   * a tap inside an open form must never open a second one behind it. The
   * client drawer is deliberately NOT a blocker: the cards inside a client file
   * are real cards and editing them from there is the whole point. A client
   * card itself is excluded — tapping one opens the full client file instead.
   */
  function tapEditKey(target) {
    if (!target || !target.closest) return '';
    if (Select.on || Confirm.isOpen()) return '';
    if (!$('#typeSheet').hidden || !$('#formSheet').hidden || !$('#trashSheet').hidden) return '';
    // Sprint 12 — the reader is a card surface of its own; a tap inside it must
    // not resolve to the card underneath and open a second layer
    if (Detail.isOpen()) return '';

    var card = target.closest('[data-rec]');
    var key = card && card.dataset ? card.dataset.rec : '';
    if (!key) return '';
    // a card mid-collapse is on its way out; it is not editable
    if (card.classList && card.classList.contains('is-leaving')) return '';
    return TAP_EDIT.indexOf(String(key).split(':')[0]) === -1 ? '' : key;
  }

  /**
   * Where a tap on a card body goes (Sprint 12 · mandate §4).
   *
   * A task or an event opens the READER: the record laid out to be read, with
   * עריכה one tap further in. A list or a note has no reading surface of its
   * own — its whole content is the checklist or the body the card already
   * shows — so those still open their form directly, exactly as before.
   */
  function openTapped(collection, id) {
    if (TAP_DETAIL.indexOf(collection) !== -1) return Detail.open(collection, id);
    return openEdit(collection, id);
  }

  /**
   * The archive button (Sprint 9). Every completed task on screen collapses
   * together, then the whole batch moves into היסטוריה and arms one אחזר — the
   * same choreography a batch deletion gets, because it is the same size of
   * move. Nothing is asked first: the log holds everything for ten days and
   * offers שחזר on every row, so this is not a destructive tap.
   */
  function runArchiveDone() {
    var rows = doneUnfiled();
    if (!rows.length) { toast('אין משימות שבוצעו להעברה'); return false; }

    var keys = rows.map(function (t) { return 'tasks:' + t.id; });
    Haptics.done();

    leaveThen(keys, function () {
      var filed = archiveDone();
      render();
      if (!filed) { toast('לא הועברה אף משימה'); return; }
      toast(filed.count === 1
        ? 'משימה אחת הועברה להיסטוריה'
        : filed.count + ' משימות הועברו להיסטוריה',
      UNDO_LABEL, UNDO_BATCH_MS);
    });
    return true;
  }

  /** [שחזר] / [מחק לצמיתות] inside היסטוריה */
  function runArchiveAction(action, id) {
    var entry = archiveFind(id);
    if (!entry) { renderArchive(); toast('המשימה כבר לא בהיסטוריה'); return false; }

    if (action === 'restore') {
      var back = archiveRestore(id);
      if (!back) { renderArchive(); return false; }
      Haptics.done();
      // the task re-enters the lists it left — the membership moved
      render();
      toast('המשימה חזרה לרשימה');
      return true;
    }

    if (action !== 'purge') return false;

    // the one deletion in the log with no net behind it — it asks like every
    // other destructive tap, and this time the answer really is final
    return !!confirmDelete(
      'משימה · ' + (recTitle('tasks', entry.rec) || 'ללא כותרת') + ' — לצמיתות, ללא שחזור',
      function () {
        if (!archivePurge(id)) return;
        renderArchive();
        toast('המשימה נמחקה לצמיתות');
      });
  }

  /**
   * [🗑 ריקון סל המחזור] — the only tap in the app that destroys a whole
   * surface. It goes through the same confirmation door as a single row, with
   * the bin named inside the question, and it counts what it is about to take
   * so the answer is never given blind.
   */
  function askEmptyTrash() {
    var n = trashCount();
    if (!n) { renderTrash(); toast('סל המחזור ריק'); return false; }

    return !!confirmDelete(
      plural(n, 'פריט אחד', 'פריטים') + ' — לצמיתות, ללא שחזור',
      function () {
        var gone = emptyTrash();
        // nothing is left to be picked, so the selection layer leaves with it
        TrashSel.setMode(false);
        if (!gone) { toast('לא נמחק דבר'); return; }
        toast(plural(gone, 'פריט אחד נמחק לצמיתות', 'פריטים נמחקו לצמיתות'));
      },
      { title: CONFIRM_EMPTY_TRASH, yes: 'אישור' }
    );
  }

  /** [שחזר] / [מחק לצמיתות] / [ריקון הסל] inside the bin */
  function runTrashAction(action, id) {
    // the one bin action that is about the bin itself, not about a row in it
    if (action === 'empty') return askEmptyTrash();

    var entry = trashFind(id);
    if (!entry) { renderTrash(); toast('הפריט כבר לא בסל המחזור'); return false; }

    if (action === 'restore') {
      var back = trashRestore(id);
      if (!back) { renderTrash(); return false; }
      Haptics.done();
      // the restored record re-enters a list it left — the membership moved
      render();
      toast((TRASH_LABEL[back.collection] || 'הפריט') + ' שוחזר');
      return true;
    }

    if (action !== 'purge') return false;

    // the one deletion in the app with no net behind it — it asks like every
    // other destructive tap, and this time the answer really is final
    return !!confirmDelete(
      (TRASH_LABEL[entry.collection] || 'הפריט') + ' · ' +
      (recTitle(entry.collection, entry.rec) || 'ללא כותרת') + ' — לצמיתות, ללא שחזור',
      function () {
        if (!trashPurge(id)) return;
        renderTrash();
        toast('הפריט נמחק לצמיתות');
      });
  }

  function onClick(e) {
    // selection mode owns every tap that lands on a card (Wave 3), so it is
    // asked before any control branch below can act on that card
    if (Select.tap(e.target)) return;
    // ...and the bin owns every tap that lands on one of its rows while its
    // own selection is live. The two can never both be on: Select declines
    // `.sheet`, and this one answers to nothing outside #trashList.
    if (TrashSel.tap(e.target)) return;

    var el = e.target.closest ? e.target.closest(
      '[data-nav],[data-action],[data-type],[data-filter],[data-cat],[data-toggle],[data-del],' +
      '[data-calview],[data-calnav],[data-calslot],' +
      '[data-tasktab],[data-work],[data-upcoming],' +
      // Sprint 12 — the reminder panel, the "פתוחות" sheet and the detail reader
      '[data-remindmode],[data-remindadd],[data-reminddrop],' +
      '[data-openall],[data-openfilter],[data-detailact],' +
      // Sprint 13 — the settings drawer and the per-record alert picker
      '[data-settoggle],[data-setplay],[data-setdefault],[data-settheme],[data-setsync],' +
      '[data-alertsound],[data-alertvibe],' +
      // Sprint 15 — the pantry catalog; Sprint 16 — the module around it
      '[data-pantrycat],[data-pantryitem],' +
      '[data-shoptab],[data-shopcheck],[data-shopdel],[data-shopclear],[data-shopadd],' +
      // Sprint 17 — the ± pair on a row, and עריכת המאגר inside the catalog
      '[data-shopstep],[data-shopmanage],[data-shopcatadd],[data-shopcatreset],' +
      '[data-pnedit],[data-pnsave],[data-pndel],[data-pncancel],' +
      '[data-cycle],[data-subtask],[data-listitem],[data-pin],[data-convert],' +
      '[data-clientfilter],[data-clientopen],[data-clienttab],[data-contact],[data-clientadd],' +
      '[data-nextaction],[data-clientnote],[data-clientnotedel],[data-undo],' +
      '[data-edit],[data-batch],[data-trashbatch],[data-confirmdel],[data-trash],[data-arch]') : null;

    // Sprint 8 · universal tap-to-edit — a tap that hit no control at all, but
    // landed on a card, opens that card's own form pre-filled. The check circle,
    // the ✕, the ✎ and every chip inside the row are controls and were matched
    // above, so this can only ever be the card BODY.
    if (!el) {
      var open = tapEditKey(e.target);
      if (open) {
        Haptics.light();
        if (!openTapped(open.split(':')[0], open.split(':')[1])) toast('הפריט לא נמצא');
      }
      return;
    }

    // one light pulse for every control in the app — button taps, tab switches
    // and status toggles all come through this one delegate. The check circle
    // is the exception: it fires its own dual pulse, and a light beat 10ms
    // earlier would truncate the first beat of it.
    if (!el.dataset.toggle) Haptics.light();

    if (el.dataset.undo) {
      var back = Undo.fire();
      hideToast();
      if (back) {
        render();
        // a batch carries a count, and Hebrew declines the verb with it
        toast(back.label + (back.count > 1 ? ' שוחזרו' : ' שוחזר'));
      }
      return;
    }

    /* ---------- confirmation · editing · batch actions ---------- */

    if (el.dataset.confirmdel) { acceptConfirm(); return; }

    if (el.dataset.edit) {
      var ep = el.dataset.edit.split(':');
      if (!openEdit(ep[0], ep[1])) toast('הפריט לא נמצא');
      return;
    }

    if (el.dataset.batch) { Select.run(el.dataset.batch); return; }
    if (el.dataset.trashbatch) { TrashSel.run(el.dataset.trashbatch); return; }

    if (el.dataset.action === 'select-mode') { Select.toggleMode(); return; }
    if (el.dataset.action === 'close-confirm') { closeConfirm(); return; }
    if (el.dataset.action === 'trash') { openTrash(); return; }

    /* ---------- היסטוריה (Sprint 9) ---------- */

    if (el.dataset.action === 'archive-done') { runArchiveDone(); return; }

    if (el.dataset.arch) {
      var arp = el.dataset.arch.split(':');
      runArchiveAction(arp[0], arp[1]);
      return;
    }

    if (el.dataset.action === 'master-add') { openTypeSheet(); return; }
    // Sprint 16 — the module's front door, from anywhere that cares to carry it
    if (el.dataset.action === 'shopping') { Shop.open(); return; }
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

    // a deep-link from an attention card names a tab but not a workspace, and
    // the tab strip only exists inside משימות — so arriving there is part of
    // the same move
    if (el.dataset.tasktab) {
      if (workspace() !== 'tasks') {
        Store.data.prefs.workspace = 'tasks';
        Store.save();
      }
      setTaskTab(el.dataset.tasktab);
      return;
    }

    if (el.dataset.work) { setWorkspace(el.dataset.work); return; }
    if (el.dataset.upcoming) { toggleUpcoming(); return; }

    /* ---------- Sprint 12 · reminders panel, "פתוחות" sheet, detail reader ---- */

    if (el.dataset.remindmode) { FormRemind.setMode(el.dataset.remindmode); return; }
    if (el.dataset.remindadd) { FormRemind.addCustom(); return; }
    if (el.dataset.reminddrop) { FormRemind.dropCustom(parseInt(el.dataset.reminddrop, 10)); return; }

    if (el.dataset.openall) { openOpenSheet(); return; }
    if (el.dataset.openfilter) { setOpenFilter(el.dataset.openfilter); return; }
    if (el.dataset.detailact) { Detail.act(el.dataset.detailact); return; }

    /* ---------- Sprint 13 · the settings drawer and the alert picker ------- */

    if (el.dataset.action === 'settings') { Settings.toggle(); return; }
    if (el.dataset.action === 'close-settings') { closeSheets(); return; }
    if (el.dataset.action === 'archive-log') { openArchiveLog(); return; }

    if (el.dataset.settoggle === 'haptics') { Settings.toggleHaptics(); return; }
    if (el.dataset.setplay) { Settings.preview(el.dataset.setplay); return; }
    if (el.dataset.setdefault) { Settings.reset(el.dataset.setdefault); return; }
    if (el.dataset.settheme) { Settings.setTheme(el.dataset.settheme); return; }
    if (el.dataset.setsync) { Sync.flush(); toast('מסנכרן מול הענן…'); return; }

    if (el.dataset.alertsound) { FormAlert.set('sound', el.dataset.alertsound); return; }
    if (el.dataset.alertvibe) { FormAlert.set('vibe', el.dataset.alertvibe); return; }

    /* ---------- רשימת קניות (Sprint 15 catalog · Sprint 16 module) ---------- */

    if (el.dataset.pantrycat) { Shop.setCat(el.dataset.pantrycat); return; }
    if (el.dataset.pantryitem) { Shop.toggle(el.dataset.pantryitem); return; }
    if (el.dataset.shoptab) { Shop.setTab(el.dataset.shoptab); return; }
    if (el.dataset.shopcheck) { Shop.check(el.dataset.shopcheck); return; }
    if (el.dataset.shopdel) { Shop.drop(el.dataset.shopdel); return; }
    if (el.dataset.shopclear) { Shop.clear(el.dataset.shopclear); return; }
    if (el.dataset.shopadd) { Shop.add(); return; }

    /* ---------- Sprint 17 · the ± pair and עריכת המאגר ---------- */

    if (el.dataset.shopstep) {
      var st = el.dataset.shopstep.split(':');
      Shop.step(st.slice(1).join(':'), st[0] === '-' ? -1 : 1);
      return;
    }
    if (el.dataset.shopmanage) { Shop.setManage(!Shop.manage); return; }
    if (el.dataset.shopcatadd) { Shop.catalogAdd(); return; }
    if (el.dataset.shopcatreset) { Shop.catalogReset(); return; }
    if (el.dataset.pnedit) { Shop.catalogEdit(el.dataset.pnedit); return; }
    // the rename bar is static, so the ref it saves lives in Shop.editing
    if (el.dataset.pnsave) { Shop.catalogSave(Shop.editing); return; }
    if (el.dataset.pndel) { Shop.catalogRemove(el.dataset.pndel); return; }
    if (el.dataset.pncancel) { Shop.catalogCancel(); return; }

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

    if (el.dataset.clientnotedel) { askDeleteClientNote(el.dataset.clientnotedel); return; }

    if (el.dataset.nav) { setView(el.dataset.nav); return; }

    if (el.dataset.toggle) {
      var t = Store.find('tasks', el.dataset.toggle);
      if (t) {
        // Sprint 8 — the ✓ draws, the title strikes through and the dual pulse
        // fires FIRST. Sprint 9 — and then the task STAYS, right where it is:
        // the commit writes the state and patches that one row in place, and
        // every list it belongs to still counts it as a member, so no container
        // is rebuilt and nothing moves under the finger. The archive button is
        // what files it, when the user decides.
        Complete.run(t, function () {
          toggleTaskDone(t);
          Store.save();
          Patch.apply('tasks', t.id);
          toast(t.done
            ? 'בוצע ✓ — נשאר כאן עד להעברה להיסטוריה'
            : 'המשימה חזרה ל' + STATUS_LABEL[t.status]);
        });
      }
      return;
    }

    /* ---------- סל מחזור (Sprint 8) ---------- */

    if (el.dataset.trash) {
      var tp = el.dataset.trash.split(':');
      runTrashAction(tp[0], tp[1]);
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

    // every destructive tap asks first (Wave 2) and stays undoable afterwards
    if (el.dataset.del) { askDelete(el.dataset.del); return; }
  }

  /** the only <select> that mutates the store outside a form submit */
  function onChange(e) {
    var el = e.target;
    if (!el || !el.dataset) return;

    /* Sprint 12 — the reminder panel answers to `change`, not to the click
       delegate: a <label> wrapping a checkbox already toggles it, so a click
       handler on the same element would toggle it straight back. */
    if (el.dataset.remindopt) {
      FormRemind.toggle(el.dataset.remindopt, !!el.checked);
      return;
    }
    if (el.dataset.remindwhen) {
      FormRemind.setCustom(parseInt(el.dataset.remindwhen, 10), el.value);
      return;
    }

    /* Sprint 13 — the settings drawer's three <select> pickers. Same reason as
       above: a <select> answers `change`, and the click delegate never sees the
       value the user landed on. */
    if (el.dataset.setpick) {
      Haptics.light();
      Settings.pick(el.dataset.setpick, el.value);
      return;
    }

    if (!el.dataset.clientstatus) return;
    var c = Store.find('clients', el.dataset.clientstatus);
    if (!c) return;
    Haptics.light();
    setClientStatus(c, el.value);
    Store.save();
    Patch.apply('clients', c.id);
    toast('סטטוס: ' + CLIENT_STATUS_LABEL[normClientStatus(c.status)]);
  }

  /**
   * The two keystrokes the app listens to, both of them the shopping module's:
   * the catalog search box and the per-row amount. Neither carries a `name`, so
   * submitForm()'s sweep of #formFields can never see either of them.
   */
  function onInput(e) {
    var el = e.target;
    if (!el || !el.dataset) return;
    if (el.dataset.shopsearch) { Shop.setQuery(el.value); return; }
    if (el.dataset.shopqty) { Shop.qty(el.dataset.shopqty, el.value); return; }
  }

  /**
   * The keyboard, in one place. Escape has closed every layer in the app since
   * Wave 1; Sprint 16 adds ↵ inside "הוספת מוצר משלי", because a shopping list
   * is typed in bursts and reaching for a button between every two products is
   * what makes people stop using the field at all.
   */
  function onKeydown(e) {
    var el = e.target;
    var d = el && el.dataset ? el.dataset : null;

    if (e.key === 'Escape') {
      // Sprint 17 — a rename in flight is its own layer: Escape puts the row
      // back rather than closing the whole module around a half-typed name
      if (d && d.shoprename && Shop.editing) { e.preventDefault(); Shop.catalogCancel(); return; }
      closeSheets();
      return;
    }
    if (!d || e.key !== 'Enter') return;

    if (d.shopnew) { e.preventDefault(); Shop.add(); return; }
    // ...and the same burst-typing argument applies to filling a shelf
    if (d.shopnewproduct) { e.preventDefault(); Shop.catalogAdd(); return; }
    if (d.shoprename) { e.preventDefault(); Shop.catalogSave(Shop.editing); }
  }

  /* ==========================================================================
     הגדרות — the settings drawer (Sprint 13 · mandate §1–§2)

     WHY A DRAWER AND NOT MORE PILLS

     The top bar had grown to four pills, a Google readout line and a 🗑 in the
     filter strip: six controls competing with the one question "היום שלי"
     exists to answer. Every one of them was reachable and none of them was
     findable. They are all still here — the SAME elements, the same ids, the
     same handlers, moved rather than rebuilt — grouped under the five headings
     the mandate names, behind one ☰.

     Nothing in this module owns state that lives elsewhere: #pushBtn is still
     painted by Notify.paintSound()/paint(), #gcalBtn by GCal.paint(), #trashBtn
     by renderTrash(). Settings.paint() only paints what is genuinely its own —
     the two sound pickers, the vibration picker, the touch-feedback switch, the
     theme choice and the two read-only lines under אודות.
     ========================================================================== */

  var Settings = {
    isOpen: function () {
      var el = $('#settingsDrawer');
      return !!el && !el.hidden;
    },

    open: function () {
      var el = $('#settingsDrawer');
      if (!el) return false;
      var backdrop = $('#backdrop');
      if (backdrop) backdrop.hidden = false;
      el.hidden = false;
      if (document.body && document.body.style) document.body.style.overflow = 'hidden';
      var btn = $('#menuBtn');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      // the drawer is the one surface that shows the cloud, Google and bin
      // state together, so it is repainted on the way in rather than on a timer
      Settings.paint();
      Notify.paint();
      Sync.paint();
      GCal.paint();
      renderTrash();                 // paints the bin's badge, not the bin itself
      return true;
    },

    /**
     * Hide the panel and nothing else. The backdrop and the body scroll lock
     * belong to closeSheets(), which owns them for every layer in the app — a
     * second owner here is how a sheet ends up open behind a live scrim.
     */
    close: function () {
      var el = $('#settingsDrawer');
      if (!el || el.hidden) return false;
      el.hidden = true;
      var btn = $('#menuBtn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      // a ten-second ringtone must not outlive the panel it was auditioned in
      Chime.stop();
      return true;
    },

    toggle: function () {
      if (Settings.isOpen()) { closeSheets(); return false; }
      return Settings.open();
    },

    /* ---- the two sound pickers and the vibration picker ---- */

    /** <option> list for one picker, marking the value the store currently holds */
    options: function (map, current) {
      return Object.keys(map).map(function (k) {
        var label = map[k].label !== undefined ? map[k].label : map[k];
        return '<option value="' + esc(k) + '"' + (k === current ? ' selected' : '') + '>' +
          esc(label) + '</option>';
      }).join('');
    },

    pick: function (which, value) {
      var prefs = Store.data.prefs;
      if (which === 'shortSound') prefs.sound.short = normShortSound(value);
      else if (which === 'longSound') prefs.sound.long = normLongSound(value);
      else if (which === 'vibe') prefs.vibe = normVibe(value);
      else return false;
      Store.save();
      Settings.paint();
      // hearing (or feeling) the choice is the point of making it — and this
      // tap is the gesture the autoplay policy wants
      Settings.preview(which === 'vibe' ? 'vibe' : (which === 'longSound' ? 'long' : 'short'));
      return true;
    },

    reset: function (which) {
      var prefs = Store.data.prefs;
      if (which === 'shortSound') prefs.sound.short = SHORT_DEFAULT;
      else if (which === 'longSound') prefs.sound.long = LONG_DEFAULT;
      else if (which === 'vibe') prefs.vibe = VIBE_DEFAULT;
      else return false;
      Store.save();
      Settings.paint();
      toast('הוחזר לברירת המחדל');
      return true;
    },

    /** ▶ / ■ — auditioning is never gated on the record, only on the chime toggle */
    preview: function (what) {
      var prefs = Store.data.prefs;
      if (what === 'stop') { Chime.stop(); return true; }
      if (what === 'vibe') {
        if (!Haptics.supported()) { toast('המכשיר הזה לא תומך ברטט'); return false; }
        return Haptics.pattern(prefs.vibe);
      }
      Chime.unlock();
      if (!Chime.armed()) { toast('צליל התזכורת כבוי — אפשר להפעיל אותו כאן למעלה'); return false; }
      Chime.stop();
      return what === 'long' ? Chime.playLong(prefs.sound.long) : Chime.playShort(prefs.sound.short);
    },

    /* ---- רטט במגע ---- */

    toggleHaptics: function () {
      if (!Haptics.supported()) { toast('המכשיר הזה לא תומך ברטט'); return false; }
      var on = !Haptics.touchOn();
      Store.data.prefs.haptics = on;
      Store.save();
      if (on) Haptics.fire(HAPTIC_CHECK);        // the switch answers itself
      Settings.paint();
      toast(on ? 'רטט במגע הופעל' : 'רטט במגע כובה');
      return true;
    },

    /* ---- מראה ועיצוב ---- */

    /** what the OS is asking for, when the choice is "לפי המערכת" */
    systemTheme: function () {
      try {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
          ? 'light' : 'dark';
      } catch (e) { return 'dark'; }
    },

    /** the palette actually in force — 'system' is a question, never an answer */
    resolvedTheme: function () {
      var t = (Store.data && Store.data.prefs) ? Store.data.prefs.theme : THEME_DEFAULT;
      if (THEMES.indexOf(t) === -1) t = THEME_DEFAULT;
      return t === 'system' ? Settings.systemTheme() : t;
    },

    /** does the OS ask for less movement? Stated rather than silently obeyed */
    reducedMotion: function () {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { return false; }
    },

    applyTheme: function () {
      var root = document.documentElement;
      if (root && root.setAttribute) root.setAttribute('data-theme', Settings.resolvedTheme());
      return true;
    },

    setTheme: function (theme) {
      if (THEMES.indexOf(theme) === -1) return false;
      Store.data.prefs.theme = theme;
      Store.save();
      Settings.applyTheme();
      Settings.paint();
      toast('ערכת הנושא: ' + THEME_LABEL[theme]);
      return true;
    },

    /* ---- אודות ---- */

    /**
     * The in-app half of `node healthcheck.js`: the suite proves the ARTEFACTS
     * are right before a deploy, and this proves the INSTALL is right on the
     * phone holding it — which is the half a repo-local script can never see.
     */
    health: function () {
      var parts = [];
      var storeOk = false;
      try {
        window.localStorage.setItem(STORE_KEY + '.probe', '1');
        window.localStorage.removeItem(STORE_KEY + '.probe');
        storeOk = true;
      } catch (e) { storeOk = false; }
      parts.push((storeOk ? '✓' : '✕') + ' אחסון מקומי');

      var swOk = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      parts.push((swOk ? '✓' : '…') + ' עבודה במצב לא־מקוון');
      parts.push((Notify.armed() ? '✓' : '✕') + ' התראות');
      parts.push((Chime.supported() ? '✓' : '✕') + ' צליל');
      parts.push((Haptics.supported() ? '✓' : '✕') + ' רטט');

      var d = Store.data;
      var n = d ? (d.events.length + d.tasks.length + d.lists.length +
        d.notes.length + d.clients.length) : 0;
      parts.push(n + ' פריטים בזיכרון');
      return parts.join(' · ');
    },

    /* ---- paint ---- */

    paint: function () {
      var box = $('#settingsDrawer');
      if (!box || !Store.data) return;
      var prefs = Store.data.prefs;

      var shortSel = $('#setShortSound');
      if (shortSel) {
        setHTML(shortSel, Settings.options(SHORT_SOUNDS, prefs.sound.short));
        shortSel.value = prefs.sound.short;
      }
      var longSel = $('#setLongSound');
      if (longSel) {
        setHTML(longSel, Settings.options(LONG_RINGS, prefs.sound.long));
        longSel.value = prefs.sound.long;
      }
      var vibeSel = $('#setVibe');
      if (vibeSel) {
        setHTML(vibeSel, Settings.options(VIBE_LABEL, prefs.vibe));
        vibeSel.value = prefs.vibe;
      }

      var hap = $('#hapticsBtn');
      if (hap) {
        var on = Haptics.touchOn() && Haptics.supported();
        hap.classList.toggle('is-on', on);
        hap.setAttribute('aria-pressed', on ? 'true' : 'false');
        setText($('#hapticsHint'), Haptics.supported()
          ? (on ? 'רטט קצר בכל לחיצה ובכל סימון V' : 'המסך לא ירטוט בלחיצות — תזכורות ירטטו כרגיל')
          : 'המכשיר הזה לא תומך ברטט (באייפון אין API כזה בדפדפן)');
      }

      // ☁ — the same three states the header badge carries, spelled out
      var st = Sync.state();
      var cfg = Sync.cfg();
      var q = cfg ? cfg.queue.length : 0;
      var line = SYNC_LABEL[st].ico + ' ' + SYNC_LABEL[st].text;
      if (q) line += ' · ' + q + ' שינויים ממתינים';
      else if (st === 'synced' && cfg && cfg.lastSyncAt) line += ' · ' + hhmm(cfg.lastSyncAt);
      setText($('#setSyncState'), line);

      $$('[data-settheme]', box).forEach(function (b) {
        var active = b.dataset.settheme === prefs.theme;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      setText($('#setThemeHint'), prefs.theme === 'system'
        ? 'לפי המערכת — כרגע ' + (Settings.resolvedTheme() === 'light' ? 'בהיר' : 'כהה')
        : 'ערכת הנושא נבחרה ידנית: ' + THEME_LABEL[prefs.theme]);
      setText($('#setMotionHint'), Settings.reducedMotion()
        ? 'המערכת מבקשת פחות תנועה — האנימציות באפליקציה מושבתות בהתאם.'
        : 'אנימציות פעילות. אפשר לכבות אותן בהגדרות הנגישות של המכשיר.');

      setText($('#setVersion'), 'מה הלו״ז — Benja · גרסה ' + APP_VERSION);
      setText($('#setHealth'), Settings.health());
    },

    init: function () {
      Settings.applyTheme();

      // the OS can flip while the app is open; 'system' means "follow it", so
      // it has to be followed rather than sampled once at boot
      try {
        var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
        if (mq && mq.addEventListener) {
          mq.addEventListener('change', function () {
            if (Store.data.prefs.theme === 'system') { Settings.applyTheme(); Settings.paint(); }
          });
        }
      } catch (e) { /* older engine — the choice still applies, it just cannot follow */ }

      Settings.paint();
    }
  };

  /* -------------------------------------------------------------- bootstrap */

  function init() {
    Store.load();
    Cal.init();
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    $('#entityForm').addEventListener('submit', submitForm);
    $('#backdrop').addEventListener('click', closeSheets);
    document.addEventListener('keydown', onKeydown);
    setFilter(Store.data.prefs.filter);
    setView('today');
    Fab.init();                       // the CTA ducks while the page scrolls
    Select.paint();                   // the batch bar starts closed, the pill off
    Select.bindLongPress();           // long press on a card opens selection mode
    TrashSel.paint();                 // the bin's own bar starts closed too
    TrashSel.bindLongPress();         // long press on a binned row picks it
    registerServiceWorker();
    Notify.init();
    Sync.init();
    GCal.init();
    Settings.init();                  // applies the stored theme and follows the OS
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
      shownClients: shownClients,

      // Waves 1–3 (post-Sprint-7 hardening): the scroll-aware CTA, the
      // membership source of truth for the timeline, the confirmation door,
      // universal editing and the multi-select batch layer. Every one of them
      // is executable head-lessly — no DOM, no scroll, no finger.
      FAB_TOP: FAB_TOP,
      FAB_DELTA: FAB_DELTA,
      CONFIRM_QUESTION: CONFIRM_QUESTION,
      CONFIRM_YES: CONFIRM_YES,
      CONFIRM_EMPTY_TRASH: CONFIRM_EMPTY_TRASH,
      SELECTABLE: SELECTABLE,
      UNDO_BATCH_MS: UNDO_BATCH_MS,
      LONG_PRESS_MS: LONG_PRESS_MS,
      Fab: Fab,
      Confirm: Confirm,
      Select: Select,
      toast: toast,
      softDeleteMany: softDeleteMany,
      timelineRows: timelineRows,
      timelineKeys: timelineKeys,
      // Sprint 10 — the timeline now draws two collections (§4 time-blocking)
      timelineEntries: timelineEntries,
      timelineCard: timelineCard,
      recSummary: recSummary,
      recTitle: recTitle,
      itemLines: itemLines,
      mergeChecklist: mergeChecklist,
      applyEdit: applyEdit,
      TO_FORM: TO_FORM,
      EDIT_TYPE: EDIT_TYPE,
      COLLECTION_OF: COLLECTION_OF,

      // Sprint 8 — the completion gesture, the 10-day recycle bin and the
      // tap-to-edit gate. plan(), the whole trash layer and the countdown math
      // are pure: healthcheck.js drives a full delete → count-down → restore →
      // purge cycle with no DOM, no timer and no clock of its own.
      HAPTIC_CHECK: HAPTIC_CHECK,
      COMPLETE_MS: COMPLETE_MS,
      LEAVE_MS: LEAVE_MS,
      TRASH_DAYS: TRASH_DAYS,
      DAY_MS: DAY_MS,
      TRASH_LABEL: TRASH_LABEL,
      TAP_EDIT: TAP_EDIT,
      CHECK_MARK: CHECK_MARK,
      Complete: Complete,
      leaveThen: leaveThen,
      normTrash: normTrash,
      trashLeftMs: trashLeftMs,
      trashDaysLeft: trashDaysLeft,
      trashExpired: trashExpired,
      trashList: trashList,
      trashFind: trashFind,
      trashCount: trashCount,
      trashPut: trashPut,
      trashRestore: trashRestore,
      trashPurge: trashPurge,
      emptyTrash: emptyTrash,
      purgeTrash: purgeTrash,
      trashRow: trashRow,
      trashDone: trashDone,
      selBoxHTML: selBoxHTML,

      // the bin's own selection layer — pure state, so a whole
      // enter → pick → בחר הכל → restore/purge cycle runs head-lessly
      TrashSel: TrashSel,

      // Sprint 9 — in-place completion, the היסטוריה log and the anti-shake
      // layer. The whole log is pure store work, so healthcheck.js drives a
      // full tick → archive → count-down → restore → purge cycle with no DOM,
      // no timer and no clock of its own.
      ARCHIVE_DAYS: ARCHIVE_DAYS,
      ARCHIVE_LABEL: ARCHIVE_LABEL,
      awaitingArchive: awaitingArchive,
      sinksToBottom: sinksToBottom,
      boardTasksToday: boardTasksToday,
      boardTasksOn: boardTasksOn,
      doneUnfiled: doneUnfiled,
      retentionLeftMs: retentionLeftMs,
      retentionDaysLeft: retentionDaysLeft,
      retentionCountdown: retentionCountdown,
      normArchive: normArchive,
      archiveLeftMs: archiveLeftMs,
      archiveDaysLeft: archiveDaysLeft,
      archiveExpired: archiveExpired,
      archiveList: archiveList,
      archiveFind: archiveFind,
      archiveCount: archiveCount,
      archivePut: archivePut,
      archiveDone: archiveDone,
      archiveRestore: archiveRestore,
      archivePurge: archivePurge,
      purgeArchive: purgeArchive,
      archiveRow: archiveRow,
      archiveBarHTML: archiveBarHTML,
      markEntering: markEntering,
      setHTML: setHTML,
      setText: setText,

      /* Sprint 12 — real-time visibility (§2), the open-items sheet (§3) and
         the detail reader (§4). reveal() and dayGuard() are the two things
         that stood between "saved" and "on screen"; everything below them is
         pure selector work the healthcheck drives with no DOM at all. */
      TAP_DETAIL: TAP_DETAIL,
      reveal: reveal,
      calShows: calShows,
      dayGuard: dayGuard,
      OPEN_FILTERS: OPEN_FILTERS,
      OPEN_FILTER_LABEL: OPEN_FILTER_LABEL,
      OPEN_EMPTY: OPEN_EMPTY,
      openFilter: openFilter,
      openEntries: openEntries,
      openMatches: openMatches,
      openRows: openRows,
      openKeys: openKeys,
      openRowHTML: openRowHTML,
      renderOpenSheet: renderOpenSheet,
      Detail: Detail,
      openTapped: openTapped,

      /* Sprint 14 — the compact task row (§1) and the reader that now holds
         everything it stopped carrying (§2). taskRow() is pure string work, so
         healthcheck.js renders real records and asserts on the markup itself. */
      taskRow: taskRow,
      rowWhen: rowWhen,
      shortDay: shortDay,
      stampDay: stampDay
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
      sortTasks: sortTasks,

      // Sprint 10 — the Inbox / Upcoming split, the My Day widget behind it and
      // the workspaces of the משימות screen. Every predicate here is pure, so
      // healthcheck.js partitions a whole synthetic store with no DOM at all.
      TAB_LABEL: TASK_TAB_LABEL,
      TAB_EMPTY: TASK_TAB_EMPTY,
      UPCOMING_DAYS: UPCOMING_DAYS,
      WORK_TABS: WORK_TABS,
      WORK_LABEL: WORK_LABEL,
      WORK_TITLE: WORK_TITLE,
      sortByDate: sortByDate,
      upcomingBand: upcomingBand,
      upcomingSoon: upcomingSoon,
      inboxTasks: inboxTasks,
      upcomingWidget: upcomingWidget,
      shownTasks: shownTasks,
      tasksHTML: tasksHTML,
      workspace: workspace,
      timedTasksToday: timedTasksToday,
      clientChip: clientChip
    },

    // Sprint 10 — per-record reminder leads and the synthesised chime. Both are
    // pure enough to drive with no clock, no speaker and no permission prompt.
    reminders: {
      OPTIONS: REMIND_OPTIONS,
      LABEL: REMIND_LABEL,
      SHORT: REMIND_SHORT,
      MINUTES: REMIND_MINUTES,
      DEFAULT: REMIND_DEFAULT,
      TONES: CHIME_TONES,
      normRemind: normRemind,
      remindLead: remindLead,
      remindTag: remindTag,
      migrateEvent: migrateEvent,
      Chime: Chime,
      // Sprint 11 — the grace window and the gesture list, so healthcheck can
      // assert the late-delivery contract rather than pattern-match for it
      GRACE: MISS_GRACE_MIN,
      GESTURES: CHIME_GESTURES,

      // Sprint 12 — several reminders per record. The whole vocabulary is pure
      // string work, so healthcheck.js round-trips a real multi-reminder record
      // through the store, the column and the scan with no clock and no DOM.
      BUILTIN: REMIND_BUILTIN,
      MULTI: REMIND_MULTI,
      ORDER: REMIND_ORDER,
      MAX: REMIND_MAX,
      CUSTOM_PREFIX: REMIND_CUSTOM_PREFIX,
      ON_LABEL: REMIND_ON_LABEL,
      OFF_LABEL: REMIND_OFF_LABEL,
      isCustomRemind: isCustomRemind,
      customRemindStamp: customRemindStamp,
      customRemindDate: customRemindDate,
      customRemindTime: customRemindTime,
      customRemindText: customRemindText,
      remindLabelOf: remindLabelOf,
      remindClass: remindClass,
      normRemindList: normRemindList,
      remindersOf: remindersOf,
      remindKey: remindKey,
      remindColumn: remindColumn,
      setReminders: setReminders,
      remindOn: remindOn,
      remindPlan: remindPlan,
      remindMark: remindMark,
      remindSentence: remindSentence,
      remindField: remindField,
      FormRemind: FormRemind
    },

    /**
     * Sprint 13 — the settings drawer, the dual-sound engine and the per-record
     * alert pair. Every normaliser and every voice spec is pure data or pure
     * string work, so healthcheck.js drives the whole layer head-lessly: no
     * AudioContext, no vibration motor, no DOM.
     */
    settings: {
      APP_VERSION: APP_VERSION,
      SHORT_SOUNDS: SHORT_SOUNDS,
      SHORT_DEFAULT: SHORT_DEFAULT,
      LONG_RINGS: LONG_RINGS,
      LONG_DEFAULT: LONG_DEFAULT,
      LONG_MS: LONG_MS,
      VIBE_KINDS: VIBE_KINDS,
      VIBE_LABEL: VIBE_LABEL,
      VIBE_PATTERN: VIBE_PATTERN,
      VIBE_DEFAULT: VIBE_DEFAULT,
      ALERT_SOUNDS: ALERT_SOUNDS,
      ALERT_SOUND_LABEL: ALERT_SOUND_LABEL,
      ALERT_SOUND_DEFAULT: ALERT_SOUND_DEFAULT,
      THEMES: THEMES,
      THEME_LABEL: THEME_LABEL,
      THEME_DEFAULT: THEME_DEFAULT,
      normAlertSound: normAlertSound,
      normVibe: normVibe,
      normShortSound: normShortSound,
      normLongSound: normLongSound,
      setAlert: setAlert,
      setAlertFrom: setAlertFrom,
      alertOf: alertOf,
      alertSentence: alertSentence,
      alertField: alertField,
      FormAlert: FormAlert,
      Settings: Settings,
      Chime: Chime,
      Haptics: Haptics,
      // the one door every layer in the app closes through — exported so the
      // suite can prove the drawer goes down with the rest of them
      closeSheets: closeSheets
    },

    lists: {
      migrateList: migrateList,
      normItems: normItems,
      normQty: normQty,
      QTY_MAX: QTY_MAX,
      parseChecklist: parseChecklist,
      listProgress: listProgress,
      progressOf: progressOf,
      toggleItem: toggleItem,
      // Sprint 15 — the pantry catalog. Everything above the UI module is pure,
      // so the suite can search, toggle and count without a DOM at all.
      PANTRY: PANTRY,
      PANTRY_TOTAL: PANTRY_TOTAL,
      pantryAisle: pantryAisle,
      pantryLabel: pantryLabel,
      pantryAisleRows: pantryAisleRows,
      pantryNorm: pantryNorm,
      pantrySearch: pantrySearch,
      pantryCatOf: pantryCatOf,
      // Sprint 17 — the catalog overlay. PANTRY above is still the dictated
      // vocabulary; everything here is the owner's own layer over it, and all
      // of it is pure: an overlay in, a new overlay (or a catalog) out.
      PRODUCT_MAX: PRODUCT_MAX,
      normProduct: normProduct,
      normPantryEdits: normPantryEdits,
      pantryRef: pantryRef,
      pantryRefCat: pantryRefCat,
      pantryRefOrig: pantryRefOrig,
      pantryBase: pantryBase,
      pantryApply: pantryApply,
      pantryEdited: pantryEdited,
      pantryTitleOf: pantryTitleOf,
      pantryHolds: pantryHolds,
      pantryAddProduct: pantryAddProduct,
      pantryRenameProduct: pantryRenameProduct,
      pantryRemoveProduct: pantryRemoveProduct,
      pantryEdits: pantryEdits,
      pantryAisles: pantryAisles,
      pantryTotal: pantryTotal,
      pantryWrite: pantryWrite,
      pantryChip: pantryChip,
      pantryEditRow: pantryEditRow,
      // Sprint 16 — the shopping list, as rows. Same deal: every one of these
      // is pure, so the suite drives a whole select → tick → count → clear
      // cycle without a DOM, and the module below is the only part that needs one.
      SHOP_LIST_ID: SHOP_LIST_ID,
      SHOP_TITLE: SHOP_TITLE,
      SHOP_TABS: SHOP_TABS,
      SHOP_OTHER: SHOP_OTHER,
      shopIndex: shopIndex,
      shopHas: shopHas,
      shopToggle: shopToggle,
      shopDrop: shopDrop,
      shopCheck: shopCheck,
      shopSetQty: shopSetQty,
      shopClearDone: shopClearDone,
      shopGroups: shopGroups,
      shopRow: shopRow,
      // Sprint 17 — the ± pair over a free-text amount, the repaint guard that
      // keeps a rebuild off the caret, and the rename that follows a catalog
      // edit into the list
      QTY_STEP_MAX: QTY_STEP_MAX,
      qtyStep: qtyStep,
      shopSignature: shopSignature,
      shopRename: shopRename,
      shopList: shopList,
      shopItems: shopItems,
      shopEnsure: shopEnsure,
      shopWrite: shopWrite,
      Shop: Shop
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
