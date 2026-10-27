/* 前提票ドリル service worker
 * 方針：アプリ本体（HTML/CSS/JS/アイコン）はキャッシュ優先＋裏で更新（stale-while-revalidate）。
 * 外部（Google Fonts・GTO Wizard・Anthropic API）は触らない＝ネットワーク直通。
 * CACHE 名を上げると旧キャッシュは activate で消える。index.html の ?v= と合わせて更新する。
 */
var V = '16';
var CACHE = 'pd-v' + V;
var CORE = [
  './', './index.html', './manifest.webmanifest',
  './css/tokens.css', './css/app.css', './css/ui-home.css', './css/ui-drill.css', './css/ui-truth.css', './css/ui-map.css', './css/ui-settings.css', './css/ui-guide.css', './css/ui-memo.css',
  './js/util.js', './js/cards.js', './js/range-data.js', './js/range.js', './js/generator.js', './js/sheet.js', './js/wizard.js', './js/gaps.js', './js/localjudge.js', './js/store.js', './js/judge.js', './js/memo.js',
  './js/ui/memo.js', './js/ui/guide.js', './js/ui/home.js', './js/ui/drill.js', './js/ui/truth.js', './js/ui/map.js', './js/ui/settings.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

/** index.html が参照する実 URL（js/css は ?v= 付き）に揃えてプリキャッシュする */
function versioned(u) { return /\.(js|css)$/.test(u) ? u + '?v=' + V : u; }

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 1件失敗しても install を落とさない（CDN 反映待ちの間に開かれても良いように）
      return Promise.all(CORE.map(versioned).map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // 自オリジン・自スコープ以外（Fonts / Wizard / API）は介入しない
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(self.registration.scope.replace(self.location.origin, '')) !== 0) return;

  // ナビゲーション（index.html）はネットワーク優先：オンラインなら常に最新、オフラインだけキャッシュ
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () {
        return caches.open(CACHE).then(function (c) {
          return c.match(req, { ignoreSearch: true }).then(function (hit) { return hit || c.match('./index.html'); });
        });
      })
    );
    return;
  }

  ev.respondWith(
    caches.open(CACHE).then(function (c) {
      // js/css は ?v= を含めて照合＝版上げが効く（キャッシュ優先＋裏で更新）
      var opts = undefined;
      return c.match(req, opts).then(function (hit) {
        var fetching = fetch(req).then(function (res) {
          if (res && res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || fetching;
      });
    })
  );
});
