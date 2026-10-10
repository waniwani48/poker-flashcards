// premise-drill: PD.ui.memo の純粋部分（html(ctx)）のテスト（M2）。jsdom 無し。
// 実行: node test/run.js ui-memo
'use strict';

var path = require('path');

var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

var memoUi = require(path.join(__dirname, '..', 'js', 'ui', 'memo.js'));

function card(id, deck, kind, q) {
  return { id: id, deck: deck, kind: kind, q: q };
}

function defaultItems() {
  return [
    { card: card('alpha_33', 'alpha', 'number', '33% ベットに対して、自レンジの何%を降りる？（暗記値）'), kind: 'number' },
    { card: card('pf_As', 'pf', 'text', 'BB が BTN 2.5bb オープンにコールする境界：suited A の底は？'), kind: 'text' },
    { card: card('eqgap_more', 'eqgap', 'lines', 'サイズ→fold% を α より多めに降りるスポットを全部挙げよ'), kind: 'lines' },
    {
      card: card('board_1', 'board', 'board', 'Ks7d5c：クラスは？ 1枚でストレートドローになるランクは？（無ければ「無し」）'),
      kind: 'board',
      boardSpot: { board: 'Ks7d5c' }
    }
  ];
}

function ctxWith(overrides) {
  overrides = overrides || {};
  var memo = {
    state: overrides.state || { cards: {}, daily: { ok: 1, ng: 2, boardOk: 1, boardN: 3 } },
    items: overrides.items || defaultItems(),
    idx: overrides.idx || 0,
    phase: overrides.phase || 'ask',
    input: overrides.input === undefined ? null : overrides.input,
    result: overrides.result || null
  };
  return { memo: memo };
}

function run(assert) {
  // ================= ask：各 kind の入力部と「答えを見る」 =================
  var h0 = memoUi.html(ctxWith({ idx: 0, phase: 'ask' }));
  assert.ok(h0.indexOf('答えを見る') >= 0, 'ask に「答えを見る」');
  assert.ok(/data-act="reveal"[^>]*disabled/.test(h0), '空入力では disabled');
  assert.ok(/<input[^>]*type="number"[^>]*inputmode="numeric"[^>]*data-k="value"/.test(h0), 'alpha は number input（inputmode=numeric）');
  assert.ok(h0.indexOf('1/4') >= 0, '進捗「1/4」が出る');
  assert.ok(h0.indexOf('pd-chip') < 0, 'ask にチップ要素が無い');

  // 入力があれば disabled が外れ、値が保持される
  var hFilled = memoUi.html(ctxWith({ idx: 0, phase: 'ask', input: { value: '30' } }));
  assert.ok(!/data-act="reveal"[^>]*disabled/.test(hFilled), '入力があれば答えを見るが押せる');
  assert.ok(hFilled.indexOf('value="30"') >= 0, '入力値が再描画でも保持される');

  // pf：1行テキスト
  var hPf = memoUi.html(ctxWith({ idx: 1, phase: 'ask' }));
  assert.ok(/<input[^>]*type="text"[^>]*data-k="value"/.test(hPf), 'pf は text input');
  assert.ok(/data-act="reveal"[^>]*disabled/.test(hPf), 'pf も空入力では disabled');

  // eqgap：複数行 textarea
  var hEq = memoUi.html(ctxWith({ idx: 2, phase: 'ask' }));
  assert.ok(/<textarea[^>]*data-k="value"/.test(hEq), 'eqgap は textarea');

  // board：クラス／ランクの2つの text input
  var hBoard = memoUi.html(ctxWith({ idx: 3, phase: 'ask' }));
  assert.ok(/data-k="cls"/.test(hBoard) && /data-k="ranks"/.test(hBoard), 'board はクラス／ランクの2入力');
  assert.strictEqual((hBoard.match(/<input/g) || []).length, 2, 'board の input は2つだけ');
  assert.ok(hBoard.indexOf('<textarea') < 0, 'board に textarea は無い');

  // board：片方だけ入力では disabled のまま
  var hBoardHalf = memoUi.html(ctxWith({ idx: 3, phase: 'ask', input: { cls: 'ドライ', ranks: '' } }));
  assert.ok(/data-act="reveal"[^>]*disabled/.test(hBoardHalf), 'board は片方未入力で disabled');
  var hBoardFull = memoUi.html(ctxWith({ idx: 3, phase: 'ask', input: { cls: 'ドライ', ranks: '無し' } }));
  assert.ok(!/data-act="reveal"[^>]*disabled/.test(hBoardFull), 'board は両方入力で押せる');

  // ================= reveal =================
  // 本物の PD.memo（M1）が読み込まれていても、ここでは差し替えて検証する（終了時に必ず元へ戻す）
  var realMemo = PD.memo;
  PD.memo = {
    checkAlpha: function (id, v) { return id === 'alpha_33' && v === 30; },
    checkBoard: function (board, cls, ranks) {
      return { clsOk: cls === 'ドライ', ranksOk: ranks === '無し', expect: { cls: 'dry_high', ranks: [] } };
    },
    eqgapAnswer: function (id) {
      return id === 'eqgap_more' ? ['4bp', 'utg', 'capped', 'wide'] : ['btn', 'turn'];
    },
    wizardPfUrl: function () {
      return { url: 'https://app.gtowizard.com/solutions?x', verified: false, note: '要実機確認' };
    }
  };

  // alpha：補助照合バッジ（一致／不一致）
  var hRevealOk = memoUi.html(ctxWith({ idx: 0, phase: 'reveal', input: { value: '30' } }));
  assert.ok(hRevealOk.indexOf('一致') >= 0 && hRevealOk.indexOf('data-match="ok"') >= 0, 'alpha 一致バッジ');
  assert.ok(hRevealOk.indexOf('○ 覚えてた') >= 0 && hRevealOk.indexOf('× 忘れた') >= 0, 'reveal の下部バー文言');
  assert.ok(/data-act="ok"/.test(hRevealOk) && /data-act="ng"/.test(hRevealOk), 'ok/ng の data-act');

  var hRevealNg = memoUi.html(ctxWith({ idx: 0, phase: 'reveal', input: { value: '99' } }));
  assert.ok(hRevealNg.indexOf('不一致') >= 0 && hRevealNg.indexOf('data-match="ng"') >= 0, 'alpha 不一致バッジ');

  // pf：Wizard リンクと textarea（data-role="note"）
  var hRevealPf = memoUi.html(ctxWith({ idx: 1, phase: 'reveal', input: { value: 'A2s' } }));
  assert.ok(
    /<a[^>]*href="https:\/\/app\.gtowizard\.com\/solutions\?x"[^>]*target="_blank"[^>]*rel="noopener"/.test(hRevealPf),
    'Wizard リンクが target=_blank rel=noopener'
  );
  assert.ok(/<textarea[^>]*data-role="note"/.test(hRevealPf), 'メモ textarea（data-role=note）');
  assert.ok(hRevealPf.indexOf('未確認') >= 0, '前回メモが無ければ「未確認」');
  assert.ok(hRevealPf.indexOf('A2s') >= 0, '本人の入力が表示される');

  // pf：前回メモがあれば esc して表示
  var hRevealPfNote = memoUi.html(ctxWith({
    idx: 1, phase: 'reveal', input: { value: 'A2s' },
    state: { cards: { pf_As: { note: '<b>A2s</b>から' } }, daily: {} }
  }));
  assert.ok(hRevealPfNote.indexOf('&lt;b&gt;A2s&lt;/b&gt;から') >= 0, '前回メモは esc される');

  // eqgap：暗記値の一覧を表示
  var hRevealEq = memoUi.html(ctxWith({ idx: 2, phase: 'reveal', input: { value: '4bp\nutg' } }));
  assert.ok(hRevealEq.indexOf('4bp') >= 0 && hRevealEq.indexOf('capped') >= 0, 'eqgap の暗記一覧（EQGAP_MEMO 由来）が出る');

  // board：クラス／ランクそれぞれにバッジ
  var hRevealBoard = memoUi.html(ctxWith({ idx: 3, phase: 'reveal', input: { cls: 'ドライ', ranks: '無し' } }));
  assert.ok(hRevealBoard.indexOf('クラス：') >= 0 && hRevealBoard.indexOf('ランク：') >= 0, 'board は2つのバッジ');
  assert.strictEqual((hRevealBoard.match(/一致/g) || []).length, 2, 'board 両方一致');

  var hRevealBoardNg = memoUi.html(ctxWith({ idx: 3, phase: 'reveal', input: { cls: 'ウェット', ranks: 'KT8' } }));
  assert.ok(hRevealBoardNg.indexOf('不一致') >= 0, 'board 不一致バッジ');

  delete PD.memo;

  // PD.memo が無くてもエラーにならない（任意依存）
  var hNoMemoApi = memoUi.html(ctxWith({ idx: 0, phase: 'reveal', input: { value: '30' } }));
  assert.ok(hNoMemoApi.indexOf('本人の入力') >= 0, 'PD.memo 無しでも reveal は描画される');

  // 元の PD.memo（本物があれば本物）に戻す。他のテストファイルの状態を汚さない
  if (realMemo === undefined) { delete PD.memo; } else { PD.memo = realMemo; }

  // ================= done =================
  var hDone = memoUi.html(ctxWith({ phase: 'done' }));
  assert.ok(/data-act="to-drill"/.test(hDone), '「ドリルへ」ボタン（data-act）');
  assert.ok(/data-go="home"/.test(hDone), '「ホーム」ボタン（data-go）');
  assert.ok(hDone.indexOf('○ 覚えてた：1') >= 0, 'ok 件数');
  assert.ok(hDone.indexOf('× 忘れた：2') >= 0, 'ng 件数');
  assert.ok(hDone.indexOf('ボード正答：1/3') >= 0, 'boardOk/boardN 件数');

  // items が空なら「今日の暗記はありません」＋ホーム
  var hEmpty = memoUi.html(ctxWith({ items: [] }));
  assert.ok(hEmpty.indexOf('ありません') >= 0 && /data-go="home"/.test(hEmpty), '出題なしの案内');

  // ================= 全フェーズを通じてチップ要素が無い =================
  var all = [h0, hFilled, hPf, hEq, hBoard, hBoardHalf, hBoardFull,
    hRevealOk, hRevealNg, hRevealPf, hRevealPfNote, hRevealEq, hRevealBoard, hRevealBoardNg,
    hNoMemoApi, hDone, hEmpty].join('');
  assert.ok(all.indexOf('pd-chip') < 0, 'どのフェーズにも .pd-chip が無い（チップ・選択肢を出さない）');
  assert.ok(all.indexOf('pd-keypad') < 0, 'キーパッドも無い（自由記述のみ）');
  assert.ok(all.indexOf('<select') < 0, 'select も無い（自由記述のみ）');

  // ================= render：DOM が無くても／簡易 DOM でも例外にならない =================
  assert.strictEqual(typeof memoUi.render, 'function', 'render は関数');
  var fakeRoot = {
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    addEventListener: function () {},
    querySelector: function () { return null; },
    contains: function () { return true; }
  };
  memoUi.render(fakeRoot, ctxWith({ idx: 0, phase: 'ask' }));
  assert.ok(fakeRoot._html.indexOf('答えを見る') >= 0, 'render が html(ctx) と同じ内容を書き込む');
  memoUi.render(null, ctxWith()); // root が無ければ何もしない（例外にならない）
}

module.exports = { name: 'ui-memo', run: run };
