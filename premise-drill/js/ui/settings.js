// premise-drill: PD.ui.settings（T13a）。設定画面。
//   API キー（pokerApiKey を暗記 SRS と共有）／モデル（pd_model。PD.judge.MODELS から選ぶ）／
//   Wizard bbfacing の確認結果（unknown/ok/ng）＋テストリンク2本（小数1桁・2桁）＋wizardBetDecimals／
//   追加欄の有効・無効（settings.extraFields[].enabled、退役スロットの再有効化）／
//   エクスポート・インポート（PD.store）／リセット（確認ダイアログ→PD.store.resetAll、pokerApiKey は残る）
// 構成（node で検証できるよう3層に分ける）：
//   html(ctx) -> string        純粋。document / window を使わない
//   apply(ctx, act, val)       状態と PD.store だけを触る。DOM を使わない
//   render(root, ctx)          イベント結線と DOM の差し替えだけ
// 他の UI モジュールを参照しない。状態は ctx（state / log / judgeState）と PD.store 経由でのみ触る。
// 再描画は構造変更（追加欄の再有効化・インポート・リセット）のときだけ。チップやステータスは in-place 更新。
// API キーは HTML 文字列に埋めない（入力欄は空で描き、保存済みかどうかと末尾4文字だけを示す）。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.ui.settings = (function () {
  'use strict';

  // ---- 依存解決（ブラウザは読込順で PD に揃っている。node では require で補う。無くても落とさない）----
  function dep(name, rel) {
    if (PD[name]) return PD[name];
    if (typeof require === 'function') {
      try { require(rel); } catch (e) { /* その環境に無い */ }
    }
    return PD[name] || null;
  }
  dep('util', '../util');
  dep('wizard', '../wizard');
  dep('store', '../store');
  dep('judge', '../judge');
  dep('sheet', '../sheet');
  dep('gaps', '../gaps');

  // ---- 定数 ----
  var BFACING = [
    { id: 'unknown', label: '未確認' },
    { id: 'ok', label: 'ok（着地した）' },
    { id: 'ng', label: 'ng（戻された）' }
  ];
  var DECIMALS = [
    { id: 1, label: '小数1桁' },
    { id: 2, label: '小数2桁' }
  ];
  var CARDS = ['claude', 'wizard', 'extra', 'data', 'reset'];
  var DEFAULT_MAX_EXTRA = 2;
  var DEFAULT_LOG_CAP = 600;
  var DEFAULT_MODEL = 'claude-opus-5';
  var EXPORT_WARN = 'この JSON は公開リポに置かない。自己申告した真値と票の中身がそのまま入る。';
  var RESET_CONFIRM = 'ドリルのデータ（状態・ログ・モデル設定）をすべて消す。API キーは残る。\n本当に消す？';

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // ---- 小道具 ----
  function esc(s) {
    if (PD.util && typeof PD.util.esc === 'function') return PD.util.esc(s);
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function has(obj, fn) { return !!obj && typeof obj[fn] === 'function'; }

  function store() { return PD.store || null; }

  function toast(ctx, msg) {
    if (ctx && typeof ctx.toast === 'function' && msg) ctx.toast(msg);
  }

  function todayStr() {
    if (PD.util && typeof PD.util.today === 'function') return PD.util.today();
    return new Date().toISOString().slice(0, 10);
  }

  function result(ok, msg, cards, data) {
    return { ok: !!ok, msg: msg || '', cards: cards || [], data: data === undefined ? null : data };
  }

  // ---------------------------------------------------------------------------
  // 状態の読み書き（ctx.state.settings のみ。書き込み後は PD.store.saveState）
  // ---------------------------------------------------------------------------

  function fallbackState() {
    return {
      version: 1, stage: 1,
      settings: { wizardNode: 'cb', wizardBfacing: 'unknown', wizardBetDecimals: 1, sizes: [33, 50],
                  extraFields: [], pendingExtra: [], speedUnlockedAt: null },
      recurrence: {}, familyStats: {},
      counters: { committed: 0, live: 0, speed: 0, liveToday: { date: todayStr(), n: 0 } }
    };
  }

  function ensureState(ctx) {
    if (!ctx.state || typeof ctx.state !== 'object') {
      ctx.state = has(store(), 'loadState') ? store().loadState() : fallbackState();
    }
    if (!ctx.state.settings || typeof ctx.state.settings !== 'object') ctx.state.settings = {};
    var s = ctx.state.settings;
    if (!Array.isArray(s.extraFields)) s.extraFields = [];
    if (!Array.isArray(s.pendingExtra)) s.pendingExtra = [];
    if (!Array.isArray(ctx.log)) ctx.log = [];
    return s;
  }

  function bfacingOf(s) {
    return (s.wizardBfacing === 'ok' || s.wizardBfacing === 'ng') ? s.wizardBfacing : 'unknown';
  }

  function decimalsOf(s) {
    return s.wizardBetDecimals === 2 ? 2 : 1;
  }

  function saveState(ctx) {
    var st = store();
    if (has(st, 'saveState')) st.saveState(ctx.state);
  }

  function reloadCtx(ctx) {
    var st = store();
    if (has(st, 'loadState')) ctx.state = st.loadState();
    if (has(st, 'loadLog')) ctx.log = st.loadLog() || [];
    ensureState(ctx);
  }

  /** キーの有無で judgeState を nokey ⇄ idle に合わせる（loading/done/error は触らない） */
  function syncJudgeState(ctx, hasKey) {
    if (!hasKey) ctx.judgeState = 'nokey';
    else if (ctx.judgeState === 'nokey' || !ctx.judgeState) ctx.judgeState = 'idle';
  }

  function currentKey() {
    var st = store();
    return has(st, 'getApiKey') ? (st.getApiKey() || '') : '';
  }

  function currentModel() {
    var st = store();
    return has(st, 'getModel') ? (st.getModel() || DEFAULT_MODEL) : DEFAULT_MODEL;
  }

  function modelList() {
    var j = PD.judge;
    return (j && Array.isArray(j.MODELS) && j.MODELS.length) ? j.MODELS.slice() : [{ id: DEFAULT_MODEL, label: DEFAULT_MODEL }];
  }

  function maxActiveExtra() {
    var u = PD.gaps && PD.gaps.UNLOCK;
    return (u && typeof u.maxActiveExtra === 'number') ? u.maxActiveExtra : DEFAULT_MAX_EXTRA;
  }

  function activeExtraCount(s) {
    var n = 0;
    for (var i = 0; i < s.extraFields.length; i++) {
      var x = s.extraFields[i];
      if (x && x.enabled && !x.retiredAt) n++;
    }
    return n;
  }

  function findExtra(s, id) {
    for (var i = 0; i < s.extraFields.length; i++) {
      if (s.extraFields[i] && s.extraFields[i].id === id) return s.extraFields[i];
    }
    return null;
  }

  function extraLabel(id) {
    var f = PD.sheet && PD.sheet.EXTRA_FIELDS && PD.sheet.EXTRA_FIELDS[id];
    return (f && f.label) ? f.label : String(id || '');
  }

  function gapLabel(gapId) {
    var list = PD.gaps && PD.gaps.GAP_TYPES;
    if (Array.isArray(list)) {
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === gapId) return list[i].label;
    }
    return String(gapId || '');
  }

  function logCap() {
    var st = store();
    return (st && typeof st.LOG_CAP === 'number') ? st.LOG_CAP : DEFAULT_LOG_CAP;
  }

  // ---------------------------------------------------------------------------
  // HTML（純粋。document を使わない）
  // ---------------------------------------------------------------------------

  function chip(act, val, label, on) {
    return '<button type="button" class="pd-chip' + (on ? ' on' : '') + '" data-act="' + esc(act) +
      '" data-val="' + esc(val) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(label) + '</button>';
  }

  function kicker(text) {
    return '<p class="pd-settings-kicker">' + esc(text) + '</p>';
  }

  /** 保存状況の表示。キー本体は出さない（末尾4文字だけ） */
  function keyStatusHTML(key) {
    if (!key) return '未設定';
    var tail = key.length > 8 ? key.slice(-4) : '';
    return '保存済み' + (tail ? '（末尾 <span class="pd-mono">' + esc(tail) + '</span>）' : '');
  }

  // ---- Claude（キー・モデル） ----
  function cardClaude(ctx) {
    var key = currentKey();
    var model = currentModel();
    var models = modelList();
    var known = false;
    var i;
    for (i = 0; i < models.length; i++) if (models[i] && models[i].id === model) known = true;
    if (!known && model) models.push({ id: model, label: model + '（現在の値）' });
    var opts = '';
    for (i = 0; i < models.length; i++) {
      var m = models[i];
      if (!m || !m.id) continue;
      opts += '<option value="' + esc(m.id) + '"' + (m.id === model ? ' selected' : '') + '>' + esc(m.label || m.id) + '</option>';
    }
    return '<section class="pd-card pd-settings-card" data-card="claude">' +
      kicker('Claude 採点') +
      '<h2>API キーとモデル</h2>' +
      '<label class="pd-settings-label" for="pd-settings-key">API キー（この端末の localStorage にだけ保存。暗記 SRS と共有）</label>' +
      '<div class="pd-settings-keyrow">' +
        '<input id="pd-settings-key" class="pd-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
          'placeholder="' + (key ? '置き換えるなら貼る' : 'sk-ant-… を貼る') + '" value="" data-role="key">' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-act="key-show" aria-pressed="false">表示</button>' +
      '</div>' +
      '<div class="pd-settings-row">' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="key-save">保存</button>' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-act="key-clear">削除</button>' +
        '<span class="pd-settings-status" data-role="key-status">' + keyStatusHTML(key) + '</span>' +
      '</div>' +
      '<label class="pd-settings-label" for="pd-settings-model">採点モデル</label>' +
      '<select id="pd-settings-model" class="pd-input" data-act="model">' + opts + '</select>' +
      '<p class="pd-small pd-mute pd-settings-note">採点は https で開いたときだけ呼べる。file:// ではキー無しの案内まで。</p>' +
    '</section>';
  }

  // ---- Wizard（bbfacing 確認・テストリンク2本・小数桁） ----
  function wizardStatusHTML(bf, dec) {
    if (bf === 'ok') {
      return 'Truth では <b>BB 応答ノード（小数' + dec + '桁）</b>が主リンクになる。';
    }
    if (bf === 'ng') {
      return 'ng を記録中。もう一方の桁で試すか、<b>CB ノード＋サイズを1クリック</b>で BB 応答を見る。';
    }
    return 'Truth では確認済みの <b>CB ノード</b>が主リンク。BB 応答ノード直リンクは「要確認」の副リンク。';
  }

  function testLink(n, url) {
    var label = 'テストリンクを開く（K75r 33%・小数' + n + '桁）';
    if (!url) {
      return '<span class="pd-btn pd-btn-block" aria-disabled="true" data-role="testlink-' + n + '">' + esc(label) + '</span>';
    }
    return '<a class="pd-btn pd-btn-truth pd-btn-block" href="' + esc(url) + '" target="_blank" rel="noopener" data-role="testlink-' + n + '">' +
      esc(label) + '</a>';
  }

  function cardWizard(ctx) {
    var s = ensureState(ctx);
    var bf = bfacingOf(s);
    var dec = decimalsOf(s);
    var w = PD.wizard;
    var u1 = has(w, 'testUrl') ? w.testUrl(1) : null;
    var u2 = has(w, 'testUrl') ? w.testUrl(2) : null;
    var i, chips = '';
    for (i = 0; i < BFACING.length; i++) chips += chip('bfacing', BFACING[i].id, BFACING[i].label, BFACING[i].id === bf);
    var decs = '';
    for (i = 0; i < DECIMALS.length; i++) decs += chip('decimals', DECIMALS[i].id, DECIMALS[i].label, DECIMALS[i].id === dec);
    return '<section class="pd-card pd-settings-card" data-card="wizard">' +
      kicker('GTO Wizard') +
      '<h2>BB 応答ノードの直リンク確認</h2>' +
      '<p class="pd-small pd-mute">BB 応答ノードへ直接着地する形式はまだ実機で未確認。下の2本を開き、BB の応答ノードに着地したら「ok」、CB ノードや別の場所へ戻されたら「ng」を記録する。ok になった桁を小数桁に選ぶ。</p>' +
      '<div class="pd-settings-links">' + testLink(1, u1) + testLink(2, u2) + '</div>' +
      '<div class="pd-settings-group" role="group" aria-label="確認結果">' +
        '<span class="pd-settings-label">確認結果</span>' +
        '<div class="pd-settings-chips" data-role="bfacing">' + chips + '</div>' +
      '</div>' +
      '<div class="pd-settings-group" role="group" aria-label="bet の小数桁">' +
        '<span class="pd-settings-label">bet の小数桁（33/50% 以外のサイズ用。URL の R1.8 / R1.82）</span>' +
        '<div class="pd-settings-chips" data-role="decimals">' + decs + '</div>' +
      '</div>' +
      '<p class="pd-settings-status" data-role="wizard-status">' + wizardStatusHTML(bf, dec) + '</p>' +
    '</section>';
  }

  // ---- 追加欄 ----
  function extraItemHTML(x, canRevive) {
    var fams = Array.isArray(x.families) ? x.families : [];
    var famHTML = '';
    for (var i = 0; i < fams.length; i++) {
      famHTML += (i ? ' ' : '') + '<span class="pd-mono pd-settings-fam">' + esc(fams[i]) + '</span>';
    }
    var retired = !!x.retiredAt;
    var meta = '<span>型：' + esc(gapLabel(x.gap)) + '</span>' +
      (famHTML ? '<span>由来：' + famHTML + '</span>' : '') +
      (x.addedAt ? '<span>追加 ' + esc(x.addedAt) + '</span>' : '');
    var control;
    if (retired) {
      control = '<span class="pd-settings-badge">退役 ' + esc(x.retiredAt) + '</span>' +
        '<button type="button" class="pd-btn pd-btn-ghost pd-settings-revive" data-act="extra-revive" data-id="' + esc(x.id) + '"' +
        (canRevive ? '' : ' disabled aria-disabled="true"') + '>再有効化</button>';
    } else {
      control = '<label class="pd-settings-switch">' +
        '<input type="checkbox" data-act="extra-toggle" data-id="' + esc(x.id) + '"' + (x.enabled ? ' checked' : '') + '>' +
        '<span class="pd-settings-track" aria-hidden="true"></span>' +
        '<span class="pd-sr">この欄を有効にする</span>' +
      '</label>';
    }
    return '<li class="pd-settings-extra-item' + (retired ? ' is-retired' : '') + '" data-id="' + esc(x.id) + '">' +
      '<div class="pd-settings-extra-main">' +
        '<div class="pd-settings-extra-label">' + esc(extraLabel(x.id)) + '</div>' +
        '<div class="pd-settings-extra-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="pd-settings-extra-ctl">' + control + '</div>' +
    '</li>';
  }

  function cardExtra(ctx) {
    var s = ensureState(ctx);
    var list = s.extraFields;
    var pend = s.pendingExtra;
    var max = maxActiveExtra();
    var active = activeExtraCount(s);
    var canRevive = active < max;
    var body;
    if (!list.length) {
      body = '<p class="pd-settings-empty pd-mute">まだ無い。同じ型×族で2回ズレると、次の Drill から欄が1つ増える。</p>';
    } else {
      var items = '';
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id) items += extraItemHTML(list[i], canRevive);
      }
      body = '<ul class="pd-settings-extra">' + items + '</ul>';
    }
    var pendHTML = '';
    if (pend.length) {
      var rows = '';
      for (var j = 0; j < pend.length; j++) {
        var p = pend[j];
        if (!p || !p.id) continue;
        rows += '<li><span>' + esc(extraLabel(p.id)) + '</span>' +
          '<span class="pd-settings-extra-meta"><span>型：' + esc(gapLabel(p.gap)) + '</span>' +
          (p.family ? '<span>由来：<span class="pd-mono pd-settings-fam">' + esc(p.family) + '</span></span>' : '') +
          (p.since ? '<span>' + esc(p.since) + ' から</span>' : '') + '</span></li>';
      }
      pendHTML = '<h3 class="pd-settings-sub">提案待ち</h3>' +
        '<p class="pd-small pd-mute">有効枠（' + max + '）が塞がっている間は表示だけ。枠が空くと先頭から昇格する。</p>' +
        '<ul class="pd-settings-pending">' + rows + '</ul>';
    }
    return '<section class="pd-card pd-settings-card" data-card="extra">' +
      kicker('前提票') +
      '<div class="pd-settings-h"><h2>追加欄</h2><span class="pd-settings-status">有効 <b data-role="extra-active">' + active + '</b> / ' + max + '</span></div>' +
      body + pendHTML +
    '</section>';
  }

  // ---- データ（エクスポート・インポート） ----
  function cardData(ctx) {
    var n = Array.isArray(ctx.log) ? ctx.log.length : 0;
    return '<section class="pd-card pd-settings-card" data-card="data">' +
      kicker('データ') +
      '<h2>エクスポート・インポート</h2>' +
      '<p class="pd-settings-status">保存済みログ <b data-role="log-count">' + n + '</b> 件（上限 ' + logCap() + ' 件。超えると古い順に間引く）</p>' +
      '<div class="pd-settings-warn" role="note">' + esc(EXPORT_WARN) + '</div>' +
      '<div class="pd-settings-row">' +
        '<button type="button" class="pd-btn pd-btn-truth" data-act="export">エクスポート JSON を作る</button>' +
      '</div>' +
      '<div class="pd-settings-export" data-role="export-box" hidden>' +
        '<label class="pd-settings-label" for="pd-settings-export-out">エクスポート結果</label>' +
        '<textarea id="pd-settings-export-out" class="pd-input pd-settings-json" readonly data-role="export-out" rows="6"></textarea>' +
        '<div class="pd-settings-row">' +
          '<button type="button" class="pd-btn" data-act="export-copy">コピー</button>' +
          '<button type="button" class="pd-btn" data-act="export-download">ダウンロード</button>' +
        '</div>' +
      '</div>' +
      '<h3 class="pd-settings-sub">インポート</h3>' +
      '<p class="pd-small pd-mute">エクスポート JSON を貼るか、ファイルを選ぶ。ログは id で重複を除いて統合し、格子は取り込んだログから再計算する。</p>' +
      '<label class="pd-sr" for="pd-settings-import-in">インポートする JSON</label>' +
      '<textarea id="pd-settings-import-in" class="pd-input pd-settings-json" data-role="import-in" rows="4" placeholder="{&quot;v&quot;:1, …}"></textarea>' +
      '<div class="pd-settings-row">' +
        '<button type="button" class="pd-btn" data-act="import">取り込む</button>' +
        '<label class="pd-btn pd-btn-ghost pd-settings-file">ファイルを選ぶ' +
          '<input type="file" accept=".json,application/json" data-act="import-file">' +
        '</label>' +
      '</div>' +
    '</section>';
  }

  // ---- リセット ----
  function cardReset() {
    return '<section class="pd-card pd-settings-card" data-card="reset">' +
      kicker('リセット') +
      '<h2>ドリルのデータを消す</h2>' +
      '<p class="pd-small pd-mute">状態・ログ・モデル設定（pd_ のキー）を消す。API キーは残る。消す前にエクスポートしておく。</p>' +
      '<button type="button" class="pd-btn pd-settings-danger" data-act="reset">すべて消去</button>' +
    '</section>';
  }

  function cardHTML(ctx, name) {
    switch (name) {
      case 'claude': return cardClaude(ctx);
      case 'wizard': return cardWizard(ctx);
      case 'extra': return cardExtra(ctx);
      case 'data': return cardData(ctx);
      case 'reset': return cardReset(ctx);
      default: return '';
    }
  }

  /** PD.ui.settings.html(ctx) -> string（純粋） */
  function html(ctx) {
    ctx = ctx || {};
    ensureState(ctx);
    var out = '';
    for (var i = 0; i < CARDS.length; i++) out += cardHTML(ctx, CARDS[i]);
    return out + '<p class="pd-settings-foot"><button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホームへ戻る</button></p>';
  }

  // ---------------------------------------------------------------------------
  // 操作（状態と store だけ。DOM を使わない）
  // ---------------------------------------------------------------------------

  function actKeySave(ctx, val) {
    var st = store();
    var key = (val === null || val === undefined) ? '' : String(val).trim();
    if (!key) return result(false, 'キーが空。消すときは「削除」を押す');
    if (!has(st, 'setApiKey')) return result(false, '保存先（store）が見つからない');
    st.setApiKey(key);
    var saved = currentKey();
    syncJudgeState(ctx, !!saved);
    return result(!!saved, saved ? 'API キーを保存した' : 'API キーを保存できなかった');
  }

  function actKeyClear(ctx) {
    var st = store();
    if (has(st, 'setApiKey')) st.setApiKey('');
    syncJudgeState(ctx, false);
    return result(true, 'API キーを削除した');
  }

  function actModel(ctx, val) {
    var st = store();
    var id = (val === null || val === undefined) ? '' : String(val).trim();
    if (!id) return result(false, 'モデルが空');
    if (!has(st, 'setModel')) return result(false, '保存先（store）が見つからない');
    st.setModel(id);
    return result(true, '採点モデルを ' + currentModel() + ' にした');
  }

  function actBfacing(ctx, val) {
    var s = ensureState(ctx);
    s.wizardBfacing = (val === 'ok' || val === 'ng') ? val : 'unknown';
    // ok のときだけ BB 応答ノードが主リンク（SPEC ②）。wizardNode も合わせておく
    s.wizardNode = s.wizardBfacing === 'ok' ? 'bbfacing' : 'cb';
    saveState(ctx);
    return result(true, 'Wizard の確認結果を「' + s.wizardBfacing + '」にした');
  }

  function actDecimals(ctx, val) {
    var s = ensureState(ctx);
    s.wizardBetDecimals = (String(val) === '2') ? 2 : 1;
    saveState(ctx);
    return result(true, 'bet の小数桁を ' + s.wizardBetDecimals + ' 桁にした');
  }

  /** val = { id, enabled } */
  function actExtraToggle(ctx, val) {
    var s = ensureState(ctx);
    var id = val && val.id;
    var x = findExtra(s, id);
    if (!x) return result(false, 'その欄は無い');
    if (x.retiredAt) return result(false, '退役した欄は「再有効化」で戻す');
    x.enabled = !!(val && val.enabled);
    saveState(ctx);
    return result(true, '「' + extraLabel(id) + '」を' + (x.enabled ? '有効' : '無効') + 'にした');
  }

  function actExtraRevive(ctx, id) {
    var s = ensureState(ctx);
    var x = findExtra(s, id);
    if (!x) return result(false, 'その欄は無い');
    if (!x.retiredAt) return result(false, 'その欄は退役していない');
    if (activeExtraCount(s) >= maxActiveExtra()) {
      return result(false, '有効枠（' + maxActiveExtra() + '）が塞がっている。先にどれかを無効にする');
    }
    x.retiredAt = null;
    x.enabled = true;
    saveState(ctx);
    return result(true, '「' + extraLabel(id) + '」を再有効化した', ['extra']);
  }

  function actExport(ctx) {
    var st = store();
    if (!has(st, 'exportJSON')) return result(false, 'エクスポート先（store）が見つからない');
    var text = st.exportJSON();
    return result(true, 'エクスポート JSON を作った（' + Math.round(text.length / 1024) + ' KB）', [], text);
  }

  function actImport(ctx, text) {
    var st = store();
    if (!text || !String(text).trim()) return result(false, 'JSON が空');
    if (!has(st, 'importJSON')) return result(false, 'インポート先（store）が見つからない');
    var r = st.importJSON(String(text));
    var msg = r && r.msg ? r.msg : (r && r.ok ? '取り込んだ' : '取り込めなかった');
    if (!r || !r.ok) return result(false, msg);
    reloadCtx(ctx);
    return result(true, msg, ['extra', 'data'], { added: r.added, skipped: r.skipped });
  }

  /** 確認ダイアログは render 側。ここは消すだけ（pokerApiKey は store.resetAll が残す） */
  function actReset(ctx) {
    var st = store();
    if (!has(st, 'resetAll')) return result(false, 'store が見つからない');
    st.resetAll();
    ctx.state = null;
    reloadCtx(ctx);
    syncJudgeState(ctx, !!currentKey());
    return result(true, 'ドリルのデータを消した（API キーは残っている）', CARDS.slice());
  }

  /**
   * PD.ui.settings.apply(ctx, act, val) -> { ok, msg, cards, data }
   *   cards: 作り直すべきカード名（構造変更のとき）。data: export の JSON 文字列など
   */
  function apply(ctx, act, val) {
    ctx = ctx || {};
    ensureState(ctx);
    switch (act) {
      case 'key-save': return actKeySave(ctx, val);
      case 'key-clear': return actKeyClear(ctx);
      case 'model': return actModel(ctx, val);
      case 'bfacing': return actBfacing(ctx, val);
      case 'decimals': return actDecimals(ctx, val);
      case 'extra-toggle': return actExtraToggle(ctx, val);
      case 'extra-revive': return actExtraRevive(ctx, val);
      case 'export': return actExport(ctx);
      case 'import': return actImport(ctx, val);
      case 'reset': return actReset(ctx);
      default: return result(false, '未知の操作：' + String(act));
    }
  }

  // ---------------------------------------------------------------------------
  // DOM（render 側だけ）
  // ---------------------------------------------------------------------------

  function q(el, sel) { return el ? el.querySelector(sel) : null; }

  function setChips(group, val) {
    if (!group) return;
    var chips = group.querySelectorAll('[data-val]');
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].getAttribute('data-val') === String(val);
      chips[i].classList.toggle('on', on);
      chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function syncWizard(el, ctx) {
    var s = ensureState(ctx);
    setChips(q(el, '[data-role="bfacing"]'), bfacingOf(s));
    setChips(q(el, '[data-role="decimals"]'), decimalsOf(s));
    var st = q(el, '[data-role="wizard-status"]');
    if (st) st.innerHTML = wizardStatusHTML(bfacingOf(s), decimalsOf(s));
  }

  function syncKey(el) {
    var key = currentKey();
    var st = q(el, '[data-role="key-status"]');
    if (st) st.innerHTML = keyStatusHTML(key);
    var input = q(el, '[data-role="key"]');
    if (input) {
      input.value = '';
      input.placeholder = key ? '置き換えるなら貼る' : 'sk-ant-… を貼る';
    }
  }

  function syncExtraCount(el, ctx) {
    var cnt = q(el, '[data-role="extra-active"]');
    if (cnt) cnt.textContent = String(activeExtraCount(ensureState(ctx)));
  }

  /** 1枚のカードだけ作り直す（イベントは el にデリゲートしているので差し替えてよい） */
  function replaceCard(el, ctx, name) {
    var old = q(el, '[data-card="' + name + '"]');
    if (!old) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = cardHTML(ctx, name);
    var next = tmp.firstElementChild;
    if (next) old.parentNode.replaceChild(next, old);
  }

  function applyCards(el, ctx, cards) {
    for (var i = 0; i < cards.length; i++) replaceCard(el, ctx, cards[i]);
  }

  function onKeyShow(el, btn) {
    var input = q(el, '[data-role="key"]');
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.textContent = show ? '隠す' : '表示';
  }

  function copyText(text, ta) {
    var nav = root.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard.writeText(text).then(function () { return true; }, function () { return copyFallback(ta); });
    }
    return Promise.resolve(copyFallback(ta));
  }

  function copyFallback(ta) {
    try {
      if (!ta) return false;
      ta.focus();
      ta.select();
      return !!document.execCommand('copy');
    } catch (e) { return false; }
  }

  function onExport(el, ctx) {
    var r = apply(ctx, 'export');
    if (r.ok) {
      var box = q(el, '[data-role="export-box"]');
      var out = q(el, '[data-role="export-out"]');
      if (out) out.value = r.data;
      if (box) box.hidden = false;
    }
    toast(ctx, r.msg);
  }

  function onExportCopy(el, ctx) {
    var out = q(el, '[data-role="export-out"]');
    var text = out ? out.value : '';
    if (!text) { toast(ctx, '先に「エクスポート JSON を作る」を押す'); return; }
    copyText(text, out).then(function (ok) {
      toast(ctx, ok ? 'コピーした' : 'コピーできなかった。テキストを選択して手で控える');
    });
  }

  function onExportDownload(el, ctx) {
    var out = q(el, '[data-role="export-out"]');
    var text = out ? out.value : '';
    if (!text) { toast(ctx, '先に「エクスポート JSON を作る」を押す'); return; }
    if (typeof Blob === 'undefined' || !root.URL || typeof root.URL.createObjectURL !== 'function') {
      toast(ctx, 'この環境ではダウンロードできない。コピーを使う');
      return;
    }
    var blob = new Blob([text], { type: 'application/json' });
    var url = root.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'premise-drill-' + todayStr() + '.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      try { root.URL.revokeObjectURL(url); } catch (e) { /* 無視 */ }
    }, 1000);
    toast(ctx, a.download + ' を保存した');
  }

  function onImportText(el, ctx, text) {
    var r = apply(ctx, 'import', text);
    if (r.ok) applyCards(el, ctx, r.cards);
    toast(ctx, r.msg);
  }

  function onImportFile(el, ctx, input) {
    var f = input && input.files && input.files[0];
    if (!f) return;
    if (typeof FileReader === 'undefined') { toast(ctx, 'この環境ではファイルを読めない。貼り付けを使う'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var ta = q(el, '[data-role="import-in"]');
      if (ta) ta.value = String(reader.result || '');
      onImportText(el, ctx, reader.result);
      try { input.value = ''; } catch (e) { /* 一部ブラウザで不可 */ }
    };
    reader.onerror = function () { toast(ctx, 'ファイルを読めなかった'); };
    reader.readAsText(f);
  }

  function onReset(el, ctx) {
    var ok = (typeof root.confirm === 'function') ? root.confirm(RESET_CONFIRM) : false;
    if (!ok) return;
    var r = apply(ctx, 'reset');
    if (r.ok) {
      var host = el.parentNode;
      if (host) render(host, ctx);
    }
    toast(ctx, r.msg);
  }

  function onClick(el, ctx, act, target) {
    var r;
    switch (act) {
      case 'key-show':
        onKeyShow(el, target);
        return;
      case 'key-save': {
        var input = q(el, '[data-role="key"]');
        r = apply(ctx, 'key-save', input ? input.value : '');
        if (r.ok) syncKey(el);
        toast(ctx, r.msg);
        return;
      }
      case 'key-clear':
        r = apply(ctx, 'key-clear');
        syncKey(el);
        toast(ctx, r.msg);
        return;
      case 'bfacing':
      case 'decimals':
        r = apply(ctx, act, target.getAttribute('data-val'));
        syncWizard(el, ctx);
        toast(ctx, r.msg);
        return;
      case 'extra-revive':
        r = apply(ctx, 'extra-revive', target.getAttribute('data-id'));
        if (r.ok) applyCards(el, ctx, r.cards);
        toast(ctx, r.msg);
        return;
      case 'export': onExport(el, ctx); return;
      case 'export-copy': onExportCopy(el, ctx); return;
      case 'export-download': onExportDownload(el, ctx); return;
      case 'import': {
        var ta = q(el, '[data-role="import-in"]');
        onImportText(el, ctx, ta ? ta.value : '');
        return;
      }
      case 'reset': onReset(el, ctx); return;
      default: return;
    }
  }

  function onChange(el, ctx, act, target) {
    var r;
    if (act === 'model') {
      r = apply(ctx, 'model', target.value);
      toast(ctx, r.msg);
    } else if (act === 'extra-toggle') {
      r = apply(ctx, 'extra-toggle', { id: target.getAttribute('data-id'), enabled: target.checked });
      if (r.ok) syncExtraCount(el, ctx);
      else target.checked = !target.checked;
      toast(ctx, r.msg);
    } else if (act === 'import-file') {
      onImportFile(el, ctx, target);
    }
  }

  // change で扱う data-act（click では素通しして既定動作を残す）
  var CHANGE_ACTS = { model: true, 'extra-toggle': true, 'import-file': true };

  function bind(el, ctx) {
    el.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var a = t.closest('[data-act]');
      if (!a || !el.contains(a)) return;
      var act = a.getAttribute('data-act');
      if (CHANGE_ACTS[act]) return;
      ev.preventDefault();
      if (a.disabled || a.getAttribute('aria-disabled') === 'true') return;
      onClick(el, ctx, act, a);
    });
    el.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || typeof t.getAttribute !== 'function') return;
      var act = t.getAttribute('data-act');
      if (act && CHANGE_ACTS[act]) onChange(el, ctx, act, t);
    });
  }

  // ---------------------------------------------------------------------------
  // 公開
  // ---------------------------------------------------------------------------

  /** PD.ui.settings.render(root, ctx) */
  function render(rootEl, ctx) {
    if (!rootEl || typeof document === 'undefined') return;
    ctx = ctx || {};
    ensureState(ctx);
    var el = document.createElement('div');
    el.className = 'pd-settings';
    el.innerHTML = html(ctx);
    bind(el, ctx);
    rootEl.innerHTML = '';
    rootEl.appendChild(el);
  }

  return {
    render: render,
    // 契約外（結合・検証用）：純粋な HTML 生成と、DOM を使わない操作
    html: html,
    apply: apply,
    _html: html,
    BFACING: BFACING,
    DECIMALS: DECIMALS,
    EXPORT_WARN: EXPORT_WARN
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.settings;
