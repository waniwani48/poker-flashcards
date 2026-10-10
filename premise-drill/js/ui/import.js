// premise-drill: PD.ui.import（T13b）。T0 のプレースホルダ。T13b が本実装で上書きする。
var root = typeof window !== "undefined" ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};
PD.ui.import = PD.ui.import || {};

// TODO(T13b): PD.ui.import.render(root, ctx) を実装する（SPEC ⑫ UI 契約。他の UI モジュールを参照せず、状態は ctx 経由のみ）
