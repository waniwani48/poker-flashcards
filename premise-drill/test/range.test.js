// PD.range（Phase D）のテスト。SPEC-judge.md §1・§4 の項目を1つずつ assert する。
//   node test/run.js range
'use strict';

var fs = require('fs');
var path = require('path');
var R = require(path.join(__dirname, '..', 'js', 'range.js'));
var PD = globalThis.PD;

var RANGE_PATH = path.join(__dirname, '..', 'js', 'range.js');
var DATA_PATH = path.join(__dirname, '..', 'js', 'range-data.js');

/** localStorage スタブ（自分専用。他テストの残留に依存しない） */
function makeStub(seed) {
  var data = {};
  if (seed) for (var k in seed) data[k] = String(seed[k]);
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, val) { data[key] = String(val); },
    removeItem: function (key) { delete data[key]; },
    _data: data
  };
}

function install(value) {
  Object.defineProperty(globalThis, 'localStorage', { value: value, configurable: true, writable: true });
}

function near(assert, actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (msg || '') + ' expected ' + expected + ' got ' + actual);
}

/** hands を 'call' で埋めた Range */
function build(hands, state) {
  var r = R.empty();
  hands.forEach(function (h) { r = R.setCell(r, h, state || 'call'); });
  return r;
}

function find(list, hand) {
  for (var i = 0; i < list.length; i++) if (list[i].hand === hand) return list[i];
  return null;
}

/** 仕様 §4 の手作りレンジ：AA〜22 全 call＋AKs〜A2s＋KQs〜K9s＋QJs/JTs/T9s/98s/76s/65s＋J2o */
var STD_HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
  'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'JTs', 'T9s', '98s', '76s', '65s', 'J2o'];

/** 決定的な疑似乱数（ES5 の number で桁あふれしない LCG） */
function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

module.exports = {
  name: 'range (PD.range)',
  run: function (assert) {
    var origDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    var origData = PD.rangeData;
    try {
      install(makeStub());
      body(assert, origData);
    } finally {
      PD.rangeData = origData;
      if (origDesc) Object.defineProperty(globalThis, 'localStorage', origDesc);
      else delete globalThis.localStorage;
    }
  }
};

function body(assert, origData) {
  var std = build(STD_HANDS);

  // ---------------------------------------------------------------- 13×13 と HANDS
  assert.strictEqual(R.HANDS.length, 169, 'HANDS は 169 名');
  var uniq = {};
  R.HANDS.forEach(function (h) { uniq[h] = true; });
  assert.strictEqual(Object.keys(uniq).length, 169, 'HANDS に重複なし');
  assert.strictEqual(R.HAND_GRID.length, 13);
  R.HAND_GRID.forEach(function (row) { assert.strictEqual(row.length, 13); });
  assert.strictEqual(R.HAND_GRID[0][0], 'AA');
  assert.strictEqual(R.HAND_GRID[0][1], 'AKs', 'i<j は suited');
  assert.strictEqual(R.HAND_GRID[1][0], 'AKo', 'i>j は offsuit（高い方が先）');
  assert.strictEqual(R.HAND_GRID[1][1], 'KK');
  assert.strictEqual(R.HAND_GRID[11][12], '32s');
  assert.strictEqual(R.HAND_GRID[12][11], '32o');
  assert.strictEqual(R.HAND_GRID[12][12], '22');
  assert.deepStrictEqual(R.HANDS.slice(0, 3), ['AA', 'AKs', 'AQs'], '行優先');
  assert.strictEqual(R.HANDS[13], 'AKo');
  var nS = 0;
  var nO = 0;
  var nP = 0;
  R.HANDS.forEach(function (h) {
    if (h.length === 2) nP++;
    else if (h.charAt(2) === 's') nS++;
    else nO++;
  });
  assert.deepStrictEqual([nP, nS, nO], [13, 78, 78]);

  // 全 call のレンジを展開すると 1326 コンボ。名前・枚数が PD.cards.handName と一致する
  var full = R.empty();
  R.HANDS.forEach(function (h) { full = R.setCell(full, h, 'call'); });
  var allCombos = R.combos(full, '');
  assert.strictEqual(allCombos.length, 1326);
  var perHand = {};
  allCombos.forEach(function (c) {
    var p = PD.cards.parseHand(c.cards);
    assert.ok(p.ok, '具体カードが parseHand で読める: ' + c.cards);
    assert.strictEqual(PD.cards.handName(p.cards), c.hand, '名前が一致: ' + c.cards);
    perHand[c.hand] = (perHand[c.hand] || 0) + 1;
  });
  R.HANDS.forEach(function (h) {
    var want = h.length === 2 ? 6 : (h.charAt(2) === 's' ? 4 : 12);
    assert.strictEqual(perHand[h], want, h + ' のコンボ数');
  });

  // ---------------------------------------------------------------- callWeight／cycle
  assert.strictEqual(R.callWeight('call'), 1);
  assert.strictEqual(R.callWeight('mix'), 0.5);
  assert.strictEqual(R.callWeight('3bet'), 0);
  assert.strictEqual(R.callWeight('fold'), 0);
  assert.strictEqual(R.callWeight(undefined), 0);
  assert.deepStrictEqual(R.STATE_ORDER, ['fold', 'call', '3bet', 'mix']);
  assert.strictEqual(R.cycle('fold'), 'call');
  assert.strictEqual(R.cycle('call'), '3bet');
  assert.strictEqual(R.cycle('3bet'), 'mix');
  assert.strictEqual(R.cycle('mix'), 'fold', '一周する');
  assert.strictEqual(R.cycle(undefined), 'call', '未定義は fold 扱い');

  // ---------------------------------------------------------------- empty／setCell（純粋）
  var e0 = R.empty();
  assert.deepStrictEqual(e0, { v: 1, cells: {}, updatedAt: null, source: '' });
  var snap = JSON.stringify(e0);
  var s1 = R.setCell(e0, 'AA', 'call', '2026-10-16T10:00:00');
  assert.strictEqual(JSON.stringify(e0), snap, '元の Range は変わらない');
  assert.notStrictEqual(s1, e0);
  assert.strictEqual(s1.cells.AA, 'call');
  assert.strictEqual(s1.updatedAt, '2026-10-16T10:00:00', 'now を渡すと updatedAt を更新');
  var s2 = R.setCell(s1, 'AA', 'mix');
  assert.strictEqual(s1.cells.AA, 'call', '元は call のまま');
  assert.strictEqual(s2.cells.AA, 'mix');
  assert.strictEqual(s2.updatedAt, '2026-10-16T10:00:00', 'now 省略なら updatedAt は据え置き');
  var s3 = R.setCell(s1, 'XX', 'call');
  assert.deepStrictEqual(s3, s1, '不正な hand は無視（同じ内容）');
  assert.notStrictEqual(s3, s1, '新しいオブジェクト');
  assert.deepStrictEqual(R.setCell(s1, 'AA', 'raise'), s1, '不正な state は無視');
  assert.deepStrictEqual(R.setCell(s1, 'aa', 'call'), s1, '小文字の hand は不正');
  assert.deepStrictEqual(R.setCell(s1, 'AA', 'fold').cells, {}, 'fold は cells から落とす（既定値）');
  assert.strictEqual(R.cellState(s1, 'AA'), 'call');
  assert.strictEqual(R.cellState(s1, 'KK'), 'fold', 'cells に無い手は fold');

  // ---------------------------------------------------------------- isFilled
  assert.strictEqual(R.isFilled(R.empty()), false);
  assert.strictEqual(R.isFilled(build(R.HANDS.slice(0, 19))), false, '19 セルは未入力');
  assert.strictEqual(R.isFilled(build(R.HANDS.slice(0, 20))), true, '20 セルで入力済み');
  assert.strictEqual(R.isFilled(build(R.HANDS.slice(0, 20), '3bet')), false, '3bet は数えない');
  var mixed = build(R.HANDS.slice(0, 10), 'call');
  R.HANDS.slice(10, 20).forEach(function (h) { mixed = R.setCell(mixed, h, 'mix'); });
  assert.strictEqual(R.isFilled(mixed), true, 'call と mix の合計で数える');
  assert.strictEqual(R.isFilled(null), false);

  // ---------------------------------------------------------------- summary
  var pairs = build(['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22']);
  var sm = R.summary(pairs);
  assert.strictEqual(sm.callCombos, 78, 'AA〜22 全 call＝78 コンボ');
  assert.strictEqual(sm.callPct, 5.9);
  assert.strictEqual(sm.threeBetCombos, 0);
  assert.strictEqual(sm.mixCombos, 0);
  var sm2 = R.summary(R.setCell(R.setCell(R.setCell(R.empty(), 'AKs', 'call'), 'AKo', '3bet'), 'QQ', 'mix'));
  assert.strictEqual(sm2.callCombos, 7, 'suited 4＋mix(ペア6)の半分 3');
  assert.strictEqual(sm2.threeBetCombos, 15, 'offsuit 12＋mix の半分 3');
  assert.strictEqual(sm2.mixCombos, 6);
  assert.strictEqual(sm2.callPct, 0.5);
  assert.strictEqual(sm2.threeBetPct, 1.1);
  assert.strictEqual(R.summary(std).callCombos, 178);
  assert.strictEqual(R.summary(std).callPct, 13.4);
  assert.strictEqual(R.summary(R.empty()).callPct, 0);

  // ---------------------------------------------------------------- combos（ブロッカー除外）
  var cr = R.setCell(R.setCell(R.setCell(R.setCell(R.empty(), 'AKs', 'call'), 'KK', 'call'), 'AQs', 'mix'), 'AA', '3bet');
  var cb = R.combos(cr, 'Ks7d5c');
  var akCombos = cb.filter(function (c) { return c.hand === 'AKs'; });
  var kkCombos = cb.filter(function (c) { return c.hand === 'KK'; });
  var aqCombos = cb.filter(function (c) { return c.hand === 'AQs'; });
  assert.strictEqual(akCombos.length, 3, 'board Ks7d5c で AKs は 3 コンボ（AsKs が消える）');
  assert.deepStrictEqual(akCombos.map(function (c) { return c.cards; }).sort(), ['AcKc', 'AdKd', 'AhKh']);
  assert.strictEqual(kkCombos.length, 3, 'KK は 3 コンボ（Ks を含む3つが消える）');
  assert.ok(kkCombos.every(function (c) { return c.cards.indexOf('Ks') < 0; }));
  assert.strictEqual(aqCombos.length, 4);
  assert.ok(aqCombos.every(function (c) { return c.w === 0.5; }), 'mix の w は 0.5');
  assert.ok(akCombos.every(function (c) { return c.w === 1; }), 'call の w は 1');
  assert.ok(!cb.some(function (c) { return c.hand === 'AA'; }), '3bet はコールレンジに入らない');
  var cbHero = R.combos(cr, 'Ks7d5c', 'Ad4d');
  assert.strictEqual(cbHero.filter(function (c) { return c.hand === 'AKs'; }).length, 2, 'hero の Ad を使う AdKd も消える');
  assert.strictEqual(cbHero.filter(function (c) { return c.hand === 'AQs'; }).length, 3, 'AdQd も消える');
  assert.strictEqual(R.combos(cr, '').filter(function (c) { return c.hand === 'KK'; }).length, 6, 'board 無しなら除外なし');
  assert.deepStrictEqual(R.combos(cr, 'Zz7d5c'), [], '不正なボードは空');
  assert.strictEqual(R.combos(R.empty(), 'Ks7d5c').length, 0);

  // ---------------------------------------------------------------- stats：不正入力
  assert.strictEqual(R.stats(std, 'Ks7d'), null, '2枚は不正');
  assert.strictEqual(R.stats(std, 'KsKs7d'), null, '重複は不正');
  assert.strictEqual(R.stats(std, ''), null);
  assert.strictEqual(R.stats(std, undefined), null);
  assert.strictEqual(R.stats(std, 'Xx7d5c'), null);

  // ---------------------------------------------------------------- stats：Ks7d5c の分類
  var st = R.stats(std, 'Ks7d5c', 'Ad4d');
  assert.strictEqual(st.total, 160, '除外後の重み合計');
  assert.deepStrictEqual(st.pct, { pairPlus: 60, hi: 22.5, trash: 17.5 });
  assert.deepStrictEqual(st.draws, { strong: 2.5, backdoor: 7.5, pureAir: 7.5 });
  assert.deepStrictEqual(st.drawRanks, [], 'Ks7d5c にはドローになるランクが無い');
  assert.strictEqual(st.weakestFirst.length, 36);

  var kqs = find(st.weakestFirst, 'KQs');
  assert.strictEqual(kqs.cat, 'pairPlus', 'KQs は top pair');
  assert.strictEqual(kqs.w, 3);
  near(assert, kqs.score, 6.12, 'top pair 6.0＋キッカー Q');
  var aqs = find(st.weakestFirst, 'AQs');
  assert.strictEqual(aqs.cat, 'hi', 'AQs は hi');
  assert.strictEqual(find(st.weakestFirst, 'QJs').cat, 'trash');
  assert.strictEqual(find(st.weakestFirst, 'QJs').sub, 'backdoor', 'QJs は bdsd 有り＝backdoor');
  assert.strictEqual(find(st.weakestFirst, 'JTs').sub, 'backdoor');
  assert.strictEqual(find(st.weakestFirst, 'T9s').cat, 'trash', 'T9s は trash');
  assert.strictEqual(find(st.weakestFirst, 'T9s').sub, 'backdoor', 'T9s は T-9-7 と K-T-9 で bdsd');
  assert.strictEqual(find(st.weakestFirst, '98s').sub, 'strong', '98s は 9-8-7-5 でガット＝strong');
  near(assert, find(st.weakestFirst, '98s').score, 3.0, 'gut 3.0');
  // 注：65s は 5 とペア（third pair）なので pairPlus。gut ではない
  assert.strictEqual(find(st.weakestFirst, '65s').cat, 'pairPlus', '65s はボードの 5 とペア');
  near(assert, find(st.weakestFirst, '65s').score, 4.56, 'third pair 4.5＋キッカー 6');
  var j2o = find(st.weakestFirst, 'J2o');
  assert.strictEqual(j2o.cat, 'trash');
  assert.strictEqual(j2o.sub, 'pureAir', 'J2o は pureAir');
  assert.strictEqual(j2o.w, 12);
  near(assert, j2o.score, 1.1102, 'ドロー無し 1.0＋J/100＋2/10000');
  assert.strictEqual(st.weakestFirst[0].hand, 'J2o', '最も弱いのは J2o');

  // ペアの位置・ポケットの位置（score は丸めない）
  near(assert, find(st.weakestFirst, 'AA').score, 6.64, 'overpair 6.5＋A');
  near(assert, find(st.weakestFirst, 'KK').score, 8.13, 'セット 8.0＋K');
  near(assert, find(st.weakestFirst, '77').score, 8.07);
  near(assert, find(st.weakestFirst, 'QQ').score, 5.62, 'between1 pocket 5.5');
  near(assert, find(st.weakestFirst, '66').score, 4.76, 'between2 pocket 4.7');
  near(assert, find(st.weakestFirst, '44').score, 4.04, 'under pocket 4.0');
  near(assert, find(st.weakestFirst, 'A7s').score, 5.14, 'second pair 5.0＋A');
  near(assert, find(st.weakestFirst, 'A5s').score, 4.64, 'third pair 4.5＋A');
  near(assert, find(st.weakestFirst, 'AKs').score, 6.14);
  // draws の平均 score（suit 別に bdfd 有り／無しが混ざる）
  near(assert, find(st.weakestFirst, 'QJs').score, (2.4 * 3 + 2.0) / 4, 'bdfd+bdsd 3 コンボ＋bdsd 1 コンボの平均');

  // weakestFirst：昇順・w>0・合計一致
  for (var i = 1; i < st.weakestFirst.length; i++) {
    assert.ok(st.weakestFirst[i - 1].score <= st.weakestFirst[i].score + 1e-9, 'score 昇順');
  }
  var wsum = 0;
  st.weakestFirst.forEach(function (e) { assert.ok(e.w > 0); wsum += e.w; });
  assert.strictEqual(wsum, st.total);

  // hero の序列
  assert.strictEqual(st.hero.hand, 'A4s');
  assert.strictEqual(st.hero.cards, 'Ad4d');
  near(assert, st.hero.score, 2.4, 'bdfd+bdsd');
  assert.strictEqual(st.hero.cat, 'hi');
  assert.strictEqual(st.hero.percentile, 29.1, '自分より弱い 33＋同点 27 の半分 → 46.5/160');
  assert.strictEqual(R.stats(std, 'Ks7d5c', '9d8d').hero.percentile, 38.8, 'gut の 98s');
  assert.strictEqual(R.stats(std, 'Ks7d5c', 'Td2c').hero.percentile, 0, 'hero が最弱（範囲外）なら 0');
  var top = R.stats(std, 'Ks7d5c', 'KdKh').hero;
  assert.strictEqual(top.percentile, 99.1, 'hero が最強なら 100 付近');
  assert.ok(top.percentile > 99);
  assert.strictEqual(R.stats(std, 'Ks7d5c').hero, null, 'hero 省略なら null');
  assert.strictEqual(R.stats(std, 'Ks7d5c', 'Ks2d').hero, null, 'ボードと重なる hero は null');
  assert.strictEqual(R.stats(std, 'Ks7d5c', 'AdAd').hero, null, '重複は null');
  assert.strictEqual(R.stats(std, 'Ks7d5c', 'Ad').hero, null, '1枚は null');
  assert.strictEqual(R.stats(std, 'Ks7d5c', 'Xx2d').hero, null, '不正は null');

  // 空レンジ／3bet のみ
  var se = R.stats(R.empty(), 'Ks7d5c', 'Ad4d');
  assert.strictEqual(se.total, 0);
  assert.deepStrictEqual(se.pct, { pairPlus: 0, hi: 0, trash: 0 });
  assert.deepStrictEqual(se.weakestFirst, []);
  assert.strictEqual(se.hero.percentile, null);
  assert.strictEqual(R.stats(build(['AA', 'KK'], '3bet'), 'Ks7d5c').total, 0, '3bet は重みを持たない');

  // mix の重み
  var mixRange = R.setCell(R.setCell(R.empty(), 'AA', 'mix'), 'KK', 'call');
  var sMix = R.stats(mixRange, 'Qh7d2c');
  assert.strictEqual(sMix.total, 9, 'AA(6×0.5)＋KK(6)');
  assert.strictEqual(find(sMix.weakestFirst, 'AA').w, 3);

  // ---------------------------------------------------------------- hero の分類（score の語彙）
  function heroAt(board, hero) {
    var h = R.stats(std, board, hero).hero;
    assert.ok(h, board + ' ' + hero);
    return h;
  }
  var b1 = 'Ks7d5c';
  near(assert, heroAt(b1, 'KhQc').score, 6.12, 'top pair');
  near(assert, heroAt(b1, '7h2c').score, 5.02, 'second pair');
  near(assert, heroAt(b1, '5h2c').score, 4.52, 'third pair');
  near(assert, heroAt(b1, 'Kh7c').score, 7.13, 'ツーペア');
  near(assert, heroAt(b1, 'AhAc').score, 6.64);
  near(assert, heroAt(b1, '7h7c').score, 8.07, 'セット');
  assert.strictEqual(heroAt(b1, 'AhQc').cat, 'hi');
  near(assert, heroAt(b1, 'AhQc').score, 2.0, 'bdsd のみ');
  assert.strictEqual(heroAt(b1, 'Jh2c').sub, 'pureAir');
  // ドロー付き trash
  assert.strictEqual(heroAt('Ks7s5c', 'Ts9s').sub, 'strong');
  near(assert, heroAt('Ks7s5c', 'Ts9s').score, 3.5, 'fd');
  near(assert, heroAt('9s8s2c', 'Ts7s').score, 3.9, 'fd+oesd');
  near(assert, heroAt('9s8s2c', 'Js7s').score, 3.7, 'fd+gut');
  near(assert, heroAt('9d8c2h', 'Ts7c').score, 3.3, 'oesd');
  near(assert, heroAt('9d8c2h', 'Js7c').score, 3.0, 'gut');
  // 完成フラッシュ／ストレート
  var fl = heroAt('KsJs4s', 'AsTs');
  assert.strictEqual(fl.cat, 'pairPlus', '完成フラッシュ');
  near(assert, fl.score, 9.14);
  var nf = heroAt('KsJs4s', 'AhTh');
  assert.strictEqual(nf.cat, 'hi', 'スートが合わなければフラッシュではない');
  near(assert, nf.score, 3.0, 'ガット');
  var sg = heroAt('9d8c7h', 'Th6c');
  assert.strictEqual(sg.cat, 'pairPlus', '完成ストレート');
  near(assert, sg.score, 9.1);
  assert.strictEqual(heroAt('9d8c7h', 'Jh6c').cat, 'trash', 'J-9-8-7-6 は未完成（OESD）');
  near(assert, heroAt('9d8c7h', 'Jh6c').score, 3.3);
  var wh = heroAt('5d4c3h', 'Ah2c');
  assert.strictEqual(wh.cat, 'pairPlus', 'A-5 ホイールも完成ストレート');
  near(assert, wh.score, 9.14);
  assert.strictEqual(heroAt('5d4c3h', '6h2c').cat, 'pairPlus');
  // ペアボード
  var pb = 'KsKd7c';
  near(assert, heroAt(pb, 'Kh2c').score, 8.02, 'トリップス');
  near(assert, heroAt(pb, '7h2c').score, 7.0 + 0.13 + 0.0007 + 0.000002, 'ボードのペア＋7 でツーペア（KK77、2 キッカー）');
  near(assert, heroAt(pb, 'QhQc').score, 7.0 + 0.13 + 0.0012, 'ペアボード上のポケットはツーペア（KKQQ）');
  // ペアボード上のツーペアは 上のペア→下のペア→キッカー の辞書式で並ぶ（強い手が弱い手より下に来ない）
  assert.ok(heroAt(pb, 'QhQc').score > heroAt(pb, 'Ah7h').score, 'KKQQ > KK77+A');
  assert.ok(heroAt(pb, 'Ah7h').score > heroAt(pb, '3h3c').score, 'KK77+A > KK33');
  assert.ok(heroAt(pb, '7h2c').score > heroAt(pb, '3h3c').score, 'KK77 > KK33');
  assert.ok(heroAt(pb, 'AhAc').score > heroAt(pb, 'QhQc').score, 'AAKK > KKQQ');
  var pb2 = 'Ks7d7c';
  assert.ok(heroAt(pb2, 'AhAc').score > heroAt(pb2, 'Kh2c').score, 'Ks7d7c: AA(77AA) > K2(77KK)');
  assert.ok(heroAt(pb2, 'Kh2c').score > heroAt(pb2, 'QhQc').score, 'Ks7d7c: 77KK > 77QQ');
  assert.ok(heroAt(pb2, 'QhQc').score > heroAt(pb2, '5h5c').score, 'Ks7d7c: 77QQ > 7755');
  assert.ok(heroAt(pb2, 'AhAc').score < 8, 'ツーペアはトリップス(8.0)未満');
  near(assert, heroAt(pb, 'KhKc').score, 9.93, 'クワッズ');
  near(assert, heroAt(pb, '7h7s').score, 9.57, 'フルハウス');
  near(assert, heroAt(pb, 'Kh7h').score, 9.63, 'フルハウス（K＋7）');
  assert.strictEqual(heroAt(pb, 'AhQc').cat, 'hi', 'ボードのペアは hero の役に数えない');
  assert.strictEqual(heroAt(pb, 'Qh2c').cat, 'trash');
  // トリップスボード
  var tb = '7s7d7c';
  near(assert, heroAt(tb, 'Ah7h').score, 9.94, 'クワッズ');
  near(assert, heroAt(tb, 'QhQc').score, 9.62, 'フルハウス');
  assert.strictEqual(heroAt(tb, 'AhKc').cat, 'hi');

  // ---------------------------------------------------------------- 不変条件（疑似乱数の多数ボード・レンジ）
  var rng = makeRng(20261016);
  for (var t = 0; t < 40; t++) {
    var bd = PD.cards.fmt(PD.cards.randomBoard(rng));
    var rr = R.empty();
    var stateByRoll = ['fold', 'fold', 'call', 'call', '3bet', 'mix'];
    R.HANDS.forEach(function (h) { rr = R.setCell(rr, h, stateByRoll[Math.floor(rng() * stateByRoll.length)]); });
    var hero = PD.cards.fmt(PD.cards.randomBoard(rng, bd).slice(0, 2));
    var s = R.stats(rr, bd, hero);
    var cmb = R.combos(rr, bd);
    var csum = 0;
    cmb.forEach(function (c) { csum += c.w; });
    assert.strictEqual(s.total, csum, bd + ': total は combos の重み合計と一致');
    assert.strictEqual(Math.round((s.pct.pairPlus + s.pct.hi + s.pct.trash) * 10), 1000, bd + ': 3 バケツ合計 100');
    assert.strictEqual(Math.round((s.draws.strong + s.draws.backdoor + s.draws.pureAir) * 10), Math.round(s.pct.trash * 10), bd + ': draws の合計 = trash');
    var ws = 0;
    s.weakestFirst.forEach(function (e, idx) {
      ws += e.w;
      if (idx > 0) assert.ok(s.weakestFirst[idx - 1].score <= e.score + 1e-9, bd + ': 昇順');
    });
    assert.strictEqual(ws, s.total, bd + ': weakestFirst の w 合計');
    assert.ok(s.hero.percentile >= 0 && s.hero.percentile <= 100, bd + ' ' + hero + ': percentile 範囲');
    assert.ok(s.weakestFirst.length <= 169);
  }
  // 丸めの端：3 バケツが 1 桁丸めで 100 にならない例でも合計を保つ
  var odd = R.stats(build(['AA', 'AKs', 'T9s']), 'Qh7d2c');
  assert.strictEqual(odd.total, 14);
  assert.strictEqual(Math.round((odd.pct.pairPlus + odd.pct.hi + odd.pct.trash) * 10), 1000);
  assert.ok(Math.abs(odd.pct.pairPlus - 42.857) < 0.1 && Math.abs(odd.pct.hi - 28.571) < 0.1);

  // ドローになるランク（PD.cards.drawRanks の gut∪oesd を 'A'..'2' 順に）
  var sdr = R.stats(std, 'QsJd9c');
  assert.deepStrictEqual(sdr.drawRanks, ['K', 'T', '8'], 'QJ9：K（ガット）・T（OESD）・8（ガット）');

  // ---------------------------------------------------------------- boundaries
  var bRange = R.empty();
  ['QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22',
    'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s',
    'JTs', 'T9s', '98s', '87s', '76s', '65s', 'KQo', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo'
  ].forEach(function (h) { bRange = R.setCell(bRange, h, 'call'); });
  bRange = R.setCell(bRange, 'A5s', 'mix');
  ['AA', 'KK', 'AKs', 'A4s'].forEach(function (h) { bRange = R.setCell(bRange, h, '3bet'); });
  var bd2 = R.boundaries(bRange);
  assert.strictEqual(bd2.As, 'A5s', 'mix も含めて A の底');
  assert.strictEqual(bd2.Ks, 'K9s');
  assert.strictEqual(bd2.Qs, 'Q9s');
  assert.strictEqual(bd2.sc, '65s', '54s は無いので 65s が底');
  assert.deepStrictEqual(bd2.off, { K: 'KTo', Q: 'QTo', J: 'JTo' });
  assert.strictEqual(bd2.pocket, '22');
  assert.deepStrictEqual(bd2.threeBet, ['AA', 'KK', 'AKs', 'A5s', 'A4s'], '3bet と mix を強い順に');
  var bNone = R.boundaries(build(['AA', 'KK']));
  assert.strictEqual(bNone.As, null);
  assert.strictEqual(bNone.Ks, null);
  assert.strictEqual(bNone.sc, null);
  assert.deepStrictEqual(bNone.off, { K: null, Q: null, J: null });
  assert.strictEqual(bNone.pocket, 'KK');
  assert.deepStrictEqual(bNone.threeBet, []);

  // ---------------------------------------------------------------- pfAnswer／checkPf
  assert.strictEqual(R.pfAnswer(R.empty(), 'pf_As'), null, '未入力は null');
  assert.strictEqual(R.checkPf(R.empty(), 'pf_As', 'A5s'), null);
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_As'), { expect: ['A5s'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_Ks'), { expect: ['K9s'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_Qs'), { expect: ['Q9s'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_JTs'), { expect: ['65s'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_off'), { expect: ['KTo', 'QTo', 'JTo'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_pocket'), { expect: ['22'], kind: 'hand' });
  assert.deepStrictEqual(R.pfAnswer(bRange, 'pf_3bet_value'), { expect: ['AA', 'KK', 'AKs', 'A5s', 'A4s'], kind: 'list' });
  assert.strictEqual(R.pfAnswer(bRange, 'pf_3bet_bluff').kind, 'list');
  assert.strictEqual(R.pfAnswer(bRange, 'alpha_33'), null, '未知の id は null');

  // 正規化：大文字化・s/o は小文字・区切りは空白／カンマ／全角・半角スラッシュ
  assert.strictEqual(R.checkPf(bRange, 'pf_As', 'a5s').ok, true, "'a5s'→'A5s'");
  assert.strictEqual(R.checkPf(bRange, 'pf_As', 'A5S').ok, true);
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_As', 'a5s').got, ['A5s']);
  assert.strictEqual(R.checkPf(bRange, 'pf_As', 'A4s').ok, false);
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_As', 'A4s').expect, ['A5s']);
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_pocket', 'kk').got, ['KK'], "'kk'→'KK'");
  assert.strictEqual(R.checkPf(bRange, 'pf_pocket', '22').ok, true);
  assert.strictEqual(R.checkPf(bRange, 'pf_pocket', '22s').ok, false, 'ペアに s は付かない');
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'kto qto jto').ok, true);
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'K9o,Q9o／J9o').ok, false);
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_off', 'K9o,Q9o／J9o').got, ['K9o', 'Q9o', 'J9o'], '区切り：カンマ・全角スラッシュ');
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'KTo,QTo／JTo').ok, true);
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'JTo/QTo/KTo').ok, true, '順序無関係');
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'KTo QTo').ok, false, '欠けると不一致');
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'KTo QTo JTo 98o').ok, false, '余分があると不一致');
  assert.strictEqual(R.checkPf(bRange, 'pf_off', 'ＫＴｏ　ＱＴｏ　ＪＴｏ').ok, true, '全角英数も受ける');
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_As', 'A5s A5s').got, ['A5s'], '重複は1つに');
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_As', '5as').got, ['A5s'], '高い方を先頭に');
  assert.strictEqual(R.checkPf(bRange, 'pf_As', '').ok, false);
  assert.deepStrictEqual(R.checkPf(bRange, 'pf_As', '').got, []);
  assert.strictEqual(R.checkPf(bRange, 'pf_3bet_value', 'AA KK'), null, 'list は判定しない');
  assert.strictEqual(R.checkPf(bRange, 'nope', 'AA'), null);
  // 底が無い行（null）は期待から除く
  var noOff = build(['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', '55', '44', '33', '22', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'JTs', 'T9s']);
  assert.deepStrictEqual(R.pfAnswer(noOff, 'pf_off').expect, [], 'オフスートの底が無ければ期待は空');
  assert.strictEqual(R.checkPf(noOff, 'pf_off', '無し').ok, true);
  assert.strictEqual(R.checkPf(noOff, 'pf_off', '').ok, true);
  assert.strictEqual(R.checkPf(noOff, 'pf_off', 'KTo').ok, false);
  assert.deepStrictEqual(R.pfAnswer(noOff, 'pf_Ks').expect, []);

  // ---------------------------------------------------------------- 保存／読込（localStorage スタブ → 同梱 → empty）
  assert.strictEqual(R.KEY, 'pd_range_v1');
  var stub = makeStub();
  install(stub);

  // 同梱データ（PD.rangeData）の形。中身は後から埋める想定なので空かどうかは問わない
  assert.ok(origData && origData.bb_vs_btn_25, 'PD.rangeData.bb_vs_btn_25 がある');
  assert.strictEqual(origData.bb_vs_btn_25.v, 1);
  assert.ok(origData.bb_vs_btn_25.cells && typeof origData.bb_vs_btn_25.cells === 'object');
  Object.keys(origData.bb_vs_btn_25.cells).forEach(function (h) {
    assert.ok(R.HANDS.indexOf(h) >= 0, '同梱データの手の名前が正しい: ' + h);
    assert.ok(['call', '3bet', 'mix', 'fold'].indexOf(origData.bb_vs_btn_25.cells[h]) >= 0, '同梱データの状態が正しい: ' + h);
  });
  assert.strictEqual(R.importState(JSON.parse(JSON.stringify(origData.bb_vs_btn_25))).ok, true, '同梱データは importState を通る');
  stub.removeItem(R.KEY);

  // 1) 保存なし＋同梱なし → empty
  PD.rangeData = {};
  assert.deepStrictEqual(R.load(), R.empty());
  PD.rangeData = { bb_vs_btn_25: null };
  assert.deepStrictEqual(R.load(), R.empty());
  delete PD.rangeData;
  assert.deepStrictEqual(R.load(), R.empty(), 'rangeData 自体が無くても empty');

  // 2) 保存なし＋同梱あり → 同梱
  var bundled = { v: 1, cells: { AA: 'call', AKs: '3bet', QQ: 'mix' }, updatedAt: '2026-10-16', source: 'test' };
  PD.rangeData = { bb_vs_btn_25: bundled };
  var l2 = R.load();
  assert.deepStrictEqual(l2, bundled);
  assert.notStrictEqual(l2, bundled, '同梱データは複製して返す');
  l2.cells.AA = 'fold';
  assert.strictEqual(bundled.cells.AA, 'call', '返り値を変えても同梱は壊れない');

  // 3) 保存あり → 保存を優先
  var mine = R.setCell(R.empty(), 'KK', 'call', '2026-10-17');
  assert.strictEqual(R.save(mine), true);
  assert.ok(Object.prototype.hasOwnProperty.call(stub._data, 'pd_range_v1'), 'キー pd_range_v1 に保存');
  assert.deepStrictEqual(R.load(), mine);
  assert.deepStrictEqual(R.exportState(), mine, 'exportState は現在の Range');
  assert.strictEqual(R.save(mine, '2026-10-18'), true);
  assert.strictEqual(R.load().updatedAt, '2026-10-18', 'save に now を渡すと updatedAt を打つ');

  // 4) clear → 同梱へ戻る
  assert.strictEqual(R.clear(), true);
  assert.ok(!Object.prototype.hasOwnProperty.call(stub._data, 'pd_range_v1'));
  assert.deepStrictEqual(R.load(), bundled);

  // 5) 壊れた JSON／形が違う → empty
  stub.setItem('pd_range_v1', '{not json');
  assert.deepStrictEqual(R.load(), R.empty(), '壊れた JSON は empty');
  stub.setItem('pd_range_v1', JSON.stringify({ v: 2, cells: {} }));
  assert.deepStrictEqual(R.load(), R.empty(), '版違いは empty');
  stub.setItem('pd_range_v1', 'null');
  assert.deepStrictEqual(R.load(), R.empty());
  stub.setItem('pd_range_v1', JSON.stringify({ v: 1, cells: { AA: 'call', XX: 'call', KK: 'raise' } }));
  assert.deepStrictEqual(R.load().cells, { AA: 'call' }, '読込時は不正セルだけ捨てる');
  stub.removeItem('pd_range_v1');

  // 6) localStorage が無い／例外
  install(undefined);
  assert.strictEqual(R.save(mine), false, 'localStorage が無ければ save は false');
  assert.strictEqual(R.clear(), false);
  PD.rangeData = { bb_vs_btn_25: bundled };
  assert.deepStrictEqual(R.load(), bundled, 'localStorage が無ければ rangeData');
  PD.rangeData = {};
  assert.deepStrictEqual(R.load(), R.empty(), '無ければ empty');
  install({
    getItem: function () { throw new Error('denied'); },
    setItem: function () { throw new Error('quota'); },
    removeItem: function () { throw new Error('denied'); }
  });
  assert.strictEqual(R.save(mine), false, 'setItem が投げたら false');
  assert.strictEqual(R.clear(), false);
  assert.deepStrictEqual(R.load(), R.empty(), 'getItem が投げても例外にしない');
  assert.strictEqual(R.save({ v: 9 }), false, '形が不正な Range は保存しない');
  install(makeStub());

  // ---------------------------------------------------------------- importState の検証
  var stub2 = makeStub();
  install(stub2);
  var okImp = R.importState({ v: 1, cells: { AA: 'call', AKs: 'mix', 'T9s': '3bet', KK: 'fold' }, updatedAt: '2026-10-16', source: 'x' });
  assert.strictEqual(okImp.ok, true);
  assert.deepStrictEqual(okImp.range, { v: 1, cells: { AA: 'call', AKs: 'mix', T9s: '3bet' }, updatedAt: '2026-10-16', source: 'x' }, 'fold は既定値なので落とす');
  assert.strictEqual(okImp.saved, true);
  assert.deepStrictEqual(R.load(), okImp.range, '取り込みは保存される');
  // 往復
  var exp = R.exportState();
  var back = R.importState(JSON.parse(JSON.stringify(exp)));
  assert.strictEqual(back.ok, true);
  assert.deepStrictEqual(back.range, exp, 'export → import で同じ内容');
  // 不正
  var before = stub2._data.pd_range_v1;
  [null, undefined, 'x', 5, [], { v: 2, cells: {} }, { cells: {} }, { v: 1 }, { v: 1, cells: [] }, { v: 1, cells: 'x' },
    { v: 1, cells: { XX: 'call' } }, { v: 1, cells: { aa: 'call' } }, { v: 1, cells: { AA: 'raise' } }, { v: 1, cells: { AA: 1 } }
  ].forEach(function (bad) {
    var res = R.importState(bad);
    assert.strictEqual(res.ok, false, '不正な入力は ok:false: ' + JSON.stringify(bad));
    assert.strictEqual(typeof res.msg, 'string');
    assert.ok(res.msg.length > 0);
    assert.ok(!('range' in res));
  });
  assert.strictEqual(stub2._data.pd_range_v1, before, '失敗した取り込みは保存を変えない');
  // 緩い項目：updatedAt／source が欠けても受ける
  var loose = R.importState({ v: 1, cells: { AA: 'call' } });
  assert.deepStrictEqual(loose.range, { v: 1, cells: { AA: 'call' }, updatedAt: null, source: '' });
  install(makeStub());

  // ---------------------------------------------------------------- 静的チェック（ソース／データファイル）
  var src = fs.readFileSync(RANGE_PATH, 'utf8');
  var dataSrc = fs.readFileSync(DATA_PATH, 'utf8');
  var rootLine = "typeof window !== 'undefined' ? window : globalThis";
  var srcBody = src.split(rootLine).join('');
  assert.ok(!/\bdocument\b/.test(srcBody), 'document を直接触らない');
  assert.ok(!/\bwindow\b/.test(srcBody), 'window を直接触らない（root 経由）');
  assert.ok(!/=>|\blet\b|\bconst\b|`/.test(srcBody.replace(/\/\/.*$/gm, '')), 'ES5（アロー・let・const・テンプレートなし）');
  assert.ok(src.indexOf('ヒューリスティック') >= 0, '序列 score が仮のものだと明記');
  assert.ok(/root\.localStorage/.test(src), 'localStorage は root 経由');
  assert.ok(!/new Date|Date\.now/.test(src), 'Date を使わない');
  var banned = new RegExp(['乾' + 'い', '濡' + 'れ', '高' + 'カード', '接' + '続'].join('|'));
  assert.ok(!banned.test(src) && !banned.test(dataSrc), '用語はカタカナ正典（禁止語を含まない）');
  assert.ok(!/https?:\/\//i.test(src) && !/https?:\/\//i.test(dataSrc), '生の URL を埋め込まない');
  assert.ok(src.indexOf('note.com') < 0);
  assert.ok(/PD\.rangeData\s*=/.test(dataSrc), 'range-data.js は PD.rangeData を定義');
  assert.strictEqual(require(DATA_PATH), origData, 'range-data.js の module.exports は PD.rangeData');
  assert.strictEqual(R, PD.range, 'module.exports は PD.range');
}
