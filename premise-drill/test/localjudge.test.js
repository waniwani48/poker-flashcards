// PD.localjudge のテスト。SPEC-judge.md §2／§4 の受入を1項目ずつ assert する。
//   node test/run.js localjudge
// PD.range は別担当の実装に依存しないよう、固定値を返すモックを deps.range に注入して検証する。
'use strict';

var fs = require('fs');
var path = require('path');
var cards = require(path.join(__dirname, '..', 'js', 'cards.js'));
var lj = require(path.join(__dirname, '..', 'js', 'localjudge.js'));

var LJ_PATH = path.join(__dirname, '..', 'js', 'localjudge.js');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function ent(hand, w, score, cat, sub) {
  return { hand: hand, w: w, score: score, cat: cat, sub: sub };
}

// ------------------------------------------------------------------ 固定値の Stats（モック用）
// 手計算しやすい数字だけを置く。strong+backdoor+pureAir = trash を満たす。

/** Ks7d5c：ドロー無しのボード。必要 fold% 30（33%）なら pureAir 7.5 は足りない */
var S1 = {
  total: 160,
  pct: { pairPlus: 55.0, hi: 20.0, trash: 25.0 },
  draws: { strong: 5.0, backdoor: 12.5, pureAir: 7.5 },
  drawRanks: [],
  weakestFirst: [
    ent('J2o', 12, 1.1102, 'trash', 'pureAir'),
    ent('QJs', 3, 2.0, 'trash', 'backdoor'),
    ent('AQs', 4, 2.0, 'hi', null),
    ent('T9s', 3, 2.4, 'trash', 'backdoor'),
    ent('98s', 4, 3.0, 'trash', 'strong'),
    ent('A5s', 3, 4.5, 'pairPlus', null),
    ent('KQs', 3, 6.0, 'pairPlus', null),
    ent('AA', 3, 6.5, 'pairPlus', null)
  ]
};

/** QsJd9c：K／T／8 がドローのランク。純air 33 は 33% なら足り（30）、50% なら足りない（40） */
var S2 = {
  total: 200,
  pct: { pairPlus: 30.0, hi: 30.0, trash: 40.0 },
  draws: { strong: 4.0, backdoor: 3.0, pureAir: 33.0 },
  drawRanks: ['K', 'T', '8'],
  weakestFirst: [
    ent('32o', 12, 1.0302, 'trash', 'pureAir'),
    ent('52o', 12, 1.0502, 'trash', 'pureAir'),
    ent('62o', 12, 1.0602, 'trash', 'pureAir'),
    ent('K2o', 12, 3.0, 'hi', null),
    ent('T2o', 12, 3.3, 'trash', 'strong'),
    ent('AA', 6, 6.5, 'pairPlus', null)
  ]
};

// board → { stats, heroes: { 'Ad4d': percentile ... } }
var FIXTURE = {
  'Ks7d5c': {
    stats: S1,
    heroes: {
      'Ad4d': 20.0, 'Qs3h': 24.9, 'Qs2h': 25.0, 'Jc2h': 29.9, 'Qs6h': 30.0, 'Qs4h': 35.0, 'Qs5h': 35.1, 'AhKh': 80.0
    }
  },
  'QsJd9c': {
    stats: S2,
    heroes: { 'Ad4d': 36.0 }
  }
};

/** PD.range のモック。stats の呼出し回数を数える（fold 手ごとに呼ばない契約の検証用） */
function mockRange(opts) {
  opts = opts || {};
  var m = {
    statsCalls: 0,
    comboCalls: 0,
    isFilled: function (r) { return !!(r && r.filled); },
    callWeight: function (st) { return st === 'call' ? 1 : (st === 'mix' ? 0.5 : 0); },
    combos: function () { m.comboCalls++; return opts.combos || []; },
    stats: function (range, board, hero) {
      m.statsCalls++;
      var fx = FIXTURE[board];
      if (!fx) return null;
      var out = clone(fx.stats);
      if (opts.noSub) {
        out.weakestFirst.forEach(function (e) { delete e.sub; });
      }
      var p = hero && fx.heroes[hero];
      out.hero = (typeof p === 'number')
        ? { hand: 'XXo', cards: hero, score: 0, cat: 'hi', percentile: p }
        : null;
      return out;
    }
  };
  return m;
}

function filledRange(extraCells) {
  var cells = { 'J2o': 'call', 'QJs': 'call', 'AQs': 'call', 'T9s': 'call', '98s': 'call', 'A5s': 'call',
    'KQs': 'call', 'AA': 'call', 'Q9s': 'call', 'AKo': '3bet' };
  if (extraCells) for (var k in extraCells) cells[k] = extraCells[k];
  return { v: 1, cells: cells, updatedAt: null, source: 'test', filled: true };
}

function spot1(extra) {
  var s = { board: 'Ks7d5c', hero: 'Ad4d', size: 33 };
  if (extra) for (var k in extra) s[k] = extra[k];
  return s;
}

/** Ks7d5c・33% の「全部正解」の票 */
function sheet1(over) {
  var s = {
    f1: { foldPct: 30 },
    f2: { trash: 25, hi: 20, pairPlus: 55 },
    f3: { noDraw: true, drawRanks: [], shiftPct: 17.5, examples: [] },
    f4: { pureAirPct: 7.5, enough: 'no', foldList: ['J2o'], nextLayer: ['QJs'] },
    f5: { bdfd: false, bdsd: false, gut: false, oesd: false, kickerNote: '', position: 'in', action: 'fold', confidence: 70 }
  };
  return merge(s, over);
}

/** QsJd9c・33% の「全部正解」の票（hero Ad4d は percentile 36 → 必要30 に対し 'above'／call） */
function sheet2(over) {
  var s = {
    f1: { foldPct: 30 },
    f2: { trash: 40, hi: 30, pairPlus: 30 },
    f3: { noDraw: false, drawRanks: ['K', 'T', '8'], shiftPct: 7, examples: ['KJo'] },
    f4: { pureAirPct: 33, enough: 'yes', foldList: ['32o', '52o', '62o'], nextLayer: [] },
    f5: { bdfd: false, bdsd: false, gut: false, oesd: false, kickerNote: '', position: 'above', action: 'call', confidence: 70 }
  };
  return merge(s, over);
}

function merge(base, over) {
  if (over) {
    for (var k in over) {
      for (var kk in over[k]) base[k][kk] = over[k][kk];
    }
  }
  return base;
}

function spot2(extra) {
  var s = { board: 'QsJd9c', hero: 'Ad4d', size: 33 };
  if (extra) for (var k in extra) s[k] = extra[k];
  return s;
}

module.exports = {
  name: 'localjudge (PD.localjudge)',
  run: function (assert) {
    var range = filledRange();

    function J(sheet, spot, opts, rangeObj) {
      var mock = mockRange(opts);
      var v = lj.judge(sheet, spot, rangeObj || range, { cards: cards, range: mock, baseline: { 33: 30, 50: 40 } });
      v._mock = mock;
      return v;
    }

    // ---------------------------------------------------------------- 公開 API
    assert.strictEqual(typeof lj.judge, 'function');
    assert.deepStrictEqual(lj.TOL, { f1: 5, f2: 8, f3: 6, f4: 8 });
    assert.strictEqual(lj.normHand('a4S'), 'A4s');
    assert.strictEqual(lj.normHand('4Ad'), null, '順序違いのカード表記は不正');
    assert.strictEqual(lj.normHand('4A'), null, '異ランクで接尾辞なしは不正');
    assert.strictEqual(lj.normHand('55s'), null, 'ペアに接尾辞は不正');
    assert.strictEqual(lj.normHand('Ad4d'), 'A4s');
    assert.strictEqual(lj.normHand('4hAd'), 'A4o', '具体2枚は高い方を先頭にして s／o を付ける');
    assert.strictEqual(lj.normHand('AsAh'), 'AA');
    assert.strictEqual(lj.normHand('AsAs'), null, '同一カード2枚は不正');
    assert.strictEqual(lj.normHand('K9o'), 'K9o');
    assert.strictEqual(lj.normHand('9Ko'), 'K9o', 'ランクの並びは高い方を先頭にそろえる');

    // ---------------------------------------------------------------- available false
    var unfilled = J(sheet1(), spot1(), null, { filled: false, cells: {} });
    assert.deepStrictEqual({ available: unfilled.available, reason: unfilled.reason },
      { available: false, reason: 'レンジ表が未入力' });
    assert.strictEqual(unfilled._mock.statsCalls, 0, '未入力なら stats は呼ばない');
    var nullRange = lj.judge(sheet1(), spot1(), null, { cards: cards, range: mockRange(), baseline: { 33: 30 } });
    assert.strictEqual(nullRange.available, false, 'range が null でも available:false');
    assert.strictEqual(nullRange.reason, 'レンジ表が未入力');

    var badBoard = J(sheet1(), spot1({ board: 'Zz9' }));
    assert.strictEqual(badBoard.available, false, 'board が不正（stats が null）なら available:false');
    assert.strictEqual(badBoard.reason, 'ボードが不正');
    var badSize = J(sheet1(), spot1({ size: 75 }));
    assert.strictEqual(badSize.available, false, '暗記値の無いサイズは判定しない');

    // ---------------------------------------------------------------- deps 省略時の既定（PD.range／PD.gaps.BASELINE_FOLD）
    var hadRange = Object.prototype.hasOwnProperty.call(globalThis.PD, 'range');
    var prevRange = globalThis.PD.range;
    globalThis.PD.range = mockRange();
    try {
      var vd = lj.judge(sheet1(), spot1(), range);
      assert.strictEqual(vd.available, true, 'deps 省略なら PD.range を使う');
      assert.strictEqual(vd.required, 30, 'baseline 省略なら PD.gaps.BASELINE_FOLD（33→30）');
      var vd50 = lj.judge(sheet2(), spot2({ size: 50 }), range);
      assert.strictEqual(vd50.required, 40, '50% → 40');
      var vdOv = lj.judge(sheet1(), spot1(), range, { baseline: { 33: 25 } });
      assert.strictEqual(vdOv.required, 25, 'deps.baseline が優先');
    } finally {
      if (hadRange) globalThis.PD.range = prevRange; else delete globalThis.PD.range;
    }

    // ---------------------------------------------------------------- 全部正解
    var perfect1 = J(sheet1(), spot1());
    assert.strictEqual(perfect1.available, true);
    assert.strictEqual(perfect1.required, 30);
    assert.strictEqual(perfect1.summary.okCount, 5);
    assert.strictEqual(perfect1.summary.total, 5);
    assert.deepStrictEqual(perfect1.summary.score, { size_fold: 2, draw_protect: 4, action: 1 });
    assert.strictEqual(perfect1.stats.pct.trash, 25, 'stats を参照用に返す');
    assert.strictEqual(perfect1.stats.hero.percentile, 20);
    assert.strictEqual(perfect1._mock.statsCalls, 1, 'stats は1回だけ（fold 手ごとに呼ばない）');

    var perfect2 = J(sheet2(), spot2());
    assert.strictEqual(perfect2.summary.okCount, 5, 'QsJd9c の全部正解も 5/5');
    assert.deepStrictEqual(perfect2.summary.score, { size_fold: 2, draw_protect: 4, action: 1 });

    // 入力を壊さない
    var sh = sheet1();
    var before = JSON.stringify(sh);
    J(sh, spot1());
    assert.strictEqual(JSON.stringify(sh), before, 'sheet を変更しない');

    // 空の票：全欄 ok=false・diff=null
    var empty = J({}, spot1());
    assert.strictEqual(empty.available, true);
    assert.strictEqual(empty.summary.okCount, 0);
    assert.deepStrictEqual(empty.summary.score, { size_fold: 0, draw_protect: 0, action: 0 });
    assert.strictEqual(empty.f1.diff, null);
    assert.deepStrictEqual(empty.f2.diff, { trash: null, hi: null, pairPlus: null });
    assert.strictEqual(empty.f4.ok, false);
    assert.strictEqual(empty.f5.ok, false);

    // ---------------------------------------------------------------- f1：tol 5
    var f1a = J(sheet1({ f1: { foldPct: 35 } }), spot1()).f1;
    assert.strictEqual(f1a.ok, true, '+5 は境界で ok');
    assert.strictEqual(f1a.diff, 5);
    assert.strictEqual(f1a.expect, 30);
    assert.strictEqual(f1a.got, 35);
    assert.strictEqual(f1a.tol, 5);
    assert.strictEqual(J(sheet1({ f1: { foldPct: 25 } }), spot1()).f1.ok, true, '-5 も ok');
    var f1b = J(sheet1({ f1: { foldPct: 36 } }), spot1()).f1;
    assert.strictEqual(f1b.ok, false, '+6 は NG');
    assert.strictEqual(f1b.diff, 6);
    var f1c = J(sheet1({ f1: { foldPct: null } }), spot1()).f1;
    assert.strictEqual(f1c.ok, false, '未入力は ok=false');
    assert.strictEqual(f1c.diff, null);
    assert.strictEqual(f1c.got, null);
    assert.strictEqual(J(sheet1(), spot1()).f1.pureAlpha, 25, '33% の純 α は 25');
    assert.strictEqual(J(sheet2(), spot2({ size: 50 })).f1.pureAlpha, 33, '50% の純 α は 33');
    var f1d = J(sheet2({ f1: { foldPct: 40 } }), spot2({ size: 50 })).f1;
    assert.strictEqual(f1d.expect, 40, '50% の暗記値は 40');
    assert.strictEqual(f1d.ok, true);

    // ---------------------------------------------------------------- f2：3つとも tol 8
    var f2a = J(sheet1({ f2: { trash: 33, hi: 12, pairPlus: 63 } }), spot1()).f2;
    assert.strictEqual(f2a.ok, true, '全て |diff|=8 は境界で ok');
    assert.deepStrictEqual(f2a.diff, { trash: 8, hi: -8, pairPlus: 8 });
    assert.deepStrictEqual(f2a.expect, { trash: 25, hi: 20, pairPlus: 55 });
    assert.strictEqual(f2a.tol, 8);
    var f2b = J(sheet1({ f2: { trash: 34, hi: 20, pairPlus: 55 } }), spot1()).f2;
    assert.strictEqual(f2b.ok, false, '1つでも |diff|>8 なら NG');
    assert.deepStrictEqual(f2b.diff, { trash: 9, hi: 0, pairPlus: 0 });
    assert.deepStrictEqual(f2b.got, { trash: 34, hi: 20, pairPlus: 55 });
    var f2c = J(sheet1({ f2: { hi: null } }), spot1()).f2;
    assert.strictEqual(f2c.ok, false, '未入力が1つでもあれば NG');
    assert.strictEqual(f2c.diff.hi, null);
    assert.strictEqual(f2c.diff.trash, 0);

    // ---------------------------------------------------------------- f3
    // QsJd9c：期待 shift = strong 4 + backdoor 3 = 7、ranks = K T 8
    var f3ok = J(sheet2(), spot2()).f3;
    assert.strictEqual(f3ok.ok, true);
    assert.deepStrictEqual(f3ok.expect, { shiftPct: 7, ranks: ['K', 'T', '8'] });
    assert.deepStrictEqual(f3ok.got, { shiftPct: 7, ranks: ['K', 'T', '8'], noDraw: false });
    assert.deepStrictEqual(f3ok.missingRanks, []);
    assert.deepStrictEqual(f3ok.extraRanks, []);
    assert.strictEqual(f3ok.tol, 6);

    var f3miss = J(sheet2({ f3: { drawRanks: ['K', 'T'] } }), spot2()).f3;
    assert.strictEqual(f3miss.ok, false, 'ランク不足は NG');
    assert.deepStrictEqual(f3miss.missingRanks, ['8']);
    assert.deepStrictEqual(f3miss.extraRanks, []);

    var f3extra = J(sheet2({ f3: { drawRanks: ['K', 'T', '8', 'A'] } }), spot2()).f3;
    assert.strictEqual(f3extra.ok, false, '余計なランクも NG');
    assert.deepStrictEqual(f3extra.missingRanks, []);
    assert.deepStrictEqual(f3extra.extraRanks, ['A']);

    var f3both = J(sheet2({ f3: { drawRanks: ['t', 'Q'] } }), spot2()).f3;
    assert.deepStrictEqual(f3both.missingRanks, ['K', '8'], '不足は A..2 の順');
    assert.deepStrictEqual(f3both.extraRanks, ['Q']);
    assert.deepStrictEqual(f3both.got.ranks, ['Q', 'T'], '小文字は大文字に直し A..2 順にそろえる');

    var f3tolEdge = J(sheet2({ f3: { shiftPct: 13 } }), spot2()).f3;
    assert.strictEqual(f3tolEdge.ok, true, 'shift の |diff|=6 は境界で ok');
    assert.strictEqual(f3tolEdge.diff, 6);
    var f3tolOver = J(sheet2({ f3: { shiftPct: 14 } }), spot2()).f3;
    assert.strictEqual(f3tolOver.ok, false, '|diff|=7 は NG');
    assert.strictEqual(f3tolOver.shiftOk, false);
    assert.strictEqual(f3tolOver.ranksOk, true);
    var f3null = J(sheet2({ f3: { shiftPct: null } }), spot2()).f3;
    assert.strictEqual(f3null.ok, false, 'shift 未入力は NG');
    assert.strictEqual(f3null.diff, null);

    // noDraw：Ks7d5c は期待 ranks が空
    var nd1 = J(sheet1({ f3: { shiftPct: 17.5 } }), spot1()).f3;
    assert.strictEqual(nd1.ok, true, '期待 ranks が空で noDraw=true なら ranks は ok');
    assert.strictEqual(nd1.ranksOk, true);
    assert.deepStrictEqual(nd1.expect, { shiftPct: 17.5, ranks: [] });
    var nd2 = J(sheet1({ f3: { noDraw: false, drawRanks: [], shiftPct: 17.5 } }), spot1()).f3;
    assert.strictEqual(nd2.ok, false, '期待が空でも「ドロー無し」の宣言が無ければ ranks は NG');
    assert.strictEqual(nd2.ranksOk, false);
    var nd3 = J(sheet1({ f3: { noDraw: true, drawRanks: ['T'], shiftPct: 17.5 } }), spot1()).f3;
    assert.strictEqual(nd3.ok, false, 'noDraw なのにランクを挙げたら NG');
    assert.deepStrictEqual(nd3.extraRanks, ['T']);
    // noDraw を宣言したが実は期待 ranks がある
    var nd4 = J(sheet2({ f3: { noDraw: true, drawRanks: [] } }), spot2()).f3;
    assert.strictEqual(nd4.ok, false);
    assert.deepStrictEqual(nd4.missingRanks, ['K', 'T', '8']);

    // ---------------------------------------------------------------- f4：pureAir／enough
    var f4ok = J(sheet2(), spot2()).f4;
    assert.strictEqual(f4ok.ok, true);
    assert.deepStrictEqual(f4ok.expect, { pureAir: 33, enough: true });
    assert.strictEqual(f4ok.got.pureAirPct, 33);
    assert.strictEqual(f4ok.got.enough, true);
    assert.deepStrictEqual(f4ok.got.foldList, ['32o', '52o', '62o']);
    assert.strictEqual(f4ok.tol, 8);
    assert.deepStrictEqual(f4ok.invalid, []);
    assert.strictEqual(f4ok.orderOk, true);

    assert.strictEqual(J(sheet2({ f4: { pureAirPct: 41 } }), spot2()).f4.ok, true, 'pureAir の |diff|=8 は境界で ok');
    assert.strictEqual(J(sheet2({ f4: { pureAirPct: 42 } }), spot2()).f4.ok, false, '|diff|=9 は NG');
    assert.strictEqual(J(sheet2({ f4: { pureAirPct: 25 } }), spot2()).f4.ok, true, '下側 -8 も ok');
    assert.strictEqual(J(sheet2({ f4: { pureAirPct: null } }), spot2()).f4.ok, false, '未入力は NG');
    assert.strictEqual(J(sheet2({ f4: { pureAirPct: null } }), spot2()).f4.diff, null);

    // enough：期待 = (pureAir >= required)。33% は 33>=30 → true、50% は 33>=40 → false
    assert.strictEqual(J(sheet2({ f4: { enough: 'no' } }), spot2()).f4.ok, false, 'enough 不一致は NG');
    assert.strictEqual(J(sheet2({ f4: { enough: null } }), spot2()).f4.ok, false, 'enough 未入力は NG');
    assert.strictEqual(J(sheet2({ f4: { enough: true } }), spot2()).f4.ok, true, 'boolean の enough も受ける');
    var f4s50 = J(sheet2({ f1: { foldPct: 40 }, f4: { enough: 'no' } }), spot2({ size: 50 })).f4;
    assert.deepStrictEqual(f4s50.expect, { pureAir: 33, enough: false }, '50% は必要 40 > 33 で足りない');
    assert.strictEqual(f4s50.got.enough, false);
    assert.strictEqual(f4s50.ok, true);
    assert.strictEqual(J(sheet2({ f4: { enough: 'no' } }), spot2({ size: 50 })).f4.ok, true);
    assert.strictEqual(J(sheet2({ f4: { enough: false } }), spot2({ size: 50 })).f4.ok, true, 'boolean false も受ける');
    assert.strictEqual(J(sheet2({ f4: { enough: 'yes' } }), spot2({ size: 50 })).f4.ok, false);
    assert.strictEqual(J(sheet1({ f4: { enough: 'yes' } }), spot1()).f4.expect.enough, false, 'Ks7d5c：7.5 < 30 で足りない');
    // 境界：pureAir == required は足りる（>=）
    var edgeV = lj.judge(sheet2(), spot2(), range, { cards: cards, range: mockRange(), baseline: { 33: 33 } });
    assert.strictEqual(edgeV.required, 33);
    assert.strictEqual(edgeV.f4.expect.enough, true, '33 >= 33 は足りる');
    var edgeV2 = lj.judge(sheet2(), spot2(), range, { cards: cards, range: mockRange(), baseline: { 33: 34 } });
    assert.strictEqual(edgeV2.f4.expect.enough, false, '33 < 34 は足りない');

    // 空の foldList は未入力扱い
    var f4empty = J(sheet2({ f4: { foldList: [] } }), spot2()).f4;
    assert.strictEqual(f4empty.ok, false);
    assert.deepStrictEqual(f4empty.invalid, []);

    // ---------------------------------------------------------------- f4：invalid の種類（Ks7d5c）
    var kinds = J(sheet1({
      f4: { foldList: ['J2o', 'AQs', 'T9s', '98s', 'AA', 'Q7o', 'AKo', 'Q9s', 'XYo', 'AK'] }
    }), spot1());
    var inv = kinds.f4.invalid;
    assert.deepStrictEqual(inv.map(function (x) { return x.hand; }),
      ['AQs', 'T9s', '98s', 'AA', 'Q7o', 'AKo', 'Q9s', 'XYo', 'AK'], 'J2o（純air）だけが valid、並びは入力順');
    function why(h) { return inv.filter(function (x) { return x.hand === h; })[0].why; }
    assert.ok(/trash ではない/.test(why('AQs')), 'ハイカード：trash でない');
    assert.ok(/バックドア/.test(why('T9s')), 'バックドア付き');
    assert.ok(/ドロー付き/.test(why('98s')), 'ドロー付き');
    assert.ok(/ペア以上/.test(why('AA')), 'ペア以上');
    assert.ok(/コールレンジに居ない/.test(why('Q7o')), 'セル無しはレンジ外');
    assert.ok(/コールレンジに居ない/.test(why('AKo')), '3bet セルはコールレンジに居ない');
    assert.ok(/ブロック/.test(why('Q9s')), 'セルは call だが weakestFirst に無い手はブロック');
    assert.ok(/不正/.test(why('XYo')), '名前が不正');
    assert.ok(/不正/.test(why('AK')), '接尾辞なしの異ランクは名前が不正');
    assert.strictEqual(kinds.f4.ok, false, 'invalid があれば f4 は NG');
    inv.forEach(function (x) { assert.ok(typeof x.why === 'string' && x.why.length > 0); });
    assert.strictEqual(kinds._mock.statsCalls, 1, 'fold 手が10個あっても stats は1回');

    // 名前の揺れ：小文字・具体2枚・重複
    var alias = J(sheet1({ f4: { foldList: ['j2O', 'Jh2c', 'J2o'] } }), spot1()).f4;
    assert.deepStrictEqual(alias.invalid, [], '小文字・具体2枚・重複は J2o として valid（重複は二重に数えない）');
    assert.strictEqual(alias.orderOk, true);
    var dupBad = J(sheet1({ f4: { foldList: ['AA', 'AsAh'] } }), spot1()).f4;
    assert.strictEqual(dupBad.invalid.length, 1, '同じ手の invalid は1件にまとめる');

    // ---------------------------------------------------------------- f4：orderOk（弱い順 = score 非減少）
    function order(list) { return J(sheet1({ f4: { foldList: list } }), spot1()).f4.orderOk; }
    assert.strictEqual(order(['J2o', 'QJs', 'T9s']), true, '1.1102 <= 2.0 <= 2.4');
    assert.strictEqual(order(['T9s', 'J2o']), false, '強い順に並べたら false');
    assert.strictEqual(order(['QJs', 'AQs']), true, '同点は可');
    assert.strictEqual(order(['AQs', 'QJs']), true, '同点は逆順でも可');
    assert.strictEqual(order(['J2o', 'Q7o', 'T9s']), true, 'レンジ外の手は並びの判定から外す');
    assert.strictEqual(order(['AA', 'J2o']), false, 'ペア以上が先なら false（invalid でも score で見る）');
    assert.strictEqual(order(['J2o']), true, '1件は true');
    assert.strictEqual(order(['J2o', 'QJs', 'T9s', '98s', 'A5s', 'KQs', 'AA']), true);

    // ---------------------------------------------------------------- f4：sub が無いときのコンボ展開による保険
    var comboList = [
      { hand: 'J2o', cards: 'Jh2c', w: 1 },
      { hand: 'T9s', cards: 'Th9h', w: 1 },
      { hand: '98s', cards: '9h8h', w: 1 }
    ];
    var fb = J(sheet1({ f4: { foldList: ['J2o', 'T9s', '98s'] } }), spot1(), { noSub: true, combos: comboList });
    assert.deepStrictEqual(fb.f4.invalid.map(function (x) { return x.hand; }), ['T9s', '98s'],
      'sub が無くてもコンボの handFeatures から pureAir／backdoor／strong を判別');
    assert.ok(/バックドア/.test(fb.f4.invalid[0].why));
    assert.ok(/ドロー付き/.test(fb.f4.invalid[1].why));
    assert.strictEqual(fb._mock.statsCalls, 1);
    assert.strictEqual(fb._mock.comboCalls, 1, 'コンボ展開は1回だけ');
    var noFb = J(sheet1({ f4: { foldList: ['J2o', 'T9s'] } }), spot1(), { noSub: false, combos: comboList });
    assert.strictEqual(noFb._mock.comboCalls, 0, 'sub があればコンボ展開はしない');

    // ---------------------------------------------------------------- f5
    function f5of(heroKey, over, spotExtra) {
      var sp = spot1({ hero: heroKey });
      if (spotExtra) for (var k in spotExtra) sp[k] = spotExtra[k];
      return J(sheet1({ f5: over || {} }), sp).f5;
    }
    // 必要 fold% 30：percentile < 25 → in／25..35 → edge／35 超 → above。action：< 30 → fold
    var p20 = f5of('Ad4d', { position: 'in', action: 'fold' });
    assert.strictEqual(p20.predicted.position, 'in');
    assert.strictEqual(p20.predicted.action, 'fold');
    assert.strictEqual(p20.predicted.percentile, 20);
    assert.strictEqual(p20.predicted.cat, 'hi');
    assert.strictEqual(p20.ok, true);
    assert.strictEqual(p20.positionOk, true);
    assert.deepStrictEqual(p20.got, { position: 'in', action: 'fold' });
    assert.strictEqual(p20.note, '予測（GTO 真値ではない）');

    var p249 = f5of('Qs3h', { position: 'in', action: 'fold' });
    assert.strictEqual(p249.predicted.position, 'in', '24.9 < 25 は in');
    var p25 = f5of('Qs2h', { position: 'edge', action: 'fold' });
    assert.strictEqual(p25.predicted.position, 'edge', 'ちょうど 25（required-5）は edge');
    assert.strictEqual(p25.predicted.action, 'fold');
    var p299 = f5of('Jc2h', { position: 'edge', action: 'fold' });
    assert.strictEqual(p299.predicted.position, 'edge');
    assert.strictEqual(p299.predicted.action, 'fold', '29.9 < 30 は fold');
    var p30 = f5of('Qs6h', { position: 'edge', action: 'call' });
    assert.strictEqual(p30.predicted.position, 'edge');
    assert.strictEqual(p30.predicted.action, 'call', 'ちょうど 30 は call');
    assert.strictEqual(p30.ok, true);
    var p35 = f5of('Qs4h', { position: 'edge', action: 'call' });
    assert.strictEqual(p35.predicted.position, 'edge', 'ちょうど 35（required+5）は edge');
    var p351 = f5of('Qs5h', { position: 'above', action: 'call' });
    assert.strictEqual(p351.predicted.position, 'above', '35.1 は above');
    var p80 = f5of('AhKh', { position: 'above', action: 'call' });
    assert.strictEqual(p80.predicted.position, 'above');
    assert.strictEqual(p80.ok, true);

    // ok は action 一致のみ。position が違っても action が合えば ok
    var posWrong = f5of('Ad4d', { position: 'above', action: 'fold' });
    assert.strictEqual(posWrong.ok, true, 'action だけで ok を決める');
    assert.strictEqual(posWrong.positionOk, false);
    var actWrong = f5of('Ad4d', { position: 'in', action: 'call' });
    assert.strictEqual(actWrong.ok, false);
    var actNull = f5of('Ad4d', { position: 'in', action: null });
    assert.strictEqual(actNull.ok, false, 'action 未入力は NG');
    assert.strictEqual(actNull.got.action, null);

    // hero が無い／stats に hero が無い
    var noHero = J(sheet1(), { board: 'Ks7d5c', size: 33 }).f5;
    assert.strictEqual(noHero.ok, false);
    assert.deepStrictEqual(noHero.predicted, { position: null, action: null, percentile: null, cat: null });

    // サイズが変われば必要 fold% も変わる（50% → 40：36 は edge／fold）
    var f5s50 = J(sheet2({ f1: { foldPct: 40 }, f4: { enough: 'no' }, f5: { position: 'edge', action: 'fold' } }), spot2({ size: 50 }));
    assert.strictEqual(f5s50.f5.predicted.position, 'edge', '36 は 40±5 の中');
    assert.strictEqual(f5s50.f5.predicted.action, 'fold');
    assert.strictEqual(f5s50.f5.ok, true);
    assert.strictEqual(J(sheet2(), spot2()).f5.predicted.position, 'above', '33% なら 36 は 30+5 を超えて above');

    // ---------------------------------------------------------------- summary.score
    // size_fold
    function sizeFold(v) { return J(sheet1({ f1: { foldPct: v } }), spot1()).summary.score.size_fold; }
    assert.strictEqual(sizeFold(30), 2);
    assert.strictEqual(sizeFold(35), 2, '|diff|=5 → 2');
    assert.strictEqual(sizeFold(25), 2);
    assert.strictEqual(sizeFold(36), 1, '|diff|=6 → 1');
    assert.strictEqual(sizeFold(40), 1, '|diff|=10 → 1');
    assert.strictEqual(sizeFold(20), 1);
    assert.strictEqual(sizeFold(41), 0, '|diff|=11 → 0');
    assert.strictEqual(sizeFold(null), 0, '未入力 → 0');

    // draw_protect：f3.ok → 4／ranks だけ → 2／shift だけ → 2／他 0
    function dp(over) { return J(sheet2({ f3: over }), spot2()).summary.score.draw_protect; }
    assert.strictEqual(dp({}), 4, 'f3.ok → 4');
    assert.strictEqual(dp({ shiftPct: 50 }), 2, 'ranks だけ合う → 2');
    assert.strictEqual(dp({ drawRanks: ['A'] }), 2, 'shift だけ合う → 2');
    assert.strictEqual(dp({ shiftPct: 50, drawRanks: ['A'] }), 0, 'どちらも外れ → 0');
    assert.strictEqual(dp({ shiftPct: null, drawRanks: [] }), 0);
    // noDraw で期待も空なら（shift が期待とズレていても）4
    var nd = J(sheet1({ f3: { noDraw: true, drawRanks: [], shiftPct: 0 } }), spot1());
    assert.strictEqual(nd.f3.ok, false, 'Ks7d5c の shift 期待は 17.5 なので f3.ok 自体は false');
    assert.strictEqual(nd.summary.score.draw_protect, 4, 'ただし noDraw 宣言と期待 ranks 空が揃えば draw_protect は 4');
    // 宣言が無い／ランクを挙げた場合は適用しない
    assert.strictEqual(J(sheet1({ f3: { noDraw: false, drawRanks: [], shiftPct: 0 } }), spot1()).summary.score.draw_protect, 0);
    assert.strictEqual(J(sheet1({ f3: { noDraw: true, drawRanks: ['T'], shiftPct: 0 } }), spot1()).summary.score.draw_protect, 0);

    // action
    assert.strictEqual(J(sheet1({ f5: { action: 'call' } }), spot1()).summary.score.action, 0);
    assert.strictEqual(J(sheet1({ f5: { action: 'fold' } }), spot1()).summary.score.action, 1);

    // okCount：1つずつ壊す
    assert.strictEqual(J(sheet1({ f1: { foldPct: 60 } }), spot1()).summary.okCount, 4);
    assert.strictEqual(J(sheet1({ f1: { foldPct: 60 }, f2: { trash: 90 }, f5: { action: 'call' } }), spot1()).summary.okCount, 2);

    // ---------------------------------------------------------------- ソース衛生
    var src = fs.readFileSync(LJ_PATH, 'utf8');
    var bannedTerms = new RegExp(['乾' + 'い', '濡' + 'れ', '高' + 'カード', '接' + '続'].join('|'));
    assert.ok(!bannedTerms.test(src), '用語はカタカナ正典（禁止語を含まない）');
    assert.ok(!/https?:\/\//i.test(src), '生の URL を埋め込まない');
    assert.ok(src.indexOf('note.com') < 0);
    assert.ok(!/=>/.test(src), 'ES5：アロー関数を使わない');
    assert.ok(!/(^|[^\w])(let|const)\s+[\w$]+\s*=/m.test(src), 'ES5：let／const を使わない');
    assert.ok(src.indexOf('`') < 0, 'ES5：テンプレートリテラルを使わない');
    assert.ok(!/\bdocument\b/.test(src), 'document を直接触らない');
    assert.ok(src.indexOf('ヒューリスティック') >= 0, '⑤が仮の序列であることをコメントに明記');
  }
};
