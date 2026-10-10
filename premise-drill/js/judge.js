// premise-drill: PD.judge（T7）。Claude 採点。ブラウザから直接 fetch（SDK 無し）。
// SPEC ⑦「Claude 採点」／⑫ の契約：
//   JUDGE_SYS_PD / JUDGE_SCHEMA_PD / MODELS / MAX_TOKENS / buildPrompt / judge / _fetch
// store 依存は getApiKey / getModel のみ。node では require('./store') で解決する。
// _fetch は差し替え可能（テストはモックで全エラー分類を検証する）。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
var store = PD.store || (typeof require === 'function' ? require('./store') : null);

PD.judge = (function () {
  'use strict';

  var API_URL = 'https://api.anthropic.com/v1/messages';
  var API_VERSION = '2023-06-01';
  var DEFAULT_MODEL = 'claude-opus-5';
  var MAX_TOKENS = 4096;
  var EFFORT = 'low';

  var MODELS = [
    { id: 'claude-opus-5', label: 'Opus 5（精度）' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5（安）' }
  ];

  // 配点上限（items の clamp に使う。合計 10）
  var ITEM_MAX = { procedure: 3, size_fold: 2, draw_protect: 4, action: 1 };

  // ---- JUDGE_SYS_PD（SPEC ⑦ 完成形をそのまま）----
  var JUDGE_SYS_PD = [
    'あなたはポーカー学習者の「前提票」を採点するコーチです。対象スポットは BTN 2.5bb open → BB call → フロップ → BB x → BTN CB（33% または 50%）、BB の call/fold 判定のみ（レイズは扱いません）。学習者は答えを見る前に前提票5欄を埋めてコミットし、その後 GTO Wizard で真値を見て自己申告しています。',
    '',
    '採点は10点満点、配点は固定です。',
    '①手順（3点）：サイズ→必要fold% → 自レンジを弱い順に3バケツ → trash の中でドローを持つ手を守る側に移して純airを縮める → fold組を弱い順に名指し → 境界の自手を明示、の順で票が埋まっている。順序が逆（自手や相手の手から始める）は0〜1点。',
    '②サイズ→必要fold%（2点）：33%→約30%、50%→約40%（純αより5〜7pt多めに降りる実践値＝学習者の暗記値）。±5ptで2点、±10ptで1点、それ以上は0点。真値との差は採点に使わない。',
    '③ドロー付きtrashを守ると言えたか（4点・最重要）：弱く見えて繋がる手（ガット／オープンエンド／BDSD／BDFD）をランクと具体コンボで名指しして守る側に移し、純airが何%残るかを概算し、足りなければ次の層（BDFD無しのAハイ、色なし低ポケット等）を名指しで捻出している。ドロー無しのボードで「無し」と宣言できていればそれも正しい。「ドローは守る」と書くだけで名指しが無ければ2点まで。',
    '④答え（1点）：⑤の call/fold が学習者の自己申告した自手の fold 頻度（fold≥50%ならfold）と整合。真値が未入力なら0点にし、miss に「真値未入力」と書く。',
    '',
    '減点規則：',
    '- 答え1点・過程9点。正解アクションでも理由が「ハンド対ハンド」「安いから降りられない」「役が強いから」なら①③を減点。',
    '- 相手レンジや相手の戦略（「BTNはブラフが多い」「このサイズはバリュー寄り」等）を根拠に call/fold を決めている記述は減点し villain_range_used=true（均衡判定はサイズ／自レンジ／自手の3変数で閉じる）。',
    '- fold組がランク順（J2o→T5o→98o のようにランクだけで単調に並び、ドロー持ちの位置がランクで決まっている）で並び、アウツ・BD・スートへの言及が無ければ③を減点し gap_type に strength_order を提案、boundary_hand_named=false。',
    '- ドロー無しtrashの%推定の誤差（±10pt）は減点しない。「順序」と「境界の名指し」は厳しく見る。',
    '',
    '事実の扱い：',
    '- 真値（レンジfold%・自手の頻度）は学習者の自己申告だけを使う。自分の記憶でソルバーの数値を断言しない。知らない数値は「推測」と明記する。',
    '- 記事や教材の文言・名称を引用しない。原理と手順の言葉だけで指摘する。',
    '',
    'gap_type は次から1つ：',
    'range_state（自レンジに居ない手を数えた／抜けた手を見落とし／%でなく形容詞で済ませた）、baseline（暗記表・定石の未想起。①が暗記値から大きく外れる）、rule（則の適用条件違い。例：レインボーで色の則を使う、50%に33%の値で処理、①の%を④の列挙が満たしていない）、strength_order（役の強さ順の序列、2枚で見ていない）、middling（極端側が正しいのに混合・中間に寄せた）、none（ズレなし）、unknown_concept（必要な概念そのものが票に無い）。',
    '',
    '出力は JSON のみ。日本語で短く鋭く。用語はカタカナ（ハイ／ハンド／コネクテッド／ボード／ドライ／ウェット）。表記ゆれ（trash／ゴミ／エアー、x／check、BDFD／バックドアフラッシュ）は寛容、内容は甘くしない。verdict は20字以内。good は合っている点。miss はズレと直し方（欄番号と具体ハンドを指す）。fix_one_line は次回の票で直す1行（欄名を含める）。items の合計を score と一致させる。'
  ].join('\n');

  // ---- JUDGE_SCHEMA_PD（SPEC ⑦ 完成形をそのまま。minimum/maximum は使わない）----
  var JUDGE_SCHEMA_PD = {
    type: 'object',
    properties: {
      score: { type: 'integer' },
      items: {
        type: 'object',
        properties: {
          procedure: { type: 'integer' },
          size_fold: { type: 'integer' },
          draw_protect: { type: 'integer' },
          action: { type: 'integer' }
        },
        required: ['procedure', 'size_fold', 'draw_protect', 'action'],
        additionalProperties: false
      },
      verdict: { type: 'string' },
      good: { type: 'string' },
      miss: { type: 'string' },
      fix_one_line: { type: 'string' },
      gap_type: {
        type: 'string',
        enum: ['range_state', 'baseline', 'rule', 'strength_order', 'middling', 'none', 'unknown_concept']
      },
      gap_reason: { type: 'string' },
      boundary_hand_named: { type: 'boolean' },
      villain_range_used: { type: 'boolean' }
    },
    required: ['score', 'items', 'verdict', 'good', 'miss', 'fix_one_line', 'gap_type', 'gap_reason',
               'boundary_hand_named', 'villain_range_used'],
    additionalProperties: false
  };

  // Claude 向けのクラス表示（学習者には Truth 以降でのみ表示される。ここは user メッセージ用）
  var CLS_LABEL = {
    dry_high: 'ドライ・ハイカード',
    bw_sd: 'ブロードウェイ・ストレートドロー',
    mid: 'ミドル',
    low: 'ロー',
    paired: 'ペアード',
    mono: 'モノトーン',
    trips: 'トリップス'
  };
  var SUIT_LABEL = { rainbow: 'レインボー', twotone: 'ツートーン', mono: 'モノトーン' };

  // ---- store アクセス（getApiKey / getModel のみ）----
  function currentStore() {
    return PD.store || store || {};
  }
  function getApiKey() {
    var s = currentStore();
    var k = (typeof s.getApiKey === 'function') ? s.getApiKey() : '';
    return (k === null || k === undefined) ? '' : String(k).trim();
  }
  function getModel() {
    var s = currentStore();
    var m = (typeof s.getModel === 'function') ? s.getModel() : '';
    m = (m === null || m === undefined) ? '' : String(m).trim();
    return m || DEFAULT_MODEL;
  }

  // ---- 文字列ヘルパ ----
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function val(v, fallback) { return has(v) ? String(v) : (fallback === undefined ? '未入力' : fallback); }
  function pct(v) { return has(v) ? String(v) + '%' : '未入力'; }
  function list(arr, empty) {
    if (!arr || !arr.length) return empty === undefined ? '無し' : empty;
    return Array.prototype.map.call(arr, function (x) { return String(x); }).join(', ');
  }
  function yn(v) { return v === true ? 'yes' : (v === false ? 'no' : '未入力'); }

  /** SheetValues → 【前提票】本文（sheetText が無い時のフォールバック。⑦のテンプレート） */
  function sheetToText(sheet) {
    var s = sheet || {};
    var f1 = s.f1 || {}, f2 = s.f2 || {}, f3 = s.f3 || {}, f4 = s.f4 || {}, f5 = s.f5 || {};
    var lines = [];
    lines.push('①必要fold%=' + val(f1.foldPct));
    lines.push('②trash=' + pct(f2.trash) + ' ハイカード=' + pct(f2.hi) + ' ペア以上=' + pct(f2.pairPlus));
    var draws = f3.noDraw === true ? '無しと宣言' : list(f3.drawRanks, '未入力');
    lines.push('③ドロー：' + draws + '／守る側に移る ' + pct(f3.shiftPct) + '（レンジ全体比）／例 ' + list(f3.examples));
    lines.push('④純air=' + pct(f4.pureAirPct) + '／足りる=' + val(f4.enough) +
      '／fold組（弱い順）' + list(f4.foldList, '未入力') + '／次の層 ' + list(f4.nextLayer));
    var checks = [];
    if (f5.bdfd === true) checks.push('BDFD');
    if (f5.bdsd === true) checks.push('BDSD');
    if (f5.gut === true) checks.push('ガット');
    if (f5.oesd === true) checks.push('オープンエンド');
    lines.push('⑤2枚チェック ' + (checks.length ? checks.join(', ') : '無し') +
      '／キッカー ' + val(f5.kickerNote, '無し') + '／位置=' + val(f5.position) +
      '／判定=' + val(f5.action) + '／確信度=' + pct(f5.confidence));
    var extra = s.extra && typeof s.extra === 'object' ? s.extra : null;
    if (extra) {
      var keys = Object.keys(extra).filter(function (k) { return has(extra[k]); });
      if (keys.length) {
        lines.push('追加欄：' + keys.map(function (k) {
          var v = extra[k];
          if (v && typeof v === 'object') {
            try { v = JSON.stringify(v); } catch (e) { v = String(v); }
          }
          return k + '=' + String(v);
        }).join('／'));
      }
    }
    return lines.join('\n');
  }

  function spotLine(spot) {
    var sp = spot || {};
    var cls = val(sp.cls, '?');
    var clsLabel = CLS_LABEL[cls] ? cls + '＝' + CLS_LABEL[cls] : cls;
    var suit = SUIT_LABEL[sp.suit] || val(sp.suit, '?');
    return '【スポット】' + val(sp.node, '?') + '／ボード ' + val(sp.board, '?') +
      '（' + clsLabel + '・' + suit + '）／CB ' + val(sp.size, '?') + '%（' +
      val(sp.bet, '?') + 'bb into ' + val(sp.pot, '?') + 'bb）／Hero ' + val(sp.hero, '?') + '／EFF 100bb';
  }

  function hintsLine(hints) {
    if (!hints || !hints.length) return '【ヒント使用】無し';
    return '【ヒント使用】' + Array.prototype.map.call(hints, function (h) {
      if (!h || typeof h !== 'object') return String(h);
      return val(h.field, '?') + (has(h.tier) ? ':tier' + h.tier : '');
    }).join(', ');
  }

  function orderLine(entry) {
    var c = (entry && entry.commit) || {};
    var order = (c.order && c.order.length) ? c.order.join('→') : '未記録';
    var sec = has(c.elapsedMs) ? String(Math.round(Number(c.elapsedMs) / 1000)) : '?';
    var tempo = val(entry && entry.tempo, '?');
    var flags = [];
    if (c.timedOut === true) flags.push('タイムアウト');
    if (c.incomplete === true) flags.push('未完');
    return '【入力順】' + order + '（所要 ' + sec + '秒、テンポ ' + tempo +
      (flags.length ? '、' + flags.join('・') : '') + '）';
  }

  function truthLine(truth) {
    if (!truth || truth.used !== true) return '【自己申告の真値】未入力';
    var b = truth.buckets;
    var buckets = (b && typeof b === 'object')
      ? ('trash ' + pct(b.trash) + '／ハイカード ' + pct(b.hi) + '／ペア以上 ' + pct(b.pairPlus))
      : '未入力';
    return '【自己申告の真値】レンジfold ' + pct(truth.rangeFoldPct) +
      '／自手 fold/call/raise=' + val(truth.heroFold) + '/' + val(truth.heroCall) + '/' + val(truth.heroRaise) + '%' +
      '／3バケツ ' + buckets;
  }

  function selfScoreLine(ss) {
    if (!ss || typeof ss !== 'object') return '【自己採点】未入力';
    return '【自己採点】手順' + val(ss.procedure, '?') + '/サイズ' + val(ss.sizeFold, '?') +
      '/ドロー' + val(ss.drawProtect, '?') + '/答え' + val(ss.action, '?');
  }

  /**
   * user メッセージを組む（SPEC ⑦ buildPrompt）。
   * sheetText（sheet.toText の出力）があればそれを【前提票】本文に使い、無ければ entry.sheet から組む。
   */
  function buildPrompt(entry, sheetText) {
    var e = entry || {};
    var body = (typeof sheetText === 'string' && sheetText.trim()) ? sheetText.trim() : sheetToText(e.sheet);
    return [
      spotLine(e.spot),
      '【前提票】',
      body,
      hintsLine(e.hints),
      orderLine(e),
      truthLine(e.truth),
      selfScoreLine(e.selfScore),
      'この票を10点満点で採点して。'
    ].join('\n');
  }

  // ---- リクエスト ----
  function requestBody(model, prompt, withEffort) {
    var outputConfig = { format: { type: 'json_schema', schema: JUDGE_SCHEMA_PD } };
    if (withEffort) outputConfig.effort = EFFORT;
    return {
      model: model,
      max_tokens: MAX_TOKENS,
      system: JUDGE_SYS_PD,
      messages: [{ role: 'user', content: prompt }],
      output_config: outputConfig
    };
  }

  function defaultFetch(url, opts) {
    if (typeof root.fetch !== 'function') {
      return Promise.reject(new Error('fetch unavailable'));
    }
    return root.fetch(url, opts);
  }

  function send(key, body) {
    var f = api._fetch;
    if (typeof f !== 'function') return Promise.reject(new Error('_fetch is not a function'));
    return Promise.resolve().then(function () {
      return f(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
    });
  }

  function isOk(r) {
    if (typeof r.ok === 'boolean') return r.ok;
    var st = Number(r.status);
    return st >= 200 && st < 300;
  }

  function readJson(r) {
    if (typeof r.json === 'function') return Promise.resolve().then(function () { return r.json(); });
    if (typeof r.text === 'function') {
      return Promise.resolve().then(function () { return r.text(); }).then(function (t) { return JSON.parse(t); });
    }
    return Promise.reject(new Error('no body reader'));
  }

  function extractText(json) {
    var content = json && json.content;
    if (!content || !content.length) return '';
    return Array.prototype.filter.call(content, function (b) { return b && b.type === 'text'; })
      .map(function (b) { return String(b.text || ''); }).join('');
  }

  function toInt(v, lo, hi) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) n = lo;
    return Math.min(hi, Math.max(lo, n));
  }
  function str(v) { return (v === null || v === undefined) ? '' : String(v); }

  /** score 0–10 clamp、items を配点上限で clamp、合計≠score なら合計を採用 */
  function normalize(raw, model) {
    var rawItems = (raw.items && typeof raw.items === 'object') ? raw.items : {};
    var items = {};
    var sum = 0;
    Object.keys(ITEM_MAX).forEach(function (k) {
      items[k] = toInt(rawItems[k], 0, ITEM_MAX[k]);
      sum += items[k];
    });
    var score = toInt(raw.score, 0, 10);
    if (score !== sum) score = sum;
    return {
      score: score,
      items: items,
      verdict: str(raw.verdict),
      good: str(raw.good),
      miss: str(raw.miss),
      fix_one_line: str(raw.fix_one_line),
      gap_type: str(raw.gap_type),
      gap_reason: str(raw.gap_reason),
      boundary_hand_named: raw.boundary_hand_named === true,
      villain_range_used: raw.villain_range_used === true,
      model: model,
      at: new Date().toISOString()
    };
  }

  function fail(error, status) {
    var out = { ok: false, error: error };
    if (status !== undefined) out.status = status;
    return out;
  }

  /**
   * Claude 採点。キー無しなら fetch せずに NO_KEY。
   * エラー分類：NO_KEY / BAD_KEY(401) / HTTP(他 status) / NET / PARSE / TRUNC / REFUSAL
   * output_config.effort で 400 が返ったら effort を外して1回だけ再試行。
   */
  function judge(entry, sheetText) {
    var key = getApiKey();
    if (!key) return Promise.resolve(fail('NO_KEY'));

    var model = getModel();
    var prompt = buildPrompt(entry, sheetText);

    return send(key, requestBody(model, prompt, true))
      .then(function (r) {
        if (r && Number(r.status) === 400) {
          return send(key, requestBody(model, prompt, false));
        }
        return r;
      })
      .then(function (r) {
        if (!r || typeof r !== 'object') return fail('NET');
        var status = Number(r.status);
        if (!isOk(r)) {
          if (status === 401) return fail('BAD_KEY', 401);
          return fail('HTTP', isFinite(status) ? status : undefined);
        }
        return readJson(r).then(function (json) {
          if (!json || typeof json !== 'object') return fail('PARSE');
          if (json.stop_reason === 'max_tokens') return fail('TRUNC');
          if (json.stop_reason === 'refusal') return fail('REFUSAL');
          var raw;
          try {
            raw = JSON.parse(extractText(json));
          } catch (e) {
            return fail('PARSE');
          }
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('PARSE');
          return { ok: true, result: normalize(raw, model) };
        }, function () {
          return fail('PARSE');
        });
      }, function () {
        return fail('NET');
      });
  }

  var api = {
    JUDGE_SYS_PD: JUDGE_SYS_PD,
    JUDGE_SCHEMA_PD: JUDGE_SCHEMA_PD,
    MODELS: MODELS,
    MAX_TOKENS: MAX_TOKENS,
    API_URL: API_URL,
    buildPrompt: buildPrompt,
    judge: judge,
    _fetch: defaultFetch
  };
  return api;
})();

if (typeof module !== 'undefined') module.exports = PD.judge;
