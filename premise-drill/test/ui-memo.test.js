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

  // board：選択式（種類7択＋ランク13択＋「無し」）。text input は無い
  var hBoard = memoUi.html(ctxWith({ idx: 3, phase: 'ask' }));
  assert.strictEqual((hBoard.match(/data-pick="cls"/g) || []).length, 7, 'board の種類チップは7つ');
  assert.strictEqual((hBoard.match(/data-pick="rank"/g) || []).length, 14, 'board のランクチップは13＋「無し」');
  assert.ok(hBoard.indexOf('<input') < 0 && hBoard.indexOf('<textarea') < 0, 'board に自由入力は無い');
  assert.ok(hBoard.indexOf('モノトーン') >= 0 && hBoard.indexOf('ドライ・ハイ') >= 0, '種類は日本語ラベル');

  // board：片方だけ選択では disabled のまま。選択済みチップは aria-pressed=true
  var hBoardHalf = memoUi.html(ctxWith({ idx: 3, phase: 'ask', input: { cls: 'dry_high', ranks: '' } }));
  assert.ok(/data-act="reveal"[^>]*disabled/.test(hBoardHalf), 'board は片方未選択で disabled');
  assert.ok(/data-pick="cls" data-v="dry_high" aria-pressed="true"/.test(hBoardHalf), '選択中の種類チップが押下表示');
  var hBoardFull = memoUi.html(ctxWith({ idx: 3, phase: 'ask', input: { cls: 'dry_high', ranks: 'KT' } }));
  assert.ok(!/data-act="reveal"[^>]*disabled/.test(hBoardFull), 'board は両方選択で押せる');
  assert.strictEqual((hBoardFull.match(/data-pick="rank" data-v="[KT]" aria-pressed="true"/g) || []).length, 2, 'K と T が押下表示');
  var hBoardNone = memoUi.html(ctxWith({ idx: 3, phase: 'ask', input: { cls: 'dry_high', ranks: '無し' } }));
  assert.ok(/data-v="無し" aria-pressed="true"/.test(hBoardNone), '「無し」が押下表示');

  // ================= reveal =================
  // 本物の PD.memo（M1）が読み込まれていても、ここでは差し替えて検証する（終了時に必ず元へ戻す）
  var realMemo = PD.memo;
  // PD.range（レンジ表）は「未入力」のスタブにして、pf の従来表示（Wizard リンク＋本人 ○×）を検証する
  var realRange = PD.range;
  PD.range = { load: function () { return { v: 1, cells: {} }; }, isFilled: function () { return false; } };
  PD.memo = {
    checkAlpha: function (id, v) { return id === 'alpha_33' && v === 30; },
    checkBoard: function (board, cls, ranks) {
      return { clsOk: cls === 'dry_high', ranksOk: ranks === '無し', expect: { cls: 'dry_high', ranks: [] } };
    },
    ALPHA_MEMO: { 33: 30 },
    pureAlpha: function (s) { return Math.round(s / (100 + s) * 100); },
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

  // alpha：暗記値と純αを併記
  assert.ok(hRevealOk.indexOf('暗記値：') >= 0 && hRevealOk.indexOf('純α 25%') >= 0, 'alpha の reveal に暗記値と純α');

  // board：正解を表示し、自動判定（○／×）。下部バーは「次へ」のみ
  var hRevealBoard = memoUi.html(ctxWith({ idx: 3, phase: 'reveal', input: { cls: 'dry_high', ranks: '無し' } }));
  assert.ok(hRevealBoard.indexOf('正解：') >= 0 && hRevealBoard.indexOf('種類：ドライ・ハイ') >= 0, 'board は正解を表示');
  assert.ok(/data-ok="1"/.test(hRevealBoard) && hRevealBoard.indexOf('○ 正解') >= 0, 'board 両方正解で ○');
  assert.ok(/data-act="auto"/.test(hRevealBoard) && !/data-act="ok"/.test(hRevealBoard), 'board の下部バーは自動判定の「次へ」だけ');

  var hRevealBoardNg = memoUi.html(ctxWith({ idx: 3, phase: 'reveal', input: { cls: 'mono', ranks: 'KT8' } }));
  assert.ok(/data-ok="0"/.test(hRevealBoardNg) && hRevealBoardNg.indexOf('× 不正解') >= 0, 'board どちらか違えば ×');
  assert.ok(hRevealBoardNg.indexOf('ここが違う') >= 0, '違った項目に印');

  delete PD.memo;

  // PD.memo が無くてもエラーにならない（任意依存）
  var hNoMemoApi = memoUi.html(ctxWith({ idx: 0, phase: 'reveal', input: { value: '30' } }));
  assert.ok(hNoMemoApi.indexOf('本人の入力') >= 0, 'PD.memo 無しでも reveal は描画される');

  // 元の PD.memo（本物があれば本物）に戻す。他のテストファイルの状態を汚さない
  // pf：レンジ表が埋まっていれば自動判定（PD.range を埋まったスタブに差し替え）
  PD.range = {
    load: function () { return { v: 1, cells: { A2s: 'call' } }; },
    isFilled: function () { return true; },
    checkPf: function (range, id, text) {
      if (!/^pf_/.test(String(id)) || /3bet/.test(String(id))) return null;
      var got = String(text || '').trim();
      return { ok: got === 'A2s', expect: ['A2s'], got: [got] };
    },
    pfAnswer: function (range, id) { return /3bet/.test(String(id)) ? { expect: ['A5s', 'A4s'], kind: 'list' } : { expect: ['A2s'], kind: 'hand' }; }
  };
  var hPfAuto = memoUi.html(ctxWith({ idx: 1, phase: 'reveal', input: { value: 'A2s' } }));
  assert.ok(hPfAuto.indexOf('○ 正解') >= 0 && /data-act="auto"/.test(hPfAuto) && !/data-act="ok"/.test(hPfAuto), 'pf はレンジ表があれば自動判定で「次へ」');
  assert.ok(hPfAuto.indexOf('レンジ表の答え') >= 0, 'レンジ表の答えを表示');
  assert.ok(!/<a[^>]*app\.gtowizard\.com/.test(hPfAuto), '自動判定のときは Wizard リンクを出さない');
  var hPfAutoNg = memoUi.html(ctxWith({ idx: 1, phase: 'reveal', input: { value: 'A5s' } }));
  assert.ok(hPfAutoNg.indexOf('× 不正解') >= 0 && /data-ok="0"/.test(hPfAutoNg), 'pf 不正解');

  if (realMemo === undefined) { delete PD.memo; } else { PD.memo = realMemo; }
  if (realRange === undefined) { delete PD.range; } else { PD.range = realRange; }

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

  // ================= board 以外はチップ・選択肢を出さない（思い出す練習） =================
  var nonBoard = [h0, hFilled, hPf, hEq,
    hRevealOk, hRevealNg, hRevealPf, hRevealPfNote, hRevealEq,
    hNoMemoApi, hDone, hEmpty].join('');
  assert.ok(nonBoard.indexOf('pd-chip') < 0, 'board 以外のフェーズに .pd-chip が無い');
  var all = nonBoard + [hBoard, hBoardHalf, hBoardFull, hRevealBoard, hRevealBoardNg].join('');
  assert.ok(all.indexOf('pd-keypad') < 0, 'キーパッドは無い');
  assert.ok(all.indexOf('<select') < 0, 'select は無い');

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
