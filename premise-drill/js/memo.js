// premise-drill: PD.memo（M1）。暗記レーン（SRS）の純粋モジュール＋自前ストレージ。
// 契約は SPEC-memo.md §5「js/memo.js — PD.memo」。cards／wizard は任意依存（node では require）。
// ソルバー数値・記事名・著者名・出典サイトの URL はコード／コメント／UI 文字列に書かない。
// 暗記値（ALPHA_MEMO／EQGAP_MEMO）はこのファイルの1箇所のみに置く。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

var memoCardsDep = PD.cards || (typeof require === 'function' ? require('./cards') : null);
var memoWizardDep = PD.wizard || (typeof require === 'function' ? require('./wizard') : null);

PD.memo = (function (cardsDep, wizardDep) {
  'use strict';

  // ---------------------------------------------------------------- 定数

  var KEY = 'pd_memo_v1';

  /** 暗記値（本人の暗記表）。サイズ% → fold% の目安。置き場はここ1箇所 */
  var ALPHA_MEMO = { 33: 30, 50: 40, 75: 50, 125: 60 };

  /** EQ差の暗記値。key → 'more'（αより多めに降りる）｜'alpha'（α通りに戻る） */
  var EQGAP_MEMO = { '4bp': 'more', 'utg': 'more', 'capped': 'more', 'wide': 'more', 'btn': 'alpha', 'turn': 'alpha' };

  /** reveal 用の短い言い換え（自作要約。記事の言い回しは使わない） */
  var EQGAP_LABELS = {
    '4bp': '4ベットポット',
    'utg': 'UTG に対するフロップ',
    'capped': 'ポラーを吐いた後のキャップドレンジ',
    'wide': 'ワイド・リンプポット',
    'btn': 'BTN vs BB などレンジ差が小さい対面',
    'turn': 'トラッシュが落ちた後のターン'
  };

  var MEMO_INTERVALS = [1, 2, 4, 8, 16];
  var NEW_PER_DAY = 4;
  var BOARD_PER_DAY = 3;

  var FALLBACK_BOARDS = ['Ks7d5c', 'QsJd9c', 'Ts9h6c', '8h7d4c', 'Ah9h6c'];

  /** ボードの種類（PD.cards.classifyBoard の cls）の表示名。選択肢の並び順も兼ねる */
  var CLS_ORDER = ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono', 'trips'];
  var CLS_LABELS = {
    dry_high: 'ドライ・ハイ', bw_sd: 'ブロードウェイSD', mid: 'ミドル', low: 'ロー',
    paired: 'ペア', mono: 'モノトーン', trips: 'トリップス'
  };

  var ALPHA_HINT = 'α（アルファ）＝相手のベットサイズから決まる「自レンジの何%まで降りてよいか」の基準。' +
    '純粋な α は ベット÷(ベット＋ポット)（33%ベットなら25%）。ここで暗記するのは、それより少し多めに降りる実践値。';
  var EQGAP_HINT = 'EQ差＝自レンジが相手レンジよりエクイティで劣るほど、暗記値を超えて降りてよい（overfold）。' +
    'レンジ差が小さい対面では暗記値どおり。';
  var BOARD_HINT = '②は「このランクを手札に1枚持っていれば、ボード3枚と合わせて4枚のストレートドロー（OESD かガット）になる」ランク。' +
    '完成カードではない。例：QJ9 なら T（OESD）、K と 8（ガット）。無ければ「無し」。';

  var DECKS = [
    { id: 'alpha', label: '必要fold%（α）' },
    { id: 'eqgap', label: 'EQ差' },
    { id: 'pf', label: 'PF境界' },
    { id: 'board', label: 'ボード' }
  ];

  /** 固定カード（alpha 4／eqgap 2／pf 8）。問いは自作要約。記事名・著者名は書かない */
  var CARDS = [
    { id: 'alpha_33', deck: 'alpha', kind: 'number', q: '相手が 33% ポットを打ってきた。自レンジの何%まで降りてよい？（暗記値）', hint: ALPHA_HINT },
    { id: 'alpha_50', deck: 'alpha', kind: 'number', q: '相手が 50% ポットを打ってきた。自レンジの何%まで降りてよい？（暗記値）', hint: ALPHA_HINT },
    { id: 'alpha_75', deck: 'alpha', kind: 'number', q: '相手が 75% ポットを打ってきた。自レンジの何%まで降りてよい？（暗記値）', hint: ALPHA_HINT },
    { id: 'alpha_125', deck: 'alpha', kind: 'number', q: '相手が 125% ポットを打ってきた。自レンジの何%まで降りてよい？（暗記値）', hint: ALPHA_HINT },

    { id: 'eqgap_more', deck: 'eqgap', kind: 'lines', q: '暗記値より多く降りる（overfold する）スポットを全部挙げよ（1行1項目）', hint: EQGAP_HINT },
    { id: 'eqgap_alpha', deck: 'eqgap', kind: 'lines', q: '暗記値どおりでよい（overfold しない）のはどんな時か、全部挙げよ（1行1項目）', hint: EQGAP_HINT },

    { id: 'pf_As', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：スーテッド A の底は？' },
    { id: 'pf_Ks', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：スーテッド K の底は？' },
    { id: 'pf_Qs', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：スーテッド Q の底は？' },
    { id: 'pf_JTs', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：スーテッド・コネクテッドの底は？' },
    { id: 'pf_off', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：オフスートの底（K／Q／J）は？' },
    { id: 'pf_pocket', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンにコールする境界：ポケットの底は？' },
    { id: 'pf_3bet_value', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンに 3bet する境界：value の下限は？' },
    { id: 'pf_3bet_bluff', deck: 'pf', kind: 'text', q: 'BB が BTN 2.5bb オープンに 3bet する境界：bluff に使う形は？' }
  ];

  var CARD_BY_ID = {};
  CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  var GAP_DECK_MAP = { baseline: 'alpha', range_state: 'pf', rule: 'eqgap' };

  var CLS_VALID = { dry_high: 1, bw_sd: 1, mid: 1, low: 1, paired: 1, mono: 1, trips: 1 };
  var CLS_ALIASES = {
    'ドライ': 'dry_high', 'ドライ・ハイ': 'dry_high', 'dry': 'dry_high',
    'bw': 'bw_sd', 'ブロードウェイ': 'bw_sd',
    'ミドル': 'mid',
    'ロー': 'low',
    'ペア': 'paired', 'ペアード': 'paired',
    'モノ': 'mono', 'モノトーン': 'mono',
    'トリップス': 'trips'
  };

  // ---------------------------------------------------------------- 小道具

  function clone(o) {
    if (o === undefined || o === null) return o;
    try { return JSON.parse(JSON.stringify(o)); } catch (e) { return o; }
  }

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  /** ローカル日付 'YYYY-MM-DD'（setNote で新規カードを作る際の既定値にのみ使う） */
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 'YYYY-MM-DD' に n 日足す（UTC 計算で DST の影響を避ける。gaps.js と同じ方式） */
  function addDays(ymd, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return ymd;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (Number(n) || 0) * 86400000;
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function uniq(arr) {
    var seen = {};
    var out = [];
    (arr || []).forEach(function (x) {
      var k = String(x);
      if (!seen[k]) { seen[k] = true; out.push(x); }
    });
    return out;
  }

  function setsEqual(a, b) {
    var ua = uniq(a);
    var ub = uniq(b);
    if (ua.length !== ub.length) return false;
    for (var i = 0; i < ua.length; i++) {
      if (ub.indexOf(ua[i]) < 0) return false;
    }
    return true;
  }

  function newCardRecord(due) {
    return { box: 0, due: due, reps: 0, lapses: 0, lastAt: null, note: '' };
  }

  // ---------------------------------------------------------------- ストレージ（自前。try/catch、無ければメモリ）

  var mem = {};

  function hasLocalStorage() {
    try {
      var s = root.localStorage;
      return !!(s && typeof s.getItem === 'function' && typeof s.setItem === 'function');
    } catch (e) {
      return false;
    }
  }

  function getRaw(key) {
    try {
      if (hasLocalStorage()) {
        var v = root.localStorage.getItem(key);
        return v === null || v === undefined ? undefined : v;
      }
    } catch (e) { /* 読めない環境はメモリへ */ }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : undefined;
  }

  function setRaw(key, val) {
    try {
      if (hasLocalStorage()) {
        root.localStorage.setItem(key, val);
        return;
      }
    } catch (e) { /* 書けない環境はメモリへ */ }
    mem[key] = val;
  }

  // ---------------------------------------------------------------- state

  function defaultState() {
    return {
      version: 1,
      cards: {},
      daily: { date: null, done: 0, ok: 0, ng: 0, boardOk: 0, boardN: 0, finished: false },
      decks: { alpha: true, eqgap: true, pf: true, board: true }
    };
  }

  function sanitizeDaily(d) {
    if (!d || typeof d !== 'object') return defaultState().daily;
    return {
      date: typeof d.date === 'string' ? d.date : null,
      done: Number(d.done) || 0,
      ok: Number(d.ok) || 0,
      ng: Number(d.ng) || 0,
      boardOk: Number(d.boardOk) || 0,
      boardN: Number(d.boardN) || 0,
      finished: !!d.finished
    };
  }

  function sanitizeDecks(d) {
    var base = defaultState().decks;
    if (!d || typeof d !== 'object') return base;
    return {
      alpha: d.alpha !== false,
      eqgap: d.eqgap !== false,
      pf: d.pf !== false,
      board: d.board !== false
    };
  }

  function loadState() {
    var raw = getRaw(KEY);
    var parsed;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
    var base = defaultState();
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return base;
    base.cards = (parsed.cards && typeof parsed.cards === 'object') ? parsed.cards : {};
    base.daily = sanitizeDaily(parsed.daily);
    base.decks = sanitizeDecks(parsed.decks);
    return base;
  }

  function saveState(s) {
    var text;
    try { text = JSON.stringify(s); } catch (e) { return; }
    setRaw(KEY, text);
  }

  function exportState() {
    return loadState();
  }

  /** version 検査・cards をマージ（note は上書きしない：既存 note が非空なら保持） */
  function importState(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, msg: '形式が不正です' };
    if (obj.version !== 1) return { ok: false, msg: '版が一致しません' };
    var cur = loadState();
    var incoming = (obj.cards && typeof obj.cards === 'object') ? obj.cards : {};
    var merged = cur.cards || {};
    for (var id in incoming) {
      if (!Object.prototype.hasOwnProperty.call(incoming, id)) continue;
      var inc = incoming[id] || {};
      var exist = merged[id];
      var keepNote = (exist && typeof exist.note === 'string' && exist.note !== '')
        ? exist.note
        : (typeof inc.note === 'string' ? inc.note : '');
      merged[id] = {
        box: Number(inc.box) || 0,
        due: typeof inc.due === 'string' ? inc.due : (exist ? exist.due : todayLocal()),
        reps: Number(inc.reps) || 0,
        lapses: Number(inc.lapses) || 0,
        lastAt: (typeof inc.lastAt === 'string' || inc.lastAt === null) ? inc.lastAt : (exist ? exist.lastAt : null),
        note: keepNote
      };
    }
    cur.cards = merged;
    if (obj.decks && typeof obj.decks === 'object') cur.decks = sanitizeDecks(obj.decks);
    saveState(cur);
    return { ok: true, msg: '取り込み完了' };
  }

  function ensureDaily(state, today) {
    if (!state.daily || state.daily.date !== today) {
      state.daily = { date: today, done: 0, ok: 0, ng: 0, boardOk: 0, boardN: 0, finished: false };
    }
    return state.daily;
  }

  // ---------------------------------------------------------------- 出題（todaySet）

  function pickBoards(n, rngFn) {
    var out = [];
    if (cardsDep && typeof cardsDep.randomBoard === 'function' && typeof cardsDep.fmt === 'function') {
      for (var i = 0; i < n; i++) {
        out.push(cardsDep.fmt(cardsDep.randomBoard(rngFn)));
      }
      return out;
    }
    var pool = FALLBACK_BOARDS.slice();
    for (var j = 0; j < n && pool.length; j++) {
      var idx = Math.floor(rngFn() * pool.length);
      if (idx < 0) idx = 0;
      if (idx >= pool.length) idx = pool.length - 1;
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  function boardQuestion(boardStr) {
    return boardStr + '：① ボードの種類は？ ② 手札に1枚あればストレートドロー（4枚）が付くランクは？';
  }

  /** 純粋な α（%）。size はポットに対するベット%。33 → 25 */
  function pureAlpha(size) {
    var s = Number(size);
    if (!isFinite(s) || s <= 0) return null;
    return Math.round(s / (100 + s) * 100);
  }

  /** due 順（alpha→eqgap→pf）＋ board を BOARD_PER_DAY 件。新規は deck ごと NEW_PER_DAY まで */
  function todaySet(state, today, rng) {
    var s = state || defaultState();
    var decksOn = s.decks || {};
    var rngFn = typeof rng === 'function' ? rng : Math.random;
    var out = [];

    ['alpha', 'eqgap', 'pf'].forEach(function (deckId) {
      if (decksOn[deckId] === false) return;
      var due = [];
      var neu = [];
      CARDS.forEach(function (c) {
        if (c.deck !== deckId) return;
        var rec = s.cards && s.cards[c.id];
        if (!rec) { neu.push(c); }
        else if (rec.due <= today) { due.push(c); }
      });
      neu = neu.slice(0, NEW_PER_DAY);
      due.concat(neu).forEach(function (c) {
        out.push({ card: c, kind: c.kind });
      });
    });

    if (decksOn.board !== false) {
      var boards = pickBoards(BOARD_PER_DAY, rngFn);
      boards.forEach(function (boardStr, i) {
        var card = {
          id: 'board_' + String(today || '').replace(/-/g, '') + '_' + i,
          deck: 'board',
          kind: 'board',
          q: boardQuestion(boardStr),
          hint: BOARD_HINT
        };
        out.push({ card: card, kind: 'board', boardSpot: { board: boardStr } });
      });
    }

    return out;
  }

  // ---------------------------------------------------------------- 採点・SRS

  function grade(state, cardId, ok, today) {
    var s = clone(state) || defaultState();
    if (!s.cards) s.cards = {};
    var rec = s.cards[cardId];
    if (!rec) { rec = newCardRecord(today); s.cards[cardId] = rec; }
    rec.reps = (Number(rec.reps) || 0) + 1;
    if (ok) {
      rec.box = Math.min(4, (Number(rec.box) || 0) + 1);
      rec.due = addDays(today, MEMO_INTERVALS[rec.box]);
    } else {
      rec.box = 0;
      rec.lapses = (Number(rec.lapses) || 0) + 1;
      rec.due = addDays(today, 1);
    }
    rec.lastAt = new Date().toISOString();

    ensureDaily(s, today);
    s.daily.done += 1;
    if (ok) s.daily.ok += 1; else s.daily.ng += 1;
    return s;
  }

  function gradeBoard(state, ok, today) {
    var s = clone(state) || defaultState();
    ensureDaily(s, today);
    s.daily.boardN += 1;
    if (ok) s.daily.boardOk += 1;
    return s;
  }

  function setNote(state, cardId, note) {
    var s = clone(state) || defaultState();
    if (!s.cards) s.cards = {};
    var rec = s.cards[cardId];
    if (!rec) { rec = newCardRecord(todayLocal()); s.cards[cardId] = rec; }
    rec.note = typeof note === 'string' ? note : '';
    return s;
  }

  /** onGap：対応 deck の全カードを due=明日に（既存の due がそれ以前ならそのまま） */
  function onGap(state, gap, today) {
    var s = clone(state) || defaultState();
    var deckId = GAP_DECK_MAP[gap];
    if (!deckId) return s;
    if (!s.cards) s.cards = {};
    var tomorrow = addDays(today, 1);
    CARDS.forEach(function (c) {
      if (c.deck !== deckId) return;
      var rec = s.cards[c.id];
      if (!rec) return; // 未学習（due=今日相当）は変更しない
      if (rec.due && rec.due <= tomorrow) return; // 既にそれ以前に due ならそのまま
      rec.due = tomorrow;
    });
    return s;
  }

  function dueCount(state, today) {
    var s = state || defaultState();
    var decksOn = s.decks || {};
    var due = 0;
    var newAvail = 0;
    ['alpha', 'eqgap', 'pf'].forEach(function (deckId) {
      if (decksOn[deckId] === false) return;
      var newCount = 0;
      CARDS.forEach(function (c) {
        if (c.deck !== deckId) return;
        var rec = s.cards && s.cards[c.id];
        if (!rec) { newCount++; }
        else if (rec.due <= today) { due++; }
      });
      newAvail += Math.min(newCount, NEW_PER_DAY);
    });
    var boardOn = decksOn.board !== false;
    var boardDoneToday = (s.daily && s.daily.date === today) ? (Number(s.daily.boardN) || 0) : 0;
    var boardLeft = boardOn ? Math.max(0, BOARD_PER_DAY - boardDoneToday) : 0;
    return { due: due, newAvail: newAvail, boardLeft: boardLeft };
  }

  function finishDay(state, today) {
    var s = clone(state) || defaultState();
    ensureDaily(s, today);
    s.daily.finished = true;
    return s;
  }

  // ---------------------------------------------------------------- 補助照合

  function checkAlpha(cardId, value) {
    var m = /^alpha_(\d+)$/.exec(String(cardId || ''));
    if (!m) return false;
    var expect = ALPHA_MEMO[Number(m[1])];
    if (expect === undefined) return false;
    return Number(value) === expect;
  }

  function eqgapAnswer(cardId) {
    var target = cardId === 'eqgap_alpha' ? 'alpha' : 'more';
    var out = [];
    for (var k in EQGAP_MEMO) {
      if (!Object.prototype.hasOwnProperty.call(EQGAP_MEMO, k)) continue;
      if (EQGAP_MEMO[k] === target) out.push(EQGAP_LABELS[k] || k);
    }
    return out;
  }

  function normalizeClsText(text) {
    var raw = String(text === null || text === undefined ? '' : text).trim();
    var lower = raw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CLS_VALID, lower)) return lower;
    if (Object.prototype.hasOwnProperty.call(CLS_ALIASES, raw)) return CLS_ALIASES[raw];
    if (Object.prototype.hasOwnProperty.call(CLS_ALIASES, lower)) return CLS_ALIASES[lower];
    return lower;
  }

  function parseRanksText(text) {
    var t = String(text === null || text === undefined ? '' : text).trim();
    if (t === '' || t === '無し' || t === 'なし') return [];
    var parts = /\s/.test(t) ? t.split(/\s+/) : t.split('');
    var seen = {};
    var out = [];
    parts.forEach(function (p) {
      var ch = String(p).trim().toUpperCase();
      if (!ch) return;
      if (!seen[ch]) { seen[ch] = true; out.push(ch); }
    });
    return out;
  }

  /** checkBoard：clsText は別名表、ranksText は 'KT8'/'K T 8'/'無し'/'なし'/'' を集合に。cards はモック注入可 */
  function checkBoard(board, clsText, ranksText, cardsApi) {
    var api = cardsApi || cardsDep;
    if (!api || typeof api.classifyBoard !== 'function' || typeof api.drawRanks !== 'function') {
      return { clsOk: false, ranksOk: false, expect: { cls: '', ranks: [] } };
    }
    var clsInfo = api.classifyBoard(board) || {};
    var expectCls = clsInfo.cls || '';
    var dr = api.drawRanks(board) || {};
    var expectRanks = uniq((dr.gut || []).concat(dr.oesd || []));

    var gotCls = normalizeClsText(clsText);
    var clsOk = !!expectCls && gotCls === expectCls;

    var gotRanks = parseRanksText(ranksText);
    var ranksOk = setsEqual(gotRanks, expectRanks);

    return { clsOk: clsOk, ranksOk: ranksOk, expect: { cls: expectCls, ranks: expectRanks } };
  }

  function wizardPfUrl() {
    var base = wizardDep && wizardDep.BASE;
    var url = base ? (base + '&preflop_actions=F-F-F-R2.5-F&history_spot=5') : null;
    return {
      url: url,
      verified: false,
      note: 'Wizard を開いて BTN 2.5 → BB を選ぶ'
    };
  }

  return {
    KEY: KEY,
    ALPHA_MEMO: ALPHA_MEMO,
    CLS_ORDER: CLS_ORDER,
    CLS_LABELS: CLS_LABELS,
    pureAlpha: pureAlpha,
    EQGAP_MEMO: EQGAP_MEMO,
    MEMO_INTERVALS: MEMO_INTERVALS,
    NEW_PER_DAY: NEW_PER_DAY,
    BOARD_PER_DAY: BOARD_PER_DAY,
    FALLBACK_BOARDS: FALLBACK_BOARDS,
    DECKS: DECKS,
    CARDS: CARDS,
    CARD_BY_ID: CARD_BY_ID,

    loadState: loadState,
    saveState: saveState,
    importState: importState,
    exportState: exportState,
    defaultState: defaultState,
    todaySet: todaySet,
    grade: grade,
    gradeBoard: gradeBoard,
    setNote: setNote,
    checkAlpha: checkAlpha,
    eqgapAnswer: eqgapAnswer,
    checkBoard: checkBoard,
    onGap: onGap,
    dueCount: dueCount,
    wizardPfUrl: wizardPfUrl,
    finishDay: finishDay
  };
})(memoCardsDep, memoWizardDep);

if (typeof module !== 'undefined') module.exports = PD.memo;
