// PD.memo（M1）のテスト。SPEC-memo.md §6 の受入を1項目ずつ assert する。
//   node test/run.js memo
'use strict';

var fs = require('fs');
var path = require('path');
var memo = require(path.join(__dirname, '..', 'js', 'memo.js'));

var MEMO_PATH = path.join(__dirname, '..', 'js', 'memo.js');

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

/** cards のモック（checkBoard 用。実装に依存せず固定値を返す） */
function mockCardsFor(table) {
  return {
    classifyBoard: function (board) { return { cls: (table[board] && table[board].cls) || 'mid' }; },
    drawRanks: function (board) {
      var t = table[board] || {};
      return { gut: t.gut || [], oesd: t.oesd || [] };
    }
  };
}

module.exports = {
  name: 'memo (PD.memo)',
  run: function (assert) {
    var T0 = '2026-10-10';

    // ---------------------------------------------------------------- defaultState
    var d0 = memo.defaultState();
    assert.strictEqual(d0.version, 1);
    assert.deepStrictEqual(d0.cards, {});
    assert.deepStrictEqual(d0.decks, { alpha: true, eqgap: true, pf: true, board: true });
    assert.strictEqual(d0.daily.done, 0);
    assert.strictEqual(d0.daily.finished, false);

    // 契約の定数
    assert.strictEqual(memo.KEY, 'pd_memo_v1');
    assert.deepStrictEqual(memo.ALPHA_MEMO, { 33: 30, 50: 40, 75: 50, 125: 60 });
    assert.deepStrictEqual(memo.MEMO_INTERVALS, [1, 2, 4, 8, 16]);
    assert.strictEqual(memo.NEW_PER_DAY, 4);
    assert.strictEqual(memo.BOARD_PER_DAY, 3);
    assert.strictEqual(memo.CARDS.filter(function (c) { return c.deck === 'alpha'; }).length, 4);
    assert.strictEqual(memo.CARDS.filter(function (c) { return c.deck === 'eqgap'; }).length, 2);
    assert.strictEqual(memo.CARDS.filter(function (c) { return c.deck === 'pf'; }).length, 8);

    // ---------------------------------------------------------------- todaySet（初日）
    var s1 = memo.defaultState();
    var rng = function () { return 0; };
    var set1 = memo.todaySet(s1, T0, rng);
    var byDeck = { alpha: 0, eqgap: 0, pf: 0, board: 0 };
    set1.forEach(function (item) { byDeck[item.card.deck]++; });
    assert.strictEqual(byDeck.alpha, 4, '初日 alpha は4枚全部');
    assert.strictEqual(byDeck.eqgap, 2, '初日 eqgap は2枚全部');
    assert.strictEqual(byDeck.pf, 4, '初日 pf は NEW_PER_DAY=4 枚まで');
    assert.strictEqual(byDeck.board, 3, 'board は常に3枚');
    assert.strictEqual(set1.length, 13);

    // deck off なら除外
    var s1b = memo.defaultState();
    s1b.decks.pf = false;
    s1b.decks.board = false;
    var set1b = memo.todaySet(s1b, T0, rng);
    assert.ok(!set1b.some(function (item) { return item.card.deck === 'pf'; }), 'pf オフは除外');
    assert.ok(!set1b.some(function (item) { return item.card.deck === 'board'; }), 'board オフは除外');
    assert.strictEqual(set1b.length, 6, 'alpha4+eqgap2のみ');

    // ---------------------------------------------------------------- grade
    var g0 = memo.defaultState();
    var g1 = memo.grade(g0, 'alpha_33', true, T0);
    assert.strictEqual(g1.cards.alpha_33.box, 1, '○で box+1');
    assert.strictEqual(g1.cards.alpha_33.due, '2026-10-12', 'due = today + MEMO_INTERVALS[1]=2');
    assert.strictEqual(g1.cards.alpha_33.reps, 1);
    assert.strictEqual(g1.cards.alpha_33.lapses, 0);
    assert.strictEqual(g1.daily.date, T0);
    assert.strictEqual(g1.daily.done, 1);
    assert.strictEqual(g1.daily.ok, 1);
    assert.strictEqual(g1.daily.ng, 0);

    var g2 = memo.grade(g1, 'alpha_33', true, '2026-10-12');
    assert.strictEqual(g2.cards.alpha_33.box, 2, '2回目の○で box+1');
    assert.strictEqual(g2.cards.alpha_33.due, '2026-10-16', 'due = 2026-10-12 + MEMO_INTERVALS[2]=4');

    var g3 = memo.grade(g2, 'alpha_33', false, '2026-10-16');
    assert.strictEqual(g3.cards.alpha_33.box, 0, '×で box=0');
    assert.strictEqual(g3.cards.alpha_33.due, '2026-10-17', '×で due=明日');
    assert.strictEqual(g3.cards.alpha_33.lapses, 1);
    assert.strictEqual(g3.daily.date, '2026-10-16', '日付が変わったら daily はリセット');
    assert.strictEqual(g3.daily.done, 1);
    assert.strictEqual(g3.daily.ng, 1);
    assert.strictEqual(g3.daily.ok, 0, '新しい日の daily は前日の ok を持ち越さない');

    // gradeBoard は daily.boardOk/boardN のみ
    var gb0 = memo.defaultState();
    var gb1 = memo.gradeBoard(gb0, true, T0);
    assert.strictEqual(gb1.daily.boardN, 1);
    assert.strictEqual(gb1.daily.boardOk, 1);
    assert.strictEqual(gb1.daily.done, 0, 'gradeBoard は done を増やさない');
    var gb2 = memo.gradeBoard(gb1, false, T0);
    assert.strictEqual(gb2.daily.boardN, 2);
    assert.strictEqual(gb2.daily.boardOk, 1);

    // ---------------------------------------------------------------- onGap
    var og0 = memo.defaultState();
    // alpha の全カードに既存レコードを作る：1枚は未来 due、1枚は今日 due
    og0.cards.alpha_33 = { box: 2, due: '2026-10-20', reps: 2, lapses: 0, lastAt: null, note: '' };
    og0.cards.alpha_50 = { box: 0, due: T0, reps: 1, lapses: 1, lastAt: null, note: '' };
    var og1 = memo.onGap(og0, 'baseline', T0);
    assert.strictEqual(og1.cards.alpha_33.due, '2026-10-11', 'baseline→alpha：未来 due は明日に前倒し');
    assert.strictEqual(og1.cards.alpha_50.due, T0, '既に今日 due ならそのまま');
    assert.ok(!og1.cards.alpha_75, '未学習カードは変更しない（レコードを作らない）');
    // gap が対応しない種類は無変化
    var og2 = memo.onGap(og0, 'none', T0);
    assert.strictEqual(og2.cards.alpha_33.due, '2026-10-20', 'none は対象外のためそのまま');
    // range_state→pf, rule→eqgap の対応も確認
    var og3 = memo.defaultState();
    og3.cards.pf_As = { box: 1, due: '2026-10-25', reps: 1, lapses: 0, lastAt: null, note: '' };
    og3.cards.eqgap_more = { box: 1, due: '2026-10-25', reps: 1, lapses: 0, lastAt: null, note: '' };
    var og4 = memo.onGap(og3, 'range_state', T0);
    assert.strictEqual(og4.cards.pf_As.due, '2026-10-11');
    assert.strictEqual(og4.cards.eqgap_more.due, '2026-10-25', 'range_state は eqgap に影響しない');
    var og5 = memo.onGap(og3, 'rule', T0);
    assert.strictEqual(og5.cards.eqgap_more.due, '2026-10-11');
    assert.strictEqual(og5.cards.pf_As.due, '2026-10-25', 'rule は pf に影響しない');

    // ---------------------------------------------------------------- checkAlpha
    assert.strictEqual(memo.checkAlpha('alpha_33', 30), true);
    assert.strictEqual(memo.checkAlpha('alpha_33', 31), false);
    assert.strictEqual(memo.checkAlpha('alpha_50', 40), true);
    assert.strictEqual(memo.checkAlpha('alpha_75', 50), true);
    assert.strictEqual(memo.checkAlpha('alpha_125', 60), true);
    assert.strictEqual(memo.checkAlpha('alpha_999', 1), false, '未知のサイズは false');

    // ---------------------------------------------------------------- eqgapAnswer
    var more = memo.eqgapAnswer('eqgap_more');
    var alpha = memo.eqgapAnswer('eqgap_alpha');
    assert.strictEqual(more.length, 4, 'more は4件');
    assert.strictEqual(alpha.length, 2, 'alpha は2件');

    // ---------------------------------------------------------------- checkBoard（cards はモック注入）
    var mock1 = mockCardsFor({ 'Ks7d5c': { cls: 'dry_high', gut: [], oesd: [] } });
    var r1 = memo.checkBoard('Ks7d5c', 'ドライ', '無し', mock1);
    assert.strictEqual(r1.clsOk, true);
    assert.strictEqual(r1.ranksOk, true);

    var mock2 = mockCardsFor({ 'QsJd9c': { cls: 'bw_sd', gut: ['K', '8'], oesd: ['T'] } });
    var r2 = memo.checkBoard('QsJd9c', 'BW', 'K T 8', mock2);
    assert.strictEqual(r2.clsOk, true);
    assert.strictEqual(r2.ranksOk, true);
    assert.deepStrictEqual(r2.expect.ranks.slice().sort(), ['8', 'K', 'T']);

    var r3 = memo.checkBoard('QsJd9c', 'BW', 'KT', mock2);
    assert.strictEqual(r3.clsOk, true);
    assert.strictEqual(r3.ranksOk, false, "'KT' は '8' が無いので false");

    // ---------------------------------------------------------------- importState（note 保持）
    install(makeStub());
    var base = memo.defaultState();
    base.cards.pf_As = { box: 2, due: '2026-10-15', reps: 3, lapses: 0, lastAt: null, note: '自分のメモ' };
    memo.saveState(base);
    var imp = memo.importState({
      version: 1,
      cards: { pf_As: { box: 0, due: '2026-10-10', reps: 0, lapses: 0, lastAt: null, note: '上書きされるはずのメモ' } }
    });
    assert.strictEqual(imp.ok, true);
    var after = memo.loadState();
    assert.strictEqual(after.cards.pf_As.note, '自分のメモ', '既存 note が非空なら保持');
    assert.strictEqual(after.cards.pf_As.box, 0, 'note 以外は取り込んだ値で更新');

    var impBad = memo.importState({ version: 2, cards: {} });
    assert.strictEqual(impBad.ok, false, 'version 不一致は ok:false');

    // ---------------------------------------------------------------- localStorage スタブで save/load 往復
    install(makeStub());
    var rt = memo.defaultState();
    rt.cards.alpha_33 = { box: 1, due: '2026-10-12', reps: 1, lapses: 0, lastAt: '2026-10-10T00:00:00.000Z', note: '' };
    memo.saveState(rt);
    var rt2 = memo.loadState();
    assert.strictEqual(rt2.cards.alpha_33.box, 1);
    assert.strictEqual(rt2.cards.alpha_33.due, '2026-10-12');
    // 後始末：他のテストに影響しないよう空のスタブへ
    install(makeStub());

    // ---------------------------------------------------------------- 禁止文字列 grep
    var src = fs.readFileSync(MEMO_PATH, 'utf8');
    var bannedTerms = new RegExp(['乾' + 'い', '濡' + 'れ', '高' + 'カード', '接' + '続'].join('|'));
    assert.ok(!bannedTerms.test(src), '用語はカタカナ正典（禁止語を含まない）');
    assert.ok(src.indexOf('note.com') < 0, 'note.com URL を含まない');
    assert.ok(!/https?:\/\//i.test(src), '生の URL を直接埋め込まない（wizard.BASE 経由のみ）');
  }
};
