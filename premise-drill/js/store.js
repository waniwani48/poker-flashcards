// premise-drill: PD.store（T6）。localStorage I/O（try/catch）・メモリフォールバック・export/import・
// LOG_CAP 間引き・QuotaExceeded 対応・pd_model。SPEC ⑫ の契約：
//   KEYS / LOG_CAP / loadState / saveState / loadLog / appendLog / updateLog / exportJSON / importJSON /
//   resetAll / getApiKey / setApiKey / getModel / setModel
// 依存なし。importJSON の再計算だけは、実行時に PD.gaps.recordOutcome が居ればそれを使い、無ければ飛ばす。
// own.html のキー（pokerSRS_v1 / pokerJudgeModel / pokerMode / pokerStreak）には一切触らない。共有は pokerApiKey のみ。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.store = (function () {
  'use strict';

  var KEYS = { state: 'pd_state_v1', log: 'pd_log_v1', model: 'pd_model', apiKey: 'pokerApiKey' };
  var LOG_CAP = 600;
  var DEFAULT_MODEL = 'claude-opus-5';
  var QUOTA_RETRIES = 5;       // QuotaExceeded 時の再試行回数（初回の失敗後に最大5回）
  var QUOTA_TRIM_RATIO = 0.1;  // 再試行1回ごとに古い順から間引く割合
  var RECENT_CAP = 10;         // familyStats[f].recent の上限

  var mem = {};                // localStorage が無い／触れない環境の代替（プロセス内のみ）

  var hasOwn = Object.prototype.hasOwnProperty;

  function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // ---------------------------------------------------------------------------
  // 低レベル I/O
  // ---------------------------------------------------------------------------

  /** 使える localStorage を返す。無い・アクセスで例外（SecurityError 等）なら null */
  function ls() {
    try {
      var s = root.localStorage;
      if (s && typeof s.getItem === 'function' && typeof s.setItem === 'function' && typeof s.removeItem === 'function') return s;
    } catch (e) { /* 使えない環境 */ }
    return null;
  }

  function getItem(key) {
    var s = ls();
    if (s) {
      try {
        var v = s.getItem(key);
        return (v === undefined) ? null : v;
      } catch (e) { return null; }
    }
    return hasOwn.call(mem, key) ? mem[key] : null;
  }

  /** 例外をそのまま伝える（Quota 判定は呼び出し側） */
  function setItemRaw(key, val) {
    var s = ls();
    if (s) { s.setItem(key, val); return; }
    mem[key] = String(val);
  }

  function setItemSafe(key, val) {
    try { setItemRaw(key, val); return true; } catch (e) { return false; }
  }

  function removeItem(key) {
    var s = ls();
    if (s) { try { s.removeItem(key); } catch (e) { /* 無視 */ } }
    delete mem[key];
  }

  /** QuotaExceededError（name）または code 22 / 1014 */
  function isQuotaError(e) {
    if (!e || typeof e !== 'object') return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
  }

  function parseJSON(text) {
    if (typeof text !== 'string' || !text) return undefined;
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** ローカル日付 'YYYY-MM-DD'（util に依存しない） */
  function isoDate(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function genId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  function defaultState() {
    return {
      version: 1,
      stage: 1,
      settings: {
        wizardNode: 'cb',
        wizardBfacing: 'unknown',
        wizardBetDecimals: 1,
        sizes: [33, 50],
        extraFields: [],
        pendingExtra: [],
        speedUnlockedAt: null
      },
      recurrence: {},
      familyStats: {},
      counters: { committed: 0, live: 0, speed: 0, liveToday: { date: isoDate(), n: 0 } }
    };
  }

  /** 欠けた項目を既定で補う（古い保存・手編集・部分インポートへの防御）。liveToday は日付が変わっていたら 0 に戻す */
  function normalizeState(s) {
    var d = defaultState();
    if (!isObj(s)) return d;
    var k;
    if (typeof s.version !== 'number') s.version = 1;
    if (typeof s.stage !== 'number') s.stage = 1;

    if (!isObj(s.settings)) s.settings = {};
    for (k in d.settings) {
      if (hasOwn.call(d.settings, k) && !hasOwn.call(s.settings, k)) s.settings[k] = d.settings[k];
    }
    if (!Array.isArray(s.settings.sizes) || !s.settings.sizes.length) s.settings.sizes = d.settings.sizes;
    if (!Array.isArray(s.settings.extraFields)) s.settings.extraFields = [];
    if (!Array.isArray(s.settings.pendingExtra)) s.settings.pendingExtra = [];

    if (!isObj(s.recurrence)) s.recurrence = {};
    if (!isObj(s.familyStats)) s.familyStats = {};

    if (!isObj(s.counters)) s.counters = {};
    for (k in d.counters) {
      if (hasOwn.call(d.counters, k) && !hasOwn.call(s.counters, k)) s.counters[k] = d.counters[k];
    }
    var today = isoDate();
    if (!isObj(s.counters.liveToday) || s.counters.liveToday.date !== today) {
      s.counters.liveToday = { date: today, n: 0 };
    }
    if (typeof s.counters.liveToday.n !== 'number') s.counters.liveToday.n = 0;
    return s;
  }

  /** 無ければ既定を生成して保存。壊れていても既定で作り直す */
  function loadState() {
    var raw = getItem(KEYS.state);
    var parsed = parseJSON(raw);
    if (isObj(parsed)) return normalizeState(parsed);
    var d = defaultState();
    saveState(d);
    return d;
  }

  function saveState(s) {
    if (!isObj(s)) return;
    var text;
    try { text = JSON.stringify(s); } catch (e) { return; }
    setItemSafe(KEYS.state, text);
  }

  // ---------------------------------------------------------------------------
  // Log
  // ---------------------------------------------------------------------------

  function loadLog() {
    var parsed = parseJSON(getItem(KEYS.log));
    return Array.isArray(parsed) ? parsed : [];
  }

  /**
   * ログを保存する。LOG_CAP 超は古い順に間引く。setItem が QuotaExceededError なら
   * 古い順に 10% ずつ間引いて再試行（最大 QUOTA_RETRIES 回）。全て失敗なら ok:false（保存内容は変わらない）。
   * trimmed は「実際に保存から消えた件数」。
   */
  function saveLog(log) {
    var trimmed = 0;
    if (log.length > LOG_CAP) {
      trimmed = log.length - LOG_CAP;
      log = log.slice(trimmed);
    }
    for (var attempt = 0; ; attempt++) {
      try {
        setItemRaw(KEYS.log, JSON.stringify(log));
        return { ok: true, trimmed: trimmed, length: log.length };
      } catch (e) {
        if (!isQuotaError(e) || attempt >= QUOTA_RETRIES || log.length <= 1) {
          return { ok: false, trimmed: 0, length: log.length };
        }
        var cut = Math.ceil(log.length * QUOTA_TRIM_RATIO);
        if (cut < 1) cut = 1;
        if (cut >= log.length) cut = log.length - 1;   // 最新（今回の追記分）は最後まで残す
        log = log.slice(cut);
        trimmed += cut;
      }
    }
  }

  function appendLog(e) {
    if (!isObj(e)) return { ok: false, trimmed: 0 };
    if (typeof e.id !== 'string' || !e.id) e.id = genId('l');
    if (typeof e.at !== 'string' || !e.at) e.at = new Date().toISOString();
    var log = loadLog();
    log.push(e);
    var r = saveLog(log);
    return { ok: r.ok, trimmed: r.trimmed };
  }

  /** id で1件を浅くマージ。見つからなければ何もしない */
  function updateLog(id, patch) {
    if (typeof id !== 'string' || !id || !isObj(patch)) return;
    var log = loadLog();
    for (var i = log.length - 1; i >= 0; i--) {
      var e = log[i];
      if (isObj(e) && e.id === id) {
        for (var k in patch) if (hasOwn.call(patch, k)) e[k] = patch[k];
        saveLog(log);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  /** { v:1, exportedAt, state, log }。pokerApiKey と pd_model は含めない */
  function exportJSON() {
    return JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), state: loadState(), log: loadLog() });
  }

  function byAt(a, b) {
    var x = (a && typeof a.at === 'string') ? a.at : '';
    var y = (b && typeof b.at === 'string') ? b.at : '';
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  /** scoreUsed に従う採点値（PD.gaps.scoreOf が居ればそれを優先） */
  function scoreOf(e) {
    var gaps = root.PD && root.PD.gaps;
    if (gaps && typeof gaps.scoreOf === 'function') {
      try { return gaps.scoreOf(e); } catch (err) { /* 下の自前判定へ */ }
    }
    if (e.scoreUsed === 'claude' && isObj(e.claude) && typeof e.claude.score === 'number') return e.claude.score;
    if (isObj(e.selfScore) && typeof e.selfScore.total === 'number') return e.selfScore.total;
    if (isObj(e.claude) && typeof e.claude.score === 'number') return e.claude.score;
    return null;
  }

  /** familyStats に1件積む（④ の定義：attempts と recent≤10 の {score,hint,gap}）。speed と未完は積まない */
  function pushFamilyStat(stats, e) {
    var family = isObj(e.spot) && typeof e.spot.family === 'string' ? e.spot.family : null;
    if (!family) return;
    if (isObj(e.commit) && e.commit.incomplete) return;
    var st = stats[family];
    if (!isObj(st)) st = stats[family] = { attempts: 0, recent: [] };
    if (!Array.isArray(st.recent)) st.recent = [];
    st.attempts = (typeof st.attempts === 'number' ? st.attempts : 0) + 1;
    st.recent.push({ score: scoreOf(e), hint: Array.isArray(e.hints) && e.hints.length > 0, gap: typeof e.gap === 'string' ? e.gap : 'none' });
    while (st.recent.length > RECENT_CAP) st.recent.shift();
  }

  function dateOfEntry(e) {
    var s = (e && typeof e.at === 'string') ? e.at.slice(0, 10) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : isoDate();
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].id === id) return list[i];
    return null;
  }

  /**
   * 再演で得た追加欄（replayed）に、再演前の slot（orig）を重ねる。
   *   両方にある slot → 再演の結果を採り、families は和集合、enabled の手動 OFF（enabled:false かつ未退役）は引き継ぐ
   *   再演で出なかった slot → 元のまま残す（ログに履歴が無い slot を消さない）
   */
  function mergeExtraFields(replayed, orig) {
    var out = replayed.slice();
    for (var i = 0; i < orig.length; i++) {
      var o = orig[i];
      if (!isObj(o) || typeof o.id !== 'string') continue;
      var r = findById(out, o.id);
      if (!r) { out.push(o); continue; }
      if (!Array.isArray(r.families)) r.families = [];
      var fams = Array.isArray(o.families) ? o.families : [];
      for (var k = 0; k < fams.length; k++) if (r.families.indexOf(fams[k]) < 0) r.families.push(fams[k]);
      if (o.enabled === false && !o.retiredAt && !r.retiredAt) r.enabled = false;
    }
    return out;
  }

  /** 再演で得た提案待ちに、元の提案待ち（id 重複なし・有効化済み slot は除く）を足す */
  function mergePending(replayed, orig, extraFields) {
    var out = replayed.slice();
    for (var i = 0; i < orig.length; i++) {
      var p = orig[i];
      if (!isObj(p) || typeof p.id !== 'string' || findById(out, p.id)) continue;
      var slot = findById(extraFields, p.id);
      if (slot && !slot.retiredAt) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * 派生部分（recurrence / familyStats / counters）をログから再計算する。speed エントリは再計算から除外。
   * recurrence（と追加欄の発火・退役・昇格）は PD.gaps.recordOutcome が居るときだけ時系列で再演する。
   * 再演は extraFields / pendingExtra を空にして始め（slot が先に在ると最初の1件で全て退役してしまう）、
   * 終わってから元の slot を重ねる（mergeExtraFields / mergePending）。他の settings は触らない。
   * counters.committed は speed を除いた件数（gaps.recordOutcome と同じ定義）。
   */
  function rebuildState(state, log) {
    state = normalizeState(state);
    state.recurrence = {};
    state.familyStats = {};
    var gaps = root.PD && root.PD.gaps;
    var canReplay = !!(gaps && typeof gaps.recordOutcome === 'function');
    var origExtra = state.settings.extraFields;
    var origPending = state.settings.pendingExtra;
    if (canReplay) {
      state.settings.extraFields = [];
      state.settings.pendingExtra = [];
    }
    var sorted = log.slice().sort(byAt);
    var today = isoDate();
    var committed = 0, live = 0, speed = 0, liveToday = 0;
    var i;
    for (i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      if (!isObj(e)) continue;
      if (e.mode === 'speed') { speed++; continue; }
      committed++;
      if (e.mode === 'live') {
        live++;
        if (dateOfEntry(e) === today) liveToday++;
      }
      if (canReplay) {
        try {
          var r = gaps.recordOutcome(state, e, dateOfEntry(e));
          if (r && isObj(r.state)) state = r.state;
        } catch (err) { /* 再演に失敗した1件は飛ばす */ }
      }
    }
    if (canReplay) {
      state.settings.extraFields = mergeExtraFields(
        Array.isArray(state.settings.extraFields) ? state.settings.extraFields : [], origExtra);
      state.settings.pendingExtra = mergePending(
        Array.isArray(state.settings.pendingExtra) ? state.settings.pendingExtra : [], origPending, state.settings.extraFields);
    }
    // familyStats は ④ の定義で自前に組み直す（再演が触っていても同じ定義に揃える）
    state.familyStats = {};
    for (i = 0; i < sorted.length; i++) {
      if (isObj(sorted[i]) && sorted[i].mode !== 'speed') pushFamilyStat(state.familyStats, sorted[i]);
    }
    state.counters = { committed: committed, live: live, speed: speed, liveToday: { date: today, n: liveToday } };
    return state;
  }

  function cloneJSON(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return undefined; }
  }

  /** 復元（現在のログが空）：インポート側の settings / stage をそのまま採る */
  function adoptSettings(state, inState) {
    var s = cloneJSON(inState.settings);
    if (isObj(s)) state.settings = s;
    if (typeof inState.stage === 'number') state.stage = inState.stage;
    return normalizeState(state);
  }

  /** 統合（現在のログあり）：スカラー設定はこの端末を優先し、追加欄・提案待ちは id で和集合 */
  function mergeSettings(state, inState) {
    var inS = isObj(inState.settings) ? inState.settings : {};
    var cur = state.settings;
    var i, j, k;
    var inExtra = Array.isArray(inS.extraFields) ? inS.extraFields : [];
    for (i = 0; i < inExtra.length; i++) {
      var x = cloneJSON(inExtra[i]);
      if (!isObj(x) || typeof x.id !== 'string') continue;
      var found = null;
      for (j = 0; j < cur.extraFields.length; j++) {
        if (isObj(cur.extraFields[j]) && cur.extraFields[j].id === x.id) { found = cur.extraFields[j]; break; }
      }
      if (!found) { cur.extraFields.push(x); continue; }
      if (!Array.isArray(found.families)) found.families = [];
      var fams = Array.isArray(x.families) ? x.families : [];
      for (k = 0; k < fams.length; k++) if (found.families.indexOf(fams[k]) < 0) found.families.push(fams[k]);
    }
    var inPend = Array.isArray(inS.pendingExtra) ? inS.pendingExtra : [];
    for (i = 0; i < inPend.length; i++) {
      var p = cloneJSON(inPend[i]);
      if (!isObj(p) || typeof p.id !== 'string') continue;
      var dup = false;
      for (j = 0; j < cur.pendingExtra.length; j++) {
        if (isObj(cur.pendingExtra[j]) && cur.pendingExtra[j].id === p.id) { dup = true; break; }
      }
      if (!dup) cur.pendingExtra.push(p);
    }
    if (!cur.speedUnlockedAt && typeof inS.speedUnlockedAt === 'string') cur.speedUnlockedAt = inS.speedUnlockedAt;
    if (typeof inState.stage === 'number' && inState.stage > state.stage) state.stage = inState.stage;
    return state;
  }

  /**
   * エクスポート JSON（または LogEntry[]）を取り込む。ログは id で重複除去してマージし at 順に並べる。
   * state は recurrence / familyStats（/ counters）をログから再計算（speed は除外）。
   * 現在のログが空なら「復元」として settings も取り込み、空でなければ「統合」としてこの端末の設定を優先する。
   */
  function importJSON(text) {
    function fail(msg) { return { ok: false, added: 0, skipped: 0, msg: msg }; }
    var data = parseJSON(text);
    if (data === undefined) return fail('JSON を読めませんでした');
    var inLog, inState = null;
    if (Array.isArray(data)) {
      inLog = data;
    } else if (isObj(data)) {
      if (data.v !== undefined && data.v !== 1) return fail('未対応の形式です（v=' + String(data.v) + '）');
      inLog = Array.isArray(data.log) ? data.log : [];
      inState = isObj(data.state) ? data.state : null;
    } else {
      return fail('形式が違います');
    }

    var cur = loadLog();
    var wasEmpty = cur.length === 0;
    var seen = {};
    var i;
    for (i = 0; i < cur.length; i++) {
      if (isObj(cur[i]) && typeof cur[i].id === 'string') seen[cur[i].id] = true;
    }
    var added = 0, skipped = 0;
    for (i = 0; i < inLog.length; i++) {
      var e = inLog[i];
      if (!isObj(e) || typeof e.id !== 'string' || !e.id || seen[e.id]) { skipped++; continue; }
      seen[e.id] = true;
      cur.push(e);
      added++;
    }
    cur.sort(byAt);

    var state = loadState();
    if (inState) state = wasEmpty ? adoptSettings(state, inState) : mergeSettings(state, inState);
    state = rebuildState(state, cur);

    var r = saveLog(cur);
    if (!r.ok) return { ok: false, added: 0, skipped: skipped, msg: '保存できませんでした。エクスポートして整理してください' };
    saveState(state);
    var msg = added + '件を追加、' + skipped + '件は重複のためスキップ';
    if (r.trimmed) msg += '（上限超過で古い' + r.trimmed + '件を間引き）';
    return { ok: true, added: added, skipped: skipped, msg: msg };
  }

  // ---------------------------------------------------------------------------
  // Reset / API key / Model
  // ---------------------------------------------------------------------------

  /** pd_ のキーだけ消す。pokerApiKey（own.html と共有）は消さない */
  function resetAll() {
    removeItem(KEYS.state);
    removeItem(KEYS.log);
    removeItem(KEYS.model);
  }

  function getApiKey() {
    var k = getItem(KEYS.apiKey);
    return typeof k === 'string' ? k : '';
  }

  /** 空なら removeItem */
  function setApiKey(k) {
    k = (k === null || k === undefined) ? '' : String(k).trim();
    if (!k) { removeItem(KEYS.apiKey); return; }
    setItemSafe(KEYS.apiKey, k);
  }

  function getModel() {
    var m = getItem(KEYS.model);
    return (typeof m === 'string' && m) ? m : DEFAULT_MODEL;
  }

  /** 空なら removeItem（既定に戻る） */
  function setModel(m) {
    m = (m === null || m === undefined) ? '' : String(m).trim();
    if (!m) { removeItem(KEYS.model); return; }
    setItemSafe(KEYS.model, m);
  }

  return {
    KEYS: KEYS,
    LOG_CAP: LOG_CAP,
    DEFAULT_MODEL: DEFAULT_MODEL,
    loadState: loadState,
    saveState: saveState,
    defaultState: defaultState,
    loadLog: loadLog,
    appendLog: appendLog,
    updateLog: updateLog,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetAll: resetAll,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    getModel: getModel,
    setModel: setModel,
    // テスト・結合用（契約外）
    _rebuildState: rebuildState,
    _isQuotaError: isQuotaError
  };
})();

if (typeof module !== 'undefined') module.exports = PD.store;
