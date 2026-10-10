// premise-drill: PD.ui.map（T11）。弱点マップ＝signature「淀みが晴れる格子」。
// 行＝出題済みの族（PD.gaps.mapCells）、列＝5型。セルは2層：下層＝再発膜（count）、上層＝灯る輪（cleanStreak）。
// 数字は表示しない。count / streak は data 属性に置き、見た目は css/ui-map.css に委ねる。
// 行末「安定」バッジ＝PD.gaps.stableFamilies（⑨と同一関数）。下部に追加欄の履歴。セルタップでログ一覧。
// mini(ctx) は Home 用の縮小版：行ラベル無し・次に出る族を強調しない。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.ui.map = (function () {
  'use strict';

  /** 族ラベルの予備（PD.gen.FAMILIES が無い環境用）。本来のラベルは generator が持つ */
  var CLS_LABEL = {
    dry_high: 'ドライ・ハイ',
    bw_sd: 'ブロードウェイSD',
    mid: 'ミドル',
    low: 'ロー',
    paired: 'ペアード',
    mono: 'モノトーン'
  };
  var SIZE_LABEL = { '33': '33%', '50': '50%', 'x': 'その他' };
  /** 列の予備（PD.gaps が無い環境用）。本来は GAP_TYPES の remedySlot 付き5型 */
  var FALLBACK_COLS = [
    { id: 'range_state', label: 'レンジ状態' },
    { id: 'baseline', label: '定石忘れ' },
    { id: 'rule', label: '規則違い' },
    { id: 'strength_order', label: '強さ順' },
    { id: 'middling', label: '中庸' }
  ];
  var STREAK_MAX = 4;

  function esc(s) {
    return (PD.util && typeof PD.util.esc === 'function') ? PD.util.esc(s) : String(s == null ? '' : s);
  }

  function gapsApi() {
    return PD.gaps || null;
  }

  function columns() {
    var g = gapsApi();
    if (g && Array.isArray(g.GAP_TYPES)) {
      var cols = g.GAP_TYPES.filter(function (t) { return t && t.remedySlot; })
        .map(function (t) { return { id: t.id, label: t.label }; });
      if (cols.length) return cols;
    }
    return FALLBACK_COLS.slice();
  }

  function gapLabel(id) {
    var cols = columns();
    for (var i = 0; i < cols.length; i++) if (cols[i].id === id) return cols[i].label;
    var g = gapsApi();
    if (g && Array.isArray(g.GAP_TYPES)) {
      for (var j = 0; j < g.GAP_TYPES.length; j++) if (g.GAP_TYPES[j].id === id) return g.GAP_TYPES[j].label;
    }
    return String(id || '');
  }

  /** 族ラベル。PD.gen.FAMILIES があればそれ、無ければ cls×size から組む */
  function familyLabel(id) {
    id = String(id || '');
    if (PD.gen && Array.isArray(PD.gen.FAMILIES)) {
      for (var i = 0; i < PD.gen.FAMILIES.length; i++) {
        var f = PD.gen.FAMILIES[i];
        if (f && f.id === id && f.label) return f.label;
      }
    }
    var m = /^(.*)_(33|50|x)$/.exec(id);
    if (m && CLS_LABEL[m[1]]) return CLS_LABEL[m[1]] + ' ' + SIZE_LABEL[m[2]];
    return id;
  }

  function familyOfEntry(e) {
    var s = e && e.spot;
    if (!s) return null;
    if (s.family) return s.family;
    if (s.cls) return s.cls + '_' + ((s.size === 33 || s.size === 50) ? String(s.size) : 'x');
    return null;
  }

  function isComplete(e) {
    return !(e && e.commit && e.commit.incomplete === true);
  }

  function cells(ctx) {
    var g = gapsApi();
    if (!g || typeof g.mapCells !== 'function' || !ctx || !ctx.state) return [];
    try { return g.mapCells(ctx.state, ctx.log || []) || []; } catch (e) { return []; }
  }

  function stableSet(ctx) {
    var g = gapsApi();
    var set = {};
    if (!g || typeof g.stableFamilies !== 'function' || !ctx || !ctx.state) return set;
    var list;
    try { list = g.stableFamilies(ctx.state) || []; } catch (e) { list = []; }
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    return set;
  }

  /** mapCells の平らな配列を族ごとの行に畳む（順序は mapCells のまま） */
  function rows(list) {
    var out = [];
    var byFam = {};
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!byFam[c.family]) {
        byFam[c.family] = { family: c.family, cells: [] };
        out.push(byFam[c.family]);
      }
      byFam[c.family].cells.push(c);
    }
    return out;
  }

  function clampInt(n, lo, hi) {
    n = Number(n) || 0;
    return Math.min(hi, Math.max(lo, Math.floor(n)));
  }

  /**
   * セル1個の HTML。
   *   data-count  = 再発カウント（CSS 用。表示はしない）
   *   data-film   = 膜の濃さ 0 / 1 / 2（2 は 2 以上）
   *   data-streak = cleanStreak 0〜4（count 0 のセルは CSS 側で輪を出さない＝素地）
   *   data-live   = 実戦でその型が付いたか 0 / 1
   * ＋印＝count 2 以上（欄追加済み）。
   * interactive（Map 本体）のときだけ data-family / data-gap と aria-label を付ける。
   * Home の縮小版（interactive:false）には族 id も型 id も置かない（答え漏れ防止）。
   */
  function cellHtml(c, opts) {
    opts = opts || {};
    var count = clampInt(c.count, 0, 999);
    var film = count >= 2 ? 2 : count;
    var streak = clampInt(c.cleanStreak, 0, STREAK_MAX);
    var live = (Number(c.live) || 0) > 0 ? 1 : 0;
    var tag = opts.interactive ? 'button' : 'span';
    var attrs =
      ' class="pd-map-cell"' +
      ' data-count="' + count + '"' +
      ' data-film="' + film + '"' +
      ' data-streak="' + streak + '"' +
      ' data-live="' + live + '"';
    if (opts.interactive) {
      var stateWord = count >= 2 ? '再発あり・欄追加済み' : (count === 1 ? '再発あり' : '素地');
      if (count >= 1 && streak >= 1) stateWord += '・クリア継続中';
      if (live) stateWord += '・実戦あり';
      attrs +=
        ' data-family="' + esc(c.family) + '"' +
        ' data-gap="' + esc(c.gap) + '"' +
        ' type="button" aria-label="' + esc(familyLabel(c.family)) + '・' + esc(gapLabel(c.gap)) + '：' + stateWord + '"';
    } else {
      attrs += ' aria-hidden="true"';
    }
    return (
      '<' + tag + attrs + '>' +
        (count >= 2 ? '<span class="pd-map-plus" aria-hidden="true">＋</span>' : '') +
        (live ? '<i class="pd-map-live" aria-hidden="true"></i>' : '') +
      '</' + tag + '>'
    );
  }

  // ---- Home 用の縮小版 ----

  /**
   * 行ラベル無し・5列固定。次に出る族（due）を強調しない。族 id・型 id も属性に置かない。
   * セルが無ければ空文字（Home 側が空状態メッセージを出す）。
   */
  function mini(ctx) {
    var list = cells(ctx);
    if (!list.length) return '';
    var rs = rows(list);
    var out = '<div class="pd-map-mini" role="img" aria-label="格子の縮小版">';
    for (var i = 0; i < rs.length; i++) {
      out += '<div class="pd-map-mini-row">';
      for (var j = 0; j < rs[i].cells.length; j++) out += cellHtml(rs[i].cells[j], { interactive: false });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  // ---- Map 本体 ----

  function headerHtml() {
    var cols = columns();
    var out = '<div class="pd-map-head" aria-hidden="true"><span class="pd-map-head-blank"></span>';
    for (var i = 0; i < cols.length; i++) {
      out += '<span class="pd-map-col" data-gap="' + esc(cols[i].id) + '"><span class="pd-map-col-text">' + esc(cols[i].label) + '</span></span>';
    }
    return out + '</div>';
  }

  function gridHtml(ctx) {
    var list = cells(ctx);
    if (!list.length) {
      return (
        '<section class="pd-card pd-map-empty">' +
          '<h2>まだ格子がありません</h2>' +
          '<p class="pd-mute">1問コミットして保存すると、その族の行が生まれます。再発は膜として沈み、連続クリアで輪が灯って晴れていきます。</p>' +
          '<p><button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホームへ</button></p>' +
        '</section>'
      );
    }
    var stable = stableSet(ctx);
    var rs = rows(list);
    var out = '<div class="pd-map-grid" role="group" aria-label="型×族の格子">' + headerHtml();
    for (var i = 0; i < rs.length; i++) {
      var fam = rs[i].family;
      out +=
        '<div class="pd-map-row" data-family="' + esc(fam) + '">' +
          '<span class="pd-map-rowlabel">' +
            '<span class="pd-map-fam">' + esc(familyLabel(fam)) + '</span>' +
            (stable[fam] ? '<span class="pd-map-stable">安定</span>' : '') +
          '</span>';
      for (var j = 0; j < rs[i].cells.length; j++) out += cellHtml(rs[i].cells[j], { interactive: true });
      out += '</div>';
    }
    out += '</div>';
    out +=
      '<ul class="pd-map-legend pd-small pd-mute">' +
        '<li><i class="pd-map-key pd-map-key-film" aria-hidden="true"></i>膜＝再発。重なるほど沈み、＋は欄が追加済み</li>' +
        '<li><i class="pd-map-key pd-map-key-ring" aria-hidden="true"></i>輪＝連続クリア。積み上がると膜が消えて素地に戻る</li>' +
        '<li><i class="pd-map-key pd-map-key-live" aria-hidden="true"></i>点＝実戦持ち込みで同じ型が付いた</li>' +
      '</ul>';
    return out;
  }

  function extraLabel(id) {
    if (PD.sheet && PD.sheet.EXTRA_FIELDS && PD.sheet.EXTRA_FIELDS[id] && PD.sheet.EXTRA_FIELDS[id].label) {
      return PD.sheet.EXTRA_FIELDS[id].label;
    }
    return String(id || '');
  }

  function slotGap(x) {
    if (x && x.gap) return x.gap;
    var g = gapsApi();
    if (g && Array.isArray(g.GAP_TYPES)) {
      for (var i = 0; i < g.GAP_TYPES.length; i++) if (g.GAP_TYPES[i].remedySlot === x.id) return g.GAP_TYPES[i].id;
    }
    return '';
  }

  function famList(arr) {
    if (!Array.isArray(arr) || !arr.length) return '—';
    return arr.map(function (f) { return esc(familyLabel(f)); }).join('・');
  }

  function extrasHtml(ctx) {
    var st = (ctx && ctx.state && ctx.state.settings) || {};
    var list = Array.isArray(st.extraFields) ? st.extraFields : [];
    var pend = Array.isArray(st.pendingExtra) ? st.pendingExtra : [];
    var out = '<section class="pd-card pd-map-extras"><h2>追加欄の履歴</h2>';
    if (!list.length && !pend.length) {
      out += '<p class="pd-mute pd-small">まだ欄は増えていません。同じ型×族が2回出ると、前提票に欄が1つ足されます。</p>';
    } else {
      out += '<ul class="pd-map-extra-list">';
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (!x || !x.id) continue;
        var status = x.retiredAt ? 'retired' : (x.enabled === false ? 'off' : 'on');
        var statusWord = x.retiredAt ? '退役' : (x.enabled === false ? '無効' : '有効');
        out +=
          '<li class="pd-map-extra" data-status="' + status + '">' +
            '<span class="pd-map-extra-label">' + esc(extraLabel(x.id)) + '</span>' +
            '<span class="pd-map-extra-meta pd-small pd-mute">' +
              '由来 ' + esc(gapLabel(slotGap(x))) + ' × ' + famList(x.families) +
              '<span class="pd-map-extra-dates pd-mono">追加 ' + esc(x.addedAt || '—') +
                (x.retiredAt ? '　退役 ' + esc(x.retiredAt) : '') + '</span>' +
            '</span>' +
            '<span class="pd-map-extra-status">' + statusWord + '</span>' +
          '</li>';
      }
      for (var k = 0; k < pend.length; k++) {
        var p = pend[k];
        if (!p || !p.id) continue;
        out +=
          '<li class="pd-map-extra" data-status="pending">' +
            '<span class="pd-map-extra-label">' + esc(extraLabel(p.id)) + '</span>' +
            '<span class="pd-map-extra-meta pd-small pd-mute">' +
              '由来 ' + esc(gapLabel(p.gap || slotGap(p))) + ' × ' + famList(p.family ? [p.family] : []) +
              '<span class="pd-map-extra-dates pd-mono">提案 ' + esc(p.since || '—') + '</span>' +
            '</span>' +
            '<span class="pd-map-extra-status">提案待ち</span>' +
          '</li>';
      }
      out += '</ul>';
    }
    return out + '</section>';
  }

  function scoreText(e) {
    var g = gapsApi();
    var sc = null;
    if (g && typeof g.scoreOf === 'function') {
      try { sc = g.scoreOf(e); } catch (err) { sc = null; }
    }
    return (typeof sc === 'number') ? (sc + '/10') : '—';
  }

  /** セルに紐づくログ（speed・未完は除く）。新しい順 */
  function logsFor(ctx, family, gap) {
    var log = (ctx && Array.isArray(ctx.log)) ? ctx.log : [];
    var out = [];
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (!e || e.mode === 'speed' || !isComplete(e)) continue;
      if (familyOfEntry(e) !== family) continue;
      if ((e.gap || 'none') !== gap) continue;
      out.push(e);
    }
    return out;
  }

  function logsHtml(ctx, family, gap) {
    var list = logsFor(ctx, family, gap);
    var out =
      '<section class="pd-card pd-map-logs" data-family="' + esc(family) + '" data-gap="' + esc(gap) + '">' +
        '<h2>' + esc(familyLabel(family)) + ' <span class="pd-map-logs-x">×</span> ' + esc(gapLabel(gap)) + '</h2>';
    if (!list.length) {
      out += '<p class="pd-mute pd-small">この型が付いた記録はまだありません。</p>';
    } else {
      out += '<ul class="pd-map-log-list">';
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var sp = e.spot || {};
        var date = String(e.at || '').slice(0, 10);
        out +=
          '<li class="pd-map-log" data-id="' + esc(e.id || '') + '"' + (typeof sp.seed === 'number' ? ' data-seed="' + sp.seed + '"' : '') + '>' +
            '<span class="pd-map-log-date pd-mono">' + esc(date) + '</span>' +
            '<span class="pd-map-log-spot pd-mono">' + esc(sp.board || '') + ' ' + esc(sp.hero || '') + '</span>' +
            '<span class="pd-map-log-size pd-mono">CB ' + esc(sp.size != null ? sp.size + '%' : '—') + '</span>' +
            (e.mode === 'live' ? '<span class="pd-map-log-live">実戦</span>' : '') +
            '<span class="pd-map-log-score pd-mono">' + esc(scoreText(e)) + '</span>' +
            (e.gapNote ? '<span class="pd-map-log-note pd-small pd-mute">' + esc(e.gapNote) + '</span>' : '') +
          '</li>';
      }
      out += '</ul>';
    }
    return out + '</section>';
  }

  function html(ctx) {
    return (
      '<div class="pd-map">' +
        '<header class="pd-map-top">' +
          '<h2 class="pd-map-title">格子</h2>' +
          '<p class="pd-small pd-mute">行＝出題済みの族、列＝5型。セルをタップすると記録が出ます。</p>' +
        '</header>' +
        gridHtml(ctx) +
        '<div class="pd-map-logs-slot"></div>' +
        extrasHtml(ctx) +
      '</div>'
    );
  }

  // ---- 公開 ----

  /**
   * @param {HTMLElement} rootEl
   * @param {Ctx} ctx
   */
  function render(rootEl, ctx) {
    if (!rootEl) return;
    ctx = ctx || {};
    rootEl.innerHTML = html(ctx);
    if (typeof rootEl.querySelector !== 'function') return;
    var grid = rootEl.querySelector('.pd-map-grid');
    var slot = rootEl.querySelector('.pd-map-logs-slot');
    if (!grid || !slot || typeof grid.addEventListener !== 'function') return;
    grid.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var cell = t.closest('.pd-map-cell');
      if (!cell) return;
      var fam = cell.getAttribute('data-family');
      var gap = cell.getAttribute('data-gap');
      var all = grid.querySelectorAll('.pd-map-cell[aria-pressed="true"]');
      for (var i = 0; i < all.length; i++) all[i].removeAttribute('aria-pressed');
      cell.setAttribute('aria-pressed', 'true');
      slot.innerHTML = logsHtml(ctx, fam, gap);
    });
  }

  return {
    render: render,
    mini: mini,
    // 補助（契約外・テスト用）
    familyLabel: familyLabel,
    cellHtml: cellHtml,
    logsHtml: logsHtml,
    html: html
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.map;
