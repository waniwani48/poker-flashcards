// PD.wizard（T4）のテスト。SPEC ⑬ T4 の受入（機械的）を1項目ずつ検証する。
'use strict';

var path = require('path');
var W = require(path.join(__dirname, '..', 'js', 'wizard.js'));

var CB_EXPECTED = 'https://app.gtowizard.com/solutions?gametype=Cash6m50zGeneral&depth=100&soltab=strategy&preflop_actions=F-F-F-R2.5-F-C&flop_actions=X&history_spot=7&board=Ks7d5c';

function spot33() {
  return { board: 'Ks7d5c', villainPos: 'BTN', size: 33, pot: 5.5, bet: 1.82 };
}
function spot50() {
  return { board: 'Ks7d5c', villainPos: 'BTN', size: 50, pot: 5.5, bet: 2.75 };
}

module.exports = {
  name: 'wizard (PD.wizard)',
  run: function (assert) {
    // 名前空間と契約の形
    assert.ok(W && typeof W === 'object', 'module.exports が PD.wizard でない');
    assert.strictEqual(typeof W.potOf, 'function');
    assert.strictEqual(typeof W.betBB, 'function');
    assert.strictEqual(typeof W.url, 'function');
    assert.strictEqual(typeof W.testUrl, 'function');

    // PRE_BY_POS は BTN のみ
    assert.deepStrictEqual(Object.keys(W.PRE_BY_POS), ['BTN'], 'PRE_BY_POS は BTN のみ');
    assert.strictEqual(W.PRE_BY_POS.BTN.pre, 'F-F-F-R2.5-F-C');
    assert.strictEqual(W.PRE_BY_POS.BTN.open, 2.5);
    assert.strictEqual(W.PRE_BY_POS.BTN.hs, 7);
    assert.strictEqual(W.PRE_BY_POS.BTN.flop, 'X');

    // 受入: cb の URL 完全一致 かつ verified===true
    var cb = W.url(spot33(), 'cb');
    assert.strictEqual(cb.url, CB_EXPECTED, 'cb URL が完全一致しない');
    assert.strictEqual(cb.verified, true, 'cb は verified true');
    assert.strictEqual(typeof cb.note, 'string');
    assert.ok(cb.note.length > 0, 'cb の note（手順文）が空');

    // 実機確認 2026-10-11: bbfacing は flop_actions=X-R1.8&history_spot=8 で BB 応答ノードに着地（verified true）
    var bf = W.url(spot33(), 'bbfacing');
    assert.ok(bf.url.indexOf('flop_actions=X-R1.8&history_spot=8') !== -1, 'bbfacing に X-R1.8&history_spot=8 が無い: ' + bf.url);
    assert.strictEqual(bf.verified, true, 'bbfacing(33) は verified true');
    assert.ok(bf.note.indexOf('実機確認済') !== -1, 'bbfacing の note に「実機確認済」が無い');
    var bfX = W.url({ board: 'Ks7d5c', villainPos: 'BTN', size: 40 }, 'bbfacing');
    assert.strictEqual(bfX.verified, false, '既定ノードに無いサイズ(40)は verified false');
    assert.ok(bfX.url.indexOf('X-R2.2&') !== -1, 'size 40 は toFixed(1) の R2.2: ' + bfX.url);
    // 既定は1桁（R1.82 ではない）
    assert.ok(bf.url.indexOf('X-R1.82') === -1, '既定の bbfacing が2桁になっている');
    // 共通部分（base・preflop・board）は cb と同じ
    assert.ok(bf.url.indexOf(W.BASE + '&preflop_actions=F-F-F-R2.5-F-C&') === 0, 'bbfacing の先頭が base+preflop でない');
    assert.ok(/&board=Ks7d5c$/.test(bf.url), 'bbfacing の末尾が board でない');

    // 実機確認 2026-10-11: size 50 の bbfacing は X-R2.75（Wizard の実ノード。R2.8 は 51% のカスタム解になる）
    var bf50 = W.url(spot50(), 'bbfacing');
    assert.ok(bf50.url.indexOf('flop_actions=X-R2.75&history_spot=8') !== -1, 'size 50 の bbfacing に X-R2.75 が無い: ' + bf50.url);
    assert.strictEqual(bf50.verified, true, 'bbfacing(50) は verified true');

    // 33/50 は betDecimals に関わらず実ノード表記で固定（R1.82 は 33% のカスタム解になるので出さない）
    assert.ok(W.url(spot33(), 'bbfacing', { betDecimals: 2 }).url.indexOf('X-R1.8&') !== -1, '33 は betDecimals:2 でも R1.8');
    assert.ok(W.url(spot50(), 'bbfacing', { betDecimals: 1 }).url.indexOf('X-R2.75&') !== -1, '50 は betDecimals:1 でも R2.75');
    // 既定ノードに無いサイズだけ betDecimals が効く（既定1桁、不正値は1桁）
    var s40 = { board: 'Ks7d5c', villainPos: 'BTN', size: 40 };
    assert.ok(W.url(s40, 'bbfacing', { betDecimals: 2 }).url.indexOf('X-R2.20&') !== -1, 'size 40 betDecimals:2 は R2.20');
    assert.ok(W.url(s40, 'bbfacing', {}).url.indexOf('X-R2.2&') !== -1);
    assert.ok(W.url(s40, 'bbfacing', { betDecimals: 3 }).url.indexOf('X-R2.2&') !== -1);

    // 受入: betBB
    assert.strictEqual(W.betBB(5.5, 33), 1.82, 'betBB(5.5,33) !== 1.82');
    assert.strictEqual(W.betBB(5.5, 50), 2.75, 'betBB(5.5,50) !== 2.75');
    assert.ok(Number.isNaN(W.betBB('5.5', 33)), '非数値で NaN');

    // 受入: potOf
    assert.strictEqual(W.potOf('BTN'), 5.5, 'potOf(BTN) !== 5.5');
    assert.strictEqual(W.potOf('HJ'), null, 'potOf(HJ) !== null');
    assert.strictEqual(W.potOf(undefined), null);
    assert.strictEqual(W.potOf('toString'), null, 'prototype のキーで null');

    // 受入: villainPos 'HJ' で url===null（cb・bbfacing とも）
    var hj = W.url({ board: 'Ks7d5c', villainPos: 'HJ', size: 33, pot: 5.5, bet: 1.82 }, 'cb');
    assert.strictEqual(hj.url, null, 'HJ の cb url が null でない');
    assert.strictEqual(hj.verified, false);
    assert.strictEqual(W.url({ board: 'Ks7d5c', villainPos: 'HJ', size: 33 }, 'bbfacing').url, null, 'HJ の bbfacing url が null でない');

    // 受入: testUrl(2) に R1.82
    var t2 = W.testUrl(2);
    assert.strictEqual(typeof t2, 'string');
    assert.ok(t2.indexOf('R1.82') !== -1, 'testUrl(2) に R1.82 が無い: ' + t2);
    assert.ok(t2.indexOf('history_spot=8') !== -1, 'testUrl は bbfacing ノード');
    assert.ok(t2.indexOf('board=Ks7d5c') !== -1, 'testUrl は K75r');
    // testUrl() 既定は1桁
    var t1 = W.testUrl();
    assert.ok(t1.indexOf('R1.8&') !== -1 && t1.indexOf('R1.82') === -1, 'testUrl() 既定が1桁でない: ' + t1);
    assert.strictEqual(W.testUrl(1), t1);

    // 形式: gmfs_solution_tab を付けない・depth=100 を常に明示・target 用の余計なクエリ無し
    [cb.url, bf.url, bf2.url, t1, t2].forEach(function (u) {
      assert.ok(u.indexOf('gmfs_solution_tab') === -1, 'gmfs_solution_tab が付いている: ' + u);
      assert.ok(u.indexOf('&depth=100&') !== -1, 'depth=100 が無い: ' + u);
      assert.ok(u.indexOf(' ') === -1, 'URL にスペースがある: ' + u);
    });

    // board の正規化：スペース無し・ランク大文字＋スート小文字
    var norm = W.url({ board: 'ks 7D 5c', villainPos: 'BTN', size: 33 }, 'cb');
    assert.strictEqual(norm.url, CB_EXPECTED, 'board の正規化が効いていない: ' + norm.url);

    // pot 省略時は potOf(villainPos) で補う／size 無しの bbfacing は url null
    var noPot = W.url({ board: 'Ks7d5c', villainPos: 'BTN', size: 33 }, 'bbfacing');
    assert.ok(noPot.url.indexOf('X-R1.8&') !== -1, 'pot 省略時に potOf で補えていない');
    assert.strictEqual(W.url({ board: 'Ks7d5c', villainPos: 'BTN' }, 'bbfacing').url, null, 'size 無しの bbfacing が null でない');
    assert.strictEqual(W.url({ villainPos: 'BTN', size: 33 }, 'cb').url, null, 'board 無しが null でない');

    // node 省略は cb と同じ
    assert.strictEqual(W.url(spot33()).url, CB_EXPECTED, 'node 省略が cb でない');
  }
};
