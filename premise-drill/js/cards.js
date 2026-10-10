// premise-drill: PD.cards（T1）。純粋・依存なし。SPEC ⑫ の契約：
//   RANKS / SUITS / parseBoard / parseHand / fmt / handName / classifyBoard / drawRanks / handFeatures / randomBoard
// ストレート系の判定（hmsd・connected・gut/oesd/bdsd）はビットマスクとホールカード全列挙で厳密に行う。
// A は 14 と 1 の両方として扱い、A-5 ホイールに対応する。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.cards = (function () {
  'use strict';

  var RANKS = 'AKQJT98765432';
  var SUITS = 'shdc';

  /** @typedef {{ r: number, s: 's'|'h'|'d'|'c' }} Card  r は 14(A)..2 */

  // ---------------------------------------------------------------- 基本変換

  /** ランク文字（'A'..'2'、小文字可）→ 数値 14..2。不正なら 0 */
  function rankValue(ch) {
    var i = RANKS.indexOf(String(ch).toUpperCase());
    return i < 0 ? 0 : 14 - i;
  }

  /** 数値 14..2 → ランク文字 'A'..'2'。範囲外は '' */
  function rankChar(r) {
    return (r >= 2 && r <= 14) ? RANKS.charAt(14 - r) : '';
  }

  /** 空白除去・'10'→'T' */
  function normalize(str) {
    return String(str === null || str === undefined ? '' : str).replace(/\s+/g, '').replace(/10/g, 'T');
  }

  /**
   * 文字列を Card[] に。n を渡すと枚数を検査（省略時は任意枚）。重複・不正文字は ok:false。
   * 並びは入力順のまま（整列はしない）。
   */
  function parseCards(str, n) {
    var s = normalize(str);
    if (s.length % 2 !== 0 || (n !== undefined && s.length !== n * 2)) {
      return { ok: false, cards: [], err: n !== undefined ? 'カードは' + n + '枚で入力（例 ' + (n === 3 ? 'Ks7d5c' : 'Ad4d') + '）' : 'カード文字列の長さが不正' };
    }
    var cards = [];
    var seen = {};
    for (var i = 0; i < s.length; i += 2) {
      var rc = s.charAt(i).toUpperCase();
      var sc = s.charAt(i + 1).toLowerCase();
      var r = rankValue(rc);
      if (!r || SUITS.indexOf(sc) < 0) {
        return { ok: false, cards: [], err: '不正なカード: ' + s.substr(i, 2) };
      }
      var key = rc + sc;
      if (seen[key]) {
        return { ok: false, cards: [], err: '同じカードが重複: ' + key };
      }
      seen[key] = true;
      cards.push({ r: r, s: sc });
    }
    return { ok: true, cards: cards };
  }

  /** ボード3枚。重複・不正・枚数違いは ok:false */
  function parseBoard(str) {
    return parseCards(str, 3);
  }

  /** ハンド2枚。suited を付ける。重複・不正・枚数違いは ok:false */
  function parseHand(str) {
    var p = parseCards(str, 2);
    if (!p.ok) return { ok: false, cards: [], suited: false, err: p.err };
    return { ok: true, cards: p.cards, suited: p.cards[0].s === p.cards[1].s };
  }

  /** Card[] → 'Ks7d5c'（与えられた順のまま） */
  function fmt(cards) {
    var out = '';
    for (var i = 0; i < cards.length; i++) out += rankChar(cards[i].r) + cards[i].s;
    return out;
  }

  /** ランク降順（同ランクはスート順 s,h,d,c）に整列した新しい配列 */
  function sortDesc(cards) {
    return cards.slice().sort(function (a, b) {
      return (b.r - a.r) || (SUITS.indexOf(a.s) - SUITS.indexOf(b.s));
    });
  }

  /** 2枚 → 'A4s' / 'AKo' / '55' */
  function handName(cards) {
    var c = sortDesc(cards);
    var a = rankChar(c[0].r);
    var b = rankChar(c[1].r);
    if (c[0].r === c[1].r) return a + b;
    return a + b + (c[0].s === c[1].s ? 's' : 'o');
  }

  // ---------------------------------------------------------------- 入力の受け取り

  function isCard(c) {
    return !!c && typeof c.r === 'number' && c.r >= 2 && c.r <= 14 && SUITS.indexOf(c.s) >= 0;
  }

  /** 文字列でも Card[] でも Card[] に揃える。n は期待枚数（省略可）。不正なら throw */
  function toCards(x, n, what) {
    var cards;
    if (Array.isArray(x)) {
      for (var i = 0; i < x.length; i++) {
        if (!isCard(x[i])) throw new Error('PD.cards: ' + what + ' に不正な Card があります');
      }
      cards = x;
    } else {
      var p = parseCards(x, n);
      if (!p.ok) throw new Error('PD.cards: ' + what + ' が不正です（' + p.err + '）');
      cards = p.cards;
    }
    if (n !== undefined && cards.length !== n) throw new Error('PD.cards: ' + what + ' は' + n + '枚で渡してください');
    return cards;
  }

  function boardCards(board) { return toCards(board, 3, 'board'); }
  function handCards(hand) { return toCards(hand, 2, 'hand'); }

  // ---------------------------------------------------------------- ランク集合とストレート

  /** 重複を除いたランク数値の配列 */
  function distinctRanks(cards) {
    var seen = {};
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      if (!seen[cards[i].r]) { seen[cards[i].r] = true; out.push(cards[i].r); }
    }
    return out;
  }

  /** ランク数値の配列 → ビットマスク。A(14) はビット 1 にも立てる（ホイール対応） */
  function maskOf(ranks) {
    var m = 0;
    for (var i = 0; i < ranks.length; i++) {
      m |= (1 << ranks[i]);
      if (ranks[i] === 14) m |= (1 << 1);
    }
    return m;
  }

  function withRank(mask, r) {
    return mask | (1 << r) | (r === 14 ? (1 << 1) : 0);
  }

  /** 5連続ランクを含むか（ビット 1..5 のホイール〜 10..14 のブロードウェイ） */
  function hasStraight(mask) {
    for (var lo = 1; lo <= 10; lo++) {
      var run = 0x1F << lo;
      if ((mask & run) === run) return true;
    }
    return false;
  }

  /** mask に1ランク足すとストレートになるランク（数値、降順）。既に完成していれば [] */
  function straightOuts(mask) {
    var outs = [];
    if (hasStraight(mask)) return outs;
    for (var r = 14; r >= 2; r--) {
      if (mask & (1 << r)) continue;
      if (hasStraight(withRank(mask, r))) outs.push(r);
    }
    return outs;
  }

  /** 3つの相異なるランクが5ランク幅の窓に収まるか（A は 14 でも 1 でもよい） */
  function fitsFiveWindow(ranks) {
    var m = maskOf(ranks);
    for (var lo = 1; lo <= 10; lo++) {
      var n = 0;
      for (var b = lo; b <= lo + 4; b++) if (m & (1 << b)) n++;
      if (n >= 3) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- デッキとホールカード列挙

  function fullDeck() {
    var deck = [];
    for (var r = 14; r >= 2; r--) {
      for (var s = 0; s < SUITS.length; s++) deck.push({ r: r, s: SUITS.charAt(s) });
    }
    return deck;
  }

  function sameCard(a, b) { return a.r === b.r && a.s === b.s; }

  function without(deck, exclude) {
    if (!exclude || !exclude.length) return deck;
    return deck.filter(function (c) {
      for (var i = 0; i < exclude.length; i++) if (sameCard(c, exclude[i])) return false;
      return true;
    });
  }

  /** ボードを除いた残り札から取れるホールカード2枚の全組合せ（C(49,2)=1176） */
  function holeCombos(board) {
    var deck = without(fullDeck(), board);
    var combos = [];
    for (var i = 0; i < deck.length; i++) {
      for (var j = i + 1; j < deck.length; j++) combos.push([deck[i], deck[j]]);
    }
    return combos;
  }

  // ---------------------------------------------------------------- ボード分類

  /**
   * hmsd：H と M を含む4枚（H・M＋ホールカード2枚）がストレートドロー（1枚足すと完成）になる
   * ホールカード2枚が存在するか。ガットも含む。ホールカードは残り札から全列挙。
   */
  function computeHmsd(combos, H, M) {
    if (H === M) return false;
    for (var i = 0; i < combos.length; i++) {
      var ranks = distinctRanks([{ r: H }, { r: M }, combos[i][0], combos[i][1]]);
      if (ranks.length !== 4) continue;
      if (straightOuts(maskOf(ranks)).length > 0) return true;
    }
    return false;
  }

  /** connected：何らかのホールカード2枚でフロップ時点にストレートが完成するか（全列挙） */
  function computeConnected(board, combos) {
    for (var i = 0; i < combos.length; i++) {
      var ranks = distinctRanks(board.concat(combos[i]));
      if (ranks.length === 5 && hasStraight(maskOf(ranks))) return true;
    }
    return false;
  }

  function suitTexture(board) {
    var count = {};
    var max = 0;
    for (var i = 0; i < board.length; i++) {
      count[board[i].s] = (count[board[i].s] || 0) + 1;
      if (count[board[i].s] > max) max = count[board[i].s];
    }
    return max === 3 ? 'mono' : (max === 2 ? 'twotone' : 'rainbow');
  }

  /**
   * classifyBoard('Ks7d5c') -> { cls, suit, hmsd, connected, H, M, L }
   *   cls: 3枚同ランク→trips／3枚同スート→mono／2枚同ランク→paired／
   *        H≥J→hmsd なら bw_sd・そうでなければ dry_high／H∈{T,9}→mid／H≤8→low
   *   suit: rainbow|twotone|mono。H/M/L はランク降順の数値。
   */
  function classifyBoard(board) {
    var b = sortDesc(boardCards(board));
    var H = b[0].r;
    var M = b[1].r;
    var L = b[2].r;
    var suit = suitTexture(b);
    var distinct = distinctRanks(b).length;
    var combos = holeCombos(b);
    var hmsd = computeHmsd(combos, H, M);
    var connected = computeConnected(b, combos);
    var cls;
    if (distinct === 1) cls = 'trips';
    else if (suit === 'mono') cls = 'mono';
    else if (distinct === 2) cls = 'paired';
    else if (H >= 11) cls = hmsd ? 'bw_sd' : 'dry_high';
    else if (H >= 9) cls = 'mid';
    else cls = 'low';
    return { cls: cls, suit: suit, hmsd: hmsd, connected: connected, H: H, M: M, L: L };
  }

  /**
   * drawRanks('QsJd9c') -> { gut: string[], oesd: string[] }
   * ボード3枚に1ランク足した4枚が、さらに1枚で完成するランク数：2以上→oesd、1→gut。
   * 戻りは 'A'..'2' の順。ペア／トリップスのボードは4ランクにならないので両方空。
   */
  function drawRanks(board) {
    var ranks = distinctRanks(boardCards(board));
    var out = { gut: [], oesd: [] };
    if (ranks.length < 3) return out;
    var base = maskOf(ranks);
    for (var r = 14; r >= 2; r--) {
      if (base & (1 << r)) continue;
      var outs = straightOuts(withRank(base, r));
      if (outs.length >= 2) out.oesd.push(rankChar(r));
      else if (outs.length === 1) out.gut.push(rankChar(r));
    }
    return out;
  }

  /**
   * handFeatures('Ad4d','Ks7d5c') -> { pair, overpair, pocket, fd, bdfd, oesd, gut, bdsd, hiCard }
   *   pair：hero のどちらかがボードのランクと一致（セット含む）
   *   overpair：ポケットがボードの H より上
   *   fd：hero スーテッド＋ボード同スートちょうど2枚。bdfd：同じくちょうど1枚（3枚は完成なので両方 false）
   *   oesd：5枚に1枚足してストレートになるランクが2つ以上。gut：1つ。既に完成していれば両方 false
   *   bdsd：gut/oesd 無し（完成も無し）で、hero 2枚＋ボード1枚の相異なる3ランクが5ランク幅に収まる（A-5 対応）
   *   hiCard：hero の高い方のランクが T 以上ならその文字、それ以外は null
   */
  function handFeatures(hand, board) {
    var h = handCards(hand);
    var b = boardCards(board);
    var h1 = h[0];
    var h2 = h[1];
    var pocket = h1.r === h2.r;
    var suited = h1.s === h2.s;

    var H = 0;
    var i;
    for (i = 0; i < b.length; i++) if (b[i].r > H) H = b[i].r;

    var pair = false;
    for (i = 0; i < b.length; i++) if (b[i].r === h1.r || b[i].r === h2.r) pair = true;
    var overpair = pocket && h1.r > H;

    var fd = false;
    var bdfd = false;
    if (suited) {
      var n = 0;
      for (i = 0; i < b.length; i++) if (b[i].s === h1.s) n++;
      fd = n === 2;
      bdfd = n === 1;
    }

    var mask = maskOf(distinctRanks(h.concat(b)));
    var made = hasStraight(mask);
    var outs = made ? [] : straightOuts(mask);
    var oesd = outs.length >= 2;
    var gut = outs.length === 1;

    var bdsd = false;
    if (!made && !oesd && !gut && !pocket) {
      for (i = 0; i < b.length; i++) {
        var r = b[i].r;
        if (r === h1.r || r === h2.r) continue;
        if (fitsFiveWindow([h1.r, h2.r, r])) { bdsd = true; break; }
      }
    }

    var hi = Math.max(h1.r, h2.r);
    var hiCard = hi >= 10 ? rankChar(hi) : null;

    return {
      pair: pair, overpair: overpair, pocket: pocket,
      fd: fd, bdfd: bdfd, oesd: oesd, gut: gut, bdsd: bdsd,
      hiCard: hiCard
    };
  }

  /**
   * randomBoard(r, exclude?) -> Card[3]（ランク降順）
   * r は [0,1) を返す関数。exclude（Card[] または 'Ad4d' 形式）の札は引かない。
   */
  function randomBoard(r, exclude) {
    var f = typeof r === 'function' ? r : Math.random;
    var ex = exclude ? toCards(exclude, undefined, 'exclude') : [];
    var deck = without(fullDeck(), ex);
    if (deck.length < 3) throw new Error('PD.cards: randomBoard の残り札が3枚未満です');
    var out = [];
    for (var k = 0; k < 3; k++) {
      var i = Math.floor(f() * deck.length);
      if (i < 0) i = 0;
      if (i >= deck.length) i = deck.length - 1;
      out.push(deck[i]);
      deck.splice(i, 1);
    }
    return sortDesc(out);
  }

  return {
    RANKS: RANKS,
    SUITS: SUITS,
    rankValue: rankValue,
    rankChar: rankChar,
    parseCards: parseCards,
    parseBoard: parseBoard,
    parseHand: parseHand,
    fmt: fmt,
    sortDesc: sortDesc,
    handName: handName,
    classifyBoard: classifyBoard,
    drawRanks: drawRanks,
    handFeatures: handFeatures,
    randomBoard: randomBoard
  };
})();

if (typeof module !== 'undefined') module.exports = PD.cards;
