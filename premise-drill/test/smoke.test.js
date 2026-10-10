// premise-drill: 結合の静的スモーク（T14a）。document / window 無しの node で、
//   1. index.html の読込順どおり require しても例外にならない
//   2. 各 UI の純粋な HTML 生成（html(ctx)）が文字列を返し、Home / Drill に PD.gen.FAMILIES の label が出ない
//   3. nextSpot → buildSheet → emptyValues → 充足値で canCommit ok、1欄空で ok:false
//   4. PD.app の状態機械（start → commit → saveOutcome）が document 非依存で回り、
//      同型×族2回で added.id==='pf_removed'、次の Drill の fields に pf_removed が入る
//   5. store の export → import で件数一致、resetAll 後に pokerApiKey が残る
//   6. speed：commit(timedOut) → incomplete、saveOutcome で recurrence 不変・counters.speed +1
// 実行: node test/run.js smoke
'use strict';

var path = require('path');
var JS = path.join(__dirname, '..', 'js');

/** localStorage スタブ（自分専用。他テストの残留に依存しない） */
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

function install(value) {
  Object.defineProperty(globalThis, 'localStorage', { value: value, configurable: true, writable: true });
}

/** 充足する票の値（正誤は見ない。暗記値は gaps.BASELINE_FOLD から引く） */
function fillSheet(PD, sheet, spot, fields) {
  var base = PD.gaps.BASELINE_FOLD[spot.size];
  sheet.f1.foldPct = typeof base === 'number' ? base : 30;
  sheet.f2 = { trash: 50, hi: 25, pairPlus: 25 };
  sheet.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
  sheet.f4 = { pureAirPct: 50, enough: 'yes', foldList: ['J2o', 'T5o', 'Q7o'], nextLayer: [] };
  sheet.f5 = { bdfd: false, bdsd: false, gut: false, oesd: false, kickerNote: 'キッカー低い', position: 'edge', action: 'fold', confidence: 80 };
  sheet.extra = sheet.extra || {};
  (fields || []).forEach(function (f) {
    if (f.id === 'pf_removed') sheet.extra.pf_removed = ['AA', 'KK'];
    if (f.id === 'baseline_src') sheet.extra.baseline_src = { src: '暗記表', value: sheet.f1.foldPct };
    if (f.id === 'rule_cond') sheet.extra.rule_cond = { rule: '条件→則', cond: 'Y' };
    if (f.id === 'rank_table') sheet.extra.rank_table = [{ hand: 'A4s', beats: 'Aハイ', bd: 'BDFD' }, { hand: 'K9s', beats: 'Kハイ', bd: '無し' }, { hand: '55', beats: '下のペア', bd: '無し' }];
    if (f.id === 'anti_mid') sheet.extra.anti_mid = { yn: 'Y', reason: '先に pure fold を書いた' };
  });
  return sheet;
}

function hasNoLabel(assert, html, labels, where) {
  labels.forEach(function (l) {
    assert.ok(html.indexOf(l) < 0, where + ' に FAMILIES.label「' + l + '」が出ている');
  });
}

module.exports = {
  name: 'smoke（結合・静的）',
  run: function (assert) {
    install(makeStub());

    // ---- 1. 読込順どおり require（document / window 無し） ----
    var order = ['util', 'cards', 'generator', 'sheet', 'wizard', 'gaps', 'store', 'judge',
      'ui/home', 'ui/drill', 'ui/truth', 'ui/map', 'ui/settings', 'app'];
    order.forEach(function (m) {
      assert.doesNotThrow(function () { require(path.join(JS, m + '.js')); }, 'require ' + m);
    });
    var PD = globalThis.PD;
    // 他テストがモックを差して戻している可能性があるので、本物を明示的に置き直す
    PD.gaps = require(path.join(JS, 'gaps.js'));
    PD.store = require(path.join(JS, 'store.js'));
    ['util', 'cards', 'gen', 'sheet', 'wizard', 'gaps', 'store', 'judge', 'app'].forEach(function (k) {
      assert.ok(PD[k], 'PD.' + k + ' がある');
    });
    ['home', 'drill', 'truth', 'map', 'settings'].forEach(function (v) {
      assert.strictEqual(typeof PD.ui[v].render, 'function', 'PD.ui.' + v + '.render');
      assert.strictEqual(typeof PD.ui[v].html, 'function', 'PD.ui.' + v + '.html');
    });
    ['init', 'go', 'start', 'commit', 'saveOutcome', 'next', 'toast'].forEach(function (k) {
      assert.strictEqual(typeof PD.app[k], 'function', 'PD.app.' + k);
    });

    var app = PD.app;
    var ctx = app.ctx;
    var labels = PD.gen.FAMILIES.map(function (f) { return f.label; });
    assert.strictEqual(labels.length, 12);

    PD.store.resetAll();
    app.reload();
    assert.ok(ctx.state && ctx.state.settings, 'reload で state');
    assert.deepStrictEqual(ctx.log, []);
    assert.strictEqual(ctx.judgeState, 'nokey');

    // ---- 2. 純粋な HTML 生成（document 無し） ----
    var hHome0 = PD.ui.home.html(ctx);
    assert.strictEqual(typeof hHome0, 'string');
    assert.ok(hHome0.indexOf('pd-home-start') >= 0 && hHome0.indexOf('ランダム') >= 0, 'ログ0件の Home はランダム');
    assert.ok(hHome0.indexOf('まだ記録がありません') >= 0, 'ログ0件は空状態');
    hasNoLabel(assert, hHome0, labels, 'Home');
    var hMap0 = PD.ui.map.html(ctx);
    assert.ok(typeof hMap0 === 'string' && hMap0.indexOf('まだ格子がありません') >= 0, 'Map 空状態');
    var hSet = PD.ui.settings.html(ctx);
    assert.ok(typeof hSet === 'string' && hSet.indexOf('B1.8') >= 0 && hSet.indexOf('B1.82') >= 0, 'Settings のテストリンク2本');
    var hTruth0 = PD.ui.truth.html(ctx);
    assert.ok(typeof hTruth0 === 'string' && hTruth0.indexOf('gtowizard') < 0, 'コミット前の Truth に Wizard リンク無し');
    var hDrill0 = PD.ui.drill.html(ctx);
    assert.ok(typeof hDrill0 === 'string' && hDrill0.indexOf('出題がありません') >= 0, '出題前の Drill');

    // ---- 3. nextSpot → buildSheet → emptyValues → 充足 → canCommit ----
    var ns = PD.gen.nextSpot(ctx.state, ctx.log, { tempo: 'slow', seed: 7 });
    assert.ok(ns && ns.spot && ns.spot.board && ns.spot.hero, 'nextSpot が Spot を返す');
    assert.ok(ns.reason === 'random' || ns.reason === 'srs');
    assert.strictEqual(ns.spot.villainPos, 'BTN');
    var fields = PD.sheet.buildSheet([], 'slow');
    assert.strictEqual(fields.length, 5);
    var v = fillSheet(PD, PD.sheet.emptyValues(), ns.spot, fields);
    var cc = PD.sheet.canCommit(fields, v, ns.spot);
    assert.strictEqual(cc.ok, true, '充足値で canCommit ok: ' + cc.missing.join('/'));
    var v2 = fillSheet(PD, PD.sheet.emptyValues(), ns.spot, fields);
    v2.f5.action = null;
    cc = PD.sheet.canCommit(fields, v2, ns.spot);
    assert.strictEqual(cc.ok, false, '1欄空で ok:false');
    assert.deepStrictEqual(cc.missing, [fields[4].label], 'missing は欄名');

    // ---- 4. PD.app：start → commit → saveOutcome（同型×族2回で pf_removed） ----
    function cycle(seed, gap) {
      var spot = PD.gen.generateSpot({ family: 'bw_sd_33', seed: seed });
      assert.strictEqual(spot.family, 'bw_sd_33');
      app.start(spot, 'drill', 'slow', 'random');
      assert.strictEqual(ctx.view, 'drill');
      assert.strictEqual(ctx.spot, spot);
      assert.ok(Array.isArray(ctx.fields) && ctx.fields.length >= 5);
      assert.deepStrictEqual(ctx.hints, []);
      assert.strictEqual(ctx.entry, null);

      // Drill の DOM に族名・cls・プール名が出ない
      var hd = PD.ui.drill.html(ctx);
      assert.strictEqual(typeof hd, 'string');
      hasNoLabel(assert, hd, labels, 'Drill');
      [spot.family, spot.heroPool, 'data-cls'].forEach(function (bad) {
        assert.ok(hd.indexOf(bad) < 0, 'Drill に ' + bad + ' が出ている');
      });
      assert.ok(hd.indexOf('pd-drill-cardface') >= 0, 'Drill にカード面');

      // コミット前は commit が拒否する（未充足）
      assert.strictEqual(app.commit(), null, '未充足では封印しない');
      assert.strictEqual(ctx.view, 'drill');

      fillSheet(PD, ctx.sheet, spot, ctx.fields);
      ctx.fields.forEach(function (f, i) { ctx.sheet._ts[f.id] = (i + 1) * 1000; });
      var entry = app.commit();
      assert.ok(entry, 'commit が entry を返す');
      assert.strictEqual(ctx.entry, entry);
      assert.strictEqual(ctx.view, 'truth');
      assert.ok(/^l_/.test(entry.id) && typeof entry.at === 'string');
      assert.strictEqual(entry.mode, 'drill');
      assert.strictEqual(entry.tempo, 'slow');
      assert.strictEqual(entry.reason, 'random');
      assert.strictEqual(entry.spot.board, spot.board);
      assert.notStrictEqual(entry.spot, spot, 'spot は複製して凍結');
      assert.notStrictEqual(entry.sheet, ctx.sheet, 'sheet は複製して凍結');
      assert.strictEqual(entry.sheet._ts, undefined, '票から _ts を外す');
      assert.deepStrictEqual(Object.keys(entry.commit.fieldTimes).sort(), ctx.fields.map(function (f) { return f.id; }).sort(), 'fieldTimes に全欄のキー');
      assert.deepStrictEqual(entry.commit.order, ctx.fields.map(function (f) { return f.id; }), 'order は完了時刻順');
      assert.strictEqual(entry.commit.incomplete, false);
      assert.strictEqual(entry.commit.timedOut, false);
      assert.strictEqual(entry.commit.confidence, 80);
      assert.ok(typeof entry.commit.elapsedMs === 'number' && entry.commit.elapsedMs >= 0);
      assert.ok(entry.postCheck && Array.isArray(entry.postCheck.drawRanksMissing) && Array.isArray(entry.postCheck.heroFeatMismatch), 'postCheck に PD.cards を注入');
      var dr = PD.cards.drawRanks(spot.board);
      var expectMissing = [].concat(dr.gut, dr.oesd).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
      assert.deepStrictEqual(entry.postCheck.drawRanksMissing.slice().sort(), expectMissing, '「ドロー無し」宣言 → 不足ランク＝cards.drawRanks の全ランク');
      assert.deepStrictEqual(entry.postCheck.drawRanksExtra, []);
      assert.strictEqual(entry.truth, null);
      assert.strictEqual(entry.gap, null);

      // Truth の HTML：Wizard リンク・cls ラベル
      var ht = PD.ui.truth.html(ctx);
      assert.ok(ht.indexOf('gtowizard') >= 0 && ht.indexOf('data-wizard="main"') >= 0, 'Truth に Wizard リンク');
      assert.ok(ht.indexOf('data-role="cls"') >= 0, 'Truth に cls ラベル');
      assert.ok(ht.indexOf('data-role="claude-nokey"') >= 0, 'キー無し案内');

      // truth 側の finalize 相当
      entry.truth = { used: true, rangeFoldPct: 30, heroFold: 100, heroCall: 0, heroRaise: 0, buckets: null, note: '' };
      entry.selfScore = { procedure: 3, sizeFold: 2, drawProtect: 2, action: 1, total: 8 };
      entry.gap = gap;
      entry.scoreUsed = 'self';
      var res = app.saveOutcome();
      assert.strictEqual(res.ok, true, 'saveOutcome ok');
      assert.strictEqual(ctx.view, 'home', '保存後は home');
      assert.strictEqual(ctx.entry, null);
      assert.strictEqual(ctx.spot, null);
      assert.strictEqual(ctx.lastOutcome, res.outcome);
      return res;
    }

    var r1 = cycle(11, 'range_state');
    assert.strictEqual(r1.outcome.added, null, '1回目は欄追加なし');
    assert.strictEqual(PD.store.loadLog().length, 1);
    assert.strictEqual(ctx.log.length, 1);
    assert.strictEqual(ctx.state.recurrence['range_state|bw_sd_33'].count, 1);
    assert.strictEqual(PD.store.loadState().recurrence['range_state|bw_sd_33'].count, 1, 'saveState 済み');
    assert.strictEqual(ctx.state.counters.committed, 1);
    assert.strictEqual(ctx.state.familyStats.bw_sd_33.attempts, 1);

    // Home：格子の縮小版が出て、族名は出ない。出題ボタンは復習（33%）
    var hHome1 = PD.ui.home.html(ctx);
    assert.ok(hHome1.indexOf('pd-map-mini') >= 0, 'Home に縮小格子');
    assert.ok(hHome1.indexOf('data-count="1"') >= 0, '縮小格子に count 1 のセル');
    hasNoLabel(assert, hHome1, labels, 'Home（記録あり）');
    assert.ok(hHome1.indexOf('bw_sd_33') < 0 && hHome1.indexOf('range_state') < 0, 'Home に族 id・型 id が無い');
    var hMap1 = PD.ui.map.html(ctx);
    assert.ok(hMap1.indexOf('pd-map-grid') >= 0 && hMap1.indexOf('data-family="bw_sd_33"') >= 0, 'Map に行');

    var r2 = cycle(12, 'range_state');
    assert.ok(r2.outcome.added && r2.outcome.added.id === 'pf_removed', '同型×族2回で pf_removed');
    assert.strictEqual(PD.store.loadLog().length, 2);
    assert.strictEqual(ctx.state.recurrence['range_state|bw_sd_33'].count, 2);
    assert.strictEqual(ctx.state.settings.extraFields.length, 1);
    assert.strictEqual(ctx.state.settings.extraFields[0].id, 'pf_removed');
    assert.strictEqual(ctx.state.settings.extraFields[0].retiredAt, null);
    assert.deepStrictEqual(app.activeExtraIds(ctx.state), ['pf_removed']);

    // 次の Drill では pf_removed が f2 の前に入る（6欄）。3回目のコミットで fieldTimes が6キー
    var r3 = cycle(13, 'none');
    assert.strictEqual(r3.outcome.added, null, '3回目は added なし');
    var last = PD.store.loadLog()[2];
    assert.deepStrictEqual(last.commit.order.slice(0, 2), ['f1', 'pf_removed'], 'pf_removed は f1 の後・f2 の前');
    assert.deepStrictEqual(last.sheet.extra.pf_removed, ['AA', 'KK']);
    assert.strictEqual(ctx.state.recurrence['range_state|bw_sd_33'].cleanStreak, 1, 'none で cleanStreak +1');

    // next()：nextSpot → start（due 族があれば srs）
    var nx = app.next();
    assert.ok(nx && nx.spot, 'next が出題を返す');
    assert.strictEqual(ctx.view, 'drill');
    assert.strictEqual(ctx.mode, 'drill');
    assert.strictEqual(ctx.tempo, 'slow');
    assert.ok(ctx.reason === 'srs' || ctx.reason === 'random');
    assert.ok(ctx.fields.some(function (f) { return f.id === 'pf_removed'; }), '追加欄が次の Drill に入る');
    var hDrillX = PD.ui.drill.html(ctx);
    assert.ok(hDrillX.indexOf('data-fid="pf_removed"') >= 0 && hDrillX.indexOf('data-fid="pf_removed"') < hDrillX.indexOf('data-fid="f2"'));
    hasNoLabel(assert, hDrillX, labels, 'Drill（追加欄あり）');

    // ---- 5. store：export → import で件数一致、resetAll 後に pokerApiKey が残る ----
    PD.store.setApiKey('sk-smoke-key');
    var text = PD.store.exportJSON();
    var parsed = JSON.parse(text);
    assert.strictEqual(parsed.v, 1);
    assert.strictEqual(parsed.log.length, 3);
    assert.ok(text.indexOf('sk-smoke-key') < 0, 'エクスポートにキーを含めない');
    PD.store.resetAll();
    assert.deepStrictEqual(PD.store.loadLog(), []);
    assert.strictEqual(PD.store.getApiKey(), 'sk-smoke-key', 'resetAll 後も pokerApiKey が残る');
    var ir = PD.store.importJSON(text);
    assert.strictEqual(ir.ok, true, ir.msg);
    assert.strictEqual(ir.added, 3);
    assert.strictEqual(PD.store.loadLog().length, 3, 'export → import で件数一致');
    var st = PD.store.loadState();
    assert.strictEqual(st.recurrence['range_state|bw_sd_33'].count, 2, 'recurrence を再計算');
    assert.strictEqual(st.settings.extraFields.length, 1);
    assert.strictEqual(st.settings.extraFields[0].id, 'pf_removed');
    assert.strictEqual(st.settings.extraFields[0].retiredAt, null, 'インポートで不当に退役しない');
    assert.deepStrictEqual(st.settings.pendingExtra, []);
    assert.strictEqual(st.counters.committed, 3);
    PD.store.setApiKey('');

    // ---- 6. speed：recordOutcome を通らず、counters.speed だけ +1 ----
    app.reload();
    var recBefore = JSON.stringify(ctx.state.recurrence);
    var fsBefore = JSON.stringify(ctx.state.familyStats);
    var sp = PD.gen.generateSpot({ family: 'bw_sd_33', seed: 14 });
    app.start(sp, 'speed', 'speed', 'stable');
    assert.strictEqual(ctx.view, 'speed');
    assert.strictEqual(ctx.fields.length, 5, 'speed に追加欄は無い');
    assert.ok(ctx.fields.every(function (f) { return f.compact === true && !f.hints; }), 'speed は縮約・ヒント無し');
    ctx.sheet.f1.foldPct = 30;
    ctx.sheet._ts.f1 = 500;
    var es = app.commit({ timedOut: true });
    assert.ok(es, 'タイムアップでも封印する');
    assert.strictEqual(es.commit.timedOut, true);
    assert.strictEqual(es.commit.incomplete, true);
    assert.deepStrictEqual(es.commit.order, ['f1']);
    assert.strictEqual(ctx.view, 'truth');
    var hts = PD.ui.truth.html(ctx);
    assert.ok(hts.indexOf('name="skip"') >= 0, 'speed の Truth はスキップ可');
    assert.strictEqual(PD.ui.truth._pure.validateSave(ctx.entry, 'speed').ok, true, 'speed は真値・自己採点無しで保存可');
    PD.ui.truth._pure.finalize(ctx.entry, 'speed');   // truth.js の保存ボタンが行う整形
    var rs = app.saveOutcome();
    assert.strictEqual(rs.ok, true);
    assert.strictEqual(rs.outcome, null, 'speed は recordOutcome を通らない');
    assert.strictEqual(ctx.view, 'home');
    assert.strictEqual(JSON.stringify(ctx.state.recurrence), recBefore, 'speed で recurrence 不変');
    assert.strictEqual(JSON.stringify(ctx.state.familyStats), fsBefore, 'speed で familyStats 不変');
    assert.strictEqual(ctx.state.counters.speed, 1, 'counters.speed +1');
    assert.strictEqual(ctx.state.counters.committed, 3, 'committed は不変');
    var lastLog = PD.store.loadLog()[3];
    assert.strictEqual(lastLog.mode, 'speed');
    assert.deepStrictEqual(lastLog.truth, { used: false });

    // ---- 7. 保存失敗：appendLog が ok:false なら state を変えず truth に留まる ----
    app.reload();
    var spF = PD.gen.generateSpot({ family: 'dry_high_50', seed: 15 });
    app.start(spF, 'drill', 'slow', 'random');
    fillSheet(PD, ctx.sheet, spF, ctx.fields);
    ctx.fields.forEach(function (f, i) { ctx.sheet._ts[f.id] = (i + 1) * 100; });
    var eF = app.commit();
    assert.ok(eF);
    eF.truth = { used: true, rangeFoldPct: 40, heroFold: 100, heroCall: 0, heroRaise: 0, buckets: null, note: '' };
    eF.selfScore = { procedure: 3, sizeFold: 2, drawProtect: 4, action: 1, total: 10 };
    eF.gap = 'rule';
    var origAppend = PD.store.appendLog;
    PD.store.appendLog = function () { return { ok: false, trimmed: 0 }; };
    var stateBefore = JSON.stringify(ctx.state);
    try {
      var rf = app.saveOutcome();
      assert.strictEqual(rf.ok, false);
      assert.strictEqual(ctx.view, 'truth', '失敗時は truth に留まる');
      assert.strictEqual(ctx.entry, eF, 'entry を保持（やり直せる）');
      assert.strictEqual(JSON.stringify(ctx.state), stateBefore, '失敗時は state 不変');
      assert.strictEqual(PD.store.loadLog().length, 4);
    } finally {
      PD.store.appendLog = origAppend;
    }
    var rf2 = app.saveOutcome();
    assert.strictEqual(rf2.ok, true, 'やり直しで保存できる');
    assert.strictEqual(PD.store.loadLog().length, 5);
    assert.strictEqual(ctx.state.recurrence['rule|dry_high_50'].count, 1);

    // ---- 用語：生成した HTML にカタカナ正典に反する語が無い（語そのものは文字コードで組む） ----
    var all = hHome0 + hHome1 + hMap1 + hSet + hDrillX + hts;
    [[0x4e7e, 0x3044], [0x6fe1, 0x308c], [0x9ad8, 0x30ab, 0x30fc, 0x30c9], [0x63a5, 0x7d9a, 0x6027], [0x63a5, 0x7d9a, 0x30dc]].forEach(function (codes) {
      var bad = String.fromCharCode.apply(null, codes);
      assert.ok(all.indexOf(bad) < 0, '禁止用語（コード ' + codes.join(',') + '）');
    });

    // 後始末
    PD.store.resetAll();
    PD.store.setApiKey('');
    install(makeStub());
  }
};
