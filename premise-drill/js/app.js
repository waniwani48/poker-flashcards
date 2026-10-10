// premise-drill: PD.app（T0 骨格 → T14a で完成）。
// ルータ（view 名 → PD.ui[view].render(root, ctx)）と Ctx の器、状態機械 home→drill→truth→home。
//   init         : state / log を store から読み、ナビを結線して home へ
//   go(view)     : 遷移前に ctx.timer?.stop()。body[data-view] を更新して描画
//   start(...)   : 出題を開始（sheet を buildSheet で組み、票を空にする）。speed は 'speed'、それ以外は 'drill' へ
//   commit()     : 票を凍結し LogEntry を作る（_ts → commit.fieldTimes、postCheck に PD.cards を注入）→ truth へ
//   saveOutcome(): mode!=='speed' なら gaps.recordOutcome → store.saveState。全 mode で store.appendLog → home
//   next()       : gen.nextSpot → start（slow・drill）
// 純粋ロジック（commit / saveOutcome / next）は document 無しでも動く（node の静的スモークで検証）。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.app = (function () {
  'use strict';

  var VIEWS = ['home', 'drill', 'truth', 'map', 'settings', 'speed', 'import', 'review'];
  var TOAST_MS = 2400;
  var SAVE_FAIL_MSG = '保存できませんでした。エクスポートして整理してください';
  var BASE_FIELDS = ['f1', 'f2', 'f3', 'f4', 'f5'];

  function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }

  function esc(s) {
    return has(PD.util, 'esc') ? PD.util.esc(s) : String(s == null ? '' : s);
  }

  function todayStr() {
    if (has(PD.util, 'today')) return PD.util.today();
    var d = new Date();
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function newId(prefix) {
    if (has(PD.util, 'id')) return PD.util.id(prefix);
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clone(x) {
    if (x === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return x; }
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** store が無い環境向けの最小 State。正規の既定は PD.store.defaultState / loadState */
  function fallbackState() {
    if (has(PD.store, 'defaultState')) return PD.store.defaultState();
    return {
      version: 1,
      stage: 1,
      settings: {
        wizardNode: 'cb',
        wizardBfacing: 'unknown',
        wizardBetDecimals: 1,
        sizes: [33, 50],
        extraFields: [],
        pendingExtra: [],
        speedUnlockedAt: null
      },
      recurrence: {},
      familyStats: {},
      counters: { committed: 0, live: 0, speed: 0, liveToday: { date: todayStr(), n: 0 } }
    };
  }

  /** sheet が無い環境向けの最小 SheetValues。正規の既定は PD.sheet.emptyValues */
  function emptySheet() {
    if (has(PD.sheet, 'emptyValues')) return PD.sheet.emptyValues();
    return { f1: {}, f2: {}, f3: {}, f4: {}, f5: {}, extra: {}, _ts: {} };
  }

  /** 有効な追加欄（enabled かつ未退役）の slot id */
  function activeExtraIds(state) {
    var list = (state && state.settings && state.settings.extraFields) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x && x.enabled && !x.retiredAt && x.id) out.push(x.id);
    }
    return out;
  }

  // ---- Ctx（SPEC ⑫ typedef の全項目。UI はここ以外の状態を持たない） ----
  var ctx = {
    state: null,
    log: [],
    view: 'home',
    mode: null,          // 'drill'|'speed'|'live'|null
    tempo: 'slow',       // 'slow'|'normal'|'speed'
    reason: null,        // 'srs'|'random'|'stable'|'manual'|null
    spot: null,
    fields: [],
    sheet: null,
    hints: [],
    startedAt: null,
    timer: null,         // { stop() } speed のみ
    pairNext: null,      // Phase C 用に予約。A/B では常に null
    entry: null,
    judgeState: 'nokey', // 'nokey'|'idle'|'loading'|'error'|'done'
    live: null,          // Phase B（Import）が入れる { villainPos, myAction, memo }。A では null
    lastOutcome: null,   // 直前の saveOutcome の recordOutcome 結果（added 等）。UI の「欄が増えました」表示用
    // メソッドは PD.app に委譲
    go: function (view) { return PD.app.go(view); },
    commit: function (opts) { return PD.app.commit(opts); },
    saveOutcome: function () { return PD.app.saveOutcome(); },
    next: function () { return PD.app.next(); },
    toast: function (msg) { return PD.app.toast(msg); }
  };

  function rootEl() {
    return (typeof document !== 'undefined') ? document.getElementById('pd-root') : null;
  }

  function renderUnimplemented(el, view) {
    el.innerHTML =
      '<section class="pd-card pd-unimpl">' +
        '<h2>未実装</h2>' +
        '<p class="pd-mute">画面「' + esc(view) + '」はまだ実装されていません。</p>' +
        '<p><button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホームへ</button></p>' +
      '</section>';
  }

  /** 解放条件を初めて満たしたら speedUnlockedAt を記録する（Home のカードは1回だけ出る） */
  function markSpeedUnlock() {
    var st = ctx.state;
    if (!st || !st.settings || st.settings.speedUnlockedAt) return;
    if (!has(PD.gaps, 'speedUnlocked')) return;
    var info;
    try { info = PD.gaps.speedUnlocked(st, ctx.log); } catch (e) { return; }
    if (!info || !info.ok) return;
    st.settings.speedUnlockedAt = new Date().toISOString();
    if (has(PD.store, 'saveState')) PD.store.saveState(st);
  }

  // ---- ルータ ----
  function go(view) {
    if (ctx.timer && typeof ctx.timer.stop === 'function') {
      try { ctx.timer.stop(); } catch (e) { /* 停止失敗は無視 */ }
    }
    ctx.timer = null;
    ctx.view = VIEWS.indexOf(view) >= 0 ? view : 'home';

    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-view', ctx.view);
    }
    var el = rootEl();
    if (!el) return;

    var ui = PD.ui[ctx.view];
    if (ui && typeof ui.render === 'function') {
      ui.render(el, ctx);
    } else {
      renderUnimplemented(el, ctx.view);
    }
    if (ctx.view === 'home') markSpeedUnlock();
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0); } catch (e) { /* 一部環境で未対応 */ }
    }
  }

  /** data-go="<view>" を持つ要素のクリックで遷移（全 UI 共通のナビ） */
  function bindNav() {
    if (typeof document === 'undefined') return;
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var a = t.closest('[data-go]');
      if (!a) return;
      ev.preventDefault();
      go(a.getAttribute('data-go'));
    });
  }

  // ---- ライフサイクル ----
  function reload() {
    ctx.state = has(PD.store, 'loadState') ? PD.store.loadState() : fallbackState();
    ctx.log = has(PD.store, 'loadLog') ? (PD.store.loadLog() || []) : [];
    var hasKey = has(PD.store, 'getApiKey') && !!PD.store.getApiKey();
    if (!hasKey) ctx.judgeState = 'nokey';
    else if (ctx.judgeState === 'nokey') ctx.judgeState = 'idle';
  }

  function clearDrill() {
    ctx.spot = null;
    ctx.mode = null;
    ctx.reason = null;
    ctx.fields = [];
    ctx.sheet = emptySheet();
    ctx.hints = [];
    ctx.startedAt = null;
    ctx.entry = null;
    ctx.pairNext = null;
    ctx.live = null;
  }

  function init() {
    reload();
    clearDrill();
    bindNav();
    go('home');
  }

  /** 出題を開始して Drill（speed は Speed 画面）へ */
  function start(spot, mode, tempo, reason) {
    ctx.spot = spot || null;
    ctx.mode = mode || 'drill';
    ctx.tempo = tempo || 'slow';
    ctx.reason = reason || null;
    ctx.fields = has(PD.sheet, 'buildSheet') ? PD.sheet.buildSheet(activeExtraIds(ctx.state), ctx.tempo) : [];
    ctx.sheet = emptySheet();
    ctx.hints = [];
    ctx.startedAt = Date.now();
    ctx.entry = null;
    ctx.pairNext = null;
    ctx.lastOutcome = null;
    if (ctx.mode !== 'live') ctx.live = null;
    ctx.judgeState = (ctx.judgeState === 'nokey') ? 'nokey' : 'idle';
    go(ctx.mode === 'speed' ? 'speed' : 'drill');
  }

  // ---- コミット：票の凍結と LogEntry の作成 ----

  /** 完了時刻（_ts）の昇順に欄 id を並べる（未完了の欄は含めない） */
  function orderOf(fields, ts) {
    var ids = [];
    var i;
    for (i = 0; i < fields.length; i++) {
      var id = fields[i] && fields[i].id;
      if (id && isNum(ts[id])) ids.push(id);
    }
    if (!ids.length) {
      for (var k in ts) if (Object.prototype.hasOwnProperty.call(ts, k) && isNum(ts[k])) ids.push(k);
    }
    ids.sort(function (a, b) { return ts[a] - ts[b]; });
    return ids;
  }

  /**
   * commit(opts?) -> LogEntry|null
   *   opts.timedOut（speed のタイムアップ）。未充足でも speed なら incomplete:true で封印する。
   *   slow/normal/live は canCommit ok のときだけ封印する（UI 側でも弾いているが防御）。
   */
  function commit(opts) {
    opts = opts || {};
    if (!ctx.spot || !ctx.sheet) {
      toast('出題がありません');
      return null;
    }
    var S = PD.sheet;
    var fields = Array.isArray(ctx.fields) ? ctx.fields : [];
    var cc = has(S, 'canCommit') ? S.canCommit(fields, ctx.sheet, ctx.spot) : { ok: true, missing: [] };
    var timedOut = opts.timedOut === true;
    if (!cc.ok && !timedOut && ctx.tempo !== 'speed') {
      toast('未充足：' + cc.missing.join('／'));
      return null;
    }

    var now = Date.now();
    var startedAt = isNum(ctx.startedAt) ? ctx.startedAt : now;
    var ts = (ctx.sheet && ctx.sheet._ts) || {};
    var fieldTimes = {};
    var i;
    for (i = 0; i < fields.length; i++) {
      var fid = fields[i] && fields[i].id;
      if (fid && isNum(ts[fid])) fieldTimes[fid] = ts[fid];
    }
    // 票の凍結（深いコピー）。_ts は commit.fieldTimes に転記したので票側からは外す
    var sheet = clone(ctx.sheet) || {};
    delete sheet._ts;
    for (i = 0; i < BASE_FIELDS.length; i++) if (!sheet[BASE_FIELDS[i]]) sheet[BASE_FIELDS[i]] = {};
    if (!sheet.extra) sheet.extra = {};

    var f5 = sheet.f5 || {};
    var confidence = isNum(f5.confidence) ? f5.confidence : null;
    if (confidence !== null && has(S, 'confidenceCap')) {
      var cap = S.confidenceCap(ctx.hints);
      if (confidence > cap) confidence = cap;
    }

    var postCheck = null;
    if (has(S, 'postCheck')) {
      try { postCheck = S.postCheck(sheet, ctx.spot, PD.cards || {}); } catch (e) { postCheck = null; }
    }

    var entry = {
      id: newId('l'),
      at: new Date(now).toISOString(),
      mode: ctx.mode || 'drill',
      tempo: ctx.tempo || 'slow',
      reason: ctx.reason || (ctx.mode === 'live' ? 'manual' : 'random'),
      spot: clone(ctx.spot),
      sheet: sheet,
      hints: clone(Array.isArray(ctx.hints) ? ctx.hints : []),
      commit: {
        elapsedMs: Math.max(0, now - startedAt),
        fieldTimes: fieldTimes,
        order: orderOf(fields, ts),
        timedOut: timedOut,
        incomplete: !cc.ok,
        confidence: confidence
      },
      truth: null,
      postCheck: postCheck,
      selfScore: null,
      claude: null,
      gap: null,
      gapNote: '',
      scoreUsed: 'self',
      live: (ctx.mode === 'live') ? (clone(ctx.live) || { villainPos: ctx.spot.villainPos || 'BTN', myAction: null, memo: '' }) : null
    };
    ctx.entry = entry;
    ctx.lastOutcome = null;
    go('truth');
    return entry;
  }

  // ---- 保存：recordOutcome → saveState、appendLog → home ----

  /** 保存直前の整形（truth 側の finalize が済んでいる前提だが、欠けを埋める） */
  function normalizeEntry(entry) {
    if (!entry.id) entry.id = newId('l');
    if (!entry.at) entry.at = new Date().toISOString();
    if (!entry.gap) entry.gap = 'none';
    if (typeof entry.gapNote !== 'string') entry.gapNote = '';
    if (entry.scoreUsed !== 'claude') entry.scoreUsed = 'self';
    if (entry.truth === undefined) entry.truth = null;
    if (entry.selfScore === undefined) entry.selfScore = null;
    if (entry.claude === undefined) entry.claude = null;
    if (!entry.commit) entry.commit = { elapsedMs: 0, fieldTimes: {}, order: [], timedOut: false, incomplete: false, confidence: null };
    // 真値：UI の下書き（未入力のまま）は used:false に落とす。下書き専用の skip は保存しない
    var t = entry.truth;
    if (t && typeof t === 'object' && t.used !== false) {
      if (!isNum(t.rangeFoldPct) && !isNum(t.heroFold) && !isNum(t.heroCall) && !isNum(t.heroRaise)) {
        entry.truth = { used: false };
      } else {
        delete t.skip;
      }
    }
    if (entry.mode === 'speed' && entry.truth === null) entry.truth = { used: false };
    return entry;
  }

  /**
   * saveOutcome() -> { ok, outcome }
   *   appendLog が失敗したら state を変えず、トーストを出して truth に留まる（UI がやり直せる）。
   */
  function saveOutcome() {
    var entry = ctx.entry;
    if (!entry || !entry.spot || !entry.sheet) {
      toast('保存する票がありません');
      return { ok: false, outcome: null };
    }
    normalizeEntry(entry);
    if (!ctx.state) ctx.state = fallbackState();
    // slow/live は真値必須（UI の保存ボタン無効化と二重の防御）
    if (entry.mode !== 'speed' && !(entry.truth && entry.truth.used === true)) {
      toast('真値（Wizard で見た数字）を入れてから保存してください');
      return { ok: false, outcome: null };
    }

    var outcome = null;
    var nextState = ctx.state;
    if (entry.mode !== 'speed') {
      if (has(PD.gaps, 'recordOutcome')) {
        var res = PD.gaps.recordOutcome(ctx.state, entry, todayStr());
        if (res && res.state) {
          nextState = res.state;
          outcome = res;
        }
      }
    } else {
      // speed は recordOutcome を通らない。counters.speed だけここで加算する
      nextState = clone(ctx.state) || ctx.state;
      nextState.counters = nextState.counters || {};
      nextState.counters.speed = (Number(nextState.counters.speed) || 0) + 1;
    }

    var r = has(PD.store, 'appendLog') ? PD.store.appendLog(entry) : { ok: true, trimmed: 0 };
    if (!r || !r.ok) {
      toast(SAVE_FAIL_MSG);
      return { ok: false, outcome: null };
    }

    ctx.state = nextState;
    if (has(PD.store, 'saveState')) PD.store.saveState(ctx.state);
    ctx.log = has(PD.store, 'loadLog') ? (PD.store.loadLog() || []) : ctx.log.concat([entry]);
    ctx.lastOutcome = outcome;

    clearDrill();
    go('home');
    var msg = '保存しました';
    if (outcome && outcome.added) msg = '保存しました。次回から欄が1つ増えます';
    else if (r.trimmed) msg = '保存しました（上限超過で古い ' + r.trimmed + ' 件を間引き）';
    toast(msg);
    return { ok: true, outcome: outcome };
  }

  /** gen.nextSpot → start（Phase A は slow・drill のみ） */
  function next() {
    if (!has(PD.gen, 'nextSpot')) {
      toast('出題エンジンが読み込まれていません');
      return null;
    }
    if (!ctx.state) ctx.state = fallbackState();
    var r;
    try {
      r = PD.gen.nextSpot(ctx.state, ctx.log, { tempo: 'slow' });
    } catch (e) {
      toast('出題を作れませんでした');
      return null;
    }
    if (!r || !r.spot) {
      toast('出題を作れませんでした');
      return null;
    }
    start(r.spot, 'drill', 'slow', r.reason || 'random');
    return r;
  }

  // ---- トースト ----
  function toast(msg) {
    var text = String(msg == null ? '' : msg);
    if (typeof document === 'undefined' || !document.body) {
      if (typeof console !== 'undefined' && console.log) console.log('[toast] ' + text);
      return;
    }
    var old = document.querySelector('.pd-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'pd-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () {
      t.classList.add('pd-toast-out');
      setTimeout(function () { if (t.parentNode) t.remove(); }, 260);
    }, TOAST_MS);
  }

  return {
    VIEWS: VIEWS,
    ctx: ctx,
    init: init,
    go: go,
    start: start,
    commit: commit,
    saveOutcome: saveOutcome,
    next: next,
    toast: toast,
    // 契約外（結合・検証用）
    reload: reload,
    activeExtraIds: activeExtraIds
  };
})();

// ブラウザでは DOM 準備後に起動。node（テスト）では何もしない
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { PD.app.init(); });
  } else {
    PD.app.init();
  }
}

if (typeof module !== 'undefined') module.exports = PD.app;
