// premise-drill: PD.ui.memo（M2）。暗記レーン（Memo）画面。
// 1問1画面。html(ctx) は純粋（document 不使用）。入力は全て自由記述（テキスト／数値）。
// チップ・選択肢は出さない（選ぶのではなく思い出す練習にするため）。
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

  var DECK_LABEL = { alpha: 'α表', pf: 'PF境界', eqgap: 'EQ差', board: 'ボード' };

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

  // ---- 入力部（ask） --------------------------------------------------------

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
    if (kind === 'board') {
      return (
        '<input class="pd-input pd-memo-input" type="text" data-k="cls" ' +
          'value="' + esc(fieldVal(m, 'cls')) + '" placeholder="クラス（例：ドライ）" aria-label="クラス">' +
        '<input class="pd-input pd-memo-input pd-memo-ranks" type="text" data-k="ranks" ' +
          'value="' + esc(fieldVal(m, 'ranks')) + '" placeholder="ランク列（例：KT8、無ければ「無し」）" aria-label="ランク列">'
      );
    }
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
    return out;
  }

  function revealPf(m, cardId) {
    var raw = fieldVal(m, 'value');
    var prior = priorNote(m, cardId);
    var api = memoApi();
    var wiz = (api && typeof api.wizardPfUrl === 'function') ? api.wizardPfUrl() : null;
    var out = '<p class="pd-memo-yourinput">本人の入力：<span>' + (esc(raw) || '（未記入）') + '</span></p>';
    out += '<p class="pd-memo-prevnote pd-small pd-mute">前回のメモ：' + (prior ? esc(prior) : '未確認') + '</p>';
    if (wiz && wiz.url) {
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

  function revealBoard(m, cardId, item) {
    var cls = fieldVal(m, 'cls');
    var ranks = fieldVal(m, 'ranks');
    var board = item && item.boardSpot && item.boardSpot.board;
    var api = memoApi();
    var res = null;
    if (api && typeof api.checkBoard === 'function' && board) {
      try { res = api.checkBoard(board, cls, ranks, cardsApi()); } catch (e) { res = null; }
    }
    var out = (
      '<p class="pd-memo-yourinput">本人の入力：<span>クラス ' + (esc(cls) || '（未記入）') +
        '／ランク ' + (esc(ranks) || '（未記入）') + '</span></p>'
    );
    if (res) {
      out += badgeHtml(!!res.clsOk, 'クラス');
      out += badgeHtml(!!res.ranksOk, 'ランク');
    }
    return out;
  }

  function revealBody(m, item, cardId) {
    var kind = kindOf(item);
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
      '<h2 class="pd-memo-question">' + esc(card.q) + '</h2>'
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
    return (
      '<div class="pd-memo pd-memo-reveal" data-phase="reveal">' +
        progressHtml(m) +
        '<section class="pd-card pd-memo-q" data-kind="' + esc(kindOf(item)) + '">' +
          questionHeadHtml(card) +
          revealBody(m, item, cardId) +
        '</section>' +
      '</div>' +
      '<div class="pd-bar pd-memo-bar">' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-act="ng">× 忘れた</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="ok">○ 覚えてた</button>' +
      '</div>'
    );
  }

  function doneHtml(m) {
    var daily = (m && m.state && m.state.daily) || {};
    var ok = daily.ok || 0;
    var ng = daily.ng || 0;
    var boardOk = daily.boardOk || 0;
    var boardN = daily.boardN || 0;
    return (
      '<div class="pd-memo pd-memo-done" data-phase="done">' +
        '<section class="pd-card pd-memo-summary">' +
          '<h2>今日の暗記はここまでです</h2>' +
          '<ul class="pd-memo-counts pd-mono">' +
            '<li>○ 覚えてた：' + ok + '</li>' +
            '<li>× 忘れた：' + ng + '</li>' +
            '<li>ボード正答：' + boardOk + '/' + boardN + '</li>' +
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
