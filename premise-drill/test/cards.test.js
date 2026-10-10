// PD.cards（T1）のテスト。SPEC ⑬ T1 の受入項目（機械的）＋境界ケース。
//   node test/run.js cards
'use strict';

var path = require('path');
var cards = require(path.join(__dirname, '..', 'js', 'cards.js'));

// テスト専用の小さな乱数（util.js に依存しないため同じ mulberry32 を内蔵）
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  name: 'cards (PD.cards)',
  run: function (assert) {
    var C = cards;
    var cb = C.classifyBoard;
    var hf = C.handFeatures;
    var dr = C.drawRanks;

    // ---------------------------------------------------------------- 定数・名前空間
    assert.strictEqual(C.RANKS, 'AKQJT98765432');
    assert.strictEqual(C.SUITS, 'shdc');
    var g = typeof window !== 'undefined' ? window : globalThis;
    assert.strictEqual(g.PD.cards, C, 'module.exports と PD.cards が同じ');

    // ---------------------------------------------------------------- parseBoard / parseHand / fmt / handName
    var pb = C.parseBoard('Ks7d5c');
    assert.strictEqual(pb.ok, true);
    assert.deepStrictEqual(pb.cards, [{ r: 13, s: 's' }, { r: 7, s: 'd' }, { r: 5, s: 'c' }]);
    assert.strictEqual(C.parseBoard('ks 7D 5c').ok, true, '大文字小文字・空白を許容');
    assert.strictEqual(C.fmt(C.parseBoard('ks 7D 5c').cards), 'Ks7d5c');
    assert.strictEqual(C.fmt(C.parseBoard('Ks10d5c').cards), 'KsTd5c', "'10' は T に正規化");
    assert.strictEqual(C.parseBoard('Ks7d').ok, false, '2枚は ng');
    assert.strictEqual(C.parseBoard('Ks7d5c2h').ok, false, '4枚は ng');
    assert.strictEqual(C.parseBoard('Ks7dKs').ok, false, '重複は ng');
    assert.strictEqual(C.parseBoard('Ks7d5x').ok, false, '不正スートは ng');
    assert.strictEqual(C.parseBoard('Zs7d5c').ok, false, '不正ランクは ng');
    assert.strictEqual(C.parseBoard('').ok, false);
    assert.strictEqual(C.parseBoard(null).ok, false);
    assert.ok(typeof C.parseBoard('Ks7d').err === 'string' && C.parseBoard('Ks7d').err.length > 0, 'err 文字列あり');

    var ph = C.parseHand('Ad4d');
    assert.strictEqual(ph.ok, true);
    assert.strictEqual(ph.suited, true);
    assert.deepStrictEqual(ph.cards, [{ r: 14, s: 'd' }, { r: 4, s: 'd' }]);
    assert.strictEqual(C.parseHand('Ac4d').suited, false);
    assert.strictEqual(C.parseHand('AdAd').ok, false, '重複は ng');
    assert.strictEqual(C.parseHand('Ad').ok, false, '1枚は ng');
    assert.strictEqual(C.parseHand('A4s').ok, false, '略記は parseHand では ng');

    assert.strictEqual(C.fmt([{ r: 14, s: 'd' }, { r: 4, s: 'd' }]), 'Ad4d');
    assert.strictEqual(C.handName(C.parseHand('Ad4d').cards), 'A4s');
    assert.strictEqual(C.handName(C.parseHand('4dAd').cards), 'A4s', '順序に依らず高い方が先');
    assert.strictEqual(C.handName(C.parseHand('Ac4d').cards), 'A4o');
    assert.strictEqual(C.handName(C.parseHand('KcAd').cards), 'AKo');
    assert.strictEqual(C.handName(C.parseHand('5h5c').cards), '55');
    assert.strictEqual(C.handName(C.parseHand('Th9h').cards), 'T9s');

    // ---------------------------------------------------------------- classifyBoard（受入）
    var r1 = cb('Ks7d5c');
    assert.strictEqual(r1.cls, 'dry_high', 'Ks7d5c → dry_high');
    assert.strictEqual(r1.suit, 'rainbow', 'Ks7d5c → rainbow');
    assert.strictEqual(r1.hmsd, false, 'Ks7d5c → hmsd:false');
    assert.strictEqual(r1.connected, false, 'Ks7d5c → connected:false');
    assert.deepStrictEqual([r1.H, r1.M, r1.L], [13, 7, 5]);

    var r2 = cb('QsJd9c');
    assert.strictEqual(r2.cls, 'bw_sd', 'QsJd9c → bw_sd');
    assert.strictEqual(r2.hmsd, true, 'QsJd9c → hmsd:true');
    assert.strictEqual(r2.connected, true, 'QsJd9c → KT/T8 でストレート');
    assert.strictEqual(r2.suit, 'rainbow');

    var r3 = cb('Ts9h6c');
    assert.strictEqual(r3.cls, 'mid', 'Ts9h6c → mid');
    assert.strictEqual(r3.connected, true, 'Ts9h6c → 87 でストレート');

    var r4 = cb('8h7d4c');
    assert.strictEqual(r4.cls, 'low', '8h7d4c → low');
    assert.strictEqual(r4.connected, true, '8h7d4c → connected:true');

    var r5 = cb('Ks9s4s');
    assert.strictEqual(r5.cls, 'mono', 'Ks9s4s → mono');
    assert.strictEqual(r5.suit, 'mono');
    assert.strictEqual(r5.connected, false);

    var r6 = cb('8s8h3c');
    assert.strictEqual(r6.cls, 'paired', '8s8h3c → paired');
    assert.strictEqual(r6.suit, 'rainbow');
    assert.strictEqual(r6.hmsd, false, 'H===M なら hmsd false');
    assert.strictEqual(r6.connected, false, 'ペアボードは5ランク揃わない');
    assert.deepStrictEqual([r6.H, r6.M, r6.L], [8, 8, 3]);

    // ---------------------------------------------------------------- classifyBoard（境界）
    assert.strictEqual(cb('8s8h8d').cls, 'trips', '3枚同ランク → trips');
    assert.strictEqual(cb('8s8h3s').suit, 'twotone', 'ペア＋2枚同スート → twotone');
    assert.strictEqual(cb('8s8h3s').cls, 'paired', 'paired は twotone でも paired');
    assert.strictEqual(cb('QsJs9c').suit, 'twotone');
    assert.strictEqual(cb('QsJs9c').cls, 'bw_sd', 'twotone でも cls は H/M で決まる');
    assert.strictEqual(cb('QsJs9s').cls, 'mono', 'mono は H≥J より優先');
    assert.strictEqual(cb('5c7dKs').H, 13, '入力順に依らず H は最大ランク');
    assert.strictEqual(cb('5c7dKs').cls, 'dry_high');
    assert.strictEqual(cb('KsQd2c').cls, 'bw_sd', 'KQx は JT でオープンエンド');
    assert.strictEqual(cb('Ks9d5c').cls, 'bw_sd', 'K9x は JT でガット（ガットもストレートドロー）');
    assert.strictEqual(cb('Ks8d5c').cls, 'dry_high', 'K8x は H と M を含むストレートが無い');
    assert.strictEqual(cb('Js7d2c').cls, 'bw_sd', 'J7x は T98 系のガット');
    assert.strictEqual(cb('Js6d2c').cls, 'dry_high', 'J6x は幅が広すぎる');
    assert.strictEqual(cb('Jd6d2c').cls, 'dry_high', 'H=J は H≥J 側');
    assert.strictEqual(cb('Td6d2c').cls, 'mid', 'H=T は mid');
    assert.strictEqual(cb('9d6d2c').cls, 'mid', 'H=9 は mid');
    assert.strictEqual(cb('8d6d2c').cls, 'low', 'H=8 は low');
    assert.strictEqual(cb('2c3d4s').cls, 'low');
    // ホイール
    assert.strictEqual(cb('As4d2c').hmsd, true, 'A42：H=A,M=4 は 53/32 で A-5 ホイールのドロー');
    assert.strictEqual(cb('As4d2c').cls, 'bw_sd');
    assert.strictEqual(cb('As5d3c').hmsd, true, 'A53：H=A,M=5 は 42 でホイールのドロー');
    assert.strictEqual(cb('As4d9c').hmsd, false, 'A94：M は 9 なので A と 9 を含むストレートは無い');
    assert.strictEqual(cb('As4d9c').cls, 'dry_high');
    assert.strictEqual(cb('As6d2c').hmsd, false, 'A6x はホイールにも乗らない');
    assert.strictEqual(cb('As6d2c').cls, 'dry_high');
    assert.strictEqual(cb('Ah2d3c').connected, true, 'A23 は 54 でホイール完成');
    assert.strictEqual(cb('As5d4c').connected, true, 'A54 は 32 でホイール完成');
    assert.strictEqual(cb('AsKd3c').connected, false);
    assert.strictEqual(cb('AsKdQc').connected, true, 'AKQ は JT で完成');
    assert.strictEqual(cb('AsKdQc').hmsd, true);
    // 文字列でも Card[] でも受ける
    assert.strictEqual(cb(C.parseBoard('Ks7d5c').cards).cls, 'dry_high');
    assert.throws(function () { cb('Ks7d'); }, /PD\.cards/, '不正ボードは throw');

    // ---------------------------------------------------------------- drawRanks（受入）
    var d1 = dr('QsJd9c');
    assert.ok(d1.oesd.indexOf('T') >= 0, "drawRanks('QsJd9c').oesd に 'T'");
    assert.ok(d1.gut.indexOf('K') >= 0, "drawRanks('QsJd9c').gut に 'K'");
    assert.ok(d1.gut.indexOf('8') >= 0, "drawRanks('QsJd9c').gut に '8'");
    assert.deepStrictEqual(d1, { gut: ['K', '8'], oesd: ['T'] }, '過不足なし・A..2 の順');

    // ---------------------------------------------------------------- drawRanks（境界）
    assert.deepStrictEqual(dr('Ks7d5c'), { gut: [], oesd: [] }, 'K75 は1枚足しても4ランクのドローにならない');
    assert.deepStrictEqual(dr('8h7d4c'), { gut: ['6', '5'], oesd: [] });
    assert.deepStrictEqual(dr('2c3d4s'), { gut: ['A', '6'], oesd: ['5'] }, 'A はホイール側のガット、5 は A/6 のオープンエンド');
    assert.deepStrictEqual(dr('Ah2h3c'), { gut: ['5', '4'], oesd: [] });
    assert.deepStrictEqual(dr('8s8h3c'), { gut: [], oesd: [] }, 'ペアボードは空');
    assert.deepStrictEqual(dr('8s8h8d'), { gut: [], oesd: [] }, 'トリップスは空');
    assert.deepStrictEqual(dr('Ts9h6c'), { gut: ['8', '7'], oesd: [] }, 'T96：8 は T986 で 7 待ち、7 は T976 で 8 待ち、どちらもガット');
    assert.deepStrictEqual(dr('Ts9h7c'), { gut: ['J', '6'], oesd: ['8'] }, 'T97：8 で JT98/T987 の2方向、J と 6 はガット');
    assert.deepStrictEqual(dr('3c4d9s'), { gut: [], oesd: [] });

    // ---------------------------------------------------------------- handFeatures（受入）
    assert.strictEqual(hf('Ad4d', 'Ks7d5c').bdfd, true, "hf('Ad4d','Ks7d5c').bdfd");
    assert.strictEqual(hf('Ad4d', 'Kd7d5c').fd, true, "hf('Ad4d','Kd7d5c').fd");
    assert.strictEqual(hf('Ac4d', 'Ks7d5c').bdfd, false, "hf('Ac4d','Ks7d5c').bdfd === false");
    assert.strictEqual(hf('5h5c', 'Ks7d5c').pair, true, "hf('5h5c','Ks7d5c').pair");
    var f44 = hf('4h4c', 'Ks7d5c');
    assert.strictEqual(f44.pocket, true, "hf('4h4c','Ks7d5c').pocket");
    assert.strictEqual(f44.pair, false, "hf('4h4c','Ks7d5c').pair === false");
    assert.strictEqual(hf('Ah2h', '3c4d9s').gut, true, "hf('Ah2h','3c4d9s').gut（ホイール）");

    // ---------------------------------------------------------------- handFeatures（全項目・境界）
    var fa = hf('Ad4d', 'Ks7d5c');
    assert.deepStrictEqual(fa, {
      pair: false, overpair: false, pocket: false,
      fd: false, bdfd: true, oesd: false, gut: false, bdsd: true, hiCard: 'A'
    }, 'A4s on K75：BDFD＋A45 の BDSD、ハイカード A');

    var fb = hf('Ad4d', 'Kd7d5c');
    assert.strictEqual(fb.bdfd, false, 'fd なら bdfd は false');

    var fc = hf('5h5c', 'Ks7d5c');
    assert.strictEqual(fc.pocket, true);
    assert.strictEqual(fc.overpair, false);
    assert.strictEqual(fc.hiCard, null, '5 はハイカードに数えない');
    assert.strictEqual(fc.bdsd, false, 'ポケットは bdsd にならない');

    var fq = hf('QhQc', 'Ts9h6c');
    assert.strictEqual(fq.overpair, true, 'QQ on T96 はオーバーペア');
    assert.strictEqual(fq.pocket, true);
    assert.strictEqual(fq.pair, false);
    assert.strictEqual(fq.hiCard, 'Q');
    assert.strictEqual(hf('9h9c', 'Ts9h6c').overpair, false, '99 on T96 はセットでありオーバーペアでない');
    assert.strictEqual(hf('9h9c', 'Ts9h6c').pair, true);
    assert.strictEqual(hf('TdTc', 'Ts9h6c').overpair, false, 'H と同ランクはオーバーペアでない');

    var ft = hf('Th9h', 'Ts8d7c');
    assert.strictEqual(ft.pair, true);
    assert.strictEqual(ft.oesd, true, 'T9 on T87 は J/6 のオープンエンド');
    assert.strictEqual(ft.gut, false);
    assert.strictEqual(ft.bdsd, false, 'oesd があれば bdsd は false');
    assert.strictEqual(ft.hiCard, 'T');

    var fw = hf('Ah2h', '3c4d9s');
    assert.strictEqual(fw.oesd, false);
    assert.strictEqual(fw.bdsd, false, 'gut があれば bdsd は false');
    assert.strictEqual(fw.bdfd, false, 'ボードにハートが無ければ bdfd false');

    assert.strictEqual(hf('5h4h', '3c2d9s').oesd, true, '5432 は A/6 の2方向');
    assert.strictEqual(hf('Jh9c', 'Ks7d5c').bdsd, true, 'J9 + K は5ランク幅に収まる');
    assert.strictEqual(hf('Jh9c', 'Ks7d5c').hiCard, 'J');
    assert.strictEqual(hf('Jh8c', 'Ks7d5c').bdsd, true, 'J8 + 7 は 7..J');
    assert.strictEqual(hf('Jh6c', 'Ks7d5c').bdsd, false, 'J6 はどのボード札とも5ランク幅に収まらない');
    assert.strictEqual(hf('Ah5c', '7d6s2c').bdsd, true, 'A5 + 2 はホイール側の BDSD');
    assert.strictEqual(hf('Ah5c', 'Ks7d5c').bdsd, false, 'ペアになるボード札は3ランクに数えない');

    var fm = hf('6h5h', '8h7d4c');
    assert.strictEqual(fm.oesd, false, '完成ストレートは oesd ではない');
    assert.strictEqual(fm.gut, false, '完成ストレートは gut ではない');
    assert.strictEqual(fm.bdsd, false, '完成ストレートは bdsd ではない');
    assert.strictEqual(fm.bdfd, true, 'ハート1枚で bdfd');

    var ff = hf('AsKs', 'Ks9s4s');
    assert.strictEqual(ff.fd, false, '完成フラッシュは fd ではない');
    assert.strictEqual(ff.bdfd, false);
    assert.strictEqual(ff.pair, true);
    assert.strictEqual(hf('AsKc', 'Ks9s4s').fd, false, 'オフスートは fd にならない');

    assert.strictEqual(hf('Jh2c', 'Jd2d9s').pair, true, 'ツーペアも pair');
    assert.strictEqual(hf('4d2d', 'Ad3d9s').fd, true, '42s on A39 の fd（ダイヤ2枚）');
    assert.strictEqual(hf('4d2d', 'Ad3d9s').oesd, false);
    assert.strictEqual(hf('4d2d', 'Ad3d9s').gut, true, 'A432 は 5 のガット');

    // 文字列でも Card[] でも受ける
    assert.strictEqual(hf(C.parseHand('Ad4d').cards, C.parseBoard('Ks7d5c').cards).bdfd, true);
    assert.throws(function () { hf('Ad', 'Ks7d5c'); }, /PD\.cards/, '不正ハンドは throw');
    assert.throws(function () { hf('Ad4d', 'Ks7d'); }, /PD\.cards/, '不正ボードは throw');

    // ---------------------------------------------------------------- randomBoard
    var b1 = C.randomBoard(rng(42));
    assert.strictEqual(b1.length, 3);
    assert.strictEqual(C.parseBoard(C.fmt(b1)).ok, true, '3枚とも相異なる有効カード');
    assert.ok(b1[0].r >= b1[1].r && b1[1].r >= b1[2].r, 'ランク降順');
    assert.strictEqual(C.fmt(C.randomBoard(rng(42))), C.fmt(b1), '同じ seed で同じボード');
    assert.notStrictEqual(C.fmt(C.randomBoard(rng(43))), C.fmt(b1), '別 seed では別ボード（この seed 組で確認）');

    var ex = C.parseHand('Ad4d').cards;
    var seen = {};
    for (var i = 0; i < 500; i++) {
      var bd = C.randomBoard(rng(1000 + i), ex);
      assert.strictEqual(C.parseBoard(C.fmt(bd)).ok, true);
      for (var j = 0; j < 3; j++) {
        assert.ok(!(bd[j].r === 14 && bd[j].s === 'd'), 'exclude の Ad が出ない');
        assert.ok(!(bd[j].r === 4 && bd[j].s === 'd'), 'exclude の 4d が出ない');
      }
      seen[C.fmt(bd)] = true;
    }
    assert.ok(Object.keys(seen).length > 400, '500回でほぼ異なるボードが出る');
    assert.strictEqual(C.randomBoard(rng(7), 'Ad4d').length, 3, 'exclude は文字列でも可');
    assert.strictEqual(C.randomBoard(function () { return 0.999999; }).length, 3, 'r が 1 に近くても範囲内');
    assert.strictEqual(C.randomBoard(function () { return 0; }).length, 3);

    // ---------------------------------------------------------------- 整合性：randomBoard → classifyBoard が全クラスを返す
    var clsSeen = {};
    for (var k = 0; k < 3000; k++) {
      var rb = C.randomBoard(rng(50000 + k));
      var c = cb(rb);
      clsSeen[c.cls] = (clsSeen[c.cls] || 0) + 1;
      assert.ok(['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono', 'trips'].indexOf(c.cls) >= 0);
      assert.ok(['rainbow', 'twotone', 'mono'].indexOf(c.suit) >= 0);
      assert.strictEqual(c.suit === 'mono', c.cls === 'mono', 'suit mono ⇔ cls mono');
      assert.ok(c.H >= c.M && c.M >= c.L);
      if (c.cls === 'bw_sd') assert.ok(c.H >= 11 && c.hmsd);
      if (c.cls === 'dry_high') assert.ok(c.H >= 11 && !c.hmsd);
      if (c.cls === 'mid') assert.ok(c.H === 10 || c.H === 9);
      if (c.cls === 'low') assert.ok(c.H <= 8);
    }
    ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono'].forEach(function (k2) {
      assert.ok(clsSeen[k2] > 0, k2 + ' が3000回で1回以上出る');
    });
  }
};
