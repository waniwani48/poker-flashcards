// PD.store（T6）のテスト。node で global.localStorage にスタブを入れて検証する。
//   node test/run.js store
// 受入（SPEC ⑬ T6）：appendLog 2回→2件／605回→600件で最古が消える／Quota 1回→ok:true,trimmed>0 で件数減／
//   常に Quota→ok:false／importJSON(exportJSON())→added 0,skipped 2／setApiKey('')→削除／resetAll 後も pokerApiKey／
//   getModel 既定／own.html のキーに触らない（キー一覧）
'use strict';

var path = require('path');

var ALLOWED_KEYS = ['pd_state_v1', 'pd_log_v1', 'pd_model', 'pokerApiKey'];
var OWN_KEYS = ['pokerSRS_v1', 'pokerJudgeModel', 'pokerMode', 'pokerStreak'];

/** localStorage スタブ。quotaFails > 0 の間は setItem が QuotaExceededError を投げる（投げるたびに減る） */
function makeStub(seed) {
  var data = {};
  var touched = {};
  var k;
  if (seed) for (k in seed) data[k] = String(seed[k]);
  var stub = {
    quotaFails: 0,
    setCalls: 0,
    getItem: function (key) {
      touched[key] = true;
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, val) {
      touched[key] = true;
      this.setCalls++;
      if (this.quotaFails > 0) {
        if (this.quotaFails !== Infinity) this.quotaFails--;
        var e = new Error('quota');
        e.name = 'QuotaExceededError';
        e.code = 22;
        throw e;
      }
      data[key] = String(val);
    },
    removeItem: function (key) {
      touched[key] = true;
      delete data[key];
    },
    clear: function () { throw new Error('localStorage.clear() を呼んではいけない'); },
    key: function (i) { return Object.keys(data)[i] || null; },
    _data: data,
    _touched: touched
  };
  Object.defineProperty(stub, 'length', { get: function () { return Object.keys(data).length; } });
  return stub;
}

function install(value) {
  Object.defineProperty(globalThis, 'localStorage', { value: value, configurable: true, writable: true });
}

function installThrowingGetter() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: function () { var e = new Error('denied'); e.name = 'SecurityError'; throw e; }
  });
}

function entry(n, extra) {
  var e = {
    id: 'l_' + String(n),
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    mode: 'drill',
    tempo: 'slow',
    reason: 'random',
    spot: { id: 's_' + n, family: 'dry_high_33', board: 'Ks7d5c', hero: 'Ad4d' },
    sheet: {},
    hints: [],
    commit: { elapsedMs: 1000, fieldTimes: {}, order: ['f1', 'f2', 'f3', 'f4', 'f5'], timedOut: false, incomplete: false, confidence: 80 },
    truth: null,
    postCheck: null,
    selfScore: { procedure: 3, sizeFold: 2, drawProtect: 4, action: 1, total: 10 },
    claude: null,
    gap: 'none',
    gapNote: '',
    scoreUsed: 'self',
    live: null
  };
  if (extra) for (var k in extra) e[k] = extra[k];
  return e;
}

module.exports = {
  name: 'store (PD.store)',
  run: function (assert) {
    var store = require(path.join(__dirname, '..', 'js', 'store.js'));
    var PD = globalThis.PD;
    var stub, r, i, log, st;

    // ---- 契約の定数 ----
    assert.deepStrictEqual(store.KEYS, { state: 'pd_state_v1', log: 'pd_log_v1', model: 'pd_model', apiKey: 'pokerApiKey' });
    assert.strictEqual(store.LOG_CAP, 600);

    // ---- loadState：無ければ既定を生成して保存 ----
    stub = makeStub();
    install(stub);
    st = store.loadState();
    assert.strictEqual(st.version, 1);
    assert.strictEqual(st.stage, 1);
    assert.strictEqual(st.settings.wizardNode, 'cb');
    assert.strictEqual(st.settings.wizardBfacing, 'unknown');
    assert.strictEqual(st.settings.wizardBetDecimals, 1);
    assert.deepStrictEqual(st.settings.sizes, [33, 50]);
    assert.deepStrictEqual(st.settings.extraFields, []);
    assert.deepStrictEqual(st.settings.pendingExtra, []);
    assert.strictEqual(st.settings.speedUnlockedAt, null);
    assert.deepStrictEqual(st.recurrence, {});
    assert.deepStrictEqual(st.familyStats, {});
    assert.strictEqual(st.counters.committed, 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(st.counters.liveToday.date), 'liveToday.date が YYYY-MM-DD');
    assert.ok(stub._data.pd_state_v1, '既定 state が保存されている');

    // saveState → loadState の往復。欠けた項目は補われる
    st.settings.wizardBfacing = 'ok';
    st.settings.wizardBetDecimals = 2;
    store.saveState(st);
    st = store.loadState();
    assert.strictEqual(st.settings.wizardBfacing, 'ok');
    assert.strictEqual(st.settings.wizardBetDecimals, 2);
    stub._data.pd_state_v1 = JSON.stringify({ version: 1, settings: { wizardBfacing: 'ng' } });
    st = store.loadState();
    assert.strictEqual(st.settings.wizardBfacing, 'ng');
    assert.deepStrictEqual(st.settings.sizes, [33, 50], '欠けた sizes が既定で補われる');
    assert.deepStrictEqual(st.recurrence, {});
    assert.strictEqual(st.counters.speed, 0);
    // 壊れた JSON → 既定で作り直す
    stub._data.pd_state_v1 = '{broken';
    st = store.loadState();
    assert.strictEqual(st.settings.wizardBfacing, 'unknown');
    // liveToday の日付が古ければ 0 に戻る
    st.counters.liveToday = { date: '2000-01-01', n: 2 };
    store.saveState(st);
    assert.strictEqual(store.loadState().counters.liveToday.n, 0, '日付が変わった liveToday は 0');

    // ---- appendLog 2回 → loadLog().length === 2 ----
    stub = makeStub();
    install(stub);
    assert.deepStrictEqual(store.loadLog(), [], 'ログ無しは []');
    r = store.appendLog(entry(1));
    assert.deepStrictEqual(r, { ok: true, trimmed: 0 });
    r = store.appendLog(entry(2));
    assert.deepStrictEqual(r, { ok: true, trimmed: 0 });
    log = store.loadLog();
    assert.strictEqual(log.length, 2);
    assert.strictEqual(log[0].id, 'l_1');
    assert.strictEqual(log[1].id, 'l_2');

    // id / at が無い entry には補われる
    r = store.appendLog({ mode: 'drill' });
    assert.strictEqual(r.ok, true);
    log = store.loadLog();
    assert.ok(/^l_[0-9a-z]+$/.test(log[2].id), '補われた id は l_ 接頭辞');
    assert.ok(typeof log[2].at === 'string' && log[2].at.length > 0);
    assert.deepStrictEqual(store.appendLog(null), { ok: false, trimmed: 0 });

    // ---- updateLog ----
    store.updateLog('l_1', { gap: 'baseline', gapNote: 'memo' });
    log = store.loadLog();
    assert.strictEqual(log[0].gap, 'baseline');
    assert.strictEqual(log[0].gapNote, 'memo');
    assert.strictEqual(log[0].mode, 'drill', '他の項目は残る');
    store.updateLog('l_nope', { gap: 'rule' });
    assert.strictEqual(store.loadLog().length, 3, '無い id は何もしない');

    // ---- appendLog 605回 → 600件、最古が消える ----
    stub = makeStub();
    install(stub);
    var trimmedTotal = 0;
    for (i = 1; i <= 605; i++) {
      r = store.appendLog(entry(i));
      assert.strictEqual(r.ok, true, 'appendLog #' + i);
      trimmedTotal += r.trimmed;
    }
    log = store.loadLog();
    assert.strictEqual(log.length, 600);
    assert.strictEqual(trimmedTotal, 5, '間引き合計 5');
    assert.strictEqual(log[0].id, 'l_6', '最古 l_1..l_5 が消え l_6 が先頭');
    assert.strictEqual(log[599].id, 'l_605');
    for (i = 0; i < log.length; i++) assert.notStrictEqual(log[i].id, 'l_1');

    // ---- Quota 1回 → ok:true, trimmed>0, 件数が減る ----
    stub = makeStub();
    install(stub);
    for (i = 1; i <= 100; i++) store.appendLog(entry(i));
    assert.strictEqual(store.loadLog().length, 100);
    stub.quotaFails = 1;
    var calls = stub.setCalls;
    r = store.appendLog(entry(101));
    assert.strictEqual(r.ok, true, 'Quota 1回なら再試行で成功');
    assert.ok(r.trimmed > 0, 'trimmed > 0 (' + r.trimmed + ')');
    assert.strictEqual(stub.setCalls - calls, 2, 'setItem は失敗1回＋成功1回');
    log = store.loadLog();
    assert.ok(log.length < 101, '保存後の件数が減っている (' + log.length + ')');
    assert.strictEqual(log.length, 101 - r.trimmed);
    assert.strictEqual(log[log.length - 1].id, 'l_101', '新しい entry は残る');
    assert.strictEqual(log[0].id, 'l_' + (1 + r.trimmed), '古い順に消える');
    assert.strictEqual(stub.quotaFails, 0);

    // Quota 3回 → 3回間引いて成功
    stub.quotaFails = 3;
    var before = store.loadLog().length;
    r = store.appendLog(entry(102));
    assert.strictEqual(r.ok, true);
    assert.ok(r.trimmed > 0);
    assert.strictEqual(store.loadLog().length, before + 1 - r.trimmed);

    // ---- 常に Quota → ok:false、保存内容は変わらない ----
    var snapshot = stub._data.pd_log_v1;
    stub.quotaFails = Infinity;
    calls = stub.setCalls;
    r = store.appendLog(entry(103));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.trimmed, 0, '保存できなければ trimmed は 0');
    assert.strictEqual(stub.setCalls - calls, 6, '初回＋再試行5回で打ち切り');
    assert.strictEqual(stub._data.pd_log_v1, snapshot, '失敗時は保存内容が不変');
    stub.quotaFails = 0;

    // Quota 以外の例外は再試行しない
    var plainThrow = makeStub();
    plainThrow.setItem = function () { plainThrow.setCalls++; throw new Error('other'); };
    install(plainThrow);
    r = store.appendLog(entry(1));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(plainThrow.setCalls, 1, 'Quota 以外は1回で諦める');
    assert.strictEqual(store._isQuotaError({ name: 'QuotaExceededError' }), true);
    assert.strictEqual(store._isQuotaError({ code: 22 }), true);
    assert.strictEqual(store._isQuotaError({ code: 1014 }), true);
    assert.strictEqual(store._isQuotaError(new Error('x')), false);
    assert.strictEqual(store._isQuotaError(null), false);

    // ---- exportJSON / importJSON ----
    stub = makeStub();
    install(stub);
    store.setApiKey('sk-test-not-exported');
    store.appendLog(entry(1));
    store.appendLog(entry(2));
    var text = store.exportJSON();
    var parsed = JSON.parse(text);
    assert.strictEqual(parsed.v, 1);
    assert.ok(typeof parsed.exportedAt === 'string' && parsed.exportedAt.length > 0);
    assert.strictEqual(parsed.log.length, 2);
    assert.strictEqual(parsed.state.version, 1);
    assert.strictEqual(text.indexOf('sk-test-not-exported'), -1, 'API キーはエクスポートに含めない');
    assert.strictEqual(text.indexOf('pokerApiKey'), -1);

    r = store.importJSON(text);
    assert.strictEqual(r.ok, true, r.msg);
    assert.strictEqual(r.added, 0);
    assert.strictEqual(r.skipped, 2);
    assert.strictEqual(store.loadLog().length, 2);

    // 新しい entry を含む JSON → added 1。at 順に並ぶ
    var ext = JSON.parse(text);
    ext.log.push(entry(0));   // at が最古
    ext.log.push(entry(2));   // 重複
    ext.log.push({ mode: 'drill' }); // id 無し → skipped
    r = store.importJSON(JSON.stringify(ext));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.added, 1);
    assert.strictEqual(r.skipped, 4);
    log = store.loadLog();
    assert.strictEqual(log.length, 3);
    assert.strictEqual(log[0].id, 'l_0', 'at 順に並ぶ');
    assert.strictEqual(log[2].id, 'l_2');
    st = store.loadState();
    assert.strictEqual(st.counters.committed, 3, 'counters.committed をログから再計算');
    assert.strictEqual(st.familyStats.dry_high_33.attempts, 3, 'familyStats をログから再計算');
    assert.strictEqual(st.familyStats.dry_high_33.recent.length, 3);
    assert.deepStrictEqual(st.familyStats.dry_high_33.recent[0], { score: 10, hint: false, gap: 'none' });

    // 配列だけの JSON も受ける
    r = store.importJSON(JSON.stringify([entry(7)]));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.added, 1);
    assert.strictEqual(store.loadLog().length, 4);

    // 壊れた JSON・違う形式・未対応 v
    r = store.importJSON('{nope');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.added, 0);
    assert.ok(r.msg.length > 0);
    assert.strictEqual(store.importJSON('42').ok, false);
    assert.strictEqual(store.importJSON(JSON.stringify({ v: 9, log: [] })).ok, false);
    assert.strictEqual(store.loadLog().length, 4, '失敗したインポートはログを変えない');

    // 上限超のインポートは古い順に間引く
    var big = [];
    for (i = 1000; i < 1700; i++) big.push(entry(i));
    r = store.importJSON(JSON.stringify({ v: 1, log: big }));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(store.loadLog().length, 600);
    assert.ok(/間引き/.test(r.msg), 'msg に間引きの案内');

    // Quota で保存できないインポート → ok:false、ログ不変
    snapshot = stub._data.pd_log_v1;
    stub.quotaFails = Infinity;
    r = store.importJSON(JSON.stringify([entry(99999)]));
    assert.strictEqual(r.ok, false);
    assert.ok(/エクスポート/.test(r.msg));
    assert.strictEqual(stub._data.pd_log_v1, snapshot);
    stub.quotaFails = 0;

    // ---- import の再計算：speed は除外、recordOutcome が居れば時系列で再演、未完は familyStats に入らない ----
    stub = makeStub();
    install(stub);
    var replayed = [];
    var savedGaps = PD.gaps;
    PD.gaps = {
      recordOutcome: function (state, e, today) {
        replayed.push(e.id + '@' + today);
        state.recurrence[e.gap + '|' + e.spot.family] = { count: 1, lastAt: e.at, cleanStreak: 0, due: today };
        return { state: state, added: null, pending: null, retired: [], promoted: null };
      },
      scoreOf: function (e) { return e.scoreUsed === 'claude' && e.claude ? e.claude.score : (e.selfScore ? e.selfScore.total : null); }
    };
    try {
      var mixed = [
        entry(3, { gap: 'rule' }),
        entry(1, { mode: 'speed', tempo: 'speed', gap: 'baseline', spot: { family: 'mid_50' } }),
        entry(2, { mode: 'live', gap: 'range_state', spot: { family: 'bw_sd_33' }, hints: [{ field: 'f3', tier: 1 }],
          claude: { score: 6 }, scoreUsed: 'claude' }),
        entry(4, { spot: { family: 'bw_sd_33' }, commit: { incomplete: true, timedOut: true } })
      ];
      r = store.importJSON(JSON.stringify({ v: 1, log: mixed }));
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.added, 4);
      assert.deepStrictEqual(replayed, ['l_2@2026-01-01', 'l_3@2026-01-01', 'l_4@2026-01-01'],
        'speed を除き at 順に recordOutcome へ');
      st = store.loadState();
      assert.ok(st.recurrence['rule|dry_high_33'], '再演結果の recurrence が保存される');
      assert.ok(!st.recurrence['baseline|mid_50'], 'speed は再計算に入らない');
      assert.ok(!st.familyStats.mid_50, 'speed は familyStats に入らない');
      assert.strictEqual(st.familyStats.bw_sd_33.attempts, 1, 'incomplete は familyStats に入らない');
      assert.deepStrictEqual(st.familyStats.bw_sd_33.recent, [{ score: 6, hint: true, gap: 'range_state' }]);
      assert.deepStrictEqual(st.counters, { committed: 3, live: 1, speed: 1, liveToday: st.counters.liveToday },
        'committed は speed を除く（gaps.recordOutcome と同じ定義）');
      assert.strictEqual(st.counters.liveToday.n, 0, '2026-01-01 の live は今日の分ではない');
    } finally {
      PD.gaps = savedGaps;
    }

    // recordOutcome が無い環境でも importJSON は動く（recurrence は空のまま）。
    // 全件実行では PD.gaps が読まれているので、ここでは明示的に外して決定的にする
    savedGaps = PD.gaps;
    PD.gaps = undefined;
    try {
      stub = makeStub();
      install(stub);
      r = store.importJSON(JSON.stringify({ v: 1, log: [entry(1, { gap: 'rule' })] }));
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(store.loadState().recurrence, {}, 'gaps 無しでは recurrence は空');
      assert.strictEqual(store.loadState().familyStats.dry_high_33.attempts, 1);
    } finally {
      PD.gaps = savedGaps;
    }

    // 本物の PD.gaps がある環境：SPEC ④ どおり log から recurrence / 追加欄を再計算する
    savedGaps = PD.gaps;
    PD.gaps = require(path.join(__dirname, '..', 'js', 'gaps.js'));
    try {
      stub = makeStub();
      install(stub);
      var ruleLog = [entry(1, { gap: 'rule' }), entry(2, { gap: 'rule' }), entry(3, { gap: 'none' })];
      r = store.importJSON(JSON.stringify({ v: 1, log: ruleLog }));
      assert.strictEqual(r.ok, true);
      st = store.loadState();
      var cell = st.recurrence['rule|dry_high_33'];
      assert.ok(cell, '再計算で recurrence が入る');
      assert.strictEqual(cell.count, 2, '同型×族2回で count 2');
      assert.strictEqual(cell.cleanStreak, 1, 'none で cleanStreak +1');
      assert.strictEqual(st.settings.extraFields.length, 1, 'count 2 到達で追加欄が発火');
      assert.strictEqual(st.settings.extraFields[0].id, 'rule_cond');
      assert.strictEqual(st.settings.extraFields[0].retiredAt, null, '再演中に不当に退役しない');
      assert.strictEqual(st.familyStats.dry_high_33.attempts, 3);
      assert.strictEqual(st.counters.committed, 3);

      // エクスポート → リセット → インポートで追加欄・recurrence が一致（再演を slot 空から始めるので退役・昇格が走らない）
      var exported = store.exportJSON();
      var beforeState = JSON.parse(exported).state;
      store.resetAll();
      r = store.importJSON(exported);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.added, 3);
      st = store.loadState();
      assert.deepStrictEqual(st.recurrence, beforeState.recurrence, 'recurrence が往復で一致');
      assert.deepStrictEqual(st.settings.extraFields, beforeState.settings.extraFields, 'extraFields が往復で一致');
      assert.deepStrictEqual(st.settings.pendingExtra, beforeState.settings.pendingExtra, 'pendingExtra が往復で一致');
      assert.deepStrictEqual(st.familyStats, beforeState.familyStats, 'familyStats が往復で一致');

      // 手動で enabled:false にした slot は再演後も OFF のまま
      st.settings.extraFields[0].enabled = false;
      store.saveState(st);
      r = store.importJSON(JSON.stringify({ v: 1, log: [entry(9, { gap: 'none' })] }));
      assert.strictEqual(r.ok, true);
      st = store.loadState();
      assert.strictEqual(st.settings.extraFields.length, 1);
      assert.strictEqual(st.settings.extraFields[0].enabled, false, '手動 OFF を引き継ぐ');
    } finally {
      PD.gaps = savedGaps;
    }

    // ログが空なら復元（設定も取り込む）、空でなければ統合（この端末の設定を優先・追加欄は和集合）
    stub = makeStub();
    install(stub);
    var fileState = store.defaultState();
    fileState.settings.wizardBfacing = 'ok';
    fileState.settings.wizardBetDecimals = 2;
    fileState.settings.extraFields = [{ id: 'pf_removed', gap: 'range_state', families: ['bw_sd_33'], addedAt: '2026-01-02', enabled: true, retiredAt: null }];
    fileState.stage = 2;
    r = store.importJSON(JSON.stringify({ v: 1, state: fileState, log: [entry(1)] }));
    assert.strictEqual(r.ok, true);
    st = store.loadState();
    assert.strictEqual(st.settings.wizardBfacing, 'ok', '復元：設定を取り込む');
    assert.strictEqual(st.settings.wizardBetDecimals, 2);
    assert.strictEqual(st.stage, 2);
    assert.strictEqual(st.settings.extraFields.length, 1);
    st.settings.wizardBfacing = 'ng';
    store.saveState(st);
    fileState.settings.wizardBfacing = 'ok';
    fileState.settings.extraFields = [
      { id: 'pf_removed', gap: 'range_state', families: ['dry_high_33'], addedAt: '2026-01-02', enabled: true, retiredAt: null },
      { id: 'rule_cond', gap: 'rule', families: ['mid_33'], addedAt: '2026-01-03', enabled: true, retiredAt: null }
    ];
    fileState.settings.pendingExtra = [{ id: 'anti_mid', gap: 'middling', family: 'low_50', since: '2026-01-04' }];
    r = store.importJSON(JSON.stringify({ v: 1, state: fileState, log: [entry(2)] }));
    assert.strictEqual(r.ok, true);
    st = store.loadState();
    assert.strictEqual(st.settings.wizardBfacing, 'ng', '統合：この端末のスカラー設定を優先');
    assert.strictEqual(st.settings.extraFields.length, 2, '追加欄は id で和集合');
    assert.deepStrictEqual(st.settings.extraFields[0].families, ['bw_sd_33', 'dry_high_33'], 'families は和集合');
    assert.strictEqual(st.settings.extraFields[1].id, 'rule_cond');
    assert.strictEqual(st.settings.pendingExtra.length, 1);

    // ---- setApiKey('') で pokerApiKey 削除 ----
    stub = makeStub();
    install(stub);
    assert.strictEqual(store.getApiKey(), '');
    store.setApiKey('  sk-ant-test  ');
    assert.strictEqual(stub._data.pokerApiKey, 'sk-ant-test', 'trim して保存');
    assert.strictEqual(store.getApiKey(), 'sk-ant-test');
    store.setApiKey('');
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pokerApiKey'), 'setApiKey(\'\') で pokerApiKey が消える');
    assert.strictEqual(store.getApiKey(), '');
    store.setApiKey('k');
    store.setApiKey(null);
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pokerApiKey'), 'null でも消える');

    // ---- getModel 既定 / setModel ----
    assert.strictEqual(store.getModel(), 'claude-opus-5');
    store.setModel('claude-sonnet-5');
    assert.strictEqual(stub._data.pd_model, 'claude-sonnet-5');
    assert.strictEqual(store.getModel(), 'claude-sonnet-5');
    store.setModel('');
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_model'));
    assert.strictEqual(store.getModel(), 'claude-opus-5', '空にすると既定へ');
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pokerJudgeModel'), 'pokerJudgeModel を書かない');

    // ---- resetAll 後も pokerApiKey が残る。own.html のキーは不変 ----
    stub = makeStub({ pokerSRS_v1: '{"own":1}', pokerJudgeModel: 'own-model', pokerMode: 'x', pokerStreak: '3' });
    install(stub);
    store.setApiKey('sk-keep');
    store.setModel('claude-sonnet-5');
    store.appendLog(entry(1));
    store.loadState();
    assert.ok(stub._data.pd_state_v1 && stub._data.pd_log_v1 && stub._data.pd_model);
    store.resetAll();
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_state_v1'), 'pd_state_v1 が消える');
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_log_v1'), 'pd_log_v1 が消える');
    assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_model'), 'pd_model が消える');
    assert.strictEqual(stub._data.pokerApiKey, 'sk-keep', 'resetAll 後も pokerApiKey が残る');
    assert.strictEqual(store.getApiKey(), 'sk-keep');
    assert.strictEqual(store.getModel(), 'claude-opus-5');
    assert.deepStrictEqual(store.loadLog(), []);
    assert.strictEqual(store.loadState().counters.committed, 0);
    assert.strictEqual(stub._data.pokerSRS_v1, '{"own":1}', 'pokerSRS_v1 は不変');
    assert.strictEqual(stub._data.pokerJudgeModel, 'own-model', 'pokerJudgeModel は不変');
    assert.strictEqual(stub._data.pokerMode, 'x');
    assert.strictEqual(stub._data.pokerStreak, '3');

    // ---- キー一覧：全 API を一通り使っても触るキーは4つだけ ----
    stub = makeStub({ pokerSRS_v1: '{"own":1}', pokerJudgeModel: 'own-model', pokerMode: 'x', pokerStreak: '3' });
    install(stub);
    store.loadState();
    store.saveState(store.loadState());
    store.loadLog();
    store.appendLog(entry(1));
    store.updateLog('l_1', { gap: 'rule' });
    store.importJSON(store.exportJSON());
    store.getApiKey();
    store.setApiKey('k');
    store.setApiKey('');
    store.getModel();
    store.setModel('claude-sonnet-5');
    store.setModel('');
    store.resetAll();
    var touched = Object.keys(stub._touched).sort();
    assert.deepStrictEqual(touched, ALLOWED_KEYS.slice().sort(), '触ったキー: ' + touched.join(','));
    for (i = 0; i < OWN_KEYS.length; i++) {
      assert.ok(!stub._touched[OWN_KEYS[i]], OWN_KEYS[i] + ' に触っていない');
    }
    assert.strictEqual(stub._data.pokerSRS_v1, '{"own":1}');
    assert.strictEqual(stub._data.pokerJudgeModel, 'own-model');

    // ---- localStorage 無し → メモリで動く ----
    install(undefined);
    store.resetAll();
    assert.deepStrictEqual(store.loadLog(), []);
    st = store.loadState();
    assert.strictEqual(st.version, 1);
    r = store.appendLog(entry(1));
    assert.deepStrictEqual(r, { ok: true, trimmed: 0 });
    r = store.appendLog(entry(2));
    assert.strictEqual(store.loadLog().length, 2, 'メモリに2件');
    st.settings.wizardBfacing = 'ok';
    store.saveState(st);
    assert.strictEqual(store.loadState().settings.wizardBfacing, 'ok');
    store.setApiKey('mem-key');
    assert.strictEqual(store.getApiKey(), 'mem-key');
    assert.strictEqual(store.getModel(), 'claude-opus-5');
    store.setModel('claude-sonnet-5');
    assert.strictEqual(store.getModel(), 'claude-sonnet-5');
    r = store.importJSON(store.exportJSON());
    assert.deepStrictEqual([r.ok, r.added, r.skipped], [true, 0, 2]);
    store.resetAll();
    assert.deepStrictEqual(store.loadLog(), []);
    assert.strictEqual(store.getApiKey(), 'mem-key', 'メモリでも resetAll は pokerApiKey を残す');
    store.setApiKey('');
    assert.strictEqual(store.getApiKey(), '');

    // ---- localStorage のアクセス自体が例外（SecurityError）→ メモリで動く ----
    installThrowingGetter();
    assert.deepStrictEqual(store.loadLog(), []);
    r = store.appendLog(entry(1));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(store.loadLog().length, 1);
    assert.strictEqual(store.loadState().version, 1);
    store.resetAll();
    assert.deepStrictEqual(store.loadLog(), []);

    // getItem が投げる（読めない）localStorage でも落ちない
    var broken = makeStub();
    broken.getItem = function () { throw new Error('read fail'); };
    install(broken);
    assert.deepStrictEqual(store.loadLog(), []);
    assert.strictEqual(store.loadState().version, 1);
    assert.strictEqual(store.getApiKey(), '');
    assert.strictEqual(store.getModel(), 'claude-opus-5');

    // 後始末：他のテストに影響しないよう空のスタブへ
    install(makeStub());
    store.resetAll();
  }
};
