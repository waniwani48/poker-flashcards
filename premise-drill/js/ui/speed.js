// premise-drill: PD.ui.speed（T12）。T0 のプレースホルダ。T12 が本実装で上書きする。
var root = typeof window !== "undefined" ? window : globalThis;
var PD = root.PD = root.PD || {};
PD.ui = PD.ui || {};
PD.ui.speed = PD.ui.speed || {};

// TODO(T12): PD.ui.speed.render(root, ctx) を実装する（SPEC ⑫ UI 契約。他の UI モジュールを参照せず、状態は ctx 経由のみ）
