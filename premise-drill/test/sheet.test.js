// premise-drill: PD.sheet のテスト（T3）。node test/run.js sheet
'use strict';

var path = require('path');
var sheet = require(path.join(__dirname, '..', 'js', 'sheet.js'));

function spotFixture() {
  return {
    id: 's_test', seed: 1, node: 'BTN2.5-BBcall-x-cb', villainPos: 'BTN', pre: 'F-F-F-R2.5-F-C',
    board: 'Ks7d5c', cls: 'dry_high', suit: 'rainbow', connected: false, hmsd: false,
    size: 33, pot: 5.5, bet: 1.82, hero: 'Ad4d', heroPool: 'A_lowkick_s', family: 'dry_high_33'
  };
}

// 全欄充足（slow）の値
function fullValues() {
  var v = sheet.emptyValues();
  v.f1.foldPct = 30;
  v.f2 = { trash: 55, hi: 25, pairPlus: 20 };
  v.f3 = { noDraw: false, drawRanks: ['6', '8'], shiftPct: 10, examples: ['86s', '64s'] };
  v.f4 = { pureAirPct: 45, enough: 'yes', foldList: ['J2o', 'T5o', 'Q7o'], nextLayer: [] };
  v.f5 = { bdfd: true, bdsd: false, gut: false, oesd: false, kickerNote: '4 のスートはボードに1枚',
           position: 'edge', action: 'call', confidence: 60 };
  return v;
}

function fieldById(fields, id) {
  for (var i = 0; i < fields.length; i++) if (fields[i].id === id) return fields[i];
  return null;
}

module.exports = {
  name: 'sheet (PD.sheet)',
  run: function (assert) {
    var spot = spotFixture();
    var slow = sheet.buildSheet([], 'slow');
    var F = function (id) { return fieldById(slow, id); };

    // ---- 定義の形 ----
    assert.strictEqual(sheet.SHEET_V1.length, 5);
    assert.deepStrictEqual(sheet.SHEET_V1.map(function (f) { return f.id; }), ['f1', 'f2', 'f3', 'f4', 'f5']);
    assert.deepStrictEqual(sheet.SHEET_V1.map(function (f) { return f.slot; }), [10, 20, 30, 40, 50]);
    sheet.SHEET_V1.forEach(function (f) {
      assert.ok(Array.isArray(f.hints) && f.hints.length === 2, f.id + ' のヒントが2段でない');
      assert.ok(f.hints[0].length > 0 && f.hints[1].length > 0);
    });
    assert.deepStrictEqual(
      ['pf_removed', 'baseline_src', 'rule_cond', 'rank_table', 'anti_mid'].map(function (id) { return sheet.EXTRA_FIELDS[id].slot; }),
      [15, 12, 35, 38, 55]);
    assert.deepStrictEqual(sheet.SPEED_OPTIONS, { foldChips: [20, 25, 30, 35, 40, 45, 50], maxFoldList: 3 });
    var ev = sheet.emptyValues();
    ['f1', 'f2', 'f3', 'f4', 'f5', 'extra', '_ts'].forEach(function (k) { assert.ok(k in ev, 'emptyValues に ' + k + ' が無い'); });

    // ---- 全欄充足フィクスチャが通る ----
    var good = fullValues();
    slow.forEach(function (f) {
      var r = sheet.isFilled(f, good, spot);
      assert.ok(r.ok, f.id + ' が充足にならない: ' + r.msg);
    });
    assert.strictEqual(sheet.openIndex(slow, good, spot), slow.length);
    assert.deepStrictEqual(sheet.canCommit(slow, good, spot), { ok: true, missing: [] });

    // ---- 受入：buckets {30,20,50}→ok、{30,20,60}→ng ----
    var v = fullValues();
    v.f2 = { trash: 30, hi: 20, pairPlus: 50 };
    assert.strictEqual(sheet.isFilled(F('f2'), v, spot).ok, true, 'buckets 30/20/50 が ok でない');
    v.f2 = { trash: 30, hi: 20, pairPlus: 60 };
    var r2 = sheet.isFilled(F('f2'), v, spot);
    assert.strictEqual(r2.ok, false, 'buckets 30/20/60 が ng でない');
    assert.ok(r2.msg.length > 0, 'ng に msg が無い');
    v.f2 = { trash: 30, hi: 20, pairPlus: 54 }; // 104 は ±5 内
    assert.strictEqual(sheet.isFilled(F('f2'), v, spot).ok, true);
    v.f2 = { trash: 30, hi: null, pairPlus: 70 };
    assert.strictEqual(sheet.isFilled(F('f2'), v, spot).ok, false, '空欄ありが ok になっている');

    // ---- 受入：f4.pureAirPct と trash−shift の差 5 超→ng ----
    v = fullValues(); // trash 55, shift 10 → 45
    v.f4.pureAirPct = 51; // 差 6
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false, '差 6 が ng でない');
    v.f4.pureAirPct = 50; // 差 5 は可
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, true, '差 5 が ok でない');
    v.f4.pureAirPct = 40; // 差 −5 は可
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, true);
    v.f4.pureAirPct = 39;
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false);
    // (2)(3)(4) の条件
    v = fullValues();
    v.f4.enough = null;
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false, 'enough 未選択が ok');
    v = fullValues();
    v.f4.foldList = ['J2o', 'T5o'];
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false, 'foldList 2件が ok');
    v = fullValues();
    v.f4.foldList = ['J2o', 'T5o', 'A'];
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false, '不正ハンド名が ok');
    v = fullValues();
    v.f4.enough = 'no';
    v.f4.nextLayer = [];
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, false, 'no で nextLayer 空が ok');
    v.f4.nextLayer = ['A4o'];
    assert.strictEqual(sheet.isFilled(F('f4'), v, spot).ok, true, 'no で nextLayer 1件が ng');

    // ---- 受入：f3 noDraw はストレートドローの宣言のみ。FD 等があれば shiftPct>0 でよい（例は shift>0 なら必須）----
    v = fullValues();
    v.f3 = { noDraw: true, drawRanks: [], shiftPct: 10, examples: [] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, false, 'noDraw+shift10 でも例が無ければ ng（FD 等を名指しする）');
    v.f3 = { noDraw: true, drawRanks: [], shiftPct: 10, examples: ['QsTs', '65s'] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, true, 'noDraw でも FD 等で shift>0＋例2つは ok');
    v.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, true, 'noDraw+shift0 は例なしで ok');
    v.f3 = { noDraw: false, drawRanks: [], shiftPct: 0, examples: [] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, false, 'ランク無し・宣言無しが ok');
    v.f3 = { noDraw: false, drawRanks: ['T'], shiftPct: 5, examples: ['T9o'] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, false, '例1件が ok');
    v.f3 = { noDraw: false, drawRanks: ['T'], shiftPct: 5, examples: ['T9o', '98s'] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, true, '例2件が ng');
    v.f3 = { noDraw: false, drawRanks: ['X'], shiftPct: 5, examples: ['T9o', '98s'] };
    assert.strictEqual(sheet.isFilled(F('f3'), v, spot).ok, false, '不正ランクが ok');

    // ---- f1 / f5 ----
    v = fullValues();
    v.f1.foldPct = null;
    assert.strictEqual(sheet.isFilled(F('f1'), v, spot).ok, false);
    v.f1.foldPct = 101;
    assert.strictEqual(sheet.isFilled(F('f1'), v, spot).ok, false);
    v.f1.foldPct = 0;
    assert.strictEqual(sheet.isFilled(F('f1'), v, spot).ok, true);
    v = fullValues();
    v.f5.position = null;
    assert.strictEqual(sheet.isFilled(F('f5'), v, spot).ok, false);
    v = fullValues();
    v.f5.action = 'raise';
    assert.strictEqual(sheet.isFilled(F('f5'), v, spot).ok, false);
    v = fullValues();
    v.f5.kickerNote = '';
    assert.strictEqual(sheet.isFilled(F('f5'), v, spot).ok, false);
    v = fullValues();
    v.f5.confidence = null;
    assert.strictEqual(sheet.isFilled(F('f5'), v, spot).ok, false);

    // ---- openIndex / canCommit（順序ロック） ----
    v = sheet.emptyValues();
    assert.strictEqual(sheet.openIndex(slow, v, spot), 0);
    v.f1.foldPct = 30;
    assert.strictEqual(sheet.openIndex(slow, v, spot), 1, '①充足で②が開かない');
    v.f2 = { trash: 55, hi: 25, pairPlus: 20 };
    assert.strictEqual(sheet.openIndex(slow, v, spot), 2);
    var cc = sheet.canCommit(slow, v, spot);
    assert.strictEqual(cc.ok, false);
    assert.strictEqual(cc.missing.length, 3);
    assert.ok(cc.missing[0].indexOf('③') === 0, 'missing は欄名（label）: ' + cc.missing[0]);

    // ---- 受入：validHandName ----
    assert.strictEqual(sheet.validHandName('A'), false);
    assert.strictEqual(sheet.validHandName('A4s'), true);
    assert.strictEqual(sheet.validHandName('44'), true);
    assert.strictEqual(sheet.validHandName('44s'), false);
    assert.strictEqual(sheet.validHandName('AK'), false, '異ランクに s|o が無いのに true');
    assert.strictEqual(sheet.validHandName('AKo'), true);
    assert.strictEqual(sheet.validHandName('Ad4d'), true);
    assert.strictEqual(sheet.validHandName('AdAd'), false, '同一カード2枚が true');
    assert.strictEqual(sheet.validHandName('a4s'), false);
    assert.strictEqual(sheet.validHandName(''), false);
    assert.strictEqual(sheet.validHandName(null), false);
    assert.strictEqual(sheet.validHandName('A4s '), false);

    // ---- 受入：detectRankOrder ----
    assert.strictEqual(sheet.detectRankOrder(['Q7o', 'J2o', 'T5o']), true, '降順');
    assert.strictEqual(sheet.detectRankOrder(['T5o', 'J2o', 'Q7o']), true, '昇順');
    assert.strictEqual(sheet.detectRankOrder(['J2o', 'T5o', 'Q7o']), false, '非単調');
    assert.strictEqual(sheet.detectRankOrder(['J2o', 'T5o']), false, '要素不足');
    assert.strictEqual(sheet.detectRankOrder(['J2o', 'J5o', 'T5o']), true, '同値を含む非増加');
    assert.strictEqual(sheet.detectRankOrder(['J2o', 'T5o', 'XX']), false, '不正要素');
    assert.strictEqual(sheet.detectRankOrder([]), false);
    assert.strictEqual(sheet.detectRankOrder(null), false);

    // ---- 受入：buildSheet ----
    var withRank = sheet.buildSheet(['rank_table'], 'slow');
    var ids = withRank.map(function (f) { return f.id; });
    assert.strictEqual(ids.indexOf('rank_table') + 1, ids.indexOf('f4'), 'rank_table が f4 の直前でない: ' + ids.join(','));
    assert.strictEqual(fieldById(withRank, 'rank_table').extra, true);
    assert.ok(fieldById(withRank, 'f1').hints, 'slow でヒントが無い');

    var allExtra = ['pf_removed', 'baseline_src', 'rule_cond', 'rank_table', 'anti_mid'];
    var full = sheet.buildSheet(allExtra, 'slow');
    assert.deepStrictEqual(full.map(function (f) { return f.id; }),
      ['f1', 'baseline_src', 'pf_removed', 'f2', 'f3', 'rule_cond', 'rank_table', 'f4', 'f5', 'anti_mid']);
    var dup = sheet.buildSheet(['pf_removed', 'pf_removed', 'nope'], 'slow');
    assert.strictEqual(dup.length, 6, '重複・未知 id の扱い');

    var sp = sheet.buildSheet(allExtra, 'speed');
    assert.strictEqual(sp.length, 5, 'speed に extra が混じる');
    assert.ok(sp.every(function (f) { return !f.extra && f.compact === true && !f.hints; }), 'speed は compact・ヒント無し');
    var nm = sheet.buildSheet(['pf_removed'], 'normal');
    assert.strictEqual(nm.length, 6);
    assert.ok(nm.every(function (f) { return !f.hints && !f.compact; }), 'normal はヒント無し・非 compact');
    // 定数を汚染しない
    withRank[0].label = 'x';
    assert.notStrictEqual(sheet.SHEET_V1[0].label, 'x');

    // ---- speed の縮約充足 ----
    var sv = sheet.emptyValues();
    sv.f1.foldPct = 30;
    sv.f2 = { trash: 55, hi: 25, pairPlus: 20 };
    sv.f3 = { noDraw: false, drawRanks: ['6'], shiftPct: 10, examples: [] };   // 例は任意
    sv.f4 = { pureAirPct: 45, enough: null, foldList: ['J2o'], nextLayer: [] };  // enough 自動 yes・最大3
    sv.f5 = { bdfd: null, bdsd: null, gut: null, oesd: null, kickerNote: '', position: 'edge', action: 'fold', confidence: null };
    assert.deepStrictEqual(sheet.canCommit(sp, sv, spot), { ok: true, missing: [] });
    sv.f4.foldList = ['J2o', 'T5o', 'Q7o', 'A4o'];
    assert.strictEqual(sheet.isFilled(fieldById(sp, 'f4'), sv, spot).ok, false, 'speed で 4 件が ok');
    assert.strictEqual(sheet.isFilled(F('f3'), sv, spot).ok, false, 'slow の③は例が必須');

    // ---- 追加欄の充足 ----
    var ex = fullValues();
    ex.extra = {
      pf_removed: ['QQ', 'AKs'],
      baseline_src: { src: '暗記表', value: 30 },
      rule_cond: { rule: 'レインボー→色の則は使わない', cond: 'Y' },
      rank_table: [
        { hand: 'A4s', beats: 'Aハイ同士でキッカー勝ち', bd: 'BDFD' },
        { hand: 'J2o', beats: '無し', bd: '無し' },
        { hand: '86s', beats: '無し', bd: 'オープンエンド' }
      ],
      anti_mid: { yn: 'Y', reason: 'pure call を先に書いた' }
    };
    assert.deepStrictEqual(sheet.canCommit(full, ex, spot), { ok: true, missing: [] });
    var bad = fullValues();
    bad.extra = { pf_removed: ['QQ'] };
    var ccb = sheet.canCommit(full, bad, spot);
    assert.strictEqual(ccb.ok, false);
    assert.strictEqual(ccb.missing.length, 5, '追加欄5つが未充足: ' + ccb.missing.join('|'));
    bad.extra.rank_table = [{ hand: 'A4s', beats: 'x', bd: '' }, { hand: 'J2o', beats: 'x', bd: '無し' }, { hand: '86s', beats: 'x', bd: '無し' }];
    assert.strictEqual(sheet.isFilled(fieldById(full, 'rank_table'), bad, spot).ok, false, 'BD 空が ok');

    // ---- 受入：confidenceCap ----
    assert.strictEqual(sheet.confidenceCap([{ field: 'f3', tier: 1 }]), 70);
    assert.strictEqual(sheet.confidenceCap([]), 100);
    assert.strictEqual(sheet.confidenceCap(null), 100);
    assert.strictEqual(sheet.confidenceCap(undefined), 100);

    // ---- 受入：postCheck はモックだけで動き PD.cards を参照しない ----
    var rootObj = typeof window !== 'undefined' ? window : globalThis;
    var PDns = rootObj.PD;
    var saved = Object.getOwnPropertyDescriptor(PDns, 'cards');
    var touched = 0;
    Object.defineProperty(PDns, 'cards', {
      configurable: true, enumerable: true,
      get: function () { touched++; throw new Error('postCheck が PD.cards を参照した'); },
      set: function () { touched++; throw new Error('postCheck が PD.cards を参照した'); }
    });
    try {
      var calls = [];
      var mock = {
        drawRanks: function (board) { calls.push(['drawRanks', board]); return { gut: ['8', '3'], oesd: ['6'] }; },
        handFeatures: function (hand, board) { calls.push(['handFeatures', hand, board]); return { bdfd: true, bdsd: true, gut: false, oesd: false, pair: false }; }
      };
      var pv = fullValues();
      pv.f3.drawRanks = ['6', '8', 'T'];           // 3 が不足、T が過剰
      pv.f4.foldList = ['J2o', 'T5o', 'Q7o'];       // 非単調
      var pc = sheet.postCheck(pv, spot, mock);
      assert.deepStrictEqual(pc, { drawRanksMissing: ['3'], drawRanksExtra: ['T'], heroFeatMismatch: ['bdsd'], rankOrder: false });
      assert.deepStrictEqual(calls, [['drawRanks', 'Ks7d5c'], ['handFeatures', 'Ad4d', 'Ks7d5c']]);

      pv.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
      pv.f4.foldList = ['Q7o', 'J2o', 'T5o'];
      pv.f5.bdsd = true;
      pc = sheet.postCheck(pv, spot, mock);
      assert.deepStrictEqual(pc.drawRanksMissing, ['8', '6', '3'], 'ランク順 A..2');
      assert.deepStrictEqual(pc.drawRanksExtra, []);
      assert.deepStrictEqual(pc.heroFeatMismatch, []);
      assert.strictEqual(pc.rankOrder, true);

      // 省略された2枚チェック（boolean でない）は比較しない
      pv.f5 = { bdfd: null, bdsd: null, gut: null, oesd: null, position: 'edge', action: 'fold' };
      assert.deepStrictEqual(sheet.postCheck(pv, spot, mock).heroFeatMismatch, []);
      // api 無しでも落ちない
      var noapi = sheet.postCheck(pv, spot, {});
      assert.deepStrictEqual(noapi, { drawRanksMissing: [], drawRanksExtra: [], heroFeatMismatch: [], rankOrder: true });
      assert.strictEqual(touched, 0, 'PD.cards が参照された');
    } finally {
      if (saved) Object.defineProperty(PDns, 'cards', saved); else delete PDns.cards;
    }

    // ---- toText ----
    var tx = sheet.toText(fullValues(), slow);
    assert.ok(tx.indexOf('①必要fold%=30') >= 0, tx);
    assert.ok(tx.indexOf('②trash=55% ハイカード=25% ペア以上=20%') >= 0, tx);
    assert.ok(tx.indexOf('③ドロー：6,8／守る側に移る 10%（レンジ全体比）／例 86s,64s') >= 0, tx);
    assert.ok(tx.indexOf('④純air=45%／足りる=足りる／fold組（弱い順）J2o,T5o,Q7o／次の層 無し') >= 0, tx);
    assert.ok(tx.indexOf('⑤2枚チェック BDFD=有 BDSD=無 ガット=無 オープンエンド=無／キッカー 4 のスートはボードに1枚／位置=境界／判定=call／確信度=60%') >= 0, tx);
    assert.strictEqual(tx.split('\n').length, 5);
    assert.ok(tx.indexOf('追加欄') < 0, 'extra 無しで追加欄行が出ている');
    var tx2 = sheet.toText(ex, full);
    assert.strictEqual(tx2.split('\n').length, 10);
    assert.ok(tx2.indexOf('追加欄：プリフロで抜けた手（3betへ回った上位／fold した下位）：QQ,AKs') >= 0, tx2);
    assert.ok(tx2.indexOf('暗記値 30%') >= 0, tx2);
    assert.ok(tx2.indexOf('条件成立 Y') >= 0, tx2);
    assert.ok(tx2.indexOf('A4s｜Aハイ同士でキッカー勝ち｜BD BDFD') >= 0, tx2);
    var nd = fullValues();
    nd.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
    assert.ok(sheet.toText(nd, slow).indexOf('③ドロー：無しと宣言') >= 0);
    var emptyTx = sheet.toText(sheet.emptyValues(), slow);
    assert.ok(emptyTx.indexOf('未記入') >= 0);
    assert.strictEqual(sheet.toText(fullValues()).split('\n').length, 5, 'fields 省略で SHEET_V1');

    // ---- node 互換：グローバル名前空間に attach ----
    assert.strictEqual(rootObj.PD.sheet, sheet);
  }
};
