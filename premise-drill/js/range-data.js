// premise-drill: PD.rangeData（Phase D）。同梱する初期レンジ。データだけ（ロジックは js/range.js）。
// 形は SPEC-judge.md §1.1：{ v: 1, cells: { [hand]: 'call'|'3bet'|'mix'|'fold' }, updatedAt, source }。
// cells に無い手は 'fold'。手の書式は 'AKs' / 'AKo' / 'AA'。
// 初期値＝BB が BTN 2.5bb オープンに直面した応答（6max 100bb）を 2026-10-16 に 4 状態へ量子化して起こしたもの。
// 量子化：fold が 50% 以上 → fold／3bet と call が共に 25% 以上 → mix／残りは多い方。頻度の数値は持たない。
// 設定画面で上書きでき、上書きは localStorage（pd_range_v1）に入る。この初期値は参照用。
var root = typeof window !== 'undefined' ? window : globalThis;
var PD = root.PD = root.PD || {};

PD.rangeData = {
  bb_vs_btn_25: {
    v: 1,
    cells: {
    'AA': '3bet', 'AKs': '3bet', 'AKo': '3bet', 'AQs': '3bet', 'AQo': '3bet', 'AJs': '3bet', 'AJo': 'call', 'ATs': 'call', 'ATo': 'mix', 'A9s': 'call', 'A9o': 'call', 'A8s': 'call', 'A8o': 'mix', 'A7s': 'call', 'A7o': 'mix', 'A6s': 'call', 'A5s': '3bet', 'A5o': 'mix', 'A4s': 'mix', 'A3s': 'call', 'A2s': 'call',
    'KK': '3bet', 'KQs': '3bet', 'KQo': 'mix', 'KJs': 'call', 'KJo': 'mix', 'KTs': 'mix', 'KTo': 'mix', 'K9s': 'call', 'K9o': 'mix', 'K8s': 'call', 'K7s': 'call', 'K6s': 'call', 'K5s': 'call', 'K4s': 'call', 'K3s': 'call', 'K2s': 'call',
    'QQ': '3bet', 'QJs': 'call', 'QJo': 'mix', 'QTs': 'call', 'QTo': 'mix', 'Q9s': 'call', 'Q8s': 'call', 'Q7s': 'call', 'Q6s': 'call', 'Q5s': 'call', 'Q4s': 'mix', 'Q3s': 'mix', 'Q2s': 'mix',
    'JJ': '3bet', 'JTs': 'mix', 'JTo': 'mix', 'J9s': 'call', 'J9o': 'call', 'J8s': 'call', 'J7s': 'mix', 'J6s': 'mix', 'J5s': 'mix', 'J4s': 'mix',
    'TT': '3bet', 'T9s': 'mix', 'T9o': 'call', 'T8s': 'call', 'T7s': 'call', 'T6s': 'mix',
    '99': 'mix', '98s': 'mix', '97s': 'call', '96s': 'call',
    '88': 'call', '87s': 'call', '86s': 'call', '85s': 'call',
    '77': 'call', '76s': 'mix', '75s': 'call', '74s': 'call',
    '66': 'call', '65s': 'mix', '64s': 'call',
    '55': 'call', '54s': 'mix', '53s': 'call', '52s': 'call',
    '44': 'call', '43s': 'call',
    '33': 'call',
    '22': 'call'
    },
    updatedAt: '2026-10-16',
    source: '2026-10-16 起こし（4状態・頻度なし）。3bet 12／コール 49／混合 28／フォールド 80 セル'
  }
};

if (typeof module !== 'undefined') module.exports = PD.rangeData;
