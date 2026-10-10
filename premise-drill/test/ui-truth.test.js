// premise-drill: PD.ui.truth の純粋部分（html(ctx) の文字列生成・判定）のテスト（T10）。jsdom 無し。
// 実行: node test/run.js ui-truth
// ブラウザ受入（遷移・クリック・localStorage 実機）は結合担当が別途行う。ここは node で返る文字列だけを検査する。
'use strict';

var path = require('path');
var sheet = require(path.join(__dirname, '..', 'js', 'sheet.js'));
var store = require(path.join(__dirname, '..', 'js', 'store.js'));
var gaps = require(path.join(__dirname, '..', 'js', 'gaps.js'));
var truth = require(path.join(__dirname, '..', 'js', 'ui', 'truth.js'));

// モック Spot（T2 のラベル文字列は使わない）
function mockSpot(over) {
  var sp = {
    id: 's_test', seed: 1, node: 'BTN2.5-BBcall-x-cb', villainPos: 'BTN', pre: 'F-F-F-R2.5-F-C',
    board: 'Ks7d5c', cls: 'dry_high', suit: 'rainbow', connected: false, hmsd: false,
    size: 33, pot: 5.5, bet: 1.82, hero: 'Ad4d', heroPool: 'A_lowkick_s', family: 'dry_high_33'
  };
  for (var k in (over || {})) sp[k] = over[k];
  return sp;
}

// 充足済みの票（暗記値の確認は gaps.BASELINE_FOLD を参照し、ここに数字を固定しない）
function filledValues() {
  var v = sheet.emptyValues();
  v.f1.foldPct = gaps.BASELINE_FOLD[33];
  v.f2 = { trash: 50, hi: 20, pairPlus: 30 };
  v.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
  v.f4 = { pureAirPct: 50, enough: true, foldList: ['J2o', 'T5o', 'Q7o'], nextLayer: [] };
  v.f5 = { bdfd: true, bdsd: true, gut: false, oesd: false, kickerNote: '', position: 'edge', action: 'fold', confidence: 80 };
  return v;
}

function mockEntry(over) {
  var e = {
    id: 'e_test', mode: 'drill', tempo: 'slow', spot: mockSpot(), sheet: filledValues(), hints: [],
    commit: { order: ['f1', 'f2', 'f3', 'f4', 'f5'], fieldTimes: { f1: 1, f2: 2, f3: 3, f4: 4, f5: 5 }, elapsedMs: 61000, confidence: 80 },
    truth: null, selfScore: null, gap: null
  };
  for (var k in (over || {})) e[k] = over[k];
  return e;
}

/** localStorage スタブ（他テストが残した pd_state_v1 に依存しないよう、run の冒頭で空のものを入れる） */
function makeStub() {
  var data = {};
  var stub = {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem: function (key, val) { data[key] = String(val); },
    removeItem: function (key) { delete data[key]; },
    clear: function () { throw new Error('localStorage.clear() を呼んではいけない'); },
    key: function (i) { return Object.keys(data)[i] || null; },
    _data: data
  };
  Object.defineProperty(stub, 'length', { get: function () { return Object.keys(data).length; } });
  return stub;
}

function installStub(value) {
  Object.defineProperty(globalThis, 'localStorage', { value: value, configurable: true, writable: true });
}

function ctxWith(entry, over) {
  var st = store.loadState();
  var c = {
    state: st, log: [], view: 'truth', mode: 'drill', tempo: 'slow', reason: 'random',
    spot: entry ? entry.spot : null, fields: sheet.buildSheet([], 'slow'), sheet: entry ? entry.sheet : sheet.emptyValues(),
    hints: [], startedAt: 1, timer: null, pairNext: null, entry: entry, judgeState: 'nokey',
    go: function () {}, commit: function () {}, saveOutcome: function () {}, next: function () {}, toast: function () {}
  };
  for (var k in (over || {})) c[k] = over[k];
  return c;
}

function attrOf(html, re) {
  var m = html.match(re);
  return m ? m[1] : null;
}

module.exports = {
  name: 'ui-truth（PD.ui.truth の純粋部分）',
  run: function (assert) {
    // 他テスト（ui-settings 等）が localStorage スタブに残した設定（wizardBfacing:'ok' 等）に依存しない
    installStub(makeStub());
    store.resetAll();
    assert.strictEqual(store.loadState().settings.wizardBfacing, 'unknown', '既定の state から始める');

    // ---- require と公開 API：document 無しで読み込め、html(ctx) が文字列を返す ----
    assert.strictEqual(typeof truth.render, 'function');
    assert.strictEqual(typeof truth.html, 'function');
    assert.strictEqual(typeof truth._pure, 'object');
    assert.strictEqual(truth.render(null, ctxWith(mockEntry())), undefined, 'render(null, ctx) は例外を出さない');

    // ---- entry 無し：案内カード（コミット前に真値へ入れない）----
    var hb = truth.html(ctxWith(null));
    assert.strictEqual(typeof hb, 'string');
    assert.ok(hb.indexOf('data-role="truth-blocked"') >= 0, 'entry 無しは案内カード');
    assert.ok(hb.indexOf('data-role="truth-view"') < 0);
    assert.ok(hb.indexOf('gtowizard') < 0, 'コミット前に Wizard リンクを出さない');
    assert.strictEqual(typeof truth.html(), 'string', 'ctx 無しでも文字列');

    // ---- 通常：封印票ヘッダに cls ラベル、Wizard 主（cb・確認済）／副（bbfacing・要確認）----
    var ctx = ctxWith(mockEntry());
    var h = truth.html(ctx);
    assert.strictEqual(typeof h, 'string');
    assert.ok(h.indexOf('data-role="truth-view"') >= 0);
    assert.ok(/<h2 class="pd-truth-cls" data-role="cls">ドライ・ハイカード・レインボー<\/h2>/.test(h), 'cls ラベルを初表示');
    assert.ok(h.indexOf('封印済み') >= 0);
    assert.ok(h.indexOf('Ks7d5c') >= 0 && h.indexOf('Ad4d') >= 0);
    var mainHref = attrOf(h, /data-wizard="main" data-node="cb" href="([^"]+)"/);
    assert.ok(mainHref, '主リンクは cb ノード');
    assert.strictEqual(mainHref,
      'https://app.gtowizard.com/solutions?gametype=Cash6m50zGeneral&amp;depth=100&amp;soltab=strategy&amp;preflop_actions=F-F-F-R2.5-F-C&amp;flop_actions=X&amp;history_spot=7&amp;board=Ks7d5c',
      'href は T4 の形式（& はエスケープ）');
    assert.ok(/data-wizard="main"[^>]*target="_blank" rel="noopener"/.test(h), '新規タブ・noopener');
    var subHref = attrOf(h, /data-wizard="sub" data-node="bbfacing" href="([^"]+)"/);
    assert.ok(subHref && subHref.indexOf('flop_actions=X-B1.8&amp;history_spot=8') >= 0, '副は bbfacing（既定1桁）');
    assert.ok(/data-wizard="sub"[\s\S]*?要確認/.test(h), '副リンクに要確認タグ');

    // ---- settings.wizardBfacing==='ok' かつ 2桁 → bbfacing が主・B1.82 ----
    var ctxOk = ctxWith(mockEntry());
    ctxOk.state.settings.wizardBfacing = 'ok';
    ctxOk.state.settings.wizardBetDecimals = 2;
    var hOk = truth.html(ctxOk);
    var mainOk = attrOf(hOk, /data-wizard="main" data-node="bbfacing" href="([^"]+)"/);
    assert.ok(mainOk && mainOk.indexOf('X-B1.82') >= 0, 'ok 設定で bbfacing が主、bet 2桁');
    assert.ok(/data-wizard="sub" data-node="cb"/.test(hOk));

    // ---- 真値未入力：保存バーは未入力・ボタン disabled ----
    assert.ok(/data-role="save-msg"[^>]*data-ok="0">未入力：真値・自己採点（残り 4 項目）/.test(h), '未入力の内訳');
    assert.ok(/data-act="save" disabled>/.test(h), '保存ボタン disabled');
    assert.ok(h.indexOf('data-role="hero-sum">自手の合計 —') >= 0);
    assert.ok(/data-role="truth-msg" aria-live="polite"><\/p>/.test(h), '触っていなければ未充足メッセージは空');

    // ---- 自己採点：○候補（暗記値基準）と真値差（参考）、合計 ----
    assert.ok(/data-score="sizeFold" data-val="2" aria-pressed="false" data-cand="1"/.test(h), '①＝暗記値 → サイズ2候補');
    assert.ok(h.indexOf('真値との差 —（真値未入力）') >= 0);
    assert.ok(h.indexOf('data-role="cand-action">真値（自手 fold%）を入れると候補が出る') >= 0);
    assert.ok(h.indexOf('data-role="self-total">—/10') >= 0);
    assert.ok(h.indexOf('入力順 f1→f2→f3→f4→f5') >= 0);

    // ---- Claude ブロック：キー無しは案内文 ----
    assert.ok(/data-role="claude" data-state="nokey"/.test(h));
    assert.ok(h.indexOf('data-role="claude-nokey"') >= 0, 'キー無し案内');
    assert.ok(h.indexOf('data-act="judge"') < 0, 'キー無しでは採点ボタンを出さない');

    // ---- 事後検算：④が非単調（J2o→T5o→Q7o）なら rank 注記なし、⑤の2枚チェックは一致 ----
    assert.ok(h.indexOf('data-role="post"') >= 0);
    assert.ok(h.indexOf('<li data-kind="rank">') < 0, '④ J2o→T5o→Q7o は非単調 → 注記なし');
    assert.ok(h.indexOf('<li data-kind="hero">') < 0, '⑤ bdfd/bdsd 一致なら差分なし');
    assert.ok(/<li data-kind="ok">/.test(h), '注記が無ければ「差分なし」');

    // ---- 型：手がかり無しなら none（初期値表示）。チップは GAP_TYPES 全件 ----
    gaps.GAP_TYPES.forEach(function (g) {
      assert.ok(h.indexOf('data-gap="' + g.id + '"') >= 0, '型チップ ' + g.id);
    });
    assert.ok(h.indexOf('data-role="gap-src">初期値：ズレなし') >= 0);
    assert.strictEqual(ctx.entry.gap, 'none');

    // ---- ④が単調（Q7o→J2o→T5o）→ rank 注記、⑤の2枚チェック不一致 → hero 注記、型の初期値は手がかりから ----
    var vr = filledValues();
    vr.f4.foldList = ['Q7o', 'J2o', 'T5o'];
    vr.f5.bdfd = false; // Ad4d on Ks7d5c は BDFD 有 → 票と不一致
    var er = mockEntry({ sheet: vr });
    var hr = truth.html(ctxWith(er));
    assert.ok(/<li data-kind="rank">/.test(hr), '④ 単調 → 注記');
    assert.ok(/<li data-kind="hero">[^<]*BDFD（票：無／実際：有）/.test(hr), '⑤ の差を表示');
    assert.ok(hr.indexOf('<li data-kind="ok">') < 0);
    var expected = gaps.hintFor(er, []).suggest;
    assert.ok(expected, 'hintFor が手がかりを返す前提');
    assert.strictEqual(er.gap, expected, '初期値は hintFor の第1候補');
    assert.ok(hr.indexOf('data-role="gap-src">初期値：手がかりから') >= 0);
    assert.ok(new RegExp('data-gap="' + expected + '" aria-pressed="true"').test(hr));
    assert.ok(hr.indexOf('<li><b>') >= 0, '手がかりの理由を列挙');

    // ---- 真値・自己採点を入れると保存できる。○候補 action、真値差 ±0 ----
    var e2 = mockEntry({
      truth: { used: true, rangeFoldPct: gaps.BASELINE_FOLD[33], heroFold: 60, heroCall: 40, heroRaise: 0, buckets: { trash: null, hi: null, pairPlus: null }, note: '<b>x</b>' },
      selfScore: { procedure: 3, sizeFold: 2, drawProtect: 4, action: 1, total: 10 }
    });
    var ctx2 = ctxWith(e2);
    var h2 = truth.html(ctx2);
    assert.ok(/data-role="save-msg"[^>]*data-ok="1">保存できる</.test(h2), '保存できる');
    assert.ok(/data-act="save">保存</.test(h2), '保存ボタン enabled');
    assert.ok(h2.indexOf('data-role="hero-sum">自手の合計 100%') >= 0);
    assert.ok(/data-score="action" data-val="1" aria-pressed="true" data-cand="1"/.test(h2), '⑤fold と真値 fold60 → 答え1候補');
    assert.ok(h2.indexOf('真値との差 ±0 pt（参考）') >= 0);
    assert.ok(h2.indexOf('data-role="self-total">10/10') >= 0);
    assert.ok(h2.indexOf('&lt;b&gt;x&lt;/b&gt;') >= 0 && h2.indexOf('<b>x</b>') < 0, '学習者入力はエスケープ');
    assert.strictEqual(e2.gap, 'none', '手がかり無しの初期値は none');

    // ---- 真値の合計が 100±5 を外れる → 未充足表示・保存不可 ----
    var e3 = mockEntry({ truth: { used: true, rangeFoldPct: 30, heroFold: 60, heroCall: 60, heroRaise: 0, buckets: {}, note: '' } });
    var h3 = truth.html(ctxWith(e3));
    assert.ok(/pd-truth-sum pd-truth-sum-ng" data-role="hero-sum">自手の合計 120%/.test(h3));
    assert.ok(/data-role="truth-msg" aria-live="polite">未充足：自手の合計が 100±5 でない（現在 120）/.test(h3));
    assert.ok(/data-act="save" disabled>/.test(h3));

    // ---- Claude done：結果表示・自己採点と3点以上離れたら分岐カード ----
    var e4 = mockEntry({
      truth: { used: true, rangeFoldPct: 30, heroFold: 60, heroCall: 40, heroRaise: 0, buckets: {}, note: '' },
      selfScore: { procedure: 3, sizeFold: 2, drawProtect: 4, action: 1, total: 10 },
      claude: { score: 5, items: { procedure: 2, size_fold: 2, draw_protect: 0, action: 1 }, verdict: 'v', good: 'g', miss: 'm',
        fix_one_line: 'f', gap_type: 'strength_order', gap_reason: 'r', boundary_hand_named: false, villain_range_used: false }
    });
    var ctx4 = ctxWith(e4, { judgeState: 'done' });
    var h4 = truth.html(ctx4);
    assert.ok(/data-role="claude" data-state="done"/.test(h4));
    assert.ok(h4.indexOf('pd-truth-claude-score">5<small>/10</small>') >= 0);
    assert.ok(/data-role="branch-card"[\s\S]*?採点が 5 点離れている/.test(h4), '3点差分岐');
    assert.ok(/name="scoreUsed" value="self" checked/.test(h4), '既定は自己採点');
    assert.strictEqual(e4.gap, 'strength_order', '初期値は Claude の型');
    assert.ok(h4.indexOf('data-role="gap-src">初期値：Claude の型') >= 0);
    assert.ok(/data-gap="strength_order" aria-pressed="true"/.test(h4));

    // ---- Claude error：分類ラベルと再試行 ----
    var h5 = truth.html(ctxWith(mockEntry(), { judgeState: 'error' }));
    assert.ok(/data-role="claude" data-state="error"/.test(h5));
    assert.ok(h5.indexOf('data-act="judge">再試行') >= 0);
    // idle（キーあり相当）：store にキーが無い node では nokey に揃う（syncKeyState）
    var ctxIdle = ctxWith(mockEntry(), { judgeState: 'idle' });
    truth.html(ctxIdle);
    assert.strictEqual(ctxIdle.judgeState, 'nokey', 'キー無しなら idle→nokey');

    // ---- speed：スキップ可・真値無しでも保存可、自己採点未入力も可 ----
    var e6 = mockEntry({ mode: 'speed', tempo: 'speed' });
    var h6 = truth.html(ctxWith(e6, { mode: 'speed', tempo: 'speed' }));
    assert.ok(h6.indexOf('name="skip"') >= 0, '速度はスキップ欄');
    assert.ok(h6.indexOf('速度モードはスキップ可') >= 0);
    assert.ok(/data-role="save-msg"[^>]*data-ok="1">保存できる</.test(h6), '速度は真値・自己採点無しで保存可');
    var hs = truth.html(ctxWith(mockEntry()));
    assert.ok(hs.indexOf('name="skip"') < 0, 'slow にスキップ欄は無い');

    // ---- 欄が増えましたカード（recordOutcome の先読み結果から）----
    var oc = truth._pure.outcomeCardHtml({ added: { id: 'pf_removed', gap: 'range_state' }, pending: null, retired: [], promoted: null }, mockEntry());
    assert.ok(oc.indexOf('欄が増えました') >= 0 && oc.indexOf('data-act="confirm"') >= 0);
    assert.strictEqual(truth._pure.outcomeCardHtml({ added: null, pending: null, retired: [], promoted: null }, mockEntry()), '', '何も無ければ空');

    // ---- 純粋ヘルパ ----
    assert.deepStrictEqual(truth._pure.heroSum({ heroFold: 60, heroCall: 40, heroRaise: 0 }), { text: '自手の合計 100%（100±5）', ng: false });
    assert.strictEqual(truth._pure.validateTruth({ rangeFoldPct: 30, heroFold: 50, heroCall: 50, heroRaise: 0, buckets: {} }, 'drill').ok, true);
    assert.strictEqual(truth._pure.validateTruth({ rangeFoldPct: 30, heroFold: 50, heroCall: 50, heroRaise: 0, buckets: { trash: 50 } }, 'drill').ok, false, '3バケツは3つ全てか空');
    assert.strictEqual(truth._pure.validateTruth({}, 'speed').truth.used, false, 'speed は未入力なら used:false');
    assert.strictEqual(truth._pure.saveBarState(mockEntry(), 'drill', { saved: true }).disabled, true);

    // ---- 用語：禁止語が無い（禁止語そのものをこのファイルに書かないよう連結で作る。⑫の用語 grep 対策）----
    var banned = new RegExp(['乾' + 'い', '濡' + 'れ', '高' + 'カード', '接' + '続性', '接' + '続ボード', '接' + '続した'].join('|'));
    [h, h2, h4, h6, hr].forEach(function (s) {
      assert.ok(!banned.test(s), '用語はカタカナ正典');
    });
  }
};
