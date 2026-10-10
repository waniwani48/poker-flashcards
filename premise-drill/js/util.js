// premise-drill: PD.util（T0）。純粋・依存なし。SPEC ⑫ の契約：
//   esc / id / today / rng(mulberry32) / pick / weighted / clamp
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.util = (function () {
  'use strict';

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** HTML エスケープ。null/undefined は空文字 */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  /** prefix + '_' + base36(now) + rand */
  function id(prefix) {
    var now = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 8);
    return String(prefix || 'x') + '_' + now + rand;
  }

  /** ローカル日付 'YYYY-MM-DD' */
  function today() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return y + '-' + m + '-' + day;
  }

  /** mulberry32。seed が数値でなければランダムに採る。戻りは [0,1) */
  function rng(seed) {
    var a = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : (Math.floor(Math.random() * 4294967296) >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 配列から1つ。r は [0,1) を返す関数（省略時 Math.random） */
  function pick(arr, r) {
    if (!arr || !arr.length) return undefined;
    var f = typeof r === 'function' ? r : Math.random;
    var i = Math.floor(f() * arr.length);
    if (i >= arr.length) i = arr.length - 1;
    return arr[i];
  }

  /** {w:number} を持つ要素から重み付きで1つ。w<=0 は選ばれない */
  function weighted(items, r) {
    if (!items || !items.length) return undefined;
    var f = typeof r === 'function' ? r : Math.random;
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var w = Number(items[i] && items[i].w) || 0;
      if (w > 0) total += w;
    }
    if (total <= 0) return items[0];
    var x = f() * total;
    for (i = 0; i < items.length; i++) {
      var wi = Number(items[i] && items[i].w) || 0;
      if (wi <= 0) continue;
      x -= wi;
      if (x < 0) return items[i];
    }
    return items[items.length - 1];
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) n = lo;
    return Math.min(hi, Math.max(lo, n));
  }

  return {
    esc: esc,
    id: id,
    today: today,
    rng: rng,
    pick: pick,
    weighted: weighted,
    clamp: clamp
  };
})();

if (typeof module !== 'undefined') module.exports = PD.util;
