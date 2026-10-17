// premise-drill: PD.localjudge（Phase D）。前提票①〜⑤のアプリ内判定。
// 契約は SPEC-judge.md §2「PD.localjudge」。判定の土台は PD.range（deps.range で差し替え可）。
// 依存する range 側の API（SPEC-judge §1）：isFilled／stats／callWeight（combos は sub が無いときの保険のみ）。
//   stats.weakestFirst の各要素は { hand, w, score, cat, sub }。sub は cat==='trash' のときの内訳
//   'strong'|'backdoor'|'pureAir'、それ以外は null。f4 の名指し検証は stats を1回呼んだ結果だけで行う。
// ⑤の予測は stats.hero.percentile を使う仮の序列（ヒューリスティック）に基づく。GTO の真値ではない。
// 数値は小数1桁に丸める。未入力（null）の欄は ok=false・diff=null。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

if (typeof require === 'function' && !PD.cards) {
  try { require('./cards'); } catch (e) { /* cards 無しでも名前の解釈と判定は動く */ }
}

PD.localjudge = (function () {
  'use strict';

  // ---------------------------------------------------------------- 定数

  var TOL = { f1: 5, f2: 8, f3: 6, f4: 8 };
  var SIZE_FOLD_PARTIAL = 10;   // size_fold：±5 以内で 2、±10 以内で 1
  var EDGE_BAND = 5;            // ⑤の position：必要 fold% の ±5 を境界とする
  var DEFAULT_BASELINE = { 33: 30, 50: 40 };
  var F5_NOTE = '予測（GTO 真値ではない）';
  var RANKS = 'AKQJT98765432';
  var EPS = 1e-9;

  // ---------------------------------------------------------------- 小道具

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** 小数1桁。-0 は 0 に直す */
  function r1(x) {
    var v = Math.round(x * 10) / 10;
    return v === 0 ? 0 : v;
  }

  /** 数値（または数値文字列）→ number。それ以外は null */
  function num(x) {
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (typeof x === 'string' && x.trim() !== '' && isFinite(Number(x))) return Number(x);
    return null;
  }

  function diffOf(got, expect) {
    return got === null ? null : r1(got - expect);
  }

  function within(diff, tol) {
    return diff !== null && Math.abs(diff) <= tol + EPS;
  }

  /** ランク文字の配列 → 大文字・重複なし・A..2 順 */
  function normRanks(list) {
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (x) {
      var ch = String(x === null || x === undefined ? '' : x).trim().toUpperCase();
      if (ch.length === 1 && RANKS.indexOf(ch) >= 0) seen[ch] = true;
    });
    return RANKS.split('').filter(function (ch) { return seen[ch]; });
  }

  function pureAlpha(size) {
    return size > 0 ? Math.round(size / (100 + size) * 100) : null;
  }

  /**
   * ハンド名の正規化。'A4s'／'AKo'／'55'（大文字小文字は問わない）と 'Ad4d' 形式を受け、
   * 'A4s'／'AKo'／'55' にそろえて返す。不正（異ランクの接尾辞なし・ペアの接尾辞あり・同一カード2枚）は null。
   */
  function normHand(s) {
    if (typeof s !== 'string') return null;
    var t = s.replace(/\s+/g, '');
    var m = /^([AKQJT2-9])([AKQJT2-9])([so])?$/i.exec(t);
    var a, b, sfx;
    if (m) {
      a = m[1].toUpperCase();
      b = m[2].toUpperCase();
      sfx = m[3] ? m[3].toLowerCase() : '';
      if (a === b) return sfx ? null : a + b;
      if (!sfx) return null;
    } else {
      m = /^([AKQJT2-9])([shdc])([AKQJT2-9])([shdc])$/i.exec(t);
      if (!m) return null;
      a = m[1].toUpperCase();
      b = m[3].toUpperCase();
      var s1 = m[2].toLowerCase();
      var s2 = m[4].toLowerCase();
      if (a === b && s1 === s2) return null;
      if (a === b) return a + b;
      sfx = s1 === s2 ? 's' : 'o';
    }
    var hi = RANKS.indexOf(a) <= RANKS.indexOf(b) ? a : b;
    var lo = hi === a ? b : a;
    return hi + lo + sfx;
  }

  /** sheet.f4.enough（'yes'|'no'|boolean|null）→ true|false|null */
  function normEnough(v) {
    if (v === 'yes' || v === true) return true;
    if (v === 'no' || v === false) return false;
    return null;
  }

  // ---------------------------------------------------------------- 依存の解決

  function lazyDep(key, modPath) {
    if (PD[key]) return PD[key];
    if (typeof require === 'function') {
      try {
        var m = require(modPath);
        return PD[key] || m || null;
      } catch (e) { return null; }
    }
    return null;
  }

  function resolveDeps(deps) {
    var d = deps || {};
    var gaps = d.baseline ? null : lazyDep('gaps', './gaps');
    return {
      cards: d.cards || lazyDep('cards', './cards'),
      range: d.range || lazyDep('range', './range'),
      baseline: d.baseline || (gaps && gaps.BASELINE_FOLD) || DEFAULT_BASELINE
    };
  }

  /** そのハンド名のコールレンジ上の重み（セル由来。ボードによるブロックは含まない） */
  function cellWeight(api, range, hand) {
    var st = (range && range.cells && hasOwn(range.cells, hand)) ? range.cells[hand] : undefined;
    if (typeof api.callWeight === 'function') return Number(api.callWeight(st)) || 0;
    return st === 'call' ? 1 : (st === 'mix' ? 0.5 : 0);
  }

  /**
   * weakestFirst に sub が無いときの保険：コンボ展開から trash の内訳を求める。
   * 重み最大の内訳（同率は弱い側：pureAir < backdoor < strong）。求められなければ null。
   */
  function makeSubResolver(ctx) {
    var byHand = null;
    return function (hand) {
      if (!ctx.cards || typeof ctx.cards.handFeatures !== 'function') return null;
      if (typeof ctx.api.combos !== 'function') return null;
      if (!byHand) {
        byHand = {};
        var all = ctx.api.combos(ctx.range, ctx.board) || [];
        all.forEach(function (c) {
          if (!c || typeof c.hand !== 'string') return;
          if (!byHand[c.hand]) byHand[c.hand] = [];
          byHand[c.hand].push(c);
        });
      }
      var cs = hasOwn(byHand, hand) ? byHand[hand] : null;
      if (!cs || !cs.length) return null;
      var w = { strong: 0, backdoor: 0, pureAir: 0 };
      var counted = 0;
      cs.forEach(function (c) {
        var f;
        try { f = ctx.cards.handFeatures(c.cards, ctx.board); } catch (e) { return; }
        var sub = (f.fd || f.oesd || f.gut) ? 'strong' : ((f.bdfd || f.bdsd) ? 'backdoor' : 'pureAir');
        w[sub] += typeof c.w === 'number' ? c.w : 1;
        counted++;
      });
      if (!counted) return null;
      var best = 'pureAir';
      if (w.backdoor > w[best]) best = 'backdoor';
      if (w.strong > w[best]) best = 'strong';
      return best;
    };
  }

  // ---------------------------------------------------------------- ④ fold 組の検証

  function whyNotTrash(cat) {
    if (cat === 'pairPlus') return 'ペア以上（trash ではない）';
    if (cat === 'hi') return 'A／K ハイ（trash ではない）';
    return 'このボードで trash ではない';
  }

  function whyProtected(sub) {
    return sub === 'strong' ? 'ドロー付き（FD／OESD／ガット）で守る側' : 'バックドア付き（BDFD／BDSD）で守る側';
  }

  /**
   * foldList を stats.weakestFirst で検証する。
   * invalid：(a) コールレンジに無い／ブロック (b) trash でない (c) ドロー付き (d) 名前が不正。
   * orderOk：見つかった手の score が並びどおり非減少（同点可）なら true。
   */
  function checkFoldList(list, ctx) {
    var entry = {};
    (ctx.stats.weakestFirst || []).forEach(function (e) {
      if (e && typeof e.hand === 'string') entry[e.hand] = e;
    });
    var resolveSub = makeSubResolver(ctx);
    var invalid = [];
    var seenInvalid = {};
    var scores = [];

    function bad(hand, why) {
      if (seenInvalid[hand]) return;
      seenInvalid[hand] = true;
      invalid.push({ hand: hand, why: why });
    }

    list.forEach(function (raw) {
      var name = normHand(raw);
      if (name === null) {
        bad(String(raw), 'ハンド名が不正（A4s／AKo／55 形式）');
        return;
      }
      var e = hasOwn(entry, name) ? entry[name] : null;
      if (!e || !(Number(e.w) > 0)) {
        bad(name, cellWeight(ctx.api, ctx.range, name) > 0
          ? 'このボードでは全コンボがブロックされている'
          : 'コールレンジに居ない');
        return;
      }
      if (typeof e.score === 'number') scores.push(e.score);
      if (e.cat !== 'trash') {
        bad(name, whyNotTrash(e.cat));
        return;
      }
      var sub = e.sub === undefined ? resolveSub(name) : e.sub;
      if (sub === 'strong' || sub === 'backdoor') bad(name, whyProtected(sub));
    });

    var orderOk = true;
    for (var i = 1; i < scores.length; i++) {
      if (scores[i] < scores[i - 1] - EPS) { orderOk = false; break; }
    }
    return { invalid: invalid, orderOk: orderOk };
  }

  // ---------------------------------------------------------------- 各欄

  function judgeF1(v, required, size) {
    var got = num(v && v.foldPct);
    var diff = diffOf(got, required);
    return { ok: within(diff, TOL.f1), expect: required, got: got, diff: diff, tol: TOL.f1, pureAlpha: pureAlpha(size) };
  }

  function judgeF2(v, stats) {
    var exp = { trash: stats.pct.trash, hi: stats.pct.hi, pairPlus: stats.pct.pairPlus };
    var got = { trash: num(v && v.trash), hi: num(v && v.hi), pairPlus: num(v && v.pairPlus) };
    var diff = { trash: diffOf(got.trash, exp.trash), hi: diffOf(got.hi, exp.hi), pairPlus: diffOf(got.pairPlus, exp.pairPlus) };
    var ok = within(diff.trash, TOL.f2) && within(diff.hi, TOL.f2) && within(diff.pairPlus, TOL.f2);
    return { ok: ok, expect: exp, got: got, diff: diff, tol: TOL.f2 };
  }

  function judgeF3(v, stats) {
    var shiftExpect = r1((stats.draws.strong || 0) + (stats.draws.backdoor || 0));
    var ranksExpect = normRanks(stats.drawRanks);
    var gotShift = num(v && v.shiftPct);
    var gotRanks = normRanks(v && v.drawRanks);
    var noDraw = !!(v && v.noDraw === true);
    var diff = diffOf(gotShift, shiftExpect);
    var missing = ranksExpect.filter(function (ch) { return gotRanks.indexOf(ch) < 0; });
    var extra = gotRanks.filter(function (ch) { return ranksExpect.indexOf(ch) < 0; });
    // 期待 ranks が空のときは「ドロー無し」の宣言が要る（宣言があれば ranks は ok）
    var ranksOk = missing.length === 0 && extra.length === 0 && (ranksExpect.length > 0 || noDraw);
    var shiftOk = within(diff, TOL.f3);
    return {
      ok: shiftOk && ranksOk,
      expect: { shiftPct: shiftExpect, ranks: ranksExpect },
      got: { shiftPct: gotShift, ranks: gotRanks, noDraw: noDraw },
      diff: diff,
      missingRanks: missing,
      extraRanks: extra,
      shiftOk: shiftOk,
      ranksOk: ranksOk,
      tol: TOL.f3
    };
  }

  function judgeF4(v, stats, required, ctx) {
    var pureAirExpect = stats.draws.pureAir;
    var enoughExpect = pureAirExpect >= required;
    var gotAir = num(v && v.pureAirPct);
    var gotEnough = normEnough(v && v.enough);
    var gotList = (v && Array.isArray(v.foldList)) ? v.foldList.slice() : [];
    var diff = diffOf(gotAir, pureAirExpect);
    var airOk = within(diff, TOL.f4);
    var enoughOk = gotEnough !== null && gotEnough === enoughExpect;
    var chk = checkFoldList(gotList, ctx);
    return {
      ok: airOk && enoughOk && gotList.length > 0 && chk.invalid.length === 0,
      expect: { pureAir: pureAirExpect, enough: enoughExpect },
      got: { pureAirPct: gotAir, enough: gotEnough, foldList: gotList },
      diff: diff,
      airOk: airOk,
      enoughOk: enoughOk,
      tol: TOL.f4,
      invalid: chk.invalid,
      orderOk: chk.orderOk
    };
  }

  function judgeF5(v, hero, required) {
    var gotPos = (v && (v.position === 'in' || v.position === 'edge' || v.position === 'above')) ? v.position : null;
    var gotAct = (v && (v.action === 'call' || v.action === 'fold')) ? v.action : null;
    var predicted = { position: null, action: null, percentile: null, cat: null };
    var p = hero ? num(hero.percentile) : null;
    if (p !== null) {
      p = r1(p);
      var d = r1(p - required);
      predicted.percentile = p;
      predicted.cat = hero.cat === undefined ? null : hero.cat;
      predicted.position = d < -EDGE_BAND - EPS ? 'in' : (d <= EDGE_BAND + EPS ? 'edge' : 'above');
      predicted.action = p < required - EPS ? 'fold' : 'call';
    }
    return {
      ok: predicted.action !== null && gotAct === predicted.action,
      predicted: predicted,
      got: { position: gotPos, action: gotAct },
      positionOk: predicted.position !== null && gotPos === predicted.position,
      note: F5_NOTE
    };
  }

  // ---------------------------------------------------------------- 本体

  /**
   * judge(sheet, spot, range, deps) → Verdict（SPEC-judge §2.2）
   *   deps = { cards, range, baseline }。省略時は PD.cards／PD.range／PD.gaps.BASELINE_FOLD（無ければ {33:30,50:40}）
   */
  function judge(sheet, spot, range, deps) {
    var d = resolveDeps(deps);
    var api = d.range;
    if (!api || typeof api.isFilled !== 'function' || typeof api.stats !== 'function') {
      return { available: false, reason: 'レンジ機能が読み込めない' };
    }
    if (!range || !api.isFilled(range)) return { available: false, reason: 'レンジ表が未入力' };

    var sp = spot || {};
    var size = Number(sp.size);
    var required = hasOwn(d.baseline, size) ? Number(d.baseline[size]) : NaN;
    if (!isFinite(required)) return { available: false, reason: 'このサイズの暗記値が無い' };

    var stats = api.stats(range, sp.board, sp.hero);
    if (!stats) return { available: false, reason: 'ボードが不正' };

    var s = sheet || {};
    var ctx = { api: api, cards: d.cards, range: range, board: sp.board, stats: stats };

    var f1 = judgeF1(s.f1, required, size);
    var f2 = judgeF2(s.f2, stats);
    var f3 = judgeF3(s.f3, stats);
    var f4 = judgeF4(s.f4, stats, required, ctx);
    var f5 = judgeF5(s.f5, stats.hero || null, required);

    var okCount = (f1.ok ? 1 : 0) + (f2.ok ? 1 : 0) + (f3.ok ? 1 : 0) + (f4.ok ? 1 : 0) + (f5.ok ? 1 : 0);

    var sizeFold = 0;
    if (f1.diff !== null) {
      var ad = Math.abs(f1.diff);
      sizeFold = ad <= TOL.f1 + EPS ? 2 : (ad <= SIZE_FOLD_PARTIAL + EPS ? 1 : 0);
    }
    var drawProtect;
    if (f3.got.noDraw && f3.expect.ranks.length === 0 && f3.got.ranks.length === 0) drawProtect = 4;
    else if (f3.shiftOk && f3.ranksOk) drawProtect = 4;
    else if (f3.shiftOk || f3.ranksOk) drawProtect = 2;
    else drawProtect = 0;

    return {
      available: true,
      required: required,
      f1: f1, f2: f2, f3: f3, f4: f4, f5: f5,
      stats: stats,
      summary: {
        okCount: okCount,
        total: 5,
        score: { size_fold: sizeFold, draw_protect: drawProtect, action: f5.ok ? 1 : 0 }
      }
    };
  }

  return {
    TOL: TOL,
    F5_NOTE: F5_NOTE,
    normHand: normHand,
    judge: judge
  };
})();

if (typeof module !== 'undefined') module.exports = PD.localjudge;
