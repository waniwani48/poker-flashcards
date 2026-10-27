// premise-drill: PD.ui.memo（M2）。暗記レーン（Memo）画面。
// 1問1画面。html(ctx) は純粋（document 不使用）。
// alpha／pf／eqgap は自由記述（選ぶのではなく思い出す練習）。board だけは選択式＋自動判定（2026-10-16 SHO 指示）。
// ctx.memo = { state, items, idx, phase:'ask'|'reveal'|'done', input, result } は app が所有。
// view 遷移で保持、finishDay で破棄。
// render は innerHTML を書き込み、input/change を ctx.memo.input へ退避（再描画で消えない）。
// data-act のクリックは ctx.memoAnswer(input) / ctx.memoGrade(ok) / ctx.memoNext() / ctx.memoFinish() を
// 呼ぶだけ（app 側が実装。無ければ no-op）。Enter（数値・1行入力）で「答えを見る」と同じ動作。
// PD.memo／PD.cards は任意依存（node では require、ブラウザでは読込順で解決済み）。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

if (typeof require === 'function') {
  if (!PD.util) { try { require('../util'); } catch (e) { /* 無くても esc は内蔵で代替 */ } }
  if (!PD.memo) { try { require('../memo'); } catch (e) { /* 無ければ補助照合・Wizard リンクを省く */ } }
  if (!PD.cards) { try { require('../cards'); } catch (e) { /* 無ければ checkBoard への注入を省く */ } }
}

PD.ui.memo = (function () {
  'use strict';

  var DECK_LABEL = { alpha: '必要fold%（α）', anchor: '3バケツ・アンカー', pf: 'PF境界', eqgap: 'EQ差', board: 'ボード' };
  var CLS_ORDER_FALLBACK = ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono', 'trips'];
  var CLS_LABEL_FALLBACK = {
    dry_high: 'ドライ・ハイ', bw_sd: 'ブロードウェイSD', mid: 'ミドル', low: 'ロー',
    paired: 'ペア', mono: 'モノトーン', trips: 'トリップス'
  };
  var RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
  var NONE = '無し';

  // ---- 小道具 --------------------------------------------------------------

  function esc(s) {
    if (PD.util && typeof PD.util.esc === 'function') return PD.util.esc(s);
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) { return (v === null || v === undefined) ? '' : String(v); }

  function trim(v) { return str(v).replace(/^\s+|\s+$/g, ''); }

  function memoApi() { return PD.memo || null; }

  function cardsApi() { return PD.cards || null; }

  function clsOrder() {
    var api = memoApi();
    return (api && Array.isArray(api.CLS_ORDER)) ? api.CLS_ORDER : CLS_ORDER_FALLBACK;
  }

  function clsLabel(key) {
    var api = memoApi();
    var table = (api && api.CLS_LABELS) ? api.CLS_LABELS : CLS_LABEL_FALLBACK;
    return table[key] || key || '';
  }

  function currentItem(m) {
    if (!m || !Array.isArray(m.items)) return null;
    var idx = (typeof m.idx === 'number') ? m.idx : 0;
    return m.items[idx] || null;
  }

  function kindOf(item) {
    return (item && (item.kind || (item.card && item.card.kind))) || '';
  }

  /** ctx.memo.input は常にオブジェクト（{value}／{cls,ranks}／pf は {value, note} も持つ） */
  function fieldVal(m, key) {
    var inp = m && m.input;
    if (!inp || typeof inp !== 'object') return '';
    return str(inp[key]);
  }

  function priorNote(m, cardId) {
    var st = m && m.state;
    var rec = st && st.cards && st.cards[cardId];
    return (rec && typeof rec.note === 'string') ? rec.note : '';
  }

  function noteVal(m, cardId) {
    var inp = m && m.input;
    if (inp && typeof inp === 'object' && typeof inp.note === 'string') return inp.note;
    return priorNote(m, cardId);
  }

  function isEmptyInput(item, m) {
    if (kindOf(item) === 'board') {
      return !trim(fieldVal(m, 'cls')) || !trim(fieldVal(m, 'ranks'));
    }
    return !trim(fieldVal(m, 'value'));
  }

  /** ranks 入力（'KT8'／'無し'／''）→ 選択中ランクの配列 */
  function pickedRanks(ranksText) {
    var t = trim(ranksText);
    if (!t || t === NONE) return [];
    return t.split('').filter(function (ch) { return RANKS.indexOf(ch) >= 0; });
  }

  function joinRanks(arr) {
    return RANKS.filter(function (r) { return arr.indexOf(r) >= 0; }).join('');
  }

  // ---- 入力部（ask） --------------------------------------------------------

  function chipHtml(pick, v, label, on) {
    return (
      '<button type="button" class="pd-chip' + (on ? ' on' : '') + '" data-pick="' + esc(pick) + '" data-v="' + esc(v) + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>'
    );
  }

  function boardInputHtml(m) {
    var cls = trim(fieldVal(m, 'cls'));
    var ranksText = trim(fieldVal(m, 'ranks'));
    var picked = pickedRanks(ranksText);
    return (
      '<p class="pd-memo-sublabel">① ボードの種類</p>' +
      '<div class="pd-memo-chips" role="group" aria-label="ボードの種類">' +
        clsOrder().map(function (k) { return chipHtml('cls', k, clsLabel(k), cls === k); }).join('') +
      '</div>' +
      '<p class="pd-memo-sublabel">② 手札に1枚あればストレートドロー（4枚）が付くランク（複数可）</p>' +
      '<div class="pd-memo-chips pd-memo-ranks" role="group" aria-label="ランク">' +
        RANKS.map(function (r) { return chipHtml('rank', r, r, picked.indexOf(r) >= 0); }).join('') +
        chipHtml('rank', NONE, NONE, ranksText === NONE) +
      '</div>'
    );
  }

  function inputHtml(kind, m) {
    if (kind === 'number') {
      return (
        '<input class="pd-input pd-memo-input" type="number" inputmode="numeric" data-k="value" ' +
          'value="' + esc(fieldVal(m, 'value')) + '" placeholder="%" aria-label="回答（数値）">'
      );
    }
    if (kind === 'lines') {
      return (
        '<textarea class="pd-input pd-memo-input pd-memo-textarea" data-k="value" ' +
          'placeholder="1行に1項目でタイプ" aria-label="回答（複数行）">' + esc(fieldVal(m, 'value')) + '</textarea>'
      );
    }
    if (kind === 'board') return boardInputHtml(m);
    // 'text'（pf）既定
    return (
      '<input class="pd-input pd-memo-input" type="text" data-k="value" ' +
        'value="' + esc(fieldVal(m, 'value')) + '" placeholder="自由記述でタイプ" aria-label="回答">'
    );
  }

  // ---- 補助照合バッジ --------------------------------------------------------

  function badgeHtml(ok, label) {
    var pre = label ? esc(label) + '：' : '補助照合：';
    return (
      '<p class="pd-memo-badge" data-match="' + (ok ? 'ok' : 'ng') + '">' +
        pre + '<span class="pd-mono">' + (ok ? '一致' : '不一致') + '</span>' +
      '</p>'
    );
  }

  // ---- reveal の内容（kind ごと） ---------------------------------------------

  function revealAlpha(m, cardId) {
    var raw = fieldVal(m, 'value');
    var out = '<p class="pd-memo-yourinput">本人の入力：<span class="pd-mono">' + (esc(raw) || '（未記入）') + '%</span></p>';
    var api = memoApi();
    if (api && typeof api.checkAlpha === 'function') {
      var n = Number(raw);
      var ok = (raw !== '' && isFinite(n)) ? !!api.checkAlpha(cardId, n) : false;
      out += badgeHtml(ok);
    }
    var mm = /^alpha_(\d+)$/.exec(str(cardId));
    if (mm && api && api.ALPHA_MEMO && api.ALPHA_MEMO[Number(mm[1])] !== undefined) {
      var expect = api.ALPHA_MEMO[Number(mm[1])];
      var pure = (typeof api.pureAlpha === 'function') ? api.pureAlpha(Number(mm[1])) : null;
      out += '<p class="pd-memo-expect-line">暗記値：<span class="pd-mono">' + esc(expect) + '%</span>' +
        (pure !== null && pure !== undefined ? '<span class="pd-small pd-mute">（純α ' + esc(pure) + '%）</span>' : '') + '</p>';
    }
    return out;
  }

  // ---- pf：レンジ表（PD.range）が埋まっていれば自動判定。無ければ従来どおり本人の ○× ----
  function rangeApi() { return PD.range || null; }

  function filledRange() {
    var R = rangeApi();
    if (!R || typeof R.load !== 'function' || typeof R.isFilled !== 'function') return null;
    try {
      var range = R.load();
      return R.isFilled(range) ? range : null;
    } catch (e) { return null; }
  }

  /** { ok, expect, got } ｜ null（判定しないカード・レンジ未入力） */
  function pfResult(m, cardId) {
    var R = rangeApi();
    var range = filledRange();
    if (!range || typeof R.checkPf !== 'function') return null;
    try { return R.checkPf(range, cardId, fieldVal(m, 'value')); } catch (e) { return null; }
  }

  /** 判定しないカード（3bet 等）の参考一覧 */
  function pfReference(cardId) {
    var R = rangeApi();
    var range = filledRange();
    if (!range || typeof R.pfAnswer !== 'function') return null;
    try {
      var a = R.pfAnswer(range, cardId);
      return (a && Array.isArray(a.expect) && a.expect.length) ? a : null;
    } catch (e) { return null; }
  }

  function pfOk(m, item) {
    var card = (item && item.card) || {};
    var res = pfResult(m, card.id);
    return !!(res && res.ok);
  }

  function revealPf(m, cardId) {
    var raw = fieldVal(m, 'value');
    var prior = priorNote(m, cardId);
    var api = memoApi();
    var wiz = (api && typeof api.wizardPfUrl === 'function') ? api.wizardPfUrl() : null;
    var out = '<p class="pd-memo-yourinput">本人の入力：<span>' + (esc(raw) || '（未記入）') + '</span></p>';
    var res = pfResult(m, cardId);
    if (res) {
      out += '<div class="pd-memo-expect"><p class="pd-small pd-mute">レンジ表の答え：</p>' +
        '<p class="pd-mono pd-memo-expect-hands">' + esc((res.expect || []).join('・') || '—') + '</p></div>';
      out += '<p class="pd-memo-verdict" data-ok="' + (res.ok ? '1' : '0') + '">' + (res.ok ? '○ 正解' : '× 不正解') + '</p>';
    } else {
      var ref = pfReference(cardId);
      if (ref) {
        out += '<div class="pd-memo-expect"><p class="pd-small pd-mute">参考：レンジ表で ' + esc(ref.label || '3bet／混合にしている手') + '（判定は本人）</p>';
        if (Array.isArray(ref.groups) && ref.groups.length) {
          out += '<ul class="pd-memo-list pd-memo-groups">' + ref.groups.map(function (g) {
            return '<li><span class="pd-small pd-mute">' + esc(g.label) + '：</span><span class="pd-mono">' + esc(g.hands.join('・')) + '</span></li>';
          }).join('') + '</ul>';
        } else {
          out += '<p class="pd-mono pd-memo-expect-hands">' + esc(ref.expect.join('・')) + '</p>';
        }
        out += '</div>';
      }
    }
    out += '<p class="pd-memo-prevnote pd-small pd-mute">前回のメモ：' + (prior ? esc(prior) : '未確認') + '</p>';
    if (wiz && wiz.url && !res) {
      out += (
        '<p class="pd-memo-wizard">' +
          '<a class="pd-btn pd-btn-truth" href="' + esc(wiz.url) + '" target="_blank" rel="noopener">Wizard で確認</a>' +
          (wiz.note ? '<span class="pd-small pd-mute">' + esc(wiz.note) + '</span>' : '') +
        '</p>'
      );
    }
    out += (
      '<textarea class="pd-input pd-memo-input pd-memo-note" data-k="note" data-role="note" ' +
        'placeholder="自分の言葉でメモ" aria-label="メモ">' + esc(noteVal(m, cardId)) + '</textarea>'
    );
    return out;
  }

  function revealEqgap(m, cardId) {
    var raw = fieldVal(m, 'value');
    var lines = raw.split('\n').map(trim).filter(function (s) { return !!s; });
    var api = memoApi();
    var expect = (api && typeof api.eqgapAnswer === 'function') ? (api.eqgapAnswer(cardId) || []) : [];
    function list(arr, emptyMsg) {
      if (!arr.length) return '<p class="pd-small pd-mute">' + emptyMsg + '</p>';
      return '<ul class="pd-memo-list">' + arr.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    }
    return (
      '<div class="pd-memo-yourinput"><p class="pd-small pd-mute">本人の入力：</p>' + list(lines, '（未記入）') + '</div>' +
      '<div class="pd-memo-expect"><p class="pd-small pd-mute">暗記値の一覧：</p>' + list(expect, '（取得できません）') + '</div>'
    );
  }

  /** board の照合結果。app が ctx.memo.result に入れていればそれ、無ければここで計算 */
  function boardResult(m, item) {
    if (m && m.result && typeof m.result === 'object' && 'clsOk' in m.result) return m.result;
    var api = memoApi();
    var board = item && item.boardSpot && item.boardSpot.board;
    if (!api || typeof api.checkBoard !== 'function' || !board) return null;
    try { return api.checkBoard(board, fieldVal(m, 'cls'), fieldVal(m, 'ranks'), cardsApi()); } catch (e) { return null; }
  }

  function boardOk(m, item) {
    var res = boardResult(m, item);
    return !!(res && res.clsOk && res.ranksOk);
  }

  /** 正解のドロー表示：'T（OESD）・K・8（ガット）' ／ '無し' */
  function expectRanksLabel(board, expectRanks) {
    var api = cardsApi();
    var dr = null;
    if (api && typeof api.drawRanks === 'function' && board) {
      try { dr = api.drawRanks(board); } catch (e) { dr = null; }
    }
    if (dr && (dr.oesd || dr.gut)) {
      var parts = [];
      if (dr.oesd && dr.oesd.length) parts.push(dr.oesd.join('・') + '（OESD）');
      if (dr.gut && dr.gut.length) parts.push(dr.gut.join('・') + '（ガット）');
      return parts.length ? parts.join('　') : NONE;
    }
    var arr = Array.isArray(expectRanks) ? expectRanks : [];
    return arr.length ? joinRanks(arr).split('').join('・') : NONE;
  }

  function revealBoard(m, cardId, item) {
    var cls = trim(fieldVal(m, 'cls'));
    var ranksText = trim(fieldVal(m, 'ranks'));
    var picked = pickedRanks(ranksText);
    var board = item && item.boardSpot && item.boardSpot.board;
    var res = boardResult(m, item);
    var yourRanks = ranksText === NONE ? NONE : (picked.length ? picked.join('・') : '（未選択）');
    var out = (
      '<p class="pd-memo-yourinput">本人の答え：<span>種類 ' + (cls ? esc(clsLabel(cls)) : '（未選択）') +
        '／ドロー ' + esc(yourRanks) + '</span></p>'
    );
    if (res) {
      var ex = res.expect || {};
      out += (
        '<div class="pd-memo-expect"><p class="pd-small pd-mute">正解：</p>' +
          '<ul class="pd-memo-list">' +
            '<li>種類：' + esc(clsLabel(ex.cls)) + (res.clsOk ? '' : '<span class="pd-memo-miss">（ここが違う）</span>') + '</li>' +
            '<li>ドロー：' + esc(expectRanksLabel(board, ex.ranks)) + (res.ranksOk ? '' : '<span class="pd-memo-miss">（ここが違う）</span>') + '</li>' +
          '</ul>' +
        '</div>'
      );
      var ok = !!(res.clsOk && res.ranksOk);
      out += '<p class="pd-memo-verdict" data-ok="' + (ok ? '1' : '0') + '">' + (ok ? '○ 正解' : '× 不正解') + '</p>';
    }
    return out;
  }

  // ---- anchor：数値列カードは自動判定、手順カード（lines）は手本を出して本人 ○× ----
  function anchorResult(m, cardId) {
    var api = memoApi();
    if (!api || typeof api.checkAnchor !== 'function') return null;
    try { return api.checkAnchor(cardId, fieldVal(m, 'value')); } catch (e) { return null; }
  }

  function anchorOk(m, item) {
    var card = (item && item.card) || {};
    var res = anchorResult(m, card.id);
    return !!(res && res.ok);
  }

  function revealAnchorNums(m, cardId) {
    var raw = fieldVal(m, 'value');
    var res = anchorResult(m, cardId);
    var out = '<p class="pd-memo-yourinput">本人の入力：<span class="pd-mono">' + (esc(raw) || '（未記入）') + '</span></p>';
    if (res) {
      out += '<p class="pd-memo-expect-line">暗記値：<span class="pd-mono">' + esc(res.expect.join('／')) + '</span></p>';
      out += '<p class="pd-memo-verdict" data-ok="' + (res.ok ? '1' : '0') + '">' + (res.ok ? '○ 正解' : '× 不正解') + '</p>';
    }
    return out;
  }

  function revealAnchorSteps(m) {
    var raw = fieldVal(m, 'value');
    var lines = raw.split('\n').map(trim).filter(function (s) { return !!s; });
    var api = memoApi();
    var expect = (api && typeof api.anchorSteps === 'function') ? (api.anchorSteps() || []) : [];
    function list(arr, emptyMsg) {
      if (!arr.length) return '<p class="pd-small pd-mute">' + emptyMsg + '</p>';
      return '<ul class="pd-memo-list">' + arr.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    }
    return (
      '<div class="pd-memo-yourinput"><p class="pd-small pd-mute">本人の入力：</p>' + list(lines, '（未記入）') + '</div>' +
      '<div class="pd-memo-expect"><p class="pd-small pd-mute">手本：</p>' + list(expect, '（取得できません）') + '</div>'
    );
  }

  function deckOf(item) {
    return (item && item.card && item.card.deck) || '';
  }

  function revealBody(m, item, cardId) {
    var kind = kindOf(item);
    if (deckOf(item) === 'anchor') return kind === 'lines' ? revealAnchorSteps(m) : revealAnchorNums(m, cardId);
    if (kind === 'number') return revealAlpha(m, cardId);
    if (kind === 'lines') return revealEqgap(m, cardId);
    if (kind === 'board') return revealBoard(m, cardId, item);
    return revealPf(m, cardId);
  }

  // ---- 画面全体 --------------------------------------------------------------

  function progressHtml(m) {
    var total = (m && Array.isArray(m.items)) ? m.items.length : 0;
    var idx = (m && typeof m.idx === 'number') ? m.idx : 0;
    return '<p class="pd-memo-progress pd-small pd-mono pd-mute">' + (idx + 1) + '/' + total + '</p>';
  }

  function questionHeadHtml(card) {
    return (
      '<p class="pd-memo-deck pd-small pd-mute">' + esc(DECK_LABEL[card.deck] || card.deck || '') + '</p>' +
      '<h2 class="pd-memo-question">' + esc(card.q) + '</h2>' +
      (card.hint ? '<p class="pd-memo-hint pd-small">' + esc(card.hint) + '</p>' : '')
    );
  }

  function askHtml(m, item) {
    var card = (item && item.card) || {};
    var kind = kindOf(item);
    var disabled = isEmptyInput(item, m);
    return (
      '<div class="pd-memo pd-memo-ask" data-phase="ask">' +
        progressHtml(m) +
        '<section class="pd-card pd-memo-q" data-kind="' + esc(kind) + '">' +
          questionHeadHtml(card) +
          inputHtml(kind, m) +
        '</section>' +
      '</div>' +
      '<div class="pd-bar pd-memo-bar">' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="reveal"' + (disabled ? ' disabled' : '') + '>答えを見る</button>' +
      '</div>'
    );
  }

  function revealHtml(m, item) {
    var card = (item && item.card) || {};
    var cardId = card.id;
    var kind = kindOf(item);
    var auto = kind === 'board' ||
      (deckOf(item) === 'anchor' && kind !== 'lines') ||
      (deckOf(item) === 'pf' && kind === 'text' && !!pfResult(m, cardId));
    var bar = auto
      ? '<button type="button" class="pd-btn pd-btn-primary" data-act="auto">次へ</button>'
      : '<button type="button" class="pd-btn pd-btn-ghost" data-act="ng">× 忘れた</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="ok">○ 覚えてた</button>';
    return (
      '<div class="pd-memo pd-memo-reveal" data-phase="reveal">' +
        progressHtml(m) +
        '<section class="pd-card pd-memo-q" data-kind="' + esc(kind) + '">' +
          questionHeadHtml(card) +
          revealBody(m, item, cardId) +
        '</section>' +
      '</div>' +
      '<div class="pd-bar pd-memo-bar">' + bar + '</div>'
    );
  }

  function doneHtml(m) {
    var daily = (m && m.state && m.state.daily) || {};
    var ok = daily.ok || 0;
    var ng = daily.ng || 0;
    var boardOkN = daily.boardOk || 0;
    var boardN = daily.boardN || 0;
    return (
      '<div class="pd-memo pd-memo-done" data-phase="done">' +
        '<section class="pd-card pd-memo-summary">' +
          '<h2>今日の暗記はここまでです</h2>' +
          '<ul class="pd-memo-counts pd-mono">' +
            '<li>○ 覚えてた：' + ok + '</li>' +
            '<li>× 忘れた：' + ng + '</li>' +
            '<li>ボード正答：' + boardOkN + '/' + boardN + '</li>' +
          '</ul>' +
        '</section>' +
      '</div>' +
      '<div class="pd-bar pd-memo-bar">' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホーム</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="to-drill">ドリルへ</button>' +
      '</div>'
    );
  }

  function emptyHtml() {
    return (
      '<div class="pd-memo pd-memo-empty" data-phase="empty">' +
        '<section class="pd-card"><p>今日の暗記はありません。</p></section>' +
      '</div>' +
      '<div class="pd-bar pd-memo-bar">' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホーム</button>' +
      '</div>'
    );
  }

  /** PD.ui.memo.html(ctx) -> string（純粋。document を使わない） */
  function html(ctx) {
    var m = ctx && ctx.memo;
    if (!m || !Array.isArray(m.items) || !m.items.length) return emptyHtml();
    var idx = (typeof m.idx === 'number') ? m.idx : 0;
    if (m.phase === 'done' || idx >= m.items.length) return doneHtml(m);
    var item = currentItem(m);
    if (!item) return doneHtml(m);
    if (m.phase === 'reveal') return revealHtml(m, item);
    return askHtml(m, item);
  }

  // ---- render（DOM 結線） ------------------------------------------------------

  function setInputField(ctx, k, value) {
    if (!k || !ctx || !ctx.memo) return;
    if (!ctx.memo.input || typeof ctx.memo.input !== 'object') ctx.memo.input = {};
    ctx.memo.input[k] = value;
  }

  function onFieldEvent(ev, ctx, el) {
    var t = ev && ev.target;
    if (!t || typeof t.getAttribute !== 'function') return;
    if (!t.className || String(t.className).indexOf('pd-memo-input') < 0) return;
    setInputField(ctx, t.getAttribute('data-k'), t.value);
    refreshReveal(el, ctx);
  }

  /** 入力のたびに「答えを見る」の有効/無効だけを更新する（再描画しない＝入力中のフォーカスを保つ） */
  function refreshReveal(el, ctx) {
    if (!el || typeof el.querySelector !== 'function' || !ctx || !ctx.memo) return;
    var btn = el.querySelector('[data-act="reveal"]');
    if (!btn) return;
    var m = ctx.memo;
    var item = (Array.isArray(m.items) && m.items[m.idx]) ? m.items[m.idx] : null;
    if (!item) return;
    btn.disabled = isEmptyInput(item, m);
  }

  function setChip(btn, on) {
    if (!btn) return;
    if (btn.classList) btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** board の選択チップ：DOM を直接更新して再描画しない（listener の二重登録を避ける） */
  function onPick(ctx, el, btn) {
    var m = ctx && ctx.memo;
    if (!m || !btn) return;
    var pick = btn.getAttribute('data-pick');
    var v = btn.getAttribute('data-v');
    var all = el.querySelectorAll('[data-pick="' + pick + '"]');
    var i;
    if (pick === 'cls') {
      setInputField(ctx, 'cls', v);
      for (i = 0; i < all.length; i++) setChip(all[i], all[i].getAttribute('data-v') === v);
    } else if (pick === 'rank') {
      var cur = trim(fieldVal(m, 'ranks'));
      var next;
      if (v === NONE) {
        next = cur === NONE ? '' : NONE;
      } else {
        var set = pickedRanks(cur);
        var at = set.indexOf(v);
        if (at >= 0) set.splice(at, 1); else set.push(v);
        next = joinRanks(set);
      }
      setInputField(ctx, 'ranks', next);
      for (i = 0; i < all.length; i++) {
        var bv = all[i].getAttribute('data-v');
        setChip(all[i], bv === NONE ? next === NONE : (next !== NONE && next.indexOf(bv) >= 0));
      }
    }
    refreshReveal(el, ctx);
  }

  function callIf(fn, args) {
    if (typeof fn === 'function') fn.apply(null, args || []);
  }

  function onAct(ctx, act) {
    var m = ctx && ctx.memo;
    if (!m) return;
    if (act === 'reveal') {
      callIf(ctx.memoAnswer, [m.input]);
    } else if (act === 'ok' || act === 'ng') {
      callIf(ctx.memoGrade, [act === 'ok']);
      callIf(ctx.memoNext, []);
    } else if (act === 'auto') {
      var cur = currentItem(m);
      var ok2 = kindOf(cur) === 'board' ? boardOk(m, cur) : (deckOf(cur) === 'anchor' ? anchorOk(m, cur) : pfOk(m, cur));
      callIf(ctx.memoGrade, [ok2]);
      callIf(ctx.memoNext, []);
    } else if (act === 'to-drill') {
      callIf(ctx.memoFinish, []);
      callIf(ctx.next, []);   // 完了→そのまま今日の出題へ
    }
  }

  function bind(el, ctx) {
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('input', function (ev) { onFieldEvent(ev, ctx, el); });
    el.addEventListener('change', function (ev) { onFieldEvent(ev, ctx, el); });
    el.addEventListener('keydown', function (ev) {
      if (!ev || ev.key !== 'Enter') return;
      var t = ev.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (typeof el.contains === 'function' && !el.contains(t)) return;
      var btn = (typeof el.querySelector === 'function') ? el.querySelector('[data-act="reveal"]') : null;
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      onAct(ctx, 'reveal');
    });
    el.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var p = t.closest('[data-pick]');
      if (p && (typeof el.contains !== 'function' || el.contains(p))) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        onPick(ctx, el, p);
        return;
      }
      var a = t.closest('[data-act]');
      if (!a || (typeof el.contains === 'function' && !el.contains(a))) return;
      if (a.disabled || a.getAttribute('aria-disabled') === 'true') return;
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      onAct(ctx, a.getAttribute('data-act'));
    });
  }

  /** PD.ui.memo.render(root, ctx) -> void */
  function render(rootEl, ctx) {
    if (!rootEl) return;
    ctx = ctx || {};
    rootEl.innerHTML = html(ctx);
    bind(rootEl, ctx);
  }

  return {
    render: render,
    html: html
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.memo;
