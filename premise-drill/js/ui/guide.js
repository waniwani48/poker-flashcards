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

      sec('毎日できること（上限と目安）', ul([
        '<strong>暗記</strong>：期日が来た札を全部＋新規はデッキごと1日4枚まで＋ボード問題が毎日3枚。目安 2〜10分。',
        '<strong>出題（前提票）</strong>：何問でもできる。1問目は日替わりの<strong>「今日のボード」</strong>（その日は誰が開いても同じボード）。目安は1〜2スポット 10〜15分。',
        '<strong>実戦の持ち込み</strong>：1日3ハンドまで（準備中）。',
        '<strong>速度モード</strong>：通算20スポットで解放。',
        '<strong>連続日数</strong>：上のどれか1つやれば続く。忙しい日は暗記だけでいい。'
      ])) +

      sec('前提票の5欄（この順番が思考の順番）', ol([
        '<strong>サイズ → 必要 fold%</strong>：相手のベット額から、自レンジの何%を降りてよいか。',
        '<strong>自レンジの3バケツ</strong>：trash（Qハイ以下）／ハイカード／ペア以上 が何%ずつか。',
        '<strong>trash の中でドローを持つ手</strong>：弱く見えて守る側に移る手（ガット・オープンエンド・バックドア）。これで純 air が縮む。',
        '<strong>fold 組を弱い順に名指し</strong>：純 air を全部降ろして足りるか。足りなければ、次に弱い層から降ろす手を名指しで追加。',
        '<strong>自分のハンドはどこか</strong>：2枚で見る（キッカーにドローが付くか）→ fold 組の中／境界／上 → call か fold。'
      ])) +

      sec('答え合わせ（アプリ判定）', ul([
        'コミットすると「アプリ判定」が①〜⑤の ○× と正解値を出す。土台は<strong>設定の「BB の守りレンジ表」</strong>（13×13）。①〜④は厳密、⑤だけ仮の序列からの予測。',
        'レンジ表が空だと判定は出ない。最初に一度、Wizard の BB 応答ノードを見ながら埋める（タップで フォールド→コール→3bet→混合）。',
        'Wizard は<strong>任意の検算</strong>。開くなら先にログインしておき、見た数字を「Wizard で見た数字を入れる」に入れると⑤の採点はそちらを優先する。'
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

      sec('コラム：アンカーの話（なぜ1セットで足りて、どこで壊れるか）', (
        '<p class="pd-guide-lead">②で使うアンカーは丸暗記しなくていい。覚えるのは <strong>13</strong> ひとつと「形」だけ：' +
        '<strong>13（ポケット）→＋5→18（Kハイ）→＋5→23（Aハイ）→てっぺんの倍＝46（trash）</strong>。' +
        'trash がほぼ半分なのは、BB のコールレンジが「降りるには惜しい Q 以下のスーテッド」だらけだから。</p>' +
        '<p class="pd-guide-lead"><strong>なぜ相手のポジションで変わらないのか。</strong>' +
        'どの対面でも丸ごとコールに残る帯（ポケット 22〜99・A スーテッド・K スーテッド）が同じで、' +
        '増減するのは「低スーテッドとオフスートの下限」という1本の線だけ。全バケツがほぼ比例して伸び縮みするので、割合は動かない。' +
        'しかも現実の 6max は狭いポジションほど小さく開く（UTG 2.0bb）ので、「狭いから狭く守る」と「安いから広く守る」が打ち消し合う。' +
        '唯一の例外が vs SB：99・TT が 3bet に抜けて、ポケットだけ 13→9 に落ちる。</p>' +
        '<p class="pd-guide-lead"><strong>ただし、ポットが育つと壊れる</strong>（同じツリーの実測概算）：</p>' +
        ul([
          'SRP の BB コール：ポケット13／Aハイ23／Kハイ18／trash <strong>46</strong>',
          '3bp の BTN コール側（凝縮）：ポケット<strong>28</strong>／Aハイ35／Kハイ25／trash <strong>12</strong> ＝「半分ゴミ」→「9割実弾」',
          '3bp の BB 3bet 側（ポラー）：Aハイ<strong>38</strong>（AK・AQ＋A5s/A4s）／trash 26 は bluff 枠',
          '4bp の BB コール側：ポケット<strong>26</strong>／Aハイ<strong>17</strong>（上位 Ax はジャムに抜ける）／スーコネ帯が37残る'
        ]) +
        '<p class="pd-guide-lead">含意：ポットが育つほどポケットが倍増し trash が消える＝<strong>「安い手で fold を払う」が物理的にできなくなる</strong>。' +
        'だから capped 側は暗記値どおりでなく多めに降りる（暗記カードの「4bp は overfold」の正体）。' +
        'アンカーは<strong>ポットタイプごとに1セット</strong>。このドリルは SRP だけなので、今は 13/18/23/46 だけで戦える。</p>'
      )) +

      sec('コラム：役じゃなくレンジ内順位（⑤の正体）', (
        '<p class="pd-guide-lead">「トップペアだから call」「A ハイだから fold」——役名で決めた瞬間に⑤は外れる。' +
        '判定の正体は<strong>「自レンジの弱い方から数えて何%地点に居るか」対「必要 fold%」</strong>の比較だけで、役名は出てこない。' +
        '必要 fold% が 30 なら、下位 30% に入っていれば TP だろうが降りるし、上位 70% に入っていれば A ハイだろうが守る。</p>' +
        '<p class="pd-guide-lead">役名が信用できないのは、<strong>レンジ内の順位がストリートごとに入れ替わる</strong>から。2つの動きがある：</p>' +
        ul([
          '<strong>再序列化</strong>：K75 で call した大量の Ax は、Turn の A でトップペアに昇格する。すると旧トップペアの Kx が相対的に降格して、KJ ですら fold 側へ落ちる。',
          '<strong>シフト</strong>：前のストリートで弱かった手がボードで強化されると、レンジの下限ごと上がる。QJ4-9s では TP が fold なのに、K75-Td では TP が call なのはこれ。「同じ役」でも住んでいるレンジが違う。'
        ]) +
        '<p class="pd-guide-lead">⑤の2枚チェック（BDFD・BDSD・ガット）が境界で効くのも同じ理屈。' +
        '境界付近は役がほぼ同じ手の渋滞だから、<strong>2枚目に付いたおまけが順位を1〜2段動かして、call と fold を分ける</strong>。' +
        'だから「A ハイで終わらせない。2枚で見る」。</p>'
      )) +

      sec('コラム：弱く見えて繋がる手（③の正体）', (
        '<p class="pd-guide-lead">③は前提票でいちばん配点が重い（4点）。理由は、ここが<strong>「降ろされる手の総量」を決める栓</strong>だから。</p>' +
        '<p class="pd-guide-lead">678 のようなコネクテッドなボードでは、9T・54・ガット持ちが「air に見えて実は OESD／ストレート」で守る側に回る。' +
        'すると<strong>純 air（本当に何も無い手）が縮む</strong>。fold は縮んだ純 air からしか払えないので、' +
        '純 air が必要 fold% に届かず、<strong>fold の負担がドロー無しの弱ハイカードへ波及する</strong>。' +
        '「ドローを守る」と「弱ハイカードが余計に降ろされる」はセットで起きる、ここが肝。</p>' +
        '<p class="pd-guide-lead">見落としやすいのが2つ：</p>' +
        ul([
          '<strong>バックドア</strong>：ドライな K75r ですら、BDFD・BDSD 持ちの trash がレンジの 25〜30% を占める（実測）。1枚ドローが無い＝移る量 0 ではない。',
          '<strong>フラッシュドロー</strong>：(a) のランク選択はストレートドロー専用。2トーンのボードなら (a) が「無し」でも FD で移る量は 10% 前後入る。'
        ]) +
        '<p class="pd-guide-lead">手順はいつも同じ：②の trash から③で移る分を引いた残りが④の純 air。' +
        'この引き算を飛ばして「弱い順＝役の弱い順」で数え始めると、強さ順の型に落ちる。</p>'
      )) +

      sec('コラム：EQ差 overfold の地図（①の上級編）', (
        '<p class="pd-guide-lead">①の暗記値（33%→30 など）は出発点で、<strong>自レンジが相手レンジよりエクイティで劣るほど、暗記値を超えて降りてよい</strong>（overfold）。' +
        'どこで超えて、どこで暗記値に戻るのか。地図はこうなっている。</p>' +
        '<p class="pd-guide-lead"><strong>超えるスポット（多めに降りる）：</strong></p>' +
        ul([
          '<strong>4bet ポット</strong>：コールレンジがキャップされて脆い（上位は全部ジャムに抜けている）。A ハイのボードでは 10% の CB にすら半分降りる実測がある。',
          '<strong>vs UTG のフロップ</strong>：レンジ差が最大の対面。',
          '<strong>ポラーを吐いた後の capped レンジ</strong>：強い手を前のアクションで出し切った残り。',
          '<strong>ワイドに守ったポット（リンプ等）</strong>：母数が弱い。'
        ]) +
        '<p class="pd-guide-lead"><strong>暗記値どおりに戻るスポット：</strong>BTN vs BB のようにレンジ差が小さい対面。' +
        'そしてもう1つが見落としがち——<strong>trash が落ちた後の Turn</strong>。' +
        'フロップで BB が overfold すると（弱ペア・裸の下ヒットが純 fold）、Turn に持ち込まれたレンジは強く狭く、EQ はほぼ拮抗する（KT53 で BB52:UTG48 の実測）。' +
        '<strong>EQ差は trash が落ちるストリートで消費される</strong>。「プリフロで劣っていたから Turn もまだ劣位」は誤りで、参照は常に「その時点のレンジ EQ」。</p>'
      )) +

      sec('コラム：純α 25 と暗記値 30 の差はどこから来るか', (
        '<p class="pd-guide-lead">33% ベットの純α（ベット÷(ベット＋ポット)）は 25%。なのに暗記値は 30。この 5pt は何か。</p>' +
        '<p class="pd-guide-lead">純αは「相手のブラフを 0EV にする最低ライン」で、<strong>自分の手がポットを取り切れる前提</strong>の数字。' +
        '現実の BB は3つの重りを背負っている（ここは実測値への私の因果の読み）：</p>' +
        ul([
          '<strong>実現エクイティ</strong>：OOP の弱い手は、持っているエクイティを最後まで実現できない。紙の上で 30% ある手が実際には 25% 分しか取れないなら、守る価値のラインは上がる。',
          '<strong>レンジ EQ の劣位</strong>：BB のコールレンジ vs オープンレンジは基本劣位。境界の手は以降のストリートでも不利な判断を迫られ続ける。',
          '<strong>以降のベットに晒される</strong>：フロップを守っても Turn・River の弾が待っている。境界の手のコールは「1回分の価格」では済まない。'
        ]) +
        '<p class="pd-guide-lead">だから実践値は「純αより少し多めに降りる」側に寄る。33%→30、50%→40、75%→50、125%→60。' +
        '逆に言うと、<strong>この 5〜10pt の上乗せは既にレンジ劣位の分を織り込んでいる</strong>ので、普通の SRP でさらに感覚で上乗せすると降りすぎになる。' +
        '追加で盛るのは上のコラムの overfold スポットだけでいい。</p>'
      )) +

      sec('コラム：ボード7分類の話（族はなぜこの分け方か）', (
        '<p class="pd-guide-lead">弱点マップの行になっている7分類（ドライ・ハイ／ブロードウェイSD／ミドル／ロー／ペア／モノトーン／トリップス）は、' +
        '見た目の分類ではなく<strong>「BB のレンジがどう当たるか」の分類</strong>になっている。</p>' +
        ul([
          '<strong>ドライ・ハイ（K72r 等）</strong>：BB のハイカード枠（A23・K18）の片方がペア化し、残りは当たらない。相手（BTN）はほぼ全レンジでベットできる（K72r・Q72r は純レンジベットの実測）。',
          '<strong>A ハイだけ例外</strong>：BB は A ハイボードでハイカード枠がほぼ消える（Ax がペア化、Kx だけ残る）。一方 BTN も「BB が Ax をあまり持たない」ことを知っていて、マージナルを打つ価値が薄く、A72r はチェック約48%。「ハイ＝レンジベット」は K・Q ハイ限定。',
          '<strong>ミドル（T・9 ハイ）</strong>：ハイカード枠 41 がフルに残る＝BB のレンジが刺さりやすく、しかも T・9 はスーコネ帯でペア化も厚い（ランク密度 17〜22）。BTN のベット頻度が落ちる。',
          '<strong>ロー（8 以下）</strong>：同じくハイカード枠は残るが、ペア化は薄い。trash の中のドロー（③）が最大化する族。',
          '<strong>ペア／モノ／トリップス</strong>：役の底が変わる（ペアの価値が落ちる／フラッシュが完成している）ので、序列のルールごと別物。だから別の行。'
        ]) +
        '<p class="pd-guide-lead">判別の軸は1つ：<strong>「相手に継続帯があり、自分のマージナルに打つ価値があるか」</strong>。' +
        '族ごとに②③の形がパターン化してくるので、同じ族を2〜3回やると「見た瞬間に3バケツの概算が出る」状態に近づく。</p>'
      )) +

      sec('コラム：5つの型の解剖（自分がどう外すかを知る）', (
        '<p class="pd-guide-lead">弱点マップの列は「どの知識が無いか」ではなく<strong>「どういう壊れ方をしたか」</strong>の分類。見分けの順番ごと覚えるといい。</p>' +
        ul([
          '<strong>レンジ状態</strong>：自レンジに居ない手を数えた（3bet に回った上位、プリフロで降りた下位）。④の名指しに AA や 72o が混ざる、%でなく「多い・少ない」の形容詞で済ませるのが兆候。',
          '<strong>定石忘れ</strong>：暗記値そのものの未想起。①が暗記値から大きく外れる、①を最後に埋める、が兆候。治療は暗記レーン。',
          '<strong>規則違い</strong>：則は知っているが条件の違う則を使った。50% に 33% の値で処理する、レインボーでフラッシュの則を使う、など。「条件→則」を1行で言えるかで検査。',
          '<strong>強さ順</strong>：役の強さで並べた。④がランク順の単調な並び、⑤の2枚チェック無視が兆候。上のコラム「レンジ内順位」が解毒剤。',
          '<strong>中庸</strong>：正解が極端（pure fold／pure call）なのに真ん中に寄せた。確信度 40〜60% が続くのが兆候。先に「極端側はどっちか」を書いてから量を調整する。'
        ]) +
        '<p class="pd-guide-lead">同じ型×同じ族が2回出ると票に欄が増えるのは、この分類を「次の1問の手順」に変換する仕掛け。' +
        '型の自己申告の精度が上がるほど、マップと追加欄が正しく効く。迷ったら「どの欄で最初に手が止まったか」が型のヒントになる。</p>'
      )) +

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
