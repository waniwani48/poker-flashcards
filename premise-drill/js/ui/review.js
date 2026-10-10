// premise-drill: PD.ui.review（T15）。T0 のプレースホルダ。T15 が本実装で上書きする。
var root = typeof window !== "undefined" ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};
PD.ui.review = PD.ui.review || {};

// TODO(T15): PD.ui.review.render(root, ctx) を実装する（SPEC ⑫ UI 契約。他の UI モジュールを参照せず、状態は ctx 経由のみ）
