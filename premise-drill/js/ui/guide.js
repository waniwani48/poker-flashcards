// premise-drill: PD.ui.guide。「はじめに」＝このアプリの触り方（初回起動で自動表示、以後はホームから）。
//   html(ctx) -> string  純粋（document を使わない）
//   render(root, ctx)    流し込み＋結線（「最初の1問へ」は ctx.next、「暗記から」は ctx.memoStart）
// 他の UI モジュールは参照しない。記事名・著者名・ソルバー数値は書かない。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};

PD.ui.guide = (function () {
  'use strict';

  function sec(title, body) {
    return '<section class="pd-card pd-guide-sec"><h2>' + title + '</h2>' + body + '</section>';
  }
  function ol(items) {
    return '<ol class="pd-guide-list">' + items.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>';
  }
  function ul(items) {
    return '<ul class="pd-guide-list">' + items.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>';
  }

  function html(ctx) {
    var first = !!(ctx && ctx.guideFirst);
    return '<div class="pd-guide">' +
      '<p class="pd-guide-eyebrow pd-mono">はじめに</p>' +
      '<h1 class="pd-guide-title">「この手は強い？」をやめて、<br>「自分のレンジの何番目？」で決める練習</h1>' +
      '<p class="pd-guide-lead">相手のベットに直面した時、答えを見る前に5つの欄を<strong>上から順に</strong>埋める。' +
      '欄を全部埋めるまで call／fold は押せない。答え（GTO Wizard の数字）は自分で見て入力する。' +
      '外した時は「どう外したか」を5つの型から選ぶ。同じ型が2回出たら、次から欄が1つ増える。</p>' +

      sec('毎日の順番', ol([
        '<strong>朝（通勤・スマホ）</strong>：ホームの「暗記」。期日が来た分だけ、思い出してタイプ → 答えを見る → ○× を自分で押す（ボードの問題だけ選択式で自動判定）。2〜10分。',
        '<strong>夜</strong>：ホームの「出題」。前提票を1〜2スポット（時間無制限）。10〜15分。',
        '<strong>打った日</strong>：実戦のハンドを同じ票で（準備中）。',
        '<strong>日曜</strong>：弱点マップを開く。沈んだマスと増えた欄を見るだけでいい。'
      ])) +

      sec('前提票の5欄（この順番が思考の順番）', ol([
        '<strong>サイズ → 必要 fold%</strong>：相手のベット額から、自レンジの何%を降りてよいか。',
        '<strong>自レンジの3バケツ</strong>：trash（Qハイ以下）／ハイカード／ペア以上 が何%ずつか。',
        '<strong>trash の中でドローを持つ手</strong>：弱く見えて守る側に移る手（ガット・オープンエンド・バックドア）。これで純 air が縮む。',
        '<strong>fold 組を弱い順に名指し</strong>：純 air で足りるか。足りなければ次の層から手を名指しで捻出。',
        '<strong>自分のハンドはどこか</strong>：2枚で見る（キッカーにドローが付くか）→ fold 組の中／境界／上 → call か fold。'
      ])) +

      sec('答え合わせ（GTO Wizard）', ul([
        'コミット後に出る「Wizard で BB 応答ノードを開く」を押す。<strong>先に Wizard にログイン</strong>しておく（未ログインだと空の画面に飛ぶ）。',
        '着地したら読むのは2つだけ：<strong>レンジ全体の Fold%</strong> と <strong>自分のハンドの fold／call／raise%</strong>。それを入力。',
        'リンクで着地しない時は、Truth の「手動で3タップ」を開く（ボードをコピーして Wizard に貼る）。'
      ])) +

      sec('自己採点と「型」', ul([
        '採点は過程が9点、答えが1点。<strong>ドロー付き trash を守ると言えたか</strong>が最大配点。',
        '外した時は型を1つ選ぶ：<strong>レンジ状態</strong>（居ない手を数えた）／<strong>定石忘れ</strong>（暗記値を外した）／<strong>規則違い</strong>（条件の違う則を使った）／<strong>強さ順</strong>（役の強さで並べた）／<strong>中庸</strong>（極端が正解なのに真ん中に寄せた）。',
        '同じ型が同じボード種類で2回出ると、次回からその型を潰す欄が票に増える。増えた欄は消さない。'
      ])) +

      sec('弱点マップの見方', ul([
        '行＝出題済みのボード種類、列＝5つの型。',
        '沈んだマス＝再発。「＋」＝欄が増えた。輪＝連続クリア（4回で沈みが消える）。',
        '数字は出ない。「どこが濁っていて、どこが晴れてきたか」だけ見る。'
      ])) +

      sec('最初の2週間の目標', ul([
        '10スポット：自分の外し方の型が1〜2個分かる。',
        '20スポット：ボードを見た瞬間に3バケツ%の概算が出る。速度モードが解放される。',
        'やらないこと：記事を読み返して解く／マップの色を気にする／正解したかで一喜一憂する。'
      ])) +

      '<div class="pd-guide-actions">' +
        '<button type="button" class="pd-btn pd-btn-primary pd-btn-block" data-act="guide-memo">暗記から始める</button>' +
        '<button type="button" class="pd-btn pd-btn-ghost pd-btn-block" data-act="guide-drill">最初の1問へ</button>' +
        (first ? '' : '<button type="button" class="pd-btn pd-btn-ghost pd-btn-block" data-go="home">ホームへ</button>') +
      '</div>' +
    '</div>';
  }

  function render(rootEl, ctx) {
    if (!rootEl) return;
    ctx = ctx || {};
    rootEl.innerHTML = html(ctx);
    if (typeof rootEl.addEventListener !== 'function') return;
    rootEl.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      if (!t || typeof t.closest !== 'function') return;
      var a = t.closest('[data-act]');
      if (!a) return;
      var act = a.getAttribute('data-act');
      if (typeof ctx.guideSeen === 'function') ctx.guideSeen();
      if (act === 'guide-memo' && typeof ctx.memoStart === 'function') ctx.memoStart();
      else if (act === 'guide-drill' && typeof ctx.next === 'function') ctx.next();
    });
  }

  return { html: html, render: render };
})();

if (typeof module !== 'undefined') module.exports = PD.ui.guide;
