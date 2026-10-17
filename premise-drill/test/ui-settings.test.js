// premise-drill: PD.ui.settings の純粋部分（html / apply）のテスト（T13a）。jsdom 無し・document 無し。
//   node test/run.js ui-settings
// 受入（SPEC ⑬ T13a）の静的な裏付け：
//   モデル変更で pd_model が変わり pokerJudgeModel は不変／export→import で件数一致／
//   テストリンク2本の href がそれぞれ R1.8・R1.82 を含む／wizardBfacing を ok にすると state に反映／
//   リセット後 pokerApiKey が残る。ブラウザ（DOM）での受入は結合担当が別途行う。
'use strict';

var path = require('path');

/** localStorage スタブ（own.html のキーを seed し、触られていないことを見る） */
function makeStub(seed) {
  var data = {};
  var k;
  if (seed) for (k in seed) data[k] = String(seed[k]);
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

function install(value) {
  Object.defineProperty(globalThis, 'localStorage', { value: value, configurable: true, writable: true });
}

function freshCtx() {
  var toasts = [];
  return {
    state: null, log: [], view: 'settings', mode: null, tempo: 'slow', reason: null,
    spot: null, fields: [], sheet: null, hints: [], startedAt: null, timer: null, pairNext: null,
    entry: null, judgeState: 'nokey',
    go: function () {}, commit: function () {}, saveOutcome: function () {}, next: function () {},
    toast: function (m) { toasts.push(m); },
    _toasts: toasts
  };
}

function attr(html, role, name) {
  var re = new RegExp('<[^>]*data-role="' + role + '"[^>]*>');
  var m = re.exec(html);
  if (!m) return null;
  var a = new RegExp('\\s' + name + '="([^"]*)"').exec(m[0]);
  return a ? a[1] : null;
}

function chipPressed(html, act, val) {
  var re = new RegExp('data-act="' + act + '" data-val="' + val + '" aria-pressed="([a-z]+)"');
  var m = re.exec(html);
  return m ? m[1] : null;
}

function mockEntry(id, family) {
  return {
    id: id, at: new Date().toISOString(), mode: 'drill', tempo: 'slow', reason: 'random',
    spot: { id: 's_' + id, seed: 1, node: 'BTN2.5-BBcall-x-cb', villainPos: 'BTN', pre: 'F-F-F-R2.5-F-C',
            board: 'Ks7d5c', cls: 'dry_high', suit: 'rainbow', connected: false, hmsd: false,
            size: 33, pot: 5.5, bet: 1.82, hero: 'Ad4d', heroPool: 'A_lowkick_s', family: family || 'dry_high_33' },
    sheet: {}, hints: [],
    commit: { elapsedMs: 1000, fieldTimes: {}, order: ['f1', 'f2', 'f3', 'f4', 'f5'], timedOut: false, incomplete: false, confidence: 80 },
    truth: { used: false }, postCheck: null,
    selfScore: { procedure: 3, sizeFold: 2, drawProtect: 4, action: 1, total: 10 },
    claude: null, gap: 'none', gapNote: '', scoreUsed: 'self', live: null
  };
}

function run(assert) {
  var stub = makeStub({ pokerJudgeModel: 'own-model', pokerSRS_v1: '[{"own":1}]' });
  install(stub);

  var util = require(path.join(__dirname, '..', 'js', 'util.js'));
  var store = require(path.join(__dirname, '..', 'js', 'store.js'));
  var wizard = require(path.join(__dirname, '..', 'js', 'wizard.js'));
  var judge = require(path.join(__dirname, '..', 'js', 'judge.js'));
  var sheet = require(path.join(__dirname, '..', 'js', 'sheet.js'));
  var settings = require(path.join(__dirname, '..', 'js', 'ui', 'settings.js'));

  assert.strictEqual(typeof settings.render, 'function', 'render がある');
  assert.strictEqual(typeof settings.html, 'function', 'html がある');
  assert.strictEqual(typeof settings.apply, 'function', 'apply がある');
  assert.strictEqual(typeof document, 'undefined', 'このテストは document 無しで走る');

  // ---- html(ctx)：document 無しで文字列が返る。5カード＋戻るボタン ----
  var ctx = freshCtx();
  var h = settings.html(ctx);
  assert.strictEqual(typeof h, 'string');
  ['claude', 'wizard', 'extra', 'data', 'reset'].forEach(function (c) {
    assert.ok(h.indexOf('data-card="' + c + '"') >= 0, 'カード ' + c);
  });
  assert.ok(h.indexOf('data-go="home"') >= 0, 'ホームへ戻る');
  assert.ok(ctx.state && ctx.state.settings, 'html が state を store から補う');

  // ---- テストリンク2本：href がそれぞれ R1.8 / R1.82（history_spot=8）で、新規タブ ----
  var href1 = attr(h, 'testlink-1', 'href');
  var href2 = attr(h, 'testlink-2', 'href');
  assert.ok(href1 && href2, 'テストリンク2本に href');
  assert.strictEqual(href1, util.esc(wizard.testUrl(1)), '1桁版は PD.wizard.testUrl(1)');
  assert.strictEqual(href2, util.esc(wizard.testUrl(2)), '2桁版は PD.wizard.testUrl(2)');
  assert.ok(href1.indexOf('X-R1.8&amp;history_spot=8') >= 0, '1桁版に R1.8');
  assert.ok(href2.indexOf('X-R1.82&amp;history_spot=8') >= 0, '2桁版に R1.82');
  assert.ok(href1.indexOf('R1.82') < 0, '1桁版に R1.82 は無い');
  assert.strictEqual(attr(h, 'testlink-1', 'target'), '_blank');
  assert.strictEqual(attr(h, 'testlink-1', 'rel'), 'noopener');
  assert.strictEqual(attr(h, 'testlink-2', 'target'), '_blank');
  assert.strictEqual(attr(h, 'testlink-2', 'rel'), 'noopener');

  // ---- エクスポートの注意書き ----
  assert.ok(h.indexOf('この JSON は公開リポに置かない') >= 0, '公開リポに置かない注意書き');

  // ---- モデル：MODELS の全 id が option、既定が selected ----
  judge.MODELS.forEach(function (m) {
    assert.ok(h.indexOf('<option value="' + m.id + '"') >= 0, 'option ' + m.id);
  });
  assert.ok(h.indexOf('<option value="claude-opus-5" selected>') >= 0, '既定は claude-opus-5 が selected');
  assert.strictEqual(store.getModel(), 'claude-opus-5');

  // ---- モデル変更：pd_model が変わり pokerJudgeModel は不変 ----
  var r = settings.apply(ctx, 'model', 'claude-sonnet-5');
  assert.ok(r.ok, r.msg);
  assert.strictEqual(stub._data.pd_model, 'claude-sonnet-5', 'pd_model が変わる');
  assert.strictEqual(stub._data.pokerJudgeModel, 'own-model', 'pokerJudgeModel は不変');
  assert.strictEqual(store.getModel(), 'claude-sonnet-5');
  var h2 = settings.html(ctx);
  assert.ok(h2.indexOf('<option value="claude-sonnet-5" selected>') >= 0, '変更後は sonnet が selected');
  assert.ok(h2.indexOf('<option value="claude-opus-5" selected>') < 0);
  // 未知のモデル値は「現在の値」として option に残す
  store.setModel('claude-x-test');
  var hx = settings.html(ctx);
  assert.ok(hx.indexOf('<option value="claude-x-test" selected>') >= 0, '未知のモデル値も selected で残る');
  assert.ok(hx.indexOf('（現在の値）') >= 0);
  store.setModel('claude-opus-5');
  assert.ok(!settings.apply(ctx, 'model', '').ok, '空のモデルは弾く');

  // ---- wizardBfacing：ok にすると ctx.state と保存済み state に反映、チップが on ----
  assert.strictEqual(chipPressed(h, 'bfacing', 'unknown'), 'true', '初期は未確認が on');
  assert.strictEqual(chipPressed(h, 'bfacing', 'ok'), 'false');
  r = settings.apply(ctx, 'bfacing', 'ok');
  assert.ok(r.ok, r.msg);
  assert.strictEqual(ctx.state.settings.wizardBfacing, 'ok', 'ctx.state に反映');
  assert.strictEqual(store.loadState().settings.wizardBfacing, 'ok', '保存済み state に反映');
  assert.strictEqual(ctx.state.settings.wizardNode, 'bbfacing', 'ok なら wizardNode も bbfacing');
  var h3 = settings.html(ctx);
  assert.strictEqual(chipPressed(h3, 'bfacing', 'ok'), 'true', 'ok チップが on');
  assert.strictEqual(chipPressed(h3, 'bfacing', 'unknown'), 'false');
  assert.ok(h3.indexOf('BB 応答ノード（小数1桁）') >= 0, 'ok のステータス文');
  r = settings.apply(ctx, 'bfacing', 'ng');
  assert.strictEqual(store.loadState().settings.wizardBfacing, 'ng');
  assert.strictEqual(ctx.state.settings.wizardNode, 'cb', 'ng なら wizardNode は cb');
  r = settings.apply(ctx, 'bfacing', 'garbage');
  assert.strictEqual(ctx.state.settings.wizardBfacing, 'unknown', '不正値は unknown に丸める');

  // ---- wizardBetDecimals：1 ⇄ 2 ----
  assert.strictEqual(chipPressed(h, 'decimals', '1'), 'true', '初期は1桁');
  r = settings.apply(ctx, 'decimals', '2');
  assert.ok(r.ok);
  assert.strictEqual(ctx.state.settings.wizardBetDecimals, 2);
  assert.strictEqual(store.loadState().settings.wizardBetDecimals, 2, '保存される');
  assert.strictEqual(chipPressed(settings.html(ctx), 'decimals', '2'), 'true');
  r = settings.apply(ctx, 'decimals', 1);
  assert.strictEqual(ctx.state.settings.wizardBetDecimals, 1);
  r = settings.apply(ctx, 'decimals', 'x');
  assert.strictEqual(ctx.state.settings.wizardBetDecimals, 1, '不正値は1桁');

  // ---- API キー：保存・削除。HTML にキー本体を埋めない ----
  var DUMMY_KEY = 'dummy-key-for-test-abcd1234';
  assert.ok(!settings.apply(ctx, 'key-save', '   ').ok, '空のキーは弾く');
  assert.strictEqual(ctx.judgeState, 'nokey');
  r = settings.apply(ctx, 'key-save', '  ' + DUMMY_KEY + '  ');
  assert.ok(r.ok, r.msg);
  assert.strictEqual(store.getApiKey(), DUMMY_KEY, 'trim して保存');
  assert.strictEqual(stub._data.pokerApiKey, DUMMY_KEY, 'pokerApiKey に保存（own.html と共有）');
  assert.strictEqual(ctx.judgeState, 'idle', 'キーがあれば judgeState は idle');
  var hk = settings.html(ctx);
  assert.ok(hk.indexOf(DUMMY_KEY) < 0, 'HTML にキー本体を埋めない');
  assert.ok(hk.indexOf('保存済み') >= 0 && hk.indexOf('1234') >= 0, '保存済み＋末尾4文字');
  assert.ok(/data-role="key"/.test(hk) && /value="" data-role="key"/.test(hk), '入力欄は空で描く');
  ctx.judgeState = 'done';
  settings.apply(ctx, 'key-save', DUMMY_KEY);
  assert.strictEqual(ctx.judgeState, 'done', 'done は触らない');
  r = settings.apply(ctx, 'key-clear');
  assert.ok(r.ok);
  assert.strictEqual(store.getApiKey(), '');
  assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pokerApiKey'), '削除で removeItem');
  assert.strictEqual(ctx.judgeState, 'nokey');
  assert.ok(settings.html(ctx).indexOf('未設定') >= 0);

  // ---- 追加欄：トグル・再有効化・枠上限・学習者由来の文字列は esc ----
  ctx.state.settings.extraFields = [
    { id: 'pf_removed', gap: 'range_state', families: ['bw_sd_33'], addedAt: '2026-10-10', enabled: true, retiredAt: null },
    { id: 'rule_cond', gap: 'rule', families: ['<x>'], addedAt: '2026-10-10', enabled: true, retiredAt: '2026-10-11' }
  ];
  ctx.state.settings.pendingExtra = [{ id: 'anti_mid', gap: 'middling', family: 'mid_50', since: '2026-10-12' }];
  store.saveState(ctx.state);
  var he = settings.html(ctx);
  assert.ok(he.indexOf(sheet.EXTRA_FIELDS.pf_removed.label) >= 0, '追加欄のラベルは sheet.EXTRA_FIELDS から');
  assert.ok(he.indexOf(sheet.EXTRA_FIELDS.anti_mid.label) >= 0, '提案待ちもラベル表示');
  assert.ok(he.indexOf('&lt;x&gt;') >= 0 && he.indexOf('<x>') < 0, '由来の文字列は esc');
  assert.ok(/data-role="extra-active">1</.test(he), '有効 1');
  assert.ok(/data-act="extra-toggle" data-id="pf_removed" checked/.test(he), 'pf_removed のトグルが checked');
  assert.ok(/data-act="extra-revive" data-id="rule_cond">/.test(he), '退役欄に再有効化（枠が空いているので enabled）');
  assert.ok(he.indexOf('提案待ち') >= 0);

  r = settings.apply(ctx, 'extra-toggle', { id: 'pf_removed', enabled: false });
  assert.ok(r.ok, r.msg);
  assert.strictEqual(ctx.state.settings.extraFields[0].enabled, false);
  assert.strictEqual(store.loadState().settings.extraFields[0].enabled, false, 'トグルは保存される');
  assert.ok(/data-act="extra-toggle" data-id="pf_removed">/.test(settings.html(ctx)), '無効なら checked 無し');
  assert.ok(!settings.apply(ctx, 'extra-toggle', { id: 'nope', enabled: true }).ok, '無い欄は弾く');
  assert.ok(!settings.apply(ctx, 'extra-toggle', { id: 'rule_cond', enabled: true }).ok, '退役欄はトグルで戻さない');

  r = settings.apply(ctx, 'extra-revive', 'rule_cond');
  assert.ok(r.ok, r.msg);
  assert.strictEqual(ctx.state.settings.extraFields[1].retiredAt, null);
  assert.strictEqual(ctx.state.settings.extraFields[1].enabled, true);
  assert.deepStrictEqual(r.cards, ['extra'], '再有効化は extra カードを作り直す');
  assert.ok(!settings.apply(ctx, 'extra-revive', 'rule_cond').ok, '退役していない欄は再有効化しない');

  // 枠（maxActiveExtra=2）が塞がっていると再有効化できず、ボタンは disabled
  settings.apply(ctx, 'extra-toggle', { id: 'pf_removed', enabled: true });
  ctx.state.settings.extraFields.push({ id: 'rank_table', gap: 'strength_order', families: ['low_33'], addedAt: '2026-10-10', enabled: true, retiredAt: '2026-10-12' });
  store.saveState(ctx.state);
  var hf = settings.html(ctx);
  assert.ok(/data-role="extra-active">2</.test(hf), '有効 2');
  assert.ok(/data-act="extra-revive" data-id="rank_table" disabled aria-disabled="true"/.test(hf), '枠が塞がると再有効化は disabled');
  r = settings.apply(ctx, 'extra-revive', 'rank_table');
  assert.ok(!r.ok, '枠が塞がっていると再有効化できない');
  assert.strictEqual(ctx.state.settings.extraFields[2].retiredAt, '2026-10-12');

  // ---- export → import で件数一致、reset 後も pokerApiKey が残る ----
  settings.apply(ctx, 'key-save', DUMMY_KEY);
  settings.apply(ctx, 'bfacing', 'ok');
  settings.apply(ctx, 'decimals', '2');
  store.appendLog(mockEntry('l_a', 'dry_high_33'));
  store.appendLog(mockEntry('l_b', 'bw_sd_33'));
  ctx.log = store.loadLog();
  assert.strictEqual(ctx.log.length, 2);
  assert.ok(/data-role="log-count">2</.test(settings.html(ctx)), 'ログ件数を表示');

  r = settings.apply(ctx, 'export');
  assert.ok(r.ok, r.msg);
  var text = r.data;
  var parsed = JSON.parse(text);
  assert.strictEqual(parsed.v, 1);
  assert.strictEqual(parsed.log.length, 2, 'エクスポートに2件');
  assert.ok(text.indexOf(DUMMY_KEY) < 0, 'エクスポートにキーは入らない');
  assert.strictEqual(parsed.state.settings.extraFields.length, 3);
  assert.strictEqual(parsed.state.settings.wizardBfacing, 'ok');
  assert.strictEqual(parsed.state.settings.wizardBetDecimals, 2);

  r = settings.apply(ctx, 'reset');
  assert.ok(r.ok, r.msg);
  assert.strictEqual(store.loadLog().length, 0, 'リセットでログが消える');
  assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_log_v1'), 'pd_log_v1 が消える');
  assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_model'), 'pd_model が消える');
  assert.strictEqual(stub._data.pokerApiKey, DUMMY_KEY, 'リセット後も pokerApiKey が残る');
  assert.strictEqual(store.getApiKey(), DUMMY_KEY);
  assert.strictEqual(ctx.judgeState, 'idle', 'キーが残っているので idle');
  assert.strictEqual(ctx.log.length, 0, 'ctx.log も空に');
  assert.strictEqual(ctx.state.settings.extraFields.length, 0, 'ctx.state は既定に戻る');
  assert.strictEqual(ctx.state.settings.wizardBfacing, 'unknown', 'リセットで wizardBfacing も既定に');
  assert.strictEqual(ctx.state.settings.wizardBetDecimals, 1);
  assert.deepStrictEqual(r.cards.slice().sort(), ['claude', 'data', 'extra', 'memo', 'range', 'reset', 'wizard'], 'リセットは全カードを作り直す');
  assert.ok(/data-role="log-count">0</.test(settings.html(ctx)));

  r = settings.apply(ctx, 'import', text);
  assert.ok(r.ok, r.msg);
  assert.strictEqual(r.data.added, 2);
  assert.strictEqual(store.loadLog().length, 2, 'export→import で件数一致');
  assert.strictEqual(ctx.log.length, 2, 'ctx.log が取り込み後に更新される');
  assert.deepStrictEqual(r.cards, ['extra', 'data']);
  // 空の端末への取り込みは settings も復元する（追加欄はログからの再演で退役・昇格が起きるので、再演が触らないスカラーで見る）
  assert.strictEqual(ctx.state.settings.wizardBfacing, 'ok', '取り込みで wizardBfacing が復元');
  assert.strictEqual(ctx.state.settings.wizardBetDecimals, 2, '取り込みで wizardBetDecimals が復元');
  assert.ok(ctx.state.settings.extraFields.length >= 3, '追加欄スロットも取り込まれる');
  assert.ok(/data-role="log-count">2</.test(settings.html(ctx)));

  r = settings.apply(ctx, 'import', text);
  assert.ok(r.ok, r.msg);
  assert.strictEqual(r.data.added, 0);
  assert.strictEqual(r.data.skipped, 2, '同じ JSON の再取り込みは全件スキップ');
  assert.strictEqual(store.loadLog().length, 2);
  assert.ok(!settings.apply(ctx, 'import', '   ').ok, '空は弾く');
  assert.ok(!settings.apply(ctx, 'import', 'not json').ok, '壊れた JSON は弾く');
  assert.ok(!settings.apply(ctx, 'unknown-act').ok, '未知の操作は弾く');

  // ---- own.html のキーに触らない ----
  assert.strictEqual(stub._data.pokerJudgeModel, 'own-model');
  assert.strictEqual(stub._data.pokerSRS_v1, '[{"own":1}]');
  Object.keys(stub._data).forEach(function (k) {
    assert.ok(['pd_state_v1', 'pd_log_v1', 'pd_model', 'pd_memo_v1', 'pd_range_v1', 'pokerApiKey', 'pokerJudgeModel', 'pokerSRS_v1'].indexOf(k) >= 0, '想定外のキー: ' + k);
  });

  // ---- store が無い環境でも html / apply が例外にならない ----
  var savedStore = globalThis.PD.store;
  globalThis.PD.store = null;
  try {
    var c2 = freshCtx();
    var hn = settings.html(c2);
    assert.ok(typeof hn === 'string' && hn.indexOf('data-card="wizard"') >= 0, 'store 無しでも描ける');
    assert.ok(c2.state && c2.state.settings, 'store 無しは最小 state');
    assert.ok(!settings.apply(c2, 'export').ok, 'store 無しの export は ok:false');
    assert.ok(!settings.apply(c2, 'reset').ok);
    assert.ok(settings.apply(c2, 'bfacing', 'ok').ok, 'store 無しでも ctx.state は更新できる');
    assert.strictEqual(c2.state.settings.wizardBfacing, 'ok');
  } finally {
    globalThis.PD.store = savedStore;
  }

  // ---- 用語：カタカナ正典に反する語が HTML に無い（語そのものをこのファイルに書かないよう文字コードで組む） ----
  var all = h + h3 + he + hf + hk;
  [[0x4e7e, 0x3044], [0x6fe1, 0x308c], [0x9ad8, 0x30ab, 0x30fc, 0x30c9], [0x63a5, 0x7d9a]].forEach(function (codes) {
    var bad = String.fromCharCode.apply(null, codes);
    assert.ok(all.indexOf(bad) < 0, '禁止用語（コード ' + codes.join(',') + '）');
  });
}

module.exports = { name: 'ui-settings', run: run };
