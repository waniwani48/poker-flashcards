// premise-drill: PD.gaps（T5）。純粋・依存なし。SPEC ⑫ の契約：
//   GAP_TYPES / RUBRIC / BASELINE_FOLD / UNLOCK / LIMITS / INTERVALS
//   hintFor / recordOutcome / dueFamilies / mapCells / stableFamilies / speedUnlocked / scoreOf
// 再発セルの規律（⑥「再発で足される欄」）は recordOutcome に集約する。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.gaps = (function () {
  'use strict';

  // ---------------------------------------------------------------
  // 定数
  // ---------------------------------------------------------------

  /** 5型 + none + unknown_concept。cue は UI の手がかり文（ルールベース）。remedySlot は ⑥ の slot id */
  var GAP_TYPES = [
    { id: 'range_state', label: 'レンジ状態', cue: '自レンジに居ない手を数えた／抜けた手を見落とした／%でなく形容詞で済ませた', remedySlot: 'pf_removed' },
    { id: 'baseline', label: '定石忘れ', cue: '暗記値・定石を想起できず、①が暗記値から大きく外れた', remedySlot: 'baseline_src' },
    { id: 'rule', label: '規則違い', cue: '則の適用条件を取り違えた（サイズ違いの値・④の列挙が①を満たさない・相手レンジで決めた）', remedySlot: 'rule_cond' },
    { id: 'strength_order', label: '強さ順', cue: 'ランクだけで並べ、2枚で見ていない（ドロー・BD・スートの順位が無い）', remedySlot: 'rank_table' },
    { id: 'middling', label: '中庸', cue: '極端側（pure fold／pure call）が正しいのに境界・混合に寄せた', remedySlot: 'anti_mid' },
    { id: 'none', label: 'ズレなし', cue: '手順・数値・名指しが揃っている', remedySlot: null },
    { id: 'unknown_concept', label: '概念欠落', cue: '必要な概念そのものが票に無い', remedySlot: null }
  ];

  /** 自己採点4項目（⑦）。pts は配点、cond は「○の条件」の1行 */
  var RUBRIC = [
    { id: 'procedure', pts: 3, label: '手順', cond: '①→②→③→④→⑤ の順に埋め、④で純air→足りる?→名指しの順を守った' },
    { id: 'sizeFold', pts: 2, label: 'サイズ→fold%', cond: '①が暗記値 ±5pt で2、±10pt で1' },
    { id: 'drawProtect', pts: 4, label: 'ドロー付き trash を守る', cond: '③でランクを列挙し、④で純air を縮めてから名指しした（ドロー無しのボードなら「無し」を宣言した）' },
    { id: 'action', pts: 1, label: '答え', cond: '⑤の action が真値（heroFold≥50 → fold）と一致' }
  ];

  /** 暗記値（本人の暗記表）。サイズ% → 必要 fold% の目安。置き場はここ1箇所 */
  var BASELINE_FOLD = { 33: 30, 50: 40 };

  var UNLOCK = {
    minCommitted: 20,
    stableOfLast: 15,
    window: 20,
    minScore: 7,
    stableScore: 7,
    stableWindow: 5,
    maxActiveExtra: 2,
    retireClean: 4
  };

  /** テンポ制限（秒）。テンポ定数の唯一の置き場 */
  var LIMITS = { slow: null, normal: 180, speed: 60 };

  /** SRS の due 間隔（日）。cleanStreak 1→[0]、2→[1]、3→[2]、4以上→[3] */
  var INTERVALS = [1, 2, 4, 8];

  /** 格子の行順（cls 6 × size 2）。generator の FAMILIES と同じ並びだが依存はしない */
  var CLS_ORDER = ['dry_high', 'bw_sd', 'mid', 'low', 'paired', 'mono'];
  var SIZE_ORDER = ['33', '50', 'x'];

  /** hintFor の検知閾値（⑧）。暗記値ではなく判定の幅 */
  var BASELINE_TOL = 10;          // ①と暗記値の差がこれを超えたら baseline 候補
  var RULE_FOLD_FLOOR_50 = 32;    // 50% なのに①がこれ以下なら rule 候補（33% の値で処理した疑い）
  var MID_CONF_LO = 40;           // middling：確信度の帯
  var MID_CONF_HI = 60;
  var RANGE_STATE_HANDS = { QQ: 1, KK: 1, AA: 1, AKs: 1, AKo: 1 };

  // ---------------------------------------------------------------
  // 小道具
  // ---------------------------------------------------------------

  function clone(o) {
    return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  }

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  /** ローカル日付 'YYYY-MM-DD' */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 'YYYY-MM-DD' に n 日足す（UTC 計算で DST の影響を避ける） */
  function addDays(ymd, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return ymd;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + (Number(n) || 0) * 86400000;
    var d = new Date(t);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** cleanStreak → 次の due 間隔（日） */
  function intervalFor(cleanStreak) {
    var i = Math.max(1, Number(cleanStreak) || 0) - 1;
    if (i >= INTERVALS.length) i = INTERVALS.length - 1;
    return INTERVALS[i];
  }

  function gapById(id) {
    for (var i = 0; i < GAP_TYPES.length; i++) if (GAP_TYPES[i].id === id) return GAP_TYPES[i];
    return null;
  }

  function slotFor(gap) {
    var g = gapById(gap);
    return g ? g.remedySlot : null;
  }

  function gapOfSlot(slotId) {
    for (var i = 0; i < GAP_TYPES.length; i++) if (GAP_TYPES[i].remedySlot === slotId) return GAP_TYPES[i].id;
    return null;
  }

  function cellKey(gap, family) {
    return gap + '|' + family;
  }

  function splitKey(key) {
    var i = String(key).indexOf('|');
    if (i < 0) return null;
    return { gap: key.slice(0, i), family: key.slice(i + 1) };
  }

  function familyRank(f) {
    var m = /^(.*)_(33|50|x)$/.exec(String(f || ''));
    var ci = m ? CLS_ORDER.indexOf(m[1]) : -1;
    var si = m ? SIZE_ORDER.indexOf(m[2]) : -1;
    if (ci < 0) ci = CLS_ORDER.length;
    if (si < 0) si = SIZE_ORDER.length;
    return ci * 10 + si;
  }

  function sortFamilies(list) {
    return list.slice().sort(function (a, b) {
      var d = familyRank(a) - familyRank(b);
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function familyOfEntry(entry) {
    var s = entry && entry.spot;
    if (!s) return null;
    if (s.family) return s.family;
    if (s.cls) {
      var size = (s.size === 33 || s.size === 50) ? String(s.size) : 'x';
      return s.cls + '_' + size;
    }
    return null;
  }

  function isComplete(entry) {
    return !(entry && entry.commit && entry.commit.incomplete === true);
  }

  /** ハンド表記を 'AKs' / 'QQ' 形式へ寄せる（'AsKs' 形式も受ける）。不明なら元の文字列 */
  var RANK_VAL = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };
  function normHand(s) {
    s = String(s || '').trim();
    var m = /^([AKQJT2-9])([shdc])([AKQJT2-9])([shdc])$/.exec(s);
    if (m) {
      var r1 = m[1], r2 = m[3];
      if (r1 === r2) return r1 + r2;
      var hi = RANK_VAL[r1] >= RANK_VAL[r2] ? r1 : r2;
      var lo = hi === r1 ? r2 : r1;
      return hi + lo + (m[2] === m[4] ? 's' : 'o');
    }
    m = /^([AKQJT2-9])([AKQJT2-9])([so])?$/.exec(s);
    if (m) {
      if (m[1] === m[2]) return m[1] + m[2];
      var h = RANK_VAL[m[1]] >= RANK_VAL[m[2]] ? m[1] : m[2];
      var l = h === m[1] ? m[2] : m[1];
      return h + l + (m[3] || '');
    }
    return s;
  }

  function lastIndexOfField(order, fid) {
    if (!order || !order.length) return -1;
    var idx = -1;
    for (var i = 0; i < order.length; i++) if (order[i] === fid) idx = i;
    return idx;
  }

  // ---------------------------------------------------------------
  // scoreOf
  // ---------------------------------------------------------------

  /** scoreUsed に従う。指定側が無ければもう一方、どちらも無ければ null */
  function scoreOf(entry) {
    if (!entry) return null;
    var self = entry.selfScore && typeof entry.selfScore.total === 'number' ? entry.selfScore.total : null;
    var cl = entry.claude && typeof entry.claude.score === 'number' ? entry.claude.score : null;
    if (entry.scoreUsed === 'claude') return cl !== null ? cl : self;
    return self !== null ? self : cl;
  }

  // ---------------------------------------------------------------
  // hintFor（ルールベース手がかり。⑧の表）
  // ---------------------------------------------------------------

  /**
   * @param {Partial<LogEntry>} entry
   * @param {LogEntry[]=} log  任意。middling の「同族で2回 edge を選んで外す」に使う（無ければその条件は見ない）
   * @returns {{ suggest: string|null, reasons: string[] }}
   */
  function hintFor(entry, log) {
    entry = entry || {};
    var sheet = entry.sheet || {};
    var spot = entry.spot || {};
    var f1 = sheet.f1 || {};
    var f4 = sheet.f4 || {};
    var f5 = sheet.f5 || {};
    var claude = entry.claude || null;
    var truth = entry.truth && entry.truth.used ? entry.truth : null;
    var commit = entry.commit || {};
    var fieldTimes = commit.fieldTimes || {};
    var order = commit.order || [];
    var hints = entry.hints || [];
    var post = entry.postCheck || {};
    var foldList = Array.isArray(f4.foldList) ? f4.foldList : [];

    var hits = [];   // { gap, reason }
    function hit(gap, reason) { hits.push({ gap: gap, reason: reason }); }

    // --- range_state：固定2条件のみ（プリフロップのレンジ表は参照しない）
    if (claude && claude.gap_type === 'range_state') hit('range_state', 'Claude の型が range_state');
    var named = [];
    for (var i = 0; i < foldList.length; i++) {
      var h = normHand(foldList[i]);
      if (RANGE_STATE_HANDS[h]) named.push(h);
    }
    if (named.length) hit('range_state', '④の fold 組に自レンジに居ない手（' + named.join('・') + '）がある');

    // --- baseline
    var base = BASELINE_FOLD[spot.size];
    if (typeof base === 'number' && typeof f1.foldPct === 'number' && Math.abs(f1.foldPct - base) > BASELINE_TOL) {
      hit('baseline', '①が暗記値から ' + Math.abs(f1.foldPct - base) + 'pt 外れている');
    }
    if (typeof fieldTimes.f1 === 'number') {
      var f1Last = true;
      var others = 0;
      for (var k in fieldTimes) {
        if (k === 'f1' || typeof fieldTimes[k] !== 'number') continue;
        others++;
        if (fieldTimes[k] > fieldTimes.f1) { f1Last = false; break; }
      }
      if (f1Last && others > 0) hit('baseline', '①が最後に完了している');
    }
    for (i = 0; i < hints.length; i++) {
      if (hints[i] && hints[i].field === 'f1' && hints[i].tier === 2) { hit('baseline', '①でヒント2段目を開いた'); break; }
    }

    // --- rule
    var i3 = lastIndexOfField(order, 'f3');
    var i4 = lastIndexOfField(order, 'f4');
    var f4First = (i3 >= 0 && i4 >= 0 && i4 < i3) ||
      (typeof fieldTimes.f3 === 'number' && typeof fieldTimes.f4 === 'number' && fieldTimes.f4 < fieldTimes.f3);
    if (f4First) hit('rule', '④が③より先に完了している');
    if (f4.enough === 'yes' && Array.isArray(f4.nextLayer) && f4.nextLayer.length) hit('rule', '④で「足りる」なのに次の層から降ろす手を挙げている');
    if (spot.size === 50 && typeof f1.foldPct === 'number' && f1.foldPct <= RULE_FOLD_FLOOR_50) hit('rule', '50% なのに①が 33% 相当の値');
    if (claude && claude.villain_range_used === true) hit('rule', '相手レンジを根拠にしている（Claude）');

    // --- strength_order
    if (post.rankOrder === true) hit('strength_order', '④がランク順（単調）の並び');
    if (Array.isArray(post.heroFeatMismatch) && post.heroFeatMismatch.length >= 2) hit('strength_order', '⑤の2枚チェックが ' + post.heroFeatMismatch.length + ' 項目ずれている');
    if (claude && claude.boundary_hand_named === false) hit('strength_order', '境界のハンドを名指ししていない（Claude）');

    // --- middling
    var conf = f5.confidence;
    if (typeof conf === 'number' && conf >= MID_CONF_LO && conf <= MID_CONF_HI && f5.position === 'edge' &&
        truth && (truth.heroFold === 0 || truth.heroFold === 100)) {
      hit('middling', '境界・確信度' + conf + '% なのに真値は極端側');
    }
    if (Array.isArray(log) && log.length) {
      var fam = familyOfEntry(entry);
      var missEdge = 0;
      for (i = log.length - 1; i >= 0 && fam; i--) {
        var e = log[i];
        if (!e || e === entry || (entry.id && e.id === entry.id)) continue;
        if (e.mode === 'speed' || familyOfEntry(e) !== fam) continue;
        var ef5 = e.sheet && e.sheet.f5;
        var et = e.truth && e.truth.used ? e.truth : null;
        if (!ef5 || ef5.position !== 'edge' || !et || typeof et.heroFold !== 'number') break;
        var truthAct = et.heroFold >= 50 ? 'fold' : 'call';
        if (ef5.action !== truthAct) missEdge++; else break;
        if (missEdge >= 2) break;
      }
      if (missEdge >= 2) hit('middling', '同族で2回続けて境界を選んで外している');
    }

    // 第1候補は表の順（range_state → baseline → rule → strength_order → middling）
    var orderOf = ['range_state', 'baseline', 'rule', 'strength_order', 'middling'];
    var suggest = null;
    for (i = 0; i < orderOf.length && !suggest; i++) {
      for (var j = 0; j < hits.length; j++) if (hits[j].gap === orderOf[i]) { suggest = orderOf[i]; break; }
    }
    return {
      suggest: suggest,
      reasons: hits.map(function (x) { return x.gap + ': ' + x.reason; })
    };
  }

  // ---------------------------------------------------------------
  // state の器を保証
  // ---------------------------------------------------------------

  function ensure(state) {
    state.settings = state.settings || {};
    if (!Array.isArray(state.settings.extraFields)) state.settings.extraFields = [];
    if (!Array.isArray(state.settings.pendingExtra)) state.settings.pendingExtra = [];
    state.recurrence = state.recurrence || {};
    state.familyStats = state.familyStats || {};
    state.counters = state.counters || {};
    var c = state.counters;
    if (typeof c.committed !== 'number') c.committed = 0;
    if (typeof c.live !== 'number') c.live = 0;
    if (typeof c.speed !== 'number') c.speed = 0;
    if (!c.liveToday || typeof c.liveToday !== 'object') c.liveToday = { date: null, n: 0 };
    return state;
  }

  function findSlot(state, id) {
    var list = state.settings.extraFields;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function activeCount(state) {
    var n = 0;
    var list = state.settings.extraFields;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f && f.enabled !== false && !f.retiredAt) n++;
    }
    return n;
  }

  function addFamily(slot, family) {
    if (!Array.isArray(slot.families)) slot.families = [];
    if (slot.families.indexOf(family) < 0) slot.families.push(family);
  }

  function findPending(state, id) {
    var list = state.settings.pendingExtra;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function removePending(state, id) {
    state.settings.pendingExtra = state.settings.pendingExtra.filter(function (p) { return !(p && p.id === id); });
  }

  /** その型で count≥2 の族（昇格時に families を補うため） */
  function familiesAtTwo(state, gap) {
    var out = [];
    for (var key in state.recurrence) {
      var kk = splitKey(key);
      var cell = state.recurrence[key];
      if (kk && kk.gap === gap && cell && cell.count >= 2) out.push(kk.family);
    }
    return out;
  }

  /**
   * slot を有効化する（新規 or 退役済みの再有効化）。枠は呼び出し側が確認済み。
   * @returns {ExtraField}
   */
  function activateSlot(state, id, gap, families, today) {
    var slot = findSlot(state, id);
    if (slot) {
      slot.retiredAt = null;
      slot.enabled = true;
      if (!slot.gap) slot.gap = gap;
    } else {
      slot = { id: id, gap: gap, families: [], addedAt: today, enabled: true, retiredAt: null };
      state.settings.extraFields.push(slot);
    }
    for (var i = 0; i < families.length; i++) addFamily(slot, families[i]);
    removePending(state, id);
    return slot;
  }

  /** 空いた枠に pendingExtra の先頭から昇格する。返り値は昇格したスロット（配列） */
  function promotePending(state, today) {
    var out = [];
    while (state.settings.pendingExtra.length && activeCount(state) < UNLOCK.maxActiveExtra) {
      var p = state.settings.pendingExtra[0];
      state.settings.pendingExtra.shift();
      if (!p || !p.id) continue;
      var gap = p.gap || gapOfSlot(p.id);
      var fams = [];
      if (p.family) fams.push(p.family);
      var more = familiesAtTwo(state, gap);
      for (var i = 0; i < more.length; i++) if (fams.indexOf(more[i]) < 0) fams.push(more[i]);
      out.push(activateSlot(state, p.id, gap, fams, today));
    }
    return out;
  }

  /** families の全セルが count===0 の有効 slot を退役させる。返り値は退役した id の配列 */
  function retireCleared(state, today) {
    var out = [];
    var list = state.settings.extraFields;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || f.retiredAt) continue;
      var fams = Array.isArray(f.families) ? f.families : [];
      if (!fams.length) continue;
      var gap = f.gap || gapOfSlot(f.id);
      var allZero = true;
      for (var j = 0; j < fams.length; j++) {
        var cell = state.recurrence[cellKey(gap, fams[j])];
        if (cell && cell.count > 0) { allZero = false; break; }
      }
      if (allZero) {
        f.retiredAt = today;
        out.push(f.id);
      }
    }
    return out;
  }

  /** セルの膜が消えたとき、その型×族を待つ pendingExtra を整理する */
  function settlePendingAfterClear(state, gap, family) {
    var id = slotFor(gap);
    if (!id) return;
    var p = findPending(state, id);
    if (!p || p.family !== family) return;
    var others = familiesAtTwo(state, gap);
    if (others.length) p.family = others[0];
    else removePending(state, id);
  }

  // ---------------------------------------------------------------
  // recordOutcome（⑥の規律）
  // ---------------------------------------------------------------

  /**
   * @param {State} state   破壊しない。返り値の state が新しい状態
   * @param {LogEntry} entry
   * @param {string=} today  'YYYY-MM-DD'（省略時はローカル今日）
   * @returns {{ state: State, added: ExtraField|null, pending: ExtraField|null, retired: string[], promoted: ExtraField|null }}
   */
  function recordOutcome(state, entry, today) {
    var nil = { state: state, added: null, pending: null, retired: [], promoted: null, promotedAll: [] };
    if (!state || !entry) return nil;
    // speed は格子・再発・解放判定に一切入れない（呼ばないのが原則だが防御）
    if (entry.mode === 'speed') return nil;

    today = today || todayStr();
    var s = ensure(clone(state));
    var family = familyOfEntry(entry);
    var gap = entry.gap || 'none';
    var nowIso = entry.at || new Date().toISOString();
    var complete = isComplete(entry);

    var res = { state: s, added: null, pending: null, retired: [], promoted: null, promotedAll: [] };

    // カウンタ（コミット数は未完でも数える。live は今日の n/3 も進める）
    s.counters.committed += 1;
    if (entry.mode === 'live') {
      s.counters.live += 1;
      if (s.counters.liveToday.date !== today) s.counters.liveToday = { date: today, n: 0 };
      s.counters.liveToday.n += 1;
    }

    // 未完（タイムアップ等）は格子・族統計に入れない
    if (!complete || !family) {
      return res;
    }

    // 族統計（drill/live のみ。speed は上で弾いている）
    var fs = s.familyStats[family] || (s.familyStats[family] = { attempts: 0, recent: [] });
    if (typeof fs.attempts !== 'number') fs.attempts = 0;
    if (!Array.isArray(fs.recent)) fs.recent = [];
    fs.attempts += 1;
    fs.recent.push({ score: scoreOf(entry), hint: !!(entry.hints && entry.hints.length), gap: gap });
    while (fs.recent.length > 10) fs.recent.shift();

    if (gap === 'none') {
      // その族の全セル（count≥1）を前進させる
      for (var key in s.recurrence) {
        var kk = splitKey(key);
        var cell = s.recurrence[key];
        if (!kk || kk.family !== family || !cell || !(cell.count >= 1)) continue;
        cell.cleanStreak = (Number(cell.cleanStreak) || 0) + 1;
        cell.due = addDays(today, intervalFor(cell.cleanStreak));
        cell.lastAt = nowIso;
        if (cell.cleanStreak >= UNLOCK.retireClean) {
          // 膜消去：再発カウントも消える。cleanStreak は維持
          cell.count = 0;
          settlePendingAfterClear(s, kk.gap, family);
        }
      }
    } else {
      var ck = cellKey(gap, family);
      var c = s.recurrence[ck] || (s.recurrence[ck] = { count: 0, lastAt: null, cleanStreak: 0, due: null });
      c.count = (Number(c.count) || 0) + 1;
      c.cleanStreak = 0;
      c.due = addDays(today, INTERVALS[0]);
      c.lastAt = nowIso;

      // 発火：count が 2 に到達
      if (c.count === 2) {
        var slotId = slotFor(gap);
        if (slotId) {
          var slot = findSlot(s, slotId);
          if (slot && !slot.retiredAt) {
            // 既に登録済み（有効、または手動で無効）：families に追記するだけ。重複スロットは作らない
            addFamily(slot, family);
          } else if (activeCount(s) < UNLOCK.maxActiveExtra) {
            // 未登録 or 退役済み → 枠があれば（再）有効化
            res.added = activateSlot(s, slotId, gap, [family], today);
          } else {
            // 枠が無い → 提案待ち（同 id は1件）
            var p = findPending(s, slotId);
            if (!p) {
              p = { id: slotId, gap: gap, family: family, since: today };
              s.settings.pendingExtra.push(p);
            }
            res.pending = p;
          }
        }
      }
    }

    // 退役：families の全セルが count===0 になった slot
    res.retired = retireCleared(s, today);
    // 空いた枠に提案待ちを昇格
    if (res.retired.length) {
      res.promotedAll = promotePending(s, today);
      res.promoted = res.promotedAll.length ? res.promotedAll[0] : null;
    }
    return res;
  }

  // ---------------------------------------------------------------
  // dueFamilies / mapCells / stableFamilies / speedUnlocked
  // ---------------------------------------------------------------

  /** due が today 以前で膜のある（count≥1）セルを持つ族。due の早い順 */
  function dueFamilies(state, today) {
    if (!state || !state.recurrence) return [];
    today = today || todayStr();
    var best = {};
    for (var key in state.recurrence) {
      var kk = splitKey(key);
      var cell = state.recurrence[key];
      if (!kk || !cell || !(cell.count >= 1) || !cell.due) continue;
      if (String(cell.due) > today) continue;
      if (!best[kk.family] || cell.due < best[kk.family]) best[kk.family] = cell.due;
    }
    var fams = Object.keys(best);
    fams.sort(function (a, b) {
      if (best[a] !== best[b]) return best[a] < best[b] ? -1 : 1;
      var d = familyRank(a) - familyRank(b);
      return d !== 0 ? d : (a < b ? -1 : a > b ? 1 : 0);
    });
    return fams;
  }

  /**
   * 格子のセル。行＝出題済みの族（drill/live・完走分 ∪ familyStats ∪ recurrence に現れる族）、列＝5型。
   * live は実戦（mode:'live'）でその型が付いた件数。speed・未完は数えない。
   */
  function mapCells(state, log) {
    state = state || {};
    var rec = state.recurrence || {};
    var famSet = {};
    for (var fsKey in (state.familyStats || {})) famSet[fsKey] = true;
    var liveCount = {};
    var i;
    if (Array.isArray(log)) {
      for (i = 0; i < log.length; i++) {
        var e = log[i];
        if (!e || e.mode === 'speed' || !isComplete(e)) continue;
        var f = familyOfEntry(e);
        if (!f) continue;
        famSet[f] = true;
        if (e.mode === 'live' && e.gap && e.gap !== 'none') {
          var lk = cellKey(e.gap, f);
          liveCount[lk] = (liveCount[lk] || 0) + 1;
        }
      }
    }
    for (var key in rec) {
      var kk = splitKey(key);
      if (kk) famSet[kk.family] = true;
    }
    var fams = sortFamilies(Object.keys(famSet));
    var cols = GAP_TYPES.filter(function (g) { return g.remedySlot; }).map(function (g) { return g.id; });
    var out = [];
    for (i = 0; i < fams.length; i++) {
      for (var j = 0; j < cols.length; j++) {
        var ck = cellKey(cols[j], fams[i]);
        var cell = rec[ck] || null;
        out.push({
          family: fams[i],
          gap: cols[j],
          count: cell ? (Number(cell.count) || 0) : 0,
          cleanStreak: cell ? (Number(cell.cleanStreak) || 0) : 0,
          due: cell && cell.due ? cell.due : null,
          live: liveCount[ck] || 0
        });
      }
    }
    return out;
  }

  /** 直近 stableWindow 件が揃い、全て score≥stableScore かつ hint=false の族 */
  function stableFamilies(state) {
    var fsAll = state && state.familyStats ? state.familyStats : {};
    var out = [];
    for (var f in fsAll) {
      var fs = fsAll[f];
      var recent = fs && Array.isArray(fs.recent) ? fs.recent : [];
      if (recent.length < UNLOCK.stableWindow) continue;
      var tail = recent.slice(-UNLOCK.stableWindow);
      var ok = true;
      for (var i = 0; i < tail.length; i++) {
        var r = tail[i];
        if (!r || typeof r.score !== 'number' || r.score < UNLOCK.stableScore || r.hint) { ok = false; break; }
      }
      if (ok) out.push(f);
    }
    return sortFamilies(out);
  }

  /**
   * 速度モードの解放判定。
   *  committed ≥ minCommitted ／ slow・gen（live 除く）・完走の直近 window 件のうち stableOfLast 件以上が score≥minScore
   *  ／ 直近10件（speed 除く・完走）で同一セルの再発が2連続していない。
   *  一度解放済み（settings.speedUnlockedAt）なら ok:true。
   */
  function speedUnlocked(state, log) {
    state = state || {};
    log = Array.isArray(log) ? log : [];
    var i;
    var committed;
    if (state.counters && typeof state.counters.committed === 'number') {
      committed = state.counters.committed;
    } else {
      committed = 0;
      for (i = 0; i < log.length; i++) if (log[i] && log[i].mode !== 'speed') committed++;
    }

    var gen = [];
    var nonSpeed = [];
    for (i = 0; i < log.length; i++) {
      var e = log[i];
      if (!e || e.mode === 'speed' || !isComplete(e)) continue;
      nonSpeed.push(e);
      if (e.mode === 'live') continue;
      if (e.tempo && e.tempo !== 'slow') continue;
      gen.push(e);
    }
    var tail = gen.slice(-UNLOCK.window);
    var stable = 0;
    for (i = 0; i < tail.length; i++) {
      var sc = scoreOf(tail[i]);
      if (typeof sc === 'number' && sc >= UNLOCK.minScore) stable++;
    }

    var last10 = nonSpeed.slice(-10);
    var blocked = false;
    for (i = 1; i < last10.length && !blocked; i++) {
      var a = last10[i - 1], b = last10[i];
      if (!a.gap || a.gap === 'none' || a.gap !== b.gap) continue;
      var fa = familyOfEntry(a), fb = familyOfEntry(b);
      if (fa && fa === fb) blocked = true;
    }

    var already = !!(state.settings && state.settings.speedUnlockedAt);
    var ok = already || (committed >= UNLOCK.minCommitted && stable >= UNLOCK.stableOfLast && !blocked);
    return { ok: ok, stable: stable, need: UNLOCK.stableOfLast, blockedByRecurrence: blocked };
  }

  return {
    GAP_TYPES: GAP_TYPES,
    RUBRIC: RUBRIC,
    BASELINE_FOLD: BASELINE_FOLD,
    UNLOCK: UNLOCK,
    LIMITS: LIMITS,
    INTERVALS: INTERVALS,
    hintFor: hintFor,
    recordOutcome: recordOutcome,
    dueFamilies: dueFamilies,
    mapCells: mapCells,
    stableFamilies: stableFamilies,
    speedUnlocked: speedUnlocked,
    scoreOf: scoreOf,
    // 補助（契約外・UI/テスト用）
    addDays: addDays,
    intervalFor: intervalFor,
    slotFor: slotFor
  };
})();

if (typeof module !== 'undefined') module.exports = PD.gaps;
