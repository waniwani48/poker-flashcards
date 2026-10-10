// PD.gen（T2）のテスト。SPEC ⑬ T2 の受入項目（機械的）を1項目ずつ検証する。
//   node test/run.js generator
'use strict';

var path = require('path');

// 受入: generator.js 単体の require で cards/wizard を自力解決する（先に他モジュールを読まない）
var G = require(path.join(__dirname, '..', 'js', 'generator.js'));
var g = typeof window !== 'undefined' ? window : globalThis;

var cards = require(path.join(__dirname, '..', 'js', 'cards.js'));
var wizard = require(path.join(__dirname, '..', 'js', 'wizard.js'));
var util = require(path.join(__dirname, '..', 'js', 'util.js'));

var CLS = ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono'];

function overlaps(hero, board) {
  var h = cards.parseHand(hero).cards;
  var b = cards.parseBoard(board).cards;
  for (var i = 0; i < h.length; i++) {
    for (var j = 0; j < b.length; j++) if (h[i].r === b[j].r && h[i].s === b[j].s) return true;
  }
  return false;
}

function stateWithDue(family, due) {
  var rec = {};
  rec['range_state|' + family] = { count: 2, lastAt: '2026-10-01T00:00:00.000Z', cleanStreak: 0, due: due };
  return { version: 1, stage: 1, settings: { sizes: [33, 50], extraFields: [], pendingExtra: [], speedUnlockedAt: null },
    recurrence: rec, familyStats: {}, counters: { committed: 0, live: 0, speed: 0, liveToday: { date: '2026-10-09', n: 0 } } };
}

function stateStable(family) {
  var fs = {};
  fs[family] = { attempts: 5, recent: [
    { score: 7, hint: false, gap: 'none' }, { score: 8, hint: false, gap: 'none' }, { score: 9, hint: false, gap: 'none' },
    { score: 7, hint: false, gap: 'none' }, { score: 10, hint: false, gap: 'none' }
  ] };
  return { version: 1, stage: 1, settings: { sizes: [33, 50], extraFields: [], pendingExtra: [], speedUnlockedAt: null },
    recurrence: {}, familyStats: fs, counters: { committed: 20, live: 0, speed: 0, liveToday: { date: '2026-10-09', n: 0 } } };
}

module.exports = {
  name: 'generator (PD.gen)',
  run: function (assert) {
    // ---------------------------------------------------------------- 名前空間・契約の形
    assert.ok(G && typeof G === 'object', 'module.exports が PD.gen でない');
    assert.strictEqual(g.PD.gen, G, 'module.exports と PD.gen が同じ');
    assert.ok(g.PD.cards, 'generator 単体の require で PD.cards が attach される');
    assert.ok(g.PD.wizard || true, 'wizard は遅延解決（呼出時）');
    ['generateSpot', 'spotFromManual', 'parseShorthand', 'familyOf', 'nextSpot'].forEach(function (k) {
      assert.strictEqual(typeof G[k], 'function', k + ' が function でない');
    });
    assert.deepStrictEqual(G.CLASS_WEIGHTS, { dry_high: 3, bw_sd: 3, mid: 2, low: 2, paired: 1, mono: 1 });
    assert.deepStrictEqual(Object.keys(G.HERO_POOLS).sort(), ['A_lowkick_o', 'A_lowkick_s', 'K_mid_s', 'Q_T_sc', 'low_pocket', 'mid_sc_o']);
    assert.strictEqual(G.HERO_POOLS.A_lowkick_s.w, 25);
    assert.strictEqual(G.HERO_POOLS.A_lowkick_o.w, 15);
    assert.strictEqual(G.HERO_POOLS.K_mid_s.w, 10);
    assert.strictEqual(G.HERO_POOLS.Q_T_sc.w, 20);
    assert.strictEqual(G.HERO_POOLS.low_pocket.w, 15);
    assert.strictEqual(G.HERO_POOLS.mid_sc_o.w, 15);
    assert.deepStrictEqual(G.FALLBACK_BOARDS, ['Ks7d5c', 'QsJd9c', 'Ts9h6c', '8h7d4c', 'Ah9h6c']);
    assert.strictEqual(G.FAMILIES.length, 12, 'FAMILIES は 12 件');
    var famIds = G.FAMILIES.map(function (f) { return f.id; });
    CLS.forEach(function (c) {
      assert.ok(famIds.indexOf(c + '_33') >= 0 && famIds.indexOf(c + '_50') >= 0, 'FAMILIES に ' + c + ' の 33/50 が無い');
    });
    G.FAMILIES.forEach(function (f) {
      assert.strictEqual(typeof f.label, 'string');
      assert.ok(f.label.length > 0, 'label が空: ' + f.id);
    });
    // 固定盤は全て trips でなく、クラスが既知
    G.FALLBACK_BOARDS.forEach(function (b) {
      var c = cards.classifyBoard(b).cls;
      assert.ok(CLS.indexOf(c) >= 0, '固定盤のクラスが不正: ' + b + ' → ' + c);
    });

    // ---------------------------------------------------------------- 受入: 固定 seed で同じ Spot
    var s1 = G.generateSpot({ seed: 123456 });
    var s2 = G.generateSpot({ seed: 123456 });
    assert.deepStrictEqual(s1, s2, '同じ seed で同じ Spot にならない');
    assert.strictEqual(s1.seed, 123456);
    assert.ok(/^s_[0-9a-z]+$/.test(s1.id), 'id の形式: ' + s1.id);
    var s3 = G.generateSpot({ seed: 123457 });
    assert.ok(s3.board !== s1.board || s3.hero !== s1.hero || s3.size !== s1.size, '別 seed で同じ Spot（偶然の一致なら seed を変える）');
    // family 指定でも seed 決定論
    assert.deepStrictEqual(G.generateSpot({ seed: 77, family: 'low_50' }), G.generateSpot({ seed: 77, family: 'low_50' }));
    // Spot の形（SPEC ④）
    ['id', 'seed', 'node', 'villainPos', 'pre', 'board', 'cls', 'suit', 'connected', 'hmsd', 'size', 'pot', 'bet', 'hero', 'heroPool', 'family'].forEach(function (k) {
      assert.ok(Object.prototype.hasOwnProperty.call(s1, k), 'Spot に ' + k + ' が無い');
    });
    assert.strictEqual(s1.node, 'BTN2.5-BBcall-x-cb');
    assert.strictEqual(s1.pre, 'F-F-F-R2.5-F-C');
    assert.strictEqual(s1.pot, 5.5);
    assert.strictEqual(typeof s1.connected, 'boolean');
    assert.strictEqual(typeof s1.hmsd, 'boolean');

    // ---------------------------------------------------------------- 受入: generateSpot({family:'bw_sd_33'}) 100回
    for (var i = 0; i < 100; i++) {
      var sp = G.generateSpot({ family: 'bw_sd_33', seed: 1000 + i });
      assert.strictEqual(sp.cls, 'bw_sd', 'family 固定で cls が違う: ' + sp.board + ' → ' + sp.cls);
      assert.strictEqual(sp.size, 33, 'family 固定で size が違う');
      assert.strictEqual(sp.family, 'bw_sd_33');
      assert.strictEqual(sp.hmsd, true, 'bw_sd なのに hmsd false: ' + sp.board);
    }
    // 各クラスの family 固定（size 50・'x'）
    CLS.forEach(function (c, idx) {
      var sp50 = G.generateSpot({ family: c + '_50', seed: 5000 + idx });
      assert.strictEqual(sp50.cls, c, c + '_50 の cls');
      assert.strictEqual(sp50.size, 50);
      var spx = G.generateSpot({ family: c + '_x', seed: 6000 + idx });
      assert.strictEqual(spx.cls, c, c + '_x の cls');
      assert.ok(spx.size === 33 || spx.size === 50, c + '_x の size は sizes から');
    });

    // ---------------------------------------------------------------- 受入: 1000回の統計
    var N = 1000;
    var master = util.rng(20261009);
    var clsCount = {};
    var poolCount = {};
    var suitMono = 0;
    var clsMono = 0;
    for (i = 0; i < N; i++) {
      var seed = Math.floor(master() * 4294967296) >>> 0;
      var s = G.generateSpot({ seed: seed });
      var where = ' [seed ' + seed + ' ' + s.board + ' ' + s.hero + ']';
      // Hero がボードと重複0
      assert.ok(!overlaps(s.hero, s.board), 'Hero がボードと重複' + where);
      // pair 常に false（セット含む）
      var hf = cards.handFeatures(s.hero, s.board);
      assert.strictEqual(hf.pair, false, 'Hero がボードとペア' + where);
      // trips 0
      assert.notStrictEqual(s.cls, 'trips', 'trips が出た' + where);
      assert.ok(CLS.indexOf(s.cls) >= 0, '不明な cls ' + s.cls + where);
      // suit==='mono' ⇔ cls==='mono'
      assert.strictEqual(s.suit === 'mono', s.cls === 'mono', 'suit/cls の mono が一致しない' + where);
      if (s.suit === 'mono') suitMono++;
      if (s.cls === 'mono') clsMono++;
      assert.ok(s.suit === 'rainbow' || s.suit === 'twotone' || s.suit === 'mono', 'suit 不正' + where);
      // villainPos
      assert.strictEqual(s.villainPos, 'BTN', 'villainPos' + where);
      // bet === wizard.betBB(5.5, size)
      assert.strictEqual(s.bet, wizard.betBB(5.5, s.size), 'bet が betBB と違う' + where);
      assert.ok(s.size === 33 || s.size === 50, 'size が既定 sizes 外' + where);
      // 自己整合：cls/suit/hmsd/connected は classifyBoard と一致、family は familyOf
      var cb = cards.classifyBoard(s.board);
      assert.strictEqual(s.cls, cb.cls, 'cls が classifyBoard と違う' + where);
      assert.strictEqual(s.suit, cb.suit, 'suit が classifyBoard と違う' + where);
      assert.strictEqual(s.hmsd, cb.hmsd, 'hmsd' + where);
      assert.strictEqual(s.connected, cb.connected, 'connected' + where);
      assert.strictEqual(s.family, G.familyOf(s), 'family' + where);
      assert.strictEqual(s.family, s.cls + '_' + s.size);
      // Hero はプールの手、プール規則どおり
      var pool = G.HERO_POOLS[s.heroPool];
      assert.ok(pool, '不明な heroPool ' + s.heroPool + where);
      var hn = cards.handName(cards.parseHand(s.hero).cards);
      assert.ok(pool.hands.indexOf(hn) >= 0, 'プール外の Hero ' + hn + ' (' + s.heroPool + ')' + where);
      if ((s.heroPool === 'A_lowkick_s' || s.heroPool === 'Q_T_sc') && s.cls !== 'mono') {
        assert.strictEqual(hf.bdfd, true, s.heroPool + ' なのに BDFD 無し' + where);
      }
      assert.strictEqual(hf.fd, false, 'FD 付きの Hero（境界外）' + where);
      // 弱すぎる組の除外（ポケットは対象外）
      if (!hf.pocket) {
        assert.ok(hf.hiCard || hf.bdfd || hf.oesd || hf.gut || hf.bdsd, 'ハイカード無し・ドロー無し・BD 無しの Hero' + where);
      }
      clsCount[s.cls] = (clsCount[s.cls] || 0) + 1;
      poolCount[s.heroPool] = (poolCount[s.heroPool] || 0) + 1;
    }
    // low_pocket が 50 回以上
    assert.ok((poolCount.low_pocket || 0) >= 50, 'low_pocket が 50 回未満: ' + poolCount.low_pocket);
    // 全プールが出ている
    Object.keys(G.HERO_POOLS).forEach(function (p) {
      assert.ok((poolCount[p] || 0) > 0, 'プール ' + p + ' が一度も出ない');
    });
    assert.strictEqual(suitMono, clsMono);
    assert.ok(clsMono > 0, 'mono が一度も出ない');

    // クラス分布が重みの ±10%（百分率ポイント）。さらに ±5pt を内部の偏り検知として課す
    var totalW = 0;
    CLS.forEach(function (c) { totalW += G.CLASS_WEIGHTS[c]; });
    var dist = [];
    CLS.forEach(function (c) {
      var exp = G.CLASS_WEIGHTS[c] / totalW * 100;
      var obs = (clsCount[c] || 0) / N * 100;
      dist.push(c + ' ' + obs.toFixed(1) + '% (期待 ' + exp.toFixed(1) + '%)');
      assert.ok(Math.abs(obs - exp) <= 10, 'クラス分布が重みの ±10% を超える: ' + c + ' ' + obs.toFixed(1) + '% vs ' + exp.toFixed(1) + '%');
      assert.ok(Math.abs(obs - exp) <= 5, 'クラス分布の偏り（±5pt）: ' + c + ' ' + obs.toFixed(1) + '% vs ' + exp.toFixed(1) + '%');
    });
    module.exports.lastDist = dist;

    // sizes オプション
    var sz = G.generateSpot({ seed: 9, sizes: [66] });
    assert.strictEqual(sz.size, 66);
    assert.strictEqual(sz.bet, wizard.betBB(5.5, 66));
    assert.strictEqual(sz.family, sz.cls + '_x', 'size 66 は family _x');

    // ---------------------------------------------------------------- 受入: parseShorthand
    var p1 = G.parseShorthand('K75r 33 A4s');
    assert.strictEqual(p1.ok, true, 'K75r 33 A4s: ' + p1.err);
    assert.strictEqual(p1.size, 33);
    assert.strictEqual(p1.needSuitQuestion, true, 'スーテッド Hero・抽象ボードは質問が要る');
    assert.strictEqual(p1.hero, 'A4s');
    assert.ok(p1.heroOptions && p1.heroOptions.same && p1.heroOptions.other, 'heroOptions.same/other');
    assert.strictEqual(cards.classifyBoard(p1.board).cls, 'dry_high');
    assert.strictEqual(cards.classifyBoard(p1.board).suit, 'rainbow');
    assert.strictEqual(cards.handFeatures(p1.heroOptions.same, p1.board).bdfd, true, 'same は BDFD');
    assert.strictEqual(cards.handFeatures(p1.heroOptions.other, p1.board).bdfd, false, 'other は BDFD 無し');
    assert.strictEqual(cards.parseHand(p1.heroOptions.other).suited, true, 'other もスーテッド');

    var p2 = G.parseShorthand('Ks7d5c b50 Ad4d');
    assert.strictEqual(p2.ok, true, 'Ks7d5c b50 Ad4d: ' + p2.err);
    assert.strictEqual(p2.board, 'Ks7d5c');
    assert.strictEqual(p2.size, 50);
    assert.strictEqual(p2.hero, 'Ad4d');
    assert.strictEqual(p2.needSuitQuestion, false, '両方具体なら質問しない');

    var p3 = G.parseShorthand('K75tt 33 A4dd');
    assert.strictEqual(p3.ok, true, 'K75tt 33 A4dd: ' + p3.err);
    assert.strictEqual(cards.classifyBoard(p3.board).suit, 'twotone');
    assert.strictEqual(p3.needSuitQuestion, true, '抽象ボード＋スーテッドは質問');
    assert.strictEqual(cards.handFeatures(p3.heroOptions.same, p3.board).bdfd, true);
    assert.strictEqual(cards.handFeatures(p3.heroOptions.other, p3.board).bdfd, false);
    assert.strictEqual(cards.handFeatures(p3.heroOptions.other, p3.board).fd, false);

    var p4 = G.parseShorthand('K75r 33 A4o');
    assert.strictEqual(p4.ok, true);
    assert.strictEqual(p4.needSuitQuestion, false, 'オフスートは質問しない');
    assert.strictEqual(cards.parseHand(p4.hero).suited, false);
    assert.ok(!overlaps(p4.hero, p4.board));

    var p5 = G.parseShorthand('K75m 50 44');
    assert.strictEqual(p5.ok, true, 'K75m 50 44: ' + p5.err);
    assert.strictEqual(cards.classifyBoard(p5.board).cls, 'mono');
    assert.strictEqual(p5.needSuitQuestion, false);
    assert.strictEqual(cards.handFeatures(p5.hero, p5.board).pocket, true);

    var p6 = G.parseShorthand('K75m 33 A4s');
    assert.strictEqual(p6.ok, true);
    assert.strictEqual(p6.needSuitQuestion, false, 'モノトーン盤ではスートを揃えられないので質問しない');
    assert.strictEqual(cards.handFeatures(p6.hero, p6.board).bdfd, false);
    assert.strictEqual(cards.handFeatures(p6.hero, p6.board).fd, false);

    var p7 = G.parseShorthand('Ks7d5c 33 A4s');
    assert.strictEqual(p7.ok, true);
    assert.strictEqual(p7.needSuitQuestion, true, '具体ボード＋ハンド名スーテッドは質問');
    assert.strictEqual(cards.handFeatures(p7.heroOptions.same, 'Ks7d5c').bdfd, true);
    assert.strictEqual(p7.heroOptions.other, 'Ah4h', 'other は盤に無いスート');

    assert.strictEqual(G.parseShorthand('Ks7d 33 A4s').ok, false, '2枚のボードは不可');
    assert.strictEqual(G.parseShorthand('K75 33 A4s').ok, false, 'テクスチャ無しは不可');
    assert.strictEqual(G.parseShorthand('K75r 33').ok, false, '2語は不可');
    assert.strictEqual(G.parseShorthand('K75r 33 A4').ok, false, '異ランクに s/o 無しは不可');
    assert.strictEqual(G.parseShorthand('K75r 33 44s').ok, false, '同ランクに s は不可');
    assert.strictEqual(G.parseShorthand('K75r xx A4s').ok, false, 'サイズ不正');
    assert.strictEqual(G.parseShorthand('Ks7d5c 33 Ks4s').ok, false, 'Hero がボードと重複');
    assert.strictEqual(G.parseShorthand('').ok, false);
    assert.strictEqual(G.parseShorthand(null).ok, false);
    assert.strictEqual(G.parseShorthand('K77m 33 A4s').ok, false, 'ペア盤をモノトーンにはできない');
    assert.strictEqual(G.parseShorthand('KK7tt 33 A4s').ok, true, 'ペア盤のツートーン');
    assert.strictEqual(typeof G.parseShorthand('K75 33 A4s').err, 'string');

    // ---------------------------------------------------------------- 受入: spotFromManual
    var m1 = G.spotFromManual({ board: 'Ks7d', hero: 'Ad4d', size: 33 });
    assert.strictEqual(m1.ok, false, 'Ks7d は ok:false');
    assert.strictEqual(typeof m1.err, 'string');
    var m2 = G.spotFromManual({ board: 'Ks7d5c', hero: 'Ad4d', size: 33 });
    assert.strictEqual(m2.ok, true, m2.err);
    assert.strictEqual(m2.spot.villainPos, 'BTN');
    assert.strictEqual(m2.spot.board, 'Ks7d5c');
    assert.strictEqual(m2.spot.hero, 'Ad4d');
    assert.strictEqual(m2.spot.cls, 'dry_high');
    assert.strictEqual(m2.spot.size, 33);
    assert.strictEqual(m2.spot.bet, 1.82);
    assert.strictEqual(m2.spot.pot, 5.5);
    assert.strictEqual(m2.spot.family, 'dry_high_33');
    assert.strictEqual(m2.spot.heroPool, 'manual');
    assert.strictEqual(m2.spot.seed, null);
    assert.ok(/^s_/.test(m2.spot.id));
    var m3 = G.spotFromManual({ board: 'Ks7d5c', hero: '4dAd', size: 66 });
    assert.strictEqual(m3.ok, true);
    assert.strictEqual(m3.spot.hero, 'Ad4d', 'Hero は降順に正規化');
    assert.strictEqual(m3.spot.family, 'dry_high_x', 'その他サイズは _x');
    assert.strictEqual(m3.spot.bet, wizard.betBB(5.5, 66));
    assert.strictEqual(G.spotFromManual({ board: 'Ks7d5c', hero: 'Ks4s', size: 33 }).ok, false, 'Hero 重複は不可');
    assert.strictEqual(G.spotFromManual({ board: 'Ks7d5c', hero: 'A4s', size: 33 }).ok, false, 'Hero はカード指定が必要');
    assert.strictEqual(G.spotFromManual({ board: 'Ks7d5c', hero: 'Ad4d', size: 0 }).ok, false, 'size 0 は不可');
    assert.strictEqual(G.spotFromManual({ board: 'Ks7d5c', hero: 'Ad4d', size: 'x' }).ok, false, 'size 非数は不可');
    assert.strictEqual(G.spotFromManual({ board: 'KsKdKc', hero: 'Ad4d', size: 33 }).ok, false, 'trips は不可');
    assert.strictEqual(G.spotFromManual({ board: 'Ks7d5c', hero: 'Kd5s', size: 33 }).ok, true, '実戦の手はペアでも受け付ける');
    assert.strictEqual(G.spotFromManual(null).ok, false);
    // 順序の正規化
    assert.strictEqual(G.spotFromManual({ board: '5cKs7d', hero: 'Ad4d', size: 33 }).spot.board, 'Ks7d5c');

    // ---------------------------------------------------------------- familyOf
    assert.strictEqual(G.familyOf({ cls: 'dry_high', size: 33 }), 'dry_high_33');
    assert.strictEqual(G.familyOf({ cls: 'mono', size: 50 }), 'mono_50');
    assert.strictEqual(G.familyOf({ cls: 'low', size: 66 }), 'low_x');
    assert.strictEqual(G.familyOf({ cls: 'low', size: 33.5 }), 'low_x');

    // ---------------------------------------------------------------- 受入: nextSpot
    var today = '2026-10-09';
    // due 族あり → 'srs' かつその族
    var stDue = stateWithDue('mid_50', '2026-10-09');
    var n1 = G.nextSpot(stDue, [], { tempo: 'slow', seed: 1, today: today });
    assert.strictEqual(n1.reason, 'srs', 'due 族ありで srs でない');
    assert.strictEqual(n1.spot.family, 'mid_50', 'srs の族が due 族でない: ' + n1.spot.family);
    assert.strictEqual(n1.spot.villainPos, 'BTN');
    // due が未来なら random
    var n2 = G.nextSpot(stateWithDue('mid_50', '2026-10-10'), [], { tempo: 'slow', seed: 1, today: today });
    assert.strictEqual(n2.reason, 'random', 'due が未来なら random');
    // 無ければ random
    var n3 = G.nextSpot({}, [], { tempo: 'slow', seed: 2 });
    assert.strictEqual(n3.reason, 'random');
    assert.ok(n3.spot && n3.spot.board, 'spot が返る');
    assert.ok(n3.spot.size === 33 || n3.spot.size === 50);
    // 決定論
    assert.deepStrictEqual(G.nextSpot({}, [], { tempo: 'slow', seed: 2 }), n3, 'nextSpot が seed で決定論でない');
    // 直近3問と同クラスを避ける（random）
    var log3 = [{ spot: { cls: 'dry_high' } }, { spot: { cls: 'dry_high' } }, { spot: { cls: 'bw_sd' } }];
    for (i = 0; i < 40; i++) {
      var nr = G.nextSpot({}, log3, { tempo: 'slow', seed: 100 + i });
      assert.strictEqual(nr.reason, 'random');
      assert.ok(nr.spot.cls !== 'dry_high' && nr.spot.cls !== 'bw_sd', '直近3問のクラスを避けていない: ' + nr.spot.cls);
    }
    // 直近3問は末尾3件（それより前は数えない）
    var log4 = [{ spot: { cls: 'mono' } }, { spot: { cls: 'low' } }, { spot: { cls: 'paired' } }, { spot: { cls: 'mid' } }];
    var seenMono = false;
    for (i = 0; i < 60; i++) {
      var nr4 = G.nextSpot({}, log4, { tempo: 'slow', seed: 200 + i });
      assert.ok(['low', 'paired', 'mid'].indexOf(nr4.spot.cls) < 0, '末尾3件のクラスを避けていない: ' + nr4.spot.cls);
      if (nr4.spot.cls === 'mono') seenMono = true;
    }
    assert.ok(seenMono, '4件前のクラス（mono）は避けない');
    // state.settings.sizes を使う
    var stSz = { settings: { sizes: [50] } };
    for (i = 0; i < 10; i++) assert.strictEqual(G.nextSpot(stSz, [], { tempo: 'slow', seed: 300 + i }).spot.size, 50, 'settings.sizes が効いていない');
    // tempo 'speed' は安定族から 'stable'
    var stStable = stateStable('low_33');
    var n5 = G.nextSpot(stStable, [], { tempo: 'speed', seed: 3, today: today });
    assert.strictEqual(n5.reason, 'stable', 'speed は stable: ' + n5.reason);
    assert.strictEqual(n5.spot.family, 'low_33');
    // speed は due より安定族を優先
    var stBoth = stateStable('low_33');
    stBoth.recurrence = stateWithDue('mid_50', today).recurrence;
    assert.strictEqual(G.nextSpot(stBoth, [], { tempo: 'speed', seed: 4, today: today }).reason, 'stable');
    assert.strictEqual(G.nextSpot(stBoth, [], { tempo: 'slow', seed: 4, today: today }).reason, 'srs');
    // speed で安定族が無ければ random に落ちる
    assert.strictEqual(G.nextSpot({}, [], { tempo: 'speed', seed: 5 }).reason, 'random');
    // seed 再演：spot.seed と family から同じ Spot
    var re = G.generateSpot({ seed: n1.spot.seed, family: n1.spot.family });
    assert.strictEqual(re.board, n1.spot.board, 'seed 再演でボードが違う');
    assert.strictEqual(re.hero, n1.spot.hero, 'seed 再演で Hero が違う');
  }
};
