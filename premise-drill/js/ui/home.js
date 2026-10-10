// premise-drill: PD.ui.home（T11）。Home 画面。
// 今日やることを1画面で決める：段表示／今日の出題ボタン（reason とサイズだけ。族名・クラスラベルは出さない）
// ／格子の縮小版（PD.ui.map.mini。次に出る族を強調しない）／実戦持ち込み n/3／速度の解放状況／own.html／設定。
// 状態は ctx 経由のみ。出題開始は ctx.next() に委ねる（nextSpot → start は app の責務）。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.ui.home = (function () {
  'use strict';

  var LIVE_PER_DAY = 3;

  function esc(s) {
    return (PD.util && typeof PD.util.esc === 'function') ? PD.util.esc(s) : String(s == null ? '' : s);
  }

  function todayStr() {
    if (PD.util && typeof PD.util.today === 'function') return PD.util.today();
    var d = new Date();
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  function gapsApi() {
    return PD.gaps || null;
  }

  /** 族 id の末尾からサイズだけを取り出す（'33' | '50' | 'x' | null）。族名そのものは表示に使わない */
  function sizeOfFamily(family) {
    var m = /_(33|50|x)$/.exec(String(family || ''));
    return m ? m[1] : null;
  }

  /**
   * 出題ボタンの文言。due 族があれば「復習（33%）」、無ければ「ランダム」。
   * 族名・クラスラベルは含めない（③「ドロー無し宣言」の答えが先に見えるのを防ぐ）。
   */
  function startInfo(ctx) {
    var g = gapsApi();
    var state = ctx && ctx.state;
    var due = [];
    if (g && state && typeof g.dueFamilies === 'function') {
      try { due = g.dueFamilies(state, todayStr()) || []; } catch (e) { due = []; }
    }
    if (due.length) {
      var sz = sizeOfFamily(due[0]);
      var withSize = (sz === '33' || sz === '50') ? '（' + sz + '%）' : '';
      return { reason: 'srs', size: sz, label: '復習' + withSize };
    }
    return { reason: 'random', size: null, label: 'ランダム' };
  }

  /** 段表示「段1（＋50%）」。33% を基準に、それ以外のサイズを「＋」で添える */
  function stageLabel(state) {
    var stage = (state && typeof state.stage === 'number') ? state.stage : 1;
    var sizes = (state && state.settings && Array.isArray(state.settings.sizes)) ? state.settings.sizes : [33, 50];
    var extras = [];
    for (var i = 0; i < sizes.length; i++) {
      if (sizes[i] !== 33) extras.push('＋' + sizes[i] + '%');
    }
    return '段' + stage + (extras.length ? '（' + extras.join('・') + '）' : '');
  }

  function liveToday(state) {
    var lt = state && state.counters && state.counters.liveToday;
    if (!lt || lt.date !== todayStr()) return 0;
    return typeof lt.n === 'number' ? lt.n : 0;
  }

  function hasView(name) {
    return !!(PD.ui && PD.ui[name] && typeof PD.ui[name].render === 'function');
  }

  function miniHtml(ctx) {
    if (PD.ui && PD.ui.map && typeof PD.ui.map.mini === 'function') {
      try { return PD.ui.map.mini(ctx) || ''; } catch (e) { return ''; }
    }
    return '';
  }

  // ---- 区画 ----

  function startHtml(ctx) {
    var info = startInfo(ctx);
    return (
      '<section class="pd-home-start-wrap">' +
        '<p class="pd-home-eyebrow pd-mono">' + esc(stageLabel(ctx.state)) + '<span class="pd-home-eyebrow-sep">／</span>今日の出題</p>' +
        '<button type="button" class="pd-btn pd-btn-primary pd-home-start" data-reason="' + esc(info.reason) + '">' +
          '<span class="pd-home-start-label">' + esc(info.label) + '</span>' +
          '<span class="pd-home-start-arrow" aria-hidden="true">→</span>' +
        '</button>' +
        '<p class="pd-home-start-note pd-small pd-mute">' +
          (info.reason === 'srs' ? '期日が来たセルの族から出します。' : '出題済みの族に期日のセルはありません。') +
        '</p>' +
      '</section>'
    );
  }

  function gridHtml(ctx) {
    var mini = miniHtml(ctx);
    var body = mini
      ? mini
      : '<p class="pd-home-empty">まだ記録がありません。<br>最初の1問をコミットすると、ここに格子の行が生まれます。</p>';
    return (
      '<a class="pd-card pd-home-grid" href="#map" data-go="map" aria-label="格子を開く">' +
        '<span class="pd-home-grid-head">' +
          '<span class="pd-home-grid-title">格子</span>' +
          '<span class="pd-home-grid-hint pd-small pd-mute">タップで開く</span>' +
        '</span>' +
        body +
      '</a>'
    );
  }

  function liveHtml(ctx) {
    var n = liveToday(ctx.state);
    var ready = hasView('import');
    return (
      '<li class="pd-home-row">' +
        '<span class="pd-home-row-main">' +
          '<span class="pd-home-row-title">実戦持ち込み</span>' +
          '<span class="pd-home-row-sub pd-small pd-mute">今日 <span class="pd-mono">' + n + '/' + LIVE_PER_DAY + '</span></span>' +
        '</span>' +
        (ready
          ? '<button type="button" class="pd-btn pd-btn-ghost" data-go="import">登録</button>'
          : '<span class="pd-home-row-soon pd-small pd-mute">Phase B</span>') +
      '</li>'
    );
  }

  function speedHtml(ctx) {
    var g = gapsApi();
    var info = null;
    if (g && typeof g.speedUnlocked === 'function') {
      try { info = g.speedUnlocked(ctx.state, ctx.log); } catch (e) { info = null; }
    }
    var ok = !!(info && info.ok);
    var ready = hasView('speed');
    var sub, action;
    if (ok) {
      sub = '解放済み';
      action = ready
        ? '<button type="button" class="pd-btn pd-btn-ghost" data-go="speed">開始</button>'
        : '<span class="pd-home-row-soon pd-small pd-mute">Phase B</span>';
    } else if (info) {
      var remain = Math.max(0, (info.need || 0) - (info.stable || 0));
      sub = '解放まで 安定 <span class="pd-mono">' + info.stable + '/' + info.need + '</span>（あと' + remain + '件）' +
        (info.blockedByRecurrence ? '・同じセルの再発が続いています' : '');
      action = '<span class="pd-home-row-lock pd-small pd-mute" aria-label="未解放">ロック</span>';
    } else {
      sub = '未解放';
      action = '<span class="pd-home-row-lock pd-small pd-mute" aria-label="未解放">ロック</span>';
    }
    return (
      '<li class="pd-home-row" data-speed="' + (ok ? 'unlocked' : 'locked') + '">' +
        '<span class="pd-home-row-main">' +
          '<span class="pd-home-row-title">速度モード</span>' +
          '<span class="pd-home-row-sub pd-small pd-mute">' + sub + '</span>' +
        '</span>' +
        action +
      '</li>'
    );
  }

  /** 解放直後の1回カード（speedUnlockedAt は app が記録する。未記録の間だけ出る） */
  function unlockCardHtml(ctx) {
    var g = gapsApi();
    if (!g || typeof g.speedUnlocked !== 'function') return '';
    var info;
    try { info = g.speedUnlocked(ctx.state, ctx.log); } catch (e) { return ''; }
    if (!info || !info.ok) return '';
    var at = ctx.state && ctx.state.settings && ctx.state.settings.speedUnlockedAt;
    if (at) return '';
    return (
      '<section class="pd-card pd-home-unlock" role="status">' +
        '<h2>速度モードが解放されました</h2>' +
        '<p class="pd-small pd-mute">安定した族だけを60秒で回します。slow の票と同じ5行です。</p>' +
      '</section>'
    );
  }

  function linksHtml() {
    return (
      '<li class="pd-home-row">' +
        '<span class="pd-home-row-main">' +
          '<span class="pd-home-row-title">暗記 SRS</span>' +
          '<span class="pd-home-row-sub pd-small pd-mute">own.html の暗記表へ</span>' +
        '</span>' +
        '<a class="pd-btn pd-btn-ghost" href="../own.html">開く</a>' +
      '</li>' +
      '<li class="pd-home-row">' +
        '<span class="pd-home-row-main">' +
          '<span class="pd-home-row-title">設定</span>' +
          '<span class="pd-home-row-sub pd-small pd-mute">キー・Wizard 確認・追加欄・エクスポート</span>' +
        '</span>' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-go="settings">開く</button>' +
      '</li>'
    );
  }

  function html(ctx) {
    return (
      '<div class="pd-home">' +
        startHtml(ctx) +
        unlockCardHtml(ctx) +
        gridHtml(ctx) +
        '<ul class="pd-home-rows">' +
          liveHtml(ctx) +
          speedHtml(ctx) +
          linksHtml() +
        '</ul>' +
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
    var btn = (typeof rootEl.querySelector === 'function') ? rootEl.querySelector('.pd-home-start') : null;
    if (btn && typeof btn.addEventListener === 'function') {
      btn.addEventListener('click', function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (typeof ctx.next === 'function') ctx.next();
      });
    }
  }

  return {
    render: render,
    // 補助（契約外・テスト用）
    startInfo: startInfo,
    stageLabel: stageLabel,
    html: html
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.home;
