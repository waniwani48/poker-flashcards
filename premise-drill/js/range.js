// premise-drill: PD.range（Phase D）。BB の守りレンジ（vs BTN 2.5bb オープン）13×13 の保持・展開・ボード別の統計。
// 契約は SPEC-judge.md §1「PD.range」。PD.cards は必須依存（node では require）、PD.rangeData は任意（同梱の初期レンジ）。
// 序列 score は「予測専用のヒューリスティック」であって GTO の真値ではない。
// ソルバー数値・記事名・著者名・出典サイトの URL はコード／コメント／UI 文字列に書かない。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

if (typeof require === 'function' && !PD.cards) require('./cards');
if (typeof require === 'function' && !PD.rangeData) require('./range-data');

PD.range = (function (cardsDep) {
  'use strict';

  // ---------------------------------------------------------------- 定数

  var KEY = 'pd_range_v1';
  var DATA_KEY = 'bb_vs_btn_25';
  var RANK_CHARS = 'AKQJT98765432';
  var SUIT_CHARS = 'shdc';
  var STATE_ORDER = ['fold', 'call', '3bet', 'mix'];
  var TOTAL_COMBOS = 1326;
  var FILLED_MIN = 20;
  var EPS = 1e-9;
  var SUITED_CONNECTORS = ['JTs', 'T9s', '98s', '87s', '76s', '65s', '54s', '43s', '32s'];

  /** 13×13 の手の名前。行 i＝1枚目のランク（A..2）、列 j＝2枚目。i<j は suited、i>j は offsuit、i==j はペア */
  var HAND_GRID = [];
  /** 169 名の平坦配列（行優先） */
  var HANDS = [];
  /** 手の名前 → { name, hi, lo, kind: 'pair'|'s'|'o', n: コンボ数, idx, expanded } */
  var HAND_INFO = {};

  (function buildGrid() {
    for (var i = 0; i < 13; i++) {
      var row = [];
      for (var j = 0; j < 13; j++) {
        var name;
        var kind;
        if (i === j) { name = RANK_CHARS.charAt(i) + RANK_CHARS.charAt(j); kind = 'pair'; }
        else if (i < j) { name = RANK_CHARS.charAt(i) + RANK_CHARS.charAt(j) + 's'; kind = 's'; }
        else { name = RANK_CHARS.charAt(j) + RANK_CHARS.charAt(i) + 'o'; kind = 'o'; }
        row.push(name);
        HANDS.push(name);
        HAND_INFO[name] = {
          name: name,
          hi: 14 - Math.min(i, j),
          lo: 14 - Math.max(i, j),
          kind: kind,
          n: kind === 'pair' ? 6 : (kind === 's' ? 4 : 12),
          idx: HANDS.length - 1,
          expanded: null
        };
      }
      HAND_GRID.push(row);
    }
  })();

  // ---------------------------------------------------------------- 小道具

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function cardsLib() { return cardsDep || PD.cards; }

  /** 小数1桁に丸める（pct／draws／percentile／summary の % にだけ使う。score は丸めない） */
  function round1(x) { return Math.round(x * 10) / 10; }

  function isState(s) { return typeof s === 'string' && STATE_ORDER.indexOf(s) >= 0; }

  /** コールレンジとしての重み：call→1、mix→0.5、3bet／fold／未定義→0 */
  function callWeight(state) {
    return state === 'call' ? 1 : (state === 'mix' ? 0.5 : 0);
  }

  /** タップ用：fold→call→3bet→mix→fold。不明な state は fold 扱い */
  function cycle(state) {
    var i = STATE_ORDER.indexOf(state);
    if (i < 0) i = 0;
    return STATE_ORDER[(i + 1) % STATE_ORDER.length];
  }

  // ---------------------------------------------------------------- Range の形

  function empty() {
    return { v: 1, cells: {}, updatedAt: null, source: '' };
  }

  /**
   * 形の検査と複製。strict なら不正セルが1つでもあれば失敗、そうでなければ不正セルを捨てる。
   * 'fold' は既定値なので cells から落とす。返す range は常に新しいオブジェクト。
   */
  function sanitize(obj, strict) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, msg: '形式が不正です' };
    if (obj.v !== 1) return { ok: false, msg: '版が一致しません' };
    var cells = obj.cells;
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return { ok: false, msg: 'cells が不正です' };
    var out = {};
    var bad = [];
    for (var h in cells) {
      if (!hasOwn(cells, h)) continue;
      var st = cells[h];
      if (!hasOwn(HAND_INFO, h) || !isState(st)) { bad.push(h); continue; }
      if (st !== 'fold') out[h] = st;
    }
    if (strict && bad.length) return { ok: false, msg: '不正なセルがあります：' + bad.slice(0, 5).join(', ') };
    return {
      ok: true,
      range: {
        v: 1,
        cells: out,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : null,
        source: typeof obj.source === 'string' ? obj.source : ''
      },
      dropped: bad
    };
  }

  /** 不正な入力は empty 扱い。計算系 API の入口で使う */
  function normalizeRange(range) {
    var s = sanitize(range, false);
    return s.ok ? s.range : empty();
  }

  /** hand のセル状態。無ければ 'fold' */
  function cellState(range, hand) {
    if (!range || !range.cells || typeof hand !== 'string' || !hasOwn(range.cells, hand)) return 'fold';
    return isState(range.cells[hand]) ? range.cells[hand] : 'fold';
  }

  /** call か mix のセルが 20 以上 */
  function isFilled(range) {
    var rg = normalizeRange(range);
    var n = 0;
    for (var i = 0; i < HANDS.length; i++) {
      var st = rg.cells[HANDS[i]];
      if (st === 'call' || st === 'mix') n++;
    }
    return n >= FILLED_MIN;
  }

  /** 純粋。不正な hand／state は無視して同じ内容の新しい Range を返す。now（文字列）を渡すと updatedAt を更新 */
  function setCell(range, hand, state, now) {
    var next = normalizeRange(range);
    if (typeof hand !== 'string' || !hasOwn(HAND_INFO, hand) || !isState(state)) return next;
    if (state === 'fold') delete next.cells[hand];
    else next.cells[hand] = state;
    if (typeof now === 'string') next.updatedAt = now;
    return next;
  }

  // ---------------------------------------------------------------- 保存（localStorage は root.localStorage を try で）

  function lsGet(key) {
    try {
      var s = root.localStorage;
      if (!s || typeof s.getItem !== 'function') return null;
      var v = s.getItem(key);
      return (v === null || v === undefined) ? null : v;
    } catch (e) {
      return null;
    }
  }

  /** localStorage → 同梱 PD.rangeData.bb_vs_btn_25 → empty。保存済みが壊れていれば empty */
  function load() {
    var raw = lsGet(KEY);
    if (raw !== null) {
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return empty(); }
      var s = sanitize(parsed, false);
      return s.ok ? s.range : empty();
    }
    var data = PD.rangeData;
    var bundled = (data && typeof data === 'object') ? data[DATA_KEY] : null;
    if (bundled && typeof bundled === 'object' && bundled.cells && typeof bundled.cells === 'object') {
      var b = sanitize(bundled, false);
      if (b.ok) return b.range;
    }
    return empty();
  }

  /** 保存。失敗は false。now（文字列）を渡すと updatedAt を打ってから保存（Date は使わない） */
  function save(range, now) {
    var s = sanitize(range, false);
    if (!s.ok) return false;
    var r = s.range;
    if (typeof now === 'string') r.updatedAt = now;
    try {
      var ls = root.localStorage;
      if (!ls || typeof ls.setItem !== 'function') return false;
      ls.setItem(KEY, JSON.stringify(r));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 保存済みを消す（同梱の初期値には戻る） */
  function clear() {
    try {
      var ls = root.localStorage;
      if (!ls || typeof ls.removeItem !== 'function') return false;
      ls.removeItem(KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportState() {
    return load();
  }

  /** 形を検証（不正セルも拒否）して保存する。{ ok:false, msg } か { ok:true, range, saved } */
  function importState(obj) {
    var s = sanitize(obj, true);
    if (!s.ok) return { ok: false, msg: s.msg };
    return { ok: true, range: s.range, saved: save(s.range) };
  }

  // ---------------------------------------------------------------- コンボ展開

  /** 手の名前 → 具体カードの組（pair 6／suited 4／offsuit 12）。結果は共有（変更しない） */
  function expandHand(name) {
    var info = HAND_INFO[name];
    if (info.expanded) return info.expanded;
    var out = [];
    var a;
    var b;
    if (info.kind === 'pair') {
      for (a = 0; a < 4; a++) {
        for (b = a + 1; b < 4; b++) {
          out.push([{ r: info.hi, s: SUIT_CHARS.charAt(a) }, { r: info.lo, s: SUIT_CHARS.charAt(b) }]);
        }
      }
    } else if (info.kind === 's') {
      for (a = 0; a < 4; a++) {
        out.push([{ r: info.hi, s: SUIT_CHARS.charAt(a) }, { r: info.lo, s: SUIT_CHARS.charAt(a) }]);
      }
    } else {
      for (a = 0; a < 4; a++) {
        for (b = 0; b < 4; b++) {
          if (a !== b) out.push([{ r: info.hi, s: SUIT_CHARS.charAt(a) }, { r: info.lo, s: SUIT_CHARS.charAt(b) }]);
        }
      }
    }
    info.expanded = out;
    return out;
  }

  function isCardObj(c) {
    return !!c && typeof c.r === 'number' && c.r >= 2 && c.r <= 14 && typeof c.s === 'string' && SUIT_CHARS.indexOf(c.s) >= 0 && c.s.length === 1;
  }

  /** 文字列（'Ks7d5c'）か Card[] を Card[] に。空は []。不正は null */
  function toCardList(x) {
    if (x === null || x === undefined || x === '') return [];
    if (Array.isArray(x)) {
      for (var i = 0; i < x.length; i++) if (!isCardObj(x[i])) return null;
      return x;
    }
    if (typeof x !== 'string') return null;
    var p = cardsLib().parseCards(x);
    return p.ok ? p.cards : null;
  }

  function hasDup(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var k = list[i].r + list[i].s;
      if (seen[k]) return true;
      seen[k] = true;
    }
    return false;
  }

  function blockedMap(list) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[list[i].r + list[i].s] = true;
    return m;
  }

  /** コールレンジの全コンボを具体化。board と exclude に含まれるカードを使うコンボは除外。w = callWeight */
  function combos(range, board, exclude) {
    var b = toCardList(board);
    var ex = toCardList(exclude);
    if (b === null || ex === null) return [];
    var rg = normalizeRange(range);
    var blocked = blockedMap(b.concat(ex));
    var fmt = cardsLib().fmt;
    var out = [];
    for (var i = 0; i < HANDS.length; i++) {
      var hand = HANDS[i];
      var w = callWeight(rg.cells[hand]);
      if (w <= 0) continue;
      var list = expandHand(hand);
      for (var k = 0; k < list.length; k++) {
        var c = list[k];
        if (blocked[c[0].r + c[0].s] || blocked[c[1].r + c[1].s]) continue;
        out.push({ hand: hand, cards: fmt(c), w: w });
      }
    }
    return out;
  }

  /** コンボ数（suited 4／offsuit 12／pair 6、mix は call と 3bet に 0.5 ずつ）と 1326 に対する % */
  function summary(range) {
    var rg = normalizeRange(range);
    var call = 0;
    var three = 0;
    var mixc = 0;
    for (var i = 0; i < HANDS.length; i++) {
      var h = HANDS[i];
      var st = rg.cells[h];
      var n = HAND_INFO[h].n;
      if (st === 'call') call += n;
      else if (st === '3bet') three += n;
      else if (st === 'mix') { call += n / 2; three += n / 2; mixc += n; }
    }
    return {
      callCombos: call,
      threeBetCombos: three,
      mixCombos: mixc,
      callPct: round1(call * 100 / TOTAL_COMBOS),
      threeBetPct: round1(three * 100 / TOTAL_COMBOS)
    };
  }

  // ---------------------------------------------------------------- ボード別の分類と序列（ヒューリスティック）

  var STRAIGHT_RUN = 0x1F;

  function maskWith(mask, r) {
    mask |= (1 << r);
    if (r === 14) mask |= 2; // A は 1 としても立てる（A-5）
    return mask;
  }

  function hasRun5(mask) {
    for (var lo = 1; lo <= 10; lo++) {
      var run = STRAIGHT_RUN << lo;
      if ((mask & run) === run) return true;
    }
    return false;
  }

  function analyzeBoard(b) {
    var count = {};
    var suitCount = {};
    var mask = 0;
    var ranks = [];
    var i;
    for (i = 0; i < b.length; i++) {
      count[b[i].r] = (count[b[i].r] || 0) + 1;
      suitCount[b[i].s] = (suitCount[b[i].s] || 0) + 1;
      mask = maskWith(mask, b[i].r);
      ranks.push(b[i].r);
    }
    ranks.sort(function (x, y) { return y - x; });
    var distinct = [];
    for (i = 0; i < ranks.length; i++) if (distinct.indexOf(ranks[i]) < 0) distinct.push(ranks[i]);
    var pairRank = 0;
    var singleRank = 0;
    if (distinct.length === 2) {
      pairRank = count[distinct[0]] === 2 ? distinct[0] : distinct[1];
      singleRank = pairRank === distinct[0] ? distinct[1] : distinct[0];
    }
    return {
      count: count, suitCount: suitCount, mask: mask,
      H: ranks[0], M: ranks[1], L: ranks[2],
      distinct: distinct, pairRank: pairRank, singleRank: singleRank
    };
  }

  /** ツーペアの辞書式スコア：上のペア→下のペア→キッカー（ランク 2..14 なので最大 約 7.1413 でトリップス 8.0 未満） */
  function twoPair(a, b, kicker) {
    return 7.0 + Math.max(a, b) / 100 + Math.min(a, b) / 10000 + kicker / 1000000;
  }

  /**
   * 完成役がある（pairPlus）なら score、無ければ null。
   * ボードと絡む形（ペア／ポケットペア／完成ストレート・フラッシュ）だけを見る。ボード自身のペアは hero の役に数えない。
   * 序列（弱い順に並べる予測専用の仮の値）：
   *   完成ストレート/フラッシュ 9.0 ／ セット・トリップス 8.0 ／ ツーペア 7.0 ／ overpair 6.5 ／ top pair 6.0 ／
   *   between1 pocket 5.5 ／ second pair 5.0 ／ between2 pocket 4.7 ／ third pair 4.5 ／ under pocket 4.0
   *   （フルハウス 9.5・クワッズ 9.8 は仕様外の拡張）。pairPlus 内の同点は hero の他方のランク /100 で減らす。
   *   ペアボード上のツーペア（ポケット／ボードの単独ランクとのペア）は上のペア→下のペア→キッカーの辞書式（twoPair）。
   */
  function madeScore(c1, c2, bi, hi) {
    var n1 = bi.count[c1.r] || 0;
    var n2 = bi.count[c2.r] || 0;
    var nd = bi.distinct.length;
    var pocket = c1.r === c2.r;
    var suited = c1.s === c2.s;
    var tb;

    if (pocket) {
      tb = hi / 100;
      if (n1 === 2) return 9.8 + tb;                        // ボードのペア＋ポケット＝クワッズ
      if (n1 === 1) return (nd === 2 ? 9.5 : 8.0) + tb;     // ペアボード上はフルハウス、それ以外はセット
      if (nd === 1) return 9.5 + tb;                        // トリップスボード＋ポケット＝フルハウス
      if (nd === 2) return twoPair(hi, bi.pairRank, 0);     // ペアボード＋ポケット＝ツーペア（ボードのペア＋ポケット）
      if (hi > bi.H) return 6.5 + tb;                       // overpair
      if (hi > bi.M) return 5.5 + tb;                       // between1
      if (hi > bi.L) return 4.7 + tb;                       // between2
      return 4.0 + tb;                                      // under
    }

    // 完成フラッシュ（hero suited かつボード同スート3枚）／完成ストレート（5連続。A-5 含む）
    if (suited && (bi.suitCount[c1.s] || 0) === 3) return 9.0 + hi / 100;
    if (hasRun5(maskWith(maskWith(bi.mask, c1.r), c2.r))) return 9.0 + hi / 100;

    if (nd === 1) {                                         // トリップスボード
      if (n1 > 0) return 9.8 + c2.r / 100;
      if (n2 > 0) return 9.8 + c1.r / 100;
      return null;
    }
    if (nd === 2) {                                         // ペアボード（P＝ペアのランク、S＝残り1枚）
      var hasP = c1.r === bi.pairRank || c2.r === bi.pairRank;
      var hasS = c1.r === bi.singleRank || c2.r === bi.singleRank;
      if (hasP && hasS) return 9.5 + hi / 100;              // フルハウス
      if (hasP) return 8.0 + (c1.r === bi.pairRank ? c2.r : c1.r) / 100; // トリップス
      if (hasS) return twoPair(bi.singleRank, bi.pairRank, c1.r === bi.singleRank ? c2.r : c1.r); // ツーペア
      return null;
    }
    if (n1 > 0 && n2 > 0) return 7.0 + hi / 100;           // ツーペア
    if (n1 > 0 || n2 > 0) {                                 // ワンペア：位置は top / second / third
      var matched = n1 > 0 ? c1.r : c2.r;
      var kicker = n1 > 0 ? c2.r : c1.r;
      var base = matched === bi.H ? 6.0 : (matched === bi.M ? 5.0 : 4.5);
      return base + kicker / 100;
    }
    return null;
  }

  /** trash／hi の内訳：strong＝fd||oesd||gut、backdoor＝strong でなく bdfd||bdsd、他は pureAir */
  function drawSub(f) {
    if (f.fd || f.oesd || f.gut) return 'strong';
    if (f.bdfd || f.bdsd) return 'backdoor';
    return 'pureAir';
  }

  /**
   * pairPlus 以外の score：
   *   fd+oesd 3.9 ／ fd+gut 3.7 ／ fd 3.5 ／ oesd 3.3 ／ gut 3.0 ／ bdfd+bdsd 2.4 ／ bdfd 2.2 ／ bdsd 2.0 ／
   *   ドロー無し 1.0 + 高い方/100 + 低い方/10000
   * 判定材料は PD.cards.handFeatures（1枚だけの mono ボード上のフラッシュドローなどは数えない）。
   */
  function drawScore(f, hi, lo) {
    if (f.fd && f.oesd) return 3.9;
    if (f.fd && f.gut) return 3.7;
    if (f.fd) return 3.5;
    if (f.oesd) return 3.3;
    if (f.gut) return 3.0;
    if (f.bdfd && f.bdsd) return 2.4;
    if (f.bdfd) return 2.2;
    if (f.bdsd) return 2.0;
    return 1.0 + hi / 100 + lo / 10000;
  }

  /** 1コンボの分類と score。cat は pairPlus／hi／trash、sub は strong／backdoor／pureAir（pairPlus は null） */
  function evalCombo(c1, c2, b, bi) {
    var hi = Math.max(c1.r, c2.r);
    var lo = Math.min(c1.r, c2.r);
    var made = madeScore(c1, c2, bi, hi);
    if (made !== null) return { cat: 'pairPlus', sub: null, score: made };
    var f = cardsLib().handFeatures([c1, c2], b);
    return { cat: hi >= 13 ? 'hi' : 'trash', sub: drawSub(f), score: drawScore(f, hi, lo) };
  }

  /** 各値（% の厳密値）を 0.1 刻みに丸め、合計が targetTenths（0.1 単位）になるよう最大剰余法で配分 */
  function splitTenths(values, targetTenths) {
    var floors = [];
    var fracs = [];
    var sum = 0;
    var i;
    for (i = 0; i < values.length; i++) {
      var t = values[i] * 10;
      var f = Math.floor(t + EPS);
      floors.push(f);
      fracs.push(t - f);
      sum += f;
    }
    var rest = targetTenths - sum;
    var order = [];
    for (i = 0; i < values.length; i++) order.push(i);
    order.sort(function (x, y) { return (fracs[y] - fracs[x]) || (x - y); });
    for (i = 0; i < order.length && rest > 0; i++, rest--) floors[order[i]] += 1;
    var out = [];
    for (i = 0; i < floors.length; i++) out.push(floors[i] / 10);
    return out;
  }

  function pickMax(wmap, order) {
    var best = null;
    var bw = 0;
    for (var i = 0; i < order.length; i++) {
      var w = wmap[order[i]];
      if (w > bw + EPS) { bw = w; best = order[i]; }
    }
    return best;
  }

  /**
   * ボード別の統計。board が不正なら null。hero（'Ad4d'）が有効なら hero の序列も返す。
   * hero のカードはレンジから除外しない（自レンジの中での位置を見る）。除外するのは board のみ。
   * weakestFirst：169 名単位に集約（同名の平均 score、w＝除外後の重み合計）。score 昇順、w=0 の手は含めない。
   * cat／sub は同名の中で重みが最大の分類（同数なら pairPlus>hi>trash、strong>backdoor>pureAir）。
   */
  function stats(range, board, hero) {
    var b = toCardList(board);
    if (!b || b.length !== 3 || hasDup(b)) return null;
    var lib = cardsLib();
    var rg = normalizeRange(range);
    var bi = analyzeBoard(b);
    var blocked = blockedMap(b);

    var total = 0;
    var agg = { pairPlus: 0, hi: 0, trash: 0, strong: 0, backdoor: 0, pureAir: 0 };
    var comboScores = [];
    var list = [];

    for (var i = 0; i < HANDS.length; i++) {
      var hand = HANDS[i];
      var w = callWeight(rg.cells[hand]);
      if (w <= 0) continue;
      var group = expandHand(hand);
      var hw = 0;
      var sumScore = 0;
      var catW = { pairPlus: 0, hi: 0, trash: 0 };
      var subW = { strong: 0, backdoor: 0, pureAir: 0 };
      for (var k = 0; k < group.length; k++) {
        var c1 = group[k][0];
        var c2 = group[k][1];
        if (blocked[c1.r + c1.s] || blocked[c2.r + c2.s]) continue;
        var e = evalCombo(c1, c2, b, bi);
        hw += w;
        sumScore += e.score * w;
        catW[e.cat] += w;
        if (e.sub) subW[e.sub] += w;
        total += w;
        agg[e.cat] += w;
        if (e.cat === 'trash') agg[e.sub] += w;
        comboScores.push({ score: e.score, w: w });
      }
      if (hw > 0) {
        var cat = pickMax(catW, ['pairPlus', 'hi', 'trash']);
        list.push({
          hand: hand,
          w: hw,
          score: sumScore / hw,
          cat: cat,
          sub: cat === 'pairPlus' ? null : pickMax(subW, ['strong', 'backdoor', 'pureAir'])
        });
      }
    }

    list.sort(function (x, y) {
      if (Math.abs(x.score - y.score) > EPS) return x.score - y.score;
      return HAND_INFO[x.hand].idx - HAND_INFO[y.hand].idx;
    });

    var pct;
    var draws;
    if (total > 0) {
      var p = splitTenths([agg.pairPlus * 100 / total, agg.hi * 100 / total, agg.trash * 100 / total], 1000);
      pct = { pairPlus: p[0], hi: p[1], trash: p[2] };
      var d = splitTenths([agg.strong * 100 / total, agg.backdoor * 100 / total, agg.pureAir * 100 / total], Math.round(pct.trash * 10));
      draws = { strong: d[0], backdoor: d[1], pureAir: d[2] };
    } else {
      pct = { pairPlus: 0, hi: 0, trash: 0 };
      draws = { strong: 0, backdoor: 0, pureAir: 0 };
    }

    var dr = lib.drawRanks(b);
    var seen = {};
    var drawRanks = [];
    (dr.gut || []).concat(dr.oesd || []).forEach(function (ch) {
      if (!seen[ch]) { seen[ch] = true; drawRanks.push(ch); }
    });
    drawRanks.sort(function (x, y) { return lib.rankValue(y) - lib.rankValue(x); });

    var heroOut = null;
    var hc = toCardList(hero);
    if (hc && hc.length === 2 && !hasDup(hc) && !blocked[hc[0].r + hc[0].s] && !blocked[hc[1].r + hc[1].s]) {
      var he = evalCombo(hc[0], hc[1], b, bi);
      var below = 0;
      var tie = 0;
      for (var m = 0; m < comboScores.length; m++) {
        var cs = comboScores[m];
        if (cs.score < he.score - EPS) below += cs.w;
        else if (Math.abs(cs.score - he.score) <= EPS) tie += cs.w;
      }
      heroOut = {
        hand: lib.handName(hc),
        cards: lib.fmt(hc),
        score: he.score,
        cat: he.cat,
        sub: he.sub,
        percentile: total > 0 ? round1((below + 0.5 * tie) * 100 / total) : null
      };
    }

    return {
      total: total,
      pct: pct,
      draws: draws,
      drawRanks: drawRanks,
      weakestFirst: list,
      hero: heroOut
    };
  }

  // ---------------------------------------------------------------- PF 境界（暗記レーン用）

  function liveAt(rg, name) {
    var st = rg.cells[name];
    return st === 'call' || st === 'mix';
  }

  /** hiCh 行（K なら KQ..K2）の suffix（'s'|'o'）で call/mix のうち最も低い手 */
  function lowestLive(rg, hiCh, suffix) {
    var start = RANK_CHARS.indexOf(hiCh);
    for (var k = RANK_CHARS.length - 1; k > start; k--) {
      var name = hiCh + RANK_CHARS.charAt(k) + suffix;
      if (liveAt(rg, name)) return name;
    }
    return null;
  }

  function lowestPocket(rg) {
    for (var k = RANK_CHARS.length - 1; k >= 0; k--) {
      var ch = RANK_CHARS.charAt(k);
      if (liveAt(rg, ch + ch)) return ch + ch;
    }
    return null;
  }

  function lowestConnector(rg) {
    for (var k = SUITED_CONNECTORS.length - 1; k >= 0; k--) {
      if (liveAt(rg, SUITED_CONNECTORS[k])) return SUITED_CONNECTORS[k];
    }
    return null;
  }

  /** 強い順：ポケット（高い順）→ それ以外は高い方のランク→低い方のランク→suited→offsuit */
  function strengthCmp(a, b) {
    var A = HAND_INFO[a];
    var B = HAND_INFO[b];
    var pa = A.kind === 'pair' ? 1 : 0;
    var pb = B.kind === 'pair' ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (A.hi !== B.hi) return B.hi - A.hi;
    if (A.lo !== B.lo) return B.lo - A.lo;
    return (A.kind === 's' ? 0 : 1) - (B.kind === 's' ? 0 : 1);
  }

  function boundaries(range) {
    var rg = normalizeRange(range);
    var tb = [];
    for (var i = 0; i < HANDS.length; i++) {
      var st = rg.cells[HANDS[i]];
      if (st === '3bet' || st === 'mix') tb.push(HANDS[i]);
    }
    tb.sort(strengthCmp);
    return {
      As: lowestLive(rg, 'A', 's'),
      Ks: lowestLive(rg, 'K', 's'),
      Qs: lowestLive(rg, 'Q', 's'),
      sc: lowestConnector(rg),
      off: { K: lowestLive(rg, 'K', 'o'), Q: lowestLive(rg, 'Q', 'o'), J: lowestLive(rg, 'J', 'o') },
      pocket: lowestPocket(rg),
      threeBet: tb
    };
  }

  /** memo の固定カード id に対応する正解。レンジ未入力なら null。3bet の2枚は kind 'list'（表示のみ） */
  function pfAnswer(range, cardId) {
    var rg = normalizeRange(range);
    if (!isFilled(rg)) return null;
    var bd = boundaries(rg);
    var one = function (h) { return { expect: h ? [h] : [], kind: 'hand' }; };
    switch (cardId) {
      case 'pf_As': return one(bd.As);
      case 'pf_Ks': return one(bd.Ks);
      case 'pf_Qs': return one(bd.Qs);
      case 'pf_JTs': return one(bd.sc);
      case 'pf_off':
        return { expect: [bd.off.K, bd.off.Q, bd.off.J].filter(function (h) { return !!h; }), kind: 'hand' };
      case 'pf_pocket': return one(bd.pocket);
      case 'pf_3bet_value':
      case 'pf_3bet_bluff':
        return { expect: bd.threeBet.slice(), kind: 'list' };
      default: return null;
    }
  }

  function toHalfWidth(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/　/g, ' ');
  }

  /** 'a5s'→'A5s'、'kk'→'KK'、'5as'→'A5s'。ペアに s/o が付く・suited/offsuit 不明などは入力のまま返す（一致しない） */
  function normalizeHandToken(tok) {
    var t = tok.replace(/10/g, 'T');
    var m = /^([AKQJT98765432])([AKQJT98765432])([so]?)$/i.exec(t);
    if (!m) return tok;
    var a = m[1].toUpperCase();
    var b = m[2].toUpperCase();
    var sfx = m[3].toLowerCase();
    if (a === b) return sfx === '' ? a + b : tok;
    if (sfx === '') return tok;
    if (RANK_CHARS.indexOf(a) > RANK_CHARS.indexOf(b)) { var x = a; a = b; b = x; }
    return a + b + sfx;
  }

  /** 区切りは空白・カンマ・全角／半角スラッシュ。重複は除く。'無し'／'なし' は空 */
  function parseHandList(text) {
    var parts = toHalfWidth(text).split(/[\s,、\/]+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i];
      if (!tok || tok === '無し' || tok === 'なし') continue;
      var h = normalizeHandToken(tok);
      if (out.indexOf(h) < 0) out.push(h);
    }
    return out;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) < 0) return false;
    return true;
  }

  /** 入力テキストを正解と集合一致で照合。レンジ未入力／list のカード／未知の id は null（判定しない） */
  function checkPf(range, cardId, text) {
    var ans = pfAnswer(range, cardId);
    if (!ans || ans.kind !== 'hand') return null;
    var got = parseHandList(text);
    return { ok: sameSet(got, ans.expect), expect: ans.expect, got: got };
  }

  return {
    KEY: KEY,
    STATE_ORDER: STATE_ORDER,
    HAND_GRID: HAND_GRID,
    HANDS: HANDS,
    callWeight: callWeight,
    cycle: cycle,
    empty: empty,
    isFilled: isFilled,
    setCell: setCell,
    cellState: cellState,
    load: load,
    save: save,
    clear: clear,
    exportState: exportState,
    importState: importState,
    summary: summary,
    combos: combos,
    stats: stats,
    boundaries: boundaries,
    pfAnswer: pfAnswer,
    checkPf: checkPf
  };
})(PD.cards);

if (typeof module !== 'undefined') module.exports = PD.range;
