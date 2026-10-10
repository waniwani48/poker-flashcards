// premise-drill: PD.wizard（T4）。Wizard リンク生成。依存なし（純粋モジュール）。
// 契約は SPEC ⑫「js/wizard.js — PD.wizard」、URL 形式は SPEC ⑪。
var root = typeof window !== "undefined" ? window : globalThis;
var PD = root.PD = root.PD || {};

(function () {
  "use strict";

  // 共通の base。depth=100 は常に明示。gmfs_solution_tab は付けない。
  var BASE = "https://app.gtowizard.com/solutions?gametype=Cash6m50zGeneral&depth=100&soltab=strategy";

  // ポジション別のプリフロップ列。トライアルは BTN のみ（他ポジションは Phase C で追加）。
  //   pre  : preflop_actions の文字列
  //   open : オープンサイズ（BB）。pot = open*2 + 0.5
  //   hs   : CB 判断ノードの history_spot。BB 応答ノードは hs+1
  //   flop : フロップの先頭アクション（BB チェック）
  var PRE_BY_POS = {
    BTN: { pre: "F-F-F-R2.5-F-C", open: 2.5, hs: 7, flop: "X" }
  };

  // テストリンク用の固定スポット（K75 レインボー・33%）。
  var TEST_SPOT = { board: "Ks7d5c", villainPos: "BTN", size: 33 };

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function preOf(villainPos) {
    if (typeof villainPos !== "string") return null;
    return Object.prototype.hasOwnProperty.call(PRE_BY_POS, villainPos) ? PRE_BY_POS[villainPos] : null;
  }

  /** potOf(villainPos) -> number|null。BTN→5.5。未対応ポジションは null。 */
  function potOf(villainPos) {
    var p = preOf(villainPos);
    if (!p) return null;
    return Math.round((p.open * 2 + 0.5) * 100) / 100;
  }

  /**
   * betBB(pot, size) -> number（小数2桁）。
   * 契約の式 Math.round(pot*size/100*100)/100 と同値（/100*100 を約分して浮動小数の揺れを避ける）。
   * 5.5×33→1.82、5.5×50→2.75。Spot.bet と UI 表示に使う。
   */
  function betBB(pot, size) {
    if (!isNum(pot) || !isNum(size)) return NaN;
    return Math.round(pot * size) / 100;
  }

  // board をスペース無し・ランク大文字＋スート小文字に正規化する（カード妥当性は見ない）。
  function normBoard(board) {
    if (typeof board !== "string") return "";
    var s = board.replace(/\s+/g, "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      out += (i % 2 === 0) ? s.charAt(i).toUpperCase() : s.charAt(i).toLowerCase();
    }
    return out;
  }

  function decimalsOf(opts) {
    var d = opts && opts.betDecimals;
    return d === 2 ? 2 : 1;
  }

  /**
   * url(spot, node, opts) -> { url: string|null, verified: boolean, note: string }
   *   node 'cb'       : BTN の CB 判断ノード（確認済・既定）。history_spot=hs、flop_actions=X
   *   node 'bbfacing' : BB 応答ノード（要実機確認）。history_spot=hs+1、flop_actions=X-B{bet}
   *     {bet} は betBB(pot,size).toFixed(opts.betDecimals ?? 1)（1桁：B1.8／B2.8、2桁：B1.82／B2.75）
   *   villainPos が PRE_BY_POS に無い場合は url null。
   */
  function url(spot, node, opts) {
    spot = spot || {};
    var p = preOf(spot.villainPos);
    if (!p) {
      return { url: null, verified: false, note: "未対応ポジション（トライアルは BTN のみ）" };
    }
    var board = normBoard(spot.board);
    if (!board) {
      return { url: null, verified: false, note: "ボードが未指定" };
    }
    var head = BASE + "&preflop_actions=" + p.pre;

    if (node === "bbfacing") {
      var pot = isNum(spot.pot) ? spot.pot : potOf(spot.villainPos);
      var bet = betBB(pot, spot.size);
      if (!isNum(bet)) {
        return { url: null, verified: false, note: "ベットサイズが未指定" };
      }
      var dec = decimalsOf(opts);
      var betStr = bet.toFixed(dec);
      return {
        url: head + "&flop_actions=" + p.flop + "-B" + betStr + "&history_spot=" + (p.hs + 1) + "&board=" + board,
        verified: false,
        note: "要実機確認：BB 応答ノードへ直接着地する形式（bet 小数" + dec + "桁）。Settings のテストリンクで ok になるまで副リンク"
      };
    }

    // 既定 'cb'
    return {
      url: head + "&flop_actions=" + p.flop + "&history_spot=" + p.hs + "&board=" + board,
      verified: true,
      note: "着地後、ベットサイズ（33%/50%）をクリックすると BB 応答ノード"
    };
  }

  /** testUrl(betDecimals = 1) -> string。K75r 33% の bbfacing 確認用。Settings は 1 と 2 の2本を出す。 */
  function testUrl(betDecimals) {
    var r = url(TEST_SPOT, "bbfacing", { betDecimals: betDecimals === 2 ? 2 : 1 });
    return r.url;
  }

  PD.wizard = {
    BASE: BASE,
    PRE_BY_POS: PRE_BY_POS,
    TEST_SPOT: TEST_SPOT,
    potOf: potOf,
    betBB: betBB,
    url: url,
    testUrl: testUrl
  };
})();

if (typeof module !== "undefined") module.exports = PD.wizard;
