// premise-drill: PD.gen（T2）。出題アルゴリズム（SPEC ⑤）。cards・wizard 依存（node では require で解決）。
// ソルバー数値は一切使わない。カードの組合せ（数学）とクラス定義（構造）のみで出題する。
//   CLASS_WEIGHTS / HERO_POOLS / FAMILIES / FALLBACK_BOARDS
//   generateSpot / spotFromManual / parseShorthand / familyOf / nextSpot
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.gen = (function () {
  'use strict';

  // ---------------------------------------------------------------- 依存解決
  // ブラウザは読込順（util → cards → generator → … → wizard → gaps）で揃う。
  // wizard・gaps は generator より後に読まれるので呼出時に遅延解決する。node では require。
  function dep(name, path) {
    if (PD[name]) return PD[name];
    if (typeof require === 'function') {
      try { return require(path); } catch (e) { return null; }
    }
    return null;
  }
  var cards = dep('cards', './cards');
  var util = dep('util', './util');

  function needCards() {
    if (!cards) cards = dep('cards', './cards');
    if (!cards) throw new Error('PD.gen: PD.cards が見つかりません（js/cards.js を先に読み込む）');
    return cards;
  }
  function needUtil() {
    if (!util) util = dep('util', './util');
    if (!util) throw new Error('PD.gen: PD.util が見つかりません（js/util.js を先に読み込む）');
    return util;
  }
  function needWizard() {
    var w = dep('wizard', './wizard');
    if (!w) throw new Error('PD.gen: PD.wizard が見つかりません（js/wizard.js を読み込む）');
    return w;
  }
  /** gaps は任意依存（nextSpot の due／安定族の判定に使う。無ければ内蔵の簡易判定） */
  function optGaps() {
    return dep('gaps', './gaps');
  }

  // ---------------------------------------------------------------- 定数
  var VILLAIN_POS = 'BTN';                 // トライアルは BTN 固定（他ポジションは Phase C）
  var NODE = 'BTN2.5-BBcall-x-cb';
  var DEFAULT_SIZES = [33, 50];
  var MAX_BOARD_TRIES = 200;               // ボードのリジェクションサンプリング上限（SPEC ⑤-3）
  var MAX_HERO_TRIES = 200;                // Hero の再抽選上限（超えたら決定論的に走査）

  /** ボードクラスと重み（既定）。trips は破棄 */
  var CLASS_WEIGHTS = { dry_high: 3, bw_sd: 3, mid: 2, low: 2, paired: 1, mono: 1 };
  var CLS_ORDER = ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono'];

  /**
   * Hero プール（境界に来やすい手のみ。w は重み）。
   *   rule 'bdfd'   : スーテッド。ボードに1枚だけあるスートを採る（BDFD 成立）。モノトーン盤では盤に無いスート
   *   rule 'suited' : スーテッド。ボードに2枚以上あるスートは採らない（FD／フラッシュ完成を避ける）
   *   rule 'off'    : オフスート（2枚は別スート）
   *   rule 'pocket' : ポケットペア（2枚は別スート）
   * ボードと重複するカードは除外。ボードとペア以上になる組は再抽選（generateSpot 側）。
   */
  var HERO_POOLS = {
    A_lowkick_s: { w: 25, rule: 'bdfd',   hands: ['A2s', 'A3s', 'A4s', 'A5s', 'A6s', 'A7s'] },
    A_lowkick_o: { w: 15, rule: 'off',    hands: ['A4o', 'A5o', 'A6o', 'A7o', 'A8o', 'A9o'] },
    K_mid_s:     { w: 10, rule: 'suited', hands: ['K5s', 'K6s', 'K7s', 'K8s', 'K9s'] },
    Q_T_sc:      { w: 20, rule: 'bdfd',   hands: ['QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', '98s'] },
    low_pocket:  { w: 15, rule: 'pocket', hands: ['22', '33', '44', '55'] },
    mid_sc_o:    { w: 15, rule: 'off',    hands: ['J9o', 'T8o', '97o'] }
  };
  var POOL_ORDER = ['A_lowkick_s', 'A_lowkick_o', 'K_mid_s', 'Q_T_sc', 'low_pocket', 'mid_sc_o'];

  /** 族の表示名（Truth／Map でのみ表示。Drill・Home には出さない） */
  var CLS_LABEL = {
    dry_high: 'ドライ・ハイ',
    bw_sd: 'ブロードウェイSD',
    mid: 'ミドル',
    low: 'ロー',
    paired: 'ペアード',
    mono: 'モノトーン'
  };

  /** 表示順（cls 6 × size 2 = 12件）。gaps の格子行順と同じ並び */
  var FAMILIES = (function () {
    var out = [];
    for (var i = 0; i < CLS_ORDER.length; i++) {
      for (var j = 0; j < DEFAULT_SIZES.length; j++) {
        out.push({ id: CLS_ORDER[i] + '_' + DEFAULT_SIZES[j], label: CLS_LABEL[CLS_ORDER[i]] + ' ' + DEFAULT_SIZES[j] + '%' });
      }
    }
    return out;
  })();

  /** リジェクションサンプリングが上限に達したときの固定盤 */
  var FALLBACK_BOARDS = ['Ks7d5c', 'QsJd9c', 'Ts9h6c', '8h7d4c', 'Ah9h6c'];

  var SUITS = 'shdc';
  var RANKS = 'AKQJT98765432';
  var RE_HAND_NAME = /^([AKQJT2-9])([AKQJT2-9])([so])?$/;             // 'A4s' / 'AKo' / '55'
  var RE_HAND_CARDS = /^([AKQJT2-9])([shdc])([AKQJT2-9])([shdc])$/;  // 'Ad4d'
  var RE_HAND_RR_SS = /^([AKQJT2-9])([AKQJT2-9])([shdc])([shdc])$/;  // 'A4dd'（短縮記法のみ）
  var RE_BOARD_ABS = /^([AKQJT2-9])([AKQJT2-9])([AKQJT2-9])(r|tt|m)$/; // 'K75r' / 'K75tt' / 'K75m'
  var RE_SIZE = /^b?(\d+(?:\.\d+)?)%?$/;                                 // '33' / 'b50' / '50%'
  var RE_FAMILY = /^(dry_high|bw_sd|mid|low|paired|mono)_(33|50|x)$/;

  // ---------------------------------------------------------------- 小道具
  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  function randomSeed() { return Math.floor(Math.random() * 4294967296) >>> 0; }

  function rankValue(ch) {
    var i = RANKS.indexOf(String(ch).toUpperCase());
    return i < 0 ? 0 : 14 - i;
  }

  /** ランク降順（同ランクは s,h,d,c 順）に整列した新しい配列 */
  function sortDesc(list) {
    return list.slice().sort(function (a, b) {
      return (b.r - a.r) || (SUITS.indexOf(a.s) - SUITS.indexOf(b.s));
    });
  }

  function onBoard(board, r, s) {
    for (var i = 0; i < board.length; i++) if (board[i].r === r && board[i].s === s) return true;
    return false;
  }

  function suitCounts(board) {
    var c = { s: 0, h: 0, d: 0, c: 0 };
    for (var i = 0; i < board.length; i++) c[board[i].s]++;
    return c;
  }

  function distinctRanks(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (!seen[list[i].r]) { seen[list[i].r] = true; out.push(list[i].r); }
    }
    return out;
  }

  /** ランク配列 → ビットマスク（A は 14 と 1 の両方。ホイール対応） */
  function maskOf(ranks) {
    var m = 0;
    for (var i = 0; i < ranks.length; i++) {
      m |= (1 << ranks[i]);
      if (ranks[i] === 14) m |= (1 << 1);
    }
    return m;
  }

  function hasStraight(mask) {
    for (var lo = 1; lo <= 10; lo++) {
      var run = 0x1F << lo;
      if ((mask & run) === run) return true;
    }
    return false;
  }

  /** FNV-1a 32bit → base36（Spot.id を seed と opts から決定論的に作る） */
  function hash36(str) {
    var h = 0x811C9DC5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function normSizes(sizes) {
    if (!Array.isArray(sizes)) return DEFAULT_SIZES.slice();
    var out = [];
    for (var i = 0; i < sizes.length; i++) {
      var n = Number(sizes[i]);
      if (isNum(n) && n > 0) out.push(n);
    }
    return out.length ? out : DEFAULT_SIZES.slice();
  }

  function classList(exclude) {
    var out = [];
    for (var i = 0; i < CLS_ORDER.length; i++) {
      var id = CLS_ORDER[i];
      if (exclude && exclude[id]) continue;
      var w = Number(CLASS_WEIGHTS[id]) || 0;
      if (w > 0) out.push({ id: id, w: w });
    }
    return out;
  }

  function poolList() {
    var out = [];
    for (var i = 0; i < POOL_ORDER.length; i++) {
      var p = HERO_POOLS[POOL_ORDER[i]];
      if (!p || !(Number(p.w) > 0)) continue;
      out.push({ id: POOL_ORDER[i], w: Number(p.w), rule: p.rule, hands: p.hands });
    }
    return out;
  }

  function parseFamily(family) {
    var m = RE_FAMILY.exec(String(family || ''));
    if (!m) return null;
    return { cls: m[1], size: m[2] === 'x' ? null : Number(m[2]) };
  }

  /** 'A4s' / 'AKo' / '55' → { r1, r2, kind: 's'|'o'|'p' }。不正なら null */
  function parseHandName(name) {
    var m = RE_HAND_NAME.exec(String(name || '').toUpperCase().replace(/([SO])$/, function (c) { return c.toLowerCase(); }));
    if (!m) return null;
    var r1 = rankValue(m[1]);
    var r2 = rankValue(m[2]);
    if (r1 === r2) {
      if (m[3]) return null;                       // 同ランクに s/o は付けない
      return { r1: r1, r2: r2, kind: 'p' };
    }
    if (!m[3]) return null;                        // 異ランクは s|o 必須
    if (r1 < r2) { var t = r1; r1 = r2; r2 = t; }
    return { r1: r1, r2: r2, kind: m[3] };
  }

  // ---------------------------------------------------------------- Hero のスート割り当て
  /**
   * ハンド名と規則からボードに合うスート割り当ての候補（Card[2] の配列）を返す。
   * ボードと重複するカードは除く。候補の並びは決定論的（走査フォールバック用）。
   *   prefer: 優先したいスート（短縮記法で明示されたとき）。候補にあれば先頭に寄せる
   */
  function suitOptions(hand, rule, board, prefer) {
    var h = typeof hand === 'string' ? parseHandName(hand) : hand;
    if (!h) return [];
    var cnt = suitCounts(board);
    var out = [];
    var i, j, s1, s2;
    if (h.kind === 's') {
      var pref = [];
      var alt = [];
      for (i = 0; i < SUITS.length; i++) {
        s1 = SUITS.charAt(i);
        if (onBoard(board, h.r1, s1) || onBoard(board, h.r2, s1)) continue;
        if (rule === 'bdfd') {
          if (cnt[s1] === 1) pref.push(s1);
          else if (cnt[s1] === 0) alt.push(s1);
        } else if (rule === 'other') {
          if (cnt[s1] === 0) pref.push(s1);
        } else if (cnt[s1] <= 1) {
          pref.push(s1);
        }
      }
      var use = pref.length ? pref : alt;
      if (prefer && use.indexOf(prefer) > 0) {
        use.splice(use.indexOf(prefer), 1);
        use.unshift(prefer);
      }
      for (i = 0; i < use.length; i++) out.push([{ r: h.r1, s: use[i] }, { r: h.r2, s: use[i] }]);
      return out;
    }
    // オフスート／ポケット：2枚は別スート
    for (i = 0; i < SUITS.length; i++) {
      for (j = 0; j < SUITS.length; j++) {
        if (i === j) continue;
        if (h.kind === 'p' && j < i) continue;     // ポケットは順不同なので片側だけ
        s1 = SUITS.charAt(i);
        s2 = SUITS.charAt(j);
        if (onBoard(board, h.r1, s1) || onBoard(board, h.r2, s2)) continue;
        out.push([{ r: h.r1, s: s1 }, { r: h.r2, s: s2 }]);
      }
    }
    if (prefer && Array.isArray(prefer)) {
      for (i = 0; i < out.length; i++) {
        if (out[i][0].s === prefer[0] && out[i][1].s === prefer[1]) {
          var hit = out.splice(i, 1)[0];
          out.unshift(hit);
          break;
        }
      }
    }
    return out;
  }

  /**
   * 段1は境界訓練：ボードとペア以上（セット・ストレート・フラッシュ完成含む）は不採用。
   * ハイカード無し・ドロー無し・BD 無しの純粋に弱すぎる組も不採用（ポケットペアは対象外）。
   */
  function heroAccepted(hero, board) {
    var C = needCards();
    var hf = C.handFeatures(hero, board);
    if (hf.pair) return false;
    var ranks = distinctRanks(hero.concat(board));
    if (ranks.length === 5 && hasStraight(maskOf(ranks))) return false;
    if (hero[0].s === hero[1].s && suitCounts(board)[hero[0].s] === 3) return false;
    if (!hf.pocket && !hf.hiCard && !hf.fd && !hf.bdfd && !hf.oesd && !hf.gut && !hf.bdsd) return false;
    return true;
  }

  function drawHero(board, r) {
    var U = needUtil();
    var pools = poolList();
    var i, j, k;
    for (i = 0; i < MAX_HERO_TRIES; i++) {
      var pool = U.weighted(pools, r);
      var hand = U.pick(pool.hands, r);
      var opts = suitOptions(hand, pool.rule, board);
      if (!opts.length) continue;
      var hc = U.pick(opts, r);
      if (heroAccepted(hc, board)) return { cards: hc, pool: pool.id };
    }
    // 決定論的フォールバック：全候補を順に走査（理論上はここで必ず見つかる）
    for (i = 0; i < pools.length; i++) {
      for (j = 0; j < pools[i].hands.length; j++) {
        var all = suitOptions(pools[i].hands[j], pools[i].rule, board);
        for (k = 0; k < all.length; k++) {
          if (heroAccepted(all[k], board)) return { cards: all[k], pool: pools[i].id };
        }
      }
    }
    throw new Error('PD.gen: このボードでは Hero プールから手を作れません: ' + needCards().fmt(board));
  }

  // ---------------------------------------------------------------- ボード抽選
  /** classifyBoard を呼ぶ前の安い前判定。'high' は dry_high/bw_sd のどちらか（hmsd は厳密判定に委ねる） */
  function quickCls(b) {
    var distinct = distinctRanks(b).length;
    if (distinct === 1) return 'trips';
    var cnt = suitCounts(b);
    if (cnt.s === 3 || cnt.h === 3 || cnt.d === 3 || cnt.c === 3) return 'mono';
    if (distinct === 2) return 'paired';
    var H = Math.max(b[0].r, b[1].r, b[2].r);
    if (H >= 11) return 'high';
    if (H >= 9) return 'mid';
    return 'low';
  }

  function parseFixedBoard(str) {
    var p = needCards().parseBoard(str);
    return p.ok ? sortDesc(p.cards) : null;
  }

  function sampleBoard(cls, r) {
    var C = needCards();
    var want = (cls === 'dry_high' || cls === 'bw_sd') ? 'high' : cls;
    var i;
    for (i = 0; i < MAX_BOARD_TRIES; i++) {
      var b = C.randomBoard(r);
      if (quickCls(b) !== want) continue;
      if (want !== 'high') return b;
      if (C.classifyBoard(b).cls === cls) return b;
    }
    // 上限到達：固定盤から同クラスを探し、無ければ先頭
    for (i = 0; i < FALLBACK_BOARDS.length; i++) {
      var fb = parseFixedBoard(FALLBACK_BOARDS[i]);
      if (fb && C.classifyBoard(fb).cls === cls) return fb;
    }
    return parseFixedBoard(FALLBACK_BOARDS[0]);
  }

  // ---------------------------------------------------------------- Spot 組み立て
  function buildSpot(board, hero, heroPool, size, seed, id) {
    var C = needCards();
    var W = needWizard();
    var b = sortDesc(board);
    var h = sortDesc(hero);
    var c = C.classifyBoard(b);
    var pot = W.potOf(VILLAIN_POS);
    var spot = {
      id: id,
      seed: seed,
      node: NODE,
      villainPos: VILLAIN_POS,
      pre: W.PRE_BY_POS[VILLAIN_POS].pre,
      board: C.fmt(b),
      cls: c.cls,
      suit: c.suit,
      connected: c.connected,
      hmsd: c.hmsd,
      size: size,
      pot: pot,
      bet: W.betBB(pot, size),
      hero: C.fmt(h),
      heroPool: heroPool,
      family: ''
    };
    spot.family = familyOf(spot);
    return spot;
  }

  /** `${cls}_${size}`。size が 33/50 以外なら `${cls}_x` */
  function familyOf(spot) {
    var cls = spot && spot.cls ? String(spot.cls) : '';
    var size = spot ? spot.size : null;
    return cls + '_' + ((size === 33 || size === 50) ? String(size) : 'x');
  }

  /**
   * generateSpot(opts) -> Spot
   *   opts.family : `${cls}_${size}` で cls×size 固定（size 'x' はサイズのみ抽選）
   *   opts.sizes  : サイズ候補（既定 [33,50]）。等確率
   *   opts.seed   : 乱数シード（mulberry32）。同じ seed・同じ opts で同じ Spot
   *   opts.rng    : 乱数関数の注入（テスト用。与えると seed は保存のみ）
   * villainPos は常に 'BTN'、pot 5.5、bet は wizard.betBB。
   */
  function generateSpot(opts) {
    opts = opts || {};
    var U = needUtil();
    var seed = isNum(opts.seed) ? (opts.seed >>> 0) : randomSeed();
    var r = typeof opts.rng === 'function' ? opts.rng : U.rng(seed);
    var sizes = normSizes(opts.sizes);
    var fam = opts.family ? parseFamily(opts.family) : null;
    var cls = fam ? fam.cls : U.weighted(classList(), r).id;
    var size = (fam && fam.size) ? fam.size : U.pick(sizes, r);
    var board = sampleBoard(cls, r);
    var hero = drawHero(board, r);
    var id = 's_' + hash36(seed + '|' + (fam ? opts.family : '') + '|' + sizes.join(','));
    return buildSpot(board, hero.cards, hero.pool, size, seed, id);
  }

  /**
   * spotFromManual({ board, hero, size }) -> { ok, spot?, err? }
   * 実戦持ち込み用。villainPos 'BTN' 固定。heroPool 'manual'、seed null（再生成しない）。
   * ペアやドロー完成の Hero も受け付ける（実戦の手はそのまま）。trips のボードは族が無いので不可。
   */
  function spotFromManual(input) {
    input = input || {};
    var C = needCards();
    var pb = C.parseBoard(input.board);
    if (!pb.ok) return { ok: false, err: 'ボード：' + pb.err };
    var ph = C.parseHand(input.hero);
    if (!ph.ok) return { ok: false, err: 'Hero：' + ph.err };
    for (var i = 0; i < ph.cards.length; i++) {
      if (onBoard(pb.cards, ph.cards[i].r, ph.cards[i].s)) {
        return { ok: false, err: 'Hero のカードがボードと重複: ' + C.fmt([ph.cards[i]]) };
      }
    }
    var size = Number(input.size);
    if (!isNum(size) || size <= 0) return { ok: false, err: 'サイズは正の数（%）で入力' };
    if (C.classifyBoard(pb.cards).cls === 'trips') return { ok: false, err: 'トリップスのボードは対象外' };
    var id = needUtil().id('s');
    return { ok: true, spot: buildSpot(pb.cards, ph.cards, 'manual', size, null, id) };
  }

  // ---------------------------------------------------------------- 短縮記法
  /** 'Ks7d5c' または 'K75r' / 'K75tt' / 'K75m' → { ok, cards, abstract, err } */
  function parseBoardToken(tok) {
    var C = needCards();
    var t = String(tok || '');
    var m = RE_BOARD_ABS.exec(t.toUpperCase().replace(/(R|TT|M)$/, function (x) { return x.toLowerCase(); }));
    if (!m) {
      var p = C.parseBoard(t);
      if (!p.ok) return { ok: false, err: 'ボード：' + p.err + '（または K75r / K75tt / K75m 形式）' };
      return { ok: true, cards: sortDesc(p.cards), abstract: false };
    }
    var ranks = [rankValue(m[1]), rankValue(m[2]), rankValue(m[3])];
    var tex = m[4];
    var patterns = tex === 'r' ? [['s', 'd', 'c']]
      : tex === 'm' ? [['s', 's', 's']]
      : [['s', 's', 'd'], ['s', 'd', 's'], ['d', 's', 's']];
    for (var i = 0; i < patterns.length; i++) {
      var cs = [];
      var seen = {};
      var dup = false;
      for (var j = 0; j < 3; j++) {
        var key = ranks[j] + patterns[i][j];
        if (seen[key]) { dup = true; break; }
        seen[key] = true;
        cs.push({ r: ranks[j], s: patterns[i][j] });
      }
      if (!dup) return { ok: true, cards: sortDesc(cs), abstract: true };
    }
    return { ok: false, err: 'ボード：そのランクとテクスチャの組は作れません（' + t + '）' };
  }

  function parseSizeToken(tok) {
    var m = RE_SIZE.exec(String(tok || '').toLowerCase());
    if (!m) return { ok: false, err: 'サイズ：33 / b50 / 50% の形式で入力' };
    var n = Number(m[1]);
    if (!isNum(n) || n <= 0) return { ok: false, err: 'サイズは正の数（%）で入力' };
    return { ok: true, size: n };
  }

  /** 'A4s' / 'Ad4d' / 'A4dd' → { ok, hand:{r1,r2,kind}, suits:[s1,s2]|null, err } */
  function parseHeroToken(tok) {
    var t = String(tok || '');
    var up = t.toUpperCase();
    var m = RE_HAND_CARDS.exec(up.replace(/([SHDC])/g, function (x, c, off) { return off % 2 === 1 ? c.toLowerCase() : c; }));
    var r1, r2, s1, s2;
    if (m) {
      r1 = rankValue(m[1]); s1 = m[2]; r2 = rankValue(m[3]); s2 = m[4];
      if (r1 === r2 && s1 === s2) return { ok: false, err: 'Hero：同じカードが重複' };
      if (r1 < r2) { var tr = r1; r1 = r2; r2 = tr; var ts = s1; s1 = s2; s2 = ts; }
      return { ok: true, hand: { r1: r1, r2: r2, kind: r1 === r2 ? 'p' : (s1 === s2 ? 's' : 'o') }, suits: [s1, s2] };
    }
    m = RE_HAND_RR_SS.exec(up.replace(/([SHDC])([SHDC])$/, function (x, a, b) { return a.toLowerCase() + b.toLowerCase(); }));
    if (m) {
      r1 = rankValue(m[1]); s1 = m[3]; r2 = rankValue(m[2]); s2 = m[4];
      if (r1 === r2 && s1 === s2) return { ok: false, err: 'Hero：同じカードが重複' };
      if (r1 < r2) { var tr2 = r1; r1 = r2; r2 = tr2; var ts2 = s1; s1 = s2; s2 = ts2; }
      return { ok: true, hand: { r1: r1, r2: r2, kind: r1 === r2 ? 'p' : (s1 === s2 ? 's' : 'o') }, suits: [s1, s2] };
    }
    var h = parseHandName(t);
    if (!h) return { ok: false, err: 'Hero：A4s / AKo / 55 / Ad4d の形式で入力' };
    return { ok: true, hand: h, suits: null };
  }

  /**
   * parseShorthand('K75r 33 A4s') -> { ok, board, size, hero, needSuitQuestion, heroOptions?, boardAbstract?, err? }
   *   語順は「ボード サイズ Hero」固定（'44' がサイズともハンドとも読めるため）。
   *   board は常に具体化した 'Ks7d5c' 形式（r → s,d,c／tt → 先頭2枚同スート／m → 全て s）。
   *   Hero がスーテッドでスートを揃えられない（ボードが抽象、または Hero がハンド名）ときは needSuitQuestion:true、
   *   hero はハンド名のまま、heroOptions.same（ボードと同じスートが1枚＝BDFD）／heroOptions.other（無し）に具体形を返す。
   *   オフスート・ポケットは BDFD が無いので質問せず具体化する。
   */
  function parseShorthand(text) {
    var C = needCards();
    var toks = String(text === null || text === undefined ? '' : text).trim().split(/\s+/).filter(function (x) { return x; });
    if (toks.length !== 3) return { ok: false, err: '「ボード サイズ Hero」の3語で入力（例 K75r 33 A4s）' };
    var b = parseBoardToken(toks[0]);
    if (!b.ok) return { ok: false, err: b.err };
    var sz = parseSizeToken(toks[1]);
    if (!sz.ok) return { ok: false, err: sz.err };
    var ht = parseHeroToken(toks[2]);
    if (!ht.ok) return { ok: false, err: ht.err };

    var board = b.cards;
    var hand = ht.hand;
    var res = { ok: true, board: C.fmt(board), size: sz.size, hero: null, needSuitQuestion: false, boardAbstract: b.abstract };
    var opts;

    // 両方具体：そのまま（重複だけ検査）
    if (ht.suits && !b.abstract) {
      var hc = [{ r: hand.r1, s: ht.suits[0] }, { r: hand.r2, s: ht.suits[1] }];
      for (var i = 0; i < 2; i++) {
        if (onBoard(board, hc[i].r, hc[i].s)) return { ok: false, err: 'Hero のカードがボードと重複: ' + C.fmt([hc[i]]) };
      }
      res.hero = C.fmt(sortDesc(hc));
      return res;
    }

    if (hand.kind === 's') {
      var prefer = ht.suits ? ht.suits[0] : null;
      var same = suitOptions(hand, 'bdfd', board, prefer).filter(function (o) { return suitCounts(board)[o[0].s] === 1; });
      var other = suitOptions(hand, 'other', board, prefer);
      if (same.length && other.length) {
        res.needSuitQuestion = true;
        res.hero = C.handName([{ r: hand.r1, s: 's' }, { r: hand.r2, s: 's' }]);
        res.heroOptions = { same: C.fmt(same[0]), other: C.fmt(other[0]) };
        return res;
      }
      opts = same.length ? same : other;
      if (!opts.length) return { ok: false, err: 'Hero：そのハンドはこのボードでは作れません' };
      res.hero = C.fmt(opts[0]);
      return res;
    }

    opts = suitOptions(hand, hand.kind === 'p' ? 'pocket' : 'off', board, ht.suits);
    if (!opts.length) return { ok: false, err: 'Hero：そのハンドはこのボードでは作れません' };
    res.hero = C.fmt(opts[0]);
    return res;
  }

  // ---------------------------------------------------------------- 出題順
  /** gaps が無い環境向けの簡易 due 判定（recurrence の count≥1 かつ due≤today の族。due の早い順） */
  function dueFallback(state, today) {
    var rec = state && state.recurrence ? state.recurrence : {};
    var best = {};
    for (var key in rec) {
      if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
      var bar = key.indexOf('|');
      if (bar < 0) continue;
      var fam = key.slice(bar + 1);
      var cell = rec[key];
      if (!cell || !(cell.count >= 1) || !cell.due || String(cell.due) > today) continue;
      if (!best[fam] || cell.due < best[fam]) best[fam] = cell.due;
    }
    return Object.keys(best).sort(function (a, b) { return best[a] < best[b] ? -1 : best[a] > best[b] ? 1 : (a < b ? -1 : a > b ? 1 : 0); });
  }

  /**
   * nextSpot(state, log, opts) -> { spot, reason: 'srs'|'random'|'stable' }
   *   ① dueFamilies があれば最優先で family 指定（srs）
   *   ② 直近3問と同クラスを避ける ③ それ以外は重みでランダム（random）
   *   tempo 'speed' は stableFamilies からのみ（stable）。安定族が無ければ random に落ちる（UI 側で解放判定するのが原則）
   *   opts.seed で全体を決定論に、opts.today で日付を固定できる。
   */
  function nextSpot(state, log, opts) {
    state = state || {};
    log = Array.isArray(log) ? log : [];
    opts = opts || {};
    var U = needUtil();
    var seed = isNum(opts.seed) ? (opts.seed >>> 0) : randomSeed();
    var r = U.rng(seed);
    var sizes = normSizes(state.settings && state.settings.sizes);
    var today = opts.today || U.today();
    var gaps = optGaps();
    function spotSeed() { return Math.floor(r() * 4294967296) >>> 0; }

    if (opts.tempo === 'speed') {
      var stable = (gaps && typeof gaps.stableFamilies === 'function') ? gaps.stableFamilies(state) : [];
      if (stable.length) {
        return { spot: generateSpot({ family: U.pick(stable, r), sizes: sizes, seed: spotSeed() }), reason: 'stable' };
      }
    }

    var due = (gaps && typeof gaps.dueFamilies === 'function') ? gaps.dueFamilies(state, today) : dueFallback(state, today);
    if (due && due.length) {
      return { spot: generateSpot({ family: due[0], sizes: sizes, seed: spotSeed() }), reason: 'srs' };
    }

    var recent = {};
    for (var i = log.length - 1, n = 0; i >= 0 && n < 3; i--) {
      var e = log[i];
      if (!e || !e.spot || !e.spot.cls) continue;
      recent[e.spot.cls] = true;
      n++;
    }
    var list = classList(recent);
    if (!list.length) list = classList();
    var cls = U.weighted(list, r).id;
    var size = U.pick(sizes, r);
    return { spot: generateSpot({ family: cls + '_' + size, sizes: sizes, seed: spotSeed() }), reason: 'random' };
  }

  return {
    CLASS_WEIGHTS: CLASS_WEIGHTS,
    HERO_POOLS: HERO_POOLS,
    FAMILIES: FAMILIES,
    FALLBACK_BOARDS: FALLBACK_BOARDS,
    generateSpot: generateSpot,
    spotFromManual: spotFromManual,
    parseShorthand: parseShorthand,
    familyOf: familyOf,
    nextSpot: nextSpot
  };
})();

if (typeof module !== 'undefined') module.exports = PD.gen;
