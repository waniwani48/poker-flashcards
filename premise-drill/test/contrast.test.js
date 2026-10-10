// css/tokens.css の --ink と --bg / --surface の WCAG コントラスト比が 4.5 以上であることを確認する（T0）。
// 相対輝度と比の式は自前実装（WCAG 2.x）。
'use strict';

var fs = require('fs');
var path = require('path');

function readTokens() {
  var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'tokens.css'), 'utf8');
  var rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
  var body = rootBlock ? rootBlock[1] : css;
  var out = {};
  var re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  var m;
  while ((m = re.exec(body))) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

function hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) {
    h = h.split('').map(function (c) { return c + c; }).join('');
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function channel(c) {
  var v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  var c = hexToRgb(hex);
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function ratio(a, b) {
  var la = luminance(a);
  var lb = luminance(b);
  var hi = Math.max(la, lb);
  var lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = {
  name: 'contrast (tokens.css)',
  run: function (assert) {
    var t = readTokens();
    ['ink', 'bg', 'surface', 'mute', 'lamp', 'truth'].forEach(function (k) {
      assert.ok(t[k], '--' + k + ' が tokens.css の :root に無い');
    });

    var inkBg = ratio(t.ink, t.bg);
    var inkSurface = ratio(t.ink, t.surface);
    console.log('  --ink/--bg      = ' + inkBg.toFixed(2));
    console.log('  --ink/--surface = ' + inkSurface.toFixed(2));
    console.log('  (参考) --mute/--bg = ' + ratio(t.mute, t.bg).toFixed(2) +
      ', --mute/--surface = ' + ratio(t.mute, t.surface).toFixed(2) +
      ', --bg/--lamp = ' + ratio(t.bg, t.lamp).toFixed(2) +
      ', --bg/--truth = ' + ratio(t.bg, t.truth).toFixed(2));

    assert.ok(inkBg >= 4.5, '--ink/--bg のコントラスト比 ' + inkBg.toFixed(2) + ' < 4.5');
    assert.ok(inkSurface >= 4.5, '--ink/--surface のコントラスト比 ' + inkSurface.toFixed(2) + ' < 4.5');

    // 式の自己検算：白/黒は 21、同色は 1
    assert.ok(Math.abs(ratio('#ffffff', '#000000') - 21) < 0.01, '白/黒の比が 21 でない');
    assert.ok(Math.abs(ratio('#777', '#777') - 1) < 1e-9, '同色の比が 1 でない');
  }
};
