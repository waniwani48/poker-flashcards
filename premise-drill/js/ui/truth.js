// premise-drill: PD.ui.truth（T10）。Truth 画面（コミット後にのみ入れる）。
//   封印票（ヘッダに cls ラベルをここで初表示）／Wizard 主・副リンク（PD.wizard.url と settings.wizardBfacing /
//   wizardBetDecimals で決定、target=_blank rel=noopener）／真値入力（必須3・任意3）／
//   事後検算（PD.sheet.postCheck に PD.cards を注入）／自己採点4＋○候補（暗記値 gaps.BASELINE_FOLD 基準、真値差は参考）／
//   Claude ブロック4状態（PD.judge.judge）／型選択（初期値：Claude gap_type > PD.gaps.hintFor > none、確定は本人）／
//   自己採点と Claude の3点差分岐（どちらを採るか、両方残す）／保存（ctx.saveOutcome。直前に recordOutcome を
//   純粋関数として先読みし「欄が増えました」カードを出す）。
// 構成（node で検証できるよう2層に分ける）：
//   html(ctx) -> string        純粋。document / window を使わない（画面全体の HTML。候補・合計・保存可否も文字列に含める）
//   render(root, ctx)          html(ctx) を流し込み、イベント結線と in-place 更新だけを行う
// 他の UI モジュールは参照しない。状態は ctx 経由のみ（入力は input/change で ctx.entry に即時退避）。
// 差し戻し・差分・警告は lamp 系（または ink）で表示し、umber は使わない。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.ui.truth = (function () {
  'use strict';

  // ---- 依存解決（ブラウザは読込順で PD に揃っている。node テストでは require で補う）----
  function dep(name, rel) {
    if (PD[name]) return PD[name];
    if (typeof require === 'function') {
      try { return require(rel); } catch (e) { /* その環境に無い */ }
    }
    return null;
  }

  function esc(s) {
    var u = dep('util', '../util');
    if (u && typeof u.esc === 'function') return u.esc(s);
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 定数（表示ラベルと判定の幅。ソルバー数値・暗記値はここに置かない）----
  var CLS_LABEL = {
    dry_high: 'ドライ・ハイカード', bw_sd: 'ブロードウェイSD', mid: 'ミドル', low: 'ロー',
    paired: 'ペアード', mono: 'モノトーン', trips: 'トリップス'
  };
  var SUIT_LABEL = { rainbow: 'レインボー', twotone: '2トーン', mono: 'モノ' };
  var FEAT_LABEL = { bdfd: 'BDFD', bdsd: 'BDSD', gut: 'ガット', oesd: 'オープンエンド' };
  var MODE_LABEL = { drill: 'ドリル', speed: '速度', live: '実戦' };
  var SCORE_IDS = ['procedure', 'sizeFold', 'drawProtect', 'action'];
  var SCORE_OPTIONS = { procedure: [0, 3], sizeFold: [0, 1, 2], drawProtect: [0, 2, 4], action: [0, 1] };
  var ERR_LABEL = {
    NO_KEY: 'API キーが未設定',
    BAD_KEY: 'API キーが無効（401）',
    HTTP: 'API エラー',
    NET: 'ネットワークエラー（file:// からは呼べないことがある）',
    PARSE: '応答を読めなかった',
    TRUNC: '応答が途中で切れた',
    REFUSAL: '採点が拒否された'
  };
  var SUM_TOL = 5;      // 自分のハンド fold/call/raise と3バケツ実測の合計 100±5
  var SIZE_TOL_2 = 5;   // ①と暗記値の差 ±5pt → サイズ2点候補
  var SIZE_TOL_1 = 10;  // ±10pt → 1点候補
  var BRANCH_GAP = 3;   // 自己採点と Claude がこれ以上離れたら「どちらを採るか」
  var FOLD_LINE = 50;   // 真値 heroFold がこれ以上なら答えは fold

  // 画面内だけの一時状態（entry が変わると捨てる。保存データには入れない）
  var session = { ref: null, gapTouched: false, judgeErr: null, saved: false, preview: null };
  function sessionFor(entry) {
    if (session.ref !== entry) session = { ref: entry, gapTouched: false, judgeErr: null, saved: false, preview: null };
    return session;
  }

  // ---- 小道具 ----
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function inRange(v, lo, hi) { return isNum(v) && v >= lo && v <= hi; }
  function toNum(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).trim();
    if (!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }
  function fmt(v) { return isNum(v) ? String(v) : '—'; }
  function signed(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '±')) + Math.abs(n); }
  function modeOf(entry, ctx) { return (entry && entry.mode) || (ctx && ctx.mode) || 'drill'; }
  function q(el, sel) { return el ? el.querySelector(sel) : null; }
  function all(el, sel) { return el ? Array.prototype.slice.call(el.querySelectorAll(sel)) : []; }
  function isConnected(el) {
    if (!el) return false;
    if (typeof el.isConnected === 'boolean') return el.isConnected;
    return !!(typeof document !== 'undefined' && document.body && document.body.contains(el));
  }

  function gapTypes() {
    var G = dep('gaps', '../gaps');
    return (G && Array.isArray(G.GAP_TYPES)) ? G.GAP_TYPES : [];
  }
  function gapIds() { return gapTypes().map(function (g) { return g.id; }); }
  function gapLabel(id) {
    var list = gapTypes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id ? String(id) : '';
  }
  function gapCue(id) {
    var list = gapTypes();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].cue || '';
    return '';
  }
  function rubric() {
    var G = dep('gaps', '../gaps');
    return (G && Array.isArray(G.RUBRIC)) ? G.RUBRIC : [];
  }
  /** 暗記値（置き場は gaps.BASELINE_FOLD の1箇所）。無いサイズは null */
  function baselineOf(size) {
    var G = dep('gaps', '../gaps');
    var b = (G && G.BASELINE_FOLD) ? G.BASELINE_FOLD[size] : undefined;
    return isNum(b) ? b : null;
  }
  function slotLabel(id) {
    var S = dep('sheet', '../sheet');
    var f = S && S.EXTRA_FIELDS ? S.EXTRA_FIELDS[id] : null;
    return (f && f.label) ? f.label : String(id || '');
  }

  // ---- cls ラベル（Truth 以降でのみ表示。例「ブロードウェイSD・2トーン」）----
  function clsLabel(spot) {
    var sp = spot || {};
    var cls = sp.cls;
    var suit = sp.suit;
    if ((!cls || !suit) && sp.board) {
      var C = dep('cards', '../cards');
      if (C && typeof C.classifyBoard === 'function') {
        try {
          var r = C.classifyBoard(sp.board);
          cls = cls || r.cls;
          suit = suit || r.suit;
        } catch (e) { /* ボードが読めなければ手持ちの値だけで */ }
      }
    }
    var a = CLS_LABEL[cls] || (cls ? String(cls) : '不明');
    if (cls === 'mono' || cls === 'trips' || !suit) return a;
    return a + '・' + (SUIT_LABEL[suit] || String(suit));
  }

  /** generator の FAMILIES（あれば）から族ラベル。無ければ null */
  function familyLabel(spot) {
    var gen = PD.gen;
    var list = (gen && Array.isArray(gen.FAMILIES)) ? gen.FAMILIES : null;
    if (!list || !spot || !spot.family) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === spot.family && list[i].label) return list[i].label;
    }
    return null;
  }

  // ---- Wizard 主・副リンク ----
  /**
   * 既定は確認済の cb ノードが主（手順文つき）。settings.wizardBfacing==='ok' のときだけ bbfacing が主になる。
   * bbfacing の bet 小数桁は settings.wizardBetDecimals（1|2）。villainPos 未対応なら url null（表示は注記のみ）。
   */
  function wizardLinks(spot, settings) {
    var W = dep('wizard', '../wizard');
    if (!W || typeof W.url !== 'function') return { main: null, sub: null };
    var s = settings || {};
    var dec = s.wizardBetDecimals === 2 ? 2 : 1;
    var cb = W.url(spot, 'cb');
    var bf = W.url(spot, 'bbfacing', { betDecimals: dec });
    var bfOk = s.wizardBfacing === 'ok' || (bf.verified === true && s.wizardBfacing !== 'ng');
    var cbLink = {
      node: 'cb', url: cb.url, verified: cb.verified === true, tag: '確認済',
      label: 'Wizard で CB ノードを開く', note: cb.note || ''
    };
    var bfLink = {
      node: 'bbfacing', url: bf.url, verified: bfOk,
      tag: bfOk ? '確認済' : (s.wizardBfacing === 'ng' ? '要確認（ng 記録あり）' : '要確認'),
      label: 'Wizard で BB 応答ノードを開く',
      note: bfOk ? (bf.note || 'BB の応答ノードに直接着地する') : (bf.note || '')
    };
    return bfOk ? { main: bfLink, sub: cbLink } : { main: cbLink, sub: bfLink };
  }

  // ---- 真値ドラフト ----
  function emptyBuckets() { return { trash: null, hi: null, pairPlus: null }; }
  function truthDraft(entry) {
    var t = entry.truth;
    if (!t || typeof t !== 'object' || t.used === false) {
      var skip = !!(t && t.used === false);
      t = entry.truth = { used: true, rangeFoldPct: null, heroFold: null, heroCall: null, heroRaise: null, buckets: emptyBuckets(), note: '', skip: skip };
    }
    if (!t.buckets || typeof t.buckets !== 'object') t.buckets = emptyBuckets();
    if (typeof t.note !== 'string') t.note = '';
    if (typeof t.skip !== 'boolean') t.skip = false;
    if (t.used !== true) t.used = true;
    return t;
  }
  function selfDraft(entry) {
    var s = entry.selfScore;
    if (!s || typeof s !== 'object') s = entry.selfScore = { procedure: null, sizeFold: null, drawProtect: null, action: null, total: null };
    return s;
  }
  function bucketsCount(b) {
    b = b || {};
    return [b.trash, b.hi, b.pairPlus].filter(isNum).length;
  }
  function touchedTruth(t) {
    t = t || {};
    return [t.rangeFoldPct, t.heroFold, t.heroCall, t.heroRaise].some(isNum) || bucketsCount(t.buckets) > 0;
  }

  /**
   * 真値の検証。slow/live は必須（rangeFoldPct 0–100、hero fold/call/raise 各 0–100 で合計 100±5）。
   * 3バケツ実測は任意だが、入れるなら3つ全て（各 0–100、合計 100±5）。
   * speed はスキップ可（skip または何も入っていなければ used:false）。
   */
  function validateTruth(draft, mode) {
    var d = draft || {};
    var b = d.buckets || {};
    var msgs = [];
    if (mode === 'speed' && (d.skip === true || !touchedTruth(d))) {
      return { ok: true, truth: { used: false }, msgs: [] };
    }
    if (!inRange(d.rangeFoldPct, 0, 100)) msgs.push('レンジ全体の fold%（0〜100）');
    var trio = [d.heroFold, d.heroCall, d.heroRaise];
    if (!trio.every(function (v) { return inRange(v, 0, 100); })) {
      msgs.push('自分のハンドの fold／call／raise%（各 0〜100）');
    } else {
      var sum = trio[0] + trio[1] + trio[2];
      if (Math.abs(sum - 100) > SUM_TOL) msgs.push('自分のハンドの合計が 100±' + SUM_TOL + ' でない（現在 ' + sum + '）');
    }
    var bc = bucketsCount(b);
    if (bc > 0 && bc < 3) msgs.push('3バケツ実測は3つ全て入れるか空のままに');
    if (bc === 3) {
      if (![b.trash, b.hi, b.pairPlus].every(function (v) { return inRange(v, 0, 100); })) {
        msgs.push('3バケツ実測は各 0〜100');
      } else {
        var bs = b.trash + b.hi + b.pairPlus;
        if (Math.abs(bs - 100) > SUM_TOL) msgs.push('3バケツ実測の合計が 100±' + SUM_TOL + ' でない（現在 ' + bs + '）');
      }
    }
    if (msgs.length) return { ok: false, truth: null, msgs: msgs };
    return {
      ok: true, msgs: [],
      truth: {
        used: true,
        rangeFoldPct: d.rangeFoldPct, heroFold: d.heroFold, heroCall: d.heroCall, heroRaise: d.heroRaise,
        buckets: bc === 3 ? { trash: b.trash, hi: b.hi, pairPlus: b.pairPlus } : null,
        note: typeof d.note === 'string' ? d.note.trim() : ''
      }
    };
  }

  // ---- 自己採点の○候補（提示のみ）----
  /** |①−暗記値| ≤5 → 2候補、≤10 → 1候補、それ以上 0。暗記値の無いサイズ・①未記入は cand null */
  function sizeCandidate(entry) {
    var f1 = (entry && entry.sheet && entry.sheet.f1) || {};
    var base = baselineOf(entry && entry.spot ? entry.spot.size : undefined);
    var fp = isNum(f1.foldPct) ? f1.foldPct : null;
    if (fp === null || base === null) return { cand: null, diff: null, base: base, foldPct: fp };
    var diff = Math.abs(fp - base);
    return { cand: diff <= SIZE_TOL_2 ? 2 : (diff <= SIZE_TOL_1 ? 1 : 0), diff: diff, base: base, foldPct: fp };
  }
  /** ①と真値 rangeFoldPct の差（参考表示のみ）。どちらか無ければ null */
  function truthDiff(entry) {
    var f1 = (entry && entry.sheet && entry.sheet.f1) || {};
    var t = (entry && entry.truth) || {};
    if (!isNum(f1.foldPct) || !isNum(t.rangeFoldPct)) return null;
    return f1.foldPct - t.rangeFoldPct;
  }
  /** ⑤action と真値（heroFold≥50 → fold）の整合 → 1候補／0。真値が無ければ cand null */
  function actionCandidate(entry) {
    var f5 = (entry && entry.sheet && entry.sheet.f5) || {};
    var t = (entry && entry.truth) || {};
    var action = f5.action || null;
    if (!isNum(t.heroFold)) return { cand: null, truthAct: null, action: action };
    var truthAct = t.heroFold >= FOLD_LINE ? 'fold' : 'call';
    return { cand: action === truthAct ? 1 : 0, truthAct: truthAct, action: action };
  }
  function selfTotal(ss) {
    ss = ss || {};
    var sum = 0;
    for (var i = 0; i < SCORE_IDS.length; i++) {
      if (!isNum(ss[SCORE_IDS[i]])) return null;
      sum += ss[SCORE_IDS[i]];
    }
    return sum;
  }
  function completeSelf(ss) {
    var total = selfTotal(ss);
    if (total === null) return null;
    return { procedure: ss.procedure, sizeFold: ss.sizeFold, drawProtect: ss.drawProtect, action: ss.action, total: total };
  }
  function claudeScore(entry) {
    return (entry && entry.claude && isNum(entry.claude.score)) ? entry.claude.score : null;
  }
  /** 自己採点と Claude が BRANCH_GAP 以上離れている（両方そろっている時だけ）*/
  function needsBranch(entry) {
    var st = selfTotal(entry && entry.selfScore);
    var cs = claudeScore(entry);
    return st !== null && cs !== null && Math.abs(st - cs) >= BRANCH_GAP;
  }
  function pickScoreUsed(entry) {
    var st = selfTotal(entry.selfScore);
    var cs = claudeScore(entry);
    if (st !== null && cs !== null && Math.abs(st - cs) >= BRANCH_GAP) return entry.scoreUsed === 'claude' ? 'claude' : 'self';
    if (st !== null) return 'self';
    if (cs !== null) return 'claude';
    return 'self';
  }

  // ---- 表示文字列の計算（純粋。html と in-place 更新の両方がここを使う）----
  /** 自分のハンド fold/call/raise の合計表示 */
  function heroSum(t) {
    t = t || {};
    var trio = [t.heroFold, t.heroCall, t.heroRaise];
    if (!trio.every(isNum)) return { text: '自分のハンドの合計 —（100±' + SUM_TOL + '）', ng: false };
    var sum = trio[0] + trio[1] + trio[2];
    return { text: '自分のハンドの合計 ' + sum + '%（100±' + SUM_TOL + '）', ng: Math.abs(sum - 100) > SUM_TOL };
  }
  /** 真値の未充足メッセージ（触っていなければ空） */
  function truthMsg(t, mode) {
    var vt = validateTruth(t, mode);
    return (!vt.ok && touchedTruth(t)) ? ('未充足：' + vt.msgs.join('／')) : '';
  }
  /** 自己採点4項目の○候補と説明文。cand が null なら機械的候補なし */
  function candidates(entry) {
    var out = {};
    var text;
    var sc = sizeCandidate(entry);
    var td = truthDiff(entry);
    if (sc.cand === null) text = (sc.base === null ? '暗記値の無いサイズ（候補なし）' : '①が未記入（候補なし）');
    else text = '○候補 ' + sc.cand + ' 点：①=' + sc.foldPct + '%、暗記値 ' + sc.base + '% との差 ' + sc.diff + 'pt';
    text += '／真値との差 ' + (td === null ? '—（真値未入力）' : signed(td) + ' pt') + '（参考）';
    out.sizeFold = { cand: sc.cand, text: text };
    var ac = actionCandidate(entry);
    var t = (entry && entry.truth) || {};
    if (ac.cand === null) text = '真値（自分のハンド fold%）を入れると候補が出る';
    else text = '○候補 ' + ac.cand + ' 点：⑤=' + (ac.action || '未記入') + '、真値 fold ' + t.heroFold + '% → ' + ac.truthAct;
    out.action = { cand: ac.cand, text: text };
    var c = (entry && entry.commit) || {};
    var order = (Array.isArray(c.order) && c.order.length) ? c.order.join('→') : '未記録';
    out.procedure = { cand: null, text: '機械的な候補なし。入力順 ' + order + ' を見て本人が判定' };
    out.drawProtect = { cand: null, text: '機械的な候補なし。③のランク列挙と④の縮め方を見て本人が判定' };
    return out;
  }
  /** 下部バーの文言と保存可否 */
  function saveBarState(entry, mode, s) {
    if (s && s.saved) return { text: '上のカードを確認して保存', ok: true, disabled: true };
    var v = validateSave(entry, mode);
    return { text: v.ok ? '保存できる' : '未入力：' + v.missing.join('・'), ok: v.ok, disabled: !v.ok };
  }

  // ---- 事後検算の注記（採点には使わない）----
  function postNotes(entry) {
    var pc = (entry && entry.postCheck) || {};
    var sheet = (entry && entry.sheet) || {};
    var f3 = sheet.f3 || {};
    var f5 = sheet.f5 || {};
    var c = (entry && entry.commit) || {};
    var ft = c.fieldTimes || {};
    var order = Array.isArray(c.order) ? c.order : [];
    var notes = [];
    var miss = Array.isArray(pc.drawRanksMissing) ? pc.drawRanksMissing : [];
    var extra = Array.isArray(pc.drawRanksExtra) ? pc.drawRanksExtra : [];
    if (miss.length) {
      notes.push({ kind: 'draw', text: '③で挙げなかったストレートドローのランク：' + miss.join('・') + (f3.noDraw === true ? '（「ドロー無し」と宣言していた）' : '') });
    }
    if (extra.length) notes.push({ kind: 'draw', text: '③で挙げたがボードに無いランク：' + extra.join('・') });
    var mm = Array.isArray(pc.heroFeatMismatch) ? pc.heroFeatMismatch : [];
    if (mm.length) {
      var parts = mm.map(function (k) {
        var declared = f5[k] === true;
        return (FEAT_LABEL[k] || k) + '（票：' + (declared ? '有' : '無') + '／実際：' + (declared ? '無' : '有') + '）';
      });
      notes.push({ kind: 'hero', text: '⑤の2枚チェックと実際の差：' + parts.join('、') });
    }
    if (pc.rankOrder === true) {
      notes.push({ kind: 'rank', text: '④の fold 組がランク順（単調）の並びになっている。ドロー性で順位が入れ替わっていないか確認' });
    }
    var i3 = order.lastIndexOf('f3');
    var i4 = order.lastIndexOf('f4');
    var f4First = (i3 >= 0 && i4 >= 0 && i4 < i3) || (isNum(ft.f3) && isNum(ft.f4) && ft.f4 < ft.f3);
    if (f4First) notes.push({ kind: 'order', text: '④が③より先に完了している → 規則違い（rule）の候補' });
    if (isNum(ft.f1)) {
      var others = 0;
      var last = true;
      for (var k in ft) {
        if (!Object.prototype.hasOwnProperty.call(ft, k) || k === 'f1' || !isNum(ft[k])) continue;
        others++;
        if (ft[k] > ft.f1) { last = false; break; }
      }
      if (others > 0 && last) notes.push({ kind: 'order', text: '①が最後に完了している → 定石忘れ（baseline）の候補' });
    }
    return notes;
  }

  // ---- 型の初期値：Claude gap_type > hintFor の第1候補 > none ----
  function defaultGap(entry, log) {
    var G = dep('gaps', '../gaps');
    var ids = gapIds();
    var h = { suggest: null, reasons: [] };
    if (G && typeof G.hintFor === 'function') {
      try { h = G.hintFor(entry, Array.isArray(log) ? log : []) || h; } catch (e) { /* 手がかり無しとして続ける */ }
    }
    var cg = entry && entry.claude ? entry.claude.gap_type : null;
    if (cg && ids.indexOf(cg) >= 0) return { gap: cg, source: 'claude', reasons: h.reasons || [] };
    if (h.suggest && ids.indexOf(h.suggest) >= 0) return { gap: h.suggest, source: 'hint', reasons: h.reasons || [] };
    return { gap: 'none', source: 'none', reasons: h.reasons || [] };
  }

  /** judge・hintFor に渡す写し（真値と自己採点を検証済みの形にする。entry 本体は触らない）*/
  function judgeSnapshot(entry, mode) {
    var snap = {};
    for (var k in entry) if (Object.prototype.hasOwnProperty.call(entry, k)) snap[k] = entry[k];
    var vt = validateTruth(entry.truth, mode);
    snap.truth = vt.ok ? vt.truth : null;
    snap.selfScore = completeSelf(entry.selfScore);
    return snap;
  }

  // ---- 保存の検証・確定 ----
  function validateSave(entry, mode) {
    var missing = [];
    var vt = validateTruth(entry.truth, mode);
    if (!vt.ok) missing.push('真値');
    var ss = entry.selfScore || {};
    var n = SCORE_IDS.filter(function (k) { return isNum(ss[k]); }).length;
    if (mode === 'speed') {
      if (n > 0 && n < SCORE_IDS.length) missing.push('自己採点（残り ' + (SCORE_IDS.length - n) + ' 項目）');
    } else if (n < SCORE_IDS.length) {
      missing.push('自己採点（残り ' + (SCORE_IDS.length - n) + ' 項目）');
    }
    if (!entry.gap || gapIds().indexOf(entry.gap) < 0) missing.push('ズレの型');
    return { ok: missing.length === 0, missing: missing };
  }
  function finalize(entry, mode) {
    var vt = validateTruth(entry.truth, mode);
    entry.truth = vt.ok ? vt.truth : null;
    entry.selfScore = completeSelf(entry.selfScore);
    if (!entry.gap || gapIds().indexOf(entry.gap) < 0) entry.gap = 'none';
    entry.gapNote = typeof entry.gapNote === 'string' ? entry.gapNote.trim() : '';
    entry.scoreUsed = pickScoreUsed(entry);
    return entry;
  }

  /** recordOutcome（純粋）を先読みして「欄が増えました」等のカード本文を作る。何も無ければ '' */
  function outcomeCardHtml(res, entry) {
    if (!res) return '';
    var fam = familyLabel(entry && entry.spot) || (entry && entry.spot && entry.spot.family) || '';
    var blocks = [];
    if (res.added) {
      blocks.push('<h2>欄が増えました</h2><p class="pd-truth-outcome-slot">' + esc(slotLabel(res.added.id)) + '</p>' +
        '<p class="pd-small">次回の Drill から必須。由来：' + esc(gapLabel(res.added.gap)) + ' × ' + esc(fam) + '</p>');
    }
    if (res.pending) {
      blocks.push('<h2>提案待ち</h2><p class="pd-truth-outcome-slot">' + esc(slotLabel(res.pending.id)) + '</p>' +
        '<p class="pd-small pd-mute">有効な追加欄が既に2つあるため表示だけ（設定で入れ替え可）。</p>');
    }
    var promoted = (Array.isArray(res.promotedAll) && res.promotedAll.length) ? res.promotedAll : (res.promoted ? [res.promoted] : []);
    if (promoted.length) {
      blocks.push('<h2>提案待ちから昇格</h2><p class="pd-truth-outcome-slot">' +
        promoted.map(function (p) { return esc(slotLabel(p && p.id)); }).join('、') + '</p><p class="pd-small pd-mute">次回の Drill から必須。</p>');
    }
    if (Array.isArray(res.retired) && res.retired.length) {
      blocks.push('<h2>欄が退役</h2><p class="pd-truth-outcome-slot">' +
        res.retired.map(function (id) { return esc(slotLabel(id)); }).join('、') + '</p><p class="pd-small pd-mute">由来の型×族が全て晴れた。</p>');
    }
    if (!blocks.length) return '';
    return '<article class="pd-card pd-truth-outcome" data-role="outcome">' + blocks.join('') +
      '<button type="button" class="pd-btn pd-btn-primary pd-btn-block" data-act="confirm">保存してホームへ</button></article>';
  }

  // ---- HTML ----
  function sealHtml(entry, ctx) {
    var sp = entry.spot || {};
    var c = entry.commit || {};
    var S = dep('sheet', '../sheet');
    var text = (S && typeof S.toText === 'function') ? S.toText(entry.sheet, ctx.fields) : '';
    var fam = familyLabel(sp);
    var meta = [];
    if (entry.tempo) meta.push('テンポ ' + entry.tempo);
    if (isNum(c.elapsedMs)) meta.push('所要 ' + Math.round(c.elapsedMs / 1000) + '秒');
    if (isNum(c.confidence)) meta.push('確信度 ' + c.confidence + '%');
    meta.push('ヒント ' + ((entry.hints && entry.hints.length) || 0) + '回');
    if (Array.isArray(c.order) && c.order.length) meta.push('入力順 ' + c.order.join('→'));
    if (c.timedOut === true) meta.push('タイムアップ');
    if (c.incomplete === true) meta.push('未完');
    return '<article class="pd-card pd-truth-seal" data-role="seal">' +
      '<div class="pd-truth-seal-top"><span class="pd-truth-sealtag">封印済み</span>' +
        '<span class="pd-small pd-mute">' + esc(MODE_LABEL[entry.mode] || entry.mode || 'ドリル') + '</span></div>' +
      '<h2 class="pd-truth-cls" data-role="cls">' + esc(clsLabel(sp)) + '</h2>' +
      (fam ? '<p class="pd-truth-family pd-small pd-mute">族：' + esc(fam) + '</p>' : '') +
      '<p class="pd-truth-spotline"><span class="pd-mono">' + esc(sp.board) + '</span>／CB ' + esc(fmt(sp.size)) + '%（' +
        esc(fmt(sp.bet)) + 'bb into ' + esc(fmt(sp.pot)) + 'bb）／Hero <span class="pd-mono">' + esc(sp.hero) + '</span></p>' +
      '<p class="pd-small pd-mute pd-truth-meta">' + esc(meta.join('・')) + '</p>' +
      '<details class="pd-truth-sheet"><summary>票を見る（読み取り専用）</summary>' +
        '<pre class="pd-truth-pre pd-mono">' + esc(text) + '</pre></details>' +
      '</article>';
  }

  function linkHtml(link, isMain) {
    if (!link) return '';
    if (!link.url) return '<p class="pd-truth-warn">' + esc(link.note || 'Wizard リンクを作れない') + '</p>';
    var cls = isMain ? 'pd-btn pd-btn-truth pd-btn-block pd-truth-link' : 'pd-btn pd-btn-ghost pd-btn-block pd-truth-link pd-truth-link-sub';
    return '<a class="' + cls + '" data-wizard="' + (isMain ? 'main' : 'sub') + '" data-node="' + esc(link.node) + '" href="' + esc(link.url) +
      '" target="_blank" rel="noopener"><span>' + (isMain ? '' : '副：') + esc(link.label) + '</span>' +
      '<span class="pd-truth-tag">' + esc(link.tag) + '</span></a>' +
      '<p class="pd-truth-note pd-small' + (isMain ? '' : ' pd-mute') + '">' + esc(link.note) + '</p>';
  }
  /** リンクが効かない時（未ログインで /login に飛ぶとパラメータが消える）の手動ナビ：ボードのコピーと3手順 */
  function manualHtml(spot) {
    var board = spot && spot.board ? String(spot.board) : '';
    var size = spot && isNum(spot.size) ? spot.size : '';
    return '<details class="pd-truth-manual"><summary>リンクで着地しない時（手動で3タップ）</summary>' +
      '<p class="pd-small pd-mute">Wizard に<strong>未ログイン</strong>だとログイン画面に飛んでボード等が消える。先に Wizard へログインしてからリンクを開く。それでも駄目なら：</p>' +
      '<ol class="pd-small"><li>Wizard の Cash 6max 100bb で <strong>BTN 2.5bb open → BB call</strong> を選ぶ</li>' +
      '<li>SELECT BOARD に <code class="pd-mono">' + esc(board) + '</code> を入れる' +
      '<button type="button" class="pd-btn pd-btn-ghost pd-truth-copy" data-copy="' + esc(board) + '">ボードをコピー</button></li>' +
      '<li>BB x → BTN の <strong>' + esc(size) + '%</strong> をタップ → BB の応答（Call／Raise／Fold の %）を読む</li></ol></details>';
  }
  function wizardHtml(entry, ctx) {
    var links = wizardLinks(entry.spot, ctx.state && ctx.state.settings);
    return '<article class="pd-card pd-truth-wizard" data-role="wizard"><h2>真値を見る</h2>' +
      '<p class="pd-small pd-mute">Wizard で BB の応答を見て、見た数字を下に申告する。</p>' +
      linkHtml(links.main, true) + linkHtml(links.sub, false) + manualHtml(entry.spot) + '</article>';
  }

  function numInput(name, value) {
    return '<input class="pd-input" type="number" inputmode="decimal" min="0" max="100" step="any" name="' + name +
      '" value="' + (isNum(value) ? esc(value) : '') + '">';
  }
  function truthHtml(entry, mode) {
    var t = truthDraft(entry);
    var b = t.buckets;
    var speed = mode === 'speed';
    var hs = heroSum(t);
    return '<article class="pd-card pd-truth-values" data-role="truth"><h2>見た数字を申告</h2>' +
      '<p class="pd-small pd-mute">本人の自己申告だけを使う（ログにのみ保存）。' + (speed ? '速度モードはスキップ可。' : '保存には必須。') + '</p>' +
      (speed ? '<label class="pd-truth-skip"><input type="checkbox" name="skip"' + (t.skip ? ' checked' : '') + '> 真値をスキップ</label>' : '') +
      '<div class="pd-truth-inputs"' + (speed && t.skip ? ' data-off="1"' : '') + '>' +
      '<label class="pd-truth-lab">レンジ全体の fold%' + numInput('rangeFoldPct', t.rangeFoldPct) + '</label>' +
      '<div class="pd-truth-trio">' +
        '<label>自分のハンド fold%' + numInput('heroFold', t.heroFold) + '</label>' +
        '<label>call%' + numInput('heroCall', t.heroCall) + '</label>' +
        '<label>raise%' + numInput('heroRaise', t.heroRaise) + '</label></div>' +
      '<p class="pd-small pd-mute pd-truth-sum' + (hs.ng ? ' pd-truth-sum-ng' : '') + '" data-role="hero-sum">' + esc(hs.text) + '</p>' +
      '<details class="pd-truth-opt"><summary>任意：3バケツ実測（本人が読み替え）</summary><div class="pd-truth-trio">' +
        '<label>trash%' + numInput('b_trash', b.trash) + '</label>' +
        '<label>ハイカード%' + numInput('b_hi', b.hi) + '</label>' +
        '<label>ペア以上%' + numInput('b_pairPlus', b.pairPlus) + '</label></div></details>' +
      '<label class="pd-truth-lab">メモ（任意）<textarea class="pd-input" name="note" rows="2">' + esc(t.note) + '</textarea></label>' +
      '</div>' +
      '<p class="pd-truth-warn" data-role="truth-msg" aria-live="polite">' + esc(truthMsg(t, mode)) + '</p></article>';
  }

  function postHtml(entry) {
    var notes = postNotes(entry);
    var items = notes.length
      ? notes.map(function (n) { return '<li data-kind="' + esc(n.kind) + '">' + esc(n.text) + '</li>'; }).join('')
      : '<li data-kind="ok">差分なし（③のランク・⑤の2枚チェック・④の並び・入力順に注記なし）</li>';
    return '<article class="pd-card pd-truth-post" data-role="post"><h2>事後検算</h2>' +
      '<p class="pd-small pd-mute">ボードとハンドから機械的に照合する。採点には使わない。</p><ul>' + items + '</ul></article>';
  }

  function selfHtml(entry) {
    var ss = selfDraft(entry);
    var total = selfTotal(ss);
    var cands = candidates(entry);
    var rows = rubric().map(function (r) {
      var opts = SCORE_OPTIONS[r.id] || [0, r.pts];
      var cd = cands[r.id] || { cand: null, text: '' };
      var chips = opts.map(function (v) {
        var on = ss[r.id] === v;
        var isCand = cd.cand !== null && cd.cand === v;
        return '<button type="button" class="pd-chip' + (on ? ' on' : '') + '" data-score="' + esc(r.id) + '" data-val="' + v +
          '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (isCand ? ' data-cand="1"' : '') + '>' + v + '</button>';
      }).join('');
      return '<div class="pd-truth-item" data-item="' + esc(r.id) + '">' +
        '<div class="pd-truth-item-head"><span class="pd-truth-item-label">' + esc(r.label) + '</span>' +
        '<span class="pd-truth-pts">' + esc(r.pts) + '点</span></div>' +
        '<p class="pd-truth-cond pd-small">○の条件：' + esc(r.cond) + '</p>' +
        '<div class="pd-truth-chips" role="group" aria-label="' + esc(r.label) + '">' + chips + '</div>' +
        '<p class="pd-truth-cand pd-small" data-role="cand-' + esc(r.id) + '">' + esc(cd.text) + '</p></div>';
    }).join('');
    return '<article class="pd-card pd-truth-self" data-role="self"><h2>自己採点 <span class="pd-truth-total" data-role="self-total">' +
      esc((total === null ? '—' : total) + '/10') + '</span></h2>' +
      '<p class="pd-small pd-mute">基準は暗記値。○候補は提示のみ（確定は本人）。真値との差は参考表示。</p>' + rows + '</article>';
  }

  function claudeInner(entry, ctx) {
    var st = ctx.judgeState || 'nokey';
    var s = sessionFor(entry);
    var store = dep('store', '../store');
    var model = (store && typeof store.getModel === 'function') ? store.getModel() : '';
    var head = '<h2>Claude 採点 <span class="pd-small pd-mute">任意</span></h2>';
    if (st === 'nokey') {
      return head + '<p class="pd-small" data-role="claude-nokey">API キーが未設定。設定でキーを保存すると Claude 採点（任意）が使える。キー無しでも自己採点だけで保存できる。</p>' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-go="settings">設定へ</button>';
    }
    if (st === 'loading') {
      return head + '<p class="pd-truth-claude-busy" aria-busy="true">採点中…（' + esc(model) + '）</p>';
    }
    if (st === 'error') {
      var e = s.judgeErr || {};
      var label = ERR_LABEL[e.code] || ('エラー ' + (e.code || ''));
      if (e.code === 'HTTP' && e.status) label += '（HTTP ' + e.status + '）';
      return head + '<p class="pd-truth-claude-err" data-code="' + esc(e.code || '') + '">' + esc(label) + '</p>' +
        '<button type="button" class="pd-btn" data-act="judge">再試行</button>';
    }
    if (st === 'done' && entry.claude) {
      var c = entry.claude;
      var it = c.items || {};
      return head +
        '<div class="pd-truth-claude-top"><span class="pd-truth-claude-score">' + esc(fmt(c.score)) + '<small>/10</small></span>' +
        '<span class="pd-truth-claude-items">手順 ' + esc(fmt(it.procedure)) + '／サイズ ' + esc(fmt(it.size_fold)) +
        '／ドロー ' + esc(fmt(it.draw_protect)) + '／答え ' + esc(fmt(it.action)) + '</span></div>' +
        '<p class="pd-truth-verdict">' + esc(c.verdict) + '</p>' +
        '<dl><dt>良い</dt><dd>' + esc(c.good) + '</dd><dt>ズレ</dt><dd>' + esc(c.miss) + '</dd>' +
        '<dt>次回</dt><dd>' + esc(c.fix_one_line) + '</dd>' +
        '<dt>型</dt><dd>' + esc(gapLabel(c.gap_type)) + (c.gap_reason ? '：' + esc(c.gap_reason) : '') + '</dd></dl>' +
        '<p class="pd-small pd-mute">境界ハンドの名指し：' + (c.boundary_hand_named ? '有' : '無') +
        '／相手レンジ：' + (c.villain_range_used ? '根拠に使っている' : '不使用') + (c.model ? '／' + esc(c.model) : '') + '</p>' +
        '<button type="button" class="pd-btn pd-btn-ghost" data-act="judge">もう一度</button>';
    }
    return head + '<p class="pd-small pd-mute">真値と自己採点を入れてから頼むと精度が上がる。モデル：' + esc(model) + '</p>' +
      '<button type="button" class="pd-btn pd-btn-block" data-act="judge">Claude に採点を頼む</button>';
  }

  function branchHtml(entry) {
    if (!needsBranch(entry)) return '';
    var st = selfTotal(entry.selfScore);
    var cs = claudeScore(entry);
    var used = entry.scoreUsed === 'claude' ? 'claude' : 'self';
    return '<article class="pd-card pd-truth-branch" data-role="branch-card"><h2>採点が ' + Math.abs(st - cs) + ' 点離れている</h2>' +
      '<p class="pd-small pd-mute">どちらを弱点マップと安定判定に使うか選ぶ。両方とも保存される。</p>' +
      '<label><input type="radio" name="scoreUsed" value="self"' + (used === 'self' ? ' checked' : '') + '> 自己採点 ' + st + ' 点</label>' +
      '<label><input type="radio" name="scoreUsed" value="claude"' + (used === 'claude' ? ' checked' : '') + '> Claude ' + cs + ' 点</label></article>';
  }

  function srcText(d) {
    if (d.source === 'claude') return '初期値：Claude の型（' + gapLabel(d.gap) + '）。確定は本人';
    if (d.source === 'hint') return '初期値：手がかりから（' + gapLabel(d.gap) + '）。確定は本人';
    return '初期値：ズレなし（手がかり無し）。確定は本人';
  }
  function reasonsHtml(reasons) {
    if (!reasons || !reasons.length) return '';
    return reasons.map(function (r) {
      r = String(r);
      var i = r.indexOf(': ');
      var id = i > 0 ? r.slice(0, i) : '';
      var txt = i > 0 ? r.slice(i + 2) : r;
      return '<li>' + (id ? '<b>' + esc(gapLabel(id)) + '</b> ' : '') + esc(txt) + '</li>';
    }).join('');
  }
  function gapHtml(entry, ctx) {
    var d = defaultGap(judgeSnapshot(entry, modeOf(entry, ctx)), ctx.log);
    var s = sessionFor(entry);
    var chips = gapTypes().map(function (g) {
      var on = entry.gap === g.id;
      return '<button type="button" class="pd-chip' + (on ? ' on' : '') + '" data-gap="' + esc(g.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(g.label) + '</button>';
    }).join('');
    return '<article class="pd-card pd-truth-gap" data-role="gap"><h2>ズレの型</h2>' +
      '<p class="pd-small pd-mute" data-role="gap-src">' + esc(s.gapTouched ? ('本人が確定：' + gapLabel(entry.gap)) : srcText(d)) + '</p>' +
      '<div class="pd-truth-gapchips" role="group" aria-label="ズレの型">' + chips + '</div>' +
      '<p class="pd-truth-cue pd-small" data-role="gap-cue">' + esc(gapCue(entry.gap)) + '</p>' +
      '<ul class="pd-truth-reasons pd-small" data-role="gap-reasons">' + reasonsHtml(d.reasons) + '</ul>' +
      '<label class="pd-truth-lab">メモ（任意）<textarea class="pd-input" name="gapNote" rows="2">' + esc(entry.gapNote || '') + '</textarea></label></article>';
  }

  function barHtml(entry, mode, s) {
    var sb = saveBarState(entry, mode, s);
    return '<div class="pd-bar pd-truth-bar"><div class="pd-truth-bar-msg pd-small" data-role="save-msg" aria-live="polite" data-ok="' +
      (sb.ok ? '1' : '0') + '">' + esc(sb.text) + '</div>' +
      '<button type="button" class="pd-btn pd-btn-primary" data-act="save"' + (sb.disabled ? ' disabled' : '') + '>保存</button></div>';
  }

  function blockedHtml() {
    return '<section class="pd-card pd-truth-blocked" data-role="truth-blocked"><h2>コミット前は真値を見られない</h2>' +
      '<p class="pd-mute">前提票を全部埋めてコミットすると、ここに Wizard リンクと真値入力が出る。</p>' +
      '<p><button type="button" class="pd-btn pd-btn-ghost" data-go="home">ホームへ</button></p></section>';
  }

  /**
   * PD.ui.truth.html(ctx) -> string（純粋。document / window を使わない）
   * entry が無ければ案内カード。あれば画面全体（封印票・Wizard・真値・事後検算・自己採点・Claude・分岐・型・保存バー）。
   * entry の下書き（truth / selfScore / postCheck / gap 初期値）はここで整える（ctx.entry を触る。DOM は触らない）。
   */
  function html(ctx) {
    ctx = ctx || {};
    var entry = ctx.entry;
    if (!entry || typeof entry !== 'object' || !entry.spot || !entry.sheet) return blockedHtml();
    var s = sessionFor(entry);
    prepare(entry, ctx);
    syncKeyState(ctx);
    var mode = modeOf(entry, ctx);
    if (!s.gapTouched) entry.gap = defaultGap(judgeSnapshot(entry, mode), ctx.log).gap;
    return '<section class="pd-truth" data-role="truth-view"' + (s.saved ? ' data-saved="1"' : '') + '>' +
      '<div data-role="outcome-slot">' + ((s.saved && s.preview) ? outcomeCardHtml(s.preview, entry) : '') + '</div>' +
      sealHtml(entry, ctx) +
      wizardHtml(entry, ctx) +
      truthHtml(entry, mode) +
      postHtml(entry) +
      selfHtml(entry) +
      '<article class="pd-card pd-truth-claude" data-role="claude" data-state="' + esc(ctx.judgeState) + '">' + claudeInner(entry, ctx) + '</article>' +
      '<div data-role="branch">' + branchHtml(entry) + '</div>' +
      gapHtml(entry, ctx) +
      barHtml(entry, mode, s) +
      '</section>';
  }

  // ---- 部分更新（innerHTML の再描画は構造が変わる所だけ）----
  function renderClaude(section, ctx) {
    var el = q(section, '[data-role="claude"]');
    if (!el) return;
    el.setAttribute('data-state', ctx.judgeState || 'nokey');
    el.innerHTML = claudeInner(ctx.entry, ctx);
  }
  function renderBranch(section, ctx) {
    var el = q(section, '[data-role="branch"]');
    if (el) el.innerHTML = branchHtml(ctx.entry);
  }
  function refreshGapChips(section, ctx) {
    var entry = ctx.entry;
    all(section, '[data-gap]').forEach(function (b) {
      var on = b.getAttribute('data-gap') === entry.gap;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var cue = q(section, '[data-role="gap-cue"]');
    if (cue) cue.textContent = gapCue(entry.gap);
  }
  /** 本人が触っていなければ初期値を取り直す（Claude 結果・真値の変化で変わりうる）*/
  function refreshGapDefault(section, ctx) {
    var entry = ctx.entry;
    var s = sessionFor(entry);
    var d = defaultGap(judgeSnapshot(entry, modeOf(entry, ctx)), ctx.log);
    var reasons = q(section, '[data-role="gap-reasons"]');
    if (reasons) reasons.innerHTML = reasonsHtml(d.reasons);
    if (s.gapTouched) return;
    entry.gap = d.gap;
    var src = q(section, '[data-role="gap-src"]');
    if (src) src.textContent = srcText(d);
    refreshGapChips(section, ctx);
  }
  function refreshTruth(section, ctx) {
    var entry = ctx.entry;
    var t = truthDraft(entry);
    var mode = modeOf(entry, ctx);
    var sumEl = q(section, '[data-role="hero-sum"]');
    if (sumEl) {
      var hs = heroSum(t);
      sumEl.textContent = hs.text;
      sumEl.classList.toggle('pd-truth-sum-ng', hs.ng);
    }
    var msg = q(section, '[data-role="truth-msg"]');
    if (msg) msg.textContent = truthMsg(t, mode);
    var wrap = q(section, '.pd-truth-inputs');
    if (wrap) {
      if (mode === 'speed' && t.skip) wrap.setAttribute('data-off', '1');
      else wrap.removeAttribute('data-off');
    }
  }
  function setCand(section, id, cand, text) {
    var p = q(section, '[data-role="cand-' + id + '"]');
    if (p) p.textContent = text;
    all(section, '[data-score="' + id + '"]').forEach(function (b) {
      if (cand !== null && Number(b.getAttribute('data-val')) === cand) b.setAttribute('data-cand', '1');
      else b.removeAttribute('data-cand');
    });
  }
  function refreshSelf(section, ctx) {
    var entry = ctx.entry;
    var ss = selfDraft(entry);
    var total = selfTotal(ss);
    var tot = q(section, '[data-role="self-total"]');
    if (tot) tot.textContent = (total === null ? '—' : total) + '/10';
    all(section, '[data-score]').forEach(function (b) {
      var on = ss[b.getAttribute('data-score')] === Number(b.getAttribute('data-val'));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var cands = candidates(entry);
    for (var i = 0; i < SCORE_IDS.length; i++) {
      var cd = cands[SCORE_IDS[i]];
      if (cd) setCand(section, SCORE_IDS[i], cd.cand, cd.text);
    }
  }
  function refreshSaveBar(section, ctx) {
    var entry = ctx.entry;
    var sb = saveBarState(entry, modeOf(entry, ctx), sessionFor(entry));
    var msg = q(section, '[data-role="save-msg"]');
    var btn = q(section, '[data-act="save"]');
    if (msg) { msg.textContent = sb.text; msg.setAttribute('data-ok', sb.ok ? '1' : '0'); }
    if (btn) btn.disabled = sb.disabled;
  }

  // ---- Claude 採点 ----
  function runJudge(section, ctx) {
    var J = dep('judge', '../judge');
    var S = dep('sheet', '../sheet');
    var entry = ctx.entry;
    var s = sessionFor(entry);
    if (ctx.judgeState === 'loading') return;
    if (!J || typeof J.judge !== 'function') {
      ctx.judgeState = 'error';
      s.judgeErr = { code: 'NET' };
      renderClaude(section, ctx);
      return;
    }
    ctx.judgeState = 'loading';
    s.judgeErr = null;
    renderClaude(section, ctx);
    var snap = judgeSnapshot(entry, modeOf(entry, ctx));
    var text = (S && typeof S.toText === 'function') ? S.toText(entry.sheet, ctx.fields) : '';
    var p;
    try { p = J.judge(snap, text); } catch (e) { p = { ok: false, error: 'NET' }; }
    Promise.resolve(p).then(function (r) { return r; }, function () { return { ok: false, error: 'NET' }; }).then(function (r) {
      if (ctx.entry !== entry) return; // 画面が別の出題に移っている
      if (r && r.ok && r.result) {
        entry.claude = r.result;
        ctx.judgeState = 'done';
      } else {
        var code = (r && r.error) || 'NET';
        if (code === 'NO_KEY') {
          ctx.judgeState = 'nokey';
        } else {
          ctx.judgeState = 'error';
          s.judgeErr = { code: code, status: r && r.status };
        }
      }
      if (!isConnected(section)) return;
      renderClaude(section, ctx);
      refreshGapDefault(section, ctx);
      renderBranch(section, ctx);
      refreshSaveBar(section, ctx);
    });
  }

  // ---- 保存 ----
  function showOutcome(section, ctx, preview) {
    var slot = q(section, '[data-role="outcome-slot"]');
    if (!slot) return;
    slot.innerHTML = outcomeCardHtml(preview, ctx.entry);
    if (slot.firstChild && typeof slot.scrollIntoView === 'function') {
      try { slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 無視 */ }
    }
  }
  function commitSave(section, ctx) {
    var entry = ctx.entry;
    var s = sessionFor(entry);
    if (typeof ctx.saveOutcome === 'function') ctx.saveOutcome();
    // app が遷移しなかった（未結合・保存失敗でトースト）ときは、やり直せるよう入力に戻す
    if (ctx.entry === entry && ctx.view === 'truth' && isConnected(section)) {
      s.saved = false;
      s.preview = null;
      section.removeAttribute('data-saved');
      var slot = q(section, '[data-role="outcome-slot"]');
      if (slot) slot.innerHTML = '';
      refreshSaveBar(section, ctx);
    }
  }
  function save(section, ctx) {
    var entry = ctx.entry;
    var s = sessionFor(entry);
    var mode = modeOf(entry, ctx);
    if (s.saved) return;
    var v = validateSave(entry, mode);
    if (!v.ok) { refreshSaveBar(section, ctx); return; }
    finalize(entry, mode);
    var preview = null;
    var G = dep('gaps', '../gaps');
    var U = dep('util', '../util');
    if (mode !== 'speed' && G && typeof G.recordOutcome === 'function' && ctx.state) {
      try { preview = G.recordOutcome(ctx.state, entry, (U && typeof U.today === 'function') ? U.today() : undefined); } catch (e) { preview = null; }
    }
    s.saved = true;
    s.preview = preview;
    section.setAttribute('data-saved', '1');
    if (preview && outcomeCardHtml(preview, entry)) {
      showOutcome(section, ctx, preview);
      refreshSaveBar(section, ctx);
      return;
    }
    commitSave(section, ctx);
  }

  // ---- イベント（section 単位で委譲。view が入れ替わると一緒に消える）----
  function onInput(ev, section, ctx) {
    var t = ev.target;
    if (!t || !t.name) return;
    var entry = ctx.entry;
    if (!entry || sessionFor(entry).saved) return;
    var td = truthDraft(entry);
    switch (t.name) {
      case 'rangeFoldPct': case 'heroFold': case 'heroCall': case 'heroRaise':
        td[t.name] = toNum(t.value);
        refreshTruth(section, ctx);
        refreshSelf(section, ctx);
        refreshGapDefault(section, ctx);
        refreshSaveBar(section, ctx);
        return;
      case 'b_trash': td.buckets.trash = toNum(t.value); break;
      case 'b_hi': td.buckets.hi = toNum(t.value); break;
      case 'b_pairPlus': td.buckets.pairPlus = toNum(t.value); break;
      case 'note': td.note = String(t.value || ''); return;
      case 'skip': td.skip = !!t.checked; break;
      case 'gapNote': entry.gapNote = String(t.value || ''); return;
      case 'scoreUsed':
        if (ev.type === 'change') entry.scoreUsed = (t.value === 'claude') ? 'claude' : 'self';
        return;
      default: return;
    }
    refreshTruth(section, ctx);
    refreshSaveBar(section, ctx);
  }
  function onClick(ev, section, ctx) {
    var t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    var entry = ctx.entry;
    if (!entry) return;
    var s = sessionFor(entry);
    var cp = t.closest('[data-copy]');
    if (cp) {
      var text = cp.getAttribute('data-copy') || '';
      var done = function () { if (typeof ctx.toast === 'function') ctx.toast('コピーしました：' + text); };
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(done, function () { window.prompt('ボード（手でコピー）', text); });
      } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        window.prompt('ボード（手でコピー）', text);
      }
      return;
    }
    var act = t.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'save') save(section, ctx);
      else if (a === 'confirm') commitSave(section, ctx);
      else if (a === 'judge' && !s.saved) runJudge(section, ctx);
      return;
    }
    if (s.saved) return;
    var sc = t.closest('[data-score]');
    if (sc) {
      var id = sc.getAttribute('data-score');
      var v = Number(sc.getAttribute('data-val'));
      var ss = selfDraft(entry);
      ss[id] = (ss[id] === v) ? null : v;
      ss.total = selfTotal(ss);
      refreshSelf(section, ctx);
      renderBranch(section, ctx);
      refreshSaveBar(section, ctx);
      return;
    }
    var g = t.closest('[data-gap]');
    if (g) {
      entry.gap = g.getAttribute('data-gap');
      s.gapTouched = true;
      refreshGapChips(section, ctx);
      var src = q(section, '[data-role="gap-src"]');
      if (src) src.textContent = '本人が確定：' + gapLabel(entry.gap);
      refreshSaveBar(section, ctx);
    }
  }
  function bind(section, ctx) {
    section.addEventListener('input', function (ev) { onInput(ev, section, ctx); });
    section.addEventListener('change', function (ev) { onInput(ev, section, ctx); });
    section.addEventListener('click', function (ev) { onClick(ev, section, ctx); });
  }

  // ---- 準備 ----
  function prepare(entry, ctx) {
    var S = dep('sheet', '../sheet');
    var C = dep('cards', '../cards');
    if (S && typeof S.postCheck === 'function') {
      try { entry.postCheck = S.postCheck(entry.sheet, entry.spot, C || {}); } catch (e) { if (!entry.postCheck) entry.postCheck = null; }
    }
    truthDraft(entry);
    selfDraft(entry);
    if (typeof entry.gapNote !== 'string') entry.gapNote = '';
    if (entry.scoreUsed !== 'claude') entry.scoreUsed = 'self';
    if (!entry.mode && ctx.mode) entry.mode = ctx.mode;
  }
  /** キーの有無で nokey/idle を揃える（done/error/loading は触らない）*/
  function syncKeyState(ctx) {
    var store = dep('store', '../store');
    var has = !!(store && typeof store.getApiKey === 'function' && store.getApiKey());
    var st = ctx.judgeState;
    if (!has && (st === 'idle' || st === 'nokey' || !st)) ctx.judgeState = 'nokey';
    else if (has && (st === 'nokey' || !st)) ctx.judgeState = 'idle';
  }
  function blocked(rootEl, ctx) {
    rootEl.innerHTML = blockedHtml();
    if (typeof ctx.toast === 'function') ctx.toast('コミット前は真値画面に入れません');
    var back = (ctx.spot && Array.isArray(ctx.fields) && ctx.fields.length) ? 'drill' : 'home';
    if (typeof ctx.go === 'function') {
      try { ctx.go(back); } catch (e) { /* 戻れなければ案内カードのまま */ }
    }
  }

  // ---- render（html(ctx) を流し込み、イベント結線だけ行う）----
  function render(rootEl, ctx) {
    if (!rootEl || !ctx) return;
    var entry = ctx.entry;
    if (!entry || typeof entry !== 'object' || !entry.spot || !entry.sheet) { blocked(rootEl, ctx); return; }
    rootEl.innerHTML = html(ctx);
    var section = q(rootEl, '[data-role="truth-view"]');
    if (!section) return;
    var s = sessionFor(entry);
    if (s.saved && s.preview) {
      var slot = q(section, '[data-role="outcome-slot"]');
      if (slot && slot.firstChild && typeof slot.scrollIntoView === 'function') {
        try { slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 無視 */ }
      }
    }
    bind(section, ctx);
  }

  return {
    render: render,
    // 契約外（結合・検証用）：画面全体の純粋な HTML 生成
    html: html,
    _html: html,
    // 契約外：純粋部分（node での確認・結合テスト用）
    _pure: {
      clsLabel: clsLabel,
      familyLabel: familyLabel,
      wizardLinks: wizardLinks,
      validateTruth: validateTruth,
      sizeCandidate: sizeCandidate,
      truthDiff: truthDiff,
      actionCandidate: actionCandidate,
      selfTotal: selfTotal,
      needsBranch: needsBranch,
      pickScoreUsed: pickScoreUsed,
      postNotes: postNotes,
      defaultGap: defaultGap,
      validateSave: validateSave,
      finalize: finalize,
      outcomeCardHtml: outcomeCardHtml,
      heroSum: heroSum,
      truthMsg: truthMsg,
      candidates: candidates,
      saveBarState: saveBarState
    }
  };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.truth;
