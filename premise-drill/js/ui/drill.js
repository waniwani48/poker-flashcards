// premise-drill: PD.ui.drill（T9）。Drill 画面（訓練本体）。
// スポットカード（ノード文・ボード3枚・CB サイズ・Hero・pot/bet。クラスラベル・族名・スート構成は出さない）
// ＋前提票の縦ステッパー（開いている欄は常に1つ。PD.sheet.openIndex で locked/open/passed）
// ＋キーパッド（13ランク＋s/o＋削除）＋ヒント2段（slow のみ）＋下部固定バー（進捗ドット・確信度・コミット）。
// 状態は ctx 経由のみ（入力は input/change で ctx.sheet に即時退避、充足時刻は ctx.sheet._ts、ヒント使用は ctx.hints）。
// 他の PD.ui.* は参照しない。innerHTML の再描画は render 時のみで、欄の開閉は data-state の付け替えで行う
// （入力中の欄が充足した瞬間にフォーカスを失わないため）。リスト・キーパッドは自分の小さな容器だけを書き換える。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

// node（テスト）では依存を require で解決。ブラウザでは読込順で解決済み
if (typeof require === 'function') {
  if (!PD.util) { try { require('../util'); } catch (e) { /* 無くても esc は内蔵で代替 */ } }
  if (!PD.sheet) { try { require('../sheet'); } catch (e) { /* 無ければ render 時に案内を出す */ } }
}

PD.ui.drill = (function () {
  'use strict';

  var RANKS = 'AKQJT98765432';
  var SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  var SUIT_NAME = { s: 'スペード', h: 'ハート', d: 'ダイヤ', c: 'クラブ' };
  var TEMPO_LABEL = { slow: 'slow：時間無制限・ヒント可', normal: 'normal：ヒント無し', speed: 'speed：60秒' };
  var POS_LABEL = { in: 'fold 組の中', edge: '境界', above: 'fold 組の上' };
  var ACTION_LABEL = { call: 'call', fold: 'fold' };
  var ENOUGH_LABEL = { yes: '足りる', no: '足りない' };
  var HERO_CHECKS = [
    { k: 'bdfd', label: 'BDFD' },
    { k: 'bdsd', label: 'BDSD' },
    { k: 'gut', label: 'ガット' },
    { k: 'oesd', label: 'オープンエンド' }
  ];
  var BASELINE_SRC = ['暗記表', 'Stage', '自力計算'];
  var MIN_TABLE_ROWS = 3;
  var LOCKED_MSG = '前の欄を埋めると開きます';

  // ---- 小道具 ------------------------------------------------------------

  function esc(s) {
    if (PD.util && typeof PD.util.esc === 'function') return PD.util.esc(s);
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function S() { return PD.sheet || null; }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function numOf(raw) {
    if (raw === null || raw === undefined) return null;
    var t = String(raw).trim();
    if (!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function attrNum(v) { return isNum(v) ? String(v) : ''; }

  function isBase(fid) { return /^f[1-5]$/.test(String(fid)); }

  function validHand(s) {
    var api = S();
    return !!(api && typeof api.validHandName === 'function' && api.validHandName(s));
  }

  function cap(ctx) {
    var api = S();
    if (api && typeof api.confidenceCap === 'function') return api.confidenceCap(ctx && ctx.hints);
    return 100;
  }

  function hintUsed(ctx, fid, tier) {
    var hs = (ctx && Array.isArray(ctx.hints)) ? ctx.hints : [];
    for (var i = 0; i < hs.length; i++) {
      if (hs[i] && hs[i].field === fid && Number(hs[i].tier) === tier) return true;
    }
    return false;
  }

  function elapsed(ctx) {
    var now = Date.now();
    if (typeof ctx.startedAt !== 'number') ctx.startedAt = now;
    return Math.max(0, now - ctx.startedAt);
  }

  // ---- 値の置き場（ctx.sheet） -------------------------------------------

  function defaultExtra(fid) {
    switch (fid) {
      case 'pf_removed': return [];
      case 'baseline_src': return { src: '', value: null };
      case 'rule_cond': return { rule: '', cond: null };
      case 'rank_table': return [];
      case 'anti_mid': return { yn: null, reason: '' };
      default: return {};
    }
  }

  /** f1..f5 は sheet[fid]、追加欄は sheet.extra[fid]。create で既定を作る */
  function bagOf(sheet, fid, create) {
    if (isBase(fid)) {
      if (!sheet[fid]) sheet[fid] = {};
      return sheet[fid];
    }
    sheet.extra = sheet.extra || {};
    if (sheet.extra[fid] === undefined && create) sheet.extra[fid] = defaultExtra(fid);
    return sheet.extra[fid];
  }

  /** 'f4.foldList' / 'extra.pf_removed' → 配列参照（create で作る） */
  function listRef(sheet, path, create) {
    var parts = String(path || '').split('.');
    var holder, key;
    if (parts[0] === 'extra') {
      sheet.extra = sheet.extra || {};
      holder = sheet.extra; key = parts[1];
    } else {
      sheet[parts[0]] = sheet[parts[0]] || {};
      holder = sheet[parts[0]]; key = parts[1];
    }
    if (!Array.isArray(holder[key])) {
      if (!create) return [];
      holder[key] = [];
    }
    return holder[key];
  }

  function tableRows(sheet) {
    var rows = bagOf(sheet, 'rank_table', true);
    if (!Array.isArray(rows)) { rows = sheet.extra.rank_table = []; }
    while (rows.length < MIN_TABLE_ROWS) rows.push({ hand: '', beats: '', bd: '' });
    return rows;
  }

  function ensureSheet(ctx) {
    var api = S();
    if (!ctx.sheet) ctx.sheet = (api && typeof api.emptyValues === 'function') ? api.emptyValues() : {};
    var sh = ctx.sheet;
    ['f1', 'f2', 'f3', 'f4', 'f5'].forEach(function (k) { if (!sh[k]) sh[k] = {}; });
    if (!sh.extra) sh.extra = {};
    if (!sh._ts) sh._ts = {};
    if (!Array.isArray(ctx.hints)) ctx.hints = [];
    return sh;
  }

  function ensureFields(ctx) {
    var api = S();
    if (!Array.isArray(ctx.fields) || !ctx.fields.length) {
      ctx.fields = (api && typeof api.buildSheet === 'function') ? api.buildSheet([], ctx.tempo || 'slow') : [];
    }
    return ctx.fields;
  }

  // ---- 純粋な判定（テスト可） --------------------------------------------

  /** 各欄の data-state を返す（開いている欄は常に1つ） */
  function statesOf(fields, sheet, spot) {
    var api = S();
    var open = (api && typeof api.openIndex === 'function') ? api.openIndex(fields, sheet, spot) : 0;
    return fields.map(function (f, i) {
      return i < open ? 'passed' : (i === open ? 'open' : 'locked');
    });
  }

  function filledOf(field, sheet, spot) {
    var api = S();
    if (!api || typeof api.isFilled !== 'function') return { ok: false, msg: '' };
    return api.isFilled(field, sheet, spot);
  }

  /** 折りたたみ時の1行要約（PD.sheet.toText を1欄分だけ使う） */
  function summaryOf(field, sheet) {
    var api = S();
    if (!api || typeof api.toText !== 'function') return '';
    try { return api.toText(sheet, [field]) || ''; } catch (e) { return ''; }
  }

  /** 未充足欄名の常時表示用テキスト */
  function missingText(fields, sheet, spot) {
    var api = S();
    if (!api || typeof api.canCommit !== 'function') return { ok: false, text: '' };
    var cc = api.canCommit(fields, sheet, spot);
    return { ok: cc.ok, text: cc.ok ? 'すべて充足。コミットできます' : '未充足：' + cc.missing.join('／') };
  }

  /**
   * キーパッドの1打。buf は組み立て中の文字列。
   * ランク2つ同じ→即ペア追加、異なる→s/o 待ち。'add' は validHandName で検証（'A' 単独は弾く）。
   * 'del' は buf を1文字削る。buf が空なら removeLast（リスト末尾の削除）を返す。
   */
  function keypadPress(buf, key) {
    var b = String(buf || '');
    var out = { buf: b, add: null, removeLast: false, err: '' };
    if (key === 'del') {
      if (b.length) out.buf = b.slice(0, -1);
      else out.removeLast = true;
      return out;
    }
    if (key === 'add') {
      if (validHand(b)) { out.add = b; out.buf = ''; }
      else out.err = b ? '「' + b + '」は不完全。A4s／AKo／55 の形式で' : 'ランクを押してから追加';
      return out;
    }
    if (key === 's' || key === 'o') {
      if (b.length === 2 && b[0] !== b[1]) { out.add = b + key; out.buf = ''; }
      else if (b.length === 2) { out.err = '同ランクは s／o 無し'; }
      else out.err = 'ランクを2つ先に';
      return out;
    }
    if (RANKS.indexOf(key) >= 0 && key.length === 1) {
      if (b.length === 0) out.buf = key;
      else if (b.length === 1) {
        if (b === key) { out.add = b + key; out.buf = ''; }
        else out.buf = b + key;
      } else out.err = '先に s／o を選ぶ';
      return out;
    }
    out.err = '不明なキー';
    return out;
  }

  // ---- スポットカード ----------------------------------------------------

  function cardTokens(str) {
    var out = [];
    var s = String(str || '');
    for (var i = 0; i + 1 < s.length; i += 2) out.push({ r: s.charAt(i), s: s.charAt(i + 1) });
    return out;
  }

  function cardFace(c) {
    var sym = SUIT_SYM[c.s] || '';
    return '<span class="pd-drill-cardface" data-suit="' + esc(c.s) + '" aria-label="' + esc(c.r + (SUIT_NAME[c.s] || c.s)) + '">' +
      '<span class="pd-drill-rank pd-mono">' + esc(c.r) + '</span>' +
      '<span class="pd-drill-suit" aria-hidden="true">' + esc(sym) + '</span>' +
    '</span>';
  }

  function cardsHtml(str) {
    return '<span class="pd-drill-cards">' + cardTokens(str).map(cardFace).join('') + '</span>';
  }

  function nodeText(spot) {
    var pos = spot.villainPos || 'BTN';
    var m = /R([0-9.]+)/.exec(String(spot.pre || ''));
    var open = m ? m[1] + 'bb' : '';
    var size = isNum(spot.size) ? spot.size + '%' : '';
    return pos + ' オープン' + (open ? ' ' + open : '') + ' → BB コール → フロップ：BB チェック → ' + pos + ' CB' + (size ? ' ' + size : '');
  }

  /** クラスラベル・族名・スート構成・Hero プール名は出さない（f3 の答えが先に見えるのを防ぐ） */
  function spotCardHtml(spot, ctx) {
    if (!spot) return '';
    var tempo = (ctx && ctx.tempo) || 'slow';
    var bet = isNum(spot.bet) ? spot.bet + 'bb' : '—';
    var pot = isNum(spot.pot) ? spot.pot + 'bb' : '—';
    var size = isNum(spot.size) ? '（' + spot.size + '%）' : '';
    return (
      '<section class="pd-card pd-drill-spotcard" aria-label="スポット">' +
        '<p class="pd-drill-eyebrow pd-mono">スポット<span class="pd-drill-eyebrow-sep">／</span>' + esc(TEMPO_LABEL[tempo] || tempo) + '</p>' +
        '<p class="pd-drill-node">' + esc(nodeText(spot)) + '</p>' +
        '<div class="pd-drill-boardrow">' +
          '<span class="pd-drill-rowlabel pd-small pd-mute">ボード</span>' +
          cardsHtml(spot.board) +
        '</div>' +
        '<div class="pd-drill-boardrow">' +
          '<span class="pd-drill-rowlabel pd-small pd-mute">Hero（BB）</span>' +
          cardsHtml(spot.hero) +
        '</div>' +
        '<p class="pd-drill-pot pd-mono">ポット ' + esc(pot) + '<span class="pd-drill-eyebrow-sep">／</span>ベット ' + esc(bet) + esc(size) + '</p>' +
      '</section>'
    );
  }

  // ---- 入力部品 ----------------------------------------------------------

  function numInput(fid, k, val, o) {
    o = o || {};
    var id = 'pd-drill-' + fid + '-' + k + (o.i !== undefined ? '-' + o.i : '');
    return (
      '<label class="pd-drill-num" for="' + id + '">' +
        '<span class="pd-drill-numlabel pd-small">' + esc(o.label || '') + '</span>' +
        '<span class="pd-drill-numwrap">' +
          '<input class="pd-input" type="number" inputmode="decimal" id="' + id + '"' +
            ' data-f="' + esc(fid) + '" data-k="' + esc(k) + '"' + (o.i !== undefined ? ' data-i="' + o.i + '"' : '') +
            ' min="' + (o.min !== undefined ? o.min : 0) + '" max="' + (o.max !== undefined ? o.max : 100) + '" step="' + (o.step || 'any') + '"' +
            ' value="' + esc(attrNum(val)) + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' +
          (o.unit ? '<span class="pd-drill-unit pd-mute">' + esc(o.unit) + '</span>' : '') +
        '</span>' +
      '</label>'
    );
  }

  function textInput(fid, k, val, o) {
    o = o || {};
    var id = 'pd-drill-' + fid + '-' + k + (o.i !== undefined ? '-' + o.i : '');
    return (
      '<label class="pd-drill-num" for="' + id + '">' +
        (o.label ? '<span class="pd-drill-numlabel pd-small">' + esc(o.label) + '</span>' : '') +
        '<input class="pd-input" type="text" id="' + id + '" autocomplete="off"' +
          ' data-f="' + esc(fid) + '" data-k="' + esc(k) + '"' + (o.i !== undefined ? ' data-i="' + o.i + '"' : '') +
          ' value="' + esc(val || '') + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' +
      '</label>'
    );
  }

  function checkInput(fid, k, val, label) {
    var id = 'pd-drill-' + fid + '-' + k;
    return (
      '<label class="pd-drill-check" for="' + id + '">' +
        '<input type="checkbox" id="' + id + '" data-f="' + esc(fid) + '" data-k="' + esc(k) + '"' + (val === true ? ' checked' : '') + '>' +
        '<span>' + esc(label) + '</span>' +
      '</label>'
    );
  }

  /** 単一選択のチップ群。data-act="set" で値を書き、aria-pressed を付け替える */
  function chipGroup(fid, k, current, options, o) {
    o = o || {};
    var html = '<div class="pd-drill-group" role="group" data-group="' + esc(fid + '.' + k) + '"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>';
    if (o.label) html += '<span class="pd-drill-numlabel pd-small">' + esc(o.label) + '</span>';
    html += '<span class="pd-drill-chips">';
    options.forEach(function (op) {
      var on = String(current) === String(op.v) && current !== null && current !== undefined;
      html += '<button type="button" class="pd-chip" data-act="set" data-f="' + esc(fid) + '" data-k="' + esc(k) + '" data-v="' + esc(op.v) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(op.label) + '</button>';
    });
    html += '</span></div>';
    return html;
  }

  function rankChips(selected, noDraw) {
    var sel = Array.isArray(selected) ? selected : [];
    var html = '<span class="pd-drill-chips pd-drill-ranks" data-nodraw="' + (noDraw ? '1' : '0') + '">';
    for (var i = 0; i < RANKS.length; i++) {
      var r = RANKS.charAt(i);
      var on = sel.indexOf(r) >= 0;
      html += '<button type="button" class="pd-chip pd-mono" data-act="rank" data-r="' + r + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + r + '</button>';
    }
    return html + '</span>';
  }

  function listItemsHtml(list, reorder) {
    var arr = Array.isArray(list) ? list : [];
    if (!arr.length) return '<span class="pd-drill-empty pd-small pd-mute">まだありません</span>';
    return arr.map(function (h, i) {
      return (
        '<span class="pd-drill-item">' +
          (reorder ? '<span class="pd-drill-itemno pd-small pd-mute">' + (i + 1) + '</span>' : '') +
          '<span class="pd-drill-itemname pd-mono">' + esc(h) + '</span>' +
          (reorder ? '<button type="button" class="pd-drill-itembtn" data-act="mv" data-i="' + i + '" data-d="-1" aria-label="' + esc(h) + ' を前へ"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
                     '<button type="button" class="pd-drill-itembtn" data-act="mv" data-i="' + i + '" data-d="1" aria-label="' + esc(h) + ' を後ろへ"' + (i === arr.length - 1 ? ' disabled' : '') + '>▶</button>' : '') +
          '<button type="button" class="pd-drill-itembtn" data-act="rm" data-i="' + i + '" aria-label="' + esc(h) + ' を削除">×</button>' +
        '</span>'
      );
    }).join('');
  }

  function keypadHtml() {
    var html = '<div class="pd-keypad pd-drill-keypad" aria-label="ハンド名キーパッド">';
    for (var i = 0; i < RANKS.length; i++) {
      var r = RANKS.charAt(i);
      html += '<button type="button" data-act="key" data-key="' + r + '">' + r + '</button>';
    }
    html += '<button type="button" class="pd-drill-key-del" data-act="key" data-key="del" aria-label="削除">削除</button>';
    html += '<button type="button" class="pd-drill-key-s" data-act="key" data-key="s">s</button>';
    html += '<button type="button" class="pd-drill-key-o" data-act="key" data-key="o">o</button>';
    html += '<button type="button" class="pd-drill-key-add" data-act="key" data-key="add">追加</button>';
    return html + '</div>';
  }

  /** リスト＋キーパッド。path は 'f4.foldList' / 'extra.pf_removed' */
  function listBlock(path, list, o) {
    o = o || {};
    return (
      '<div class="pd-drill-listwrap" data-list="' + esc(path) + '"' + (o.max ? ' data-max="' + o.max + '"' : '') + (o.reorder ? ' data-reorder="1"' : '') + (o.hidden ? ' hidden' : '') + '>' +
        (o.label ? '<p class="pd-drill-numlabel pd-small">' + esc(o.label) + '</p>' : '') +
        '<div class="pd-drill-list" aria-live="polite">' + listItemsHtml(list, !!o.reorder) + '</div>' +
        '<div class="pd-drill-kp" data-buf="">' +
          '<div class="pd-drill-kp-head">' +
            '<span class="pd-drill-kp-buf pd-mono" aria-label="入力中">&nbsp;</span>' +
            '<span class="pd-drill-kp-msg pd-small" aria-live="polite"></span>' +
          '</div>' +
          keypadHtml() +
        '</div>' +
      '</div>'
    );
  }

  // ---- 欄本体 ------------------------------------------------------------

  function f1Body(field, sheet) {
    var v = sheet.f1 || {};
    if (field.compact) {
      var api = S();
      var chips = (api && api.SPEED_OPTIONS && api.SPEED_OPTIONS.foldChips) || [20, 25, 30, 35, 40, 45, 50];
      return chipGroup('f1', 'foldPct', v.foldPct, chips.map(function (n) { return { v: n, label: n + '%' }; }), { label: '必要 fold%' });
    }
    return numInput('f1', 'foldPct', v.foldPct, { label: 'このサイズに対して自レンジの何%が降りる必要があるか', unit: '%' });
  }

  function f2Body(field, sheet) {
    var v = sheet.f2 || {};
    var step = field.compact ? 5 : 'any';
    var stepBtn = function (k, d) {
      return '<button type="button" class="pd-drill-stepbtn" data-act="step" data-f="f2" data-k="' + k + '" data-d="' + d + '" aria-label="' + (d > 0 ? '＋' : '−') + Math.abs(d) + '">' + (d > 0 ? '＋' : '−') + '</button>';
    };
    var cell = function (k, label) {
      return '<div class="pd-drill-bucket">' +
        numInput('f2', k, v[k], { label: label, unit: '%', step: step }) +
        (field.compact ? '<span class="pd-drill-stepbtns">' + stepBtn(k, -5) + stepBtn(k, 5) + '</span>' : '') +
      '</div>';
    };
    return (
      '<div class="pd-drill-num3">' +
        cell('trash', 'trash（Qハイ以下）') +
        cell('hi', 'ハイカード（A・Kハイ、未ヒット）') +
        cell('pairPlus', 'ペア以上') +
      '</div>' +
      '<p class="pd-drill-total pd-mono pd-small"></p>' +
      (field.note ? '<p class="pd-drill-note pd-small pd-mute">' + esc(field.note) + '</p>' : '')
    );
  }

  function f3Body(field, sheet) {
    var v = sheet.f3 || {};
    var noDraw = v.noDraw === true;
    return (
      '<p class="pd-drill-numlabel pd-small">(a) 手札に1枚あれば、ボード3枚と合わせて4枚のストレートドロー（OESD／ガット）になるランク（複数可。完成カードではない）</p>' +
      rankChips(v.drawRanks, noDraw) +
      checkInput('f3', 'noDraw', noDraw, 'ドロー無しと宣言する') +
      numInput('f3', 'shiftPct', v.shiftPct, { label: '(b) 守る側に移る量（レンジ全体に対する%。ドロー無しなら 0）', unit: '%' }) +
      listBlock('f3.examples', v.examples, { label: field.compact ? '(c) 移る手の例（任意）' : '(c) 移る手の例（最低2つ。ドロー無しなら 0 可）' })
    );
  }

  function f4Body(field, sheet) {
    var v = sheet.f4 || {};
    var f1 = sheet.f1 || {};
    var ref = isNum(f1.foldPct) ? '（①：' + f1.foldPct + '%）' : '';
    var html = numInput('f4', 'pureAirPct', v.pureAirPct, { label: '(1) 純air%（レンジ全体に対する%。②trash − ③移る量 と ±5 以内）', unit: '%' });
    if (field.compact) {
      var api = S();
      var max = (api && api.SPEED_OPTIONS && api.SPEED_OPTIONS.maxFoldList) || 3;
      html += listBlock('f4.foldList', v.foldList, { label: '(2) fold 組を弱い順に（最大' + max + 'つ）', reorder: true, max: max });
      return html;
    }
    html += chipGroup('f4', 'enough', v.enough, [{ v: 'yes', label: '足りる' }, { v: 'no', label: '足りない' }], { label: '(2) 純air だけで必要 fold%' + ref + ' に足りる？' });
    html += listBlock('f4.foldList', v.foldList, { label: '(3) fold 組を弱い順に名指し（最低3つ。◀▶で並べ替え）', reorder: true });
    html += listBlock('f4.nextLayer', v.nextLayer, { label: '(4) 足りないなら、次の層から捻出する手（最低1つ）', hidden: v.enough !== 'no' });
    return html;
  }

  function f5Body(field, sheet, ctx) {
    var v = sheet.f5 || {};
    var html = '';
    if (!field.compact) {
      html += '<p class="pd-drill-numlabel pd-small">2枚で見るチェック（当てはまるものを付ける）</p><div class="pd-drill-checks">';
      HERO_CHECKS.forEach(function (c) { html += checkInput('f5', c.k, v[c.k] === true, c.label); });
      html += '</div>';
      html += textInput('f5', 'kickerNote', v.kickerNote, { label: 'キッカーメモ', placeholder: 'キッカーについて一言' });
    }
    html += chipGroup('f5', 'position', v.position, [
      { v: 'in', label: POS_LABEL.in }, { v: 'edge', label: POS_LABEL.edge }, { v: 'above', label: POS_LABEL.above }
    ], { label: '自分のハンドは fold 組のどこ？' });
    html += chipGroup('f5', 'action', v.action, [
      { v: 'call', label: ACTION_LABEL.call }, { v: 'fold', label: ACTION_LABEL.fold }
    ], { label: '判定' });
    if (!field.compact) {
      var c = cap(ctx);
      html += numInput('f5', 'confidence', v.confidence, { label: '確信度', unit: '%', max: c });
      html += '<p class="pd-drill-capnote pd-small pd-mute">' + capNote(c) + '</p>';
    }
    return html;
  }

  function capNote(c) {
    return c < 100 ? 'ヒントを使ったので上限 ' + c + '%' : '上限 100%（ヒントを使うと 70%）';
  }

  function extraBody(field, sheet) {
    var ex;
    switch (field.id) {
      case 'pf_removed':
        ex = bagOf(sheet, 'pf_removed', true);
        return listBlock('extra.pf_removed', ex, { label: '抜けた手（最低2つ）' });
      case 'baseline_src':
        ex = bagOf(sheet, 'baseline_src', true);
        return (
          '<label class="pd-drill-num" for="pd-drill-baseline_src-src">' +
            '<span class="pd-drill-numlabel pd-small">出典</span>' +
            '<select class="pd-input" id="pd-drill-baseline_src-src" data-f="baseline_src" data-k="src">' +
              '<option value=""' + (!ex.src ? ' selected' : '') + '>選ぶ</option>' +
              BASELINE_SRC.map(function (s) { return '<option value="' + esc(s) + '"' + (ex.src === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
            '</select>' +
          '</label>' +
          numInput('baseline_src', 'value', ex.value, { label: '暗記値（このサイズの必要 fold%）', unit: '%' })
        );
      case 'rule_cond':
        ex = bagOf(sheet, 'rule_cond', true);
        return (
          textInput('rule_cond', 'rule', ex.rule, { label: '引用した則（条件→則）を1行', placeholder: '条件 → 則' }) +
          chipGroup('rule_cond', 'cond', ex.cond, [{ v: 'Y', label: '条件成立 Y' }, { v: 'N', label: '条件不成立 N' }], { label: 'このスポットで条件は成立している？' })
        );
      case 'rank_table':
        return '<div class="pd-drill-table">' + tableRowsHtml(tableRows(sheet)) + '</div>' +
          '<button type="button" class="pd-btn pd-btn-ghost pd-drill-addrow" data-act="addrow">行を足す</button>';
      case 'anti_mid':
        ex = bagOf(sheet, 'anti_mid', true);
        return (
          chipGroup('anti_mid', 'yn', ex.yn, [{ v: 'Y', label: '先に書いた Y' }, { v: 'N', label: '書いていない N' }], { label: '極端側（pure fold／pure call）を先に書いたか' }) +
          textInput('anti_mid', 'reason', ex.reason, { label: '理由', placeholder: '一言で' })
        );
      default:
        return '<p class="pd-small pd-mute">この追加欄の入力形式は未定義です（' + esc(field.id) + '）</p>';
    }
  }

  function tableRowsHtml(rows) {
    var html = '<div class="pd-drill-trow pd-drill-thead pd-small pd-mute"><span>手</span><span>勝てる相手の手 or アウツ</span><span>BD</span><span></span></div>';
    rows.forEach(function (r, i) {
      r = r || {};
      html += '<div class="pd-drill-trow">' +
        '<input class="pd-input pd-mono" type="text" autocomplete="off" data-f="rank_table" data-k="hand" data-i="' + i + '" value="' + esc(r.hand || '') + '" placeholder="A4s" aria-label="' + (i + 1) + '行目の手">' +
        '<input class="pd-input" type="text" autocomplete="off" data-f="rank_table" data-k="beats" data-i="' + i + '" value="' + esc(r.beats || '') + '" placeholder="勝てる手／アウツ" aria-label="' + (i + 1) + '行目の勝てる相手">' +
        '<input class="pd-input" type="text" autocomplete="off" data-f="rank_table" data-k="bd" data-i="' + i + '" value="' + esc(r.bd || '') + '" placeholder="BD／無し" aria-label="' + (i + 1) + '行目の BD">' +
        '<button type="button" class="pd-drill-itembtn" data-act="rmrow" data-i="' + i + '" aria-label="' + (i + 1) + '行目を削除"' + (rows.length <= MIN_TABLE_ROWS ? ' disabled' : '') + '>×</button>' +
      '</div>';
    });
    return html;
  }

  function bodyOf(field, sheet, ctx) {
    switch (field.id) {
      case 'f1': return f1Body(field, sheet);
      case 'f2': return f2Body(field, sheet);
      case 'f3': return f3Body(field, sheet);
      case 'f4': return f4Body(field, sheet);
      case 'f5': return f5Body(field, sheet, ctx);
      default: return extraBody(field, sheet);
    }
  }

  function hintsHtml(field, ctx) {
    if (!field.hints || !field.hints.length) return '';
    var u1 = hintUsed(ctx, field.id, 1);
    var u2 = hintUsed(ctx, field.id, 2);
    return (
      '<div class="pd-drill-hints" data-fid="' + esc(field.id) + '">' +
        '<div class="pd-drill-hintbtns">' +
          '<button type="button" class="pd-btn pd-btn-ghost pd-drill-hintbtn" data-act="hint" data-tier="1"' + (u1 ? ' disabled' : '') + '>ヒント1（問い）</button>' +
          '<button type="button" class="pd-btn pd-btn-ghost pd-drill-hintbtn" data-act="hint" data-tier="2"' + (u2 ? ' disabled' : '') + (u1 ? '' : ' hidden') + '>ヒント2（原理）</button>' +
          '<span class="pd-drill-hintnote pd-small pd-mute">使うと確信度の上限が 70% になります</span>' +
        '</div>' +
        '<p class="pd-drill-hint" data-tier="1"' + (u1 ? '' : ' hidden') + '>' + esc(field.hints[0]) + '</p>' +
        '<p class="pd-drill-hint" data-tier="2"' + (u2 ? '' : ' hidden') + '>' + esc(field.hints[1]) + '</p>' +
      '</div>'
    );
  }

  function fieldHtml(field, idx, state, sheet, ctx) {
    var res = filledOf(field, sheet, ctx && ctx.spot);
    var status = state === 'locked' ? LOCKED_MSG : (res.ok ? '充足' : res.msg);
    var sum = state === 'passed' ? summaryOf(field, sheet) : '';
    return (
      '<section class="pd-field pd-drill-field" data-fid="' + esc(field.id) + '" data-idx="' + idx + '" data-state="' + state + '" data-filled="' + (res.ok ? '1' : '0') + '"' + (field.extra ? ' data-extra="1"' : '') + '>' +
        '<button type="button" class="pd-drill-head" data-act="toggle" aria-expanded="' + (state === 'open' ? 'true' : 'false') + '">' +
          '<span class="pd-drill-label">' + esc(field.label) + '</span>' +
          '<span class="pd-drill-sum pd-small pd-mute">' + esc(sum) + '</span>' +
        '</button>' +
        '<div class="pd-drill-body">' +
          bodyOf(field, sheet, ctx) +
          '<p class="pd-drill-status pd-small" aria-live="polite">' + esc(status) + '</p>' +
          hintsHtml(field, ctx) +
        '</div>' +
      '</section>'
    );
  }

  function barHtml(fields, sheet, ctx) {
    var mt = missingText(fields, sheet, ctx.spot);
    var conf = sheet.f5 && isNum(sheet.f5.confidence) ? sheet.f5.confidence + '%' : '—';
    var dots = fields.map(function (f) {
      var ok = filledOf(f, sheet, ctx.spot).ok;
      return '<span class="pd-drill-dot" data-fid="' + esc(f.id) + '" data-on="' + (ok ? '1' : '0') + '" title="' + esc(f.label) + '"></span>';
    }).join('');
    return (
      '<div class="pd-bar pd-drill-bar">' +
        '<div class="pd-drill-barrow">' +
          '<span class="pd-drill-dots" aria-label="進捗">' + dots + '</span>' +
          '<span class="pd-drill-conf pd-small"><span class="pd-mute">確信度</span> <span class="pd-drill-confval pd-mono">' + esc(conf) + '</span></span>' +
          (ctx.tempo === 'speed' ? '<span class="pd-drill-timer pd-mono" data-timer aria-label="残り時間">—</span>' : '') +
          '<button type="button" class="pd-btn pd-btn-primary pd-drill-commit" data-act="commit"' + (mt.ok ? '' : ' disabled aria-disabled="true"') + '>コミット</button>' +
        '</div>' +
        '<p class="pd-drill-missing pd-small" data-ok="' + (mt.ok ? '1' : '0') + '">' + esc(mt.text) + '</p>' +
      '</div>'
    );
  }

  function emptyHtml() {
    return (
      '<section class="pd-card pd-drill-none">' +
        '<h2>出題がありません</h2>' +
        '<p class="pd-mute">ホームから今日の出題を始めてください。</p>' +
        '<p><button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホームへ</button></p>' +
      '</section>'
    );
  }

  /** 画面全体の HTML（DOM 不要。テストはここを検査する） */
  function html(ctx) {
    ctx = ctx || {};
    if (!ctx.spot) return emptyHtml();
    if (!S()) return '<section class="pd-card"><h2>読込エラー</h2><p class="pd-mute">PD.sheet が読み込まれていません。</p></section>';
    var sheet = ensureSheet(ctx);
    var fields = ensureFields(ctx);
    var states = statesOf(fields, sheet, ctx.spot);
    var stepper = fields.map(function (f, i) { return fieldHtml(f, i, states[i], sheet, ctx); }).join('');
    return (
      '<div class="pd-drill" data-tempo="' + esc(ctx.tempo || 'slow') + '">' +
        '<aside class="pd-drill-spot">' + spotCardHtml(ctx.spot, ctx) + '</aside>' +
        '<section class="pd-drill-sheet" aria-label="前提票">' +
          '<div class="pd-stepper pd-drill-stepper">' + stepper + '</div>' +
        '</section>' +
        barHtml(fields, sheet, ctx) +
      '</div>'
    );
  }

  // ---- DOM 同期（innerHTML を使わず属性・textContent のみ） -------------

  function qs(el, sel) { return el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null; }
  function qsa(el, sel) { return el && typeof el.querySelectorAll === 'function' ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; }
  function setText(el, sel, text) { var t = qs(el, sel); if (t && t.textContent !== text) t.textContent = text; }

  function fieldEl(wrap, fid) { return qs(wrap, '.pd-drill-field[data-fid="' + fid + '"]'); }

  function activeEl() { return (typeof document !== 'undefined') ? document.activeElement : null; }

  function syncField(wrap, ctx, field, state, changedFid) {
    var el = fieldEl(wrap, field.id);
    if (!el) return;
    var sheet = ctx.sheet;
    var prev = el.getAttribute('data-state');
    if (prev !== state) el.setAttribute('data-state', state);
    if (state === 'passed') {
      var a = activeEl();
      if (a && el.contains(a)) el.setAttribute('data-expanded', 'true');
    } else {
      el.removeAttribute('data-expanded');
    }
    var head = qs(el, '.pd-drill-head');
    if (head) head.setAttribute('aria-expanded', (state === 'open' || el.getAttribute('data-expanded') === 'true') ? 'true' : 'false');

    var res = filledOf(field, sheet, ctx.spot);
    el.setAttribute('data-filled', res.ok ? '1' : '0');
    setText(el, '.pd-drill-status', state === 'locked' ? LOCKED_MSG : (res.ok ? '充足' : res.msg));
    setText(el, '.pd-drill-sum', state === 'passed' ? summaryOf(field, sheet) : '');

    // 充足時刻（_ts）：充足なら記録（変更した欄は再完了時刻で上書き）、未充足なら消す
    var ts = sheet._ts = sheet._ts || {};
    if (res.ok) {
      if (field.id === changedFid || !Object.prototype.hasOwnProperty.call(ts, field.id)) ts[field.id] = elapsed(ctx);
    } else if (Object.prototype.hasOwnProperty.call(ts, field.id)) {
      delete ts[field.id];
    }

    // 欄ごとの動的部分
    if (field.id === 'f2') {
      var v = sheet.f2 || {};
      var sum = (isNum(v.trash) ? v.trash : 0) + (isNum(v.hi) ? v.hi : 0) + (isNum(v.pairPlus) ? v.pairPlus : 0);
      setText(el, '.pd-drill-total', '合計 ' + sum + '%（100±5）');
    }
    if (field.id === 'f3') {
      var ranks = qs(el, '.pd-drill-ranks');
      if (ranks) ranks.setAttribute('data-nodraw', sheet.f3 && sheet.f3.noDraw === true ? '1' : '0');
    }
    if (field.id === 'f4' && !field.compact) {
      var next = qs(el, '.pd-drill-listwrap[data-list="f4.nextLayer"]');
      if (next) next.hidden = !(sheet.f4 && sheet.f4.enough === 'no');
    }
  }

  function syncBar(wrap, ctx) {
    var fields = ctx.fields, sheet = ctx.sheet;
    var mt = missingText(fields, sheet, ctx.spot);
    var btn = qs(wrap, '.pd-drill-commit');
    if (btn) {
      btn.disabled = !mt.ok;
      if (mt.ok) btn.removeAttribute('aria-disabled'); else btn.setAttribute('aria-disabled', 'true');
    }
    var miss = qs(wrap, '.pd-drill-missing');
    if (miss) { miss.setAttribute('data-ok', mt.ok ? '1' : '0'); if (miss.textContent !== mt.text) miss.textContent = mt.text; }
    fields.forEach(function (f) {
      var dot = qs(wrap, '.pd-drill-dot[data-fid="' + f.id + '"]');
      if (dot) dot.setAttribute('data-on', filledOf(f, sheet, ctx.spot).ok ? '1' : '0');
    });
    var conf = sheet.f5 && isNum(sheet.f5.confidence) ? sheet.f5.confidence + '%' : '—';
    setText(wrap, '.pd-drill-confval', conf);
  }

  /** 構造（開閉）・状態表示・バーをまとめて同期する。changedFid は今回値を変えた欄 */
  function sync(wrap, ctx, changedFid) {
    var fields = ctx.fields;
    var states = statesOf(fields, ctx.sheet, ctx.spot);
    fields.forEach(function (f, i) { syncField(wrap, ctx, f, states[i], changedFid); });
    syncBar(wrap, ctx);
  }

  /** ヒント使用で確信度の上限が変わったとき：max 属性・注記・値のクランプ */
  function syncCap(wrap, ctx) {
    var c = cap(ctx);
    var inp = qs(wrap, 'input[data-f="f5"][data-k="confidence"]');
    if (inp) {
      inp.setAttribute('max', String(c));
      var v = ctx.sheet.f5 && ctx.sheet.f5.confidence;
      if (isNum(v) && v > c) {
        ctx.sheet.f5.confidence = c;
        inp.value = String(c);
      }
    }
    setText(wrap, '.pd-drill-capnote', capNote(c));
  }

  // ---- 入力の退避 --------------------------------------------------------

  function writeInput(ctx, el) {
    var fid = el.getAttribute('data-f');
    var k = el.getAttribute('data-k');
    if (!fid || !k) return null;
    var sheet = ctx.sheet;
    var bag = bagOf(sheet, fid, true);
    var i = el.getAttribute('data-i');
    if (i !== null && i !== undefined) {
      if (!Array.isArray(bag)) return null;
      var n = Number(i);
      bag[n] = bag[n] || {};
      bag = bag[n];
    }
    if (!bag || typeof bag !== 'object') return null;
    var v;
    if (el.type === 'checkbox') v = !!el.checked;
    else if (el.type === 'number' || el.getAttribute('inputmode') === 'decimal') v = numOf(el.value);
    else v = String(el.value == null ? '' : el.value);
    if (fid === 'f5' && k === 'confidence' && isNum(v)) {
      var c = cap(ctx);
      var cv = clamp(v, 0, c);
      if (cv !== v) { v = cv; el.value = String(cv); }
    }
    bag[k] = v;
    return fid;
  }

  function refreshList(wrapList, ctx) {
    var path = wrapList.getAttribute('data-list');
    var list = listRef(ctx.sheet, path, true);
    var box = qs(wrapList, '.pd-drill-list');
    if (box) box.innerHTML = listItemsHtml(list, wrapList.getAttribute('data-reorder') === '1');
  }

  function fidOfPath(path) {
    var parts = String(path || '').split('.');
    return parts[0] === 'extra' ? parts[1] : parts[0];
  }

  function setKpMsg(kp, msg) {
    setText(kp, '.pd-drill-kp-msg', msg || '');
    var buf = qs(kp, '.pd-drill-kp-buf');
    if (buf) buf.textContent = kp.getAttribute('data-buf') || ' ';
  }

  function handleKey(btn, wrap, ctx) {
    var wrapList = btn.closest('.pd-drill-listwrap');
    var kp = btn.closest('.pd-drill-kp');
    if (!wrapList || !kp) return null;
    var path = wrapList.getAttribute('data-list');
    var list = listRef(ctx.sheet, path, true);
    var res = keypadPress(kp.getAttribute('data-buf') || '', btn.getAttribute('data-key'));
    var msg = res.err;
    var changed = false;
    if (res.add) {
      var max = Number(wrapList.getAttribute('data-max')) || 0;
      if (list.indexOf(res.add) >= 0) msg = res.add + ' は既にあります';
      else if (max && list.length >= max) msg = '最大 ' + max + ' つまで';
      else { list.push(res.add); changed = true; }
    }
    if (res.removeLast && list.length) { list.pop(); changed = true; }
    kp.setAttribute('data-buf', res.buf);
    setKpMsg(kp, msg);
    if (changed) refreshList(wrapList, ctx);
    return changed ? fidOfPath(path) : null;
  }

  function handleListEdit(btn, ctx, act) {
    var wrapList = btn.closest('.pd-drill-listwrap');
    if (!wrapList) return null;
    var path = wrapList.getAttribute('data-list');
    var list = listRef(ctx.sheet, path, true);
    var i = Number(btn.getAttribute('data-i'));
    if (!(i >= 0 && i < list.length)) return null;
    if (act === 'rm') {
      list.splice(i, 1);
    } else {
      var j = i + Number(btn.getAttribute('data-d'));
      if (j < 0 || j >= list.length) return null;
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    refreshList(wrapList, ctx);
    return fidOfPath(path);
  }

  function handleSet(btn, ctx) {
    var fid = btn.getAttribute('data-f'), k = btn.getAttribute('data-k'), v = btn.getAttribute('data-v');
    var bag = bagOf(ctx.sheet, fid, true);
    if (!bag || typeof bag !== 'object') return null;
    var num = Number(v);
    bag[k] = (v !== '' && !isNaN(num) && /^-?\d+(\.\d+)?$/.test(v)) ? num : v;
    var group = btn.closest('.pd-drill-group');
    qsa(group, '[data-act="set"]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    return fid;
  }

  function handleRank(btn, ctx) {
    var r = btn.getAttribute('data-r');
    var f3 = bagOf(ctx.sheet, 'f3', true);
    var list = Array.isArray(f3.drawRanks) ? f3.drawRanks : (f3.drawRanks = []);
    var idx = list.indexOf(r);
    if (idx >= 0) {
      list.splice(idx, 1);
      btn.setAttribute('aria-pressed', 'false');
    } else {
      list.push(r);
      list.sort(function (a, b) { return RANKS.indexOf(a) - RANKS.indexOf(b); });
      btn.setAttribute('aria-pressed', 'true');
      if (f3.noDraw === true) {
        f3.noDraw = false;
        var cb = qs(btn.closest('.pd-drill-field'), 'input[data-f="f3"][data-k="noDraw"]');
        if (cb) cb.checked = false;
      }
    }
    return 'f3';
  }

  function handleStep(btn, ctx) {
    var fid = btn.getAttribute('data-f'), k = btn.getAttribute('data-k'), d = Number(btn.getAttribute('data-d')) || 0;
    var bag = bagOf(ctx.sheet, fid, true);
    var cur = isNum(bag[k]) ? bag[k] : 0;
    bag[k] = clamp(cur + d, 0, 100);
    var inp = qs(btn.closest('.pd-drill-field'), 'input[data-f="' + fid + '"][data-k="' + k + '"]');
    if (inp) inp.value = String(bag[k]);
    return fid;
  }

  function handleHint(btn, wrap, ctx) {
    var box = btn.closest('.pd-drill-hints');
    if (!box) return;
    var fid = box.getAttribute('data-fid');
    var tier = Number(btn.getAttribute('data-tier'));
    if (!hintUsed(ctx, fid, tier)) ctx.hints.push({ field: fid, tier: tier });
    var p = qs(box, '.pd-drill-hint[data-tier="' + tier + '"]');
    if (p) p.hidden = false;
    btn.disabled = true;
    if (tier === 1) {
      var b2 = qs(box, '.pd-drill-hintbtn[data-tier="2"]');
      if (b2) b2.hidden = false;
    }
    syncCap(wrap, ctx);
  }

  function handleToggle(btn, wrap) {
    var el = btn.closest('.pd-drill-field');
    if (!el || el.getAttribute('data-state') !== 'passed') return;
    var now = el.getAttribute('data-expanded') === 'true';
    qsa(wrap, '.pd-drill-field[data-expanded="true"]').forEach(function (o) {
      o.removeAttribute('data-expanded');
      var h = qs(o, '.pd-drill-head'); if (h) h.setAttribute('aria-expanded', 'false');
    });
    if (!now) {
      el.setAttribute('data-expanded', 'true');
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function handleTable(btn, ctx, act) {
    var rows = tableRows(ctx.sheet);
    if (act === 'addrow') rows.push({ hand: '', beats: '', bd: '' });
    else {
      var i = Number(btn.getAttribute('data-i'));
      if (rows.length > MIN_TABLE_ROWS && i >= 0 && i < rows.length) rows.splice(i, 1);
    }
    var box = qs(btn.closest('.pd-drill-field'), '.pd-drill-table');
    if (box) box.innerHTML = tableRowsHtml(rows);
    return 'rank_table';
  }

  function doCommit(ctx) {
    var api = S();
    var cc = api.canCommit(ctx.fields, ctx.sheet, ctx.spot);
    if (!cc.ok) {
      if (typeof ctx.toast === 'function') ctx.toast('未充足：' + cc.missing.join('／'));
      return;
    }
    var ts = ctx.sheet._ts = ctx.sheet._ts || {};
    ctx.fields.forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(ts, f.id)) ts[f.id] = elapsed(ctx);
    });
    if (typeof ctx.commit === 'function') ctx.commit();
  }

  // ---- イベント配線（wrap 要素に委譲。render ごとに新しい wrap に付く） ----

  function bind(wrap, ctx) {
    wrap.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-f')) return;
      var fid = writeInput(ctx, t);
      if (fid === 'f3' && t.getAttribute('data-k') === 'noDraw' && t.checked) {
        ctx.sheet.f3.drawRanks = [];
        qsa(t.closest('.pd-drill-field'), '[data-act="rank"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      }
      if (fid) sync(wrap, ctx, fid);
    });
    wrap.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-f')) return;
      var fid = writeInput(ctx, t);
      if (fid === 'f3' && t.getAttribute('data-k') === 'noDraw' && t.checked) {
        ctx.sheet.f3.drawRanks = [];
        qsa(t.closest('.pd-drill-field'), '[data-act="rank"]').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      }
      if (fid) sync(wrap, ctx, fid);
    });
    wrap.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var btn = t.closest('[data-act]');
      if (!btn || !wrap.contains(btn)) return;
      var act = btn.getAttribute('data-act');
      var changed = null;
      switch (act) {
        case 'key': changed = handleKey(btn, wrap, ctx); break;
        case 'rm':
        case 'mv': changed = handleListEdit(btn, ctx, act); break;
        case 'set': changed = handleSet(btn, ctx); break;
        case 'rank': changed = handleRank(btn, ctx); break;
        case 'step': changed = handleStep(btn, ctx); break;
        case 'addrow':
        case 'rmrow': changed = handleTable(btn, ctx, act); break;
        case 'hint': handleHint(btn, wrap, ctx); return;
        case 'toggle': handleToggle(btn, wrap); return;
        case 'commit': ev.preventDefault(); doCommit(ctx); return;
        default: return;
      }
      if (changed) sync(wrap, ctx, changed);
    });
    // 通過欄の再編集中にフォーカスが外へ出たら折りたたむ
    wrap.addEventListener('focusout', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var el = t.closest('.pd-drill-field');
      if (!el || el.getAttribute('data-state') !== 'passed') return;
      var to = ev.relatedTarget;
      if (to && el.contains(to)) return;
      el.removeAttribute('data-expanded');
      var h = qs(el, '.pd-drill-head'); if (h) h.setAttribute('aria-expanded', 'false');
    });
    // Enter で数値入力を確定（change を起こす）
    wrap.addEventListener('keydown', function (ev) {
      var t = ev.target;
      if (ev.key === 'Enter' && t && t.tagName === 'INPUT' && t.type !== 'checkbox') {
        ev.preventDefault();
        if (typeof t.blur === 'function') t.blur();
      }
    });
  }

  // ---- 公開 --------------------------------------------------------------

  /**
   * @param {HTMLElement} rootEl
   * @param {Ctx} ctx
   */
  function render(rootEl, ctx) {
    if (!rootEl) return;
    ctx = ctx || {};
    rootEl.innerHTML = html(ctx);
    var wrap = qs(rootEl, '.pd-drill');
    if (!wrap || !ctx.spot || !S()) return;
    bind(wrap, ctx);
    sync(wrap, ctx, null);
  }

  return {
    render: render,
    // 補助（契約外・テスト用）
    html: html,
    spotCardHtml: spotCardHtml,
    fieldHtml: fieldHtml,
    barHtml: barHtml,
    statesOf: statesOf,
    summaryOf: summaryOf,
    missingText: missingText,
    keypadPress: keypadPress,
    listItemsHtml: listItemsHtml,
    cardTokens: cardTokens
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.drill;
