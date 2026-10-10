// premise-drill: PD.gaps のテスト（T5）。SPEC ⑬ T5 の受入を1項目ずつ assert する。
'use strict';

var path = require('path');
var gaps = require(path.join(__dirname, '..', 'js', 'gaps.js'));

var T0 = '2026-10-10';

function freshState() {
  return {
    version: 1,
    stage: 1,
    settings: {
      wizardNode: 'cb', wizardBfacing: 'unknown', wizardBetDecimals: 1, sizes: [33, 50],
      extraFields: [], pendingExtra: [], speedUnlockedAt: null
    },
    recurrence: {},
    familyStats: {},
    counters: { committed: 0, live: 0, speed: 0, liveToday: { date: null, n: 0 } }
  };
}

var seq = 0;
function entry(opts) {
  opts = opts || {};
  seq++;
  var fam = opts.family || 'bw_sd_33';
  var m = /^(.*)_(33|50|x)$/.exec(fam);
  var cls = m ? m[1] : 'bw_sd';
  var size = m && m[2] !== 'x' ? Number(m[2]) : 33;
  var e = {
    id: 'l_' + seq,
    at: opts.at || ('2026-10-10T00:00:' + String(seq % 60).padStart(2, '0') + 'Z'),
    mode: opts.mode || 'drill',
    tempo: opts.tempo || 'slow',
    reason: 'random',
    spot: { id: 's_' + seq, cls: cls, size: size, family: fam, board: 'QsJd9c', hero: 'Ad4d', villainPos: 'BTN' },
    sheet: opts.sheet || {},
    hints: opts.hints || [],
    commit: { elapsedMs: 1000, fieldTimes: {}, order: ['f1', 'f2', 'f3', 'f4', 'f5'], timedOut: false,
              incomplete: !!opts.incomplete, confidence: 80 },
    truth: opts.truth || { used: true, rangeFoldPct: 30, heroFold: 100, heroCall: 0, heroRaise: 0, buckets: null, note: '' },
    postCheck: opts.postCheck || { drawRanksMissing: [], drawRanksExtra: [], heroFeatMismatch: [], rankOrder: false },
    selfScore: { procedure: 3, sizeFold: 2, drawProtect: 2, action: 1, total: typeof opts.score === 'number' ? opts.score : 8 },
    claude: opts.claude || null,
    gap: opts.gap || 'none',
    gapNote: '',
    scoreUsed: opts.scoreUsed || 'self',
    live: null
  };
  if (opts.commit) for (var k in opts.commit) e.commit[k] = opts.commit[k];
  return e;
}

function rec(state, opts, today) {
  return gaps.recordOutcome(state, entry(opts), today || T0);
}

function slots(state, id) {
  return state.settings.extraFields.filter(function (f) { return f.id === id; });
}

module.exports = {
  name: 'gaps (PD.gaps)',
  run: function (assert) {
    var r, s;

    // --- 定数の形
    assert.strictEqual(gaps.GAP_TYPES.length, 7, 'GAP_TYPES は 5型+none+unknown_concept');
    assert.deepStrictEqual(gaps.GAP_TYPES.map(function (g) { return g.id; }),
      ['range_state', 'baseline', 'rule', 'strength_order', 'middling', 'none', 'unknown_concept']);
    assert.deepStrictEqual(gaps.RUBRIC.map(function (x) { return x.id + ':' + x.pts; }),
      ['procedure:3', 'sizeFold:2', 'drawProtect:4', 'action:1']);
    assert.deepStrictEqual(gaps.BASELINE_FOLD, { 33: 30, 50: 40 });
    assert.deepStrictEqual(gaps.UNLOCK, { minCommitted: 20, stableOfLast: 15, window: 20, minScore: 7,
      stableScore: 7, stableWindow: 5, maxActiveExtra: 2, retireClean: 4 });
    assert.deepStrictEqual(gaps.LIMITS, { slow: null, normal: 180, speed: 60 });
    assert.deepStrictEqual(gaps.INTERVALS, [1, 2, 4, 8]);

    // ============================================================
    // 1. 同 (range_state, bw_sd_33) を2回 → 2回目に added.id==='pf_removed'、3回目は added===null
    // ============================================================
    s = freshState();
    r = rec(s, { gap: 'range_state', family: 'bw_sd_33' });
    assert.strictEqual(r.added, null, '1回目は added 無し');
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].count, 1);
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].due, '2026-10-11', '再発の due は today+1');
    r = rec(r.state, { gap: 'range_state', family: 'bw_sd_33' });
    assert.ok(r.added && r.added.id === 'pf_removed', '2回目で pf_removed が追加される');
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].count, 2);
    assert.strictEqual(slots(r.state, 'pf_removed').length, 1);
    assert.deepStrictEqual(slots(r.state, 'pf_removed')[0].families, ['bw_sd_33']);
    r = rec(r.state, { gap: 'range_state', family: 'bw_sd_33' });
    assert.strictEqual(r.added, null, '3回目は added===null');
    assert.strictEqual(slots(r.state, 'pf_removed').length, 1, '重複スロット無し');
    var afterThree = r.state;

    // ============================================================
    // 2. 別族 (range_state, dry_high_33) で2回目 → added===null かつ pf_removed が1件のみで families に両族
    // ============================================================
    r = rec(afterThree, { gap: 'range_state', family: 'dry_high_33' });
    assert.strictEqual(r.added, null);
    r = rec(r.state, { gap: 'range_state', family: 'dry_high_33' });
    assert.strictEqual(r.added, null, '同 slot が有効なら added===null');
    assert.strictEqual(r.pending, null);
    assert.strictEqual(slots(r.state, 'pf_removed').length, 1, 'pf_removed は1件のみ');
    assert.deepStrictEqual(slots(r.state, 'pf_removed')[0].families.slice().sort(), ['bw_sd_33', 'dry_high_33']);
    var twoFamilies = r.state;

    // ============================================================
    // 3. 有効 extra が2つある状態で別型2回目 → added===null かつ pending あり
    // ============================================================
    s = JSON.parse(JSON.stringify(twoFamilies));
    r = rec(s, { gap: 'baseline', family: 'mid_50' });
    r = rec(r.state, { gap: 'baseline', family: 'mid_50' });
    assert.ok(r.added && r.added.id === 'baseline_src', '2枠目は追加される');
    var active = r.state.settings.extraFields.filter(function (f) { return f.enabled && !f.retiredAt; });
    assert.strictEqual(active.length, 2, '有効 extra が2つ');
    r = rec(r.state, { gap: 'rule', family: 'low_33' });
    assert.strictEqual(r.added, null);
    assert.strictEqual(r.pending, null, '1回目は pending も無し');
    r = rec(r.state, { gap: 'rule', family: 'low_33' });
    assert.strictEqual(r.added, null, '枠が無いので added===null');
    assert.ok(r.pending && r.pending.id === 'rule_cond', 'pending に rule_cond');
    assert.strictEqual(r.state.settings.pendingExtra.length, 1);
    assert.strictEqual(r.state.settings.pendingExtra[0].id, 'rule_cond');
    assert.strictEqual(r.state.settings.pendingExtra[0].family, 'low_33');
    assert.strictEqual(r.state.settings.pendingExtra[0].since, T0);
    assert.strictEqual(slots(r.state, 'rule_cond').length, 0, 'extraFields には積まれない');
    // 同 id は1件：もう一度 2 に到達しても増えない（別族で）
    r = rec(r.state, { gap: 'rule', family: 'paired_33' });
    r = rec(r.state, { gap: 'rule', family: 'paired_33' });
    assert.strictEqual(r.state.settings.pendingExtra.length, 1, 'pendingExtra の同 id は1件');
    var fullState = r.state;

    // ============================================================
    // 4. gap 'none' を同族で4回保存 → cleanStreak 1→2→3→4、due 間隔 1→2→4→8 日、他族のセルは不変
    // ============================================================
    s = JSON.parse(JSON.stringify(twoFamilies));
    // bw_sd_33 に2つ目の型のセル（count 1）も用意して「全セル」を確認する
    r = rec(s, { gap: 'rule', family: 'bw_sd_33' });
    s = r.state;
    var otherBefore = JSON.stringify(s.recurrence['range_state|dry_high_33']);
    var expectStreak = [1, 2, 3, 4];
    var expectDue = ['2026-10-11', '2026-10-12', '2026-10-14', '2026-10-18'];
    for (var i = 0; i < 4; i++) {
      r = rec(s, { gap: 'none', family: 'bw_sd_33' });
      s = r.state;
      var c1 = s.recurrence['range_state|bw_sd_33'];
      var c2 = s.recurrence['rule|bw_sd_33'];
      assert.strictEqual(c1.cleanStreak, expectStreak[i], 'range_state|bw_sd_33 cleanStreak ' + (i + 1) + '回目');
      assert.strictEqual(c2.cleanStreak, expectStreak[i], 'rule|bw_sd_33 cleanStreak ' + (i + 1) + '回目');
      assert.strictEqual(c1.due, expectDue[i], 'due 間隔 ' + (i + 1) + '回目');
      assert.strictEqual(c2.due, expectDue[i], 'due 間隔（2つ目のセル）' + (i + 1) + '回目');
      assert.strictEqual(JSON.stringify(s.recurrence['range_state|dry_high_33']), otherBefore, '他族のセルは不変');
    }
    var afterFourNone = s;

    // ============================================================
    // 5. cleanStreak 4 到達でそのセル count===0、由来セルが全て 0 の slot に retiredAt
    // ============================================================
    assert.strictEqual(afterFourNone.recurrence['range_state|bw_sd_33'].count, 0, '膜消去 count=0');
    assert.strictEqual(afterFourNone.recurrence['rule|bw_sd_33'].count, 0);
    assert.strictEqual(afterFourNone.recurrence['range_state|bw_sd_33'].cleanStreak, 4, 'cleanStreak は維持');
    // pf_removed の families は bw_sd_33 と dry_high_33。dry_high_33 がまだ count 2 なので退役しない
    assert.strictEqual(slots(afterFourNone, 'pf_removed')[0].retiredAt, null, '由来セルが残っていれば退役しない');
    // dry_high_33 も4回 none で晴らす → 退役
    s = afterFourNone;
    var retiredSeen = [];
    for (i = 0; i < 4; i++) {
      r = rec(s, { gap: 'none', family: 'dry_high_33' });
      s = r.state;
      retiredSeen = retiredSeen.concat(r.retired);
    }
    assert.strictEqual(s.recurrence['range_state|dry_high_33'].count, 0);
    assert.deepStrictEqual(retiredSeen, ['pf_removed'], '退役は1回だけ返る');
    assert.strictEqual(slots(s, 'pf_removed')[0].retiredAt, T0, '由来セルが全て 0 → retiredAt');
    assert.strictEqual(slots(s, 'pf_removed').length, 1);
    var afterRetire = s;

    // 膜が消えた後の none は count 0 のセルを前進させない
    r = rec(afterRetire, { gap: 'none', family: 'bw_sd_33' });
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].cleanStreak, 4, 'count 0 のセルは cleanStreak 据え置き');
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].due, '2026-10-18', 'count 0 のセルは due 据え置き');

    // ============================================================
    // 6. 退役後に同セルで再び2回再発 → 再有効化（retiredAt===null、重複スロット無し）
    // ============================================================
    r = rec(afterRetire, { gap: 'range_state', family: 'bw_sd_33' });
    assert.strictEqual(r.added, null);
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].count, 1);
    assert.strictEqual(r.state.recurrence['range_state|bw_sd_33'].cleanStreak, 0, '再発で cleanStreak=0');
    assert.strictEqual(slots(r.state, 'pf_removed')[0].retiredAt, T0, '1回目ではまだ退役のまま');
    r = rec(r.state, { gap: 'range_state', family: 'bw_sd_33' });
    assert.ok(r.added && r.added.id === 'pf_removed', '2回目で再有効化が added に返る');
    assert.strictEqual(slots(r.state, 'pf_removed').length, 1, '重複スロット無し');
    assert.strictEqual(slots(r.state, 'pf_removed')[0].retiredAt, null, 'retiredAt===null');
    assert.strictEqual(slots(r.state, 'pf_removed')[0].enabled, true);
    assert.ok(slots(r.state, 'pf_removed')[0].families.indexOf('bw_sd_33') >= 0);

    // ============================================================
    // 7. 枠が塞がった状態での退役 → pendingExtra の先頭が promoted
    // ============================================================
    // fullState：pf_removed(bw_sd_33, dry_high_33)・baseline_src(mid_50) が有効、pending=[rule_cond(low_33)]
    s = JSON.parse(JSON.stringify(fullState));
    assert.strictEqual(s.settings.pendingExtra[0].id, 'rule_cond');
    var promotedSeen = null;
    var retiredAll = [];
    for (i = 0; i < 4; i++) {
      r = rec(s, { gap: 'none', family: 'bw_sd_33' });
      s = r.state;
      retiredAll = retiredAll.concat(r.retired);
      if (r.promoted) promotedSeen = r.promoted;
    }
    for (i = 0; i < 4; i++) {
      r = rec(s, { gap: 'none', family: 'dry_high_33' });
      s = r.state;
      retiredAll = retiredAll.concat(r.retired);
      if (r.promoted) promotedSeen = r.promoted;
    }
    assert.deepStrictEqual(retiredAll, ['pf_removed'], 'pf_removed が退役');
    assert.ok(promotedSeen && promotedSeen.id === 'rule_cond', 'pendingExtra の先頭が promoted');
    assert.strictEqual(s.settings.pendingExtra.length, 0, 'pending から外れる');
    assert.strictEqual(slots(s, 'rule_cond').length, 1, 'rule_cond が extraFields に1件');
    assert.strictEqual(slots(s, 'rule_cond')[0].retiredAt, null);
    assert.strictEqual(slots(s, 'rule_cond')[0].enabled, true);
    assert.ok(slots(s, 'rule_cond')[0].families.indexOf('low_33') >= 0, '由来族 low_33');
    assert.ok(slots(s, 'rule_cond')[0].families.indexOf('paired_33') >= 0, 'count≥2 の paired_33 も由来に補われる');
    var activeNow = s.settings.extraFields.filter(function (f) { return f.enabled && !f.retiredAt; });
    assert.strictEqual(activeNow.length, 2, '有効枠は上限のまま');
    // 退役済みで枠が無いとき再び2回再発 → pending に積まれる（added 無し）
    r = rec(s, { gap: 'range_state', family: 'bw_sd_33' });
    r = rec(r.state, { gap: 'range_state', family: 'bw_sd_33' });
    assert.strictEqual(r.added, null, '枠が無い退役済み slot は再有効化しない');
    assert.ok(r.pending && r.pending.id === 'pf_removed', '退役済み slot も枠が無ければ pending');
    assert.strictEqual(slots(r.state, 'pf_removed').length, 1);

    // ============================================================
    // 8. recordOutcome に mode:'speed' の entry → state が deepEqual で不変
    // ============================================================
    s = JSON.parse(JSON.stringify(fullState));
    var snapshot = JSON.parse(JSON.stringify(s));
    r = rec(s, { mode: 'speed', tempo: 'speed', gap: 'range_state', family: 'bw_sd_33' });
    assert.deepStrictEqual(r.state, snapshot, 'speed は state を変えない（返り値）');
    assert.deepStrictEqual(s, snapshot, 'speed は入力 state も変えない');
    assert.strictEqual(r.added, null);
    assert.strictEqual(r.pending, null);
    assert.deepStrictEqual(r.retired, []);
    assert.strictEqual(r.promoted, null);

    // 入力 state は破壊されない（非 speed でも）
    s = freshState();
    var before = JSON.parse(JSON.stringify(s));
    rec(s, { gap: 'range_state', family: 'bw_sd_33' });
    assert.deepStrictEqual(s, before, '入力 state を破壊しない');

    // ============================================================
    // 9. speedUnlocked：committed 19 で ok:false／直近20中15が score≥7 で ok:true／同セル2連続再発で blockedByRecurrence:true
    // ============================================================
    function goodLog(n, scores) {
      var out = [];
      for (var k = 0; k < n; k++) {
        var fam = ['bw_sd_33', 'dry_high_33', 'mid_33', 'low_50'][k % 4];
        out.push(entry({ family: fam, score: scores[k], gap: 'none' }));
      }
      return out;
    }
    var scores15 = [];
    for (i = 0; i < 20; i++) scores15.push(i < 15 ? 8 : 5);
    var log20 = goodLog(20, scores15);
    s = freshState();
    s.counters.committed = 19;
    var u = gaps.speedUnlocked(s, log20);
    assert.strictEqual(u.ok, false, 'committed 19 で ok:false');
    assert.strictEqual(u.stable, 15);
    assert.strictEqual(u.need, 15);
    assert.strictEqual(u.blockedByRecurrence, false);
    s.counters.committed = 20;
    u = gaps.speedUnlocked(s, log20);
    assert.strictEqual(u.ok, true, '直近20中15が score≥7 で ok:true');
    // 14件だと false
    var scores14 = scores15.slice(); scores14[14] = 6;
    u = gaps.speedUnlocked(s, goodLog(20, scores14));
    assert.strictEqual(u.ok, false, '14件では ok:false');
    assert.strictEqual(u.stable, 14);
    // 同セル2連続再発
    var logBlocked = goodLog(18, scores15.slice(0, 18));
    logBlocked.push(entry({ family: 'mid_33', score: 8, gap: 'rule' }));
    logBlocked.push(entry({ family: 'mid_33', score: 8, gap: 'rule' }));
    u = gaps.speedUnlocked(s, logBlocked);
    assert.strictEqual(u.blockedByRecurrence, true, '同セル2連続再発で blocked');
    assert.strictEqual(u.ok, false);
    // 別族なら blocked ではない
    var logNotBlocked = goodLog(18, scores15.slice(0, 18));
    logNotBlocked.push(entry({ family: 'mid_33', score: 8, gap: 'rule' }));
    logNotBlocked.push(entry({ family: 'low_50', score: 8, gap: 'rule' }));
    u = gaps.speedUnlocked(s, logNotBlocked);
    assert.strictEqual(u.blockedByRecurrence, false, '別族の連続は blocked でない');
    assert.strictEqual(u.ok, true);
    // speed のエントリは解放判定に入らない
    var logWithSpeed = goodLog(20, scores15).concat([entry({ mode: 'speed', tempo: 'speed', score: 1, gap: 'rule' }),
      entry({ mode: 'speed', tempo: 'speed', score: 1, gap: 'rule' })]);
    u = gaps.speedUnlocked(s, logWithSpeed);
    assert.strictEqual(u.ok, true, 'speed エントリは窓に入らない');
    assert.strictEqual(u.stable, 15);

    // ============================================================
    // 10. incomplete:true の entry は mapCells・stableFamilies に影響しない
    // ============================================================
    s = freshState();
    r = rec(s, { gap: 'range_state', family: 'bw_sd_33', incomplete: true, commit: { timedOut: true } });
    assert.deepStrictEqual(r.state.recurrence, {}, '未完は recurrence に入らない');
    assert.deepStrictEqual(r.state.familyStats, {}, '未完は familyStats に入らない');
    var incLog = [entry({ gap: 'range_state', family: 'bw_sd_33', incomplete: true, commit: { timedOut: true } })];
    assert.deepStrictEqual(gaps.mapCells(r.state, incLog), [], '未完だけの族は格子に行を作らない');
    assert.deepStrictEqual(gaps.stableFamilies(r.state), []);
    // 完走5件で安定した族に未完を足しても安定のまま
    s = freshState();
    for (i = 0; i < 5; i++) { r = rec(s, { gap: 'none', family: 'mid_33', score: 9 }); s = r.state; }
    assert.deepStrictEqual(gaps.stableFamilies(s), ['mid_33']);
    r = rec(s, { gap: 'rule', family: 'mid_33', score: 2, incomplete: true, hints: [{ field: 'f1', tier: 1 }] });
    assert.deepStrictEqual(gaps.stableFamilies(r.state), ['mid_33'], '未完は stableFamilies に影響しない');
    var cellsInc = gaps.mapCells(r.state, [entry({ gap: 'rule', family: 'mid_33', mode: 'live', incomplete: true })]);
    var ruleMid = cellsInc.filter(function (c) { return c.family === 'mid_33' && c.gap === 'rule'; })[0];
    assert.ok(ruleMid, 'mid_33 の行はある（完走分の familyStats から）');
    assert.strictEqual(ruleMid.count, 0, '未完は count に影響しない');
    assert.strictEqual(ruleMid.live, 0, '未完の live は数えない');

    // mapCells の形：行＝出題済み族、列＝5型、live 件数
    s = freshState();
    r = rec(s, { gap: 'rule', family: 'mid_33' });
    r = rec(r.state, { gap: 'rule', family: 'mid_33', mode: 'live' });
    var mlog = [entry({ gap: 'rule', family: 'mid_33' }), entry({ gap: 'rule', family: 'mid_33', mode: 'live' }),
      entry({ gap: 'none', family: 'low_50' })];
    var cells = gaps.mapCells(r.state, mlog);
    assert.strictEqual(cells.length, 10, '2族 × 5型');
    assert.deepStrictEqual(cells.map(function (c) { return c.family; }).filter(function (f, k, a) { return a.indexOf(f) === k; }),
      ['mid_33', 'low_50'], '行順は cls 順');
    var rm = cells.filter(function (c) { return c.family === 'mid_33' && c.gap === 'rule'; })[0];
    assert.strictEqual(rm.count, 2);
    assert.strictEqual(rm.cleanStreak, 0);
    assert.strictEqual(rm.due, '2026-10-11');
    assert.strictEqual(rm.live, 1, 'live の件数');
    var lowNone = cells.filter(function (c) { return c.family === 'low_50'; });
    assert.strictEqual(lowNone.length, 5);
    assert.ok(lowNone.every(function (c) { return c.count === 0 && c.cleanStreak === 0 && c.due === null && c.live === 0; }));
    assert.ok(cells.every(function (c) { return c.gap !== 'none' && c.gap !== 'unknown_concept'; }), '列は5型のみ');

    // dueFamilies
    s = freshState();
    r = rec(s, { gap: 'rule', family: 'mid_33' });
    r = rec(r.state, { gap: 'baseline', family: 'low_50' }, '2026-10-05');
    assert.deepStrictEqual(gaps.dueFamilies(r.state, '2026-10-10'), ['low_50'], 'due 到来の族だけ');
    assert.deepStrictEqual(gaps.dueFamilies(r.state, '2026-10-11'), ['low_50', 'mid_33'], 'due の早い順');
    assert.deepStrictEqual(gaps.dueFamilies(r.state, '2026-10-04'), []);
    assert.deepStrictEqual(gaps.dueFamilies(afterFourNone, '2027-01-01').indexOf('bw_sd_33'), -1, 'count 0 のセルは due にならない');

    // ============================================================
    // 11. stableFamilies：直近5件 7,7,8,9,7 hint:false → 含む／4件のみ → 含まない／1件 hint:true → 含まない
    // ============================================================
    s = freshState();
    s.familyStats = {
      bw_sd_33: { attempts: 5, recent: [7, 7, 8, 9, 7].map(function (sc) { return { score: sc, hint: false, gap: 'none' }; }) },
      dry_high_33: { attempts: 4, recent: [7, 7, 8, 9].map(function (sc) { return { score: sc, hint: false, gap: 'none' }; }) },
      mid_33: { attempts: 5, recent: [7, 7, 8, 9, 7].map(function (sc, k) { return { score: sc, hint: k === 2, gap: 'none' }; }) },
      low_33: { attempts: 5, recent: [7, 6, 8, 9, 7].map(function (sc) { return { score: sc, hint: false, gap: 'none' }; }) },
      paired_50: { attempts: 7, recent: [3, 2, 7, 7, 8, 9, 7].map(function (sc) { return { score: sc, hint: false, gap: 'rule' }; }) }
    };
    var st = gaps.stableFamilies(s);
    assert.ok(st.indexOf('bw_sd_33') >= 0, '7,7,8,9,7 hint:false → 含む');
    assert.ok(st.indexOf('dry_high_33') < 0, '4件のみ → 含まない');
    assert.ok(st.indexOf('mid_33') < 0, '1件 hint:true → 含まない');
    assert.ok(st.indexOf('low_33') < 0, 'score 6 を含む → 含まない');
    assert.ok(st.indexOf('paired_50') >= 0, '直近5件だけ見る（古い低得点は無視）');
    // recordOutcome 経由でも同じ（recent は最大10件）
    s = freshState();
    for (i = 0; i < 12; i++) { r = rec(s, { gap: 'none', family: 'bw_sd_33', score: 9 }); s = r.state; }
    assert.strictEqual(s.familyStats.bw_sd_33.recent.length, 10, 'recent は最大10');
    assert.strictEqual(s.familyStats.bw_sd_33.attempts, 12);
    assert.deepStrictEqual(gaps.stableFamilies(s), ['bw_sd_33']);

    // scoreOf
    assert.strictEqual(gaps.scoreOf(entry({ score: 6 })), 6);
    assert.strictEqual(gaps.scoreOf(entry({ score: 6, scoreUsed: 'claude', claude: { score: 9 } })), 9, 'scoreUsed claude');
    assert.strictEqual(gaps.scoreOf(entry({ score: 6, scoreUsed: 'claude', claude: null })), 6, 'claude 無しなら self');
    assert.strictEqual(gaps.scoreOf({ scoreUsed: 'self', selfScore: null, claude: null }), null);

    // ============================================================
    // 12. hintFor：foldPct=45,size=33→'baseline'／order が f4 先→'rule'／foldList 'QQ'→'range_state'／'AKs'→'range_state'／'A4o' のみ→range_state を出さない
    // ============================================================
    var h = gaps.hintFor({ spot: { size: 33 }, sheet: { f1: { foldPct: 45 } } });
    assert.strictEqual(h.suggest, 'baseline', 'foldPct=45,size=33 → baseline');
    assert.ok(h.reasons.length >= 1);
    h = gaps.hintFor({ spot: { size: 33 }, sheet: { f1: { foldPct: 32 } } });
    assert.strictEqual(h.suggest, null, '±10 以内は baseline を出さない');

    h = gaps.hintFor({ commit: { order: ['f1', 'f2', 'f4', 'f3', 'f5'] } });
    assert.strictEqual(h.suggest, 'rule', 'order が f4 先 → rule');
    h = gaps.hintFor({ commit: { fieldTimes: { f1: 10, f2: 20, f3: 50, f4: 40, f5: 60 } } });
    assert.strictEqual(h.suggest, 'rule', 'fieldTimes で f4 が f3 より先 → rule');
    h = gaps.hintFor({ commit: { order: ['f1', 'f2', 'f3', 'f4', 'f5'], fieldTimes: { f1: 10, f2: 20, f3: 30, f4: 40, f5: 60 } } });
    assert.strictEqual(h.suggest, null, '正順なら出さない');

    h = gaps.hintFor({ sheet: { f4: { foldList: ['J2o', 'T5o', 'QQ'] } } });
    assert.strictEqual(h.suggest, 'range_state', "foldList に 'QQ' → range_state");
    h = gaps.hintFor({ sheet: { f4: { foldList: ['AKs'] } } });
    assert.strictEqual(h.suggest, 'range_state', "foldList に 'AKs' → range_state");
    h = gaps.hintFor({ sheet: { f4: { foldList: ['A4o'] } } });
    assert.strictEqual(h.suggest, null, "foldList に 'A4o' のみ → range_state を出さない");
    assert.ok(h.reasons.every(function (x) { return x.indexOf('range_state') !== 0; }));
    h = gaps.hintFor({ sheet: { f4: { foldList: ['AsKh'] } } });
    assert.strictEqual(h.suggest, 'range_state', "'AsKh' 形式も range_state");
    h = gaps.hintFor({ claude: { gap_type: 'range_state' } });
    assert.strictEqual(h.suggest, 'range_state', 'Claude の gap_type');

    // その他の手がかり
    h = gaps.hintFor({ spot: { size: 50 }, sheet: { f1: { foldPct: 30 } } });
    assert.strictEqual(h.suggest, 'rule', '50% で ①≤32 → rule');
    h = gaps.hintFor({ sheet: { f4: { enough: 'yes', nextLayer: ['A4o'] } } });
    assert.strictEqual(h.suggest, 'rule', '足りるのに nextLayer → rule');
    h = gaps.hintFor({ postCheck: { rankOrder: true } });
    assert.strictEqual(h.suggest, 'strength_order');
    h = gaps.hintFor({ postCheck: { heroFeatMismatch: ['bdfd', 'gut'] } });
    assert.strictEqual(h.suggest, 'strength_order');
    h = gaps.hintFor({ claude: { boundary_hand_named: false } });
    assert.strictEqual(h.suggest, 'strength_order');
    h = gaps.hintFor({ sheet: { f5: { confidence: 50, position: 'edge' } }, truth: { used: true, heroFold: 100 } });
    assert.strictEqual(h.suggest, 'middling');
    h = gaps.hintFor({ sheet: { f5: { confidence: 50, position: 'edge' } }, truth: { used: true, heroFold: 60 } });
    assert.strictEqual(h.suggest, null, '真値が極端でなければ middling を出さない');
    h = gaps.hintFor({ hints: [{ field: 'f1', tier: 2 }] });
    assert.strictEqual(h.suggest, 'baseline', '①のヒント2段目 → baseline');
    h = gaps.hintFor({ commit: { fieldTimes: { f1: 99, f2: 20, f3: 30, f4: 40, f5: 60 } } });
    assert.strictEqual(h.suggest, 'baseline', '①が最後に完了 → baseline');
    h = gaps.hintFor({});
    assert.deepStrictEqual(h, { suggest: null, reasons: [] }, '手がかり無し');

    // 補助：addDays / intervalFor
    assert.strictEqual(gaps.addDays('2026-10-30', 2), '2026-11-01');
    assert.strictEqual(gaps.addDays('2026-12-31', 1), '2027-01-01');
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(gaps.intervalFor), [1, 2, 4, 8, 8]);

    // カウンタ：live の n/3
    s = freshState();
    r = rec(s, { mode: 'live', gap: 'none', family: 'mid_33' });
    assert.strictEqual(r.state.counters.committed, 1);
    assert.strictEqual(r.state.counters.live, 1);
    assert.deepStrictEqual(r.state.counters.liveToday, { date: T0, n: 1 });
    r = rec(r.state, { mode: 'live', gap: 'none', family: 'mid_33' }, '2026-10-11');
    assert.deepStrictEqual(r.state.counters.liveToday, { date: '2026-10-11', n: 1 }, '日付が変わると n はリセット');
  }
};
