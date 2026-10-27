// premise-drill: PD.sheet（T3）。純粋・依存なし。
// 前提票の欄定義（SHEET_V1 / EXTRA_FIELDS）、充足判定（isFilled）、順序ロック（openIndex）、
// コミット可否（canCommit）、確信度上限（confidenceCap）、ハンド名検証、純ランク並びの検知、
// 事後検算（postCheck。カード判定は cardsApi として注入され、PD.cards は参照しない）、judge 用直列化（toText）。
// コミット前は「充足＋算術整合」だけを見る。正誤判定はここでは一切しない。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.sheet = (function () {
  'use strict';

  var RANKS = 'AKQJT98765432';
  // 'A4s' / 'AKo' / '55' 形式。同ランクは接尾辞無し、異ランクは s|o 必須（判定は validHandName）
  var HAND_RE = /^([AKQJT2-9])([AKQJT2-9])([so])?$/;
  // 'Ad4d' 形式（具体2枚）
  var CARD_HAND_RE = /^([AKQJT2-9])([shdc])([AKQJT2-9])([shdc])$/;

  var SUM_TOL = 5;   // f2：3バケツ合計 100±5
  var AIR_TOL = 5;   // f4：純air% と (f2.trash − f3.shiftPct) の差 ±5
  var HINT_CAP = 70; // ヒント使用時の確信度上限
  var FULL_CAP = 100;

  var SPEED_OPTIONS = { foldChips: [20, 25, 30, 35, 40, 45, 50], maxFoldList: 3 };

  // 最低件数（slow/normal）。speed は縮約（foldList は 1 以上 maxFoldList 以下、examples 任意）
  var MIN = { examples: 2, foldList: 3, nextLayer: 1, pfRemoved: 2, rankTable: 3, speedFoldList: 1 };

  // ---- 欄定義 ------------------------------------------------------------

  /**
   * @typedef {{ id:string, slot:number, label:string,
   *   kind:'number'|'buckets'|'draws'|'foldlist'|'hero'|'handlist'|'select'|'yn'|'table'|'text',
   *   required:boolean, hints?:[string,string], extra?:boolean,
   *   note?:string, min?:number, compact?:boolean }} Field
   * note＝固定注記（UI がそのまま表示）、min＝リスト欄の最低件数、compact＝speed の縮約表示（buildSheet が付ける）
   */

  var SHEET_V1 = [
    {
      id: 'f1', slot: 10, label: '① サイズ→必要 fold%', kind: 'number', required: true,
      hints: [
        'この額のブラフが0EVになるには自レンジの何%が降りる？',
        'α＝bet÷(pot＋bet)。実践値は純αより少し多めに降りる'
      ]
    },
    {
      id: 'f2', slot: 20, label: '② 自レンジ3バケツ%', kind: 'buckets', required: true,
      note: '3betに回った上位とプリフロで降りた下位は居ない',
      hints: [
        'このボードで A や K が当たった手はどのバケツへ？',
        'アンカー：ポケット13／Aハイ23／Kハイ18／残り46。ボードの各ランクが当たる分だけペアへ移す（9・8・7 はスーコネ帯で厚い）'
      ]
    },
    {
      id: 'f3', slot: 30, label: '③ trash の中でドロー持ち', kind: 'draws', required: true, min: MIN.examples,
      hints: [
        'ボードの中位・下位カードの周りに、1枚で付くストレートドローはある？（2トーンなら FD も）',
        'コネクテッドなボードほど trash が守り側へ移り、fold の負担はドロー無しの弱ハイカードへ移る'
      ]
    },
    {
      id: 'f4', slot: 40, label: '④ fold 組を弱い順に名指し', kind: 'foldlist', required: true, min: MIN.foldList,
      hints: [
        '純air を全部降ろして①に足りる？足りないなら、次に弱い層はどの手？',
        '先に数えて名指しし、その後で「足りる・足りない」を言う（印象から入らない）'
      ]
    },
    {
      id: 'f5', slot: 50, label: '⑤ 自分のハンドはどこ', kind: 'hero', required: true,
      hints: [
        'キッカーのスートはボードに何枚ある？',
        '「Aハイだから」で終わらせない。ドロー付きの弱ハイカードが、ドロー無しの強ハイカードより上に来ることがある'
      ]
    }
  ];

  // 再発で足される欄（スロット位置固定）。values.extra[slotId] に値を持つ
  //   pf_removed   : string[]                              ハンド名 最低2
  //   baseline_src : { src: string, value: number }        出典（暗記表／Stage）＋暗記値
  //   rule_cond    : { rule: string, cond: 'Y'|'N' }       引用した則「条件→則」＋条件成立
  //   rank_table   : { hand: string, beats: string, bd: string }[]   最低3行（BD 無しは「無し」と書く）
  //   anti_mid     : { yn: 'Y'|'N', reason: string }       極端側を先に書いたか＋理由
  var EXTRA_FIELDS = {
    pf_removed: {
      id: 'pf_removed', slot: 15, label: 'プリフロで抜けた手（3betへ回った上位／fold した下位）',
      kind: 'handlist', required: true, extra: true, min: MIN.pfRemoved
    },
    baseline_src: {
      id: 'baseline_src', slot: 12, label: '出典（暗記表／Stage）＋暗記値',
      kind: 'select', required: true, extra: true
    },
    rule_cond: {
      id: 'rule_cond', slot: 35, label: '引用した則：条件→則／条件成立 Y/N',
      kind: 'text', required: true, extra: true
    },
    rank_table: {
      id: 'rank_table', slot: 38, label: '手／このストリートで勝てる相手の手 or アウツ／BD',
      kind: 'table', required: true, extra: true, min: MIN.rankTable
    },
    anti_mid: {
      id: 'anti_mid', slot: 55, label: '極端側（pure fold／pure call）を先に書いたか Y/N＋理由',
      kind: 'yn', required: true, extra: true
    }
  };

  function cloneField(f) {
    var out = {};
    var k;
    for (k in f) if (Object.prototype.hasOwnProperty.call(f, k)) out[k] = f[k];
    if (f.hints) out.hints = [f.hints[0], f.hints[1]];
    return out;
  }

  /**
   * 欄の並びを作る。slot 昇順。speed は extra 無し・compact:true・ヒント無し。
   * normal はヒント無し（ヒントは slow のみ）。未知の extra id は無視、重複は1つ。
   */
  function buildSheet(extraIds, tempo) {
    var t = tempo || 'slow';
    var speed = t === 'speed';
    var fields = SHEET_V1.map(cloneField);
    var seen = {};
    if (!speed && Array.isArray(extraIds)) {
      extraIds.forEach(function (id) {
        if (!id || seen[id] || !EXTRA_FIELDS[id]) return;
        seen[id] = true;
        fields.push(cloneField(EXTRA_FIELDS[id]));
      });
    }
    fields.sort(function (a, b) { return a.slot - b.slot; });
    fields.forEach(function (f) {
      if (speed) f.compact = true;
      if (t !== 'slow') delete f.hints;
    });
    return fields;
  }

  function emptyValues() {
    return {
      f1: { foldPct: null },
      f2: { trash: null, hi: null, pairPlus: null },
      f3: { noDraw: false, drawRanks: [], shiftPct: null, examples: [] },
      f4: { pureAirPct: null, enough: null, foldList: [], nextLayer: [] },
      f5: { bdfd: false, bdsd: false, gut: false, oesd: false, kickerNote: '',
            position: null, action: null, confidence: null },
      extra: {},
      _ts: {}
    };
  }

  // ---- 小道具 ------------------------------------------------------------

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function inRange(v, lo, hi) { return isNum(v) && v >= lo && v <= hi; }
  function isStr(v) { return typeof v === 'string' && v.trim().length > 0; }
  function isRank(ch) { return typeof ch === 'string' && ch.length === 1 && RANKS.indexOf(ch) >= 0; }
  function rankVal(ch) { return isRank(ch) ? 14 - RANKS.indexOf(ch) : null; }
  function sortRanks(arr) {
    return arr.slice().sort(function (a, b) { return RANKS.indexOf(a) - RANKS.indexOf(b); });
  }

  /** 'A4s' / 'AKo' / '55' または 'Ad4d'。同ランクは接尾辞無し、異ランクは s|o 必須 */
  function validHandName(s) {
    if (typeof s !== 'string') return false;
    var m = HAND_RE.exec(s);
    if (m) {
      if (m[1] === m[2]) return !m[3];
      return !!m[3];
    }
    var c = CARD_HAND_RE.exec(s);
    if (c) return !(c[1] === c[3] && c[2] === c[4]); // 同一カード2枚は不正
    return false;
  }

  /** ハンド名のハイカード（高い方のランク）の数値。不正なら null */
  function hiRank(s) {
    if (!validHandName(s)) return null;
    var m = HAND_RE.exec(s);
    var a, b;
    if (m) { a = rankVal(m[1]); b = rankVal(m[2]); }
    else { var c = CARD_HAND_RE.exec(s); a = rankVal(c[1]); b = rankVal(c[3]); }
    return Math.max(a, b);
  }

  function allValidHands(list) {
    return Array.isArray(list) && list.every(validHandName);
  }

  /**
   * 先頭ランク（ハイカード）の数値が list 全体で単調（非増加 または 非減少、同値可）なら true。
   * 要素3未満、または不正なハンド名を含むなら false。ドロー性を無視した「純ランク並び」の検知。
   */
  function detectRankOrder(list) {
    if (!Array.isArray(list) || list.length < 3) return false;
    var vals = [];
    for (var i = 0; i < list.length; i++) {
      var v = hiRank(list[i]);
      if (v === null) return false;
      vals.push(v);
    }
    var nonInc = true, nonDec = true;
    for (var j = 1; j < vals.length; j++) {
      if (vals[j] > vals[j - 1]) nonInc = false;
      if (vals[j] < vals[j - 1]) nonDec = false;
    }
    return nonInc || nonDec;
  }

  /** ヒントを1つでも使っていれば 70、無ければ 100 */
  function confidenceCap(hints) {
    return (Array.isArray(hints) && hints.length > 0) ? HINT_CAP : FULL_CAP;
  }

  // ---- 充足判定 ----------------------------------------------------------

  function ok() { return { ok: true, msg: '' }; }
  function ng(msg) { return { ok: false, msg: msg }; }

  function checkF1(v) {
    if (!v || !inRange(v.foldPct, 0, 100)) return ng('①必要 fold% を 0〜100 で入力');
    return ok();
  }

  function checkF2(v) {
    if (!v || !isNum(v.trash) || !isNum(v.hi) || !isNum(v.pairPlus)) return ng('②3バケツ（trash／ハイカード／ペア以上）を全て入力');
    if (v.trash < 0 || v.hi < 0 || v.pairPlus < 0) return ng('②3バケツに負の値がある');
    var sum = v.trash + v.hi + v.pairPlus;
    if (Math.abs(sum - 100) > SUM_TOL) return ng('②3バケツの合計が 100±' + SUM_TOL + ' でない（現在 ' + sum + '）');
    return ok();
  }

  function checkF3(v, compact) {
    if (!v) return ng('③ドローのランク選択か「ドロー無し」宣言');
    var noDraw = v.noDraw === true;
    var ranks = Array.isArray(v.drawRanks) ? v.drawRanks : [];
    if (!ranks.every(isRank)) return ng('③ランクは A〜2 から選ぶ');
    if (!noDraw && ranks.length === 0) return ng('③ドローのランクを選ぶか「ドロー無し」を宣言');
    if (noDraw && ranks.length > 0) return ng('③「ドロー無し」宣言とランク選択が両立している');
    if (!inRange(v.shiftPct, 0, 100)) return ng('③守る側に移る量%（レンジ全体比）を入力');
    // noDraw は「1枚でのストレートドローが無い」の宣言。FD・バックドアの移動量（shiftPct）は別なので 0 を強制しない
    var ex = Array.isArray(v.examples) ? v.examples : [];
    if (!allValidHands(ex)) return ng('③例のハンド名が不正（A4s／AKo／55 形式）');
    if (!compact && v.shiftPct > 0 && ex.length < MIN.examples) return ng('③移る手の例を最低' + MIN.examples + 'つ（移る量 0 なら省略可）');
    return ok();
  }

  function checkF4(v, values, compact) {
    if (!v) return ng('④純air%（レンジ全体比）を入力');
    var f2 = values && values.f2, f3 = values && values.f3;
    if (!inRange(v.pureAirPct, 0, 100)) return ng('④純air%（レンジ全体比）を入力');
    if (!f2 || !isNum(f2.trash) || !f3 || !isNum(f3.shiftPct)) return ng('④の前に②trash と③移る量を埋める');
    var expect = f2.trash - f3.shiftPct;
    if (Math.abs(v.pureAirPct - expect) > AIR_TOL) {
      return ng('④純air% が ②trash−③移る量（' + expect + '%）と ±' + AIR_TOL + ' を超えて離れている');
    }
    var enough = compact ? (v.enough || 'yes') : v.enough;
    if (enough !== 'yes' && enough !== 'no') return ng('④「必要 fold% に足りる？」を選ぶ');
    var list = Array.isArray(v.foldList) ? v.foldList : [];
    if (!allValidHands(list)) return ng('④fold 組のハンド名が不正（A4s／AKo／55 形式）');
    var minList = compact ? MIN.speedFoldList : MIN.foldList;
    if (list.length < minList) return ng('④fold 組を弱い順に最低' + minList + 'つ名指し');
    if (compact && list.length > SPEED_OPTIONS.maxFoldList) return ng('④speed では fold 組は最大' + SPEED_OPTIONS.maxFoldList + 'つ');
    if (!compact && enough === 'no') {
      var next = Array.isArray(v.nextLayer) ? v.nextLayer : [];
      if (!allValidHands(next)) return ng('④次の層のハンド名が不正');
      if (next.length < MIN.nextLayer) return ng('④足りないなら次の層から捻出する手を最低' + MIN.nextLayer + 'つ');
    }
    return ok();
  }

  function checkF5(v, compact) {
    if (!v) return ng('⑤2枚チェック・キッカー・位置・判定・確信度を入力');
    if (!compact) {
      var keys = ['bdfd', 'bdsd', 'gut', 'oesd'];
      for (var i = 0; i < keys.length; i++) {
        if (typeof v[keys[i]] !== 'boolean') return ng('⑤2枚チェック（BDFD／BDSD／ガット／オープンエンド）を確認');
      }
      if (!isStr(v.kickerNote)) return ng('⑤キッカーメモを入力');
    }
    if (v.position !== 'in' && v.position !== 'edge' && v.position !== 'above') return ng('⑤fold 組の中／境界／上を選ぶ');
    if (v.action !== 'call' && v.action !== 'fold') return ng('⑤call／fold を選ぶ');
    // slow/normal は必須。speed は省略可だが、入っているなら 0〜100
    var hasConf = v.confidence !== null && v.confidence !== undefined;
    if (!compact || hasConf) {
      if (!inRange(v.confidence, 0, 100)) return ng('⑤確信度%を入力');
    }
    return ok();
  }

  function ynOf(v) {
    if (v === 'Y' || v === true) return 'Y';
    if (v === 'N' || v === false) return 'N';
    return null;
  }

  function checkExtra(field, values) {
    var ex = values && values.extra ? values.extra[field.id] : undefined;
    var L = field.label;
    switch (field.id) {
      case 'pf_removed': {
        var list = Array.isArray(ex) ? ex : [];
        if (!allValidHands(list)) return ng(L + '：ハンド名が不正');
        if (list.length < MIN.pfRemoved) return ng(L + '：最低' + MIN.pfRemoved + 'つ');
        return ok();
      }
      case 'baseline_src': {
        if (!ex || !isStr(ex.src)) return ng(L + '：出典を選ぶ');
        if (!inRange(ex.value, 0, 100)) return ng(L + '：暗記値を入力');
        return ok();
      }
      case 'rule_cond': {
        if (!ex || !isStr(ex.rule)) return ng(L + '：「条件→則」を1行');
        if (ynOf(ex.cond) === null) return ng(L + '：条件成立 Y/N を選ぶ');
        return ok();
      }
      case 'rank_table': {
        var rows = Array.isArray(ex) ? ex : [];
        if (rows.length < MIN.rankTable) return ng(L + '：最低' + MIN.rankTable + '行');
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i] || {};
          if (!validHandName(r.hand)) return ng(L + '：' + (i + 1) + '行目の手が不正');
          if (!isStr(r.beats)) return ng(L + '：' + (i + 1) + '行目の「勝てる相手の手 or アウツ」が空');
          if (!isStr(r.bd)) return ng(L + '：' + (i + 1) + '行目の BD が空（無ければ「無し」）');
        }
        return ok();
      }
      case 'anti_mid': {
        if (!ex || ynOf(ex.yn) === null) return ng(L + '：Y/N を選ぶ');
        if (!isStr(ex.reason)) return ng(L + '：理由を入力');
        return ok();
      }
      default:
        return ng('未知の追加欄：' + field.id);
    }
  }

  /**
   * 充足＋算術整合のみ。正誤判定はしない。
   * f3: noDraw は(a)ストレートドローの宣言のみ（FD・BD があれば shiftPct>0 でよい）。f4: pureAirPct が f2.trash − f3.shiftPct と ±5 以内。
   * field.compact（speed）では③例は任意、④enough は自動で yes・nextLayer 省略・foldList 1〜3、⑤2枚チェック・キッカー・確信度は省略可。
   */
  function isFilled(field, values, spot) {
    if (!field || !field.id) return ng('欄が不正');
    var v = values || {};
    var compact = field.compact === true;
    switch (field.id) {
      case 'f1': return checkF1(v.f1);
      case 'f2': return checkF2(v.f2);
      case 'f3': return checkF3(v.f3, compact);
      case 'f4': return checkF4(v.f4, v, compact);
      case 'f5': return checkF5(v.f5, compact);
      default:
        if (field.extra || EXTRA_FIELDS[field.id]) return checkExtra(field, v);
        return ng('未知の欄：' + field.id);
    }
  }

  /** 最初に未充足の欄の index。全充足なら fields.length */
  function openIndex(fields, values, spot) {
    var fs = Array.isArray(fields) ? fields : [];
    for (var i = 0; i < fs.length; i++) {
      if (!isFilled(fs[i], values, spot).ok) return i;
    }
    return fs.length;
  }

  /** 全欄充足でコミット可。missing は未充足の欄名（label） */
  function canCommit(fields, values, spot) {
    var fs = Array.isArray(fields) ? fields : [];
    var missing = [];
    fs.forEach(function (f) {
      if (!isFilled(f, values, spot).ok) missing.push(f.label || f.id);
    });
    return { ok: missing.length === 0, missing: missing };
  }

  // ---- 事後検算（コミット後。採点には使わない） ---------------------------

  function diff(a, b) { // a − b
    return a.filter(function (x) { return b.indexOf(x) < 0; });
  }
  function uniq(arr) {
    var out = [];
    arr.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /**
   * cardsApi は呼び出し側（app/truth）が PD.cards を渡す。ここでは PD.cards を参照しない。
   * drawRanksMissing＝ボード上に在るのに③で挙げなかったランク、drawRanksExtra＝③で挙げたが無いランク。
   * heroFeatMismatch＝⑤の2枚チェック（boolean のもののみ比較）と handFeatures の不一致キー。
   * rankOrder＝④の fold 組が純ランク並び（detectRankOrder）。
   */
  function postCheck(values, spot, cardsApi) {
    var v = values || {};
    var sp = spot || {};
    var api = cardsApi || {};
    var out = { drawRanksMissing: [], drawRanksExtra: [], heroFeatMismatch: [], rankOrder: false };

    if (typeof api.drawRanks === 'function' && sp.board) {
      var dr = api.drawRanks(sp.board) || {};
      var truth = uniq([].concat(Array.isArray(dr.gut) ? dr.gut : [], Array.isArray(dr.oesd) ? dr.oesd : []));
      var f3 = v.f3 || {};
      var declared = f3.noDraw === true ? [] : uniq(Array.isArray(f3.drawRanks) ? f3.drawRanks : []);
      out.drawRanksMissing = sortRanks(diff(truth, declared));
      out.drawRanksExtra = sortRanks(diff(declared, truth));
    }

    if (typeof api.handFeatures === 'function' && sp.hero && sp.board) {
      var hf = api.handFeatures(sp.hero, sp.board) || {};
      var f5 = v.f5 || {};
      ['bdfd', 'bdsd', 'gut', 'oesd'].forEach(function (k) {
        if (typeof f5[k] !== 'boolean') return; // speed 等で省略された項目は比較しない
        if (f5[k] !== !!hf[k]) out.heroFeatMismatch.push(k);
      });
    }

    out.rankOrder = detectRankOrder((v.f4 && v.f4.foldList) || []);
    return out;
  }

  // ---- judge 用直列化 ----------------------------------------------------

  function fmtNum(v) { return isNum(v) ? String(v) : '未記入'; }
  function fmtPct(v) { return isNum(v) ? v + '%' : '未記入'; }
  function fmtBool(v) { return v === true ? '有' : v === false ? '無' : '未記入'; }
  function fmtList(arr) { return Array.isArray(arr) && arr.length ? arr.join(',') : '無し'; }
  function fmtStr(s) { return isStr(s) ? s.trim() : '未記入'; }
  function fmtYn(v) { var y = ynOf(v); return y === null ? '未記入' : y; }
  var POS_LABEL = { in: 'fold組の中', edge: '境界', above: 'fold組の上' };
  var ENOUGH_LABEL = { yes: '足りる', no: '足りない' };

  function extraText(field, ex) {
    switch (field.id) {
      case 'pf_removed':
        return fmtList(ex);
      case 'baseline_src':
        return ex ? ('出典 ' + fmtStr(ex.src) + '／暗記値 ' + fmtPct(ex.value)) : '未記入';
      case 'rule_cond':
        return ex ? ('則「' + fmtStr(ex.rule) + '」／条件成立 ' + fmtYn(ex.cond)) : '未記入';
      case 'rank_table':
        if (!Array.isArray(ex) || !ex.length) return '未記入';
        return ex.map(function (r) {
          r = r || {};
          return fmtStr(r.hand) + '｜' + fmtStr(r.beats) + '｜BD ' + fmtStr(r.bd);
        }).join('； ');
      case 'anti_mid':
        return ex ? (fmtYn(ex.yn) + '／' + fmtStr(ex.reason)) : '未記入';
      default:
        return ex === undefined ? '未記入' : JSON.stringify(ex);
    }
  }

  /** judge 用の日本語直列化（⑦ buildPrompt の【前提票】部分） */
  function toText(values, fields) {
    var v = values || {};
    var fs = Array.isArray(fields) && fields.length ? fields.slice() : SHEET_V1.map(cloneField);
    fs.sort(function (a, b) { return a.slot - b.slot; });
    var lines = [];
    fs.forEach(function (f) {
      var x;
      switch (f.id) {
        case 'f1':
          x = v.f1 || {};
          lines.push('①必要fold%=' + fmtNum(x.foldPct));
          break;
        case 'f2':
          x = v.f2 || {};
          lines.push('②trash=' + fmtPct(x.trash) + ' ハイカード=' + fmtPct(x.hi) + ' ペア以上=' + fmtPct(x.pairPlus));
          break;
        case 'f3':
          x = v.f3 || {};
          lines.push('③ドロー：' + (x.noDraw === true ? '無しと宣言' : fmtList(x.drawRanks)) +
            '／守る側に移る ' + fmtPct(x.shiftPct) + '（レンジ全体比）／例 ' + fmtList(x.examples));
          break;
        case 'f4':
          x = v.f4 || {};
          lines.push('④純air=' + fmtPct(x.pureAirPct) + '／足りる=' + (ENOUGH_LABEL[x.enough] || '未記入') +
            '／fold組（弱い順）' + fmtList(x.foldList) + '／次の層 ' + fmtList(x.nextLayer));
          break;
        case 'f5':
          x = v.f5 || {};
          lines.push('⑤2枚チェック BDFD=' + fmtBool(x.bdfd) + ' BDSD=' + fmtBool(x.bdsd) +
            ' ガット=' + fmtBool(x.gut) + ' オープンエンド=' + fmtBool(x.oesd) +
            '／キッカー ' + fmtStr(x.kickerNote) + '／位置=' + (POS_LABEL[x.position] || '未記入') +
            '／判定=' + (x.action || '未記入') + '／確信度=' + fmtPct(x.confidence));
          break;
        default:
          if (f.extra || EXTRA_FIELDS[f.id]) {
            lines.push('追加欄：' + (f.label || f.id) + '：' + extraText(f, v.extra ? v.extra[f.id] : undefined));
          }
      }
    });
    return lines.join('\n');
  }

  return {
    SHEET_V1: SHEET_V1,
    EXTRA_FIELDS: EXTRA_FIELDS,
    SPEED_OPTIONS: SPEED_OPTIONS,
    buildSheet: buildSheet,
    emptyValues: emptyValues,
    isFilled: isFilled,
    openIndex: openIndex,
    canCommit: canCommit,
    confidenceCap: confidenceCap,
    validHandName: validHandName,
    detectRankOrder: detectRankOrder,
    postCheck: postCheck,
    toText: toText
  };
})();

if (typeof module !== 'undefined') module.exports = PD.sheet;
