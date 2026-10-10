// premise-drill: PD.ui.drill の純粋部分（文字列生成・判定）のテスト（T9）。jsdom 無し。
// 実行: node test/run.js ui-drill
'use strict';

var path = require('path');
var sheet = require(path.join(__dirname, '..', 'js', 'sheet.js'));
var drill = require(path.join(__dirname, '..', 'js', 'ui', 'drill.js'));

// モック Spot（T2 のラベル文字列は使わない。cls / family / suit は DOM に出てはいけない値として検査に使う）
function mockSpot() {
  return {
    id: 's_test', seed: 1, node: 'BTN2.5-BBcall-x-cb', villainPos: 'BTN', pre: 'F-F-F-R2.5-F-C',
    board: 'Ks7d5c', cls: 'dry_high', suit: 'rainbow', connected: false, hmsd: false,
    size: 33, pot: 5.5, bet: 1.82, hero: 'Ad4d', heroPool: 'A_lowkick_s', family: 'dry_high_33'
  };
}

function ctxWith(values, opts) {
  opts = opts || {};
  var tempo = opts.tempo || 'slow';
  return {
    state: null, log: [], view: 'drill', mode: 'drill', tempo: tempo, reason: 'random',
    spot: opts.spot === undefined ? mockSpot() : opts.spot,
    fields: sheet.buildSheet(opts.extra || [], tempo),
    sheet: values || sheet.emptyValues(),
    hints: opts.hints || [],
    startedAt: Date.now(), timer: null, pairNext: null, entry: null, judgeState: 'nokey',
    go: function () {}, commit: function () {}, saveOutcome: function () {}, next: function () {}, toast: function () {}
  };
}

function filledValues() {
  var v = sheet.emptyValues();
  v.f1.foldPct = 30;
  v.f2 = { trash: 30, hi: 20, pairPlus: 50 };
  v.f3 = { noDraw: false, drawRanks: ['6'], shiftPct: 10, examples: ['86s', '64s'] };
  v.f4 = { pureAirPct: 20, enough: 'yes', foldList: ['J2o', 'T5o', 'Q7o'], nextLayer: [] };
  v.f5 = { bdfd: true, bdsd: false, gut: false, oesd: false, kickerNote: 'キッカー 4', position: 'edge', action: 'call', confidence: 80 };
  return v;
}

function stateOf(html, fid) {
  var m = new RegExp('data-fid="' + fid + '"[^>]*data-state="([a-z]+)"').exec(html);
  return m ? m[1] : null;
}

function run(assert) {
  // ---- スポットカード：cls / 族名 / スート構成 / Hero プール名を出さない ----
  var sp = mockSpot();
  var card = drill.spotCardHtml(sp, { tempo: 'slow' });
  assert.ok(card.indexOf('Ks7d5c') < 0 || card.indexOf('pd-drill-cardface') >= 0, 'ボードはカード面として描く');
  assert.ok(card.indexOf('pd-drill-cardface') >= 0, 'カード面がある');
  assert.ok(card.indexOf('♠') >= 0 && card.indexOf('♦') >= 0 && card.indexOf('♣') >= 0, 'スート記号');
  assert.ok(card.indexOf('5.5bb') >= 0 && card.indexOf('1.82bb') >= 0 && card.indexOf('33%') >= 0, 'pot/bet/サイズ');
  ['dry_high', 'dry_high_33', 'rainbow', 'twotone', 'A_lowkick_s', 'hmsd', 'connected'].forEach(function (bad) {
    assert.ok(card.indexOf(bad) < 0, 'スポットカードに出してはいけない文字列: ' + bad);
  });

  // ---- 画面全体：空の票で f1 が open、f2..f5 が locked（②空で③が locked） ----
  var ctx0 = ctxWith(sheet.emptyValues());
  var h0 = drill.html(ctx0);
  assert.strictEqual(stateOf(h0, 'f1'), 'open');
  assert.strictEqual(stateOf(h0, 'f2'), 'locked');
  assert.strictEqual(stateOf(h0, 'f3'), 'locked');
  assert.strictEqual(stateOf(h0, 'f5'), 'locked');
  assert.strictEqual((h0.match(/data-state="open"/g) || []).length, 1, '開いている欄は1つ');
  assert.ok(/class="pd-btn pd-btn-primary pd-drill-commit" data-act="commit" disabled/.test(h0), '空の票ではコミット disabled');
  assert.ok(h0.indexOf('未充足：') >= 0, '未充足の欄名を常時表示');
  sheet.SHEET_V1.forEach(function (f) {
    assert.ok(h0.indexOf('未充足：') >= 0 && h0.indexOf(f.label) >= 0, '未充足に欄名 ' + f.label);
  });
  ['dry_high', 'dry_high_33', 'rainbow', 'A_lowkick_s'].forEach(function (bad) {
    assert.ok(h0.indexOf(bad) < 0, 'Drill DOM に出してはいけない文字列: ' + bad);
  });
  assert.ok(h0.indexOf('pd-drill-hintbtn') >= 0, 'slow ではヒントボタンがある');
  assert.ok(h0.indexOf('data-key="A"') >= 0 && h0.indexOf('data-key="2"') >= 0 && h0.indexOf('data-key="s"') >= 0 &&
            h0.indexOf('data-key="o"') >= 0 && h0.indexOf('data-key="del"') >= 0, 'キーパッド 13ランク＋s/o＋削除');

  // ---- ①充足 → ②が open、③ locked ----
  var v1 = sheet.emptyValues();
  v1.f1.foldPct = 30;
  var h1 = drill.html(ctxWith(v1));
  assert.strictEqual(stateOf(h1, 'f1'), 'passed');
  assert.strictEqual(stateOf(h1, 'f2'), 'open');
  assert.strictEqual(stateOf(h1, 'f3'), 'locked');
  assert.ok(h1.indexOf('value="30"') >= 0, '①の値が input に保持される');

  // ---- ③「無し」宣言で shiftPct≠0 → 未充足表示 ----
  var v3 = sheet.emptyValues();
  v3.f1.foldPct = 30;
  v3.f2 = { trash: 30, hi: 20, pairPlus: 50 };
  v3.f3 = { noDraw: true, drawRanks: [], shiftPct: 10, examples: [] };
  var h3 = drill.html(ctxWith(v3));
  assert.strictEqual(stateOf(h3, 'f3'), 'open');
  assert.ok(h3.indexOf(sheet.isFilled(sheet.SHEET_V1[2], v3, mockSpot()).msg) >= 0, '③の未充足理由が表示される');
  assert.ok(/data-f="f3" data-k="noDraw" checked/.test(h3), 'noDraw チェックが保持される');

  // ---- 全欄充足 → コミット enabled、全欄 passed ----
  var vf = filledValues();
  var cf = ctxWith(vf);
  assert.ok(sheet.canCommit(cf.fields, vf, cf.spot).ok, 'モック値は canCommit ok');
  var hf = drill.html(cf);
  assert.ok(/data-act="commit">コミット</.test(hf), 'コミット enabled（disabled 無し）');
  assert.ok(hf.indexOf('data-act="commit" disabled') < 0);
  ['f1', 'f2', 'f3', 'f4', 'f5'].forEach(function (fid) { assert.strictEqual(stateOf(hf, fid), 'passed'); });
  assert.ok(hf.indexOf('data-state="open"') < 0, '全充足なら open 無し');
  assert.ok(hf.indexOf('J2o') >= 0 && hf.indexOf('T5o') >= 0, 'foldList が描画される');
  assert.ok(hf.indexOf('80%') >= 0, '確信度がバーに出る');
  var states = drill.statesOf(cf.fields, vf, cf.spot);
  assert.deepStrictEqual(states, ['passed', 'passed', 'passed', 'passed', 'passed']);

  // ---- 確信度上限：ヒント無しで max=100、ヒント1回で max=70 ----
  var hNo = drill.html(ctxWith(filledValues(), { hints: [] }));
  assert.ok(/data-f="f5" data-k="confidence"[^>]*max="100"/.test(hNo), 'ヒント無しは max=100');
  var hHint = drill.html(ctxWith(filledValues(), { hints: [{ field: 'f3', tier: 1 }] }));
  assert.ok(/data-f="f5" data-k="confidence"[^>]*max="70"/.test(hHint), 'ヒント1回で max=70');
  assert.ok(hHint.indexOf('上限 70%') >= 0, '上限の注記');
  // 使ったヒントの本文は表示、未使用は hidden
  var f3hints = sheet.SHEET_V1[2].hints;
  assert.ok(new RegExp('data-tier="1">' + f3hints[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hHint), 'ヒント1本文が見える');
  assert.ok(new RegExp('data-tier="2" hidden>').test(hHint), 'ヒント2本文は hidden');

  // ---- normal / speed ではヒント無し、speed は縮約（extra 無し・④ foldList 最大3） ----
  var hNormal = drill.html(ctxWith(sheet.emptyValues(), { tempo: 'normal' }));
  assert.ok(hNormal.indexOf('pd-drill-hintbtn') < 0, 'normal はヒント無し');
  var hSpeed = drill.html(ctxWith(sheet.emptyValues(), { tempo: 'speed' }));
  assert.ok(hSpeed.indexOf('pd-drill-hintbtn') < 0, 'speed はヒント無し');
  assert.ok(hSpeed.indexOf('data-list="f4.foldList" data-max="3"') >= 0, 'speed の fold 組は最大3');
  assert.ok(hSpeed.indexOf('data-timer') >= 0, 'speed はバーに残り時間の枠');

  // ---- 追加欄：rank_table が f4 の前に入り、pf_removed はキーパッド ----
  var ctxE = ctxWith(sheet.emptyValues(), { extra: ['rank_table', 'pf_removed'] });
  var hE = drill.html(ctxE);
  assert.ok(hE.indexOf('data-fid="rank_table"') < hE.indexOf('data-fid="f4"'), 'rank_table は f4 の直前');
  assert.ok(hE.indexOf('data-fid="pf_removed"') < hE.indexOf('data-fid="f2"'), 'pf_removed は f2 の前');
  assert.ok(hE.indexOf('data-list="extra.pf_removed"') >= 0, 'pf_removed はリスト＋キーパッド');
  assert.strictEqual((hE.match(/data-f="rank_table" data-k="hand"/g) || []).length, 3, 'rank_table は最低3行');

  // ---- キーパッド：'A','4','s' → A4s、'A' 単独の追加は弾く、'4','4' → 44 ----
  var r = drill.keypadPress('', 'A');
  assert.strictEqual(r.buf, 'A'); assert.strictEqual(r.add, null);
  r = drill.keypadPress('A', '4');
  assert.strictEqual(r.buf, 'A4'); assert.strictEqual(r.add, null);
  r = drill.keypadPress('A4', 's');
  assert.strictEqual(r.add, 'A4s'); assert.strictEqual(r.buf, '');
  r = drill.keypadPress('A', 'add');
  assert.strictEqual(r.add, null); assert.ok(r.err, "'A' 単独は弾かれる");
  r = drill.keypadPress('', 'add');
  assert.strictEqual(r.add, null); assert.ok(r.err);
  r = drill.keypadPress('4', '4');
  assert.strictEqual(r.add, '44');
  r = drill.keypadPress('A4', 'K');
  assert.strictEqual(r.add, null); assert.ok(r.err, '3つ目のランクは弾く');
  r = drill.keypadPress('A', 's');
  assert.strictEqual(r.add, null); assert.ok(r.err, 'ランク1つで s は弾く');
  r = drill.keypadPress('A4', 'del');
  assert.strictEqual(r.buf, 'A'); assert.strictEqual(r.removeLast, false);
  r = drill.keypadPress('', 'del');
  assert.strictEqual(r.removeLast, true, 'buf 空の削除はリスト末尾の削除');
  r = drill.keypadPress('A4o', 'add');
  assert.strictEqual(r.add, 'A4o');

  // ---- リスト表示：並べ替えボタンは reorder 時のみ、学習者入力はエスケープ ----
  var li = drill.listItemsHtml(['J2o', 'T5o'], true);
  assert.ok(li.indexOf('data-act="mv"') >= 0 && li.indexOf('data-act="rm"') >= 0);
  assert.ok(drill.listItemsHtml(['J2o'], false).indexOf('data-act="mv"') < 0);
  assert.ok(drill.listItemsHtml(['<b>'], false).indexOf('&lt;b&gt;') >= 0, 'esc される');
  assert.ok(drill.listItemsHtml([], false).indexOf('まだありません') >= 0);

  // ---- 要約（toText 1欄分） ----
  var sum = drill.summaryOf(sheet.SHEET_V1[0], vf);
  assert.ok(sum.indexOf('30') >= 0, '①の要約に値');

  // ---- 未充足テキスト ----
  var mt = drill.missingText(cf.fields, sheet.emptyValues(), cf.spot);
  assert.strictEqual(mt.ok, false);
  assert.ok(mt.text.indexOf('未充足：') === 0);
  assert.strictEqual(drill.missingText(cf.fields, vf, cf.spot).ok, true);

  // ---- 出題なし ----
  var hNone = drill.html(ctxWith(sheet.emptyValues(), { spot: null }));
  assert.ok(hNone.indexOf('出題がありません') >= 0 && hNone.indexOf('data-go="home"') >= 0);

  // ---- カード分解 ----
  assert.deepStrictEqual(drill.cardTokens('Ks7d5c'), [{ r: 'K', s: 's' }, { r: '7', s: 'd' }, { r: '5', s: 'c' }]);

  // ---- 用語：カタカナ正典に反する語が HTML に無い（語そのものをこのファイルに書かないよう文字コードで組む） ----
  var all = h0 + hf + hE + hSpeed;
  [[0x4e7e, 0x3044], [0x6fe1, 0x308c], [0x9ad8, 0x30ab, 0x30fc, 0x30c9], [0x63a5, 0x7d9a]].forEach(function (codes) {
    var bad = String.fromCharCode.apply(null, codes);
    assert.ok(all.indexOf(bad) < 0, '禁止用語（コード ' + codes.join(',') + '）');
  });
}

module.exports = { name: 'ui-drill', run: run };
