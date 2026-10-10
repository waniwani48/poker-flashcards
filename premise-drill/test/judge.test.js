// premise-drill: PD.judge（T7）のテスト。_fetch モックで全エラー分類・送信 body・effort 再試行・clamp を検証する。
//   node test/run.js judge
'use strict';

var fs = require('fs');
var path = require('path');

var judge = require('../js/judge.js');
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD;

// ---- フィクスチャ（ソルバー数値ではなく、票の形を満たすだけのダミー値）----
function sampleEntry() {
  return {
    id: 'l_test', at: '2026-01-01T00:00:00.000Z', mode: 'drill', tempo: 'normal', reason: 'random',
    spot: {
      id: 's_test', seed: 1, node: 'BTN2.5-BBcall-x-cb', villainPos: 'BTN', pre: 'F-F-F-R2.5-F-C',
      board: 'Ks7d5c', cls: 'dry_high', suit: 'rainbow', connected: false, hmsd: false,
      size: 33, pot: 5.5, bet: 1.82, hero: 'Ad4d', heroPool: 'A_lowkick_s', family: 'dry_high_33'
    },
    sheet: {
      f1: { foldPct: 30 },
      f2: { trash: 40, hi: 30, pairPlus: 30 },
      f3: { noDraw: false, drawRanks: ['6', '8'], shiftPct: 8, examples: ['86s', '64s'] },
      f4: { pureAirPct: 32, enough: 'yes', foldList: ['J2o', 'T5o', 'Q7o'], nextLayer: ['A4o'] },
      f5: { bdfd: true, bdsd: false, gut: false, oesd: false, kickerNote: 'ロー', position: 'edge', action: 'call', confidence: 80 },
      extra: { pf_removed: 'AA-QQ' },
      _ts: {}
    },
    hints: [{ field: 'f3', tier: 1 }],
    commit: { elapsedMs: 120000, fieldTimes: { f1: 1, f2: 2, f3: 3, f4: 4, f5: 5 },
              order: ['f1', 'f2', 'f3', 'f4', 'f5'], timedOut: false, incomplete: false, confidence: 80 },
    truth: { used: true, rangeFoldPct: 31, heroFold: 20, heroCall: 80, heroRaise: 0, buckets: null, note: '' },
    postCheck: { drawRanksMissing: [], drawRanksExtra: [], heroFeatMismatch: [], rankOrder: true },
    selfScore: { procedure: 3, sizeFold: 2, drawProtect: 2, action: 1, total: 8 },
    claude: null, gap: 'none', gapNote: '', scoreUsed: 'self', live: null
  };
}

function goodJudgeJson(over) {
  var o = {
    score: 8,
    items: { procedure: 3, size_fold: 2, draw_protect: 2, action: 1 },
    verdict: '順序は良い', good: '手順どおり', miss: '③で名指しが足りない',
    fix_one_line: '③で具体コンボを書く', gap_type: 'strength_order', gap_reason: 'ランク順',
    boundary_hand_named: false, villain_range_used: false
  };
  Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
  return o;
}

/** API レスポンス風オブジェクト */
function apiResponse(opts) {
  var o = opts || {};
  var status = o.status === undefined ? 200 : o.status;
  var bodyObj = o.bodyObj !== undefined ? o.bodyObj : {
    id: 'msg_test', type: 'message', role: 'assistant',
    content: o.content !== undefined ? o.content : [{ type: 'text', text: JSON.stringify(goodJudgeJson()) }],
    stop_reason: o.stop_reason || 'end_turn'
  };
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: function () {
      if (o.jsonThrows) return Promise.reject(new SyntaxError('bad json'));
      return Promise.resolve(bodyObj);
    },
    text: function () { return Promise.resolve(JSON.stringify(bodyObj)); }
  };
}

/** _fetch モック。responder(callIndex, url, opts) がレスポンス（または throw）を返す */
function mockFetch(responder) {
  var calls = [];
  var fn = function (url, opts) {
    var i = calls.length;
    calls.push({ url: url, opts: opts, body: JSON.parse(opts.body) });
    return Promise.resolve().then(function () { return responder(i, url, opts); });
  };
  fn.calls = calls;
  return fn;
}

function walkSchema(node, visit, pathStr) {
  if (!node || typeof node !== 'object') return;
  visit(node, pathStr || '$');
  if (Array.isArray(node)) {
    node.forEach(function (n, i) { walkSchema(n, visit, (pathStr || '$') + '[' + i + ']'); });
    return;
  }
  Object.keys(node).forEach(function (k) {
    walkSchema(node[k], visit, (pathStr || '$') + '.' + k);
  });
}

module.exports = {
  name: 'judge',
  run: async function (assert) {
    var origStore = PD.store;
    var origGetApiKey = PD.store && PD.store.getApiKey;
    var origGetModel = PD.store && PD.store.getModel;
    var origFetch = judge._fetch;

    function setKey(k, model) {
      PD.store = PD.store || {};
      PD.store.getApiKey = function () { return k; };
      PD.store.getModel = function () { return model; };
    }

    try {
      // ---- 定数・契約 ----
      assert.strictEqual(typeof judge.JUDGE_SYS_PD, 'string');
      assert.ok(judge.JUDGE_SYS_PD.length > 500, 'JUDGE_SYS_PD が短すぎる');
      assert.strictEqual(typeof judge.JUDGE_SCHEMA_PD, 'object');
      assert.strictEqual(judge.MAX_TOKENS, 4096);
      assert.ok(judge.MAX_TOKENS >= 4096);
      assert.deepStrictEqual(judge.MODELS.map(function (m) { return m.id; }), ['claude-opus-5', 'claude-sonnet-5']);
      assert.strictEqual(typeof judge.buildPrompt, 'function');
      assert.strictEqual(typeof judge.judge, 'function');
      assert.strictEqual(typeof judge._fetch, 'function');
      assert.strictEqual(PD.judge, judge, 'module.exports と PD.judge が同一でない');

      // ---- schema：全 object に additionalProperties:false、minimum/maximum 無し ----
      var objCount = 0;
      walkSchema(judge.JUDGE_SCHEMA_PD, function (node, p) {
        if (Array.isArray(node)) return;
        assert.ok(!('minimum' in node), 'minimum が ' + p + ' にある');
        assert.ok(!('maximum' in node), 'maximum が ' + p + ' にある');
        if (node.type === 'object') {
          objCount++;
          assert.strictEqual(node.additionalProperties, false, 'additionalProperties:false が ' + p + ' に無い');
          assert.ok(Array.isArray(node.required), 'required が ' + p + ' に無い');
        }
      });
      assert.strictEqual(objCount, 2, 'object 型は root と items の2つのはず');
      assert.deepStrictEqual(judge.JUDGE_SCHEMA_PD.required.slice().sort(),
        ['score', 'items', 'verdict', 'good', 'miss', 'fix_one_line', 'gap_type', 'gap_reason',
         'boundary_hand_named', 'villain_range_used'].sort());
      assert.deepStrictEqual(judge.JUDGE_SCHEMA_PD.properties.gap_type.enum,
        ['range_state', 'baseline', 'rule', 'strength_order', 'middling', 'none', 'unknown_concept']);

      // ---- buildPrompt：4見出しを含む ----
      var entry = sampleEntry();
      var p1 = judge.buildPrompt(entry, '');
      ['【スポット】', '【前提票】', '【自己申告の真値】', '【自己採点】', '【ヒント使用】', '【入力順】'].forEach(function (h) {
        assert.ok(p1.indexOf(h) >= 0, 'buildPrompt に ' + h + ' が無い');
      });
      assert.ok(p1.indexOf('Ks7d5c') >= 0);
      assert.ok(p1.indexOf('Ad4d') >= 0);
      assert.ok(p1.indexOf('CB 33%') >= 0);
      assert.ok(p1.indexOf('①必要fold%=30') >= 0, 'sheetText 無しでは entry.sheet から票を組む');
      assert.ok(p1.indexOf('追加欄：pf_removed=AA-QQ') >= 0, '追加欄が出る');
      assert.ok(p1.indexOf('レンジfold 31%') >= 0);
      assert.ok(p1.indexOf('fold/call/raise=20/80/0%') >= 0);
      assert.ok(p1.indexOf('3バケツ 未入力') >= 0);
      assert.ok(p1.indexOf('手順3/サイズ2/ドロー2/答え1') >= 0);
      assert.ok(p1.indexOf('f1→f2→f3→f4→f5') >= 0);
      assert.ok(p1.indexOf('所要 120秒') >= 0);
      assert.ok(p1.indexOf('f3:tier1') >= 0);

      // sheetText があればそれを【前提票】本文に使う
      var p2 = judge.buildPrompt(entry, '票テキスト（sheet.toText）');
      assert.ok(p2.indexOf('票テキスト（sheet.toText）') >= 0);
      assert.ok(p2.indexOf('①必要fold%=30') < 0, 'sheetText がある時は entry.sheet から組み直さない');

      // 真値・自己採点・ヒント無し
      var e2 = sampleEntry();
      e2.truth = { used: false }; e2.selfScore = null; e2.hints = [];
      e2.sheet.f3 = { noDraw: true, drawRanks: [], shiftPct: 0, examples: [] };
      var p3 = judge.buildPrompt(e2, '');
      assert.ok(p3.indexOf('【自己申告の真値】未入力') >= 0);
      assert.ok(p3.indexOf('【自己採点】未入力') >= 0);
      assert.ok(p3.indexOf('【ヒント使用】無し') >= 0);
      assert.ok(p3.indexOf('無しと宣言') >= 0);
      // 壊れた entry でも落ちない
      assert.strictEqual(typeof judge.buildPrompt(null, null), 'string');
      assert.strictEqual(typeof judge.buildPrompt({}, undefined), 'string');

      // ---- NO_KEY：fetch しない ----
      var noKeyFetch = mockFetch(function () { throw new Error('must not be called'); });
      judge._fetch = noKeyFetch;
      setKey('', 'claude-opus-5');
      var r0 = await judge.judge(entry, '');
      assert.deepStrictEqual(r0, { ok: false, error: 'NO_KEY' });
      assert.strictEqual(noKeyFetch.calls.length, 0, 'NO_KEY で _fetch が呼ばれた');
      setKey(null, 'claude-opus-5');
      r0 = await judge.judge(entry, '');
      assert.strictEqual(r0.error, 'NO_KEY');
      setKey('   ', 'claude-opus-5');
      r0 = await judge.judge(entry, '');
      assert.strictEqual(r0.error, 'NO_KEY');
      assert.strictEqual(noKeyFetch.calls.length, 0);

      // store に getApiKey が無い（T6 未結合）でも NO_KEY で閉じる
      PD.store = {};
      r0 = await judge.judge(entry, '');
      assert.strictEqual(r0.error, 'NO_KEY');
      assert.strictEqual(noKeyFetch.calls.length, 0);

      // ---- 正常 JSON ----
      var okFetch = mockFetch(function () { return apiResponse(); });
      judge._fetch = okFetch;
      setKey('test-key-placeholder', 'claude-sonnet-5');
      var r1 = await judge.judge(entry, '');
      assert.strictEqual(r1.ok, true, JSON.stringify(r1));
      assert.ok(r1.result.score >= 0 && r1.result.score <= 10);
      assert.strictEqual(r1.result.score, 8);
      assert.deepStrictEqual(r1.result.items, { procedure: 3, size_fold: 2, draw_protect: 2, action: 1 });
      assert.strictEqual(r1.result.gap_type, 'strength_order');
      assert.strictEqual(r1.result.boundary_hand_named, false);
      assert.strictEqual(r1.result.model, 'claude-sonnet-5');
      assert.strictEqual(typeof r1.result.at, 'string');

      // 送信 body / headers
      assert.strictEqual(okFetch.calls.length, 1);
      var c = okFetch.calls[0];
      assert.strictEqual(c.url, 'https://api.anthropic.com/v1/messages');
      assert.strictEqual(c.opts.method, 'POST');
      assert.strictEqual(c.opts.headers['x-api-key'], 'test-key-placeholder');
      assert.strictEqual(c.opts.headers['anthropic-version'], '2023-06-01');
      assert.strictEqual(c.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
      assert.strictEqual(c.opts.headers['content-type'], 'application/json');
      assert.strictEqual(c.body.model, 'claude-sonnet-5');
      assert.ok(c.body.max_tokens >= 4096, 'max_tokens が 4096 未満');
      assert.strictEqual(c.body.system, judge.JUDGE_SYS_PD);
      assert.strictEqual(c.body.messages.length, 1);
      assert.strictEqual(c.body.messages[0].role, 'user');
      assert.ok(c.body.messages[0].content.indexOf('【前提票】') >= 0);
      assert.strictEqual(c.body.output_config.effort, 'low');
      assert.strictEqual(c.body.output_config.format.type, 'json_schema');
      assert.deepStrictEqual(c.body.output_config.format.schema, judge.JUDGE_SCHEMA_PD);

      // getModel が空なら既定モデル
      setKey('test-key-placeholder', '');
      await judge.judge(entry, '');
      assert.strictEqual(okFetch.calls[1].body.model, 'claude-opus-5');
      setKey('test-key-placeholder', 'claude-opus-5');

      // thinking ブロックが混ざっても text だけを読む
      judge._fetch = mockFetch(function () {
        return apiResponse({ content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: JSON.stringify(goodJudgeJson({ score: 10, items: { procedure: 3, size_fold: 2, draw_protect: 4, action: 1 } })) }
        ] });
      });
      var r1b = await judge.judge(entry, '');
      assert.strictEqual(r1b.ok, true);
      assert.strictEqual(r1b.result.score, 10);

      // ---- clamp / items 合計優先 ----
      judge._fetch = mockFetch(function () {
        return apiResponse({ content: [{ type: 'text', text: JSON.stringify(goodJudgeJson({ score: 5, items: { procedure: 3, size_fold: 2, draw_protect: 4, action: 1 } })) }] });
      });
      var r2 = await judge.judge(entry, '');
      assert.strictEqual(r2.result.score, 10, 'items 合計≠score なら items 合計');

      judge._fetch = mockFetch(function () {
        return apiResponse({ content: [{ type: 'text', text: JSON.stringify(goodJudgeJson({ score: 42, items: { procedure: 9, size_fold: 9, draw_protect: 9, action: 9 } })) }] });
      });
      var r3 = await judge.judge(entry, '');
      assert.strictEqual(r3.result.score, 10, 'score は 0–10 に clamp');
      assert.deepStrictEqual(r3.result.items, { procedure: 3, size_fold: 2, draw_protect: 4, action: 1 }, 'items は配点上限で clamp');

      judge._fetch = mockFetch(function () {
        return apiResponse({ content: [{ type: 'text', text: JSON.stringify(goodJudgeJson({ score: -3, items: { procedure: -1, size_fold: 0, draw_protect: 0, action: 0 } })) }] });
      });
      var r4 = await judge.judge(entry, '');
      assert.strictEqual(r4.result.score, 0);
      assert.strictEqual(r4.result.items.procedure, 0);

      // ---- PARSE：壊れ JSON ----
      judge._fetch = mockFetch(function () {
        return apiResponse({ content: [{ type: 'text', text: '{"score": 8, "items": ' }] });
      });
      var r5 = await judge.judge(entry, '');
      assert.deepStrictEqual(r5, { ok: false, error: 'PARSE' });

      // PARSE：text ブロック無し
      judge._fetch = mockFetch(function () { return apiResponse({ content: [] }); });
      assert.strictEqual((await judge.judge(entry, '')).error, 'PARSE');

      // PARSE：JSON だが object でない
      judge._fetch = mockFetch(function () { return apiResponse({ content: [{ type: 'text', text: '[1,2]' }] }); });
      assert.strictEqual((await judge.judge(entry, '')).error, 'PARSE');

      // PARSE：レスポンス本体が JSON でない（r.json() が投げる）
      judge._fetch = mockFetch(function () { return apiResponse({ jsonThrows: true }); });
      assert.strictEqual((await judge.judge(entry, '')).error, 'PARSE');

      // ---- TRUNC / REFUSAL ----
      judge._fetch = mockFetch(function () {
        return apiResponse({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"score": 8' }] });
      });
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'TRUNC' });

      judge._fetch = mockFetch(function () {
        return apiResponse({ stop_reason: 'refusal', content: [] });
      });
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'REFUSAL' });

      // ---- BAD_KEY / HTTP ----
      judge._fetch = mockFetch(function () {
        return apiResponse({ status: 401, bodyObj: { type: 'error', error: { type: 'authentication_error', message: 'invalid' } } });
      });
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'BAD_KEY', status: 401 });

      judge._fetch = mockFetch(function () {
        return apiResponse({ status: 500, bodyObj: { type: 'error' } });
      });
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'HTTP', status: 500 });

      judge._fetch = mockFetch(function () {
        return apiResponse({ status: 429, bodyObj: { type: 'error' } });
      });
      var r429 = await judge.judge(entry, '');
      assert.strictEqual(r429.error, 'HTTP');
      assert.strictEqual(r429.status, 429);

      // ---- NET ----
      judge._fetch = mockFetch(function () { throw new TypeError('Failed to fetch'); });
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'NET' });

      judge._fetch = function () { return Promise.reject(new TypeError('network')); };
      assert.deepStrictEqual(await judge.judge(entry, ''), { ok: false, error: 'NET' });

      judge._fetch = function () { return Promise.resolve(null); };
      assert.strictEqual((await judge.judge(entry, '')).error, 'NET');

      // ---- effort で 400 → 2回目は effort 無し ----
      var retryFetch = mockFetch(function (i) {
        if (i === 0) {
          return apiResponse({ status: 400, bodyObj: { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.effort: Extra inputs are not permitted' } } });
        }
        return apiResponse();
      });
      judge._fetch = retryFetch;
      var r6 = await judge.judge(entry, '');
      assert.strictEqual(r6.ok, true, JSON.stringify(r6));
      assert.strictEqual(retryFetch.calls.length, 2, '400 後に1回だけ再試行');
      assert.strictEqual(retryFetch.calls[0].body.output_config.effort, 'low');
      assert.ok(!('effort' in retryFetch.calls[1].body.output_config), '2回目に effort が残っている');
      assert.strictEqual(retryFetch.calls[1].body.output_config.format.type, 'json_schema', '2回目も format は維持');
      assert.ok(retryFetch.calls[1].body.max_tokens >= 4096);
      assert.strictEqual(retryFetch.calls[1].body.model, retryFetch.calls[0].body.model);

      // 2回目も 400 → HTTP 400（再試行は1回だけ）
      var retry2 = mockFetch(function () {
        return apiResponse({ status: 400, bodyObj: { type: 'error' } });
      });
      judge._fetch = retry2;
      var r7 = await judge.judge(entry, '');
      assert.deepStrictEqual(r7, { ok: false, error: 'HTTP', status: 400 });
      assert.strictEqual(retry2.calls.length, 2);

      // 再試行後に 401 → BAD_KEY
      judge._fetch = mockFetch(function (i) {
        return i === 0 ? apiResponse({ status: 400, bodyObj: {} }) : apiResponse({ status: 401, bodyObj: {} });
      });
      assert.strictEqual((await judge.judge(entry, '')).error, 'BAD_KEY');

      // ---- URL が JUDGE_SYS_PD と judge.js に無い（記事名・著者名・用語の固定語 grep は SPEC ⑫⑬どおりシェルで行う。
      //      禁止語をテストに書くと ⑫の grep 自体に引っかかるため、ここには書かない）----
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'judge.js'), 'utf8');
      assert.ok(!/https?:\/\/(?!api\.anthropic\.com\/v1\/messages)/.test(src), 'judge.js に API 以外の URL がある');
      assert.ok(!/https?:\/\//.test(judge.JUDGE_SYS_PD), 'JUDGE_SYS_PD に URL がある');
    } finally {
      judge._fetch = origFetch;
      PD.store = origStore;
      if (origStore) {
        if (origGetApiKey) origStore.getApiKey = origGetApiKey; else delete origStore.getApiKey;
        if (origGetModel) origStore.getModel = origGetModel; else delete origStore.getModel;
      }
    }
  }
};
